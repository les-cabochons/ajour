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
 * an earlier run's too. What an earlier run left for entries the cache no
 * longer holds goes at start (WSL clones at their first use), with
 * `git worktree prune` only when every stale registration in it is Deck's.
 * Forgetting or replacing a clone removes its worktrees first, while its
 * mapping still says where they are.
 *
 * Removal touches the user's disk, so it proves each folder is Deck's
 * first: a direct child of the worktrees folder, named by an entry's hash,
 * with the mark Deck wrote beside it before checking it out (`<id>.deck`).
 * Anything else there, a worktree the user made included, stays. A link or
 * junction where a worktree was goes itself, never what it points to, and a
 * folder goes only at its real path under the worktrees folder's.
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
   * The content cache's entries now, by key and repository: their
   * worktrees, an earlier run's included, stay when a clone is swept.
   */
  liveEntries?: () => Promise<Iterable<DeckCloneLive>>;
}

/** A content cache entry, as a sweep keeps its worktree. */
export interface DeckCloneLive extends DeckCloneRepository {
  key: string;
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
  /** The worktree's folder, as the agent reads it. */
  root: string;
  ref: string;
  head: string;
}

/** Where a clone's worktrees go, as removal checks them. */
interface Place {
  /** The path style of the clone's environment. */
  style: typeof path.posix;
  /** Where its worktrees go, in its environment, by its real path. */
  worktrees: string;
  /** A folder of its environment, as this computer and the agent read it. */
  here(folder: string): string;
}

/** A clone's environment, folder and git, once checked. */
interface Opened extends Place {
  git: DeckGit;
  environment: DeckCloneEnvironment;
  /** The clone's top folder, in its environment. */
  top: string;
}

/** A worktree's name: the hash `idOf` makes of its cache entry's key. */
const DECK_ID = /^[0-9a-f]{16}$/;

/**
 * What is at a worktree folder Deck proved its own: a folder at its real
 * path, a link or junction (which goes itself), or nothing.
 */
type Held = "folder" | "link" | "missing";

