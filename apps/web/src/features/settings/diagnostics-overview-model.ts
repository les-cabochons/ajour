import type { Outcome } from "@ajour/wide-events";
import type {
  DesktopLogOverview,
  DesktopLogRange,
  ProblemOutcome,
} from "@/lib/desktop-bridge";
import {
  DEFAULT_EVENTS_VIEW,
  eventsSearchOf,
  type EventQueryTerms,
  type EventsView,
} from "./diagnostics-events-model";

/*
 * Diagnostics > Overview (#445): what its figures, chart and lists show
 * from logs.aggregate, and the Events filter each one opens. A link is the
 * Events tab's own search keys (diagnostics-events-model.ts), so the tab it
 * opens shows the filter in its chips and query box.
 */

export type OverviewRange = DesktopLogRange;

export const OVERVIEW_RANGES: ReadonlyArray<{
  value: OverviewRange;
  label: string;
}> = [
  { value: "launch", label: "This launch" },
  { value: "24h", label: "24 hours" },
  { value: "7d", label: "7 days" },
];

/** The Overview's `range` search key: This launch when absent or unknown. */
export function parseOverviewRange(
  search: Record<string, unknown>,
): OverviewRange {
  return (
    OVERVIEW_RANGES.find((range) => range.value === search.range)?.value ??
    "launch"
  );
}

type EventsPatch = Partial<Omit<EventsView, "terms">> & {
  terms?: EventQueryTerms;
};

/**
 * The Events tab's search for a filter over the Overview's range: this
 * launch, or every launch over the last 24 hours or 7 days.
 */
export function overviewEventsSearch(
  range: OverviewRange,
  patch: EventsPatch,
): Record<string, string> {
  const view: EventsView = {
    ...DEFAULT_EVENTS_VIEW,
    ...(range === "launch" ? {} : { launch: "all", range }),
    ...patch,
    terms: patch.terms ?? {},
  };
  return { tab: "events", ...eventsSearchOf(view) };
}

const isProblem = (outcome: Outcome) => outcome !== "ok" && outcome !== "noop";

/** Sync: the connections whose syncs failed, each with its last failure. */
export function syncFigureOf(
  overview: DesktopLogOverview,
  range: OverviewRange,
) {
  const failing = overview.syncs.filter((sync) => sync.failed_count > 0);
  return {
    failedCount: failing.reduce((sum, sync) => sum + sync.failed_count, 0),
    syncCount: overview.syncs.reduce((sum, sync) => sum + sync.sync_count, 0),
    rows: failing.map((sync) => {
      const failure = sync.last_failure ?? sync.last;
      return {
        connectionId: sync.connection_id,
        failedCount: sync.failed_count,
        syncCount: sync.sync_count,
        lastFailureAt: failure.started_at,
        reason: failure.outcome_reason,
        outcome: failure.outcome,
        /** Its last sync, after the failure, ended well. */
        recovered: !isProblem(sync.last.outcome),
        search: overviewEventsSearch(range, {
          problems: true,
          terms: { name: "backlog.sync", connection: sync.connection_id },
        }),
      };
    }),
    search: overviewEventsSearch(range, {
      problems: true,
      terms: { name: "backlog.sync" },
    }),
  };
}

/** The reasons the Plugins figure counts, as main does. */
const PLUGIN_PROBLEM_REASONS = ["timeout", "crashed", "capacity"];

/** Plugins: timeouts, crashes and capacity refusals, by plugin and version. */
export function pluginFigureOf(
  overview: DesktopLogOverview,
  range: OverviewRange,
) {
  return {
    count: overview.plugin_problems.reduce(
      (sum, problem) => sum + problem.count,
      0,
    ),
    rows: overview.plugin_problems.map((problem) => ({
      key: [
        problem.plugin_id,
        problem.plugin_version ?? "",
        problem.outcome,
        problem.outcome_reason ?? "",
      ].join("\n"),
      pluginId: problem.plugin_id,
      version: problem.plugin_version,
      outcome: problem.outcome,
      reason: problem.outcome_reason,
      count: problem.count,
      lastAt: problem.last_at,
      // The version has no filter: the row opens the plugin's every version.
      search: overviewEventsSearch(range, {
        kind: "plugin_operation",
        terms: {
          plugin: problem.plugin_id,
          outcome: [problem.outcome],
          ...(problem.outcome_reason
            ? { reason: [problem.outcome_reason] }
            : {}),
        },
      }),
    })),
    search: overviewEventsSearch(range, {
      kind: "plugin_operation",
      terms: { reason: PLUGIN_PROBLEM_REASONS },
    }),
  };
}

/** An app.launch's phases, in the order they run. */
const LAUNCH_PHASES = [
  ["ready_ms", "Electron ready"],
  ["api_start_ms", "Local API start"],
  ["window_ms", "Window"],
  ["renderer_load_ms", "Renderer load"],
] as const;

