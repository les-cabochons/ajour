import { describe, expect, it } from "vitest";
import type { TimeSyncRemoteEntry, TimeSyncResult } from "@ajour/shared";
import type {
  LocalAppState,
  LocalProject,
  LocalTimer,
  LocalTimeSync,
  LocalTimesheetEntry,
} from "@/domain/local-state";
import {
  NO_PROPERTY_PLUGINS,
  type PropertyPlugins,
} from "@/domain/projects/plugin-properties";
import {
  entrySyncKey,
  normalizeTimesheetEntry,
  updateTimesheetEntry,
} from "@/domain/time/timesheet-entry";
import { findLockedWeekWrite } from "@/domain/time/locked-weeks";
import {
  applyTimeSyncRound,
  describeTimeSyncHoldReason,
  describeTimeSyncStatus,
  failTimeSyncRound,
  normalizeTimeSyncs,
  planTimeSyncRound,
  reconcileTimeSyncs,
  startTimeSync,
  stopTimeSync,
  type TimeSyncContext,
  type TimeSyncPlan,
  type TimeSyncState,
} from "@/domain/projects/time-sync";
import {
  cancelTimer,
  continueTimesheetEntry,
  editRunningEntry,
  saveTimer,
  startTimer,
} from "@/domain/time/timer-transitions";

/*
 * The time sync rules for saved entries (#692, ADR 0018): which entries
 * qualify, the changes a round sends against the synced copies, and what a
 * round's answer does to them. Today is Thursday 2026-11-12, and Time
 * entries went on this week, the week of 2026-11-09.
 */

const CONNECTION = { pluginId: "example-project-source", connectionId: "c1" };
const TODAY = "2026-11-12";
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

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
    timesheetTombstones: [],
    timers: [],
    workItems: [],
    lockedWeeks: [],
    timeSyncs: startTimeSync({}, CONNECTION, TODAY, 100),
  };
}

