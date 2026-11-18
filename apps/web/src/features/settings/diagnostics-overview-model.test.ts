import { describe, expect, it } from "vitest";
import { overviewFixture } from "@/test-support/log-overview-fixtures";
import {
  chartBarsOf,
  crashFigureOf,
  isHealthy,
  launchFigureOf,
  overviewEventsSearch,
  parseOverviewRange,
  pluginFigureOf,
  slowestOperationsOf,
  syncFigureOf,
  topProblemsOf,
} from "./diagnostics-overview-model";

/*
 * Diagnostics > Overview (#445): what each figure, bar and row shows from
 * logs.aggregate, and the Events filter each opens.
 */

describe("the range", () => {
  it("is This launch unless the search names 24h or 7d", () => {
    expect(parseOverviewRange({})).toBe("launch");
    expect(parseOverviewRange({ range: "7d" })).toBe("7d");
    expect(parseOverviewRange({ range: "24h" })).toBe("24h");
    expect(parseOverviewRange({ range: "1h" })).toBe("launch");
  });

  it("opens Events on this launch, or on every launch over the range", () => {
    expect(overviewEventsSearch("launch", { problems: true })).toEqual({
      tab: "events",
      problems: "1",
    });
    expect(overviewEventsSearch("7d", { problems: true })).toEqual({
      tab: "events",
      problems: "1",
      launch: "all",
      range: "7d",
    });
  });
});

describe("the health figures", () => {
  it("Sync: the connections whose syncs failed, with the last reason", () => {
    const sync = syncFigureOf(overviewFixture(), "24h");
    expect(sync.failedCount).toBe(2);
    expect(sync.rows).toEqual([
      {
        connectionId: "conn-jira",
        failedCount: 2,
        syncCount: 4,
        lastFailureAt: "2026-11-18T10:15:00.000Z",
        reason: "secret_unavailable",
        outcome: "error",
        recovered: false,
        search: {
          tab: "events",
          launch: "all",
          range: "24h",
          name: "backlog.sync",
          problems: "1",
          connection: "conn-jira",
        },
      },
    ]);
    expect(sync.search).toEqual({
      tab: "events",
      launch: "all",
      range: "24h",
      name: "backlog.sync",
      problems: "1",
    });
  });

  it("Sync: a connection whose last sync ended well after a failure has recovered", () => {
    const sync = syncFigureOf(
      overviewFixture({
        syncs: [
          {
            connection_id: "conn-jira",
            sync_count: 3,
            failed_count: 1,
            last: { started_at: "2026-11-18T11:00:00.000Z", outcome: "ok" },
            last_failure: {
              started_at: "2026-11-18T10:00:00.000Z",
              outcome: "timeout",
              outcome_reason: "timeout",
            },
          },
        ],
      }),
      "launch",
    );
    expect(sync.rows[0]).toMatchObject({ recovered: true, reason: "timeout" });
  });

  it("Plugins: timeouts, crashes and capacity refusals by plugin and version, a row opening its version alone", () => {
    const plugins = pluginFigureOf(overviewFixture(), "24h");
    expect(plugins.count).toBe(1);
    expect(plugins.rows).toEqual([
      {
        key: "ajour.jira\n2.1.0\ntimeout\ntimeout",
        pluginId: "ajour.jira",
        version: "2.1.0",
        outcome: "timeout",
        reason: "timeout",
        count: 1,
        lastAt: "2026-11-18T11:30:00.000Z",
        search: {
          tab: "events",
          launch: "all",
          range: "24h",
          kind: "plugin_operation",
          plugin: "ajour.jira",
          outcome: "timeout",
          reason: "timeout",
          version: "2.1.0",
        },
      },
    ]);
    expect(plugins.search).toEqual({
      tab: "events",
      launch: "all",
      range: "24h",
      kind: "plugin_operation",
      reason: "timeout,crashed,capacity",
    });
  });

  it("App start: the latest launch's duration, the p95, and the slowest phase, the window's setup apart from the renderer load it holds", () => {
    expect(launchFigureOf(overviewFixture(), "24h")).toEqual({
      durationMs: 6400,
      outcome: "ok",
      p95Ms: 6400,
      launchCount: 3,
      // window_ms 5100 holds renderer_load_ms 4700: the setup is 400.
      slowestPhase: { label: "Renderer load", ms: 4700 },
      search: {
        tab: "events",
        launch: "all",
        range: "24h",
        name: "app.launch",
      },
    });
    const slowWindow = overviewFixture();
    slowWindow.latest_launch = {
      ...slowWindow.latest_launch!,
      launch: { ready_ms: 900, window_ms: 5100, renderer_load_ms: 300 },
    } as typeof slowWindow.latest_launch;
    expect(launchFigureOf(slowWindow, "24h").slowestPhase).toEqual({
      label: "Window setup",
      ms: 4800,
    });
    expect(
      launchFigureOf(overviewFixture({ latest_launch: null }), "launch"),
    ).toMatchObject({ durationMs: null, slowestPhase: null });
  });

  it("Crashes: app.error, process.gone and window.unresponsive", () => {
    const crashes = crashFigureOf(overviewFixture(), "24h");
    expect(crashes.count).toBe(3);
    expect(crashes.rows).toEqual([
      {
        name: "process.gone",
        count: 2,
        search: {
          tab: "events",
          launch: "all",
          range: "24h",
          kind: "crash",
          name: "process.gone",
        },
      },
      {
        name: "window.unresponsive",
        count: 1,
        search: {
          tab: "events",
          launch: "all",
          range: "24h",
          kind: "crash",
          name: "window.unresponsive",
        },
      },
    ]);
    expect(crashes.search).toEqual({
      tab: "events",
      launch: "all",
      range: "24h",
      kind: "crash",
    });
  });
});

