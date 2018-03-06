import {spawn} from "child_process";

export function runSpawn(
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
