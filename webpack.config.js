const path = require('path');

module.exports = {
    // Inputs
    entry: {
        index: "./src/index.ts"
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
        libraryTarget: 'commonjs',
        path: path.resolve(__dirname, './dist'),
        filename: 'index.js',
    },
    devtool: "source-map",
};