describe("problems per hour", () => {
  it("has one bar per hour, each the hour's problems by outcome", () => {
    const bars = chartBarsOf(overviewFixture(), "24h");
    expect(
      bars.map(({ hour, values, total }) => ({ hour, values, total })),
    ).toEqual([
      {
        hour: "2026-11-18T09:00:00.000Z",
        values: { error: 2, timeout: 0, refused: 0, cancelled: 0 },
        total: 2,
      },
      {
        hour: "2026-11-18T10:00:00.000Z",
        values: { error: 6, timeout: 0, refused: 1, cancelled: 0 },
        total: 7,
      },
      {
        hour: "2026-11-18T11:00:00.000Z",
        values: { error: 0, timeout: 1, refused: 0, cancelled: 2 },
        total: 3,
      },
      {
        hour: "2026-11-18T12:00:00.000Z",
        values: { error: 0, timeout: 0, refused: 0, cancelled: 0 },
        total: 0,
      },
    ]);
  });

  it("opens Events on the bar's hour and its problems", () => {
    const [bar] = chartBarsOf(overviewFixture(), "7d");
    expect(bar!.search).toEqual({
      tab: "events",
      problems: "1",
      launch: "all",
      hour: "2026-11-18T09:00:00.000Z",
    });
    expect(chartBarsOf(overviewFixture(), "launch")[0]!.search).toEqual({
      tab: "events",
      problems: "1",
      hour: "2026-11-18T09:00:00.000Z",
    });
  });

  it("opens the first and last bars on the part of their hour the range counted", () => {
    const overview = overviewFixture({
      from: "2026-11-18T09:23:00.000Z",
      to: "2026-11-18T11:40:00.000Z",
    });
    const [first, middle, last] = chartBarsOf(overview, "24h");
    expect(first!.search).toMatchObject({
      hour: "2026-11-18T09:00:00.000Z",
      from: "2026-11-18T09:23:00.000Z",
    });
    expect(first!.search.to).toBeUndefined();
    expect(middle!.search.from).toBeUndefined();
    expect(middle!.search.to).toBeUndefined();
    // The aggregate counts its `to`; a filter's `to` excludes it.
    expect(last!.search).toMatchObject({
      hour: "2026-11-18T11:00:00.000Z",
      to: "2026-11-18T11:40:00.001Z",
    });
    // This launch counts the launch's events before its start too.
    expect(chartBarsOf(overview, "launch")[0]!.search.from).toBeUndefined();
  });
});

describe("the lists", () => {
  it("Top problems: by name, outcome and reason, with the count, last time and places", () => {
    const [first, second] = topProblemsOf(overviewFixture(), "24h");
    expect(first).toEqual({
      key: "backlog.sync\nerror\nsecret_unavailable",
      name: "backlog.sync",
      outcome: "error",
      reason: "secret_unavailable",
      count: 6,
      lastAt: "2026-11-18T10:15:00.000Z",
      places: [{ connection_id: "conn-jira", count: 6 }],
      search: {
        tab: "events",
        launch: "all",
        range: "24h",
        name: "backlog.sync",
        outcome: "error",
        reason: "secret_unavailable",
      },
    });
    // No reason: it opens the events of its name and outcome without one.
    expect(second!.search).toEqual({
      tab: "events",
      launch: "all",
      range: "24h",
      name: "process.gone",
      outcome: "error",
      reason: "none",
    });
  });

  it("Slowest operations: p50 and p95 per name, slowest p95 first", () => {
    expect(
      slowestOperationsOf(overviewFixture(), "launch").map(
        ({ name, p50Ms, p95Ms, count, search }) => ({
          name,
          p50Ms,
          p95Ms,
          count,
          search,
        }),
      ),
    ).toEqual([
      {
        name: "app.launch",
        p50Ms: 2100,
        p95Ms: 6400,
        count: 3,
        search: { tab: "events", name: "app.launch" },
      },
      {
        name: "backlog.sync",
        p50Ms: 800,
        p95Ms: 2500,
        count: 18,
        search: { tab: "events", name: "backlog.sync" },
      },
      {
        name: "time_entry.update",
        p50Ms: 12,
        p95Ms: 30,
        count: 40,
        search: { tab: "events", name: "time_entry.update" },
      },
    ]);
  });

  it("is healthy with no problem and no crash", () => {
    expect(isHealthy(overviewFixture())).toBe(false);
    expect(
      isHealthy(
        overviewFixture({
          problems: [],
          crash_count: 0,
          syncs: [],
          plugin_problems: [],
        }),
      ),
    ).toBe(true);
  });
});
