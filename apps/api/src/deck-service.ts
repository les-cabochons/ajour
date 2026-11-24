import type {
  CodeHostChangedFile,
  CodeHostOperationRequest,
  CodeHostOperationResult,
} from "../../../packages/shared/code-host.ts";
import {
  DECK_GUIDE_HUNK_LIMIT,
  type DeckFile,
  type DeckGuide,
  type DeckGuideSkipped,
  type DeckOpenedPullRequest,
  type DeckOpenRequest,
  type DeckPullRequestDiff,
} from "../../../packages/shared/deck.ts";
import {
  buildDiff,
  hunkToPatch,
  parseDiff,
} from "../../../packages/review-deck/diff.ts";
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
 * vendored pipeline, in the guide builds' worker thread (#782). The pull
 * request on screen is kept in memory until another one opens, and the last
 * preloaded ones until they open or newer preloads push them out. The disk
 * cache is a later ticket (#781). A pull request with more hunks than a
 * guide is built for gets none, and the pipeline doesn't run (#790).
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
  /** The diff was one a preload read. */
  preloaded: boolean;
}

/** What preloading pull requests did, for its event. */
export interface DeckPreloaded {
  /** The guide builds queued. A pull request already kept is not read again. */
  queued: number;
  /** The pull requests read and kept with no guide build: they have too many hunks. */
  guideSkipped: number;
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
/** The preloaded pull requests kept in memory. Newer preloads push the oldest out. */
const PRELOADS_KEPT = 20;
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

/**
 * Why the diff gets no guide: it has more hunks than a guide is built for,
 * so neither syntax parsing nor scoring runs (#790).
 */
function guideSkippedFor(
  diff: DeckPullRequestDiff,
): DeckGuideSkipped | undefined {
  const hunks = diff.files.reduce(
    (count, file) => count + file.hunks.length,
    0,
  );
  return hunks > DECK_GUIDE_HUNK_LIMIT
    ? { reason: "too_many_hunks", hunkLimit: DECK_GUIDE_HUNK_LIMIT }
    : undefined;
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

/** A pull request kept in memory at one base and head: its diff and its guide. */
interface Entry {
  key: string;
  diff: Promise<DeckPullRequestDiff>;
  /**
   * Null when the pipeline failed, or didn't run for too many hunks. It
   * rejects only when the build was cancelled.
   */
  guide: Promise<DeckGuide | null>;
  stop: AbortController;
}

type DeckSource = { pluginId: string; connectionId: string };

const keyOf = (
  source: DeckSource,
  request: DeckOpenRequest,
  content: CodeHostOperationResult<"getPullRequestContent">,
) =>
  JSON.stringify([
    source.pluginId,
    source.connectionId,
    request.repository,
    request.number,
    content.baseSha,
    content.headSha,
  ]);

/** A failed build gives no guide, and the page shows the files A–Z. A cancelled one stays a rejection. */
const guideOrNull = (built: Promise<DeckGuide>) =>
  built.catch((error: unknown) => {
    if (error instanceof GuideBuildCancelled) throw error;
    return null;
  });

/** One local API's Deck service. */
export function createDeckService(options: { guides: GuideBuilds }) {
  const { guides } = options;
  /**
   * The pull request on screen: the last one opened, at its base and head.
   * Opening another stops its reads and its guide build, so they don't hold
   * the plugin's operation slots or the worker.
   */
  let onScreen: Entry | undefined;
  /** The preloaded pull requests by key, oldest first. */
  const preloaded = new Map<string, Entry>();
  /** Counts the opens, so the last one wins whatever order their file lists come back in. */
  let lastOpen = 0;
  /** The opens still reading their file lists or files, which preloads wait for. */
  const opening = new Set<Promise<void>>();
  /** Preload requests run one after the other. */
  let preloading: Promise<unknown> = Promise.resolve();

  const opensDone = async () => {
    while (opening.size) await Promise.allSettled([...opening]);
  };

  /** Stops a preload pushed out of the kept ones: its build, if it still runs or waits. */
  const evict = (entry: Entry) => {
    entry.stop.abort();
    guides.evict(entry.key);
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
    const guideSkipped = guideSkippedFor(diff);
    // A failed guide isn't kept: opening it again reads and builds it again.
    if (guide === null && !guideSkipped && onScreen === entry) {
      onScreen = undefined;
    }
    return {
      opened: { ...diff, guide, ...(guideSkipped ? { guideSkipped } : {}) },
      ...facts,
    };
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
    const content = await runWhenFree(
      codeHost,
      "getPullRequestContent",
      request,
      replaced,
    );
    // A later open owns the screen: this one neither replaces it nor stops its build.
    if (replaced()) throw new DeckBuildReplaced();
    const key = keyOf(source, request, content);
    const none = { fileReadCount: 0, kept: false, preloaded: false };
    if (onScreen?.key === key) {
      doneReading();
      return answer(onScreen, { ...none, kept: true });
    }
    // Its reads and its guide build stop.
    onScreen?.stop.abort();

    const ready = preloaded.get(key);
    if (ready) {
      preloaded.delete(key);
      const entry: Entry = { ...ready, stop: new AbortController() };
      onScreen = entry;
      // Its build, if it still waits, runs before the other preloads.
      guides.prioritize(key, entry.stop.signal);
      doneReading();
      return answer(entry, { ...none, preloaded: true });
    }

    const stop = new AbortController();
    const built = buildPullRequestDiff(
      codeHost,
      request.repository,
      content,
      stop.signal,
    );
    const entry: Entry = {
      key,
      diff: built.then((result) => result.diff),
      guide: built.then((result) =>
        guideSkippedFor(result.diff)
          ? null
          : guideOrNull(
              guides.build(key, result.guideInput, "open", stop.signal),
            ),
      ),
      stop,
    };
    // A failure reaches this caller below. A second caller awaits it too.
    entry.diff.catch(() => {});
    entry.guide.catch(() => {});
    onScreen = entry;
    try {
      const { fileReadCount } = await built;
      doneReading();
      return await answer(entry, { ...none, fileReadCount });
    } catch (error) {
      if (onScreen === entry) onScreen = undefined;
      throw error;
    }
  }

  async function preloadOne(
    source: DeckSource,
    request: DeckOpenRequest,
    codeHost: DeckCodeHost,
  ): Promise<Omit<DeckPreloaded, "failed">> {
    const none = { queued: 0, guideSkipped: 0 };
    await opensDone();
    const content = await runWhenFree(
      codeHost,
      "getPullRequestContent",
      request,
      () => false,
    );
    const key = keyOf(source, request, content);
    const kept = () => onScreen?.key === key || preloaded.has(key);
    if (kept()) return { ...none, fileReadCount: 0 };
    const stop = new AbortController();
    const { diff, guideInput, fileReadCount } = await buildPullRequestDiff(
      codeHost,
      request.repository,
      content,
      stop.signal,
      { atOnce: PRELOAD_READS_AT_ONCE, beforeEach: opensDone },
    );
    // An open of the same pull request may have read it meanwhile.
    if (kept()) return { ...none, fileReadCount };
    const skipped = guideSkippedFor(diff) !== undefined;
    const entry: Entry = {
      key,
      diff: Promise.resolve(diff),
      guide: skipped
        ? Promise.resolve(null)
        : guideOrNull(guides.build(key, guideInput, "preload")),
      stop,
    };
    entry.guide.catch(() => {});
    preloaded.set(key, entry);
    for (const [oldKey, old] of preloaded) {
      if (preloaded.size <= PRELOADS_KEPT) break;
      preloaded.delete(oldKey);
      evict(old);
    }
    return skipped
      ? { queued: 0, guideSkipped: 1, fileReadCount }
      : { queued: 1, guideSkipped: 0, fileReadCount };
  }

  return {
    /**
     * The pull request's diff from the merge base to the head, and its
     * guide. The file list is read each time, so a new push is seen. The
     * diff and guide are built again only when the pull request, its base
     * or its head changed, unless a preload built them.
     */
    openPullRequest,

    /**
     * Reads the pull requests and queues their guide builds at low
     * priority, so they open at once. Each read waits while a pull request
     * opens, and a pull request kept at its head is not read again. One
     * that fails is skipped; when every one fails, the first error is
     * thrown, so a refused token still reaches the caller.
     */
    preloadPullRequests(
      source: DeckSource,
      requests: DeckOpenRequest[],
      codeHost: DeckCodeHost,
    ): Promise<DeckPreloaded> {
      const run = preloading.then(async () => {
        const total = {
          queued: 0,
          guideSkipped: 0,
          fileReadCount: 0,
          failed: 0,
        };
        let firstError: unknown;
        for (const request of requests) {
          try {
            const one = await preloadOne(source, request, codeHost);
            total.queued += one.queued;
            total.guideSkipped += one.guideSkipped;
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

    close: () => guides.close(),
  };
}

export type DeckService = ReturnType<typeof createDeckService>;
