import {
  copyFile,
  link,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { pluginApi4ManifestSchema } from "../../../packages/shared/plugin-api-4.ts";
import type { AjourEvent } from "../../../packages/wide-events/catalog.ts";
import { createRecordingSink } from "../../../packages/wide-events/sinks.ts";
import type { BrokerCaller } from "./broker-port.ts";
import { createApiEvents } from "./events.ts";
import { ProcessBroker, type ProcessBrokerOptions } from "./process-broker.ts";
import { SESSION_LIMITS } from "./process-sessions.ts";

const roots: string[] = [];
const brokers: ProcessBroker[] = [];
const pids: number[] = [];
afterEach(async () => {
  await Promise.all(brokers.splice(0).map((broker) => broker.shutdown()));
  for (const pid of pids.splice(0)) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      /* Already ended. */
    }
  }
  await Promise.all(
    roots.splice(0).map((p) => rm(p, { recursive: true, force: true })),
  );
});

/**
 * A fake JSON-RPC server: one request per line on stdin, one answer per line
 * on stdout. A few methods let a test make it misbehave.
 */
const SERVER = String.raw`
const { spawn } = require("node:child_process");
const readline = require("node:readline");
const send = (value) => process.stdout.write(JSON.stringify(value) + "\n");
readline.createInterface({ input: process.stdin }).on("line", (line) => {
  const request = JSON.parse(line);
  const { id, method, params } = request;
  if (method === "echo") send({ jsonrpc: "2.0", id, result: { params, line, pid: process.pid } });
  else if (method === "child") {
    const child = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], { stdio: "ignore" });
    send({ jsonrpc: "2.0", id, result: { pids: [process.pid, child.pid] } });
  } else if (method === "flood") {
    for (let n = 0; n < params.lines; n++) process.stdout.write(JSON.stringify({ n, pad: "x".repeat(params.pad ?? 0) }) + "\n");
  } else if (method === "long") {
    process.stdout.write("y".repeat(params.bytes) + "\n");
    send({ jsonrpc: "2.0", id, result: "after" });
  } else if (method === "stderr") {
    process.stderr.write("e".repeat(params.bytes) + "TAIL");
    send({ jsonrpc: "2.0", id, result: "written" });
  } else if (method === "env") {
    send({ jsonrpc: "2.0", id, result: Object.fromEntries(Object.entries(process.env).filter(([k]) => /^(GIT_|AJOUR_)/i.test(k))) });
  } else if (method === "later") {
    setTimeout(() => send({ jsonrpc: "2.0", id, result: "late" }), params.ms);
  } else if (method === "orphan") {
    const child = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], { stdio: "ignore" });
    send({ jsonrpc: "2.0", id, result: { pids: [process.pid, child.pid] } });
    setTimeout(() => process.exit(0), 50);
  } else if (method === "exit") {
    send({ jsonrpc: "2.0", id, result: "bye" });
    process.exitCode = params.code;
    process.stdin.destroy();
    setTimeout(() => process.exit(params.code), 20);
  }
});
`;

interface SessionRead {
  lines: string[];
  dropped: boolean;
  stderr: string;
  exited: boolean;
  exitCode: number | null;
}

async function fixture(
  options: Partial<ProcessBrokerOptions> & {
    idleTimeoutSeconds?: number;
    executable?: (root: string) => Promise<string>;
    manifestId?: string;
  } = {},
) {
  const root = await mkdtemp(path.join(os.tmpdir(), "ajour-session-"));
  roots.push(root);
  const script = path.join(root, "server.cjs");
  await writeFile(script, SERVER);
  const manifestFor = (id: string) =>
    pluginApi4ManifestSchema.parse({
      id,
      version: "1.0.0",
      apiVersion: 4,
      displayName: "Session test",
      iconSvg: "<svg/>",
      entrypoint: "index.js",
      connectionFields: [{ id: "site", label: "Site", type: "text" }],
      capabilities: { connector: {} },
      processes: {
        executables: { node: { names: ["node"] } },
        commands: [
          {
            id: "server",
            executable: "node",
            args: [{ kind: "literal", value: script }, "{label:id}"],
            mode: "session",
            idleTimeoutSeconds: options.idleTimeoutSeconds ?? 60,
          },
          {
            id: "capture",
            executable: "node",
            args: ["--version"],
            mode: "capture",
          },
        ],
      },
    });
  const manifest = manifestFor(options.manifestId ?? "session-test");
  const sink = createRecordingSink<AjourEvent>();
  const executable = options.executable
    ? await options.executable(root)
    : process.execPath;
  const broker = new ProcessBroker({
    folders: { resolve: async () => root },
    gate: async () => undefined,
    executableOverride: async () => executable,
    events: createApiEvents({ sink, userDataPath: root }),
    ...options,
  });
  brokers.push(broker);
  const callerFor = (m = manifest): BrokerCaller => ({
    pluginId: m.id,
    manifest: m,
    method: "syncConnection",
  });
  const operation = (m = manifest) => broker.forOperation(callerFor(m));
  return { root, manifest, manifestFor, broker, sink, operation, script };
}

