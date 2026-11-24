import { getOrCreateWorkerPoolSingleton } from "@pierre/diffs/worker";
import workerUrl from "@pierre/diffs/worker/worker-portable.js?worker&url";

/*
 * Where `DiffHunk` highlights its lines: in two module workers of
 * `@pierre/diffs`'s pool, off the window's main thread, so a large hunk or
 * a language's first grammar never holds a frame (#790). The window only
 * builds the lines the workers send back. Loaded with the library, by the
 * first hunk that draws. Without workers, or when they fail to start, the
 * library highlights on the main thread as before.
 */

/** Two workers: each loads its own highlighter and grammars. */
const POOL_SIZE = 2;

/** The window's one highlighter pool, made with the first hunk that draws. Undefined without workers. */
export function diffWorkerPool() {
  if (typeof Worker === "undefined") return undefined;
  return getOrCreateWorkerPoolSingleton({
    poolOptions: {
      workerFactory: () => new Worker(workerUrl, { type: "module" }),
      poolSize: POOL_SIZE,
      // The pool highlights on the main thread when its workers can't
      // start, so a failure needs no report of its own.
      onWorkerError: (event) => event.preventDefault(),
    },
    highlighterOptions: {},
  });
}
