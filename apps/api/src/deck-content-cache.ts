import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { CodeHostPullRequestState } from "../../../packages/shared/code-host.ts";
import {
  deckGuideSchema,
  deckPullRequestDiffSchema,
  type DeckGuide,
  type DeckPullRequestDiff,
} from "../../../packages/shared/deck.ts";
import { writeFileAtomically } from "./atomic-file.ts";
import type { GuideBuildInput } from "./deck-guide-builds.ts";

/*
 * Deck's content cache (#596, #781): what Deck read of a pull request at one
 * base and head, on disk under the local API's data folder, so it opens at
 * once and survives a restart. An entry holds both versions of each changed
 * file, the built diff, and the guide once it is built. A new push makes a
 * new entry; the old one stays until it is evicted. Over the cap, closed
 * pull requests go first, then the least recently used, never the one on
 * screen. Draft reviews never live here: they're the window's.
 *
 * Each entry is three files named by a hash of its key, so no repository,
 * path or commit is in a file name: `<id>.content.json`, `<id>.guide.json`
 * once its guide is built, and `<id>.meta.json`, written last, which says
 * the entry is whole. Every file is written whole or not at all. A file that
 * doesn't read back drops its entry, and the pull request is read again.
 *
 * No error leaves this module with a path in it: a cache that can't read or
 * write is a cache that misses, and Deck reads through the plugin instead.
 */

/** One pull request's connection. */
export type DeckCacheSource = { pluginId: string; connectionId: string };

/** A pull request at one base and head. */
export interface DeckCacheKey extends DeckCacheSource {
  repository: string;
  number: number;
  baseSha: string;
  headSha: string;
}

/** What Deck read and built of a pull request, before its guide. */
export interface DeckCachedContent {
  diff: DeckPullRequestDiff;
  guideInput: GuideBuildInput;
}

/** An entry as it comes back: its key, contents and guide, null until built. */
export interface DeckCachedEntry extends DeckCachedContent {
  key: DeckCacheKey;
  guide: DeckGuide | null;
}

export interface DeckCacheUsage {
  /** The entries' contents and guides. */
  sizeBytes: number;
  entryCount: number;
}

/** The format of the files below. Another version's files are dropped. */
const VERSION = 1;

const keySchema = z.object({
  pluginId: z.string(),
  connectionId: z.string(),
  repository: z.string(),
  number: z.number(),
  baseSha: z.string(),
  headSha: z.string(),
});

const metaSchema = z.object({
  version: z.literal(VERSION),
  key: keySchema,
  /** The pull request was merged or closed at its last sync. */
  closed: z.boolean(),
  lastUsedAt: z.number(),
  contentBytes: z.number().int().nonnegative(),
  /** Zero until the guide is built. */
  guideBytes: z.number().int().nonnegative(),
});
type Meta = z.infer<typeof metaSchema>;

const textMapSchema = z.array(z.tuple([z.string(), z.string()]));
const contentSchema = z.object({
  version: z.literal(VERSION),
  key: keySchema,
  diff: deckPullRequestDiffSchema,
  guideInput: z.object({
    diff: z.string(),
    old: textMapSchema,
    new: textMapSchema,
  }),
});
const guideFileSchema = z.object({
  version: z.literal(VERSION),
  guide: deckGuideSchema,
});

/** The key as one string, as Deck's guide builds name a pull request. */
export const deckCacheKeyString = (key: DeckCacheKey) =>
  JSON.stringify([
    key.pluginId,
    key.connectionId,
    key.repository,
    key.number,
    key.baseSha,
    key.headSha,
  ]);

const idOf = (key: DeckCacheKey) =>
  createHash("sha256")
    .update(deckCacheKeyString(key))
    .digest("hex")
    .slice(0, 40);

const ENTRY_FILE = /^([0-9a-f]{40})\.(meta|content|guide)\.json$/;
const PARTS = ["content", "guide", "meta"] as const;

const sameKey = (a: DeckCacheKey, b: DeckCacheKey) =>
  deckCacheKeyString(a) === deckCacheKeyString(b);

