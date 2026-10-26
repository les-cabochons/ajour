import os from "node:os";
import path from "node:path";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { afterEach, describe, expect, it } from "vitest";
import { recordingEvents } from "./recording-events.ts";

/*
 * The launch's sweep of orphaned plugin renderers (#391): it ends only the
 * processes a previous session recorded that are still Ajour's renderers,
 * by program and start time, and never one that took a freed id. The
 * real-Electron check, scripts/check-plugin-sandbox.mjs, proves it against
 * real processes.
 */

const require = createRequire(import.meta.url);
interface RecordedEntry {
  pid: number;
  pluginId?: string;
  createdAt?: number;
}
interface ProcessRecord {
  add(entry: RecordedEntry): void;
  remove(entry: RecordedEntry): void;
  hold(entries: RecordedEntry[]): void;
  release(entries: RecordedEntry[]): void;
}
interface RunningProcess {
  pid: number;
  executablePath: string;
  createdAt?: number;
}
const {
  createProcessRecord,
  describeProcesses,
  isOurRenderer,
  sweepOrphanedRenderers,
} = require("./electron/plugin-renderer-sweep.cjs") as {
  createProcessRecord: (
    filePath: string,
    options?: { fileSystem?: unknown },
  ) => ProcessRecord;
  describeProcesses: (
    pids: number[],
    platform: string,
    options?: {
      run?: (
        file: string,
        args: string[],
        env: Record<string, string | undefined> | undefined,
      ) => Promise<string>;
      env?: Record<string, string | undefined>;
    },
  ) => Promise<RunningProcess[]>;
  isOurRenderer: (
    recorded: { pid: number; createdAt?: number },
    running: RunningProcess,
    self: { execPath: string; platform: string },
  ) => boolean;
  sweepOrphanedRenderers: (options: Record<string, unknown>) => Promise<{
    recorded: number;
    ended: number;
    gone: number;
    notOurs: number;
    stillRunning: number;
  }>;
};

const AJOUR = "C:\\Program Files\\Ajour\\Ajour.exe";
const STARTED = 1_792_000_000_000;
const RECORD_FILE =
  "C:\\Users\\ada\\AppData\\Roaming\\Ajour\\plugin-renderers.json";

/** A record that writes to memory: what the file holds now, or undefined. */
function memoryRecord(initial?: unknown) {
  let file: string | undefined =
    initial === undefined
      ? undefined
      : typeof initial === "string"
        ? initial
        : JSON.stringify(initial);
  const record = createProcessRecord(RECORD_FILE, {
    fileSystem: {
      writeFileSync: (_path: string, text: string) => {
        file = text;
      },
      renameSync: () => undefined,
      rmSync: () => {
        file = undefined;
      },
    },
  });
  return {
    record,
    /** The pids the file lists, or undefined when there is no file. */
    pidsInFile: () =>
      file === undefined
        ? undefined
        : (JSON.parse(file).processes as RecordedEntry[]).map(
            (entry) => entry.pid,
          ),
    read: () => {
      if (file === undefined) throw new Error("ENOENT");
      return file;
    },
  };
}

function sweep(
  record: unknown,
  running: RunningProcess[] | Error | Promise<RunningProcess[]>,
  options: {
    alive?: (pid: number) => boolean;
    memory?: ReturnType<typeof memoryRecord>;
  } = {},
) {
  const { events, recorded } = recordingEvents();
  const killed: number[] = [];
  const removed: string[] = [];
  const memory = options.memory ?? memoryRecord(record);
  const result = sweepOrphanedRenderers({
    filePath: RECORD_FILE,
    record: memory.record,
    platform: "win32",
    execPath: AJOUR,
    events,
    readFile: () => memory.read(),
    removeFile: (file: string) => removed.push(file),
    describe: async () => {
      if (running instanceof Error) throw running;
      return running;
    },
    kill: (pid: number) => killed.push(pid),
    alive: options.alive ?? (() => false),
    waitMs: 200,
  });
  return { result, killed, removed, recorded, memory };
}

