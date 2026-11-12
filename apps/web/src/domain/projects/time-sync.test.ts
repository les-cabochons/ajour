import { describe, expect, it } from "vitest";
import type { TimeSyncResult } from "@ajour/shared";
import type {
  LocalProject,
  LocalTimeSync,
  LocalTimesheetEntry,
} from "@/domain/local-state";
import {
  NO_PROPERTY_PLUGINS,
  type PropertyPlugins,
} from "@/domain/projects/plugin-properties";
import {
  applyTimeSyncRound,
  describeTimeSyncStatus,
  entrySyncKey,
  failTimeSyncRound,
  planTimeSyncRound,
  reconcileTimeSyncs,
  startTimeSync,
  stopTimeSync,
  type TimeSyncContext,
  type TimeSyncPlan,
  type TimeSyncState,
} from "@/domain/projects/time-sync";

/*
 * The time sync rules for saved entries (#692, ADR 0018): which entries
 * qualify, the changes a round sends against the synced copies, and what a
 * round's answer does to them. Today is Thursday 2026-11-12, and Time
 * entries went on this week, the week of 2026-11-09.
 */

const CONNECTION = { pluginId: "example-project-source", connectionId: "c1" };
const TODAY = "2026-11-12";
const MINUTE = 60_000;

const CONTEXT: TimeSyncContext = {
  today: TODAY,
  timeZone: "America/Toronto",
  plugins: NO_PROPERTY_PLUGINS,
  namesSource: undefined,
};

/** Acme - Support, managed by the connection, with a task of each kind. */
function managedProject(overrides: Partial<LocalProject> = {}): LocalProject {
  return {
    _id: "acme",
    name: "Acme - Support",
    color: "#123456",
    icon: { kind: "preset", name: "dot" },
    status: "active",
    source: { ...CONNECTION, remoteId: "ACME-SUP", syncedAt: 1 },
    tasks: [
      {
        _id: "login",
        name: "Ticket #101 - Login",
        status: "active",
        createdAt: 1,
        source: { remoteId: "1001", assigned: true },
      },
      { _id: "ad-hoc", name: "Ad hoc support", status: "active", createdAt: 1 },
      {
        _id: "temp",
        name: "Temp migration",
        status: "active",
        createdAt: 1,
        commitAs: "waiting",
      },
      {
        _id: "mine",
        name: "Reading",
        status: "active",
        createdAt: 1,
        commitAs: "local",
      },
    ],
    ...overrides,
  };
}

function entry(
  id: string,
  overrides: Partial<LocalTimesheetEntry> = {},
): LocalTimesheetEntry {
  return {
    _id: id,
    localDate: TODAY,
    projectId: "acme",
    taskId: "login",
    label: "",
    note: "Fixed the redirect for ACME",
    durationMs: 90 * MINUTE,
    sourceBlockIds: [],
    committedAt: 1,
    ...overrides,
  };
}

/** The state with Time entries on since this week, and nothing synced yet. */
function stateWith(
  entries: LocalTimesheetEntry[],
  projects: LocalProject[] = [managedProject()],
): TimeSyncState {
  return {
    projects,
    timesheetEntries: entries,
    timeSyncs: startTimeSync({}, CONNECTION, TODAY, 100),
  };
}

function plan(state: TimeSyncState, context: TimeSyncContext = CONTEXT) {
  return planTimeSyncRound(state, CONNECTION, context, 200)!;
}

