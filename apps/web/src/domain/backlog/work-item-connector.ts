import {
  normalizeConnectorStatusKey,
  type ConnectorDoneWorkItem,
  type ConnectorImportCandidate,
  type ConnectorSyncFieldUpdate,
  type ConnectorSyncWorkItemUpdate,
} from "@ajour/shared";
import type {
  LocalAppState,
  LocalWorkItem,
  LocalWorkItemEstimateFieldKey,
  LocalWorkItemEstimateFieldState,
  LocalWorkItemEstimateSyncState,
} from "@/domain/local-state";
import { archiveBacklogItem } from "@/domain/backlog/backlog-item-lifecycle";
import { findMappedWorkflowStateId } from "@/domain/backlog/workflow-states";
import {
  createImportedEstimateSyncState,
  normalizeWorkItemEstimateValue,
} from "@/domain/backlog/work-item-estimates";
import { normalizeWorkItemPriority } from "@/domain/backlog/work-item-transitions";

export interface ConnectorWorkItemFactories {
  createId: (prefix: string) => string;
  now: () => number;
}

export interface ConnectorWorkItemImportResult {
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

function createConnectorWorkItem(
  workItem: ConnectorImportCandidate,
  mappedWorkflowStateId: string | undefined,
  createId: (prefix: string) => string,
  existingId?: string,
): LocalWorkItem {
  const sourceStatusLabel = workItem.state?.trim() || undefined;
  const sourceStatusKey = sourceStatusLabel
    ? normalizeConnectorStatusKey(sourceStatusLabel)
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
    priority: normalizeWorkItemPriority(workItem.priority),
    importedPriority: normalizeWorkItemPriority(workItem.priority),
    workflowStateId: mappedWorkflowStateId,
    importedWorkflowStateId: mappedWorkflowStateId,
    sourceStatusKey,
    sourceStatusLabel,
    projectId: undefined,
    taskId: undefined,
    note: workItem.note?.trim() || undefined,
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

function mergeConnectorWorkItem(
  existingWorkItem: LocalWorkItem,
  importedWorkItem: ConnectorImportCandidate,
  mappedWorkflowStateId: string | undefined,
  factories: ConnectorWorkItemFactories,
): LocalWorkItem {
  const nextImportedState = createConnectorWorkItem(
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
  const reopened = reopenedInSource(
    existingWorkItem,
    importedWorkItem,
    nextImportedState,
  );
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
    title: nextImportedState.title,
    note: existingWorkItem.note,
    sourceId: nextImportedState.sourceId,
    sourceUrl: nextImportedState.sourceUrl,
    sourceConnectionId: nextImportedState.sourceConnectionId,
    sourceConnectionLabel: nextImportedState.sourceConnectionLabel,
    sourceProjectName: nextImportedState.sourceProjectName,
    sourceWorkItemType: nextImportedState.sourceWorkItemType,
    hierarchyLevel: nextImportedState.hierarchyLevel,
    parentSourceId: nextImportedState.parentSourceId,
    priority: followsImportedPriority
      ? nextImportedState.importedPriority
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
    // Until a settle's write is sent, the source still shows the old values.
    // The item keeps the settle's values, and the old ones don't return it.
    ...(existingWorkItem.pendingSourceWrite
      ? {
          priority: existingWorkItem.priority,
          importedPriority: existingWorkItem.importedPriority,
          sourceStatusKey: existingWorkItem.sourceStatusKey,
          sourceStatusLabel: existingWorkItem.sourceStatusLabel,
          workflowStateId: existingWorkItem.workflowStateId,
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
    ...(!existingWorkItem.pendingSourceWrite &&
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
 * An archived item comes back when the source shows it open in a state other
 * than the one it had when it was archived, such as a reopened bug. Items
 * archived by a local Archive keep that state in the source, so they stay.
 */
function reopenedInSource(
  existingWorkItem: LocalWorkItem,
  importedWorkItem: ConnectorImportCandidate,
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

export function importConnectorWorkItems(
  state: LocalAppState,
  workItems: ConnectorImportCandidate[],
  options: { archiveMissingFromConnectionId?: string } | undefined,
  factories: ConnectorWorkItemFactories,
) {
  const uniqueWorkItems = Array.from(
    new Map(
      workItems.map(
        (workItem) => [getWorkItemSourceKey(workItem), workItem] as const,
      ),
    ).values(),
  );
  const result: ConnectorWorkItemImportResult = {
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
          normalizeConnectorStatusKey(workItem.state),
        )
      : undefined;
    const existingWorkItem = existingItemsByKey.get(key);
    if (options?.archiveMissingFromConnectionId === workItem.connectionId) {
      importedKeysForConnection.add(key);
    }

    if (existingWorkItem) {
      const mergedWorkItem = mergeConnectorWorkItem(
        existingWorkItem,
        workItem,
        mappedWorkflowStateId,
        factories,
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
        existingWorkItem.status === "settled" &&
        mergedWorkItem.status === "active"
      ) {
        returnedIds.add(mergedWorkItem._id);
      }

      result.updatedCount += 1;
      continue;
    }

    const importedItem = createConnectorWorkItem(
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
      workItem.status === "settled" &&
      workItem.settledWithParentId &&
      returnedIds.has(workItem.settledWithParentId)
        ? {
            ...workItem,
            status: "active" as const,
            settledAt: undefined,
            settledWithParentId: undefined,
            settledSourceStatusKey: undefined,
            settledImportedPriority: undefined,
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

      if (
        workItem.source === "manual" ||
        workItem.sourceConnectionId !== archiveConnectionId ||
        !sourceId ||
        workItem.keepWhenMissingFromSync
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

  return {
    state: {
      ...state,
      workItems: [...importedItems, ...nextWorkItems],
    },
    result,
  };
}

/**
 * Archives the synced items a sync reports in a done category, such as Azure
 * DevOps Completed or Removed, or Jira Done. This covers active, snoozed and
 * settled items alike, and the subitems a settle carried go with their parent.
 * Done items Ajour has not imported are ignored, and an archived item stays
 * as it is.
 */
export function archiveDoneConnectorWorkItems(
  state: LocalAppState,
  doneItems: ConnectorDoneWorkItem[],
  factories: ConnectorWorkItemFactories,
): { state: LocalAppState; archivedCount: number } {
  let nextState = state;
  let archivedCount = 0;

  for (const doneItem of doneItems) {
    const key = getWorkItemSourceKey(doneItem);
    const target = nextState.workItems.find(
      (workItem) =>
        workItem.sourceId !== undefined &&
        getWorkItemSourceKey({ ...workItem, sourceId: workItem.sourceId }) ===
          key,
    );
    if (!target || target.status === "archived") {
      continue;
    }

    const stateLabel = doneItem.state?.trim();
    const withSourceState = stateLabel
      ? {
          ...nextState,
          workItems: nextState.workItems.map((workItem) =>
            workItem._id === target._id
              ? {
                  ...workItem,
                  sourceStatusKey: normalizeConnectorStatusKey(stateLabel),
                  sourceStatusLabel: stateLabel,
                }
              : workItem,
          ),
        }
      : nextState;
    nextState = archiveBacklogItem(withSourceState, target._id, factories);
    archivedCount += 1;
  }

  return { state: nextState, archivedCount };
}

function applyConnectorFieldUpdateToWorkItem(
  workItem: LocalWorkItem,
  fieldKey: LocalWorkItemEstimateFieldKey,
  update: ConnectorSyncFieldUpdate,
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

export function applyConnectorSyncWorkItemUpdates(
  state: LocalAppState,
  updates: ConnectorSyncWorkItemUpdate[],
  now: () => number,
): LocalAppState {
  if (updates.length === 0) {
    return state;
  }

  const updatesByWorkItemId = new Map<string, ConnectorSyncWorkItemUpdate[]>();
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
          nextWorkItem = applyConnectorFieldUpdateToWorkItem(
            nextWorkItem,
            "originalEstimateHours",
            update.fields.originalEstimateHours,
            now,
          );
        }
        if (update.fields.remainingEstimateHours) {
          nextWorkItem = applyConnectorFieldUpdateToWorkItem(
            nextWorkItem,
            "remainingEstimateHours",
            update.fields.remainingEstimateHours,
            now,
          );
        }
        if (update.fields.completedEstimateHours) {
          nextWorkItem = applyConnectorFieldUpdateToWorkItem(
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
