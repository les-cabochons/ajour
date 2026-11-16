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
import {
  childRunning,
  endProcessGroup,
  endProcessTree,
} from "./process-tree.ts";

/*
 * A session's lifecycle against a program the test plays (#743): timers,
 * exits and errors arrive when the test says, and ending a tree is recorded
 * rather than done.
 */

vi.mock("./process-tree.ts", () => ({
  endProcessTree: vi.fn(),
  endProcessGroup: vi.fn(),
  childRunning: vi.fn(),
}));

/** A played program runs until it reports its end. */
const playedRunning = (child: ChildProcess) =>
  child.exitCode === null && child.signalCode === null;

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
  vi.mocked(childRunning).mockReset();
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
  const released = vi.fn();
  const sessions = new ProcessSessions({
    events: createApiEvents({ sink, userDataPath: os.tmpdir() }),
    check: options.check ?? (async () => undefined),
    checkMs: options.checkMs,
    released,
  });
  const children: FakeChild[] = [];
  cleanups.push(() => {
    // What a test left running ends with it, not in the next test.
    for (const child of children) if (child.exitCode === null) child.end(137);
    return sessions.shutdown();
  });
  vi.mocked(childRunning).mockImplementation(playedRunning);
  // Ending a tree ends the program it was given.
  vi.mocked(endProcessTree).mockImplementation((child) => {
    queueMicrotask(() => (child as unknown as FakeChild).end(137));
  });
  const start = () => {
    const release = sessions.reserve(caller.pluginId);
    const child = new FakeChild();
    children.push(child);
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
  return { sessions, start, read, closeEvents, released };
}

