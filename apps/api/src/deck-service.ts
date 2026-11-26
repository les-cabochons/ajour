import type {
  CodeHostChangedFile,
  CodeHostLinkedTicket,
  CodeHostOperationRequest,
  CodeHostOperationResult,
} from "../../../packages/shared/code-host.ts";
import type {
  DeckFile,
  DeckGuide,
  DeckGuideSkipped,
  DeckOpenedPullRequest,
  DeckOpenRequest,
  DeckPullRequestDiff,
  DeckSinceReview,
  DeckSinceReviewRequest,
} from "../../../packages/shared/deck.ts";
import { parseDeckPullRequestKey } from "../../../packages/shared/deck.ts";
import {
  hunkToPatch,
  parseDiff,
  type FileChange,
  type FileContents,
} from "../../../packages/review-deck/diff.ts";
import type { GuideJobBuilt } from "../../../packages/review-deck/guide-job.ts";
import type { GroupedConcern } from "../../../packages/review-deck/summary.ts";
import {
  deckCacheKeyString,
  type DeckCacheForgotten,
  type DeckCacheKey,
  type DeckCachedEntry,
  type DeckContentCache,
} from "./deck-content-cache.ts";
import {
  GuideBuildCancelled,
  type GuideBuildInput,
  type GuideBuilds,
} from "./deck-guide-builds.ts";
import {
  createWorkerDeckDiffs,
  type DeckDiffLane,
  type DeckDiffs,
} from "./deck-diffs.ts";
import { guideOf, withTickets } from "./deck-summary.ts";
import { PluginOperationRefused } from "./plugin-operation-lifetime.ts";
import {
  changedSinceReview,
  diffSignatures,
  type DiffSignatures,
} from "./deck-since-review.ts";

/*
 * Deck's service: it builds a pull request's diff from both versions of
 * each changed file, read through the code host plugin, with Review Deck's
 * vendored `buildDiff` (ADR 0003). The host's patch is never used, so the
 * hunk ids are Review Deck's. Its guide is built from the same diff by the
 * vendored pipeline, in the guide builds' worker thread (#782), and its
 * summary by the summary's rules, with the tickets the pull request is
 * linked to (#789). What it read
 * and built goes to the content cache on disk (#781), so a pull request
 * opened or preloaded before opens again without reading a file, and one
 * opened at the head the window's last sync saw doesn't ask the code host at
 * all. The pull request on screen is also kept in memory until another one
 * opens, and the cache never evicts it. A pull request with more hunks than
 * a guide is built for gets none, and the pipeline doesn't run (#790).
 */

/** The code host operations Deck calls itself. */
export type DeckOperation =
  | "getPullRequestContent"
  | "getFileContent"
  | "getLinkedTickets"
  | "getPullRequestVersions";

/** The code host operations Deck calls, bound to one connection. */
export interface DeckCodeHost {
  run<Operation extends DeckOperation>(
    operation: Operation,
    request: CodeHostOperationRequest<Operation>,
  ): Promise<CodeHostOperationResult<Operation>>;
  /**
   * The connection's generation (`cache.generation`) when the route found
   * the connection. Work through it stops once the connection is removed
   * after that moment, not only after the work began.
   */
  generation?: number;
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
  /** The pull requests read and kept with no guide build: they have too many hunks. */
  guideSkippedCount: number;
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

/** An open or a preload stopped because its connection was removed meanwhile. */
export class DeckConnectionRemoved extends Error {
  constructor() {
    super("This connection was removed.");
  }
}

/** Why aborted work stopped: its connection was removed, or another pull request opened. */
const stopped = (signal: AbortSignal) =>
  signal.reason instanceof DeckConnectionRemoved
    ? signal.reason
    : new DeckBuildReplaced();

/** A diff the worker wrote, or the stop's own error once the work stopped. */
async function written<T>(writing: Promise<T>, signal: AbortSignal) {
  try {
    return await writing;
  } catch (error) {
    if (signal.aborted) throw stopped(signal);
    throw error;
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
      if (signal.aborted) throw stopped(signal);
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
  // Another pull request may have opened, or the connection gone, during the last reads.
  if (signal.aborted) throw stopped(signal);
  return results;
}

/**
 * Runs one code host operation, waiting while the plugin runs as many
 * operations as it may. It stops waiting once `check` throws: another pull
 * request opened, or the connection was removed.
 */
async function runWhenFree<Operation extends DeckOperation>(
  codeHost: DeckCodeHost,
  operation: Operation,
  request: CodeHostOperationRequest<Operation>,
  check: () => void,
) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await codeHost.run(operation, request);
    } catch (error) {
      const busy =
        error instanceof PluginOperationRefused && error.reason === "capacity";
      if (!busy || attempt >= BUSY_RETRIES) throw error;
      await new Promise((resolve) => setTimeout(resolve, BUSY_RETRY_MS));
      check();
    }
  }
}