type Operation = ReturnType<Awaited<ReturnType<typeof fixture>>["operation"]>;

const open = async (op: Operation, label = "main") =>
  (await op.session({
    action: "open",
    command: "server",
    args: { label },
  })) as string;
const send = (op: Operation, id: string, line: string) =>
  op.session({ action: "send", id, line });
const read = async (
  op: Operation,
  id: string,
  options: { max?: number; waitMs?: number } = {},
) => (await op.session({ action: "read", id, ...options })) as SessionRead;
const close = (op: Operation, id: string) =>
  op.session({ action: "close", id });

/** Sends one request and reads until its answer arrives. */
async function call(
  op: Operation,
  id: string,
  method: string,
  params: unknown = {},
  rpcId = 1,
) {
  await send(
    op,
    id,
    JSON.stringify({ jsonrpc: "2.0", id: rpcId, method, params }),
  );
  for (let attempt = 0; attempt < 50; attempt++) {
    const { lines } = await read(op, id, { waitMs: 2000 });
    for (const line of lines) {
      const message = JSON.parse(line);
      if (message.id === rpcId) return message.result;
    }
  }
  throw new Error(`No answer to ${method}.`);
}

function alive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function expectGone(list: number[]) {
  // taskkill can close the parent's pipes before it finishes the tree.
  await vi.waitFor(
    () => {
      for (const pid of list) expect(alive(pid)).toBe(false);
    },
    { timeout: 5000 },
  );
}

const sessionEvents = (sink: { events: readonly AjourEvent[] }) =>
  sink.events.filter(
    (event) =>
      event.name === "plugin.process" &&
      (event as { process?: { mode?: string } }).process?.mode === "session",
  );

