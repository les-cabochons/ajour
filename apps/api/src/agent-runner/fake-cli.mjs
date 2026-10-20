#!/usr/bin/env node
// Test stand-in for an agent CLI. Reads FAKE_CLI_SCRIPT, a JSON array of
// steps: { "stdout": "<line>" }, { "stderr": "<line>" }, { "wait": ms },
// { "exit": code }, { "hang": true }, { "ignoreTerm": true } (keeps running
// after SIGTERM, only SIGKILL stops it), { "grandchild": true } (starts a
// process that inherits the output pipes and never exits, like an MCP
// server), { "escapee": true } (the same, but outside the CLI's process tree
// and process group, so killing the tree cannot reach it). Also appends its
// argv, its working folder, whether AJOUR_MCP_TOKEN is set and the names of
// any other AJOUR_ variables to FAKE_CLI_REPORT when set, and one
// { grandchildPid } line per started grandchild.
import { spawn } from "node:child_process";
import { appendFileSync } from "node:fs";

const HANG = "setInterval(() => {}, 1000)";

function report(line) {
  if (process.env.FAKE_CLI_REPORT) {
    appendFileSync(process.env.FAKE_CLI_REPORT, JSON.stringify(line) + "\n");
  }
}

report({
  argv: process.argv.slice(2),
  hasToken: Boolean(process.env.AJOUR_MCP_TOKEN),
  ajourKeys: Object.keys(process.env).filter(
    (key) => key.startsWith("AJOUR_") && key !== "AJOUR_MCP_TOKEN",
  ),
  cwd: process.cwd(),
});
const steps = JSON.parse(process.env.FAKE_CLI_SCRIPT ?? "[]");
for (const step of steps) {
  if (step.ignoreTerm) process.on("SIGTERM", () => {});
  if (step.stdout) process.stdout.write(step.stdout + "\n");
  if (step.stderr) process.stderr.write(step.stderr + "\n");
  if (step.wait) await new Promise((resolve) => setTimeout(resolve, step.wait));
  if (step.grandchild) {
    // On Windows, Node puts each child it spawns in a job that dies with it,
    // which a real CLI (Rust, Bun) does not do for its MCP servers. Detached
    // stays out of that job but keeps the parent link. Elsewhere it would
    // leave the CLI's process group, so it is not detached there.
    const grandchild = spawn(process.execPath, ["-e", HANG], {
      stdio: "inherit",
      detached: process.platform === "win32",
    });
    report({ grandchildPid: grandchild.pid });
  }
  if (step.escapee) {
    // A middle process starts the grandchild and exits. On Windows that cuts
    // the parent link `taskkill /T` follows; `detached` gives it its own
    // process group elsewhere. It still inherits the output pipes.
    const middle = spawn(
      process.execPath,
      [
        "-e",
        `const { spawn } = require("node:child_process");
        const grandchild = spawn(process.execPath, ["-e", ${JSON.stringify(HANG)}], { stdio: "inherit", detached: true });
        require("node:fs").appendFileSync(process.env.FAKE_CLI_REPORT, JSON.stringify({ grandchildPid: grandchild.pid }) + "\\n");
        grandchild.unref();`,
      ],
      { stdio: "inherit" },
    );
    await new Promise((resolve) => middle.on("exit", resolve));
  }
  // A bare pending promise lets Node exit, so keep a timer running.
  if (step.hang) await new Promise(() => setInterval(() => {}, 1000));
  if (step.exit !== undefined) process.exit(step.exit);
}
process.exit(0);
