# 🚀多文件断点续传

![image](https://github.com/JhonLandy/file-upload/blob/master/%E6%96%AD%E7%82%B9%E7%BB%AD%E4%BC%A01.0.gif)

## 🎉使用

### Download
```bash
git clone https://github.com/JhonLandy/file-upload.git
```

### Client
```bash
cd file-upload/client
npm install
npm run dev
```

### Server
```bash
cd file-upload/server
npm install
npm run dev
```

## 🎉功能点

1. 16进制文件头信息判断文件格式
2. 大文件分片上传
3. 文件续传（断网）
4. 文件秒传
5. 多文件断点续传

## 🎉思路

  - 首先，利用16进制文件头信息判断文件类型。因为这部分信息是唯一的，修改了文件后缀还是能正确出来，从而限制文件类型。
  
  - 然后对文件进行hash计算（由于hash计算是比较消耗时间，放在主进程会堵塞），采用web-worker的处理方案。
  
  - 对大文件进行切片，因为网路速度不佳的时候，上传是缓慢的，容易上传失败，失败得重头开始上传，体验不好，这里选择断点续传。这里有些细节处理:
  
     - 后端验证上传过的分片（服务端需要通过hash判断文件是否已存在服务器），只上传没上传过的文件切片，最后再合并文件，清理碎片（对于上传的文件，进行秒传）
     - 切片是在浏览器空闲时，安排文件切片任务（requestIdleCallback）
     - 小文件进行全量hash计算，大文件散列hash计算（减少耗时）。
     - 切片上传出错，重传三次。
  
  - 但是，还有些问题，因为浏览器的并发数过大，会造成一丢丢卡顿，最后还需要控制文件并行数，请求并行数。
  - 最后，当上传文件数和并发请求数小于上限时，通过算法，为正在上传文件添加新请求，加快上传速度。
  
## 🎉技术点

- typescript
- axios
- promise
- async/await
- vue
- node
- <a href='https://github.com/JhonLandy/file-upload/blob/master/client/src/components/FileList.js'>函数值组件（jsx）</a>
- h5(FileReader、readAsArrayBuffer、Uint8Array)

## 🎉代码分析(只包括前端)

主要讲解一下大致的逻辑，过程涉及到比较细节的处理都在代码里体现了。文件在这：<a href='https://github.com/JhonLandy/file-upload/blob/master/client/src/App.vue'>App.vue</a>

### 简单操作

点击上传，启动worker, 开始上传, 上传结束，终止worker。
```js
async doUpload() {
    if (this.uploading) return//正在上传，禁止操作。避免重复操作
    this.uploading = true
    workerController = new WorkerController(MyWorker)//创建worker
    this.upLoadFile()
    .then(result => {
        console.log('上传结果' + result)
    })
    .catch(error => {//统一处理上传中的所有错误
        if (typeof error === 'string') {
            this.$message.error(error)
        } else {
            console.error(error)
        }
    })
    .finally(() => {
        workerController.compeleted()//终止worker
        workerController = null
        this.uploading = false//上传完毕
    })
}
```
### 主题逻辑：

下面代码整个过程就是这样：文件切片、hash计算、发送切片、合并切片。最后说明一下控制请求并发。

```js

const chunks = await this.fileSlice(file, 0)// 文件切片
const hash = await this.caculateHash(file)//计算hash

...

await this.sendRequest(_file, _newChunks)//发送切片
...
await this.mergeFile(_file.name, _hash, this.chunkSize)//合并文件

```

#### 文件切片：

安排文件在浏览器空闲时上传，不影响主线程做渲染、用户交互操作。重点是：requestIdleCallback！！！

```js
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
}

```

#### hash计算：

- 队列处理：

 在worker处理方面，不管要上传多少文件，浏览器只启动一个worker，每一个文件的hash计算，放进队列，等待worker一一计算。
 ```js
class WorkerController {
    queue = [];
    //....
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
}
 ```
- 计算规则

 下面代码是计算hash的逻辑，参考布隆过滤器的散列思想，对大文件hash计算做处理，减少耗时。
 ```js
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
 ```
 
- 计算超时处理： 
 ```js
return Promise.race([new Promise((resovle, reject) => {
    //....
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
 ```
#### 分片发送
使用axios这个库，进行分片发送，同时计算上传进度。
```js
...

const form = new FormData()
form.append('name', `${hash}-${index}`)
form.append('type', file.type)
form.append('size', String(file.size))
form.append('hash', hash)
form.append('file', chunk.chunk)
...

return Request().post('/upload', form,  {
  onUploadProgress: async (progressEvent) => {//这里有一误差，误差可能来源于请求头的资源大小
      currentFile.progress += (progressEvent.loaded - chunk.loaded) / currentFile.size * 100
      chunk.loaded = progressEvent.loaded
  }
})
```
#### 合并切片
调用接口，告诉后端进行文件切分合并，通过hash定位文件切片
```js
mergeFile(filename: string, hash: string, size: string): Promise<any> {
    const [name, ext] = this.getSuffix(filename)
    return Request().post(`/merge`, {
        hash,
        ext,
        size 
    })
}
```

#### 并发控制：

下面这段代码对切片 会进行错误重传，应为切片在上传的过程中还是会有概率发生上传失败。
```js
class RequestController {
   //....
   constructor(file = [], MaxR = 4) {
    //...
   }
   send(currentFile, chunks, queue, resolve) { 
      if (this.rNumber >= this.MaxR) {
         return Promise.resolve('请求过多，不接受请求')
      }
      //....
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
}
```
 
 
 
 


