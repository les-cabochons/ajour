#!/usr/bin/env node
// Test stand-in for an agent CLI. Reads FAKE_CLI_SCRIPT, a JSON array of
// steps: { "stdout": "<line>" }, { "stderr": "<line>" }, { "wait": ms },
// { "exit": code }, { "hang": true }, { "ignoreTerm": true } (keeps running
// after SIGTERM, only SIGKILL stops it), { "escapee": true } (starts a process
// that inherits the output pipes and outlives the CLI, so the CLI's close
// never comes while it runs; { "escapee": ms } makes it exit after that long,
// so a CLI that exits next exits without closing for that long),
// { "mcp": { "method": ..., "params": ... } } (sends one JSON-RPC request to
// FAKE_CLI_MCP_URL with AJOUR_MCP_TOKEN, as an agent calls Ajour's MCP
// server, or a batch for an array; "origin" beside it sends that Origin
// header, as a web page would). Also appends its
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
// an interrupt control request and answers it; { "resumeFails": true }, when
// `--resume` names a session, fails as Claude Code does when it finds none:
// an error result, "No conversation found" on stderr, and exit 1. Each line
// read from stdin is reported as { stdin }.
//
// Codex's per-turn process speaks `exec --json`: { "codexThread": "<id>" }
// prints thread.started with that ID, or the one `exec resume` names;
// { "codexReadTurn": true } reads stdin to its end and reports it as
// { codexTurn }; { "codexMessage": "<text>" } prints a completed agent
// message; { "codexDone": true } completes the turn, and
// { "codexDone": "<message>" } fails it.
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
// Claude Code's `--resume <id>`, or Codex's `exec resume ... <id> -`.
const resumed = argv.includes("--resume")
  ? argv[argv.indexOf("--resume") + 1]
  : argv.includes("resume") && argv.at(-1) === "-"
    ? argv.at(-2)
    : undefined;
let codexItems = 0;

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
        ...(step.origin ? { Origin: step.origin } : {}),
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
  if (step.resumeFails && resumed) {
    print({
      type: "result",
      subtype: "error_during_execution",
      is_error: true,
      num_turns: 0,
      session_id: resumed,
    });
    process.stderr.write(`No conversation found with session ID: ${resumed}\n`);
    process.exit(1);
  }
  if (step.readTurn && (await nextLine()) === null) process.exit(0);
  if (step.codexThread) {
    print({ type: "thread.started", thread_id: resumed ?? step.codexThread });
  }
  if (step.codexReadTurn) {
    const lines = [];
    for (let line = await nextLine(); line !== null; line = await nextLine()) {
      lines.push(typeof line === "string" ? line : JSON.stringify(line));
    }
    report({ codexTurn: lines.join("\n") });
    print({ type: "turn.started" });
  }
  if (step.codexMessage !== undefined) {
    codexItems += 1;
    print({
      type: "item.completed",
      item: {
        id: `item_${codexItems}`,
        type: "agent_message",
        text: step.codexMessage,
      },
    });
  }
  if (step.codexDone !== undefined) {
    print(
      typeof step.codexDone === "string"
        ? { type: "turn.failed", error: { message: step.codexDone } }
        : { type: "turn.completed", usage: {} },
    );
  }
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
        const grandchild = spawn(process.execPath, ["-e", ${JSON.stringify(
          typeof step.escapee === "number"
            ? `setTimeout(() => {}, ${step.escapee})`
            : HANG,
        )}], { stdio: "inherit", detached: true });
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
