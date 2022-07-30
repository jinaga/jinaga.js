const path = require('path');

module.exports = {
    // Inputs
    entry: {
        index: "./src/jinaga-browser.ts"
    },
    resolve: {
        extensions: [".js", ".ts"],
    },

    // Processing
    mode: "production",
    module: {
        rules: [
            {
                test: /\.ts$/,
                loader: "ts-loader",
                include: [
                    path.resolve(__dirname, "./src"),
                ],
                exclude: [/node_modules/],
            },
        ],
    },

    // Outputs
    output: {
        library: 'jinaga',
        libraryTarget: 'amd',
        path: path.resolve(__dirname, './dist'),
        filename: 'jinaga-client.js',
    },
    devtool: "source-map",
};