# 断点续传

这个功能前端是基于vue-cli4,后端是基于egg

## 使用

下载

```bash
  git clone https://github.com/JhonLandy/file-upload.git
```

客户端

```bash
  cd file-upload/client
  npm install
  npm run dev
```
服务端
```bash
  cd file-upload/server
  npm install
  npm run dev
```

## 功能点

1. 16进制文件头信息判断文件格式
2. 大文件分片上传
3. 文件hash计算，标记文件在
4. 文件分片续传
5. 文件秒传
6. 多文件断点续传

## 思路

  > 首先，利用16进制文件头信息判断文件类型。应为这部分信息是唯一的，修改了文件后缀还是能正确出来，从而限制文件类型。
  
  > 然后对文件进行hash计算（由于hash计算是比较消耗时间，放在主进程会堵塞），我们采用web-worker的处理方案
  
  > 对大文件进行切片，因为网路速度不佳的时候，上传是缓慢的，容易上传失败，失败得重头开始上传，体验不好，这里选择断点续传，后端验证上传过的分片，只上传没上传过的文件切片，最后再合并文件，清理碎片（对于上传的文件，进行秒传）。
  
  > 但是，还有些问题，因为浏览器的并发数过大，会造成一丢丢卡顿，最后还需要控制文件并行数，请求并行数。

## 代码分析

##### 主题逻辑是这样的：点击上传，启动worker, 开始上传, 上传结束，终止worker。

```js
async doUpload() {
    if (this.uploading) return//正在上传，禁止操作。避免重复操作
    this.uploading = true
    workerController = new WorkerController(MyWorker)//创建worker
    this.upLoadFile()
    .then(result => {
        console.log('上传结果' + result)
    })
    .catch(error => {//捕抓上中的所有错误
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
##### 详细分析：
 ```js
  /*省略*/
  const chunks = await this.fileSlice(file, 0)// 文件切片
  const hash = await this.caculateHash(file)//计算hash
  /*省略*/
  
  const newChunks = chunks//过滤上传过的分片
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
  /*省略*/
 await this.mergeFile(_file.name, _hash, this.chunkSize)//合并文件
 /*省略*/
 ```
 整个过程就是这样：文件切片、hash计算、发送切片、合并切片。下面说明一下worker是什么计算hash和控制请求并发
 
 ##### worker
 
 在worker处理方面，不管要上传多少文件，浏览器只启动一个worker，每一个文件的hash计算，放进队列，等待worker一一计算
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
 
 在计算hahs过程中，有可能文件计算hash失去了响应，这里做了一些超时处理
 
 ```js
 return Promise.race([new Promise((resovle, reject) => {
    //....
    workerController.push(hander)
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
 
 ##### 并发控制
 
 ```js
 send(currentFile, chunks, queue, resolve) {
if (this.rNumber >= this.MaxR) {
    return Promise.resolve('请求过多，不接受请求')
}
//....
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
 ```
 这段代码对切片 会进行错误重传，应为切片在上传的过程中还是会有概率发生上传失败
 
 
 


