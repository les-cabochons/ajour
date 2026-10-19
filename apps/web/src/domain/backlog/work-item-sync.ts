import {
  normalizeSourceStatusKey,
  type BacklogItemCommentFacts,
  type BacklogPerson,
  type BacklogDoneWorkItem,
  type BacklogImportCandidate,
  type BacklogSyncFieldUpdate,
  type BacklogSyncWorkItemUpdate,
} from "@ajour/shared";
import type {
  LocalAppState,
  LocalWorkItem,
  LocalWorkItemEstimateFieldKey,
  LocalWorkItemEstimateFieldState,
  LocalWorkItemEstimateSyncState,
} from "@/domain/local-state";
import { getPendingSourceWriteItemIds } from "@/domain/local-state";
import {
  applyWorkflowStateLifecycle,
  archiveBacklogItem,
  restoreBacklogItem,
  sourceChangeSnooze,
  unsettleBacklogItem,
} from "@/domain/backlog/backlog-item-lifecycle";
import {
  findMappedWorkflowStateId,
  isDoneWorkflowState,
} from "@/domain/backlog/workflow-states";
import {
  createImportedEstimateSyncState,
  normalizeWorkItemEstimateValue,
} from "@/domain/backlog/work-item-estimates";
import { priorityLevelFromSource } from "@/domain/backlog/priority";

export interface SyncedWorkItemFactories {
  createId: (prefix: string) => string;
  now: () => number;
}

export interface SyncedWorkItemImportResult {
  importedCount: number;
  updatedCount: number;
  archivedCount: number;
}

function getWorkItemSourceKey(workItem: {
  source: LocalWorkItem["source"];
  sourceId: string;
  sourceConnectionId?: string;
  connectionId?: string;
}) {
  const connectionId =
    workItem.sourceConnectionId ?? workItem.connectionId ?? "";
  return `${workItem.source}:${connectionId}:${workItem.sourceId}`;
}

function createSyncedWorkItem(
  workItem: BacklogImportCandidate,
  mappedWorkflowStateId: string | undefined,
  createId: (prefix: string) => string,
  existingId?: string,
): LocalWorkItem {
  const importedPriority = priorityLevelFromSource(workItem.priority);
  const sourceStatusLabel = workItem.state?.trim() || undefined;
  const sourceStatusKey = sourceStatusLabel
    ? normalizeSourceStatusKey(sourceStatusLabel)
    : undefined;

  return {
    _id: existingId ?? createId("work_item"),
    title: workItem.title.trim(),
    status: "active",
    source: workItem.source,
    sourceId: workItem.sourceId,
    sourceUrl: workItem.sourceUrl,
    sourceConnectionId: workItem.connectionId,
    sourceConnectionLabel: workItem.connectionLabel,
    sourceProjectName: workItem.projectName,
    sourceWorkItemType: workItem.workItemType,
    hierarchyLevel: workItem.depth,
    parentSourceId: workItem.parentSourceId,
    priority: importedPriority,
    importedPriority,
    workflowStateId: mappedWorkflowStateId,
    importedWorkflowStateId: mappedWorkflowStateId,
    sourceStatusKey,
    sourceStatusLabel,
    projectId: undefined,
    taskId: undefined,
    description: workItem.note?.trim() || undefined,
    originalEstimateHours: normalizeWorkItemEstimateValue(
      workItem.originalEstimateHours,
    ),
    remainingEstimateHours: normalizeWorkItemEstimateValue(
      workItem.remainingEstimateHours,
    ),
    completedEstimateHours: normalizeWorkItemEstimateValue(
      workItem.completedEstimateHours,
    ),
    estimateSync: createImportedEstimateSyncState(workItem),
    keepWhenMissingFromSync: false,
    archivedByMissingSync: false,
    createdAt: workItem.pushedAt,
    archivedAt: undefined,
  };
}

