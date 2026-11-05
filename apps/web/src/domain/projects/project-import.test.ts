import { describe, expect, it } from "vitest";
import type {
  LocalProject,
  LocalProjectDraft,
  LocalProjectTask,
  LocalProjectTaskDraft,
} from "@/domain/local-state";
import { DEFAULT_PROJECT_ICON } from "@/domain/projects/project-icon";
import {
  applyWaitingTaskAnswers,
  findWaitingTaskChoices,
  importProjectDataShapeProjects,
  importProjectDataShapeTasks,
  importProjectTasks,
  importProjectWorkbookRows,
} from "@/domain/projects/project-import";
import { createOrRestoreProjectTask } from "@/domain/projects/project-transitions";

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
      confirmedWaitingCount: 0,
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
    ).toThrow(
      expect.objectContaining({
        message: "This file is for another project.",
        fileProjectName: "Mercury",
      }),
    );
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

describe("a task created from a picker, then imported", () => {
  it("is updated by a later import of the same name, in any case or accents", () => {
    const factories = createFactories();
    const project = factories.createProject({
      name: "Acme",
      color: "#123456",
    });
    const created = createOrRestoreProjectTask(
      [project],
      project._id,
      { name: "  07   Run ", commitAs: "waiting" },
      { createId: (prefix) => `${prefix}-created`, now: () => 1 },
    );
    expect(created.projects[0]!.tasks[0]).toMatchObject({
      _id: "task-created",
      name: "07 Run",
    });

    const operation = importProjectDataShapeTasks(
      created.projects,
      project._id,
      [{ status: "active", tasks: [{ name: "07 rün", billable: false }] }],
      factories,
    );
    expect(operation.result).toEqual({
      addedTaskCount: 0,
      updatedTaskCount: 1,
    });
    expect(operation.projects[0]!.tasks).toEqual([
      expect.objectContaining({
        _id: "task-created",
        name: "07 Run",
        billable: false,
      }),
    ]);
    // The file has the task, so it is no longer Not known yet.
    expect(operation.projects[0]!.tasks[0]!.commitAs).toBeUndefined();

    const columnC = importProjectTasks(
      created.projects,
      project._id,
      ["07 RUN"],
      factories,
    );
    expect(columnC.result.importedCount).toBe(0);
  });
});