describe("Given a declared session command", () => {
  it("opens it, sends a line with a newline added, and reads the answer", async () => {
    const { operation } = await fixture();
    const op = operation();
    const id = await open(op);
    expect(id).toMatch(/^[A-Za-z0-9_-]{22,}$/);
    const result = await call(op, id, "echo", { text: "héllo & $(x)" });
    expect(result.params).toEqual({ text: "héllo & $(x)" });
    expect(result.line).toBe(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "echo",
        params: { text: "héllo & $(x)" },
      }),
    );
    pids.push(result.pid);
  });

  it("keeps the session across operations, and a later operation reuses it", async () => {
    const { operation } = await fixture();
    const first = operation();
    const id = await open(first);
    const { pid } = await call(first, id, "echo");
    pids.push(pid);
    first.close();
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(alive(pid)).toBe(true);
    const later = operation();
    expect((await call(later, id, "echo", { again: true }, 2)).pid).toBe(pid);
  });

  it("gives another plugin nothing, as if the id were unknown", async () => {
    const { operation, manifestFor } = await fixture();
    const id = await open(operation());
    const other = operation(manifestFor("other-plugin"));
    for (const request of [
      { action: "send", id, line: "{}" },
      { action: "read", id },
      { action: "close", id },
    ] as const)
      await expect(other.session(request)).rejects.toMatchObject({
        reason: "session_ended",
      });
    await expect(
      operation().session({ action: "read", id: "x".repeat(22) }),
    ).rejects.toMatchObject({ reason: "session_ended" });
    // The owner still has it.
    expect((await call(operation(), id, "echo")).pid).toBeTypeOf("number");
  });

  it("keeps at most two per plugin; a closed or exited one frees its place", async () => {
    const { operation, manifestFor } = await fixture();
    const op = operation();
    const a = await open(op, "a");
    const b = await open(op, "b");
    await expect(open(op, "c")).rejects.toMatchObject({
      reason: "session_limit",
    });
    // Another plugin has places of its own.
    await open(operation(manifestFor("other-plugin")), "c");
    await close(op, a);
    const c = await open(op, "c");
    await call(op, b, "exit", { code: 3 });
    await vi.waitFor(async () => expect((await read(op, b)).exited).toBe(true));
    await open(op, "d");
    await expect(open(op, "e")).rejects.toMatchObject({
      reason: "session_limit",
    });
    expect(c).not.toBe(a);
  });

  it("refuses two opens racing for the last place", async () => {
    const { operation } = await fixture();
    const op = operation();
    await open(op, "a");
    const results = await Promise.allSettled([open(op, "b"), open(op, "c")]);
    expect(results.map((r) => r.status).sort()).toEqual([
      "fulfilled",
      "rejected",
    ]);
  });

  it.each([
    ["a NUL", "{\u0000}"],
    ["a newline", "{}\n{}"],
    ["a carriage return", "{}\r"],
    ["a line over 1 MB", "x".repeat(SESSION_LIMITS.sendBytes + 1)],
    ["a line over 1 MB in UTF-8", "é".repeat(SESSION_LIMITS.sendBytes / 2 + 1)],
  ])("refuses to send %s", async (_name, line) => {
    const { operation } = await fixture();
    const op = operation();
    const id = await open(op);
    await expect(send(op, id, line)).rejects.toMatchObject({
      reason: "invalid_request",
    });
    expect((await call(op, id, "echo")).pid).toBeTypeOf("number");
  });

  it("refuses malformed session requests", async () => {
    const { operation } = await fixture();
    const op = operation();
    const id = await open(op);
    for (const request of [
      { action: "open", command: "server", args: {}, extra: 1 },
      { action: "send", id, line: 42 },
      { action: "read", id, max: 0 },
      { action: "read", id, max: SESSION_LIMITS.readLines + 1 },
      { action: "read", id, waitMs: -1 },
      { action: "read", id, waitMs: SESSION_LIMITS.waitMs + 1 },
      { action: "launch", id },
      null,
    ])
      await expect(op.session(request as never)).rejects.toMatchObject({
        reason: "invalid_request",
      });
  });

  it("reads at most max lines, oldest first, and keeps the rest for the next read", async () => {
    const { operation } = await fixture();
    const op = operation();
    const id = await open(op);
    await send(
      op,
      id,
      JSON.stringify({ method: "flood", params: { lines: 5 } }),
    );
    // The five lines come in one write; give them time to arrive.
    await new Promise((resolve) => setTimeout(resolve, 500));
    const { lines } = await read(op, id, { max: 2, waitMs: 1000 });
    expect(lines.map((line) => JSON.parse(line).n)).toEqual([0, 1]);
    const rest = await read(op, id, { waitMs: 1000 });
    expect(rest.lines.map((line) => JSON.parse(line).n)).toEqual([2, 3, 4]);
    expect(rest.dropped).toBe(false);
  });

  it("drops the oldest lines past the buffer and says so once", async () => {
    const { operation } = await fixture();
    const op = operation();
    const id = await open(op);
    const pad = 1000;
    const lines = Math.ceil((SESSION_LIMITS.bufferBytes * 1.5) / pad);
    await send(
      op,
      id,
      JSON.stringify({ method: "flood", params: { lines, pad } }),
    );
    let last = -1;
    const seen: number[] = [];
    let dropped = false;
    await vi.waitFor(
      async () => {
        const result = await read(op, id, {
          max: SESSION_LIMITS.readLines,
          waitMs: 200,
        });
        dropped ||= result.dropped;
        for (const line of result.lines) seen.push(JSON.parse(line).n);
        if (seen.length) last = seen[seen.length - 1]!;
        expect(last).toBe(lines - 1);
      },
      { timeout: 10_000 },
    );
    expect(dropped).toBe(true);
    expect(seen.length).toBeLessThan(lines);
    // Lines arrive in order, with the dropped ones missing from the front.
    expect([...seen].sort((a, b) => a - b)).toEqual(seen);
    expect((await read(op, id)).dropped).toBe(false);
  });

  it("drops a line over 1 MB with the flag and keeps the next line whole", async () => {
    const { operation } = await fixture();
    const op = operation();
    const id = await open(op);
    await send(
      op,
      id,
      JSON.stringify({
        id: 1,
        method: "long",
        params: { bytes: SESSION_LIMITS.lineBytes + 10 },
      }),
    );
    const lines: string[] = [];
    let dropped = false;
    await vi.waitFor(async () => {
      const result = await read(op, id, { waitMs: 500 });
      dropped ||= result.dropped;
      lines.push(...result.lines);
      expect(lines.length).toBeGreaterThan(0);
    });
    expect(dropped).toBe(true);
    expect(lines.map((line) => JSON.parse(line))).toEqual([
      { jsonrpc: "2.0", id: 1, result: "after" },
    ]);
  });

  it("keeps only the newest stderr, bounded", async () => {
    const { operation } = await fixture();
    const op = operation();
    const id = await open(op);
    await send(
      op,
      id,
      JSON.stringify({
        id: 1,
        method: "stderr",
        params: { bytes: SESSION_LIMITS.stderrBytes * 2 },
      }),
    );
    let stderr = "";
    await vi.waitFor(async () => {
      stderr += (await read(op, id, { waitMs: 500 })).stderr;
      expect(stderr.endsWith("TAIL")).toBe(true);
    });
    expect(stderr.length).toBeLessThanOrEqual(SESSION_LIMITS.stderrBytes);
    expect((await read(op, id)).stderr).toBe("");
  });

  it("waits for a line up to waitMs, and no longer than the operation has left", async () => {
    const { operation } = await fixture();
    const op = operation();
    const id = await open(op);
    await send(
      op,
      id,
      JSON.stringify({ id: 1, method: "later", params: { ms: 300 } }),
    );
    let started = Date.now();
    const answered = await read(op, id, { waitMs: 5000 });
    expect(answered.lines).toHaveLength(1);
    expect(Date.now() - started).toBeLessThan(3000);

    started = Date.now();
    expect((await read(op, id, { waitMs: 200 })).lines).toEqual([]);
    expect(Date.now() - started).toBeGreaterThanOrEqual(150);

    // The operation has 400 ms left: the wait ends before it does.
    op.setRemainingTime?.(() => 400);
    started = Date.now();
    expect((await read(op, id, { waitMs: 10_000 })).lines).toEqual([]);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("ends a waiting read when its operation ends, and keeps the session", async () => {
    const { operation } = await fixture();
    const op = operation();
    const id = await open(op);
    const waiting = read(op, id, { waitMs: 10_000 });
    setTimeout(() => op.close(), 100);
    await expect(waiting).rejects.toMatchObject({ reason: "operation_ended" });
    await expect(read(op, id)).rejects.toMatchObject({
      reason: "operation_ended",
    });
    expect((await call(operation(), id, "echo")).pid).toBeTypeOf("number");
  });

  it("reports a program that exited, then forgets the session", async () => {
    const { operation } = await fixture();
    const op = operation();
    const id = await open(op);
    await send(
      op,
      id,
      JSON.stringify({ id: 1, method: "exit", params: { code: 7 } }),
    );
    let result: SessionRead | undefined;
    await vi.waitFor(async () => {
      result = await read(op, id, { waitMs: 500 });
      if (!result.exited) throw new Error("Still running.");
    });
    expect(result).toMatchObject({ exited: true, exitCode: 7 });
    await expect(send(op, id, "{}")).rejects.toMatchObject({
      reason: "session_ended",
    });
  });
});

