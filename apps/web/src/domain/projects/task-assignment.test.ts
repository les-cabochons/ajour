import { describe, expect, it } from "vitest";
import type { LocalProjectTask } from "@/domain/local-state";
import {
  isTaskAssignedToUser,
  sortAssignedTasksFirst,
} from "@/domain/projects/task-assignment";

function task(
  name: string,
  source?: LocalProjectTask["source"],
): LocalProjectTask {
  return { _id: name, name, status: "active", createdAt: 1, source };
}

const login = task("Ticket #101 - Login", { remoteId: "1001", assigned: true });
const exportTask = task("Ticket #102 - Export", {
  remoteId: "1002",
  assigned: false,
});
const review = task("Review", { remoteId: "1004", assigned: true });
const mine = task("Ad hoc support");

describe("tasks a project source assigns to the user", () => {
  it("says a task is assigned to the user only when its source says so", () => {
    expect(isTaskAssignedToUser(login)).toBe(true);
    expect(isTaskAssignedToUser(exportTask)).toBe(false);
    expect(isTaskAssignedToUser(mine)).toBe(false);
  });

  it("puts the tasks assigned to the user first, each group keeping its order", () => {
    expect(
      sortAssignedTasksFirst([exportTask, mine, login, review]).map(
        ({ name }) => name,
      ),
    ).toEqual([
      "Ticket #101 - Login",
      "Review",
      "Ticket #102 - Export",
      "Ad hoc support",
    ]);
  });

  it("leaves a local project's tasks in their order", () => {
    const tasks = [task("B"), task("A"), task("C")];
    expect(sortAssignedTasksFirst(tasks)).toEqual(tasks);
  });
});
