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
 * 2.5 s, as one hunk, and every request waited behind it. A file whose
 * versions differ by more than `DECK_FILE_MAX_EDIT_LINES` is too large to
 * compare, on every computer alike; `DECK_FILE_DIFF_BUDGET_MS` stops one
 * that takes too long anyway. Opens and preloads have a worker each, so an
 * open never waits behind a preload.
 */

/**
 * The most lines one file's diff may add and remove, both versions having
 * lines. jsdiff's work grows with the square of it: a file with 1,000 lines
 * replaced, 2,000 added and removed, takes about 300 ms and shows its
 * hunks; a rewritten lockfile, 8,000, stops here whatever the computer's
 * speed. An added, deleted or emptied file costs only its length, so has
 * no limit but the clock's.
 */
export const DECK_FILE_MAX_EDIT_LINES = 2_000;

/**
 * The most one file's diff may take, in milliseconds: the backstop for a
 * file under the edit limit that still takes too long, on a slow computer.
 */
export const DECK_FILE_DIFF_BUDGET_MS = 500;

/** One file's diff budget: its time, and its added and removed lines. */
export interface DeckFileBudget {
  timeoutMs: number;
  maxEditLines: number;
}

const FILE_BUDGET: DeckFileBudget = {
  timeoutMs: DECK_FILE_DIFF_BUDGET_MS,
  maxEditLines: DECK_FILE_MAX_EDIT_LINES,
};

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
function workerLane(workerUrl: URL, budget: DeckFileBudget) {
  type Held = { worker: Worker; pending: Pending };
  let current: Held | undefined;
  let idle: NodeJS.Timeout | undefined;
  let nextId = 0;
  /**
   * The worker holding each waiting diff now: a diff moved to a new worker
   * is stopped there.
   */
  const holders = new Map<number, Held>();

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
        fileBudgetMs: budget.timeoutMs,
        fileMaxEditLines: budget.maxEditLines,
      };
      const onAbort = () => {
        const holder = holders.get(id);
        const waiting = holder?.pending.get(id);
        if (!holder || !waiting) return;
        holder.pending.delete(id);
        waiting.reject(new DeckDiffCancelled());
        if (current?.worker !== holder.worker) return;
        // The worker may be writing this diff: end it, and send the
        // diffs behind it to a new one.
        void stop();
        if (!holder.pending.size) return;
        const next = start();
        current = next;
        for (const [queued, entry] of holder.pending) {
          next.pending.set(queued, entry);
          holders.set(queued, next);
          next.worker.postMessage(entry.job);
        }
        holder.pending.clear();
      };
      // A settled diff lets go of the signal, which a caller may reuse.
      const written = new Promise<DiffJobWritten>((resolve, reject) => {
        pending.set(id, { job, resolve, reject });
      }).finally(() => {
        holders.delete(id);
        signal.removeEventListener("abort", onAbort);
      });
      holders.set(id, current);
      worker.postMessage(job);
      signal.addEventListener("abort", onAbort, { once: true });
      return written;
    },
    async close() {
      const ending = current;
      if (ending) failAll(ending.pending, new DeckDiffCancelled());
      await stop();
    },
  };
}

/**
 * Deck's diffs in worker threads, one for opens and one for preloads.
 * `budget` changes a file's budget, for tests.
 */
export function createWorkerDeckDiffs(
  workerUrl = DIFF_WORKER_URL,
  budget: Partial<DeckFileBudget> = {},
): DeckDiffs {
  const fileBudget = { ...FILE_BUDGET, ...budget };
  const lanes = {
    open: workerLane(workerUrl, fileBudget),
    preload: workerLane(workerUrl, fileBudget),
  };
  return {
    write: (changes, contents, lane, signal) =>
      lanes[lane].write(changes, contents, signal),
    async close() {
      await Promise.all([lanes.open.close(), lanes.preload.close()]);
    },
  };
}
