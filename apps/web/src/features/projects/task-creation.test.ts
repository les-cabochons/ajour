import { describe, expect, it } from "vitest";
import type { LocalProject } from "@/domain/local-state";
import { describeCreateTaskRow } from "@/features/projects/task-creation";

const tasks: LocalProject["tasks"] = [
  { _id: "build", name: "05 Build", status: "active", createdAt: 1 },
  { _id: "old", name: "08 Old", status: "archived", createdAt: 1 },
];

describe("the create row of a task picker", () => {
  it("creates a name no task has, tidied", () => {
    expect(describeCreateTaskRow({ tasks }, "  07  Run ")).toBe(
      'Create task "07 Run"',
    );
  });

  it("shows nothing for an active task's name, which the list shows", () => {
    expect(describeCreateTaskRow({ tasks }, "05 build")).toBeNull();
    expect(describeCreateTaskRow({ tasks }, "   ")).toBeNull();
  });

  it("restores an archived task of the name", () => {
    expect(describeCreateTaskRow({ tasks }, "08 OLD")).toBe(
      'Restore task "08 Old"',
    );
  });

  it("says the team gets the task in a shared project", () => {
    expect(
      describeCreateTaskRow(
        { tasks, team: { connectionId: "team" } },
        "07 Run",
      ),
    ).toBe('Add task "07 Run" for the team…');
  });
});