describe("planning a round", () => {
  it("sends a saved entry on a managed project in whole minutes, under its task's name, without its note", () => {
    const round = plan(
      stateWith([entry("e1", { durationMs: 90 * MINUTE + 29_000 })]),
    );

    expect(round.request.changes).toEqual([
      {
        kind: "upsert",
        syncKey: "e1",
        values: {
          localDate: TODAY,
          minutes: 90,
          running: false,
          projectRemoteId: "ACME-SUP",
          taskName: "Ticket #101 - Login",
          taskRemoteId: "1001",
        },
      },
    ]);
    expect(JSON.stringify(round.request)).not.toContain("redirect");
  });

  it("leaves out an entry that doesn't qualify", () => {
    const otherSource = managedProject({
      _id: "globex",
      source: {
        pluginId: CONNECTION.pluginId,
        connectionId: "another-connection",
        remoteId: "GLOBEX-INT",
        syncedAt: 1,
      },
    });
    const local = managedProject({ _id: "local", source: undefined });
    const localOnly = managedProject({ _id: "private", localOnly: true });
    const round = plan(
      stateWith(
        [
          entry("on-another-connection", { projectId: "globex" }),
          entry("on-a-local-project", { projectId: "local" }),
          entry("on-a-local-only-project", { projectId: "private" }),
          entry("on-a-local-only-task", { taskId: "mine" }),
          entry("without-a-task", { taskId: undefined }),
          entry("before-the-start-week", { localDate: "2026-11-08" }),
          entry("tomorrow", { localDate: "2026-11-13" }),
          entry("a-mis-click", { durationMs: 29_999 }),
          entry("half-a-minute", { durationMs: 30_000 }),
          entry("on-monday", { localDate: "2026-11-09" }),
        ],
        [managedProject(), otherSource, local, localOnly],
      ),
    );

    expect(round.request.changes.map((change) => change.syncKey)).toEqual([
      "on-monday",
      "half-a-minute",
    ]);
    // Half a minute rounds to one whole minute.
    expect(round.request.changes[1]).toMatchObject({ values: { minutes: 1 } });
  });

  it("rounds to the nearest whole minute, and sends at least 1", () => {
    const minutes = (durationMs: number) => {
      const [change] = plan(stateWith([entry("e1", { durationMs })])).request
        .changes;
      return change?.kind === "upsert" ? change.values.minutes : undefined;
    };

    expect(minutes(30_000)).toBe(1);
    expect(minutes(89_000)).toBe(1);
    expect(minutes(90_000)).toBe(2);
    expect(minutes(89 * MINUTE + 31_000)).toBe(90);
  });

  it("sends the name the task commits as, and a Not known yet task's own name", () => {
    const workday: PropertyPlugins = {
      projects: [],
      tasks: [
        {
          pluginId: "workday-agent",
          capability: {
            section: "Workday",
            fields: [
              { id: "task", label: "Workday task", defaultFrom: "name" },
            ],
          },
        },
      ],
    };
    const project = managedProject();
    project.tasks[1] = {
      ...project.tasks[1]!,
      pluginProperties: { "workday-agent": { task: "07 Run" } },
    };
    const state = stateWith(
      [
        entry("mapped", { taskId: "ad-hoc" }),
        entry("waiting", { taskId: "temp" }),
      ],
      [project],
    );

    const round = plan(state, { ...CONTEXT, plugins: workday });

    expect(
      round.request.changes.map((change) =>
        change.kind === "upsert" ? change.values : undefined,
      ),
    ).toEqual([
      expect.objectContaining({ taskName: "07 Run" }),
      expect.objectContaining({ taskName: "Temp migration" }),
    ]);
    // A task the source doesn't know has no remote id to send.
    expect(round.request.changes[0]).not.toHaveProperty("values.taskRemoteId");
  });

  it("sends the current week and the 4 before it, never before the start week", () => {
    const state = stateWith([]);
    expect(plan(state).request).toMatchObject({
      from: "2026-11-09",
      to: "2026-11-15",
      timeZone: "America/Toronto",
    });

    state.timeSyncs[CONNECTION.connectionId]!.startWeek = "2026-09-07";
    expect(plan(state).request).toMatchObject({
      from: "2026-10-12",
      to: "2026-11-15",
    });
  });

  it("sends 20 changes a round, in day order, and counts the rest as waiting", () => {
    const entries = Array.from({ length: 23 }, (_, index) =>
      entry(`e${String(index).padStart(2, "0")}`, {
        localDate: index % 2 ? "2026-11-10" : "2026-11-11",
      }),
    );
    const round = plan(stateWith(entries));

    expect(round.request.changes).toHaveLength(20);
    expect(round.waiting).toBe(3);
    expect(round.request.changes[0]).toMatchObject({
      syncKey: "e01",
      values: { localDate: "2026-11-10" },
    });
  });

  it("has nothing to plan for a connection without a time sync", () => {
    const state = stateWith([entry("e1")]);
    state.timeSyncs = {};
    expect(planTimeSyncRound(state, CONNECTION, CONTEXT, 200)).toBeUndefined();
  });
});

