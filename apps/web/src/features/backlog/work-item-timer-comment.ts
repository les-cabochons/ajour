import type { LocalWorkItem } from "@/domain/local-state";

/** Parsed once per source id: every synced backlog row shows its reference. */
const referencesBySourceId = new Map<string, string | undefined>();

export function parseWorkItemReference(sourceId?: string) {
  if (!sourceId) {
    return undefined;
  }

  if (referencesBySourceId.has(sourceId)) {
    return referencesBySourceId.get(sourceId);
  }

  const reference = parseReference(sourceId);
  referencesBySourceId.set(sourceId, reference);
  return reference;
}

function parseReference(sourceId: string) {
  try {
    const pathnameSegments = new URL(sourceId).pathname
      .split("/")
      .filter(Boolean);
    const reference = pathnameSegments.at(-1);
    return reference && /^\d+$/.test(reference) ? reference : undefined;
  } catch {
    const reference = sourceId.split("/").filter(Boolean).at(-1);
    return reference && /^\d+$/.test(reference) ? reference : undefined;
  }
}

export function buildWorkItemTimerComment(title: string, sourceId?: string) {
  const reference = parseWorkItemReference(sourceId);
  return [reference ? `#${reference}` : undefined, title.trim()]
    .filter(Boolean)
    .join(" ");
}

/**
 * What a new or running entry takes from a backlog item: the item, its project
 * and task mapping, and a note naming it. Start entry and New entry… use it on
 * the Backlog page and in the command palette.
 */
export function getWorkItemEntryValues(
  workItem: Pick<
    LocalWorkItem,
    "_id" | "title" | "sourceId" | "projectId" | "taskId"
  >,
) {
  return {
    workItemId: workItem._id,
    projectId: workItem.projectId,
    taskId: workItem.taskId,
    note: buildWorkItemTimerComment(workItem.title, workItem.sourceId),
  };
}
