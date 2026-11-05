import type {
  LocalAppState,
  LocalProject,
  LocalProjectTask,
  LocalTimesheetEntry,
} from "@/domain/local-state";
import { updateWorkItem } from "@/domain/backlog/work-item-transitions";
import { getCommitTarget } from "@/domain/projects/commit-target";
import { setProjectTaskStatus } from "@/domain/projects/project-transitions";
import { normalizeTaskImportName } from "@/domain/projects/task-import";
import { isDateLocked } from "@/domain/time/locked-weeks";
import {
  markTimesheetEntriesNotCommitted,
  updateTimesheetEntry,
  type TimesheetEntryFactories,
} from "@/domain/time/timesheet-entry";

/*
 * Merge into… (#507, ADR 0016): moves a task's time entries to another task
 * of the same managed project and archives the emptied task.
 */

/**
 * Why a merge can't happen: `missing` when either task is not in the project,
 * `other_project` when the target belongs to another project,
 * `local_only_target` when the target's time never reaches the timesheet
 * tool, so the merged entries would leave it.
 */
export type TaskMergeRefusal =
  | "not_managed"
  | "missing"
  | "other_project"
  | "same_task"
  | "archived_target"
  | "local_only_target";

export type TaskMergeResult =
  { kind: "refused"; reason: TaskMergeRefusal } | TaskMerged;

export type TaskMerged = {
  kind: "merged";
  movedEntryCount: number;
  /** Entries of submitted weeks, which stay on the merged task. */
  keptEntryCount: number;
  /** Committed entries whose copy the merge marked stale. */
  staleEntryCount: number;
  movedTimerCount: number;
  /** Backlog items mapped to the merged task, now mapped to the target. */
  movedWorkItemCount: number;
  /** The target had no pin, and took the merged task's. */
  movedPin: boolean;
  /** The target had no star, and took the merged task's. */
  movedFavorite: boolean;
};

/** Why `fromTaskId` can't merge into `intoTaskId`, or undefined when it can. */
export function getTaskMergeRefusal(
  projects: readonly LocalProject[],
  projectId: string,
  fromTaskId: string,
  intoTaskId: string,
): TaskMergeRefusal | undefined {
  const project = projects.find((candidate) => candidate._id === projectId);
  if (project && !project.source) return "not_managed";
  const from = project?.tasks.find((task) => task._id === fromTaskId);
  const into = project?.tasks.find((task) => task._id === intoTaskId);
  if (!project || !from) return "missing";
  if (!into) {
    return projects.some((other) =>
      other.tasks.some((task) => task._id === intoTaskId),
    )
      ? "other_project"
      : "missing";
  }
  if (from === into) return "same_task";
  if (into.status !== "active") return "archived_target";
  if (getCommitTarget(project, into) === "local") return "local_only_target";
  return undefined;
}

/**
 * Moves every entry of `fromTaskId`, and the running entry, to `intoTaskId`
 * in project `projectId`, then archives `fromTaskId`. The store's Undo puts
 * back every record it changed.
 */