/** A plugin's answer that syncs every change, as the example planner does. */
function syncEverything(
  round: TimeSyncPlan,
  updatedAt = "2026-11-12T14:00:00.000Z",
): TimeSyncResult {
  const results = round.request.changes.map((change, index) =>
    change.kind === "upsert"
      ? {
          syncKey: change.syncKey,
          status: "synced" as const,
          entry: {
            remoteId: change.remoteId ?? `remote-${index + 1}`,
            clientRef: change.syncKey,
            ...change.values,
            updatedAt,
          },
        }
      : { syncKey: change.syncKey, status: "synced" as const },
  );
  return {
    results,
    entries: results.flatMap((result) =>
      "entry" in result && result.entry ? [result.entry] : [],
    ),
  };
}

/** Plans a round, answers it with `answer`, and returns the state after. */
function runRound(
  state: TimeSyncState,
  answer: (round: TimeSyncPlan) => TimeSyncResult = syncEverything,
  now = 300,
) {
  const round = plan(state);
  const applied = applyTimeSyncRound(state, round, answer(round), CONTEXT, now);
  return {
    round,
    result: applied.result,
    state: { ...state, timeSyncs: applied.timeSyncs },
  };
}

function recordIn(state: TimeSyncState): LocalTimeSync {
  return state.timeSyncs[CONNECTION.connectionId]!;
}

