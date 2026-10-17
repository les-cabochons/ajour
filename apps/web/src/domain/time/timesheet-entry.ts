import type {
  LocalAppState,
  LocalProject,
  LocalTimesheetEntry,
} from "@/domain/local-state";
import {
  getChangedCommitFields,
  getTimesheetEntryChange,
  isTimesheetEntryCommitted,
  normalizeTimesheetEntryCommit,
  toCommittedCopy,
} from "@/domain/time/timesheet-commit";
import { applyLoggedTimeToWorkItems } from "@/domain/backlog/work-item-estimates";

export interface TimesheetEntryFactories {
  createId: (prefix: string) => string;
  now: () => number;
}

export interface CreateTimesheetEntryValues {
  localDate: string;
  workItemId?: string;
  projectId?: string;
  taskId?: string;
  note?: string;
  durationMs: number;
  sourceBlockIds: string[];
  entryId?: string;
}

export interface UpdateTimesheetEntryValues {
  projectId?: string;
  taskId?: string;
  note?: string;
  durationMs: number;
}

export interface RelocateTimesheetEntryValues extends UpdateTimesheetEntryValues {
  localDate: string;
}

function hasOwn<T extends object>(value: T, key: PropertyKey) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function resolveTaskLabel(
  projects: LocalProject[],
  projectId?: string,
  taskId?: string,
) {
  const project = projects.find((item) => item._id === projectId);
  const task = project?.tasks.find((item) => item._id === taskId);

  return task?.name ?? "";
}

/** A stored entry, which may still carry the submission fields Ajour used before committed copies. */
export type PersistedTimesheetEntry = Omit<LocalTimesheetEntry, "commit"> & {
  commit?: unknown;
  submittedAt?: unknown;
  submittedFingerprint?: unknown;
  previousSubmittedAt?: unknown;
};

/**
 * Reads a stored entry. An entry stored as submitted gets a committed copy of
 * its current values: an edit used to clear `submittedAt`, so they are the
 * submitted values. One submitted only before an edit (`previousSubmittedAt`)
 * gets none and shows as added; its external entry has an old ID that Reset
 * sync matches later.
 */
export function normalizeTimesheetEntry(
  stored: PersistedTimesheetEntry,
): LocalTimesheetEntry {
  const {
    commit: storedCommit,
    submittedAt,
    submittedFingerprint: _submittedFingerprint,
    previousSubmittedAt: _previousSubmittedAt,
    ...entry
  } = stored;
  const normalized: LocalTimesheetEntry = {
    ...entry,
    sourceBlockIds: Array.isArray(entry.sourceBlockIds)
      ? entry.sourceBlockIds
      : [],
  };
  const commit =
    normalizeTimesheetEntryCommit(storedCommit) ??
    (typeof submittedAt === "number" && Number.isFinite(submittedAt)
      ? toCommittedCopy(normalized, submittedAt)
      : undefined);

  return commit ? { ...normalized, commit } : normalized;
}

export function createTimesheetEntry(
  projects: LocalProject[],
  values: CreateTimesheetEntryValues,
  factories: TimesheetEntryFactories,
): LocalTimesheetEntry {
  return {
    _id: values.entryId ?? factories.createId("timesheet"),
    localDate: values.localDate,
    workItemId: values.workItemId,
    projectId: values.projectId,
    taskId: values.taskId,
    label: resolveTaskLabel(projects, values.projectId, values.taskId),
    note: values.note,
    durationMs: values.durationMs,
    sourceBlockIds: values.sourceBlockIds,
    committedAt: factories.now(),
  };
}

export function saveManualTimesheetEntry(
  state: LocalAppState,
  values: Omit<CreateTimesheetEntryValues, "sourceBlockIds" | "entryId">,
  factories: TimesheetEntryFactories,
): LocalAppState {
  return {
    ...state,
    timesheetEntries: [
      ...state.timesheetEntries,
      createTimesheetEntry(
        state.projects,
        {
          ...values,
          sourceBlockIds: [],
        },
        factories,
      ),
    ],
    workItems: applyLoggedTimeToWorkItems(state.workItems, {
      workItemId: values.workItemId,
      projectId: values.projectId,
      taskId: values.taskId,
      durationMsDelta: values.durationMs,
    }),
  };
}

