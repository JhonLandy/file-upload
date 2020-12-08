'use strict';

const Controller = require('egg').Controller;
const fs = require('fs')
const path = require('path')
const hashMap = {}

class HomeController extends Controller {

    async fileUplod() {

        const { ctx } = this;
        const { name, hash, size } = ctx.request.body
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
        console.log(files[0].filepath)
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
        })
        ctx.body = result
    }

    async fileMerge() {
        
        const { ctx } = this;
        const { hash, ext, size = 0} = ctx.request.body
        const filePath = path.resolve(this.config.baseDir, `app/public/${hash}`)
        const fileUrl = path.resolve(this.config.baseDir, `app/public/${hash}.${ext}`)
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
                console.log(chunkName, index)
                const pipeStream = (name, writerStream) => {
                    const readStream = fs.createReadStream(path.resolve(filePath, name))
                    readStream.on('end', function() {
                        resolve()
                    })
                    readStream.pipe(writerStream)
                }
                pipeStream(chunkName, fs.createWriteStream(fileUrl, {
                    start: index * size,
                    end: (index + 1) * size
                }))
        })))
            
        ctx.body = {
            url: fileUrl,
            status: 200,
            message: '合并成功'
        }
    }

    async checkFile() {
        const { ctx } = this;
        const { hash, ext } = ctx.request.query
        const fileDocument = path.resolve(this.config.baseDir, `app/public/${hash}`)
        const filePath = path.resolve(this.config.baseDir, `app/public/${hash}.${ext}`)
     
        function isUploaded() {
            return new Promise((resolve) => {
                fs.access(filePath, fs.constants.F_OK, (err) => {
                    console.log(err)
                    const uploaded = err ? false : true
                    resolve(uploaded)
                });
            })
        }
        function getChunks() {
            return new Promise((resolve, reject) => {
                if (fs.existsSync(fileDocument)) {
                    fs.readdir(fileDocument, (error, chunkNames) => {
                        if (error) {
                            reject(error)
                        } else {
                            resolve(chunkNames)
                        }
                    }) 
                } else {
                    resolve([])
                }
            })
            .then(chunks => {
                const map = {}
                for (const chunk of chunks) {
                    map[chunk] = chunk
                }
                return map
            })
        }
        const uploaded = await isUploaded()
        console.log(uploaded)
        let chunkMap = {}
        if (!uploaded) {
            const result =await getChunks()
            chunkMap = result
        }
        ctx.body = {
            uploaded,
            chunkMap
        }
    }
}

module.exports = HomeController;
