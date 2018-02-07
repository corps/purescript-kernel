// var Message = require("jmp").Message; // IPython/Jupyter protocol message
// var Socket = require("jmp").Socket; // IPython/Jupyter protocol socket
// var zmq = require("jmp").zmq; // ZMQ bindings

import {CompleteContent, ExecuteContent, Message, Socket, ShutdownContent} from "jmp";
import * as zeromq from "zeromq";
import {CellScript, LanguageServiceHost, CompletionResult} from "./typescript-host";
import * as typescript from "typescript";
import * as fs from "fs";
import * as path from "path";
import {Webpacker} from "./webpacker";

export interface JupyterConnection {
  signature_scheme: string
  key: string
  ip: string
  hb_port: number
  shell_port: number
  control_port: number
  iopub_port: number
}

export interface KernelConfig {
  connection: JupyterConnection
  workingDir: string
}

export class Kernel {
  constructor(public config: KernelConfig) {
  }

  start() {
    this.resetLanguageHost();
    this.bindSockets();
  }

  scheme = this.config.connection.signature_scheme.slice("hmac-".length);
  heartbeatSocket = zeromq.createSocket("rep");
  ioPubSocket = new Socket("pub", this.scheme, this.config.connection.key);
  shellSocket = new Socket("router", this.scheme, this.config.connection.key);
  controlSocket = new Socket("router", this.scheme, this.config.connection.key);
  languageHost: LanguageServiceHost;
  curScript: CellScript;
  protocolVersion = "5.0";
  webpacker: Webpacker;
  compiledSetup = false;

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
          console.warn("Unhandled control message type", msg.header.msg_type)
      }
    } catch (e) {
      console.error(e.toString(), e.stack);
    }
  };

  handleShutdownRequest(request: Message) {
    let content = request.content as ShutdownContent;

    if (content.restart) {
      return this.restart();
    }
    else {
      return Promise.resolve().then(() => {
        setTimeout(() => {
          this.close();
        }, 0);
      });
    }
  }

  handleInspectRequest(request: Message) {
    let content = request.content as CompleteContent;
    this.languageHost.addOrReplaceScript(this.curScript.update(content.code));

    return this.languageHost.inspect(this.curScript, content.cursor_pos).then(response => {
      request.respond(this.shellSocket, "inspect_reply", {
        found: !!response.details,
        data: response.details && {
          "text/plain": response.details,
          "text/html": "<pre>" + response.details + "</pre>"
        },
        metadata: {},
        status: "ok"
      });
    });
  }

  handleHistoryRequest(request: Message) {
    request.respond(this.shellSocket, "history_reply", {"history": []}, {}, this.protocolVersion);
    return Promise.resolve();
  }

  handleCompleteRequest(request: Message) {
    let content = request.content as CompleteContent;
    this.languageHost.addOrReplaceScript(this.curScript.update(content.code));

    return this.languageHost.codeComplete(this.curScript, content.cursor_pos).catch(e => {
      console.error("Problem fetching code escapes", e, e.stack);
      return {
        cursorStart: content.cursor_pos,
        cursorEnd: content.cursor_pos,
        textMatches: []
      } as CompletionResult;
    }).then(result => {
      request.respond(this.shellSocket, "complete_reply", {
        matches: result.textMatches,
        cursor_start: result.cursorStart,
        cursor_end: result.cursorEnd,
        status: "ok",
      });
    });
  }

  handleExecuteRequest(request: Message) {
    let content = request.content as ExecuteContent;
    let executingScript = this.curScript;

    this.languageHost.addOrReplaceScript(executingScript.update(content.code));
    this.curScript = this.languageHost.addOrReplaceScript(new CellScript(this.curScript.cellCounter + 1));

    request.respond(this.ioPubSocket, "execute_input", {
      execution_count: this.curScript.cellCounter,
      code: content.code,
    });

    const buildExecutingScript = () => {
      this.stream(request, "stdout", "Starting typescript compilation for cell...\n");

      return this.languageHost.compileScript(executingScript).then(result => {
        this.stream(request, "stdout", "typescript compilation finished, running webpack...\n");
        let entry = result.entry.split(".").slice(0, -1).join(".") + ".js";

        return this.webpacker.run(entry, result.contents[entry]);
      }).then(jsCode => {
        request.respond(this.shellSocket, "execute_reply", {
          status: "ok",
          execution_count: this.curScript.cellCounter,
          payload: [],
          user_expressions: {},
        });

        request.respond(this.ioPubSocket, "execute_result", {
          execution_count: this.curScript.cellCounter,
          data: {
            "text/html": "<div id='" + executingScript.cellDivId + "'></div><script>" + jsCode + "</script>"
          },
          metadata: {},
        });
      }).catch((e) => {
        let err = {
          ename: "Compilation Error",
          evalue: "",
          traceback: e.toString().split("\n"),
        };

        request.respond(this.shellSocket, "execute_reply", {
          ...err,
          status: "error",
          execution_count: this.curScript.cellCounter,
        });

        request.respond(this.ioPubSocket, "error", {
          ...err,
          execution_count: this.curScript.cellCounter,
        });

        return Promise.reject(e);
      });
    };

    if (!this.compiledSetup) {
      this.stream(request, "stdout", "Building setup script...\n");

      return this.languageHost.compileScript(CellScript.cellSetupScript).then(result => {
        this.compiledSetup = true;
        let entry = result.entry.split(".").slice(0, -1).join(".") + ".js";
        this.webpacker.addOrReplaceScript(entry, result.contents[entry]);
        this.stream(request, "stdout", "Setup script ready\n");
        return buildExecutingScript();
      });
    }

    return buildExecutingScript();
  }

  handleKernelInfo(request: Message) {
    return new Promise((resolve, reject) => {
      request.respond(this.shellSocket, "kernel_info_reply", {
        implementation: "jp-ts",
        implementation_version: JSON.parse(fs.readFileSync(
            path.join(__dirname, "..", "package.json"), "utf-8")).version,
        language_info: {
          name: "typescript",
          version: typescript.version,
          file_extension: ".tsx"
        },
        protocol_version: this.protocolVersion,
      }, {}, this.protocolVersion);

      resolve();
    });
  }

  handle(request: Message, handler: (request: Message) => Promise<any>) {
    try {
      this.reportExecutionState(request, 'busy');
      let finish = this.reportExecutionState.bind(this, request, 'idle');
      handler.call(this, request).then(finish, (e: Error) => {
        console.error(e, e.stack);
        finish();
      });
    } catch (e) {
      console.error(e, e.stack);
      this.reportExecutionState(request, 'idle');
      throw e;
    }
  }

  onHeartbeat = (msg: Message) => {
    console.log("heartbeat");
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

  private reportExecutionState(request: Message, state: 'busy' | 'idle') {
    request.respond(this.ioPubSocket, 'status', {
      execution_state: state
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

    this.languageHost.dispose();
  }

  restart() {
    this.resetLanguageHost();
    return Promise.resolve();
  }

  private resetLanguageHost() {
    if (this.languageHost) this.languageHost.dispose();
    this.compiledSetup = false;

    this.languageHost = new LanguageServiceHost(this.config.workingDir);
    this.languageHost.addOrReplaceScript(CellScript.cellSetupScript);
    this.webpacker = new Webpacker(this.config.workingDir);
    this.curScript = this.languageHost.addOrReplaceScript(new CellScript(0));
  }
}