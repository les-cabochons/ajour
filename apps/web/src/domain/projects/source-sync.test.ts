import { describe, expect, it } from "vitest";
import type { ProjectSourceSnapshot } from "@ajour/shared";
import { fixtureSnapshot } from "../../../../../packages/example/index.ts";
import type { LocalProject, LocalProjectTask } from "@/domain/local-state";
import {
  setProjectTaskStatus,
  updateProject,
  type ProjectFactories,
} from "@/domain/projects/project-transitions";
import {
  answerSourceWaitingTasks,
  disconnectProjectSource,
  resolveHeldSourceProject,
  syncProjectSource,
  type ProjectSourceSyncState,
} from "@/domain/projects/source-sync";

/*
 * The project source sync rules (#505, ADR 0016), on the example plugin's
 * fixture: two projects, Acme - Support (code ACME-SUP, open, three tasks,
 * one closed) and Globex - Internal (code GLOBEX-INT, complete).
 */

const CONNECTION = { pluginId: "example-project-source", connectionId: "c1" };

function createFactories(): ProjectFactories {
  let nextId = 1;
  return {
    createId: (prefix) => `${prefix}-new-${nextId++}`,
    now: () => 5_000,
  };
}

function localTask(
  id: string,
  overrides: Partial<LocalProjectTask> = {},
): LocalProjectTask {
  return {
    _id: id,
    name: `Task ${id}`,
    status: "active",
    createdAt: 10,
    billable: true,
    ...overrides,
  };
}

function localProject(
  id: string,
  overrides: Partial<LocalProject> = {},
): LocalProject {
  return {
    _id: id,
    name: `Project ${id}`,
    displayName: `Project ${id}`,
    color: "#123456",
    icon: { kind: "preset", name: "dot" },
    status: "active",
    tasks: [],
    ...overrides,
  };
}

function stateWith(projects: LocalProject[]): ProjectSourceSyncState {
  return { projects, projectSources: {} };
}

/** A copy of the fixture to change, so no test changes another's. */
function snapshot(
  change: (copy: ProjectSourceSnapshot) => void = () => undefined,
): ProjectSourceSnapshot {
  const copy = structuredClone(fixtureSnapshot);
  change(copy);
  return copy;
}

function sync(
  state: ProjectSourceSyncState,
  from: ProjectSourceSnapshot = snapshot(),
  factories = createFactories(),
) {
  return syncProjectSource(state, CONNECTION, from, factories);
}

function projectNamed(state: ProjectSourceSyncState, name: string) {
  const project = state.projects.find((entry) => entry.name === name);
  if (!project) throw new Error(`No project named ${name}.`);
  return project;
}

