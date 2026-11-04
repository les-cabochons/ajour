import { run } from "./main.ts";
import { processIo } from "./io.ts";

void run(process.argv.slice(2), processIo()).then((code) => {
  process.exitCode = code;
});
