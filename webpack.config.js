const path = require('path')
const archiver = require('archiver')
const fs = require('fs')

class ZipPlugin {
  apply(compiler) {
    compiler.hooks.done.tapAsync('ZipPlugin', (stats, callback) => {
      const outputPath = path.join(__dirname, 'dist')
      const outputFilePath = path.join(outputPath, 'bundle.zip')

      if (!fs.existsSync(outputPath)) {
        console.error(`Output directory "${outputPath}" does not exist.`)
        return callback(new Error(`Output directory "${outputPath}" does not exist.`))
      }

      const output = fs.createWriteStream(outputFilePath)
      const archive = archiver('zip', { zlib: { level: 9 } })

      output.on('close', () => {
        console.log(`lambda.zip has been created (${archive.pointer()} total bytes)`)
        callback()
      })

      archive.on('error', (err) => {
        console.error('Error during zipping process:', err)
        return callback(err)
      })

      archive.pipe(output)

      fs.readdir(outputPath, (err, files) => {
        if (err) {
          console.error('Error reading output directory:', err)
          return callback(err)
        }

        files.forEach((file) => {
          if (file !== 'bundle.zip') {
            const filePath = path.join(outputPath, file)
            if (fs.statSync(filePath).isFile()) {
              archive.file(filePath, { name: file })
            } else if (fs.statSync(filePath).isDirectory()) {
              archive.directory(filePath, file)
            }
          }
        })

        archive.finalize()
      })
    })
  }
}

module.exports = {
  entry: './src/handler.ts',
  target: 'node',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'index.js',
    libraryTarget: 'commonjs2'
  },
  resolve: {
    extensions: ['.ts', '.js']
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        use: 'ts-loader',
        exclude: /node_modules/
      }
    ]
  },
  mode: 'production',
  optimization: {
    minimize: true,
    usedExports: true
  },
  externals: {
    'aws-sdk': 'commonjs aws-sdk'
  },
  plugins: [new ZipPlugin()]
}