describe("syncProjectSource", () => {
  it("links a local project with the same code without asking, and keeps its ID", () => {
    const local = localProject("acme", {
      name: "Acme support",
      displayName: "Support (mine)",
      code: " acme-sup ",
      color: "#abcdef",
      favoritedAt: 42,
    });

    const next = sync(stateWith([local]));

    const linked = next.projects.find((project) => project._id === "acme")!;
    expect(linked).toMatchObject({
      name: "Acme - Support",
      displayName: "Support (mine)",
      code: "ACME-SUP",
      client: "Acme inc.",
      startsOn: "2026-01-01",
      endsOn: "2026-12-31",
      color: "#abcdef",
      favoritedAt: 42,
      status: "active",
      budget: {
        unit: "hours",
        total: 40,
        consumed: 31.5,
        remaining: 8.5,
        status: "warning",
        asOf: "2026-10-31T23:59:59.000Z",
      },
      source: {
        pluginId: "example-project-source",
        connectionId: "c1",
        remoteId: "ACME-SUP",
        url: "https://planner.example/projects/ACME-SUP",
        syncedAt: 5_000,
      },
    });
    expect(next.result.linked).toBe(1);
  });

  it("creates a project it can't link, with its tasks, and archives what the source closed", () => {
    const next = sync(stateWith([]));

    const acme = projectNamed(next, "Acme - Support");
    expect(acme).toMatchObject({
      _id: expect.stringMatching(/^project-new-/),
      displayName: "Acme - Support",
      code: "ACME-SUP",
      status: "active",
    });
    expect(
      acme.tasks.map((task) => ({
        name: task.name,
        status: task.status,
        billable: task.billable,
        budgetMs: task.budgetMs,
        source: task.source,
        archivedBySource: task.archivedBySource,
      })),
    ).toEqual([
      {
        name: "Ticket #101 - Login",
        status: "active",
        billable: true,
        budgetMs: 8 * 3_600_000,
        source: {
          remoteId: "1001",
          group: "Support",
          assigned: true,
          myHours: 5.25,
        },
        archivedBySource: undefined,
      },
      {
        name: "Ticket #102 - Export",
        status: "active",
        billable: true,
        budgetMs: 4 * 3_600_000,
        source: { remoteId: "1002", group: "Support", assigned: false },
        archivedBySource: undefined,
      },
      {
        name: "Ticket #099 - Time zone",
        status: "archived",
        billable: true,
        budgetMs: 2 * 3_600_000,
        source: {
          remoteId: "1003",
          group: "Support",
          assigned: true,
          myHours: 2,
        },
        archivedBySource: true,
      },
    ]);
    // Complete at the source: archived, and the sync remembers why.
    expect(projectNamed(next, "Globex - Internal")).toMatchObject({
      status: "archived",
      archivedBySource: true,
      budget: { unit: "money", consumed: 21200 },
    });
    expect(next.projectSources.c1).toEqual({
      pluginId: "example-project-source",
      label: "Example planner",
      url: "https://planner.example",
      asOf: "2026-10-31T23:59:59.000Z",
      me: { hoursAvailable: true },
      syncedAt: 5_000,
      held: [],
    });
    expect(next.result).toMatchObject({ created: 2, archived: 1, linked: 0 });
  });

  it("holds a project that only matches by name for review, and keeps it current", () => {
    const local = localProject("mine", { name: " acme -  SUPPORT " });

    const first = sync(stateWith([local]));

    expect(first.projects).toEqual([
      local,
      expect.objectContaining({ name: "Globex - Internal" }),
    ]);
    expect(first.projectSources.c1!.held).toEqual([
      expect.objectContaining({ remoteId: "ACME-SUP", name: "Acme - Support" }),
    ]);
    expect(first.result).toMatchObject({ held: 1, linked: 0, created: 1 });

    const second = sync(
      first,
      snapshot((copy) => {
        copy.projects[0]!.client = "Acme Holdings";
      }),
    );
    expect(second.projects).toHaveLength(2);
    expect(second.projectSources.c1!.held).toEqual([
      expect.objectContaining({
        remoteId: "ACME-SUP",
        client: "Acme Holdings",
      }),
    ]);
    expect(second.result.held).toBe(1);
  });

  it("follows a linked project by its remote ID through a rename, with a display name that was the full name", () => {
    const first = sync(stateWith([]));
    const id = projectNamed(first, "Acme - Support")._id;

    const renamed = sync(
      first,
      snapshot((copy) => {
        copy.projects[0]!.name = "Acme - Support 2027";
        copy.projects[0]!.code = "ACME-SUP-27";
      }),
    );

    expect(
      renamed.projects.find((project) => project._id === id),
    ).toMatchObject({
      name: "Acme - Support 2027",
      displayName: "Acme - Support 2027",
      code: "ACME-SUP-27",
    });
    expect(renamed.projects).toHaveLength(2);
    expect(renamed.result).toMatchObject({ updated: 1, unchanged: 1 });
  });

  it("keeps a display name the user chose through a rename", () => {
    const first = sync(stateWith([]));
    const id = projectNamed(first, "Acme - Support")._id;
    const named = {
      ...first,
      projects: first.projects.map((project) =>
        project._id === id ? { ...project, displayName: "Acme" } : project,
      ),
    };

    const renamed = sync(
      named,
      snapshot((copy) => {
        copy.projects[0]!.name = "Acme - Support 2027";
      }),
    );

    expect(
      renamed.projects.find((project) => project._id === id)?.displayName,
    ).toBe("Acme");
  });

  it("archives a project and a task the snapshot lacks, and restores them when they return", () => {
    const first = sync(stateWith([]));
    const acmeId = projectNamed(first, "Acme - Support")._id;

    const gone = sync(
      first,
      snapshot((copy) => {
        copy.projects[0]!.tasks = copy.projects[0]!.tasks.filter(
          (task) => task.remoteId !== "1002",
        );
        copy.projects = copy.projects.filter(
          (project) => project.remoteId !== "GLOBEX-INT",
        );
        copy.projects.push({
          ...structuredClone(fixtureSnapshot.projects[0]!),
          remoteId: "ACME-OPS",
          code: "ACME-OPS",
          name: "Acme - Ops",
          complete: false,
          tasks: [],
        });
      }),
    );
    const acme = gone.projects.find((project) => project._id === acmeId)!;
    expect(
      acme.tasks.find((task) => task.source?.remoteId === "1002"),
    ).toMatchObject({
      status: "archived",
      archivedAt: 5_000,
      archivedByMissingSync: true,
    });
    // Already archived as complete: missing changes nothing.
    expect(projectNamed(gone, "Globex - Internal")).toMatchObject({
      status: "archived",
      archivedBySource: true,
    });

    const opsGone = sync(gone);
    expect(projectNamed(opsGone, "Acme - Ops")).toMatchObject({
      status: "archived",
      archivedByMissingSync: true,
    });
    expect(opsGone.result.archived).toBe(1);
    expect(
      opsGone.projects
        .find((project) => project._id === acmeId)!
        .tasks.find((task) => task.source?.remoteId === "1002"),
    ).toMatchObject({
      status: "active",
      archivedAt: undefined,
      archivedByMissingSync: undefined,
    });

    const opsBack = sync(
      opsGone,
      snapshot((copy) => {
        copy.projects.push({
          ...structuredClone(fixtureSnapshot.projects[0]!),
          remoteId: "ACME-OPS",
          code: "ACME-OPS",
          name: "Acme - Ops",
          complete: false,
          tasks: [],
        });
      }),
    );
    expect(projectNamed(opsBack, "Acme - Ops")).toMatchObject({
      status: "active",
      archivedByMissingSync: undefined,
    });
    expect(opsBack.result.restored).toBe(1);
  });

  it("archives a project the source completes and restores it when the source reopens it", () => {
    const first = sync(stateWith([]));
    expect(projectNamed(first, "Globex - Internal").status).toBe("archived");

    const reopened = sync(
      first,
      snapshot((copy) => {
        copy.projects[1]!.complete = false;
      }),
    );

    expect(projectNamed(reopened, "Globex - Internal")).toMatchObject({
      status: "active",
      archivedBySource: undefined,
    });
    expect(reopened.result.restored).toBe(1);

    const completed = sync(reopened);
    expect(projectNamed(completed, "Globex - Internal").status).toBe(
      "archived",
    );
    expect(completed.result.archived).toBe(1);
  });

  it("leaves a project the user archived by hand archived when the source reopens it", () => {
    const local = localProject("globex", {
      name: "Globex",
      code: "GLOBEX-INT",
      status: "archived",
    });

    const next = sync(
      stateWith([local]),
      snapshot((copy) => {
        copy.projects[1]!.complete = false;
      }),
    );

    const globex = next.projects.find((project) => project._id === "globex")!;
    expect(globex.status).toBe("archived");
    expect(globex.archivedBySource).toBeUndefined();
  });

  it("forgets the source's archive once the user changes the status by hand", () => {
    const first = sync(stateWith([]));
    const globex = projectNamed(first, "Globex - Internal");
    // Restored by hand, then archived by hand: the user's archive now.
    const handled = {
      ...first,
      projects: updateProject(
        updateProject(first.projects, globex._id, { status: "active" }),
        globex._id,
        { status: "archived" },
      ),
    };
    const closedTask = projectNamed(first, "Acme - Support").tasks.find(
      (task) => task.source?.remoteId === "1003",
    )!;
    const acmeId = projectNamed(first, "Acme - Support")._id;
    handled.projects = setProjectTaskStatus(
      setProjectTaskStatus(
        handled.projects,
        acmeId,
        closedTask._id,
        "active",
        () => 1,
      ),
      acmeId,
      closedTask._id,
      "archived",
      () => 1,
    );

    const reopened = sync(
      handled,
      snapshot((copy) => {
        copy.projects[1]!.complete = false;
        copy.projects[0]!.tasks[2]!.closed = false;
      }),
    );

    expect(projectNamed(reopened, "Globex - Internal").status).toBe("archived");
    expect(
      projectNamed(reopened, "Acme - Support").tasks.find(
        (task) => task._id === closedTask._id,
      )?.status,
    ).toBe("archived");
  });

  it("links a task without a source by name, so its time stays, and confirms a Not known yet task", () => {
    const local = localProject("acme", {
      code: "ACME-SUP",
      tasks: [
        localTask("login", {
          name: "ticket #101 -  login",
          commitAs: "waiting",
          favoritedAt: 9,
          pinnedSlot: "3",
          budgetMs: 1,
        }),
        localTask("mine", { name: "Internal notes" }),
      ],
    });

    const next = sync(stateWith([local]));

    const tasks = next.projects.find(
      (project) => project._id === "acme",
    )!.tasks;
    expect(tasks.find((task) => task._id === "login")).toMatchObject({
      name: "Ticket #101 - Login",
      commitAs: undefined,
      favoritedAt: 9,
      pinnedSlot: "3",
      budgetMs: 8 * 3_600_000,
      source: { remoteId: "1001" },
    });
    // A task the source doesn't know stays as it was.
    expect(tasks.find((task) => task._id === "mine")).toEqual(
      localTask("mine", { name: "Internal notes" }),
    );
    expect(tasks).toHaveLength(4);
  });

  it("never links a shared project, by code or by name, and counts what it skipped", () => {
    const team = { connectionId: "team-1" };
    const byCode = localProject("shared-code", {
      name: "Acme",
      code: "ACME-SUP",
      team,
    });
    const byName = localProject("shared-name", {
      name: "Globex - Internal",
      team,
    });

    const next = sync(stateWith([byCode, byName]));

    expect(next.projects).toEqual([byCode, byName]);
    expect(next.projectSources.c1!.held).toEqual([]);
    expect(next.result).toMatchObject({
      refusedShared: 2,
      linked: 0,
      created: 0,
      held: 0,
    });
  });
});

