import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type {
  DeckClone,
  DeckCloneEnvironment,
  DeckCloneSource,
  DeckCloneSuggestion,
} from "../../../packages/shared/deck.ts";
import {
  findExecutable,
  resolveLoginShellPath,
} from "./agent-runner/cli-path.ts";
import {
  cloneIdentityOf,
  fetchableHostOf,
  isSshAddress,
  sameRepository,
} from "./clone-identity.ts";
import {
  checkedRef,
  Git,
  GitFailure,
  WSL_DISTRO_NAME,
  WslGit,
  type GitResult,
} from "./git-process.ts";
import { childEnvironment, gitEnvironment } from "./process-broker.ts";

/*
 * Deck's local clones (#795, ADR 0023). The user picks the clone of a
 * repository once; Deck reads it at a pull request's head without touching
 * the user's branches, index, working files, HEAD or FETCH_HEAD:
 *
 * - it fetches the head into a private `refs/ajour/deck/<id>/head` ref,
 *   with the user's own Git setup, unless the clone already has the commit.
 *   GitHub's `refs/pull/N/head` comes from the repository itself; on Azure
 *   DevOps, the source branch's commit, never the `refs/pull/N/merge` merge;
 * - it checks the commit is exactly the head the pull request names;
 * - it checks the commit out in a detached worktree of its own, under the
 *   content cache entry's folder, with no hooks, filters, symbolic links or
 *   submodules. A WSL clone's worktree stays in its distribution.
 *
 * The worktree goes with its cache entry: `release` removes it and its ref,
 * and what an earlier run left for entries the cache no longer holds goes
 * the first time that clone is prepared, with `git worktree prune` only
 * when every stale registration in it is Deck's.
 *
 * A clone that can't be prepared never stops an ask: `prepare` answers why,
 * and the agent reads the pull request alone. No reason holds a path, a
 * remote address or what git printed, so none leaks into an event.
 */

/** A pull request's repository, as Deck keys a clone. */
export interface DeckCloneRepository {
  pluginId: string;
  connectionId: string;
  repository: string;
}

/** The cache entry an ask reads: a pull request at one base and head. */
export interface DeckCloneEntry extends DeckCloneRepository {
  /** The content cache entry's key. The worktree lives and goes with it. */
  key: string;
  number: number;
  head: string;
  clone: DeckCloneSource;
}

/** Why a clone wasn't read, for the wide event. */
export type DeckCloneFailure =
  | "clone_missing"
  | "remote_changed"
  | "no_git"
  | "wsl_unavailable"
  | "head_not_full"
  | "no_head_ref"
  | "no_fork_remote"
  | "fetch_failed"
  | "fetch_timeout"
  | "head_not_found"
  | "checkout_failed"
  | "cancelled";

export type DeckClonePrepared =
  | { state: "read"; root: string }
  | { state: "unavailable"; failure: DeckCloneFailure; reason: string }
  | { state: "not_chosen" };

/** A folder that can't be the repository's clone, with a sentence for the picker. */
export class DeckCloneRefused extends Error {}

/** How long one git call may take, by what it does. */
export interface DeckCloneTimeouts {
  localMs: number;
  fetchMs: number;
  checkoutMs: number;
}

/**
 * Longer than a hand off's (ADR 0022): a pull request's head can bring many
 * objects, and a checkout writes the whole tree. The ask waits, and Stop
 * ends git at once.
 */
const DEFAULT_TIMEOUTS: DeckCloneTimeouts = {
  localMs: 15_000,
  fetchMs: 120_000,
  checkoutMs: 300_000,
};

/** Folders whose remotes are read at once when Deck suggests clones. */
const SUGGESTION_READS_AT_ONCE = 4;

/** Where a WSL clone's worktrees go, under the distribution user's home. */
const WSL_WORKTREES = ".cache/ajour/deck-worktrees";

export interface DeckClonesOptions {
  storage: {
    getDeckClones(): Promise<DeckClone[]>;
    saveDeckClone(clone: DeckClone): Promise<void>;
    forgetDeckClone(repository: DeckCloneRepository): Promise<boolean>;
  };
  /** The content cache's folder for worktrees. */
  worktreesFolder: string;
  /** Git on this computer, run in `cwd`; undefined without git. */
  nativeGit?: (cwd: string) => Promise<Git | undefined>;
  /** Git in a WSL distribution, run in the Linux folder `cwd`. */
  wslGit?: (distro: string, cwd: string) => Git;
  timeouts?: Partial<DeckCloneTimeouts>;
  now?: () => number;
  /**
   * The keys of the content cache's entries now: their worktrees, an
   * earlier run's included, stay when a clone is swept.
   */
  liveKeys?: () => Promise<Iterable<string>>;
}