export function mergeTask(
  state: LocalAppState,
  projectId: string,
  fromTaskId: string,
  intoTaskId: string,
  factories: TimesheetEntryFactories,
): { state: LocalAppState; result: TaskMergeResult } {
  const reason = getTaskMergeRefusal(
    state.projects,
    projectId,
    fromTaskId,
    intoTaskId,
  );
  if (reason) return { state, result: { kind: "refused", reason } };

  const onTask = state.timesheetEntries.filter(
    (entry) => entry.projectId === projectId && entry.taskId === fromTaskId,
  );
  // A submitted week is read-only, and the timesheet tool keeps its entries
  // under the task they were submitted with.
  const moving = onTask.filter(
    (entry) => !isDateLocked(state, entry.localDate),
  );
  const movingIds = moving.map((entry) => entry._id);
  // A committed entry's copy goes stale first: the move then keeps the copy,
  // so the next commit moves the external entry instead of adding one.
  const marked = markTimesheetEntriesNotCommitted(state, movingIds);
  const staleEntryCount = marked.timesheetEntries.filter(
    (entry, index) =>
      entry.commit?.stale && !state.timesheetEntries[index]?.commit?.stale,
  ).length;
  const next = moving.reduce((current, entry) => {
    const moved = updateTimesheetEntry(
      current,
      entry._id,
      {
        projectId,
        taskId: intoTaskId,
        note: entry.note,
        durationMs: entry.durationMs,
      },
      factories,
    );
    return {
      ...moved,
      // The running entry keeps its running time; it moves below.
      timers: current.timers,
      // A merge is not a use: recent tasks keep their order.
      timesheetEntries: moved.timesheetEntries.map((item) =>
        item._id === entry._id ? withUsedAt(item, entry.usedAt) : item,
      ),
    };
  }, marked);
  let movedTimerCount = 0;
  const timers = next.timers.map((timer) => {
    if (
      timer.projectId !== projectId ||
      timer.taskId !== fromTaskId ||
      isDateLocked(next, timer.localDate)
    ) {
      return timer;
    }
    movedTimerCount += 1;
    return { ...timer, taskId: intoTaskId };
  });

  const personal = movePersonalMarks(
    next.projects,
    projectId,
    fromTaskId,
    intoTaskId,
  );
  // The source's own archive flag stays on a task it already archived, so a
  // hand Restore is still refused. An active task is archived as by hand.
  const wasActive =
    personal.projects
      .find((candidate) => candidate._id === projectId)
      ?.tasks.find((candidate) => candidate._id === fromTaskId)?.status ===
    "active";
  const projects = wasActive
    ? setProjectTaskStatus(
        personal.projects,
        projectId,
        fromTaskId,
        "archived",
        factories.now,
      )
    : personal.projects;

  // Backlog items on the task follow it, so new time from them lands on the
  // target, not on an archived task.
  const movedItemIds = next.workItems
    .filter(
      (item) => item.projectId === projectId && item.taskId === fromTaskId,
    )
    .map((item) => item._id);
  const workItems = movedItemIds.reduce(
    (current, id) => updateWorkItem(current, id, { taskId: intoTaskId }),
    next,
  ).workItems;

  return {
    state: { ...next, projects, timers, workItems },
    result: {
      kind: "merged",
      movedEntryCount: moving.length,
      keptEntryCount: onTask.length - moving.length,
      staleEntryCount,
      movedTimerCount,
      movedWorkItemCount: movedItemIds.length,
      movedPin: personal.movedPin,
      movedFavorite: personal.movedFavorite,
    },
  };
}

/**
 * The merged task's pin and star go to the target when it has none of its
 * own. A target's own stays, and the archived task keeps the other.
 */
function movePersonalMarks(
  projects: LocalProject[],
  projectId: string,
  fromTaskId: string,
  intoTaskId: string,
) {
  const project = projects.find((candidate) => candidate._id === projectId);
  const from = project?.tasks.find((task) => task._id === fromTaskId);
  const into = project?.tasks.find((task) => task._id === intoTaskId);
  const movedPin = Boolean(from?.pinnedSlot && !into?.pinnedSlot);
  const movedFavorite =
    from?.favoritedAt !== undefined && into?.favoritedAt === undefined;
  if (!project || !from || !into || (!movedPin && !movedFavorite)) {
    return { projects, movedPin: false, movedFavorite: false };
  }

  const tasks = project.tasks.map((task) => {
    if (task === from) {
      const {
        pinnedSlot: _pinnedSlot,
        favoritedAt: _favoritedAt,
        ...rest
      } = task;
      return {
        ...rest,
        ...(movedPin ? {} : { pinnedSlot: task.pinnedSlot }),
        ...(movedFavorite ? {} : { favoritedAt: task.favoritedAt }),
      };
    }
    if (task === into) {
      return {
        ...task,
        ...(movedPin ? { pinnedSlot: from.pinnedSlot } : {}),
        ...(movedFavorite ? { favoritedAt: from.favoritedAt } : {}),
      };
    }
    return task;
  });
  return {
    projects: projects.map((candidate) =>
      candidate === project ? { ...project, tasks } : candidate,
    ),
    movedPin,
    movedFavorite,
  };
}

function withUsedAt<T extends { usedAt?: number }>(
  record: T,
  usedAt: number | undefined,
): T {
  const { usedAt: _usedAt, ...rest } = record;
  return (usedAt === undefined ? rest : { ...rest, usedAt }) as T;
}

// ---------------------------------------------------------------------------
// Suggestions: computed from the state each time, never stored.

/**
 * A pair Ajour offers to merge. `renamed`: the task left the source while a
 * new task of its group arrived, as a rename at a source without stable IDs
 * looks. `lookalike`: a task of the user's own has a name close to a source
 * task's.
 */
