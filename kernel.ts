// var Message = require("jmp").Message; // IPython/Jupyter protocol message
// var Socket = require("jmp").Socket; // IPython/Jupyter protocol socket
// var zmq = require("jmp").zmq; // ZMQ bindings
import {
  CompleteContent,
  ExecuteContent,
  Message,
  Socket,
  ShutdownContent,
} from "jmp";
import * as zeromq from "zeromq";
import * as fs from "fs";
import * as path from "path";
import {compile} from "./webpacker";
import {
  PursIdeClient,
  CompletionResult,
  CellScript,
  startServerAndClient,
} from "./purescript-ide";

export interface JupyterConnection {
  signature_scheme: string;
  key: string;
  ip: string;
  hb_port: number;
  shell_port: number;
  control_port: number;
  iopub_port: number;
}

export interface KernelConfig {
  connection: JupyterConnection;
  workingDir: string;
}

export class Kernel {
  constructor(public config: KernelConfig) {}

  start() {
    this.restart();
    this.bindSockets();
  }

  scheme = this.config.connection.signature_scheme.slice("hmac-".length);
  heartbeatSocket = zeromq.createSocket("rep");
  ioPubSocket = new Socket("pub", this.scheme, this.config.connection.key);
  shellSocket = new Socket("router", this.scheme, this.config.connection.key);
  controlSocket = new Socket("router", this.scheme, this.config.connection.key);
  protocolVersion = "5.0";
  pursIde: PursIdeClient;
  nextIde: Promise<PursIdeClient>;
  curScript = new CellScript(1, "");

  onShellMessage = (msg: Message) => {
    try {
      console.log("received shell msg", msg);

      switch (msg.header.msg_type) {
        case "kernel_info_request":
          this.handle(msg, this.handleKernelInfo);
          break;
        case "execute_request":
          this.handle(msg, this.handleExecuteRequest);
          break;
        case "complete_request":
          this.handle(msg, this.handleCompleteRequest);
          break;
        case "history_request":
          this.handle(msg, this.handleHistoryRequest);
          break;
        case "inspect_request":
          this.handle(msg, this.handleInspectRequest);
          break;
        case "shutdown_request":
          this.handle(msg, this.handleShutdownRequest);
          break;
        default:
          console.warn("Unhandled shell message type", msg.header.msg_type);
      }
    } catch (e) {
      console.error(e.toString(), e.stack);
    }
  };

  onControlMessage = (msg: Message) => {
    try {
      console.log("received control msg", msg.header.msg_type);

      switch (msg.header.msg_type) {
        case "shutdown_request":
          this.close();
          msg.respond(this.controlSocket, "shutdown_reply", msg.content);
          break;
        default:
          console.warn("Unhandled control message type", msg.header.msg_type);
      }
    } catch (e) {
      console.error(e.toString(), e.stack);
    }
  };

  handleShutdownRequest(request: Message): Promise<PursIdeClient | void> {
    let content = request.content as ShutdownContent;

    if (content.restart) {
      return this.restart();
    } else {
      return this.stop();
    }
  }

  prepareContentRequest(request: {content: {code: string}}): Promise<void> {
    if (!this.running()) return Promise.reject(new Error("Not running!"));
    let content = request.content as CompleteContent;
    this.curScript = this.curScript.updated(content.code);
    return Promise.resolve();
  }

  handleInspectRequest(request: Message<CompleteContent>): Promise<void> {
    return this.prepareContentRequest(request).then(() => {
      let content = request.content;
      this.pursIde
        .inspect(this.curScript, content.cursor_pos)
        .then(response => {
          request.respond(this.shellSocket, "inspect_reply", {
            found: !!response.details,
            data: response.details && {
              "text/plain": response.details,
              "text/html": "<pre>" + response.details + "</pre>",
            },
            metadata: {},
            status: "ok",
          });
        });
    });
  }

  // TODO?
  handleHistoryRequest(request: Message) {
    request.respond(
      this.shellSocket,
      "history_reply",
      {history: []},
      {},
      this.protocolVersion
    );
    return Promise.resolve();
  }

  handleCompleteRequest(request: Message<CompleteContent>) {
    return this.prepareContentRequest(request).then(() => {
      let content = request.content;
      return this.pursIde
        .codeComplete(this.curScript, content.cursor_pos)
        .catch(e => {
          console.error("Problem fetching code escapes", e, e.stack);
          return {
            cursorStart: content.cursor_pos,
            cursorEnd: content.cursor_pos,
            textMatches: [],
          } as CompletionResult;
        })
        .then(result => {
          request.respond(this.shellSocket, "complete_reply", {
            matches: result.textMatches,
            cursor_start: result.cursorStart,
            cursor_end: result.cursorEnd,
            status: "ok",
          });
        });
    });
  }

