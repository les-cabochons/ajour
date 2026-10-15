import {
  getLocalProjectDisplayName,
  type LocalProject,
  type LocalTimesheetEntry,
  type WeeklyCapacityTargets,
} from "@/domain/local-state";

/**
 * Rules for the Commit page's lines: how the week's entries become copyable
 * lines and what the week summary shows. The user copies lines into an
 * external timesheet by hand; committing is in `timesheet-commit.ts`.
 */

const CAPACITY_KEYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const satisfies readonly (keyof WeeklyCapacityTargets)[];

/** Separator between merged comments, as typed into the external timesheet. */
export const SUBMIT_COMMENT_SEPARATOR = " | ";

export type SubmitGroupBy = "day-task" | "day" | "task";

/** One copyable line. Its hours and comments cover every entry in `entryIds`. */
export interface SubmitLine {
  key: string;
  entryIds: string[];
  projectId?: string;
  /** Undefined when the entries have no project. */
  projectName?: string;
  /** The project's code. Undefined when the project has no code. */
  projectCode?: string;
  /** Undefined when the entries have no task. */
  taskName?: string;
  durationMs: number;
  /** Notes merged with `SUBMIT_COMMENT_SEPARATOR`. Empty when there are none. */
  comments: string;
}

/** A day of lines, or the whole week when grouping by task. */
export interface SubmitSection {
  key: string;
  /** Undefined for the single section of the "task" grouping. */
  localDate?: string;
  lines: SubmitLine[];
}

interface DescribedEntry {
  entry: LocalTimesheetEntry;
  taskKey: string;
  projectName?: string;
  projectCode?: string;
  taskName?: string;
}

/**
 * Merges notes for one line. Blank notes are dropped, and a note repeated on
 * several entries appears once.
 */
export function mergeSubmitComments(notes: (string | undefined)[]): string {
  const unique = new Set<string>();
  for (const note of notes) {
    const trimmed = note?.trim();
    if (trimmed) {
      unique.add(trimmed);
    }
  }
  return [...unique].join(SUBMIT_COMMENT_SEPARATOR);
}

function describeEntries(
  entries: LocalTimesheetEntry[],
  projects: LocalProject[],
): DescribedEntry[] {
  const projectMap = new Map(projects.map((project) => [project._id, project]));
  return entries.map((entry) => {
    const project = entry.projectId
      ? projectMap.get(entry.projectId)
      : undefined;
    const task = entry.taskId
      ? project?.tasks.find((candidate) => candidate._id === entry.taskId)
      : undefined;
    const projectName = project
      ? getLocalProjectDisplayName(project)
      : undefined;
    const projectCode = project?.code?.trim() || undefined;
    // Imported entries without a task keep their source label as the task.
    const legacyLabel =
      entry.label.trim() && entry.label !== projectName
        ? entry.label.trim()
        : undefined;
    return {
      entry,
      taskKey: `${entry.projectId ?? "none"}::${entry.taskId ?? entry.label}`,
      projectName,
      projectCode,
      taskName: task?.name ?? legacyLabel,
    };
  });
}

function toLine(key: string, group: DescribedEntry[]): SubmitLine {
  const first = group[0]!;
  return {
    key,
    entryIds: group.map((item) => item.entry._id),
    projectId: first.entry.projectId,
    projectName: first.projectName,
    projectCode: first.projectCode,
    taskName: first.taskName,
    durationMs: group.reduce((sum, item) => sum + item.entry.durationMs, 0),
    comments: mergeSubmitComments(group.map((item) => item.entry.note)),
  };
}

function groupByTask(entries: DescribedEntry[]) {
  const groups = new Map<string, DescribedEntry[]>();
  for (const item of entries) {
    const group = groups.get(item.taskKey) ?? [];
    group.push(item);
    groups.set(item.taskKey, group);
  }
  return groups;
}

function compareLines(left: SubmitLine, right: SubmitLine) {
  return (
    (left.projectName ?? "").localeCompare(right.projectName ?? "") ||
    (left.taskName ?? "").localeCompare(right.taskName ?? "")
  );
}

/**
 * Builds the Commit page lines.
 *
 * - "day-task": a section per day, a line per task in that day.
 * - "day": a section per day, a line per entry.
 * - "task": one section, a line per task for the whole week.
 *
 * Days keep the week order and skip days without entries. Within a day,
 * entries keep the Day view order (latest committed first).
 */
export function groupSubmitLines({
  entries,
  groupBy,
  projects,
  weekDates,
}: {
  entries: LocalTimesheetEntry[];
  groupBy: SubmitGroupBy;
  projects: LocalProject[];
  weekDates: string[];
}): SubmitSection[] {
  const weekDateSet = new Set(weekDates);
  const described = describeEntries(
    entries
      .filter((entry) => weekDateSet.has(entry.localDate))
      .sort((left, right) => right.committedAt - left.committedAt),
    projects,
  );

  if (groupBy === "task") {
    const lines = [...groupByTask(described)]
      .map(([taskKey, group]) => toLine(taskKey, group))
      .sort(compareLines);
    return lines.length > 0 ? [{ key: "week", lines }] : [];
  }

  return weekDates.flatMap((localDate) => {
    const dayEntries = described.filter(
      (item) => item.entry.localDate === localDate,
    );
    const lines =
      groupBy === "day"
        ? dayEntries.map((item) => toLine(item.entry._id, [item]))
        : [...groupByTask(dayEntries)].map(([taskKey, group]) =>
            toLine(`${localDate}::${taskKey}`, group),
          );
    return lines.length > 0 ? [{ key: localDate, localDate, lines }] : [];
  });
}

export type SubmitWarning =
  | {
      kind: "day-under-target";
      localDate: string;
      loggedMs: number;
      targetMs: number;
    }
  | { kind: "missing-task"; entryCount: number };

export interface SubmitSummary {
  /** Every entry of the week. */
  totalMs: number;
  targetMs: number;
  isUnderTarget: boolean;
  warnings: SubmitWarning[];
}

/** The week's total against its capacity targets, with its warnings. */
export function summarizeWeek({
  capacityTargets,
  weekDates,
  weekEntries,
}: {
  capacityTargets: WeeklyCapacityTargets;
  weekDates: string[];
  weekEntries: LocalTimesheetEntry[];
}): SubmitSummary {
  const days = weekDates.map((localDate, index) => {
    const key = CAPACITY_KEYS[index];
    return {
      localDate,
      targetMs: key ? capacityTargets[key] : 0,
      loggedMs: weekEntries
        .filter((entry) => entry.localDate === localDate)
        .reduce((sum, entry) => sum + entry.durationMs, 0),
    };
  });
  const totalMs = days.reduce((sum, day) => sum + day.loggedMs, 0);
  const targetMs = days.reduce((sum, day) => sum + day.targetMs, 0);
  const missingTaskCount = weekEntries.filter((entry) => !entry.taskId).length;

  const warnings: SubmitWarning[] = days
    .filter((day) => day.targetMs > 0 && day.loggedMs < day.targetMs)
    .map((day) => ({ kind: "day-under-target", ...day }));
  if (missingTaskCount > 0) {
    warnings.push({ kind: "missing-task", entryCount: missingTaskCount });
  }

  return {
    totalMs,
    targetMs,
    isUnderTarget: targetMs > 0 && totalMs < targetMs,
    warnings,
  };
}
