import type { Handoff } from "@ajour/shared/handoffs";
import type { RepositoryFolder } from "@ajour/shared/repository-folders";
import {
  worktreeStartInLabels,
  type FinishedItem,
  type ListedWorktree,
  type Worktree,
  type WorktreeChange,
  type WorktreeDeletePreview,
  type WorktreeKeptReason,
  type WorktreeStatus,
} from "@ajour/shared/worktrees";
import type { LocalWorkItem } from "@/domain/local-state";

/*
 * How the window names a worktree and what it holds (#862): its status, the
 * threads under it on the Handoffs card, and the words of the dialog that
 * asks before a delete. The lists of the project page and of Settings name
 * a worktree the same way.
 */

const plural = (count: number, one: string, many: string) =>
  `${count} ${count === 1 ? one : many}`;

/** A worktree's status as a list says it: Clean, "3 changes", Missing. */
export function describeWorktreeStatus(status: WorktreeStatus): string {
  switch (status.state) {
    case "clean":
      return "Clean";
    case "changed":
      return plural(status.changes, "change", "changes");
    case "missing":
      return "Missing";
    case "unknown":
      return "Status unknown";
  }
}

/**
 * How a list tints a worktree's status: `running` for a tool at work,
 * `attention` for a thread that waits for the user, `warning` for
 * uncommitted work, `quiet` for the rest.
 */
export type WorktreeStatusTone = "running" | "attention" | "warning" | "quiet";

/** A worktree's status as one list row says it. */
export interface WorktreeStatusLine {
  text: string;
  tone: WorktreeStatusTone;
}

/** Why automatic clean up keeps a worktree, after "Kept: ". */
function describeKeptReason(
  reason: WorktreeKeptReason,
  status: WorktreeStatus,
): string {
  switch (reason) {
    case "changes":
      // The count git status gave, as in "Kept: 3 changes".
      return status.state === "changed"
        ? describeWorktreeStatus(status)
        : "uncommitted changes";
    case "running":
      return "a thread is running";
    case "recent":
      return "used in the last hour";
    case "branch":
      return "on another branch";
    case "not_ours":
      return "not the worktree Ajour made";
    case "missing":
      return "its folder is gone";
    case "unconfirmed":
      return "couldn't check its threads";
    case "failed":
      return "git couldn't remove it";
  }
}

/**
 * A worktree's status on the project page and in Settings › Worktrees
 * (#864). A folder that is gone reads Missing. A thread that still runs in
 * it comes next, "Working" or "Needs you", since that is what a delete
 * would interrupt. Then what automatic clean up will do, when the list
 * asked for it: "Kept: 3 changes" for a worktree a rule would remove that
 * stays, with why, or "Goes Nov 22", the first day a rule removes it if nothing
 * changes, and never a day before `now`. Else it is what git status says:
 * "Clean" or "3 changes". `locale` names the months, the user's by default.
 */
export function describeListedWorktree(
  listed: ListedWorktree,
  now = 0,
  locale?: string,
): WorktreeStatusLine {
  const { status, running, cleanUp } = listed;
  if (status.state === "missing") return { text: "Missing", tone: "quiet" };
  if (running === "working") return { text: "Working", tone: "running" };
  if (running === "needs-you") return { text: "Needs you", tone: "attention" };
  if (cleanUp?.kind === "kept")
    return {
      text: `Kept: ${describeKeptReason(cleanUp.reason, status)}`,
      // Used in the last hour passes by itself. The rest needs the user.
      tone: cleanUp.reason === "recent" ? "quiet" : "warning",
    };
  if (cleanUp?.kind === "goes")
    return {
      text: `Goes ${new Date(Math.max(cleanUp.at, now)).toLocaleDateString(
        locale,
        { month: "short", day: "numeric" },
      )}`,
      tone: "quiet",
    };
  return {
    text: describeWorktreeStatus(status),
    tone: status.state === "changed" ? "warning" : "quiet",
  };
}

/**
 * When a backlog item became finished, for automatic clean up (#864): the
 * latest of the moments it was settled and archived. An item moved into a
 * done state is archived then, so that moment is its done moment too. An
 * item that is active again is not finished, whatever moments it keeps.
 */
