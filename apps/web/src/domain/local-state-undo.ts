import { applyLoggedTimeToWorkItems } from "@/domain/backlog/work-item-estimates";
import { completeSourceWrite } from "@/domain/backlog/backlog-item-lifecycle";
import type {
  LocalAppState,
  LocalTimesheetEntry,
  LocalWorkItem,
} from "@/domain/local-state";

/**
 * The local state lists that undoable actions change. A project's tasks live
 * inside the project record, so archiving a task changes its project.
 */
const UNDO_COLLECTIONS = [
  "projects",
  "timesheetEntries",
  "timers",
  "timesheetImportDrafts",
  "workItems",
  "workflowStates",
  "workflowStateMappings",
  "workflowStateWriteRules",
] as const satisfies readonly (keyof LocalAppState)[];

type UndoCollection = (typeof UNDO_COLLECTIONS)[number];
type UndoRecord<K extends UndoCollection> = LocalAppState[K][number];

/** How each list identifies its records. Status mappings have no `_id`. */
const recordKeys: {
  [K in UndoCollection]: (record: UndoRecord<K>) => string;
} = {
  projects: (project) => project._id,
  timesheetEntries: (entry) => entry._id,
  timers: (timer) => timer._id,
  timesheetImportDrafts: (draft) => draft._id,
  workItems: (workItem) => workItem._id,
  workflowStates: (status) => status._id,
  workflowStateMappings: (mapping) =>
    `${mapping.source}:${mapping.connectionId}:${mapping.sourceProjectName ?? ""}:${mapping.sourceStatusKey}`,
  workflowStateWriteRules: (rule) =>
    `${rule.source}:${rule.connectionId}:${rule.sourceProjectName ?? ""}:${rule.workflowStateId}`,
};

/**
 * One record an action changed. `before` is missing for a record the action
 * created and `after` is missing for one it removed. `index` is the record's
 * position before the action, so Undo puts a removed record back in place.
 */
export interface UndoRecordChange<T> {
  key: string;
  index: number;
  before?: T;
  after?: T;
}

/**
 * What Undo needs after an action: each record the action changed, as the
 * action found it and left it, grouped by local state list. Lists the action
 * did not touch are empty.
 */
export type LocalStateUndo = {
  [K in UndoCollection]: UndoRecordChange<UndoRecord<K>>[];
} & { workItemOrder?: { before: string[]; after: string[] } };

/**
 * `stale` means a record changed again after the action, or restoring would
 * leave two running timers. The state is then left as it is.
 */
export type LocalStateUndoResult = "restored" | "stale";

/** Updates a replacement action's snapshots without hiding independent edits. */
export function completeSourceWriteInUndo(
  undo: LocalStateUndo,
  current: LocalAppState,
  workItemId: string,
  sentItems: readonly LocalWorkItem[],
): LocalStateUndo {
  const acknowledge = (record: LocalWorkItem | undefined) => {
    if (!record) return record;
    return completeSourceWrite(
      {
        ...current,
        workItems: [
          record,
          ...current.workItems.filter((item) => item._id !== record._id),
        ],
      },
      workItemId,
      sentItems,
    ).workItems.find((item) => item._id === record._id);
  };
  return {
    ...undo,
    workItems: undo.workItems.map((change) =>
      change.key === workItemId && change.before?.pendingSourceWrite
        ? {
            ...change,
            before: acknowledge(change.before),
            after: acknowledge(change.after),
          }
        : change,
    ),
  };
}

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

function diffRecords<T>(
  before: T[],
  after: T[],
  keyOf: (record: T) => string,
): UndoRecordChange<T>[] {
  const afterByKey = new Map(after.map((record) => [keyOf(record), record]));
  const beforeKeys = new Set(before.map(keyOf));
  const changes: UndoRecordChange<T>[] = [];

  before.forEach((record, index) => {
    const key = keyOf(record);
    const next = afterByKey.get(key);
    if (!recordsEqual(record, next)) {
      changes.push({ key, index, before: record, after: next });
    }
  });
  for (const record of after) {
    const key = keyOf(record);
    if (!beforeKeys.has(key)) {
      changes.push({ key, index: -1, after: record });
    }
  }

  return changes;
}

function diffCollection<K extends UndoCollection>(
  collection: K,
  before: LocalAppState,
  after: LocalAppState,
): UndoRecordChange<UndoRecord<K>>[] {
  return diffRecords<UndoRecord<K>>(
    before[collection] as UndoRecord<K>[],
    after[collection] as UndoRecord<K>[],
    recordKeys[collection],
  );
}

/**
 * Records what an action changed by comparing the local state before and after
 * it. Returns null when the action changed no record.
 */
export function captureUndo(
  before: LocalAppState,
  after: LocalAppState,
): LocalStateUndo | null {
  const undo: LocalStateUndo = {
    projects: diffCollection("projects", before, after),
    workItems: diffCollection("workItems", before, after),
    timers: diffCollection("timers", before, after),
    timesheetEntries: diffCollection("timesheetEntries", before, after),
    timesheetImportDrafts: diffCollection(
      "timesheetImportDrafts",
      before,
      after,
    ),
    workflowStates: diffCollection("workflowStates", before, after),
    workflowStateMappings: diffCollection(
      "workflowStateMappings",
      before,
      after,
    ),
    workflowStateWriteRules: diffCollection(
      "workflowStateWriteRules",
      before,
      after,
    ),
  };

  const beforeOrder = before.workItems.map((item) => item._id);
  const afterOrder = after.workItems.map((item) => item._id);
  if (
    beforeOrder.length === afterOrder.length &&
    beforeOrder.every((id) => afterOrder.includes(id)) &&
    !recordsEqual(beforeOrder, afterOrder)
  ) {
    undo.workItemOrder = { before: beforeOrder, after: afterOrder };
  }

  return undo.workItemOrder ||
    UNDO_COLLECTIONS.some((collection) => undo[collection].length > 0)
    ? undo
    : null;
}

