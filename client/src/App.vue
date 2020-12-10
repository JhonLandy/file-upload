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
    chunks: Chunk [];//切片
    chunkSize: number;//切片大小
    // uploadQueue: Promise<any> [];
    fileList: any [];//文件列表
    uploading: boolean;
    number: number;//上传文件数
    fileQueue: Array<any>;//上传队列
    // chunksMap: Map<string, any>;
    format: Array<string>;//允许上传的文件格式
    fileBinaryStringSet: Set<string>;//16进制的文件格式
}

let worker: MyWorker
let requestController
class RequestController {
    more = 0;//第一次上传的请求书
    MaxR = 0;
    file = [];
    number = 0;//当前正在上传的文件个数
    rNumber = 0;//当前请求数
    // shouldCaculate = true //判断是否第一次上传，第一次上传不计算
    constructor(file = [], MaxR = 4) {
        this.file = file
        this.MaxR = MaxR
        // this.more = this.file.length > this.MaxR ? 0 : this.MaxR - this.file.length
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
    begin() {
        return ++this.number
    }
    end() {
        this.number--
    }
    send(currentFile, chunks, queue, resolve) {
        if (this.rNumber >= this.MaxR) {
            return Promise.resolve('请求过多，不接受请求')
        }

        const current = chunks.shift()
        if (!current) {
            resolve(queue)
            return
        }
        const { form, chunk } = current
        this.rNumber++
        return Request().post('/upload', form,  {
            onUploadProgress: async (progressEvent) => {
                currentFile.progress += (progressEvent.loaded - chunk.loaded) / currentFile.size * 100
                chunk.loaded = progressEvent.loaded
            }
        })
        .then(() => {
            this.rNumber--
        })
        .catch(() => {
            current.chunk.error++
            alert('错误重传')
            if (current.chunk.error < 3) {
                chunks.unshift(current)
            }
        })
        .finally(() => {
            this.actions(currentFile, chunks, queue, resolve)
        })
    }
    upload(currentFile, chunks) {
        return new Promise(resolve => {
            this.actions(currentFile, chunks, [], resolve)
        }).then(requestQueue => {
            return Promise.all(requestQueue).then(() => this.end())
        })
    }
    actions(currentFile, chunks, queue = [], resolve) {
        queue.push(this.send(currentFile, chunks, queue, resolve))
        this.caculateMore()
        while (this.isOneMore()) {
            queue.push(this.send(currentFile, chunks, queue, resolve))
        }
    }
    caculateMore() {
        const fileNumber = this.file.length + 1//表示剩余文件数,用剩余文件数求还能传多少个请求，本身会上传一个，所以要this.file.length + 1 再this.MaxR - fileNumber
        this.more = fileNumber < this.MaxR  ? this.MaxR - fileNumber : 0
    }
}
let workerController 
class WorkerController {
    queue = [];
    worker = null;
    on = false
    constructor(MyWorker) {
        this.worker = new MyWorker()
        this.worker.onerror= function (error) {
            console.log('error', error)
        }
        this.worker.onmessageerror= function (error) {
            console.log('error', error)
        }
    }
    push(handler) {
        this.queue.push(handler)
        if (!this.on) {
            this.on = true
            this.flushWorker()
        }
    }
    flushWorker() {
        while (this.queue.length > 0) {
            const handler = this.queue.shift()
            handler(this.worker)
        }
        this.on = false
    }
    compeleted() {
        this.worker.terminate()
    }
}

const formatMap = {
    'jpg': 'FFD8FF',
    'gif': '47494638',
    'png': '89504E47',
    'zip': '504B0304',
    'rar': '52617221'
}
export default Vue.extend({

  name: 'App',

  components: { FileList },

    data: (): CompData => ({
        filers : null,
        chunks: [],
        chunkSize: 20 * 1024 * 600,//字节1kb=1024字节
        // uploadQueue: [],
        fileList: [],
        uploading: false,
        number: 0,
        fileQueue: [],//当前正在上传的文件队列,
        // chunksMap: new Map(),//各个文件的切片hashmap
        // format: ['gif', 'jpg', 'jpeg', 'png', 'zip'],
        fileBinaryStringSet: new Set()
    }),

    created() {
        for (const key of this.format) {
            this.fileBinaryStringSet.add(formatMap[key])
        }
    },

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
            workerController = new WorkerController(MyWorker)
            this.upLoadFile()
            .then(result => {
                console.log('上传结果' + result)
            })
            .catch(error => {
                if (typeof error === 'string') {
                    this.$message.error(error)
                } else {
                    console.error(error)
                }
            })
            .finally(() => {
                workerController.compeleted()
                workerController = null
                this.uploading = false
            })
        },
        
        doTigger() {
            const selectFile = document.querySelector("#selectFile")
            if (selectFile)  (selectFile as HTMLElement).click()
        },

        getSuffix(filename: string): Array<string> {
            if (filename) {
                const arr = filename.split('.')
                const ext: string = arr[arr.length - 1]
                arr.length = arr.length - 1
                const name: string = arr.join('')
                return [name, ext]
            } 
            this.$message.error('文件不存在')
            return []
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
        async caculateHash(filer: FileInfo): Promise<string> {
            const chunks: (Blob []) = []
            const file: File = filer.file
            if (filer.size < 1024 * 1024 * 2) {
                chunks.push(file)
            } else {
                //参照散列的思想，不进行文件的全量hash计算，减少hash的计算量
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
            }
            let errorId 
            return Promise.race([new Promise((resovle, reject) => {
                    workerController.push(worker => {
                        worker.onerror = () => {
                            reject('There is an error with your worker!')
                        }   
                        worker.postMessage(new Blob(chunks))//发送切片计算hash
                        worker.onmessage = (event: any) => {
                            const {data: hash} = event
                            resovle(hash)
                        }
                    })
                }),
                new Promise((resovle, reject) => {
                    errorId = setTimeout(() => {
                        filer.stop = true
                        reject('计算hash超时') 
                    }, 30 * 1000);
                })])
                .then(hash => {
                    clearTimeout(errorId)
                    return hash
                }, error => {
                    throw error
                })
               
        },
        confirmUplodeFile(fileList: FileInfo []): FileInfo [] {
            return fileList.filter((file: FileInfo) => !file.isUpload)
        },
        async upLoadFile(): Promise<any> {
            return await this.sendFile()
        },
        sendRequest(currentFile: FileInfo, chunks: Array<any>): Promise<string> {
            return requestController.upload(currentFile, chunks)
        },
        async sendFile(): Promise<any> {
            const fileQueue = this.confirmUplodeFile(this.fileList)
            const isAllow = await this.verifyFile(fileQueue)
            console.log('文件是否通过格式检查', isAllow)
            requestController = new RequestController(fileQueue, 4)
            const max = requestController.max()
            const request: Array<any> = []
            const goStart = async () => {
                requestController.begin()
                const result = await this.handleFile()
                console.log(result)
                const [file, newChunks, hash, status] = result
                if (status === 'empty') {//没有下一个文件或者chunks已经全部上传过
                    return 'done'
                }
                console.log(file.name, newChunks)
                const work = this.startRequestWork(file, newChunks, hash, status, goStart)
                //rNumber + 1 表示下一个文件是否还有位置处理
                if (requestController.number < max) {
                    request.push(goStart())
                }
                //既要文件切片、哈希计算按顺序紧密执行，又不希望等上一个文件上传完毕，才开始上传下一个文件。因为代码放在一个函数执行，同时await，先当于等上一个文件上传完毕，才开始上传下一个文件
                //while代码块，这里分开做处理，先handleFile，再push一个请求
                return work
            }
            request.push(goStart())
            return Promise.all(request)
        },
        async startRequestWork($file: FileInfo, $newChunks: any, $hash: string, $status: string, fn: () => Promise<string>) {
            const callback = async (_file: (FileInfo | string), _newChunks: any, _hash: string, _status: string) => {
                _file.uploading = true
                if (_status === 'exist') {//文件上传过
                    _file.uploading = false
                    _file.progress = 100
                    _file.isUpload = true
                    return fn()
                }
                await this.sendRequest(_file, _newChunks)
                //做个是否已存在文件判断，存在，则不用合并文件
                await this.mergeFile(_file.name, _hash, this.chunkSize)
                _file.uploading = false
                _file.progress = 100
                _file.isUpload = true
                return fn()
            }
            return callback($file, $newChunks, $hash, $status)
        },
        handleFile(): Promise<string | Array<any> >{
            const callback = async () => {
                const file: FileInfo = requestController.nextFile()
                if (!file) {
                    return [file, null, null, 'empty']
                }
                const chunks = await this.fileSlice(file, 0)
                const hash = await this.caculateHash(file)
                console.log(file.name, hash)
                const [name, ext] = this.getSuffix(file.name)
                const { uploaded, chunkMap }: { 
                    uploaded: boolean;
                    chunkMap: object;
                } = await Request().get('check', {
                    params: { hash, ext }
                })
                console.log(uploaded, chunkMap, file.name)
                if (uploaded) {//判断是否上传过
                    file.isUpload = true
                    file.progress = 100
                    return [file, null, null, 'exist']
                } 
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
                return [file, newChunks, hash, 'upload']
            }
            return Promise.resolve(callback())
        },
        mergeFile(filename: string, hash: string, size: string): Promise<any> {
            const [name, ext] = this.getSuffix(filename)
            return Request().post(`/merge`, {
                hash,
                ext,
                size 
            })
        },
        async allowFile(file) {
            const res = await this.readFile(file)
            const code = this.fileBinaryStringSet.values()
            console.log(res)
            let result = this.fileBinaryStringSet.size > 0 ? false : true
            for (const value of code) {
                if (new RegExp(`${value}`).test(res)) {
                    result = true
                    break
                }
            }
            if (!result) {
                file.stop = true
                throw `文件格式不对，请上传${this.format.join('、')}格式`
            } else {
                file.stop = false
                return result
            }
        },
        readFile({ file }) {
            return new Promise(resolve => {
                const reader = new FileReader()
                reader.onload = function() {
                    const result = (reader.result as ArrayBuffer)//读取数据
                    const arr = [...new Uint8Array(result).slice(0, 10)]//获取一个8位无符号整型数组
                    resolve(arr.map(v => v < 10 ? '0' + v.toString(16) : v.toString(16).toUpperCase()).join(''))//获取文件格式十六进制
                }
                reader.readAsArrayBuffer(file)
            })
        },
        async verifyFile(fileList) {
            const results = await Promise.all(fileList.map(file => this.allowFile(file)))
            return results.every(isPass => isPass)
        }
    }
})
</script>
<style lang="scss" scoped>
  #selectFile {
    display: none
  }
</style>