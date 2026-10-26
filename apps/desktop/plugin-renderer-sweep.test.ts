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
interface RunningProcess {
  pid: number;
  executablePath: string;
  createdAt?: number;
}
const { createProcessRecord, isOurRenderer, sweepOrphanedRenderers } =
  require("./electron/plugin-renderer-sweep.cjs") as {
    createProcessRecord: (filePath: string) => {
      add(entry: { pid: number; pluginId: string; createdAt?: number }): void;
      remove(pid: number): void;
    };
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

function sweep(
  record: unknown,
  running: RunningProcess[] | Error,
  options: { alive?: (pid: number) => boolean } = {},
) {
  const { events, recorded } = recordingEvents();
  const killed: number[] = [];
  const removed: string[] = [];
  const result = sweepOrphanedRenderers({
    filePath: "C:\\Users\\ada\\AppData\\Roaming\\Ajour\\plugin-renderers.json",
    platform: "win32",
    execPath: AJOUR,
    events,
    readFile: () => {
      if (record === undefined) throw new Error("ENOENT");
      return typeof record === "string" ? record : JSON.stringify(record);
    },
    removeFile: (file: string) => removed.push(file),
    describe: async () => {
      if (running instanceof Error) throw running;
      return running;
    },
    kill: (pid: number) => killed.push(pid),
    alive: options.alive ?? (() => false),
    waitMs: 200,
  });
  return { result, killed, removed, recorded };
}

describe("the sweep of orphaned plugin renderers", () => {
  it("does nothing, and says nothing, when the last session closed every renderer", async () => {
    const { result, killed, recorded } = sweep(undefined, []);

    await expect(result).resolves.toMatchObject({ recorded: 0, ended: 0 });
    expect(killed).toEqual([]);
    expect(recorded).toEqual([]);
  });

  it("ends a recorded renderer still running, and nothing that took a freed id", async () => {
    const { result, killed, removed, recorded } = sweep(
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
    expect(removed).toHaveLength(1);
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

    record.add({ pid: 11, pluginId: "jira", createdAt: STARTED });
    record.add({ pid: 12, pluginId: "github" });
    expect(JSON.parse(await readFile(filePath, "utf8"))).toEqual({
      version: 1,
      processes: [
        { pid: 11, pluginId: "jira", createdAt: STARTED },
        { pid: 12, pluginId: "github" },
      ],
    });

    record.remove(11);
    record.remove(12);
    expect(existsSync(filePath)).toBe(false);
  });
});
