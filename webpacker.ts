import webpack = require("webpack");
import MemoryFs = require("memory-fs");
import * as fs from "fs";
import * as path from "path";

var WebpackOptionsDefaulter = require("webpack/lib/WebpackOptionsDefaulter");
var WebpackOptionsApply = require("webpack/lib/WebpackOptionsApply");

export function compile(workingDir: string, entryFile: string) {
  let fullEntryPath = path.resolve(workingDir, entryFile);
  let compiler = new webpack.Compiler();
  let fs = createHybridFs();

  compiler.outputFileSystem = fs;
  (compiler as any).inputFileSystem = fs;

  let options = {
    entry: fullEntryPath,
    output: {
      path: path.resolve(workingDir, "build"),
      filename: "built.js",
    },
    devtool: false,
    context: workingDir,
  } as webpack.Configuration;

  new WebpackOptionsDefaulter().process(options);
  compiler.options = options;
  (compiler as any).context = options.context;
  new WebpackOptionsApply().process(options, compiler);

  return new Promise<string>((resolve, reject) => {
    compiler.run((err, stats) => {
      if (err) {
        reject(err);
        return;
      }

      if (stats.hasErrors()) {
        reject(stats.toString());
        return;
      }

      try {
        resolve(this.fs.memoryFs.readFileSync(path.resolve(this.workingDir, "build/built.js"), "utf-8"));
      } catch (e) {
        reject(e);
      }
    });
  })
}

function createHybridFs() {
  let memoryFs = new MemoryFs();
  const result = {memoryFs};
  const config = result as any;

  config.existsSync = function (_path: string): boolean {
    return memoryFs.existsSync(_path) || fs.existsSync(_path);
  };

  [
    "mkdirSync", "mkdirpSync", "rmdirSync", "unlinkSync", "writeFileSync", "createWriteStream",
    "writeFile", "mkdirp", "rmdir", "unlink", "mkdir", "join", "pathToArray", "normalize"
  ].forEach(methodName => {
    config[methodName] = function () {
      return (memoryFs as any)[methodName].apply(memoryFs, arguments);
    }
  });

  [
    "statSync", "readFileSync", "readdirSync", "readlinkSync", "createReadStream", "exists",
    "stat", "readdir", "readlink", "readFile"
  ].forEach(methodName => {
    config[methodName] = function (path: string) {
      if (memoryFs.existsSync(path)) return (memoryFs as any)[methodName].apply(memoryFs, arguments);
      return (fs as any)[methodName].apply(fs, arguments);
    }
  });

  return result;
}
