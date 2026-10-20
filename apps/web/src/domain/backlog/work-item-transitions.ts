import type {
  BacklogSortMode,
  LocalAppState,
  LocalWorkItem,
  LocalWorkItemDescriptionSync,
  LocalWorkItemDraft,
  LocalWorkItemEstimateFieldKey,
  PersistedLocalWorkItem,
} from "@/domain/local-state";
import {
  assertValidParentWorkItem,
  inferInheritedParentMapping,
  isSubtaskWorkItem,
} from "@/domain/backlog/work-item-hierarchy";
import {
  isPriorityLevel,
  normalizePriorityLevel,
} from "@/domain/backlog/priority";
import { normalizeWorkItemEstimateValue } from "@/domain/backlog/work-item-estimates";

export interface WorkItemFactories {
  createId: (prefix: string) => string;
  now: () => number;
}

export type WorkItemPatch = Partial<
  Omit<LocalWorkItem, "_id" | "createdAt" | "source">
>;

/** Older move snapshots omitted archive provenance, including carried items. */
export function normalizeSourceWriteRecovery(workItems: LocalWorkItem[]) {
  const itemsById = new Map(workItems.map((item) => [item._id, item]));
  const hasSourceState = (
    item:
      Pick<LocalWorkItem, "sourceStatusKey" | "sourceStatusLabel"> | undefined,
  ) => Boolean(item?.sourceStatusKey || item?.sourceStatusLabel?.trim());
  function normalize<
    T extends Pick<
      LocalWorkItem,
      | "status"
      | "archivedByMissingSync"
      | "archivedSourceStatusKey"
      | "workflowStateIdBeforeClose"
    >,
  >(
    snapshot: T,
    source: LocalWorkItem["source"],
    workflowStateId: string | undefined,
    sourceStateKnown: boolean,
  ): T {
    if (typeof snapshot.archivedByMissingSync === "boolean") return snapshot;
    // Explicit closes record the source state or pre-close workflow state.
    // A markerless explicit close still assigned a Done ID. With no known
    // source state, treat an assigned ID as explicit rather than guessing.
    return {
      ...snapshot,
      archivedByMissingSync:
        snapshot.status === "archived" &&
        source !== "manual" &&
        snapshot.archivedSourceStatusKey === undefined &&
        snapshot.workflowStateIdBeforeClose === undefined &&
        (sourceStateKnown || workflowStateId === undefined),
    };
  }
  return workItems.map((item) => {
    const write = item.pendingSourceWrite;
    if (!write) return item;
    return {
      ...item,
      pendingSourceWrite: {
        ...write,
        previous: {
          ...write.previous,
          lifecycle: write.previous.lifecycle
            ? normalize(
                write.previous.lifecycle,
                item.source,
                write.previous.workflowStateId,
                hasSourceState(write.previous),
              )
            : undefined,
          carriedChildren: write.previous.carriedChildren?.map((child) => {
            const current = itemsById.get(child.id);
            const source = current?.source ?? "manual";
            const before = current?.pendingSourceWrite
              ? current.pendingSourceWrite.previous
              : current;
            return {
              ...child,
              before: normalize(
                child.before,
                source,
                child.before.workflowStateId,
                hasSourceState(before),
              ),
              after: normalize(
                child.after,
                source,
                child.after.workflowStateId,
                hasSourceState(current),
              ),
            };
          }),
        },
      },
    };
  });
}

/** A stored description sync state, or nothing when it is not one. */
function normalizeDescriptionSync(
  value: unknown,
): LocalWorkItemDescriptionSync | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const sync = value as Record<string, unknown>;
  if (typeof sync.remote !== "string") return undefined;
  const conflict = sync.conflict as Record<string, unknown> | undefined;
  const lost = Array.isArray(sync.lost)
    ? sync.lost.filter((entry): entry is string => typeof entry === "string")
    : [];
  return {
    ...(typeof sync.baseline === "string" ? { baseline: sync.baseline } : {}),
    remote: sync.remote,
    ...(lost.length > 0 ? { lost } : {}),
    ...(sync.cut === true ? { cut: true } : {}),
    ...(conflict &&
    typeof conflict.detectedAt === "number" &&
    typeof conflict.localText === "string" &&
    typeof conflict.remoteText === "string"
      ? {
          conflict: {
            detectedAt: conflict.detectedAt,
            localText: conflict.localText,
            remoteText: conflict.remoteText,
          },
        }
      : {}),
  };
}