/** Git on this computer, as hand-off worktrees run it (ADR 0022). */
async function defaultNativeGit(cwd: string): Promise<Git | undefined> {
  const userPath = await resolveLoginShellPath();
  const executable = await findExecutable("git", userPath);
  if (!executable) return undefined;
  return new Git(
    executable,
    {
      ...gitEnvironment(childEnvironment(userPath)),
      GIT_TERMINAL_PROMPT: "0",
      GCM_INTERACTIVE: "never",
      // A Git LFS filter left on fetches nothing: its files stay pointers.
      GIT_LFS_SKIP_SMUDGE: "1",
    },
    cwd,
  );
}

/** A WSL folder a Windows path names: `\\wsl.localhost\Ubuntu\home\…` or `\\wsl$\…`. */
export function wslFolderOf(
  chosen: string,
): { distro: string; path: string } | undefined {
  const match =
    /^[\\/]{2}(?:wsl\.localhost|wsl\$)[\\/]([^\\/]+)((?:[\\/][^\\/]*)*)$/i.exec(
      chosen,
    );
  if (!match || !WSL_DISTRO_NAME.test(match[1]!)) return undefined;
  const linux = `/${match[2]!.split(/[\\/]/).filter(Boolean).join("/")}`;
  return { distro: match[1]!, path: linux };
}

const sameKey = (a: DeckCloneRepository, b: DeckCloneRepository) =>
  a.pluginId === b.pluginId &&
  a.connectionId === b.connectionId &&
  a.repository === b.repository;

/** The worktree's short name, from its cache entry's key: no repository or commit in a path. */
const idOf = (key: string) =>
  createHash("sha256").update(key).digest("hex").slice(0, 16);

