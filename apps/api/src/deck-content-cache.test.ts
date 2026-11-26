import os from "node:os";
import path from "node:path";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
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

/** The generation of a cache that forgot no connection yet. */
const FRESH = 0;

const guide: DeckGuide = {
  madeWith: "code",
  concerns: [
    { id: "g1", title: "Title", rationale: "", hunkIds: ["a#0"], kinds: [] },
  ],
  summary: {
    problem: null,
    tickets: [],
    kinds: [],
    breaking: [],
    risks: [],
    tests: [],
    untested: [],
    leftovers: [],
  },
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
  await cache.put(key(1), content(1), FRESH);
  return (await cache.usage()).sizeBytes;
}

/**
 * Holds an entry's content file, or its `part`, as Windows does while another process has
 * it open without delete sharing: a folder in its place can't be deleted as
 * a file. `release` puts the file back, as it was, for a later delete.
 */
async function holdContent(
  directory: string,
  held?: DeckCacheKey,
  part: "content" | "meta" = "content",
) {
  const names = (await readdir(directory)).filter((name) =>
    name.endsWith(`.${part}.json`),
  );
  let name: string | undefined;
  for (const candidate of names) {
    const text = await readFile(path.join(directory, candidate), "utf8");
    if (!held || text.includes(`"number":${held.number},`)) name = candidate;
  }
  const file = path.join(directory, name!);
  const text = await readFile(file, "utf8");
  await rm(file);
  await mkdir(file);
  await writeFile(path.join(file, "held"), "", "utf8");
  return async () => {
    await rm(file, { recursive: true });
    await writeFile(file, text, "utf8");
  };
}

