import type { LocalProjectTask } from "@/domain/local-state";

/*
 * Every open task of a managed project is selectable. The task menu and the
 * task pickers put the ones the source assigns to the user first, and they
 * carry "Assigned to you" there and on the project page. A task the source
 * assigns to someone else, or doesn't know, such as a local one, has no mark.
 */

/** Whether the task's project source assigns it to the user. */
export function isTaskAssignedToUser(task: Pick<LocalProjectTask, "source">) {
  return task.source?.assigned === true;
}

/**
 * The tasks with the ones assigned to the user first. Each group keeps its
 * order, so a list without them is returned as it was.
 */
export function sortAssignedTasksFirst<
  Task extends Pick<LocalProjectTask, "source">,
>(tasks: readonly Task[]): Task[] {
  const assigned = tasks.filter(isTaskAssignedToUser);
  if (assigned.length === 0) return [...tasks];
  return [...assigned, ...tasks.filter((task) => !isTaskAssignedToUser(task))];
}
