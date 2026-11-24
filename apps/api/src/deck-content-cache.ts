import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rm, stat } from "node:fs/promises";
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
 * An entry being removed leaves at once, but its files count until they are
 * gone: one Windows holds is deleted again at the next pass, or start.
 * `removals.json` names the entries being removed, by id, and is written
 * before their files are deleted, so a start never loads one whose files
 * all stayed.
 *
 * No error leaves this module with a path in it: a cache that can't read or
 * write is a cache that misses, and Deck reads through the plugin instead.
 */

/** One pull request's connection. */
export type DeckCacheSource = { pluginId: string; connectionId: string };

/** A connection, or every connection of a plugin. */
export type DeckCacheForgotten = { pluginId: string; connectionId?: string };

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
  /** The entries' contents and guides, those not deleted yet included. */
  sizeBytes: number;
  entryCount: number;
  /** The entries removed whose files couldn't be deleted yet. */
  pendingRemovalCount: number;
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
const ID = /^[0-9a-f]{40}$/;
const removalsSchema = z.object({
  version: z.literal(VERSION),
  ids: z.array(z.string().regex(ID)),
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
type Part = "meta" | "content" | "guide";

/** Delete errors Windows gives for a moment while another process, such as an antivirus scan, holds the file. */
const TRANSIENT_DELETE_CODES = new Set(["EPERM", "EACCES", "EBUSY"]);
const DELETE_ATTEMPTS = 5;

/**
 * Deletes a file, trying again a few times while Windows holds it (`rm`
 * retries only folders). True once it is gone, false when it stays.
 */
async function deleteFile(file: string): Promise<boolean> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      await rm(file, { force: true });
      return true;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException | undefined)?.code;
      if (
        attempt >= DELETE_ATTEMPTS ||
        code === undefined ||
        !TRANSIENT_DELETE_CODES.has(code)
      ) {
        return false;
      }
      await new Promise((resolve) => setTimeout(resolve, 20 * attempt));
    }
  }
}

const sameKey = (a: DeckCacheKey, b: DeckCacheKey) =>
  deckCacheKeyString(a) === deckCacheKeyString(b);

const ofSource = (key: DeckCacheKey, source: DeckCacheForgotten) =>
  key.pluginId === source.pluginId &&
  (source.connectionId === undefined ||
    key.connectionId === source.connectionId);

const PARTS: Part[] = ["content", "guide", "meta"];
/** The bytes of an entry's contents and guide files, as counted. */
type PartSizes = { content?: number; guide?: number };
const bytesOf = (sizes: PartSizes) => (sizes.content ?? 0) + (sizes.guide ?? 0);

/** A file's size, zero once it is gone. */
const sizeOf = (file: string) =>
  stat(file).then(
    (found) => (found.isFile() ? found.size : 0),
    () => 0,
  );

