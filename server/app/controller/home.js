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
            .map((chunkName, index) => new Promise((resolve) => {
                const pipeStream = (name, writerStream) => {
                    const readStream = fs.createReadStream(path.resolve(filePath, name))
                    readStream.on('end', () => {
                        resolve(this.removeDocument(filePath))
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
                    resolve(err ? false : true)
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

    removeDocument(path) {
        return new Promise(resolve => {
            fs.readdir(path, (error, chunkNames) => {
                if (error) {
                    reject(error)
                } else {
                    resolve(chunkNames)
                }
            }) 
        })
        .then(chunkNames => {
            return Promise.all(chunkNames.map(chunkName => {
                return new Promise((resolve) => {
                    fs.unlink(`${path}/${chunkName}`, () => {
                        resolve()
                    })
                })
            }))
        })
        .then(() => {
            return new Promise(reoslve => {
                fs.rmdir(path, {}, () => {
                    reoslve()
                })
            })
        })
    }
}

module.exports = HomeController;
