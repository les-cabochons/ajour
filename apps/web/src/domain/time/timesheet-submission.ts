import {
  getLocalProjectDisplayName,
  type LocalProject,
  type LocalTimesheetEntry,
  type WeeklyCapacityTargets,
} from "@/domain/local-state";

/**
 * Rules for the submit page: how the week's entries become copyable lines,
 * what is selected, what the summary shows, and the week's submission status.
 * Submitting means copying the week into an external timesheet by hand, then
 * marking the entries as submitted in Ajour.
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

/**
 * One copyable line. Its hours and comments cover every entry in `entryIds`,
 * submitted or not, so the line matches what the external timesheet holds.
 */
export interface SubmitLine {
  key: string;
  entryIds: string[];
  /** The line's entries that are not submitted. Its checkbox covers these. */
  unsubmittedEntryIds: string[];
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
    unsubmittedEntryIds: group
      .filter((item) => item.entry.submittedAt === undefined)
      .map((item) => item.entry._id),
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
 * Builds the submit page lines.
 *
 * - "day-task": a section per day, a line per task in that day.
 * - "day": a section per day, a line per entry.
 * - "task": one section, a line per task for the whole week.
 *
 * Days keep the week order and skip days without entries. Within a day,
 * entries keep the Day view order (oldest committed first). With
 * `onlyUnsubmitted`, lines whose entries are all submitted are left out, but a
 * line that remains still adds up its submitted entries.
 */
export function groupSubmitLines({
  entries,
  groupBy,
  onlyUnsubmitted = false,
  projects,
  weekDates,
}: {
  entries: LocalTimesheetEntry[];
  groupBy: SubmitGroupBy;
  onlyUnsubmitted?: boolean;
  projects: LocalProject[];
  weekDates: string[];
}): SubmitSection[] {
  const keep = (line: SubmitLine) =>
    !onlyUnsubmitted || line.unsubmittedEntryIds.length > 0;
  const weekDateSet = new Set(weekDates);
  const described = describeEntries(
    entries
      .filter((entry) => weekDateSet.has(entry.localDate))
      .sort((left, right) => left.committedAt - right.committedAt),
    projects,
  );

  if (groupBy === "task") {
    const lines = [...groupByTask(described)]
      .map(([taskKey, group]) => toLine(taskKey, group))
      .filter(keep)
      .sort(compareLines);
    return lines.length > 0 ? [{ key: "week", lines }] : [];
  }

  return weekDates.flatMap((localDate) => {
    const dayEntries = described.filter(
      (item) => item.entry.localDate === localDate,
    );
    const lines = (
      groupBy === "day"
        ? dayEntries.map((item) => toLine(item.entry._id, [item]))
        : [...groupByTask(dayEntries)].map(([taskKey, group]) =>
            toLine(`${localDate}::${taskKey}`, group),
          )
    ).filter(keep);
    return lines.length > 0 ? [{ key: localDate, localDate, lines }] : [];
  });
}

export type SubmitSelectionState = "all" | "some" | "none";

/** How much of a line or a day the selection covers, for its checkbox. */
export function getSubmitSelectionState(
  selectedIds: ReadonlySet<string>,
  entryIds: string[],
): SubmitSelectionState {
  const selectedCount = entryIds.filter((id) => selectedIds.has(id)).length;
  if (selectedCount === 0) {
    return "none";
  }
  return selectedCount === entryIds.length ? "all" : "some";
}

/** Adds or drops every entry behind a line or a day chip. */
export function setSubmitSelection(
  selectedIds: ReadonlySet<string>,
  entryIds: string[],
  include: boolean,
): Set<string> {
  const next = new Set(selectedIds);
  for (const id of entryIds) {
    if (include) {
      next.add(id);
    } else {
      next.delete(id);
    }
  }
  return next;
}

/**
 * Keeps the selection in step with the entries the page can submit. Entries
 * that left the list are dropped. Entries that joined it, such as one edited
 * after the page opened, start selected, like every unsubmitted entry does.
 */
export function reconcileSubmitSelection(
  selectedIds: ReadonlySet<string>,
  previousSelectableIds: ReadonlySet<string>,
  selectableIds: string[],
): Set<string> {
  return new Set(
    selectableIds.filter(
      (id) => selectedIds.has(id) || !previousSelectableIds.has(id),
    ),
  );
}

export type SubmitWeekStatus =
  /** No entry of the week is submitted. */
  | { kind: "not-submitted" }
  /** Every entry of the week is submitted. */
  | {
      kind: "submitted";
      submittedAt: number;
      entryCount: number;
      totalMs: number;
    }
  /** Some entries are submitted and the others were never submitted. */
  | {
      kind: "partly-submitted";
      submittedAt: number;
      entryCount: number;
      totalMs: number;
    }
  /** Some entries were edited after they were submitted. */
  | { kind: "changed"; submittedAt: number; changedEntryIds: string[] };

/**
 * Status of one week's timesheet. `submittedAt` is the latest submission time
 * among the week's entries, including entries that were edited since.
 */
export function getSubmitWeekStatus(
  weekEntries: LocalTimesheetEntry[],
): SubmitWeekStatus {
  const submitted = weekEntries.filter(
    (entry) => entry.submittedAt !== undefined,
  );
  const changedEntryIds = weekEntries
    .filter(
      (entry) =>
        entry.submittedAt === undefined &&
        entry.previousSubmittedAt !== undefined,
    )
    .map((entry) => entry._id);
  const submittedAt = Math.max(
    ...weekEntries.map(
      (entry) =>
        entry.submittedAt ??
        entry.previousSubmittedAt ??
        Number.NEGATIVE_INFINITY,
    ),
  );

  if (!Number.isFinite(submittedAt)) {
    return { kind: "not-submitted" };
  }
  if (changedEntryIds.length > 0) {
    return { kind: "changed", submittedAt, changedEntryIds };
  }

  return {
    kind:
      submitted.length === weekEntries.length
        ? "submitted"
        : "partly-submitted",
    submittedAt,
    entryCount: submitted.length,
    totalMs: submitted.reduce((sum, entry) => sum + entry.durationMs, 0),
  };
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
  /** Entries already submitted plus the selected entries. */
  totalMs: number;
  targetMs: number;
  isUnderTarget: boolean;
  warnings: SubmitWarning[];
}

/**
 * Summarizes the week as it will stand once the selected entries are marked:
 * entries already submitted plus the selection. Counting submitted entries
 * keeps "Mark changes as submitted" from reading as a nearly empty week.
 */
export function summarizeSubmitSelection({
  capacityTargets,
  selectedIds,
  weekDates,
  weekEntries,
}: {
  capacityTargets: WeeklyCapacityTargets;
  selectedIds: ReadonlySet<string>;
  weekDates: string[];
  weekEntries: LocalTimesheetEntry[];
}): SubmitSummary {
  const counted = weekEntries.filter(
    (entry) => entry.submittedAt !== undefined || selectedIds.has(entry._id),
  );
  const days = weekDates.map((localDate, index) => {
    const key = CAPACITY_KEYS[index];
    return {
      localDate,
      targetMs: key ? capacityTargets[key] : 0,
      loggedMs: counted
        .filter((entry) => entry.localDate === localDate)
        .reduce((sum, entry) => sum + entry.durationMs, 0),
    };
  });
  const totalMs = days.reduce((sum, day) => sum + day.loggedMs, 0);
  const targetMs = days.reduce((sum, day) => sum + day.targetMs, 0);
  const missingTaskCount = weekEntries.filter(
    (entry) => selectedIds.has(entry._id) && !entry.taskId,
  ).length;

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

/**
 * Label of the mark button. Reads "Mark changes as submitted" when the
 * selection holds only entries edited since the last submission.
 */
export function getSubmitButtonLabel(
  status: SubmitWeekStatus,
  selectedIds: ReadonlySet<string>,
): string {
  if (
    status.kind === "changed" &&
    selectedIds.size > 0 &&
    [...selectedIds].every((id) => status.changedEntryIds.includes(id))
  ) {
    return "Mark changes as submitted";
  }

  const count = selectedIds.size;
  return `Mark ${count} ${count === 1 ? "entry" : "entries"} as submitted`;
}
