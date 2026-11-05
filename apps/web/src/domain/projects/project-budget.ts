import type { ProjectSourceMe } from "@ajour/shared";
import type {
  LocalProject,
  LocalProjectSourceBudget,
  LocalProjectTask,
  LocalTimesheetEntry,
  LocalTimesheetEntryCommit,
  LocalTimesheetTombstone,
} from "@/domain/local-state";

export const HOUR_MS = 3_600_000;

/*
 * A managed project's budget card (#509, ADR 0016). The source writes the
 * budget and the consumed hours as of a time it gives; Ajour computes what
 * the source can't have yet from the entries and their committed copies.
 * Every function is pure and nothing it returns is stored.
 */

/**
 * The entries a managed project's figures read: those on the project, those
 * whose committed copy is on it (so one moved off it counts), and the deleted
 * ones whose committed copy was on it. A deleted entry has no time on any
 * project now, so it stands as an entry of no project and no time, holding
 * its committed copy: it subtracts that copy from Not counted yet and counts
 * on the reconciliation's committed side.
 */
export function budgetEntries(
  projectId: string,
  entries: readonly LocalTimesheetEntry[],
  tombstones: readonly LocalTimesheetTombstone[],
): LocalTimesheetEntry[] {
  const deleted: LocalTimesheetEntry[] = [];
  for (const { entryId, commit } of tombstones) {
    if (commit.projectId !== projectId) continue;
    deleted.push({
      _id: entryId,
      localDate: commit.localDate,
      label: "",
      durationMs: 0,
      sourceBlockIds: [],
      committedAt: commit.at,
      commit,
    });
  }
  return [
    ...entries.filter(
      (entry) =>
        entry.projectId === projectId || entry.commit?.projectId === projectId,
    ),
    ...deleted,
  ];
}

/** Whether the timesheet tool had this committed copy by `asOfMs`. */
function reachedSource(
  commit: LocalTimesheetEntryCommit | undefined,
  asOfMs: number,
): commit is LocalTimesheetEntryCommit {
  // Local time never reaches the timesheet tool.
  return Boolean(commit && !commit.local && commit.at <= asOfMs);
}

/** Whether a day is in the period that starts on `since`. Without one, all are. */
function inPeriod(localDate: string, since: string | undefined) {
  return !since || localDate >= since;
}

/**
 * Not counted yet: the user's time on the project the source can't have by
 * `asOf`. An entry counts what it holds on the project now, less what its
 * committed copy held there when the source could have it. So an entry never
 * committed, committed after `asOf` or committed as local time counts in
 * full, a stale entry counts its difference from the copy, and an entry moved
 * off the project subtracts its committed hours. With `since`, the budget's
 * first day, only time dated from that day counts.
 *
 * Known limitation: `commit` keeps only an entry's latest copy. An entry
 * committed before `asOf`, then edited and committed again after it, shows
 * the later copy, which the source can't have, so the whole entry counts here
 * until the next snapshot passes the re-commit.
 */
export function notCountedMs(
  project: Pick<LocalProject, "_id">,
  entries: readonly LocalTimesheetEntry[],
  asOf: string,
  since?: string,
): number {
  const asOfMs = Date.parse(asOf);
  let total = 0;
  for (const entry of entries) {
    if (entry.projectId === project._id && inPeriod(entry.localDate, since)) {
      total += entry.durationMs;
    }
    const { commit } = entry;
    if (
      reachedSource(commit, asOfMs) &&
      commit.projectId === project._id &&
      inPeriod(commit.localDate, since)
    ) {
      total -= commit.durationMs;
    }
  }
  return total;
}

/**
 * The estimated Remaining: the source's remaining hours, or its total less
 * its consumed hours, less Not counted yet. Undefined for a money budget,
 * which Ajour can't subtract hours from, and for one with nothing left to
 * read.
 */
export function remainingEstimate(
  budget: LocalProjectSourceBudget,
  notCounted: number,
): number | undefined {
  const sourceRemaining = sourceRemainingMs(budget);
  return sourceRemaining === undefined
    ? undefined
    : sourceRemaining - notCounted;
}

/** The source's own remaining hours in ms, before Not counted yet. */
export function sourceRemainingMs(
  budget: LocalProjectSourceBudget,
): number | undefined {
  if (budget.unit !== "hours") return undefined;
  const remainingHours =
    budget.remaining ??
    (budget.total === undefined ? undefined : budget.total - budget.consumed);
  return remainingHours === undefined
    ? undefined
    : Math.round(remainingHours * HOUR_MS);
}

/** An hours budget's total and consumed hours, in ms. */
export function budgetHoursMs(budget: LocalProjectSourceBudget): {
  totalMs?: number;
  consumedMs: number;
} {
  return {
    ...(budget.total === undefined
      ? {}
      : { totalMs: Math.round(budget.total * HOUR_MS) }),
    consumedMs: Math.round(budget.consumed * HOUR_MS),
  };
}

