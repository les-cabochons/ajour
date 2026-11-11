import type { LocalAppState } from "@/domain/local-state";

/**
 * The references in the state that point at a record the state does not hold:
 * a subitem whose parent is gone, an entry whose project, task or backlog
 * item is gone, and the like. Each is a string naming the record and the
 * link, so two states compare by set difference.
 */
export function findBrokenReferences(state: LocalAppState): Set<string> {
  const workItemIds = new Set(state.workItems.map((item) => item._id));
  const projectIds = new Set(state.projects.map((project) => project._id));
  const taskIds = new Set(
    state.projects.flatMap((project) => project.tasks.map((task) => task._id)),
  );
  const workflowStateIds = new Set(
    (state.workflowStates ?? []).map((status) => status._id),
  );
  const broken = new Set<string>();
  const check = (
    owner: string,
    link: string,
    target: string | undefined,
    known: ReadonlySet<string>,
  ) => {
    if (target !== undefined && !known.has(target)) {
      broken.add(`${owner}:${link}:${target}`);
    }
  };

  for (const item of state.workItems) {
    const owner = `workItem:${item._id}`;
    check(owner, "parent", item.parentWorkItemId, workItemIds);
    check(owner, "project", item.projectId, projectIds);
    check(owner, "task", item.taskId, taskIds);
    check(owner, "status", item.workflowStateId, workflowStateIds);
  }
  for (const entry of state.timesheetEntries) {
    const owner = `entry:${entry._id}`;
    check(owner, "workItem", entry.workItemId, workItemIds);
    check(owner, "project", entry.projectId, projectIds);
    check(owner, "task", entry.taskId, taskIds);
  }
  for (const timer of state.timers) {
    const owner = `timer:${timer._id}`;
    check(owner, "workItem", timer.workItemId, workItemIds);
    check(owner, "project", timer.projectId, projectIds);
    check(owner, "task", timer.taskId, taskIds);
  }
  return broken;
}

/** Whether the second state breaks a reference that the first kept whole. */
export function breaksReferences(
  before: LocalAppState,
  after: LocalAppState,
): boolean {
  const alreadyBroken = findBrokenReferences(before);
  for (const reference of findBrokenReferences(after)) {
    if (!alreadyBroken.has(reference)) return true;
  }
  return false;
}