export function updateTimesheetEntry(
  state: LocalAppState,
  entryId: string,
  values: UpdateTimesheetEntryValues,
  factories: TimesheetEntryFactories,
): LocalAppState {
  const entry = state.timesheetEntries.find((item) => item._id === entryId);
  if (!entry) {
    return state;
  }

  const nextEntry = createTimesheetEntry(
    state.projects,
    {
      localDate: entry.localDate,
      workItemId: entry.workItemId,
      projectId: hasOwn(values, "projectId")
        ? values.projectId
        : entry.projectId,
      taskId: hasOwn(values, "taskId") ? values.taskId : entry.taskId,
      note: hasOwn(values, "note") ? values.note : entry.note,
      durationMs: values.durationMs,
      sourceBlockIds: entry.sourceBlockIds,
      entryId: entry._id,
    },
    factories,
  );
  nextEntry.committedAt = entry.committedAt;
  const persistedEntry = keepTimesheetEntryCommit(
    entry,
    nextEntry.taskId
      ? nextEntry
      : {
          ...nextEntry,
          label: entry.taskId ? "" : entry.label,
        },
  );
  const revertedWorkItems = applyLoggedTimeToWorkItems(state.workItems, {
    workItemId: entry.workItemId,
    projectId: entry.projectId,
    taskId: entry.taskId,
    durationMsDelta: -entry.durationMs,
  });
  const timers = state.timers.map((timer) =>
    timer.entryId === entryId
      ? {
          ...timer,
          projectId: persistedEntry.projectId,
          taskId: persistedEntry.taskId,
          note: persistedEntry.note,
          accumulatedDurationMs: persistedEntry.durationMs,
          startedAt: factories.now(),
        }
      : timer,
  );

  return {
    ...state,
    timesheetEntries: state.timesheetEntries.map((item) =>
      item._id === entryId ? persistedEntry : item,
    ),
    timers,
    workItems: applyLoggedTimeToWorkItems(revertedWorkItems, {
      workItemId: entry.workItemId,
      projectId: persistedEntry.projectId,
      taskId: persistedEntry.taskId,
      durationMsDelta: values.durationMs,
    }),
  };
}

export function deleteTimesheetEntry(
  state: LocalAppState,
  entryId: string,
): LocalAppState {
  const entry = state.timesheetEntries.find((item) => item._id === entryId);
  if (!entry || state.timers.some((timer) => timer.entryId === entryId)) {
    return state;
  }

  return {
    ...state,
    timesheetEntries: state.timesheetEntries.filter(
      (item) => item._id !== entryId,
    ),
    // A committed entry leaves a tombstone, so its deletion can be committed.
    timesheetTombstones: entry.commit
      ? [
          ...state.timesheetTombstones,
          { entryId: entry._id, commit: entry.commit },
        ]
      : state.timesheetTombstones,
    workItems: applyLoggedTimeToWorkItems(state.workItems, {
      workItemId: entry.workItemId,
      projectId: entry.projectId,
      taskId: entry.taskId,
      durationMsDelta: -entry.durationMs,
    }),
  };
}

/**
 * Deletes several entries in one change, such as a Week Grid row. An entry linked
 * to a running timer stays, as in `deleteTimesheetEntry`.
 */
export function deleteTimesheetEntries(
  state: LocalAppState,
  entryIds: readonly string[],
): LocalAppState {
  return entryIds.reduce(deleteTimesheetEntry, state);
}

export function duplicateTimesheetEntry(
  state: LocalAppState,
  entryId: string,
  values: RelocateTimesheetEntryValues,
  factories: TimesheetEntryFactories,
): LocalAppState {
  const entry = state.timesheetEntries.find((item) => item._id === entryId);
  if (!entry || state.timers.some((timer) => timer.entryId === entryId)) {
    return state;
  }

  const createdDuplicate = createTimesheetEntry(
    state.projects,
    {
      localDate: values.localDate,
      workItemId: entry.workItemId,
      projectId: values.projectId,
      taskId: values.taskId,
      note: values.note,
      durationMs: values.durationMs,
      sourceBlockIds: [],
    },
    factories,
  );
  const duplicate = createdDuplicate.taskId
    ? createdDuplicate
    : {
        ...createdDuplicate,
        label: entry.taskId ? "" : entry.label,
      };

  return {
    ...state,
    timesheetEntries: [...state.timesheetEntries, duplicate],
    workItems: applyLoggedTimeToWorkItems(state.workItems, {
      workItemId: duplicate.workItemId,
      projectId: duplicate.projectId,
      taskId: duplicate.taskId,
      durationMsDelta: duplicate.durationMs,
    }),
  };
}

