var path = require('path');
var nodeExternals = require('webpack-node-externals');

module.exports = [
    {
        mode: 'production',
        target: 'web',
        entry: './src/jinaga-browser.ts',
        devtool: 'source-map',
        module: {
            rules: [{
                test: /\.ts$/,
                use: 'ts-loader'
            }]
        },
        resolve: {
            extensions: [ '.ts', '.js' ]
        },
        output: {
            library: 'jinaga',
            libraryTarget: 'amd',
            path: path.resolve(__dirname, './dist'),
            filename: 'jinaga.js'
        }
    },
    {
        mode: 'production',
        target: 'node',
        entry: './src/index.ts',
        devtool: 'source-map',
        module: {
            rules: [{
                test: /\.ts$/,
                use: 'ts-loader'
            }]
        },
        resolve: {
            extensions: [ '.ts' ]
        },
        output: {
            libraryTarget: 'commonjs',
            path: path.resolve(__dirname, './dist'),
            filename: 'index.js',
            devtoolModuleFilenameTemplate: function (info) {
                return "..\\" + path.relative(__dirname, info.absoluteResourcePath);
            },
        },
        externals: [
            nodeExternals()
        ]
    }
]