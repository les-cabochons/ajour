import type { LocalProjectTask } from "@/domain/local-state";

/*
 * Every open task of a managed project is selectable, but the task menu and
 * the task pickers put the ones the source assigns to the user first. The
 * others say "Not assigned". A task the source doesn't know, such as a local
 * one, keeps its place.
 */

/** Whether the task's project source assigns it to someone else. */
export function isTaskNotAssigned(task: Pick<LocalProjectTask, "source">) {
  return task.source?.assigned === false;
}

/**
 * The tasks with the Not assigned ones last. Each group keeps its order, so
 * a list without them is returned as it was.
 */
export function sortAssignedTasksFirst<
  Task extends Pick<LocalProjectTask, "source">,
>(tasks: readonly Task[]): Task[] {
  const notAssigned = tasks.filter(isTaskNotAssigned);
  if (notAssigned.length === 0) return [...tasks];
  return [...tasks.filter((task) => !isTaskNotAssigned(task)), ...notAssigned];
}
