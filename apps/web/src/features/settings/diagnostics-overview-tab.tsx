import { useEffect, useMemo, useState, type ReactNode } from "react";
import { format } from "date-fns";
import type { Outcome } from "@ajour/wide-events";
import {
  RiCheckLine as CheckIcon,
  RiRefreshLine as RefreshIcon,
} from "@remixicon/react";
import { MessagePanel } from "@/components/app-surface";
import { BarChart, type BarChartSeries } from "@/components/bar-chart";
import { SectionHeading } from "@/components/section-heading";
import { TooltipButton } from "@/components/tooltip-button";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Value } from "@/components/ui/value";
import {
  OUTCOME_LABELS,
  formatDurationMs,
} from "@/domain/diagnostics/action-trace";
import { explainOutcomeReason } from "@/domain/diagnostics/outcome-reasons";
import {
  aggregateLogs,
  type DesktopLogOverview,
  type ProblemOutcome,
} from "@/lib/desktop-bridge";
import { cn } from "@/lib/utils";
import { useEventDisplayNames } from "./diagnostics-event-detail";
import { OutcomeDot } from "./diagnostics-event-table";
import {
  formatEventHour,
  type EventDisplayNames,
} from "./diagnostics-events-model";
import {
  OVERVIEW_RANGES,
  PROBLEM_SERIES,
  chartBarsOf,
  crashFigureOf,
  isEmpty,
  isHealthy,
  launchFigureOf,
  parseOverviewRange,
  pluginFigureOf,
  slowestOperationsOf,
  syncFigureOf,
  topProblemsOf,
  type OverviewRange,
} from "./diagnostics-overview-model";
import {
  SettingsLink,
  useOpenSettings,
  useSettingsSearch,
} from "./settings-link";
import { useLocalLogs } from "./use-local-logs";

/*
 * Diagnostics > Overview (#445): the local log file's health over this
 * launch, 24 hours or 7 days, from one logs.aggregate. Every figure, bar
 * and row is a link to the Events tab filtered on what it counts.
 */

/** Each problem outcome's segment: failures red, refusals amber. */
const SERIES_CLASSES: Readonly<Record<ProblemOutcome, string>> = {
  error: "bg-destructive",
  timeout: "bg-destructive/50",
  refused: "bg-warning",
  cancelled: "bg-warning/50",
};

const CHART_SERIES: readonly BarChartSeries[] = PROBLEM_SERIES.map(
  (series) => ({ ...series, className: SERIES_CLASSES[series.id] }),
);

const RANGE_PHRASES: Readonly<Record<OverviewRange, string>> = {
  launch: "this launch",
  "24h": "the last 24 hours",
  "7d": "the last 7 days",
};

/** The rows a health figure lists at most. */
const FIGURE_ROWS = 3;

type OverviewState =
  | { status: "loading"; overview: DesktopLogOverview | null }
  | { status: "ready"; overview: DesktopLogOverview }
  | { status: "error"; overview: null };

/** logs.aggregate over the range, again on each `reload`. */
function useOverview(range: OverviewRange, reload: number): OverviewState {
  const [state, setState] = useState<OverviewState>({
    status: "loading",
    overview: null,
  });
  useEffect(() => {
    let current = true;
    // The figures shown stay until the new ones arrive.
    setState((previous) => ({
      status: "loading",
      overview: previous.overview,
    }));
    aggregateLogs(range).then(
      (overview) => {
        if (current) setState({ status: "ready", overview });
      },
      () => {
        if (current) setState({ status: "error", overview: null });
      },
    );
    return () => {
      current = false;
    };
  }, [range, reload]);
  return state;
}

/** When a problem last happened: its time today, with its day before. */
function formatLastAt(time: string, now: number): string {
  const at = Date.parse(time);
  if (!Number.isFinite(at)) return "";
  return format(at, "yyyy-MM-dd") === format(now, "yyyy-MM-dd")
    ? format(at, "HH:mm")
    : format(at, "MMM d, HH:mm");
}

const plural = (count: number, one: string, many: string) =>
  `${count.toLocaleString()} ${count === 1 ? one : many}`;