function mergeSyncedWorkItem(
  existingWorkItem: LocalWorkItem,
  importedWorkItem: BacklogImportCandidate,
  mappedWorkflowStateId: string | undefined,
  factories: SyncedWorkItemFactories,
  changesEndSnoozeEarly: boolean,
  preserveSource: boolean,
): LocalWorkItem {
  const nextImportedState = createSyncedWorkItem(
    importedWorkItem,
    mappedWorkflowStateId,
    factories.createId,
    existingWorkItem._id,
  );
  const followsImportedEstimate = (fieldKey: LocalWorkItemEstimateFieldKey) => {
    const syncState = existingWorkItem.estimateSync?.[fieldKey];
    if (!syncState) {
      return true;
    }
    return (
      existingWorkItem[fieldKey] ===
      (syncState?.baselineValue ?? syncState?.remoteValue)
    );
  };
  const followsImportedPriority =
    existingWorkItem.priority === existingWorkItem.importedPriority;
  // A local move stays until the source shows a different state; then the
  // mapping wins again.
  const followsImportedWorkflowState =
    existingWorkItem.workflowStateId ===
      existingWorkItem.importedWorkflowStateId ||
    nextImportedState.sourceStatusKey !== existingWorkItem.sourceStatusKey;
  const reopened =
    !preserveSource &&
    reopenedInSource(existingWorkItem, importedWorkItem, nextImportedState);
  const followsImportedOriginalEstimate = followsImportedEstimate(
    "originalEstimateHours",
  );
  const followsImportedRemainingEstimate = followsImportedEstimate(
    "remainingEstimateHours",
  );
  const followsImportedCompletedEstimate = followsImportedEstimate(
    "completedEstimateHours",
  );
  const mergeEstimateField = (
    fieldKey: LocalWorkItemEstimateFieldKey,
    followsImported: boolean,
  ): LocalWorkItemEstimateFieldState | undefined => {
    const current = existingWorkItem.estimateSync?.[fieldKey];
    const imported = nextImportedState.estimateSync?.[fieldKey];
    if (!imported) {
      return followsImported
        ? current
          ? {
              ...current,
              baselineValue: undefined,
              remoteValue: undefined,
              resolution: undefined,
              conflict: undefined,
              error: undefined,
            }
          : undefined
        : current;
    }

    return {
      ...current,
      remoteValue: imported.remoteValue,
      baselineValue: followsImported
        ? imported.baselineValue
        : current?.baselineValue,
      resolution: followsImported ? undefined : current?.resolution,
      conflict: followsImported ? undefined : current?.conflict,
      error: followsImported ? undefined : current?.error,
    };
  };
  const mergedEstimateSync: LocalWorkItemEstimateSyncState = {
    originalEstimateHours: mergeEstimateField(
      "originalEstimateHours",
      followsImportedOriginalEstimate,
    ),
    remainingEstimateHours: mergeEstimateField(
      "remainingEstimateHours",
      followsImportedRemainingEstimate,
    ),
    completedEstimateHours: mergeEstimateField(
      "completedEstimateHours",
      followsImportedCompletedEstimate,
    ),
  };
  const estimateSync = Object.values(mergedEstimateSync).some(Boolean)
    ? mergedEstimateSync
    : undefined;

  return {
    ...existingWorkItem,
    ...sourceChangeSnooze(
      existingWorkItem,
      nextImportedState,
      changesEndSnoozeEarly,
      factories.now(),
    ),
    title: nextImportedState.title,
    description: existingWorkItem.description,
    sourceId: nextImportedState.sourceId,
    sourceUrl: nextImportedState.sourceUrl,
    sourceConnectionId: nextImportedState.sourceConnectionId,
    sourceConnectionLabel: nextImportedState.sourceConnectionLabel,
    sourceProjectName: nextImportedState.sourceProjectName,
    sourceWorkItemType: nextImportedState.sourceWorkItemType,
    hierarchyLevel: nextImportedState.hierarchyLevel,
    parentSourceId: nextImportedState.parentSourceId,
    priority: followsImportedPriority
      ? nextImportedState.priority
      : existingWorkItem.priority,
    importedPriority: nextImportedState.importedPriority,
    // An archived item stays in its done state unless the source reopened it.
    workflowStateId:
      existingWorkItem.status === "archived" &&
      !existingWorkItem.archivedByMissingSync &&
      !reopened
        ? existingWorkItem.workflowStateId
        : followsImportedWorkflowState
          ? nextImportedState.importedWorkflowStateId
          : existingWorkItem.workflowStateId,
    importedWorkflowStateId: nextImportedState.importedWorkflowStateId,
    sourceStatusKey: nextImportedState.sourceStatusKey,
    sourceStatusLabel: nextImportedState.sourceStatusLabel,
    originalEstimateHours: followsImportedOriginalEstimate
      ? nextImportedState.originalEstimateHours
      : existingWorkItem.originalEstimateHours,
    remainingEstimateHours: followsImportedRemainingEstimate
      ? nextImportedState.remainingEstimateHours
      : existingWorkItem.remainingEstimateHours,
    completedEstimateHours: followsImportedCompletedEstimate
      ? nextImportedState.completedEstimateHours
      : existingWorkItem.completedEstimateHours,
    estimateSync,
    keepWhenMissingFromSync: existingWorkItem.keepWhenMissingFromSync ?? false,
    status: existingWorkItem.archivedByMissingSync
      ? "active"
      : existingWorkItem.status,
    archivedAt: existingWorkItem.archivedByMissingSync
      ? undefined
      : existingWorkItem.archivedAt,
    archivedByMissingSync: false,
    // A pending move or settle keeps its source values until the write is sent.
    ...(preserveSource
      ? {
          priority: existingWorkItem.priority,
          importedPriority: existingWorkItem.importedPriority,
          sourceStatusKey: existingWorkItem.sourceStatusKey,
          sourceStatusLabel: existingWorkItem.sourceStatusLabel,
          workflowStateId: existingWorkItem.workflowStateId,
          importedWorkflowStateId: existingWorkItem.importedWorkflowStateId,
        }
      : {}),
    ...(reopened
      ? {
          status: "active" as const,
          returnedAt: factories.now(),
          archivedAt: undefined,
          archivedSourceStatusKey: undefined,
          settledWithParentId: undefined,
          workflowStateIdBeforeClose: undefined,
          workflowStateId:
            nextImportedState.importedWorkflowStateId ??
            existingWorkItem.workflowStateIdBeforeClose,
        }
      : {}),
    ...(!preserveSource &&
    changedSinceSettled(existingWorkItem, nextImportedState)
      ? {
          status: "active" as const,
          returnedAt: factories.now(),
          settledAt: undefined,
          settledWithParentId: undefined,
          settledSourceStatusKey: undefined,
          settledImportedPriority: undefined,
        }
      : {}),
  };
}

