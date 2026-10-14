import type { LocalWorkItem } from "@/domain/local-state";

export function getWorkItemLookupKeys(workItem: LocalWorkItem) {
  const keys = [`local:${workItem._id}`];

  if (workItem.sourceId) {
    keys.push(`source:${workItem.sourceId}`);
  }

  return keys;
}

export function getWorkItemLookupKey(workItem: LocalWorkItem) {
  return workItem.sourceId
    ? `source:${workItem.sourceId}`
    : `local:${workItem._id}`;
}

export function getWorkItemParentKey(workItem: LocalWorkItem) {
  if (workItem.parentWorkItemId) {
    return `local:${workItem.parentWorkItemId}`;
  }

  if (workItem.parentSourceId) {
    return `source:${workItem.parentSourceId}`;
  }

  return null;
}

export function isSubtaskWorkItem(
  workItem: Pick<
    LocalWorkItem,
    "hierarchyLevel" | "parentWorkItemId" | "parentSourceId"
  >,
) {
  return Boolean(
    workItem.parentWorkItemId ||
    workItem.parentSourceId ||
    (workItem.hierarchyLevel ?? 0) > 0,
  );
}

interface ChildIndex {
  byParentKey: Map<string, LocalWorkItem[]>;
  positionById: Map<string, number>;
}

/**
 * Children grouped by the lookup key of their parent, built once per work item
 * list. The store replaces a list instead of editing it, so the list itself is
 * the cache key, and a list no longer held lets its index go.
 */
const childIndexes = new WeakMap<readonly LocalWorkItem[], ChildIndex>();

function indexChildren(workItems: readonly LocalWorkItem[]): ChildIndex {
  const cached = childIndexes.get(workItems);
  if (cached) {
    return cached;
  }

  const index: ChildIndex = { byParentKey: new Map(), positionById: new Map() };
  workItems.forEach((workItem, position) => {
    index.positionById.set(workItem._id, position);
    const parentKey = getWorkItemParentKey(workItem);
    if (!parentKey) {
      return;
    }

    const siblings = index.byParentKey.get(parentKey);
    if (siblings) {
      siblings.push(workItem);
    } else {
      index.byParentKey.set(parentKey, [workItem]);
    }
  });
  childIndexes.set(workItems, index);
  return index;
}

/** Newest first; children created at the same time keep their list order. */
export function getDirectChildWorkItems(
  workItem: LocalWorkItem,
  workItems: readonly LocalWorkItem[],
) {
  const index = indexChildren(workItems);

  return getWorkItemLookupKeys(workItem)
    .flatMap((key) => index.byParentKey.get(key) ?? [])
    .sort(
      (left, right) =>
        right.createdAt - left.createdAt ||
        index.positionById.get(left._id)! - index.positionById.get(right._id)!,
    );
}

function hasDirectChildWorkItems(
  workItems: LocalWorkItem[],
  target: LocalWorkItem,
) {
  return workItems.some(
    (candidate) =>
      candidate.parentWorkItemId === target._id ||
      (target.sourceId ? candidate.parentSourceId === target.sourceId : false),
  );
}

function resolveParentWorkItemId(
  workItem: LocalWorkItem,
  workItemsById: Map<string, LocalWorkItem>,
  workItemsBySourceId: Map<string, LocalWorkItem>,
) {
  if (workItem.parentWorkItemId) {
    return workItem.parentWorkItemId;
  }

  if (workItem.parentSourceId) {
    return workItemsBySourceId.get(workItem.parentSourceId)?._id;
  }

  return undefined;
}

export function assertValidParentWorkItem(
  workItems: LocalWorkItem[],
  workItemId: string,
  parentWorkItemId: string,
) {
  const target = workItems.find((workItem) => workItem._id === workItemId);
  if (!target) {
    throw new Error("Work item not found.");
  }

  const parent = workItems.find(
    (workItem) => workItem._id === parentWorkItemId,
  );
  if (!parent) {
    throw new Error("Parent work item not found.");
  }

  if (parent._id === workItemId) {
    throw new Error("A work item cannot be its own parent.");
  }

  if (isSubtaskWorkItem(parent)) {
    throw new Error("Subitems cannot have subitems.");
  }

  if (hasDirectChildWorkItems(workItems, target)) {
    throw new Error("Items with subitems cannot be nested.");
  }

  const workItemsById = new Map(
    workItems.map((workItem) => [workItem._id, workItem]),
  );
  const workItemsBySourceId = new Map(
    workItems
      .filter(
        (workItem): workItem is LocalWorkItem & { sourceId: string } =>
          typeof workItem.sourceId === "string",
      )
      .map((workItem) => [workItem.sourceId, workItem]),
  );

  let currentParent: LocalWorkItem | undefined = parent;

  while (currentParent) {
    if (currentParent._id === workItemId) {
      throw new Error(
        "A task cannot be nested under one of its own descendants.",
      );
    }

    const nextParentId = resolveParentWorkItemId(
      currentParent,
      workItemsById,
      workItemsBySourceId,
    );
    currentParent = nextParentId ? workItemsById.get(nextParentId) : undefined;
  }
}

function doesWorkItemMappingMatch(
  left: Pick<LocalWorkItem, "projectId" | "taskId">,
  right: Pick<LocalWorkItem, "projectId" | "taskId">,
) {
  return left.projectId === right.projectId && left.taskId === right.taskId;
}

export function inferInheritedParentMapping(
  workItem: Pick<
    LocalWorkItem,
    | "parentWorkItemId"
    | "parentSourceId"
    | "projectId"
    | "taskId"
    | "inheritsParentMapping"
  >,
  parent: Pick<LocalWorkItem, "projectId" | "taskId"> | undefined,
) {
  if ((!workItem.parentWorkItemId && !workItem.parentSourceId) || !parent) {
    return undefined;
  }

  if (typeof workItem.inheritsParentMapping === "boolean") {
    return workItem.inheritsParentMapping;
  }

  return (
    (!workItem.projectId && !workItem.taskId) ||
    doesWorkItemMappingMatch(workItem, parent)
  );
}
