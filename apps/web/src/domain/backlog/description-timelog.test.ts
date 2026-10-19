import { describe, expect, it } from "vitest";
import {
  applyDescriptionTimelogs,
  applyItemTimelog,
  getTimelogMismatch,
} from "@/domain/backlog/description-timelog";
import type {
  LocalAppState,
  LocalProject,
  LocalWorkItem,
} from "@/domain/local-state";

function createState(overrides: Partial<LocalAppState> = {}): LocalAppState {
  return {
    user: {
      _id: "local-user",
      name: "Local User",
      email: "local@example.com",
    },
    projects: [],
    rules: [],
    segments: [],
    dismissedSegmentIds: [],
    editedBlocks: [],
    importedBrowserDrafts: [],
    timers: [],
    timesheetEntries: [],
    timesheetImportDrafts: [],
    commitPromptedWeeks: [],
    timesheetTombstones: [],
    lockedWeeks: [],
    workItems: [],
    workflowStates: [],
    workflowStateMappings: [],
    workflowStateWriteRules: [],
    backlogSortMode: "custom",
    capture: {
      urlMode: "sanitized_path",
      titleMode: "normalized",
      blockedDomains: [],
      sensitiveDomains: [],
      maxPathSegments: 4,
    },
    userPreferences: {
      themeMode: "system",
      updateTrack: "stable",
      projectDataShapeId: "default",
      weeklyTimeViewStyle: "grid",
      weeklyCapacityTargets: {
        monday: 8,
        tuesday: 8,
        wednesday: 8,
        thursday: 8,
        friday: 8,
        saturday: 0,
        sunday: 0,
      },
      warnWhenOverCapacity: true,
      warnWhenSubmittingUnderCapacity: true,
      closeParentSubitems: "ask",
    },
    updatedAt: 0,
    ...overrides,
  };
}

function createFactories() {
  let nextId = 1;
  return {
    createId: (prefix: string) => `${prefix}-${nextId++}`,
    now: () => 500,
  };
}

function project(
  overrides: Partial<LocalProject> & Pick<LocalProject, "_id" | "name">,
): LocalProject {
  return {
    displayName: overrides.name,
    color: "#000000",
    icon: { kind: "initials" },
    status: "active",
    tasks: [],
    ...overrides,
  } as LocalProject;
}

function task(
  _id: string,
  name: string,
  status: "active" | "archived" = "active",
) {
  return {
    _id,
    name,
    status,
    createdAt: 1,
    archivedAt: status === "archived" ? 2 : undefined,
    billable: true,
  };
}

function item(overrides: Partial<LocalWorkItem> = {}): LocalWorkItem {
  return {
    _id: "item",
    title: "Item",
    status: "active",
    source: "manual",
    createdAt: 1,
    ...overrides,
  };
}

function timelog(project?: string, taskName?: string, text = "") {
  return [
    "---",
    "timelog:",
    ...(project ? [`  project: ${project}`] : []),
    ...(taskName ? [`  task: ${taskName}`] : []),
    "---",
    text,
  ].join("\n");
}

const acme = project({
  _id: "acme",
  name: "Acme website",
  displayName: "Acme",
  code: "ACM-1",
  tasks: [task("design", "Design"), task("old", "Support", "archived")],
});

const shared = project({
  _id: "shared",
  name: "Team site",
  team: { connectionId: "team-1" },
  tasks: [task("build", "Build"), task("qa", "QA", "archived")],
});

/** The state before a write and the state the write produced. */
function write(
  before: Partial<LocalAppState>,
  after: (state: LocalAppState) => Partial<LocalAppState>,
) {
  const previous = createState(before);
  return { previous, next: { ...previous, ...after(previous) } };
}

function withDescription(state: LocalAppState, description: string) {
  return {
    workItems: state.workItems.map((workItem) =>
      workItem._id === "item" ? { ...workItem, description } : workItem,
    ),
  };
}