/**
 * A settled item comes back when someone else commented after it was settled
 * (ADR 0008). The latest such comment names who brought it back.
 *
 * `sync` holds each item's settle time as the sync asked about it, and the
 * items this sync's own answer already returned for a source change, which
 * still name who commented. An item settled again since keeps its settle:
 * the comment predates it. An item whose settle write still waits, itself
 * or as a subitem its parent's settle carried, is left alone, so the settle's
 * Undo keeps working; the next sync reports the comment again.
 */
export function returnItemsWithNewComments(
  state: LocalAppState,
  facts: readonly BacklogItemCommentFacts[],
  viewer: BacklogPerson,
  sync: {
    settledSince: ReadonlyMap<string, number>;
    returnedBySync: ReadonlySet<string>;
  },
  now: () => number,
): LocalAppState {
  let next = state;
  for (const entry of facts) {
    const since = sync.settledSince.get(entry.localWorkItemId);
    const item = next.workItems.find(
      (candidate) => candidate._id === entry.localWorkItemId,
    );
    if (since === undefined || !item || waitsOnSettleWrite(next, item)) {
      continue;
    }
    const latest = entry.comments
      .filter(
        (comment) =>
          comment.author.id !== viewer.id &&
          Date.parse(comment.createdAt) > since,
      )
      .sort(
        (left, right) =>
          Date.parse(left.createdAt) - Date.parse(right.createdAt),
      )
      .at(-1);
    if (!latest) continue;
    const author = latest.author.displayName || "Someone";
    if (item.status === "settled") {
      if (item.settledAt !== since) continue;
      const at = now();
      next = unsettleBacklogItem(next, item._id);
      next = withReturnedByComment(next, item._id, { author, at }, at);
    } else if (
      item.status === "active" &&
      item.returnedAt !== undefined &&
      sync.returnedBySync.has(item._id)
    ) {
      // This answer brought it back from the settle it asked about.
      next = withReturnedByComment(
        next,
        item._id,
        { author, at: item.returnedAt },
        item.returnedAt,
      );
    }
  }
  return next;
}

