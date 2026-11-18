#!/usr/bin/env node
// Test stand-in for an agent CLI. Reads FAKE_CLI_SCRIPT, a JSON array of
// steps: { "stdout": "<line>" }, { "stderr": "<line>" }, { "wait": ms },
// { "exit": code }, { "hang": true }, { "ignoreTerm": true } (keeps running
// after SIGTERM, only SIGKILL stops it), { "escapee": true } (starts a process
// that inherits the output pipes and outlives the CLI, so the CLI's close
// never comes while it runs), { "mcp": { "method": ..., "params": ... } }
// (sends one JSON-RPC request to FAKE_CLI_MCP_URL with AJOUR_MCP_TOKEN, as an
// agent calls Ajour's MCP server, or a batch for an array). Also appends its
// pid, argv, its working folder, whether AJOUR_MCP_TOKEN is set, the names of
// any other AJOUR_ variables, of any variable whose value holds
// FAKE_CLI_SECRET_PROBE and of any file in its working folder that holds it
// to FAKE_CLI_REPORT when set, a { grandchildPid } line per escapee and a
// { mcp: { status, reply } } line per MCP request.
//
// A conversation speaks Claude Code's stream-json, its stdin open:
// { "readTurn": true } waits for the next line on stdin, the next turn, and
// exits 0 once stdin ends; { "session": "<id>" } prints the init event with
// that session ID, or the one `--resume` names; { "stream": ["Hel", "lo"] }
// prints each piece as a text delta; { "result": true } ends the turn, and
// { "result": "<message>" } fails it; { "waitForInterrupt": true } waits for
// an interrupt control request and answers it. Each line read from stdin
// is reported as { stdin }.
import { spawn } from "node:child_process";
import { appendFileSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";

const HANG = "setInterval(() => {}, 1000)";

const report = (value) => {
  if (process.env.FAKE_CLI_REPORT) {
    appendFileSync(process.env.FAKE_CLI_REPORT, JSON.stringify(value) + "\n");
  }
};

// Lines from stdin, read as they come. `nextLine` resolves with the next
// one, or null once stdin ended.
const stdinLines = [];
const stdinWaiters = [];
let stdinEnded = false;
const settleStdin = () => {
  while (stdinWaiters.length > 0 && (stdinLines.length > 0 || stdinEnded)) {
    stdinWaiters.shift()(stdinLines.length > 0 ? stdinLines.shift() : null);
  }
};
let stdinReader;
const nextLine = () => {
  stdinReader ??= createInterface({ input: process.stdin })
    .on("line", (line) => {
      let parsed = line;
      try {
        parsed = JSON.parse(line);
      } catch {
        // Not JSON: the report keeps the text.
      }
      report({ stdin: parsed });
      stdinLines.push(parsed);
      settleStdin();
    })
    .on("close", () => {
      stdinEnded = true;
      settleStdin();
    });
  return new Promise((resolve) => {
    stdinWaiters.push(resolve);
    settleStdin();
  });
};
const print = (value) => process.stdout.write(JSON.stringify(value) + "\n");
const argv = process.argv.slice(2);
const resumed = argv.includes("--resume")
  ? argv[argv.indexOf("--resume") + 1]
  : undefined;

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
      secretSeenInFiles: readdirSync(process.cwd()).filter(
        (name) =>
          probe &&
          readFileSync(path.join(process.cwd(), name), "utf8").includes(probe),
      ),
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
  if (step.readTurn && (await nextLine()) === null) process.exit(0);
  if (step.session) {
    print({
      type: "system",
      subtype: "init",
      session_id: resumed ?? step.session,
      mcp_servers: [{ name: "ajour", status: "connected" }],
    });
  }
  for (const text of step.stream ?? []) {
    print({
      type: "stream_event",
      event: {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text },
      },
    });
  }
  if (step.waitForInterrupt) {
    for (;;) {
      const line = await nextLine();
      if (line === null) process.exit(0);
      if (line?.type === "control_request") {
        print({
          type: "control_response",
          response: { subtype: "success", request_id: line.request_id },
        });
        if (line.request?.subtype === "interrupt") break;
      }
    }
  }
  if (step.result !== undefined) {
    const failed = typeof step.result === "string";
    print({
      type: "result",
      subtype: failed ? "error_during_execution" : "success",
      is_error: failed,
      ...(failed ? { result: step.result } : {}),
    });
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
