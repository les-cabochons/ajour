import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { CodeHostPullRequestState } from "../../../packages/shared/code-host.ts";
import {
  deckGuideSchema,
  deckPullRequestDiffSchema,
  deckSinceReviewSchema,
  type DeckGuide,
  type DeckPullRequestDiff,
  type DeckSinceReview,
} from "../../../packages/shared/deck.ts";
import { writeFileAtomically } from "./atomic-file.ts";
import type { GuideBuildInput } from "./deck-guide-builds.ts";

/*
 * Deck's content cache (#596, #781): what Deck read of a pull request at one
 * base and head, on disk under the local API's data folder, so it opens at
 * once and survives a restart. An entry holds both versions of each changed
 * file, the built diff, the guide once it is built, the guide an agent
 * regrouped (#794) beside it, and what changed since each version the user
 * reviewed (#787), per version pair. A new push makes a
 * new entry; the old one stays until it is evicted. Over the cap, closed
 * pull requests go first, then the least recently used, never the one on
 * screen. Draft reviews never live here: they're the window's.
 *
 * Each entry is up to five files named by a hash of its key, so no
 * repository, path or commit is in a file name: `<id>.content.json`,
 * `<id>.guide.json` once its guide is built, `<id>.agent.json` once an
 * agent regrouped it, `<id>.since.json` once a
 * comparison with a reviewed version is, and `<id>.meta.json`, which says
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
  /** The guide an agent regrouped (#794), null without one. */
  agentGuide: DeckGuide | null;
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
  /** Zero until a comparison with a reviewed version is saved. Absent before #787. */
  sinceBytes: z.number().int().nonnegative().default(0),
  /** Zero until an agent regroups the guide. Absent before #794. */
  agentBytes: z.number().int().nonnegative().default(0),
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
/** The comparisons kept per entry: the reviewed versions compared last. */
const SINCE_RESULTS_KEPT = 20;
const sinceFileSchema = z.object({
  version: z.literal(VERSION),
  /** Oldest first, by the reviewed version's head. */
  results: z.array(deckSinceReviewSchema),
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

const ENTRY_FILE = /^([0-9a-f]{40})\.(meta|content|guide|agent|since)\.json$/;
type Part = "meta" | "content" | "guide" | "agent" | "since";

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

const PARTS: Part[] = ["content", "guide", "agent", "since", "meta"];
/** The bytes of an entry's contents, guides and comparisons files, as counted. */
type PartSizes = {
  content?: number;
  guide?: number;
  agent?: number;
  since?: number;
};
const bytesOf = (sizes: PartSizes) =>
  (sizes.content ?? 0) +
  (sizes.guide ?? 0) +
  (sizes.agent ?? 0) +
  (sizes.since ?? 0);
const sizesOf = (meta: Meta): PartSizes => ({
  content: meta.contentBytes,
  guide: meta.guideBytes,
  agent: meta.agentBytes,
  since: meta.sinceBytes,
});

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
    agent: await sizeOf(fileOf(id, "agent")),
    since: await sizeOf(fileOf(id, "since")),
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
      ? sizesOf(meta)
      : (leftovers.get(id) ?? (await sizesOnDisk(id)));
    if (meta) {
      entries.delete(id);
      if (id !== kept) options.onRemoved?.(meta.key);
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
        if (meta.agentBytes > 0 && !found.has("agent")) {
          meta = { ...meta, agentBytes: 0 };
        }
        if (meta.sinceBytes > 0 && !found.has("since")) {
          meta = { ...meta, sinceBytes: 0 };
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
      (sum, meta) => sum + bytesOf(sizesOf(meta)),
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
      const readGuide = async (part: "guide" | "agent", bytes: number) => {
        if (bytes === 0) return null;
        const parsed = guideFileSchema.safeParse(
          JSON.parse(
            await readFile(fileOf(id, part), "utf8").catch(() => "null"),
          ),
        );
        return parsed.success ? parsed.data.guide : null;
      };
      const guide = await readGuide("guide", meta.guideBytes);
      const agentGuide = await readGuide("agent", meta.agentBytes);
      const used: Meta = {
        ...meta,
        lastUsedAt: now(),
        // A guide that doesn't read back is built again; an agent's is gone.
        guideBytes: guide ? meta.guideBytes : 0,
        agentBytes: agentGuide ? meta.agentBytes : 0,
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
        agentGuide,
      };
    } catch {
      await remove(id);
      return undefined;
    }
  };

  /** An entry's saved comparisons; undefined when its file doesn't read back. */
  const readSince = async (
    id: string,
  ): Promise<DeckSinceReview[] | undefined> => {
    try {
      const parsed = sinceFileSchema.safeParse(
        JSON.parse(await readFile(fileOf(id, "since"), "utf8")),
      );
      return parsed.success ? parsed.data.results : undefined;
    } catch {
      return undefined;
    }
  };

  /** Writes an entry's built or agent guide, and counts it. */
  const putGuidePart = (
    key: DeckCacheKey,
    part: "guide" | "agent",
    guide: DeckGuide,
  ) =>
    serial(async () => {
      await load();
      const id = idOf(key);
      const meta = entries.get(id);
      if (!meta) return;
      try {
        const text = JSON.stringify({ version: VERSION, guide });
        await writeFileAtomically(fileOf(id, part), text);
        const bytes = Buffer.byteLength(text);
        const next =
          part === "guide"
            ? { ...meta, guideBytes: bytes }
            : { ...meta, agentBytes: bytes };
        await writeMeta(id, next);
        entries.set(id, next);
      } catch {
        return;
      }
      await evictNow();
    });

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
            sinceBytes: 0,
            agentBytes: 0,
          };
          // Guides or comparisons an older entry left, without its meta, aren't this one's.
          for (const part of ["guide", "agent", "since"] as const) {
            if (!(await deleteFile(fileOf(id, part)))) {
              throw new Error("An older part stays.");
            }
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
      return putGuidePart(key, "guide", guide);
    },

    /**
     * Keeps the guide an agent regrouped (#794) with an entry still cached,
     * beside the built one, in place of an earlier agent's.
     */
    putAgentGuide(key: DeckCacheKey, guide: DeckGuide) {
      return putGuidePart(key, "agent", guide);
    },

    /** Drops an entry's agent guide, so the built one shows again. */
    dropAgentGuide(key: DeckCacheKey) {
      return serial(async () => {
        await load();
        const id = idOf(key);
        const meta = entries.get(id);
        if (!meta || meta.agentBytes === 0) return;
        // The meta says it's gone first: a file that stays is never read.
        const next = { ...meta, agentBytes: 0 };
        try {
          await writeMeta(id, next);
        } catch {
          return;
        }
        entries.set(id, next);
        await deleteFile(fileOf(id, "agent"));
      });
    },

    /**
     * What changed in an entry since the version whose head is
     * `reviewedHead`, as saved; undefined when it wasn't compared yet, or
     * its file doesn't read back.
     */
    getSince(key: DeckCacheKey, reviewedHead: string) {
      return serial(async () => {
        await load();
        const meta = entries.get(idOf(key));
        if (!meta || meta.sinceBytes === 0) return undefined;
        return (await readSince(idOf(key)))?.find(
          (result) => result.reviewedHead === reviewedHead,
        );
      });
    },

    /**
     * Saves what changed in an entry still cached since a reviewed
     * version, replacing an older answer for the same pair. The entry keeps
     * the last few pairs compared.
     */
    putSince(key: DeckCacheKey, result: DeckSinceReview) {
      return serial(async () => {
        await load();
        const id = idOf(key);
        const meta = entries.get(id);
        if (!meta || result.head !== key.headSha) return;
        try {
          const kept = (meta.sinceBytes > 0 ? await readSince(id) : []) ?? [];
          const results = [
            ...kept.filter(
              (saved) => saved.reviewedHead !== result.reviewedHead,
            ),
            result,
          ].slice(-SINCE_RESULTS_KEPT);
          const text = JSON.stringify({ version: VERSION, results });
          await writeFileAtomically(fileOf(id, "since"), text);
          const next = { ...meta, sinceBytes: Buffer.byteLength(text) };
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
