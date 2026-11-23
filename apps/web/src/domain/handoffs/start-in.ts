import { isValidNewBranchName } from "@ajour/shared/handoff-templates";
import type { RepositoryFolder } from "@ajour/shared/repository-folders";
import {
  WORKTREES_FOLDER,
  type HandoffStartIn,
  type RepositoryBranch,
  type RepositoryBranches,
  type Worktree,
  type WorktreeStartIn,
  worktreeStartInLabels,
} from "@ajour/shared/worktrees";

/**
 * Where a hand off starts, as the window shows and chooses it (#861), from
 * "Hand off to a coding tool" in docs/agents/ux-spec.md: the hand-off
 * sheet's Start in row, the Start in dialog and Review prompt. The local
 * API decides for a start that names no place, so `defaultStartPlace`
 * repeats its rule and nothing else here decides anything.
 */

/** What a hand off of one item can start from in one repository folder. */
export interface FolderStartOptions {
  folder: RepositoryFolder;
  /**
   * The folder's branches and default source. Undefined when the local
   * API couldn't list them: the window then offers no source.
   */
  branches?: RepositoryBranches;
  /** The item's worktrees in the folder still on disk, newest first. */
  worktrees: readonly Worktree[];
}

/** What a project's Start in select holds: its own choice, or `settings`. */
export type ProjectStartInChoice = WorktreeStartIn | "settings";

/**
 * The choices of a project's "Hand offs start in" (#864), in the order its
 * select shows them. The first follows Settings › Worktrees and names what
 * that is now, such as "Settings (New worktree)".
 */
export function projectStartInChoices(
  settings: WorktreeStartIn,
): { value: ProjectStartInChoice; label: string }[] {
  return [
    {
      value: "settings",
      label: `Settings (${worktreeStartInLabels[settings]})`,
    },
    ...(["main", "worktree", "ask"] as const).map((value) => ({
      value,
      label: worktreeStartInLabels[value],
    })),
  ];
}

/** One hand off's place, or that the window asks for it. */
export type StartPlace = HandoffStartIn | { kind: "ask" };

/**
 * Where a start that names no place runs, as the local API decides it: the
 * item's newest worktree in the folder, else what Settings say, and the
 * main folder wherever Ajour can't make a worktree. Under Ask each time the
 * window asks, whatever worktrees the item has.
 */
export function defaultStartPlace(
  startIn: WorktreeStartIn,
  options: Pick<FolderStartOptions, "branches" | "worktrees">,
): StartPlace {
  if (startIn === "ask") return { kind: "ask" };
  const earlier = options.worktrees[0];
  if (earlier) return { kind: "worktree", worktreeId: earlier.id };
  if (startIn === "main" || options.branches?.unavailable)
    return { kind: "main" };
  return { kind: "new" };
}

/**
 * Why New worktree can't be chosen in the folder: it isn't the top folder
 * of a git checkout, or this computer has no git. Undefined when it can.
 */
export function getNewWorktreeRefusal(
  options: Pick<FolderStartOptions, "branches" | "folder">,
): string | undefined {
  const reason = options.branches?.unavailable;
  if (reason === "git_missing") return "This computer has no git";
  if (reason === "not_repository")
    return `${options.folder.name} is not a git repository`;
  return undefined;
}

/** The source a new worktree starts from: the one chosen, else the folder's default. */
export function getStartSource(
  place: StartPlace,
  options: Pick<FolderStartOptions, "branches">,
): string | undefined {
  return (
    (place.kind === "new" ? place.source : undefined) ??
    options.branches?.source
  );
}

/**
 * What a tool that makes its own worktree does in a place (#863), for its
 * row in the hand-off sheet: "Makes its own worktree" under New worktree,
 * and "Can't join aj-4821; makes its own" for a worktree the item has,
 * since it can't work in a worktree of Ajour's. With `label` the sentence
 * names the tool, for a dialog: "<tool> makes its own worktree". Undefined
 * for the main folder, where it makes none, and while the place is not
 * known: under Ask each time, or before the folder is.
 */
export function getOwnWorktreeNote(
  place: StartPlace | undefined,
  options: Pick<FolderStartOptions, "worktrees"> | undefined,
  label?: string,
): string | undefined {
  if (!place || place.kind === "main" || place.kind === "ask") return undefined;
  const joined =
    place.kind === "worktree"
      ? options?.worktrees.find(
          (candidate) => candidate.id === place.worktreeId,
        )
      : undefined;
  if (joined)
    return `Can't join ${joined.name}; ${label ? `${label} makes` : "makes"} its own`;
  return label ? `${label} makes its own worktree` : "Makes its own worktree";
}

export interface StartPlaceLines {
  /** Which icon stands for the place. */
  icon: "new" | "worktree" | "main" | "ask";
  /** The top line: where the hand off starts. */
  title: string;
  /** The bottom line: the source, or the branch the tool works on. */
  detail: string;
  /** The whole branch or source name, when the bottom line may cut it. */
  branch?: string;
  /** The bottom line names a source the user can change. */
  sourced: boolean;
}

/**
 * The two lines of the Start in row for a place: "New worktree" over "From
 * origin/main", "Start in aj-4821" over its branch, "Main folder" over "On
 * develop", or "Ask each time".
 */