function isUnchangedSinceAction<K extends UndoCollection>(
  collection: K,
  state: LocalAppState,
  changes: LocalStateUndo[K],
) {
  const keyOf = recordKeys[collection];
  const records = state[collection] as UndoRecord<K>[];
  return changes.every((change) =>
    recordsEqual(
      records.find((record) => keyOf(record) === change.key),
      change.after,
    ),
  );
}

/**
 * Puts each changed record back as it was before the action: updated records in
 * place, created records removed, removed records reinserted at their old index.
 */
function restoreRecords<T>(
  records: T[],
  changes: UndoRecordChange<T>[],
  keyOf: (record: T) => string,
): T[] {
  const beforeByKey = new Map(
    changes.flatMap((change) =>
      change.before && change.after
        ? [[change.key, change.before] as const]
        : [],
    ),
  );
  const createdKeys = new Set(
    changes.filter((change) => !change.before).map((change) => change.key),
  );
  const restored = records
    .filter((record) => !createdKeys.has(keyOf(record)))
    .map((record) => beforeByKey.get(keyOf(record)) ?? record);

  const removed = changes
    .filter((change) => change.before && !change.after)
    .sort((left, right) => left.index - right.index);
  for (const change of removed) {
    restored.splice(Math.min(change.index, restored.length), 0, change.before!);
  }

  return restored;
}

function restoreCollection<K extends UndoCollection>(
  collection: K,
  state: LocalAppState,
  undo: LocalStateUndo,
): LocalAppState[K] {
  return restoreRecords<UndoRecord<K>>(
    state[collection] as UndoRecord<K>[],
    undo[collection],
    recordKeys[collection],
  ) as LocalAppState[K];
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
 * Takes back a time entry action's effect on work item estimates. A work item
 * still as the action left it returns to its exact old values. One edited
 * since, for example by a connector sync, gets the inverse logged time instead,
 * so the later edit is kept. Work items the action did not change stay as they
 * are.
 */
function restoreLoggedTime(
  state: LocalAppState,
  undo: LocalStateUndo,
): LocalWorkItem[] {
  let replayed = state.workItems;
  for (const change of undo.timesheetEntries) {
    if (change.after) {
      replayed = applyLoggedTimeToWorkItems(
        replayed,
        loggedTime(change.after, -1),
      );
    }
    if (change.before) {
      replayed = applyLoggedTimeToWorkItems(
        replayed,
        loggedTime(change.before, 1),
      );
    }
  }

  const changesByKey = new Map(
    undo.workItems.map((change) => [change.key, change]),
  );
  const replayedById = new Map(
    replayed.map((workItem) => [workItem._id, workItem]),
  );
  return state.workItems.map((workItem) => {
    const change = changesByKey.get(workItem._id);
    if (!change?.before) return workItem;
    if (recordsEqual(workItem, change.after)) return change.before;

    return replayedById.get(workItem._id) ?? workItem;
  });
}

/**
 * Undoes one action. Every record it changed returns to its `before` value, and
 * records it created are removed. If any of those records changed again since
 * the action, nothing is restored.
 *
 * Time entry actions are the exception for work items: their work item changes
 * are logged time, so a work item edited since gets the inverse logged time
 * instead of blocking the Undo (see `restoreLoggedTime`).
 */
export function restoreUndo(
  state: LocalAppState,
  undo: LocalStateUndo,
): { state: LocalAppState; result: LocalStateUndoResult } {
  const changedTimeEntries = undo.timesheetEntries.length > 0;
  const strictCollections = UNDO_COLLECTIONS.filter(
    (collection) => !(changedTimeEntries && collection === "workItems"),
  );
  if (
    (undo.workItemOrder &&
      !recordsEqual(
        state.workItems.map((item) => item._id),
        undo.workItemOrder.after,
      )) ||
    !strictCollections.every((collection) =>
      isUnchangedSinceAction(collection, state, undo[collection]),
    )
  ) {
    return { state, result: "stale" };
  }

  const timers = restoreCollection("timers", state, undo);
  if (timers.length > 1) {
    return { state, result: "stale" };
  }

  let workItems = changedTimeEntries
    ? restoreLoggedTime(state, undo)
    : restoreCollection("workItems", state, undo);
  if (undo.workItemOrder) {
    const indexes = new Map(
      undo.workItemOrder.before.map((id, index) => [id, index]),
    );
    workItems = [...workItems].sort(
      (left, right) => indexes.get(left._id)! - indexes.get(right._id)!,
    );
  }
  return {
    state: {
      ...state,
      projects: restoreCollection("projects", state, undo),
      timesheetEntries: restoreCollection("timesheetEntries", state, undo),
      timers,
      timesheetImportDrafts: restoreCollection(
        "timesheetImportDrafts",
        state,
        undo,
      ),
      workItems,
      workflowStates: restoreCollection("workflowStates", state, undo),
      workflowStateMappings: restoreCollection(
        "workflowStateMappings",
        state,
        undo,
      ),
      workflowStateWriteRules: restoreCollection(
        "workflowStateWriteRules",
        state,
        undo,
      ),
    },
    result: "restored",
  };
}
