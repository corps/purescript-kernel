import webpack = require("webpack");
import MemoryFs = require("memory-fs");
import * as fs from "fs";
import * as path from "path";

var WebpackOptionsDefaulter = require("webpack/lib/WebpackOptionsDefaulter");
var WebpackOptionsApply = require("webpack/lib/WebpackOptionsApply");

export class Webpacker {
  constructor(public workingDir: string) {
  }

  addOrReplaceScript(entry: string, content: string) {
    let fullEntryPath = path.resolve(this.workingDir, entry);
    this.fs.memoryFs.mkdirpSync(path.dirname(fullEntryPath));

    this.fs.memoryFs.writeFileSync(fullEntryPath, content);
  }

  run(entry: string, content: string) {
    this.addOrReplaceScript(entry, content);
    let fullEntryPath = path.resolve(this.workingDir, entry);

    let compiler = new webpack.Compiler();

    compiler.outputFileSystem = this.fs;
    (compiler as any).inputFileSystem = this.fs;

    let options = {
      entry: fullEntryPath,
      output: {
        path: path.resolve(this.workingDir, "build"),
        filename: "built.js",
      },
      devtool: false,
      context: this.workingDir,
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

  fs = createCellFs();
}

function createCellFs() {
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
