import os from "node:os";
import path from "node:path";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import type { DeckGuide } from "../../../packages/shared/deck.ts";
import {
  createDeckContentCache,
  type DeckCacheKey,
  type DeckCachedContent,
} from "./deck-content-cache.ts";

/*
 * The content cache on disk (#781): each pull request at a base and head is
 * one entry, kept across restarts, evicted closed first, then least recently
 * used, under a cap, never the pull request on screen.
 */

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) {
    await rm(root, { recursive: true, force: true, maxRetries: 5 });
  }
});

async function cacheFolder() {
  const root = await mkdtemp(path.join(os.tmpdir(), "ajour-deck-cache-"));
  roots.push(root);
  return path.join(root, "deck-cache");
}

const key = (number: number, headSha = "head"): DeckCacheKey => ({
  pluginId: "github",
  connectionId: "c1",
  repository: "acme/api",
  number,
  baseSha: "base",
  headSha,
});

/** One entry's contents, all of the same size whatever its number below 100. */
const content = (number: number, headSha = "head"): DeckCachedContent => ({
  diff: {
    baseSha: "base",
    headSha,
    files: [
      {
        path: `pr${String(number).padStart(2, "0")}/a.ts`,
        status: "added",
        binary: false,
        hunks: [
          {
            id: `pr${String(number).padStart(2, "0")}/a.ts#0`,
            header: "@@ -1,0 +1,1 @@",
            oldStart: 1,
            oldLines: 0,
            newStart: 1,
            newLines: 1,
            patch: "+x",
          },
        ],
      },
    ],
  },
  guideInput: {
    diff: "diff",
    old: new Map(),
    new: new Map([[`pr${String(number).padStart(2, "0")}/a.ts`, "x\n"]]),
  },
});

const guide: DeckGuide = {
  madeWith: "code",
  concerns: [{ id: "g1", title: "Title", rationale: "", hunkIds: ["a#0"] }],
};

function start(
  directory: string,
  cap = { bytes: 1_000_000_000 },
  clock = { now: 1_000 },
) {
  return createDeckContentCache({
    directory,
    capBytes: async () => cap.bytes,
    now: () => clock.now,
  });
}

/** The size of one entry with no guide, measured in its own folder. */
async function entrySize() {
  const cache = start(await cacheFolder());
  await cache.put(key(1), content(1));
  return (await cache.usage()).sizeBytes;
}

