import { z } from "zod";
import { slugOrEmpty } from "./agent-task-templates.ts";
import {
  isValidHandoffBranch,
  isValidNewBranchName,
} from "./handoff-templates.ts";

const id = z.string().min(1).max(200);

/**
 * The folders, under a repository folder, that hold Ajour's worktrees
 * (#857): `<repository folder>/.ajour/worktrees/<name>`.
 */
export const WORKTREES_FOLDER = [".ajour", "worktrees"] as const;

/**
 * A worktree's folder name: `aj-` and the item's key as a slug, or the
 * start of the item's id for an item without a key, then `-2`, `-3` for the
 * item's next ones (`worktreeBaseName`). Lower case letters, digits and
 * single dashes only, so it is one path segment on every system.
 */
export const worktreeNameSchema = z
  .string()
  .max(40)
  .regex(/^aj-[a-z0-9]+(?:-[a-z0-9]+)*$/);

/**
 * A git worktree Ajour made for one backlog item inside a repository
 * folder (#857), as the local API keeps it on this computer. Its `id` is
 * also a folder id: a plugin receives it wherever it received the
 * repository folder's, and Ajour resolves it to the worktree's path.
 */
export const worktreeSchema = z
  .object({
    id,
    repositoryFolderId: id,
    projectId: id,
    workItemId: id,
    /**
     * The item's key when the worktree was made. The name comes from it,
     * or from the item's id when the key is empty (`worktreeBaseName`).
     */
    itemKey: z.string().max(500),
    name: worktreeNameSchema,
    /** The branch Ajour created for it. */
    branch: z.string().min(1).max(500),
    /** What the branch started from, such as `origin/main`. */
    source: z.string().min(1).max(500),
    createdAt: z.number().finite(),
    /**
     * The latest use Ajour knows of that no handoff records any more
     * (#864): when a thread that ran in it started or last changed, kept
     * once that thread is removed from its item. Absent until one is. The
     * unused rule of automatic clean up counts from it too.
     */
    lastUsedAt: z.number().finite().optional(),
  })
  .strict();
export type Worktree = z.infer<typeof worktreeSchema>;
export const worktreesSchema = z.array(worktreeSchema);

/**
 * The folder name of an item's first worktree: `aj-` and the item's key as
 * a slug, cut to 23 characters so a `-2` suffix still fits.
 *
 * An item made by hand has no key. Its worktree is named after the item's
 * id instead, so two such items never share a name and a `-2` always means
 * a second worktree of the same item: `aj-` and the first 8 characters of
 * the id's unique part, as a slug. A work item's id is `work_item_` and a
 * UUID, so the unique part is what follows the last underscore, and the
 * name reads `aj-1b9d6bcd`.
 */
export function worktreeBaseName(itemKey: string, workItemId: string): string {
  const cut = (value: string, length: number) =>
    slugOrEmpty(value).slice(0, length).replace(/-+$/, "");
  const key = cut(itemKey, 23);
  if (key) return `aj-${key}`;
  const unique = workItemId.slice(workItemId.lastIndexOf("_") + 1);
  return `aj-${cut(unique, 8) || "item"}`;
}

/**
 * Where a hand off runs when nothing else says: a new worktree, the main
 * folder, which is the repository folder itself, or `ask`, where the window
 * asks at each hand off (#861) and always sends the answer with the start.
 */
export const worktreeStartInSchema = z.enum(["worktree", "main", "ask"]);
export type WorktreeStartIn = z.infer<typeof worktreeStartInSchema>;

/** A fresh install hands off in a new worktree. */
export const DEFAULT_WORKTREE_START_IN: WorktreeStartIn = "worktree";

/** The delays a clean-up rule offers, in days. */
export const WORKTREE_CLEAN_UP_DELAYS = [1, 3, 7, 14, 30, 60, 90] as const;

/**
 * One clean-up rule (#864): whether Ajour applies it, and how many days it
 * waits before it removes a worktree.
 */
