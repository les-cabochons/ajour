import type { SearchableSelectOption } from "@/components/ui/searchable-select";
import type { LocalProjectTask } from "@/domain/local-state";
import {
  isTaskNotAssigned,
  sortAssignedTasksFirst,
} from "@/domain/projects/task-assignment";

/** The muted hint on a task its project source assigns to someone else. */
export const NOT_ASSIGNED_HINT = "Not assigned";

export function isProjectTaskBillable(
  task: Pick<LocalProjectTask, "billable">,
): boolean {
  return task.billable ?? true;
}

export function getProjectTaskBillableGroupLabel(
  task: Pick<LocalProjectTask, "billable">,
) {
  return isProjectTaskBillable(task) ? "Billable" : "Non-billable";
}

export function getProjectTaskBillableValueLabel(
  task: Pick<LocalProjectTask, "billable">,
) {
  return isProjectTaskBillable(task) ? "Billable" : "Non-billable";
}

/** A task picker's options: the active tasks, Not assigned ones last in their group. */
export function buildProjectTaskOptions(
  tasks: LocalProjectTask[],
): SearchableSelectOption[] {
  return sortAssignedTasksFirst(
    tasks.filter((task) => task.status === "active"),
  ).map((task) => {
    const isBillable = isProjectTaskBillable(task);
    return {
      value: task._id,
      label: task.name,
      group: isBillable ? "Billable" : "Non-billable",
      keywords: isBillable
        ? [task.name, "billable"]
        : [task.name, "non-billable", "non billable"],
      ...(isTaskNotAssigned(task) ? { hint: NOT_ASSIGNED_HINT } : {}),
    };
  });
}
