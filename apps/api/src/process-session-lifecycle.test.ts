import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { pluginApi4ManifestSchema } from "../../../packages/shared/plugin-api-4.ts";
import type { AjourEvent } from "../../../packages/wide-events/catalog.ts";
import { createRecordingSink } from "../../../packages/wide-events/sinks.ts";
import type { BrokerCaller } from "./broker-port.ts";
import { createApiEvents } from "./events.ts";
import { ProcessBroker } from "./process-broker.ts";
import { ProcessSessions, SESSION_LIMITS } from "./process-sessions.ts";
import { endProcessGroup, endProcessTree } from "./process-tree.ts";

/*
 * A session's lifecycle against a program the test plays (#743): timers,
 * exits and errors arrive when the test says, and ending a tree is recorded
 * rather than done.
 */

vi.mock("./process-tree.ts", () => ({
  endProcessTree: vi.fn(),
  endProcessGroup: vi.fn(),
}));

/** Runs as a spawned child reports it started, before the broker hears. */
const spawnHook: { started?: (child: ChildProcess) => void } = {};
vi.mock("node:child_process", async (original) => {
  const actual = await original<typeof import("node:child_process")>();
  return {
    ...actual,
    spawn: vi.fn((...args: Parameters<typeof actual.spawn>) => {
      const child = actual.spawn(...args);
      child.once("spawn", () => spawnHook.started?.(child));
      return child;
    }),
  };
});

const manifest = pluginApi4ManifestSchema.parse({
  id: "lifecycle",
  version: "1.0.0",
  apiVersion: 4,
  displayName: "Lifecycle",
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
        args: [
          { kind: "literal", value: "-e" },
          { kind: "literal", value: "setInterval(()=>{},1000)" },
        ],
        mode: "session",
        idleTimeoutSeconds: 60,
      },
    ],
  },
});
const caller: BrokerCaller = {
  pluginId: manifest.id,
  manifest,
  method: "syncConnection",
};

class FakeChild extends EventEmitter {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly pid = 4242;
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  readonly kill = vi.fn(() => true);
  /** The program ends, its streams closed. */
  end(code = 0) {
    this.exitCode = code;
    this.emit("exit", code, null);
    this.emit("close", code, null);
  }
}

const roots: string[] = [];
const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  vi.useRealTimers();
  spawnHook.started = undefined;
  vi.mocked(endProcessTree).mockReset();
  vi.mocked(endProcessGroup).mockReset();
  for (const cleanup of cleanups.splice(0)) await cleanup();
  await Promise.all(
    roots.splice(0).map((p) => rm(p, { recursive: true, force: true })),
  );
});

function setup(
  options: {
    check?: () => Promise<string | undefined>;
    checkMs?: number;
    idleSeconds?: number;
  } = {},
) {
  const sink = createRecordingSink<AjourEvent>();
  const sessions = new ProcessSessions({
    events: createApiEvents({ sink, userDataPath: os.tmpdir() }),
    check: options.check ?? (async () => undefined),
    checkMs: options.checkMs,
  });
  cleanups.push(() => sessions.shutdown());
  // Ending a tree ends the program it was given.
  vi.mocked(endProcessTree).mockImplementation((child) => {
    queueMicrotask(() => (child as unknown as FakeChild).end(137));
  });
  const start = () => {
    const release = sessions.reserve(caller.pluginId);
    const child = new FakeChild();
    const id = sessions.register(
      caller,
      "server",
      options.idleSeconds ?? 60,
      child as unknown as ChildProcess,
      {},
    );
    release();
    return { id, child };
  };
  const read = (
    id: string,
    waitMs = 0,
    signal = new AbortController().signal,
  ) => sessions.read(caller, id, { waitMs }, signal);
  const closeEvents = () =>
    sink.events.filter(
      (event) =>
        event.name === "plugin.process" &&
        (event as { process?: { session?: string } }).process?.session ===
          "close",
    );
  return { sessions, start, read, closeEvents };
}

