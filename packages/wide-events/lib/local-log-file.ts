import { appendFileSync, mkdirSync } from "node:fs";
import * as nodeFs from "node:fs/promises";
import path from "node:path";
import type { LocalLogState, LocalLogWarning } from "./ajour-catalog.ts";
import type { Catalog } from "./fields.ts";
import { createPrivacyFilter } from "./privacy.ts";
import type { Sink } from "./sinks.ts";

/** How many days a day's file is kept after it ends. */
export type LocalLogRetentionDays = 1 | 7 | 30 | 90;

/** The most the folder may hold, in MiB, before its oldest days go. */
export type LocalLogSizeLimitMb = 100 | 250 | 1000;

/** What the user chose for the local log file. The main process stores it. */
export interface LocalLogSettings {
  enabled: boolean;
  retention_days: LocalLogRetentionDays;
  size_limit_mb: LocalLogSizeLimitMb;
  /** Whether this sink receives the catalog's sensitive fields. */
  include_sensitive: boolean;
}

export type { LocalLogState, LocalLogWarning };

/** What the settings page shows: whether it writes, and what the folder holds. */
export interface LocalLogStatus {
  /** `warning`: on, but writing stopped until the settings are saved again or the next launch. */
  state: LocalLogState;
  /** Why writing stopped: the disk is full, Ajour may not write in the folder, or another error. */
  warning?: LocalLogWarning;
  /** The day files' bytes. */
  storage_bytes: number;
  file_count: number;
  /** The oldest day file's UTC day, `YYYY-MM-DD`. */
  oldest_day?: string;
  /**
   * Events dropped since launch because too many were waiting to be written
   * (see `MAX_PENDING_LINES`) or too many were left at quit.
   */
  dropped_event_count: number;
}

/** What a retention sweep deleted, and what the folder holds after it. */
export interface LocalLogSweep {
  deleted_file_count: number;
  deleted_bytes: number;
  file_count: number;
  storage_bytes: number;
  /** Events dropped since launch, as in `LocalLogStatus`. */
  dropped_event_count: number;
}

/** What deleting every log removed. */
export interface LocalLogDeletion {
  deleted_file_count: number;
  deleted_bytes: number;
}

/** The part of `node:fs/promises` the log file uses. Tests pass one that fails. */
export interface LocalLogFileSystem {
  mkdir(
    directory: string,
    options: { recursive: true; mode?: number },
  ): Promise<unknown>;
  appendFile(
    file: string,
    data: string,
    options: { encoding: "utf8"; mode?: number },
  ): Promise<void>;
  readdir(
    directory: string,
    options: { withFileTypes: true },
  ): Promise<{ name: string; isFile(): boolean }[]>;
  stat(file: string): Promise<{ size: number }>;
  unlink(file: string): Promise<void>;
  /** Removes a folder only when it is empty. */
  rmdir(directory: string): Promise<void>;
  /** For the last write at quit; a file system without them uses the real ones. */
  mkdirSync?(
    directory: string,
    options: { recursive: true; mode?: number },
  ): unknown;
  appendFileSync?(
    file: string,
    data: string,
    options: { encoding: "utf8"; mode?: number },
  ): void;
}

export interface LocalLogFileOptions {
  /** The folder of day files: `userData/logs/events` on desktop. */
  directory: string;
  /** Where each field's privacy class comes from. */
  catalog: Catalog;
  settings: LocalLogSettings;
  fs?: LocalLogFileSystem;
  /** Epoch milliseconds. Tests pass a fake clock. */
  now?: () => number;
}

/**
 * The local log file: the sink, and the folder it writes. Every method
 * runs after the writes queued before it, so a sweep or a deletion never
 * races a write.
 */