/** Whether a settle write waits on the item or on the parent that carried it. */
function waitsOnSettleWrite(state: LocalAppState, item: LocalWorkItem) {
  if (item.pendingSourceWrite) return true;
  const parentId = item.settledWithParentId;
  return Boolean(
    parentId &&
    state.workItems.find((candidate) => candidate._id === parentId)
      ?.pendingSourceWrite,
  );
}

function withReturnedByComment(
  state: LocalAppState,
  workItemId: string,
  returnedByComment: { author: string; at: number },
  returnedAt: number,
): LocalAppState {
  return {
    ...state,
    workItems: state.workItems.map((workItem) =>
      workItem._id === workItemId
        ? { ...workItem, returnedAt, returnedByComment }
        : workItem,
    ),
  };
}

/**
 * An archived item comes back when the source shows it open in a state other
 * than the one it had when it was archived, such as a reopened bug. Items
 * archived by a local Archive keep that state in the source, so they stay.
 */
function reopenedInSource(
  existingWorkItem: LocalWorkItem,
  importedWorkItem: BacklogImportCandidate,
  importedState: LocalWorkItem,
) {
  return (
    existingWorkItem.status === "archived" &&
    !existingWorkItem.archivedByMissingSync &&
    !existingWorkItem.pendingSourceWrite &&
    importedWorkItem.stateDone !== true &&
    existingWorkItem.archivedSourceStatusKey !== undefined &&
    importedState.sourceStatusKey !== undefined &&
    importedState.sourceStatusKey !== existingWorkItem.archivedSourceStatusKey
  );
}

/**
 * A settled item comes back when the source shows a state or priority other
 * than the ones it had when the user settled it.
 */
function changedSinceSettled(
  existingWorkItem: LocalWorkItem,
  importedState: LocalWorkItem,
) {
  return (
    existingWorkItem.status === "settled" &&
    (importedState.sourceStatusKey !==
      existingWorkItem.settledSourceStatusKey ||
      importedState.importedPriority !==
        existingWorkItem.settledImportedPriority)
  );
}

