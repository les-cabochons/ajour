import { describe, expect, it } from "vitest";
import type { LocalProject } from "@/domain/local-state";
import {
  addProject,
  addProjectTask,
  createProject,
  normalizeProject,
  reorderProjects,
  reorderProjectTask,
  setProjectTaskStatus,
  updateProjectTask,
  type ProjectFactories,
} from "@/domain/projects/project-transitions";

function createFactories(): ProjectFactories {
  let nextId = 1;

  return {
    createId: (prefix) => `${prefix}-${nextId++}`,
    now: () => 500,
  };
}

function createFixtureProject(
  id: string,
  taskStatuses: Array<"active" | "archived"> = ["active"],
): LocalProject {
  return {
    _id: id,
    name: id,
    displayName: id,
    color: "#123456",
    icon: { kind: "preset", name: "dot" },
    status: "active",
    tasks: taskStatuses.map((status, index) => ({
      _id: `${id}-task-${index + 1}`,
      name: `Task ${index + 1}`,
      status,
      createdAt: 100 + index,
      archivedAt: status === "archived" ? 200 + index : undefined,
      billable: true,
    })),
  };
}

describe("project creation and hydration", () => {
  it("normalizes a project and its tasks when creating it", () => {
    const project = createProject(
      {
        name: "  Mercury  ",
        displayName: "  Mercury Client  ",
        color: "#123456",
        tasks: [
          {
            name: "Build",
            status: "archived",
            billable: false,
            budgetMs: -1,
            adjustmentMs: 1.4,
          },
        ],
      },
      createFactories(),
    );

    expect(project).toMatchObject({
      _id: "project-1",
      name: "Mercury",
      displayName: "Mercury Client",
      status: "active",
      tasks: [
        {
          _id: "task-2",
          status: "archived",
          createdAt: 500,
          archivedAt: 500,
          billable: false,
          budgetMs: undefined,
          adjustmentMs: 1,
        },
      ],
    });
  });

  it("preserves an imported project status", () => {
    expect(
      createProject(
        {
          name: "Archived",
          color: "#123456",
          status: "archived",
        },
        createFactories(),
      ).status,
    ).toBe("archived");
  });

  it("hydrates legacy task defaults with one stable timestamp", () => {
    const legacy = createFixtureProject("project-1");
    const task = legacy.tasks[0]!;
    delete (task as Partial<typeof task>).createdAt;
    task.status = "archived";
    task.archivedAt = undefined;
    task.billable = undefined;

    expect(normalizeProject(legacy, () => 700).tasks[0]).toMatchObject({
      createdAt: 700,
      archivedAt: 700,
      billable: true,
    });
  });

  it("hydrates missing project status and clears stale active archive dates", () => {
    const legacy = createFixtureProject("project-1");
    delete (legacy as Partial<typeof legacy>).status;
    legacy.tasks[0]!.archivedAt = 200;

    const normalized = normalizeProject(legacy, () => 700);

    expect(normalized.status).toBe("active");
    expect(normalized.tasks[0]?.archivedAt).toBeUndefined();
  });

  it("returns the created project ID with the updated collection", () => {
    const operation = addProject(
      [],
      { name: "Mercury", color: "#123456" },
      createFactories(),
    );

    expect(operation.result).toBe("project-1");
    expect(operation.projects[0]?.name).toBe("Mercury");
  });
});

describe("project ordering", () => {
  it("reorders only selected project slots", () => {
    const projects = [
      createFixtureProject("one"),
      createFixtureProject("fixed"),
      createFixtureProject("two"),
    ];

    expect(
      reorderProjects(projects, ["two", "one"]).map(({ _id }) => _id),
    ).toEqual(["two", "fixed", "one"]);
  });

  it("rejects an incomplete project order", () => {
    const projects = [createFixtureProject("one"), createFixtureProject("two")];

    expect(reorderProjects(projects, ["two", "missing"])).toBe(projects);
  });
});

describe("project task lifecycle", () => {
  it("adds a task with canonical defaults", () => {
    const project = createFixtureProject("project-1", []);
    const [updated] = addProjectTask(
      [project],
      project._id,
      "Build",
      createFactories(),
    );

    expect(updated?.tasks[0]).toMatchObject({
      _id: "task-1",
      name: "Build",
      status: "active",
      billable: true,
      createdAt: 500,
    });
  });

  it("reorders active tasks and keeps archived tasks after them", () => {
    const project = createFixtureProject("project-1", [
      "active",
      "archived",
      "active",
    ]);

    const [updated] = reorderProjectTask(
      [project],
      project._id,
      "project-1-task-3",
      0,
    );

    expect(updated?.tasks.map(({ _id }) => _id)).toEqual([
      "project-1-task-3",
      "project-1-task-1",
      "project-1-task-2",
    ]);
  });

  it("rejects non-integer task positions", () => {
    const project = createFixtureProject("project-1", ["active", "active"]);
    const projects = [project];

    expect(
      reorderProjectTask(
        projects,
        project._id,
        project.tasks[0]!._id,
        Number.NaN,
      ),
    ).toEqual(projects);
    expect(
      reorderProjectTask(projects, project._id, project.tasks[0]!._id, 0.5),
    ).toEqual(projects);
  });

  it("normalizes editable task values without overwriting omitted fields", () => {
    const project = createFixtureProject("project-1");
    project.tasks[0]!.budgetMs = 100;
    project.tasks[0]!.adjustmentMs = 20;

    const [updated] = updateProjectTask(
      [project],
      project._id,
      project.tasks[0]!._id,
      {
        billable: undefined,
        budgetMs: -1,
        adjustmentMs: 12.6,
      },
    );

    expect(updated?.tasks[0]).toMatchObject({
      name: "Task 1",
      billable: true,
      budgetMs: undefined,
      adjustmentMs: 13,
    });
  });

  it("archives once and clears the timestamp when restored", () => {
    const project = createFixtureProject("project-1");
    const taskId = project.tasks[0]!._id;
    const [archived] = setProjectTaskStatus(
      [project],
      project._id,
      taskId,
      "archived",
      () => 800,
    );
    const [archivedAgain] = setProjectTaskStatus(
      [archived!],
      project._id,
      taskId,
      "archived",
      () => 900,
    );
    const [restored] = setProjectTaskStatus(
      [archivedAgain!],
      project._id,
      taskId,
      "active",
      () => 1_000,
    );

    expect(archivedAgain?.tasks[0]?.archivedAt).toBe(800);
    expect(restored?.tasks[0]).toMatchObject({
      status: "active",
      archivedAt: undefined,
    });
  });
});