describe("Given a session whose program exited", () => {
  it("keeps its place until read, and forgets it a minute later if nobody reads", async () => {
    vi.useFakeTimers();
    const { sessions, start, read } = setup();
    const first = start();
    start();
    first.child.stdout.write("last words\n");
    first.child.end(0);
    // Its lines wait for a read, and hold a place meanwhile.
    expect(() => sessions.reserve(caller.pluginId)).toThrow(
      expect.objectContaining({ reason: "session_limit" }),
    );
    await vi.advanceTimersByTimeAsync(SESSION_LIMITS.exitedKeepMs - 1000);
    expect(() => sessions.reserve(caller.pluginId)).toThrow(
      expect.objectContaining({ reason: "session_limit" }),
    );
    await vi.advanceTimersByTimeAsync(1001);
    sessions.reserve(caller.pluginId)();
    await expect(read(first.id)).rejects.toMatchObject({
      reason: "session_ended",
    });
  });

  it("a read hands over its last lines and frees its place", async () => {
    const { sessions, start, read } = setup();
    const first = start();
    start();
    first.child.stdout.write("last words\n");
    first.child.end(3);
    expect(await read(first.id)).toMatchObject({
      lines: ["last words"],
      exited: true,
      exitCode: 3,
    });
    sessions.reserve(caller.pluginId)();
  });

  it("ends the rest of its tree, which may outlive it", async () => {
    const { start } = setup();
    const { child } = start();
    child.end(0);
    expect(endProcessGroup).toHaveBeenCalledWith(child);
  });

  it("an error after it started ends the tree before the session counts as ended", async () => {
    const { start, read } = setup();
    vi.mocked(endProcessTree).mockImplementation(() => undefined);
    const { id, child } = start();
    child.emit("error", new Error("kill EPERM"));
    expect(endProcessTree).toHaveBeenCalledWith(
      child,
      expect.anything(),
      expect.any(Function),
    );
    expect(await read(id)).toMatchObject({ exited: false });
    child.end(1);
    expect(await read(id)).toMatchObject({ exited: true, exitCode: 1 });
  });
});

describe("Given a session's idle timeout", () => {
  it("a read waiting for a line holds it off, and it counts from the read's end", async () => {
    vi.useFakeTimers();
    const { start, read } = setup({ idleSeconds: 1 });
    const { id, child } = start();
    const waiting = read(id, SESSION_LIMITS.waitMs);
    await vi.advanceTimersByTimeAsync(5000);
    expect(endProcessTree).not.toHaveBeenCalled();
    child.stdout.write("answer\n");
    expect((await waiting).lines).toEqual(["answer"]);
    await vi.advanceTimersByTimeAsync(990);
    expect(endProcessTree).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(20);
    expect(endProcessTree).toHaveBeenCalledOnce();
  });
});

describe("Given a session's stderr", () => {
  it("keeps the newest 64 KB in UTF-8, in whole characters", async () => {
    const { start, read } = setup();
    const { id, child } = start();
    const text = "😀".repeat(20_000) + "TAIL";
    const bytes = Buffer.from(text, "utf8");
    // A character split between two writes still arrives whole.
    child.stderr.write(bytes.subarray(0, 3));
    child.stderr.write(bytes.subarray(3));
    await new Promise((resolve) => setImmediate(resolve));
    const { stderr } = await read(id);
    expect(Buffer.byteLength(stderr, "utf8")).toBeLessThanOrEqual(
      SESSION_LIMITS.stderrBytes,
    );
    expect(Buffer.byteLength(stderr, "utf8")).toBeGreaterThan(
      SESSION_LIMITS.stderrBytes - 4,
    );
    expect(stderr.endsWith("TAIL")).toBe(true);
    expect(stderr).not.toContain("�");
    expect(stderr.startsWith("😀")).toBe(true);
  });
});

describe("Given Ajour quitting", () => {
  it("records quit for a session a gate check ends while the plugins stop", async () => {
    vi.useFakeTimers();
    let off = false;
    const { sessions, start, read, closeEvents } = setup({
      check: async () => (off ? "plugin_off" : undefined),
      checkMs: 100,
    });
    const timed = start();
    const called = start();
    sessions.quitting();
    // The plugins stopping turns their gates off.
    off = true;
    await vi.advanceTimersByTimeAsync(500);
    await expect(read(called.id)).rejects.toMatchObject({
      reason: "plugin_off",
    });
    await sessions.shutdown();
    expect(timed.child.exitCode).toBe(137);
    expect(closeEvents()).toHaveLength(2);
    for (const event of closeEvents())
      expect(event).toMatchObject({ process: { ended_by: "quit" } });
    expect(() => sessions.reserve(caller.pluginId)).toThrow(
      expect.objectContaining({ reason: "operation_ended" }),
    );
  });
});

describe("Given an open whose operation ends as its program starts", () => {
  it("ends the program and refuses the open", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ajour-lifecycle-"));
    roots.push(root);
    const broker = new ProcessBroker({
      folders: { resolve: async () => root },
      gate: async () => undefined,
      executableOverride: async () => process.execPath,
    });
    cleanups.push(() => broker.shutdown());
    vi.mocked(endProcessTree).mockImplementation((child) => {
      child.kill("SIGKILL");
    });
    const op = broker.forOperation(caller);
    let started: ChildProcess | undefined;
    spawnHook.started = (child) => {
      started = child;
      op.close();
    };
    await expect(
      op.session({ action: "open", command: "server", args: {} }),
    ).rejects.toMatchObject({ reason: "operation_ended" });
    expect(started).toBeDefined();
    expect(endProcessTree).toHaveBeenCalledWith(
      started,
      expect.anything(),
      expect.any(Function),
    );
    // Its place is free again.
    spawnHook.started = undefined;
    const again = broker.forOperation(caller);
    await again.session({ action: "open", command: "server", args: {} });
    await again.session({ action: "open", command: "server", args: {} });
  });
});
