import webpack = require("webpack");
import MemoryFs = require("memory-fs");
import * as fs from "fs";
import * as path from "path";
import { CellScript } from "./purescript-ide";

var WebpackOptionsDefaulter = require("webpack/lib/WebpackOptionsDefaulter");
var WebpackOptionsApply = require("webpack/lib/WebpackOptionsApply");

export function compile(projectDir: string, entryScript: CellScript) {
  let fullEntryPath = path.resolve(projectDir, "src", "entry.js");
  let compiler = new webpack.Compiler();
  let fs = createHybridFs();

  fs.memoryFs.writeFileSync(fullEntryPath, `
var divId = ${JSON.stringify(entryScript.divId)};
var div = document.getElementById(divId);
window.HtmlContentSignal = {};

var module = require(${"./" + JSON.stringify(entryScript.moduleName)});

var main = module.main;
if (module.mainWithDiv) {
  main = module.mainWithDivId(div);
}

if (typeof main == "function") {
  main();
} else {
  console.log(main);
}
`);

  compiler.outputFileSystem = fs;
  (compiler as any).inputFileSystem = fs;

  let options = {
    entry: fullEntryPath,
    output: {
      path: path.resolve(projectDir, "build"),
      filename: "built.js",
    },
    devtool: false,
    context: projectDir,
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
        resolve(this.fs.memoryFs.readFileSync(path.resolve(this.projectDir, "build/built.js"), "utf-8"));
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
