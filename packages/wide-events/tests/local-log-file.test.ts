import { readFileSync } from "node:fs";
import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { catalog } from "../catalog.ts";
import { createEmitter } from "../index.ts";
import {
  createLocalLogFile,
  type LocalLogFileSystem,
  type LocalLogSettings,
} from "../local-log-file.ts";
import { apiContext } from "./fixtures.ts";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});

const ON: LocalLogSettings = {
  enabled: true,
  retention_days: 7,
  size_limit_mb: 250,
  include_sensitive: false,
};
const MIB = 1024 * 1024;

async function temporaryFolder() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ajour-local-logs-"));
  temporaryDirectories.push(root);
  return root;
}

/**
 * A local log file in a temporary user data folder, with a clock the test
 * moves, and the real catalog's emitter writing to it.
 */
async function logFile({
  settings = ON,
  at = "2026-10-26T12:00:00.000Z",
  fileSystem,
}: {
  settings?: Partial<LocalLogSettings>;
  at?: string;
  fileSystem?: LocalLogFileSystem;
} = {}) {
  const root = await temporaryFolder();
  const directory = path.join(root, "logs", "events");
  let time = Date.parse(at);
  const file = createLocalLogFile({
    directory,
    catalog,
    settings: { ...ON, ...settings },
    now: () => time,
    ...(fileSystem ? { fs: fileSystem } : {}),
  });
  const events = createEmitter({
    catalog,
    context: apiContext,
    sink: file.sink,
    now: () => time,
  });
  return {
    root,
    directory,
    file,
    events,
    setTime: (next: string) => {
      time = Date.parse(next);
    },
    lines: async (day: string) =>
      (await fs.readFile(path.join(directory, `${day}.ndjson`), "utf8"))
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Record<string, unknown>),
  };
}

/** Writes a day file of `bytes` bytes, without filling the disk for it. */
async function dayFile(directory: string, day: string, bytes = 10) {
  await fs.mkdir(directory, { recursive: true });
  const file = path.join(directory, `${day}.ndjson`);
  await fs.writeFile(file, "{}\n");
  await fs.truncate(file, bytes);
}

async function dayFiles(directory: string) {
  return (await fs.readdir(directory)).sort();
}

function sync(events: Awaited<ReturnType<typeof logFile>>["events"]) {
  return events.run("backlog.sync", { kind: "job", trigger: "user" }, () => 7);
}

/** A file system whose appends fail with `code` until it heals. */
function failingFs(code: string) {
  let failing = true;
  const appendFile = vi.fn(
    async (...args: Parameters<LocalLogFileSystem["appendFile"]>) => {
      if (failing) {
        throw Object.assign(new Error(`${code}: simulated`), { code });
      }
      await fs.appendFile(...args);
    },
  );
  const fileSystem: LocalLogFileSystem = {
    mkdir: fs.mkdir,
    readdir: fs.readdir,
    stat: fs.stat,
    unlink: fs.unlink,
    rmdir: fs.rmdir,
    appendFile,
  };
  return {
    fileSystem,
    appendFile,
    heal: () => {
      failing = false;
    },
  };
}

