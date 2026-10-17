import { describe, expect, it } from "vitest";
import {
  TEAM_SYNC_MAX_PROJECTS,
  TEAM_SYNC_MAX_TASKS,
  type TeamProject,
  type TeamSyncResult,
  type TeamTask,
} from "@ajour/shared";
import type { LocalProject, LocalProjectTask } from "@/domain/local-state";
import {
  DEFAULT_PROJECT_COLOR,
  normalizeProject,
  updateProject,
  updateProjectTask,
  type ProjectFactories,
} from "@/domain/projects/project-transitions";
import { normalizeTeamConnections } from "@/domain/projects/team-link";
import {
  applyTeamSync,
  disconnectTeam,
  linkProject,
  planTeamSync,
  resolveHeldArrival,
  shareProject,
  toTeamProjectFields,
  toTeamTaskFields,
  unshareProject,
  type TeamSyncState,
} from "@/domain/projects/team-sync";

const CONNECTION = "connection-1";
const NO_SKIPS: ReadonlySet<string> = new Set();

function createFactories(): ProjectFactories {
  let nextId = 1;
  return {
    createId: (prefix) => `${prefix}-new-${nextId++}`,
    now: () => 1_000,
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

/** A shared project as it stands right after a sync: nothing changed since. */
function syncedProject(
  id: string,
  overrides: Partial<LocalProject> = {},
): LocalProject {
  const project = localProject(id, overrides);
  const tasks = project.tasks.map((task) => ({
    ...task,
    team: { remoteId: `remote-${task._id}`, synced: toTeamTaskFields(task) },
  }));
  return {
    ...project,
    tasks,
    team: {
      connectionId: CONNECTION,
      remoteId: `remote-${id}`,
      synced: toTeamProjectFields(project),
    },
  };
}

function teamTask(task: LocalProjectTask, remoteId = `remote-${task._id}`) {
  return { remoteId, ...toTeamTaskFields(task) } satisfies TeamTask;
}

function teamProject(
  project: LocalProject,
  tasks: TeamTask[] = [],
  remoteId = `remote-${project._id}`,
): TeamProject {
  return { remoteId, ...toTeamProjectFields(project), tasks };
}

function syncResult(
  projects: TeamProject[],
  assigned: TeamSyncResult["assigned"] = [],
): TeamSyncResult {
  return { cursor: "cursor-2", projects, assigned, hasMore: false };
}

/** A workspace whose team connection has synced once. */
function stateOf(projects: LocalProject[]): TeamSyncState {
  return {
    projects,
    teamConnections: {
      [CONNECTION]: {
        cursor: "cursor-1",
        unsharedRemoteIds: [],
        unsharedLocalIds: [],
        heldArrivals: [],
      },
    },
  };
}

/** Plans a round, has the team accept it as is, and applies the result. */
function roundTrip(state: TeamSyncState, assigned: [string, string][] = []) {
  const plan = planTeamSync(state, CONNECTION, NO_SKIPS);
  return applyTeamSync(
    state,
    CONNECTION,
    plan.request.changes,
    syncResult(
      [],
      assigned.map(([localId, remoteId]) => ({ localId, remoteId })),
    ),
    createFactories(),
  );
}

describe("planning a team sync", () => {
  it("never sends a local project, and sends a new shared one in full", () => {
    const shared = {
      ...localProject("p1", { code: "ACM", tasks: [localTask("t1")] }),
      team: { connectionId: CONNECTION },
    };
    const plan = planTeamSync(
      stateOf([localProject("p0"), shared]),
      CONNECTION,
      NO_SKIPS,
    );

    expect(plan.request.changes).toEqual([
      {
        localId: "p1",
        name: "Project p1",
        displayName: "Project p1",
        code: "ACM",
        color: "#123456",
        icon: { kind: "preset", name: "dot" },
        status: "active",
        tasks: [
          {
            localId: "t1",
            name: "Task t1",
            status: "active",
            billable: true,
            budgetMs: null,
          },
        ],
      },
    ]);
    expect(plan.hasMoreChanges).toBe(false);
  });

  it("sends only the fields that differ from the last sync", () => {
    const project = syncedProject("p1", { tasks: [localTask("t1")] });
    const edited = updateProjectTask(
      updateProject([project], "p1", { code: "NEW" }),
      "p1",
      "t1",
      { budgetMs: 3_600_000 },
    );

    expect(
      planTeamSync(stateOf(edited), CONNECTION, NO_SKIPS).request.changes,
    ).toEqual([
      {
        localId: "p1",
        remoteId: "remote-p1",
        code: "NEW",
        tasks: [{ localId: "t1", remoteId: "remote-t1", budgetMs: 3_600_000 }],
      },
    ]);
    expect(
      planTeamSync(stateOf([project]), CONNECTION, NO_SKIPS).request.changes,
    ).toEqual([]);
  });

  it("leaves personal fields out: pinned slots, adjustments, plugin properties", () => {
    const project = syncedProject("p1", { tasks: [localTask("t1")] });
    const edited = updateProjectTask(
      updateProject([project], "p1", {
        pluginProperties: { workday: { code: "CA004" } },
      }),
      "p1",
      "t1",
      { adjustmentMs: 600_000, pinnedSlot: "1" },
    );

    expect(
      planTeamSync(stateOf(edited), CONNECTION, NO_SKIPS).request.changes,
    ).toEqual([]);
  });

  it("waits for a project whose Undo window is open", () => {
    const edited = updateProject([syncedProject("p1")], "p1", { name: "X" });
    const plan = planTeamSync(stateOf(edited), CONNECTION, new Set(["p1"]));

    expect(plan.request.changes).toEqual([]);
  });

  it("sends a color the contract refuses as Ajour's default", () => {
    const shared = {
      ...localProject("p1", { color: "teal" }),
      team: { connectionId: CONNECTION },
    };
    const [change] = planTeamSync(stateOf([shared]), CONNECTION, NO_SKIPS)
      .request.changes;

    expect(change?.color).toBe(DEFAULT_PROJECT_COLOR);
  });

  it("reports a project it cannot send and still sends the others", () => {
    const tooLong = {
      ...localProject("p1", { name: "x".repeat(300) }),
      team: { connectionId: CONNECTION },
    };
    const fine = { ...localProject("p2"), team: { connectionId: CONNECTION } };
    const plan = planTeamSync(stateOf([tooLong, fine]), CONNECTION, NO_SKIPS);

    expect(plan.unsendable).toEqual([{ projectId: "p1" }]);
    expect(plan.request.changes.map((change) => change.localId)).toEqual([
      "p2",
    ]);
  });

  it("keeps a round within the project bound", () => {
    const projects = Array.from(
      { length: TEAM_SYNC_MAX_PROJECTS + 1 },
      (_, i) => ({
        ...localProject(`p${i}`),
        team: { connectionId: CONNECTION },
      }),
    );
    const plan = planTeamSync(stateOf(projects), CONNECTION, NO_SKIPS);

    expect(plan.request.changes).toHaveLength(TEAM_SYNC_MAX_PROJECTS);
    expect(plan.hasMoreChanges).toBe(true);
  });

  it("splits a project with more tasks than a round holds over two rounds", () => {
    const tasks = Array.from({ length: TEAM_SYNC_MAX_TASKS + 5 }, (_, i) =>
      localTask(`t${i}`),
    );
    const state = stateOf([
      { ...localProject("p1", { tasks }), team: { connectionId: CONNECTION } },
    ]);

    const first = planTeamSync(state, CONNECTION, NO_SKIPS);
    expect(first.request.changes[0]?.tasks).toHaveLength(TEAM_SYNC_MAX_TASKS);
    expect(first.hasMoreChanges).toBe(true);

    const assigned: [string, string][] = [
      ["p1", "remote-p1"],
      ...first.request.changes[0]!.tasks.map(
        (task) => [task.localId, `remote-${task.localId}`] as [string, string],
      ),
    ];
    const afterFirst = applyTeamSync(
      state,
      CONNECTION,
      first.request.changes,
      syncResult(
        [],
        assigned.map(([localId, remoteId]) => ({ localId, remoteId })),
      ),
      createFactories(),
    );
    const second = planTeamSync(afterFirst, CONNECTION, NO_SKIPS);

    expect(second.request.changes).toHaveLength(1);
    expect(second.request.changes[0]).toMatchObject({
      localId: "p1",
      remoteId: "remote-p1",
    });
    expect(second.request.changes[0]?.tasks).toHaveLength(5);
    expect(second.hasMoreChanges).toBe(false);
  });
});

describe("applying a team sync", () => {
  it("gives what it pushed its remote IDs, so the next round sends nothing", () => {
    const state = stateOf([
      {
        ...localProject("p1", { tasks: [localTask("t1")] }),
        team: { connectionId: CONNECTION },
      },
    ]);
    const next = roundTrip(state, [
      ["p1", "remote-p1"],
      ["t1", "remote-t1"],
    ]);

    expect(next.projects[0]?.team?.remoteId).toBe("remote-p1");
    expect(next.projects[0]?.tasks[0]?.team?.remoteId).toBe("remote-t1");
    expect(next.teamConnections[CONNECTION]?.cursor).toBe("cursor-2");
    expect(planTeamSync(next, CONNECTION, NO_SKIPS).request.changes).toEqual(
      [],
    );
  });

  it("keeps an edit made while the round was in flight for the next round", () => {
    const state = stateOf(
      updateProject([syncedProject("p1")], "p1", { name: "Pushed" }),
    );
    const plan = planTeamSync(state, CONNECTION, NO_SKIPS);
    const editedMeanwhile = {
      ...state,
      projects: updateProject(state.projects, "p1", { name: "Edited later" }),
    };

    const next = applyTeamSync(
      editedMeanwhile,
      CONNECTION,
      plan.request.changes,
      syncResult([]),
      createFactories(),
    );

    expect(next.projects[0]?.name).toBe("Edited later");
    expect(
      planTeamSync(next, CONNECTION, NO_SKIPS).request.changes[0],
    ).toMatchObject({ name: "Edited later" });
  });

  it("takes a teammate's rename and keeps a local budget change", () => {
    const task = localTask("t1");
    const local = updateProjectTask(
      [syncedProject("p1", { tasks: [task] })],
      "p1",
      "t1",
      { budgetMs: 7_200_000 },
    );
    const renamed = { ...localProject("p1"), name: "Renamed by Sam" };

    const next = applyTeamSync(
      stateOf(local),
      CONNECTION,
      [],
      syncResult([
        teamProject(renamed, [
          { ...teamTask(task), name: "Development (Sam)" },
        ]),
      ]),
      createFactories(),
    );
    const project = next.projects[0]!;

    expect(project.name).toBe("Renamed by Sam");
    expect(project.tasks[0]).toMatchObject({
      name: "Development (Sam)",
      budgetMs: 7_200_000,
    });
    expect(next.result).toMatchObject({
      kind: "applied",
      updatedProjectIds: ["p1"],
    });
    expect(planTeamSync(next, CONNECTION, NO_SKIPS).request.changes).toEqual([
      {
        localId: "p1",
        remoteId: "remote-p1",
        tasks: [{ localId: "t1", remoteId: "remote-t1", budgetMs: 7_200_000 }],
      },
    ]);
  });

  it("keeps personal fields when the team changes a task", () => {
    const task = localTask("t1", { pinnedSlot: "3", adjustmentMs: 900_000 });
    const next = applyTeamSync(
      stateOf([syncedProject("p1", { tasks: [task] })]),
      CONNECTION,
      [],
      syncResult([
        teamProject(localProject("p1"), [{ ...teamTask(task), name: "QA" }]),
      ]),
      createFactories(),
    );

    expect(next.projects[0]?.tasks[0]).toMatchObject({
      _id: "t1",
      name: "QA",
      pinnedSlot: "3",
      adjustmentMs: 900_000,
    });
  });

  it("archives and restores a task the team archived or restored", () => {
    const task = localTask("t1");
    const archive = applyTeamSync(
      stateOf([syncedProject("p1", { tasks: [task] })]),
      CONNECTION,
      [],
      syncResult([
        teamProject(localProject("p1"), [
          { ...teamTask(task), status: "archived" },
        ]),
      ]),
      createFactories(),
    );
    expect(archive.projects[0]?.tasks[0]).toMatchObject({
      status: "archived",
      archivedAt: 1_000,
    });

    const restore = applyTeamSync(
      archive,
      CONNECTION,
      [],
      syncResult([
        teamProject(localProject("p1"), [
          { ...teamTask(task), status: "active" },
        ]),
      ]),
      createFactories(),
    );
    expect(restore.projects[0]?.tasks[0]?.status).toBe("active");
    expect(restore.projects[0]?.tasks[0]?.archivedAt).toBeUndefined();
  });

  it("adds a team task, and links a same-name task added here before it synced", () => {
    const project = {
      ...syncedProject("p1"),
      tasks: [localTask("local-qa", { name: "QA" })],
    };
    const next = applyTeamSync(
      stateOf([project]),
      CONNECTION,
      [],
      syncResult([
        teamProject(localProject("p1"), [
          teamTask(localTask("x", { name: "qa" }), "remote-qa"),
          teamTask(localTask("y", { name: "Meetings" }), "remote-meetings"),
        ]),
      ]),
      createFactories(),
    );
    const tasks = next.projects[0]!.tasks;

    expect(tasks.map((task) => [task._id, task.team?.remoteId])).toEqual([
      ["local-qa", "remote-qa"],
      ["task-new-1", "remote-meetings"],
    ]);
  });

  it("adds a team project the workspace does not have, at the end", () => {
    const sams = localProject("sam", {
      name: "Beta",
      code: "BET",
      tasks: [localTask("t1", { budgetMs: 3_600_000 })],
    });
    const next = applyTeamSync(
      stateOf([localProject("p1")]),
      CONNECTION,
      [],
      syncResult([
        teamProject(sams, [teamTask(sams.tasks[0]!)], "remote-beta"),
      ]),
      createFactories(),
    );
    const created = next.projects[1]!;

    expect(created).toMatchObject({
      name: "Beta",
      code: "BET",
      status: "active",
      team: { connectionId: CONNECTION, remoteId: "remote-beta" },
    });
    expect(created.tasks[0]).toMatchObject({
      budgetMs: 3_600_000,
      team: { remoteId: "remote-t1" },
    });
    expect(next.result).toMatchObject({
      kind: "applied",
      createdProjectIds: [created._id],
    });
    expect(planTeamSync(next, CONNECTION, NO_SKIPS).request.changes).toEqual(
      [],
    );
  });

  it("holds a team project whose name a local project has, and adds nothing", () => {
    const mine = localProject("mine", { name: "Beta" });
    const next = applyTeamSync(
      stateOf([mine]),
      CONNECTION,
      [],
      syncResult([teamProject(localProject("sam", { name: "beta" }))]),
      createFactories(),
    );

    expect(next.projects).toEqual([mine]);
    expect(next.result).toMatchObject({
      kind: "applied",
      heldArrivals: [{ remoteId: "remote-sam", localProjectId: "mine" }],
    });
    expect(next.teamConnections[CONNECTION]?.heldArrivals).toMatchObject([
      { remoteId: "remote-sam", name: "beta" },
    ]);
    expect(planTeamSync(next, CONNECTION, NO_SKIPS).request.changes).toEqual(
      [],
    );
  });

  it("keeps a held arrival current while it waits", () => {
    const held = applyTeamSync(
      stateOf([localProject("mine", { name: "Beta" })]),
      CONNECTION,
      [],
      syncResult([
        teamProject(localProject("sam", { name: "Beta" }), [
          teamTask(localTask("t1", { name: "Development" })),
        ]),
      ]),
      createFactories(),
    );
    const next = applyTeamSync(
      held,
      CONNECTION,
      [],
      syncResult([
        teamProject(localProject("sam", { name: "Beta", code: "BET" }), [
          teamTask(localTask("t1", { name: "Dev" })),
          teamTask(localTask("t2", { name: "QA" })),
        ]),
      ]),
      createFactories(),
    );
    const [arrival] = next.teamConnections[CONNECTION]!.heldArrivals;

    expect(next.result).toMatchObject({ kind: "applied", heldArrivals: [] });
    expect(arrival?.code).toBe("BET");
    expect(arrival?.tasks.map((task) => task.name)).toEqual(["Dev", "QA"]);
  });

  it("ignores a team project the user unshared here", () => {
    const unshared = unshareProject(stateOf([syncedProject("p1")]), "p1");
    const next = applyTeamSync(
      unshared,
      CONNECTION,
      [],
      syncResult([teamProject(localProject("p1", { name: "Changed" }))]),
      createFactories(),
    );

    expect(next.projects).toHaveLength(1);
    expect(next.projects[0]?.team).toBeUndefined();
  });

  it("survives a restart: stored links read back and plan the same round", () => {
    const edited = updateProject([syncedProject("p1")], "p1", { code: "NEW" });
    const reloaded = (JSON.parse(JSON.stringify(edited)) as LocalProject[]).map(
      (project) => normalizeProject(project, () => 1),
    );

    expect(
      planTeamSync(stateOf(reloaded), CONNECTION, NO_SKIPS).request.changes,
    ).toEqual(
      planTeamSync(stateOf(edited), CONNECTION, NO_SKIPS).request.changes,
    );
  });

  it("drops a malformed stored link, which makes the project local", () => {
    const broken = {
      ...localProject("p1"),
      team: { connectionId: CONNECTION, remoteId: "remote-p1", synced: {} },
    } as unknown as LocalProject;

    expect(normalizeProject(broken, () => 1).team).toBeUndefined();
  });
});

describe("refusing an answer that contradicts the workspace", () => {
  function sharedNew(id: string, overrides: Partial<LocalProject> = {}) {
    return {
      ...localProject(id, overrides),
      team: { connectionId: CONNECTION },
    };
  }

  function expectRejected(
    before: TeamSyncState,
    after: ReturnType<typeof applyTeamSync>,
    reason: RegExp,
  ) {
    expect(after.result).toMatchObject({ kind: "rejected" });
    expect(after.result.kind === "rejected" && after.result.reason).toMatch(
      reason,
    );
    expect(after.projects).toEqual(before.projects);
    expect(after.teamConnections).toEqual(before.teamConnections);
  }

  it("refuses an ID that another shared project already has", () => {
    const state = stateOf([syncedProject("a"), sharedNew("b")]);
    const plan = planTeamSync(state, CONNECTION, NO_SKIPS);
    const next = applyTeamSync(
      state,
      CONNECTION,
      plan.request.changes,
      syncResult(
        [teamProject(localProject("b"), [], "remote-a")],
        [{ localId: "b", remoteId: "remote-a" }],
      ),
      createFactories(),
    );

    expectRejected(state, next, /one ID to two projects/);
  });

  it("refuses an answer that leaves out a new project's ID, or names one it was not sent", () => {
    const state = stateOf([sharedNew("p1")]);
    const plan = planTeamSync(state, CONNECTION, NO_SKIPS);

    expectRejected(
      state,
      applyTeamSync(
        state,
        CONNECTION,
        plan.request.changes,
        syncResult([teamProject(localProject("p1"), [], "remote-p1")]),
        createFactories(),
      ),
      /left out the ID of a new project/,
    );
    expectRejected(
      state,
      applyTeamSync(
        state,
        CONNECTION,
        plan.request.changes,
        syncResult(
          [],
          [
            { localId: "p1", remoteId: "remote-p1" },
            { localId: "ghost", remoteId: "remote-ghost" },
          ],
        ),
        createFactories(),
      ),
      /did not send/,
    );
  });

  it("refuses an answer that moves a task to another project", () => {
    const task = localTask("t1");
    const state = stateOf([
      syncedProject("p1", { tasks: [task] }),
      syncedProject("p2"),
    ]);
    const next = applyTeamSync(
      state,
      CONNECTION,
      [],
      syncResult([teamProject(localProject("p2"), [teamTask(task)])]),
      createFactories(),
    );

    expectRejected(state, next, /moved a task/);
  });
});

describe("answers that arrive after the user changed the project", () => {
  it("leaves a link made while the round was on its way", () => {
    const state = stateOf(
      updateProject([syncedProject("p1")], "p1", { code: "OLD" }),
    );
    const plan = planTeamSync(state, CONNECTION, NO_SKIPS);
    const relinked = linkProject(
      unshareProject(state, "p1"),
      CONNECTION,
      "p1",
      teamProject(localProject("other", { name: "Gamma" }), [], "remote-b"),
      createFactories(),
    );

    const next = applyTeamSync(
      relinked,
      CONNECTION,
      plan.request.changes,
      syncResult([teamProject(localProject("p1", { code: "OLD" }))]),
      createFactories(),
    );

    expect(next.projects).toHaveLength(1);
    expect(next.projects[0]?.team).toEqual(relinked.projects[0]?.team);
    expect(next.projects[0]?.name).toBe("Gamma");
  });

  it("ignores the team's project for a share undone before its first answer", () => {
    const state = stateOf([
      { ...localProject("p1"), team: { connectionId: CONNECTION } },
    ]);
    const plan = planTeamSync(state, CONNECTION, NO_SKIPS);
    const undone = unshareProject(
      {
        ...state,
        projects: updateProject(state.projects, "p1", { name: "Renamed" }),
      },
      "p1",
    );
    expect(undone.teamConnections[CONNECTION]?.unsharedLocalIds).toEqual([
      "p1",
    ]);

    const next = applyTeamSync(
      undone,
      CONNECTION,
      plan.request.changes,
      syncResult(
        [teamProject(localProject("p1"), [], "remote-p1")],
        [{ localId: "p1", remoteId: "remote-p1" }],
      ),
      createFactories(),
    );

    expect(next.result).toMatchObject({
      kind: "applied",
      createdProjectIds: [],
      heldArrivals: [],
    });
    expect(next.projects).toEqual(undone.projects);
    expect(next.teamConnections[CONNECTION]).toMatchObject({
      unsharedRemoteIds: ["remote-p1"],
      unsharedLocalIds: [],
    });
  });

  it("links the team's project when the user shared it again before the answer", () => {
    const state = stateOf([
      { ...localProject("p1"), team: { connectionId: CONNECTION } },
    ]);
    const plan = planTeamSync(state, CONNECTION, NO_SKIPS);
    const sharedAgain = shareProject(
      unshareProject(state, "p1"),
      CONNECTION,
      "p1",
    );

    const next = applyTeamSync(
      sharedAgain,
      CONNECTION,
      plan.request.changes,
      syncResult(
        [teamProject(localProject("p1"), [], "remote-p1")],
        [{ localId: "p1", remoteId: "remote-p1" }],
      ),
      createFactories(),
    );

    expect(next.projects).toHaveLength(1);
    expect(next.projects[0]?.team?.remoteId).toBe("remote-p1");
    expect(next.teamConnections[CONNECTION]?.unsharedRemoteIds).toEqual([]);
  });
});

describe("sharing, linking and leaving a team", () => {
  it("shares a local project, which goes to the team with the next sync", () => {
    const next = shareProject(stateOf([localProject("p1")]), CONNECTION, "p1");

    expect(next.result).toEqual({ kind: "shared" });
    expect(next.projects[0]?.team).toEqual({ connectionId: CONNECTION });
    expect(
      planTeamSync(next, CONNECTION, NO_SKIPS).request.changes,
    ).toHaveLength(1);
  });

  it("refuses to share before the connection's first sync", () => {
    const state = { ...stateOf([localProject("p1")]), teamConnections: {} };

    expect(shareProject(state, CONNECTION, "p1").result).toEqual({
      kind: "notSynced",
    });
  });

  it("refuses to share a project whose name a shared project of the team has", () => {
    const state = stateOf([
      syncedProject("shared", { name: "Beta" }),
      localProject("mine", { name: "beta" }),
    ]);
    const next = shareProject(state, CONNECTION, "mine");

    expect(next.result).toEqual({
      kind: "sameNameShared",
      sharedProjectId: "shared",
    });
    expect(next.projects).toEqual(state.projects);
    expect(shareProject(state, CONNECTION, "shared").result).toEqual({
      kind: "alreadyShared",
    });
  });

  it("links a local project to a team project: team values, tasks by name", () => {
    const mine = localProject("mine", {
      name: "Beta",
      color: "#000000",
      tasks: [
        localTask("dev", { name: "Development", billable: false }),
        localTask("private", { name: "Learning" }),
      ],
    });
    const team = teamProject(
      localProject("sam", { name: "Beta", color: "#4f46e5" }),
      [
        teamTask(localTask("x", { name: "development" }), "remote-dev"),
        teamTask(localTask("y", { name: "Meetings" }), "remote-meetings"),
      ],
      "remote-beta",
    );
    const next = linkProject(
      stateOf([mine]),
      CONNECTION,
      "mine",
      team,
      createFactories(),
    );
    const project = next.projects[0]!;

    expect(next.result).toEqual({ kind: "linked" });
    expect(project).toMatchObject({
      _id: "mine",
      color: "#4f46e5",
      team: { remoteId: "remote-beta" },
    });
    expect(
      project.tasks.map((task) => [
        task._id,
        task.billable,
        task.team?.remoteId,
      ]),
    ).toEqual([
      ["dev", true, "remote-dev"],
      ["private", true, undefined],
      ["task-new-1", true, "remote-meetings"],
    ]);
    expect(
      planTeamSync(next, CONNECTION, NO_SKIPS).request.changes,
    ).toMatchObject([{ localId: "mine", tasks: [{ localId: "private" }] }]);
  });

  it("links a held arrival to the local project, which becomes the shared one", () => {
    const mine = localProject("mine", {
      name: "Beta",
      tasks: [localTask("t-mine", { name: "Development" })],
    });
    const held = applyTeamSync(
      stateOf([mine]),
      CONNECTION,
      [],
      syncResult([
        teamProject(localProject("sam", { name: "Beta" }), [
          teamTask(localTask("t1", { name: "Development" })),
        ]),
      ]),
      createFactories(),
    );
    const next = resolveHeldArrival(
      held,
      CONNECTION,
      "remote-sam",
      { kind: "link", projectId: "mine" },
      createFactories(),
    );

    expect(next.result).toEqual({ kind: "linked" });
    expect(next.projects).toHaveLength(1);
    expect(next.projects[0]).toMatchObject({
      _id: "mine",
      team: { remoteId: "remote-sam" },
      tasks: [{ _id: "t-mine", team: { remoteId: "remote-t1" } }],
    });
    expect(next.teamConnections[CONNECTION]?.heldArrivals).toEqual([]);
  });

  it("adds a held arrival as its own project and leaves the local one alone", () => {
    const mine = localProject("mine", { name: "Beta" });
    const held = applyTeamSync(
      stateOf([mine]),
      CONNECTION,
      [],
      syncResult([teamProject(localProject("sam", { name: "Beta" }))]),
      createFactories(),
    );
    const next = resolveHeldArrival(
      held,
      CONNECTION,
      "remote-sam",
      { kind: "addSeparately" },
      createFactories(),
    );

    expect(next.result).toEqual({
      kind: "added",
      projectId: next.projects[1]!._id,
    });
    expect(next.projects[0]).toEqual(mine);
    expect(next.projects[1]?.team?.remoteId).toBe("remote-sam");
    expect(next.teamConnections[CONNECTION]?.heldArrivals).toEqual([]);
    expect(
      resolveHeldArrival(
        next,
        CONNECTION,
        "remote-sam",
        { kind: "addSeparately" },
        createFactories(),
      ).result,
    ).toEqual({ kind: "notHeld" });
  });

  it("points Share at a held arrival of the same name", () => {
    const held = applyTeamSync(
      stateOf([
        localProject("mine", { name: "Beta" }),
        localProject("other", { name: "BETA" }),
      ]),
      CONNECTION,
      [],
      syncResult([teamProject(localProject("sam", { name: "Beta" }))]),
      createFactories(),
    );

    expect(shareProject(held, CONNECTION, "other").result).toEqual({
      kind: "sameNameHeld",
      remoteId: "remote-sam",
    });
  });

  it("keeps a held project with more tasks than a page holds across a restart", () => {
    const pageTasks = (from: number, count: number) =>
      Array.from({ length: count }, (_, i) =>
        teamTask(localTask(`t${from + i}`)),
      );
    const mine = stateOf([localProject("mine", { name: "Beta" })]);
    const sams = localProject("sam", { name: "Beta" });
    const firstPage = applyTeamSync(
      mine,
      CONNECTION,
      [],
      syncResult([teamProject(sams, pageTasks(0, TEAM_SYNC_MAX_TASKS))]),
      createFactories(),
    );
    const secondPage = applyTeamSync(
      firstPage,
      CONNECTION,
      [],
      syncResult([teamProject(sams, pageTasks(TEAM_SYNC_MAX_TASKS, 1))]),
      createFactories(),
    );
    const reloaded = normalizeTeamConnections(
      JSON.parse(JSON.stringify(secondPage.teamConnections)),
    );

    expect(reloaded[CONNECTION]?.heldArrivals[0]?.tasks).toHaveLength(
      TEAM_SYNC_MAX_TASKS + 1,
    );
  });

  it("reads held arrivals back after a restart and drops malformed ones", () => {
    const held = applyTeamSync(
      stateOf([localProject("mine", { name: "Beta" })]),
      CONNECTION,
      [],
      syncResult([teamProject(localProject("sam", { name: "Beta" }))]),
      createFactories(),
    );
    const stored = JSON.parse(JSON.stringify(held.teamConnections)) as Record<
      string,
      { heldArrivals: unknown[] }
    >;
    stored[CONNECTION]!.heldArrivals.push({ remoteId: "broken" });

    expect(normalizeTeamConnections(stored)[CONNECTION]?.heldArrivals).toEqual(
      held.teamConnections[CONNECTION]?.heldArrivals,
    );
  });

  it("unshares on this machine only, and disconnecting makes every project local", () => {
    const state = stateOf([
      syncedProject("p1", { tasks: [localTask("t1")] }),
      syncedProject("p2"),
      localProject("p3"),
    ]);

    const unshared = unshareProject(state, "p1");
    expect(unshared.projects[0]?.team).toBeUndefined();
    expect(unshared.projects[0]?.tasks[0]?.team).toBeUndefined();
    expect(unshared.teamConnections[CONNECTION]?.unsharedRemoteIds).toEqual([
      "remote-p1",
    ]);

    const disconnected = disconnectTeam(roundTrip(state), CONNECTION);
    expect(disconnected.projects.every((project) => !project.team)).toBe(true);
    expect(disconnected.teamConnections).toEqual({});
    expect(
      disconnected.projects.map((project) => [
        project._id,
        project.tasks.map((task) => task._id),
      ]),
    ).toEqual([
      ["p1", ["t1"]],
      ["p2", []],
      ["p3", []],
    ]);
  });
});
