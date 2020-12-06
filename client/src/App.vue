<template>
  <div id="app" vf>
    <input id="selectFile" type="file" @change="handleChange" multiple>
    <el-button type="primary" size="small" @click="doTigger" :disabled="uploading">选择文件</el-button>
    <el-button type="success" size="small" @click="doUpload" :loading="uploading">{{ uploading ? 'upload...': '上传'}}</el-button>
    <FileList :fileList="fileList" :isUplod="uploading" />
  </div>
</template>
<script lang="ts">

import MyWorker from 'worker-loader!./web.worker.js';
import FileList from './components/FileList';
import Vue from 'vue';
import Request from './http/request';


interface FileInfo {
    name: string;//文件名
    type: string;//文件MINE类型
    size: number;//文件总大小（字节）
    hash?: string;//hash值
    file?: File;//当前File文件对象
    progress: number;//切片完成进度
    isUpload: boolean;//是否已经上传完
    uploading: boolean;//是否已经上传完
}

interface Chunk {
    loaded: number;//已上传的大小
    size: number;//切片大小
    chunk: Blob;//分片文件对象
    error: number;//分片上传报错次数，超过三次不再重传
}

interface CompData {
    filers: FileInfo | null;
    chunks: Chunk [];
    chunkSize: number;
    uploadQueue: Promise<any> [];
    fileList: any [];
    uploading: boolean;
    number: number;
    fileQueue: Array<any>;
    chunksMap: Map<string, any>;
}