describe("the local log file", () => {
  it("writes one JSON line per event, in the file of the UTC day it was emitted", async () => {
    const log = await logFile({ at: "2026-10-26T23:59:59.900Z" });

    sync(log.events);
    log.setTime("2026-10-27T00:00:00.100Z");
    sync(log.events);
    sync(log.events);
    await log.file.flush();

    expect(await dayFiles(log.directory)).toEqual([
      "2026-10-26.ndjson",
      "2026-10-27.ndjson",
    ]);
    expect(await log.lines("2026-10-26")).toMatchObject([
      { name: "backlog.sync", runtime: "api", outcome: "ok" },
    ]);
    expect(await log.lines("2026-10-27")).toHaveLength(2);
  });

  it("queues each event and writes the queue in one batch, after a short delay", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const log = await logFile();

    sync(log.events);
    sync(log.events);
    expect(await log.file.status()).toMatchObject({ file_count: 0 });

    vi.advanceTimersByTime(250);
    expect(await log.file.status()).toMatchObject({
      state: "on",
      file_count: 1,
    });
    expect(await log.lines("2026-10-26")).toHaveLength(2);
  });

  it("creates no file and no folder while off, which is the default", async () => {
    const log = await logFile({ settings: { enabled: false } });

    sync(log.events);
    await log.file.flush();
    await log.file.sweep();

    expect(await log.file.status()).toEqual({
      state: "off",
      storage_bytes: 0,
      dropped_event_count: 0,
      file_count: 0,
    });
    await expect(fs.readdir(log.root)).resolves.toEqual([]);
  });

  it("starts writing when turned on, and stops when turned off", async () => {
    const log = await logFile({ settings: { enabled: false } });

    log.file.configure(ON);
    sync(log.events);
    log.file.configure({ ...ON, enabled: false });
    sync(log.events);
    await log.file.flush();
    log.file.configure(ON);
    sync(log.events);
    await log.file.flush();

    expect(await log.lines("2026-10-26")).toHaveLength(1);
  });

  describe("sensitive fields", () => {
    async function writeFailedUpdate(includeSensitive: boolean) {
      const log = await logFile({
        settings: { include_sensitive: includeSensitive },
      });
      log.events.run(
        "time_entry.update",
        { kind: "command", trigger: "user" },
        (unit) => {
          unit.set({
            time_entry: {
              id: "entry-1",
              duration_before_ms: 60_000,
              duration_after_ms: 90_000,
            },
          });
          unit.fail(new Error("Could not save the entry"));
        },
      );
      await log.file.flush();
      const [line] = await log.lines("2026-10-26");
      return line!;
    }

    it("writes no sensitive field and no error message while they are off", async () => {
      const line = await writeFailedUpdate(false);

      expect(line).toMatchObject({
        name: "time_entry.update",
        outcome: "error",
        time_entry: { id: "entry-1" },
        error: { type: "Error" },
      });
      expect(line.time_entry).toEqual({ id: "entry-1" });
      expect(line.error).toEqual({ type: "Error" });
    });

    it("writes both once the user allows them for this sink", async () => {
      const line = await writeFailedUpdate(true);

      expect(line).toMatchObject({
        time_entry: {
          id: "entry-1",
          duration_before_ms: 60_000,
          duration_after_ms: 90_000,
        },
        error: { type: "Error", message: "Could not save the entry" },
      });
    });
  });

  describe("the retention sweep", () => {
    it("deletes a day's file once the day ended more than the retention ago, on UTC days", async () => {
      const log = await logFile({
        settings: { retention_days: 1 },
        at: "2026-10-26T23:59:59.999Z",
      });
      for (const day of ["2026-10-24", "2026-10-25", "2026-10-26"]) {
        await dayFile(log.directory, day);
      }

      expect(await log.file.sweep()).toEqual({
        deleted_file_count: 1,
        deleted_bytes: 10,
        file_count: 2,
        storage_bytes: 20,
        dropped_event_count: 0,
      });
      expect(await dayFiles(log.directory)).toEqual([
        "2026-10-25.ndjson",
        "2026-10-26.ndjson",
      ]);

      log.setTime("2026-10-27T00:00:00.000Z");
      await log.file.sweep();
      expect(await dayFiles(log.directory)).toEqual(["2026-10-26.ndjson"]);
    });

    it("then deletes the oldest days until the folder is under the size limit", async () => {
      const log = await logFile({
        settings: { retention_days: 90, size_limit_mb: 100 },
      });
      for (const day of [
        "2026-10-23",
        "2026-10-24",
        "2026-10-25",
        "2026-10-26",
      ]) {
        await dayFile(log.directory, day, 40 * MIB);
      }

      expect(await log.file.sweep()).toEqual({
        deleted_file_count: 2,
        deleted_bytes: 80 * MIB,
        file_count: 2,
        storage_bytes: 80 * MIB,
        dropped_event_count: 0,
      });
      expect(await dayFiles(log.directory)).toEqual([
        "2026-10-25.ndjson",
        "2026-10-26.ndjson",
      ]);
    });

    it("applies the age first, then the size", async () => {
      const log = await logFile({
        settings: { retention_days: 1, size_limit_mb: 100 },
      });
      await dayFile(log.directory, "2026-10-20", 10);
      await dayFile(log.directory, "2026-10-25", 60 * MIB);
      await dayFile(log.directory, "2026-10-26", 60 * MIB);

      await log.file.sweep();

      expect(await dayFiles(log.directory)).toEqual(["2026-10-26.ndjson"]);
    });

    it("never deletes today's file, even past the size limit", async () => {
      const log = await logFile({ settings: { size_limit_mb: 100 } });
      await dayFile(log.directory, "2026-10-26", 120 * MIB);

      expect(await log.file.sweep()).toMatchObject({ deleted_file_count: 0 });
      expect(await dayFiles(log.directory)).toEqual(["2026-10-26.ndjson"]);
    });

    it("never deletes a day that still has events waiting to be written", async () => {
      const log = await logFile({ settings: { retention_days: 1 } });
      sync(log.events);
      await log.file.flush();
      sync(log.events);

      log.setTime("2026-10-29T12:00:00.000Z");
      await log.file.sweep();
      await log.file.flush();

      expect(await log.lines("2026-10-26")).toHaveLength(2);
    });

    it("does nothing, and creates nothing, when the folder is missing", async () => {
      const log = await logFile();

      expect(await log.file.sweep()).toEqual({
        deleted_file_count: 0,
        deleted_bytes: 0,
        file_count: 0,
        storage_bytes: 0,
        dropped_event_count: 0,
      });
      await expect(fs.readdir(log.root)).resolves.toEqual([]);
    });

    it("leaves alone what isn't a day file, and a folder that is a file", async () => {
      const log = await logFile({ settings: { retention_days: 1 } });
      await dayFile(log.directory, "2026-01-01");
      await fs.writeFile(path.join(log.directory, "notes.txt"), "keep");
      await fs.writeFile(path.join(log.directory, "2026-13-45.ndjson"), "x");
      await fs.writeFile(
        path.join(log.directory, "2026-01-02.ndjson.tmp"),
        "x",
      );
      await fs.mkdir(path.join(log.directory, "2026-01-03.ndjson"));

      expect(await log.file.sweep()).toMatchObject({ deleted_file_count: 1 });
      expect(await dayFiles(log.directory)).toEqual([
        "2026-01-02.ndjson.tmp",
        "2026-01-03.ndjson",
        "2026-13-45.ndjson",
        "notes.txt",
      ]);

      const corrupt = await logFile();
      await fs.mkdir(path.dirname(corrupt.directory), { recursive: true });
      await fs.writeFile(corrupt.directory, "not a folder");
      await expect(corrupt.file.sweep()).resolves.toMatchObject({
        file_count: 0,
      });
      await expect(corrupt.file.status()).resolves.toMatchObject({
        state: "on",
        file_count: 0,
      });
    });
  });

  describe("a write that fails", () => {
    /** The real file system, but `appendFile` fails with `code` until `heal`. */

    it.each([
      ["ENOSPC", "disk_full"],
      ["EDQUOT", "disk_full"],
      ["EACCES", "no_permission"],
      ["EPERM", "no_permission"],
      ["EIO", "write_failed"],
    ])(
      "stops writing on %s and keeps the warning %s, while the work's result stays",
      async (code, warning) => {
        const disk = failingFs(code);
        const log = await logFile({ fileSystem: disk.fileSystem });

        expect(sync(log.events)).toBe(7);
        await log.file.flush();
        expect(sync(log.events)).toBe(7);
        await log.file.flush();

        expect(disk.appendFile).toHaveBeenCalledOnce();
        expect(log.file.sink.accepting?.()).toBe(false);
        expect(await log.file.status()).toMatchObject({
          state: "warning",
          warning,
        });
      },
    );

    it("never throws into the work, nor makes it async", async () => {
      const disk = failingFs("ENOSPC");
      const log = await logFile({ fileSystem: disk.fileSystem });

      const result = log.events.run(
        "backlog.sync",
        { kind: "job", trigger: "user" },
        () => "done",
      );
      const failed = log.events.run(
        "backlog.sync",
        { kind: "job", trigger: "user" },
        async () => {
          throw new Error("the work's own failure");
        },
      );

      expect(result).toBe("done");
      await expect(failed).rejects.toThrow("the work's own failure");
      await log.file.flush();
      expect(await log.file.status()).toMatchObject({ warning: "disk_full" });
    });

    it("resumes once the settings are saved again", async () => {
      const disk = failingFs("ENOSPC");
      const log = await logFile({ fileSystem: disk.fileSystem });
      sync(log.events);
      await log.file.flush();

      disk.heal();
      log.file.configure(ON);
      sync(log.events);
      await log.file.flush();

      expect(await log.file.status()).toMatchObject({ state: "on" });
      expect(await log.lines("2026-10-26")).toHaveLength(1);
    });

    it("stops when the folder can't be made, as when its path is a file", async () => {
      const log = await logFile();
      await fs.mkdir(path.dirname(log.directory), { recursive: true });
      await fs.writeFile(log.directory, "not a folder");

      sync(log.events);
      await log.file.flush();

      expect(await log.file.status()).toMatchObject({
        state: "warning",
        warning: "write_failed",
      });
    });
  });

  it("reports what the folder holds: the bytes, the files and the oldest day", async () => {
    const log = await logFile();
    await dayFile(log.directory, "2026-10-24", 30);
    await dayFile(log.directory, "2026-10-25", 12);

    expect(await log.file.status()).toEqual({
      state: "on",
      storage_bytes: 42,
      file_count: 2,
      oldest_day: "2026-10-24",
      dropped_event_count: 0,
    });
  });

  it("deletes all logs: every day file and what was waiting to be written, then the empty folder", async () => {
    const log = await logFile();
    await dayFile(log.directory, "2026-10-24", 30);
    sync(log.events);

    expect(await log.file.deleteAll()).toEqual({
      deleted_file_count: 1,
      deleted_bytes: 30,
    });
    await log.file.flush();

    await expect(fs.readdir(path.dirname(log.directory))).resolves.toEqual([]);
    sync(log.events);
    await log.file.flush();
    expect(await log.lines("2026-10-26")).toHaveLength(1);
  });

  it("deletes only day files when something else is in the folder, and counts exactly those", async () => {
    const log = await logFile();
    await dayFile(log.directory, "2026-10-24", 30);
    await dayFile(log.directory, "2026-10-25", 12);
    await fs.writeFile(path.join(log.directory, "notes.txt"), "keep");

    expect(await log.file.deleteAll()).toEqual({
      deleted_file_count: 2,
      deleted_bytes: 42,
    });

    expect(await dayFiles(log.directory)).toEqual(["notes.txt"]);
  });

  it("counts the events it drops when too many wait to be written", async () => {
    const log = await logFile();

    for (let count = 0; count < 10_003; count += 1) sync(log.events);
    expect(await log.file.status()).toMatchObject({ dropped_event_count: 3 });
    await log.file.flush();

    expect(await log.lines("2026-10-26")).toHaveLength(10_000);
    expect(await log.file.status()).toMatchObject({ dropped_event_count: 3 });
  });

  describe("whether it is writing", () => {
    it("tells its listeners when a failed write stops it, and when saving the settings resumes or turns it off", async () => {
      const disk = failingFs("ENOSPC");
      const log = await logFile({ fileSystem: disk.fileSystem });
      const changes: boolean[] = [];
      const stop = log.file.onWritingChange((writing) => changes.push(writing));
      expect(log.file.writing()).toBe(true);

      sync(log.events);
      await log.file.flush();
      disk.heal();
      log.file.configure(ON);
      log.file.configure(ON);
      log.file.configure({ ...ON, enabled: false });
      stop();
      log.file.configure(ON);

      expect(changes).toEqual([false, true, false]);
    });

    it("is not stopped by a listener that throws", async () => {
      const log = await logFile({ settings: { enabled: false } });
      const changes: boolean[] = [];
      log.file.onWritingChange(() => {
        throw new Error("The window is gone.");
      });
      log.file.onWritingChange((writing) => changes.push(writing));

      expect(() => log.file.configure(ON)).not.toThrow();

      expect(changes).toEqual([true]);
      expect(log.file.writing()).toBe(true);
    });
  });

  describe("a batch another process forwarded", () => {
    const FROM = { runtime: "renderer", launch_id: "launch-1" } as const;

    /** A renderer event, as the renderer's forwarding sink sends it. */
    const rendererEvent = (fields: Record<string, unknown> = {}) => ({
      schema: 1,
      name: "time_entry.update",
      kind: "command",
      runtime: "renderer",
      outcome: "ok",
      started_at: "2026-10-26T11:59:59.000Z",
      duration_ms: 3,
      trace_id: "0af7651916cd43dd8448eb211c80319c",
      span_id: "b7ad6b7169203331",
      launch_id: "launch-1",
      window_id: "6f9c1b6e-8a51-4c2e-9d7e-2b4f0f3c1a10",
      trigger: "user",
      app: { version: "1.2.3", channel: "stable", packaged: true },
      device: { platform: "win32" },
      ...fields,
    });

    it("writes the valid events, through the privacy filter, and says what it left out", async () => {
      const log = await logFile();

      const result = log.file.forward(
        {
          events: [
            rendererEvent({
              time_entry: {
                id: "entry-1",
                duration_ms: 1800000,
                note: "Ada's notes",
              },
              steps: ["time_entry.update", { path: "C:\Users\ada" }],
              counts: { store_write_count: 1, "C:\Users\ada": 2 },
              extra: { secret: "y" },
            }),
            rendererEvent({ runtime: "main" }),
          ],
          unsent_event_count: 2,
        },
        FROM,
      );
      await log.file.flush();

      expect(result).toEqual({
        accepted_event_count: 1,
        dropped_event_count: 0,
        rejected_event_count: 1,
        rejected_batch_count: 0,
        unsent_event_count: 2,
      });
      const [line, ...rest] = await log.lines("2026-10-26");
      expect(rest).toEqual([]);
      expect(line).toMatchObject({
        name: "time_entry.update",
        runtime: "renderer",
        trace_id: "0af7651916cd43dd8448eb211c80319c",
        launch_id: "launch-1",
        time_entry: { id: "entry-1" },
        counts: { store_write_count: 1 },
      });
      // Undeclared fields, a sensitive one the user didn't allow, and
      // values of the wrong shape are dropped.
      expect(line).not.toHaveProperty("extra");
      expect(line).not.toHaveProperty("steps");
      expect(line!.time_entry).toEqual({ id: "entry-1" });
      expect(JSON.stringify(line)).not.toMatch(/Ada|Users/);
    });

    it("writes nothing while logging is off, and creates nothing", async () => {
      const log = await logFile({ settings: { enabled: false } });

      log.file.forward({ events: [rendererEvent()] }, FROM);
      await log.file.flush();

      await expect(fs.readdir(log.root)).resolves.toEqual([]);
    });

    it("keeps the queue's limit, however many batches arrive", async () => {
      const log = await logFile();
      const batch = {
        events: Array.from({ length: 100 }, () => rendererEvent()),
      };

      for (let count = 0; count < 101; count += 1) {
        log.file.forward(batch, FROM);
      }

      expect(await log.file.status()).toMatchObject({
        dropped_event_count: 100,
      });
      await log.file.flush();
      expect(await log.lines("2026-10-26")).toHaveLength(10_000);
    });

    it("counts the events it queued apart from those it dropped for a full queue", async () => {
      const log = await logFile();
      const full = {
        events: Array.from({ length: 100 }, () => rendererEvent()),
      };
      for (let count = 0; count < 99; count += 1) log.file.forward(full, FROM);

      expect(
        log.file.forward({ events: full.events.slice(0, 60) }, FROM),
      ).toMatchObject({
        accepted_event_count: 60,
        dropped_event_count: 0,
      });
      // 9,900 + 60 queued: 40 more fit, the other 20 are dropped.
      expect(
        log.file.forward({ events: full.events.slice(0, 60) }, FROM),
      ).toMatchObject({
        accepted_event_count: 40,
        dropped_event_count: 20,
      });
      expect(await log.file.status()).toMatchObject({
        dropped_event_count: 20,
      });
    });

    it("counts them as dropped, not accepted, once writing stopped on a warning", async () => {
      const disk = failingFs("ENOSPC");
      const log = await logFile({ fileSystem: disk.fileSystem });
      sync(log.events);
      await log.file.flush();
      expect(log.file.writing()).toBe(false);

      expect(
        log.file.forward({ events: [rendererEvent()] }, FROM),
      ).toMatchObject({
        accepted_event_count: 0,
        dropped_event_count: 1,
      });
    });

    it("counts a batch refused whole, and an event the renderer doesn't emit", async () => {
      const log = await logFile();

      expect(
        log.file.forward(
          { events: Array.from({ length: 101 }, () => rendererEvent()) },
          FROM,
        ),
      ).toMatchObject({
        accepted_event_count: 0,
        rejected_event_count: 101,
        rejected_batch_count: 1,
      });
      expect(
        log.file.forward(
          {
            events: [
              rendererEvent({ name: "app.launch", kind: "lifecycle" }),
              rendererEvent({ name: "logs.sweep", kind: "job" }),
            ],
          },
          FROM,
        ),
      ).toMatchObject({ accepted_event_count: 0, rejected_event_count: 2 });
      await log.file.flush();
      await expect(fs.readdir(log.root)).resolves.toEqual([]);
    });

    it("never throws, whatever it is given", async () => {
      const log = await logFile();

      for (const batch of [undefined, 7, { events: [Symbol("x")] }]) {
        expect(log.file.forward(batch, FROM)).toMatchObject({
          accepted_event_count: 0,
        });
      }
    });
  });

  describe("draining at quit", () => {
    it("writes what is waiting, synchronously, before the batch timer would", async () => {
      const log = await logFile();

      sync(log.events);
      log.file.drainSync();

      // No await between the event and the file: nothing else ran.
      expect(
        readFileSync(path.join(log.directory, "2026-10-26.ndjson"), "utf8")
          .split("\n")
          .filter(Boolean),
      ).toHaveLength(1);
      await log.file.flush();
      expect(await log.lines("2026-10-26")).toHaveLength(1);
    });

    it("writes the privacy filter's output, with sensitive fields only when allowed", async () => {
      for (const includeSensitive of [false, true]) {
        const log = await logFile({
          settings: { include_sensitive: includeSensitive },
        });

        log.events.run(
          "time_entry.create",
          { kind: "command", trigger: "user" },
          (unit) =>
            unit.set({ time_entry: { id: "entry-1", day: "2026-10-06" } }),
        );
        log.file.drainSync();

        const [line] = await log.lines("2026-10-26");
        expect(line!.time_entry).toEqual(
          includeSensitive
            ? { id: "entry-1", day: "2026-10-06" }
            : { id: "entry-1" },
        );
      }
    });

    it("writes nothing while logging is off or after a failure, and creates nothing", async () => {
      const off = await logFile({ settings: { enabled: false } });
      sync(off.events);
      off.file.drainSync();
      await expect(fs.readdir(off.root)).resolves.toEqual([]);

      const disk = await logFile();
      sync(disk.events);
      await fs.mkdir(path.dirname(disk.directory), { recursive: true });
      await fs.writeFile(disk.directory, "not a folder");
      expect(() => disk.file.drainSync()).not.toThrow();
      expect(await disk.file.status()).toMatchObject({
        state: "warning",
        warning: "write_failed",
      });
      sync(disk.events);
      disk.file.drainSync();
      expect(disk.file.sink.accepting?.()).toBe(false);
    });

    it("never throws, and stops with a warning when the write fails", async () => {
      const failing = await logFile({
        fileSystem: {
          mkdir: fs.mkdir,
          readdir: fs.readdir,
          stat: fs.stat,
          unlink: fs.unlink,
          rmdir: fs.rmdir,
          appendFile: fs.appendFile,
          appendFileSync() {
            throw Object.assign(new Error("ENOSPC: simulated"), {
              code: "ENOSPC",
            });
          },
        },
      });

      sync(failing.events);

      expect(() => failing.file.drainSync()).not.toThrow();
      expect(await failing.file.status()).toMatchObject({
        state: "warning",
        warning: "disk_full",
      });
    });

    it("keeps the newest events within its byte budget", async () => {
      const log = await logFile();
      const big = "x".repeat(100_000);

      for (let count = 0; count < 30; count += 1) {
        log.events.run(
          "backlog.sync",
          { kind: "job", trigger: "user" },
          (unit) => {
            unit.set({ plugin: { id: `${count}-${big}` } });
          },
        );
      }
      log.file.drainSync();

      const lines = await log.lines("2026-10-26");
      expect(lines.length).toBeGreaterThan(0);
      expect(lines.length).toBeLessThan(30);
      const last = (lines.at(-1)!.plugin as { id: string }).id;
      expect(last.startsWith("29-")).toBe(true);
    });

    describe("while an async write is still waiting", () => {
      /** A file system whose appendFile waits for `release`, then resolves or rejects. */
      function gatedFileSystem() {
        let release!: (error?: Error) => void;
        const gate = new Promise<void>((resolve, reject) => {
          release = (error) => (error ? reject(error) : resolve());
        });
        const appends: string[] = [];
        const fileSystem: LocalLogFileSystem = {
          mkdir: fs.mkdir,
          readdir: fs.readdir,
          stat: fs.stat,
          unlink: fs.unlink,
          rmdir: fs.rmdir,
          async appendFile(file, data) {
            appends.push(data);
            // The process is exiting: the write never lands once released.
            await gate;
          },
        };
        return { fileSystem, release, appends };
      }

      function emitNamed(
        events: Awaited<ReturnType<typeof logFile>>["events"],
        id: string,
      ) {
        events.run("backlog.sync", { kind: "job", trigger: "user" }, (unit) => {
          unit.set({ plugin: { id } });
        });
      }

      const ids = async (log: Awaited<ReturnType<typeof logFile>>) =>
        (await log.lines("2026-10-26")).map(
          (line) => (line.plugin as { id: string }).id,
        );

      it.each([
        { outcome: "resolves", error: undefined },
        { outcome: "rejects", error: new Error("late") },
      ])(
        "writes the batch it is appending first, once, and the async write $outcome without repeating it or warning",
        async ({ error }) => {
          const gated = gatedFileSystem();
          const log = await logFile({ fileSystem: gated.fileSystem });

          emitNamed(log.events, "first");
          const flushed = log.file.flush();
          // Lets the write reach the gated append.
          await vi.waitFor(() => expect(gated.appends).toHaveLength(1));
          emitNamed(log.events, "second");
          log.file.drainSync();

          expect(await ids(log)).toEqual(["first", "second"]);

          gated.release(error);
          await flushed;

          expect(await ids(log)).toEqual(["first", "second"]);
          expect(gated.appends).toHaveLength(1);
          expect(await log.file.status()).toMatchObject({ state: "on" });
        },
      );
    });
  });
});