export const worktreeCleanUpRuleSchema = z
  .object({ enabled: z.boolean(), days: z.number().int().min(1).max(365) })
  .strict();
export type WorktreeCleanUpRule = z.infer<typeof worktreeCleanUpRuleSchema>;

/** The two rules by which Ajour removes worktrees by itself. */
export const worktreeCleanUpRulesSchema = z
  .object({
    /**
     * Removes the worktrees of finished items: `days` after the item became
     * done, settled or archived.
     */
    finished: worktreeCleanUpRuleSchema,
    /**
     * Removes unused worktrees: `days` after the last hand off or thread
     * change in it, whatever its item's state.
     */
    unused: worktreeCleanUpRuleSchema,
  })
  .strict();
export type WorktreeCleanUpRules = z.infer<typeof worktreeCleanUpRulesSchema>;
export type WorktreeCleanUpRuleName = keyof WorktreeCleanUpRules;

/**
 * A fresh install removes a finished item's worktree after 3 days, and
 * leaves unused ones alone.
 */
export const DEFAULT_WORKTREE_CLEAN_UP: WorktreeCleanUpRules = {
  finished: { enabled: true, days: 3 },
  unused: { enabled: false, days: 30 },
};

/** Settings › Worktrees, kept on this computer and never synced. */
export const worktreeSettingsSchema = z
  .object({
    startIn: worktreeStartInSchema,
    cleanUp: worktreeCleanUpRulesSchema,
  })
  .strict();
export type WorktreeSettings = z.infer<typeof worktreeSettingsSchema>;

/**
 * A change to Settings › Worktrees: only what it names changes, so a save
 * of one row never writes back an older value of another.
 */
export const worktreeSettingsUpdateSchema = z
  .object({
    startIn: worktreeStartInSchema.optional(),
    cleanUp: worktreeCleanUpRulesSchema.partial().strict().optional(),
  })
  .strict();
export type WorktreeSettingsUpdate = z.infer<
  typeof worktreeSettingsUpdateSchema
>;

/** The choices of Start in, as every surface names them. */
export const worktreeStartInLabels: Record<WorktreeStartIn, string> = {
  main: "Main folder",
  worktree: "New worktree",
  ask: "Ask each time",
};

/**
 * Where a project's hand offs start on this computer (#864): the project's
 * own choice when it has one, over the default of Settings › Worktrees. The
 * local API keeps both, and neither is synced.
 */
export const projectStartInSchema = z
  .object({
    /** The project's own choice. Absent, the project follows Settings. */
    override: worktreeStartInSchema.optional(),
    /** The default of Settings › Worktrees, as it is now. */
    settings: worktreeStartInSchema,
  })
  .strict();
export type ProjectStartIn = z.infer<typeof projectStartInSchema>;

/** A project's choice of Start in, or null to follow Settings again. */
export const projectStartInUpdateSchema = z
  .object({ startIn: worktreeStartInSchema.nullable() })
  .strict();

/** Where the project's hand offs start: its own choice, else the default. */
export function startInOf(project: ProjectStartIn): WorktreeStartIn {
  return project.override ?? project.settings;
}

/** A source name a start may send: one git reads as a ref. */
const gitName = z
  .string()
  .min(1)
  .max(500)
  .refine(isValidHandoffBranch, "Not a valid git branch name.");
/** The name of a branch a start asks Ajour to create. */
const newBranchName = gitName.refine(
  isValidNewBranchName,
  "Not a valid git branch name.",
);

/**
 * Where one hand off starts (#861), as the window chose it: the main
 * folder, a new worktree, or a worktree the item already has. A new
 * worktree may name its source, a branch the repository folder lists, and
 * its branch. Without a source it starts from the folder's default one, and
 * without a branch it gets the branch template's name.
 */
