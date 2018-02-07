import * as ts from "typescript";
import * as fs from "fs";
import * as path from "path";

export interface CompileResult {
  entry: string
  contents: { [k: string]: string };
}

export interface CompletionResult {
  textMatches: string[],
  cursorStart: number
  cursorEnd: number
}

export interface InspectResult {
  details: string
}

export class LanguageServiceHost implements ts.LanguageServiceHost, ts.ModuleResolutionHost {
  constructor(public workingDir: string) {
  }

  useCaseSensitiveFileNames() {
    return false;
  }

  resolveModuleNames(moduleNames: string[], containingFile: string): ts.ResolvedModule[] {
    let result = [] as ts.ResolvedModule[];

    for (let moduleName of moduleNames) {
      let resolution = ts.resolveModuleName(moduleName,
          containingFile,
          this.getCompilationSettings(),
          this,
          this.moduleCache);
      result.push(resolution.resolvedModule);
    }

    return result;
  }

  resolveTypeReferenceDirectives(typeDirectiveNames: string[],
                                 containingFile: string): ts.ResolvedTypeReferenceDirective[] {
    let result = [] as ts.ResolvedTypeReferenceDirective[];

    for (let directiveName of typeDirectiveNames) {
      let resolvedDirective = ts.resolveTypeReferenceDirective(directiveName,
          containingFile,
          this.getCompilationSettings(),
          this);
      result.push(resolvedDirective.resolvedTypeReferenceDirective);
    }

    return result;
  }

  getCompilationSettings(): ts.CompilerOptions {
    let options = ts.getDefaultCompilerOptions();
    options = {...options};

    options.target = ts.ScriptTarget.ES5;
    options.allowUnusedLabels = true;
    options.allowUnreachableCode = true;
    options.alwaysStrict = true;
    options.charset = "utf-8";
    options.jsx = ts.JsxEmit.React;
    options.moduleResolution = ts.ModuleResolutionKind.NodeJs;
    options.module = ts.ModuleKind.CommonJS;
    options.noImplicitAny = true;
    options.noImplicitThis = true;
    options.noEmitOnError = true;

    return options;
  }

  readFile = (filename: string) => {
    let rel = path.relative(this.workingDir, filename);
    if (rel in this.scripts) {
      return this.scripts[rel].contents;
    }

    return ts.sys.readFile(filename);
  };

  readDirectory = ts.sys.readDirectory;
  fileExists = (filename: string) => {
    let rel = path.relative(this.workingDir, filename);
    if (rel in this.scripts) {
      return true;
    }

    return ts.sys.fileExists(filename);
  };
  getDirectories = ts.sys.getDirectories;
  directoryExists = ts.sys.directoryExists;

  getScriptFileNames(): string[] {
    return Object.keys(this.scripts);
  }

  getScriptVersion(fileName: string): string {
    if (fileName in this.scripts) {
      return this.versions[fileName] + "";
    }

    let stats = fs.statSync(fileName);
    return stats.mtime.getTime() + "";
  }

  getScriptSnapshot(fileName: string): ts.IScriptSnapshot | any {
    if (fileName in this.scripts) {
      return ts.ScriptSnapshot.fromString(this.scripts[fileName].contents);
    }

    if (!fs.existsSync(fileName)) {
      return undefined;
    }

    return ts.ScriptSnapshot.fromString(fs.readFileSync(fileName, "utf-8"));
  }

  getCurrentDirectory(): string {
    return this.workingDir;
  }

  getDefaultLibFileName(options: ts.CompilerOptions): string {
    return ts.getDefaultLibFilePath(options);
  }

  dispose() {
    this.service.dispose();
  }

  getCanonicalFileName = (fileName: string) => {
    return path.relative(this.workingDir, path.resolve(this.workingDir, fileName));
  };

  scripts = {} as { [k: string]: CellScript };
  versions = {} as { [k: string]: number };
  docRegistry = ts.createDocumentRegistry(false, this.workingDir);
  service = ts.createLanguageService(this, this.docRegistry);
  moduleCache = ts.createModuleResolutionCache(this.workingDir, this.getCanonicalFileName);
  formatHost = new FormatDiagnosticsHost(this.workingDir);