  handleExecuteRequest(request: Message<ExecuteContent>) {
    return this.prepareContentRequest(request).then(() => {
      let content = request.content;
      let executingScript = this.curScript;
      this.pursIde.addOrReplaceScript(executingScript);
      this.curScript = new CellScript(this.curScript.cellId + 1, "");

      request.respond(this.ioPubSocket, "execute_input", {
        execution_count: executingScript.cellId,
        code: content.code,
      });

      this.stream(request, "stdout", "Running purs compile...\n");

      return this.pursIde
        .rebuild(executingScript)
        .then(() => {
          return compile(this.pursIde.projectDir, executingScript);
        })
        .then(jsCode => {
          request.respond(this.shellSocket, "execute_reply", {
            status: "ok",
            execution_count: this.curScript.cellId,
            payload: [],
            user_expressions: {},
          });

          request.respond(this.ioPubSocket, "execute_result", {
            execution_count: this.curScript.cellId,
            data: {
              "text/html":
                "<div id='" +
                executingScript.divId +
                "'></div><script>" +
                jsCode +
                "</script>",
            },
            metadata: {},
          });
        })
        .catch(e => {
          let err = {
            ename: "Compilation Error",
            evalue: "",
            traceback: e.toString().split("\n"),
          };

          request.respond(this.shellSocket, "execute_reply", {
            ...err,
            status: "error",
            execution_count: this.curScript.cellId,
          });

          request.respond(this.ioPubSocket, "error", {
            ...err,
            execution_count: this.curScript.cellId,
          });

          return Promise.reject(e);
        });
    });
  }

  handleKernelInfo(request: Message) {
    return new Promise((resolve, reject) => {
      request.respond(
        this.shellSocket,
        "kernel_info_reply",
        {
          implementation: "purescript-webpack-kernel",
          implementation_version: JSON.parse(
            fs.readFileSync(path.join(__dirname, "package.json"), "utf-8")
          ).version,
          language_info: {
            name: "purescript",
            version: "purs version?", // Pull this from purs bin
            file_extension: ".purs",
          },
          protocol_version: this.protocolVersion,
        },
        {},
        this.protocolVersion
      );

      resolve();
    });
  }

  handle(request: Message, handler: (request: Message) => Promise<any>) {
    try {
      this.reportExecutionState(request, "busy");
      let finish = this.reportExecutionState.bind(this, request, "idle");
      handler.call(this, request).then(finish, (e: Error) => {
        console.error(e, e.stack);
        finish();
      });
    } catch (e) {
      console.error(e, e.stack);
      this.reportExecutionState(request, "idle");
      throw e;
    }
  }

  onHeartbeat = (msg: Message) => {
    this.heartbeatSocket.send(msg);
  };

  private bindSockets() {
    let config = this.config;
    let address = "tcp://" + config.connection.ip + ":";

    this.heartbeatSocket.on("message", this.onHeartbeat);
    this.shellSocket.on("message", this.onShellMessage);
    this.controlSocket.on("message", this.onControlMessage);

    this.heartbeatSocket.bindSync(address + config.connection.hb_port);
    this.shellSocket.bindSync(address + config.connection.shell_port);
    this.controlSocket.bindSync(address + config.connection.control_port);
    this.ioPubSocket.bindSync(address + config.connection.iopub_port);
  }

  private reportExecutionState(request: Message, state: "busy" | "idle") {
    request.respond(this.ioPubSocket, "status", {
      execution_state: state,
    });
  }

  private stream(request: Message, stream: "stderr" | "stdout", msg: string) {
    request.respond(this.ioPubSocket, "stream", {name: stream, text: msg});
  }

  close() {
    console.warn("Kernel shutting down");

    this.controlSocket.removeAllListeners();
    this.shellSocket.removeAllListeners();
    this.heartbeatSocket.removeAllListeners();
    this.ioPubSocket.removeAllListeners();

    this.controlSocket.close();
    this.shellSocket.close();
    this.ioPubSocket.close();
    this.heartbeatSocket.close();

    this.stop();
  }

  stop(): Promise<void> {
    let completion: Promise<void> = Promise.resolve();
    if (this.running()) {
      completion = this.pursIde.dispose();
      this.pursIde = undefined;
    }

    this.nextIde = undefined;

    return completion;
  }

  running() {
    return this.pursIde != null;
  }

  restart(): Promise<PursIdeClient> {
    if (this.running()) {
      this.stop();
    }

    if (this.nextIde == null) {
      this.nextIde = startServerAndClient(this.config.workingDir).then(ide => {
        console.log("ide has been loaded", !!ide);
        this.pursIde = ide;
        this.nextIde = null;
        return ide;
      });
    }

    return this.nextIde;
  }
}

// if (!process.env.DEBUG) {
//   console.log = function() {};
// }

let workingDir = process.argv[2];
let connectionFile = process.argv[3];

if (!connectionFile || !fs.existsSync(connectionFile)) {
  throw new Error("Could not find connection file " + connectionFile);
}

let connection = JSON.parse(fs.readFileSync(connectionFile, "utf-8"));

let kernel = new Kernel({workingDir, connection});

kernel.start();

process.on("SIGINT", function() {
  console.warn("Received SIGINT, Restarting kernel...");
  kernel.restart();
});

process.on("SIGTERM", function() {
  console.warn("Received SIGINT, Restarting kernel...");
  kernel.stop();
});

setInterval(function() {}, 10000000);
