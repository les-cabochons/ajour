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
        rm: fs.rm,
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
    });
  });

  it("deletes all logs: the folder, and what was waiting to be written", async () => {
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
});
