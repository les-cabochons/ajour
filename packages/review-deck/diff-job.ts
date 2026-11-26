// Entry point: the messages between Ajour and `diff-worker.ts`, the worker thread that writes a pull request's
// diff with `fileDiff`, one file at a time within its budget, off the local API's main thread (#774's
// council). It imports only types, so a caller that starts the worker by its URL loads no diff code itself.
import type {
  DiffBudget,
  FileChange,
  FileContents,
} from "./review/analysis.ts";

/** A job for the worker: the changed files, both versions of each by its path, and each file's budget. */
export interface DiffJob {
  id: number;
  changes: FileChange[];
  contents: Map<string, FileContents>;
  /**
   * Each file's budget: the most it may take, in milliseconds, and the most lines it may add and remove, which
   * holds only when both its versions have lines: an added, deleted or emptied file costs only its length.
   */
  fileBudget: Required<DiffBudget>;
}

/** A file whose diff passed its budget: its lines in each version, 0 for a version it has none in. */
export interface DiffTooLarge {
  oldLines: number;
  newLines: number;
}

/**
 * What the worker wrote: the diff, each file past its budget written as one too large to read, so it has no
 * hunks, and those files by path.
 */
export interface DiffJobWritten {
  text: string;
  tooLarge: Map<string, DiffTooLarge>;
}

/** The worker's answer to a job: what it wrote, or why it failed. */
export type DiffJobResult =
  ({ id: number } & DiffJobWritten) | { id: number; error: string };

/** The worker thread's module, beside this file. */
export const DIFF_WORKER_URL = new URL("./diff-worker.ts", import.meta.url);