export function createDeckContentCache(options: {
  directory: string;
  /** The cap now: the user's, from Settings › Storage, or the default. */
  capBytes: () => Promise<number>;
  now?: () => number;
  /** An entry left the cache: its guide build, if one waits, needn't run. */
  onRemoved?: (key: DeckCacheKey) => void;
}) {
  const { directory } = options;
  const now = options.now ?? Date.now;
  const fileOf = (id: string, part: (typeof PARTS)[number]) =>
    path.join(directory, `${id}.${part}.json`);

  /** The whole entries, by id, as their meta files say. */
  const entries = new Map<string, Meta>();
  /** The pull request on screen, which is never evicted. */
  let kept: string | undefined;

  /**
   * Every read and write runs one after the other, so an eviction never
   * races a write and `usage` counts what is on disk.
   */
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(task: () => Promise<T>): Promise<T> => {
    const run = queue.then(task);
    queue = run.catch(() => undefined);
    return run;
  };

  const removeFiles = async (id: string) => {
    // The meta goes first: files left without one are dropped at the next start.
    for (const part of ["meta", "content", "guide"] as const) {
      await rm(fileOf(id, part), { force: true, maxRetries: 3 }).catch(
        () => undefined,
      );
    }
  };

  const remove = async (id: string) => {
    const meta = entries.get(id);
    entries.delete(id);
    await removeFiles(id);
    if (meta && id !== kept) options.onRemoved?.(meta.key);
  };

  const writeMeta = (id: string, meta: Meta) =>
    writeFileAtomically(fileOf(id, "meta"), JSON.stringify(meta));

  /** Reads what the folder holds, once, and drops what isn't whole. */
  let loaded: Promise<void> | undefined;
  const load = () =>
    (loaded ??= (async () => {
      let names: string[];
      try {
        await mkdir(directory, { recursive: true, mode: 0o700 });
        names = await readdir(directory);
      } catch {
        return;
      }
      const parts = new Map<string, Set<string>>();
      for (const name of names) {
        const match = ENTRY_FILE.exec(name);
        if (!match) {
          // A temp file an interrupted write left.
          if (name.endsWith(".tmp")) {
            await rm(path.join(directory, name), { force: true }).catch(
              () => undefined,
            );
          }
          continue;
        }
        const [, id, part] = match;
        parts.set(id!, (parts.get(id!) ?? new Set()).add(part!));
      }
      for (const [id, found] of parts) {
        let meta: Meta | undefined;
        if (found.has("meta") && found.has("content")) {
          try {
            const parsed = metaSchema.safeParse(
              JSON.parse(await readFile(fileOf(id, "meta"), "utf8")),
            );
            if (parsed.success && idOf(parsed.data.key) === id) {
              meta = parsed.data;
            }
          } catch {
            meta = undefined;
          }
        }
        if (!meta) {
          await removeFiles(id);
          continue;
        }
        if (meta.guideBytes > 0 && !found.has("guide")) {
          meta = { ...meta, guideBytes: 0 };
        }
        entries.set(id, meta);
      }
    })());

  const total = () =>
    [...entries.values()].reduce(
      (sum, meta) => sum + meta.contentBytes + meta.guideBytes,
      0,
    );

  /** Closed pull requests first, then the least recently used. */
  const evictNow = async () => {
    const cap = await options.capBytes();
    let size = total();
    if (size <= cap) return;
    const candidates = [...entries]
      .filter(([id]) => id !== kept)
      .sort(
        ([, a], [, b]) =>
          Number(b.closed) - Number(a.closed) || a.lastUsedAt - b.lastUsedAt,
      );
    for (const [id, meta] of candidates) {
      if (size <= cap) break;
      size -= meta.contentBytes + meta.guideBytes;
      await remove(id);
    }
  };

  /** The entry's files, read back; undefined, and dropped, when one doesn't read. */
  const read = async (id: string): Promise<DeckCachedEntry | undefined> => {
    const meta = entries.get(id);
    if (!meta) return undefined;
    try {
      const content = contentSchema.parse(
        JSON.parse(await readFile(fileOf(id, "content"), "utf8")),
      );
      if (!sameKey(content.key, meta.key)) throw new Error("Not its entry.");
      let guide: DeckGuide | null = null;
      if (meta.guideBytes > 0) {
        const parsed = guideFileSchema.safeParse(
          JSON.parse(
            await readFile(fileOf(id, "guide"), "utf8").catch(() => "null"),
          ),
        );
        if (parsed.success) guide = parsed.data.guide;
      }
      const used: Meta = {
        ...meta,
        lastUsedAt: now(),
        // A guide that doesn't read back is built again.
        guideBytes: guide ? meta.guideBytes : 0,
      };
      entries.set(id, used);
      await writeMeta(id, used).catch(() => undefined);
      return {
        key: meta.key,
        diff: content.diff,
        guideInput: {
          diff: content.guideInput.diff,
          old: new Map(content.guideInput.old),
          new: new Map(content.guideInput.new),
        },
        guide,
      };
    } catch {
      await remove(id);
      return undefined;
    }
  };

  return {
    /** The entry at exactly this base and head, as used now. */
    get(key: DeckCacheKey) {
      return serial(async () => {
        await load();
        return read(idOf(key));
      });
    },

    /**
     * The pull request at this head, whatever its base: the one used last
     * when a rebase left several. Undefined when none is cached.
     */
    find(ref: Omit<DeckCacheKey, "baseSha">) {
      return serial(async () => {
        await load();
        const matches = [...entries]
          .filter(
            ([, meta]) =>
              meta.key.pluginId === ref.pluginId &&
              meta.key.connectionId === ref.connectionId &&
              meta.key.repository === ref.repository &&
              meta.key.number === ref.number &&
              meta.key.headSha === ref.headSha,
          )
          .sort(([, a], [, b]) => b.lastUsedAt - a.lastUsedAt);
        for (const [id] of matches) {
          const entry = await read(id);
          if (entry) return entry;
        }
        return undefined;
      });
    },

    /**
     * Whether the entry is cached, and with its guide, counted as used now,
     * without reading its contents.
     */
    peek(key: DeckCacheKey) {
      return serial(async () => {
        await load();
        const id = idOf(key);
        const meta = entries.get(id);
        if (!meta) return undefined;
        const used = { ...meta, lastUsedAt: now() };
        entries.set(id, used);
        await writeMeta(id, used).catch(() => undefined);
        return { hasGuide: used.guideBytes > 0 };
      });
    },

    /**
     * Keeps a pull request's contents, then evicts down to the cap. A
     * pull request too large to write is simply not cached.
     */
    put(key: DeckCacheKey, content: DeckCachedContent) {
      return serial(async () => {
        await load();
        const id = idOf(key);
        try {
          const text = JSON.stringify({
            version: VERSION,
            key,
            diff: content.diff,
            guideInput: {
              diff: content.guideInput.diff,
              old: [...content.guideInput.old],
              new: [...content.guideInput.new],
            },
          });
          const previous = entries.get(id);
          await writeFileAtomically(fileOf(id, "content"), text);
          const meta: Meta = {
            version: VERSION,
            key,
            closed: previous?.closed ?? false,
            lastUsedAt: now(),
            contentBytes: Buffer.byteLength(text),
            guideBytes: 0,
          };
          await rm(fileOf(id, "guide"), { force: true });
          await writeMeta(id, meta);
          entries.set(id, meta);
        } catch {
          // Too large to serialize, or the disk refused: not cached.
          await remove(id);
          return;
        }
        await evictNow();
      });
    },

    /** Adds its built guide to an entry still cached. */
    putGuide(key: DeckCacheKey, guide: DeckGuide) {
      return serial(async () => {
        await load();
        const id = idOf(key);
        const meta = entries.get(id);
        if (!meta) return;
        try {
          const text = JSON.stringify({ version: VERSION, guide });
          await writeFileAtomically(fileOf(id, "guide"), text);
          const next = { ...meta, guideBytes: Buffer.byteLength(text) };
          await writeMeta(id, next);
          entries.set(id, next);
        } catch {
          return;
        }
        await evictNow();
      });
    },

    /** The pull request on screen, never evicted; none once undefined. */
    keep(key: DeckCacheKey | undefined) {
      kept = key ? idOf(key) : undefined;
    },

    /**
     * Records which of a connection's pull requests a sync found merged or
     * closed, so they're evicted first, and which are open again.
     */
    markClosed(
      source: DeckCacheSource,
      pullRequests: {
        repository: string;
        number: number;
        state: CodeHostPullRequestState;
      }[],
    ) {
      return serial(async () => {
        await load();
        const states = new Map(
          pullRequests.map((pull) => [
            JSON.stringify([pull.repository, pull.number]),
            pull.state !== "open",
          ]),
        );
        for (const [id, meta] of entries) {
          if (
            meta.key.pluginId !== source.pluginId ||
            meta.key.connectionId !== source.connectionId
          ) {
            continue;
          }
          const closed = states.get(
            JSON.stringify([meta.key.repository, meta.key.number]),
          );
          if (closed === undefined || closed === meta.closed) continue;
          const next = { ...meta, closed };
          entries.set(id, next);
          await writeMeta(id, next).catch(() => undefined);
        }
      });
    },

    /** Removes a deleted connection's entries. */
    forgetConnection(source: DeckCacheSource) {
      return serial(async () => {
        await load();
        for (const [id, meta] of [...entries]) {
          if (
            meta.key.pluginId === source.pluginId &&
            meta.key.connectionId === source.connectionId
          ) {
            await remove(id);
          }
        }
      });
    },

    /** Removes every entry, the one on screen included. */
    clear() {
      return serial(async () => {
        await load();
        for (const id of [...entries.keys()]) await remove(id);
        // Anything else an older version or a crash left.
        let names: string[] = [];
        try {
          names = await readdir(directory);
        } catch {
          return;
        }
        for (const name of names) {
          if (ENTRY_FILE.test(name) || name.endsWith(".tmp")) {
            await rm(path.join(directory, name), { force: true }).catch(
              () => undefined,
            );
          }
        }
      });
    },

    /** Evicts down to the cap now, as after the cap is lowered. */
    evict() {
      return serial(async () => {
        await load();
        await evictNow();
      });
    },

    usage(): Promise<DeckCacheUsage> {
      return serial(async () => {
        await load();
        return { sizeBytes: total(), entryCount: entries.size };
      });
    },
  };
}

export type DeckContentCache = ReturnType<typeof createDeckContentCache>;