let worker: MyWorker
let requestController
class RequestController {
    more = 0;//第一次上传的请求书
    MaxR = 0;
    file = [];
    number = 0;//当前正在上传的文件个数
    shouldCaculate = true //判断是否第一次上传，第一次上传不计算
    constructor(file = [], MaxR = 4) {
        this.file = file
        this.MaxR = MaxR
        this.shouldCaculate = false
        this.more = this.file.length > this.MaxR ? 0 : this.MaxR - this.file.length
    }
    nextFile() {
        return this.file.shift()
    }
    isOneMore() {
        return this.more-- > 0
    }
    max() {
        return this.file.length > this.MaxR ? this.MaxR : this.file.length
    }
    send(currentFile, chunks) {
        return new Promise<any>(resolve => {
             const current = chunks.shift()
            if (!current) {
                resolve([])
                return
            }
            this.number++
            const { form, chunk } = current
            Request().post('/upload', form,  {
                onUploadProgress: async (progressEvent) => {
                    currentFile.progress += (progressEvent.loaded - chunk.loaded) / currentFile.size * 100
                    chunk.loaded = progressEvent.loaded
                }
            })
            .then(() => {
                this.number--
            })
            .catch(() => {
                current.chunk.error++
                alert('错误重传')
                if (current.chunk.error < 3) {
                    chunks.unshift(current)
                }
            }).finally(() => {
                this.actions(currentFile, chunks, resolve)
            })
        })
    }
    upload(currentFile, chunks) {
        this.number++
        const uploadHandler = async resolve => {
            await this.actions(currentFile, chunks, resolve)
            this.number--
        }
        return new Promise(uploadHandler)
    }
    actions(currentFile, chunks, resolve) {
        const request = []
        request.push(this.send(currentFile, chunks))
        this.caculateMore()
        while (this.isOneMore()) {
            request.push(this.send(currentFile, chunks))
        }
        return Promise.all(request).then(() => {
            resolve('done')
        })
    }
    caculateMore() {
        this.more = this.shouldCaculate ? (this.number < this.MaxR  ? this.MaxR - this.number : this.more) : this.more
        this.shouldCaculate = true
    }
}
export default Vue.extend({

  name: 'App',

  components: { FileList },

    data: (): CompData => ({
        filers : null,
        chunks: [],
        chunkSize: 20 * 1024 * 600,//字节1kb=1024字节
        uploadQueue: [],
        fileList: [],
        uploading: false,
        number: 0,
        fileQueue: [],//当前正在上传的文件队列,
        chunksMap: new Map()//各个文件的切片hashmap
    }),

    methods: {
        handleChange(e: any): void {
            
            const files: File [] = e.target.files
            let currentFileIndex = 0

            while (files[currentFileIndex]) {
                const currentFile: File = files[currentFileIndex++]
                const newFiler: FileInfo = {
                    name: currentFile.name,
                    type: currentFile.type,
                    size: currentFile.size,
                    progress: 0,
                    isUpload: false,
                    uploading: false,
                    file: currentFile
                }
                this.fileList.push(newFiler)
            }
        },

        async doUpload() {
            if (this.uploading) return//正在上传，禁止操作。避免重复操作
            this.uploading = true
            worker = new MyWorker()//启动wrker
            const result = await this.upLoadFile()
            console.log(result)
            worker = null
            this.uploading = false
        },
        
        doTigger() {
            const selectFile = document.querySelector("#selectFile")
            if (selectFile)  (selectFile as HTMLElement).click()
        },

        getSuffix(filename: string): {
            name: string;
            suffix: string;
        } {
            if (filename) {
            const [name, suffix] = filename.split('.')
            return { name, suffix }
            } 
            this.$message.error('文件不存在')
            return { name: '', suffix: '' }
        },

        fileSlice(filer: FileInfo, start: number): Promise<Chunk []> {
            const chunkSize: number = this.chunkSize
            const end = start + chunkSize
            const file = filer.file
            const chunk = file.slice(start, end)
            return new Promise(resolve => {
                requestIdleCallback(async () => {
                    if (chunk.size === 0) {
                        resolve([])
                    } else {
                        resolve([{
                            loaded: 0,
                            chunk,
                            size: Number(chunk.size),
                            error: 0
                        } as Chunk, ...await this.fileSlice(filer, end)])
                    } 
                })
            })
        },
        caculateHash(filer: FileInfo): Promise<string> {
            //参照散列的思想，不进行文件的全量hash计算，减少hash的计算量
            const chunks: (Blob []) = []
            const file: File = filer.file
            const offset =  1024  * 2 * 1024

            let start = 0
            let mid = start + offset / 2
            let end = start + offset
            
            while (start < filer.size) {
                if (end >= filer.size) {
                    chunks.push(file.slice(end - 2, end))//最后一块不够 散列
                } else {
                    chunks.push(file.slice(start, start + 2))
                    chunks.push(file.slice(mid, mid + 2))
                    chunks.push(file.slice(end - 2, end))
                }
                start += offset
                mid = start + offset / 2
                end = start + offset
            }

            return new Promise(resovle => {
                worker.postMessage(new Blob(chunks))//发送切片计算hash
                worker.onmessage = (event: any) => {
                    const {data: hash} = event
                    resovle(hash)
                }
            })
        },
        confirmUplodeFile(fileList: FileInfo []): FileInfo [] {
            return fileList.filter((file: FileInfo) => {
                if (!file.isUpload) {
                    file.uploading = true
                    return true
                } else {
                    return false
                }
            })
        },
        upLoadFile(): Promise<any> {
            return this.sendFile()
        },
        async sendRequest(currentFile: FileInfo, chunks: Array<any>): Promise<string> {
            return await requestController.upload(currentFile, chunks)
        },
        async sendFile(): Promise<any> {
            const fileQueue = this.confirmUplodeFile(this.fileList)
            requestController = new RequestController(fileQueue)
           
            const request = []
            const max = requestController.max()
            while (this.number++ < max) {
                const result = await this.handleFile()
                const [file, newChunks, hash] = result as Array<any>
                //既要文件切片、哈希计算按顺序紧密执行，又不希望等上一个文件上传完毕，才开始上传下一个文件。因为代码放在一个函数执行，同时await，先当于等上一个文件上传完毕，才开始上传下一个文件
                //while代码块，这里分开做处理，先handleFile，再push一个请求
                request.push(this.startRequestWork(file, newChunks, hash))
            }
            return Promise.all(request)
        },
        async startRequestWork($file: FileInfo, $newChunks: any, $hash: string) {
            const callback = async (_file: FileInfo, _newChunks: any, _hash: string) => {
                if (!_file) return 'done'
                _file.uploading = true
                await this.sendRequest(_file, _newChunks)
                //做个是否已存在文件判断，存在，则不用合并文件
                await this.mergeFile(_file.name, _hash, this.chunkSize)
                _file.uploading = false
                _file.progress = 100
                _file.isUpload = true
                return callback(...await this.handleFile())
            }
            return callback($file, $newChunks, $hash)
        },
        handleFile(): Promise<string | Array<any> >{
            const callback = async resolve => {
                const file: FileInfo = requestController.nextFile()
                if (!file) {
                    resolve([])
                    return
                }
                const chunks = await this.fileSlice(file, 0)
                console.log(chunks)
                const hash = await this.caculateHash(file)
                console.log(hash)
                const { chunkMap }: { 
                    chunkMap: object;
                } = await Request().get('check', {
                    params: { hash }
                })
                const newChunks = chunks
                    .filter((_, index: number) => !chunkMap[`${hash}-${index}`])
                    .map((chunk: Chunk, index: number) => {
                        const form = new FormData()
                        form.append('name', `${hash}-${index}`)
                        form.append('type', file.type)
                        form.append('size', String(file.size))
                        form.append('hash', hash)
                        form.append('file', chunk.chunk)
                        return {
                            form,
                            index,
                            chunk
                        }
                    })
                resolve([file, newChunks, hash])
            }
            return new Promise(callback)
        },
        mergeFile(name: string, hash: string, size: string): Promise<any> {
            return Request().post(`/merge`, {
                name,
                size, 
                hash
            })
        }
    }
})
</script>
<style lang="scss" scoped>
  #selectFile {
    display: none
  }
</style>