/** A reason's short label, as the Plugins figure names them. */
function reasonLabel(outcome: ProblemOutcome, reason: string | undefined) {
  if (reason === "capacity") return "Refused at capacity";
  if (reason === "crashed") return "Crashed";
  return reason && reason !== outcome
    ? `${OUTCOME_LABELS[outcome]} · ${reason}`
    : OUTCOME_LABELS[outcome];
}

/**
 * A failing connection's last failure in plain language, with the reason
 * itself: "… so the connection is paused (secret_unavailable)."
 */
function syncReasonLine(row: {
  outcome: Outcome;
  reason?: string;
  recovered: boolean;
}): string {
  const explained = row.reason
    ? explainOutcomeReason(row.reason, "backlog.sync")
    : null;
  const sentence = (explained ?? OUTCOME_LABELS[row.outcome]).replace(
    /\.$/,
    "",
  );
  return [
    `${sentence}${row.reason ? ` (${row.reason})` : ""}.`,
    row.recovered ? "Its last sync ended well." : null,
  ]
    .filter(Boolean)
    .join(" ");
}

const ROW_LINK =
  "flex min-w-0 rounded-md px-2 text-xs hover:bg-[var(--hover-bg)] -mx-2";

/**
 * One health figure: a link over its label, number and line, then up to
 * three rows, each a link of its own.
 */
function HealthFigure({
  title,
  search,
  value,
  tone = "default",
  line,
  children,
}: {
  title: string;
  search: Record<string, string>;
  value: ReactNode;
  tone?: "default" | "danger";
  line: ReactNode;
  children?: ReactNode;
}) {
  return (
    <section
      aria-label={title}
      className="flex min-w-0 flex-col gap-2 border-t border-border pt-3"
    >
      <SettingsLink
        page="diagnostics"
        search={search}
        className="-mx-2 flex min-w-0 flex-col gap-0.5 rounded-md px-2 py-1 hover:bg-[var(--hover-bg)]"
      >
        <span className="text-xs font-medium text-muted-foreground">
          {title}
        </span>
        <Value size="lg" tone={tone}>
          {value}
        </Value>
        <span className="truncate text-xs text-muted-foreground">{line}</span>
      </SettingsLink>
      {children ? <ul className="flex flex-col">{children}</ul> : null}
    </section>
  );
}

function SyncFigure({
  overview,
  range,
  names,
}: {
  overview: DesktopLogOverview;
  range: OverviewRange;
  names: EventDisplayNames;
}) {
  const sync = syncFigureOf(overview, range);
  return (
    <HealthFigure
      title="Sync"
      search={sync.search}
      value={sync.failedCount.toLocaleString()}
      tone={sync.failedCount > 0 ? "danger" : "default"}
      line={
        sync.syncCount === 0
          ? "No sync in this range"
          : sync.failedCount === 0
            ? `Every sync ended well, of ${sync.syncCount.toLocaleString()}`
            : `${plural(sync.failedCount, "failed sync", "failed syncs")} of ${sync.syncCount.toLocaleString()}`
      }
    >
      {sync.rows.slice(0, FIGURE_ROWS).map((row) => (
        <li key={row.connectionId}>
          <SettingsLink
            page="diagnostics"
            search={row.search}
            className={cn(ROW_LINK, "flex-col gap-0.5 py-1.5")}
            data-testid="sync-row"
          >
            <span className="flex min-w-0 items-center gap-2">
              <OutcomeDot outcome={row.outcome} />
              <span className="min-w-0 flex-1 truncate font-medium">
                {names.connections.get(row.connectionId) ?? row.connectionId}
              </span>
              <Value tone="muted">
                {row.failedCount} of {row.syncCount}
              </Value>
            </span>
            <span className="line-clamp-3 text-muted-foreground">
              {syncReasonLine(row)}
            </span>
          </SettingsLink>
        </li>
      ))}
    </HealthFigure>
  );
}