export function createDeckContentCache(options: {
  directory: string;
  /** The cap now: the user's, from Settings › Storage, or the default. */
  capBytes: () => Promise<number>;
  now?: () => number;
  /** An entry left the cache: its guide build, if one waits, needn't run. */
  onRemoved?: (key: DeckCacheKey) => void;
  /**
   * Any entry left the cache, the one on screen included, as a clear or a
   * deleted connection removes it: what lives with it, such as the worktree
   * of the user's clone (#795), goes too.
   */
  onLeft?: (key: DeckCacheKey) => void;
}) {
  const { directory } = options;
  const now = options.now ?? Date.now;
  const fileOf = (id: string, part: Part) =>
    path.join(directory, `${id}.${part}.json`);
  const removalsFile = path.join(directory, "removals.json");

  /** The whole entries, by id, as their meta files say. */
  const entries = new Map<string, Meta>();
  /**
   * The files of removed entries not deleted yet, by id, with their bytes:
   * they are never read again, and count until they are gone.
   */
  const leftovers = new Map<string, PartSizes>();
  /** The pull request on screen, which is never evicted. */
  let kept: string | undefined;
  /**
   * How often each plugin and each connection was forgotten. Work begun
   * before writes nothing: its connection may be gone.
   */
  const forgotten = new Map<string, number>();
  const generationOf = (pluginId: string, connectionId: string) =>
    (forgotten.get(JSON.stringify([pluginId])) ?? 0) +
    (forgotten.get(JSON.stringify([pluginId, connectionId])) ?? 0);

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

  /** Each file's size, read on disk: zero for one that's gone. */
  const sizesOnDisk = async (id: string): Promise<PartSizes> => ({
    content: await sizeOf(fileOf(id, "content")),
    guide: await sizeOf(fileOf(id, "guide")),
  });

  /**
   * Deletes an entry's files, its contents first and its meta last, trying
   * each even when one stays, so a meta rarely outlives its contents: a
   * start deletes what it finds without both. What stays is a leftover,
   * counted at `sizes`, until a later pass deletes it.
   */
  const removeFiles = async (id: string, sizes: PartSizes) => {
    const left: PartSizes = {};
    let stays = false;
    for (const part of PARTS) {
      if (await deleteFile(fileOf(id, part))) continue;
      stays = true;
      if (part !== "meta") left[part] = sizes[part] ?? 0;
    }
    if (stays) leftovers.set(id, left);
    else leftovers.delete(id);
  };

  /**
   * Saves the entries being removed, or deletes the list once there are
   * none. A list that can't be saved leaves the removal to this run.
   */
  const saveRemovals = async (ids: Iterable<string>) => {
    const list = [...ids];
    try {
      if (list.length) {
        await writeFileAtomically(
          removalsFile,
          JSON.stringify({ version: VERSION, ids: list }),
        );
      } else {
        await deleteFile(removalsFile);
      }
    } catch {
      return;
    }
  };

  /**
   * Removes an entry, or deletes again what a removal left. The entry is
   * never read again, even while a file of it stays.
   */
  const removeOne = async (id: string) => {
    const meta = entries.get(id);
    const sizes = meta
      ? { content: meta.contentBytes, guide: meta.guideBytes }
      : (leftovers.get(id) ?? (await sizesOnDisk(id)));
    if (meta) {
      entries.delete(id);
      if (id !== kept) options.onRemoved?.(meta.key);
      options.onLeft?.(meta.key);
    }
    await removeFiles(id, sizes);
  };

  /**
   * Removes entries, saying so on disk first, so a start never loads one
   * whose files stayed. The list then names only what stayed.
   */
  const remove = async (...ids: string[]) => {
    if (!ids.length) return;
    await saveRemovals(new Set([...leftovers.keys(), ...ids]));
    for (const id of ids) await removeOne(id);
    await saveRemovals(leftovers.keys());
  };

  /** Deletes again the files earlier removals left. */
  const removeLeftovers = async () => {
    if (!leftovers.size) return;
    for (const id of [...leftovers.keys()]) await removeOne(id);
    await saveRemovals(leftovers.keys());
  };

  /**
   * The entries a run was removing when it stopped: none without a list,
   * and every entry when the list can't be read, since it may name any.
   */
  const readRemovals = async (): Promise<Set<string> | "all"> => {
    let text: string;
    try {
      text = await readFile(removalsFile, "utf8");
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === "ENOENT"
        ? new Set<string>()
        : "all";
    }
    try {
      const parsed = removalsSchema.safeParse(JSON.parse(text));
      return parsed.success ? new Set(parsed.data.ids) : "all";
    } catch {
      return "all";
    }
  };

  /** Deletes the temp files an interrupted write left. */
  const removeTempFiles = async (names: string[]) => {
    for (const name of names) {
      if (name.endsWith(".tmp")) await deleteFile(path.join(directory, name));
    }
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
      await removeTempFiles(names);
      // What a run was removing is deleted again, never loaded.
      const removing = await readRemovals();
      const parts = new Map<string, Set<string>>();
      for (const name of names) {
        const match = ENTRY_FILE.exec(name);
        if (!match) continue;
        const [, id, part] = match;
        parts.set(id!, (parts.get(id!) ?? new Set()).add(part!));
      }
      for (const [id, found] of parts) {
        let meta: Meta | undefined;
        const removed = removing === "all" || removing.has(id);
        if (!removed && found.has("meta") && found.has("content")) {
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
          await removeFiles(id, await sizesOnDisk(id));
          continue;
        }
        if (meta.guideBytes > 0 && !found.has("guide")) {
          meta = { ...meta, guideBytes: 0 };
        }
        entries.set(id, meta);
      }
      if (removing === "all" || removing.size) {
        await saveRemovals(leftovers.keys());
      }
    })());

  /** What the entries and the leftovers hold on disk. */
  const total = () =>
    [...entries.values()].reduce(
      (sum, meta) => sum + meta.contentBytes + meta.guideBytes,
      0,
    ) + [...leftovers.values()].reduce((sum, sizes) => sum + bytesOf(sizes), 0);

  /**
   * Closed pull requests first, then the least recently used, once what
   * earlier removals left is deleted again. A file that stays still
   * counts, so the next entry goes. A cap that can't be read evicts nothing
   * this time.
   */
  const evictNow = async () => {
    await removeLeftovers();
    let cap: number;
    try {
      cap = await options.capBytes();
    } catch {
      return;
    }
    if (total() <= cap) return;
    const candidates = [...entries]
      .filter(([id]) => id !== kept)
      .sort(
        ([, a], [, b]) =>
          Number(b.closed) - Number(a.closed) || a.lastUsedAt - b.lastUsedAt,
      );
    for (const [id] of candidates) {
      if (total() <= cap) break;
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
     * pull request too large to write is simply not cached. One already
     * cached at this base and head stays as it is, with its guide: the
     * contents of a key never change. `generation` is its connection's when
     * the reads began: a connection removed since then writes nothing.
     */
    put(key: DeckCacheKey, content: DeckCachedContent, generation: number) {
      return serial(async () => {
        await load();
        // Its connection was removed since the reads began.
        if (generationOf(key.pluginId, key.connectionId) !== generation) {
          return;
        }
        const id = idOf(key);
        if (entries.has(id)) return;
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
          await writeFileAtomically(fileOf(id, "content"), text);
          const meta: Meta = {
            version: VERSION,
            key,
            closed: false,
            lastUsedAt: now(),
            contentBytes: Buffer.byteLength(text),
            guideBytes: 0,
          };
          // A guide an older entry left, without its meta, isn't this one's.
          if (!(await deleteFile(fileOf(id, "guide")))) {
            throw new Error("An older guide stays.");
          }
          await writeMeta(id, meta);
          entries.set(id, meta);
          // Read again, it is no longer being removed.
          if (leftovers.delete(id)) await saveRemovals(leftovers.keys());
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

    /** The connection's generation now, which forgetting it moves on. */
    generation(source: DeckCacheSource) {
      return generationOf(source.pluginId, source.connectionId);
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

    /**
     * Removes a deleted connection's entries, or every connection's of a
     * removed plugin. A put whose reads began before, at an older
     * generation, writes nothing.
     */
    forgetConnection(source: DeckCacheForgotten) {
      const at = JSON.stringify(
        source.connectionId === undefined
          ? [source.pluginId]
          : [source.pluginId, source.connectionId],
      );
      forgotten.set(at, (forgotten.get(at) ?? 0) + 1);
      return serial(async () => {
        await load();
        await removeLeftovers();
        await remove(
          ...[...entries]
            .filter(([, meta]) => ofSource(meta.key, source))
            .map(([id]) => id),
        );
      });
    },

    /**
     * Removes every entry, the one on screen included. Files that stay
     * count in `usage` as pending removals.
     */
    clear() {
      return serial(async () => {
        await load();
        await remove(...entries.keys(), ...leftovers.keys());
        // Anything else an older version or a crash left.
        let names: string[] = [];
        try {
          names = await readdir(directory);
        } catch {
          return;
        }
        await removeTempFiles(names);
        const others = new Set<string>();
        for (const name of names) {
          const id = ENTRY_FILE.exec(name)?.[1];
          if (id && !leftovers.has(id)) others.add(id);
        }
        if (!others.size) return;
        await saveRemovals(new Set([...leftovers.keys(), ...others]));
        for (const id of others) await removeFiles(id, await sizesOnDisk(id));
        await saveRemovals(leftovers.keys());
      });
    },

    /** Resolves once every read and write asked for so far has finished. */
    flush(): Promise<void> {
      return serial(async () => {});
    },

    /** Evicts down to the cap now, as after the cap is lowered. */
    evict() {
      return serial(async () => {
        await load();
        await evictNow();
      });
    },

    /** The keys of the entries the cache holds now. */
    keys(): Promise<DeckCacheKey[]> {
      return serial(async () => {
        await load();
        return [...entries.values()].map((meta) => meta.key);
      });
    },

    usage(): Promise<DeckCacheUsage> {
      return serial(async () => {
        await load();
        return {
          sizeBytes: total(),
          entryCount: entries.size + leftovers.size,
          pendingRemovalCount: leftovers.size,
        };
      });
    },
  };
}

export type DeckContentCache = ReturnType<typeof createDeckContentCache>;