/**
 * The most hunks Deck builds a guide for (#790). Above it the pipeline
 * doesn't run: its syntax parsing and pair scoring would take over 10
 * seconds and hundreds of megabytes, growing with the square of the hunks
 * (36 s and 966 MB at 3,090), so the page shows the files A–Z.
 */
export const DECK_GUIDE_HUNK_LIMIT = 1_000;

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

/**
 * Writes a diff in Deck's diff workers, off the main thread, a file past
 * its budget written as too large to compare (`deck-diffs.ts`).
 */
type WriteDiff = (
  changes: FileChange[],
  contents: Map<string, FileContents>,
  signal: AbortSignal,
) => ReturnType<DeckDiffs["write"]>;

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
  writeDiff: WriteDiff,
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
        () => {
          if (signal.aborted) throw stopped(signal);
        },
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
  const { text: diffText, tooLarge } = await written(
    writeDiff(changes, contents, signal),
    signal,
  );
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
    // A file too large to compare is written as one too large to read.
    ...(tooLarge.get(file.path)
      ? { binary: false, tooLarge: tooLarge.get(file.path) }
      : { binary: file.binary }),
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

/**
 * Where a guide's linked tickets are read: the open's or the preload's code
 * host, and its check, which throws once the work must stop (another pull
 * request opened, or the connection was removed).
 */
interface TicketSource {
  codeHost: DeckCodeHost;
  check: () => void;
}

/**
 * The pull request's linked tickets, or null when the code host couldn't
 * say: a plugin without the operation, its access off, a failed read, or
 * work that had to stop. The summary then says so, the rest of the guide
 * stands, and the next open reads them again.
 */
async function readLinkedTickets(
  { codeHost, check }: TicketSource,
  request: { repository: string; number: number },
): Promise<CodeHostLinkedTicket[] | null> {
  try {
    check();
    const { tickets } = await runWhenFree(
      codeHost,
      "getLinkedTickets",
      { repository: request.repository, number: request.number },
      check,
    );
    return tickets;
  } catch {
    return null;
  }
}

/** Both versions of the changed files: the base's by base path, the head's by head path. */
export interface DeckFileVersions {
  old: ReadonlyMap<string, string>;
  new: ReadonlyMap<string, string>;
}

/** A pull request Deck holds at one head, for an ask and the agent's reads (#791). */
export interface DeckHeldPullRequest {
  /**
   * Its content cache entry's key, as `deckCacheKeyString` writes it. What
   * lives with the entry, such as the worktree of the user's clone (#795),
   * goes when the cache removes it.
   */
  key: string;
  diff: DeckPullRequestDiff;
  /** The guide the page shows: the agent's when it regrouped one (#794), else the built one. */
  guide: DeckGuide | null;
  /** The guide built from the code. */
  builtGuide: DeckGuide | null;
  versions: DeckFileVersions;
}

/** Why Deck refused to compare a pull request with the version reviewed. */
export class DeckSinceReviewRefused extends Error {
  readonly reason: "not_open" | "unknown_version";
  constructor(reason: "not_open" | "unknown_version", message: string) {
    super(message);
    this.reason = reason;
  }
}

/** What comparing with the version reviewed did, for its event. */
export interface DeckSinceReviewed {
  result: DeckSinceReview;
  /** The diff's hunks on screen. */
  hunkCount: number;
  /** The answer came from the content cache. */
  cached: boolean;
  fileReadCount: number;
  /** The versions whose diffs were read or found, the reviewed one included. */
  comparedCount: number;
}

/**
 * The versions walked back through at most, between the reviewed one and
 * the one on screen. A hunk the same in all of them is counted as changed
 * in the oldest, so a long run of pushes reads at most this many diffs.
 */
const VERSIONS_WALKED = 8;

/** Reads a file at a commit once per comparison. */
type FileReads = Map<string, Promise<Side>>;

