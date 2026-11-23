/**
 * Hand-off worktrees (spec #857, ADR 0022): the one module of Ajour that
 * runs git itself. A hand off asks it for a git worktree made for one
 * backlog item, inside the item's repository folder, on a new branch.
 *
 * Every git call follows the same rules. No shell, an argument list, `--`
 * before paths, no ref that starts with `-`, a timeout the call never
 * outlives (`Git.run`), and the hardened
 * git environment the process broker builds (`gitEnvironment`), with
 * prompts turned off. Writes to one repository run one at a time.
 *
 * It also lists the branches a new worktree can start from (#861), reads a
 * worktree's status, deletes or forgets one (#862), and removes by itself
 * the worktrees its two clean-up rules name (#864). Nothing else in Ajour
 * runs git.
 */

import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
  isValidHandoffBranch,
  isValidNewBranchName,
} from "../../../packages/shared/handoff-templates.ts";
import {
  MAX_LISTED_BRANCHES,
  MAX_PREVIEW_FILES,
  WORKTREES_FOLDER,
  worktreeBaseName,
  type FinishedItem,
  type ListedWorktree,
  type RepositoryBranch,
  type RepositoryBranches,
  type Worktree,
  type WorktreeChange,
  type WorktreeCleanUpResult,
  type WorktreeCleanUpRuleName,
  type WorktreeCleanUpRules,
  type WorktreeCleanUpState,
  type WorktreeDeletePreview,
  type WorktreeKeptReason,
  type WorktreeRunning,
  type WorktreeScope,
  type WorktreeStatus,
  type WorktreeStatusRequest,
} from "../../../packages/shared/worktrees.ts";
import type { Handoff } from "../../../packages/shared/handoffs.ts";
import {
  findExecutable,
  resolveLoginShellPath,
} from "./agent-runner/cli-path.ts";
import type { ApiEvents } from "./events.ts";
import { childEnvironment, gitEnvironment } from "./process-broker.ts";
import { resolveSpawn } from "./process-spawn/index.ts";
import { endProcessTree } from "./process-tree.ts";
import { worktreePathIn } from "./repository-folders.ts";
import type { AppApiStorage } from "./storage.ts";

/** How long one git call may take, by what it does. */
export interface WorktreeGitTimeouts {
  /** A call that reads or writes refs and small files. */
  localMs: number;
  /** A fetch, which waits for the network. */
  fetchMs: number;
  /** Adding or removing a worktree, which writes a whole checkout. */
  checkoutMs: number;
}

const DEFAULT_TIMEOUTS: WorktreeGitTimeouts = {
  localMs: 15_000,
  fetchMs: 20_000,
  checkoutMs: 120_000,
};

/** The longest branch asked for: a handoff's branch holds 500 with its suffix. */
const MAX_BRANCH_LENGTH = 480;
/** How many `-2`, `-3` names are tried before the create gives up. */
const MAX_SUFFIX = 50;
/** Git's output kept per call. A call that writes more fails. */
const MAX_OUTPUT_BYTES = 1024 * 1024;
/**
 * How long a call waits for git's output to end once git has exited. A
 * process git started may hold that output open for as long as it runs.
 */
const OUTPUT_DRAIN_MS = 1000;
/** The line Ajour keeps in the repository's local exclude file. */
const EXCLUDE_LINE = "/.ajour/";
const DAY_MS = 86_400_000;
/**
 * How long clean up leaves a worktree alone after a hand off in it, a
 * change of one of its threads, or its creation.
 */
const RECENT_MS = 3_600_000;

/**
 * How each worktree operation opens its event: one event per operation, of
 * its own, beside the request that asked for it.
 */
const OPERATION = { kind: "job", trigger: "user", detached: true } as const;

/** Why a worktree operation did nothing, as its event says it. */
export type WorktreeRefusalReason =
  | "invalid_branch"
  | "folder_unavailable"
  | "source_unresolved"
  | "name_unavailable"
  /**
   * A rollback found another folder where the create had made its own, or
   * a delete found something else than the worktree at its path.
   */
  | "folder_changed"
  /** Ajour keeps no worktree of that id. */
  | "worktree_not_found"
  /** A delete on a computer without git, or in a folder that is no checkout. */
  | "git_missing"
  | "not_repository"
  /** Another worktree has the branch a delete was asked to delete. */
  | "branch_in_use"
  /** A forget of a worktree whose folder is still on disk. */
  | "worktree_present"
  /** A delete of a worktree whose git status changed since its preview (#857). */
  | "worktree_changed"
  | "git_failed"
  | "timeout";

/**
 * An operation that did nothing: a create that made nothing or took back
 * what it made, a delete or a forget that left everything in place. The
 * message is for the user and may name a branch. The event gets only the
 * reason.
 */
export class WorktreeRefused extends Error {
  readonly reason: WorktreeRefusalReason;
  constructor(reason: WorktreeRefusalReason, message: string) {
    super(message);
    this.reason = reason;
  }
}

export interface WorktreeCreateInput {
  projectId: string;
  repositoryFolderId: string;
  /** The item's id. An item without a key gets its folder name from it. */
  workItemId: string;
  /** The item's key. The folder name comes from it: `aj-<key as a slug>`. */
  itemKey: string;
  /**
   * The branch to create. A taken name gets `-2`, `-3`. Without one the
   * branch gets the worktree's folder name, such as `aj-4821`.
   */
  branch?: string;
  /**
   * The source the user picked (#861), as the branch list names it, such
   * as `origin/release/1.4` or `develop`. Without one the branch starts
   * from the folder's default source (`defaultSource`).
   */
  source?: string;
}

/** A worktree a create just made. Git keeps it locked until `keep`. */
export interface CreatedWorktree {
  worktree: Worktree;
  /** The fetch failed: the branch starts from the last fetched copy. */
  sourceStale: boolean;
  /** The tool answered: the worktree stays and git's lock on it is lifted. */
  keep(): Promise<void>;
  /**
   * The start failed: removes the worktree and the branch this create
   * made, and nothing else.
   */
  discard(): Promise<void>;
}

/**
 * What a create answers. `unavailable` is a folder Ajour can't make a
 * worktree in: the hand off then starts in the main folder, as before
 * worktrees existed.
 */
export type WorktreeCreateResult =
  | ({ kind: "created" } & CreatedWorktree)
  | { kind: "unavailable"; reason: "git_missing" | "not_repository" };

/**
 * What a tool that makes its own worktree is told (#863): the source, as
 * git names it, such as `origin/main`, and the branch to create, the first
 * free name. `stale` says the fetch of a remote's branch failed, so the
 * tool starts from the last fetched copy. `unavailable` is a folder that
 * gets no worktree: the hand off then starts in the main folder.
 */
export type WorktreeSourceResult =
  | { kind: "source"; name: string; branch: string; stale: boolean }
  | { kind: "unavailable"; reason: "git_missing" | "not_repository" };

/**
 * A clean-up round left the worktree it was about to remove (#864). With a
 * reason the worktree is kept, and the round says why. Without one no rule
 * names it any more, as when the user switched the rule off meanwhile: it
 * is neither removed nor kept.
 */
class KeptByCleanUp extends Error {
  readonly reason: WorktreeKeptReason | undefined;
  constructor(reason: WorktreeKeptReason | undefined) {
    super(reason ?? "not due");
    this.reason = reason;
  }
}

/** How a delete runs. */
interface DeleteOptions {
  /** Also deletes the worktree's branch, after the worktree. */
  deleteBranch?: boolean;
  /**
   * The preview's `fingerprint` the user confirmed (#857). Under the
   * repository's lock, just before the forced removal, it is read again
   * (`deleteFingerprint`), and a worktree whose files, checked-out commit
   * or branch tip no longer match stays whole.
   */
  fingerprint?: string;
  /**
   * Automatic clean up's delete (#864), which nobody confirmed. The
   * function is the round's last look: it runs under the repository's
   * lock, once the folder is proven to be the worktree and git status
   * found it clean, as the last thing before the removal starts, and
   * throws `KeptByCleanUp` to leave the worktree.
   * Such a delete removes the worktree only while it holds no uncommitted
   * or untracked file and git takes it without force. It never drops the
   * record of a folder that is already gone, and never removes what git
   * left behind.
   */
  unconfirmed?: (worktree: Worktree) => Promise<void>;
}

/** What a delete did, for the route's answer and its event. */
export interface WorktreeDeleted {
  /** The folder was already gone: only git's registration and the record went. */
  missing: boolean;
  /** False when the branch wasn't asked for, was gone, or git kept it. */
  branchDeleted: boolean;
}

/**
 * What one clean-up round did (#864): what the route answers, and the
 * counts its event records. `looked` counts the worktrees it assessed, and
 * `due` those a rule would remove now.
 */
export interface WorktreeCleanUpRound {
  result: WorktreeCleanUpResult;
  looked: number;
  due: number;
  rules: WorktreeCleanUpRules;
}

export interface WorktreesOptions {
  storage: Pick<
    AppApiStorage,
    | "listWorktrees"
    | "addWorktree"
    | "removeWorktree"
    | "getWorktreeSource"
    | "getWorktreeSettings"
    | "listHandoffs"
  >;
  /** A repository folder's real path, rechecked at use (`FolderResolver`). */
  folders: { resolve(id: string, projectId?: string): Promise<string> };
  events?: ApiEvents;
  now?: () => number;
  timeouts?: Partial<WorktreeGitTimeouts>;
}

interface GitResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

/** A git call that failed, with what git said, for the user's message. */
class GitFailure extends Error {
  readonly reason: "git_failed" | "timeout";
  constructor(reason: "git_failed" | "timeout", said: string) {
    super(said);
    this.reason = reason;
  }
}

/** The last line git wrote, which says why it stopped. */
function lastLine(text: string): string {
  return (
    text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .at(-1) ?? ""
  );
}

/** Whether two paths name the same place, whatever the separators. */
function samePath(a: string, b: string): boolean {
  return path.relative(a, b) === "";
}

/** A ref Ajour may hand git: never one git could read as an option. */
function checkedRef(ref: string): string {
  if (!ref || ref.startsWith("-") || /[\0\r\n]/.test(ref))
    throw new GitFailure("git_failed", "Ajour refused an unsafe git ref.");
  return ref;
}

/** Git, run in one repository folder under the module's rules. */
class Git {
  private readonly executable: string;
  private readonly env: Record<string, string | undefined>;
  private readonly cwd: string;
  constructor(
    executable: string,
    env: Record<string, string | undefined>,
    cwd: string,
  ) {
    this.executable = executable;
    this.env = env;
    this.cwd = cwd;
  }

