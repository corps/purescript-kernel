import {Kernel} from "../../lib/kernel";
if (!process.env.DEBUG) {
  console.log = function () {
  }
}

import * as fs from "fs";

let workingDir = process.argv[2] || process.cwd();
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

setInterval(function() {}, 10000000);