export const handoffStartInSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("main") }).strict(),
  z
    .object({
      kind: z.literal("new"),
      source: gitName.optional(),
      branch: newBranchName.optional(),
    })
    .strict(),
  z.object({ kind: z.literal("worktree"), worktreeId: id }).strict(),
]);
export type HandoffStartIn = z.infer<typeof handoffStartInSchema>;

/** The most branches one listing answers. A repository with more is cut. */
export const MAX_LISTED_BRANCHES = 2000;

/** One branch of a repository folder, as the branch finder lists it. */
export const repositoryBranchSchema = z
  .object({
    /** As git names it: `develop`, or `origin/main` for a remote's. */
    name: z.string().min(1).max(500),
    remote: z.boolean(),
    /** The remote's default branch. */
    default: z.literal(true).optional(),
    /** The branch checked out in the main folder. */
    current: z.literal(true).optional(),
  })
  .strict();
export type RepositoryBranch = z.infer<typeof repositoryBranchSchema>;

/**
 * What a new worktree can start from in a repository folder (#861): its
 * local and remote branches, newest commit first, behind the default
 * source. `unavailable` says why Ajour can't make a worktree there, and
 * the list is then empty.
 */
export const repositoryBranchesSchema = z
  .object({
    unavailable: z.enum(["git_missing", "not_repository"]).optional(),
    /** The branch checked out in the main folder. Absent when detached. */
    current: z.string().min(1).max(500).optional(),
    /**
     * The source of a new worktree when the user picks none: the last one
     * picked for this folder, else the remote's default branch, else the
     * main folder's branch. Absent when the list can't say: the repository
     * has a remote whose default branch only the remote knows, which the
     * start asks and the list never does.
     */
    source: z.string().min(1).max(500).optional(),
    branches: z.array(repositoryBranchSchema).max(MAX_LISTED_BRANCHES),
    /** The repository has more branches than the list holds. */
    truncated: z.literal(true).optional(),
  })
  .strict();
export type RepositoryBranches = z.infer<typeof repositoryBranchesSchema>;

/** Asks for one backlog item's worktrees whose folder is still on disk. */
export const itemWorktreesRouteSchema = z
  .object({ projectId: id, workItemId: id })
  .strict();

/**
 * A worktree's state on disk, read from git when a list is asked for
 * (#862): `clean`, `changed` with the number of changed and untracked files
 * git status reports, `missing` when its folder is gone, or `unknown` when
 * git couldn't say, as on a computer that has no git any more.
 */
export const worktreeStatusSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("clean") }).strict(),
  z
    .object({
      state: z.literal("changed"),
      changes: z.number().int().positive(),
    })
    .strict(),
  z.object({ state: z.literal("missing") }).strict(),
  z.object({ state: z.literal("unknown") }).strict(),
]);
export type WorktreeStatus = z.infer<typeof worktreeStatusSchema>;

/**
 * The state of a thread that still runs: its tool is working, or waits for
 * the user.
 */
export const worktreeRunningSchema = z.enum(["working", "needs-you"]);
export type WorktreeRunning = z.infer<typeof worktreeRunningSchema>;

/**
 * Why automatic clean up keeps a worktree a rule would remove (#864):
 * `changes` for uncommitted or untracked files, `running` for a thread
 * that is Working or Needs you, `recent` for a hand off or a thread change
 * in the last hour, `branch` when the branch checked out there is no
 * longer the one Ajour recorded, `not_ours` when what is at its path is not
 * the worktree Ajour made inside `.ajour/worktrees`, `missing` when its
 * folder is gone, `unconfirmed` when the state of its threads couldn't be
 * read from their tool, and `failed` when git couldn't say or couldn't
 * remove it.
 */
export const worktreeKeptReasonSchema = z.enum([
  "changes",
  "running",
  "recent",
  "branch",
  "not_ours",
  "missing",
  "unconfirmed",
  "failed",
]);
export type WorktreeKeptReason = z.infer<typeof worktreeKeptReasonSchema>;