  /**
   * Runs git and answers its exit code and output. Rejects when git can't
   * start, or wrote too much.
   *
   * A call never outlives its deadline, and never waits long on git's
   * output once git is gone. A process git started, such as a hook's
   * background child or a credential or fetch helper, can inherit that
   * output and keep it open after git exits. So the call settles on git's
   * exit, after at most `OUTPUT_DRAIN_MS` for what is left to read. At the
   * deadline it ends git with everything it started, lets go of the output
   * and answers `timedOut`. Otherwise the hand off would hang, and hold the
   * repository's lock over every later operation there.
   */
  run(args: readonly string[], timeoutMs: number): Promise<GitResult> {
    const plan = resolveSpawn(this.executable, args, this.env);
    if ("refused" in plan)
      return Promise.reject(
        new GitFailure("git_failed", "Ajour couldn't start git."),
      );
    return new Promise<GitResult>((resolve, reject) => {
      const child = spawn(plan.command, plan.args, {
        env: plan.env,
        cwd: this.cwd,
        shell: false,
        windowsHide: true,
        // On POSIX git leads its own session: its helpers end with it, and
        // it has no terminal to ask a password on.
        detached: process.platform !== "win32",
        stdio: ["ignore", "pipe", "pipe"],
      });
      const chunks = { stdout: [] as Buffer[], stderr: [] as Buffer[] };
      let size = 0;
      let exited = false;
      let settled = false;
      let timedOut = false;
      let draining: ReturnType<typeof setTimeout> | undefined;
      const stop = () => endProcessTree(child, plan.env, () => exited);
      /** Ends the call once, and stops reading: nothing waits on a stream after. */
      const settle = (answer: GitFailure | { code: number | null }) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        clearTimeout(draining);
        child.stdout.destroy();
        child.stderr.destroy();
        if (answer instanceof GitFailure) reject(answer);
        else
          resolve({
            code: answer.code,
            stdout: Buffer.concat(chunks.stdout).toString("utf8"),
            stderr: Buffer.concat(chunks.stderr).toString("utf8"),
            timedOut,
          });
      };
      const timer = setTimeout(() => {
        timedOut = true;
        stop();
        settle({ code: null });
      }, timeoutMs);
      for (const stream of ["stdout", "stderr"] as const)
        child[stream].on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_OUTPUT_BYTES) {
            stop();
            settle(new GitFailure("git_failed", "Git wrote too much output."));
          } else chunks[stream].push(chunk);
        });
      child.once("error", () =>
        settle(new GitFailure("git_failed", "Ajour couldn't start git.")),
      );
      child.once("exit", (code) => {
        exited = true;
        // Git is gone. Its output closes at once unless something it
        // started still holds it: that gets a moment, and no more.
        draining = setTimeout(() => settle({ code }), OUTPUT_DRAIN_MS);
      });
      // The usual end: git exited and its output is read to the end.
      child.once("close", (code) => settle({ code }));
    });
  }

  /** The trimmed output of a call that must succeed. */
  async read(args: readonly string[], timeoutMs: number): Promise<string> {
    const result = await this.run(args, timeoutMs);
    if (result.timedOut)
      throw new GitFailure("timeout", "Git took too long to answer.");
    if (result.code !== 0)
      throw new GitFailure(
        "git_failed",
        lastLine(result.stderr) || "Git failed without saying why.",
      );
    return result.stdout.trim();
  }

  /** Whether a call that answers by its exit code said yes (0) or no (1). */
  async test(args: readonly string[], timeoutMs: number): Promise<boolean> {
    const result = await this.run(args, timeoutMs);
    if (result.timedOut)
      throw new GitFailure("timeout", "Git took too long to answer.");
    if (result.code === 0) return true;
    if (result.code === 1) return false;
    throw new GitFailure(
      "git_failed",
      lastLine(result.stderr) || "Git failed without saying why.",
    );
  }
}

/** What the new branch starts from. */
interface Source {
  /** Why it is the source: the start named it, the folder's last pick, or neither. */
  choice: "picked" | "remembered" | "default";
  /** The name the user reads, such as `origin/main`. */
  name: string;
  /** The full ref git resolves, such as `refs/remotes/origin/main`. */
  ref: string;
  /** The remote branch to fetch first, when the source is one. */
  remote?: { name: string; branch: string };
}

/**
 * What one create made, so a rollback removes those things and nothing a
 * program beside Ajour made under the same name meanwhile.
 */
interface Made {
  /** The repository folder, whose `.ajour/worktrees` holds the worktree. */
  repository: string;
  folder: string;
  branch: string;
  /** The commit the branch started from. */
  commit: string;
  /**
   * The folder the create made itself, as the file system knows it. A
   * rollback removes the folder only while it is still that one.
   */
  folderMade?: FolderIdentity;
  /** The create made the branch, which didn't exist before. */
  branchMade: boolean;
}

/** What tells one folder from another that later takes its name. */
interface FolderIdentity {
  dev: bigint;
  ino: bigint;
}

/**
 * Where a worktree's folder is, or was. `live` while it is the real
 * directory the folder resolver accepts. Without a repository folder that
 * resolves there is no path to name.
 */
type Place =
  | { live: true; repository: string; folder: string }
  | { live: false; repository?: string; folder?: string };

/** The status a list shows, from the changes git status reported, if it did. */
function statusOf(changes: WorktreeChange[] | undefined): WorktreeStatus {
  if (!changes) return { state: "unknown" };
  return changes.length
    ? { state: "changed", changes: changes.length }
    : { state: "clean" };
}

/**
 * The lines of `git status --porcelain=v1 -z`: two status letters, a space
 * and the file, each ended by a NUL. A rename or a copy is followed by the
 * file it came from, as an entry of its own.
 */
function parseStatus(output: string): WorktreeChange[] {
  const entries = output.split("\0");
  const changes: WorktreeChange[] = [];
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index]!;
    if (entry.length < 4) continue;
    const code = entry.slice(0, 2);
    const from = /[RC]/.test(code) ? entries[++index] : undefined;
    changes.push({ code, path: entry.slice(3), ...(from ? { from } : {}) });
  }
  return changes;
}

/**
 * The refusal of a confirmed delete whose worktree no longer holds what its
 * preview showed (#857). The route answers it with 409, and the dialog reads
 * the preview again.
 */
const changedSincePreview = (worktree: Worktree) =>
  new WorktreeRefused(
    "worktree_changed",
    `${worktree.name} changed since Ajour showed what it holds. Check it again before you delete it.`,
  );

/**
 * Whether a thread still runs in the worktree, as its handoffs were last
 * read: `working` when one is working, else `needs-you` when one waits for
 * the user. A paused handoff counts by the state it had: Ajour can't read
 * it now, and the thread may well still run.
 */
function runningIn(
  worktreeId: string,
  handoffs: readonly Handoff[],
): WorktreeRunning | undefined {
  const states = handoffs
    .filter((handoff) => handoff.worktreeId === worktreeId)
    .map((handoff) => handoff.state);
  if (states.includes("working")) return "working";
  return states.includes("needs-you") ? "needs-you" : undefined;
}

/** What a clean-up round asks of the handoffs (`Worktrees.cleanUp`). */
export interface CleanUpHooks {
  /**
   * Reads again the state of the threads in these worktrees, linked or
   * not, and answers the worktrees where a thread no handoff links is
   * Working or Needs you, and those whose threads it couldn't read.
   */
  refreshThreads?: (
    worktreeIds: string[],
  ) => Promise<{ running: string[]; unconfirmed: string[] }>;
}

/** What one clean-up pass reads once, for every worktree it looks at. */
interface CleanUpContext {
  now: number;
  rules: WorktreeCleanUpRules;
  /** When each finished item became so, by item id, as the window sent it. */
  finished: ReadonlyMap<string, number>;
  handoffs: readonly Handoff[];
  /** What git registers in each repository folder, read once per pass. */
  registrations: Map<string, Promise<{ folder: string; branch?: string }[]>>;
}

/** What the rules say of one worktree now. */
interface Verdict {
  /** The rule that removes the worktree now. */
  due?: WorktreeCleanUpRuleName;
  /**
   * When `due`'s delay ended. Without `due`, when the first delay ahead
   * ends: the finished items rule's, for an item that is finished, or the
   * unused rule's.
   */
  at?: number;
  /** Why the worktree stays whatever the rules say. */
  kept?: WorktreeKeptReason;
}

/**
 * What a list says clean up will do: nothing to say for a worktree no rule
 * names. A worktree a rule removes now is `kept` with why, or `goes`. One
 * a rule will remove `goes` on the day the first of its delays ends, unless
 * something that time won't lift keeps it.
 */
function cleanUpStateOf(verdict: Verdict): WorktreeCleanUpState | undefined {
  if (verdict.at === undefined) return undefined;
  if (verdict.due)
    return verdict.kept
      ? { kind: "kept", reason: verdict.kept }
      : { kind: "goes", at: verdict.at };
  return !verdict.kept || verdict.kept === "recent"
    ? { kind: "goes", at: verdict.at }
    : undefined;
}

/**
 * What the two rules say of a worktree at the context's moment, from its
 * record and its stored threads alone. The finished items rule counts from
 * the moment the window gave for the worktree's item. The unused rule
 * counts from the last hand off or thread change in the worktree, also of
 * a thread since removed from its item (`lastUsedAt`), or from its
 * creation, and needs nothing of the item. `due` is the rule that removes
 * it now, `at` when that rule's delay ended or, with none due, when the
 * first delay ahead ends, and `lastUsed` its last use.
 */
function dueOf(
  worktree: Worktree,
  context: CleanUpContext,
): { due?: WorktreeCleanUpRuleName; at?: number; lastUsed: number } {
  const { now, rules } = context;
  const lastUsed = Math.max(
    worktree.createdAt,
    // The use of a thread since removed from its item, kept on the record.
    worktree.lastUsedAt ?? 0,
    ...context.handoffs
      .filter((handoff) => handoff.worktreeId === worktree.id)
      .flatMap((thread) => [thread.startedAt, thread.changedAt]),
  );
  const finishedAt = context.finished.get(worktree.workItemId);
  const finishedEnds =
    rules.finished.enabled && finishedAt !== undefined
      ? finishedAt + rules.finished.days * DAY_MS
      : undefined;
  const unusedEnds = rules.unused.enabled
    ? lastUsed + rules.unused.days * DAY_MS
    : undefined;
  if (finishedEnds !== undefined && finishedEnds <= now)
    return { due: "finished", at: finishedEnds, lastUsed };
  if (unusedEnds !== undefined && unusedEnds <= now)
    return { due: "unused", at: unusedEnds, lastUsed };
  // None is due: the one that ends first, so the list says the earliest
  // day the worktree goes.
  const ahead = [finishedEnds, unusedEnds].filter(
    (ends): ends is number => ends !== undefined,
  );
  return { ...(ahead.length ? { at: Math.min(...ahead) } : {}), lastUsed };
}

/** The fields of a `worktree.create` event, gathered while it runs. */
interface CreateFacts {
  source?: "remote" | "local";
  source_choice?: Source["choice"];
  fetch?: "ok" | "failed" | "none";
  name_suffix?: number;
  branch_suffix?: number;
  rolled_back?: boolean;
}

export { worktreeBaseName };

export class Worktrees {
  private readonly options: WorktreesOptions;
  private readonly now: () => number;
  private readonly timeouts: WorktreeGitTimeouts;
  /** The last write of each repository, by its common git folder. */
  private readonly locks = new Map<string, Promise<unknown>>();
  /**
   * The worktrees a hand off is starting in, by id, with how many starts
   * hold each (`hold`). Clean up leaves them alone.
   */
  private readonly held = new Map<string, number>();
  /** The clean-up round under way, so two never remove at once. */
  private cleaning: Promise<unknown> = Promise.resolve();
  /**
   * The worktrees the last round was about to remove and kept for a reason
   * only an attempt shows, by id: git couldn't remove it, or the state of
   * its threads couldn't be read. The Settings list says so. Kept in
   * memory: the round at each launch finds them again.
   */
  private readonly lastKept = new Map<string, "failed" | "unconfirmed">();

  constructor(options: WorktreesOptions) {
    this.options = options;
    this.now = options.now ?? (() => Date.now());
    this.timeouts = { ...DEFAULT_TIMEOUTS, ...options.timeouts };
  }

  /** Every worktree Ajour keeps on this computer, oldest first. */
  async list(): Promise<Worktree[]> {
    return this.options.storage.listWorktrees();
  }

  /**
   * The item's worktrees whose folder is still on disk, newest first: the
   * places a later hand off of the item can start in.
   */
  async liveOf(projectId: string, workItemId: string): Promise<Worktree[]> {
    const candidates = await this.recordsOf({ projectId, workItemId });
    const live: Worktree[] = [];
    for (const worktree of candidates) {
      // The worktree's own id resolves only while its folder is there.
      const found = await this.options.folders
        .resolve(worktree.id, projectId)
        .then(
          () => true,
          () => false,
        );
      if (found) live.push(worktree);
    }
    return live;
  }