describe("applying a round", () => {
  it("keeps a synced copy, and sends only what differs from it", () => {
    const first = runRound(stateWith([entry("e1"), entry("e2")]));
    expect(first.result).toEqual({
      kind: "applied",
      synced: 2,
      refused: 0,
      failed: 0,
      waiting: 0,
    });
    expect(recordIn(first.state).copies.e1).toEqual({
      remoteId: "remote-1",
      agreed: expect.objectContaining({ minutes: 90 }),
      remoteUpdatedAt: "2026-11-12T14:00:00.000Z",
    });
    expect(plan(first.state).request.changes).toEqual([]);

    // 20 more seconds is the same whole minute; a minute more is a change.
    const seconds = {
      ...first.state,
      timesheetEntries: [
        entry("e1", { durationMs: 90 * MINUTE + 20_000 }),
        entry("e2", { durationMs: 91 * MINUTE }),
      ],
    };
    expect(plan(seconds).request.changes).toEqual([
      {
        kind: "upsert",
        syncKey: "e2",
        remoteId: "remote-2",
        agreed: expect.objectContaining({ minutes: 90 }),
        values: expect.objectContaining({ minutes: 91 }),
      },
    ]);
  });

  it("changes nothing for a round that brought nothing new, so the poll writes nothing", () => {
    const synced = runRound(stateWith([entry("e1")])).state;
    // The first quiet round turns "1 sent" into "up to date".
    const upToDate = runRound(synced, syncEverything, 900).state;
    expect(recordIn(upToDate).lastRound).toMatchObject({ at: 900, synced: 0 });

    const quiet = runRound(upToDate, syncEverything, 960);

    expect(quiet.result).toMatchObject({ kind: "applied", synced: 0 });
    expect(quiet.state.timeSyncs).toBe(upToDate.timeSyncs);
  });

  it("deletes an entry that stops qualifying, or is gone, then drops its copy", () => {
    const synced = runRound(stateWith([entry("moved"), entry("gone")])).state;
    const after = {
      ...synced,
      timesheetEntries: [entry("moved", { taskId: "mine" })],
    };

    const { round, state } = runRound(after);

    expect(round.request.changes).toEqual([
      {
        kind: "delete",
        syncKey: "gone",
        remoteId: "remote-1",
        agreed: expect.objectContaining({ taskName: "Ticket #101 - Login" }),
      },
      {
        kind: "delete",
        syncKey: "moved",
        remoteId: "remote-2",
        agreed: expect.objectContaining({ taskName: "Ticket #101 - Login" }),
      },
    ]);
    expect(recordIn(state).copies).toEqual({});
    expect(plan(state).request.changes).toEqual([]);
  });

  it("keeps a refusal's message, and sends the entry again only once it changes", () => {
    const tooLong = entry("e1", { durationMs: 25 * 60 * MINUTE });
    const refuse = (round: TimeSyncPlan): TimeSyncResult => ({
      results: round.request.changes.map((change) => ({
        syncKey: change.syncKey,
        status: "refused",
        message: "The planner refuses an entry over 24 hours.",
      })),
      entries: [],
    });

    const { result, state } = runRound(stateWith([tooLong]), refuse);

    expect(result).toMatchObject({ kind: "applied", synced: 0, refused: 1 });
    expect(recordIn(state).refusals.e1).toMatchObject({
      message: "The planner refuses an entry over 24 hours.",
    });
    expect(recordIn(state).lastRound).toMatchObject({ synced: 0, refused: 1 });
    expect(plan(state).request.changes).toEqual([]);

    const shorter = {
      ...state,
      timesheetEntries: [entry("e1", { durationMs: 8 * 60 * MINUTE })],
    };
    expect(plan(shorter).request.changes).toEqual([
      expect.objectContaining({ kind: "upsert", syncKey: "e1" }),
    ]);
    const settled = runRound(shorter).state;
    expect(recordIn(settled).refusals).toEqual({});
  });

  it("sends a failed change again next round", () => {
    const fail = (round: TimeSyncPlan): TimeSyncResult => ({
      results: round.request.changes.map((change) => ({
        syncKey: change.syncKey,
        status: "failed",
        message: "The planner timed out.",
      })),
      entries: [],
    });

    const { result, state } = runRound(stateWith([entry("e1")]), fail);

    expect(result).toMatchObject({ kind: "applied", synced: 0, failed: 1 });
    expect(recordIn(state).lastRound).toMatchObject({
      failed: 1,
      failedMessage: "The planner timed out.",
    });
    expect(recordIn(state).copies).toEqual({});
    expect(plan(state).request.changes).toEqual([
      expect.objectContaining({ kind: "upsert", syncKey: "e1" }),
    ]);
  });

  it("takes only the remote updatedAt from the listing, for the entries it holds a copy of", () => {
    const synced = runRound(stateWith([entry("e1")])).state;
    const listing = (): TimeSyncResult => ({
      results: [],
      entries: [
        {
          remoteId: "remote-1",
          clientRef: "e1",
          localDate: TODAY,
          minutes: 120,
          running: false,
          projectRemoteId: "ACME-SUP",
          taskName: "Ticket #102 - Export",
          updatedAt: "2026-11-12T15:00:00.000Z",
        },
        {
          remoteId: "logged-elsewhere",
          localDate: TODAY,
          minutes: 30,
          running: false,
          projectRemoteId: "ACME-SUP",
          taskName: "Ticket #101 - Login",
          updatedAt: "2026-11-12T15:00:00.000Z",
        },
      ],
    });

    const { state } = runRound(synced, listing);

    expect(recordIn(state).copies).toEqual({
      e1: {
        remoteId: "remote-1",
        agreed: expect.objectContaining({ minutes: 90 }),
        remoteUpdatedAt: "2026-11-12T15:00:00.000Z",
      },
    });
    expect(state.timesheetEntries).toEqual(synced.timesheetEntries);
  });

  it("notes when it first saw a local change, until both sides agree again", () => {
    const synced = runRound(stateWith([entry("e1")])).state;
    const edited = {
      ...synced,
      timesheetEntries: [entry("e1", { durationMs: 120 * MINUTE })],
    };
    const failed = {
      ...edited,
      timeSyncs: failTimeSyncRound(
        edited,
        CONNECTION,
        "The planner is down.",
        410,
        { plan: { ...plan(edited), plannedAt: 400 }, context: CONTEXT },
      ),
    };
    expect(recordIn(failed).copies.e1?.changedAt).toBe(400);
    expect(recordIn(failed).error).toEqual({
      at: 410,
      message: "The planner is down.",
    });

    const round = { ...plan(failed), plannedAt: 500 };
    const applied = applyTimeSyncRound(
      failed,
      round,
      syncEverything(round),
      CONTEXT,
      510,
    );
    const record = applied.timeSyncs[CONNECTION.connectionId]!;
    expect(record.copies.e1).not.toHaveProperty("changedAt");
    expect(record.error).toBeUndefined();
    expect(record.lastRound).toEqual({
      at: 510,
      synced: 1,
      refused: 0,
      failed: 0,
    });
  });

  it("applies nothing when Time entries went off and on while the round ran", () => {
    const state = stateWith([entry("e1")]);
    const round = plan(state);
    const restarted = {
      ...state,
      timeSyncs: startTimeSync(
        stopTimeSync(state.timeSyncs, CONNECTION.connectionId),
        CONNECTION,
        TODAY,
        999,
      ),
    };

    const applied = applyTimeSyncRound(
      restarted,
      round,
      syncEverything(round),
      CONTEXT,
      300,
    );

    expect(applied.result).toEqual({ kind: "discarded" });
    expect(applied.timeSyncs).toBe(restarted.timeSyncs);
  });

  it("sends every qualifying entry again once Time entries is back on, by the same sync keys", () => {
    const synced = runRound(stateWith([entry("e1")])).state;
    const again = {
      ...synced,
      timeSyncs: startTimeSync(
        stopTimeSync(synced.timeSyncs, CONNECTION.connectionId),
        CONNECTION,
        TODAY,
        999,
      ),
    };

    expect(plan(again).request.changes).toEqual([
      expect.objectContaining({
        kind: "upsert",
        syncKey: entrySyncKey(entry("e1")),
      }),
    ]);
    expect(plan(again).request.changes[0]).not.toHaveProperty("remoteId");
  });
});