export function moveTimesheetEntry(
  state: LocalAppState,
  entryId: string,
  values: RelocateTimesheetEntryValues,
  factories: TimesheetEntryFactories,
): LocalAppState {
  const entry = state.timesheetEntries.find((item) => item._id === entryId);
  if (!entry || state.timers.some((timer) => timer.entryId === entryId)) {
    return state;
  }

  const updated = updateTimesheetEntry(state, entryId, values, factories);
  const updatedEntry = updated.timesheetEntries.find(
    (item) => item._id === entryId,
  );
  if (!updatedEntry) {
    return state;
  }

  const movedEntry = {
    ...updatedEntry,
    localDate: values.localDate,
    committedAt: factories.now(),
  };
  // Moving an entry to its own day without other changes keeps its place.
  if (
    movedEntry.localDate === entry.localDate &&
    getChangedCommitFields(entry, movedEntry).length === 0
  ) {
    return updated;
  }

  return {
    ...updated,
    timesheetEntries: updated.timesheetEntries.map((item) =>
      item._id === entryId ? movedEntry : item,
    ),
  };
}

/** One entry of a paste: the copied or cut entry and the day it lands on. */
export interface PastedTimesheetEntry {
  entryId: string;
  localDate: string;
}

/**
 * Pastes copied or cut entries in one change. `copy` duplicates each entry with its
 * saved values, as Duplicate to… does; `cut` moves it, as Move to… does. Entries
 * linked to a running timer, or gone since the copy, are skipped.
 *
 * Pasted entries get the newest committed times, one millisecond apart, so the Day
 * list and Week cards show them at the end of their day in the order of `entries`.
 */
export function pasteTimesheetEntries(
  state: LocalAppState,
  entries: readonly PastedTimesheetEntry[],
  mode: "copy" | "cut",
  factories: TimesheetEntryFactories,
): LocalAppState {
  return relocateTimesheetEntries(state, entries, mode, factories).state;
}

/**
 * `pasteTimesheetEntries`, which also reports the entries that landed, in the
 * order of `entries`: the copies for `copy`, the moved entries for `cut`.
 * Skipped entries are left out. Duplicate, Duplicate to…, Move to… and a paste
 * of a selection use it, so the entries that landed become the selection.
 *
 * Every entry lands at the end of its day in the order of `entries`, a cut
 * entry already on that day too, so a selection moved to a day it partly sits
 * on still ends up together, in reading order.
 */
export function relocateTimesheetEntries(
  state: LocalAppState,
  entries: readonly PastedTimesheetEntry[],
  mode: "copy" | "cut",
  factories: TimesheetEntryFactories,
): { state: LocalAppState; entryIds: string[] } {
  const pastedAt = factories.now();
  const entryIds: string[] = [];

  const next = entries.reduce((current, { entryId, localDate }, index) => {
    const entry = current.timesheetEntries.find((item) => item._id === entryId);
    if (!entry || current.timers.some((timer) => timer.entryId === entryId)) {
      return current;
    }

    const values = {
      localDate,
      projectId: entry.projectId,
      taskId: entry.taskId,
      note: entry.note,
      durationMs: entry.durationMs,
    };
    // Lists show older entries first, so the first entry gets the earliest time.
    const stamped = { ...factories, now: () => pastedAt + index };
    if (mode === "cut") {
      entryIds.push(entryId);
      const moved = moveTimesheetEntry(current, entryId, values, stamped);
      if (entry.localDate !== localDate) return moved;
      // Moving to its own day keeps an entry's place; here it joins the others
      // at the end. The order is not part of the committed copy.
      return {
        ...moved,
        timesheetEntries: moved.timesheetEntries.map((item) =>
          item._id === entryId ? { ...item, committedAt: stamped.now() } : item,
        ),
      };
    }

    const copied = duplicateTimesheetEntry(current, entryId, values, stamped);
    // A copy is appended to the entries.
    const copy = copied.timesheetEntries.at(-1);
    if (copied !== current && copy) entryIds.push(copy._id);
    return copied;
  }, state);

  return { state: next, entryIds };
}

/**
 * Drops entries as one block on `localDate`, as a drag of a selection does:
 * entries from other days move there, then the block takes its place in front
 * of the day's entry at `targetIndex` among the entries that stay, in the order
 * of `entryIds`. An index past the last entry puts the block at the end.
 * `movedIds` lists the entries that changed day. Entries linked to a running
 * timer keep their day, as Move to… does; on their own day they still take
 * their place in the block.
 *
 * The new order lives in the day's `committedAt` values alone, made distinct,
 * and no record changes place in `timesheetEntries`. Undo restores records
 * where they are, so a day whose entries shared a time, and were ordered by
 * their place, reads as before after an Undo.
 */
