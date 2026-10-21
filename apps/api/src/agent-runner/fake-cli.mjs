#!/usr/bin/env node
// Test stand-in for an agent CLI. Reads FAKE_CLI_SCRIPT, a JSON array of
// steps: { "stdout": "<line>" }, { "stderr": "<line>" }, { "wait": ms },
// { "exit": code }, { "hang": true }, { "ignoreTerm": true } (keeps running
// after SIGTERM, only SIGKILL stops it), { "escapee": true } (starts a process
// that inherits the output pipes and outlives the CLI, so the CLI's close
// never comes while it runs). Also appends its pid, argv, its working folder,
// whether AJOUR_MCP_TOKEN is set and the names of any other AJOUR_ variables
// to FAKE_CLI_REPORT when set, and a { grandchildPid } line per escapee.
import { spawn } from "node:child_process";
import { appendFileSync } from "node:fs";

const HANG = "setInterval(() => {}, 1000)";

if (process.env.FAKE_CLI_REPORT) {
  appendFileSync(
    process.env.FAKE_CLI_REPORT,
    JSON.stringify({
      pid: process.pid,
      argv: process.argv.slice(2),
      hasToken: Boolean(process.env.AJOUR_MCP_TOKEN),
      ajourKeys: Object.keys(process.env).filter(
        (key) => key.startsWith("AJOUR_") && key !== "AJOUR_MCP_TOKEN",
      ),
      cwd: process.cwd(),
    }) + "\n",
  );
}
const steps = JSON.parse(process.env.FAKE_CLI_SCRIPT ?? "[]");
for (const step of steps) {
  if (step.ignoreTerm) process.on("SIGTERM", () => {});
  if (step.stdout) process.stdout.write(step.stdout + "\n");
  if (step.stderr) process.stderr.write(step.stderr + "\n");
  if (step.wait) await new Promise((resolve) => setTimeout(resolve, step.wait));
  if (step.escapee) {
    // A middle process starts it detached and exits, so it is outside the
    // CLI's process tree, its process group and the job Node puts children
    // in on Windows. It still inherits the output pipes.
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