describe("Given a session's end", () => {
  async function withTree() {
    const context = await fixture({ idleTimeoutSeconds: 1 });
    const op = context.operation();
    const id = await open(op);
    const { pids: tree } = await call(op, id, "child");
    pids.push(...tree);
    expect(tree.every(alive)).toBe(true);
    return { ...context, op, id, tree: tree as number[] };
  }

  it("close ends the whole tree and later calls find no session", async () => {
    const { op, id, tree, sink } = await withTree();
    await close(op, id);
    await expectGone(tree);
    await expect(read(op, id)).rejects.toMatchObject({
      reason: "session_ended",
    });
    expect(sessionEvents(sink).at(-1)).toMatchObject({
      outcome: "ok",
      process: { session: "close", ended_by: "plugin", command_id: "server" },
    });
  });

  it("the idle timeout ends the whole tree", async () => {
    const { op, id, tree, sink } = await withTree();
    await expectGone(tree);
    await expect(read(op, id)).rejects.toMatchObject({
      reason: "session_ended",
    });
    // The close event follows the program's end.
    await vi.waitFor(() =>
      expect(sessionEvents(sink).at(-1)).toMatchObject({
        process: { session: "close", ended_by: "idle" },
      }),
    );
  });

  it("use keeps an idle session alive", async () => {
    const { op, id, tree } = await withTree();
    for (let n = 0; n < 4; n++) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      await read(op, id);
    }
    expect(tree.every(alive)).toBe(true);
  });

  it("quit ends the whole tree, and nothing opens after it", async () => {
    const { broker, op, id, tree, sink } = await withTree();
    await broker.shutdown();
    await expectGone(tree);
    expect(sessionEvents(sink).at(-1)).toMatchObject({
      process: { session: "close", ended_by: "quit" },
    });
    await expect(read(op, id)).rejects.toMatchObject({
      reason: "session_ended",
    });
    await expect(open(op)).rejects.toMatchObject({
      reason: "operation_ended",
    });
  });

  // Windows has no process group to end once its leader is gone.
  it.skipIf(process.platform === "win32")(
    "a program that exited by itself leaves none of its tree running",
    async () => {
      const context = await fixture();
      const op = context.operation();
      const id = await open(op);
      const { pids: tree } = await call(op, id, "orphan");
      pids.push(...tree);
      await expectGone(tree);
      await vi.waitFor(async () =>
        expect((await read(op, id)).exited).toBe(true),
      );
    },
  );

  it("the host ending a plugin's sessions ends only that plugin's", async () => {
    const context = await withTree();
    const other = context.operation(context.manifestFor("other-plugin"));
    const otherId = await open(other);
    const { pid } = await call(other, otherId, "echo");
    pids.push(pid);
    await context.broker.endSessions(context.manifest.id);
    await expectGone(context.tree);
    expect(alive(pid)).toBe(true);
    expect(sessionEvents(context.sink).at(-1)).toMatchObject({
      process: { session: "close", ended_by: "gate" },
    });
  });

  it("a gate that turns off ends the session at the next check, and the call says why", async () => {
    let gate: "plugin_off" | "unsigned_processes_off" | undefined;
    const context = await fixture({
      gate: async () => gate,
      sessionCheckMs: 100,
    });
    const op = context.operation();
    const id = await open(op);
    const { pids: tree } = await call(op, id, "child");
    pids.push(...tree);
    gate = "unsigned_processes_off";
    await expectGone(tree);
    await expect(read(op, id)).rejects.toMatchObject({
      reason: "session_ended",
    });
  });

  it("a call made after the gate turned off ends the session and is refused with the gate", async () => {
    let gate: "needs_consent" | undefined;
    const context = await fixture({
      gate: async () => gate,
      sessionCheckMs: 60_000,
    });
    const op = context.operation();
    const id = await open(op);
    const { pids: tree } = await call(op, id, "child");
    pids.push(...tree);
    gate = "needs_consent";
    await expect(send(op, id, "{}")).rejects.toMatchObject({
      reason: "needs_consent",
    });
    await expectGone(tree);
    await expect(read(op, id)).rejects.toMatchObject({
      reason: "session_ended",
    });
  });

  it("a session gate the host adds, such as suspension, ends it too", async () => {
    let suspended = false;
    const context = await fixture({
      sessionGate: async () => (suspended ? "plugin_off" : undefined),
      sessionCheckMs: 100,
    });
    const op = context.operation();
    const id = await open(op);
    const { pids: tree } = await call(op, id, "child");
    pids.push(...tree);
    suspended = true;
    await expectGone(tree);
  });

  it("a later operation from another package of the plugin can't use it", async () => {
    const context = await fixture();
    const op = context.operation();
    const id = await open(op);
    const { pid } = await call(op, id, "echo");
    pids.push(pid);
    const updated = { ...context.manifest, version: "1.0.1" };
    await expect(
      context.operation(updated).session({ action: "read", id }),
    ).rejects.toMatchObject({ reason: "session_ended" });
    await expectGone([pid]);
  });
});

