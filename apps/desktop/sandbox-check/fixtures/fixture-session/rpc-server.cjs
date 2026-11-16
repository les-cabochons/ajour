// A fake JSON-RPC server on stdio, as Codex's `app-server` speaks it: one
// request per line on stdin, one answer per line on stdout. It starts a
// child of its own, so the lifecycle check (#743) can tell Ajour ended the
// whole tree, and counts the requests it saw, so the check can tell two
// operations talked to the same process.
"use strict";

const { spawn } = require("node:child_process");
const readline = require("node:readline");

const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
  stdio: "ignore",
});
let seen = 0;
readline.createInterface({ input: process.stdin }).on("line", (line) => {
  const request = JSON.parse(line);
  seen += 1;
  process.stdout.write(
    `${JSON.stringify({
      jsonrpc: "2.0",
      id: request.id,
      result: { method: request.method, seen, pids: [process.pid, child.pid] },
    })}\n`,
  );
});
// Should the check fail before Ajour ends it, it ends itself after a while.
setTimeout(() => {
  child.kill();
  process.exit(0);
}, 120_000).unref();