const isMissing = (error: unknown) =>
  ["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException)?.code ?? "");

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
  /**
   * The clones whose earlier runs' worktrees are swept, by `cloneKey`: only
   * once the sweep finished, so a removal that comes meanwhile waits for it.
   */
  const swept = new Set<string>();
  /**
   * What a sweep kept of an earlier run for entries the cache still held,
   * by `cloneKey`, by worktree id: their removal finds them here.
   */
  const leftovers = new Map<string, Set<string>>();
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
    return {
      git: (await gitIn(environment, nativeTop, signal)) ?? git,
      environment,
      top: nativeTop,
      ...(await nativePlace()),
    };
  }

  /** The worktrees folder on this computer, by its real path. */
  async function nativePlace(): Promise<Place> {
    // Git prints long paths: a short 8.3 name in the data folder's path,
    // as on a CI runner's temp folder, would never compare equal to them.
    await fs.mkdir(options.worktreesFolder, { recursive: true });
    const worktrees = await fs
      .realpath(options.worktreesFolder)
      .catch(() => options.worktreesFolder);
    return {
      style: path as typeof path.posix,
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
    // Worktrees of the clone chosen before go first: the next ask reads this
    // one, and no sweep finds them once its mapping is gone.
    await clear(repository);
    await options.storage.saveDeckClone(clone);
    return clone;
  }

  /**
   * Removes every worktree and ref of the repository's chosen clone, this
   * run's and an earlier's, before its mapping is forgotten or replaced.
   * Another repository's that share the folder stay.
   */
  async function clear(repository: DeckCloneRepository) {
    const clone = (await options.storage.getDeckClones()).find((other) =>
      sameKey(other, repository),
    );
    if (!clone) return;
    // What the preparations under way make goes too.
    await Promise.all(
      [...preparing.values()].map((run) => run.catch(() => undefined)),
    );
    const mine = [...prepared].filter(([, kept]) =>
      sameKey(kept.clone, repository),
    );
    for (const [key] of mine) prepared.delete(key);
    await locked(clone, async () => {
      const opened = await open(clone.environment, clone.path);
      if (typeof opened === "string") {
        for (const [key] of mine) await removeFolder(clone, idOf(key));
        return;
      }
      const others = [
        ...[...prepared].map(([key, kept]) => ({ key, ...kept.clone })),
        ...((await options.liveEntries?.().catch(() => [])) ?? []),
      ].filter((live) => !sameKey(live, repository));
      await sweep(clone, opened, new Set(others.map(({ key }) => idOf(key))));
    });
  }

  /** Deck's mark beside a worktree it made: removal's proof the folder is Deck's. */
  const markOf = (place: Place, id: string) =>
    place.style.join(place.worktrees, `${id}.deck`);

  /** The worktree folder of `id`, in its clone's environment. */
  const folderOf = (place: Place, id: string) =>
    place.style.join(place.worktrees, id);

  /**
   * The worktree's id when `folder`, in the clone's environment, is a
   * direct child of the worktrees folder named like Deck's. Its mark still
   * has to prove Deck made it.
   */
  function idIn(place: Place, folder: string): string | undefined {
    const id = place.style.basename(folder);
    return DECK_ID.test(id) &&
      place.style.relative(place.worktrees, place.style.dirname(folder)) === ""
      ? id
      : undefined;
  }

  /** Whether the worktrees folder itself is a real folder, not a link to one. */
  async function plainRoot(place: Place) {
    try {
      const root = await fs.lstat(place.here(place.worktrees));
      return root.isDirectory() && !root.isSymbolicLink();
    } catch {
      return false;
    }
  }

  /**
   * What is at the worktree folder of `id`, once Deck proves it its own: its
   * name is Deck's, its mark is beside it, and a folder there is one at its
   * real path under the worktrees folder's. Undefined, it stays as it is.
   */
  async function heldByDeck(
    place: Place,
    id: string,
  ): Promise<Held | undefined> {
    if (!DECK_ID.test(id) || !(await plainRoot(place))) return undefined;
    try {
      if (!(await fs.lstat(place.here(markOf(place, id)))).isFile()) {
        return undefined;
      }
    } catch {
      return undefined;
    }
    const here = place.here(folderOf(place, id));
    let found: Awaited<ReturnType<typeof fs.lstat>>;
    try {
      found = await fs.lstat(here);
    } catch (error) {
      return isMissing(error) ? "missing" : undefined;
    }
    // A junction is a link here too: it goes itself, never what it points to.
    if (found.isSymbolicLink()) return "link";
    if (!found.isDirectory()) return undefined;
    try {
      const [root, real] = await Promise.all([
        fs.realpath(place.here(place.worktrees)),
        fs.realpath(here),
      ]);
      return real === path.join(root, id) ? "folder" : undefined;
    } catch {
      return undefined;
    }
  }

  /** Removes what Deck proved its own at a worktree folder: a link itself, a folder whole. */
  async function removeHeld(place: Place, id: string, held: Held) {
    const here = place.here(folderOf(place, id));
    if (held === "link") {
      // Unlinking a junction or link never reaches its target; rmdir is a
      // directory junction's fallback on Windows.
      await fs
        .unlink(here)
        .catch(() => fs.rmdir(here))
        .catch(() => undefined);
    } else if (held === "folder") {
      await fs
        .rm(here, { recursive: true, force: true, maxRetries: 5 })
        .catch(() => undefined);
    }
  }

  /** Whether anything, a link included, is at `here`. */
  const occupied = (here: string) =>
    fs.lstat(here).then(
      () => true,
      (error: unknown) => !isMissing(error),
    );

  /** Writes Deck's mark beside a worktree folder it's about to make. */
  async function markAsDeck(place: Place, id: string) {
    await fs.writeFile(
      place.here(markOf(place, id)),
      "A worktree Ajour's Deck made. Ajour removes it with its cache entry.\n",
    );
  }

  /**
   * Removes Deck's mark once nothing is left of its worktree: on the disk,
   * and with `git`, in its clone's registrations.
   */
  async function forgetMark(place: Place, id: string, git?: DeckGit) {
    if ((await heldByDeck(place, id)) !== "missing") return;
    if (git) {
      const listed = await worktreesOf(git).catch(() => undefined);
      if (
        !listed ||
        listed.some(
          (tree) => idIn(place, place.style.resolve(tree.folder)) === id,
        )
      ) {
        return;
      }
    }
    await fs
      .rm(place.here(markOf(place, id)), { force: true })
      .catch(() => undefined);
  }

  /**
   * A worktree's folder on this computer, when git can't remove it: its
   * clone is gone. Only one Deck proves its own.
   */
  async function removeFolder(clone: DeckClone, id: string) {
    if (clone.environment.kind === "native") await removeNativeFolder(id);
  }

  /** A worktree's folder under the cache on this computer, once proved Deck's. */
  async function removeNativeFolder(id: string) {
    const place = await nativePlace();
    const held = await heldByDeck(place, id);
    if (!held) return;
    await removeHeld(place, id, held);
    await forgetMark(place, id);
  }

  /**
   * Removes one worktree and its ref, in its clone, once Deck proves the
   * worktree its own: git removes it with `--force` only then.
   */
  async function removeWorktree(
    opened: Opened,
    id: string,
    ref: string | undefined,
  ) {
    const held = await heldByDeck(opened, id);
    if (held === "folder") {
      const removed = await opened.git
        .run(
          [
            "worktree",
            "remove",
            "--force",
            "--force",
            "--",
            folderOf(opened, id),
          ],
          timeouts.checkoutMs,
        )
        .catch(() => undefined);
      // A folder git no longer knows, or one half made, proved again.
      if (removed?.code !== 0 && (await heldByDeck(opened, id)) === "folder") {
        await removeHeld(opened, id, "folder");
      }
    } else if (held === "link") {
      // Its registration is then stale, and goes with the prune.
      await removeHeld(opened, id, "link");
    }
    if (ref) await dropRef(opened.git, ref);
    await pruneDeckOnly(opened);
    if (held) await forgetMark(opened, id, opened.git);
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
   * registration it would drop is one Deck proves its own, its folder gone:
   * the user's own stay as they are.
   */
  async function pruneDeckOnly(opened: Opened) {
    try {
      const prunable = (await worktreesOf(opened.git)).filter(
        (tree) => tree.prunable,
      );
      if (!prunable.length) return;
      for (const tree of prunable) {
        const id = idIn(opened, normalized(opened, tree.folder));
        if (!id || (await heldByDeck(opened, id)) !== "missing") return;
      }
      await opened.git.run(
        ["worktree", "prune", "--expire=now"],
        timeouts.localMs,
      );
    } catch {
      // Left for the next time.
    }
  }

  /**
   * With per-worktree settings on in the clone, git copies the user's into
   * a new worktree, a sparse checkout's included: Deck's own worktree then
   * says it isn't sparse, in its own settings, never in the user's.
   */
  async function notSparse(
    opened: Opened,
    folder: string,
    signal?: AbortSignal,
  ) {
    const perWorktree = await opened.git.run(
      ["config", "--type=bool", "--get", "extensions.worktreeConfig"],
      timeouts.localMs,
    );
    if (perWorktree.code !== 0 || perWorktree.stdout.trim() !== "true") return;
    const worktree = await gitIn(opened.environment, folder, signal);
    if (!worktree) throw new Error("No git.");
    for (const setting of ["core.sparseCheckout", "core.sparseCheckoutCone"]) {
      await worktree.read(
        ["config", "--worktree", setting, "false"],
        timeouts.localMs,
      );
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
   * Deck's whose entries aren't in `liveIds`. Those of live entries this
   * run hasn't prepared are kept as leftovers, for their removal.
   */
  async function sweep(
    clone: DeckClone,
    opened: Opened,
    liveIds: ReadonlySet<string>,
  ) {
    const kept = new Set<string>();
    leftovers.set(cloneKey(clone), kept);
    const ours = new Set(
      [...prepared]
        .filter(([, each]) => cloneKey(each.clone) === cloneKey(clone))
        .map(([key]) => idOf(key)),
    );
    const keep = (id: string) => {
      if (!ours.has(id)) kept.add(id);
    };
    try {
      for (const tree of await worktreesOf(opened.git)) {
        // Only a direct child named like Deck's; its mark proves the rest.
        const id = idIn(opened, normalized(opened, tree.folder));
        if (!id) continue;
        if (liveIds.has(id)) {
          keep(id);
          continue;
        }
        await removeWorktree(opened, id, undefined);
      }
      const refs = await opened.git.read(
        ["for-each-ref", "--format=%(refname)", "refs/ajour/deck/"],
        timeouts.localMs,
      );
      for (const ref of refs.split(/\r?\n/).filter(Boolean)) {
        const id = /^refs\/ajour\/deck\/([0-9a-f]+)\/head$/.exec(ref)?.[1];
        if (id && liveIds.has(id)) {
          keep(id);
          continue;
        }
        await dropRef(opened.git, ref);
      }
      await pruneDeckOnly(opened);
      // Only now: a removal that came during the sweep waited for it, and
      // finds what it kept in `leftovers`.
      swept.add(cloneKey(clone));
    } catch {
      // Left for the next sweep.
      swept.delete(cloneKey(clone));
    }
  }

  /**
   * The first time this run opens a clone: what an earlier run left in it
   * for entries the cache no longer holds goes. `keep` is an entry being
   * prepared, `drop` one leaving. It runs under the clone's lock, like
   * every write to it.
   */
  async function sweepFirstTime(
    clone: DeckClone,
    opened: Opened,
    change: { keep?: string; drop?: string } = {},
  ) {
    if (swept.has(cloneKey(clone))) return;
    const live = new Set([
      ...prepared.keys(),
      ...preparing.keys(),
      ...[...((await options.liveEntries?.().catch(() => [])) ?? [])].map(
        ({ key }) => key,
      ),
    ]);
    if (change.keep) live.add(change.keep);
    if (change.drop) live.delete(change.drop);
    await sweep(clone, opened, new Set([...live].map(idOf)));
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

    await sweepFirstTime(clone, opened, { keep: entry.key });

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
      if (
        listed &&
        !listed.prunable &&
        listed.head === entry.head &&
        (await heldByDeck(opened, id)) === "folder"
      ) {
        leftovers.get(cloneKey(clone))?.delete(id);
        prepared.set(entry.key, { clone, root, ref, head: entry.head });
        return { state: "read", root };
      }
      if (listed) await removeWorktree(opened, id, undefined);
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

    const checkoutFailed = unavailable(
      "checkout_failed",
      "Ajour couldn't check out this pull request's head from your clone.",
    );
    // The folder is free, or holds only what Deck left there, which goes;
    // anything else's stays, and the clone isn't read. Then Deck marks the
    // folder its own before git makes it, so a removal can prove it.
    try {
      await fs.mkdir(opened.here(opened.worktrees), { recursive: true });
      const there = await heldByDeck(opened, id);
      if (there === "folder" || there === "link") {
        await removeHeld(opened, id, there);
      }
      if (!(await plainRoot(opened)) || (await occupied(opened.here(folder)))) {
        return failed(checkoutFailed);
      }
      await markAsDeck(opened, id);
    } catch {
      return failed(checkoutFailed);
    }

    try {
      const added = await git.run(
        [
          // A committed link could point the agent outside the worktree.
          "-c",
          "core.symlinks=false",
          // Every file, whatever the user's clone leaves out of its own
          // checkout: git then copies none of its sparse patterns.
          "-c",
          "core.sparseCheckout=false",
          "-c",
          "core.sparseCheckoutCone=false",
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
      await notSparse(opened, folder, signal);
    } catch {
      // Taken back with git that no stop cuts short.
      const cleanup = await open(clone.environment, clone.path);
      if (typeof cleanup !== "string") await removeWorktree(cleanup, id, ref);
      return signal?.aborted ? CANCELLED : checkoutFailed;
    }
    leftovers.get(cloneKey(clone))?.delete(id);
    prepared.set(entry.key, { clone, root, ref, head: entry.head });
    return { state: "read", root };
  }

  /**
   * Removes an entry's worktree and ref: its cache entry left the cache. A
   * preparation under way finishes first, so what it makes goes too. With
   * its repository, the worktree an earlier run made goes as well.
   */
  async function release(key: string, repository?: DeckCloneRepository) {
    await preparing.get(key)?.catch(() => undefined);
    const kept = prepared.get(key);
    if (!kept) {
      if (repository) await releaseLeftover(key, repository);
      return;
    }
    prepared.delete(key);
    await locked(kept.clone, async () => {
      const opened = await open(kept.clone.environment, kept.clone.path);
      if (typeof opened === "string") {
        await removeFolder(kept.clone, idOf(key));
        return;
      }
      await removeWorktree(opened, idOf(key), kept.ref);
    });
  }

  /** Removes the worktree and ref an earlier run made for the entry. */
  async function releaseLeftover(key: string, repository: DeckCloneRepository) {
    const clone = (await options.storage.getDeckClones()).find((other) =>
      sameKey(other, repository),
    );
    if (!clone) return;
    const id = idOf(key);
    // Swept already, this run knows every leftover of the clone.
    if (
      swept.has(cloneKey(clone)) &&
      !leftovers.get(cloneKey(clone))?.has(id)
    ) {
      return;
    }
    await locked(clone, async () => {
      const opened = await open(clone.environment, clone.path);
      if (typeof opened === "string") {
        await removeFolder(clone, id);
        return;
      }
      await sweepFirstTime(clone, opened, { drop: key });
      if (prepared.has(key) || !leftovers.get(cloneKey(clone))?.delete(id)) {
        return;
      }
      await removeWorktree(opened, id, `refs/ajour/deck/${id}/head`);
    });
  }

  /**
   * At start: what an earlier run left in every clone on this computer for
   * entries the cache no longer holds goes, and so do folders under the
   * cache that no chosen clone or live entry owns. A WSL clone is swept the
   * first time it's used, so a start never wakes WSL.
   */
  async function sweepAtStart() {
    const clones = await options.storage.getDeckClones();
    for (const clone of clones) {
      if (clone.environment.kind !== "native") continue;
      await locked(clone, async () => {
        const opened = await open(clone.environment, clone.path);
        if (typeof opened === "string") return;
        await sweepFirstTime(clone, opened);
      });
    }
    const names = await fs
      .readdir(options.worktreesFolder)
      .catch(() => [] as string[]);
    const cached = new Set(
      [...((await options.liveEntries?.().catch(() => [])) ?? [])].map(
        ({ key }) => idOf(key),
      ),
    );
    for (const name of names) {
      if (!DECK_ID.test(name) || cached.has(name)) continue;
      // Read at each folder: an ask may have started meanwhile.
      const asked = [...prepared.keys(), ...preparing.keys()].map(idOf);
      if (asked.includes(name)) continue;
      // Only a folder Deck proves its own, and a link only itself.
      await removeNativeFolder(name);
    }
  }

  return {
    choose,
    prepare,
    release,
    sweepAtStart,

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
      await clear(repository);
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