describe("resolveHeldSourceProject", () => {
  function held() {
    const local = localProject("mine", {
      name: "Acme - Support",
      displayName: "Support",
      tasks: [localTask("login", { name: "Ticket #101 - Login" })],
    });
    return sync(stateWith([local]));
  }

  it("links the held project to the local project the user picks", () => {
    const next = resolveHeldSourceProject(
      held(),
      CONNECTION,
      "ACME-SUP",
      { kind: "link", projectId: "mine" },
      createFactories(),
    );

    expect(next.result).toEqual({ kind: "linked", projectId: "mine" });
    const mine = next.projects.find((project) => project._id === "mine")!;
    expect(mine).toMatchObject({
      displayName: "Support",
      code: "ACME-SUP",
      source: { remoteId: "ACME-SUP", connectionId: "c1" },
      budget: { asOf: "2026-10-31T23:59:59.000Z" },
    });
    expect(mine.tasks[0]).toMatchObject({
      _id: "login",
      source: { remoteId: "1001" },
    });
    expect(next.projectSources.c1!.held).toEqual([]);
    // The next sync follows it by its remote ID: nothing is held again.
    const after = sync(next);
    expect(after.result).toMatchObject({ held: 0, unchanged: 2 });
  });

  it("adds the held project as a new one, and leaves the local one alone", () => {
    const before = held();
    const next = resolveHeldSourceProject(
      before,
      CONNECTION,
      "ACME-SUP",
      { kind: "addAsNew" },
      createFactories(),
    );

    expect(next.result).toEqual({
      kind: "added",
      projectId: expect.stringMatching(/^project-new-/),
    });
    expect(next.projects.find((project) => project._id === "mine")).toEqual(
      before.projects.find((project) => project._id === "mine"),
    );
    expect(next.projects).toHaveLength(3);
    expect(next.projectSources.c1!.held).toEqual([]);
    expect(sync(next).result.held).toBe(0);
  });

  it("refuses to link a shared or managed project", () => {
    const state = held();
    const shared = {
      ...state,
      projects: state.projects.map((project) =>
        project._id === "mine"
          ? { ...project, team: { connectionId: "team-1" } }
          : project,
      ),
    };

    const next = resolveHeldSourceProject(
      shared,
      CONNECTION,
      "ACME-SUP",
      { kind: "link", projectId: "mine" },
      createFactories(),
    );

    expect(next.result).toEqual({ kind: "notLinkable" });
    expect(next.projects).toBe(shared.projects);
  });
});