describe("the sweep of orphaned plugin renderers", () => {
  it("does nothing, and says nothing, when the last session closed every renderer", async () => {
    const { result, killed, recorded } = sweep(undefined, []);

    await expect(result).resolves.toMatchObject({ recorded: 0, ended: 0 });
    expect(killed).toEqual([]);
    expect(recorded).toEqual([]);
  });

  it("ends a recorded renderer still running, and nothing that took a freed id", async () => {
    const { result, killed, memory, recorded } = sweep(
      {
        version: 1,
        processes: [
          { pid: 101, pluginId: "jira", createdAt: STARTED },
          // The id now belongs to another program.
          { pid: 102, pluginId: "github", createdAt: STARTED },
          // Ajour's program, but started later: another process took the id.
          { pid: 103, pluginId: "outlook", createdAt: STARTED },
          // Gone already, as Chromium ends a renderer with main.
          { pid: 104, pluginId: "slack", createdAt: STARTED },
        ],
      },
      [
        { pid: 101, executablePath: AJOUR, createdAt: STARTED + 15 },
        {
          pid: 102,
          executablePath: "C:\\Windows\\System32\\notepad.exe",
          createdAt: STARTED,
        },
        { pid: 103, executablePath: AJOUR, createdAt: STARTED + 60_000 },
      ],
    );

    await expect(result).resolves.toEqual({
      recorded: 4,
      ended: 1,
      gone: 1,
      notOurs: 2,
      stillRunning: 0,
    });
    expect(killed).toEqual([101]);
    // Every entry is dealt with, so the record is gone.
    expect(memory.pidsInFile()).toBeUndefined();
    expect(
      recorded.find((event) => event.name === "plugin_renderer.sweep"),
    ).toMatchObject({
      kind: "lifecycle",
      outcome: "ok",
      sweep: { recorded: 4, ended: 1, gone: 1, not_ours: 2, still_running: 0 },
    });
  });

  it("waits on what it ended, and says when one is still running", async () => {
    let checks = 0;
    const { result } = sweep(
      { version: 1, processes: [{ pid: 101, createdAt: STARTED }] },
      [{ pid: 101, executablePath: AJOUR, createdAt: STARTED }],
      { alive: () => ++checks < 3 },
    );
    await expect(result).resolves.toMatchObject({ ended: 1, stillRunning: 0 });

    const stuck = sweep(
      { version: 1, processes: [{ pid: 101, createdAt: STARTED }] },
      [{ pid: 101, executablePath: AJOUR, createdAt: STARTED }],
      { alive: () => true },
    );
    await expect(stuck.result).resolves.toMatchObject({
      ended: 0,
      stillRunning: 1,
    });
    expect(
      stuck.recorded.find((event) => event.name === "plugin_renderer.sweep"),
    ).toMatchObject({ outcome: "error", outcome_reason: "still_running" });
  });

  it("ends nothing on a record it can't read, or when the system can't say what runs", async () => {
    const unreadable = sweep("{not json", [
      { pid: 101, executablePath: AJOUR, createdAt: STARTED },
    ]);
    await unreadable.result;
    expect(unreadable.killed).toEqual([]);
    expect(unreadable.removed).toHaveLength(1);
    expect(unreadable.recorded).toMatchObject([
      { outcome: "refused", outcome_reason: "unreadable_record" },
    ]);

    const failed = sweep(
      { version: 1, processes: [{ pid: 101, createdAt: STARTED }] },
      new Error("PowerShell failed"),
    );
    await failed.result;
    expect(failed.killed).toEqual([]);
    expect(failed.recorded).toMatchObject([
      { outcome: "error", outcome_reason: "query_failed" },
    ]);
  });

  it("keeps every entry in the record when the system doesn't answer, so the next launch tries again", async () => {
    const entries = [
      { pid: 101, pluginId: "jira", createdAt: STARTED },
      { pid: 102, pluginId: "github", createdAt: STARTED },
    ];
    const { result, killed, memory } = sweep(
      { version: 1, processes: entries },
      new Error("timed out after 15000 ms"),
    );
    await result;
    expect(killed).toEqual([]);
    expect(memory.pidsInFile()).toEqual([101, 102]);

    // This session's renderers write the file as they open and close, and
    // the last session's entries ride along each time.
    const opened = { pid: 201, pluginId: "slack", createdAt: STARTED + 9_000 };
    memory.record.add(opened);
    expect(memory.pidsInFile()).toEqual([101, 102, 201]);
    memory.record.remove(opened);
    expect(memory.pidsInFile()).toEqual([101, 102]);
  });

  it("holds the entries while the system is still being asked, whatever this session's renderers write", async () => {
    let answer!: (found: RunningProcess[]) => void;
    const pending = new Promise<RunningProcess[]>((resolve) => {
      answer = resolve;
    });
    const memory = memoryRecord({
      version: 1,
      processes: [{ pid: 101, pluginId: "jira", createdAt: STARTED }],
    });
    const { result, killed } = sweep(undefined, pending, { memory });
    // The renderer of this session opens and closes before the answer.
    const opened = { pid: 201, pluginId: "slack", createdAt: STARTED + 9_000 };
    memory.record.add(opened);
    memory.record.remove(opened);
    expect(memory.pidsInFile()).toEqual([101]);

    answer([{ pid: 101, executablePath: AJOUR, createdAt: STARTED }]);
    await expect(result).resolves.toMatchObject({ ended: 1 });
    expect(killed).toEqual([101]);
    expect(memory.pidsInFile()).toBeUndefined();
  });

  it("lets go of what it dealt with, and keeps an orphan it couldn't end", async () => {
    const memory = memoryRecord({
      version: 1,
      processes: [
        { pid: 101, pluginId: "jira", createdAt: STARTED },
        { pid: 102, pluginId: "github", createdAt: STARTED },
        { pid: 103, pluginId: "slack", createdAt: STARTED },
      ],
    });
    const { result } = sweep(
      undefined,
      [
        { pid: 101, executablePath: AJOUR, createdAt: STARTED },
        {
          pid: 102,
          executablePath: "C:\\Windows\\System32\\notepad.exe",
          createdAt: STARTED,
        },
      ],
      // 101 refuses to end; 102 isn't ours; 103 is gone.
      { memory, alive: (pid) => pid === 101 },
    );
    await expect(result).resolves.toMatchObject({
      ended: 0,
      stillRunning: 1,
      notOurs: 1,
      gone: 1,
    });
    expect(memory.pidsInFile()).toEqual([101]);
  });

  it("replaces a held entry whose id a new renderer took, and lets go of only its own", async () => {
    const memory = memoryRecord({
      version: 1,
      processes: [{ pid: 101, pluginId: "jira", createdAt: STARTED }],
    });
    let answer!: (found: RunningProcess[]) => void;
    const pending = new Promise<RunningProcess[]>((resolve) => {
      answer = resolve;
    });
    const { result } = sweep(undefined, pending, { memory });
    // The orphan is gone and this session's renderer took its id.
    const taken = { pid: 101, pluginId: "slack", createdAt: STARTED + 9_000 };
    memory.record.add(taken);
    answer([]);
    await result;
    expect(JSON.parse(memory.read()).processes).toEqual([taken]);
  });

  it("ends nothing on a program match alone: a start time missing on either side is not ours", async () => {
    const { result, killed } = sweep(
      {
        version: 1,
        processes: [
          // No start time recorded.
          { pid: 101, pluginId: "jira" },
          // The system gave no start time for the running process.
          { pid: 102, pluginId: "github", createdAt: STARTED },
        ],
      },
      [
        { pid: 101, executablePath: AJOUR, createdAt: STARTED },
        { pid: 102, executablePath: AJOUR },
      ],
    );

    await expect(result).resolves.toMatchObject({
      recorded: 2,
      ended: 0,
      notOurs: 2,
    });
    expect(killed).toEqual([]);

    const self = { execPath: AJOUR, platform: "win32" };
    expect(
      isOurRenderer(
        { pid: 7 },
        { pid: 7, executablePath: AJOUR, createdAt: STARTED },
        self,
      ),
    ).toBe(false);
    expect(
      isOurRenderer(
        { pid: 7, createdAt: STARTED },
        { pid: 7, executablePath: AJOUR },
        self,
      ),
    ).toBe(false);
  });

  it("knows Ajour's renderers by program: the same binary on Windows, a helper of its bundle on macOS", () => {
    const recorded = { pid: 7, createdAt: STARTED };
    expect(
      isOurRenderer(
        recorded,
        {
          pid: 7,
          executablePath: "c:\\program files\\ajour\\AJOUR.EXE",
          createdAt: STARTED,
        },
        { execPath: AJOUR, platform: "win32" },
      ),
    ).toBe(true);
    const mac = {
      execPath: "/Applications/Ajour.app/Contents/MacOS/Ajour",
      platform: "darwin",
    };
    expect(
      isOurRenderer(
        recorded,
        {
          pid: 7,
          executablePath:
            "/Applications/Ajour.app/Contents/Frameworks/Ajour Helper (Renderer).app/Contents/MacOS/Ajour Helper (Renderer)",
          createdAt: STARTED + 999,
        },
        mac,
      ),
    ).toBe(true);
    expect(
      isOurRenderer(
        recorded,
        {
          pid: 7,
          executablePath:
            "/Applications/Other.app/Contents/Frameworks/Other Helper (Renderer).app/Contents/MacOS/Other Helper (Renderer)",
          createdAt: STARTED,
        },
        mac,
      ),
    ).toBe(false);
  });
});

