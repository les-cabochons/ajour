import type { DesktopLogOverview, LoggedEvent } from "@/lib/desktop-bridge";

/*
 * A logs.aggregate answer for Diagnostics > Overview (#445): a failing sync,
 * a plugin timeout and a slow launch, over the last 24 hours.
 */

const launch = {
  schema: 1,
  name: "app.launch",
  kind: "lifecycle",
  runtime: "main",
  outcome: "ok",
  started_at: "2026-11-18T08:00:00.000Z",
  duration_ms: 6400,
  trace_id: "0af7651916cd43dd8448eb211c80319c",
  span_id: "b7ad6b7169203331",
  trigger: "boot",
  launch_id: "launch-now",
  app: { version: "1.2.3", channel: "stable", packaged: true },
  device: { platform: "win32" },
  // As main writes them: window_ms spans the renderer load, so the window's
  // own setup is 400 ms and the renderer load, 4700 ms, is the slowest.
  launch: {
    ready_ms: 900,
    api_start_ms: 400,
    window_ms: 5100,
    renderer_load_ms: 4700,
  },
} as unknown as LoggedEvent;

/** A failing sync, a plugin timeout and a slow launch. */
export function overviewFixture(
  fields: Partial<DesktopLogOverview> = {},
): DesktopLogOverview {
  return {
    range: "24h",
    from: "2026-11-17T12:00:00.000Z",
    to: "2026-11-18T12:00:00.000Z",
    file_count: 2,
    missing_file_count: 0,
    skipped_line_count: 0,
    counts: [
      { name: "time_entry.update", outcome: "ok", count: 40 },
      {
        name: "backlog.sync",
        outcome: "error",
        outcome_reason: "secret_unavailable",
        count: 6,
      },
      {
        name: "assignee.search",
        outcome: "timeout",
        outcome_reason: "timeout",
        count: 1,
      },
      { name: "app.launch", outcome: "ok", count: 3 },
      { name: "process.gone", outcome: "error", count: 2 },
      { name: "window.unresponsive", outcome: "ok", count: 1 },
    ],
    problems: [
      {
        name: "backlog.sync",
        outcome: "error",
        outcome_reason: "secret_unavailable",
        count: 6,
        last_at: "2026-11-18T10:15:00.000Z",
        places: [{ connection_id: "conn-jira", count: 6 }],
      },
      {
        name: "process.gone",
        outcome: "error",
        count: 2,
        last_at: "2026-11-18T09:00:00.000Z",
        places: [{ plugin_id: "ajour.jira", count: 2 }],
      },
      {
        name: "assignee.search",
        outcome: "timeout",
        outcome_reason: "timeout",
        count: 1,
        last_at: "2026-11-18T11:30:00.000Z",
        places: [],
      },
    ],
    syncs: [
      {
        connection_id: "conn-jira",
        sync_count: 4,
        failed_count: 2,
        last: {
          started_at: "2026-11-18T10:15:00.000Z",
          outcome: "error",
          outcome_reason: "secret_unavailable",
        },
        last_failure: {
          started_at: "2026-11-18T10:15:00.000Z",
          outcome: "error",
          outcome_reason: "secret_unavailable",
        },
      },
      {
        connection_id: "conn-github",
        sync_count: 5,
        failed_count: 0,
        last: { started_at: "2026-11-18T11:00:00.000Z", outcome: "ok" },
      },
    ],
    plugin_problems: [
      {
        plugin_id: "ajour.jira",
        plugin_version: "2.1.0",
        outcome: "timeout",
        outcome_reason: "timeout",
        count: 1,
        last_at: "2026-11-18T11:30:00.000Z",
      },
    ],
    problems_per_hour: [
      { hour: "2026-11-18T09:00:00.000Z", counts: { error: 2 } },
      { hour: "2026-11-18T10:00:00.000Z", counts: { error: 6, refused: 1 } },
      {
        hour: "2026-11-18T11:00:00.000Z",
        counts: { timeout: 1, cancelled: 2 },
      },
      { hour: "2026-11-18T12:00:00.000Z", counts: {} },
    ],
    durations: [
      { name: "app.launch", count: 3, p50_ms: 2100, p95_ms: 6400 },
      { name: "backlog.sync", count: 18, p50_ms: 800, p95_ms: 2500 },
      { name: "time_entry.update", count: 40, p50_ms: 12, p95_ms: 30 },
    ],
    latest_launch: launch,
    crash_count: 3,
    crashes: [],
    ...fields,
  };
}
