import { describe, expect, it } from "vitest";
import type { LocalProject } from "@/domain/local-state";
import {
  addProject,
  addProjectTask,
  createProject,
  findPinnedTask,
  getFavorites,
  getPinnedTasksBySlot,
  normalizeProject,
  reorderProjects,
  reorderProjectTask,
  setProjectFavorite,
  setProjectTaskFavorite,
  setProjectTaskPinnedSlot,
  setProjectTaskStatus,
  updateProjectTask,
  type ProjectFactories,
} from "@/domain/projects/project-transitions";
import { getSharedTableStepOrder } from "@/lib/table-drag";

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

  it("keeps plugin property overrides and drops broken ones", () => {
    const normalized = normalizeProject(
      {
        ...createFixtureProject("project-1"),
        pluginProperties: {
          "workday-agent": { name: "Tech", code: 7 },
        } as never,
      },
      () => 1,
    );

    expect(normalized.pluginProperties).toEqual({
      "workday-agent": { name: "Tech" },
    });
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

  it("persists Move up among active projects like a drag", () => {
    const archived = { ...createFixtureProject("old"), status: "archived" };
    const projects = [
      createFixtureProject("one"),
      archived as LocalProject,
      createFixtureProject("two"),
    ];
    // The sidebar's order: active projects only.
    const activeIds = projects
      .filter((project) => project.status === "active")
      .map((project) => project._id);

    const next = getSharedTableStepOrder(activeIds, "two", -1);

    expect(
      reorderProjects(projects, next!.order).map(({ _id }) => _id),
    ).toEqual(["two", "old", "one"]);
    expect(getSharedTableStepOrder(activeIds, "one", -1)).toBeNull();
  });
});