export function describeStartPlace(
  place: StartPlace,
  options: FolderStartOptions,
): StartPlaceLines {
  if (place.kind === "ask")
    return {
      icon: "ask",
      title: "Ask each time",
      detail: "Asks when you pick a tool",
      sourced: false,
    };
  if (place.kind === "worktree") {
    const worktree = options.worktrees.find(
      (candidate) => candidate.id === place.worktreeId,
    );
    return {
      icon: "worktree",
      title: worktree ? `Start in ${worktree.name}` : "Previous worktree",
      detail: worktree?.branch ?? "",
      ...(worktree ? { branch: worktree.branch } : {}),
      sourced: false,
    };
  }
  if (place.kind === "main") {
    const current = options.branches?.current;
    return {
      icon: "main",
      title: "Main folder",
      // A folder without a branch to name, such as one that isn't a git
      // repository, shows its own name.
      detail: current ? `On ${current}` : options.folder.name,
      ...(current ? { branch: current } : {}),
      sourced: false,
    };
  }
  const source = getStartSource(place, options);
  return {
    icon: "new",
    title: "New worktree",
    detail: source ? `From ${source}` : "From the default branch",
    ...(source ? { branch: source } : {}),
    // Without the folder's branches there is nothing to pick from.
    sourced: Boolean(options.branches && !options.branches.unavailable),
  };
}

/**
 * The name a new branch gets when `wanted` is taken, as the local API picks
 * it: `-2`, then `-3`. Only local branches take a name.
 */
export function freeBranchName(
  wanted: string,
  branches: readonly RepositoryBranch[],
): string {
  const taken = new Set(
    branches.filter((branch) => !branch.remote).map((branch) => branch.name),
  );
  if (!taken.has(wanted)) return wanted;
  for (let suffix = 2; suffix <= 50; suffix++)
    if (!taken.has(`${wanted}-${suffix}`)) return `${wanted}-${suffix}`;
  return wanted;
}

/** Why a typed branch name can't be used, or undefined when it can. */
export function getBranchNameRefusal(name: string): string | undefined {
  if (name.length > 480) return "This branch name is too long.";
  return isValidNewBranchName(name)
    ? undefined
    : "Not a valid git branch name.";
}

/**
 * Where the folder keeps its worktrees, or one of them, in the folder's
 * own path style, for a tooltip.
 */
export function getWorktreePath(repositoryPath: string, name?: string) {
  const separator =
    repositoryPath.includes("\\") && !repositoryPath.includes("/") ? "\\" : "/";
  return [
    repositoryPath.replace(/[\\/]+$/, ""),
    ...WORKTREES_FOLDER,
    ...(name ? [name] : []),
  ].join(separator);
}

/**
 * What Hand off will do, for the line above the Start in dialog's buttons
 * and the tooltips of Review prompt: "New branch 4821-spike from
 * origin/main", "Starts in aj-4821, on 4821-week-grid", "Starts in
 * atlas-web, on develop". `template.branch` is the branch template's name
 * for the item. When it fills empty and the user typed none, the local API
 * names the branch after the new worktree's folder, which only it can
 * pick, so the line promises no name.
 *
 * `ownWorktreeOf` is the label of a tool that makes its own worktree
 * (#863). Outside the main folder the line then says so, with the branch
 * and the source the tool is told: "<tool> makes its own worktree, on
 * 4821-spike from origin/main", or "Can't join aj-4821; <tool> makes its
 * own, on ..." for a worktree the item has. A taken name shows with the
 * `-2` the local API gives it, as for a worktree of Ajour's: for a
 * worktree the item has, the template's name is that worktree's branch.
 */
export function summarizeStartPlace(
  place: HandoffStartIn,
  options: FolderStartOptions,
  template: { branch: string },
  ownWorktreeOf?: string,
): string {
  if (place.kind === "main") {
    const current = options.branches?.current;
    return `Starts in ${options.folder.name}${current ? `, on ${current}` : ""}`;
  }
  if (ownWorktreeOf) {
    // A worktree the item has counts as New worktree, from the default source.
    const asNew: Extract<HandoffStartIn, { kind: "new" }> =
      place.kind === "new" ? place : { kind: "new" };
    const wanted = asNew.branch || template.branch;
    const branch = wanted
      ? freeBranchName(wanted, options.branches?.branches ?? [])
      : "";
    const source = getStartSource(asNew, options);
    return [
      getOwnWorktreeNote(place, options, ownWorktreeOf),
      `${branch ? `on ${branch} ` : ""}from ${source ?? "the default branch"}`,
    ].join(", ");
  }
  if (place.kind === "worktree") {
    const worktree = options.worktrees.find(
      (candidate) => candidate.id === place.worktreeId,
    );
    return worktree
      ? `Starts in ${worktree.name}, on ${worktree.branch}`
      : "Starts in a previous worktree";
  }
  const wanted = place.branch || template.branch;
  const source = getStartSource(place, options);
  // Without a source the list could name, the start picks it: no name here.
  const from = `from ${source ?? "the default branch"}`;
  return wanted
    ? `New branch ${freeBranchName(wanted, options.branches?.branches ?? [])} ${from}`
    : `New branch named after the new worktree, ${from}`;
}