function PluginFigure({
  overview,
  range,
  names,
  now,
}: {
  overview: DesktopLogOverview;
  range: OverviewRange;
  names: EventDisplayNames;
  now: number;
}) {
  const plugins = pluginFigureOf(overview, range);
  return (
    <HealthFigure
      title="Plugins"
      search={plugins.search}
      value={plugins.count.toLocaleString()}
      tone={plugins.count > 0 ? "danger" : "default"}
      line={
        plugins.count === 0
          ? "No timeout, crash or refusal at capacity"
          : "Timeouts, crashes and refusals at capacity"
      }
    >
      {plugins.rows.slice(0, FIGURE_ROWS).map((row) => (
        <li key={row.key}>
          <SettingsLink
            page="diagnostics"
            search={row.search}
            className={cn(ROW_LINK, "flex-col gap-0.5 py-1.5")}
            data-testid="plugin-row"
          >
            <span className="flex min-w-0 items-center gap-2">
              <OutcomeDot outcome={row.outcome} />
              <span className="min-w-0 flex-1 truncate font-medium">
                {names.plugins.get(row.pluginId) ?? row.pluginId}
                {row.version ? (
                  <span className="font-normal text-muted-foreground">
                    {" "}
                    {row.version}
                  </span>
                ) : null}
              </span>
              <Value tone="muted">{row.count.toLocaleString()}</Value>
            </span>
            <span className="truncate text-muted-foreground">
              {reasonLabel(row.outcome, row.reason)} · last{" "}
              {formatLastAt(row.lastAt, now)}
            </span>
          </SettingsLink>
        </li>
      ))}
    </HealthFigure>
  );
}

function LaunchFigure({
  overview,
  range,
}: {
  overview: DesktopLogOverview;
  range: OverviewRange;
}) {
  const launch = launchFigureOf(overview, range);
  const failed = launch.outcome !== null && launch.outcome !== "ok";
  return (
    <HealthFigure
      title="App start"
      search={launch.search}
      value={
        launch.durationMs === null ? "–" : formatDurationMs(launch.durationMs)
      }
      tone={failed ? "danger" : "default"}
      line={
        launch.durationMs === null
          ? "No launch in this range"
          : [
              failed ? OUTCOME_LABELS[launch.outcome!] : "Latest launch",
              launch.p95Ms !== null && launch.launchCount > 1
                ? `p95 ${formatDurationMs(launch.p95Ms)} of ${launch.launchCount}`
                : null,
            ]
              .filter(Boolean)
              .join(" · ")
      }
    >
      {launch.slowestPhase ? (
        <li className="flex min-w-0 items-center gap-2 py-1.5 text-xs">
          <span className="min-w-0 flex-1 truncate text-muted-foreground">
            Slowest phase: {launch.slowestPhase.label}
          </span>
          <Value>{formatDurationMs(launch.slowestPhase.ms)}</Value>
        </li>
      ) : null}
    </HealthFigure>
  );
}

function CrashFigure({
  overview,
  range,
}: {
  overview: DesktopLogOverview;
  range: OverviewRange;
}) {
  const crashes = crashFigureOf(overview, range);
  return (
    <HealthFigure
      title="Crashes"
      search={crashes.search}
      value={crashes.count.toLocaleString()}
      tone={crashes.count > 0 ? "danger" : "default"}
      line={
        crashes.count === 0
          ? "No crash or unresponsive window"
          : "Errors, ended processes and unresponsive windows"
      }
    >
      {crashes.rows.map((row) => (
        <li key={row.name}>
          <SettingsLink
            page="diagnostics"
            search={row.search}
            className={cn(ROW_LINK, "h-7 items-center gap-2")}
            data-testid="crash-row"
          >
            <span className="min-w-0 flex-1 truncate">{row.name}</span>
            <Value tone="muted">{row.count.toLocaleString()}</Value>
          </SettingsLink>
        </li>
      ))}
    </HealthFigure>
  );
}