describe("applyDescriptionTimelogs", () => {
  it("maps the item to the project and task the timelog names", () => {
    const { previous, next } = write(
      { projects: [acme], workItems: [item()] },
      (state) => withDescription(state, timelog("Acme website", "design")),
    );

    const result = applyDescriptionTimelogs(
      previous.workItems,
      next,
      createFactories(),
    );

    expect(result.workItems[0]).toMatchObject({
      projectId: "acme",
      taskId: "design",
    });
    expect(result.projects).toBe(next.projects);
  });

  it("finds the project by display name or code, ignoring case", () => {
    for (const name of ["acme", "acm-1"]) {
      const { previous, next } = write(
        { projects: [acme], workItems: [item()] },
        (state) => withDescription(state, timelog(name, "Design")),
      );
      expect(
        applyDescriptionTimelogs(previous.workItems, next, createFactories())
          .workItems[0]?.projectId,
      ).toBe("acme");
    }
  });

  it("creates a task the project lacks", () => {
    const { previous, next } = write(
      { projects: [acme], workItems: [item()] },
      (state) => withDescription(state, timelog("Acme", "Development")),
    );

    const result = applyDescriptionTimelogs(
      previous.workItems,
      next,
      createFactories(),
    );

    expect(result.projects[0]?.tasks.at(-1)).toMatchObject({
      _id: "task-1",
      name: "Development",
      status: "active",
      createdAt: 500,
    });
    expect(result.workItems[0]).toMatchObject({
      projectId: "acme",
      taskId: "task-1",
    });
  });

  it("restores an archived task of that name instead of adding another", () => {
    const { previous, next } = write(
      { projects: [acme], workItems: [item()] },
      (state) => withDescription(state, timelog("Acme", "support")),
    );

    const result = applyDescriptionTimelogs(
      previous.workItems,
      next,
      createFactories(),
    );

    expect(result.projects[0]?.tasks).toHaveLength(2);
    expect(result.projects[0]?.tasks[1]).toMatchObject({
      _id: "old",
      status: "active",
      archivedAt: undefined,
    });
    expect(result.workItems[0]?.taskId).toBe("old");
  });

  it("keeps the item's task when the timelog names only its project", () => {
    const { previous, next } = write(
      {
        projects: [acme],
        workItems: [item({ projectId: "acme", taskId: "design" })],
      },
      (state) => withDescription(state, timelog("Acme")),
    );

    expect(
      applyDescriptionTimelogs(previous.workItems, next, createFactories()),
    ).toBe(next);
  });

  it("sets the project and clears the task when the timelog names no task", () => {
    const { previous, next } = write(
      {
        projects: [acme, project({ _id: "other", name: "Other" })],
        workItems: [item({ projectId: "other", taskId: "x" })],
      },
      (state) => withDescription(state, timelog("Acme")),
    );

    const result = applyDescriptionTimelogs(
      previous.workItems,
      next,
      createFactories(),
    );

    expect(result.workItems[0]?.projectId).toBe("acme");
    expect(result.workItems[0]?.taskId).toBeUndefined();
  });

  it("looks for a task alone in the item's project", () => {
    const { previous, next } = write(
      { projects: [acme], workItems: [item({ projectId: "acme" })] },
      (state) => withDescription(state, timelog(undefined, "Design")),
    );

    expect(
      applyDescriptionTimelogs(previous.workItems, next, createFactories())
        .workItems[0]?.taskId,
    ).toBe("design");
  });

  it("changes nothing for a task alone on an item without a project", () => {
    const { previous, next } = write(
      { projects: [acme], workItems: [item()] },
      (state) => withDescription(state, timelog(undefined, "Design")),
    );

    expect(
      applyDescriptionTimelogs(previous.workItems, next, createFactories()),
    ).toBe(next);
  });

  it("changes nothing while the project does not exist or is archived", () => {
    const { previous, next } = write(
      {
        projects: [project({ _id: "gone", name: "Gone", status: "archived" })],
        workItems: [item()],
      },
      (state) => withDescription(state, timelog("Gone", "Design")),
    );

    expect(
      applyDescriptionTimelogs(previous.workItems, next, createFactories()),
    ).toBe(next);
  });

  it("keeps a later pick while the timelog stays the same", () => {
    const { previous, next } = write(
      {
        projects: [acme, project({ _id: "other", name: "Other" })],
        workItems: [
          item({ projectId: "other", description: timelog("Acme", "Design") }),
        ],
      },
      (state) =>
        withDescription(state, timelog("Acme", "Design", "More text.")),
    );

    expect(
      applyDescriptionTimelogs(previous.workItems, next, createFactories()),
    ).toBe(next);
  });

  it("keeps a project or task picked in the same write", () => {
    const { previous, next } = write(
      {
        projects: [acme, project({ _id: "other", name: "Other" })],
        workItems: [item()],
      },
      (state) => ({
        workItems: state.workItems.map((workItem) => ({
          ...workItem,
          description: timelog("Acme", "Design"),
          projectId: "other",
        })),
      }),
    );

    expect(
      applyDescriptionTimelogs(previous.workItems, next, createFactories()),
    ).toBe(next);
  });

  it("keeps a project the same write sets, even one the item already had", () => {
    const { previous, next } = write(
      {
        projects: [acme, project({ _id: "other", name: "Other" })],
        workItems: [item({ projectId: "other" })],
      },
      (state) => withDescription(state, timelog("Acme", "Design")),
    );

    expect(
      applyDescriptionTimelogs(
        previous.workItems,
        next,
        createFactories(),
        new Set(["item"]),
      ),
    ).toBe(next);
  });

  it("maps a new subitem whose project only came from its parent", () => {
    const parent = item({ _id: "parent", projectId: "other" });
    const previous = createState({
      projects: [acme, project({ _id: "other", name: "Other" })],
      workItems: [parent],
    });
    const next = {
      ...previous,
      workItems: [
        item({
          _id: "child",
          parentWorkItemId: "parent",
          hierarchyLevel: 1,
          projectId: "other",
          inheritsParentMapping: true,
          description: timelog("Acme", "Design"),
        }),
        parent,
      ],
    };

    expect(
      applyDescriptionTimelogs(previous.workItems, next, createFactories())
        .workItems[0],
    ).toMatchObject({
      projectId: "acme",
      taskId: "design",
      inheritsParentMapping: false,
    });
  });

  it("maps a new item, such as a synced one, unless it already has a project", () => {
    const previous = createState({ projects: [acme] });
    const next = {
      ...previous,
      workItems: [
        item({ _id: "new", description: timelog("Acme", "Design") }),
        item({
          _id: "picked",
          projectId: "elsewhere",
          description: timelog("Acme", "Design"),
        }),
      ],
    };

    const result = applyDescriptionTimelogs(
      previous.workItems,
      next,
      createFactories(),
    );

    expect(result.workItems[0]).toMatchObject({
      projectId: "acme",
      taskId: "design",
    });
    expect(result.workItems[1]?.projectId).toBe("elsewhere");
  });

  it("carries the mapping to subitems that follow their parent", () => {
    const { previous, next } = write(
      {
        projects: [acme],
        workItems: [
          item(),
          item({
            _id: "child",
            parentWorkItemId: "item",
            hierarchyLevel: 1,
            inheritsParentMapping: true,
          }),
        ],
      },
      (state) => withDescription(state, timelog("Acme", "Design")),
    );

    const result = applyDescriptionTimelogs(
      previous.workItems,
      next,
      createFactories(),
    );

    expect(result.workItems[1]).toMatchObject({
      projectId: "acme",
      taskId: "design",
    });
  });

  it("leaves adding or restoring a shared project's task to the user", () => {
    for (const name of ["Deploy", "QA"]) {
      const { previous, next } = write(
        { projects: [shared], workItems: [item()] },
        (state) => withDescription(state, timelog("Team site", name)),
      );
      expect(
        applyDescriptionTimelogs(previous.workItems, next, createFactories()),
      ).toBe(next);
    }
  });

  it("maps a shared project's existing task", () => {
    const { previous, next } = write(
      { projects: [shared], workItems: [item()] },
      (state) => withDescription(state, timelog("Team site", "build")),
    );

    expect(
      applyDescriptionTimelogs(previous.workItems, next, createFactories())
        .workItems[0],
    ).toMatchObject({ projectId: "shared", taskId: "build" });
  });

  it("returns the same state when no description changed", () => {
    const state = createState({
      projects: [acme],
      workItems: [item({ description: timelog("Acme", "Design") })],
    });

    expect(
      applyDescriptionTimelogs(
        state.workItems,
        { ...state, updatedAt: 1 },
        createFactories(),
      ).workItems,
    ).toBe(state.workItems);
  });
});