describe("Given a session Ajour ends whose program survives the kill", () => {
  /** Each way Ajour ends a session, played against a kill that fails. */
  const triggers = [
    {
      name: "a close",
      options: {},
      end: async (s: ReturnType<typeof setup>, id: string) => {
        const closing = s.sessions.close(caller, id);
        await vi.advanceTimersByTimeAsync(3000);
        await closing;
      },
    },
    {
      name: "the idle timeout",
      options: { idleSeconds: 1 },
      end: async () => {
        await vi.advanceTimersByTimeAsync(1000 + 3000);
      },
    },
    {
      name: "a gate turning off",
      options: { checkMs: 100 },
      end: async (
        _s: ReturnType<typeof setup>,
        _id: string,
        off: () => void,
      ) => {
        off();
        await vi.advanceTimersByTimeAsync(100 + 3000);
      },
    },
  ];

  function survivor(trigger: (typeof triggers)[number]) {
    vi.useFakeTimers();
    let gateOff = false;
    const s = setup({
      ...trigger.options,
      check: async () => (gateOff ? "plugin_off" : undefined),
    });
    // The kill fails: the program keeps running.
    vi.mocked(endProcessTree).mockImplementation(() => undefined);
    const first = s.start();
    return {
      ...s,
      first,
      end: () => trigger.end(s, first.id, () => (gateOff = true)),
    };
  }

  it.each(triggers)(
    "after $name it keeps its place but no call reaches it, until its process is gone",
    async (trigger) => {
      const { sessions, read, first, end, released } = survivor(trigger);
      await end();
      expect(endProcessTree).toHaveBeenCalledWith(
        first.child,
        expect.anything(),
        expect.any(Function),
      );
      await expect(read(first.id)).rejects.toMatchObject({
        reason: "session_ended",
      });
      await expect(
        sessions.send(caller, first.id, "hello"),
      ).rejects.toMatchObject({ reason: "session_ended" });
      await expect(sessions.close(caller, first.id)).rejects.toMatchObject({
        reason: "session_ended",
      });
      // The surviving program still counts toward the plugin's two, so
      // opens and closes can't pile survivors up.
      const held = sessions.reserve(caller.pluginId);
      expect(() => sessions.reserve(caller.pluginId)).toThrow(
        expect.objectContaining({ reason: "session_limit" }),
      );
      held();
      await vi.advanceTimersByTimeAsync(30_000);
      expect(released).not.toHaveBeenCalled();
      // Its process is found gone: only now is its place free.
      vi.mocked(childRunning).mockReturnValue(false);
      await vi.advanceTimersByTimeAsync(3000);
      expect(released).toHaveBeenCalledWith(caller.pluginId);
      sessions.reserve(caller.pluginId);
      sessions.reserve(caller.pluginId);
    },
  );

  it.each(triggers)("after $name the quit ends it again", async (trigger) => {
    const { sessions, first, end } = survivor(trigger);
    await end();
    vi.mocked(endProcessTree).mockClear();
    const quit = sessions.shutdown();
    await vi.advanceTimersByTimeAsync(3000);
    await quit;
    expect(endProcessTree).toHaveBeenCalledWith(
      first.child,
      expect.anything(),
      expect.any(Function),
    );
  });

  it("the host ending the plugin's sessions doesn't wait on a survivor forever", async () => {
    const { sessions, first, end } = survivor(triggers[0]!);
    await end();
    vi.mocked(endProcessTree).mockClear();
    let done = false;
    void sessions.endPlugin(caller.pluginId).then(() => (done = true));
    await vi.advanceTimersByTimeAsync(3000);
    expect(done).toBe(true);
    expect(endProcessTree).toHaveBeenCalledWith(
      first.child,
      expect.anything(),
      expect.any(Function),
    );
  });

  it("a survivor's output, kept or later, is dropped while its pipes keep draining", async () => {
    const { sessions, first, end } = survivor(triggers[0]!);
    type Kept = {
      lines: string[];
      bytes: number;
      partial: Buffer[];
      partialBytes: number;
      stderr: string;
    };
    const kept = () =>
      (sessions as unknown as { sessions: Map<string, Kept> }).sessions.get(
        first.id,
      )!;
    // A line without its end and some stderr wait when Ajour ends it.
    first.child.stdout.write("half a line");
    first.child.stderr.write("an error");
    await vi.advanceTimersByTimeAsync(0);
    await end();
    first.child.stdout.write(" and the rest\nanother line\nmore");
    first.child.stderr.write("another error");
    await vi.advanceTimersByTimeAsync(0);
    expect(kept()).toMatchObject({
      lines: [],
      bytes: 0,
      partial: [],
      partialBytes: 0,
      stderr: "",
    });
    // Its pipes are still read, so the program never blocks on a full one.
    expect(first.child.stdout.readableFlowing).toBe(true);
    expect(first.child.stdout.readableLength).toBe(0);
    expect(first.child.stderr.readableLength).toBe(0);
  });

  it("a survivor that later reports its exit is forgotten, with no output kept", async () => {
    const { sessions, first, end, read, released } = survivor(triggers[0]!);
    await end();
    first.child.end(137);
    await vi.advanceTimersByTimeAsync(0);
    expect(released).toHaveBeenCalledWith(caller.pluginId);
    await expect(read(first.id)).rejects.toMatchObject({
      reason: "session_ended",
    });
  });
});

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

  it("an error whose kill failed keeps the session, and its place, while the program runs", async () => {
    vi.useFakeTimers();
    const { sessions, start, read } = setup();
    vi.mocked(endProcessTree).mockImplementation(() => undefined);
    const { id, child } = start();
    start();
    child.emit("error", new Error("kill EPERM"));
    // The program never reports its end.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await read(id)).toMatchObject({ exited: false });
    expect(() => sessions.reserve(caller.pluginId)).toThrow(
      expect.objectContaining({ reason: "session_limit" }),
    );
    // Its process is found gone: that is its end.
    vi.mocked(childRunning).mockReturnValue(false);
    await vi.advanceTimersByTimeAsync(3000);
    expect(await read(id)).toMatchObject({ exited: true, exitCode: null });
    sessions.reserve(caller.pluginId)();
  });

  it("a session whose program outlived a failed kill is ended again at quit", async () => {
    vi.useFakeTimers();
    const { sessions, start } = setup();
    vi.mocked(endProcessTree).mockImplementation(() => undefined);
    const { child } = start();
    child.emit("error", new Error("kill EPERM"));
    await vi.advanceTimersByTimeAsync(10_000);
    vi.mocked(endProcessTree).mockClear();
    const quit = sessions.shutdown();
    await vi.advanceTimersByTimeAsync(3000);
    await quit;
    expect(endProcessTree).toHaveBeenCalledWith(
      child,
      expect.anything(),
      expect.any(Function),
    );
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
