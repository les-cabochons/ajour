import { describe, expect, it } from "vitest";
import type { LocalProject, LocalProjectTask } from "@/domain/local-state";
import {
  findMatchingProjects,
  findMatchingProjectTasks,
  findMatchingTasksInProject,
} from "./project-task-search";

function createTask(
  id: string,
  name: string,
  status: LocalProjectTask["status"] = "active",
): LocalProjectTask {
  return {
    _id: id,
    name,
    status,
    createdAt: 1,
    billable: true,
  };
}

function createProject(
  id: string,
  name: string,
  code: string,
  tasks: LocalProjectTask[],
  status: LocalProject["status"] = "active",
): LocalProject {
  return {
    _id: id,
    name,
    displayName: name,
    code,
    color: "#1f7667",
    icon: { kind: "preset", name: "dot" },
    status,
    tasks,
  };
}

const projects = [
  createProject("project-aaa", "aaa xyz", "AAA", [
    createTask("task-111", "111 000"),
    createTask("task-222-aaa", "222 000"),
    createTask("task-archived", "555 000", "archived"),
  ]),
  createProject("project-bbb", "bbb zyx", "BBB", [
    createTask("task-222-bbb", "222 000"),
    createTask("task-333", "333 000"),
  ]),
  createProject(
    "project-archived",
    "archived project",
    "OLD",
    [createTask("task-old", "222 000")],
    "archived",
  ),
];

describe("project and task search", () => {
  it("matches projects by normalized, order-independent terms", () => {
    expect(findMatchingProjects(projects, "XYZ aaa").map((project) => project._id)).toEqual([
      "project-aaa",
    ]);
  });

  it("finds a task from mixed project and task terms in either order", () => {
    expect(
      findMatchingProjectTasks(projects, "aaa 222").matches.map(
        ({ project, task }) => [project._id, task._id],
      ),
    ).toEqual([["project-aaa", "task-222-aaa"]]);

    expect(
      findMatchingProjectTasks(projects, "222 aaa").matches.map(
        ({ project, task }) => [project._id, task._id],
      ),
    ).toEqual([["project-aaa", "task-222-aaa"]]);
  });

  it("does not expand every task when the query only matches a project", () => {
    expect(findMatchingProjectTasks(projects, "aaa")).toEqual({
      matches: [],
      total: 0,
    });
  });

  it("returns task-name matches across projects and excludes archived records", () => {
    expect(
      findMatchingProjectTasks(projects, "222").matches.map(
        ({ project, task }) => [project._id, task._id],
      ),
    ).toEqual([
      ["project-aaa", "task-222-aaa"],
      ["project-bbb", "task-222-bbb"],
    ]);
  });

  it("filters tasks after drilling into a project", () => {
    expect(
      findMatchingTasksInProject(projects[0]!, "111").map((task) => task._id),
    ).toEqual(["task-111"]);
  });

  it("caps broad task results while retaining the total", () => {
    const manyTasks = createProject(
      "project-many",
      "Large project",
      "BIG",
      Array.from({ length: 55 }, (_, index) =>
        createTask(`task-${index}`, `Common task ${index}`),
      ),
    );

    const results = findMatchingProjectTasks([manyTasks], "common", 10);

    expect(results.matches).toHaveLength(10);
    expect(results.total).toBe(55);
  });
});