/**
 * The diff of `files` at one version, from its base to its head: only the
 * files on screen matter, since only their hunks are compared. Both sides
 * of each file are read whatever its status on screen: a file deleted or
 * added since that version may have been on both sides then. A file
 * missing on a side is absent there, as a file the version didn't have.
 * Its patch text.
 */
async function versionDiff(
  codeHost: DeckCodeHost,
  repository: string,
  files: readonly DeckFile[],
  version: { headSha: string; baseSha: string },
  reads: FileReads,
  writeDiff: WriteDiff,
  check: () => void,
  signal: AbortSignal,
  counted: { fileReadCount: number },
) {
  const read = (sha: string, path: string) => {
    const at = `${sha}\u0000${path}`;
    let found = reads.get(at);
    if (!found) {
      counted.fileReadCount += 1;
      found = runWhenFree(
        codeHost,
        "getFileContent",
        { repository, sha, path },
        check,
      ).then((result): Side =>
        result.kind === "text"
          ? { text: result.content, binary: false }
          : result.kind === "binary"
            ? { text: null, binary: true }
            : ABSENT,
      );
      reads.set(at, found);
    }
    return found;
  };
  const sides = await withConcurrency(
    files.map((file) => async () => {
      const basePath = file.previousPath ?? file.path;
      return [
        await read(version.baseSha, basePath),
        await read(version.headSha, file.path),
      ] as const;
    }),
    FILE_READS_AT_ONCE,
    signal,
  );
  const changes: FileChange[] = [];
  const contents = new Map<string, FileContents>();
  files.forEach((file, index) => {
    const [old, head] = sides[index]!;
    const oldThere = old.text !== null || old.binary;
    const headThere = head.text !== null || head.binary;
    if (!oldThere && !headThere) return;
    const renamed =
      oldThere && headThere && file.previousPath
        ? { originalPath: file.previousPath }
        : {};
    changes.push({
      path: file.path,
      ...renamed,
      changeType: !oldThere
        ? "add"
        : !headThere
          ? "delete"
          : file.previousPath
            ? "rename"
            : "edit",
    });
    contents.set(file.path, {
      old: old.text,
      new: head.text,
      binary: old.binary || head.binary,
      tooLarge: false,
    });
  });
  return (await written(writeDiff(changes, contents, signal), signal)).text;
}

/** The pull request on screen at one base and head: its diff and its guide. */
interface Entry {
  key: DeckCacheKey;
  id: string;
  diff: Promise<DeckPullRequestDiff>;
  /** What its guide is built from: the diff and both versions of each file. */
  input: Promise<GuideBuildInput>;
  /**
   * Null when the pipeline failed, or didn't run for too many hunks. It
   * rejects only when the build was cancelled.
   */
  guide: Promise<DeckGuide | null>;
  /** The guide an agent regrouped (#794), shown in place of the built one. */
  agentGuide: DeckGuide | null;
  /** The guide failed: the next open of the same pull request builds it again. */
  guideFailed?: boolean;
  stop: AbortController;
}

type DeckSource = { pluginId: string; connectionId: string };

/**
 * Work on one connection: an open, or a preload batch. It holds the
 * connection's generation from when it began, and a check throws once the
 * connection was removed since, before each step that reads, writes or
 * shows anything. Removing the connection also aborts `stop`, which ends
 * its file reads.
 */
interface ConnectionWork {
  source: DeckSource;
  generation: number;
  stop: AbortController;
}

const ofForgotten = (source: DeckSource, forgotten: DeckCacheForgotten) =>
  source.pluginId === forgotten.pluginId &&
  (forgotten.connectionId === undefined ||
    source.connectionId === forgotten.connectionId);

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
const guideOrNull = (built: Promise<DeckGuide>): Promise<DeckGuide | null> =>
  built.catch((error: unknown) => {
    if (error instanceof GuideBuildCancelled) throw error;
    return null;
  });