export function dropTimesheetEntries(
  state: LocalAppState,
  {
    entryIds,
    localDate,
    targetIndex,
  }: { entryIds: readonly string[]; localDate: string; targetIndex: number },
  factories: TimesheetEntryFactories,
): { state: LocalAppState; movedIds: string[] } {
  const fromOtherDays = entryIds.flatMap((entryId) => {
    const entry = state.timesheetEntries.find((item) => item._id === entryId);
    return entry && entry.localDate !== localDate
      ? [{ entryId, localDate }]
      : [];
  });
  const moved = relocateTimesheetEntries(
    state,
    fromOtherDays,
    "cut",
    factories,
  );

  const dayIds = selectSortableDayEntryIds(
    moved.state.timesheetEntries,
    localDate,
  );
  const onDay = new Set(dayIds);
  const block = entryIds.filter((entryId) => onDay.has(entryId));
  const inBlock = new Set(block);
  const staying = dayIds.filter((entryId) => !inBlock.has(entryId));
  const index = Math.max(0, Math.min(targetIndex, staying.length));
  const order = [...staying.slice(0, index), ...block, ...staying.slice(index)];

  return {
    state: orderDayByCommittedAt(moved.state, order),
    movedIds: moved.entryIds,
  };
}

/**
 * Gives the entries of `order`, one day's entries, the day's `committedAt`
 * values in that order, nudged up by a millisecond where two would be equal,
 * without moving any record in `timesheetEntries`. Returns `state` itself when
 * nothing changes.
 */
function orderDayByCommittedAt(
  state: LocalAppState,
  order: readonly string[],
): LocalAppState {
  const inOrder = new Set(order);
  const slots = state.timesheetEntries
    .filter((entry) => inOrder.has(entry._id))
    .map((entry) => entry.committedAt)
    .sort((left, right) => left - right);
  for (let index = 1; index < slots.length; index += 1) {
    if (slots[index]! <= slots[index - 1]!) {
      slots[index] = slots[index - 1]! + 1;
    }
  }

  const committedAtById = new Map(
    order.map((entryId, index) => [entryId, slots[index]!]),
  );
  let changed = false;
  const timesheetEntries = state.timesheetEntries.map((entry) => {
    const committedAt = committedAtById.get(entry._id);
    if (committedAt === undefined || committedAt === entry.committedAt) {
      return entry;
    }

    changed = true;
    return { ...entry, committedAt };
  });

  return changed ? { ...state, timesheetEntries } : state;
}

/**
 * Carries the committed copy across a rebuild of the entry, such as an edit
 * or a running entry saved again. Edits never change the copy: the change
 * shows on the Commit page until it is committed.
 */
export function keepTimesheetEntryCommit(
  existing: LocalTimesheetEntry | undefined,
  next: LocalTimesheetEntry,
): LocalTimesheetEntry {
  return existing?.commit ? { ...next, commit: existing.commit } : next;
}

/**
 * Commits the changes of `entryIds`: an added or updated entry gets a copy of
 * its current values, and a deleted entry's tombstone goes. Ids without a
 * change are left alone, so a partial commit leaves every other change as it
 * is. Returns the same state when nothing changed.
 */
export function markTimesheetEntriesCommitted(
  state: LocalAppState,
  entryIds: readonly string[],
  now: () => number,
): LocalAppState {
  const selectedIds = new Set(entryIds);
  const at = now();
  let changed = false;
  const timesheetEntries = state.timesheetEntries.map((entry) => {
    if (!selectedIds.has(entry._id) || !getTimesheetEntryChange(entry)) {
      return entry;
    }

    changed = true;
    return { ...entry, commit: toCommittedCopy(entry, at) };
  });
  const timesheetTombstones = state.timesheetTombstones.filter(
    (tombstone) => !selectedIds.has(tombstone.entryId),
  );
  if (
    !changed &&
    timesheetTombstones.length === state.timesheetTombstones.length
  ) {
    return state;
  }

  return { ...state, timesheetEntries, timesheetTombstones };
}

/**
 * Marks the committed copy of a committed entry as stale, so the Commit page
 * lists the entry as updated again. For when the external timesheet changed
 * since the commit. The copy stays, so a later move or delete still finds the
 * external entry on the committed day, and a delete still leaves a tombstone.
 * The next commit saves a fresh copy without the flag. An entry with a change
 * to commit is already on the Commit page and is left alone. Returns the same
 * state when nothing changed.
 */
export function markTimesheetEntryNotCommitted(
  state: LocalAppState,
  entryId: string,
): LocalAppState {
  const entry = state.timesheetEntries.find((item) => item._id === entryId);
  if (!entry?.commit || !isTimesheetEntryCommitted(entry)) return state;

  const stale = { ...entry, commit: { ...entry.commit, stale: true as const } };
  return {
    ...state,
    timesheetEntries: state.timesheetEntries.map((item) =>
      item === entry ? stale : item,
    ),
  };
}