export function normalizePersistedWorkItem(
  workItem: PersistedLocalWorkItem,
  now: () => number,
): LocalWorkItem {
  const parentWorkItemId = workItem.parentWorkItemId;
  const status =
    workItem.status === "done"
      ? "archived"
      : workItem.status === "open" || !workItem.status
        ? "active"
        : workItem.status;
  const isSubtask = isSubtaskWorkItem(workItem);
  const createdAt = workItem.createdAt ?? now();
  const isRetiredBuiltInSource = workItem.source === "outlook";

  const {
    backlogStatusId: legacyWorkflowStateId,
    importedBacklogStatusId: legacyImportedWorkflowStateId,
    note: legacyDescription,
    ...persisted
  } = workItem;
  // Source priorities were raw source values before plugins sent levels. A
  // stored value of 1 to 4 is read as that level, even if a custom range gave
  // it another one. Any other value is dropped and the next sync brings the
  // level. Ajour has no users to migrate, so this stays a best effort.
  const sourceLevel = (value: unknown) =>
    isPriorityLevel(value) ? value : undefined;

  return {
    ...persisted,
    title: workItem.title.trim(),
    description: workItem.description ?? legacyDescription,
    status,
    source: isRetiredBuiltInSource ? "manual" : (workItem.source ?? "manual"),
    sourceId: isRetiredBuiltInSource ? undefined : workItem.sourceId,
    sourceUrl: isRetiredBuiltInSource ? undefined : workItem.sourceUrl,
    sourceExternalId: isRetiredBuiltInSource
      ? undefined
      : workItem.sourceExternalId,
    sourceConnectionId: isRetiredBuiltInSource
      ? undefined
      : workItem.sourceConnectionId,
    sourceConnectionLabel: isRetiredBuiltInSource
      ? undefined
      : workItem.sourceConnectionLabel,
    sourceProjectName: isRetiredBuiltInSource
      ? undefined
      : workItem.sourceProjectName,
    sourceWorkItemType: isRetiredBuiltInSource
      ? undefined
      : workItem.sourceWorkItemType,
    hierarchyLevel: isSubtask ? 1 : 0,
    parentWorkItemId,
    parentSourceId: isRetiredBuiltInSource
      ? undefined
      : workItem.parentSourceId,
    priority: normalizePriorityLevel(workItem.priority),
    pendingSourceWrite: workItem.pendingSourceWrite
      ? {
          ...workItem.pendingSourceWrite,
          priority: sourceLevel(workItem.pendingSourceWrite.priority),
          previous: {
            ...workItem.pendingSourceWrite.previous,
            priority: normalizePriorityLevel(
              workItem.pendingSourceWrite.previous.priority,
            ),
            importedPriority: sourceLevel(
              workItem.pendingSourceWrite.previous.importedPriority,
            ),
          },
        }
      : undefined,
    importedPriority: isRetiredBuiltInSource
      ? undefined
      : sourceLevel(workItem.importedPriority),
    settledImportedPriority: sourceLevel(workItem.settledImportedPriority),
    workflowStateId: workItem.workflowStateId ?? legacyWorkflowStateId,
    importedWorkflowStateId: isRetiredBuiltInSource
      ? undefined
      : (workItem.importedWorkflowStateId ?? legacyImportedWorkflowStateId),
    sourceStatusKey: isRetiredBuiltInSource
      ? undefined
      : workItem.sourceStatusKey,
    sourceStatusLabel: isRetiredBuiltInSource
      ? undefined
      : workItem.sourceStatusLabel,
    originalEstimateHours: normalizeWorkItemEstimateValue(
      workItem.originalEstimateHours,
    ),
    remainingEstimateHours: normalizeWorkItemEstimateValue(
      workItem.remainingEstimateHours,
    ),
    remainingEstimateOverrunHours: normalizeWorkItemEstimateValue(
      workItem.remainingEstimateOverrunHours,
    ),
    completedEstimateHours: normalizeWorkItemEstimateValue(
      workItem.completedEstimateHours,
    ),
    estimateSync: isRetiredBuiltInSource ? undefined : workItem.estimateSync,
    descriptionSync:
      isRetiredBuiltInSource || workItem.source === "manual"
        ? undefined
        : normalizeDescriptionSync(workItem.descriptionSync),
    keepWhenMissingFromSync: isRetiredBuiltInSource
      ? false
      : (workItem.keepWhenMissingFromSync ?? false),
    archivedByMissingSync: isRetiredBuiltInSource
      ? false
      : (workItem.archivedByMissingSync ?? false),
    createdAt,
    archivedAt:
      workItem.archivedAt ??
      workItem.completedAt ??
      (status === "archived" ? createdAt : undefined),
  };
}