export interface LocalLogFile {
  readonly sink: Sink;
  readonly directory: string;
  /** Applies new settings. Saving them clears a warning, so writing resumes when on. */
  configure(settings: LocalLogSettings): void;
  status(): Promise<LocalLogStatus>;
  /** Deletes the days past the retention, then the oldest past the size limit. */
  sweep(): Promise<LocalLogSweep>;
  /**
   * Deletes every day file, and what was waiting to be written, then the
   * folder when nothing else is in it. A file that isn't a day file stays.
   */
  deleteAll(): Promise<LocalLogDeletion>;
  /** Resolves once every event emitted so far is written, or dropped. */
  flush(): Promise<void>;
  /**
   * Writes what is waiting, synchronously, for a process about to exit: the
   * async writes don't run once it has. Bounded to `MAX_DRAIN_BYTES`, keeping
   * the newest events. It writes only while the file is on and has no
   * warning, and never throws: a failure stops writing, as an async one does.
   */
  drainSync(): void;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const MIB = 1024 * 1024;
/** How long events wait, so they are written in batches. */
const FLUSH_DELAY_MS = 250;
/** The most lines waiting to be written. Past it, events are dropped. */
const MAX_PENDING_LINES = 10_000;
/** The most `drainSync` writes, so a full queue can't hold up a quit. */
const MAX_DRAIN_BYTES = 2 * MIB;
const DAY_FILE = /^(\d{4}-\d{2}-\d{2})\.ndjson$/;

/** The UTC day of an epoch time, `YYYY-MM-DD`. */
function dayOf(time: number) {
  return new Date(time).toISOString().slice(0, 10);
}

/** The day a file name holds, when it is a real day file. */
function dayOfFile(name: string) {
  const day = DAY_FILE.exec(name)?.[1];
  if (!day) return undefined;
  const start = Date.parse(`${day}T00:00:00.000Z`);
  return Number.isFinite(start) && dayOf(start) === day ? day : undefined;
}

function warningOf(error: unknown): LocalLogWarning {
  const code = (error as { code?: unknown } | null)?.code;
  if (code === "ENOSPC" || code === "EDQUOT") return "disk_full";
  if (code === "EACCES" || code === "EPERM" || code === "EROFS") {
    return "no_permission";
  }
  return "write_failed";
}

/**
 * The built-in exporter of the desktop main process (ADR 0014): one NDJSON
 * line per event, in `<directory>/YYYY-MM-DD.ndjson` for the UTC day it was
 * emitted. Each event passes the privacy filter first. `emit` only queues the
 * line: the writes run later, in batches, and never throw into the work. A
 * failed write stops writing, with a warning, until the settings are saved
 * again. Nothing creates the folder until an event is written.
 */
export function createLocalLogFile(options: LocalLogFileOptions): LocalLogFile {
  const { directory, catalog } = options;
  const fs: LocalLogFileSystem = options.fs ?? nodeFs;
  const makeFolderSync = fs.mkdirSync ?? mkdirSync;
  const appendSync = fs.appendFileSync ?? appendFileSync;
  const now = options.now ?? (() => Date.now());
  const filter = createPrivacyFilter(catalog);
  let settings = { ...options.settings };
  let warning: LocalLogWarning | undefined;
  let pending: { day: string; line: string }[] = [];
  let dropped = 0;
  let flushTimer: ReturnType<typeof setTimeout> | undefined;
  let queue: Promise<unknown> = Promise.resolve();

  const writing = () => settings.enabled && warning === undefined;

  /** Runs `job` after every job queued before it. */
  function enqueue<Result>(job: () => Promise<Result>): Promise<Result> {
    const result = queue.then(job);
    queue = result.catch(() => undefined);
    return result;
  }

  function stop(reason: LocalLogWarning) {
    warning = reason;
    pending = [];
  }

  async function writePending() {
    const lines = pending;
    pending = [];
    if (lines.length === 0 || !writing()) return;
    try {
      await fs.mkdir(directory, { recursive: true, mode: 0o700 });
      let start = 0;
      while (start < lines.length) {
        const { day } = lines[start]!;
        let end = start;
        while (end < lines.length && lines[end]!.day === day) end += 1;
        const data = lines
          .slice(start, end)
          .map(({ line }) => `${line}\n`)
          .join("");
        await fs.appendFile(path.join(directory, `${day}.ndjson`), data, {
          encoding: "utf8",
          mode: 0o600,
        });
        start = end;
      }
    } catch (error) {
      stop(warningOf(error));
    }
  }

  function scheduleFlush() {
    if (flushTimer !== undefined) return;
    flushTimer = setTimeout(() => {
      flushTimer = undefined;
      void enqueue(writePending);
    }, FLUSH_DELAY_MS);
    (flushTimer as { unref?: () => void }).unref?.();
  }

  /** The day files, oldest first, with their sizes. A missing or unreadable folder has none. */
  async function days() {
    let entries: { name: string; isFile(): boolean }[];
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch {
      return [];
    }
    const found: { day: string; file: string; bytes: number }[] = [];
    for (const entry of entries) {
      const day = entry.isFile() ? dayOfFile(entry.name) : undefined;
      if (!day) continue;
      const file = path.join(directory, entry.name);
      try {
        found.push({ day, file, bytes: (await fs.stat(file)).size });
      } catch {
        // Gone since the folder was read.
      }
    }
    return found.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
  }

  const sink: Sink = {
    accepting: writing,
    emit(event) {
      if (!writing()) return;
      if (pending.length >= MAX_PENDING_LINES) {
        dropped += 1;
        return;
      }
      let line: string;
      try {
        line = JSON.stringify(
          filter(event, { includeSensitive: settings.include_sensitive }),
        );
      } catch {
        return;
      }
      pending.push({ day: dayOf(now()), line });
      scheduleFlush();
    },
  };

  return {
    sink,
    directory,
    configure(next) {
      settings = { ...next };
      warning = undefined;
      if (!settings.enabled) pending = [];
    },
    status: () =>
      enqueue(async () => {
        const found = await days();
        const status: LocalLogStatus = {
          state: !settings.enabled ? "off" : warning ? "warning" : "on",
          storage_bytes: found.reduce((sum, { bytes }) => sum + bytes, 0),
          file_count: found.length,
          dropped_event_count: dropped,
        };
        if (settings.enabled && warning) status.warning = warning;
        if (found[0]) status.oldest_day = found[0].day;
        return status;
      }),
    sweep: () =>
      enqueue(async () => {
        const time = now();
        // Today's file, and any day still waiting to be written, stay.
        const kept = new Set([dayOf(time), ...pending.map(({ day }) => day)]);
        const retention = settings.retention_days * DAY_MS;
        let deletedFiles = 0;
        let deletedBytes = 0;
        const remove = async (file: string, bytes: number) => {
          try {
            await fs.unlink(file);
            deletedFiles += 1;
            deletedBytes += bytes;
            return true;
          } catch {
            return false;
          }
        };
        const remaining: Awaited<ReturnType<typeof days>> = [];
        for (const found of await days()) {
          const ended = Date.parse(`${found.day}T00:00:00.000Z`) + DAY_MS;
          const expired = !kept.has(found.day) && ended + retention <= time;
          if (!expired || !(await remove(found.file, found.bytes))) {
            remaining.push(found);
          }
        }
        let total = remaining.reduce((sum, { bytes }) => sum + bytes, 0);
        const limit = settings.size_limit_mb * MIB;
        for (const found of [...remaining]) {
          if (total <= limit) break;
          if (kept.has(found.day)) continue;
          if (await remove(found.file, found.bytes)) {
            total -= found.bytes;
            remaining.splice(remaining.indexOf(found), 1);
          }
        }
        return {
          deleted_file_count: deletedFiles,
          deleted_bytes: deletedBytes,
          file_count: remaining.length,
          storage_bytes: total,
          dropped_event_count: dropped,
        };
      }),
    deleteAll: () =>
      enqueue(async () => {
        pending = [];
        let deletedFiles = 0;
        let deletedBytes = 0;
        let failure: unknown;
        for (const found of await days()) {
          try {
            await fs.unlink(found.file);
            deletedFiles += 1;
            deletedBytes += found.bytes;
          } catch (error) {
            // Gone since the folder was read is as good as deleted.
            if ((error as { code?: unknown } | null)?.code !== "ENOENT") {
              failure ??= error;
            }
          }
        }
        if (failure !== undefined) throw failure;
        try {
          // Only an empty folder goes: what isn't a day file stays.
          await fs.rmdir(directory);
        } catch {
          // Missing, or not empty.
        }
        return {
          deleted_file_count: deletedFiles,
          deleted_bytes: deletedBytes,
        };
      }),
    drainSync() {
      try {
        if (flushTimer !== undefined) {
          clearTimeout(flushTimer);
          flushTimer = undefined;
        }
        const lines = pending;
        pending = [];
        if (lines.length === 0 || !writing()) return;
        // The newest lines that fit, in the order they were emitted.
        let bytes = 0;
        let first = lines.length;
        while (first > 0) {
          bytes += Buffer.byteLength(lines[first - 1]!.line) + 1;
          if (bytes > MAX_DRAIN_BYTES) break;
          first -= 1;
        }
        dropped += first;
        makeFolderSync(directory, { recursive: true, mode: 0o700 });
        for (let start = first; start < lines.length;) {
          const { day } = lines[start]!;
          let end = start;
          while (end < lines.length && lines[end]!.day === day) end += 1;
          appendSync(
            path.join(directory, `${day}.ndjson`),
            lines
              .slice(start, end)
              .map(
                ({ line }) => `${line}
`,
              )
              .join(""),
            { encoding: "utf8", mode: 0o600 },
          );
          start = end;
        }
      } catch (error) {
        stop(warningOf(error));
      }
    },
    flush() {
      if (flushTimer !== undefined) {
        clearTimeout(flushTimer);
        flushTimer = undefined;
      }
      return enqueue(writePending);
    },
  };
}
