import { runCli } from "./run.js";

if (process.platform !== "linux") {
  throw new Error(`Paseo CLI is only supported on Linux (received ${process.platform}).`);
}

const exitCode = await runCli(process.argv.slice(2), {
  nodeArgv: [process.argv[0] ?? "node", process.argv[1] ?? "paseo"],
});
process.exitCode = exitCode;