describe("getTimelogMismatch", () => {
  it("names a missing project, or an archived one of that name", () => {
    expect(
      getTimelogMismatch(
        [acme],
        item({ description: timelog("Beta", "Build") }),
      ),
    ).toEqual({
      kind: "missing-project",
      projectName: "Beta",
      taskName: "Build",
    });
    expect(
      getTimelogMismatch(
        [project({ _id: "beta", name: "Beta", status: "archived" })],
        item({ description: timelog("beta") }),
      ),
    ).toEqual({
      kind: "missing-project",
      projectName: "beta",
      archivedProjectId: "beta",
    });
  });

  it("names a missing or archived task, and whether the team gets it", () => {
    expect(
      getTimelogMismatch(
        [shared],
        item({ description: timelog("Team site", "Deploy") }),
      ),
    ).toEqual({
      kind: "missing-task",
      projectId: "shared",
      projectName: "Team site",
      taskName: "Deploy",
      shared: true,
    });
    expect(
      getTimelogMismatch(
        [acme],
        item({ projectId: "acme", description: timelog(undefined, "support") }),
      ),
    ).toEqual({
      kind: "missing-task",
      projectId: "acme",
      projectName: "Acme",
      taskName: "support",
      archivedTaskId: "old",
      shared: false,
    });
  });

  it("names the timelog's project and task when the item has others", () => {
    expect(
      getTimelogMismatch(
        [acme],
        item({ projectId: "acme", description: timelog("Acme", "Design") }),
      ),
    ).toEqual({
      kind: "different",
      projectId: "acme",
      projectName: "Acme",
      taskId: "design",
      taskName: "Design",
    });
    expect(
      getTimelogMismatch(
        [acme, project({ _id: "other", name: "Other" })],
        item({
          projectId: "other",
          taskId: "x",
          description: timelog("Acme"),
        }),
      ),
    ).toEqual({ kind: "different", projectId: "acme", projectName: "Acme" });
  });

  it("accepts any task of the project when the timelog names none", () => {
    expect(
      getTimelogMismatch(
        [acme],
        item({
          projectId: "acme",
          taskId: "design",
          description: timelog("Acme"),
        }),
      ),
    ).toBeNull();
  });

  it("is null when the item matches its timelog or has none", () => {
    expect(
      getTimelogMismatch(
        [acme],
        item({
          projectId: "acme",
          taskId: "design",
          description: timelog("Acme", "Design"),
        }),
      ),
    ).toBeNull();
    expect(
      getTimelogMismatch(
        [acme],
        item({ description: timelog(undefined, "Design") }),
      ),
    ).toBeNull();
    expect(getTimelogMismatch([acme], item())).toBeNull();
  });
});