export function importSyncedWorkItems(
  state: LocalAppState,
  workItems: BacklogImportCandidate[],
  options: { archiveMissingFromConnectionId?: string } | undefined,
  factories: SyncedWorkItemFactories,
) {
  const uniqueWorkItems = Array.from(
    new Map(
      workItems.map(
        (workItem) => [getWorkItemSourceKey(workItem), workItem] as const,
      ),
    ).values(),
  );
  const result: SyncedWorkItemImportResult = {
    importedCount: 0,
    updatedCount: 0,
    archivedCount: 0,
  };
  const existingItemsByKey = new Map<string, LocalWorkItem>(
    state.workItems
      .filter((workItem): workItem is LocalWorkItem & { sourceId: string } =>
        Boolean(workItem.sourceId),
      )
      .map((workItem) => [getWorkItemSourceKey(workItem), workItem] as const),
  );
  const pendingMoveItemIds = getPendingSourceWriteItemIds(state);
  const importedKeysForConnection = new Set<string>();
  const importedItems: LocalWorkItem[] = [];
  /** Settled items this sync brought back, whose carried subitems return with them. */
  const returnedIds = new Set<string>();
  let nextWorkItems = state.workItems;
  let changedExistingItems = false;

  for (const workItem of uniqueWorkItems) {
    const key = getWorkItemSourceKey(workItem);
    const mappedWorkflowStateId = workItem.state?.trim()
      ? findMappedWorkflowStateId(
          state.workflowStateMappings,
          workItem.source,
          workItem.connectionId,
          normalizeSourceStatusKey(workItem.state),
          workItem.projectName,
        )
      : undefined;
    const existingWorkItem = existingItemsByKey.get(key);
    if (options?.archiveMissingFromConnectionId === workItem.connectionId) {
      importedKeysForConnection.add(key);
    }

    if (existingWorkItem) {
      const mergedWorkItem = mergeSyncedWorkItem(
        existingWorkItem,
        workItem,
        mappedWorkflowStateId,
        factories,
        state.userPreferences.changesEndSnoozeEarly === true,
        pendingMoveItemIds.has(existingWorkItem._id),
      );
      if (JSON.stringify(mergedWorkItem) === JSON.stringify(existingWorkItem)) {
        continue;
      }
      if (!changedExistingItems) {
        nextWorkItems = [...state.workItems];
        changedExistingItems = true;
      }

      const existingIndex = nextWorkItems.findIndex(
        (candidate) => candidate._id === existingWorkItem._id,
      );
      if (existingIndex >= 0) {
        nextWorkItems[existingIndex] = mergedWorkItem;
        existingItemsByKey.set(key, mergedWorkItem);
      }
      if (
        existingWorkItem.status !== "active" &&
        mergedWorkItem.status === "active" &&
        !isDoneWorkflowState(
          state.workflowStates,
          mergedWorkItem.workflowStateId,
        )
      ) {
        returnedIds.add(mergedWorkItem._id);
      }

      result.updatedCount += 1;
      continue;
    }

    const importedItem = createSyncedWorkItem(
      workItem,
      mappedWorkflowStateId,
      factories.createId,
    );
    existingItemsByKey.set(key, importedItem);
    importedItems.push(importedItem);
    result.importedCount += 1;
  }

  if (returnedIds.size > 0) {
    nextWorkItems = nextWorkItems.map((workItem) =>
      workItem.status !== "active" &&
      workItem.settledWithParentId &&
      returnedIds.has(workItem.settledWithParentId)
        ? {
            ...workItem,
            status: "active" as const,
            settledAt: undefined,
            settledWithParentId: undefined,
            settledSourceStatusKey: undefined,
            settledImportedPriority: undefined,
            archivedAt: undefined,
            archivedSourceStatusKey: undefined,
            workflowStateId:
              workItem.status === "archived"
                ? workItem.workflowStateIdBeforeClose
                : workItem.workflowStateId,
            workflowStateIdBeforeClose: undefined,
          }
        : workItem,
    );
  }

  if (options?.archiveMissingFromConnectionId) {
    const archiveConnectionId = options.archiveMissingFromConnectionId;
    nextWorkItems = (
      changedExistingItems ? nextWorkItems : [...state.workItems]
    ).map((workItem) => {
      const sourceId = workItem.sourceId;

      // Pending moves may still be absent from the source's open set.
      if (
        workItem.source === "manual" ||
        workItem.sourceConnectionId !== archiveConnectionId ||
        !sourceId ||
        workItem.keepWhenMissingFromSync ||
        pendingMoveItemIds.has(workItem._id)
      ) {
        return workItem;
      }

      if (
        importedKeysForConnection.has(
          getWorkItemSourceKey({
            source: workItem.source,
            sourceId,
            sourceConnectionId: workItem.sourceConnectionId,
          }),
        ) ||
        workItem.status === "archived"
      ) {
        return workItem;
      }

      result.archivedCount += 1;
      changedExistingItems = true;
      return {
        ...workItem,
        status: "archived" as const,
        archivedAt: workItem.archivedAt ?? factories.now(),
        archivedByMissingSync: true,
      };
    });
  }

  if (importedItems.length === 0 && !changedExistingItems) {
    return { state, result };
  }

  // Items whose source state now maps to a done state close.
  return {
    state: applyWorkflowStateLifecycle(
      state,
      { ...state, workItems: [...importedItems, ...nextWorkItems] },
      factories,
    ),
    result,
  };
}