export function finishedAtOf(
  item: Pick<LocalWorkItem, "status" | "settledAt" | "archivedAt">,
): number | undefined {
  if (item.status === "active") return undefined;
  const moments = [item.settledAt, item.archivedAt].filter(
    (moment): moment is number => moment !== undefined,
  );
  return moments.length ? Math.max(...moments) : undefined;
}

/**
 * What a clean-up round sends: for each item that has a worktree and is
 * finished, when it became so. An item Ajour no longer has is not sent, so
 * only the unused rule can remove its worktree.
 */
export function finishedItemsOf(
  worktrees: readonly Pick<Worktree, "workItemId">[],
  items: readonly Pick<
    LocalWorkItem,
    "_id" | "status" | "settledAt" | "archivedAt"
  >[],
): FinishedItem[] {
  const withWorktree = new Set(worktrees.map((one) => one.workItemId));
  return items.flatMap((item) => {
    const finishedAt = withWorktree.has(item._id)
      ? finishedAtOf(item)
      : undefined;
    return finishedAt === undefined
      ? []
      : [{ workItemId: item._id, finishedAt }];
  });
}

/** A rule's delay as its select says it: "After 3 days", "After 1 day". */
export function describeCleanUpDelay(days: number): string {
  return `After ${plural(days, "day", "days")}`;
}

/**
 * What a list reads beside a worktree's name: its backlog item's title.
 * An item Ajour no longer has leaves the key the worktree was made for.
 */
export function describeWorktreeItem(
  worktree: Worktree,
  items: readonly { _id: string; title: string }[],
): string {
  return (
    items.find((item) => item._id === worktree.workItemId)?.title ??
    worktree.itemKey
  );
}

/** How many threads a group holds: "2 threads", "1 thread", "No thread". */
export function describeThreadCount(count: number): string {
  return count ? plural(count, "thread", "threads") : "No thread";
}

/**
 * The file manager's menu action by its name on this system, as Electron
 * names the platform. Any other system gets the plain words.
 */
export function showInFileManagerLabel(platform: string | undefined): string {
  if (platform === "darwin") return "Show in Finder";
  if (platform === "win32") return "Show in File Explorer";
  return "Show in file manager";
}

/** The threads of an item that run in one place, under the line that names it. */
export interface HandoffGroup {
  key: string;
  /**
   * What the line reads: the worktree's name, the repository folder's, or
   * "<tool label>'s own worktree".
   */
  name: string;
  /** The worktree of Ajour's the threads run in. */
  listed?: ListedWorktree;
  /**
   * The threads run in worktrees their tool made (#863). Ajour doesn't
   * list, delete or clean those, so the line has no status and no menu.
   */
  ownWorktree?: true;
  /** In the order given. */
  handoffs: Handoff[];
}

/** The line above the threads a tool runs in worktrees it made itself. */
export function describeOwnWorktree(toolLabel: string): string {
  return `${toolLabel}'s own worktree`;
}

/**
 * An item's threads by the place they run in, once the item has a
 * worktree: each worktree of Ajour's, newest first, then one group per
 * tool for the threads it runs in worktrees it made itself (#863), under
 * "<tool label>'s own worktree", then the main folder of each repository
 * folder a thread started in, under the folder's name. A worktree without
 * a thread keeps its group, so it can still be deleted. A thread whose
 * worktree Ajour no longer keeps sits in its main folder, and so does a
 * thread a tool that makes its own worktree started under Main folder.
 * `labelOf` names a tool as its plugin does.
 * Undefined for an item without a worktree, Ajour's or a tool's own, whose
 * card shows no line, and until the item's worktrees are read.
 */