/** Ids in order, and a clock that reads `now`, for what a round creates. */
function factoriesAt(now: number) {
  let next = 0;
  return {
    createId: (prefix: string) => `${prefix}-${++next}`,
    now: () => now,
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

/**
 * A plugin's answer that syncs every change, as the example planner does.
 * Its listing has the entries it synced, and, given the state, the others
 * its copies agree on, as the other system holds them when nothing changed
 * there.
 */
function syncEverything(
  round: TimeSyncPlan,
  state?: TimeSyncState,
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
  const sent = new Set(round.request.changes.map((change) => change.syncKey));
  const unchanged = Object.entries(
    state?.timeSyncs[CONNECTION.connectionId]?.copies ?? {},
  ).flatMap(([syncKey, copy]) =>
    sent.has(syncKey)
      ? []
      : [
          {
            remoteId: copy.remoteId,
            clientRef: syncKey,
            ...copy.agreed,
            updatedAt: copy.remoteUpdatedAt,
          },
        ],
  );
  return {
    results,
    entries: [
      ...results.flatMap((result) =>
        "entry" in result && result.entry ? [result.entry] : [],
      ),
      ...unchanged,
    ],
  };
}

/** Plans a round, answers it with `answer`, and returns the state after. */
function runRound(
  state: TimeSyncState,
  answer: (
    round: TimeSyncPlan,
    state: TimeSyncState,
  ) => TimeSyncResult = syncEverything,
  now = 300,
) {
  const round = plan(state);
  const applied = applyTimeSyncRound(
    state,
    round,
    answer(round, state),
    CONTEXT,
    factoriesAt(now),
  );
  return { round, result: applied.result, state: applied.state };
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
      putBack: 0,
      refused: 0,
      failed: 0,
      waiting: 0,
      received: 0,
      held: 0,
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
      factoriesAt(510),
    );
    const record = recordIn(applied.state);
    expect(record.copies.e1).not.toHaveProperty("changedAt");
    expect(record.error).toBeUndefined();
    expect(record.lastRound).toEqual({
      at: 510,
      synced: 1,
      putBack: 0,
      received: 0,
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
      factoriesAt(300),
    );

    expect(applied.result).toEqual({ kind: "discarded" });
    expect(applied.state).toBe(restarted);
  });

  it("keeps no failure of a round that began before Time entries went off and on", () => {
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

    const failed = failTimeSyncRound(
      restarted,
      CONNECTION,
      "The planner is down.",
      300,
      { plan: round, context: CONTEXT },
    );

    expect(failed).toBe(restarted.timeSyncs);
    expect(failed[CONNECTION.connectionId]).not.toHaveProperty("error");
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

/*
 * The running entry (#693). It starts at 10:00 in Toronto today, NOW, on
 * Ticket #101 - Login, and goes through the same timer transitions as in
 * the app: Stop, a switch, Continue and Discard.
 */
describe("the running entry", () => {
  const NOW = Date.parse("2026-11-12T15:00:00.000Z");
  const at = (offsetMs: number) => new Date(NOW + offsetMs).toISOString();

  function timer(id: string, overrides: Partial<LocalTimer> = {}): LocalTimer {
    return {
      _id: id,
      startedAt: NOW,
      localDate: TODAY,
      projectId: "acme",
      taskId: "login",
      note: "Fixed the redirect for ACME",
      accumulatedDurationMs: 0,
      ...overrides,
    };
  }

  function running(entries: LocalTimesheetEntry[] = []): TimeSyncState {
    return { ...stateWith(entries), timers: [timer("t1")] };
  }

  /** Runs a timer transition at `now`, as the store does. */
  function act(
    state: TimeSyncState,
    now: number,
    transition: (
      app: LocalAppState,
      factories: { createId: (prefix: string) => string; now: () => number },
    ) => LocalAppState,
  ): TimeSyncState {
    const next = transition(
      { ...state, workItems: [] } as unknown as LocalAppState,
      { createId: (prefix) => `${prefix}-at-${now - NOW}`, now: () => now },
    );
    return {
      ...state,
      timers: next.timers,
      timesheetEntries: next.timesheetEntries,
    };
  }

  const changesAt = (state: TimeSyncState, now: number) =>
    planTimeSyncRound(state, CONNECTION, CONTEXT, now)!.request.changes;

  /** Plans a round at `now`, and applies the example planner's answer. */
  function roundAt(state: TimeSyncState, now: number) {
    const round = planTimeSyncRound(state, CONNECTION, CONTEXT, now)!;
    const applied = applyTimeSyncRound(
      state,
      round,
      syncEverything(round, state),
      CONTEXT,
      factoriesAt(now),
    );
    return { round, state: applied.state };
  }

  it("sends the running entry as running, counting since its count would have started from zero", () => {
    expect(changesAt(running(), NOW + 10 * MINUTE)).toEqual([
      {
        kind: "upsert",
        syncKey: "t1",
        values: {
          localDate: TODAY,
          minutes: 10,
          running: true,
          countingSince: at(0),
          projectRemoteId: "ACME-SUP",
          taskName: "Ticket #101 - Login",
          taskRemoteId: "1001",
        },
      },
    ]);
  });

  it("keeps a running entry local until it has run 30 seconds, and a Stop before then too", () => {
    const state = running();

    expect(changesAt(state, NOW + 29_999)).toEqual([]);
    expect(changesAt(state, NOW + 30_000)).toEqual([
      expect.objectContaining({
        syncKey: "t1",
        values: expect.objectContaining({ running: true, minutes: 1 }),
      }),
    ]);
    const stopped = act(state, NOW + 20_000, (app, factories) =>
      saveTimer(app, "t1", factories),
    );
    expect(changesAt(stopped, NOW + 22_000)).toEqual([]);
  });

  it("sends Stop as the same entry stopped: the saved entry keeps the running entry's key", () => {
    const sent = roundAt(running(), NOW + 5 * MINUTE).state;
    const stopped = act(sent, NOW + 45 * MINUTE, (app, factories) =>
      saveTimer(app, "t1", factories),
    );
    expect(stopped.timesheetEntries).toEqual([
      expect.objectContaining({ syncKey: "t1", durationMs: 45 * MINUTE }),
    ]);

    const { round, state } = roundAt(stopped, NOW + 45 * MINUTE + 2_000);

    expect(round.request.changes).toEqual([
      {
        kind: "upsert",
        syncKey: "t1",
        remoteId: "remote-1",
        agreed: expect.objectContaining({
          running: true,
          countingSince: at(0),
        }),
        values: {
          localDate: TODAY,
          minutes: 45,
          running: false,
          projectRemoteId: "ACME-SUP",
          taskName: "Ticket #101 - Login",
          taskRemoteId: "1001",
        },
      },
    ]);
    expect(Object.keys(recordIn(state).copies)).toEqual(["t1"]);
    expect(changesAt(state, NOW + 50 * MINUTE)).toEqual([]);
  });

  it("sends a switch as the first entry stopped, then the second running, in one round", () => {
    const sent = roundAt(running(), NOW + 5 * MINUTE).state;
    const switched = act(sent, NOW + 45 * MINUTE, (app, factories) =>
      startTimer(
        app,
        { projectId: "acme", taskId: "ad-hoc" },
        TODAY,
        factories,
      ),
    );

    // Two seconds later: the second entry takes over from the first at once,
    // and stays there in the next round, though it hasn't run 30 seconds.
    const { round, state } = roundAt(switched, NOW + 45 * MINUTE + 2_000);
    expect(changesAt(state, NOW + 45 * MINUTE + 4_000)).toEqual([]);
    expect(round.request.changes).toEqual([
      expect.objectContaining({
        kind: "upsert",
        syncKey: "t1",
        values: expect.objectContaining({ running: false, minutes: 45 }),
      }),
      expect.objectContaining({
        kind: "upsert",
        syncKey: `timer-at-${45 * MINUTE}`,
        values: expect.objectContaining({
          running: true,
          countingSince: at(45 * MINUTE),
          taskName: "Ad hoc support",
        }),
      }),
    ]);
  });

  it("sends Continue on an entry taken from there to its remote entry, also once Time entries went off and on", () => {
    const taken = stateWith([entry("e1", { timeSyncRemoteId: "logged" })]);
    const continued = act(taken, NOW + MINUTE, (app, factories) =>
      continueTimesheetEntry(app, "e1", TODAY, factories),
    );

    expect(changesAt(continued, NOW + MINUTE + 2_000)).toEqual([
      expect.objectContaining({
        kind: "upsert",
        syncKey: "e1",
        remoteId: "logged",
        values: expect.objectContaining({ running: true }),
      }),
    ]);
  });

  it("sends Continue on today's entry as that entry running again, counting its saved time", () => {
    const saved = roundAt(stateWith([entry("e1")]), NOW).state;
    const continued = act(saved, NOW + MINUTE, (app, factories) =>
      continueTimesheetEntry(app, "e1", TODAY, factories),
    );

    expect(changesAt(continued, NOW + MINUTE + 2_000)).toEqual([
      {
        kind: "upsert",
        syncKey: "e1",
        remoteId: "remote-1",
        agreed: expect.objectContaining({ running: false, minutes: 90 }),
        values: expect.objectContaining({
          running: true,
          minutes: 90,
          // 90 minutes saved, resumed a minute after NOW.
          countingSince: at(MINUTE - 90 * MINUTE),
        }),
      },
    ]);
  });

  it("sends Discard as a delete, and on a continued entry puts back its saved time, stopped", () => {
    const sent = roundAt(running(), NOW + 5 * MINUTE).state;
    const discarded = act(sent, NOW + 6 * MINUTE, (app) =>
      cancelTimer(app, "t1"),
    );
    expect(changesAt(discarded, NOW + 6 * MINUTE + 2_000)).toEqual([
      {
        kind: "delete",
        syncKey: "t1",
        remoteId: "remote-1",
        agreed: expect.objectContaining({ running: true }),
      },
    ]);

    const saved = roundAt(stateWith([entry("e1")]), NOW).state;
    const continued = roundAt(
      act(saved, NOW + MINUTE, (app, factories) =>
        continueTimesheetEntry(app, "e1", TODAY, factories),
      ),
      NOW + 2 * MINUTE,
    ).state;
    const putBack = act(continued, NOW + 3 * MINUTE, (app) =>
      cancelTimer(app, continued.timers[0]!._id),
    );
    expect(changesAt(putBack, NOW + 3 * MINUTE + 2_000)).toEqual([
      expect.objectContaining({
        kind: "upsert",
        syncKey: "e1",
        values: expect.objectContaining({ running: false, minutes: 90 }),
      }),
    ]);
  });

  it("never sends a running entry again as time passes, only when its count moves by a minute or more", () => {
    const sent = roundAt(running(), NOW + 5 * MINUTE).state;
    expect(changesAt(sent, NOW + 3 * 60 * MINUTE)).toEqual([]);

    const recount = (countedDurationMs: number) =>
      act(sent, NOW + 10 * MINUTE + 40_000, (app, factories) =>
        editRunningEntry(
          app,
          "t1",
          { projectId: "acme", taskId: "login", countedDurationMs },
          factories,
        ),
      );
    // Typed back as 10 minutes at 10:40: the count starts 40 seconds later.
    expect(changesAt(recount(10 * MINUTE), NOW + 11 * MINUTE)).toEqual([]);
    expect(changesAt(recount(60 * MINUTE), NOW + 11 * MINUTE)).toEqual([
      expect.objectContaining({
        syncKey: "t1",
        values: expect.objectContaining({
          countingSince: at(40_000 - 50 * MINUTE),
        }),
      }),
    ]);
  });

  it("keeps the key handed over at save once Time entries is back on", () => {
    const sent = roundAt(running(), NOW + 5 * MINUTE).state;
    const stopped = roundAt(
      act(sent, NOW + 45 * MINUTE, (app, factories) =>
        saveTimer(app, "t1", factories),
      ),
      NOW + 46 * MINUTE,
    ).state;
    const again = {
      ...stopped,
      timeSyncs: startTimeSync(
        stopTimeSync(stopped.timeSyncs, CONNECTION.connectionId),
        CONNECTION,
        TODAY,
        999,
      ),
    };

    expect(changesAt(again, NOW + 50 * MINUTE)).toEqual([
      expect.objectContaining({
        kind: "upsert",
        syncKey: "t1",
        values: expect.objectContaining({ running: false, minutes: 45 }),
      }),
    ]);
  });
});

/** An entry as the other system lists it: 45 minutes today on Ticket #101 - Login. */
function remoteEntry(
  remoteId: string,
  overrides: Partial<TimeSyncRemoteEntry> = {},
): TimeSyncRemoteEntry {
  return {
    remoteId,
    localDate: TODAY,
    minutes: 45,
    running: false,
    projectRemoteId: "ACME-SUP",
    taskName: "Ticket #101 - Login",
    updatedAt: LATER,
    ...overrides,
  };
}

/** An answer that syncs every change, and lists exactly `entries`. */
function listing(...entries: TimeSyncRemoteEntry[]) {
  return (round: TimeSyncPlan): TimeSyncResult => ({
    results: syncEverything(round).results,
    entries,
  });
}

/** Synced at 14:00; the other system changes things at 15:00. */
const LATER = "2026-11-12T15:00:00.000Z";

/** e1, synced as remote-1, as the other system lists it with `overrides`. */
function remoteE1(overrides: Partial<TimeSyncRemoteEntry> = {}) {
  return remoteEntry("remote-1", {
    clientRef: "e1",
    minutes: 90,
    taskRemoteId: "1001",
    ...overrides,
  });
}

function entriesOf(state: TimeSyncState) {
  return state.timesheetEntries;
}

describe("taking the other system's changes", () => {
  it("adds an entry logged elsewhere on the task it names, with a copy that sends nothing back", () => {
    const { state, result } = runRound(
      stateWith([]),
      listing(remoteEntry("logged", { taskName: "ticket #101 -  LOGIN" })),
    );

    expect(entriesOf(state)).toEqual([
      expect.objectContaining({
        localDate: TODAY,
        projectId: "acme",
        taskId: "login",
        durationMs: 45 * MINUTE,
        note: undefined,
      }),
    ]);
    const added = entriesOf(state)[0]!;
    expect(recordIn(state).copies[entrySyncKey(added)]).toEqual({
      remoteId: "logged",
      agreed: expect.objectContaining({
        minutes: 45,
        taskName: "Ticket #101 - Login",
        taskRemoteId: "1001",
      }),
      remoteUpdatedAt: LATER,
    });
    expect(result).toMatchObject({ received: 1, held: 0 });
    expect(plan(state).request.changes).toEqual([]);
    expect(describeTimeSyncStatus(recordIn(state))?.summary).toBe(
      "Time entries · 1 received",
    );
  });

  it("keeps the remote id of an entry it took, so Time entries off and on updates that entry instead of adding one", () => {
    const logged = remoteEntry("logged");
    const taken = runRound(stateWith([]), listing(logged)).state;
    const [added] = entriesOf(taken);
    expect(added).toMatchObject({ timeSyncRemoteId: "logged" });
    // It survives an edit, and a reload.
    const edited = updateTimesheetEntry(
      taken,
      added!._id,
      { durationMs: HOUR },
      factoriesAt(400),
    );
    const [reloaded] = edited.timesheetEntries.map((item) =>
      normalizeTimesheetEntry(JSON.parse(JSON.stringify(item))),
    );
    expect(reloaded).toMatchObject({ timeSyncRemoteId: "logged" });
    expect(
      normalizeTimesheetEntry({ ...reloaded!, timeSyncRemoteId: 7 } as never),
    ).not.toHaveProperty("timeSyncRemoteId");
    const again = {
      ...edited,
      timesheetEntries: [reloaded!],
      timeSyncs: startTimeSync({}, CONNECTION, TODAY, 999),
    };

    expect(plan(again).request.changes).toEqual([
      {
        kind: "upsert",
        syncKey: added!._id,
        remoteId: "logged",
        values: expect.objectContaining({ minutes: 60 }),
      },
    ]);
    // A send that fails still never takes the same entry as a new one.
    const failed = runRound(again, (round) => ({
      results: round.request.changes.map((change) => ({
        syncKey: change.syncKey,
        status: "failed" as const,
        message: "The planner timed out.",
      })),
      entries: [logged],
    })).state;
    expect(entriesOf(failed)).toEqual([reloaded]);
    const sent = runRound(failed).state;
    expect(entriesOf(sent)).toEqual([reloaded]);
    expect(recordIn(sent).copies[added!._id]).toMatchObject({
      remoteId: "logged",
    });
  });

  it("reads the remote ids of entries taken on its own connection only", () => {
    const other = { ...CONNECTION, connectionId: "c2" };
    const globex = managedProject({
      _id: "globex",
      source: { ...other, remoteId: "GLOBEX-INT", syncedAt: 1 },
    });
    // c1 took remote entry 7 of its system; c2's system has its own 7.
    const state = stateWith(
      [entry("taken-on-c1", { timeSyncRemoteId: "7" })],
      [managedProject(), globex],
    );
    state.timeSyncs = startTimeSync(state.timeSyncs, other, TODAY, 100);
    const round = planTimeSyncRound(state, other, CONTEXT, 200)!;

    const applied = applyTimeSyncRound(
      state,
      round,
      listing(remoteEntry("7", { projectRemoteId: "GLOBEX-INT" }))(round),
      CONTEXT,
      factoriesAt(300),
    );

    expect(entriesOf(applied.state)).toEqual([
      entry("taken-on-c1", { timeSyncRemoteId: "7" }),
      expect.objectContaining({ projectId: "globex", timeSyncRemoteId: "7" }),
    ]);
  });

  it("finds the task by the name it commits as, then by its own name, else adds a Not known yet task once", () => {
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
    const state = stateWith([], [project]);
    const context = { ...CONTEXT, plugins: workday };
    const round = plan(state, context);

    const applied = applyTimeSyncRound(
      state,
      round,
      listing(
        remoteEntry("by-commit-name", { taskName: "07 run" }),
        remoteEntry("by-own-name", { taskName: "Ad hoc support" }),
        remoteEntry("new-1", { taskName: "Code review" }),
        remoteEntry("new-2", { taskName: "code  review" }),
      )(round),
      context,
      factoriesAt(300),
    );

    const codeReview = applied.state.projects[0]!.tasks.filter(
      (task) => task.name === "Code review",
    );
    expect(codeReview).toEqual([
      expect.objectContaining({ commitAs: "waiting", status: "active" }),
    ]);
    expect(entriesOf(applied.state).map((entry) => entry.taskId)).toEqual([
      "ad-hoc",
      "ad-hoc",
      codeReview[0]!._id,
      codeReview[0]!._id,
    ]);
    expect(applied.result).toMatchObject({ received: 4 });
    // A Not known yet task goes under its own name, as the remote has it.
    expect(plan(applied.state, context).request.changes).toEqual([]);
  });

  it("takes an edit made there, keeping the seconds when the whole minutes agree", () => {
    const synced = runRound(
      stateWith([entry("e1", { durationMs: 90 * MINUTE + 20_000 })]),
    ).state;

    const retasked = runRound(
      synced,
      listing(
        remoteE1({ taskName: "Ad hoc support", taskRemoteId: undefined }),
      ),
    );
    expect(entriesOf(retasked.state)).toEqual([
      expect.objectContaining({
        taskId: "ad-hoc",
        durationMs: 90 * MINUTE + 20_000,
        note: "Fixed the redirect for ACME",
      }),
    ]);
    expect(retasked.result).toMatchObject({ received: 1 });
    expect(plan(retasked.state).request.changes).toEqual([]);

    const moved = runRound(
      synced,
      listing(remoteE1({ localDate: "2026-11-10", minutes: 120 })),
    ).state;
    expect(entriesOf(moved)).toEqual([
      expect.objectContaining({
        localDate: "2026-11-10",
        taskId: "login",
        durationMs: 120 * MINUTE,
      }),
    ]);
    expect(recordIn(moved).copies.e1).toEqual({
      remoteId: "remote-1",
      agreed: expect.objectContaining({
        localDate: "2026-11-10",
        minutes: 120,
      }),
      remoteUpdatedAt: LATER,
    });
    expect(plan(moved).request.changes).toEqual([]);
  });

  it("is no edit when only the time it changed there moves, or values it doesn't keep differ", () => {
    const synced = runRound(stateWith([entry("e1")])).state;

    const { state, result } = runRound(
      synced,
      listing(
        remoteE1({ taskName: "TICKET #101 - LOGIN", taskRemoteId: undefined }),
      ),
    );

    expect(entriesOf(state)).toEqual(entriesOf(synced));
    expect(result).toMatchObject({ received: 0 });
    expect(recordIn(state).copies.e1?.remoteUpdatedAt).toBe(LATER);
    expect(plan(state).request.changes).toEqual([]);
  });

  it("deletes an entry deleted there, and a committed one leaves its tombstone", () => {
    const commit = {
      at: 50,
      localDate: TODAY,
      projectId: "acme",
      taskId: "login",
      note: "Fixed the redirect for ACME",
      durationMs: 90 * MINUTE,
    };
    const synced = runRound(stateWith([entry("e1", { commit })])).state;

    const { state, result } = runRound(synced, listing());

    expect(entriesOf(state)).toEqual([]);
    expect(state.timesheetTombstones).toEqual([{ entryId: "e1", commit }]);
    expect(recordIn(state).copies).toEqual({});
    expect(result).toMatchObject({ received: 1 });
    expect(plan(state).request.changes).toEqual([]);
  });

  it("lets a delete there win over an edit in Ajour", () => {
    const synced = runRound(stateWith([entry("e1")])).state;
    const edited = {
      ...synced,
      timesheetEntries: [entry("e1", { durationMs: 2 * 60 * MINUTE })],
    };
    // The round planned before the edit, so the edit waits for the next one.
    const round = plan(synced);

    const applied = applyTimeSyncRound(
      edited,
      round,
      listing()(round),
      CONTEXT,
      factoriesAt(300),
    );

    expect(entriesOf(applied.state)).toEqual([]);
    expect(recordIn(applied.state).copies).toEqual({});
  });

  it("lets a delete in Ajour win over an edit there", () => {
    const synced = runRound(stateWith([entry("e1")])).state;
    const deleted = { ...synced, timesheetEntries: [] };
    const round = plan(synced);

    const applied = applyTimeSyncRound(
      deleted,
      round,
      listing(remoteE1({ minutes: 120 }))(round),
      CONTEXT,
      factoriesAt(300),
    );

    expect(entriesOf(applied.state)).toEqual([]);
    expect(plan(applied.state).request.changes).toEqual([
      expect.objectContaining({ kind: "delete", syncKey: "e1" }),
    ]);
  });

  describe("when both sides changed the entry", () => {
    /** e1 synced, then edited to 2:00 in Ajour, first seen at `changedAt`. */
    function editedBothWays(changedAt: string) {
      const synced = runRound(stateWith([entry("e1")])).state;
      const record = recordIn(synced);
      const edited: TimeSyncState = {
        ...synced,
        timesheetEntries: [entry("e1", { durationMs: 2 * 60 * MINUTE })],
        timeSyncs: {
          [CONNECTION.connectionId]: {
            ...record,
            copies: {
              e1: { ...record.copies.e1!, changedAt: Date.parse(changedAt) },
            },
          },
        },
      };
      // A round planned before the edit: the change waits, as a refused or a
      // 21st change does.
      const round = plan(synced);
      return applyTimeSyncRound(
        edited,
        round,
        listing(remoteE1({ minutes: 45 }))(round),
        CONTEXT,
        factoriesAt(Date.parse("2026-11-12T17:00:00.000Z")),
      );
    }

    it("keeps Ajour's change when it is the later one, and sends it", () => {
      const { state, result } = editedBothWays("2026-11-12T16:00:00.000Z");

      expect(entriesOf(state)).toEqual([
        expect.objectContaining({ durationMs: 2 * 60 * MINUTE }),
      ]);
      expect(result).toMatchObject({ received: 0 });
      expect(plan(state).request.changes).toEqual([
        expect.objectContaining({
          kind: "upsert",
          syncKey: "e1",
          values: expect.objectContaining({ minutes: 120 }),
        }),
      ]);
    });

    it("takes the other system's change when it is the later one", () => {
      const { state, result } = editedBothWays("2026-11-12T14:30:00.000Z");

      expect(entriesOf(state)).toEqual([
        expect.objectContaining({ durationMs: 45 * MINUTE }),
      ]);
      expect(result).toMatchObject({ received: 1 });
      expect(recordIn(state).copies.e1).not.toHaveProperty("changedAt");
      expect(plan(state).request.changes).toEqual([]);
    });
  });

  it("dates a waiting change from the round that first saw it, so a later edit there wins", () => {
    const keys = Array.from(
      { length: 21 },
      (_, index) => `e${String(index).padStart(2, "0")}`,
    );
    const agreed = {
      localDate: TODAY,
      minutes: 90,
      running: false,
      projectRemoteId: "ACME-SUP",
      taskName: "Ticket #101 - Login",
      taskRemoteId: "1001",
    };
    const synced = stateWith(keys.map((key) => entry(key)));
    recordIn(synced).copies = Object.fromEntries(
      keys.map((key) => [
        key,
        {
          remoteId: `remote-${key}`,
          agreed,
          remoteUpdatedAt: "2026-11-12T14:00:00.000Z",
        },
      ]),
    );
    const edited = {
      ...synced,
      timesheetEntries: keys.map((key) =>
        entry(key, { durationMs: 2 * 60 * MINUTE }),
      ),
    };
    // Planned at 14:30 with 21 changes: e20 waits. Edited there at 15:00,
    // answered at 16:00.
    const round = {
      ...plan(edited),
      plannedAt: Date.parse("2026-11-12T14:30:00.000Z"),
    };
    expect(round.waiting).toBe(1);
    const answer = syncEverything(round);
    answer.entries.push(
      remoteEntry("remote-e20", {
        clientRef: "e20",
        minutes: 45,
        taskRemoteId: "1001",
      }),
    );

    const applied = applyTimeSyncRound(
      edited,
      round,
      answer,
      CONTEXT,
      factoriesAt(Date.parse("2026-11-12T16:00:00.000Z")),
    );

    expect(
      entriesOf(applied.state).find((item) => item._id === "e20"),
    ).toMatchObject({ durationMs: 45 * MINUTE });
  });

  it("dates an edit made after its round's change synced from now, so it wins over an older edit there", () => {
    const synced = runRound(stateWith([entry("e1")])).state;
    const at120 = {
      ...synced,
      timesheetEntries: [entry("e1", { durationMs: 120 * MINUTE })],
    };
    // Planned at 14:30 and synced there at 14:40; edited to 45 there at
    // 15:00, and to 2:30 in Ajour at 15:30; answered at 16:00.
    const round = {
      ...plan(at120),
      plannedAt: Date.parse("2026-11-12T14:30:00.000Z"),
    };
    const [sent] = syncEverything(
      round,
      at120,
      "2026-11-12T14:40:00.000Z",
    ).results;
    const at150 = {
      ...at120,
      timesheetEntries: [entry("e1", { durationMs: 150 * MINUTE })],
    };

    const applied = applyTimeSyncRound(
      at150,
      round,
      { results: [sent!], entries: [remoteE1({ minutes: 45 })] },
      CONTEXT,
      factoriesAt(Date.parse("2026-11-12T16:00:00.000Z")),
    );

    expect(entriesOf(applied.state)).toEqual([
      expect.objectContaining({ durationMs: 150 * MINUTE }),
    ]);
    expect(plan(applied.state).request.changes).toEqual([
      expect.objectContaining({
        values: expect.objectContaining({ minutes: 150 }),
      }),
    ]);

    // The next round, planned at 16:30, leaves it waiting past its 20; an
    // edit there at 15:10 shows only now. Ajour's edit, seen at 16:00, wins.
    const next = {
      ...plan(applied.state),
      plannedAt: Date.parse("2026-11-12T16:30:00.000Z"),
    };
    const waiting = {
      ...next,
      request: { ...next.request, changes: [] },
      waiting: 1,
    };
    const later = applyTimeSyncRound(
      applied.state,
      waiting,
      {
        results: [],
        entries: [
          remoteE1({ minutes: 30, updatedAt: "2026-11-12T15:10:00.000Z" }),
        ],
      },
      CONTEXT,
      factoriesAt(Date.parse("2026-11-12T17:00:00.000Z")),
    );
    expect(entriesOf(later.state)).toEqual([
      expect.objectContaining({ durationMs: 150 * MINUTE }),
    ]);
  });

  it("never reads an entry as deleted while its change of the round failed or was refused", () => {
    const synced = runRound(stateWith([entry("e1"), entry("e2")])).state;
    const edited = {
      ...synced,
      timesheetEntries: [
        entry("e1", { durationMs: 2 * 60 * MINUTE }),
        entry("e2", { durationMs: 25 * 60 * MINUTE }),
      ],
    };
    // Continue made the plugin delete e1 there, then the start failed; e2
    // is over 24 hours. Neither is listed.
    const answer = (): TimeSyncResult => ({
      results: [
        { syncKey: "e1", status: "failed", message: "The planner timed out." },
        {
          syncKey: "e2",
          status: "refused",
          message: "The planner refuses an entry over 24 hours.",
        },
      ],
      entries: [],
    });

    const { state } = runRound(edited, answer);

    expect(entriesOf(state).map((item) => item._id)).toEqual(["e1", "e2"]);
    expect(Object.keys(recordIn(state).copies)).toEqual(["e1", "e2"]);
    expect(plan(state).request.changes).toEqual([
      expect.objectContaining({ kind: "upsert", syncKey: "e1" }),
    ]);
  });

  it("never reads an entry as deleted while its refusal stands, in the rounds after too", () => {
    const synced = runRound(stateWith([entry("e1")])).state;
    const tooLong = {
      ...synced,
      timesheetEntries: [entry("e1", { durationMs: 25 * 60 * MINUTE })],
    };
    // Continue made the plugin delete e1 there, then refused the start.
    const refused = runRound(tooLong, (round) => ({
      results: round.request.changes.map((change) => ({
        syncKey: change.syncKey,
        status: "refused" as const,
        message: "The planner refuses an entry over 24 hours.",
      })),
      entries: [],
    })).state;
    expect(plan(refused).request.changes).toEqual([]);

    const { state } = runRound(refused, listing());

    expect(entriesOf(state).map((item) => item._id)).toEqual(["e1"]);
    expect(Object.keys(recordIn(state).copies)).toEqual(["e1"]);
  });

  it("keeps Ajour's values on the first round: an entry it made is its own, not a new one", () => {
    // Made before Time entries went off and on, and changed there since.
    const before = remoteEntry("remote-old", { clientRef: "e1", minutes: 30 });
    const first = (round: TimeSyncPlan): TimeSyncResult => ({
      results: [
        { syncKey: "e1", status: "failed", message: "The planner timed out." },
      ],
      entries: [before],
    });

    const failed = runRound(stateWith([entry("e1")]), first).state;
    expect(entriesOf(failed)).toEqual([entry("e1")]);
    expect(recordIn(failed).copies).toEqual({});

    // The plugin adopts it by its client reference and sets Ajour's values.
    const adopted = runRound(failed, (round) => ({
      results: syncEverything(round).results.map((result) =>
        result.status === "synced" && result.entry
          ? { ...result, entry: { ...result.entry, remoteId: "remote-old" } }
          : result,
      ),
      entries: [{ ...before, minutes: 90, taskRemoteId: "1001" }],
    })).state;
    expect(entriesOf(adopted)).toEqual([entry("e1")]);
    expect(recordIn(adopted).copies.e1).toMatchObject({
      remoteId: "remote-old",
      agreed: expect.objectContaining({ minutes: 90 }),
    });
  });

  it("holds an entry on a project the connection doesn't manage, or on Local only time, with its reason", () => {
    const unmanaged = remoteEntry("globex", {
      projectRemoteId: "GLOBEX-INT",
      taskName: "Design review",
      minutes: 30,
    });
    const localOnly = remoteEntry("reading", { taskName: "Reading" });

    const { state, result } = runRound(
      stateWith([]),
      listing(unmanaged, localOnly),
    );

    expect(entriesOf(state)).toEqual([]);
    expect(recordIn(state).held).toEqual([
      {
        remoteId: "globex",
        localDate: TODAY,
        minutes: 30,
        projectRemoteId: "GLOBEX-INT",
        taskName: "Design review",
        reason: "unmanagedProject",
      },
      expect.objectContaining({ remoteId: "reading", reason: "localOnlyTask" }),
    ]);
    expect(result).toMatchObject({ received: 0, held: 2 });
    expect(describeTimeSyncStatus(recordIn(state))?.summary).toBe(
      "Time entries · 2 held",
    );

    // Gone there, it leaves Sync review; turning Time entries off drops them.
    expect(recordIn(runRound(state, listing()).state).held).toEqual([]);
    expect(stopTimeSync(state.timeSyncs, CONNECTION.connectionId)).toEqual({});
  });

  it("never reads an entry outside the window as deleted", () => {
    const old = entry("old", { localDate: "2026-10-05" });
    const state = stateWith([old]);
    state.timeSyncs[CONNECTION.connectionId]!.startWeek = "2026-09-07";
    const synced = runRound(state).state;
    expect(plan(synced).request.from).toBe("2026-10-12");

    const { state: after } = runRound(synced, listing());

    expect(entriesOf(after)).toEqual([old]);
    expect(Object.keys(recordIn(after).copies)).toEqual(["old"]);
  });

  it("leaves a saved entry that runs again there as it is: not an edit, and not a new running entry", () => {
    const synced = runRound(stateWith([entry("e1")])).state;

    const { state, result } = runRound(
      synced,
      listing(remoteE1({ running: true, countingSince: LATER, minutes: 120 })),
    );

    expect(entriesOf(state)).toEqual([entry("e1")]);
    expect(state.timers).toEqual([]);
    expect(recordIn(state).copies.e1?.remoteUpdatedAt).toBe(
      "2026-11-12T14:00:00.000Z",
    );
    expect(result).toMatchObject({ received: 0, held: 0 });
  });
});

/*
 * A submitted week stays as the user committed it (#696). Last week, from
 * Monday 2026-11-02, is submitted, and Time entries went on that week.
 */
describe("a submitted week", () => {
  const SUBMITTED = "2026-11-02";

  /** The entries synced as remote-1 and on, in day order, then last week submitted. */
  function submittedWeek(
    entries: LocalTimesheetEntry[] = [entry("e1", { localDate: SUBMITTED })],
  ): TimeSyncState {
    const state = stateWith(entries);
    state.timeSyncs[CONNECTION.connectionId]!.startWeek = SUBMITTED;
    return {
      ...runRound(state).state,
      lockedWeeks: [{ weekOf: SUBMITTED, lockedAt: 400 }],
    };
  }

  /** A round that never writes to the submitted week: the store would refuse it. */
  function roundIn(
    state: TimeSyncState,
    answer?: (round: TimeSyncPlan, state: TimeSyncState) => TimeSyncResult,
  ) {
    const ran = runRound(state, answer);
    expect(findLockedWeekWrite(state, ran.state)).toBeUndefined();
    return ran;
  }

  /** e1 as the other system lists it after an edit there to 1:00. */
  const editedThere = (overrides: Partial<TimeSyncRemoteEntry> = {}) =>
    remoteE1({ localDate: SUBMITTED, minutes: 60, ...overrides });

  it("puts back an edit made there: the next round sends Ajour's values over it", () => {
    const submitted = submittedWeek();

    const seen = roundIn(submitted, listing(editedThere()));

    expect(entriesOf(seen.state)).toEqual(entriesOf(submitted));
    expect(seen.result).toMatchObject({ received: 0, putBack: 0 });
    // `agreed` is what the other system holds now, so its plugin sees what
    // goes back, such as a day it moved.
    expect(plan(seen.state).request.changes).toEqual([
      {
        kind: "upsert",
        syncKey: "e1",
        remoteId: "remote-1",
        agreed: expect.objectContaining({ minutes: 60 }),
        values: expect.objectContaining({ localDate: SUBMITTED, minutes: 90 }),
      },
    ]);

    const back = roundIn(seen.state);
    expect(back.result).toMatchObject({ synced: 0, putBack: 1 });
    expect(describeTimeSyncStatus(recordIn(back.state))?.summary).toBe(
      "Time entries · 1 put back",
    );
    expect(plan(back.state).request.changes).toEqual([]);
  });

  it("puts back an edit that moves an entry out of the submitted week, or into it", () => {
    const submitted = submittedWeek([
      entry("e1", { localDate: SUBMITTED }),
      entry("e2", { localDate: "2026-11-10" }),
    ]);

    const seen = roundIn(
      submitted,
      listing(
        remoteE1({ localDate: "2026-11-10" }),
        remoteEntry("remote-2", {
          clientRef: "e2",
          localDate: "2026-11-03",
          minutes: 90,
          taskRemoteId: "1001",
        }),
      ),
    );

    expect(entriesOf(seen.state)).toEqual(entriesOf(submitted));
    expect(plan(seen.state).request.changes).toEqual([
      expect.objectContaining({
        syncKey: "e1",
        agreed: expect.objectContaining({ localDate: "2026-11-10" }),
        values: expect.objectContaining({ localDate: SUBMITTED }),
      }),
      expect.objectContaining({
        syncKey: "e2",
        agreed: expect.objectContaining({ localDate: "2026-11-03" }),
        values: expect.objectContaining({ localDate: "2026-11-10" }),
      }),
    ]);
  });

  it("puts back a delete made there: the next round creates the entry again", () => {
    const submitted = submittedWeek();

    const seen = roundIn(submitted, listing());

    expect(entriesOf(seen.state)).toEqual(entriesOf(submitted));
    expect(seen.result).toMatchObject({ received: 0, putBack: 0 });
    // Its remote entry is gone, so nothing names it.
    expect(plan(seen.state).request.changes).toEqual([
      {
        kind: "upsert",
        syncKey: "e1",
        values: expect.objectContaining({ localDate: SUBMITTED, minutes: 90 }),
      },
    ]);

    const back = roundIn(seen.state);
    expect(back.result).toMatchObject({ synced: 0, putBack: 1 });
    expect(recordIn(back.state).copies.e1).toMatchObject({
      agreed: expect.objectContaining({ minutes: 90 }),
    });
    expect(plan(back.state).request.changes).toEqual([]);
  });

  it("puts an edit back once: a refusal stands, and Ajour's values stored another way are no new edit", () => {
    const seen = roundIn(submittedWeek(), listing(editedThere())).state;

    const refused = roundIn(seen, (round) => ({
      results: round.request.changes.map((change) => ({
        syncKey: change.syncKey,
        status: "refused" as const,
        message: "The planner keeps last week closed.",
      })),
      entries: [editedThere()],
    }));
    expect(refused.result).toMatchObject({ refused: 1, putBack: 0 });
    expect(plan(refused.state).request.changes).toEqual([]);
    const listedAgain = roundIn(refused.state, listing(editedThere()));
    expect(plan(listedAgain.state).request.changes).toEqual([]);

    // The plugin stores 1:30 as 1:15, answers that, and lists it changed at
    // another time than it answered. Read as an edit, it would go back
    // every round, and come back 1:15 every time.
    const storedOtherwise = editedThere({
      minutes: 75,
      updatedAt: "2026-11-12T15:30:00.000Z",
    });
    const synced = roundIn(seen, (round) => ({
      results: syncEverything(round).results.map((result) =>
        result.status === "synced" && result.entry
          ? { ...result, entry: { ...result.entry, minutes: 75 } }
          : result,
      ),
      entries: [storedOtherwise],
    }));
    expect(synced.result).toMatchObject({ putBack: 1 });
    expect(plan(synced.state).request.changes).toEqual([]);
    const later = roundIn(synced.state, listing(storedOtherwise));
    expect(later.result).toMatchObject({ putBack: 0 });
    expect(plan(later.state).request.changes).toEqual([]);
  });

  it("puts back an edit made there between a put-back and the round's listing", () => {
    const seen = roundIn(submittedWeek(), listing(editedThere())).state;

    // The plugin stored 1:30, then someone changed it to 0:30 there.
    const editedSince = roundIn(seen, (round) => ({
      results: syncEverything(round).results,
      entries: [
        editedThere({ minutes: 30, updatedAt: "2026-11-12T15:30:00.000Z" }),
      ],
    }));

    expect(editedSince.result).toMatchObject({ putBack: 1 });
    expect(plan(editedSince.state).request.changes).toEqual([
      expect.objectContaining({
        syncKey: "e1",
        agreed: expect.objectContaining({ minutes: 30 }),
        values: expect.objectContaining({ minutes: 90 }),
      }),
    ]);
  });

  it("never reads an entry it just created again as deleted there in the same round", () => {
    const deleted = roundIn(submittedWeek(), listing()).state;

    // The plugin answers it synced, but doesn't list it yet.
    const created = roundIn(deleted, (round) => ({
      results: syncEverything(round).results,
      entries: [],
    }));

    expect(created.result).toMatchObject({ putBack: 1 });
    expect(plan(created.state).request.changes).toEqual([]);
  });

  it("holds an entry logged there in the submitted week, and takes it once the week is reopened", () => {
    const submitted = submittedWeek([]);
    const logged = remoteEntry("logged", {
      localDate: SUBMITTED,
      taskName: "Release notes",
    });
    const unmanaged = remoteEntry("globex", {
      localDate: SUBMITTED,
      projectRemoteId: "GLOBEX-INT",
    });

    const held = roundIn(submitted, listing(logged, unmanaged));

    expect(entriesOf(held.state)).toEqual([]);
    // No task is added for an entry it holds.
    expect(held.state.projects).toEqual(submitted.projects);
    expect(recordIn(held.state).held).toEqual([
      expect.objectContaining({
        remoteId: "globex",
        reason: "unmanagedProject",
      }),
      {
        remoteId: "logged",
        localDate: SUBMITTED,
        minutes: 45,
        projectRemoteId: "ACME-SUP",
        taskName: "Release notes",
        reason: "submittedWeek",
      },
    ]);
    expect(held.result).toMatchObject({ received: 0, held: 2 });
    expect(describeTimeSyncHoldReason("submittedWeek")).toBe(
      "The week is submitted. Reopen it to take this entry.",
    );

    const taken = runRound(
      { ...held.state, lockedWeeks: [] },
      listing(logged, unmanaged),
    );
    expect(entriesOf(taken.state)).toEqual([
      expect.objectContaining({
        localDate: SUBMITTED,
        durationMs: 45 * MINUTE,
        timeSyncRemoteId: "logged",
      }),
    ]);
    expect(recordIn(taken.state).held).toEqual([
      expect.objectContaining({ remoteId: "globex" }),
    ]);
    expect(taken.result).toMatchObject({ received: 1, held: 1 });
  });

  it("takes an edit or a delete made there once the week is reopened", () => {
    const reopened = { ...submittedWeek(), lockedWeeks: [] };

    const edited = runRound(reopened, listing(editedThere()));
    expect(entriesOf(edited.state)).toEqual([
      expect.objectContaining({ localDate: SUBMITTED, durationMs: HOUR }),
    ]);
    expect(edited.result).toMatchObject({ received: 1, putBack: 0 });
    expect(plan(edited.state).request.changes).toEqual([]);

    const deleted = runRound(reopened, listing());
    expect(entriesOf(deleted.state)).toEqual([]);
    expect(deleted.result).toMatchObject({ received: 1, putBack: 0 });
  });
});

/*
 * A running entry started in another tool, such as a timer on a work item
 * (#695). It becomes Ajour's running entry, and Ajour's own is saved at the
 * instant the other one started, so the user has one running entry across
 * both tools. Ajour's running entry t1 starts at 15:00.
 */
describe("a running entry from the other system", () => {
  const NOW = Date.parse("2026-11-12T15:00:00.000Z");
  const at = (offsetMs: number) => new Date(NOW + offsetMs).toISOString();

  /** Ajour's running entry t1, on Ticket #101 - Login since 15:00. */
  function t1(overrides: Partial<LocalTimer> = {}): LocalTimer {
    return {
      _id: "t1",
      startedAt: NOW,
      localDate: TODAY,
      projectId: "acme",
      taskId: "login",
      note: "Fixed the redirect for ACME",
      accumulatedDurationMs: 0,
      ...overrides,
    };
  }

  function running(timer: LocalTimer = t1()): TimeSyncState {
    return { ...stateWith([]), timers: [timer] };
  }

  /** Ids that differ from one round to the next, and a clock that reads `now`. */
  function factoriesFor(now: number) {
    let next = 0;
    return {
      createId: (prefix: string) => `${prefix}-at-${now - NOW}-${++next}`,
      now: () => now,
    };
  }

  /** Plans a round at `now`, has `answer` answer it, and applies it. */
  function roundAt(
    state: TimeSyncState,
    now: number,
    answer: (round: TimeSyncPlan) => TimeSyncResult,
  ) {
    const round = planTimeSyncRound(state, CONNECTION, CONTEXT, now)!;
    const applied = applyTimeSyncRound(
      state,
      round,
      answer(round),
      CONTEXT,
      factoriesFor(now),
    );
    return { round, ...applied };
  }

  const changesAt = (state: TimeSyncState, now: number) =>
    planTimeSyncRound(state, CONNECTION, CONTEXT, now)!.request.changes;

  /** t1 sent at 15:01, as remote-1. */
  function sent() {
    return roundAt(running(), NOW + MINUTE, (round) => syncEverything(round))
      .state;
  }

  /** t1 as the other system lists it once sent, with `overrides`. */
  function t1There(overrides: Partial<TimeSyncRemoteEntry> = {}) {
    return remoteEntry("remote-1", {
      clientRef: "t1",
      minutes: 1,
      running: true,
      countingSince: at(0),
      taskRemoteId: "1001",
      updatedAt: "2026-11-12T14:00:00.000Z",
      ...overrides,
    });
  }

  /** t1 stopped there at 15:25, with 25 minutes. */
  const t1StoppedThere = () =>
    t1There({
      running: false,
      countingSince: undefined,
      minutes: 25,
      updatedAt: at(25 * MINUTE),
    });

  /** A timer another tool started on Ad hoc support, `offsetMs` after 15:00. */
  function timerElsewhere(offsetMs: number, remoteId = "elsewhere") {
    return remoteEntry(remoteId, {
      running: true,
      countingSince: at(offsetMs),
      minutes: 0,
      taskName: "ad hoc  SUPPORT",
      updatedAt: at(offsetMs),
    });
  }

  /**
   * The other system as these tests drive it. It keeps one running entry per
   * person, so a timer started there, or a running entry Ajour sends, stops
   * the one running before at that instant. It answers a round as the
   * example planner does, and lists every entry.
   */
  function oneRunningEntryRemote() {
    const entries = new Map<string, TimeSyncRemoteEntry>();
    let nextId = 1;
    const stopRunning = (instant: number, except?: string) => {
      for (const listed of entries.values()) {
        if (!listed.running || listed.remoteId === except) continue;
        const { countingSince, ...rest } = listed;
        entries.set(listed.remoteId, {
          ...rest,
          running: false,
          minutes: Math.round((instant - Date.parse(countingSince!)) / MINUTE),
          updatedAt: new Date(instant).toISOString(),
        });
      }
    };
    return {
      /** What runs there now. */
      running: () => [...entries.values()].filter((listed) => listed.running),
      /** Another tool starts a timer on Ad hoc support. Returns its id. */
      start(offsetMs: number) {
        stopRunning(NOW + offsetMs);
        const remoteId = `elsewhere-${nextId++}`;
        entries.set(remoteId, timerElsewhere(offsetMs, remoteId));
        return remoteId;
      },
      /** Answers a round sent at `now`. */
      answer: (now: number) => (round: TimeSyncPlan) => {
        const updatedAt = new Date(now).toISOString();
        const results = round.request.changes.map((change) => {
          const existing =
            (change.remoteId && entries.get(change.remoteId)) ||
            [...entries.values()].find(
              (listed) => listed.clientRef === change.syncKey,
            );
          if (change.kind === "delete") {
            if (existing) entries.delete(existing.remoteId);
            return { syncKey: change.syncKey, status: "synced" as const };
          }
          const remoteId = existing ? existing.remoteId : `remote-${nextId++}`;
          if (change.values.running) stopRunning(now, remoteId);
          const clientRef = existing ? existing.clientRef : change.syncKey;
          const stored: TimeSyncRemoteEntry = {
            remoteId,
            ...(clientRef ? { clientRef } : {}),
            ...change.values,
            updatedAt,
          };
          entries.set(remoteId, stored);
          return {
            syncKey: change.syncKey,
            status: "synced" as const,
            entry: stored,
          };
        });
        return { results, entries: [...entries.values()] };
      },
    };
  }

  it("makes a timer started there the running entry while Ajour has none, counting from its start, with a copy that sends nothing back", () => {
    const { state, result } = roundAt(
      stateWith([]),
      NOW + 2 * MINUTE,
      listing(timerElsewhere(0)),
    );

    expect(state.timers).toEqual([
      expect.objectContaining({
        localDate: TODAY,
        startedAt: NOW,
        accumulatedDurationMs: 0,
        projectId: "acme",
        taskId: "ad-hoc",
        timeSyncRemoteId: "elsewhere",
      }),
    ]);
    expect(state.timers[0]?.note).toBeUndefined();
    expect(entriesOf(state)).toEqual([]);
    expect(recordIn(state).copies[state.timers[0]!._id]).toEqual({
      remoteId: "elsewhere",
      agreed: expect.objectContaining({
        running: true,
        countingSince: at(0),
        taskName: "Ad hoc support",
      }),
      remoteUpdatedAt: at(0),
    });
    expect(result).toMatchObject({ received: 1, held: 0 });
    expect(changesAt(state, NOW + 10 * MINUTE)).toEqual([]);
  });

  it("saves Ajour's running entry with the minutes it ran until the other one started, and sends its stop", () => {
    // A system that lists both as running: Ajour's started first.
    const { state } = roundAt(
      sent(),
      NOW + 21 * MINUTE,
      listing(t1There(), timerElsewhere(20 * MINUTE)),
    );

    expect(entriesOf(state)).toEqual([
      expect.objectContaining({
        syncKey: "t1",
        taskId: "login",
        durationMs: 20 * MINUTE,
        note: "Fixed the redirect for ACME",
      }),
    ]);
    expect(state.timers).toEqual([
      expect.objectContaining({
        startedAt: NOW + 20 * MINUTE,
        taskId: "ad-hoc",
      }),
    ]);
    expect(changesAt(state, NOW + 21 * MINUTE + 2_000)).toEqual([
      expect.objectContaining({
        kind: "upsert",
        syncKey: "t1",
        remoteId: "remote-1",
        values: expect.objectContaining({ running: false, minutes: 20 }),
      }),
    ]);

    // One that never went there, on a Local only task, stays in Ajour.
    const kept = roundAt(
      running(t1({ taskId: "mine" })),
      NOW + MINUTE,
      listing(timerElsewhere(40_000)),
    ).state;
    expect(entriesOf(kept)).toEqual([
      expect.objectContaining({ taskId: "mine", durationMs: 40_000 }),
    ]);
    expect(changesAt(kept, NOW + MINUTE + 2_000)).toEqual([]);
  });

  it("keeps Ajour's running entry when it started after the other one, which stops once Ajour's goes there", () => {
    const remote = oneRunningEntryRemote();
    remote.start(0);
    const later = running(t1({ startedAt: NOW + 10 * MINUTE }));

    // Ten seconds in, Ajour's entry hasn't gone there yet.
    const first = roundAt(
      later,
      NOW + 10 * MINUTE + 10_000,
      remote.answer(NOW + 10 * MINUTE + 10_000),
    );
    expect(first.state.timers).toEqual(later.timers);
    expect(entriesOf(first.state)).toEqual([]);
    expect(first.result).toMatchObject({ received: 0, held: 0 });

    // Once it goes, the other system stops its own, and Ajour takes that one
    // as a saved entry.
    const second = roundAt(
      first.state,
      NOW + 10 * MINUTE + 40_000,
      remote.answer(NOW + 10 * MINUTE + 40_000),
    );
    expect(second.state.timers).toEqual(later.timers);
    expect(entriesOf(second.state)).toEqual([
      expect.objectContaining({ taskId: "ad-hoc", durationMs: 11 * MINUTE }),
    ]);
    expect(remote.running()).toEqual([
      expect.objectContaining({ clientRef: "t1" }),
    ]);
  });

  it("stops Ajour's running entry with the minutes the other system stopped it at", () => {
    const { state, result } = roundAt(
      sent(),
      NOW + 26 * MINUTE,
      listing(t1StoppedThere()),
    );

    expect(state.timers).toEqual([]);
    expect(entriesOf(state)).toEqual([
      expect.objectContaining({
        syncKey: "t1",
        taskId: "login",
        durationMs: 25 * MINUTE,
        note: "Fixed the redirect for ACME",
      }),
    ]);
    expect(recordIn(state).copies.t1).toEqual({
      remoteId: "remote-1",
      agreed: expect.objectContaining({ running: false, minutes: 25 }),
      remoteUpdatedAt: at(25 * MINUTE),
    });
    expect(result).toMatchObject({ received: 1 });
    expect(changesAt(state, NOW + 27 * MINUTE)).toEqual([]);
  });

  it("keeps Ajour's running entry running and holds the stop there when it also moved to a project Ajour doesn't manage", () => {
    const before = sent();
    const { state, result } = roundAt(
      before,
      NOW + 26 * MINUTE,
      listing({
        ...t1StoppedThere(),
        projectRemoteId: "GLOBEX-INT",
        taskName: "Design review",
        taskRemoteId: undefined,
      }),
    );

    expect(state.timers).toEqual(before.timers);
    expect(entriesOf(state)).toEqual([]);
    expect(recordIn(state).held).toEqual([
      expect.objectContaining({
        remoteId: "remote-1",
        reason: "unmanagedProject",
      }),
    ]);
    expect(result).toMatchObject({ received: 0, held: 1 });
    // Nothing goes back over the move there.
    expect(changesAt(state, NOW + 27 * MINUTE)).toEqual([]);
  });

  describe("when Ajour changed its running entry too", () => {
    /** t1 moved to Ad hoc support in Ajour, first seen at `changedAt`, and stopped there at 15:25. */
    function stoppedThereAfterEdit(changedAt: number) {
      const synced = sent();
      const record = recordIn(synced);
      const edited: TimeSyncState = {
        ...synced,
        timers: [t1({ taskId: "ad-hoc" })],
        timeSyncs: {
          [CONNECTION.connectionId]: {
            ...record,
            copies: { t1: { ...record.copies.t1!, changedAt } },
          },
        },
      };
      // Planned before the edit, so the edit waits for the next round.
      const round = planTimeSyncRound(
        synced,
        CONNECTION,
        CONTEXT,
        NOW + 26 * MINUTE,
      )!;
      return applyTimeSyncRound(
        edited,
        round,
        listing(t1StoppedThere())(round),
        CONTEXT,
        factoriesFor(NOW + 31 * MINUTE),
      );
    }

    it("keeps it running when Ajour's change is the later one, and sends it", () => {
      const { state } = stoppedThereAfterEdit(NOW + 30 * MINUTE);

      expect(state.timers).toEqual([t1({ taskId: "ad-hoc" })]);
      expect(entriesOf(state)).toEqual([]);
      expect(changesAt(state, NOW + 32 * MINUTE)).toEqual([
        expect.objectContaining({
          syncKey: "t1",
          values: expect.objectContaining({
            running: true,
            taskName: "Ad hoc support",
          }),
        }),
      ]);
    });

    it("stops it with the other system's values when the stop there is the later one", () => {
      const { state } = stoppedThereAfterEdit(NOW + 20 * MINUTE);

      expect(state.timers).toEqual([]);
      expect(entriesOf(state)).toEqual([
        expect.objectContaining({
          syncKey: "t1",
          taskId: "login",
          durationMs: 25 * MINUTE,
        }),
      ]);
      expect(changesAt(state, NOW + 32 * MINUTE)).toEqual([]);
    });
  });

  it("holds a running entry that started there before today, then takes it as a saved entry once it stops", () => {
    const yesterday = "2026-11-11";
    const overnight = remoteEntry("overnight", {
      localDate: yesterday,
      running: true,
      countingSince: "2026-11-11T22:00:00.000Z",
      minutes: 17 * 60,
      updatedAt: "2026-11-11T22:00:00.000Z",
    });

    const { state, result } = roundAt(
      running(),
      NOW + 10_000,
      listing(overnight),
    );
    expect(state.timers).toEqual([t1()]);
    expect(entriesOf(state)).toEqual([]);
    expect(recordIn(state).held).toEqual([
      {
        remoteId: "overnight",
        localDate: yesterday,
        minutes: 17 * 60,
        projectRemoteId: "ACME-SUP",
        taskName: "Ticket #101 - Login",
        reason: "startedBeforeToday",
      },
    ]);
    expect(result).toMatchObject({ received: 0, held: 1 });
    expect(describeTimeSyncHoldReason("startedBeforeToday")).toBe(
      "It has run there since before today. Ajour takes it once it stops.",
    );

    const stopped = roundAt(
      state,
      NOW + 20 * MINUTE,
      listing({
        ...overnight,
        running: false,
        countingSince: undefined,
        minutes: 17 * 60 + 30,
        updatedAt: at(-30 * MINUTE),
      }),
    ).state;
    expect(stopped.timers).toEqual([t1()]);
    expect(entriesOf(stopped)).toEqual([
      expect.objectContaining({
        localDate: yesterday,
        taskId: "login",
        durationMs: (17 * 60 + 30) * MINUTE,
        timeSyncRemoteId: "overnight",
      }),
    ]);
    expect(recordIn(stopped).held).toEqual([]);
  });

  it("holds a timer started there in a submitted week, as an entry logged there, and takes it once the week is reopened", () => {
    const submitted: TimeSyncState = {
      ...stateWith([]),
      lockedWeeks: [{ weekOf: "2026-11-09", lockedAt: 400 }],
    };

    const { state, result } = roundAt(
      submitted,
      NOW + 2 * MINUTE,
      listing(timerElsewhere(0)),
    );
    expect(state.timers).toEqual([]);
    expect(recordIn(state).held).toEqual([
      expect.objectContaining({
        remoteId: "elsewhere",
        reason: "submittedWeek",
      }),
    ]);
    expect(result).toMatchObject({ received: 0, held: 1 });

    const reopened = roundAt(
      { ...state, lockedWeeks: [] },
      NOW + 3 * MINUTE,
      listing(timerElsewhere(0)),
    ).state;
    expect(reopened.timers).toEqual([
      expect.objectContaining({
        startedAt: NOW,
        timeSyncRemoteId: "elsewhere",
      }),
    ]);
    expect(recordIn(reopened).held).toEqual([]);
  });

  it("settles after a takeover: Ajour and the other system never take the running entry back and forth", () => {
    const remote = oneRunningEntryRemote();
    let state = roundAt(
      running(),
      NOW + MINUTE,
      remote.answer(NOW + MINUTE),
    ).state;

    // Another tool starts a timer at 15:20, which stops t1 there.
    const elsewhere = remote.start(20 * MINUTE);
    state = roundAt(
      state,
      NOW + 20 * MINUTE + 30_000,
      remote.answer(NOW + 20 * MINUTE + 30_000),
    ).state;
    const [taken] = state.timers;
    expect(taken).toMatchObject({
      startedAt: NOW + 20 * MINUTE,
      taskId: "ad-hoc",
    });
    expect(entriesOf(state)).toEqual([
      expect.objectContaining({ syncKey: "t1", durationMs: 20 * MINUTE }),
    ]);

    const quiet = (minutes: number) => {
      const next = roundAt(
        state,
        NOW + minutes * MINUTE,
        remote.answer(NOW + minutes * MINUTE),
      );
      expect(next.round.request.changes).toEqual([]);
      expect(next.result).toMatchObject({ synced: 0, received: 0 });
      state = next.state;
    };
    quiet(21);
    quiet(22);
    expect(state.timers).toEqual([taken]);
    expect(remote.running()).toEqual([
      expect.objectContaining({ remoteId: elsewhere }),
    ]);

    // A switch in Ajour right after goes there as any switch does, and
    // settles too.
    state = startTimer(
      state,
      { projectId: "acme", taskId: "login" },
      TODAY,
      factoriesFor(NOW + 23 * MINUTE),
    );
    const switched = roundAt(
      state,
      NOW + 23 * MINUTE + 2_000,
      remote.answer(NOW + 23 * MINUTE + 2_000),
    );
    expect(switched.round.request.changes).toEqual([
      expect.objectContaining({
        syncKey: taken!._id,
        remoteId: elsewhere,
        values: expect.objectContaining({ running: false, minutes: 3 }),
      }),
      expect.objectContaining({
        values: expect.objectContaining({ running: true }),
      }),
    ]);
    expect(switched.result).toMatchObject({ received: 0 });
    state = switched.state;
    const [mine] = state.timers;
    quiet(24);
    quiet(25);
    expect(state.timers).toEqual([mine]);
    expect(remote.running()).toEqual([
      expect.objectContaining({ clientRef: mine!._id }),
    ]);
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
    held: [],
    puttingBack: [],
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

  it("says what the last round sent and put back, or that it is up to date", () => {
    const round = {
      at: 1,
      synced: 2,
      putBack: 0,
      received: 0,
      refused: 0,
      failed: 0,
    };
    expect(describeTimeSyncStatus(record({ lastRound: round }))).toEqual({
      summary: "Time entries · 2 sent",
      notes: [],
    });
    expect(
      describeTimeSyncStatus(record({ lastRound: { ...round, putBack: 1 } })),
    ).toEqual({ summary: "Time entries · 2 sent · 1 put back", notes: [] });
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
          putBack: 0,
          received: 0,
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
          lastRound: {
            at: 1,
            synced: 2,
            putBack: 0,
            received: 0,
            refused: 0,
            failed: 0,
          },
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

describe("reading stored time syncs back", () => {
  it("keeps what a round stored, reads an older state as none, and drops what it can't read", () => {
    const stored = runRound(stateWith([entry("e1")])).state.timeSyncs;
    expect(normalizeTimeSyncs(JSON.parse(JSON.stringify(stored)))).toEqual(
      stored,
    );
    expect(normalizeTimeSyncs(undefined)).toEqual({});

    const broken = structuredClone(stored) as Record<string, unknown>;
    (broken.c1 as LocalTimeSync).copies.e2 = {
      remoteId: "remote-2",
      agreed: { minutes: -1 },
    } as never;
    broken.c2 = { pluginId: "other", startWeek: "not a day", startedAt: 1 };
    const read = normalizeTimeSyncs(broken);
    expect(Object.keys(read)).toEqual(["c1"]);
    expect(Object.keys(read.c1!.copies)).toEqual(["e1"]);

    // A record stored before #696 puts nothing back.
    const { puttingBack: _none, ...older } = stored.c1!;
    const { putBack: _count, ...olderRound } = older.lastRound!;
    expect(
      normalizeTimeSyncs({ c1: { ...older, lastRound: olderRound } }).c1,
    ).toEqual(stored.c1);
  });
});
