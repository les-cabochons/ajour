import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  RiErrorWarningLine as AlertCircle,
  RiRefreshLine as RefreshCw,
} from "@remixicon/react";
import { MessagePanel, SurfaceCallout } from "@/components/app-surface";
import { SectionHeading } from "@/components/section-heading";
import { TooltipButton } from "@/components/tooltip-button";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Value } from "@/components/ui/value";
import {
  OUTCOME_LABELS,
  TRACE_LANES,
  describeAction,
  describeToolCallSteps,
  fieldOf,
  formatDurationMs,
  isProblem,
  laneInfo,
  rootCauseOf,
  toolCallsOfEvents,
  toolCallsOfTrace,
  waterfallRows,
  type ToolCall,
  type TraceEvent,
  type TraceLane,
  type WaterfallRow,
} from "@/domain/diagnostics/action-trace";
import { usePluginsOverview } from "@/features/backlog/plugins-overview";
import {
  getLogTrace,
  listLogActions,
  queryLogs,
  type DesktopLogAction,
  type DesktopLogActionView,
  type DesktopLogTrace,
  type LoggedEvent,
} from "@/lib/desktop-bridge";
import { localStore } from "@/lib/local-store";
import { cn } from "@/lib/utils";
import { useDiagnosticsSearch } from "./diagnostics-search";

/*
 * Diagnostics > Actions (#444): one row per trace root from logs.actions,
 * and the picked trace from logs.trace as a waterfall across runtimes,
 * with its root cause and, for an agent, its tool calls and their writes.
 * The filter and the trace ride in the page's search (`show`, `trace`).
 */

const PAGE_SIZE = 100;
/** The agent tool calls read for one agent run: 4 pages of 500. */
const MAX_TOOL_CALL_PAGES = 4;

const VIEWS: ReadonlyArray<{ value: DesktopLogActionView; label: string }> = [
  { value: "all", label: "All" },
  { value: "failed", label: "Failed" },
  { value: "slow", label: "Slow" },
];

const EMPTY_LIST: Readonly<Record<DesktopLogActionView, [string, string]>> = {
  all: [
    "No actions yet",
    "Actions show here once Ajour writes events to the local log file, under Settings.",
  ],
  failed: ["No action failed", "Every action in the log file ended well."],
  slow: [
    "No slow action",
    "An action is slow when it takes its usual 95th percentile or longer. It needs two runs of the same action to tell.",
  ],
};

/** Each runtime's bar color: the chart tokens, in lane order. */
export const LANE_BAR_CLASSES: Readonly<Record<TraceLane, string>> = {
  renderer: "bg-chart-1",
  api: "bg-chart-2",
  plugin: "bg-chart-3",
  broker: "bg-chart-4",
  main: "bg-chart-5",
};

/** How far each level of the waterfall is indented under its parent. */
const INDENT_PX = 12;