function ProblemsChart({
  overview,
  range,
}: {
  overview: DesktopLogOverview;
  range: OverviewRange;
}) {
  const bars = useMemo(
    () =>
      chartBarsOf(overview, range).map((bar) => ({
        ...bar,
        key: bar.hour,
        label: `${formatEventHour(bar.hour)}: ${[
          plural(bar.total, "problem", "problems"),
          ...PROBLEM_SERIES.filter(({ id }) => bar.values[id] > 0).map(
            ({ id, label }) => `${label} ${bar.values[id]}`,
          ),
        ].join(" · ")}`,
      })),
    [overview, range],
  );
  const total = bars.reduce((sum, bar) => sum + bar.total, 0);
  return (
    <section aria-label="Problems per hour">
      <SectionHeading trailing={<Value tone="muted">{total}</Value>}>
        Problems per hour
      </SectionHeading>
      <BarChart
        label="Problems per hour"
        series={CHART_SERIES}
        bars={bars}
        idleLine={`${bars.length.toLocaleString()} hours · point at a bar for its problems`}
        renderBar={(bar, { children, ...props }) => (
          <SettingsLink page="diagnostics" search={bar.search} {...props}>
            {children}
          </SettingsLink>
        )}
      />
    </section>
  );
}

const PROBLEM_ROW =
  "grid h-11 grid-cols-[0.5rem_minmax(0,1fr)_3rem_5.5rem] items-center gap-x-3 border-b border-[var(--border-row)] px-2 text-xs hover:bg-[var(--hover-bg)]";