describe("the Not known yet question", () => {
  it("asks about the waiting tasks of a project the sync added tasks to", () => {
    const local = localProject("acme", {
      code: "ACME-SUP",
      tasks: [
        localTask("wait", { name: "Login bug", commitAs: "waiting" }),
        localTask("other", { name: "Notes" }),
      ],
    });

    const next = sync(stateWith([local]));

    expect(next.result.waitingQuestions).toEqual([
      {
        projectId: "acme",
        choices: [
          {
            taskId: "wait",
            name: "Login bug",
            // Closed at the source, so archived: not a task to pick.
            newNames: ["Ticket #101 - Login", "Ticket #102 - Export"],
          },
        ],
      },
    ]);
    // A sync that adds nothing asks nothing.
    expect(sync(next).result.waitingQuestions).toEqual([]);
  });

  it("makes a waiting task the source task the user picks, so its time commits as that task", () => {
    const local = localProject("acme", {
      code: "ACME-SUP",
      tasks: [
        localTask("wait", {
          name: "Login bug",
          commitAs: "waiting",
          favoritedAt: 3,
        }),
        localTask("later", { name: "Export later", commitAs: "waiting" }),
        localTask("off", { name: "Off the books", commitAs: "waiting" }),
      ],
    });
    const synced = sync(stateWith([local]));

    const answered = answerSourceWaitingTasks(
      synced.projects,
      "acme",
      {
        wait: {
          expectedName: "Login bug",
          kind: "rename",
          name: "Ticket #101 - Login",
        },
        later: { expectedName: "Export later", kind: "wait" },
        off: { expectedName: "Off the books", kind: "local" },
      },
      () => false,
    );

    expect(answered.matchedCount).toBe(1);
    const tasks = answered.projects[0]!.tasks;
    expect(tasks.filter((task) => task.name === "Ticket #101 - Login")).toEqual(
      [
        expect.objectContaining({
          _id: "wait",
          commitAs: undefined,
          favoritedAt: 3,
          budgetMs: 8 * 3_600_000,
          source: expect.objectContaining({ remoteId: "1001" }),
        }),
      ],
    );
    expect(tasks.find((task) => task._id === "later")?.commitAs).toBe(
      "waiting",
    );
    expect(tasks.find((task) => task._id === "off")?.commitAs).toBe("local");
    // The next sync follows the waiting task as the source's.
    const after = sync({ ...synced, projects: answered.projects });
    expect(
      after.projects[0]!.tasks.filter(
        (task) => task.source?.remoteId === "1001",
      ),
    ).toHaveLength(1);
  });

  it("leaves a waiting task waiting when the source task it picks is in use", () => {
    const local = localProject("acme", {
      code: "ACME-SUP",
      tasks: [localTask("wait", { name: "Login bug", commitAs: "waiting" })],
    });
    const synced = sync(stateWith([local]));
    const login = synced.projects[0]!.tasks.find(
      (task) => task.name === "Ticket #101 - Login",
    )!;

    const answered = answerSourceWaitingTasks(
      synced.projects,
      "acme",
      {
        wait: {
          expectedName: "Login bug",
          kind: "rename",
          name: "Ticket #101 - Login",
        },
      },
      (taskId) => taskId === login._id,
    );

    expect(answered.matchedCount).toBe(0);
    expect(answered.projects).toBe(synced.projects);
  });
});

describe("disconnectProjectSource", () => {
  it("turns the connection's managed projects into local ones and forgets the connection", () => {
    const local = localProject("other", { name: "Mine" });
    const synced = sync(stateWith([local]));

    const next = disconnectProjectSource(synced, "c1");

    expect(next.projectSources).toEqual({});
    const acme = projectNamed(next, "Acme - Support");
    expect(acme.source).toBeUndefined();
    expect(acme.tasks.every((task) => task.source === undefined)).toBe(true);
    // Everything else stays: the name, code, budget, and the archive.
    expect(acme).toMatchObject({ code: "ACME-SUP", client: "Acme inc." });
    expect(projectNamed(next, "Globex - Internal").status).toBe("archived");
    expect(next.projects.find((project) => project._id === "other")).toBe(
      local,
    );
  });
});