describe("Not known yet tasks at import", () => {
  function project(): LocalProject {
    return {
      _id: "acme",
      name: "Acme",
      color: "#123456",
      icon: DEFAULT_PROJECT_ICON,
      status: "active",
      tasks: [
        { _id: "build", name: "05 Build", status: "active", createdAt: 1 },
        {
          _id: "temp",
          name: "Temp migration",
          status: "active",
          createdAt: 1,
          commitAs: "waiting",
        },
        {
          _id: "lunch",
          name: "Team lunch",
          status: "active",
          createdAt: 1,
          commitAs: "local",
        },
      ],
    };
  }

  it("asks only about waiting tasks the file doesn't name, with its new names closest first", () => {
    expect(
      findWaitingTaskChoices(project(), [
        "05 Build",
        "07 Run",
        "08 Migration",
        "08 migration",
      ]),
    ).toEqual([
      {
        taskId: "temp",
        name: "Temp migration",
        newNames: ["08 Migration", "07 Run"],
      },
    ]);
  });

  it("asks nothing when the file adds no task or names the waiting one", () => {
    expect(findWaitingTaskChoices(project(), ["05 Build"])).toEqual([]);
    expect(
      findWaitingTaskChoices(project(), ["temp MIGRATION", "07 Run"]),
    ).toEqual([]);
  });

  it("renames a matched task before the merge, which updates it and counts the change", () => {
    const factories = createFactories();
    const answered = applyWaitingTaskAnswers([project()], "acme", {
      temp: {
        kind: "rename",
        name: "08 Migration",
        expectedName: "Temp migration",
      },
    });
    expect(answered.matchedCount).toBe(1);
    const operation = importProjectDataShapeTasks(
      answered.projects,
      "acme",
      [{ status: "active", tasks: [{ name: "08 Migration" }] }],
      factories,
    );
    expect(operation.result).toEqual({
      addedTaskCount: 0,
      updatedTaskCount: 1,
    });
    const temp = operation.projects[0]!.tasks.find(
      (task) => task._id === "temp",
    );
    expect(temp).toMatchObject({ name: "08 Migration" });
    expect(temp!.commitAs).toBeUndefined();
  });

  it("makes a task local, leaves one waiting, and never renames onto a taken name", () => {
    const expectedName = "Temp migration";
    const local = applyWaitingTaskAnswers([project()], "acme", {
      temp: { kind: "local", expectedName },
    }).projects[0]!.tasks[1]!;
    expect(local.commitAs).toBe("local");
    const waiting = applyWaitingTaskAnswers([project()], "acme", {
      temp: { kind: "wait", expectedName },
    }).projects[0]!.tasks[1]!;
    expect(waiting).toEqual(project().tasks[1]);
    const clash = applyWaitingTaskAnswers([project()], "acme", {
      temp: { kind: "rename", name: "05 build", expectedName },
      lunch: { kind: "rename", name: "07 Run", expectedName: "Team lunch" },
    });
    expect(clash.matchedCount).toBe(0);
    expect(clash.projects[0]!.tasks[1]).toEqual(project().tasks[1]);
    // Only Not known yet tasks take an answer.
    expect(clash.projects[0]!.tasks[2]).toEqual(project().tasks[2]);
  });

  it("ignores an answer about a task renamed or archived since the question", () => {
    const renamed = project();
    renamed.tasks[1]!.name = "Client incident";
    const afterRename = applyWaitingTaskAnswers([renamed], "acme", {
      temp: {
        kind: "rename",
        name: "08 Migration",
        expectedName: "Temp migration",
      },
    });
    expect(afterRename.matchedCount).toBe(0);
    expect(afterRename.projects[0]!.tasks[1]!.name).toBe("Client incident");

    const archived = project();
    archived.tasks[1]!.status = "archived";
    const afterArchive = applyWaitingTaskAnswers([archived], "acme", {
      temp: {
        kind: "rename",
        name: "08 Migration",
        expectedName: "Temp migration",
      },
    });
    expect(afterArchive.matchedCount).toBe(0);
    expect(afterArchive.projects[0]!.tasks[1]!.name).toBe("Temp migration");
  });

  it("confirms a waiting task the column C file names", () => {
    const operation = importProjectTasks(
      [project()],
      "acme",
      ["temp migration"],
      createFactories(),
    );
    expect(operation.projects[0]!.tasks[1]!.commitAs).toBeUndefined();
    expect(operation.result).toMatchObject({
      duplicateCount: 0,
      confirmedWaitingCount: 1,
    });
  });
});

describe("a managed project's import", () => {
  function managed() {
    const factories = createFactories();
    const project = factories.createProject({
      name: "Acme - Support",
      color: "#123456",
      tasks: [{ name: "Login", budgetMs: 3_600_000 }],
    });
    project.tasks[0]!.source = { remoteId: "1001", assigned: true };
    project.source = {
      pluginId: "example-planner",
      connectionId: "planner",
      remoteId: "ACME",
      syncedAt: 1,
    };
    return { factories, project };
  }

  it("refuses Import tasks…, which its source replaces", () => {
    const { factories, project } = managed();

    expect(() =>
      importProjectTasks([project], project._id, ["Extra"], factories),
    ).toThrow("takes its tasks from its source");
  });

  it("keeps a source task's status, billable and budget when a file names it", () => {
    const { factories, project } = managed();

    const operation = importProjectWorkbookRows(
      [project],
      [
        {
          project: "Acme - Support",
          code: "OTHER",
          color: "",
          status: "active",
          task: "Login",
          taskStatus: "archived",
          billable: "non_billable",
          budgetHours: 9,
          adjustmentHours: 1,
        },
      ],
      factories,
    );

    expect(operation.projects[0]).toMatchObject({
      name: "Acme - Support",
      tasks: [
        {
          status: "active",
          billable: true,
          budgetMs: 3_600_000,
          adjustmentMs: 3_600_000,
        },
      ],
    });
    expect(operation.projects[0]?.code).toBeUndefined();
  });

  it("keeps the status of a project its source archived when a file says active", () => {
    const { factories, project } = managed();
    const archived = {
      ...project,
      status: "archived" as const,
      archivedBySource: true as const,
    };

    const operation = importProjectWorkbookRows(
      [archived],
      [
        {
          project: "Acme - Support",
          code: "",
          color: "",
          status: "active",
          task: "Login",
          taskStatus: "",
          billable: "",
          budgetHours: "",
          adjustmentHours: "",
        },
      ],
      factories,
    );

    expect(operation.projects[0]).toMatchObject({
      status: "archived",
      archivedBySource: true,
    });
  });
});
