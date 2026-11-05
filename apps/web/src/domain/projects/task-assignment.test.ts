import { describe, expect, it } from "vitest";
import type { LocalProjectTask } from "@/domain/local-state";
import {
  isTaskNotAssigned,
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
  it("says Not assigned only of a source task the source gives someone else", () => {
    expect(isTaskNotAssigned(exportTask)).toBe(true);
    expect(isTaskNotAssigned(login)).toBe(false);
    expect(isTaskNotAssigned(mine)).toBe(false);
  });

  it("puts the Not assigned tasks after the others, each keeping its order", () => {
    expect(
      sortAssignedTasksFirst([exportTask, mine, login, review]).map(
        ({ name }) => name,
      ),
    ).toEqual([
      "Ad hoc support",
      "Ticket #101 - Login",
      "Review",
      "Ticket #102 - Export",
    ]);
  });

  it("leaves a local project's tasks in their order", () => {
    const tasks = [task("B"), task("A"), task("C")];
    expect(sortAssignedTasksFirst(tasks)).toEqual(tasks);
  });
});