/**
 * What automatic clean up will do with a worktree, as the rules stand now:
 * `goes` on the earliest day a rule removes it if nothing changes, or
 * `kept` with why, for one a rule would remove now.
 */
export const worktreeCleanUpStateSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("goes"), at: z.number().finite() }).strict(),
  z
    .object({ kind: z.literal("kept"), reason: worktreeKeptReasonSchema })
    .strict(),
]);
export type WorktreeCleanUpState = z.infer<typeof worktreeCleanUpStateSchema>;

/**
 * A worktree as a list shows it: its record, its status, and where its
 * folder is, or was, for the window to show and copy. The path is absent
 * when its repository folder can't be reached. It goes to the window only,
 * never to an event. `running` says a thread still runs in it, as its
 * handoffs were last read (#864): `working` when one is working, else
 * `needs-you` when one waits for the user. `cleanUp` says what automatic
 * clean up will do with it, for the list of Settings › Worktrees.
 */
export const listedWorktreeSchema = z
  .object({
    worktree: worktreeSchema,
    status: worktreeStatusSchema,
    path: z.string().min(1).max(4096).optional(),
    running: worktreeRunningSchema.optional(),
    /** Present when the list was asked with the items' finished moments. */
    cleanUp: worktreeCleanUpStateSchema.optional(),
  })
  .strict();
export type ListedWorktree = z.infer<typeof listedWorktreeSchema>;
export const listedWorktreesSchema = z.array(listedWorktreeSchema);

/**
 * When a backlog item became finished, as the window knows it (#864): the
 * latest of the moments it became done, settled or archived. Backlog items
 * live in the window, so the window sends these with each clean-up round.
 * An item that is active again is not sent. The local API ignores a moment
 * before zero or after its own clock.
 */
export const finishedItemSchema = z
  .object({ workItemId: id, finishedAt: z.number().finite() })
  .strict();
export type FinishedItem = z.infer<typeof finishedItemSchema>;
const finishedItems = z.array(finishedItemSchema).max(10_000);

/**
 * Which worktrees a status list is for: one backlog item's, one project's,
 * or every worktree on this computer when it names neither.
 */
const worktreeScopeSchema = z
  .object({ projectId: id.optional(), workItemId: id.optional() })
  .strict();
export type WorktreeScope = z.infer<typeof worktreeScopeSchema>;

/**
 * A status list's request. With `finished`, the finished items among those
 * that have a worktree, each listed worktree also says what automatic
 * clean up will do with it (`cleanUp`).
 */
export const worktreeStatusRouteSchema = worktreeScopeSchema
  .extend({ finished: finishedItems.optional() })
  .strict();
export type WorktreeStatusRequest = z.infer<typeof worktreeStatusRouteSchema>;

/**
 * One clean-up round (#864), which the window starts: at launch, once an
 * hour, and from Clean up now. `finished` holds, for each item that has a
 * worktree and is finished, when it became so.
 */
export const worktreeCleanUpRouteSchema = z
  .object({
    trigger: z.enum(["launch", "timer", "manual"]),
    finished: finishedItems,
  })
  .strict();
export type WorktreeCleanUpRequest = z.infer<typeof worktreeCleanUpRouteSchema>;

/**
 * What a round did: the worktrees it removed, each with the rule that
 * removed it, and those a rule would have removed that it kept, each with
 * why. A worktree no rule applies to yet is in neither. No branch is ever
 * deleted.
 */
export const worktreeCleanUpResultSchema = z
  .object({
    removed: z.array(
      z
        .object({
          worktreeId: id,
          name: worktreeNameSchema,
          rule: z.enum(["finished", "unused"]),
        })
        .strict(),
    ),
    kept: z.array(
      z
        .object({
          worktreeId: id,
          name: worktreeNameSchema,
          reason: worktreeKeptReasonSchema,
        })
        .strict(),
    ),
  })
  .strict();