  /** The records of a scope, newest first. */
  private async recordsOf(scope: WorktreeScope): Promise<Worktree[]> {
    return (
      (await this.options.storage.listWorktrees())
        .filter(
          (worktree) =>
            (scope.projectId === undefined ||
              worktree.projectId === scope.projectId) &&
            (scope.workItemId === undefined ||
              worktree.workItemId === scope.workItemId),
        )
        // Newest first, and the later record first when two share a moment.
        .reverse()
        .sort((a, b) => b.createdAt - a.createdAt)
    );
  }

  /**
   * The item's newest worktree in a repository folder whose folder is still
   * on disk, so a later hand off continues the earlier one's work.
   */
  async newestLive(
    projectId: string,
    repositoryFolderId: string,
    workItemId: string,
  ): Promise<Worktree | undefined> {
    return (await this.liveOf(projectId, workItemId)).find(
      (worktree) => worktree.repositoryFolderId === repositoryFolderId,
    );
  }

  /**
   * The branches a new worktree can start from in a repository folder
   * (#861): local and remote ones, the default source first, then the
   * remote's default branch and the main folder's branch, then the rest by
   * their last commit, newest first. It reads the refs the repository
   * already has and never contacts a remote, so a remote that can't be
   * reached delays nothing: a remote-tracking branch is listed as last
   * fetched, and a remote whose default branch git didn't record marks
   * none and leaves `source` out (`listedSource`). `unavailable` for a
   * folder Ajour can't make a worktree in. Throws
   * `WorktreeRefused` when the folder is gone or git fails, with a message
   * that holds nothing of what git wrote: only the reason says why.
   */
  async branches(
    projectId: string,
    repositoryFolderId: string,
  ): Promise<RepositoryBranches> {
    try {
      const repository = await this.resolveRepository(
        projectId,
        repositoryFolderId,
      );
      const git = await this.gitIn(repository);
      if (!git) return { unavailable: "git_missing", branches: [] };
      if (!(await this.repositoryOf(git, repository)))
        return { unavailable: "not_repository", branches: [] };
      const current = await this.currentBranch(git);
      const remoteDefault = await this.remoteDefault(git, false);
      const source = await this.listedSource(git, repositoryFolderId);
      const listed: RepositoryBranch[] = [];
      let total = 0;
      for (const ref of (
        await git.read(
          [
            "for-each-ref",
            "--sort=-committerdate",
            "--format=%(refname)",
            "refs/heads",
            "refs/remotes",
          ],
          this.timeouts.localMs,
        )
      ).split(/\r?\n/)) {
        const local = ref.startsWith("refs/heads/");
        const name = local
          ? ref.slice("refs/heads/".length)
          : ref.startsWith("refs/remotes/")
            ? ref.slice("refs/remotes/".length)
            : "";
        // A remote's `HEAD` names its default branch, which is listed itself.
        if (!name || (!local && name.endsWith("/HEAD"))) continue;
        // A name the start route would refuse is not offered.
        if (name.length > 500 || !isValidHandoffBranch(name)) continue;
        if (++total > MAX_LISTED_BRANCHES) continue;
        listed.push({
          name,
          remote: !local,
          ...(!local && name === remoteDefault?.name
            ? { default: true as const }
            : {}),
          ...(local && name === current ? { current: true as const } : {}),
        });
      }
      // The picks a user makes most come first, whatever their last commit.
      const rank = (branch: RepositoryBranch) =>
        branch.name === source?.name && branch.remote === Boolean(source.remote)
          ? 0
          : branch.default
            ? 1
            : branch.current
              ? 2
              : 3;
      return {
        ...(current ? { current } : {}),
        ...(source ? { source: source.name } : {}),
        branches: listed
          .map((branch, index) => ({ branch, index }))
          .sort((a, b) => rank(a.branch) - rank(b.branch) || a.index - b.index)
          .map(({ branch }) => branch),
        ...(total > MAX_LISTED_BRANCHES ? { truncated: true as const } : {}),
      };
    } catch (error) {
      // Git's own words may name a branch or a path: none of them leaves.
      const { reason } = asRefusal(error);
      throw new WorktreeRefused(
        reason,
        reason === "folder_unavailable"
          ? "This repository folder is no longer available."
          : reason === "timeout"
            ? "Ajour couldn't list this folder's branches: git took too long to answer."
            : "Ajour couldn't list this folder's branches.",
      );
    }
  }

  /**
   * The worktrees of a scope with their status (#862), newest first: one
   * item's for its Handoffs card, one project's, or all of them. With the
   * finished items of the request, each also says what automatic clean up
   * will do with it (#864, `cleanUp`). The status
   * is read from git now: `clean`, `changed` with the number of files git
   * status reports, `missing` when the folder is no longer the real
   * directory Ajour made, or `unknown` when git can't say. For a folder
   * that is gone it also drops git's registration of that worktree, and of
   * no other (`pruneMissing`). `pruned` counts those. It never throws for a
   * worktree it can't read: that one is `missing` or `unknown`.
   */
  async statuses(
    request: WorktreeStatusRequest = {},
  ): Promise<{ listed: ListedWorktree[]; pruned: number }> {
    const { finished, ...scope } = request;
    const listed: ListedWorktree[] = [];
    let pruned = 0;
    // With the finished items, each worktree also says what clean up will
    // do with it (#864), by the rules a round applies.
    const context = finished ? await this.cleanUpContext(finished) : undefined;
    const handoffs =
      context?.handoffs ?? (await this.options.storage.listHandoffs());
    for (const worktree of await this.recordsOf(scope)) {
      const place = await this.placeOf(worktree);
      if (
        !place.live &&
        place.repository &&
        // A registration it couldn't drop changes nothing the list shows.
        (await this.pruneMissing(place.repository, worktree.name).catch(
          () => false,
        ))
      )
        pruned++;
      const entry = await this.listedAt(worktree, place, handoffs);
      const cleanUp = context
        ? cleanUpStateOf(
            await this.verdict(worktree, place, entry.status, context, true),
          )
        : undefined;
      listed.push(cleanUp ? { ...entry, cleanUp } : entry);
    }
    return { listed, pruned };
  }

