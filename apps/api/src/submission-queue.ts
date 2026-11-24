/*
 * Writes that name their submission (#784, ADR 0002) run one at a time per
 * name. Two windows retrying the same saved draft would otherwise both ask
 * the code host what an earlier try left, both find nothing, and both post.
 * Plugins can run in separate workers, so the local API holds the line
 * here, before the plugin's lookup and writes.
 *
 * A try that waited behind another of its name runs after it as a retry:
 * it's told when the first of them was tried, so the plugin finds what that
 * one posted and sends only the rest.
 */

interface Tail {
  /** Settles once the last queued write of the name has. */
  settled: Promise<void>;
  /** When the first write of the queue started. */
  firstTriedAt: number;
}

export class SubmissionQueue {
  readonly #tails = new Map<string, Tail>();

  /**
   * Runs `write` after every earlier write queued under `key`. It gets the
   * time the first of them was tried, or undefined when it ran first.
   */
  run<T>(
    key: string,
    write: (earlierTryAt: number | undefined) => Promise<T>,
  ): Promise<T> {
    const previous = this.#tails.get(key);
    const firstTriedAt = previous?.firstTriedAt ?? Date.now();
    const result = previous
      ? previous.settled.then(() => write(previous.firstTriedAt))
      : write(undefined);
    const tail: Tail = {
      settled: result.then(
        () => undefined,
        () => undefined,
      ),
      firstTriedAt,
    };
    this.#tails.set(key, tail);
    void tail.settled.then(() => {
      if (this.#tails.get(key) === tail) this.#tails.delete(key);
    });
    return result;
  }
}