describe("starting and stopping with the plugins overview", () => {
  const group = (inactive: boolean, connectionIds: string[]) => ({
    plugin: {
      id: CONNECTION.pluginId,
      capabilities: { projectSource: {}, timeSync: {} },
    },
    enabled: true,
    inactiveCapabilities: inactive ? (["timeSync"] as const) : [],
    connections: connectionIds.map((id) => ({ id })),
  });
  const reconcile = (
    syncs: Record<string, LocalTimeSync>,
    groups: ReturnType<typeof group>[],
  ) =>
    reconcileTimeSyncs(
      syncs,
      { connectionGroups: groups } as unknown as Parameters<
        typeof reconcileTimeSyncs
      >[1],
      TODAY,
      700,
    );

  it("starts each connection with Time entries on this week, and stops it when the switch goes off or the connection goes", () => {
    const started = reconcile({}, [group(false, ["c1", "c2"])]);
    expect(started.c1).toMatchObject({
      pluginId: CONNECTION.pluginId,
      startWeek: "2026-11-09",
      startedAt: 700,
    });
    expect(reconcile(started, [group(false, ["c1", "c2"])])).toBe(started);

    expect(Object.keys(reconcile(started, [group(false, ["c2"])]))).toEqual([
      "c2",
    ]);
    expect(reconcile(started, [group(true, ["c1", "c2"])])).toEqual({});
    // A plugin the overview doesn't list may still be loading.
    expect(reconcile(started, [])).toBe(started);
  });
});

describe("the connection's status line", () => {
  const record = (overrides: Partial<LocalTimeSync> = {}): LocalTimeSync => ({
    pluginId: CONNECTION.pluginId,
    startWeek: "2026-11-09",
    startedAt: 1,
    copies: {},
    refusals: {},
    ...overrides,
  });
  const refusal = (message: string) => ({
    message,
    change: "delete" as const,
    at: 1,
  });

  it("says nothing before the first round", () => {
    expect(describeTimeSyncStatus(undefined)).toBeUndefined();
    expect(describeTimeSyncStatus(record())).toBeUndefined();
  });

  it("says what the last round sent, or that it is up to date", () => {
    const round = { at: 1, synced: 2, refused: 0, failed: 0 };
    expect(describeTimeSyncStatus(record({ lastRound: round }))).toEqual({
      summary: "Time entries · 2 sent",
      notes: [],
    });
    expect(
      describeTimeSyncStatus(record({ lastRound: { ...round, synced: 0 } })),
    ).toEqual({ summary: "Time entries · up to date", notes: [] });
  });

  it("counts the refusals that stand, with each message once, and the last round's failure", () => {
    const status = describeTimeSyncStatus(
      record({
        lastRound: {
          at: 1,
          synced: 0,
          refused: 0,
          failed: 1,
          failedMessage: "The planner timed out.",
        },
        refusals: {
          e1: refusal("The planner refuses an entry over 24 hours."),
          e2: refusal("The planner refuses an entry over 24 hours."),
        },
      }),
    );

    expect(status).toEqual({
      summary: "Time entries · 2 refused · 1 failed",
      notes: [
        "The planner refuses an entry over 24 hours.",
        "The planner timed out.",
      ],
    });
  });

  it("says the last sync failed, and why, until a round goes through", () => {
    expect(
      describeTimeSyncStatus(
        record({
          lastRound: { at: 1, synced: 2, refused: 0, failed: 0 },
          error: { at: 2, message: "The planner is down." },
        }),
      ),
    ).toEqual({
      summary: "Time entries · Last sync failed",
      error: "The planner is down.",
      notes: [],
    });
  });
});
