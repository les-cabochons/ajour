/**
 * Which object has keyboard focus. Rows, cards and headers that show an object
 * carry its id in a data attribute, so app-wide commands such as the command
 * palette can act on the focused object without knowing the page. Focus on any
 * control inside the element counts, such as a row's "…" button.
 *
 * - Day rows and Week cards: `data-entry-id`, plus `data-running-entry="true"`
 *   on the running entry, whose id is not a saved entry's.
 * - Backlog rows: `data-backlog-item-id`.
 * - Task rows: `data-task-id`, inside an element with `data-project-id`.
 * - Project sidebar rows and the project page: `data-project-id`.
 */
export const FOCUS_ATTRIBUTES = {
  entry: "data-entry-id",
  runningEntry: "data-running-entry",
  backlogItem: "data-backlog-item-id",
  task: "data-task-id",
  project: "data-project-id",
} as const;

export type FocusedObjectRef =
  | { kind: "time-entry"; entryId: string; isRunning: boolean }
  | { kind: "backlog-item"; workItemId: string }
  | { kind: "task"; projectId: string; taskId: string }
  | { kind: "project"; projectId: string };

/** Only what the resolver reads from a DOM element, so it runs in unit tests without a DOM. */
export interface FocusableElement {
  closest(selector: string): FocusableElement | null;
  getAttribute(name: string): string | null;
}

const OBJECT_SELECTOR = [
  FOCUS_ATTRIBUTES.entry,
  FOCUS_ATTRIBUTES.backlogItem,
  FOCUS_ATTRIBUTES.task,
  FOCUS_ATTRIBUTES.project,
]
  .map((attribute) => `[${attribute}]`)
  .join(", ");

/**
 * The object whose element contains `element`, the nearest one when they nest,
 * such as a task row inside its project page. Returns null when focus is on no
 * object, or on the body.
 */
export function resolveFocusedObject(
  element: FocusableElement | null | undefined,
): FocusedObjectRef | null {
  const owner = element?.closest(OBJECT_SELECTOR);
  if (!owner) {
    return null;
  }

  const entryId = owner.getAttribute(FOCUS_ATTRIBUTES.entry);
  if (entryId !== null) {
    return {
      kind: "time-entry",
      entryId,
      isRunning: owner.getAttribute(FOCUS_ATTRIBUTES.runningEntry) === "true",
    };
  }

  const workItemId = owner.getAttribute(FOCUS_ATTRIBUTES.backlogItem);
  if (workItemId) {
    return { kind: "backlog-item", workItemId };
  }

  const taskId = owner.getAttribute(FOCUS_ATTRIBUTES.task);
  if (taskId) {
    const projectId = owner
      .closest(`[${FOCUS_ATTRIBUTES.project}]`)
      ?.getAttribute(FOCUS_ATTRIBUTES.project);
    return projectId ? { kind: "task", projectId, taskId } : null;
  }

  const projectId = owner.getAttribute(FOCUS_ATTRIBUTES.project);
  return projectId ? { kind: "project", projectId } : null;
}
