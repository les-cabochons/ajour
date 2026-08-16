import type {
  LocalAppState,
  LocalProject,
  LocalTimesheetEntry,
} from "@/domain/local-state";
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

export function createTimesheetEntrySubmissionFingerprint(
  entry: Pick<
    LocalTimesheetEntry,
    | "localDate"
    | "workItemId"
    | "projectId"
    | "taskId"
    | "note"
    | "durationMs"
    | "sourceBlockIds"
  >,
) {
  return JSON.stringify([
    entry.localDate,
    entry.workItemId ?? "",
    entry.projectId ?? "",
    entry.taskId ?? "",
    entry.note?.trim() ?? "",
    entry.durationMs,
    [...(entry.sourceBlockIds ?? [])].sort(),
  ]);
}

export function normalizeTimesheetEntry(
  entry: LocalTimesheetEntry,
): LocalTimesheetEntry {
  const submittedAt =
    typeof entry.submittedAt === "number" && Number.isFinite(entry.submittedAt)
      ? entry.submittedAt
      : undefined;
  const normalizedEntry = {
    ...entry,
    taskId: entry.taskId,
    note: entry.note,
    sourceBlockIds: Array.isArray(entry.sourceBlockIds)
      ? entry.sourceBlockIds
      : [],
    submittedAt,
  };

  return {
    ...normalizedEntry,
    submittedFingerprint: submittedAt !== undefined
      ? (normalizedEntry.submittedFingerprint ??
        createTimesheetEntrySubmissionFingerprint(normalizedEntry))
      : undefined,
  };
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
    submittedAt: undefined,
    submittedFingerprint: undefined,
  };
}

export function preserveTimesheetEntrySubmissionState(
  existingEntry: LocalTimesheetEntry | undefined,
  nextEntry: LocalTimesheetEntry,
): LocalTimesheetEntry {
  if (existingEntry?.submittedAt === undefined) {
    return nextEntry;
  }

  const previousFingerprint =
    existingEntry.submittedFingerprint ??
    createTimesheetEntrySubmissionFingerprint(existingEntry);
  const nextFingerprint = createTimesheetEntrySubmissionFingerprint(nextEntry);

  if (previousFingerprint !== nextFingerprint) {
    return {
      ...nextEntry,
      submittedAt: undefined,
      submittedFingerprint: undefined,
    };
  }

  return {
    ...nextEntry,
    submittedAt: existingEntry.submittedAt,
    submittedFingerprint: previousFingerprint,
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
  const persistedEntry = preserveTimesheetEntrySubmissionState(
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
    workItems: applyLoggedTimeToWorkItems(state.workItems, {
      workItemId: entry.workItemId,
      projectId: entry.projectId,
      taskId: entry.taskId,
      durationMsDelta: -entry.durationMs,
    }),
  };
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
  const updatedEntry = updated.timesheetEntries.find((item) => item._id === entryId);
  if (!updatedEntry) {
    return state;
  }

  const movedEntry = preserveTimesheetEntrySubmissionState(entry, {
    ...updatedEntry,
    localDate: values.localDate,
    committedAt: factories.now(),
  });

  if (
    movedEntry.localDate === entry.localDate &&
    createTimesheetEntrySubmissionFingerprint(movedEntry) ===
      createTimesheetEntrySubmissionFingerprint(entry)
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

export function markTimesheetEntriesSubmitted(
  state: LocalAppState,
  entryIds: string[],
  now: () => number,
): LocalAppState {
  const selectedIds = new Set(entryIds);
  let changed = false;
  const submittedAt = now();
  const timesheetEntries = state.timesheetEntries.map((entry) => {
    if (!selectedIds.has(entry._id)) {
      return entry;
    }

    changed = true;
    return {
      ...entry,
      submittedAt,
      submittedFingerprint:
        createTimesheetEntrySubmissionFingerprint(entry),
    };
  });

  return changed
    ? {
        ...state,
        timesheetEntries,
      }
    : state;
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
      (entry) =>
        entry.localDate === localDate && orderedIdSet.has(entry._id),
    )
    .sort(
      (left, right) =>
        right.committedAt - left.committedAt ||
        state.timesheetEntries.indexOf(left) -
          state.timesheetEntries.indexOf(right),
    );

  if (selectedEntries.length !== orderedIds.length) {
    return state;
  }

  const committedAtSlots = selectedEntries.map((entry) => entry.committedAt);
  const nextCommittedAtById = new Map(
    orderedIds.map((entryId, index) => [
      entryId,
      committedAtSlots[index]!,
    ]),
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