/**
 * Archives the synced items a sync reports in a done category, such as Azure
 * DevOps Completed or Removed, or Jira Done. This covers active, snoozed and
 * settled items alike, and the subitems a settle carried go with their parent.
 * Done items Ajour has not imported are ignored. Archived items return only
 * when their changed source state maps to an open workflow state.
 */
export function archiveDoneSyncedWorkItems(
  state: LocalAppState,
  doneItems: BacklogDoneWorkItem[],
  factories: SyncedWorkItemFactories,
): { state: LocalAppState; archivedCount: number } {
  let nextState = state;
  let archivedCount = 0;
  const pendingMoveItemIds = getPendingSourceWriteItemIds(state);

  for (const doneItem of doneItems) {
    const key = getWorkItemSourceKey(doneItem);
    const target = nextState.workItems.find(
      (workItem) =>
        workItem.sourceId !== undefined &&
        getWorkItemSourceKey({ ...workItem, sourceId: workItem.sourceId }) ===
          key,
    );
    if (!target || pendingMoveItemIds.has(target._id)) {
      continue;
    }

    const stateLabel = doneItem.state?.trim();
    const sourceStatusKey = stateLabel
      ? normalizeSourceStatusKey(stateLabel)
      : undefined;
    const mappedWorkflowStateId = findMappedWorkflowStateId(
      nextState.workflowStateMappings,
      target.source,
      target.sourceConnectionId,
      sourceStatusKey,
      target.sourceProjectName,
    );
    // A user who mapped this source state to a state that isn't done keeps
    // the item open there.
    const keepsOpen =
      mappedWorkflowStateId !== undefined &&
      !isDoneWorkflowState(nextState.workflowStates, mappedWorkflowStateId);
    const reopens =
      target.status === "archived" &&
      keepsOpen &&
      (target.archivedByMissingSync ||
        (target.archivedSourceStatusKey !== undefined &&
          sourceStatusKey !== undefined &&
          sourceStatusKey !== target.archivedSourceStatusKey));
    if (target.status === "archived" && !reopens) continue;
    const restored = reopens
      ? restoreBacklogItem(nextState, target._id)
      : nextState;
    const withSourceState = stateLabel
      ? {
          ...restored,
          workItems: restored.workItems.map((workItem) =>
            workItem._id === target._id
              ? {
                  ...workItem,
                  sourceStatusKey,
                  sourceStatusLabel: stateLabel,
                  importedWorkflowStateId: mappedWorkflowStateId,
                  ...(keepsOpen
                    ? {
                        workflowStateId:
                          workItem.workflowStateId ===
                            workItem.importedWorkflowStateId ||
                          workItem.sourceStatusKey !== sourceStatusKey
                            ? mappedWorkflowStateId
                            : workItem.workflowStateId,
                      }
                    : {}),
                }
              : workItem,
          ),
        }
      : restored;
    if (keepsOpen) {
      nextState =
        target.status === "settled" &&
        sourceStatusKey !== target.settledSourceStatusKey
          ? unsettleBacklogItem(withSourceState, target._id)
          : withSourceState;
      if (reopens || nextState !== withSourceState) {
        nextState = {
          ...nextState,
          workItems: nextState.workItems.map((item) =>
            item._id === target._id
              ? { ...item, returnedAt: factories.now() }
              : item,
          ),
        };
      }
      continue;
    }
    nextState = archiveBacklogItem(withSourceState, target._id, factories);
    archivedCount += 1;
  }

  return { state: nextState, archivedCount };
}

