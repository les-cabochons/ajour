import type {
  CodeHostChangedFile,
  CodeHostOperationRequest,
  CodeHostOperationResult,
} from "../../../packages/shared/code-host.ts";
import type {
  DeckFile,
  DeckGuide,
  DeckOpenedPullRequest,
  DeckOpenRequest,
  DeckPullRequestDiff,
} from "../../../packages/shared/deck.ts";
import {
  buildDiff,
  hunkToPatch,
  parseDiff,
} from "../../../packages/review-deck/diff.ts";
import {
  deckCacheKeyString,
  type DeckCacheKey,
  type DeckCachedEntry,
  type DeckContentCache,
} from "./deck-content-cache.ts";
import {
  GuideBuildCancelled,
  type GuideBuildInput,
  type GuideBuilds,
} from "./deck-guide-builds.ts";
import { PluginOperationRefused } from "./plugin-operation-lifetime.ts";

/*
 * Deck's service: it builds a pull request's diff from both versions of
 * each changed file, read through the code host plugin, with Review Deck's
 * vendored `buildDiff` (ADR 0003). The host's patch is never used, so the
 * hunk ids are Review Deck's. Its guide is built from the same diff by the
 * vendored pipeline, in the guide builds' worker thread (#782). What it read
 * and built goes to the content cache on disk (#781), so a pull request
 * opened or preloaded before opens again without reading a file, and one
 * opened at the head the window's last sync saw doesn't ask the code host at
 * all. The pull request on screen is also kept in memory until another one
 * opens, and the cache never evicts it.
 */

/** The code host operations Deck calls, bound to one connection. */
export interface DeckCodeHost {
  run<Operation extends "getPullRequestContent" | "getFileContent">(
    operation: Operation,
    request: CodeHostOperationRequest<Operation>,
  ): Promise<CodeHostOperationResult<Operation>>;
}

/** What opening a pull request did, for its event. Never a path. */
export interface DeckOpened {
  opened: DeckOpenedPullRequest;
  /** The files read through the plugin, both versions counted. */
  fileReadCount: number;
  /** The diff was the one kept for the pull request on screen. */
  kept: boolean;
  /** The diff came from the content cache: no file was read. */
  cached: boolean;
  /** The code host was asked for the pull request's file list. */
  listed: boolean;
}

/** What preloading pull requests did, for its event. */
export interface DeckPreloaded {
  /** The guide builds queued. A pull request already cached is not read again. */
  queued: number;
  fileReadCount: number;
  /** The pull requests that couldn't be read, and were skipped. */
  failed: number;
}

/** A build stopped because another pull request opened meanwhile. */
export class DeckBuildReplaced extends Error {
  constructor() {
    super("Another pull request opened in Deck.");
  }
}

/**
 * Files read at once. The plugin host runs at most 4 operations of a plugin
 * at a time and refuses the rest, so one slot stays free for a sync. A
 * preload reads one at a time, and waits while a pull request opens.
 */
const FILE_READS_AT_ONCE = 3;
const PRELOAD_READS_AT_ONCE = 1;
/** How often, and after how long, an operation the host refused for capacity is tried again. */
const BUSY_RETRIES = 40;
const BUSY_RETRY_MS = 250;

const CHANGE_TYPES = {
  added: "add",
  copied: "add",
  modified: "edit",
  removed: "delete",
  renamed: "rename",
} as const;

/**
 * Runs `tasks` with at most `limit` running at once. It stops starting tasks
 * after the first failure, or once `signal` aborts. `beforeEach` runs before
 * each task starts, as a preload waits while a pull request opens.
 */
async function withConcurrency<T>(
  tasks: (() => Promise<T>)[],
  limit: number,
  signal: AbortSignal,
  beforeEach?: () => Promise<void>,
): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let next = 0;
  let failed = false;
  const worker = async () => {
    while (!failed && next < tasks.length) {
      if (beforeEach) await beforeEach();
      if (signal.aborted) throw new DeckBuildReplaced();
      if (failed || next >= tasks.length) return;
      const index = next++;
      try {
        results[index] = await tasks[index]!();
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, tasks.length) }, worker),
  );
  // Another pull request may have opened during the last reads.
  if (signal.aborted) throw new DeckBuildReplaced();
  return results;
}