describe("the Deck content cache", () => {
  it("gives back what it holds, with its guide, at a base and head", async () => {
    const cache = start(await cacheFolder());

    await cache.put(key(1), content(1), FRESH);
    expect(await cache.get(key(1))).toEqual({
      key: key(1),
      ...content(1),
      guide: null,
      agentGuide: null,
    });
    await cache.putGuide(key(1), guide);

    expect((await cache.get(key(1)))?.guide).toEqual(guide);
    expect(await cache.get(key(1, "other"))).toBeUndefined();
    expect(await cache.usage()).toEqual({
      sizeBytes: expect.any(Number),
      entryCount: 1,
      pendingRemovalCount: 0,
    });
  });

  it("finds a pull request by its head alone, the one used last when several bases share it", async () => {
    const clock = { now: 1_000 };
    const cache = start(await cacheFolder(), undefined, clock);
    await cache.put(key(1), content(1), FRESH);
    clock.now = 2_000;
    await cache.put({ ...key(1), baseSha: "rebased" }, content(1), FRESH);

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

    await cache.put(key(1), content(1), FRESH);
    await cache.put(key(1, "pushed"), content(1, "pushed"), FRESH);

    expect((await cache.usage()).entryCount).toBe(2);
    expect((await cache.get(key(1)))?.diff.headSha).toBe("head");
    expect((await cache.get(key(1, "pushed")))?.diff.headSha).toBe("pushed");
  });

  it("keeps an entry and its guide when the same base and head is put again", async () => {
    const cache = start(await cacheFolder());
    await cache.put(key(1), content(1), FRESH);
    await cache.putGuide(key(1), guide);

    // A preload that read the pull request while an open built it.
    await cache.put(key(1), content(1), FRESH);

    expect((await cache.get(key(1)))?.guide).toEqual(guide);
    expect((await cache.usage()).entryCount).toBe(1);
  });

  it("still keeps and gives back entries when the cap can't be read", async () => {
    const cache = createDeckContentCache({
      directory: await cacheFolder(),
      capBytes: () => Promise.reject(new Error("The state file is locked.")),
    });

    await expect(cache.put(key(1), content(1), FRESH)).resolves.toBeUndefined();
    await expect(cache.putGuide(key(1), guide)).resolves.toBeUndefined();
    expect((await cache.get(key(1)))?.guide).toEqual(guide);
  });

  it("keeps its entries across a restart", async () => {
    const directory = await cacheFolder();
    const first = start(directory);
    await first.put(key(1), content(1), FRESH);
    await first.putGuide(key(1), guide);

    const second = start(directory);

    expect(await second.get(key(1))).toEqual({
      key: key(1),
      ...content(1),
      guide,
      agentGuide: null,
    });
  });

  it("keeps the agent's guide beside the built one, across a restart, counted, until it is dropped", async () => {
    const directory = await cacheFolder();
    const first = start(directory);
    await first.put(key(1), content(1), FRESH);
    await first.putGuide(key(1), guide);
    const withBuilt = (await first.usage()).sizeBytes;
    const agentGuide: DeckGuide = {
      ...guide,
      madeWith: "agent",
      provider: { cli: "claude-code", label: "Claude Code" },
    };

    await first.putAgentGuide(key(1), agentGuide);
    // Another entry's guide isn't written anywhere.
    await first.putAgentGuide(key(2), agentGuide);

    expect((await first.usage()).sizeBytes).toBeGreaterThan(withBuilt);
    const second = start(directory);
    expect(await second.get(key(1))).toEqual({
      key: key(1),
      ...content(1),
      guide,
      agentGuide,
    });

    await second.dropAgentGuide(key(1));

    expect(await second.get(key(1))).toMatchObject({ guide, agentGuide: null });
    expect((await second.usage()).sizeBytes).toBe(withBuilt);
    expect((await start(directory).get(key(1)))?.agentGuide).toBeNull();
  });

  it("keeps what changed since each reviewed version with its entry, across a restart, counted and removed with it", async () => {
    const directory = await cacheFolder();
    const first = start(directory);
    await first.put(key(1), content(1), FRESH);
    const since = (reviewedHead: string, version: number) => ({
      head: "head",
      reviewedHead,
      version: 3,
      reviewedVersion: version,
      changed: [{ hunkId: "pr01/a.ts#0", version: 3 }],
    });
    await first.putSince(key(1), since("h1", 1));
    await first.putSince(key(1), since("h2", 2));
    // Another head's answer isn't this entry's.
    await first.putSince(key(1), { ...since("h1", 1), head: "other" });
    const withoutSince = await entrySize();
    expect((await first.usage()).sizeBytes).toBeGreaterThan(withoutSince);

    const second = start(directory);
    expect(await second.getSince(key(1), "h1")).toEqual(since("h1", 1));
    expect(await second.getSince(key(1), "h2")).toEqual(since("h2", 2));
    expect(await second.getSince(key(1), "h0")).toBeUndefined();

    await second.clear();
    expect(await second.getSince(key(1), "h1")).toBeUndefined();
    expect(await readdir(directory)).toEqual([]);
  });

  it("evicts the least recently used entries first, under the cap", async () => {
    const size = await entrySize();
    const clock = { now: 1_000 };
    const cap = { bytes: size * 3 };
    const cache = start(await cacheFolder(), cap, clock);
    for (const number of [1, 2, 3]) {
      clock.now += 1_000;
      await cache.put(key(number), content(number), FRESH);
    }
    // Opening 1 makes 2 the least recently used.
    clock.now += 1_000;
    await cache.get(key(1));

    clock.now += 1_000;
    await cache.put(key(4), content(4), FRESH);

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
      await cache.put(key(number), content(number), FRESH);
    }
    await cache.markClosed({ pluginId: "github", connectionId: "c1" }, [
      { repository: "acme/api", number: 3, state: "merged" },
      { repository: "acme/api", number: 1, state: "open" },
    ]);

    await cache.put(key(4), content(4), FRESH);

    expect(await cache.get(key(3))).toBeUndefined();
    expect(await cache.get(key(1))).toBeDefined();
  });

  it("never evicts the pull request on screen, even alone over the cap", async () => {
    const cap = { bytes: 1 };
    const cache = start(await cacheFolder(), cap);
    cache.keep(key(1));

    await cache.put(key(1), content(1), FRESH);
    await cache.put(key(2), content(2), FRESH);

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
      await cache.put(key(number), content(number), FRESH);
    }

    cap.bytes = size;
    await cache.evict();

    expect(await cache.usage()).toEqual({
      sizeBytes: size,
      entryCount: 1,
      pendingRemovalCount: 0,
    });
    expect(await cache.get(key(3))).toBeDefined();
  });

  it("drops an entry whose files are cut short, and keeps working", async () => {
    const directory = await cacheFolder();
    const cache = start(directory);
    await cache.put(key(1), content(1), FRESH);
    await cache.putGuide(key(1), guide);
    for (const name of await readdir(directory)) {
      const file = path.join(directory, name);
      const text = await readFile(file, "utf8");
      await writeFile(file, text.slice(0, text.length / 2), "utf8");
    }

    expect(await cache.get(key(1))).toBeUndefined();
    expect(await cache.usage()).toEqual({
      sizeBytes: 0,
      entryCount: 0,
      pendingRemovalCount: 0,
    });
    await cache.put(key(1), content(1), FRESH);
    expect(await cache.get(key(1))).toBeDefined();
  });

  it("drops an entry cut short while it was closed, when it starts again", async () => {
    const directory = await cacheFolder();
    await start(directory).put(key(1), content(1), FRESH);
    await start(directory).put(key(2), content(2), FRESH);
    for (const name of await readdir(directory)) {
      if (!name.endsWith(".meta.json")) continue;
      await writeFile(path.join(directory, name), "{", "utf8");
    }

    const cache = start(directory);

    expect(await cache.usage()).toEqual({
      sizeBytes: 0,
      entryCount: 0,
      pendingRemovalCount: 0,
    });
    // The files of the dropped entries are gone too.
    expect(await readdir(directory)).toEqual([]);
  });

  it("removes the files an interrupted write left", async () => {
    const directory = await cacheFolder();
    await start(directory).put(key(1), content(1), FRESH);
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
    await cache.put(key(1), content(1), FRESH);
    await cache.put({ ...key(2), connectionId: "c2" }, content(2), FRESH);

    await cache.forgetConnection({ pluginId: "github", connectionId: "c1" });
    expect(await cache.usage()).toMatchObject({ entryCount: 1 });

    await cache.clear();
    expect(await cache.usage()).toEqual({
      sizeBytes: 0,
      entryCount: 0,
      pendingRemovalCount: 0,
    });
    expect(await readdir(directory)).toEqual([]);
  });

  it("drops a put begun before its connection or its plugin was forgotten", async () => {
    const cache = start(await cacheFolder());
    const c1 = { pluginId: "github", connectionId: "c1" };
    const before = cache.generation(c1);

    await cache.forgetConnection(c1);
    await cache.put(key(1), content(1), before);
    expect(await cache.usage()).toMatchObject({ entryCount: 0 });

    // Work begun after it is kept.
    await cache.put(key(1), content(1), cache.generation(c1));
    expect(await cache.usage()).toMatchObject({ entryCount: 1 });

    const beforePlugin = cache.generation(c1);
    await cache.forgetConnection({ pluginId: "github" });
    expect(await cache.usage()).toMatchObject({ entryCount: 0 });
    await cache.put(key(1), content(1), beforePlugin);
    expect(await cache.usage()).toMatchObject({ entryCount: 0 });
  });

  it("keeps counting an entry whose file Windows holds, never gives it back, and removes it on a later pass", async () => {
    const directory = await cacheFolder();
    const cache = start(directory);
    await cache.put(key(1), content(1), FRESH);
    const size = (await cache.usage()).sizeBytes;
    const release = await holdContent(directory);

    await cache.clear();

    expect(await cache.usage()).toEqual({
      sizeBytes: size,
      entryCount: 1,
      pendingRemovalCount: 1,
    });
    expect(await cache.get(key(1))).toBeUndefined();
    await release();
    await cache.clear();
    expect(await cache.usage()).toEqual({
      sizeBytes: 0,
      entryCount: 0,
      pendingRemovalCount: 0,
    });
    expect(await readdir(directory)).toEqual([]);
  });

  it("evicts past an entry it can't delete, counting only the bytes it removed", async () => {
    const size = await entrySize();
    const clock = { now: 1_000 };
    const cap = { bytes: size * 2 };
    const directory = await cacheFolder();
    const cache = start(directory, cap, clock);
    for (const number of [1, 2]) {
      clock.now += 1_000;
      await cache.put(key(number), content(number), FRESH);
    }
    // Entry 1, the least recently used, is held.
    const release = await holdContent(directory, key(1));

    clock.now += 1_000;
    await cache.put(key(3), content(3), FRESH);

    expect(await cache.usage()).toEqual({
      sizeBytes: size * 2,
      entryCount: 2,
      pendingRemovalCount: 1,
    });
    expect(await cache.get(key(2))).toBeUndefined();
    expect(await cache.get(key(3))).toBeDefined();
    await release();
    await cache.evict();
    expect(await cache.usage()).toEqual({
      sizeBytes: size,
      entryCount: 1,
      pendingRemovalCount: 0,
    });
  });

  it("removes at its next start what a removal couldn't, once Windows lets go", async () => {
    const directory = await cacheFolder();
    const cache = start(directory);
    await cache.put(key(1), content(1), FRESH);
    const release = await holdContent(directory);
    await cache.forgetConnection({ pluginId: "github", connectionId: "c1" });
    await release();

    const next = start(directory);

    expect(await next.usage()).toMatchObject({
      sizeBytes: 0,
      entryCount: 0,
      pendingRemovalCount: 0,
    });
    expect(await next.get(key(1))).toBeUndefined();
    expect(await readdir(directory)).toEqual([]);
  });

  it("never gives back after a restart an entry removed while Windows held its contents and its meta", async () => {
    const directory = await cacheFolder();
    const cache = start(directory);
    await cache.put(key(1), content(1), FRESH);
    const releaseContent = await holdContent(directory, key(1));
    const releaseMeta = await holdContent(directory, key(1), "meta");
    await cache.forgetConnection({ pluginId: "github", connectionId: "c1" });
    await releaseContent();
    await releaseMeta();

    const next = start(directory);

    expect(await next.get(key(1))).toBeUndefined();
    expect(await next.usage()).toEqual({
      sizeBytes: 0,
      entryCount: 0,
      pendingRemovalCount: 0,
    });
    expect(await readdir(directory)).toEqual([]);

    // The same pull request read again is kept across the next restart.
    await next.put(key(1), content(1), next.generation(key(1)));
    expect(await start(directory).get(key(1))).toBeDefined();
  });

  it("keeps no entry across a restart when its removal list can't be read", async () => {
    const directory = await cacheFolder();
    const cache = start(directory);
    await cache.put(key(1), content(1), FRESH);
    await cache.flush();
    // A removal list cut short, as by a crash, may have named this entry.
    await writeFile(path.join(directory, "removals.json"), '{"ids":["', "utf8");

    const next = start(directory);

    expect(await next.get(key(1))).toBeUndefined();
    expect(await next.usage()).toMatchObject({ sizeBytes: 0, entryCount: 0 });
  });

  it("names entries by a hash, so no path, repository or commit is in a file name", async () => {
    const directory = await cacheFolder();
    const cache = start(directory);

    await cache.put(key(1), content(1), FRESH);

    for (const name of await readdir(directory)) {
      expect(name).toMatch(/^[0-9a-f]{40}\.(meta|content|guide)\.json$/);
    }
  });
});