/** A branch name Ajour may put in a refspec. */
function checkedBranch(branch: string): string {
  const name = branch.replace(/^refs\/heads\//, "");
  if (
    !name ||
    name.startsWith("-") ||
    name.startsWith("/") ||
    name.endsWith("/") ||
    name.endsWith(".lock") ||
    name.includes("..") ||
    name.includes("//") ||
    name.includes("@{") ||
    /[\0-\x20\x7f~^:?*[\\]/.test(name)
  ) {
    throw new GitFailure("git_failed", "Ajour refused an unsafe branch name.");
  }
  return name;
}

const FULL_COMMIT = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i;

/** Git as Deck runs it in a clone. */
interface DeckGit {
  run(args: readonly string[], timeoutMs: number): Promise<GitResult>;
  read(args: readonly string[], timeoutMs: number): Promise<string>;
}

/**
 * Git with what every Deck call runs with: none of the clone's hooks, no
 * file system monitor, and no background maintenance or garbage collection.
 * Every call stops when `signal` aborts.
 */
function quietGit(git: Git, hooksPath: string, signal?: AbortSignal): DeckGit {
  const settings = [
    "-c",
    `core.hooksPath=${hooksPath}`,
    "-c",
    "core.fsmonitor=false",
    "-c",
    "maintenance.auto=false",
    "-c",
    "gc.auto=0",
  ];
  const run = (args: readonly string[], timeoutMs: number) =>
    git.run([...settings, ...args], timeoutMs, signal);
  return {
    run,
    async read(args, timeoutMs) {
      const result = await run(args, timeoutMs);
      if (result.timedOut || result.code !== 0) {
        throw new GitFailure(
          result.timedOut ? "timeout" : "git_failed",
          "Git failed.",
        );
      }
      return result.stdout.trim();
    },
  };
}

/** A prepared worktree, kept while its cache entry is. */
interface Prepared {
  clone: DeckClone;
  /** The worktree's folder, as git names it in the clone's environment. */
  folder: string;
  /** The same folder, as the agent reads it. */
  root: string;
  ref: string;
  head: string;
}

/** A clone's environment, folder and git, once checked. */
interface Opened {
  git: DeckGit;
  environment: DeckCloneEnvironment;
  /** The path style of the clone's environment. */
  style: typeof path.posix;
  /** The clone's top folder, in its environment. */
  top: string;
  /** Where its worktrees go, in its environment. */
  worktrees: string;
  /** A folder of its environment, as this computer and the agent read it. */
  here(folder: string): string;
}

const unavailable = (
  failure: DeckCloneFailure,
  reason: string,
): DeckClonePrepared => ({ state: "unavailable", failure, reason });

const CANCELLED = unavailable("cancelled", "The ask was stopped.");

export function createDeckClones(options: DeckClonesOptions) {
  const timeouts = { ...DEFAULT_TIMEOUTS, ...options.timeouts };
  const nativeGit = options.nativeGit ?? defaultNativeGit;
  const wslGit =
    options.wslGit ??
    ((distro: string, cwd: string) => new WslGit(distro, cwd));
  const now = options.now ?? Date.now;
  /** Prepared worktrees by cache entry key. */
  const prepared = new Map<string, Prepared>();
  /** The preparations under way, by cache entry key, which a release waits for. */
  const preparing = new Map<string, Promise<unknown>>();
  /** The clones whose earlier runs' worktrees are swept, by `cloneKey`. */
  const swept = new Set<string>();
  /** Writes to one clone run one at a time. */
  const locks = new Map<string, Promise<unknown>>();
  const hooksFolder = path.join(options.worktreesFolder, ".no-hooks");

  const cloneKey = (clone: DeckClone) =>
    JSON.stringify([clone.environment, clone.path]);

  function locked<T>(clone: DeckClone, run: () => Promise<T>): Promise<T> {
    const key = cloneKey(clone);
    const before = locks.get(key) ?? Promise.resolve();
    const next = before.then(run, run);
    const tail = next.catch(() => undefined);
    locks.set(key, tail);
    void tail.then(() => {
      if (locks.get(key) === tail) locks.delete(key);
    });
    return next;
  }

  /** Git in a folder of the environment, with no hooks; undefined without git. */
  async function gitIn(
    environment: DeckCloneEnvironment,
    folder: string,
    signal?: AbortSignal,
  ): Promise<DeckGit | undefined> {
    if (environment.kind === "wsl") {
      return quietGit(wslGit(environment.distro, folder), "/dev/null", signal);
    }
    const git = await nativeGit(folder);
    if (!git) return undefined;
    await fs.mkdir(hooksFolder, { recursive: true });
    return quietGit(git, hooksFolder, signal);
  }

  /** The clone's environment, folder and git, or why it can't be read. */
  async function open(
    environment: DeckCloneEnvironment,
    folder: string,
    signal?: AbortSignal,
  ): Promise<Opened | DeckCloneFailure> {
    if (environment.kind === "native") {
      try {
        if (!(await fs.stat(folder)).isDirectory()) return "clone_missing";
      } catch {
        return "clone_missing";
      }
    }
    const git = await gitIn(environment, folder, signal);
    if (!git) return "no_git";
    let top: string;
    try {
      const [bare, shown] = (
        await git.read(
          ["rev-parse", "--is-bare-repository", "--show-toplevel"],
          timeouts.localMs,
        )
      ).split(/\r?\n/);
      if (bare !== "false" || !shown) return "clone_missing";
      top = shown;
    } catch {
      if (signal?.aborted) return "cancelled";
      if (environment.kind === "wsl" && !(await wslAnswers(environment.distro)))
        return "wsl_unavailable";
      return "clone_missing";
    }
    if (environment.kind === "wsl") {
      const home = await wslHome(environment.distro);
      if (!home) return "wsl_unavailable";
      const { distro } = environment;
      return {
        git: (await gitIn(environment, top, signal))!,
        environment,
        style: path.posix,
        top,
        worktrees: path.posix.join(home, WSL_WORKTREES),
        here: (linux) =>
          `\\\\wsl.localhost\\${distro}${linux.replace(/\//g, "\\")}`,
      };
    }
    const nativeTop = path.resolve(top);
    // Git prints long paths: a short 8.3 name in the data folder's path,
    // as on a CI runner's temp folder, would never compare equal to them.
    await fs.mkdir(options.worktreesFolder, { recursive: true });
    const worktrees = await fs
      .realpath(options.worktreesFolder)
      .catch(() => options.worktreesFolder);
    return {
      git: (await gitIn(environment, nativeTop, signal)) ?? git,
      environment,
      style: path as typeof path.posix,
      top: nativeTop,
      worktrees,
      here: (native) => native,
    };
  }

  /** Whether the distribution runs git at all. */
  async function wslAnswers(distro: string) {
    try {
      await wslGit(distro, "/").read(["--version"], timeouts.localMs);
      return true;
    } catch {
      return false;
    }
  }

  /** The distribution user's home, read through git's own expansion of `~`. */
  async function wslHome(distro: string): Promise<string | undefined> {
    try {
      const home = await wslGit(distro, "/").read(
        [
          "config",
          "--type=path",
          "--default",
          "~",
          "--get",
          "ajour.deck-home-probe",
        ],
        timeouts.localMs,
      );
      return home.startsWith("/") ? home : undefined;
    } catch {
      return undefined;
    }
  }

  /** The clone's remotes and every address each has, as configured and as rewritten. */
  async function remotesOf(git: DeckGit): Promise<Map<string, string[]>> {
    const names = (await git.read(["remote"], timeouts.localMs))
      .split(/\r?\n/)
      .map((name) => name.trim())
      .filter((name) => name && !name.startsWith("-"));
    const remotes = new Map<string, string[]>();
    for (const name of names) {
      const addresses = new Set<string>();
      for (const args of [
        ["config", "--get-all", `remote.${name}.url`],
        ["remote", "get-url", "--all", "--", name],
      ]) {
        const result = await git.run(args, timeouts.localMs);
        if (result.code !== 0) continue;
        for (const line of result.stdout.split(/\r?\n/)) {
          if (line.trim()) addresses.add(line.trim());
        }
      }
      remotes.set(name, [...addresses]);
    }
    return remotes;
  }

  /** The first remote with an address among `cloneUrls`, origin first. */
  function matchingRemote(
    remotes: Map<string, string[]>,
    cloneUrls: readonly string[],
  ): string | undefined {
    const names = [...remotes.keys()].sort((a, b) =>
      a === "origin" ? -1 : b === "origin" ? 1 : 0,
    );
    return names.find((name) =>
      remotes
        .get(name)!
        .some((address) =>
          cloneUrls.some((url) => sameRepository(address, url)),
        ),
    );
  }

  /** Removes a private ref Deck made, whatever is left of it. */
  const dropRef = (git: DeckGit, ref: string) =>
    git
      .run(["update-ref", "-d", "--", ref], timeouts.localMs)
      .catch(() => undefined);

  async function choose(
    repository: DeckCloneRepository,
    source: DeckCloneSource,
    chosen: string,
  ): Promise<DeckClone> {
    const wsl = process.platform === "win32" ? wslFolderOf(chosen) : undefined;
    const environment: DeckCloneEnvironment = wsl
      ? { kind: "wsl", distro: wsl.distro }
      : { kind: "native" };
    const folder = wsl ? wsl.path : chosen;
    if (!wsl && !path.isAbsolute(folder)) {
      throw new DeckCloneRefused("Choose a folder on this computer.");
    }
    const opened = await open(environment, folder);
    if (opened === "no_git") {
      throw new DeckCloneRefused(
        "Git isn't installed, so Ajour can't read a clone.",
      );
    }
    if (opened === "wsl_unavailable") {
      throw new DeckCloneRefused(
        "Ajour can't run git in this WSL distribution.",
      );
    }
    if (typeof opened === "string") {
      throw new DeckCloneRefused("This folder isn't a Git clone.");
    }
    let remote: string | undefined;
    try {
      remote = matchingRemote(
        await remotesOf(opened.git),
        source.repositoryIdentity.cloneUrls,
      );
    } catch {
      remote = undefined;
    }
    if (!remote) {
      throw new DeckCloneRefused(
        `None of this folder's remotes is ${repository.repository}.`,
      );
    }
    const clone: DeckClone = {
      pluginId: repository.pluginId,
      connectionId: repository.connectionId,
      repository: repository.repository,
      environment,
      path: opened.top,
      remote,
      chosenAt: now(),
    };
    const earlier = (await options.storage.getDeckClones()).find((other) =>
      sameKey(other, repository),
    );
    await options.storage.saveDeckClone(clone);
    // Worktrees of the clone chosen before go now: the next ask reads this one.
    if (earlier) await releaseWhere((kept) => sameKey(kept.clone, repository));
    return clone;
  }

  /** Removes the prepared worktrees `which` names. */
  async function releaseWhere(which: (kept: Prepared) => boolean) {
    for (const [key, kept] of [...prepared]) {
      if (which(kept)) await release(key);
    }
  }

  /** Removes one worktree and its ref, in its clone. */
  async function removeWorktree(
    opened: Opened,
    folder: string,
    ref: string | undefined,
  ) {
    const removed = await opened.git
      .run(
        ["worktree", "remove", "--force", "--force", "--", folder],
        timeouts.checkoutMs,
      )
      .catch(() => undefined);
    // A folder git no longer knows, or one half made: only Deck's own.
    if (removed?.code !== 0 && isUnder(opened, opened.worktrees, folder)) {
      await fs
        .rm(opened.here(folder), {
          recursive: true,
          force: true,
          maxRetries: 5,
        })
        .catch(() => undefined);
    }
    if (ref) await dropRef(opened.git, ref);
    await pruneDeckOnly(opened);
  }

  /** Whether `folder` is inside `root`, both in the clone's environment. */
  function isUnder(opened: Opened, root: string, folder: string) {
    const relative = opened.style.relative(root, folder);
    return (
      relative !== "" &&
      !relative.startsWith("..") &&
      !opened.style.isAbsolute(relative)
    );
  }

  /** A folder git printed, in the clone environment's own form. */
  const normalized = (opened: Opened, folder: string) =>
    opened.style.resolve(folder);

  /** The clone's worktrees: each folder, its head, and whether git can prune it. */
  async function worktreesOf(git: DeckGit) {
    const listed = await git.read(
      ["worktree", "list", "--porcelain", "-z"],
      timeouts.localMs,
    );
    const worktrees: { folder: string; head?: string; prunable: boolean }[] =
      [];
    let current: (typeof worktrees)[number] | undefined;
    for (const field of listed.split("\0")) {
      if (field.startsWith("worktree ")) {
        current = { folder: field.slice("worktree ".length), prunable: false };
        worktrees.push(current);
      } else if (current && field.startsWith("HEAD ")) {
        current.head = field.slice("HEAD ".length);
      } else if (current && field.startsWith("prunable")) {
        current.prunable = true;
      }
    }
    return worktrees;
  }

  /**
   * `git worktree prune`, which is repository-wide, only when every
   * registration it would drop is Deck's: the user's own stay as they are.
   */
  async function pruneDeckOnly(opened: Opened) {
    try {
      const prunable = (await worktreesOf(opened.git)).filter(
        (tree) => tree.prunable,
      );
      if (!prunable.length) return;
      if (
        prunable.every((tree) =>
          isUnder(opened, opened.worktrees, normalized(opened, tree.folder)),
        )
      ) {
        await opened.git.run(
          ["worktree", "prune", "--expire=now"],
          timeouts.localMs,
        );
      }
    } catch {
      // Left for the next time.
    }
  }

  /** The filter drivers the clone configures, each turned off for the checkout. */
  async function filterOverrides(git: DeckGit): Promise<string[]> {
    const result = await git.run(
      ["config", "--name-only", "--get-regexp", "^filter\\."],
      timeouts.localMs,
    );
    const drivers = new Set(["lfs"]);
    for (const line of result.code === 0 ? result.stdout.split(/\r?\n/) : []) {
      const driver = /^filter\.(.+)\.[^.]+$/.exec(line.trim())?.[1];
      if (driver && !/[\0\r\n=]/.test(driver)) drivers.add(driver);
    }
    return [...drivers].flatMap((driver) => [
      "-c",
      `filter.${driver}.smudge=`,
      "-c",
      `filter.${driver}.process=`,
      "-c",
      `filter.${driver}.required=false`,
    ]);
  }

  /**
   * Where the head comes from, as the clone's own remote says: Azure DevOps
   * keeps no head ref of a pull request, so its source branch, from the
   * fork when it comes from one. The window's facts only name the branch
   * and the fork; the host is the clone's.
   */
  async function sourceOf(
    git: DeckGit,
    clone: DeckClone,
    entry: DeckCloneEntry,
  ): Promise<{ from: string; ref: string } | DeckCloneFailure> {
    const remotes = await remotesOf(git);
    const own = remotes.get(clone.remote) ?? [];
    const azure = own.some((address) =>
      /^(azure|server):/.test(cloneIdentityOf(address) ?? ""),
    );
    if (!azure) {
      // GitHub keeps every pull request's head, a fork's too, in the repository.
      return { from: clone.remote, ref: `refs/pull/${entry.number}/head` };
    }
    if (!entry.clone.headRef) return "no_head_ref";
    const ref = `refs/heads/${checkedBranch(entry.clone.headRef)}`;
    const fork = entry.clone.repositoryIdentity.source;
    if (!fork) return { from: clone.remote, ref };
    // A fork's branch comes from a remote of the clone that names it, or
    // from its HTTPS or SSH address on the clone's own host and transport.
    const forkRemote = matchingRemote(remotes, fork.cloneUrls);
    if (forkRemote) return { from: forkRemote, ref };
    const ssh = own.some(isSshAddress);
    const hosts = new Set(own.map(fetchableHostOf).filter(Boolean));
    const address = fork.cloneUrls.find((url) => {
      const host = fetchableHostOf(url);
      return host && hosts.has(host) && isSshAddress(url) === ssh;
    });
    return address ? { from: address, ref } : "no_fork_remote";
  }

  /** Fetches the head into `ref`, or answers why it couldn't. */
  async function fetchHead(
    git: DeckGit,
    clone: DeckClone,
    entry: DeckCloneEntry,
    ref: string,
  ): Promise<DeckCloneFailure | undefined> {
    const source = await sourceOf(git, clone, entry);
    if (typeof source === "string") return source;
    const result = await git.run(
      [
        "fetch",
        "--quiet",
        "--no-tags",
        "--no-write-fetch-head",
        "--no-recurse-submodules",
        "--no-auto-maintenance",
        "--no-show-forced-updates",
        "--refmap=",
        "--",
        checkedRef(source.from),
        `+${checkedRef(source.ref)}:${checkedRef(ref)}`,
      ],
      timeouts.fetchMs,
    );
    if (result.timedOut) return "fetch_timeout";
    return result.code === 0 ? undefined : "fetch_failed";
  }

  async function hasCommit(git: DeckGit, head: string) {
    const result = await git.run(
      ["cat-file", "-e", `${head}^{commit}`],
      timeouts.localMs,
    );
    return result.code === 0;
  }

  /**
   * Removes what an earlier run left in one clone: worktrees and refs of
   * Deck's whose entries aren't in `liveIds`.
   */
  async function sweep(opened: Opened, liveIds: ReadonlySet<string>) {
    try {
      for (const tree of await worktreesOf(opened.git)) {
        const folder = normalized(opened, tree.folder);
        if (!isUnder(opened, opened.worktrees, folder)) continue;
        if (liveIds.has(opened.style.basename(folder))) continue;
        await removeWorktree(opened, folder, undefined);
      }
      const refs = await opened.git.read(
        ["for-each-ref", "--format=%(refname)", "refs/ajour/deck/"],
        timeouts.localMs,
      );
      for (const ref of refs.split(/\r?\n/).filter(Boolean)) {
        const id = /^refs\/ajour\/deck\/([0-9a-f]+)\/head$/.exec(ref)?.[1];
        if (id && liveIds.has(id)) continue;
        await dropRef(opened.git, ref);
      }
      await pruneDeckOnly(opened);
    } catch {
      // Left for the next sweep.
    }
  }

  /**
   * The worktree of the entry's pull request at its head, prepared now
   * unless it already is. `signal` stops it, and git with it.
   */
  function prepare(
    entry: DeckCloneEntry,
    signal?: AbortSignal,
  ): Promise<DeckClonePrepared> {
    // Known at once, so a release that comes before the first await waits.
    const run = (async (): Promise<DeckClonePrepared> => {
      const clone = (await options.storage.getDeckClones()).find((candidate) =>
        sameKey(candidate, entry),
      );
      if (!clone) return { state: "not_chosen" };
      return locked(clone, () => prepareIn(clone, entry, signal));
    })();
    preparing.set(entry.key, run);
    return run.finally(() => {
      if (preparing.get(entry.key) === run) preparing.delete(entry.key);
    });
  }

  async function prepareIn(
    clone: DeckClone,
    entry: DeckCloneEntry,
    signal?: AbortSignal,
  ): Promise<DeckClonePrepared> {
    if (signal?.aborted) return CANCELLED;
    const missing = unavailable(
      "clone_missing",
      `Ajour can't find your clone of ${entry.repository} any more. Choose it again in Settings › Agents.`,
    );
    const opened = await open(clone.environment, clone.path, signal);
    if (opened === "cancelled") return CANCELLED;
    if (opened === "no_git") {
      return unavailable(
        "no_git",
        "Git isn't installed, so Ajour can't read your clone.",
      );
    }
    if (opened === "wsl_unavailable") {
      return unavailable(
        "wsl_unavailable",
        "Ajour can't run git in your clone's WSL distribution.",
      );
    }
    if (typeof opened === "string") return missing;
    const { git } = opened;
    const id = idOf(entry.key);
    const ref = `refs/ajour/deck/${id}/head`;
    const folder = opened.style.join(opened.worktrees, id);
    const root = opened.here(folder);

    // What an earlier run left in this clone for entries the cache no
    // longer holds goes the first time.
    if (!swept.has(cloneKey(clone))) {
      swept.add(cloneKey(clone));
      const live = [
        ...prepared.keys(),
        ...((await options.liveKeys?.().catch(() => [])) ?? []),
        entry.key,
      ];
      await sweep(opened, new Set(live.map(idOf)));
    }

    // The remote still names the repository: a clone whose remote changed is chosen again.
    try {
      const addresses = (await remotesOf(git)).get(clone.remote) ?? [];
      if (
        !addresses.some((address) =>
          entry.clone.repositoryIdentity.cloneUrls.some((url) =>
            sameRepository(address, url),
          ),
        )
      ) {
        return unavailable(
          "remote_changed",
          `Your clone's ${clone.remote} remote no longer names ${entry.repository}. Choose the clone again in Settings › Agents.`,
        );
      }
    } catch {
      return signal?.aborted ? CANCELLED : missing;
    }

    const kept = prepared.get(entry.key);
    if (kept && kept.head === entry.head) return { state: "read", root };

    // A worktree an earlier run left for this entry, still at its head.
    try {
      const listed = (await worktreesOf(git)).find(
        (tree) => normalized(opened, tree.folder) === folder,
      );
      if (listed && !listed.prunable && listed.head === entry.head) {
        prepared.set(entry.key, { clone, folder, root, ref, head: entry.head });
        return { state: "read", root };
      }
      if (listed) await removeWorktree(opened, folder, undefined);
    } catch {
      return signal?.aborted ? CANCELLED : missing;
    }

    if (!FULL_COMMIT.test(entry.head)) {
      return unavailable(
        "head_not_full",
        "Ajour doesn't know this pull request's full head commit.",
      );
    }
    const notFound = unavailable(
      "head_not_found",
      `Your clone's remote doesn't have this pull request's head commit, ${entry.head.slice(0, 7)}.`,
    );
    const failed = async (outcome: DeckClonePrepared) => {
      await dropRef(git, ref);
      return signal?.aborted ? CANCELLED : outcome;
    };
    try {
      if (!(await hasCommit(git, entry.head))) {
        const failure = await fetchHead(git, clone, entry, ref);
        if (failure === "no_head_ref") {
          return unavailable(
            failure,
            "The code host didn't say which branch this pull request comes from.",
          );
        }
        if (failure === "no_fork_remote") {
          return unavailable(
            failure,
            "Your clone has no remote for the fork this pull request comes from.",
          );
        }
        if (failure === "fetch_timeout") {
          return failed(
            unavailable(
              failure,
              "Fetching this pull request into your clone took too long.",
            ),
          );
        }
        if (failure) {
          return failed(
            unavailable(
              "fetch_failed",
              "Ajour couldn't fetch this pull request into your clone. Check that git fetch works there.",
            ),
          );
        }
        // The fetched tip may be a newer push: the head must be the exact commit.
        if (!(await hasCommit(git, entry.head))) return failed(notFound);
      }
      // The ref names the head itself, so git keeps the commit while Deck reads it.
      await git.read(["update-ref", "--", ref, entry.head], timeouts.localMs);
    } catch {
      return failed(
        unavailable(
          "fetch_failed",
          "Ajour couldn't fetch this pull request into your clone. Check that git fetch works there.",
        ),
      );
    }

    try {
      const added = await git.run(
        [
          // A committed link could point the agent outside the worktree.
          "-c",
          "core.symlinks=false",
          "-c",
          "core.longpaths=true",
          "-c",
          "submodule.recurse=false",
          ...(await filterOverrides(git)),
          "worktree",
          "add",
          "--detach",
          "--quiet",
          "--",
          folder,
          entry.head,
        ],
        timeouts.checkoutMs,
      );
      if (added.code !== 0 || added.timedOut)
        throw new Error("Not checked out.");
    } catch {
      // Taken back with git that no stop cuts short.
      const cleanup = await open(clone.environment, clone.path);
      if (typeof cleanup !== "string")
        await removeWorktree(cleanup, folder, ref);
      return signal?.aborted
        ? CANCELLED
        : unavailable(
            "checkout_failed",
            "Ajour couldn't check out this pull request's head from your clone.",
          );
    }
    prepared.set(entry.key, { clone, folder, root, ref, head: entry.head });
    return { state: "read", root };
  }

  /**
   * Removes an entry's worktree and ref: its cache entry left the cache. A
   * preparation under way finishes first, so what it makes goes too.
   */
  async function release(key: string) {
    await preparing.get(key)?.catch(() => undefined);
    const kept = prepared.get(key);
    if (!kept) return;
    prepared.delete(key);
    await locked(kept.clone, async () => {
      const opened = await open(kept.clone.environment, kept.clone.path);
      if (typeof opened === "string") return;
      await removeWorktree(opened, kept.folder, kept.ref);
    });
  }

  /**
   * Removes what an earlier run left in every chosen clone: worktrees and
   * refs of Deck's whose entries aren't in `live` any more.
   */
  async function releaseExcept(live: ReadonlySet<string>) {
    for (const [key] of [...prepared]) {
      if (!live.has(key)) await release(key);
    }
    const liveIds = new Set([...live].map(idOf));
    for (const clone of await options.storage.getDeckClones()) {
      await locked(clone, async () => {
        const opened = await open(clone.environment, clone.path);
        if (typeof opened === "string") return;
        swept.add(cloneKey(clone));
        await sweep(opened, liveIds);
      });
    }
  }

  return {
    choose,
    prepare,
    release,
    releaseExcept,

    /** The clones the user chose. */
    clones: () => options.storage.getDeckClones(),

    /** Whether the user chose a clone of the repository. */
    async isChosen(repository: DeckCloneRepository) {
      return (await options.storage.getDeckClones()).some((clone) =>
        sameKey(clone, repository),
      );
    },

    /** Forgets a repository's clone, and removes its worktrees. False when it had none. */
    async forget(repository: DeckCloneRepository) {
      await releaseWhere((kept) => sameKey(kept.clone, repository));
      return options.storage.forgetDeckClone(repository);
    },

    /**
     * The folders among `folders`, ones Ajour already knows, whose remotes
     * name the repository. Only their remotes are read: Deck never looks
     * for clones on the disk.
     */
    async suggest(
      source: DeckCloneSource,
      folders: readonly { id: string; name: string; path: string }[],
    ): Promise<DeckCloneSuggestion[]> {
      const matches: (DeckCloneSuggestion | undefined)[] = new Array(
        folders.length,
      );
      let next = 0;
      const worker = async () => {
        while (next < folders.length) {
          const index = next++;
          const folder = folders[index]!;
          try {
            const git = await gitIn({ kind: "native" }, folder.path);
            if (!git) return;
            const remote = matchingRemote(
              await remotesOf(git),
              source.repositoryIdentity.cloneUrls,
            );
            if (remote) {
              matches[index] = {
                folderId: folder.id,
                name: folder.name,
                path: folder.path,
              };
            }
          } catch {
            // Not a clone of it, or not a clone at all.
          }
        }
      };
      await Promise.all(
        Array.from(
          { length: Math.min(SUGGESTION_READS_AT_ONCE, folders.length) },
          worker,
        ),
      );
      return matches.filter(
        (match): match is DeckCloneSuggestion => match !== undefined,
      );
    },
  };
}

export type DeckClones = ReturnType<typeof createDeckClones>;