/**
 * Runs one code host operation, waiting while the plugin runs as many
 * operations as it may. It stops waiting once `replaced` says another pull
 * request opened.
 */
async function runWhenFree<
  Operation extends "getPullRequestContent" | "getFileContent",
>(
  codeHost: DeckCodeHost,
  operation: Operation,
  request: CodeHostOperationRequest<Operation>,
  replaced: () => boolean,
) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await codeHost.run(operation, request);
    } catch (error) {
      const busy =
        error instanceof PluginOperationRefused && error.reason === "capacity";
      if (!busy || attempt >= BUSY_RETRIES) throw error;
      await new Promise((resolve) => setTimeout(resolve, BUSY_RETRY_MS));
      if (replaced()) throw new DeckBuildReplaced();
    }
  }
}

/** One version of a changed file: its text, or that it is binary. */
type Side = { text: string | null; binary: boolean };
const ABSENT: Side = { text: null, binary: false };

/** Paths compare by UTF-16 code units, so every host lists files the same way. */
const byPath = (a: CodeHostChangedFile, b: CodeHostChangedFile) =>
  a.path < b.path ? -1 : a.path > b.path ? 1 : 0;

/**
 * Where each version of a file is, base then head: an added or copied file
 * has no base version, and a removed one no head version.
 */
function versionsOf(
  file: CodeHostChangedFile,
  content: CodeHostOperationResult<"getPullRequestContent">,
) {
  const changeType = CHANGE_TYPES[file.status];
  return [
    changeType === "add"
      ? null
      : { sha: content.baseSha, path: file.previousPath ?? file.path },
    changeType === "delete" ? null : { sha: content.headSha, path: file.path },
  ];
}

async function buildPullRequestDiff(
  codeHost: DeckCodeHost,
  repository: string,
  content: CodeHostOperationResult<"getPullRequestContent">,
  signal: AbortSignal,
  reads: { atOnce: number; beforeEach?: () => Promise<void> } = {
    atOnce: FILE_READS_AT_ONCE,
  },
) {
  const files = [...content.files].sort(byPath);
  let fileReadCount = 0;
  const fileReads = files.flatMap((file) =>
    versionsOf(file, content).map((version) => async (): Promise<Side> => {
      if (!version) return ABSENT;
      fileReadCount += 1;
      const read = await runWhenFree(
        codeHost,
        "getFileContent",
        { repository, sha: version.sha, path: version.path },
        () => signal.aborted,
      );
      // The file list says this version exists. Without it the diff would
      // show the whole file added or removed, so the open fails instead.
      if (read.kind === "missing") {
        throw new Error(
          "The code host has no version of a changed file at a commit the pull request names.",
        );
      }
      return read.kind === "binary"
        ? { text: null, binary: true }
        : { text: read.content, binary: false };
    }),
  );
  const sides = await withConcurrency(
    fileReads,
    reads.atOnce,
    signal,
    reads.beforeEach,
  );

  const changes = files.map((file) => ({
    path: file.path,
    ...(file.status === "renamed" && file.previousPath
      ? { originalPath: file.previousPath }
      : {}),
    changeType:
      file.status === "renamed" && !file.previousPath
        ? ("edit" as const)
        : CHANGE_TYPES[file.status],
  }));
  const contents = new Map(
    files.map((file, index) => {
      const old = sides[index * 2]!;
      const head = sides[index * 2 + 1]!;
      return [
        file.path,
        {
          old: old.text,
          new: head.text,
          binary: old.binary || head.binary,
          tooLarge: false,
        },
      ];
    }),
  );
  const diffText = buildDiff(changes, contents);
  // The pipeline reads a file's base version by its base path.
  const guideInput: GuideBuildInput = {
    diff: diffText,
    old: new Map(),
    new: new Map(),
  };
  files.forEach((file, index) => {
    const [base, head] = versionsOf(file, content);
    const old = sides[index * 2]!.text;
    const next = sides[index * 2 + 1]!.text;
    if (base && old !== null) guideInput.old.set(base.path, old);
    if (head && next !== null) guideInput.new.set(head.path, next);
  });
  const diffFiles: DeckFile[] = parseDiff(diffText).map((file) => ({
    path: file.path,
    ...(file.status === "renamed" && file.oldPath
      ? { previousPath: file.oldPath }
      : {}),
    status: file.status,
    binary: file.binary,
    hunks: file.hunks.map((hunk) => ({
      id: hunk.id,
      header: hunk.header,
      oldStart: hunk.oldStart,
      oldLines: hunk.oldLines,
      newStart: hunk.newStart,
      newLines: hunk.newLines,
      patch: hunkToPatch(file, hunk),
    })),
  }));
  return {
    diff: {
      headSha: content.headSha,
      baseSha: content.baseSha,
      files: diffFiles,
    },
    guideInput,
    fileReadCount,
  };
}

