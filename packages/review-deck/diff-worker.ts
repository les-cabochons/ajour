// Entry point: the worker thread that writes Deck's diffs (#774's council). Ajour starts it by `DIFF_WORKER_URL`
// from `diff-job.ts`. jsdiff's work grows with the square of the lines changed, so a rewritten lockfile would
// hold the local API's main thread for seconds: here it holds only this thread, and each file stops at its budget,
// its added and removed lines first, then its time.
import { createHash } from "node:crypto";
import { parentPort } from "node:worker_threads";
import type { DiffJob, DiffJobResult, DiffTooLarge } from "./diff-job.ts";
import { fileDiff } from "./diff.ts";

parentPort?.on("message", (job: DiffJob) => {
  parentPort?.postMessage(write(job));
});

/** The lines of a version of a file: its newlines, and a last line without one. */
function lineCount(text: string | null) {
  if (!text) return 0;
  let count = 0;
  for (let at = text.indexOf("\n"); at !== -1; at = text.indexOf("\n", at + 1))
    count += 1;
  return text.endsWith("\n") ? count : count + 1;
}

/** A version's short hash, as git's index line writes it; zeros for a version the file has none of. */
function hashOf(text: string | null) {
  return text === null
    ? "0".repeat(12)
    : createHash("sha1").update(text).digest("hex").slice(0, 12);
}

function write(job: DiffJob): DiffJobResult {
  try {
    const parts: string[] = [];
    const tooLarge = new Map<string, DiffTooLarge>();
    for (const change of job.changes) {
      const content = job.contents.get(change.path)!;
      const part = fileDiff(change, content, {
        timeout: job.fileBudgetMs,
        ...(content.old && content.new
          ? { maxEditLength: job.fileMaxEditLines }
          : {}),
      });
      if (part !== undefined) {
        parts.push(part);
        continue;
      }
      tooLarge.set(change.path, {
        oldLines: lineCount(content.old),
        newLines: lineCount(content.new),
      });
      // Written as a file too large to read, with git's index line after
      // its first: its versions' hashes stand for the lines it has none of,
      // so comparing two versions of it tells whether it changed.
      const [first, ...rest] = fileDiff(change, {
        ...content,
        tooLarge: true,
      })!.split("\n");
      parts.push(
        [
          first,
          `index ${hashOf(content.old)}..${hashOf(content.new)}`,
          ...rest,
        ].join("\n"),
      );
    }
    return { id: job.id, text: parts.join(""), tooLarge };
  } catch (error) {
    return {
      id: job.id,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