/** A task whose committed hours differ from the source's hours for the user. */
export interface ReconciledTask {
  /** Undefined for time committed on the project without a task. */
  taskId?: string;
  name: string;
  /** The source's hours for the user on the task (`myHours`). */
  sourceMs: number;
  /** What the user committed on it that the source could have by `asOf`. */
  committedMs: number;
  /** The entries behind `committedMs`, as the timesheet tool got them. */
  entries: LocalTimesheetEntry[];
}

export interface Reconciliation {
  /** The source's hours for the user across the tasks it gives them for. */
  sourceMs: number;
  /** What the user committed on those tasks, and on none, that the source could have. */
  committedMs: number;
  /** |sourceMs - committedMs|: what "See the Z" is. */
  differenceMs: number;
  /** The tasks that differ, in the project's order. Empty when all match. */
  tasks: ReconciledTask[];
}

/** A difference under a minute is the source rounding its hours. */
export const RECONCILIATION_TOLERANCE_MS = 60_000;

/**
 * Whether what the user committed on the project matches what the source
 * has for them, task by task. It compares the committed copies the source
 * could have, sent before `asOf` and not as local time, with each task's
 * `myHours`. A task without `myHours`, or one that left the source, is
 * unknown, not zero: it is left out of the comparison and of both totals.
 * With `me.hoursSince`, only copies dated from that day count. Null when the source can't give the user's hours.
 */
export function reconciliation(
  project: Pick<LocalProject, "_id" | "tasks">,
  entries: readonly LocalTimesheetEntry[],
  me: ProjectSourceMe | undefined,
  asOf: string,
): Reconciliation | null {
  if (!me?.hoursAvailable) return null;
  const asOfMs = Date.parse(asOf);
  const committedByTask = new Map<
    string | undefined,
    { committedMs: number; entries: LocalTimesheetEntry[] }
  >();
  for (const entry of entries) {
    const { commit } = entry;
    if (
      !reachedSource(commit, asOfMs) ||
      commit.projectId !== project._id ||
      !inPeriod(commit.localDate, me.hoursSince)
    ) {
      continue;
    }
    const task = committedByTask.get(commit.taskId) ?? {
      committedMs: 0,
      entries: [],
    };
    task.committedMs += commit.durationMs;
    task.entries.push(entry);
    committedByTask.set(commit.taskId, task);
  }

  let sourceMs = 0;
  let committedMs = 0;
  const compared: ReconciledTask[] = [];
  for (const task of project.tasks) {
    const committed = committedByTask.get(task._id);
    committedByTask.delete(task._id);
    // A task that left the source keeps the hours of the report before, so
    // its hours are unknown now, like a task the source gives none for.
    const myHours = task.archivedByMissingSync
      ? undefined
      : task.source?.myHours;
    if (myHours === undefined) continue;
    const taskSourceMs = Math.round(myHours * HOUR_MS);
    sourceMs += taskSourceMs;
    committedMs += committed?.committedMs ?? 0;
    compared.push({
      taskId: task._id,
      name: task.name,
      sourceMs: taskSourceMs,
      committedMs: committed?.committedMs ?? 0,
      entries: committed?.entries ?? [],
    });
  }
  // Time committed on no task, and on tasks the project no longer has, which
  // are one row.
  const removed: ReconciledTask = {
    name: "A removed task",
    sourceMs: 0,
    committedMs: 0,
    entries: [],
  };
  for (const [taskId, committed] of committedByTask) {
    committedMs += committed.committedMs;
    if (taskId === undefined) {
      compared.push({ name: "No task", sourceMs: 0, ...committed });
    } else {
      removed.committedMs += committed.committedMs;
      removed.entries.push(...committed.entries);
    }
  }
  if (removed.entries.length > 0) compared.push(removed);

  return {
    sourceMs,
    committedMs,
    differenceMs: Math.abs(sourceMs - committedMs),
    tasks: compared.filter(
      (task) =>
        Math.abs(task.committedMs - task.sourceMs) >=
        RECONCILIATION_TOLERANCE_MS,
    ),
  };
}

/**
 * What a source task's row reads: the user's hours on it as the source
 * counts them, against its estimate. Undefined when the source gives no
 * hours for the user on it, so the row reads Ajour's own time.
 */
export function sourceTaskConsumed(
  task: Pick<LocalProjectTask, "budgetMs" | "source">,
): { budgetMs?: number; consumedMs: number } | undefined {
  const myHours = task.source?.myHours;
  if (myHours === undefined) return undefined;
  return {
    ...(task.budgetMs === undefined ? {} : { budgetMs: task.budgetMs }),
    consumedMs: Math.round(myHours * HOUR_MS),
  };
}