function createManualWorkItem(
  workItem: LocalWorkItemDraft,
  factories: WorkItemFactories,
): LocalWorkItem {
  const isSubtask = Boolean(workItem.parentWorkItemId);

  return {
    _id: factories.createId("work_item"),
    title: workItem.title.trim(),
    status: "active",
    source: "manual",
    sourceId: undefined,
    sourceConnectionId: undefined,
    sourceConnectionLabel: undefined,
    sourceProjectName: undefined,
    sourceWorkItemType: undefined,
    hierarchyLevel: isSubtask ? 1 : 0,
    parentWorkItemId: workItem.parentWorkItemId,
    parentSourceId: undefined,
    priority: normalizePriorityLevel(workItem.priority),
    importedPriority: undefined,
    workflowStateId: workItem.workflowStateId,
    importedWorkflowStateId: undefined,
    sourceStatusKey: undefined,
    sourceStatusLabel: undefined,
    projectId: workItem.projectId,
    taskId: workItem.taskId,
    inheritsParentMapping: isSubtask
      ? workItem.inheritsParentMapping
      : undefined,
    description: workItem.description?.trim() || undefined,
    originalEstimateHours: normalizeWorkItemEstimateValue(
      workItem.originalEstimateHours,
    ),
    remainingEstimateHours: normalizeWorkItemEstimateValue(
      workItem.remainingEstimateHours,
    ),
    remainingEstimateOverrunHours: undefined,
    completedEstimateHours: normalizeWorkItemEstimateValue(
      workItem.completedEstimateHours,
    ),
    estimateSync: undefined,
    keepWhenMissingFromSync: false,
    archivedByMissingSync: false,
    createdAt: factories.now(),
    archivedAt: undefined,
  };
}

export function addWorkItem(
  state: LocalAppState,
  workItem: LocalWorkItemDraft,
  factories: WorkItemFactories,
) {
  const title = workItem.title.trim();
  if (!title) {
    throw new Error("Work item title is required.");
  }

  let inheritsParentMapping: boolean | undefined;
  let projectId = workItem.projectId;
  let taskId = workItem.taskId;

  if (workItem.parentWorkItemId) {
    const parent = state.workItems.find(
      (item) => item._id === workItem.parentWorkItemId,
    );
    if (!parent) {
      throw new Error("Parent work item not found.");
    }

    if (isSubtaskWorkItem(parent)) {
      throw new Error("Subitems cannot have subitems.");
    }

    inheritsParentMapping =
      inferInheritedParentMapping(
        {
          parentWorkItemId: workItem.parentWorkItemId,
          projectId: workItem.projectId,
          taskId: workItem.taskId,
          inheritsParentMapping: workItem.inheritsParentMapping,
        },
        parent,
      ) ?? false;

    if (inheritsParentMapping) {
      projectId = parent.projectId;
      taskId = parent.taskId;
    }
  }

  const createdWorkItem = createManualWorkItem(
    {
      ...workItem,
      title,
      projectId,
      taskId,
      inheritsParentMapping,
      priority: workItem.priority,
      workflowStateId: workItem.workflowStateId,
    },
    factories,
  );

  return {
    state: {
      ...state,
      workItems: [createdWorkItem, ...state.workItems],
    },
    result: createdWorkItem._id,
  };
}

