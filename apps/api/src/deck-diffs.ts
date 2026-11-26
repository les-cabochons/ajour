import { Worker } from "node:worker_threads";
import {
  DIFF_WORKER_URL,
  type DiffJob,
  type DiffJobResult,
  type DiffJobWritten,
} from "../../../packages/review-deck/diff-job.ts";
import type {
  FileChange,
  FileContents,
} from "../../../packages/review-deck/diff.ts";

/*
 * Where Deck's diffs are written: in worker threads, never on the local
 * API's main thread (#774's council). jsdiff's work grows with the square
 * of the lines changed: a lockfile of 4,200 lines with 4,000 replaced took
 * 2.5 s, as one hunk, and every request waited behind it. Each file stops
 * at `DECK_FILE_DIFF_BUDGET_MS` and is then too large to compare. Opens and
 * preloads have a worker each, so an open never waits behind a preload.
 */

/**
 * The most one file's diff may take, in milliseconds. A file of 8,000
 * lines with 1,000 scattered changes takes about 400 ms, so it still shows
 * its hunks; a rewritten lockfile stops here instead of after seconds.
 */
export const DECK_FILE_DIFF_BUDGET_MS = 500;

/** A worker idle this long ends. */
const WORKER_IDLE_MS = 2 * 60_000;

/** Which worker writes a diff: an open's, or a preload's. */
export type DeckDiffLane = "open" | "preload";

export interface DeckDiffs {
  write(
    changes: FileChange[],
    contents: Map<string, FileContents>,
    lane: DeckDiffLane,
    signal: AbortSignal,
  ): Promise<DiffJobWritten>;
  close(): Promise<void>;
}

/** A diff stopped because nobody waits for it anymore. */
export class DeckDiffCancelled extends Error {
  constructor() {
    super("The diff was cancelled.");
  }
}

type Pending = Map<
  number,
  {
    job: DiffJob;
    resolve: (written: DiffJobWritten) => void;
    reject: (error: Error) => void;
  }
>;

/**
 * One worker thread: it starts with the first diff, stays for the next
 * ones, and ends after a while idle. A stopped diff ends it, since a file's
 * diff can't stop halfway, and the diffs queued behind it go to a new one.
 * Each worker answers only its own jobs.
 */
function workerLane(workerUrl: URL) {
  let current: { worker: Worker; pending: Pending } | undefined;
  let idle: NodeJS.Timeout | undefined;
  let nextId = 0;

  const failAll = (pending: Pending, error: Error) => {
    for (const job of pending.values()) job.reject(error);
    pending.clear();
  };
  const stop = () => {
    clearTimeout(idle);
    const ending = current;
    current = undefined;
    return ending?.worker.terminate();
  };
  const start = () => {
    const worker = new Worker(workerUrl);
    const pending: Pending = new Map();
    // A diff never keeps the process alive.
    worker.unref();
    worker.on("message", (result: DiffJobResult) => {
      const job = pending.get(result.id);
      if (!job) return;
      pending.delete(result.id);
      if ("error" in result) job.reject(new Error(result.error));
      else job.resolve({ text: result.text, tooLarge: result.tooLarge });
      if (!pending.size && current?.worker === worker) {
        clearTimeout(idle);
        idle = setTimeout(() => void stop(), WORKER_IDLE_MS);
        idle.unref();
      }
    });
    const ended = (error: Error) => {
      if (current?.worker === worker) current = undefined;
      failAll(pending, error);
    };
    worker.on("error", ended);
    worker.on("exit", () => ended(new Error("The diff worker stopped.")));
    return { worker, pending };
  };

  return {
    write(
      changes: FileChange[],
      contents: Map<string, FileContents>,
      signal: AbortSignal,
    ) {
      if (signal.aborted) return Promise.reject(new DeckDiffCancelled());
      clearTimeout(idle);
      current ??= start();
      const { worker, pending } = current;
      const id = ++nextId;
      const job: DiffJob = {
        id,
        changes,
        contents,
        fileBudgetMs: DECK_FILE_DIFF_BUDGET_MS,
      };
      const written = new Promise<DiffJobWritten>((resolve, reject) => {
        pending.set(id, { job, resolve, reject });
      });
      worker.postMessage(job);
      signal.addEventListener(
        "abort",
        () => {
          const waiting = pending.get(id);
          if (!waiting) return;
          pending.delete(id);
          waiting.reject(new DeckDiffCancelled());
          if (current?.worker !== worker) return;
          // The worker may be writing this diff: end it, and send the
          // diffs behind it to a new one.
          void stop();
          if (!pending.size) return;
          current = start();
          for (const [queued, entry] of pending) {
            current.pending.set(queued, entry);
            current.worker.postMessage(entry.job);
          }
          pending.clear();
        },
        { once: true },
      );
      return written;
    },
    async close() {
      const ending = current;
      if (ending) failAll(ending.pending, new DeckDiffCancelled());
      await stop();
    },
  };
}

/** Deck's diffs in worker threads, one for opens and one for preloads. */
export function createWorkerDeckDiffs(workerUrl = DIFF_WORKER_URL): DeckDiffs {
  const lanes = {
    open: workerLane(workerUrl),
    preload: workerLane(workerUrl),
  };
  return {
    write: (changes, contents, lane, signal) =>
      lanes[lane].write(changes, contents, signal),
    async close() {
      await Promise.all([lanes.open.close(), lanes.preload.close()]);
    },
  };
}