describe("project task lifecycle", () => {
  it("adds a task with canonical defaults", () => {
    const project = createFixtureProject("project-1", []);
    const [updated] = addProjectTask(
      [project],
      project._id,
      { name: "Build" },
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

  it("adds a task with its billable flag, budget and adjustment", () => {
    const project = createFixtureProject("project-1", []);
    const [updated] = addProjectTask(
      [project],
      project._id,
      { name: "Review", billable: false, budgetMs: 7_200_000, adjustmentMs: 0 },
      createFactories(),
    );

    expect(updated?.tasks[0]).toMatchObject({
      name: "Review",
      billable: false,
      budgetMs: 7_200_000,
      adjustmentMs: undefined,
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

describe("pinned task slots", () => {
  function slotsOf(projects: LocalProject[]) {
    return projects.flatMap((project) =>
      project.tasks.map((task) => [task._id, task.pinnedSlot]),
    );
  }

  it("assigns a free slot to one task", () => {
    const projects = [createFixtureProject("alpha", ["active", "active"])];

    const pinned = setProjectTaskPinnedSlot(
      projects,
      "alpha",
      "alpha-task-2",
      "3",
    );

    expect(slotsOf(pinned)).toEqual([
      ["alpha-task-1", undefined],
      ["alpha-task-2", "3"],
    ]);
    expect(findPinnedTask(pinned, "3")?.task._id).toBe("alpha-task-2");
  });

  it("moves a taken slot to the new task, even across projects", () => {
    const projects = setProjectTaskPinnedSlot(
      [createFixtureProject("alpha"), createFixtureProject("beta")],
      "alpha",
      "alpha-task-1",
      "1",
    );

    const moved = setProjectTaskPinnedSlot(
      projects,
      "beta",
      "beta-task-1",
      "1",
    );

    expect(slotsOf(moved)).toEqual([
      ["alpha-task-1", undefined],
      ["beta-task-1", "1"],
    ]);
    expect(getPinnedTasksBySlot(moved).size).toBe(1);
  });

  it("frees the old slot when a task changes slot", () => {
    const projects = setProjectTaskPinnedSlot(
      [createFixtureProject("alpha")],
      "alpha",
      "alpha-task-1",
      "1",
    );

    const changed = setProjectTaskPinnedSlot(
      projects,
      "alpha",
      "alpha-task-1",
      "0",
    );

    expect(slotsOf(changed)).toEqual([["alpha-task-1", "0"]]);
    expect(findPinnedTask(changed, "1")).toBeUndefined();
  });

  it("clears a slot and leaves other tasks and projects untouched", () => {
    const beta = createFixtureProject("beta");
    const projects = setProjectTaskPinnedSlot(
      setProjectTaskPinnedSlot(
        [createFixtureProject("alpha", ["active", "active"]), beta],
        "alpha",
        "alpha-task-1",
        "1",
      ),
      "alpha",
      "alpha-task-2",
      "2",
    );

    const cleared = setProjectTaskPinnedSlot(
      projects,
      "alpha",
      "alpha-task-1",
      undefined,
    );

    expect(slotsOf(cleared)).toEqual([
      ["alpha-task-1", undefined],
      ["alpha-task-2", "2"],
      ["beta-task-1", undefined],
    ]);
    expect(cleared[1]).toBe(beta);
  });

  it("moves a slot saved with a task edit or a new task", () => {
    const projects = setProjectTaskPinnedSlot(
      [createFixtureProject("alpha", ["active", "active"])],
      "alpha",
      "alpha-task-1",
      "2",
    );

    const edited = updateProjectTask(projects, "alpha", "alpha-task-2", {
      name: "Renamed",
      pinnedSlot: "2",
    });
    const added = addProjectTask(
      edited,
      "alpha",
      { name: "Fresh", pinnedSlot: "2" },
      createFactories(),
    );
    const untouched = updateProjectTask(added, "alpha", "alpha-task-1", {
      name: "Keeps no slot",
    });

    expect(slotsOf(edited)).toEqual([
      ["alpha-task-1", undefined],
      ["alpha-task-2", "2"],
    ]);
    expect(slotsOf(untouched)).toEqual([
      ["alpha-task-1", undefined],
      ["alpha-task-2", undefined],
      ["task-1", "2"],
    ]);
  });

  it("keeps an archived task's slot but does not resolve it", () => {
    const projects = setProjectTaskPinnedSlot(
      [createFixtureProject("alpha", ["archived"])],
      "alpha",
      "alpha-task-1",
      "4",
    );
    const archivedProject = setProjectTaskPinnedSlot(
      [{ ...createFixtureProject("beta"), status: "archived" }],
      "beta",
      "beta-task-1",
      "5",
    );

    expect(getPinnedTasksBySlot(projects).get("4")?.task._id).toBe(
      "alpha-task-1",
    );
    expect(findPinnedTask(projects, "4")).toBeUndefined();
    expect(findPinnedTask(archivedProject, "5")).toBeUndefined();
  });

  it("drops an unknown slot when hydrating a stored task", () => {
    const project = createFixtureProject("alpha", ["active", "active"]);
    const stored = {
      ...project,
      tasks: [
        { ...project.tasks[0]!, pinnedSlot: "7" },
        { ...project.tasks[1]!, pinnedSlot: "11" },
      ],
    } as LocalProject;

    expect(slotsOf([normalizeProject(stored, () => 1)])).toEqual([
      ["alpha-task-1", "7"],
      ["alpha-task-2", undefined],
    ]);
  });
});

describe("favorites", () => {
  function favoriteIds(projects: LocalProject[]) {
    return getFavorites(projects).map((favorite) =>
      favorite.kind === "project" ? favorite.project._id : favorite.task._id,
    );
  }

  it("lists starred tasks and projects together, newest star first", () => {
    let projects = [
      createFixtureProject("alpha", ["active", "active"]),
      createFixtureProject("beta"),
    ];
    projects = setProjectTaskFavorite(projects, "alpha", "alpha-task-2", 10);
    projects = setProjectFavorite(projects, "beta", 30);
    projects = setProjectTaskFavorite(projects, "alpha", "alpha-task-1", 20);

    expect(favoriteIds(projects)).toEqual([
      "beta",
      "alpha-task-1",
      "alpha-task-2",
    ]);
  });

  it("removes a star and keeps a task's star apart from its project's", () => {
    let projects = [createFixtureProject("alpha")];
    projects = setProjectFavorite(projects, "alpha", 10);
    projects = setProjectTaskFavorite(projects, "alpha", "alpha-task-1", 20);
    projects = setProjectFavorite(projects, "alpha", undefined);

    expect(favoriteIds(projects)).toEqual(["alpha-task-1"]);
    projects = setProjectTaskFavorite(
      projects,
      "alpha",
      "alpha-task-1",
      undefined,
    );
    expect(getFavorites(projects)).toEqual([]);
  });

  it("leaves archived tasks and projects out, and lists them again once restored", () => {
    let projects = [
      createFixtureProject("alpha", ["active", "archived"]),
      { ...createFixtureProject("beta"), status: "archived" as const },
    ];
    projects = setProjectTaskFavorite(projects, "alpha", "alpha-task-1", 10);
    projects = setProjectTaskFavorite(projects, "alpha", "alpha-task-2", 20);
    projects = setProjectFavorite(projects, "beta", 30);
    projects = setProjectTaskFavorite(projects, "beta", "beta-task-1", 40);

    expect(favoriteIds(projects)).toEqual(["alpha-task-1"]);
    expect(
      favoriteIds(
        setProjectTaskStatus(
          projects,
          "alpha",
          "alpha-task-2",
          "active",
          () => 1,
        ),
      ),
    ).toEqual(["alpha-task-2", "alpha-task-1"]);
  });

  it("drops a broken star when hydrating a stored project", () => {
    const project = createFixtureProject("alpha", ["active", "active"]);
    const stored = {
      ...project,
      favoritedAt: "yesterday",
      tasks: [
        { ...project.tasks[0]!, favoritedAt: 50 },
        { ...project.tasks[1]!, favoritedAt: Number.NaN },
      ],
    } as unknown as LocalProject;
    const hydrated = normalizeProject(stored, () => 1);

    expect(hydrated.favoritedAt).toBeUndefined();
    expect(hydrated.tasks.map((task) => task.favoritedAt)).toEqual([
      50,
      undefined,
    ]);
  });
});
