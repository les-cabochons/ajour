import type {
  CodeHostChangedFile,
  CodeHostOperationRequest,
  CodeHostOperationResult,
} from "../../../packages/shared/code-host.ts";
import type {
  DeckFile,
  DeckOpenRequest,
  DeckPullRequestDiff,
} from "../../../packages/shared/deck.ts";
import {
  buildDiff,
  hunkToPatch,
  parseDiff,
} from "../../../packages/review-deck/diff.ts";
import { PluginOperationRefused } from "./plugin-operation-lifetime.ts";

/*
 * Deck's service: it builds a pull request's diff from both versions of
 * each changed file, read through the code host plugin, with Review Deck's
 * vendored `buildDiff` (ADR 0003). The host's patch is never used, so the
 * hunk ids are Review Deck's. The pull request on screen is kept in memory
 * until another one opens. The disk cache is a later ticket (#781).
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
  diff: DeckPullRequestDiff;
  /** The files read through the plugin, both versions counted. */
  fileReadCount: number;
  /** The diff was the one kept for the pull request on screen. */
  kept: boolean;
}

/** A build stopped because another pull request opened meanwhile. */
export class DeckBuildReplaced extends Error {
  constructor() {
    super("Another pull request opened in Deck.");
  }
}

/**
 * Files read at once. The plugin host runs at most 4 operations of a plugin
 * at a time and refuses the rest, so one slot stays free for a sync.
 */
const FILE_READS_AT_ONCE = 3;
/** How often, and after how long, a read the host refused for capacity is tried again. */
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
 * after the first failure, or once `signal` aborts.
 */
async function withConcurrency<T>(
  tasks: (() => Promise<T>)[],
  limit: number,
  signal: AbortSignal,
): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let next = 0;
  let failed = false;
  const worker = async () => {
    while (!failed && next < tasks.length) {
      if (signal.aborted) throw new DeckBuildReplaced();
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
  return results;
}

/** Reads one file, waiting while the plugin runs as many operations as it may. */
async function readFile(
  codeHost: DeckCodeHost,
  request: CodeHostOperationRequest<"getFileContent">,
  signal: AbortSignal,
) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await codeHost.run("getFileContent", request);
    } catch (error) {
      const busy =
        error instanceof PluginOperationRefused && error.reason === "capacity";
      if (!busy || attempt >= BUSY_RETRIES) throw error;
      await new Promise((resolve) => setTimeout(resolve, BUSY_RETRY_MS));
      if (signal.aborted) throw new DeckBuildReplaced();
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
) {
  const files = [...content.files].sort(byPath);
  let fileReadCount = 0;
  const reads = files.flatMap((file) =>
    versionsOf(file, content).map((version) => async (): Promise<Side> => {
      if (!version) return ABSENT;
      fileReadCount += 1;
      const read = await readFile(
        codeHost,
        { repository, sha: version.sha, path: version.path },
        signal,
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
  const sides = await withConcurrency(reads, FILE_READS_AT_ONCE, signal);

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
  const diffFiles: DeckFile[] = parseDiff(buildDiff(changes, contents)).map(
    (file) => ({
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
    }),
  );
  return {
    diff: {
      headSha: content.headSha,
      baseSha: content.baseSha,
      files: diffFiles,
    },
    fileReadCount,
  };
}

/** One local API's Deck service. */
export function createDeckService() {
  /**
   * The pull request on screen: the last one opened, at its base and head.
   * Opening another stops its build, so its reads don't hold the plugin's
   * operation slots.
   */
  let onScreen:
    | {
        key: string;
        diff: Promise<DeckPullRequestDiff>;
        stop: AbortController;
      }
    | undefined;

  return {
    /**
     * The pull request's diff from the merge base to the head. The file list
     * is read each time, so a new push is seen. The diff is built again only
     * when the pull request, its base or its head changed.
     */
    async openPullRequest(
      source: { pluginId: string; connectionId: string },
      request: DeckOpenRequest,
      codeHost: DeckCodeHost,
    ): Promise<DeckOpened> {
      const content = await codeHost.run("getPullRequestContent", request);
      const key = JSON.stringify([
        source.pluginId,
        source.connectionId,
        request.repository,
        request.number,
        content.baseSha,
        content.headSha,
      ]);
      if (onScreen?.key === key) {
        return { diff: await onScreen.diff, fileReadCount: 0, kept: true };
      }
      onScreen?.stop.abort();
      const stop = new AbortController();
      const built = buildPullRequestDiff(
        codeHost,
        request.repository,
        content,
        stop.signal,
      );
      const entry = { key, diff: built.then((result) => result.diff), stop };
      // A failure reaches this caller below. A second caller awaits it too.
      entry.diff.catch(() => {});
      onScreen = entry;
      try {
        const { diff, fileReadCount } = await built;
        return { diff, fileReadCount, kept: false };
      } catch (error) {
        if (onScreen === entry) onScreen = undefined;
        throw error;
      }
    },
  };
}

export type DeckService = ReturnType<typeof createDeckService>;