export function DiagnosticsActionsTab() {
  const [search, updateSearch] = useDiagnosticsSearch();
  const show = search.show ?? "all";
  const [reload, setReload] = useState(0);
  const list = useActionList(show, reload);
  const connectionName = useConnectionNames();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex h-10 items-center gap-2">
        <ToggleGroup
          aria-label="Show"
          variant="outline"
          value={[show]}
          onValueChange={(next) => {
            const value = VIEWS.find((view) => view.value === next[0])?.value;
            if (value && value !== show)
              updateSearch({ show: value === "all" ? undefined : value });
          }}
        >
          {VIEWS.map(({ value, label }) => (
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
          <RefreshCw />
        </TooltipButton>
      </div>

      <section aria-label="Actions">
        <SectionHeading
          trailing={
            list.matchCount !== null ? (
              <Value tone="muted">{list.matchCount}</Value>
            ) : undefined
          }
        >
          Actions
        </SectionHeading>
        {list.error ? (
          <MessagePanel tone="warning" role="alert">
            Couldn't read the actions. The log file may be busy; try Refresh.
          </MessagePanel>
        ) : list.actions === null ? (
          <p className="h-9 text-xs leading-9 text-muted-foreground">
            Loading actions…
          </p>
        ) : list.actions.length === 0 ? (
          <Empty align="start" className="px-0">
            <EmptyHeader>
              <EmptyTitle>{EMPTY_LIST[show][0]}</EmptyTitle>
              <EmptyDescription>{EMPTY_LIST[show][1]}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <>
            <ul className="max-h-90 overflow-y-auto border-t border-[var(--border-row)]">
              {list.actions.map((action) => (
                <ActionRow
                  key={`${action.event.runtime}:${action.event.span_id}`}
                  action={action}
                  selected={action.event.trace_id === search.trace}
                  connectionName={connectionName}
                  onSelect={() =>
                    updateSearch({ trace: action.event.trace_id })
                  }
                />
              ))}
            </ul>
            {list.nextCursor ? (
              <Button
                variant="ghost"
                size="sm"
                className="mt-1"
                disabled={list.loadingMore}
                onClick={list.loadMore}
              >
                Show more
              </Button>
            ) : null}
          </>
        )}
      </section>

      <TraceSection traceId={search.trace} reload={reload} />
    </div>
  );
}

interface ActionListState {
  actions: DesktopLogAction[] | null;
  nextCursor: string | null;
  matchCount: number | null;
  error: boolean;
}

/** logs.actions for one filter, a page at a time, newest first. */
function useActionList(show: DesktopLogActionView, reload: number) {
  const [state, setState] = useState<ActionListState>({
    actions: null,
    nextCursor: null,
    matchCount: null,
    error: false,
  });
  const [loadingMore, setLoadingMore] = useState(false);
  // Each filter and each Refresh starts a generation: a Show more page
  // asked for in an earlier one is dropped when it answers.
  const generation = useRef(0);

  useEffect(() => {
    let current = true;
    generation.current += 1;
    setLoadingMore(false);
    setState((previous) => ({ ...previous, actions: null, error: false }));
    listLogActions({ show }, { limit: PAGE_SIZE })
      .then((page) => {
        if (!current) return;
        setState({
          actions: page.actions,
          nextCursor: page.next_cursor,
          matchCount: page.match_count,
          error: false,
        });
      })
      .catch(() => {
        if (current)
          setState({
            actions: null,
            nextCursor: null,
            matchCount: null,
            error: true,
          });
      });
    return () => {
      current = false;
    };
  }, [show, reload]);

  const loadMore = useCallback(() => {
    const cursor = state.nextCursor;
    if (!cursor) return;
    const asked = generation.current;
    const current = () => asked === generation.current;
    setLoadingMore(true);
    listLogActions({ show }, { limit: PAGE_SIZE, cursor })
      .then((page) => {
        if (!current()) return;
        setState((previous) => ({
          actions: [...(previous.actions ?? []), ...page.actions],
          nextCursor: page.next_cursor,
          matchCount: page.match_count,
          error: false,
        }));
      })
      .catch(() => {
        if (current()) setState((previous) => ({ ...previous, error: true }));
      })
      .finally(() => {
        if (current()) setLoadingMore(false);
      });
  }, [show, state.nextCursor]);

  return { ...state, loadingMore, loadMore };
}

type ConnectionName = (connectionId: string) => string | undefined;

/**
 * Connection names, joined from Ajour's own data at display time: the log
 * file holds only ids. As Settings names them, then a project source's.
 */
function useConnectionNames(): ConnectionName {
  const overview = usePluginsOverview();
  const projectSources = useSyncExternalStore(
    localStore.subscribe,
    () => localStore.snapshot().projectSources,
    () => localStore.snapshot().projectSources,
  );
  return useMemo(() => {
    const names = new Map<string, string>();
    for (const [id, source] of Object.entries(projectSources ?? {})) {
      if (source.label) names.set(id, source.label);
    }
    for (const group of overview?.connectionGroups ?? []) {
      for (const connection of group.connections) {
        if (connection.label) names.set(connection.id, connection.label);
      }
    }
    return (connectionId) => names.get(connectionId);
  }, [overview, projectSources]);
}

const timeFormat = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

function formatStartedAt(startedAt: string) {
  const time = Date.parse(startedAt);
  return Number.isFinite(time) ? timeFormat.format(time) : "";
}

const ROW_COLUMNS =
  "grid-cols-[minmax(0,1fr)_6rem_4.5rem] sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,0.8fr)_6rem_8rem_4.5rem]";

function ActionRow({
  action,
  selected,
  connectionName,
  onSelect,
}: {
  action: DesktopLogAction;
  selected: boolean;
  connectionName: ConnectionName;
  onSelect: () => void;
}) {
  const row = describeAction(action);
  const connection = row.connectionId
    ? (connectionName(row.connectionId) ?? "Removed connection")
    : null;
  const rootFailed = isProblem(action.event.outcome);
  return (
    <li
      data-action-trace={action.event.trace_id}
      className="border-b border-[var(--border-row)]"
    >
      <button
        type="button"
        aria-current={selected ? "true" : undefined}
        onClick={onSelect}
        className={cn(
          "grid min-h-9 w-full items-center gap-3 px-2 py-1 text-left text-sm hover:bg-[var(--highlight-bg)] sm:h-9 sm:py-0",
          ROW_COLUMNS,
          selected && "bg-[var(--hover-bg)] hover:bg-[var(--hover-bg)]",
        )}
      >
        <span className="flex min-w-0 flex-col">
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate font-medium text-foreground">
              {row.name}
            </span>
            {row.slow ? <Chip>Slow</Chip> : null}
          </span>
          {/* Narrow, the trigger and the connection take a second line, which wraps. */}
          <span className="text-xs break-words text-[var(--text-secondary)] sm:hidden">
            {[row.detail, connection].filter(Boolean).join(" · ")}
          </span>
        </span>
        <span className="hidden truncate text-xs text-[var(--text-secondary)] sm:block">
          {row.detail}
        </span>
        <span className="hidden truncate text-xs text-[var(--text-secondary)] sm:block">
          {connection}
        </span>
        <span
          className={cn(
            "truncate text-xs",
            row.failed ? "text-destructive" : "text-[var(--text-secondary)]",
          )}
        >
          {row.outcome}
          {!rootFailed && action.problem_count > 0
            ? ` · ${action.problem_count} failed`
            : ""}
        </span>
        <span className="hidden truncate text-xs text-[var(--text-tertiary)] sm:block">
          {formatStartedAt(row.startedAt)}
        </span>
        <Value className="text-right">{formatDurationMs(row.durationMs)}</Value>
      </button>
    </li>
  );
}

type TraceState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "loaded"; trace: DesktopLogTrace };

function useLogTrace(traceId: string | undefined, reload: number) {
  const [state, setState] = useState<TraceState>({ status: "loading" });
  useEffect(() => {
    if (!traceId) return;
    let current = true;
    setState({ status: "loading" });
    getLogTrace(traceId)
      .then((trace) => {
        if (current) setState({ status: "loaded", trace });
      })
      .catch(() => {
        if (current) setState({ status: "error" });
      });
    return () => {
      current = false;
    };
  }, [traceId, reload]);
  return state;
}

function TraceSection({
  traceId,
  reload,
}: {
  traceId: string | undefined;
  reload: number;
}) {
  const state = useLogTrace(traceId, reload);
  return (
    <section aria-label="Trace">
      <SectionHeading>Trace</SectionHeading>
      {!traceId ? (
        <TraceEmpty
          title="Pick an action"
          line="Its trace shows here: every step, in the renderer, the local API, plugin workers and the broker."
        />
      ) : state.status === "error" ? (
        <MessagePanel tone="warning" role="alert">
          Couldn't read this trace.
        </MessagePanel>
      ) : state.status === "loading" ? (
        <p className="h-9 text-xs leading-9 text-muted-foreground">
          Loading the trace…
        </p>
      ) : state.trace.roots.length === 0 ? (
        <TraceEmpty
          title="This trace isn't in the log file anymore"
          line="Its days were deleted, or it was written on another computer."
        />
      ) : (
        <TraceView trace={state.trace} />
      )}
    </section>
  );
}

function TraceEmpty({ title, line }: { title: string; line: string }) {
  return (
    <Empty align="start" className="px-0">
      <EmptyHeader>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{line}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

function TraceView({ trace }: { trace: DesktopLogTrace }) {
  const rows = useMemo(() => waterfallRows(trace), [trace]);
  const cause = useMemo(() => rootCauseOf(trace), [trace]);
  const lanes = useMemo(() => {
    const present = new Set(rows.map((row) => row.lane));
    return TRACE_LANES.filter(({ lane }) => present.has(lane));
  }, [rows]);
  const root = trace.roots[0]!.event;
  const total = useMemo(() => {
    let start = Infinity;
    let end = -Infinity;
    for (const { event } of rows) {
      const at = Date.parse(event.started_at);
      start = Math.min(start, at);
      end = Math.max(end, at + Math.max(0, event.duration_ms));
    }
    return end - start;
  }, [rows]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-sm font-medium text-foreground">{root.name}</span>
        <span className="text-xs text-[var(--text-tertiary)]">
          {formatStartedAt(root.started_at)}
        </span>
        <Value>{formatDurationMs(total)}</Value>
        <span className="text-xs text-[var(--text-tertiary)]">
          {trace.event_count === 1 ? "1 span" : `${trace.event_count} spans`}
        </span>
      </div>

      {cause ? (
        <div role="note" aria-label="Root cause">
          <SurfaceCallout icon={AlertCircle} title={cause.title}>
            {cause.explanation}
            {cause.reason ? (
              <>
                {" "}
                <Value tone="danger">{cause.reason}</Value>
              </>
            ) : null}
          </SurfaceCallout>
        </div>
      ) : null}

      <ul aria-label="Runtimes" className="flex flex-wrap gap-x-4 gap-y-1">
        {lanes.map(({ lane, label }) => (
          <li
            key={lane}
            className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)]"
          >
            <span
              aria-hidden
              className={cn("size-2 rounded-sm", LANE_BAR_CLASSES[lane])}
            />
            {label}
          </li>
        ))}
      </ul>

      <ol aria-label="Spans" className="flex flex-col">
        {rows.map((row) => (
          <SpanRow key={row.key} row={row} />
        ))}
      </ol>

      <ToolCallsSection trace={trace} root={root} />
    </div>
  );
}

function SpanRow({ row }: { row: WaterfallRow }) {
  const { event } = row;
  return (
    <li
      data-waterfall-row
      data-depth={row.depth}
      data-lane={row.lane}
      data-failed={row.failed ? "true" : "false"}
      className="grid h-7 grid-cols-[minmax(0,2fr)_minmax(0,3fr)_4.5rem] items-center gap-3"
    >
      <span
        className="flex min-w-0 items-baseline gap-2"
        style={{ paddingLeft: row.depth * INDENT_PX }}
      >
        <span className="truncate text-xs text-foreground">{event.name}</span>
        <span className="shrink-0 text-2xs text-[var(--text-tertiary)]">
          {laneInfo(row.lane).label}
        </span>
        {row.failed ? (
          <span className="truncate text-2xs text-destructive">
            {event.outcome_reason ?? OUTCOME_LABELS[event.outcome]}
          </span>
        ) : null}
      </span>
      <span className="relative h-3">
        <span
          data-waterfall-bar
          className={cn(
            "absolute inset-y-0 min-w-0.5 rounded-sm",
            row.failed ? "bg-destructive" : LANE_BAR_CLASSES[row.lane],
          )}
          style={{
            left: `${row.offset * 100}%`,
            width: `${row.width * 100}%`,
          }}
        />
      </span>
      <Value className="text-right" tone={row.failed ? "danger" : "default"}>
        {formatDurationMs(event.duration_ms)}
      </Value>
    </li>
  );
}

/**
 * An agent's tool calls: those in the trace, for an `agent_tool.call`; for
 * an `agent.run`, the calls its client made while it ran, which reach
 * Ajour over MCP in traces of their own.
 */
function ToolCallsSection({
  trace,
  root,
}: {
  trace: DesktopLogTrace;
  root: TraceEvent;
}) {
  const inTrace = useMemo(() => toolCallsOfTrace(trace), [trace]);
  const run = useAgentRunToolCalls(root);
  const calls = root.name === "agent.run" ? run : inTrace;
  if (root.name !== "agent.run" && inTrace.length === 0) return null;

  return (
    <section aria-label="Agent tool calls">
      <SectionHeading
        trailing={
          calls ? <Value tone="muted">{calls.length}</Value> : undefined
        }
      >
        Tool calls
      </SectionHeading>
      {calls === null ? (
        <p className="h-9 text-xs leading-9 text-muted-foreground">
          Loading tool calls…
        </p>
      ) : calls.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          The agent called no tool, or its calls aren't in the log file.
        </p>
      ) : (
        <ul
          aria-label="Tool calls"
          className="border-t border-[var(--border-row)]"
        >
          {calls.map((call) => (
            <ToolCallRow key={call.key} call={call} />
          ))}
        </ul>
      )}
    </section>
  );
}