describe("Given an open's checks", () => {
  it("refuses at open with the gate, and starts nothing", async () => {
    const spawned = vi.fn();
    const context = await fixture({
      gate: async () => "process_acceptance_required",
      record: spawned,
    });
    await expect(open(context.operation())).rejects.toMatchObject({
      reason: "process_acceptance_required",
    });
    expect(spawned).toHaveBeenCalledWith(
      context.manifest.id,
      expect.any(Number),
      true,
      false,
    );
  });

  it("checks argument kinds at open", async () => {
    const { operation } = await fixture();
    for (const label of ["-x", "a b", ""])
      await expect(open(operation(), label)).rejects.toMatchObject({
        reason: "invalid_request",
      });
    await expect(
      operation().session({
        action: "open",
        command: "server",
        args: { label: "a", extra: "b" },
      }),
    ).rejects.toMatchObject({ reason: "invalid_request" });
  });

  it("opens only session commands, and runs none", async () => {
    const { operation } = await fixture();
    await expect(
      operation().session({ action: "open", command: "capture", args: {} }),
    ).rejects.toMatchObject({ reason: "invalid_request" });
    await expect(
      operation().run({ command: "server", args: { label: "a" } }),
    ).rejects.toMatchObject({ reason: "invalid_request" });
    await expect(
      operation().session({ action: "open", command: "missing", args: {} }),
    ).rejects.toMatchObject({ reason: "undeclared" });
  });

  it("refuses after its operation ended", async () => {
    const { operation } = await fixture();
    const op = operation();
    op.close();
    await expect(open(op)).rejects.toMatchObject({
      reason: "operation_ended",
    });
  });

  it("emits content-free open and close events", async () => {
    const marker = "CANARY-SESSION-9Z";
    const context = await fixture();
    const op = context.operation();
    const id = await open(op, marker);
    await send(
      op,
      id,
      JSON.stringify({ id: 1, method: "echo", params: marker }),
    );
    await read(op, id, { waitMs: 1000 });
    await close(op, id);
    expect(sessionEvents(context.sink)).toMatchObject([
      {
        name: "plugin.process",
        outcome: "ok",
        plugin: { id: context.manifest.id },
        process: { session: "open", command_id: "server", decided_by: "ok" },
      },
      {
        name: "plugin.process",
        outcome: "ok",
        process: {
          session: "close",
          command_id: "server",
          ended_by: "plugin",
          session_ms: expect.any(Number),
        },
      },
    ]);
    const text = JSON.stringify(context.sink.events);
    expect(text).not.toContain(marker);
    expect(text).not.toContain(id);
    expect(text).not.toContain(context.root);
  });

  it("gives a git program the git environment and no AJOUR_ variable", async () => {
    process.env.AJOUR_SESSION_CANARY = "secret";
    try {
      const context = await fixture({
        executable: async (root) => {
          const git = path.join(
            root,
            process.platform === "win32" ? "git.exe" : "git",
          );
          await link(process.execPath, git).catch(() =>
            copyFile(process.execPath, git),
          );
          return git;
        },
      });
      const op = context.operation();
      const id = await open(op);
      expect(await call(op, id, "env")).toMatchObject({
        GIT_CONFIG_KEY_0: "safe.bareRepository",
        GIT_CONFIG_VALUE_0: "explicit",
        GIT_OPTIONAL_LOCKS: "0",
      });
      expect(Object.keys(await call(op, id, "env", {}, 2))).not.toContain(
        "AJOUR_SESSION_CANARY",
      );
    } finally {
      delete process.env.AJOUR_SESSION_CANARY;
    }
  });

  it("starts in the first folder slot when there is one", async () => {
    const context = await fixture();
    const cwdScript = path.join(context.root, "cwd.cjs");
    await writeFile(
      cwdScript,
      "process.stdout.write(process.cwd()+'\\n');process.stdin.resume()",
    );
    const manifest = pluginApi4ManifestSchema.parse({
      ...context.manifest,
      processes: {
        executables: { node: { names: ["node"] } },
        commands: [
          {
            id: "server",
            executable: "node",
            args: [{ kind: "literal", value: cwdScript }, "{repo:folder}"],
            mode: "session",
            idleTimeoutSeconds: 60,
          },
        ],
      },
    });
    const op = context.operation(manifest);
    const id = (await op.session({
      action: "open",
      command: "server",
      args: { repo: "folder-1" },
    })) as string;
    const { lines } = await read(op, id, { waitMs: 2000 });
    expect(path.resolve(lines[0]!)).toBe(path.resolve(context.root));
    expect(await readFile(cwdScript, "utf8")).toContain("cwd");
  });
});