/** One local API's Deck service. */
export function createDeckService(options: {
  guides: GuideBuilds;
  cache: DeckContentCache;
  /** Where diffs are written: Deck's worker threads unless a test passes its own. */
  diffs?: DeckDiffs;
}) {
  const { guides, cache } = options;
  const diffs = options.diffs ?? createWorkerDeckDiffs();
  const writeDiff =
    (lane: DeckDiffLane): WriteDiff =>
    (changes, contents, signal) =>
      diffs.write(changes, contents, lane, signal);
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
  /** The opens and preload batches under way, which removing their connection stops. */
  const working = new Set<ConnectionWork>();
  const beginWork = (
    source: DeckSource,
    codeHost: DeckCodeHost,
  ): ConnectionWork => {
    const work = {
      source,
      generation: codeHost.generation ?? cache.generation(source),
      stop: new AbortController(),
    };
    working.add(work);
    return work;
  };
  const checkConnection = (work: ConnectionWork) => {
    if (cache.generation(work.source) !== work.generation) {
      throw new DeckConnectionRemoved();
    }
  };

  /**
   * The pull requests known to have too many hunks for a guide, so a
   * preload doesn't read one from the cache again to find it has none.
   */
  const overGuideLimit = new Set<string>();
  const overLimit = (key: DeckCacheKey, diff: DeckPullRequestDiff) => {
    if (!guideSkippedFor(diff)) return false;
    overGuideLimit.add(deckCacheKeyString(key));
    return true;
  };

  const opensDone = async () => {
    while (opening.size) await Promise.allSettled([...opening]);
  };

  /**
   * The guides being built or summarized, by cache key. The guide builds
   * share a build only while the worker has it; this also covers the ticket
   * read after it and the cache write, so an open of a pull request whose
   * preload is still reading its tickets doesn't build it twice.
   */
  const building = new Map<string, Promise<DeckGuide | null>>();

  /**
   * The guide of `key`, built from `input` at `priority` with the linked
   * tickets read from `tickets`, and saved to its cache entry once built. A
   * guide already being built for it, as a preload's, is shared, and moves
   * ahead for an open.
   */
  const buildGuide = (
    key: DeckCacheKey,
    input: GuideBuildInput,
    priority: "open" | "preload",
    tickets: TicketSource,
    signal?: AbortSignal,
  ): Promise<DeckGuide | null> => {
    const id = deckCacheKeyString(key);
    const shared = building.get(id);
    if (shared) {
      // A build still waiting moves ahead of the preloads.
      if (priority === "open") guides.prioritize(id, signal);
      return shared;
    }
    // The linked tickets are read while the worker builds. A preload's
    // read, like its file reads, waits while a pull request opens.
    const linked = (async () => {
      if (priority === "preload") await opensDone();
      return readLinkedTickets(tickets, key);
    })();
    const guide = guideOrNull(
      Promise.all([guides.build(id, input, priority, signal), linked]).then(
        ([built, read]) => guideOf(built, read),
      ),
    );
    building.set(id, guide);
    // It stays shared until the cache holds it, so an open meanwhile waits for it.
    const done = () => {
      if (building.get(id) === guide) building.delete(id);
    };
    guide
      .then(async (built) => {
        try {
          if (built) await cache.putGuide(key, built);
        } finally {
          done();
        }
      }, done)
      .catch(() => {});
    return guide;
  };

  /**
   * A guide whose tickets couldn't be read when it was built, with its
   * tickets read again, and cached so. Any other guide as it is.
   */
  const withTicketsRead = async (
    key: DeckCacheKey,
    guide: DeckGuide,
    tickets: TicketSource,
  ) => {
    if (guide.summary.tickets !== null) return guide;
    const read = await readLinkedTickets(tickets, key);
    if (!read) return guide;
    const next = withTickets(guide, read);
    void cache.putGuide(key, next);
    return next;
  };

  /** The entry's diff and guide, once both are ready. */
  const answer = async (
    entry: Entry,
    facts: Omit<DeckOpened, "opened">,
  ): Promise<DeckOpened> => {
    const diff = await entry.diff;
    const building = entry.guide;
    let guide: DeckGuide | null;
    try {
      guide = await building;
    } catch (error) {
      if (error instanceof GuideBuildCancelled)
        throw stopped(entry.stop.signal);
      throw error;
    }
    if (entry.stop.signal.aborted) throw stopped(entry.stop.signal);
    const guideSkipped = guideSkippedFor(diff);
    // The pull request stays on screen, and kept from eviction, without a
    // guide; opening it again builds the guide again. One with too many
    // hunks never gets one.
    if (guide === null && !guideSkipped && entry.guide === building) {
      entry.guideFailed = true;
    }
    return {
      opened: {
        ...diff,
        guide: entry.agentGuide ?? guide,
        ...(guideSkipped ? { guideSkipped } : {}),
      },
      ...facts,
    };
  };

  /**
   * The pull request on screen, opened again: a guide that failed is built
   * again, and tickets that couldn't be read are read again.
   */
  const answerKept = (
    entry: Entry,
    facts: Omit<DeckOpened, "opened">,
    tickets: TicketSource,
  ): Promise<DeckOpened> => {
    if (entry.guideFailed) {
      entry.guideFailed = false;
      entry.guide = entry.input.then((input) =>
        buildGuide(entry.key, input, "open", tickets, entry.stop.signal),
      );
    } else {
      entry.guide = entry.guide.then((guide) =>
        guide ? withTicketsRead(entry.key, guide, tickets) : guide,
      );
    }
    entry.guide.catch(() => {});
    return answer(entry, facts);
  };

  /**
   * Puts a cached pull request on screen, building its guide if it has
   * none, and reading its tickets again if they couldn't be read.
   */
  const openCached = (
    found: DeckCachedEntry,
    facts: Omit<DeckOpened, "opened" | "cached">,
    stop: AbortController,
    tickets: TicketSource,
  ) => {
    onScreen?.stop.abort();
    const entry: Entry = {
      key: found.key,
      id: deckCacheKeyString(found.key),
      diff: Promise.resolve(found.diff),
      input: Promise.resolve(found.guideInput),
      guide: found.guide
        ? withTicketsRead(found.key, found.guide, tickets)
        : overLimit(found.key, found.diff)
          ? Promise.resolve(null)
          : buildGuide(
              found.key,
              found.guideInput,
              "open",
              tickets,
              stop.signal,
            ),
      agentGuide: found.agentGuide,
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
    const work = beginWork(source, codeHost);
    try {
      return await openNow(work, request, codeHost, () => {
        opening.delete(reading);
        doneReading();
      });
    } finally {
      working.delete(work);
      opening.delete(reading);
      doneReading();
    }
  }

  async function openNow(
    work: ConnectionWork,
    request: DeckOpenRequest,
    codeHost: DeckCodeHost,
    doneReading: () => void,
  ): Promise<DeckOpened> {
    const { source, generation, stop } = work;
    // Bound before its connection was removed, it doesn't even take the screen.
    checkConnection(work);
    const open = ++lastOpen;
    // A later open owns the screen: this one neither replaces it nor stops
    // its build. A connection removed from here on reads, caches and shows
    // nothing more of this open.
    const check = () => {
      checkConnection(work);
      if (open !== lastOpen) throw new DeckBuildReplaced();
    };
    const tickets: TicketSource = { codeHost, check };
    const none = { fileReadCount: 0, kept: false, cached: false };
    const ref = { repository: request.repository, number: request.number };

    // At the head the last sync saw, the cache answers without the code host.
    if (request.headSha) {
      const at = { ...source, ...ref, headSha: request.headSha };
      if (onScreen && sameHead(onScreen.key, at)) {
        doneReading();
        return answerKept(
          onScreen,
          { ...none, kept: true, listed: false },
          tickets,
        );
      }
      const found = await cache.find(at);
      check();
      if (found) {
        doneReading();
        return openCached(found, { ...none, listed: false }, stop, tickets);
      }
    }

    const content = await runWhenFree(
      codeHost,
      "getPullRequestContent",
      ref,
      check,
    );
    check();
    const key = keyOf(source, request, content);
    const id = deckCacheKeyString(key);
    const listed = { ...none, listed: true };
    if (onScreen?.id === id) {
      doneReading();
      return answerKept(onScreen, { ...listed, kept: true }, tickets);
    }
    const found = await cache.get(key);
    check();
    if (found) {
      doneReading();
      return openCached(found, listed, stop, tickets);
    }
    // Its reads and its guide build stop.
    onScreen?.stop.abort();

    const built = buildPullRequestDiff(
      codeHost,
      request.repository,
      content,
      writeDiff("open"),
      stop.signal,
    );
    const entry: Entry = {
      key,
      id,
      diff: built.then((result) => result.diff),
      input: built.then((result) => result.guideInput),
      guide: built.then((result) => {
        checkConnection(work);
        void cache.put(key, result, generation);
        return overLimit(key, result.diff)
          ? null
          : buildGuide(key, result.guideInput, "open", tickets, stop.signal);
      }),
      agentGuide: null,
      stop,
    };
    // A failure reaches this caller below. A second caller awaits it too.
    entry.diff.catch(() => {});
    entry.input.catch(() => {});
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
    work: ConnectionWork,
    request: DeckOpenRequest,
    codeHost: DeckCodeHost,
  ): Promise<Omit<DeckPreloaded, "failed">> {
    const { source, generation, stop } = work;
    const ref = { repository: request.repository, number: request.number };
    const skipped = { queued: 0, guideSkippedCount: 0, fileReadCount: 0 };
    // Its batch's connection removed, it reads, caches and builds nothing more.
    const check = () => checkConnection(work);
    const tickets: TicketSource = { codeHost, check };
    /**
     * A pull request cached at `key` isn't read again, and one cached
     * without its guide gets its build queued again. Undefined when it
     * isn't cached.
     */
    const fromCache = async (key: DeckCacheKey) => {
      if (onScreen?.id === deckCacheKeyString(key)) return skipped;
      const peeked = await cache.peek(key);
      check();
      if (!peeked) return undefined;
      if (peeked.hasGuide || overGuideLimit.has(deckCacheKeyString(key))) {
        return skipped;
      }
      const found = await cache.get(key);
      check();
      if (!found) return undefined;
      if (overLimit(key, found.diff)) return skipped;
      void buildGuide(key, found.guideInput, "preload", tickets);
      return { queued: 1, guideSkippedCount: 0, fileReadCount: 0 };
    };
    await opensDone();
    check();
    if (request.headSha) {
      const at = { ...source, ...ref, headSha: request.headSha };
      if (onScreen && sameHead(onScreen.key, at)) return skipped;
      const found = await cache.find(at);
      check();
      if (found) return (await fromCache(found.key)) ?? skipped;
    }
    const content = await runWhenFree(
      codeHost,
      "getPullRequestContent",
      ref,
      check,
    );
    check();
    const key = keyOf(source, request, content);
    const cached = await fromCache(key);
    if (cached) return cached;
    const result = await buildPullRequestDiff(
      codeHost,
      request.repository,
      content,
      writeDiff("preload"),
      stop.signal,
      { atOnce: PRELOAD_READS_AT_ONCE, beforeEach: opensDone },
    );
    check();
    // An open of the same pull request may have read it meanwhile.
    if (onScreen?.id === deckCacheKeyString(key)) {
      return { ...skipped, fileReadCount: result.fileReadCount };
    }
    await cache.put(key, result, generation);
    // The connection may have gone while the write waited its turn.
    check();
    const { fileReadCount } = result;
    if (overLimit(key, result.diff)) {
      return { queued: 0, guideSkippedCount: 1, fileReadCount };
    }
    void buildGuide(key, result.guideInput, "preload", tickets);
    return { queued: 1, guideSkippedCount: 0, fileReadCount };
  }

  /**
   * The pull request Deck holds at `head`, on screen or in the content
   * cache, or undefined: another head, one that failed or one evicted.
   */
  async function held(
    pullRequest: string,
    head: string,
  ): Promise<DeckHeldPullRequest | undefined> {
    const source = parseDeckPullRequestKey(pullRequest);
    if (!source) return undefined;
    const found = await heldAt({ ...source, headSha: head });
    if (!found) return undefined;
    try {
      const builtGuide = await found.guide;
      return {
        key: deckCacheKeyString(found.key),
        diff: found.diff,
        versions: found.versions,
        guide: found.agentGuide() ?? builtGuide,
        builtGuide,
      };
    } catch {
      // Its guide build was cancelled: another pull request opened.
      return undefined;
    }
  }

  /** The pull request Deck holds at a head, with its key, or undefined. */
  async function heldAt(at: Omit<DeckCacheKey, "baseSha">) {
    if (onScreen && sameHead(onScreen.key, at)) {
      const entry = onScreen;
      try {
        const [diff, versions] = await Promise.all([entry.diff, entry.input]);
        return {
          key: entry.key,
          diff,
          versions,
          guide: entry.guide,
          agentGuide: () => entry.agentGuide,
          entry,
        };
      } catch {
        return undefined;
      }
    }
    const found = await cache.find(at);
    return found
      ? {
          key: found.key,
          diff: found.diff,
          versions: found.guideInput,
          guide: Promise.resolve(found.guide),
          agentGuide: () => found.agentGuide,
          entry: undefined,
        }
      : undefined;
  }

  /** Counts the regroups' rule runs, so two never share a build. */
  let regroups = 0;

  /**
   * The summary's rules run on concerns an agent grouped (#794), in the
   * guide worker, ahead of preloads: each concern's kinds, its test
   * coverage, the risky areas and the leftovers. Undefined when Deck no
   * longer holds the pull request at `head`; once `signal` aborts, the
   * build stops and rejects with `GuideBuildCancelled`.
   */
  async function rulesFor(
    pullRequest: string,
    head: string,
    concerns: GroupedConcern[],
    signal?: AbortSignal,
  ): Promise<GuideJobBuilt | undefined> {
    const source = parseDeckPullRequestKey(pullRequest);
    if (!source) return undefined;
    const found = await heldAt({ ...source, headSha: head });
    if (!found) return undefined;
    return guides.build(
      `${deckCacheKeyString(found.key)} regroup ${++regroups}`,
      { ...found.versions, concerns },
      "open",
      signal,
    );
  }

  /**
   * Shows `guide`, an agent's, or the built guide again when null, for the
   * pull request at `head`, on screen and in the content cache. Returns the
   * guide shown now, or undefined when Deck no longer holds it there.
   * `refusalNow` is asked last, once Deck read the pull request and its
   * built guide: when it gives a refusal, nothing is written and the
   * result carries it.
   */
  async function setAgentGuide<Refusal = never>(
    pullRequest: string,
    head: string,
    guide: DeckGuide | null,
    refusalNow?: () => Promise<Refusal | undefined>,
  ): Promise<{ guide: DeckGuide | null } | { refused: Refusal } | undefined> {
    const source = parseDeckPullRequestKey(pullRequest);
    if (!source) return undefined;
    const found = await heldAt({ ...source, headSha: head });
    if (!found) return undefined;
    let built: DeckGuide | null;
    try {
      built = await found.guide;
    } catch {
      return undefined;
    }
    // Once the guard answers, nothing awaits before the write below.
    const refused = await refusalNow?.();
    if (refused !== undefined) return { refused };
    // The one on screen may have been opened again meanwhile.
    for (const entry of [found.entry, onScreen]) {
      if (
        entry &&
        deckCacheKeyString(entry.key) === deckCacheKeyString(found.key)
      ) {
        entry.agentGuide = guide;
      }
    }
    if (guide) await cache.putAgentGuide(found.key, guide);
    else await cache.dropAgentGuide(found.key);
    return { guide: guide ?? built };
  }

  /** The comparisons under way, by version pair, which a second ask shares. */
  const comparing = new Map<
    string,
    Promise<Omit<DeckSinceReviewed, "hunkCount">>
  >();

  async function sinceReview(
    source: DeckSource,
    request: DeckSinceReviewRequest,
    codeHost: DeckCodeHost,
  ): Promise<DeckSinceReviewed> {
    const work = beginWork(source, codeHost);
    try {
      checkConnection(work);
      const ref = { repository: request.repository, number: request.number };
      const current = await heldAt({
        ...source,
        ...ref,
        headSha: request.head,
      });
      checkConnection(work);
      if (!current) {
        throw new DeckSinceReviewRefused(
          "not_open",
          "Deck doesn't hold this pull request at this head. Open it again.",
        );
      }
      const hunkCount = current.diff.files.reduce(
        (count, file) => count + file.hunks.length,
        0,
      );
      const saved = await cache.getSince(current.key, request.reviewedHead);
      if (saved) {
        return {
          result: saved,
          hunkCount,
          cached: true,
          fileReadCount: 0,
          comparedCount: 0,
        };
      }
      const pair = JSON.stringify([
        deckCacheKeyString(current.key),
        request.reviewedHead,
      ]);
      let running = comparing.get(pair);
      if (!running) {
        running = compare(work, ref, current, request.reviewedHead, codeHost);
        comparing.set(pair, running);
        void running.then(
          () => comparing.delete(pair),
          () => comparing.delete(pair),
        );
      }
      return { ...(await running), hunkCount };
    } finally {
      working.delete(work);
    }
  }

  async function compare(
    work: ConnectionWork,
    ref: { repository: string; number: number },
    current: {
      key: DeckCacheKey;
      diff: DeckPullRequestDiff;
      versions: GuideBuildInput;
    },
    reviewedHead: string,
    codeHost: DeckCodeHost,
  ): Promise<Omit<DeckSinceReviewed, "hunkCount">> {
    const check = () => checkConnection(work);
    const { versions } = await runWhenFree(
      codeHost,
      "getPullRequestVersions",
      ref,
      check,
    );
    check();
    const now = versions.find(
      (version) => version.headSha === current.key.headSha,
    );
    const reviewed = versions.find(
      (version) => version.headSha === reviewedHead,
    );
    if (!now || !reviewed) {
      throw new DeckSinceReviewRefused(
        "unknown_version",
        now
          ? "The version you reviewed isn't one of this pull request's versions."
          : "The head on screen isn't one of this pull request's versions.",
      );
    }
    const counted = { fileReadCount: 0 };
    let comparedCount = 0;
    let changed: DeckSinceReview["changed"] = [];
    if (reviewed.number < now.number) {
      const reads: FileReads = new Map();
      const signaturesAt = async (version: {
        headSha: string;
        baseSha?: string;
      }): Promise<DiffSignatures> => {
        comparedCount += 1;
        // A version opened before is in the content cache at its head.
        const cached = await cache.find({
          ...work.source,
          ...ref,
          headSha: version.headSha,
        });
        check();
        if (
          cached &&
          (!version.baseSha || cached.key.baseSha === version.baseSha)
        ) {
          return diffSignatures(cached.guideInput.diff);
        }
        const patch = await versionDiff(
          codeHost,
          ref.repository,
          current.diff.files,
          {
            headSha: version.headSha,
            baseSha: version.baseSha ?? current.key.baseSha,
          },
          reads,
          writeDiff("open"),
          check,
          work.stop.signal,
          counted,
        );
        check();
        return diffSignatures(patch);
      };
      const between = versions
        .filter(
          (version) =>
            version.number > reviewed.number && version.number < now.number,
        )
        .sort((a, b) => b.number - a.number)
        .slice(0, VERSIONS_WALKED)
        .map((version) => ({
          number: version.number,
          signatures: () => signaturesAt(version),
        }));
      changed = await changedSinceReview({
        current: current.versions.diff,
        version: now.number,
        reviewed: await signaturesAt(reviewed),
        between,
      });
    }
    const result: DeckSinceReview = {
      head: current.key.headSha,
      reviewedHead,
      version: now.number,
      reviewedVersion: reviewed.number,
      changed,
    };
    check();
    await cache.putSince(current.key, result);
    return {
      result,
      cached: false,
      fileReadCount: counted.fileReadCount,
      comparedCount,
    };
  }

  return {
    held,
    rulesFor,
    setAgentGuide,

    /**
     * Compares the pull request Deck holds at `head` with the version whose
     * head the user last reviewed, reading the versions through the code
     * host, and each version's files only when the content cache doesn't
     * hold its diff. The answer is cached per version pair with the entry
     * at `head`.
     */
    sinceReview,

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
     * error is thrown, so a refused token still reaches the caller. Once
     * the connection is removed, from the moment the batch is asked for,
     * the rest of it stops, and it throws `DeckConnectionRemoved`.
     */
    preloadPullRequests(
      source: DeckSource,
      requests: DeckOpenRequest[],
      codeHost: DeckCodeHost,
    ): Promise<DeckPreloaded> {
      const work = beginWork(source, codeHost);
      const run = preloading.then(async () => {
        const total = {
          queued: 0,
          guideSkippedCount: 0,
          fileReadCount: 0,
          failed: 0,
        };
        let firstError: unknown;
        try {
          for (const request of requests) {
            checkConnection(work);
            try {
              const one = await preloadOne(work, request, codeHost);
              total.queued += one.queued;
              total.guideSkippedCount += one.guideSkippedCount;
              total.fileReadCount += one.fileReadCount;
            } catch (error) {
              if (error instanceof DeckConnectionRemoved) throw error;
              total.failed += 1;
              firstError ??= error;
            }
          }
        } finally {
          working.delete(work);
        }
        if (requests.length && total.failed === requests.length) {
          throw firstError;
        }
        return total;
      });
      preloading = run.catch(() => {});
      return run;
    },

    /**
     * Forgets a removed connection, or every connection of a removed
     * plugin: its pull request on screen goes, with its reads and guide
     * build, and so do its cached entries. Its opens and preloads under way
     * stop, and read, cache and show nothing more.
     */
    forgetConnection(source: DeckCacheForgotten) {
      // The generation moves on first, so no work under way passes a check.
      const forgotten = cache.forgetConnection(source);
      const removed = new DeckConnectionRemoved();
      for (const work of working) {
        if (ofForgotten(work.source, source)) work.stop.abort(removed);
      }
      if (onScreen && ofForgotten(onScreen.key, source)) {
        onScreen.stop.abort(removed);
        show(undefined);
      }
      return forgotten;
    },

    /** The content cache, for Settings › Storage and syncs. */
    cache,

    close: async () => {
      await Promise.all([guides.close(), diffs.close()]);
    },
  };
}

export type DeckService = ReturnType<typeof createDeckService>;