function ToolCallRow({ call }: { call: ToolCall }) {
  const failed = isProblem(call.outcome);
  return (
    <li className="flex flex-col gap-0.5 border-b border-[var(--border-row)] px-2 py-2">
      <span className="grid grid-cols-[minmax(0,1fr)_auto_4.5rem] items-center gap-3">
        <span className="flex min-w-0 items-baseline gap-2">
          <span data-tool className="truncate text-sm font-medium">
            {call.tool}
          </span>
          {call.access ? (
            <span className="text-xs text-[var(--text-tertiary)]">
              {call.access}
            </span>
          ) : null}
        </span>
        <span
          className={cn(
            "text-xs",
            failed ? "text-destructive" : "text-[var(--text-secondary)]",
          )}
        >
          {OUTCOME_LABELS[call.outcome]}
          {call.reason ? ` · ${call.reason}` : ""}
        </span>
        <Value className="text-right">
          {formatDurationMs(call.durationMs)}
        </Value>
      </span>
      <span className="text-xs break-words text-[var(--text-secondary)]">
        {describeToolCallSteps(call)}
      </span>
    </li>
  );
}

/** The tool calls an agent run's client made while it ran, oldest first. */
function useAgentRunToolCalls(root: TraceEvent): ToolCall[] | null {
  const isRun = root.name === "agent.run";
  const clientId = fieldOf(root, "agent.client_id");
  const [calls, setCalls] = useState<ToolCall[] | null>(null);
  useEffect(() => {
    if (!isRun) return;
    if (typeof clientId !== "string") {
      setCalls([]);
      return;
    }
    let current = true;
    setCalls(null);
    const started = Date.parse(root.started_at);
    const filter = {
      name: "agent_tool.call",
      from: new Date(started).toISOString(),
      to: new Date(started + Math.max(0, root.duration_ms) + 1).toISOString(),
    };
    void (async () => {
      const events: LoggedEvent[] = [];
      let cursor: string | null = null;
      for (let page = 0; page < MAX_TOOL_CALL_PAGES; page += 1) {
        const result = await queryLogs(filter, {
          limit: 500,
          ...(cursor ? { cursor } : {}),
        });
        events.push(...result.events);
        cursor = result.next_cursor;
        if (!cursor) break;
      }
      return toolCallsOfEvents(events, clientId);
    })()
      .then((found) => {
        if (current) setCalls(found);
      })
      .catch(() => {
        if (current) setCalls([]);
      });
    return () => {
      current = false;
    };
  }, [isRun, clientId, root.started_at, root.duration_ms]);
  return isRun ? calls : [];
}