/** The pull request on screen at one base and head: its diff and its guide. */
interface Entry {
  key: DeckCacheKey;
  id: string;
  diff: Promise<DeckPullRequestDiff>;
  /** Null when the pipeline failed. It rejects only when the build was cancelled. */
  guide: Promise<DeckGuide | null>;
  stop: AbortController;
}

type DeckSource = { pluginId: string; connectionId: string };

const keyOf = (
  source: DeckSource,
  request: DeckOpenRequest,
  content: { baseSha: string; headSha: string },
): DeckCacheKey => ({
  pluginId: source.pluginId,
  connectionId: source.connectionId,
  repository: request.repository,
  number: request.number,
  baseSha: content.baseSha,
  headSha: content.headSha,
});

/** The same pull request at the same head, whatever its base. */
const sameHead = (key: DeckCacheKey, at: Omit<DeckCacheKey, "baseSha">) =>
  deckCacheKeyString({ ...key, baseSha: "" }) ===
  deckCacheKeyString({ ...at, baseSha: "" });

/** A failed build gives no guide, and the page shows the files A–Z. A cancelled one stays a rejection. */
const guideOrNull = (built: Promise<DeckGuide>) =>
  built.catch((error: unknown) => {
    if (error instanceof GuideBuildCancelled) throw error;
    return null;
  });