export function groupHandoffsByPlace(
  handoffs: readonly Handoff[],
  worktrees: readonly ListedWorktree[] | undefined,
  folders: readonly RepositoryFolder[] = [],
  labelOf: (pluginId: string, toolId: string) => string = (_, toolId) => toolId,
): HandoffGroup[] | undefined {
  if (!worktrees) return undefined;
  if (!worktrees.length && !handoffs.some((handoff) => handoff.ownWorktree))
    return undefined;
  const known = new Set(worktrees.map((listed) => listed.worktree.id));
  const inWorktree = (handoff: Handoff) =>
    handoff.worktreeId !== undefined && known.has(handoff.worktreeId);
  const groups: HandoffGroup[] = worktrees.map((listed) => ({
    key: listed.worktree.id,
    name: listed.worktree.name,
    listed,
    handoffs: handoffs.filter(
      (handoff) => handoff.worktreeId === listed.worktree.id,
    ),
  }));
  const own = new Map<string, HandoffGroup>();
  const main = new Map<string, HandoffGroup>();
  for (const handoff of handoffs) {
    if (inWorktree(handoff)) continue;
    if (handoff.ownWorktree) {
      const key = `own:${handoff.pluginId}:${handoff.toolId}`;
      const group = own.get(key) ?? {
        key,
        name: describeOwnWorktree(labelOf(handoff.pluginId, handoff.toolId)),
        ownWorktree: true as const,
        handoffs: [],
      };
      group.handoffs.push(handoff);
      own.set(key, group);
      continue;
    }
    const group = main.get(handoff.folderId) ?? {
      key: `main:${handoff.folderId}`,
      name:
        folders.find((folder) => folder.id === handoff.folderId)?.name ??
        worktreeStartInLabels.main,
      handoffs: [],
    };
    group.handoffs.push(handoff);
    main.set(handoff.folderId, group);
  }
  return [...groups, ...own.values(), ...main.values()];
}

/** A changed file as git status prints it: `M  src/grid.tsx`, `R  old -> new`. */
export function describeWorktreeChange(change: WorktreeChange): string {
  return `${change.code} ${
    change.from ? `${change.from} -> ${change.path}` : change.path
  }`;
}

/** The sentence under the delete dialog's title: what the delete loses. */
export function describeDeleteLoss(preview: WorktreeDeletePreview): string {
  const { status } = preview.listed;
  switch (status.state) {
    case "changed":
      return status.changes === 1
        ? "Deleting the worktree loses its uncommitted change."
        : `Deleting the worktree loses its ${status.changes} uncommitted changes.`;
    case "clean":
      return "It has no uncommitted changes. Deleting it removes its folder, with the files git ignores.";
    case "missing":
      return "Its folder is already gone. Deleting it removes it from Ajour's list.";
    case "unknown":
      return "Ajour couldn't read its changes. Deleting it removes its folder and every file in it.";
  }
}

/**
 * What the delete dialog adds for a worktree a tool switched off the branch
 * Ajour made (#857): the branch it is on now, which the delete keeps, or
 * that it is on none, with the commits on no branch the delete loses.
 * Empty for a worktree on its own branch.
 */
export function describeSwitched(preview: WorktreeDeletePreview): string {
  const { switched } = preview;
  if (!switched) return "";
  if (switched.branch)
    return `It is on the branch ${switched.branch} now, which stays.`;
  const lost = switched.commitsOnNoBranch;
  return !lost
    ? "It is on no branch now."
    : lost === 1
      ? "It is on no branch now. Deleting the worktree loses 1 commit that is on no branch."
      : `It is on no branch now. Deleting the worktree loses ${lost} commits that are on no branch.`;
}

/**
 * The toast after a delete: "Deleted aj-4821", or "Deleted aj-4821 and its
 * branch" when the branch went too.
 */
export function describeDeleted(name: string, branchDeleted: boolean): string {
  return branchDeleted ? `Deleted ${name} and its branch` : `Deleted ${name}`;
}

/** What the branch checkbox's second line says of the branch's commits. */
export function describeUnpushedCommits(count: number): string {
  const commits =
    count === 0
      ? "All its commits are on a remote."
      : count === 1
        ? "1 of its commits isn't on any remote."
        : `${count} of its commits aren't on any remote.`;
  return `${commits} Unticked, the branch stays with its commits.`;
}

/**
 * The warnings of the delete dialog: one line per tool and state for the
 * threads that are Working or Needs you in the worktree. `labelOf` names a
 * tool as its plugin does.
 */
export function describeRunningThreads(
  running: WorktreeDeletePreview["running"],
  labelOf: (pluginId: string, toolId: string) => string,
): string[] {
  const lines = running.map((thread) => {
    const label = labelOf(thread.pluginId, thread.toolId);
    return thread.state === "working"
      ? `${label} is still working in it.`
      : `${label} is waiting for you in it.`;
  });
  return [...new Set(lines)];
}
