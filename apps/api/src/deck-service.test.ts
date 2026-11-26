import { addedFileCodeHost, builtFrom } from "./test-support/deck-guides.ts";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { fileDiff } from "../../../packages/review-deck/diff.ts";
import type { DiffTooLarge } from "../../../packages/review-deck/diff-job.ts";
import { createDeckContentCache } from "./deck-content-cache.ts";
import type { DeckDiffs } from "./deck-diffs.ts";
import { createGuideBuilds } from "./deck-guide-builds.ts";
import {
  createDeckService,
  DeckConnectionRemoved,
  type DeckCodeHost,
} from "./deck-service.ts";

/*
 * Deck's service at the seams the routes can't hold (#781): here the
 * content cache's write queue, which the local API never shows.
 */

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) {
    await rm(root, { recursive: true, force: true, maxRetries: 5 });
  }
});

const SOURCE = { pluginId: "github", connectionId: "c1" };

const codeHost = addedFileCodeHost("head", "base");

async function startService({ diffs }: { diffs?: DeckDiffs } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "ajour-deck-service-"));
  roots.push(root);
  const cache = createDeckContentCache({
    directory: path.join(root, "deck-cache"),
    capBytes: async () => 1_000_000_000,
  });
  const builds: string[] = [];
  const guides = createGuideBuilds({
    runtime: {
      async build(input) {
        builds.push(input.diff);
        return builtFrom(input, []);
      },
      close: async () => {},
    },
  });
  // The cache's writes wait until `releasePuts`, as behind a long queue.
  let releasePuts!: () => void;
  const putsHeld = new Promise<void>((resolve) => {
    releasePuts = resolve;
  });
  let putsWaiting = 0;
  const heldCache = {
    ...cache,
    async put(...args: Parameters<typeof cache.put>) {
      putsWaiting += 1;
      await putsHeld;
      return cache.put(...args);
    },
  };
  const service = createDeckService({ guides, cache: heldCache, diffs });
  return {
    service,
    cache,
    builds,
    releasePuts,
    putsWaiting: () => putsWaiting,
  };
}

describe("Deck's service when a connection is removed", () => {
  it("builds no guide of a preload whose cache write waited past its connection's removal", async () => {
    const deck = await startService();
    const preloaded = deck.service.preloadPullRequests(
      SOURCE,
      [{ repository: "acme/api", number: 20 }],
      codeHost,
    );
    await expect.poll(deck.putsWaiting).toBe(1);

    await deck.service.forgetConnection(SOURCE);
    deck.releasePuts();

    await expect(preloaded).rejects.toBeInstanceOf(DeckConnectionRemoved);
    await deck.cache.flush();
    expect(deck.builds).toEqual([]);
    expect(await deck.cache.usage()).toMatchObject({ entryCount: 0 });
  });

  it("opens and preloads nothing through a code host bound before its connection was removed", async () => {
    const deck = await startService();
    // The route finds the connection, then reads the request's body: the
    // connection can go in between.
    const bound = { ...codeHost, generation: deck.cache.generation(SOURCE) };
    await deck.service.forgetConnection(SOURCE);
    deck.releasePuts();

    await expect(
      deck.service.openPullRequest(
        SOURCE,
        { repository: "acme/api", number: 20 },
        bound,
      ),
    ).rejects.toBeInstanceOf(DeckConnectionRemoved);
    await expect(
      deck.service.preloadPullRequests(
        SOURCE,
        [{ repository: "acme/api", number: 21 }],
        bound,
      ),
    ).rejects.toBeInstanceOf(DeckConnectionRemoved);
    await deck.cache.flush();
    expect(deck.builds).toEqual([]);
    expect(await deck.cache.usage()).toMatchObject({ entryCount: 0 });
  });

  it("asks the code host nothing for a request bound before its connection was removed, even once it's added again", async () => {
    const deck = await startService();
    deck.releasePuts();
    const operations: string[] = [];
    const counting: DeckCodeHost = {
      run(operation, request) {
        operations.push(operation);
        return codeHost.run(operation, request);
      },
    };
    const stale = { ...counting, generation: deck.cache.generation(SOURCE) };
    await deck.service.forgetConnection(SOURCE);
    // The same connection id comes back, and opens the pull request.
    await deck.service.openPullRequest(
      SOURCE,
      { repository: "acme/api", number: 20 },
      counting,
    );
    operations.length = 0;

    await expect(
      deck.service.openPullRequest(
        SOURCE,
        { repository: "acme/api", number: 20 },
        stale,
      ),
    ).rejects.toBeInstanceOf(DeckConnectionRemoved);
    expect(operations).toEqual([]);
  });
});

/** Diffs that find every file too large, stopped as `stoppedBy` says. */
function tooLargeDiffs(stoppedBy: DiffTooLarge["stoppedBy"]): DeckDiffs {
  return {
    async write(changes, contents) {
      const tooLarge = new Map<string, DiffTooLarge>();
      const text = changes
        .map((change) => {
          tooLarge.set(change.path, { oldLines: 0, newLines: 1, stoppedBy });
          return fileDiff(change, {
            ...contents.get(change.path)!,
            tooLarge: true,
          });
        })
        .join("");
      return { text, tooLarge };
    },
    close: async () => {},
  };
}

describe("a file too large to compare, in the content cache", () => {
  /** Opens #20, then #21, then #20 again, and counts the files read. */
  async function openTwice(stoppedBy: DiffTooLarge["stoppedBy"]) {
    const deck = await startService({ diffs: tooLargeDiffs(stoppedBy) });
    deck.releasePuts();
    let reads = 0;
    const counting: DeckCodeHost = {
      run(operation, request) {
        if (operation === "getFileContent") reads += 1;
        return codeHost.run(operation, request);
      },
    };
    const open = (number: number) =>
      deck.service.openPullRequest(
        SOURCE,
        { repository: "acme/api", number },
        counting,
      );
    const first = await open(20);
    await deck.cache.flush();
    await open(21);
    await deck.cache.flush();
    const again = await open(20);
    return { first, again, reads };
  }

  it("is compared again on the next open when the clock stopped it", async () => {
    const { first, again, reads } = await openTwice("clock");

    expect(first.opened.files[0]!.tooLarge).toEqual({
      oldLines: 0,
      newLines: 1,
    });
    // #20's one file read on each of its opens, and #21's.
    expect(reads).toBe(3);
    expect(again.cached).toBe(false);
  });

  it("isn't read again by each preload, and leaves the next comparison to an open", async () => {
    const deck = await startService({ diffs: tooLargeDiffs("clock") });
    deck.releasePuts();
    let reads = 0;
    const counting: DeckCodeHost = {
      run(operation, request) {
        if (operation === "getFileContent") reads += 1;
        return codeHost.run(operation, request);
      },
    };
    const preload = () =>
      deck.service.preloadPullRequests(
        SOURCE,
        [{ repository: "acme/api", number: 20 }],
        counting,
      );
    await preload();
    await preload();
    expect(reads).toBe(1);

    const opened = await deck.service.openPullRequest(
      SOURCE,
      { repository: "acme/api", number: 20 },
      counting,
    );
    expect(opened.cached).toBe(false);
    expect(reads).toBe(2);
  });

  it("stays cached when its edits passed the limit", async () => {
    const { again, reads } = await openTwice("edits");

    expect(reads).toBe(2);
    expect(again.cached).toBe(true);
  });
});
