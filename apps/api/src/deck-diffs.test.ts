import { getEventListeners } from "node:events";
import { afterEach, describe, expect, it } from "vitest";
import type {
  FileChange,
  FileContents,
} from "../../../packages/review-deck/diff.ts";
import {
  createWorkerDeckDiffs,
  DeckDiffCancelled,
  type DeckDiffs,
} from "./deck-diffs.ts";

/*
 * Deck's diff workers (#774's council): each diff is written in a worker
 * thread, a file past its budget written as too large to compare, and a
 * stopped diff doesn't hold up the ones behind it.
 */

const running: DeckDiffs[] = [];
afterEach(async () => {
  await Promise.all(running.splice(0).map((diffs) => diffs.close()));
});

function diffsOf(budget?: Parameters<typeof createWorkerDeckDiffs>[1]) {
  const diffs = createWorkerDeckDiffs(undefined, budget);
  running.push(diffs);
  return diffs;
}

/** One modified file, from its two versions. */
function modified(path: string, old: string, next: string) {
  const changes: FileChange[] = [{ path, changeType: "edit" }];
  const contents = new Map<string, FileContents>([
    [path, { old, new: next, binary: false, tooLarge: false }],
  ]);
  return { changes, contents };
}

/** A lockfile of 4,200 lines with 4,000 replaced, over a second to diff. */
const lockfile = () => {
  const line = (index: number, tag: string) =>
    `  "${tag}-${index}": "value number ${index}",\n`;
  const old = Array.from({ length: 4_200 }, (_, index) => line(index, "a"));
  const next = old.map((text, index) =>
    index >= 100 && index < 4_100 ? line(index, "b") : text,
  );
  return modified("lock.json", old.join(""), next.join(""));
};

describe("Deck's diff workers", () => {
  it("writes a file past its budget as too large to compare, with its line counts", async () => {
    const { changes, contents } = lockfile();
    const small = modified("a.ts", "one\ntwo\n", "one\n2\n");
    changes.push(...small.changes);
    for (const [path, content] of small.contents) contents.set(path, content);

    const written = await diffsOf().write(
      changes,
      contents,
      "open",
      new AbortController().signal,
    );

    expect([...written.tooLarge]).toEqual([
      [
        "lock.json",
        // The edit limit or the clock, whichever comes first here.
        { oldLines: 4_200, newLines: 4_200, stoppedBy: expect.any(String) },
      ],
    ]);
    expect(written.text).toContain(
      "Binary files a/lock.json and b/lock.json differ",
    );
    // Its versions' hashes stand for its lines, as git's index line does.
    expect(written.text).toMatch(
      /^diff --git a\/lock.json b\/lock.json\nindex [0-9a-f]{12}\.\.[0-9a-f]{12}\n/,
    );
    expect(written.text).toContain("@@ -1,2 +1,2 @@");
  });

  it("writes a rewritten lockfile as too large by its edits, however long the clock allows", async () => {
    // A minute per file: only the edit limit can stop it.
    const { changes, contents } = lockfile();
    const written = await diffsOf({ timeout: 60_000 }).write(
      changes,
      contents,
      "open",
      new AbortController().signal,
    );
    expect([...written.tooLarge]).toEqual([
      ["lock.json", { oldLines: 4_200, newLines: 4_200, stoppedBy: "edits" }],
    ]);
  });

  it("says when the clock stopped a file under the edit limit", async () => {
    // No edit limit to speak of, and a millisecond.
    const { changes, contents } = lockfile();
    const written = await diffsOf({
      timeout: 1,
      maxEditLength: 1_000_000,
    }).write(changes, contents, "open", new AbortController().signal);
    expect([...written.tooLarge]).toEqual([
      ["lock.json", { oldLines: 4_200, newLines: 4_200, stoppedBy: "clock" }],
    ]);
  });

  it("shows the hunks of a long file with scattered edits, and of a long added file, under the edit limit", async () => {
    const line = (index: number, tag: string) =>
      `const value${index} = "${tag}";\n`;
    const old = Array.from({ length: 8_000 }, (_, index) => line(index, "a"));
    // 1,000 lines replaced, one in eight: 2,000 added and removed.
    const next = old.map((text, index) =>
      index % 8 === 0 ? line(index, "b") : text,
    );
    const { changes, contents } = modified(
      "big.ts",
      old.join(""),
      next.join(""),
    );
    changes.push({ path: "new.ts", changeType: "add" });
    contents.set("new.ts", {
      old: null,
      new: next.join(""),
      binary: false,
      tooLarge: false,
    });

    const written = await diffsOf({ timeout: 60_000 }).write(
      changes,
      contents,
      "open",
      new AbortController().signal,
    );
    expect(written.tooLarge.size).toBe(0);
    expect(written.text).toContain("@@ -1,4 +1,4 @@");
    expect(written.text).toContain("+++ b/new.ts\n@@ -1,0 +1,8000 @@");
  });

  it("writes the diffs queued behind a stopped one", async () => {
    const diffs = diffsOf();
    const stop = new AbortController();
    const { changes, contents } = lockfile();
    const stopped = diffs.write(changes, contents, "open", stop.signal);
    const small = modified("a.ts", "one\n", "1\n");
    const behind = diffs.write(
      small.changes,
      small.contents,
      "open",
      new AbortController().signal,
    );

    stop.abort();

    await expect(stopped).rejects.toBeInstanceOf(DeckDiffCancelled);
    await expect(behind).resolves.toMatchObject({
      text: expect.stringContaining("@@ -1,1 +1,1 @@"),
    });
  });

  it("still stops a diff after it moved to a new worker", async () => {
    const diffs = diffsOf();
    const first = new AbortController();
    const second = new AbortController();
    const big = lockfile();
    const stoppedFirst = diffs.write(
      big.changes,
      big.contents,
      "open",
      first.signal,
    );
    const moved = diffs.write(big.changes, big.contents, "open", second.signal);

    // The first stop sends the second diff to a new worker; stopping it
    // there must still end it.
    first.abort();
    second.abort();

    await expect(stoppedFirst).rejects.toBeInstanceOf(DeckDiffCancelled);
    await expect(moved).rejects.toBeInstanceOf(DeckDiffCancelled);
  });

  it("lets go of the signal once a diff is written", async () => {
    const diffs = diffsOf();
    const signal = new AbortController().signal;
    for (let index = 0; index < 12; index += 1) {
      const small = modified(`f${index}.ts`, "one\n", "1\n");
      await diffs.write(small.changes, small.contents, "open", signal);
    }
    expect(getEventListeners(signal, "abort")).toHaveLength(0);
  });
});
