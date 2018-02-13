import * as fs from "fs";
import * as path from "path";
import {tmpdir} from "os";
import {find as findPort} from "portastic";
import {ChildProcess, spawn} from "child_process";

export interface CompletionResult {
  textMatches: string[];
  cursorStart: number;
  cursorEnd: number;
}

export interface InspectResult {
  details: string;
}

function runSpawn(
  command: string,
  args: string[],
  cwd: string,
  stdin: string = null
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let ps = spawn(command, args, {cwd});
    let stdout = "";
    let stderr = "";
    console.log("running", command, ...args, stdin);
    ps.stderr.on("data", (data: Buffer) => {
      stderr += data.toString("utf8");
    });

    ps.stdout.on("data", (data: Buffer) => {
      stdout += data.toString("utf8");
    });

    ps.on("close", (status: number) => {
      if (status) {
        reject(new Error(command + " failed: " + stderr));
        return;
      }

      console.log(stderr);
      console.log(stdout);
      resolve(stdout);
    });

    if (stdin != null) {
      ps.stdin.write(stdin, "utf-8");
    }
  });
}

function mkTempDir(): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    fs.mkdtemp(path.join(tmpdir(), "pskernel-"), (err, projectDir) => {
      if (err) {
        reject(err);
        return;
      }

      resolve(projectDir);
    });
  });
}

export function startServerAndClient(
  workingDir: string
): Promise<PursIdeClient> {
  return mkTempDir().then(projectDir => {
    fs.symlinkSync(
      path.resolve(path.join(workingDir, "node_modules")),
      path.join(projectDir, "node_modules")
    );
    fs.symlinkSync(
      path.resolve(path.join(workingDir, "bower_components")),
      path.join(projectDir, "bower_components")
    );
    fs.mkdirSync(path.join(projectDir, "src"));

    return runSpawn(
      "purs",
      ["compile", "bower_components/**/*.purs"],
      projectDir
    )
      .then(() => {
        return findPort({min: 4250, max: 6000});
      })
      .then(ports => {
        if (!ports.length) throw new Error("No ports found!");
        return ports[0];
      })
      .then(port => {
        let serverPs = spawn(
          "purs",
          ["ide", "server", "--port", port + "", "--no-watch", "--editor-mode"],
          {cwd: projectDir}
        );

        return new Promise<void>((resolve, reject) => {
          setTimeout(resolve, 200);
        }).then(() => {
          return new PursIdeClient(projectDir, serverPs, port).load();
        });
      });
  });
}

export class PursIdeClient {
  serverRunning = true;

  constructor(
    public projectDir: string,
    public serverProcess: ChildProcess,
    public serverPort: number
  ) {}

  load(): Promise<PursIdeClient> {
    return this.runPursCommand({command: "load"}).then(() => this);
  }

  dispose(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.serverProcess.killed) {
        resolve();
        return;
      }

      let timeout = setTimeout(reject, 1000 * 10);
      this.serverProcess.on("close", () => {
        clearTimeout(timeout);
        resolve();
      });
      this.serverProcess.kill("SIGTERM");
      return;
    });
  }

  private runPursCommand(data: any): Promise<any> {
    return runSpawn(
      "purs",
      ["ide", "client", "-p", this.serverPort + ""],
      this.projectDir,
      JSON.stringify(data) + "\n"
    ).then(output => {
      return JSON.parse(output);
    });
  }

  addOrReplaceScript(script: CellScript): void {
    fs.writeFileSync(
      path.join(this.projectDir, "src", script.fileName),
      script.contents,
      {encoding: "utf-8"}
    );
  }

  rebuild(script: CellScript) {
    if (script.hasModule) {
      let file = path.join(this.projectDir, "src", script.fileName);
      return this.runPursCommand({
        command: "rebuild",
        params: {
          file: file,
          actualFile: file,
        },
      }).then(result => {
        if (result.resultType != "success") {
          let errors = ["purs rebuild failed:"];
          for (let suggestion of result.suggestions) {
            if (suggestion.message) {
              for (let line of suggestion.messsage.split("\n")) {
                errors.push(line);
              }
            }
            if (suggestion.position) {
              errors.push("@" + JSON.stringify(suggestion.position));
            }
          }

          throw new Error(errors.join("\n"));
        }
      });
    }

    return Promise.reject(new Error("Cell has no module declaration!"));
  }

  codeComplete(script: CellScript, cursor: number): Promise<CompletionResult> {
    const separators = /\s|\(|\)|\,|[-+/*]|$/g;
    let startIdx = cursor;
    let endIdx = cursor;

    for (
      let next = separators.exec(script.contents);
      next;
      next = separators.exec(script.contents)
    ) {
      endIdx = next.index;
      if (next.index >= cursor) break;
      startIdx = next.index + 1;
    }

    let result = {
      cursorStart: Math.max(startIdx, 0),
      cursorEnd: Math.max(endIdx, 0),
      textMatches: [],
    } as CompletionResult;

    return this.runPursCommand({
      command: "complete",
      params: {
        filters: [
          {
            filter: "prefix",
            params: {search: script.contents.slice(startIdx, cursor)},
          },
        ],
        currentModule: script.hasModule ? script.moduleName : undefined,
        options: {
          maxResults: 10,
          groupReexports: true,
        },
      },
    }).then(completes => {
      for (let complete of completes) {
        result.textMatches.push(complete.identifier);
      }

      return result;
    });
  }

  inspect(script: CellScript, cursor: number): Promise<InspectResult> {
    const separators = /\s|\(|\)|\,|[-+/*]|$/g;
    let startIdx = cursor;
    let endIdx = cursor;

    for (
      let next = separators.exec(script.contents);
      next;
      next = separators.exec(script.contents)
    ) {
      endIdx = next.index;
      if (next.index >= cursor) break;
      startIdx = next.index + 1;
    }

    return this.runPursCommand({
      command: "type",
      params: {
        search: script.contents.slice(startIdx, endIdx),
        currentModule: script.hasModule ? script.moduleName : undefined,
      },
    }).then(completes => {
      if (completes.length > 0) {
        let {identifier, type, exportedFrom, documentation} = completes[0];
        return {
          details: [
            "<b>" + identifier + "</b> from " + (exportedFrom || "unknown"),
            type,
            documentation,
          ].join("\n"),
        };
      }

      return {details: ""};
    });
  }
}

const moduleRegex = /^module ([^\s]+) where/;

export class CellScript {
  constructor(public cellId: number, public contents: string) {}

  private moduleNameMatch = this.contents.match(moduleRegex);
  moduleName = this.moduleNameMatch ? this.moduleNameMatch[1] : undefined;
  fileName = (this.moduleName ? this.moduleName : "temp") + ".purs";
  divId = "cell" + this.cellId;
  hasModule = !!this.moduleNameMatch;

  updated(newContents: string) {
    return new CellScript(this.cellId, newContents);
  }
}
