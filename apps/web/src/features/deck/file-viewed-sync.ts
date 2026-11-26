/*
 * Per-file viewed marks on the code host (#785). When a file's hunks all
 * become viewed on the review page, or stop being, the page tells the code
 * host where it keeps per-file viewed state, GitHub's "Viewed" box, at the
 * head the user read. One write per file at a time, with only the latest
 * choice sent after it: marking and unmarking quickly never lands out of
 * order. A code host without that state, or a connection whose access is
 * off, stops the sync for the page: the marks stay on this computer.
 */

/** What a failed write means for the writes after it. */
export type FileViewedFailure = "stop" | "continue";

interface Wanted {
  viewed: boolean;
  headSha: string;
}

export class FileViewedSync {
  readonly #send: (path: string, wanted: Wanted) => Promise<unknown>;
  readonly #failed: (
    path: string,
    viewed: boolean,
    error: unknown,
  ) => FileViewedFailure;
  readonly #wanted = new Map<string, Wanted>();
  readonly #sending = new Set<string>();
  #stopped = false;

  constructor(
    send: (path: string, wanted: Wanted) => Promise<unknown>,
    failed: (
      path: string,
      viewed: boolean,
      error: unknown,
    ) => FileViewedFailure,
  ) {
    this.#send = send;
    this.#failed = failed;
  }

  /** Marks `path` viewed on the code host, or not, at `headSha`. */
  set(path: string, viewed: boolean, headSha: string) {
    if (this.#stopped) return;
    this.#wanted.set(path, { viewed, headSha });
    if (!this.#sending.has(path)) void this.#run(path);
  }

  async #run(path: string) {
    this.#sending.add(path);
    try {
      for (;;) {
        const wanted = this.#wanted.get(path);
        if (!wanted || this.#stopped) break;
        this.#wanted.delete(path);
        try {
          await this.#send(path, wanted);
        } catch (error) {
          if (this.#failed(path, wanted.viewed, error) === "stop") {
            this.#stopped = true;
            this.#wanted.clear();
          }
        }
      }
    } finally {
      this.#sending.delete(path);
    }
  }
}