export function reorderWorkItems(
  state: LocalAppState,
  orderedIds: string[],
): LocalAppState {
  if (orderedIds.length < 2) {
    return state;
  }

  const nextIndexById = new Map(orderedIds.map((id, index) => [id, index]));
  const selectedItems = state.workItems.filter((workItem) =>
    nextIndexById.has(workItem._id),
  );
  if (selectedItems.length !== orderedIds.length) {
    return state;
  }

  const reorderedItems = [...selectedItems].sort(
    (left, right) =>
      nextIndexById.get(left._id)! - nextIndexById.get(right._id)!,
  );
  let cursor = 0;
  let changed = false;
  const workItems = state.workItems.map((workItem) => {
    if (!nextIndexById.has(workItem._id)) {
      return workItem;
    }

    const nextWorkItem = reorderedItems[cursor++] ?? workItem;
    if (nextWorkItem._id !== workItem._id) {
      changed = true;
    }

    return nextWorkItem;
  });

  return changed ? { ...state, workItems } : state;
}

export function setBacklogSortMode(
  state: LocalAppState,
  mode: BacklogSortMode,
): LocalAppState {
  return state.backlogSortMode === mode
    ? state
    : { ...state, backlogSortMode: mode };
}

function hasOwn<T extends object>(value: T, key: PropertyKey) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