  /**
   * Says a hand off is starting in a worktree the item already has (#864):
   * its tool is about to be asked and Ajour holds no thread for it yet.
   * Until the answer's function is called, clean up counts the worktree as
   * used just now, and removes it under no rule. A new worktree needs none:
   * git keeps it locked until its tool answered.
   *
   * The claim is taken under the repository's lock, the one a removal
   * holds to its end. So either the hold is there when a round takes its
   * last look, or the hold waits for the removal and then finds the
   * worktree gone, or no longer whole when git removed it in part. It
   * then throws `WorktreeRefused`, as it does when the lock can't be
   * taken, and the hand off never starts a tool in a folder that is being
   * removed or in what git left of one.
   *
   * A worktree a tool switched to another branch is still the one Ajour
   * made (#857): the answer's `branch` is the one checked out there now,
   * which the tool is told, or absent when the worktree is detached.
   */
  async hold(
    worktreeId: string,
  ): Promise<{ release: () => void; branch?: string }> {
    const worktree = await this.recorded(worktreeId);
    const unavailable = () =>
      new WorktreeRefused(
        "folder_unavailable",
        `${worktree.name} can't be used for a hand off right now.`,
      );
    // Without the lock a removal could be under way unseen: git that is
    // gone or too slow to answer means no hand off in this worktree.
    const commonDir = await this.lockKeyOf(worktree).catch(() => undefined);
    if (!commonDir) throw unavailable();
    const checkout = await this.locked(commonDir, async () => {
      // Read again under the lock: a removal that held it is done. It may
      // have removed the worktree in part and kept the record, so the
      // folder must still be a checkout git lists for this repository, on
      // whatever branch.
      const current = await this.recorded(worktreeId);
      const place = await this.placeOf(current);
      const found = place.live
        ? await this.checkoutOf(place, new Map()).catch(() => undefined)
        : undefined;
      if (!found) throw unavailable();
      this.held.set(worktreeId, (this.held.get(worktreeId) ?? 0) + 1);
      return found;
    });
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      const left = (this.held.get(worktreeId) ?? 1) - 1;
      if (left > 0) this.held.set(worktreeId, left);
      else this.held.delete(worktreeId);
    };
    return { release, ...(checkout.branch ? { branch: checkout.branch } : {}) };
  }

  /** The key of the lock a worktree's repository writes under, if it has one. */
  private async lockKeyOf(worktree: Worktree): Promise<string | undefined> {
    const repository = await this.resolveRepository(
      worktree.projectId,
      worktree.repositoryFolderId,
    );
    const git = await this.gitIn(repository);
    return git ? this.repositoryOf(git, repository) : undefined;
  }

  /**
   * One clean-up round (#864). It removes the worktrees a rule names and
   * nothing else stands for: those of finished items, a number of days
   * after the item became done, settled or archived, and, when that rule
   * is on, those nobody handed off in and whose threads didn't change for
   * a number of days. `finished` says when each finished item became so.
   * The window sends it, since backlog items live there, and an item it
   * doesn't name is not finished.
   *
   * It never removes a worktree with uncommitted or untracked files, with
   * a thread that is Working or Needs you, with a hand off or a thread
   * change in the last hour, with a hand off that is starting in it
   * (`hold`), whose checked-out branch is no longer the one
   * Ajour recorded, or whose folder is not the worktree Ajour made inside
   * `.ajour/worktrees`. It never deletes a branch. A removal goes through
   * the delete path with all its checks (`delete`), asked to remove a clean
   * worktree only, so git itself refuses one with work in it.
   *
   * `refreshThreads` reads again, from their tools, the state of the
   * threads in the worktrees about to go, also those no handoff links that
   * a tool lists there (#857). It answers the worktrees where such a
   * thread is Working or Needs you (`running`), kept as `running`, and
   * those whose threads it couldn't read (`unconfirmed`), kept since a
   * thread there may be at work. Each removal then takes a last look under the repository's
   * lock, which a hand off takes its hold through: the rules as they are
   * now, the holds, and the threads as stored now. A rule switched off
   * meanwhile, a hand off that began or a thread that went back to work
   * leaves the worktree. Answers what it removed and what it kept, with
   * why. It never throws for a worktree it can't remove: that one is kept.
   */
  async cleanUp(
    finished: readonly FinishedItem[],
    hooks: CleanUpHooks = {},
  ): Promise<WorktreeCleanUpRound> {
    const run = this.cleaning.then(() => this.cleanUpRound(finished, hooks));
    // The next round waits for this one, whatever its end.
    this.cleaning = run.catch(() => undefined);
    return run;
  }

  private async cleanUpRound(
    finished: readonly FinishedItem[],
    hooks: CleanUpHooks,
  ): Promise<WorktreeCleanUpRound> {
    const result: WorktreeCleanUpResult = { removed: [], kept: [] };
    const context = await this.cleanUpContext(finished);
    // Oldest first, so a round's answer reads in the order they were made.
    const records = await this.options.storage.listWorktrees();
    const candidates: Worktree[] = [];
    let due = 0;
    for (const worktree of records) {
      const place = await this.placeOf(worktree);
      const status: WorktreeStatus = place.live
        ? statusOf(await this.changesIn(place.folder))
        : { state: "missing" };
      const verdict = await this.verdict(
        worktree,
        place,
        status,
        context,
        false,
      );
      // What the last round found of it no longer holds.
      this.lastKept.delete(worktree.id);
      if (!verdict.due) continue;
      due++;
      if (verdict.kept)
        result.kept.push({
          worktreeId: worktree.id,
          name: worktree.name,
          reason: verdict.kept,
        });
      else candidates.push(worktree);
    }
    const ids = candidates.map((worktree) => worktree.id);
    // A refresh that fails as a whole confirms no thread's state.
    const threads =
      candidates.length && hooks.refreshThreads
        ? await hooks
            .refreshThreads(ids)
            .catch(() => ({ running: [], unconfirmed: ids }))
        : { running: [], unconfirmed: [] };
    const running = new Set(threads.running);
    const unconfirmed = new Set(threads.unconfirmed);
    for (const worktree of candidates) {
      const kept = (reason: WorktreeKeptReason) => {
        if (reason === "failed" || reason === "unconfirmed")
          this.lastKept.set(worktree.id, reason);
        result.kept.push({
          worktreeId: worktree.id,
          name: worktree.name,
          reason,
        });
      };
      // A thread no handoff links runs there: no stored state says so.
      if (running.has(worktree.id)) {
        kept("running");
        continue;
      }
      if (unconfirmed.has(worktree.id)) {
        kept("unconfirmed");
        continue;
      }
      // The rule the last look found due, which may be the other one by then.
      let rule: WorktreeCleanUpRuleName | undefined;
      try {
        await this.delete(worktree.id, {
          unconfirmed: async (current) => {
            rule = await this.lastLook(current, finished);
          },
        });
        result.removed.push({
          worktreeId: worktree.id,
          name: worktree.name,
          rule: rule ?? "finished",
        });
      } catch (error) {
        if (error instanceof KeptByCleanUp) {
          // No reason: no rule names it any more, so it is not kept either.
          if (error.reason) kept(error.reason);
          continue;
        }
        const reason = error instanceof WorktreeRefused ? error.reason : "";
        // Deleted by the user meanwhile: neither removed here nor kept.
        if (reason === "worktree_not_found") continue;
        kept(
          reason === "folder_changed" || reason === "folder_unavailable"
            ? "not_ours"
            : "failed",
        );
      }
    }
    return { result, looked: records.length, due, rules: context.rules };
  }

  /**
   * A removal's last look, under the repository's lock (`delete`): whether
   * a rule still names the worktree, by the rules, the clock, the holds and
   * the stored threads as they are at that moment, not as the round first
   * read them. Answers the rule that is due. Throws `KeptByCleanUp` when
   * none is, when a hand off holds the worktree, when a thread runs in it,
   * when a thread's state is still unknown after the round's refresh, or
   * when it was used in the last hour.
   */
  private async lastLook(
    worktree: Worktree,
    finished: readonly FinishedItem[],
  ): Promise<WorktreeCleanUpRuleName> {
    const context = await this.cleanUpContext(finished);
    const { due, lastUsed } = dueOf(worktree, context);
    if (!due) throw new KeptByCleanUp(undefined);
    if (this.held.has(worktree.id)) throw new KeptByCleanUp("recent");
    if (runningIn(worktree.id, context.handoffs))
      throw new KeptByCleanUp("running");
    // A thread still Unknown once the round asked its tool may be at work:
    // nothing confirms it is idle.
    if (
      context.handoffs.some(
        (handoff) =>
          handoff.worktreeId === worktree.id && handoff.state === "unknown",
      )
    )
      throw new KeptByCleanUp("unconfirmed");
    if (context.now - lastUsed < RECENT_MS) throw new KeptByCleanUp("recent");
    return due;
  }

  /** What a clean-up pass reads once: the rules, the clock and the threads. */
  private async cleanUpContext(
    finished: readonly FinishedItem[],
  ): Promise<CleanUpContext> {
    const now = this.now();
    return {
      now,
      rules: (await this.options.storage.getWorktreeSettings()).cleanUp,
      finished: new Map(
        finished
          // A moment before zero or after now is no moment an item was
          // finished at: such an item counts as not finished, so a wrong
          // number never makes a worktree due at once.
          .filter((item) => item.finishedAt >= 0 && item.finishedAt <= now)
          .map((item) => [item.workItemId, item.finishedAt]),
      ),
      handoffs: await this.options.storage.listHandoffs(),
      registrations: new Map(),
    };
  }

  /**
   * What the two rules say of a worktree now (`dueOf`), and why it would
   * stay. `forList` also names a worktree the last round was about to
   * remove and couldn't, which a round itself tries again.
   */
  private async verdict(
    worktree: Worktree,
    place: Place,
    status: WorktreeStatus,
    context: CleanUpContext,
    forList: boolean,
  ): Promise<Verdict> {
    const { due, at, lastUsed } = dueOf(worktree, context);
    // A worktree no rule names is left unread: its list row says its status.
    if (at === undefined) return {};
    const kept = await this.keptReason(worktree, place, status, context, {
      // A hand off that is starting there is a use, as fresh as it gets.
      recent: context.now - lastUsed < RECENT_MS || this.held.has(worktree.id),
      remembered: forList && due !== undefined,
    });
    return { ...(due ? { due } : {}), at, ...(kept ? { kept } : {}) };
  }

  /**
   * Why clean up keeps a worktree, if anything stands for it. In this
   * order: its folder is gone, or is no longer the worktree Ajour made
   * inside `.ajour/worktrees`. A thread still runs in it. It holds
   * uncommitted or untracked files. Its checked-out branch is no longer
   * the one Ajour recorded. Git can't say. Someone used it in the last
   * hour. The last round couldn't remove it, or couldn't read its threads.
   */
  private async keptReason(
    worktree: Worktree,
    place: Place,
    status: WorktreeStatus,
    context: CleanUpContext,
    also: { recent: boolean; remembered: boolean },
  ): Promise<WorktreeKeptReason | undefined> {
    if (!place.live) {
      // Reached through a link, as when `.ajour/worktrees` became one, a
      // folder is still there, and it is not where Ajour made it.
      const there =
        place.folder &&
        (await fs.stat(place.folder).then(
          () => true,
          () => false,
        ));
      return there ? "not_ours" : "missing";
    }
    const proof = await this.proofOf(
      worktree,
      place,
      context.registrations,
    ).catch(() => "failed" as const);
    if (proof === "not_ours") return "not_ours";
    if (runningIn(worktree.id, context.handoffs)) return "running";
    if (status.state === "changed") return "changes";
    if (proof) return proof;
    if (status.state !== "clean") return "failed";
    if (also.recent) return "recent";
    return also.remembered ? this.lastKept.get(worktree.id) : undefined;
  }

  /**
   * Whether the folder is still the worktree Ajour made, by the proof a
   * clean-up removal asks for (`deleteWorktree`): it is a checkout of this
   * repository (`checkoutOf`), and its branch is the recorded one.
   * Undefined when it is.
   */
  private async proofOf(
    worktree: Worktree,
    place: Place & { live: true },
    /** What git registers in each repository folder, read once per pass. */
    registrations: CleanUpContext["registrations"],
  ): Promise<"not_ours" | "branch" | undefined> {
    const checkout = await this.checkoutOf(place, registrations);
    if (!checkout) return "not_ours";
    return checkout.ref === `refs/heads/${checkedRef(worktree.branch)}`
      ? undefined
      : "branch";
  }

  /**
   * What the folder has checked out, while it is a checkout of this
   * repository: git lists it as a worktree of the repository, and git run
   * inside it answers the same common git folder. `ref` is git's full ref,
   * such as `refs/heads/fix/x`, and `branch` its name; both are absent
   * when the worktree is detached. Undefined when the folder is not such a
   * checkout. A tool may switch a worktree to a branch of its own (#857):
   * the folder is still the worktree Ajour made.
   */
  private async checkoutOf(
    place: Place & { live: true },
    registrations: CleanUpContext["registrations"],
  ): Promise<{ ref?: string; branch?: string } | undefined> {
    const git = await this.gitIn(place.repository);
    const commonDir = git && (await this.repositoryOf(git, place.repository));
    if (!git || !commonDir) throw new GitFailure("git_failed", "No git.");
    let registered = registrations.get(place.repository);
    if (!registered) {
      registered = this.registrations(git);
      registrations.set(place.repository, registered);
    }
    const entry = (await registered).find((candidate) =>
      samePath(candidate.folder, place.folder),
    );
    if (!entry) return undefined;
    const inside = await this.gitIn(place.folder);
    if (
      !inside ||
      (await this.repositoryOf(inside, place.folder)) !== commonDir
    )
      return undefined;
    return entry.branch
      ? {
          ref: entry.branch,
          ...(entry.branch.startsWith("refs/heads/")
            ? { branch: entry.branch.slice("refs/heads/".length) }
            : {}),
        }
      : {};
  }

  /**
   * What deleting a worktree would lose (#862): the files git status
   * reports in it, at most `MAX_PREVIEW_FILES` with the count of the rest,
   * the item's threads there that are Working or Needs you, and how many
   * commits of its branch no remote-tracking branch reaches. It changes
   * nothing. Throws `WorktreeRefused` for an id Ajour keeps no worktree of.
   *
   * The fingerprint is read first, and what the dialog shows after it. A
   * change between the two reads then shows in the dialog and makes the
   * confirmed delete refuse, instead of passing the fingerprint unseen.
   */
  async deletePreview(id: string): Promise<WorktreeDeletePreview> {
    const worktree = await this.recorded(id);
    const place = await this.placeOf(worktree);
    const fingerprint = await this.deleteFingerprint(
      place.repository,
      place.live ? place.folder : undefined,
      worktree.branch,
    );
    const changes = place.live ? await this.changesIn(place.folder) : undefined;
    const running = (await this.options.storage.listHandoffs()).flatMap(
      (handoff) =>
        handoff.worktreeId === id &&
        // A paused handoff's state is stale: its chip says Paused.
        !handoff.paused &&
        (handoff.state === "working" || handoff.state === "needs-you")
          ? [
              {
                pluginId: handoff.pluginId,
                toolId: handoff.toolId,
                state: handoff.state,
              },
            ]
          : [],
    );
    const branch = place.repository
      ? await this.branchFacts(place.repository, worktree.branch).catch(
          () => undefined,
        )
      : undefined;
    // The branch a tool switched it to, which the dialog names (#857).
    const checkout = place.live
      ? await this.checkoutOf(place, new Map()).catch(() => undefined)
      : undefined;
    const switched =
      place.live &&
      checkout &&
      checkout.ref !== `refs/heads/${checkedRef(worktree.branch)}`
        ? checkout.branch
          ? { branch: checkout.branch }
          : await this.commitsOnNoBranch(place.folder).then((count) =>
              count ? { commitsOnNoBranch: count } : {},
            )
        : undefined;
    return {
      listed: {
        worktree,
        status: place.live ? statusOf(changes) : { state: "missing" },
        ...(place.folder ? { path: place.folder } : {}),
      },
      fingerprint,
      files: (changes ?? []).slice(0, MAX_PREVIEW_FILES),
      moreFiles: Math.max(0, (changes?.length ?? 0) - MAX_PREVIEW_FILES),
      running,
      ...(branch ? { branch } : {}),
      ...(switched ? { switched } : {}),
    };
  }

  /**
   * Deletes a worktree the user confirmed (#862), or one a clean-up round
   * removes (#864, `unconfirmed`): its folder with every
   * file in it, committed or not, git's registration of it, and its record.
   * Its handoffs stay and lose their link to it. With `deleteBranch` its
   * branch goes too, after the worktree.
   *
   * The path is never the caller's: it is `.ajour/worktrees/<name>` of the
   * record's repository folder, checked as a create checks it. What is
   * there must be the worktree Ajour made: a real directory that git lists
   * as a worktree of this repository on the recorded branch, and that is
   * itself a checkout of this repository. A record made
   * in an earlier session holds no other proof, and a branch is checked out
   * in one worktree only. Anything else at the path refuses the delete and
   * stays: a link, a folder git doesn't list. A worktree a tool switched to
   * another branch is deleted once the user confirmed (#857), since the
   * folder is still a checkout of this repository, and only its recorded
   * branch can go with it. A clean-up removal still leaves it. A folder
   * that is already gone needs no proof: its registration and its record
   * go.
   *
   * The branch is refused, before anything is removed, while another
   * worktree has it checked out. Throws `WorktreeRefused` when it deleted
   * nothing.
   */
  async delete(
    id: string,
    options: DeleteOptions = {},
  ): Promise<WorktreeDeleted> {
    try {
      const worktree = await this.recorded(id);
      const repository = await this.resolveRepository(
        worktree.projectId,
        worktree.repositoryFolderId,
      );
      const git = await this.gitIn(repository);
      if (!git)
        throw new WorktreeRefused(
          "git_missing",
          "Ajour needs git to delete a worktree, and found none on this computer.",
        );
      const commonDir = await this.repositoryOf(git, repository);
      if (!commonDir)
        throw new WorktreeRefused(
          "not_repository",
          "This repository folder is no longer a git repository, so Ajour can't delete its worktree.",
        );
      // The record is read again once the lock is held: a delete that
      // waited behind another one of the same worktree finds it gone, and
      // says so. What git registers is read under the lock too.
      return await this.locked(commonDir, async () =>
        this.deleteWorktree(
          git,
          repository,
          commonDir,
          await this.recorded(worktree.id),
          options,
        ),
      );
    } catch (error) {
      // Ajour's own refusals say why in its words. What git wrote may name
      // a file or a path, and none of it leaves: only the reason does.
      if (error instanceof WorktreeRefused || error instanceof KeptByCleanUp)
        throw error;
      const timedOut =
        error instanceof GitFailure && error.reason === "timeout";
      throw new WorktreeRefused(
        timedOut ? "timeout" : "git_failed",
        timedOut
          ? "Ajour couldn't delete this worktree: git took too long to answer."
          : "Ajour couldn't delete this worktree: git failed.",
      );
    }
  }

  private async deleteWorktree(
    git: Git,
    repository: string,
    commonDir: string,
    worktree: Worktree,
    options: DeleteOptions,
  ): Promise<WorktreeDeleted> {
    const folder = worktreePathIn(repository, worktree.name);
    const left = () =>
      new WorktreeRefused(
        "folder_changed",
        `Something else than the worktree Ajour made is at ${worktree.name} now, so Ajour left it in place.`,
      );
    // Nothing is removed through a link at `.ajour` or `.ajour/worktrees`.
    const holds = await this.worktreesFolder(repository, false).catch(() => {
      throw new WorktreeRefused(
        "folder_unavailable",
        `Ajour can't delete ${worktree.name}: ${WORKTREES_FOLDER.join("/")} in its repository folder is a link or a file, not a real folder.`,
      );
    });
    const at = (candidate: string) =>
      fs
        .lstat(candidate, { bigint: true })
        .catch((error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT" || error.code === "ENOTDIR")
            return undefined;
          throw error;
        });
    const found = holds ? await at(folder) : undefined;
    const ref = `refs/heads/${checkedRef(worktree.branch)}`;
    const registrations = await this.registrations(git);
    const registered = registrations.find((entry) =>
      samePath(entry.folder, folder),
    );
    // Asked first, so a refusal leaves the worktree as it was.
    if (
      options.deleteBranch &&
      registrations.some(
        (entry) => entry.branch === ref && !samePath(entry.folder, folder),
      )
    )
      throw new WorktreeRefused(
        "branch_in_use",
        `Another worktree has the branch ${worktree.branch} checked out, so Ajour can't delete it. Delete the worktree without its branch.`,
      );
    if (!found) {
      // A clean up removes a worktree it just saw on disk. One that is
      // gone since stays in the list as Missing, for the user to forget.
      if (options.unconfirmed) throw left();
      // A folder on disk at the preview and gone now changed since, and so
      // did a branch that moved: it may hold a commit the preview never
      // counted, which "Also delete the branch" would drop. The dialog
      // reads it again.
      if (
        options.fingerprint !== undefined &&
        (await this.deleteFingerprint(
          repository,
          undefined,
          worktree.branch,
        )) !== options.fingerprint
      )
        throw changedSincePreview(worktree);
      // The folder is gone: only git's own note of this worktree is left.
      if (registered)
        await git.read(
          ["worktree", "remove", "--force", "--force", "--", folder],
          this.timeouts.localMs,
        );
    } else {
      if (
        found.isSymbolicLink() ||
        !found.isDirectory() ||
        !samePath(await fs.realpath(folder), folder)
      )
        throw left();
      if (!registered) throw left();
      // Git keeps listing a worktree whose folder something else replaced:
      // the folder itself must be a checkout of this repository.
      const inside = await this.gitIn(folder);
      if (!inside || (await this.repositoryOf(inside, folder)) !== commonDir)
        throw left();
      // Nobody confirmed a clean-up removal: a worktree switched to
      // another branch stays. The user's delete takes it on any branch.
      if (options.unconfirmed && registered.branch !== ref)
        throw new WorktreeRefused(
          "folder_changed",
          `${worktree.name} is no longer on the branch Ajour made it on, ${worktree.branch}, so Ajour left it in place.`,
        );
      if (options.unconfirmed) {
        // Git status, under the lock: nobody confirmed this removal, so a
        // file that is not committed keeps the worktree.
        const changes = await this.changesIn(folder);
        if (!changes)
          throw new GitFailure("git_failed", "Git couldn't read its status.");
        if (changes.length) throw new KeptByCleanUp("changes");
        // Then the round's last look, the last thing before the removal
        // starts: the rules, the holds and the threads as they are now,
        // also after the time git took to read the status.
        await options.unconfirmed(worktree);
      } else if (options.fingerprint !== undefined) {
        // The user confirmed what the preview showed. A file a tool wrote
        // since, listed or past the list, and a commit made since, which
        // the branch count never held, were never shown: they stay.
        if (
          (await this.deleteFingerprint(
            repository,
            folder,
            worktree.branch,
          )) !== options.fingerprint
        )
          throw changedSincePreview(worktree);
      }
      const removed = await git.run(
        options.unconfirmed
          ? // Not forced: git refuses a worktree with modified or untracked
            // files, and a locked one, should either appear since the
            // check above. Untracked files count whatever the user's
            // `status.showUntrackedFiles` says.
            [
              "-c",
              "status.showUntrackedFiles=normal",
              "worktree",
              "remove",
              "--",
              folder,
            ]
          : // Twice forced: once for uncommitted changes, once for a locked
            // one. The user confirmed with the list of those changes in
            // front of them.
            ["worktree", "remove", "--force", "--force", "--", folder],
        this.timeouts.checkoutMs,
      );
      if (removed.timedOut)
        throw new GitFailure("timeout", "Git took too long to answer.");
      const rest = await at(folder);
      if (rest) {
        // Git removed nothing: it still lists the worktree, which stays whole.
        if (
          (await this.registrations(git)).some((entry) =>
            samePath(entry.folder, folder),
          )
        )
          throw new GitFailure(
            "git_failed",
            lastLine(removed.stderr) || "Git failed without saying why.",
          );
        // Git forgot the worktree and left files, as when one was in use.
        // Nobody confirmed an automatic removal, so what git left stays
        // for the user, and the round says git couldn't remove it.
        if (options.unconfirmed) throw new KeptByCleanUp("failed");
        // A delete the user confirmed finishes the job: they go while the
        // folder is still the one checked above.
        if (
          rest.isSymbolicLink() ||
          !rest.isDirectory() ||
          rest.ino === 0n ||
          rest.dev !== found.dev ||
          rest.ino !== found.ino ||
          !(await this.worktreesFolder(repository, false).catch(() => false))
        )
          throw left();
        await fs.rm(folder, { recursive: true, force: true });
      }
    }
    // The worktree is gone: its record goes whatever happens to the branch.
    await this.options.storage.removeWorktree(worktree.id);
    const branchDeleted = options.deleteBranch
      ? await this.deleteNamedBranch(git, worktree.branch, ref).catch(
          () => false,
        )
      : false;
    return { missing: !found, branchDeleted };
  }

  /**
   * Deletes a branch the user asked to delete with its worktree, whatever
   * commits it holds: the dialog showed how many are on no remote. Not
   * while a worktree has it checked out, which git refuses too. Answers
   * whether it did.
   */
  private async deleteNamedBranch(
    git: Git,
    branch: string,
    ref: string,
  ): Promise<boolean> {
    const exists = await git.test(
      ["show-ref", "--verify", "--quiet", ref],
      this.timeouts.localMs,
    );
    if (!exists) return false;
    if ((await this.registrations(git)).some((entry) => entry.branch === ref))
      return false;
    const deleted = await git.run(
      ["branch", "-D", "--", branch],
      this.timeouts.localMs,
    );
    return deleted.code === 0 && !deleted.timedOut;
  }

  /**
   * Forgets a worktree whose folder is gone (#862): its record goes, and
   * git's registration of it when one is left. Its handoffs stay and lose
   * their link to it. Nothing on disk is removed, so whatever else holds
   * the name stays. Throws `WorktreeRefused` for a worktree still on disk,
   * which Delete removes.
   */
  async forget(id: string): Promise<void> {
    const worktree = await this.recorded(id);
    const place = await this.placeOf(worktree);
    if (place.live)
      throw new WorktreeRefused(
        "worktree_present",
        `${worktree.name} is still on disk. Delete it instead.`,
      );
    if (place.repository)
      await this.pruneMissing(place.repository, worktree.name).catch(
        () => false,
      );
    await this.options.storage.removeWorktree(id);
  }

  /**
   * The folder of a worktree that is still on disk, for the window's Open
   * in terminal and its file manager action. Throws `WorktreeRefused` when
   * it is gone.
   */
  async folderOf(id: string): Promise<string> {
    const worktree = await this.recorded(id);
    const place = await this.placeOf(worktree);
    if (!place.live)
      throw new WorktreeRefused(
        "folder_unavailable",
        `The folder of ${worktree.name} is no longer on disk.`,
      );
    return place.folder;
  }

  /** The record of that id, or a refusal. */
  private async recorded(id: string): Promise<Worktree> {
    const worktree = (await this.options.storage.listWorktrees()).find(
      (candidate) => candidate.id === id,
    );
    if (!worktree)
      throw new WorktreeRefused(
        "worktree_not_found",
        "This worktree is no longer in Ajour's list.",
      );
    return worktree;
  }

  /** Where the worktree's folder is, or was, and whether it is still there. */
  private async placeOf(worktree: Worktree): Promise<Place> {
    const repository = await this.options.folders
      .resolve(worktree.repositoryFolderId, worktree.projectId)
      .catch(() => undefined);
    if (!repository) return { live: false };
    const folder = worktreePathIn(repository, worktree.name);
    // The worktree's own id resolves only while its folder is a real
    // directory there, which is also what a hand off can start in.
    const live = await this.options.folders
      .resolve(worktree.id, worktree.projectId)
      .then(
        () => true,
        () => false,
      );
    return { live, repository, folder };
  }

  /** A worktree as a list shows it, with its status read now. */
  private async listedAt(
    worktree: Worktree,
    place: Place,
    handoffs: readonly Handoff[],
  ): Promise<ListedWorktree> {
    const running = runningIn(worktree.id, handoffs);
    return {
      worktree,
      status: place.live
        ? statusOf(await this.changesIn(place.folder))
        : { state: "missing" },
      ...(place.folder ? { path: place.folder } : {}),
      // A folder that is gone holds no running thread to name.
      ...(running && place.live ? { running } : {}),
    };
  }

  /**
   * The changed and untracked files git status reports in a worktree's
   * folder, or undefined when git can't say. Untracked files always count,
   * whatever the user's `status.showUntrackedFiles` says: a delete loses
   * them. A new folder counts once, as git status shows it.
   */
  private async changesIn(
    folder: string,
  ): Promise<WorktreeChange[] | undefined> {
    try {
      const git = await this.gitIn(folder);
      // A folder that is no checkout of its own would answer for the
      // repository folder around it.
      if (!git || !(await this.repositoryOf(git, folder))) return undefined;
      // Not `read`: a status line may start with a space, which it trims.
      const result = await git.run(
        ["status", "--porcelain=v1", "-z", "--untracked-files=normal"],
        this.timeouts.localMs,
      );
      return result.code === 0 && !result.timedOut
        ? parseStatus(result.stdout)
        : undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * How many commits a detached worktree's `HEAD` alone holds (#857): no
   * local branch, remote-tracking branch or tag reaches them. A delete
   * removes that `HEAD` with its reflog, so a later `git gc` drops them.
   * Zero when git can't say.
   */
  private async commitsOnNoBranch(folder: string): Promise<number> {
    try {
      const git = await this.gitIn(folder);
      if (!git || !(await this.repositoryOf(git, folder))) return 0;
      const count = Number(
        await git.read(
          [
            "rev-list",
            "--count",
            "HEAD",
            "--not",
            "--branches",
            "--remotes",
            "--tags",
          ],
          this.timeouts.localMs,
        ),
      );
      return Number.isSafeInteger(count) ? count : 0;
    } catch {
      return 0;
    }
  }

  /**
   * Stands for what a confirmed delete would lose (#857). For a worktree on
   * disk (`folder`): its whole git status, each untracked file inside a new
   * folder included, the size and change time of each file that status
   * names, so more edits to a file already listed count too, the commit
   * its `HEAD` is on, and how many commits that `HEAD` alone holds
   * (`commitsOnNoBranch`, which a branch deleted since can raise). Always,
   * when the repository folder is known: the tip of the branch Ajour made
   * it on, which "Also delete the branch" drops, also for a worktree that
   * is already missing.
   * A delete preview answers it, and a confirmed delete reads it again just
   * before the removal. For a part git can't read, it stands for that
   * absence.
   */
  private async deleteFingerprint(
    repository: string | undefined,
    folder: string | undefined,
    branch: string,
  ): Promise<string> {
    const output = async (cwd: string, args: string[]) => {
      try {
        const git = await this.gitIn(cwd);
        // A folder that is no checkout of its own would answer for the
        // repository folder around it.
        if (!git || !(await this.repositoryOf(git, cwd))) return null;
        const result = await git.run(args, this.timeouts.localMs);
        return result.code === 0 && !result.timedOut ? result.stdout : null;
      } catch {
        return null;
      }
    };
    /**
     * Each file the status names, with its size and change time. A file
     * that is gone, as a deleted one, stands as null. Links are not
     * followed.
     */
    const stamps = (status: string | null, at: string) =>
      Promise.all(
        parseStatus(status ?? "").map((change) =>
          fs.lstat(path.join(at, change.path), { bigint: true }).then(
            (stats) => [
              change.path,
              stats.size.toString(),
              stats.mtimeNs.toString(),
            ],
            () => [change.path, null],
          ),
        ),
      );
    const inFolder = folder
      ? async () => {
          // `all`, not the list's `normal`: a file added inside an
          // untracked folder leaves that folder's one line unchanged.
          const status = await output(folder, [
            "status",
            "--porcelain=v1",
            "-z",
            "--untracked-files=all",
          ]);
          return Promise.all([
            status,
            stamps(status, folder),
            output(folder, ["rev-parse", "--verify", "--quiet", "HEAD"]),
            output(folder, [
              "rev-list",
              "--count",
              "HEAD",
              "--not",
              "--branches",
              "--remotes",
              "--tags",
            ]),
          ]);
        }
      : async () => null;
    const parts = await Promise.all([
      inFolder(),
      repository
        ? output(repository, [
            "rev-parse",
            "--verify",
            "--quiet",
            `refs/heads/${checkedRef(branch)}`,
          ])
        : null,
    ]);
    return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
  }

  /**
   * The worktree's branch and how many of its commits no remote-tracking
   * branch reaches, as last fetched: nothing is fetched to count them.
   * Undefined when the repository no longer has the branch.
   */
  private async branchFacts(
    repository: string,
    branch: string,
  ): Promise<{ name: string; unpushedCommits: number } | undefined> {
    const git = await this.gitIn(repository);
    if (!git || !(await this.repositoryOf(git, repository))) return undefined;
    const ref = `refs/heads/${checkedRef(branch)}`;
    const exists = await git.test(
      ["show-ref", "--verify", "--quiet", ref],
      this.timeouts.localMs,
    );
    if (!exists) return undefined;
    const count = Number(
      await git.read(
        ["rev-list", "--count", ref, "--not", "--remotes"],
        this.timeouts.localMs,
      ),
    );
    return Number.isSafeInteger(count)
      ? { name: branch, unpushedCommits: count }
      : undefined;
  }

  /**
   * Drops git's registration of a worktree whose folder is gone: that one
   * worktree's, by its path. Never `git worktree prune`, which would also
   * drop the user's own worktrees whose folders are away. Nothing is
   * removed from disk, and a name something still holds is left alone.
   * Answers whether it dropped one.
   */
  private async pruneMissing(
    repository: string,
    name: string,
  ): Promise<boolean> {
    const folder = worktreePathIn(repository, name);
    const gone = () =>
      fs.lstat(folder).then(
        () => false,
        (error: NodeJS.ErrnoException) => error.code === "ENOENT",
      );
    if (!(await gone())) return false;
    const git = await this.gitIn(repository);
    const commonDir = git && (await this.repositoryOf(git, repository));
    if (!git || !commonDir) return false;
    return this.locked(commonDir, async () => {
      if (
        !(await gone()) ||
        !(await this.registrations(git)).some((entry) =>
          samePath(entry.folder, folder),
        )
      )
        return false;
      await git.read(
        ["worktree", "remove", "--force", "--force", "--", folder],
        this.timeouts.localMs,
      );
      return true;
    });
  }

  /**
   * Makes a worktree for an item: `<repository folder>/.ajour/worktrees/aj-<key>`
   * on a new branch that starts at the source the start named, else the
   * folder's default one (`defaultSource`). A remote's branch is fetched
   * first. Throws `WorktreeRefused` when it made nothing, with a message
   * for the user.
   */
  async create(input: WorktreeCreateInput): Promise<WorktreeCreateResult> {
    const unit = this.options.events?.start("worktree.create", OPERATION);
    const facts: CreateFacts = {};
    try {
      const result = await this.createWorktree(input, facts);
      unit?.set({ worktree: facts });
      if (result.kind === "unavailable") unit?.refuse(result.reason);
      return result;
    } catch (error) {
      const refused = asRefusal(error);
      unit?.set({ worktree: facts });
      // A create ends with none of the reasons only a delete or a forget has.
      if (
        refused.reason === "timeout" ||
        refused.reason === "git_failed" ||
        refused.reason === "worktree_not_found" ||
        refused.reason === "branch_in_use" ||
        refused.reason === "worktree_present" ||
        refused.reason === "worktree_changed"
      )
        endFailed(unit, refused.reason);
      else unit?.refuse(refused.reason);
      throw refused;
    } finally {
      unit?.end();
    }
  }

  private async createWorktree(
    input: WorktreeCreateInput,
    facts: CreateFacts,
  ): Promise<WorktreeCreateResult> {
    const repository = await this.resolveRepository(
      input.projectId,
      input.repositoryFolderId,
    );
    const git = await this.gitIn(repository);
    if (!git) return { kind: "unavailable", reason: "git_missing" };
    const commonDir = await this.repositoryOf(git, repository);
    if (!commonDir) return { kind: "unavailable", reason: "not_repository" };
    // Checked only now that a branch will be created: where Ajour can make
    // no worktree, the hand off starts in the main folder whatever the name.
    if (input.branch !== undefined && !isValidNewBranchName(input.branch))
      throw new WorktreeRefused(
        "invalid_branch",
        "The branch for the new worktree is not a valid git branch.",
      );
    // A taken name still needs room for its `-2`.
    if (input.branch && input.branch.length > MAX_BRANCH_LENGTH)
      throw new WorktreeRefused(
        "invalid_branch",
        `The branch for the new worktree is longer than ${MAX_BRANCH_LENGTH} characters.`,
      );

    return this.locked(commonDir, async () => {
      await this.excludeAjourFolder(git, repository);
      const source = input.source
        ? await this.pickedSource(git, input.source)
        : await this.defaultSource(git, input.repositoryFolderId);
      facts.source = source.remote ? "remote" : "local";
      facts.source_choice = source.choice;
      facts.fetch = source.remote ? "ok" : "none";
      if (source.remote && !(await this.fetch(git, source.remote)))
        facts.fetch = "failed";
      const commit = await this.resolveCommit(git, source);
      await this.worktreesFolder(repository);
      await this.ignoreAjourFolder(repository);
      const made: Made = {
        repository,
        folder: "",
        branch: "",
        commit,
        branchMade: false,
      };
      try {
        // Each step makes one thing, and says so only once it is made.
        const { name, identity } = await this.claimName(
          git,
          repository,
          input,
          facts,
        );
        made.folder = worktreePathIn(repository, name);
        made.folderMade = identity;
        // Without a branch asked for, the folder's name: never the main folder.
        made.branch = await this.freeBranch(git, input.branch || name, facts);
        // Fails when the branch exists, so it never takes another's.
        await git.read(
          ["branch", "--no-track", "--", checkedRef(made.branch), commit],
          this.timeouts.localMs,
        );
        made.branchMade = true;
        // Locked from the start, so no prune removes it while the tool starts.
        await git.read(
          ["worktree", "add", "--lock", "--", made.folder, made.branch],
          this.timeouts.checkoutMs,
        );
        const worktree: Worktree = {
          id: randomUUID(),
          repositoryFolderId: input.repositoryFolderId,
          projectId: input.projectId,
          workItemId: input.workItemId,
          itemKey: input.itemKey,
          name,
          branch: made.branch,
          source: source.name,
          createdAt: this.now(),
        };
        await this.options.storage.addWorktree(worktree);
        return {
          kind: "created",
          worktree,
          sourceStale: facts.fetch === "failed",
          keep: () => this.keep(git, commonDir, made.folder),
          discard: () => this.discard(git, commonDir, worktree, made),
        };
      } catch (error) {
        if (made.folderMade || made.branchMade) {
          // False when something it made couldn't be taken back, and stays.
          facts.rolled_back = false;
          const kept = await this.remove(git, made).then(
            () => undefined,
            (failure: unknown) => asRefusal(failure),
          );
          // Why the create failed is then that its folder was taken.
          if (kept?.reason === "folder_changed") throw kept;
          facts.rolled_back = !kept;
        }
        throw error;
      }
    });
  }

  /**
   * The source a new worktree would start from in a repository folder, for
   * a tool that makes its own (#863): the one the start named, which the
   * repository must have, else the folder's default one, as a create picks
   * it (`defaultSource`). It also answers the branch the tool creates: the
   * name asked for, or with `-2`, `-3` when the repository has it, as a
   * create picks it (`freeBranch`). So a start that falls on a worktree the
   * item has never sends that worktree's branch. The name is read, not
   * reserved: the tool still refuses one taken meanwhile. It asks the
   * remote for its default branch when git never recorded it.
   *
   * A remote's branch is fetched first, with the fetch, the lock and the
   * timeout of a create, so the tool starts where a worktree of Ajour's
   * would, also in a clone that never fetched that branch. A fetch that
   * fails is not fatal: `stale` says the tool starts from the last fetched
   * copy. Without any copy the start is refused, since the name would
   * resolve to nothing in the tool. A local source is not fetched. Beside
   * that fetch it makes nothing: no folder, no branch, no exclude line.
   *
   * Throws `WorktreeRefused` for a source the repository doesn't have, a
   * branch git can't create, a folder that is gone, or a git call that
   * failed, with a message for the user.
   */
  async sourceFor(input: {
    projectId: string;
    repositoryFolderId: string;
    /** The branch the tool is to create, before any `-2`. */
    branch: string;
    /** The source the user picked, as the branch list names it. */
    source?: string;
  }): Promise<WorktreeSourceResult> {
    const unit = this.options.events?.start(
      "worktree.resolve_source",
      OPERATION,
    );
    try {
      const repository = await this.resolveRepository(
        input.projectId,
        input.repositoryFolderId,
      );
      const git = await this.gitIn(repository);
      if (!git) {
        unit?.refuse("git_missing");
        return { kind: "unavailable", reason: "git_missing" };
      }
      const commonDir = await this.repositoryOf(git, repository);
      if (!commonDir) {
        unit?.refuse("not_repository");
        return { kind: "unavailable", reason: "not_repository" };
      }
      // Checked only now, as a create does: a folder that gets no worktree
      // starts in the main folder whatever the name.
      if (
        !isValidNewBranchName(input.branch) ||
        input.branch.length > MAX_BRANCH_LENGTH
      )
        throw new WorktreeRefused(
          "invalid_branch",
          "The branch for the new worktree is not a valid git branch.",
        );
      const source = input.source
        ? await this.sourceNamed(git, input.source, "picked")
        : await this.defaultSource(git, input.repositoryFolderId);
      if (!source)
        throw new WorktreeRefused(
          "source_unresolved",
          `This repository has no branch ${input.source} to start from. Choose another source branch.`,
        );
      const facts: CreateFacts = {
        source: source.remote ? "remote" : "local",
        source_choice: source.choice,
        fetch: "none",
      };
      unit?.set({ worktree: facts });
      const remote = source.remote;
      if (remote) {
        // A write to the repository's refs: one at a time, as in a create.
        const fetched = await this.locked(commonDir, () =>
          this.fetch(git, remote),
        );
        facts.fetch = fetched ? "ok" : "failed";
        unit?.set({ worktree: facts });
        // No fetch and no earlier copy: the name resolves to nothing.
        if (!fetched)
          await this.resolveCommit(git, source).catch((error: unknown) => {
            throw error instanceof WorktreeRefused
              ? new WorktreeRefused(
                  error.reason,
                  `Ajour couldn't fetch ${source.name}, and this repository has no copy of it to start from.`,
                )
              : error;
          });
      }
      const branch = await this.freeBranch(git, input.branch, facts);
      unit?.set({ worktree: facts });
      return {
        kind: "source",
        name: source.name,
        branch,
        stale: facts.fetch === "failed",
      };
    } catch (error) {
      const refused = asRefusal(error, "read the source branch");
      if (refused.reason === "timeout" || refused.reason === "git_failed")
        endFailed(unit, refused.reason);
      else if (
        refused.reason === "source_unresolved" ||
        refused.reason === "folder_unavailable" ||
        refused.reason === "invalid_branch" ||
        refused.reason === "name_unavailable"
      )
        unit?.refuse(refused.reason);
      // No other reason reaches here: these steps make and remove nothing.
      else endFailed(unit, "git_failed");
      throw refused;
    } finally {
      unit?.end();
    }
  }

  /** The tool answered: lifts git's lock, so the worktree is an ordinary one. */
  private async keep(git: Git, commonDir: string, folder: string) {
    const unit = this.options.events?.start("worktree.keep", OPERATION);
    try {
      await this.locked(commonDir, () =>
        git.read(["worktree", "unlock", "--", folder], this.timeouts.localMs),
      );
    } catch (error) {
      // The worktree works while locked. Only a later prune or remove minds.
      endFailed(unit, asRefusal(error).reason);
    } finally {
      unit?.end();
    }
  }

  /** The start failed: takes back the worktree, its branch and its record. */
  private async discard(
    git: Git,
    commonDir: string,
    worktree: Worktree,
    made: Made,
  ) {
    const unit = this.options.events?.start("worktree.discard", OPERATION);
    try {
      const branchDeleted = await this.locked(commonDir, async () => {
        await this.options.storage.removeWorktree(worktree.id);
        return this.remove(git, made);
      });
      unit?.set({ worktree: { branch_deleted: branchDeleted } });
    } catch (error) {
      // What is left stays on disk, where the user can see and remove it.
      const { reason } = asRefusal(error);
      if (reason === "folder_changed") unit?.refuse("folder_changed");
      else endFailed(unit, reason);
    } finally {
      unit?.end();
    }
  }

  /**
   * Removes what one create made, and only that. The folder goes while it
   * is still the one the create made, and while git has no worktree there
   * but this create's: everything in it is then the create's. Otherwise
   * nothing there is removed and git is not given the path, and it throws
   * `folder_changed` once the rest is done: what holds the name stays for
   * the user. That is a link or another folder under the name, or another
   * program's worktree registered in the folder the create reserved. The
   * branch goes when the create made it, no worktree has it checked out,
   * and it still points at the commit it started from: a branch that moved
   * holds work, and stays. Answers whether the branch was deleted.
   */
  private async remove(git: Git, made: Made): Promise<boolean> {
    // The create's branch, once it made one: before that, no worktree is its.
    const ref = made.branchMade
      ? `refs/heads/${checkedRef(made.branch)}`
      : undefined;
    let left = false;
    if (made.folderMade) {
      // Checked again now: nothing is removed through a link put there since.
      const safe = await this.worktreesFolder(made.repository).then(
        () => true,
        () => false,
      );
      if (!safe || (await this.folderNow(made)) === "changed") left = true;
      else {
        // Git says what it knows of the folder. An add can register and lock
        // the worktree and still fail, as when a post-checkout hook does.
        // And another git may have added its own worktree in the folder
        // before this create's add ran. The create made its branch itself,
        // and a branch is checked out in one worktree only: a worktree
        // there on that branch is this create's, and any other is not.
        const registered = (await this.registrations(git)).find((entry) =>
          samePath(entry.folder, made.folder),
        );
        if (registered && (!ref || registered.branch !== ref)) left = true;
        else {
          // Twice forced: once for a dirty worktree, once for a locked one.
          // No prune follows: it would also drop the user's own worktrees
          // that are away.
          if (registered)
            await git.run(
              ["worktree", "remove", "--force", "--force", "--", made.folder],
              this.timeouts.checkoutMs,
            );
          // What git left of the folder, or all of it when git never added it.
          if ((await this.folderNow(made)) === "ours")
            await fs.rm(made.folder, { recursive: true, force: true });
        }
      }
    }
    const deleted = ref ? await this.deleteBranch(git, made, ref) : false;
    if (left)
      throw new WorktreeRefused(
        "folder_changed",
        "Something else took the folder Ajour made for the worktree, so Ajour left it in place. Hand off again.",
      );
    return deleted;
  }

  /**
   * Deletes the branch a create made, while it still points at the commit
   * it started from and no worktree has it checked out. Answers whether it
   * did.
   */
  private async deleteBranch(
    git: Git,
    made: Made,
    ref: string,
  ): Promise<boolean> {
    const tip = await git.run(
      ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`],
      this.timeouts.localMs,
    );
    if (tip.code !== 0 || tip.stdout.trim() !== made.commit) return false;
    if ((await this.registrations(git)).some((entry) => entry.branch === ref))
      return false;
    await git.read(["branch", "-D", "--", made.branch], this.timeouts.localMs);
    return true;
  }

  /**
   * What holds the name of the folder a create made: that folder (`ours`),
   * nothing (`gone`), or something else (`changed`), such as a link or a
   * folder put there since.
   */
  private async folderNow(made: Made): Promise<"ours" | "gone" | "changed"> {
    const found = await fs
      .lstat(made.folder, { bigint: true })
      .catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return undefined;
        throw error;
      });
    if (!found) return "gone";
    const mine = made.folderMade;
    return mine &&
      found.isDirectory() &&
      !found.isSymbolicLink() &&
      mine.ino !== 0n &&
      found.dev === mine.dev &&
      found.ino === mine.ino
      ? "ours"
      : "changed";
  }

  /**
   * The worktrees git lists for the repository: each one's folder, and the
   * full ref of the branch checked out there, absent for a detached or
   * bare one.
   */
  private async registrations(
    git: Git,
  ): Promise<{ folder: string; branch?: string }[]> {
    const entries: { folder: string; branch?: string }[] = [];
    for (const line of (
      await git.read(["worktree", "list", "--porcelain"], this.timeouts.localMs)
    ).split(/\r?\n/)) {
      if (line.startsWith("worktree "))
        entries.push({ folder: path.resolve(line.slice("worktree ".length)) });
      else if (line.startsWith("branch ") && entries.length)
        entries.at(-1)!.branch = line.slice("branch ".length);
    }
    return entries;
  }

  /**
   * Makes `.ajour` and `.ajour/worktrees` in the repository folder as real
   * folders, and refuses when either is a link or a file, or when the
   * worktrees folder's real path is not that one. A link there, which a
   * cloned repository can even commit, would send the checkout and its
   * removal outside the repository folder. With `make` false it makes
   * nothing, and answers false when either folder is absent: a delete then
   * has nothing there to remove.
   */
  private async worktreesFolder(
    repository: string,
    make = true,
  ): Promise<boolean> {
    const unsafe = () =>
      new WorktreeRefused(
        "folder_unavailable",
        `Ajour can't use ${WORKTREES_FOLDER.join("/")} in this repository folder: it must be a real folder, not a link or a file. Remove it, then hand off again.`,
      );
    let current = repository;
    for (const segment of WORKTREES_FOLDER) {
      current = path.join(current, segment);
      if (make)
        await fs.mkdir(current).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== "EEXIST") throw error;
        });
      const found = await fs
        .lstat(current)
        .catch((error: NodeJS.ErrnoException) => {
          if (!make && error.code === "ENOENT") return undefined;
          throw error;
        });
      if (!found) return false;
      if (found.isSymbolicLink() || !found.isDirectory()) throw unsafe();
    }
    if (!samePath(await fs.realpath(current), current)) throw unsafe();
    return true;
  }

  /** Git for a repository folder, or undefined on a computer without git. */
  private async gitIn(repository: string): Promise<Git | undefined> {
    const userPath = await resolveLoginShellPath();
    const executable = await findExecutable("git", userPath);
    if (!executable) return undefined;
    return new Git(
      executable,
      {
        ...gitEnvironment(childEnvironment(userPath)),
        // Git fails at once where it would ask for a password.
        GIT_TERMINAL_PROMPT: "0",
        GCM_INTERACTIVE: "never",
      },
      repository,
    );
  }

  /**
   * The repository's common git folder when `repository` is the top folder
   * of a git checkout, the main one or a linked worktree. Undefined for a
   * folder that isn't one, or sits inside one: Ajour makes no worktree there.
   */
  private async repositoryOf(
    git: Git,
    repository: string,
  ): Promise<string | undefined> {
    const top = await git.run(
      ["rev-parse", "--show-toplevel"],
      this.timeouts.localMs,
    );
    if (top.timedOut)
      throw new GitFailure("timeout", "Git took too long to answer.");
    if (top.code !== 0 || !top.stdout.trim()) return undefined;
    const real = await fs.realpath(top.stdout.trim()).catch(() => undefined);
    if (!real || !samePath(real, repository)) return undefined;
    const common = await git.read(
      ["rev-parse", "--git-common-dir"],
      this.timeouts.localMs,
    );
    return fs.realpath(path.resolve(repository, common));
  }

  /**
   * Keeps `.ajour/` out of git status through the repository's local
   * exclude file, under its common git folder. No committed file changes.
   * A repository whose `.gitignore` re-includes folders outranks it, so a
   * create also writes `.ajour/.gitignore` (`ignoreAjourFolder`).
   */
  private async excludeAjourFolder(git: Git, repository: string) {
    const file = path.resolve(
      repository,
      await git.read(
        ["rev-parse", "--git-path", "info/exclude"],
        this.timeouts.localMs,
      ),
    );
    const current = await fs.readFile(file, "utf8").catch(() => "");
    if (current.split(/\r?\n/).some((line) => line.trim() === EXCLUDE_LINE))
      return;
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(
      file,
      `${current}${current && !current.endsWith("\n") ? "\n" : ""}${EXCLUDE_LINE}\n`,
      "utf8",
    );
  }

  /**
   * Writes `.ajour/.gitignore` holding `*`, so git status in the main folder
   * shows nothing of `.ajour` even when the repository's own `.gitignore`
   * re-includes folders, as `*` and then a `!` rule for every folder does
   * (#857): a committed `.gitignore` outranks `info/exclude`, and a
   * `.gitignore` inside `.ajour` outranks both for what is in it. Runs only once `worktreesFolder` found
   * `.ajour` a real folder. The file is made exclusively, so a link at its
   * name is never followed, and a file already there, the user's or an
   * earlier one, stays as it is.
   */
  private async ignoreAjourFolder(repository: string) {
    await fs
      .writeFile(
        path.join(repository, WORKTREES_FOLDER[0], ".gitignore"),
        "*\n",
        {
          encoding: "utf8",
          flag: "wx",
        },
      )
      .catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "EEXIST") throw error;
      });
  }

  /** The repository folder's real path, or a refusal that says why not. */
  private async resolveRepository(
    projectId: string,
    repositoryFolderId: string,
  ): Promise<string> {
    try {
      return await this.options.folders.resolve(repositoryFolderId, projectId);
    } catch (error) {
      throw new WorktreeRefused(
        "folder_unavailable",
        error instanceof Error
          ? error.message
          : "This repository folder is no longer available.",
      );
    }
  }

  /**
   * The source when the start names none: the one the user last picked for
   * the repository folder, while the repository still has it, else the
   * remote's default branch, else the branch checked out in the main
   * folder. `askRemote` false never contacts the remote (`remoteDefault`).
   */
  private async defaultSource(
    git: Git,
    repositoryFolderId: string,
    askRemote = true,
  ): Promise<Source> {
    const remembered =
      await this.options.storage.getWorktreeSource(repositoryFolderId);
    const kept = remembered
      ? await this.sourceNamed(git, remembered, "remembered")
      : undefined;
    if (kept) return kept;
    const remote = await this.remoteDefault(git, askRemote);
    if (remote) return remote;
    const current = await this.currentBranch(git);
    return current
      ? { choice: "default", name: current, ref: `refs/heads/${current}` }
      : // A detached main folder: its commit.
        { choice: "default", name: "HEAD", ref: "HEAD" };
  }

  /**
   * The source a start that names none will use, as far as local refs can
   * say. Undefined when they can't: the repository has a remote whose
   * default branch git didn't record, so the start will ask the remote and
   * may get another branch than the main folder's. The list then names no
   * source, so the window promises none.
   */
  private async listedSource(
    git: Git,
    repositoryFolderId: string,
  ): Promise<Source | undefined> {
    const source = await this.defaultSource(git, repositoryFolderId, false);
    const fellBack = source.choice === "default" && !source.remote;
    return fellBack && (await this.remotes(git)).length ? undefined : source;
  }

  /** The source a start named. One the repository doesn't have refuses the start. */
  private async pickedSource(git: Git, name: string): Promise<Source> {
    const source = await this.sourceNamed(git, name, "picked");
    if (!source)
      throw new WorktreeRefused(
        "source_unresolved",
        `Ajour can't make a worktree from ${name}: this repository has no such branch.`,
      );
    return source;
  }

  /**
   * The branch of that name, as the branch list names it: a remote's branch
   * for `<remote>/<branch>`, else a local one. Undefined when the
   * repository has neither.
   */
  private async sourceNamed(
    git: Git,
    name: string,
    choice: Source["choice"],
  ): Promise<Source | undefined> {
    if (!isValidHandoffBranch(name)) return undefined;
    const exists = (ref: string) =>
      git.test(
        ["show-ref", "--verify", "--quiet", checkedRef(ref)],
        this.timeouts.localMs,
      );
    // The longest remote name first, for a remote named with a slash.
    for (const remote of (await this.remotes(git)).sort(
      (a, b) => b.length - a.length,
    )) {
      if (!name.startsWith(`${remote}/`)) continue;
      const branch = name.slice(remote.length + 1);
      if (await exists(`refs/remotes/${remote}/${branch}`))
        return {
          choice,
          name,
          ref: `refs/remotes/${remote}/${branch}`,
          remote: { name: remote, branch },
        };
    }
    return (await exists(`refs/heads/${name}`))
      ? { choice, name, ref: `refs/heads/${name}` }
      : undefined;
  }

  /** The names of the repository's remotes, as git lists them. */
  private async remotes(git: Git): Promise<string[]> {
    return (await git.read(["remote"], this.timeouts.localMs))
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  }

  /**
   * The remote's default branch as a source. The remote is `origin`, or the
   * first one git lists. A remote whose default branch git doesn't know
   * and can't ask for counts as no remote. With `askRemote` false only what
   * git recorded at clone counts, and the remote is never contacted: the
   * branch list must answer at once, also when the remote can't be reached.
   */
  private async remoteDefault(
    git: Git,
    askRemote = true,
  ): Promise<Source | undefined> {
    const remotes = await this.remotes(git);
    const remote = remotes.includes("origin") ? "origin" : remotes[0];
    const branch = remote
      ? await this.remoteDefaultBranch(git, remote, askRemote)
      : "";
    return remote && branch
      ? {
          choice: "default",
          name: `${remote}/${branch}`,
          ref: `refs/remotes/${remote}/${branch}`,
          remote: { name: remote, branch },
        }
      : undefined;
  }

  /**
   * The branch checked out in the main folder, or "" when it is detached.
   * Read from the full ref, never git's short name: a tag with the branch's
   * name makes `--short` answer `heads/main` (#857).
   */
  private async currentBranch(git: Git): Promise<string> {
    const head = await git.run(
      ["symbolic-ref", "--quiet", "HEAD"],
      this.timeouts.localMs,
    );
    const ref = head.code === 0 ? head.stdout.trim() : "";
    return ref.startsWith("refs/heads/") ? ref.slice("refs/heads/".length) : "";
  }

  /** The remote's default branch: what git recorded at clone, else what the remote says now. */
  private async remoteDefaultBranch(
    git: Git,
    remote: string,
    askRemote: boolean,
  ): Promise<string> {
    checkedRef(remote);
    const prefix = `refs/remotes/${remote}/`;
    const recorded = await git.run(
      ["symbolic-ref", "--quiet", `${prefix}HEAD`],
      this.timeouts.localMs,
    );
    const target = recorded.code === 0 ? recorded.stdout.trim() : "";
    if (target.startsWith(prefix)) return target.slice(prefix.length);
    if (!askRemote) return "";
    const asked = await git.run(
      ["ls-remote", "--symref", "--", remote, "HEAD"],
      this.timeouts.fetchMs,
    );
    if (asked.code !== 0) return "";
    return /^ref: refs\/heads\/(\S+)\s+HEAD$/m.exec(asked.stdout)?.[1] ?? "";
  }

  /** Fetches the source branch into its remote-tracking ref. False when it failed. */
  private async fetch(
    git: Git,
    remote: { name: string; branch: string },
  ): Promise<boolean> {
    checkedRef(remote.name);
    checkedRef(remote.branch);
    const result = await git.run(
      [
        "fetch",
        "--quiet",
        "--no-tags",
        "--no-recurse-submodules",
        "--",
        remote.name,
        `+refs/heads/${remote.branch}:refs/remotes/${remote.name}/${remote.branch}`,
      ],
      this.timeouts.fetchMs,
    );
    return result.code === 0 && !result.timedOut;
  }

  /** The commit the source names now. A source git doesn't know refuses the start. */
  private async resolveCommit(git: Git, source: Source): Promise<string> {
    const result = await git.run(
      [
        "rev-parse",
        "--verify",
        "--quiet",
        `${checkedRef(source.ref)}^{commit}`,
      ],
      this.timeouts.localMs,
    );
    const commit = result.stdout.trim();
    if (result.code !== 0 || !/^[0-9a-f]{40,64}$/.test(commit))
      throw new WorktreeRefused(
        "source_unresolved",
        `Ajour can't make a worktree from ${source.name}: this repository has no such branch or commit.`,
      );
    return commit;
  }

  /**
   * Takes the first free folder name, `aj-<key>`, or `aj-<start of the
   * item's id>` for an item without a key, then `-2`, `-3`, by making the
   * folder: a folder that already exists is another's, and the
   * next name is tried. A name is also taken in Ajour's records of this
   * repository folder, and among the worktrees git still lists.
   */
  private async claimName(
    git: Git,
    repository: string,
    input: WorktreeCreateInput,
    facts: CreateFacts,
  ): Promise<{ name: string; identity: FolderIdentity }> {
    const base = worktreeBaseName(input.itemKey, input.workItemId);
    const recorded = new Set(
      (await this.options.storage.listWorktrees())
        .filter((w) => w.repositoryFolderId === input.repositoryFolderId)
        .map((w) => w.name),
    );
    const listed = (await this.registrations(git)).map((entry) => entry.folder);
    for (let suffix = 1; suffix <= MAX_SUFFIX; suffix++) {
      const name = suffix === 1 ? base : `${base}-${suffix}`;
      const folder = worktreePathIn(repository, name);
      if (recorded.has(name) || listed.some((other) => samePath(other, folder)))
        continue;
      // Not recursive: it fails on a name that exists, whatever holds it.
      const taken = await fs.mkdir(folder).then(
        () => false,
        (error: NodeJS.ErrnoException) => {
          if (error.code === "EEXIST") return true;
          throw error;
        },
      );
      if (taken) continue;
      if (suffix > 1) facts.name_suffix = suffix;
      // Read at once, so a rollback can tell this folder from a later one.
      const { dev, ino } = await fs.stat(folder, { bigint: true });
      return { name, identity: { dev, ino } };
    }
    throw new WorktreeRefused(
      "name_unavailable",
      `Ajour found no free folder name for this item's worktree after ${base}-${MAX_SUFFIX}.`,
    );
  }

  /** The first free branch name: the one asked for, then `-2`, `-3`. */
  private async freeBranch(
    git: Git,
    wanted: string,
    facts: CreateFacts,
  ): Promise<string> {
    for (let suffix = 1; suffix <= MAX_SUFFIX; suffix++) {
      const branch = suffix === 1 ? wanted : `${wanted}-${suffix}`;
      const taken = await git.test(
        ["show-ref", "--verify", "--quiet", `refs/heads/${checkedRef(branch)}`],
        this.timeouts.localMs,
      );
      if (taken) continue;
      if (suffix > 1) facts.branch_suffix = suffix;
      return branch;
    }
    throw new WorktreeRefused(
      "name_unavailable",
      `Ajour found no free branch name after ${wanted}-${MAX_SUFFIX}.`,
    );
  }

  /** Runs one repository's writes one at a time, in the order asked. */
  private async locked<T>(key: string, run: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(key);
    let release!: () => void;
    const turn = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.locks.set(key, turn);
    await previous?.catch(() => undefined);
    try {
      return await run();
    } finally {
      release();
      if (this.locks.get(key) === turn) this.locks.delete(key);
    }
  }
}

/**
 * Ends a unit whose git call failed. Git's own words may name a branch or a
 * path, so the event gets the reason and never the message.
 */
function endFailed(
  unit:
    | {
        end(
          outcome: "timeout" | "error",
          reason: "timeout" | "git_failed",
        ): void;
      }
    | undefined,
  reason: WorktreeRefusalReason,
) {
  if (reason === "timeout") unit?.end("timeout", "timeout");
  else unit?.end("error", "git_failed");
}

/**
 * Any failure of an operation as the refusal the window shows. `doing` is
 * what failed, in the user's words: a create by default.
 */
function asRefusal(
  error: unknown,
  doing = "make the worktree",
): WorktreeRefused {
  if (error instanceof WorktreeRefused) return error;
  if (error instanceof GitFailure)
    return new WorktreeRefused(
      error.reason,
      error.reason === "timeout"
        ? `Ajour couldn't ${doing}: git took too long to answer.`
        : `Ajour couldn't ${doing}. Git said: ${error.message}`,
    );
  return new WorktreeRefused(
    "git_failed",
    `Ajour couldn't ${doing} in this repository folder.`,
  );
}