export type WorktreeCleanUpResult = z.infer<typeof worktreeCleanUpResultSchema>;

/** The most files a delete preview lists. `moreFiles` counts the rest. */
export const MAX_PREVIEW_FILES = 200;

/**
 * One line of git status: its two status letters, such as ` M` or `??`,
 * the file, and for a rename or a copy the file it came from.
 */
export const worktreeChangeSchema = z
  .object({
    code: z.string().length(2),
    path: z.string().min(1).max(4096),
    from: z.string().min(1).max(4096).optional(),
  })
  .strict();
export type WorktreeChange = z.infer<typeof worktreeChangeSchema>;

/**
 * What deleting a worktree would lose (#862), for the dialog that asks
 * first: the files git status reports, the threads that still run in it,
 * and how many of its branch's commits are on no remote. `branch` is absent
 * when the repository no longer has the branch, or git can't be asked.
 */
export const worktreeDeletePreviewSchema = z
  .object({
    listed: listedWorktreeSchema,
    /**
     * Stands for what the delete loses (#857): the worktree's whole git
     * status, the files past `files` and each file inside an untracked
     * folder included, its `HEAD` commit and its branch's tip. The delete
     * sends it back, and the local API refuses the delete when the
     * worktree no longer matches it.
     */
    fingerprint: z.string().min(1).max(128),
    files: z.array(worktreeChangeSchema).max(MAX_PREVIEW_FILES),
    /** How many more files git status reports than `files` holds. */
    moreFiles: z.number().int().nonnegative(),
    /** The item's threads in the worktree that are Working or Needs you. */
    running: z.array(
      z
        .object({
          pluginId: id,
          toolId: id,
          state: z.enum(["working", "needs-you"]),
        })
        .strict(),
    ),
    branch: z
      .object({
        name: z.string().min(1).max(500),
        /** Its commits that no remote-tracking branch reaches. */
        unpushedCommits: z.number().int().nonnegative(),
      })
      .strict()
      .optional(),
    /**
     * Present when the worktree is no longer on its recorded branch, as
     * when a tool switched it (#857): `branch` is the one checked out now,
     * absent when it is detached. `branch` above stays the recorded one,
     * the only branch a delete can delete. A detached worktree's
     * `commitsOnNoBranch` counts the commits only its `HEAD` holds, which
     * no branch, remote-tracking branch or tag reaches: the delete removes
     * the `HEAD` and its reflog, so git later drops them. Absent when there
     * are none.
     */
    switched: z
      .object({
        branch: z.string().min(1).max(500).optional(),
        commitsOnNoBranch: z.number().int().positive().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type WorktreeDeletePreview = z.infer<typeof worktreeDeletePreviewSchema>;

/**
 * Delete a worktree, and its branch too when asked. `fingerprint` is the
 * preview's the user confirmed: a worktree whose git status, commit or
 * branch tip changed since is left whole (#857).
 */
export const worktreeDeleteRouteSchema = z
  .object({
    deleteBranch: z.boolean(),
    fingerprint: z.string().min(1).max(128),
  })
  .strict();

/**
 * A refused delete. `changed` says the worktree no longer holds what its
 * preview showed, so the window reads the preview again.
 */
export const worktreeDeleteRefusalSchema = z
  .object({ error: z.string(), changed: z.literal(true).optional() })
  .strict();

/**
 * What a delete did. `branchDeleted` is false when the branch was not asked
 * for, was already gone, or git refused to delete it.
 */
export const worktreeDeleteResultSchema = z
  .object({ branchDeleted: z.boolean() })
  .strict();
export type WorktreeDeleteResult = z.infer<typeof worktreeDeleteResultSchema>;

/** Where a worktree's menu opens its folder: a terminal or the file manager. */
export const worktreeOpenRouteSchema = z
  .object({ in: z.enum(["terminal", "files"]) })
  .strict();
export type WorktreeOpenIn = z.infer<typeof worktreeOpenRouteSchema>["in"];