/** One local API's Deck service. */
export function createDeckService(options: {
  guides: GuideBuilds;
  cache: DeckContentCache;
}) {
  const { guides, cache } = options;
  /**
   * The pull request on screen: the last one opened, at its base and head.
   * Opening another stops its reads and its guide build, so they don't hold
   * the plugin's operation slots or the worker. The cache never evicts it.
   */
  let onScreen: Entry | undefined;
  const show = (entry: Entry | undefined) => {
    onScreen = entry;
    cache.keep(entry?.key);
  };
  /** Counts the opens, so the last one wins whatever order their file lists come back in. */
  let lastOpen = 0;
  /** The opens still reading their file lists or files, which preloads wait for. */
  const opening = new Set<Promise<void>>();
  /** Preload requests run one after the other. */
  let preloading: Promise<unknown> = Promise.resolve();

  const opensDone = async () => {
    while (opening.size) await Promise.allSettled([...opening]);
  };

  /**
   * The guide of `key`, built from `input` at `priority`, and saved to its
   * cache entry once built. A build already queued for it, as a preload's,
   * is shared, and moves ahead for an open.
   */
  const buildGuide = (
    key: DeckCacheKey,
    input: GuideBuildInput,
    priority: "open" | "preload",
    signal?: AbortSignal,
  ) => {
    const guide = guideOrNull(
      guides.build(deckCacheKeyString(key), input, priority, signal),
    );
    guide.then(
      (built) => {
        if (built) void cache.putGuide(key, built);
      },
      () => {},
    );
    return guide;
  };

  /** The entry's diff and guide, once both are ready. */
  const answer = async (
    entry: Entry,
    facts: Omit<DeckOpened, "opened">,
  ): Promise<DeckOpened> => {
    const diff = await entry.diff;
    let guide: DeckGuide | null;
    try {
      guide = await entry.guide;
    } catch (error) {
      if (error instanceof GuideBuildCancelled) throw new DeckBuildReplaced();
      throw error;
    }
    if (entry.stop.signal.aborted) throw new DeckBuildReplaced();
    // A failed guide isn't kept: opening it again builds it again, from the cache.
    if (guide === null && onScreen === entry) show(undefined);
    return { opened: { ...diff, guide }, ...facts };
  };

  /** Puts a cached pull request on screen, building its guide if it has none. */
  const openCached = (
    found: DeckCachedEntry,
    facts: Omit<DeckOpened, "opened" | "cached">,
  ) => {
    onScreen?.stop.abort();
    const stop = new AbortController();
    const entry: Entry = {
      key: found.key,
      id: deckCacheKeyString(found.key),
      diff: Promise.resolve(found.diff),
      guide: found.guide
        ? Promise.resolve(found.guide)
        : buildGuide(found.key, found.guideInput, "open", stop.signal),
      stop,
    };
    entry.guide.catch(() => {});
    show(entry);
    return answer(entry, { ...facts, cached: true });
  };

  async function openPullRequest(
    source: DeckSource,
    request: DeckOpenRequest,
    codeHost: DeckCodeHost,
  ): Promise<DeckOpened> {
    // Preloads wait from the file list to the last file read.
    let doneReading!: () => void;
    const reading = new Promise<void>((resolve) => {
      doneReading = resolve;
    });
    opening.add(reading);
    try {
      return await openNow(source, request, codeHost, () => {
        opening.delete(reading);
        doneReading();
      });
    } finally {
      opening.delete(reading);
      doneReading();
    }
  }

  async function openNow(
    source: DeckSource,
    request: DeckOpenRequest,
    codeHost: DeckCodeHost,
    doneReading: () => void,
  ): Promise<DeckOpened> {
    const open = ++lastOpen;
    const replaced = () => open !== lastOpen;
    const none = { fileReadCount: 0, kept: false, cached: false };
    const ref = { repository: request.repository, number: request.number };

    // At the head the last sync saw, the cache answers without the code host.
    if (request.headSha) {
      const at = { ...source, ...ref, headSha: request.headSha };
      if (onScreen && sameHead(onScreen.key, at)) {
        doneReading();
        return answer(onScreen, { ...none, kept: true, listed: false });
      }
      const found = await cache.find(at);
      if (replaced()) throw new DeckBuildReplaced();
      if (found) {
        doneReading();
        return openCached(found, { ...none, listed: false });
      }
    }

    const content = await runWhenFree(
      codeHost,
      "getPullRequestContent",
      ref,
      replaced,
    );
    // A later open owns the screen: this one neither replaces it nor stops its build.
    if (replaced()) throw new DeckBuildReplaced();
    const key = keyOf(source, request, content);
    const id = deckCacheKeyString(key);
    const listed = { ...none, listed: true };
    if (onScreen?.id === id) {
      doneReading();
      return answer(onScreen, { ...listed, kept: true });
    }
    const found = await cache.get(key);
    if (replaced()) throw new DeckBuildReplaced();
    if (found) {
      doneReading();
      return openCached(found, listed);
    }
    // Its reads and its guide build stop.
    onScreen?.stop.abort();

    const stop = new AbortController();
    const built = buildPullRequestDiff(
      codeHost,
      request.repository,
      content,
      stop.signal,
    );
    const entry: Entry = {
      key,
      id,
      diff: built.then((result) => result.diff),
      guide: built.then((result) => {
        void cache.put(key, result);
        return buildGuide(key, result.guideInput, "open", stop.signal);
      }),
      stop,
    };
    // A failure reaches this caller below. A second caller awaits it too.
    entry.diff.catch(() => {});
    entry.guide.catch(() => {});
    show(entry);
    try {
      const { fileReadCount } = await built;
      doneReading();
      return await answer(entry, { ...listed, fileReadCount });
    } catch (error) {
      if (onScreen === entry) show(undefined);
      throw error;
    }
  }

  async function preloadOne(
    source: DeckSource,
    request: DeckOpenRequest,
    codeHost: DeckCodeHost,
  ): Promise<Omit<DeckPreloaded, "failed">> {
    const ref = { repository: request.repository, number: request.number };
    const skipped = { queued: 0, fileReadCount: 0 };
    /**
     * A pull request cached at `key` isn't read again, and one cached
     * without its guide gets its build queued again. Undefined when it
     * isn't cached.
     */
    const fromCache = async (key: DeckCacheKey) => {
      if (onScreen?.id === deckCacheKeyString(key)) return skipped;
      const peeked = await cache.peek(key);
      if (!peeked) return undefined;
      if (peeked.hasGuide) return skipped;
      const found = await cache.get(key);
      if (!found) return undefined;
      void buildGuide(key, found.guideInput, "preload");
      return { queued: 1, fileReadCount: 0 };
    };
    await opensDone();
    if (request.headSha) {
      const at = { ...source, ...ref, headSha: request.headSha };
      if (onScreen && sameHead(onScreen.key, at)) return skipped;
      const found = await cache.find(at);
      if (found) return (await fromCache(found.key)) ?? skipped;
    }
    const content = await runWhenFree(
      codeHost,
      "getPullRequestContent",
      ref,
      () => false,
    );
    const key = keyOf(source, request, content);
    const cached = await fromCache(key);
    if (cached) return cached;
    const stop = new AbortController();
    const result = await buildPullRequestDiff(
      codeHost,
      request.repository,
      content,
      stop.signal,
      { atOnce: PRELOAD_READS_AT_ONCE, beforeEach: opensDone },
    );
    // An open of the same pull request may have read it meanwhile.
    if (onScreen?.id === deckCacheKeyString(key)) {
      return { queued: 0, fileReadCount: result.fileReadCount };
    }
    await cache.put(key, result);
    void buildGuide(key, result.guideInput, "preload");
    return { queued: 1, fileReadCount: result.fileReadCount };
  }

  return {
    /**
     * The pull request's diff from the merge base to the head, and its
     * guide. With the head the window's last sync saw, a pull request the
     * cache holds at that head opens without the code host. Otherwise the
     * file list is read, so a new push is seen, and the files are read only
     * when the cache doesn't hold the pull request at its base and head.
     */
    openPullRequest,

    /**
     * Reads the pull requests into the cache and queues their guide builds
     * at low priority, so they open at once. Each read waits while a pull
     * request opens, and a pull request cached at its head is not read
     * again. One that fails is skipped; when every one fails, the first
     * error is thrown, so a refused token still reaches the caller.
     */
    preloadPullRequests(
      source: DeckSource,
      requests: DeckOpenRequest[],
      codeHost: DeckCodeHost,
    ): Promise<DeckPreloaded> {
      const run = preloading.then(async () => {
        const total = { queued: 0, fileReadCount: 0, failed: 0 };
        let firstError: unknown;
        for (const request of requests) {
          try {
            const one = await preloadOne(source, request, codeHost);
            total.queued += one.queued;
            total.fileReadCount += one.fileReadCount;
          } catch (error) {
            total.failed += 1;
            firstError ??= error;
          }
        }
        if (requests.length && total.failed === requests.length) {
          throw firstError;
        }
        return total;
      });
      preloading = run.catch(() => {});
      return run;
    },

    /** The content cache, for Settings › Storage, syncs and removed connections. */
    cache,

    close: () => guides.close(),
  };
}

export type DeckService = ReturnType<typeof createDeckService>;