/**
 * Marks several entries as not committed in one change, such as a selection.
 * Entries without a committed copy, or with a change to commit, are left alone,
 * as in `markTimesheetEntryNotCommitted`.
 */
export function markTimesheetEntriesNotCommitted(
  state: LocalAppState,
  entryIds: readonly string[],
): LocalAppState {
  return entryIds.reduce(markTimesheetEntryNotCommitted, state);
}

/**
 * The ids of a day's saved entries in the order the Day list and the Week's
 * Days cards show them, top first: the lowest `committedAt` first, so a day
 * reads in the order the work happened and a new entry lands at the end.
 * The entry the running entry resumed keeps its place and sorts like the
 * others. Move up and Move down step through this order.
 */
export function selectSortableDayEntryIds(
  entries: readonly LocalTimesheetEntry[],
  localDate: string,
): string[] {
  return entries
    .filter((entry) => entry.localDate === localDate)
    .sort((left, right) => left.committedAt - right.committedAt)
    .map((entry) => entry._id);
}

/**
 * Places the running entry's row among a list of entries, top first. A running
 * entry that resumed a listed entry takes that entry's place, so continuing an
 * entry never moves it. A running entry with no listed entry, such as a new
 * one, comes last.
 */
export function placeRunningRow<Entry extends { _id: string }, Running>(
  entries: readonly Entry[],
  running: { row: Running; resumedEntryId?: string } | null,
): (Entry | Running)[] {
  if (!running) {
    return [...entries];
  }

  const slot = entries.findIndex(
    (entry) => entry._id === running.resumedEntryId,
  );
  return slot === -1
    ? [...entries, running.row]
    : entries.map((entry, index) => (index === slot ? running.row : entry));
}

export function reorderTimesheetEntries(
  state: LocalAppState,
  localDate: string,
  orderedIds: string[],
): LocalAppState {
  if (orderedIds.length < 2) {
    return state;
  }

  const orderedIdSet = new Set(orderedIds);
  const selectedEntries = state.timesheetEntries
    .filter(
      (entry) => entry.localDate === localDate && orderedIdSet.has(entry._id),
    )
    .sort(
      (left, right) =>
        left.committedAt - right.committedAt ||
        state.timesheetEntries.indexOf(left) -
          state.timesheetEntries.indexOf(right),
    );

  if (selectedEntries.length !== orderedIds.length) {
    return state;
  }

  const committedAtSlots = selectedEntries.map((entry) => entry.committedAt);
  const nextCommittedAtById = new Map(
    orderedIds.map((entryId, index) => [entryId, committedAtSlots[index]!]),
  );
  const currentIds = selectedEntries.map((entry) => entry._id);
  const orderChanged = currentIds.some(
    (entryId, index) => entryId !== orderedIds[index],
  );
  let timestampsChanged = false;
  const updatedEntries = state.timesheetEntries.map((entry) => {
    const committedAt = nextCommittedAtById.get(entry._id);
    if (committedAt === undefined || entry.committedAt === committedAt) {
      return entry;
    }

    timestampsChanged = true;
    return { ...entry, committedAt };
  });
  if (!timestampsChanged && !orderChanged) {
    return state;
  }

  let orderedCursor = 0;
  const updatedById = new Map(
    updatedEntries.map((entry) => [entry._id, entry] as const),
  );
  const timesheetEntries = updatedEntries.map((entry) =>
    entry.localDate === localDate && orderedIdSet.has(entry._id)
      ? updatedById.get(orderedIds[orderedCursor++]!)!
      : entry,
  );

  return { ...state, timesheetEntries };
}

/**
 * The entry C continues when no entry has focus: the last entry of the latest
 * day up to `today`. Within a day the last entry has the highest `committedAt`,
 * the bottom row of the Day view. `excludeEntryId` skips the entry that is
 * already running.
 */
export function selectMostRecentTimesheetEntry(
  entries: readonly LocalTimesheetEntry[],
  today: string,
  excludeEntryId?: string,
): LocalTimesheetEntry | undefined {
  let mostRecent: LocalTimesheetEntry | undefined;
  for (const entry of entries) {
    if (entry.localDate > today || entry._id === excludeEntryId) {
      continue;
    }

    if (
      !mostRecent ||
      entry.localDate > mostRecent.localDate ||
      // On a tie the later stored entry wins: the Day view's stable sort
      // shows it last.
      (entry.localDate === mostRecent.localDate &&
        entry.committedAt >= mostRecent.committedAt)
    ) {
      mostRecent = entry;
    }
  }

  return mostRecent;
}