export function updateWorkItem(
  state: LocalAppState,
  workItemId: string,
  patch: WorkItemPatch,
): LocalAppState {
  const target = state.workItems.find(
    (workItem) => workItem._id === workItemId,
  );
  if (!target) {
    return state;
  }

  const parentWorkItemIdProvided = hasOwn(patch, "parentWorkItemId");
  const parentSourceIdProvided = hasOwn(patch, "parentSourceId");
  const nextParentWorkItemId = parentWorkItemIdProvided
    ? typeof patch.parentWorkItemId === "string"
      ? patch.parentWorkItemId || undefined
      : patch.parentWorkItemId
    : target.parentWorkItemId;
  const nextParentSourceId = nextParentWorkItemId
    ? undefined
    : parentWorkItemIdProvided
      ? undefined
      : parentSourceIdProvided
        ? patch.parentSourceId
        : target.parentSourceId;
  const sourceParent = nextParentSourceId
    ? state.workItems.find(
        (workItem) =>
          workItem.sourceId === nextParentSourceId &&
          workItem.sourceConnectionId === target.sourceConnectionId,
      )
    : undefined;
  if (sourceParent?._id === workItemId) {
    throw new Error("A work item cannot be its own parent.");
  }

  if (nextParentWorkItemId) {
    assertValidParentWorkItem(
      state.workItems,
      workItemId,
      nextParentWorkItemId,
    );
  }

  const nextIsSubtask = Boolean(nextParentWorkItemId || nextParentSourceId);
  const priorityProvided = hasOwn(patch, "priority");
  const nextPriority = priorityProvided
    ? normalizePriorityLevel(patch.priority)
    : target.priority;
  const mappingProvided = hasOwn(patch, "projectId") || hasOwn(patch, "taskId");
  const inheritanceProvided = hasOwn(patch, "inheritsParentMapping");
  const nextParent = nextParentWorkItemId
    ? state.workItems.find((workItem) => workItem._id === nextParentWorkItemId)
    : undefined;
  let nextProjectId = hasOwn(patch, "projectId")
    ? patch.projectId
    : target.projectId;
  let nextTaskId = hasOwn(patch, "taskId") ? patch.taskId : target.taskId;
  let nextInheritsParentMapping = inferInheritedParentMapping(
    {
      parentWorkItemId: nextParentWorkItemId,
      projectId: nextProjectId,
      taskId: nextTaskId,
      inheritsParentMapping: hasOwn(patch, "inheritsParentMapping")
        ? patch.inheritsParentMapping
        : target.inheritsParentMapping,
    },
    nextParent,
  );

  if (
    nextParent &&
    (mappingProvided ||
      nextParentWorkItemId !== target.parentWorkItemId ||
      nextInheritsParentMapping)
  ) {
    const shouldInherit = inheritanceProvided
      ? Boolean(patch.inheritsParentMapping)
      : mappingProvided || nextParentWorkItemId !== target.parentWorkItemId
        ? (inferInheritedParentMapping(
            {
              parentWorkItemId: nextParentWorkItemId,
              projectId: nextProjectId,
              taskId: nextTaskId,
              inheritsParentMapping: undefined,
            },
            nextParent,
          ) ?? false)
        : (nextInheritsParentMapping ?? false);

    nextInheritsParentMapping = shouldInherit;
    if (shouldInherit) {
      nextProjectId = nextParent.projectId;
      nextTaskId = nextParent.taskId;
    }
  } else if (!nextParentWorkItemId) {
    nextInheritsParentMapping = undefined;
  }

  const nextTitle =
    typeof patch.title === "string" ? patch.title.trim() : target.title;
  if (!nextTitle) {
    throw new Error("Work item title is required.");
  }

  const nextTarget: LocalWorkItem = {
    ...target,
    ...patch,
    title: nextTitle,
    description:
      typeof patch.description === "string"
        ? patch.description.trim() || undefined
        : "description" in patch
          ? patch.description
          : target.description,
    parentWorkItemId: nextParentWorkItemId,
    parentSourceId: nextParentWorkItemId ? undefined : nextParentSourceId,
    hierarchyLevel:
      parentWorkItemIdProvided || parentSourceIdProvided
        ? nextIsSubtask
          ? 1
          : 0
        : target.hierarchyLevel,
    priority: nextPriority,
    importedPriority: target.importedPriority,
    projectId: nextProjectId,
    taskId: nextTaskId,
    inheritsParentMapping: nextInheritsParentMapping,
    originalEstimateHours: hasOwn(patch, "originalEstimateHours")
      ? normalizeWorkItemEstimateValue(patch.originalEstimateHours)
      : target.originalEstimateHours,
    remainingEstimateHours: hasOwn(patch, "remainingEstimateHours")
      ? normalizeWorkItemEstimateValue(patch.remainingEstimateHours)
      : target.remainingEstimateHours,
    completedEstimateHours: hasOwn(patch, "completedEstimateHours")
      ? normalizeWorkItemEstimateValue(patch.completedEstimateHours)
      : target.completedEstimateHours,
  };

  let workItems = state.workItems.map((workItem) =>
    workItem._id === workItemId ? nextTarget : workItem,
  );
  if (mappingProvided) {
    const changedParentIds = new Set([workItemId]);
    const changedParentSourceIds = new Set(
      target.sourceId
        ? [`${target.sourceConnectionId ?? ""}:${target.sourceId}`]
        : [],
    );
    let propagated = true;
    while (propagated) {
      propagated = false;
      workItems = workItems.map((workItem) => {
        if (
          workItem._id === workItemId ||
          (!workItem.parentWorkItemId && !workItem.parentSourceId)
        ) {
          return workItem;
        }
        const parentChanged =
          (workItem.parentWorkItemId
            ? changedParentIds.has(workItem.parentWorkItemId)
            : false) ||
          (workItem.parentSourceId
            ? changedParentSourceIds.has(
                `${workItem.sourceConnectionId ?? ""}:${workItem.parentSourceId}`,
              )
            : false);
        if (!parentChanged) {
          return workItem;
        }

        const previousParent = state.workItems.find(
          (candidate) =>
            candidate._id === workItem.parentWorkItemId ||
            (Boolean(workItem.parentSourceId) &&
              candidate.sourceId === workItem.parentSourceId &&
              candidate.sourceConnectionId === workItem.sourceConnectionId),
        );
        const nextParent = workItems.find(
          (candidate) => candidate._id === previousParent?._id,
        );
        if (
          !nextParent ||
          !(inferInheritedParentMapping(workItem, previousParent) ?? false)
        ) {
          return workItem;
        }

        const nextWorkItem = {
          ...workItem,
          projectId: nextParent.projectId,
          taskId: nextParent.taskId,
          inheritsParentMapping: true,
        };
        if (
          nextWorkItem.projectId === workItem.projectId &&
          nextWorkItem.taskId === workItem.taskId
        ) {
          return workItem;
        }

        propagated = true;
        changedParentIds.add(workItem._id);
        if (workItem.sourceId) {
          changedParentSourceIds.add(
            `${workItem.sourceConnectionId ?? ""}:${workItem.sourceId}`,
          );
        }
        return nextWorkItem;
      });
    }
  }

  return { ...state, workItems };
}

