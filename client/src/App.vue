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
import { Interface } from 'readline';


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

let worker
let requestController
export default Vue.extend({

  name: 'App',

  components: { FileList },

    data: (): CompData => ({
        filers : null,
        chunks: [],
        chunkSize: 20 * 1024 * 1024,//字节1kb=1024字节
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
                            size: Number(chunk.size)
                        } as Chunk, ...await this.fileSlice(filer, end)])
                    } 
                })
            })
        },
        caculateHash(filer: FileInfo): Promise<string> {
            //参照散列的思想，不进行文件的全量hash计算，减少hash的计算量
            const chunks: (Blob []) = []
            const file: File = filer.file
            const offset =  1024 * 1024 * 2

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
            return fileList.filter((file: FileInfo) => !file.isUpload)
        },
        upLoadFile(): Promise<any> {
            return this.sendFile()
        },
        sendRequest(currentFile: any, chunks: Array<any>): Promise<void> {
           
            return new Promise((resolve) => {
                async function send() {
                    const current = chunks.shift()
                    if (!current) {
                        return
                    }
                    const { form, chunk } = current
                    Request().post('/upload', form,  {
                        onUploadProgress: async (progressEvent) => {
                            currentFile.progress += (progressEvent.loaded - chunk.loaded) / currentFile.size * 100
                            chunk.loaded = progressEvent.loaded
                        }
                    }).then(() => {
                        requestController.caculateMore()
                        while (requestController.isOneMore()) {
                            send()
                        }
                        if (currentFile.progress >= 100) {
                            resolve()
                        }
                    })
                }
                requestController.caculateMore()
                while (requestController.isOneMore()) {
                    send()
                }
            })
        },

        async sendFile(): Promise<any> {
            //过滤已经上传过的文件
            // const fileQueue = this.confirmUplodeFile(this.fileList)
            requestController = this.requestController()
            const callback1 = async resolve => {
                const file = requestController.nextFile()
                if (!file) {
                    resolve()
                    return
                }
               
                file.uploading = true
                const chunks = await this.fileSlice(file, 0)
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
                resolve({ file, chunks: newChunks })
            }
            const handleFile = () => new Promise(callback1)

            const goStart = async () => {
               const result = await handleFile()
                if (!result) {
                    return 'done'
                }
                const { file, chunks } = result
                return this.sendRequest(file, chunks).then(() => {//开始发送分片
                    file.uploading = false
                    file.progress = 100
                    file.isUpload = true
                    goStart()
                    return 'done'
                })
            }
            const request = []
            const max = requestController.max()
            while (this.number++ < max) {
                console.log(11)
                request.push(goStart())
            }
            console.log(request)
            return Promise.all(request)
        },
        requestController() {
            const fileQueue = this.confirmUplodeFile(this.fileList)
            let more = 0//初始请求一次
            return {
                nextFile() {
                    return fileQueue.shift()
                },
                isOneMore() {
                    return more-- > 0
                },
                caculateMore() {
                    const max = fileQueue.length < 4 ? fileQueue.length : 4
                    more += (4 - max) + 1//有空余请求，多请求几次
                },
                max() {
                    return fileQueue.length > 4 ? 4 : fileQueue.length
                }
            }
        }
    }
})
</script>
<style lang="scss" scoped>
  #selectFile {
    display: none
  }
</style>