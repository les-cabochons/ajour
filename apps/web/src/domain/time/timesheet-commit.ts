import {
  getLocalProjectDisplayName,
  type LocalProject,
  type LocalTimesheetEntry,
  type LocalTimesheetEntryCommit,
  type LocalTimesheetTombstone,
} from "@/domain/local-state";

/**
 * Committed copies: what changed in a week since its last commit. An entry
 * with no committed copy is added, one whose copy differs or is stale is
 * updated, and a tombstone is a deleted entry. Agents and the Commit page read the same
 * list. See docs/specs/2026-10-15-commit-week-design.md.
 */

/** The values a commit compares. Other fields, such as the order, never make a change. */
export type TimesheetCommitValues = Pick<
  LocalTimesheetEntryCommit,
  "localDate" | "projectId" | "taskId" | "note" | "durationMs"
>;

export type TimesheetCommitField = keyof TimesheetCommitValues;

export const TIMESHEET_COMMIT_FIELDS = [
  "localDate",
  "projectId",
  "taskId",
  "note",
  "durationMs",
] as const satisfies readonly TimesheetCommitField[];

export type TimesheetChange =
  | { kind: "added"; entryId: string; current: TimesheetCommitValues }
  | {
      kind: "updated";
      entryId: string;
      current: TimesheetCommitValues;
      committed: LocalTimesheetEntryCommit;
      /**
       * The fields that differ, in `TIMESHEET_COMMIT_FIELDS` order. Empty when
       * only the copy is stale: the external entry may differ in any field.
       */
      changedFields: TimesheetCommitField[];
    }
  | { kind: "deleted"; entryId: string; committed: LocalTimesheetEntryCommit };

export type TimesheetChangeKind = TimesheetChange["kind"];

/** The compared values of an entry or a copy, without anything else. */
export function toCommitValues(
  values: TimesheetCommitValues,
): TimesheetCommitValues {
  return {
    localDate: values.localDate,
    projectId: values.projectId,
    taskId: values.taskId,
    note: values.note,
    durationMs: values.durationMs,
  };
}

/** The copy a commit saves: the entry's values as they are now. */
export function toCommittedCopy(
  entry: LocalTimesheetEntry,
  at: number,
): LocalTimesheetEntryCommit {
  return { at, ...toCommitValues(entry) };
}

/** The fields where two sets of values differ. Notes compare trimmed. */
export function getChangedCommitFields(
  committed: TimesheetCommitValues,
  current: TimesheetCommitValues,
): TimesheetCommitField[] {
  return TIMESHEET_COMMIT_FIELDS.filter((field) =>
    field === "note"
      ? (committed.note ?? "").trim() !== (current.note ?? "").trim()
      : committed[field] !== current[field],
  );
}

/**
 * The entry's change since its last commit, or undefined when its copy matches
 * and is not stale.
 */
export function getTimesheetEntryChange(
  entry: LocalTimesheetEntry,
): TimesheetChange | undefined {
  const current = toCommitValues(entry);
  if (!entry.commit) {
    return { kind: "added", entryId: entry._id, current };
  }

  const changedFields = getChangedCommitFields(entry.commit, current);
  return changedFields.length === 0 && !entry.commit.stale
    ? undefined
    : {
        kind: "updated",
        entryId: entry._id,
        current,
        committed: entry.commit,
        changedFields,
      };
}

/** True when the external timesheet holds the entry as it is now. */
export function isTimesheetEntryCommitted(entry: LocalTimesheetEntry) {
  return (
    entry.commit !== undefined && getTimesheetEntryChange(entry) === undefined
  );
}

const KIND_ORDER: Record<TimesheetChangeKind, number> = {
  added: 0,
  updated: 1,
  deleted: 2,
};

/**
 * The week's changes, by day in week order, then added, updated and deleted,
 * then in list order. An entry moved to another week shows in both weeks as
 * one updated change, so committing it from either week moves its external
 * entry instead of deleting and adding it. A deleted entry shows in the week
 * of its committed day.
 */
export function listWeekChanges({
  entries,
  tombstones,
  weekDates,
}: {
  entries: readonly LocalTimesheetEntry[];
  tombstones: readonly LocalTimesheetTombstone[];
  weekDates: readonly string[];
}): TimesheetChange[] {
  const week = new Set(weekDates);
  const changes: { day: string; change: TimesheetChange }[] = [];

  for (const entry of entries) {
    const change = getTimesheetEntryChange(entry);
    if (!change) continue;
    const day = week.has(entry.localDate)
      ? entry.localDate
      : change.kind === "updated" && week.has(change.committed.localDate)
        ? change.committed.localDate
        : undefined;
    if (day) changes.push({ day, change });
  }
  for (const tombstone of tombstones) {
    if (!week.has(tombstone.commit.localDate)) continue;
    changes.push({
      day: tombstone.commit.localDate,
      change: {
        kind: "deleted",
        entryId: tombstone.entryId,
        committed: tombstone.commit,
      },
    });
  }

  // Array.prototype.sort is stable, so equal items keep their list order.
  return changes
    .sort(
      (left, right) =>
        left.day.localeCompare(right.day) ||
        KIND_ORDER[left.change.kind] - KIND_ORDER[right.change.kind],
    )
    .map((item) => item.change);
}

/** The names an external timesheet matches an entry by. */
export interface TimesheetCommitNames {
  /** The project's display name. */
  projectName?: string;
  projectFullName?: string;
  projectCode?: string;
  taskName?: string;
}

/**
 * Names the project and task of an entry or a copy. Pass every project,
 * archived ones too, so a deleted entry on an archived project still reads.
 * A project or task Ajour cannot find leaves its names out.
 */
export function describeTimesheetCommitValues(
  projects: readonly LocalProject[],
  values: Pick<TimesheetCommitValues, "projectId" | "taskId">,
): TimesheetCommitNames {
  const project = projects.find((item) => item._id === values.projectId);
  const task = project?.tasks.find((item) => item._id === values.taskId);
  const projectCode = project?.code?.trim();
  return {
    ...(project
      ? {
          projectName: getLocalProjectDisplayName(project),
          projectFullName: project.name,
        }
      : {}),
    ...(projectCode ? { projectCode } : {}),
    ...(task ? { taskName: task.name } : {}),
  };
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function optionalString(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

/** Reads a stored committed copy. Anything malformed reads as no copy. */
export function normalizeTimesheetEntryCommit(
  value: unknown,
): LocalTimesheetEntryCommit | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as Record<string, unknown>;
  if (
    !isFiniteNumber(record.at) ||
    typeof record.localDate !== "string" ||
    !isFiniteNumber(record.durationMs)
  ) {
    return undefined;
  }
  return {
    at: record.at,
    localDate: record.localDate,
    projectId: optionalString(record.projectId),
    taskId: optionalString(record.taskId),
    note: optionalString(record.note),
    durationMs: record.durationMs,
    ...(record.stale === true ? { stale: true as const } : {}),
  };
}

/** Reads stored tombstones. Drops malformed ones and repeats of an entry. */
export function normalizeTimesheetTombstones(
  value: unknown,
): LocalTimesheetTombstone[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.flatMap((item: unknown) => {
    if (typeof item !== "object" || item === null) return [];
    const record = item as Record<string, unknown>;
    const commit = normalizeTimesheetEntryCommit(record.commit);
    if (
      typeof record.entryId !== "string" ||
      !commit ||
      seen.has(record.entryId)
    ) {
      return [];
    }
    seen.add(record.entryId);
    return [{ entryId: record.entryId, commit }];
  });
}