function TopProblems({
  overview,
  range,
  names,
  now,
}: {
  overview: DesktopLogOverview;
  range: OverviewRange;
  names: EventDisplayNames;
  now: number;
}) {
  const rows = topProblemsOf(overview, range);
  const placeName = (place: { connection_id?: string; plugin_id?: string }) =>
    place.connection_id
      ? (names.connections.get(place.connection_id) ?? place.connection_id)
      : (names.plugins.get(place.plugin_id!) ?? place.plugin_id!);
  return (
    <section aria-label="Top problems">
      <SectionHeading
        trailing={<Value tone="muted">{overview.problems.length}</Value>}
      >
        Top problems
      </SectionHeading>
      <ul className="flex flex-col">
        {rows.map((row) => (
          <li key={row.key}>
            <SettingsLink
              page="diagnostics"
              search={row.search}
              className={PROBLEM_ROW}
              data-testid="problem-row"
            >
              <OutcomeDot outcome={row.outcome} />
              <span className="flex min-w-0 flex-col">
                <span className="truncate font-medium text-foreground">
                  {row.name}
                </span>
                <span className="truncate text-muted-foreground">
                  {[
                    reasonLabel(row.outcome, row.reason),
                    row.places.map(placeName).join(", "),
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </span>
              <Value className="text-right">{row.count.toLocaleString()}</Value>
              <span className="truncate text-right text-muted-foreground">
                {formatLastAt(row.lastAt, now)}
              </span>
            </SettingsLink>
          </li>
        ))}
      </ul>
    </section>
  );
}

const SLOW_ROW =
  "grid h-7 grid-cols-[minmax(0,1fr)_4.5rem_4.5rem] items-center gap-x-3 px-2 text-xs @md:grid-cols-[minmax(0,1fr)_3.5rem_4.5rem_4.5rem]";

function SlowestOperations({
  overview,
  range,
}: {
  overview: DesktopLogOverview;
  range: OverviewRange;
}) {
  const rows = slowestOperationsOf(overview, range);
  if (rows.length === 0) return null;
  return (
    <section aria-label="Slowest operations">
      <SectionHeading>Slowest operations</SectionHeading>
      <div
        aria-hidden
        className={cn(SLOW_ROW, "text-2xs font-medium text-muted-foreground")}
      >
        <span>Event</span>
        <span className="hidden text-right @md:block">Runs</span>
        <span className="text-right">p50</span>
        <span className="text-right">p95</span>
      </div>
      <ul className="flex flex-col">
        {rows.map((row) => (
          <li key={row.name}>
            <SettingsLink
              page="diagnostics"
              search={row.search}
              className={cn(
                SLOW_ROW,
                "border-b border-[var(--border-row)] hover:bg-[var(--hover-bg)]",
              )}
              data-testid="slow-row"
            >
              <span className="truncate">{row.name}</span>
              <Value tone="muted" className="hidden text-right @md:block">
                {row.count.toLocaleString()}
              </Value>
              <Value className="text-right">
                {formatDurationMs(row.p50Ms)}
              </Value>
              <Value className="text-right">
                {formatDurationMs(row.p95Ms)}
              </Value>
            </SettingsLink>
          </li>
        ))}
      </ul>
    </section>
  );
}

function OverviewEmpty({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <Empty align="start" className="border-b">
      <EmptyHeader>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{children}</EmptyDescription>
      </EmptyHeader>
      {action ? <EmptyContent>{action}</EmptyContent> : null}
    </Empty>
  );
}

export function DiagnosticsOverviewTab() {
  const search = useSettingsSearch();
  const openSettings = useOpenSettings();
  const range = parseOverviewRange(search);
  const [reload, setReload] = useState(0);
  const state = useOverview(range, reload);
  const { status } = useLocalLogs();
  const names = useEventDisplayNames();
  // "Now" moves with each read, so "today" in the times is the read's.
  const now = useMemo(() => Date.now(), [state.overview]);
  const loggingOff = status?.settings.enabled === false;

  const toolbar = (
    <div className="flex h-10 items-center gap-2">
      <ToggleGroup
        aria-label="Range"
        variant="outline"
        value={[range]}
        onValueChange={(next) => {
          const value = OVERVIEW_RANGES.find(
            (option) => option.value === next[0],
          )?.value;
          if (value && value !== range)
            void openSettings(
              {
                page: "diagnostics",
                search: {
                  tab: "overview",
                  ...(value === "launch" ? {} : { range: value }),
                },
              },
              { replace: true },
            );
        }}
      >
        {OVERVIEW_RANGES.map(({ value, label }) => (
          <ToggleGroupItem key={value} value={value}>
            {label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <span className="flex-1" />
      <TooltipButton
        label="Refresh"
        render={
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setReload((count) => count + 1)}
          />
        }
      >
        <RefreshIcon />
      </TooltipButton>
    </div>
  );

  const { overview } = state;
  let body: ReactNode;
  if (state.status === "error") {
    body = (
      <MessagePanel tone="warning" role="alert">
        Couldn't read the log file.
      </MessagePanel>
    );
  } else if (!overview) {
    body = (
      <p className="py-6 text-xs text-muted-foreground" role="status">
        Reading the log file…
      </p>
    );
  } else if (isEmpty(overview)) {
    body = loggingOff ? (
      <OverviewEmpty
        title="Logging is off"
        action={
          <SettingsLink
            page="diagnostics"
            search={{ tab: "settings" }}
            replace
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            Open the Settings tab
          </SettingsLink>
        }
      >
        Turn on Write events to a local file to see Ajour's health here.
      </OverviewEmpty>
    ) : (
      <OverviewEmpty title="No data yet">
        Nothing is recorded for {RANGE_PHRASES[range]} yet. Events show here as
        Ajour works.
      </OverviewEmpty>
    );
  } else {
    const healthy = isHealthy(overview);
    body = (
      <>
        {loggingOff ? (
          <p className="text-xs text-muted-foreground">
            Logging is off: no new events are written.
          </p>
        ) : null}
        {healthy ? (
          <p
            role="status"
            className="flex items-center gap-1.5 text-sm text-foreground"
          >
            <CheckIcon aria-hidden className="size-4" />
            Everything is OK: no problem or crash in {RANGE_PHRASES[range]}.
          </p>
        ) : null}
        <div className="grid gap-x-8 gap-y-6 @xl:grid-cols-2 @5xl:grid-cols-4">
          <SyncFigure overview={overview} range={range} names={names} />
          <PluginFigure
            overview={overview}
            range={range}
            names={names}
            now={now}
          />
          <LaunchFigure overview={overview} range={range} />
          <CrashFigure overview={overview} range={range} />
        </div>
        {healthy ? null : (
          <>
            <ProblemsChart overview={overview} range={range} />
            <TopProblems
              overview={overview}
              range={range}
              names={names}
              now={now}
            />
          </>
        )}
        <SlowestOperations overview={overview} range={range} />
      </>
    );
  }

  return (
    <div className="@container flex min-w-0 flex-col gap-6">
      {toolbar}
      {body}
    </div>
  );
}
