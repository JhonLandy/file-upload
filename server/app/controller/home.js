'use strict';

const Controller = require('egg').Controller;
const fs = require('fs')
const path = require('path')
const hashMap = {}

class HomeController extends Controller {

    async fileUplod() {

        const { ctx } = this;
        const { name, hash } = ctx.request.body
        const files = ctx.request.files

        let result = {
            status: 400,
            msg: '上传失败'
        }
        console.log(hash)
        const filepath = path.resolve(this.config.baseDir, `app/public/${hash}`)

        if (!fs.existsSync(filepath)) {
            fs.mkdirSync(filepath);
        }

        const readStream = fs.createReadStream(files[0].filepath)
        const writeStream = fs.createWriteStream(`${filepath}/${name}`)
        readStream.pipe(writeStream)

        await new Promise(resolve => {
            readStream.on('end', () => {
                console.log(`${name} - ${files[0].filename}-上传成功！`)
                result = {
                    url: `${filepath}/${name}`,
                    status: 200,
                    message: '上传成功'
                }
                resolve()
            })
            readStream.pipe(writeStream)
        })
        ctx.body = result
    }

    async fileMerge() {
        
        const { ctx } = this;
        const { name, hash, size = 0} = ctx.request.body
        const filePath = path.resolve(this.config.baseDir, `app/public/${hash}`)
        const fileUrl = path.resolve(this.config.baseDir, `app/public/${name}`)
        let chunks = []

        await new Promise((resolve, reject) => {
            fs.readdir(filePath, (error, chunkNames) => {
                if (error) {
                    reject(error)
                } else {
                    chunks = chunkNames
                    resolve()
                }
            }) 
        })
        await Promise.all(chunks
            .sort((a, b) => a.split('-')[1] - b.split('-')[1])
            .map((chunkName, index) => new Promise(resolve => {
                const pipeStream = (name, writerStream) => {
                    const readStream = fs.createReadStream(path.resolve(filePath, name))
                    readStream.on('end', function() {
                        resolve()
                    })
                    readStream.pipe(writerStream)
                }
                pipeStream(chunkName, fs.createWriteStream(fileUrl, {
                    start: index * size
                }))
        })))
        console.log(chunks)
        ctx.body = {
            url: fileUrl,
            status: 200,
            message: '合并成功'
        }
    }

    async checkFile() {

        const { ctx } = this;
        const { hash } = ctx.request.query
        const map = {}
        const filePath = path.resolve(this.config.baseDir, `app/public/${hash}`)
        
        if (fs.existsSync(filePath)) {
            let chunks = []
            await new Promise((resolve, reject) => {
                fs.readdir(filePath, (error, chunkNames) => {
                    if (error) {
                        reject(error)
                    } else {
                        chunks = chunkNames
                        resolve()
                    }
                }) 
            })
            for (const chunk of chunks) {
                map[chunk] = chunk
            }
        }
        ctx.body = {
            status: 200,
            chunkMap: map
        }
    }
}

module.exports = HomeController;