describe("asking the system about the recorded processes", () => {
  it("runs Windows PowerShell by its absolute path under SystemRoot, not by the search path", async () => {
    const calls: string[] = [];
    const found = await describeProcesses([11], "win32", {
      env: { SystemRoot: "D:\\Win" },
      run: async (file) => {
        calls.push(file);
        return JSON.stringify({ pid: 11, path: AJOUR, created: STARTED });
      },
    });

    expect(calls).toEqual([
      "D:\\Win\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
    ]);
    expect(found).toEqual([
      { pid: 11, executablePath: AJOUR, createdAt: STARTED },
    ]);

    await describeProcesses([11], "win32", {
      env: {},
      run: async (file) => {
        calls.push(file);
        return "[]";
      },
    });
    expect(calls[1]).toBe(
      "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
    );
  });

  it("reads macOS start times in the C locale, whatever language the user's is, keeping the rest of the environment", async () => {
    let seenEnv: Record<string, string | undefined> | undefined;
    const found = await describeProcesses([321], "darwin", {
      env: { TZ: "Europe/Paris", LC_ALL: "fr_FR.UTF-8" },
      run: async (file, _args, env) => {
        expect(file).toBe("/bin/ps");
        seenEnv = env;
        return "  321 Sun Oct 25 15:39:17 2026 /Applications/Ajour.app/Contents/Frameworks/Ajour Helper (Renderer).app/Contents/MacOS/Ajour Helper (Renderer)\n";
      },
    });

    expect(seenEnv).toEqual({ TZ: "Europe/Paris", LC_ALL: "C" });
    expect(found).toEqual([
      {
        pid: 321,
        executablePath:
          "/Applications/Ajour.app/Contents/Frameworks/Ajour Helper (Renderer).app/Contents/MacOS/Ajour Helper (Renderer)",
        createdAt: new Date(2026, 9, 25, 15, 39, 17).getTime(),
      },
    ]);
  });
});

