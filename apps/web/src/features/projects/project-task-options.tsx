import type { SearchableSelectOption } from "@/components/ui/searchable-select";
import type { LocalProjectTask } from "@/domain/local-state";
import {
  isTaskAssignedToUser,
  sortAssignedTasksFirst,
} from "@/domain/projects/task-assignment";
import { AssignedToYouMark } from "@/features/projects/assigned-to-you-mark";

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

/**
 * A task picker's options: the active tasks, the ones assigned to the user
 * first in their group, each with the Assigned to you icon.
 */
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
      ...(isTaskAssignedToUser(task) ? { mark: <AssignedToYouMark /> } : {}),
    };
  });
}