describe("the Deck content cache", () => {
  it("gives back what it holds, with its guide, at a base and head", async () => {
    const cache = start(await cacheFolder());

    await cache.put(key(1), content(1));
    expect(await cache.get(key(1))).toEqual({
      key: key(1),
      ...content(1),
      guide: null,
    });
    await cache.putGuide(key(1), guide);

    expect((await cache.get(key(1)))?.guide).toEqual(guide);
    expect(await cache.get(key(1, "other"))).toBeUndefined();
    expect(await cache.usage()).toEqual({
      sizeBytes: expect.any(Number),
      entryCount: 1,
    });
  });

  it("finds a pull request by its head alone, the one used last when several bases share it", async () => {
    const clock = { now: 1_000 };
    const cache = start(await cacheFolder(), undefined, clock);
    await cache.put(key(1), content(1));
    clock.now = 2_000;
    await cache.put({ ...key(1), baseSha: "rebased" }, content(1));

    const found = await cache.find({
      pluginId: "github",
      connectionId: "c1",
      repository: "acme/api",
      number: 1,
      headSha: "head",
    });

    expect(found?.key.baseSha).toBe("rebased");
    expect(
      await cache.find({ ...key(1), number: 2, headSha: "head" }),
    ).toBeUndefined();
  });

  it("keeps a new head as a new entry beside the old one", async () => {
    const cache = start(await cacheFolder());

    await cache.put(key(1), content(1));
    await cache.put(key(1, "pushed"), content(1, "pushed"));

    expect((await cache.usage()).entryCount).toBe(2);
    expect((await cache.get(key(1)))?.diff.headSha).toBe("head");
    expect((await cache.get(key(1, "pushed")))?.diff.headSha).toBe("pushed");
  });

  it("keeps an entry and its guide when the same base and head is put again", async () => {
    const cache = start(await cacheFolder());
    await cache.put(key(1), content(1));
    await cache.putGuide(key(1), guide);

    // A preload that read the pull request while an open built it.
    await cache.put(key(1), content(1));

    expect((await cache.get(key(1)))?.guide).toEqual(guide);
    expect((await cache.usage()).entryCount).toBe(1);
  });

  it("still keeps and gives back entries when the cap can't be read", async () => {
    const cache = createDeckContentCache({
      directory: await cacheFolder(),
      capBytes: () => Promise.reject(new Error("The state file is locked.")),
    });

    await expect(cache.put(key(1), content(1))).resolves.toBeUndefined();
    await expect(cache.putGuide(key(1), guide)).resolves.toBeUndefined();
    expect((await cache.get(key(1)))?.guide).toEqual(guide);
  });

  it("keeps its entries across a restart", async () => {
    const directory = await cacheFolder();
    const first = start(directory);
    await first.put(key(1), content(1));
    await first.putGuide(key(1), guide);

    const second = start(directory);

    expect(await second.get(key(1))).toEqual({
      key: key(1),
      ...content(1),
      guide,
    });
  });

  it("evicts the least recently used entries first, under the cap", async () => {
    const size = await entrySize();
    const clock = { now: 1_000 };
    const cap = { bytes: size * 3 };
    const cache = start(await cacheFolder(), cap, clock);
    for (const number of [1, 2, 3]) {
      clock.now += 1_000;
      await cache.put(key(number), content(number));
    }
    // Opening 1 makes 2 the least recently used.
    clock.now += 1_000;
    await cache.get(key(1));

    clock.now += 1_000;
    await cache.put(key(4), content(4));

    expect(await cache.get(key(2))).toBeUndefined();
    for (const number of [1, 3, 4]) {
      expect(await cache.get(key(number))).toBeDefined();
    }
  });

  it("evicts closed pull requests before the least recently used ones", async () => {
    const size = await entrySize();
    const clock = { now: 1_000 };
    const cap = { bytes: size * 3 };
    const cache = start(await cacheFolder(), cap, clock);
    for (const number of [1, 2, 3]) {
      clock.now += 1_000;
      await cache.put(key(number), content(number));
    }
    await cache.markClosed({ pluginId: "github", connectionId: "c1" }, [
      { repository: "acme/api", number: 3, state: "merged" },
      { repository: "acme/api", number: 1, state: "open" },
    ]);

    await cache.put(key(4), content(4));

    expect(await cache.get(key(3))).toBeUndefined();
    expect(await cache.get(key(1))).toBeDefined();
  });

  it("never evicts the pull request on screen, even alone over the cap", async () => {
    const cap = { bytes: 1 };
    const cache = start(await cacheFolder(), cap);
    cache.keep(key(1));

    await cache.put(key(1), content(1));
    await cache.put(key(2), content(2));

    expect(await cache.get(key(1))).toBeDefined();
    expect(await cache.get(key(2))).toBeUndefined();
  });

  it("evicts down to a lower cap once it is set", async () => {
    const size = await entrySize();
    const cap = { bytes: size * 3 };
    const clock = { now: 1_000 };
    const cache = start(await cacheFolder(), cap, clock);
    for (const number of [1, 2, 3]) {
      clock.now += 1_000;
      await cache.put(key(number), content(number));
    }

    cap.bytes = size;
    await cache.evict();

    expect(await cache.usage()).toEqual({ sizeBytes: size, entryCount: 1 });
    expect(await cache.get(key(3))).toBeDefined();
  });

  it("drops an entry whose files are cut short, and keeps working", async () => {
    const directory = await cacheFolder();
    const cache = start(directory);
    await cache.put(key(1), content(1));
    await cache.putGuide(key(1), guide);
    for (const name of await readdir(directory)) {
      const file = path.join(directory, name);
      const text = await readFile(file, "utf8");
      await writeFile(file, text.slice(0, text.length / 2), "utf8");
    }

    expect(await cache.get(key(1))).toBeUndefined();
    expect(await cache.usage()).toEqual({ sizeBytes: 0, entryCount: 0 });
    await cache.put(key(1), content(1));
    expect(await cache.get(key(1))).toBeDefined();
  });

  it("drops an entry cut short while it was closed, when it starts again", async () => {
    const directory = await cacheFolder();
    await start(directory).put(key(1), content(1));
    await start(directory).put(key(2), content(2));
    for (const name of await readdir(directory)) {
      if (!name.endsWith(".meta.json")) continue;
      await writeFile(path.join(directory, name), "{", "utf8");
    }

    const cache = start(directory);

    expect(await cache.usage()).toEqual({ sizeBytes: 0, entryCount: 0 });
    // The files of the dropped entries are gone too.
    expect(await readdir(directory)).toEqual([]);
  });

  it("removes the files an interrupted write left", async () => {
    const directory = await cacheFolder();
    await start(directory).put(key(1), content(1));
    await writeFile(
      path.join(directory, "0123.content.json.0f0e-tmp.tmp"),
      "half",
      "utf8",
    );

    const cache = start(directory);
    await cache.usage();

    expect(
      (await readdir(directory)).filter((name) => name.endsWith(".tmp")),
    ).toEqual([]);
    expect(await cache.get(key(1))).toBeDefined();
  });

  it("clears every entry, and forgets a removed connection's", async () => {
    const directory = await cacheFolder();
    const cache = start(directory);
    await cache.put(key(1), content(1));
    await cache.put({ ...key(2), connectionId: "c2" }, content(2));

    await cache.forgetConnection({ pluginId: "github", connectionId: "c1" });
    expect(await cache.usage()).toMatchObject({ entryCount: 1 });

    await cache.clear();
    expect(await cache.usage()).toEqual({ sizeBytes: 0, entryCount: 0 });
    expect(await readdir(directory)).toEqual([]);
  });

  it("names entries by a hash, so no path, repository or commit is in a file name", async () => {
    const directory = await cacheFolder();
    const cache = start(directory);

    await cache.put(key(1), content(1));

    for (const name of await readdir(directory)) {
      expect(name).toMatch(/^[0-9a-f]{40}\.(meta|content|guide)\.json$/);
    }
  });
});
