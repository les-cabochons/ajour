import { applyLoggedTimeToWorkItems } from "@/domain/backlog/work-item-estimates";
import type {
  LocalAppState,
  LocalTimer,
  LocalTimesheetEntry,
} from "@/domain/local-state";

/**
 * One record an action changed. `before` is missing for a record the action
 * created and `after` is missing for one it removed. `index` is the record's
 * position before the action, so Undo puts a removed record back in place.
 */
export interface UndoRecordChange<T> {
  id: string;
  index: number;
  before?: T;
  after?: T;
}

/**
 * What Undo needs after a time entry action (Delete, Discard, Move to…,
 * Duplicate to…): the time entries and timers as the action found and left them.
 * Work item estimates are not stored. Undo replays the logged time instead, so
 * estimate changes made in between are kept.
 */
export interface TimeEntryUndo {
  entries: UndoRecordChange<LocalTimesheetEntry>[];
  timers: UndoRecordChange<LocalTimer>[];
}

/**
 * `stale` means a record changed again after the action, or restoring would
 * leave two running timers. The state is then left as it is.
 */
export type TimeEntryUndoResult = "restored" | "stale";

/**
 * Compares two records field by field. A missing field equals `undefined`, so a
 * record read back from storage matches the one the action wrote.
 */
function recordsEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (
    typeof left !== "object" ||
    typeof right !== "object" ||
    left === null ||
    right === null
  ) {
    return false;
  }
  if (Array.isArray(left) !== Array.isArray(right)) return false;

  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const keys = new Set([
    ...Object.keys(leftRecord),
    ...Object.keys(rightRecord),
  ]);
  for (const key of keys) {
    if (!recordsEqual(leftRecord[key], rightRecord[key])) return false;
  }
  return true;
}

function diffRecords<T extends { _id: string }>(
  before: T[],
  after: T[],
): UndoRecordChange<T>[] {
  const afterById = new Map(after.map((record) => [record._id, record]));
  const beforeIds = new Set(before.map((record) => record._id));
  const changes: UndoRecordChange<T>[] = [];

  before.forEach((record, index) => {
    const next = afterById.get(record._id);
    if (!recordsEqual(record, next)) {
      changes.push({ id: record._id, index, before: record, after: next });
    }
  });
  for (const record of after) {
    if (!beforeIds.has(record._id)) {
      changes.push({ id: record._id, index: -1, after: record });
    }
  }

  return changes;
}

/**
 * Records what a time entry action changed by comparing the state before and
 * after it. Returns null when the action changed no time entry or timer.
 */
export function captureTimeEntryUndo(
  before: LocalAppState,
  after: LocalAppState,
): TimeEntryUndo | null {
  const entries = diffRecords(before.timesheetEntries, after.timesheetEntries);
  const timers = diffRecords(before.timers, after.timers);

  return entries.length > 0 || timers.length > 0 ? { entries, timers } : null;
}

function isUnchangedSinceAction<T extends { _id: string }>(
  records: T[],
  changes: UndoRecordChange<T>[],
) {
  return changes.every((change) =>
    recordsEqual(
      records.find((record) => record._id === change.id),
      change.after,
    ),
  );
}

/**
 * Puts each changed record back as it was before the action: updated records in
 * place, created records removed, removed records reinserted at their old index.
 */
function restoreRecords<T extends { _id: string }>(
  records: T[],
  changes: UndoRecordChange<T>[],
): T[] {
  const beforeById = new Map(
    changes.flatMap((change) =>
      change.before && change.after
        ? [[change.id, change.before] as const]
        : [],
    ),
  );
  const createdIds = new Set(
    changes.filter((change) => !change.before).map((change) => change.id),
  );
  const restored = records
    .filter((record) => !createdIds.has(record._id))
    .map((record) => beforeById.get(record._id) ?? record);

  const removed = changes
    .filter((change) => change.before && !change.after)
    .sort((left, right) => left.index - right.index);
  for (const change of removed) {
    restored.splice(Math.min(change.index, restored.length), 0, change.before!);
  }

  return restored;
}

function loggedTime(entry: LocalTimesheetEntry, sign: 1 | -1) {
  return {
    workItemId: entry.workItemId,
    projectId: entry.projectId,
    taskId: entry.taskId,
    durationMsDelta: sign * entry.durationMs,
  };
}

/**
 * Undoes one time entry action. Time entries and timers return to their
 * recorded `before` values, and work item estimates take back the logged time
 * the action added or removed.
 */
export function restoreTimeEntryUndo(
  state: LocalAppState,
  undo: TimeEntryUndo,
): { state: LocalAppState; result: TimeEntryUndoResult } {
  if (
    !isUnchangedSinceAction(state.timesheetEntries, undo.entries) ||
    !isUnchangedSinceAction(state.timers, undo.timers)
  ) {
    return { state, result: "stale" };
  }

  const timers = restoreRecords(state.timers, undo.timers);
  if (timers.length > 1) {
    return { state, result: "stale" };
  }

  let workItems = state.workItems;
  for (const change of undo.entries) {
    if (change.after) {
      workItems = applyLoggedTimeToWorkItems(
        workItems,
        loggedTime(change.after, -1),
      );
    }
    if (change.before) {
      workItems = applyLoggedTimeToWorkItems(
        workItems,
        loggedTime(change.before, 1),
      );
    }
  }

  return {
    state: {
      ...state,
      timesheetEntries: restoreRecords(state.timesheetEntries, undo.entries),
      timers,
      workItems,
    },
    result: "restored",
  };
}