export function deleteWorkItem(
  state: LocalAppState,
  workItemId: string,
): LocalAppState {
  const target = state.workItems.find(
    (workItem) => workItem._id === workItemId,
  );
  if (!target) {
    return state;
  }
  const removedIds = new Set([target._id]);
  const removedSourceIds = new Set(
    target.sourceId
      ? [`${target.sourceConnectionId ?? ""}:${target.sourceId}`]
      : [],
  );
  let foundDescendant = true;
  while (foundDescendant) {
    foundDescendant = false;
    for (const workItem of state.workItems) {
      if (
        removedIds.has(workItem._id) ||
        (!workItem.parentWorkItemId && !workItem.parentSourceId)
      ) {
        continue;
      }
      if (
        (workItem.parentWorkItemId
          ? removedIds.has(workItem.parentWorkItemId)
          : false) ||
        (workItem.parentSourceId
          ? removedSourceIds.has(
              `${workItem.sourceConnectionId ?? ""}:${workItem.parentSourceId}`,
            )
          : false)
      ) {
        removedIds.add(workItem._id);
        if (workItem.sourceId) {
          removedSourceIds.add(
            `${workItem.sourceConnectionId ?? ""}:${workItem.sourceId}`,
          );
        }
        foundDescendant = true;
      }
    }
  }
  return {
    ...state,
    workItems: state.workItems.filter(
      (workItem) => !removedIds.has(workItem._id),
    ),
  };
}

function updateEstimateField(
  state: LocalAppState,
  workItemId: string,
  updater: (workItem: LocalWorkItem) => LocalWorkItem,
) {
  return {
    ...state,
    workItems: state.workItems.map((workItem) =>
      workItem._id === workItemId ? updater(workItem) : workItem,
    ),
  };
}

export function keepLocalEstimateConflict(
  state: LocalAppState,
  workItemId: string,
  fieldKey: LocalWorkItemEstimateFieldKey,
): LocalAppState {
  return updateEstimateField(state, workItemId, (workItem) => ({
    ...workItem,
    estimateSync: {
      ...workItem.estimateSync,
      [fieldKey]: {
        ...workItem.estimateSync?.[fieldKey],
        resolution: "keep_local",
        error: undefined,
      },
    },
  }));
}

export function acceptRemoteEstimateValue(
  state: LocalAppState,
  workItemId: string,
  fieldKey: LocalWorkItemEstimateFieldKey,
): LocalAppState {
  return updateEstimateField(state, workItemId, (workItem) => {
    const fieldState = workItem.estimateSync?.[fieldKey];
    if (!fieldState) {
      return workItem;
    }
    const remoteValue = fieldState.conflict
      ? fieldState.conflict.remoteValue
      : fieldState.remoteValue;

    return {
      ...workItem,
      [fieldKey]: remoteValue,
      estimateSync: {
        ...workItem.estimateSync,
        [fieldKey]: {
          ...fieldState,
          baselineValue: remoteValue,
          remoteValue,
          resolution: undefined,
          conflict: undefined,
          error: undefined,
        },
      },
    };
  });
}

export function dismissEstimateIssue(
  state: LocalAppState,
  workItemId: string,
  fieldKey: LocalWorkItemEstimateFieldKey,
): LocalAppState {
  return updateEstimateField(state, workItemId, (workItem) => {
    const fieldState = workItem.estimateSync?.[fieldKey];

    return {
      ...workItem,
      estimateSync: {
        ...workItem.estimateSync,
        [fieldKey]: {
          ...fieldState,
          baselineValue:
            workItem[fieldKey] === fieldState?.remoteValue
              ? fieldState?.remoteValue
              : fieldState?.baselineValue,
          resolution: undefined,
          conflict: undefined,
          error: undefined,
        },
      },
    };
  });
}