describe("applyItemTimelog", () => {
  it("creates the project with the task and maps the item", () => {
    const state = createState({
      projects: [acme],
      workItems: [item({ description: timelog("Beta", "Build") })],
    });

    const result = applyItemTimelog(state, "item", createFactories());

    expect(result.projects[1]).toMatchObject({
      _id: "project-1",
      name: "Beta",
      displayName: "Beta",
      status: "active",
      tasks: [{ _id: "task-2", name: "Build", status: "active" }],
    });
    expect(result.workItems[0]).toMatchObject({
      projectId: "project-1",
      taskId: "task-2",
    });
  });

  it("restores an archived project of that name", () => {
    const state = createState({
      projects: [
        project({
          _id: "beta",
          name: "Beta",
          status: "archived",
          tasks: [task("build", "Build")],
        }),
      ],
      workItems: [item({ description: timelog("Beta", "Build") })],
    });

    const result = applyItemTimelog(state, "item", createFactories());

    expect(result.projects).toHaveLength(1);
    expect(result.projects[0]?.status).toBe("active");
    expect(result.workItems[0]).toMatchObject({
      projectId: "beta",
      taskId: "build",
    });
  });

  it("adds or restores a shared project's task when the user asks", () => {
    const added = applyItemTimelog(
      createState({
        projects: [shared],
        workItems: [item({ description: timelog("Team site", "Deploy") })],
      }),
      "item",
      createFactories(),
    );
    expect(added.projects[0]?.tasks.at(-1)).toMatchObject({
      _id: "task-1",
      name: "Deploy",
    });
    expect(added.workItems[0]?.taskId).toBe("task-1");

    const restored = applyItemTimelog(
      createState({
        projects: [shared],
        workItems: [item({ description: timelog("Team site", "qa") })],
      }),
      "item",
      createFactories(),
    );
    expect(restored.projects[0]?.tasks[1]?.status).toBe("active");
    expect(restored.workItems[0]?.taskId).toBe("qa");
  });

  it("sets the timelog's project and task over the item's own", () => {
    const result = applyItemTimelog(
      createState({
        projects: [acme, project({ _id: "other", name: "Other" })],
        workItems: [
          item({ projectId: "other", description: timelog("Acme", "Design") }),
        ],
      }),
      "item",
      createFactories(),
    );

    expect(result.workItems[0]).toMatchObject({
      projectId: "acme",
      taskId: "design",
    });
  });

  it("changes nothing when the item matches its timelog or has none", () => {
    const matching = createState({
      projects: [acme],
      workItems: [item({ projectId: "acme", description: timelog("Acme") })],
    });
    expect(applyItemTimelog(matching, "item", createFactories())).toBe(
      matching,
    );

    const plain = createState({ workItems: [item()] });
    expect(applyItemTimelog(plain, "item", createFactories())).toBe(plain);
  });
});