describe("the record of plugin renderer processes", () => {
  const directories: string[] = [];
  afterEach(async () => {
    await Promise.all(
      directories
        .splice(0)
        .map((directory) => rm(directory, { recursive: true, force: true })),
    );
  });

  it("lists the live renderers, and is gone once none runs", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "ajour-record-"));
    directories.push(directory);
    const filePath = path.join(directory, "plugin-renderers.json");
    const record = createProcessRecord(filePath);

    const first = { pid: 11, pluginId: "jira", createdAt: STARTED };
    const second = { pid: 12, pluginId: "github" };
    record.add(first);
    record.add(second);
    expect(JSON.parse(await readFile(filePath, "utf8"))).toEqual({
      version: 1,
      processes: [
        { pid: 11, pluginId: "jira", createdAt: STARTED },
        { pid: 12, pluginId: "github" },
      ],
    });

    record.remove(first);
    record.remove(second);
    expect(existsSync(filePath)).toBe(false);
  });

  it("forgets only the entry a renderer added, so a closing one can't delete a reused id's new entry", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "ajour-record-"));
    directories.push(directory);
    const filePath = path.join(directory, "plugin-renderers.json");
    const record = createProcessRecord(filePath);
    const old = { pid: 11, pluginId: "jira", createdAt: STARTED };
    const reused = { pid: 11, pluginId: "github", createdAt: STARTED + 9_000 };

    record.add(old);
    // The id came back for another renderer before the first one finished closing.
    record.add(reused);
    record.remove(old);

    expect(JSON.parse(await readFile(filePath, "utf8"))).toEqual({
      version: 1,
      processes: [reused],
    });
    record.remove(reused);
    expect(existsSync(filePath)).toBe(false);
  });
});
