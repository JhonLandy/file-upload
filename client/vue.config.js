const path = require("path")
module.exports = {
    publicPath: '/upload',
    runtimeCompiler: true,
    devServer: {
        proxy: {
            '/api': {
                target: 'http://127.0.0.1:7001',
                changeOrigin: true,
                pathRewrite: {
                    '^/api': ''
                }
            }
        },
        open: true
    },
    configureWebpack: {
        resolve: {
            alias: {
                "@": path.resolve(__dirname, "src")
            }
        }
    },
    chainWebpack(config) {
        config
            .when(process.env.NODE_ENV === 'development',
                config => config.devtool('eval')
            );
        // config.module
        //     .rule('worker')
        //     .test('/\.worker\.(c|m)?js$/')
        //     .use('worker')
        //         .loader('worker-loader')
        //         .tap((options = {}) => {
        //             options.esModule = false
        //             return options
        //         })
    }
}