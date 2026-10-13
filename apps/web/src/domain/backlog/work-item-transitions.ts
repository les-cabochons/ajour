import type {
  BacklogSortMode,
  LocalAppState,
  LocalWorkItem,
  LocalWorkItemDraft,
  LocalWorkItemEstimateFieldKey,
  PersistedLocalWorkItem,
} from "@/domain/local-state";
import {
  assertValidParentWorkItem,
  inferInheritedParentMapping,
  isSubtaskWorkItem,
} from "@/domain/backlog/work-item-hierarchy";
import { normalizeWorkItemEstimateValue } from "@/domain/backlog/work-item-estimates";

export interface WorkItemFactories {
  createId: (prefix: string) => string;
  now: () => number;
}

export type WorkItemPatch = Partial<
  Omit<LocalWorkItem, "_id" | "createdAt" | "source">
>;

export function normalizeWorkItemPriority(priority?: number) {
  if (typeof priority !== "number" || !Number.isFinite(priority)) {
    return undefined;
  }

  return Math.max(0, Math.round(priority));
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
    ...persisted
  } = workItem;

  return {
    ...persisted,
    title: workItem.title.trim(),
    status,
    source: isRetiredBuiltInSource ? "manual" : (workItem.source ?? "manual"),
    sourceId: isRetiredBuiltInSource ? undefined : workItem.sourceId,
    sourceUrl: isRetiredBuiltInSource ? undefined : workItem.sourceUrl,
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
    priority: normalizeWorkItemPriority(workItem.priority),
    importedPriority: isRetiredBuiltInSource
      ? undefined
      : normalizeWorkItemPriority(workItem.importedPriority),
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
    priority: normalizeWorkItemPriority(workItem.priority),
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
    note: workItem.note?.trim() || undefined,
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
    ? normalizeWorkItemPriority(patch.priority)
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
    note:
      typeof patch.note === "string"
        ? patch.note.trim() || undefined
        : "note" in patch
          ? patch.note
          : target.note,
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
