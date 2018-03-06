import {runSpawn} from "./run-spawn";
import {CellScript} from "./purescript-ide";
import * as path from "path";

export function runInNodeJs(projectDir: string, script: CellScript) {
  const cwd = path.resolve(projectDir, "output");
  const moduleImport = `require(${JSON.stringify("./" + script.moduleName)})`;
  const scriptRunner = `
var module = ${moduleImport};
if ('main' in module) {
  var main = module.main;
  if (typeof main === 'function') {
    main = main();
  } else {
    console.log(main);
  }
}
`;

  return runSpawn("node", [
    "--eval",
    scriptRunner
  ], cwd);
}