function applySourceFieldUpdateToWorkItem(
  workItem: LocalWorkItem,
  fieldKey: LocalWorkItemEstimateFieldKey,
  update: BacklogSyncFieldUpdate,
  now: () => number,
): LocalWorkItem {
  const estimateSync: LocalWorkItemEstimateSyncState = {
    ...workItem.estimateSync,
  };
  const currentFieldState = estimateSync[fieldKey];
  const fieldState: LocalWorkItemEstimateFieldState = {
    ...currentFieldState,
  };

  switch (update.status) {
    case "pulled":
      fieldState.baselineValue = update.nextBaselineValue ?? update.remoteValue;
      fieldState.remoteValue = update.remoteValue;
      fieldState.resolution = undefined;
      fieldState.conflict = undefined;
      fieldState.error = undefined;
      return {
        ...workItem,
        [fieldKey]: update.remoteValue,
        estimateSync: {
          ...estimateSync,
          [fieldKey]: fieldState,
        },
      };
    case "pushed":
      fieldState.baselineValue = update.nextBaselineValue ?? update.localValue;
      fieldState.remoteValue = update.localValue;
      fieldState.resolution = undefined;
      fieldState.conflict = undefined;
      fieldState.error = undefined;
      return {
        ...workItem,
        estimateSync: {
          ...estimateSync,
          [fieldKey]: fieldState,
        },
      };
    case "noop":
      fieldState.baselineValue = update.nextBaselineValue ?? update.localValue;
      fieldState.remoteValue = update.remoteValue;
      fieldState.resolution = undefined;
      fieldState.conflict = undefined;
      fieldState.error = undefined;
      return {
        ...workItem,
        estimateSync: {
          ...estimateSync,
          [fieldKey]: fieldState,
        },
      };
    case "conflict":
      fieldState.remoteValue = update.remoteValue;
      fieldState.conflict = {
        detectedAt: now(),
        localValue: update.localValue ?? workItem[fieldKey],
        remoteValue: update.remoteValue,
        baselineValue: update.baselineValue ?? currentFieldState?.baselineValue,
      };
      fieldState.error = undefined;
      return {
        ...workItem,
        estimateSync: {
          ...estimateSync,
          [fieldKey]: fieldState,
        },
      };
    case "error":
      fieldState.error = {
        detectedAt: now(),
        message: update.message ?? "Sync failed.",
      };
      return {
        ...workItem,
        estimateSync: {
          ...estimateSync,
          [fieldKey]: fieldState,
        },
      };
  }
}

export function applyBacklogSyncWorkItemUpdates(
  state: LocalAppState,
  updates: BacklogSyncWorkItemUpdate[],
  now: () => number,
): LocalAppState {
  if (updates.length === 0) {
    return state;
  }

  const updatesByWorkItemId = new Map<string, BacklogSyncWorkItemUpdate[]>();
  for (const update of updates) {
    const current = updatesByWorkItemId.get(update.localWorkItemId) ?? [];
    current.push(update);
    updatesByWorkItemId.set(update.localWorkItemId, current);
  }

  return {
    ...state,
    workItems: state.workItems.map((workItem) => {
      const workItemUpdates = updatesByWorkItemId.get(workItem._id);
      if (!workItemUpdates) {
        return workItem;
      }

      let nextWorkItem = workItem;
      for (const update of workItemUpdates) {
        if (update.sourceId !== workItem.sourceId) {
          continue;
        }
        if (update.fields.originalEstimateHours) {
          nextWorkItem = applySourceFieldUpdateToWorkItem(
            nextWorkItem,
            "originalEstimateHours",
            update.fields.originalEstimateHours,
            now,
          );
        }
        if (update.fields.remainingEstimateHours) {
          nextWorkItem = applySourceFieldUpdateToWorkItem(
            nextWorkItem,
            "remainingEstimateHours",
            update.fields.remainingEstimateHours,
            now,
          );
        }
        if (update.fields.completedEstimateHours) {
          nextWorkItem = applySourceFieldUpdateToWorkItem(
            nextWorkItem,
            "completedEstimateHours",
            update.fields.completedEstimateHours,
            now,
          );
        }
      }

      return nextWorkItem;
    }),
  };
}