  addOrReplaceScript(script: CellScript) {
    this.scripts[script.tmpFileName] = script;
    this.versions[script.tmpFileName] = (this.versions[script.tmpFileName] || 0) + 1;

    let dirname = path.join(this.workingDir, "cell");
    let workingDirCache = this.moduleCache.getOrCreateCacheForDirectory(dirname);
    let key = "./" + path.basename(script.tmpFileName).split(".")[0];

    workingDirCache.set(key, {
      resolvedModule: {
        isExternalLibraryImport: false,
        resolvedFileName: script.tmpFileName,
        extension: ts.Extension.Tsx
      }
    });

    return script;
  }

  compileScript(script: CellScript): Promise<CompileResult> {
    return new Promise<CompileResult>((resolve, reject) => {
      if (!(script.tmpFileName in this.scripts)) {
        reject(new Error("Attempted to run cell " + script.cellCounter + " but it did not exist in the current service"));
        return;
      }

      let output = this.service.getEmitOutput(script.tmpFileName);

      if (output.emitSkipped) {
        let allDiagnostics = this.service.getCompilerOptionsDiagnostics()
                                 .concat(this.service.getSyntacticDiagnostics(script.tmpFileName))
                                 .concat(this.service.getSemanticDiagnostics(script.tmpFileName));

        reject(new Error(ts.formatDiagnostics(allDiagnostics, this.formatHost)));
        return;
      }

      let result = {entry: script.tmpFileName, contents: {}} as CompileResult;

      output.outputFiles.forEach(file => {
        result.contents[file.name] = file.text;
      });

      resolve(result);
    })
  }

  codeComplete(script: CellScript, cursor: number): Promise<CompletionResult> {
    return new Promise<CompletionResult>((resolve, reject) => {
      if (!(script.tmpFileName in this.scripts)) {
        throw new Error("Attempted to complete cell " + script.cellCounter + " but it did not exist in the current service");
      }

      let execCursor = cursor + script.header.length;
      let completions = this.service.getCompletionsAtPosition(script.tmpFileName, execCursor);

      let spaces = /\s|[^a-zA-Z0-9$_]|$/g;
      let startIdx = execCursor;
      let endIdx = execCursor;
      for (let next = spaces.exec(script.contents); next; next = spaces.exec(script.contents)) {
        endIdx = next.index;
        if (next.index >= execCursor) break;
        startIdx = next.index + 1;
      }

      let selectFilter = script.contents.slice(startIdx, execCursor);

      let result = {
        cursorStart: Math.max(startIdx - script.header.length, 0),
        cursorEnd: Math.max(endIdx - script.header.length, 0),
        textMatches: []
      } as CompletionResult;

      if (completions) {
        for (let completion of completions.entries) {
          // if (completion.replacementSpan) continue;
          if (completion.kind == "keyword") continue;
          if (completion.name.slice(0, selectFilter.length) != selectFilter) continue;
          result.textMatches.push(completion.name);
        }
      }

      resolve(result);
    })
  }

  inspect(script: CellScript, cursor: number): Promise<InspectResult> {
    return new Promise((resolve, reject) => {
      let info = this.service.getQuickInfoAtPosition(script.tmpFileName, cursor + script.header.length);
      resolve({details: info.displayParts.map(d => d.text).join("")});
    });
  }
}

export class FormatDiagnosticsHost implements ts.FormatDiagnosticsHost {
  constructor(public workingDir: string) {
  }

  getCurrentDirectory() {
    return this.workingDir;
  }

  getCanonicalFileName = (fileName: string) => {
    return path.relative(this.workingDir, path.resolve(this.workingDir, fileName));
  };

  getNewLine() {
    return "\n";
  }
}

let nameMatcher = /^\s*\/\/\s*module:([^\s]*)/;

export class CellScript {
  constructor(public cellCounter: number, public _contents = "", private withoutHeader = false) {
  }

  get tmpFileName(): string {
    let match = this._contents.match(nameMatcher);
    if (match) {
      return "cell/" + match[1] + ".tsx";
    }

    return "cell/" + this.cellCounter + ".tsx";
  }

  cellDivId = "cell-" + this.cellCounter;
  header = "import {getDiv} from \"./_setup\";\nconst div = getDiv(" + JSON.stringify(this.cellDivId) + ");\n";

  get contents(): string {
    if (this.withoutHeader) return this._contents;
    return this.header + this._contents;
  }

  update(contents: string) {
    this._contents = contents;
    return this;
  }

  static cellSetupScript = new CellScript(-1, `
    // module:_setup
    export function getDiv(cellDivId: string) {
      return document.getElementById(cellDivId);
    }
  `, true);
}

