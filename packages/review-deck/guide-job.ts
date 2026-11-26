// Entry point: the messages between Ajour and `guide-worker.ts`, the worker thread that runs the pipeline on one
// pull request at a time (#782), then the summary's rules (#789). It imports only types, so a caller that starts
// the worker by its URL never loads the pipeline itself.
import type { RuleKind, RuleSummary } from "./summary.ts";

/** A job for the worker: the diff `buildDiff` wrote, and both versions of each file. */
export interface GuideJob {
  id: number;
  diff: string;
  /** Each file's base version, by its base path. */
  old: Map<string, string>;
  /** Each file's head version, by its head path. */
  new: Map<string, string>;
}

/** A group of the pipeline's result, in reading order, with the kinds of change the rules found in it. */
export interface GuideJobConcern {
  id: string;
  title: string;
  rationale: string;
  hunkIds: string[];
  kinds: RuleKind[];
}

/** What the worker built: the concerns in reading order, and the summary's rule-based lines. */
export interface GuideJobBuilt {
  concerns: GuideJobConcern[];
  summary: RuleSummary;
}

/** The worker's answer to a job: what it built, or why it failed. */
export type GuideJobResult =
  ({ id: number } & GuideJobBuilt) | { id: number; error: string };

/** The worker thread's module, beside this file. */
export const GUIDE_WORKER_URL = new URL("./guide-worker.ts", import.meta.url);