export interface TaskMergeSuggestion {
  kind: "renamed" | "lookalike";
  fromTaskId: string;
  intoTaskId: string;
}

/**
 * How close a local task's name must be to a source task's for a lookalike:
 * a plural ("Meeting", "Meetings": 0.92) or a letter off ("Design review",
 * "Design preview": 0.88) passes, a shared word alone ("Support", "Sport":
 * 0.6) does not.
 */
export const LOOKALIKE_CLOSENESS = 0.75;

/**
 * How close two task names are, from 0 to 1: the Sørensen–Dice coefficient
 * of their letter pairs, on the names compared as task names are (case,
 * accents and spaces ignored). Twice the pairs they share, over all their
 * pairs. Equal names are 1. A word added to a name keeps it close ("Design",
 * "Design reviews": 0.56), unlike a name that only shares letters ("Design",
 * "Testing": 0.18).
 */
export function taskNameCloseness(left: string, right: string): number {
  const a = normalizeTaskImportName(left);
  const b = normalizeTaskImportName(right);
  if (a === b) return 1;
  const pairsA = letterPairs(a);
  const pairsB = letterPairs(b);
  const total = pairsA.length + pairsB.length;
  if (total === 0) return 0;
  const counts = new Map<string, number>();
  for (const pair of pairsA) counts.set(pair, (counts.get(pair) ?? 0) + 1);
  let shared = 0;
  for (const pair of pairsB) {
    const count = counts.get(pair) ?? 0;
    if (count > 0) {
      shared += 1;
      counts.set(pair, count - 1);
    }
  }
  return (2 * shared) / total;
}

function letterPairs(value: string): string[] {
  return Array.from({ length: Math.max(0, value.length - 1) }, (_, index) =>
    value.slice(index, index + 2),
  );
}

/**
 * The merges Ajour suggests in a managed project, at most one per task, in
 * the project's task order:
 *
 * - a task the source left out (archived by missing sync) that still holds
 *   entries, paired with an active source task of the same group that
 *   arrived when it left or later, the closest name first;
 * - an active task of the user's own (no source link) whose name is at least
 *   `LOOKALIKE_CLOSENESS` close to an active source task's, the closest first.
 *
 * A Local only task, or a task of a Local only project, gets none, and is
 * never a target. `isDismissed` skips a pair the user said is not the same,
 * so the next closest shows.
 */
export function findTaskMergeSuggestions(
  project: LocalProject,
  entries: readonly LocalTimesheetEntry[],
  isDismissed: (pair: TaskMergeSuggestion) => boolean = () => false,
): TaskMergeSuggestion[] {
  if (!project.source) return [];
  const sends = (task: LocalProjectTask) =>
    getCommitTarget(project, task) !== "local";
  const targets = project.tasks.filter(
    (task) => task.status === "active" && task.source && sends(task),
  );
  const withEntries = new Set(
    entries.flatMap((entry) =>
      entry.projectId === project._id && entry.taskId ? [entry.taskId] : [],
    ),
  );

  const suggestions: TaskMergeSuggestion[] = [];
  for (const task of project.tasks) {
    if (!sends(task)) continue;
    let kind: TaskMergeSuggestion["kind"];
    // Each candidate's closeness is computed once, for the filter and the sort.
    const scored = (pool: LocalProjectTask[]) =>
      pool.map((target, order) => ({
        target,
        order,
        closeness: taskNameCloseness(task.name, target.name),
      }));
    let ranked: ReturnType<typeof scored>;
    if (
      task.status === "archived" &&
      task.archivedByMissingSync &&
      task.source &&
      withEntries.has(task._id)
    ) {
      const group = task.source.group;
      const leftAt = task.archivedAt ?? 0;
      kind = "renamed";
      ranked = scored(
        targets.filter(
          (target) =>
            target.source?.group === group && target.createdAt >= leftAt,
        ),
      );
    } else if (task.status === "active" && !task.source) {
      kind = "lookalike";
      ranked = scored(targets).filter(
        ({ closeness }) => closeness >= LOOKALIKE_CLOSENESS,
      );
    } else {
      continue;
    }

    const best = ranked
      .sort(
        (left, right) =>
          right.closeness - left.closeness || left.order - right.order,
      )
      .map(({ target }) => ({
        kind,
        fromTaskId: task._id,
        intoTaskId: target._id,
      }))
      .find((pair) => !isDismissed(pair));
    if (best) suggestions.push(best);
  }
  return suggestions;
}
