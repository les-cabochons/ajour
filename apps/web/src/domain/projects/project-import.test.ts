import { describe, expect, it } from "vitest";
import type {
  LocalProject,
  LocalProjectDraft,
  LocalProjectTask,
  LocalProjectTaskDraft,
} from "@/domain/local-state";
import { DEFAULT_PROJECT_ICON } from "@/domain/projects/project-icon";
import {
  importProjectDataShapeProjects,
  importProjectDataShapeTasks,
  importProjectTasks,
  importProjectWorkbookRows,
} from "@/domain/projects/project-import";

function createFactories() {
  let nextId = 1;

  const createTask = (draft: LocalProjectTaskDraft): LocalProjectTask => ({
    _id: `task-${nextId++}`,
    name: draft.name,
    status: draft.status ?? "active",
    createdAt: 100,
    archivedAt: draft.status === "archived" ? 100 : undefined,
    billable: draft.billable ?? true,
    budgetMs: draft.budgetMs,
    adjustmentMs: draft.adjustmentMs,
  });

  const createProject = (draft: LocalProjectDraft): LocalProject => ({
    _id: `project-${nextId++}`,
    name: draft.name,
    displayName: draft.displayName ?? draft.name,
    code: draft.code,
    color: draft.color,
    icon: DEFAULT_PROJECT_ICON,
    status: draft.status ?? "active",
    tasks: (draft.tasks ?? []).map(createTask),
  });

  return {
    createProject,
    createTask,
    now: () => 500,
  };
}

describe("importProjectTasks", () => {
  it("adds normalized unique names and reports duplicates", () => {
    const project = createFactories().createProject({
      name: "Mercury",
      color: "#123456",
      tasks: [{ name: "Design" }],
    });

    const operation = importProjectTasks(
      [project],
      project._id,
      [" Build ", "build", "Désign", ""],
      createFactories(),
    );

    expect(operation.result).toEqual({
      importedCount: 1,
      duplicateCount: 2,
      blankCount: 1,
      headerCount: 0,
      importedNames: ["Build"],
    });
    expect(operation.projects[0]?.tasks.map((task) => task.name)).toEqual([
      "Design",
      "Build",
    ]);
  });

  it("rejects an unknown project", () => {
    expect(() =>
      importProjectTasks([], "missing", ["Build"], createFactories()),
    ).toThrow("Project not found.");
  });
});

describe("importProjectWorkbookRows", () => {
  it("merges matching projects and creates missing projects deterministically", () => {
    const factories = createFactories();
    const existingProject = factories.createProject({
      name: "Mercury",
      color: "#123456",
      tasks: [{ name: "Design", budgetMs: 60 * 60 * 1000 }],
    });

    const operation = importProjectWorkbookRows(
      [existingProject],
      [
        {
          project: "Mércury",
          code: "MER",
          color: "#654321",
          status: "archived",
          task: "Design",
          taskStatus: "archived",
          billable: "non_billable",
          budgetHours: 2,
          adjustmentHours: -0.5,
        },
        {
          project: "Gemini",
          code: "",
          color: "",
          status: "active",
          task: "Build",
          taskStatus: "active",
          billable: "billable",
          budgetHours: "",
          adjustmentHours: "",
        },
      ],
      factories,
    );

    expect(operation.result).toEqual({
      createdProjectCount: 1,
      mergedProjectCount: 1,
      addedTaskCount: 1,
      updatedTaskCount: 1,
    });
    expect(operation.projects).toHaveLength(2);
    expect(operation.projects[0]).toMatchObject({
      name: "Mércury",
      code: "MER",
      color: "#654321",
      status: "archived",
      tasks: [
        {
          name: "Design",
          status: "archived",
          archivedAt: 500,
          billable: false,
          budgetMs: 2 * 60 * 60 * 1000,
          adjustmentMs: -30 * 60 * 1000,
        },
      ],
    });
    expect(operation.projects[1]).toMatchObject({
      name: "Gemini",
      color: "#3d5a80",
      status: "active",
      tasks: [{ name: "Build" }],
    });
  });
});

describe("importProjectDataShapeProjects", () => {
  it("refuses a file that doesn't name its project", () => {
    expect(() =>
      importProjectDataShapeProjects(
        [],
        [{ status: "active", tasks: [{ name: "Build" }] }],
        createFactories(),
      ),
    ).toThrow("This file doesn't name its project.");
  });
});

describe("importProjectDataShapeTasks", () => {
  function workdayProject() {
    return createFactories().createProject({
      name: "Peoples Group - Support",
      color: "#123456",
      tasks: [
        { name: "Support", billable: true },
        { name: "Old ticket", status: "archived" },
        { name: "Mine only", status: "archived" },
      ],
    });
  }

  it("adds new tasks and updates known ones by name, keeping what the file leaves out", () => {
    const project = workdayProject();
    const factories = createFactories();

    const operation = importProjectDataShapeTasks(
      [project],
      project._id,
      [
        {
          status: "active",
          tasks: [
            { name: " support ", billable: false },
            { name: "Old ticket" },
            { name: "Mine only" },
            { name: "Billet 101", budgetMs: 7_200_000 },
            { name: "Billet 102", status: "archived" },
            { name: "Billet 101", billable: false },
          ],
        },
      ],
      factories,
    );

    expect(operation.result).toEqual({
      addedTaskCount: 2,
      updatedTaskCount: 1,
    });
    expect(
      operation.projects[0]!.tasks.map(
        ({ name, status, billable, budgetMs }) => ({
          name,
          status,
          billable,
          budgetMs,
        }),
      ),
    ).toEqual([
      {
        name: "Support",
        status: "active",
        billable: false,
        budgetMs: undefined,
      },
      {
        name: "Old ticket",
        status: "archived",
        billable: true,
        budgetMs: undefined,
      },
      {
        name: "Mine only",
        status: "archived",
        billable: true,
        budgetMs: undefined,
      },
      {
        name: "Billet 101",
        status: "active",
        billable: false,
        budgetMs: 7_200_000,
      },
      {
        name: "Billet 102",
        status: "archived",
        billable: true,
        budgetMs: undefined,
      },
    ]);
  });

  it("accepts the project's own name, and refuses another project's file", () => {
    const project = workdayProject();

    expect(
      importProjectDataShapeTasks(
        [project],
        project._id,
        [
          {
            name: "peoples group -  support",
            status: "active",
            tasks: [{ name: "Billet 101" }],
          },
        ],
        createFactories(),
      ).result.addedTaskCount,
    ).toBe(1);
    expect(() =>
      importProjectDataShapeTasks(
        [project],
        project._id,
        [{ name: "Mercury", status: "active", tasks: [] }],
        createFactories(),
      ),
    ).toThrow("This file is for Mercury, not Peoples Group - Support.");
  });

  it("refuses a file with several projects", () => {
    const project = workdayProject();

    expect(() =>
      importProjectDataShapeTasks(
        [project],
        project._id,
        [
          { name: "A", status: "active", tasks: [] },
          { name: "B", status: "active", tasks: [] },
        ],
        createFactories(),
      ),
    ).toThrow("This file holds 2 projects.");
  });
});
