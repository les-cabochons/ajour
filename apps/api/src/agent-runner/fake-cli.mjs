#!/usr/bin/env node
// Test stand-in for an agent CLI. Reads FAKE_CLI_SCRIPT, a JSON array of
// steps: { "stdout": "<line>" }, { "stderr": "<line>" }, { "wait": ms },
// { "exit": code }, { "hang": true }, { "ignoreTerm": true } (keeps running
// after SIGTERM, only SIGKILL stops it), { "escapee": true } (starts a process
// that inherits the output pipes and outlives the CLI, so the CLI's close
// never comes while it runs), { "mcp": { "method": ..., "params": ... } }
// (sends one JSON-RPC request to FAKE_CLI_MCP_URL with AJOUR_MCP_TOKEN, as an
// agent calls Ajour's MCP server, or a batch for an array). Also appends its pid, argv, its working
// folder, whether AJOUR_MCP_TOKEN is set, the names of any other AJOUR_
// variables and of any variable whose value holds FAKE_CLI_SECRET_PROBE to
// FAKE_CLI_REPORT when set, a { grandchildPid } line per escapee and a
// { mcp: { status, reply } } line per MCP request.
import { spawn } from "node:child_process";
import { appendFileSync } from "node:fs";

const HANG = "setInterval(() => {}, 1000)";

const probe = process.env.FAKE_CLI_SECRET_PROBE;
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
      secretSeenIn: Object.entries(process.env)
        .filter(
          ([key, value]) =>
            probe && key !== "FAKE_CLI_SECRET_PROBE" && value?.includes(probe),
        )
        .map(([key]) => key),
      cwd: process.cwd(),
    }) + "\n",
  );
}
const steps = JSON.parse(process.env.FAKE_CLI_SCRIPT ?? "[]");
let mcpRequestId = 0;
for (const step of steps) {
  if (step.mcp) {
    // An array is a batch, with an id per request.
    const message = (request) => ({
      jsonrpc: "2.0",
      id: (mcpRequestId += 1),
      ...request,
    });
    const response = await fetch(process.env.FAKE_CLI_MCP_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.AJOUR_MCP_TOKEN}`,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify(
        Array.isArray(step.mcp) ? step.mcp.map(message) : message(step.mcp),
      ),
    });
    const text = await response.text();
    let reply = text;
    try {
      reply = JSON.parse(text);
    } catch {
      // Not JSON: the report keeps the text.
    }
    appendFileSync(
      process.env.FAKE_CLI_REPORT,
      JSON.stringify({ mcp: { status: response.status, reply } }) + "\n",
    );
  }
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