/** App start: the latest launch's duration, the p95 of the range, its slowest phase. */
export function launchFigureOf(
  overview: DesktopLogOverview,
  range: OverviewRange,
) {
  const latest = overview.latest_launch;
  const phases = (latest?.launch ?? {}) as Record<string, unknown>;
  let slowestPhase: { label: string; ms: number } | null = null;
  for (const [field, label] of LAUNCH_PHASES) {
    const ms = phases[field];
    if (typeof ms !== "number" || !Number.isFinite(ms)) continue;
    if (!slowestPhase || ms > slowestPhase.ms) slowestPhase = { label, ms };
  }
  const durations = overview.durations.find(
    (duration) => duration.name === "app.launch",
  );
  return {
    durationMs: latest ? latest.duration_ms : null,
    outcome: latest ? latest.outcome : null,
    p95Ms: durations?.p95_ms ?? null,
    launchCount: durations?.count ?? 0,
    slowestPhase,
    search: overviewEventsSearch(range, { terms: { name: "app.launch" } }),
  };
}

/** The crash events, in the order the figure lists them. */
const CRASH_NAMES = ["app.error", "process.gone", "window.unresponsive"];

/** Crashes: app.error, process.gone and window.unresponsive. */
export function crashFigureOf(
  overview: DesktopLogOverview,
  range: OverviewRange,
) {
  const rows = CRASH_NAMES.map((name) => ({
    name,
    count: overview.counts
      .filter((count) => count.name === name)
      .reduce((sum, count) => sum + count.count, 0),
    search: overviewEventsSearch(range, { kind: "crash", terms: { name } }),
  })).filter((row) => row.count > 0);
  return {
    count: overview.crash_count,
    rows,
    search: overviewEventsSearch(range, { kind: "crash" }),
  };
}

/** The chart's series, bottom up: failures, then refusals. */
export const PROBLEM_SERIES: ReadonlyArray<{
  id: ProblemOutcome;
  label: string;
}> = [
  { id: "error", label: "Error" },
  { id: "timeout", label: "Timed out" },
  { id: "refused", label: "Refused" },
  { id: "cancelled", label: "Cancelled" },
];

/** One bar per hour of the range, each its problems by outcome. */
export function chartBarsOf(
  overview: DesktopLogOverview,
  range: OverviewRange,
) {
  return overview.problems_per_hour.map(({ hour, counts }) => {
    const values = Object.fromEntries(
      PROBLEM_SERIES.map(({ id }) => [id, counts[id] ?? 0]),
    ) as Record<ProblemOutcome, number>;
    return {
      hour,
      values,
      total: PROBLEM_SERIES.reduce((sum, { id }) => sum + values[id], 0),
      search: overviewEventsSearch(range, {
        problems: true,
        range: undefined,
        hour,
      }),
    };
  });
}

/** The rows each list shows at most. */
const LIST_ROWS = 10;

/**
 * Top problems: by name, outcome and reason. A row opens Events on its
 * name, outcome and reason; one without a reason opens its name and
 * outcome, since the Events filter has no "without a reason".
 */
export function topProblemsOf(
  overview: DesktopLogOverview,
  range: OverviewRange,
) {
  return overview.problems.slice(0, LIST_ROWS).map((problem) => ({
    key: [problem.name, problem.outcome, problem.outcome_reason ?? ""].join(
      "\n",
    ),
    name: problem.name,
    outcome: problem.outcome,
    reason: problem.outcome_reason,
    count: problem.count,
    lastAt: problem.last_at,
    places: problem.places,
    search: overviewEventsSearch(range, {
      terms: {
        name: problem.name,
        outcome: [problem.outcome],
        ...(problem.outcome_reason ? { reason: [problem.outcome_reason] } : {}),
      },
    }),
  }));
}

/** Slowest operations: p50 and p95 per name, the slowest p95 first. */
export function slowestOperationsOf(
  overview: DesktopLogOverview,
  range: OverviewRange,
) {
  return [...overview.durations]
    .sort((a, b) => b.p95_ms - a.p95_ms || a.name.localeCompare(b.name))
    .slice(0, LIST_ROWS)
    .map((duration) => ({
      name: duration.name,
      count: duration.count,
      p50Ms: duration.p50_ms,
      p95Ms: duration.p95_ms,
      search: overviewEventsSearch(range, { terms: { name: duration.name } }),
    }));
}

/** Everything is OK: no problem and no crash in the range. */
export function isHealthy(overview: DesktopLogOverview): boolean {
  return overview.problems.length === 0 && overview.crash_count === 0;
}

/** Nothing recorded in the range. */
export function isEmpty(overview: DesktopLogOverview): boolean {
  return overview.counts.length === 0;
}
