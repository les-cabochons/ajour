import type {
  DesktopLogAction,
  DesktopLogTrace,
  DesktopLogTraceNode,
  LoggedEvent,
} from "@/lib/desktop-bridge";

/*
 * Wide events as the local log file holds them, for the diagnostics
 * viewer's tests (#444). Content-free, as every logged event is.
 */

const LAUNCH = "launch-1";
const T0 = Date.parse("2026-11-17T10:00:00.000Z");

/** An event with the envelope filled in: `at` is milliseconds after 10:00. */
export function loggedEvent(
  fields: Partial<LoggedEvent> & {
    name: string;
    span_id: string;
    trace_id: string;
    at?: number;
  },
): LoggedEvent {
  const { at = 0, ...rest } = fields;
  return {
    schema: 1,
    runtime: "api",
    launch_id: LAUNCH,
    app: { version: "1.0.0", channel: "dev", packaged: false },
    device: { platform: "win32" },
    kind: "job",
    outcome: "ok",
    started_at: new Date(T0 + at).toISOString(),
    duration_ms: 10,
    trigger: "system",
    ...rest,
  } as LoggedEvent;
}

/** A trace's tree, as logs.trace answers it, from events and their parents. */
export function traceOf(
  traceId: string,
  events: LoggedEvent[],
): DesktopLogTrace {
  const nodes = new Map<string, DesktopLogTraceNode>();
  for (const event of events) {
    nodes.set(event.span_id, {
      event,
      depth: 0,
      children: [],
      deepest_failure: false,
      missing_parent: false,
    });
  }
  const roots: DesktopLogTraceNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.event.parent_span_id
      ? nodes.get(node.event.parent_span_id)
      : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  const ordered: DesktopLogTraceNode[] = [];
  const walk = (node: DesktopLogTraceNode, depth: number) => {
    node.depth = depth;
    ordered.push(node);
    for (const child of node.children) walk(child, depth + 1);
  };
  roots.forEach((root) => walk(root, 0));
  let deepest: DesktopLogTraceNode | undefined;
  for (const node of ordered) {
    if (node.event.outcome === "ok" || node.event.outcome === "noop") continue;
    if (!deepest || node.depth > deepest.depth) deepest = node;
  }
  if (deepest) deepest.deepest_failure = true;
  return {
    trace_id: traceId,
    roots,
    event_count: ordered.length,
    runtimes: [...new Set(ordered.map(({ event }) => event.runtime))],
    deepest_failure_span_id: deepest?.event.span_id ?? null,
    file_count: 1,
    missing_file_count: 0,
    skipped_line_count: 0,
  };
}

/** An action row for a trace's first root, as logs.actions answers it. */
export function actionOf(
  trace: DesktopLogTrace,
  extra: Partial<DesktopLogAction> = {},
): DesktopLogAction {
  const events: LoggedEvent[] = [];
  const walk = (node: DesktopLogTraceNode) => {
    events.push(node.event);
    node.children.forEach(walk);
  };
  trace.roots.forEach(walk);
  return {
    event: trace.roots[0]!.event,
    span_count: events.length,
    problem_count: events.filter(
      ({ outcome }) => outcome !== "ok" && outcome !== "noop",
    ).length,
    runtimes: trace.runtimes,
    slow: false,
    p95_ms: null,
    ...extra,
  };
}

export const RATE_LIMITED_SYNC_TRACE = "4bf92f3577b34da6a3ce929d0e0e4736";

/**
 * A backlog sync the user started that failed at the broker: the renderer's
 * job, the local API's request, the plugin worker's operation, and three
 * broker requests, a first try and two retries, each refused `rate_limited`.
 */
export function rateLimitedBacklogSync(): DesktopLogTrace {
  const trace_id = RATE_LIMITED_SYNC_TRACE;
  const failed = { outcome: "error", outcome_reason: "plugin_error" } as const;
  const broker = (span: string, at: number) =>
    loggedEvent({
      name: "plugin.request",
      trace_id,
      span_id: span,
      parent_span_id: "c000000000000003",
      at,
      duration_ms: 4,
      outcome: "refused",
      outcome_reason: "rate_limited",
      plugin: { id: "jira" },
      connection: { id: "conn-jira" },
      broker: { method: "GET", path_template: "/rest/api/3/search" },
    });
  return traceOf(trace_id, [
    loggedEvent({
      name: "backlog.sync",
      runtime: "renderer",
      kind: "job",
      trigger: "user",
      surface: "button",
      trace_id,
      span_id: "a000000000000001",
      at: 0,
      duration_ms: 1500,
      ...failed,
      plugin: { id: "jira" },
      connection: { id: "conn-jira" },
    }),
    loggedEvent({
      name: "backlog.sync",
      kind: "request",
      trigger: "user",
      trace_id,
      span_id: "b000000000000002",
      parent_span_id: "a000000000000001",
      at: 20,
      duration_ms: 1460,
      ...failed,
      connection: { id: "conn-jira" },
    }),
    loggedEvent({
      name: "backlog.sync",
      kind: "plugin_operation",
      trigger: "user",
      trace_id,
      span_id: "c000000000000003",
      parent_span_id: "b000000000000002",
      at: 40,
      duration_ms: 1420,
      ...failed,
      plugin: { id: "jira" },
      connection: { id: "conn-jira" },
      worker: { host: "plugin", method: "syncConnection" },
    }),
    broker("d000000000000004", 100),
    broker("d000000000000005", 600),
    broker("d000000000000006", 1200),
  ]);
}

export const AGENT_TOOL_TRACE = "5cf92f3577b34da6a3ce929d0e0e4737";

/** An agent's tool call: the local API's request and the window's job, whose writes fold into it. */
export function agentToolCall(
  trace_id = AGENT_TOOL_TRACE,
  { at = 0, clientId = "client-1", tool = "update_backlog_item" } = {},
): LoggedEvent[] {
  const suffix = trace_id.slice(0, 4);
  return [
    loggedEvent({
      name: "agent_tool.call",
      kind: "request",
      trigger: "agent",
      trace_id,
      span_id: `e${suffix}00000000001`,
      at,
      duration_ms: 120,
      agent: { client_id: clientId, session_id: "session-1" },
      agent_tool: { name: tool, access: "write", bridge_ms: 90 },
    }),
    loggedEvent({
      name: "agent_tool.call",
      runtime: "renderer",
      kind: "job",
      trigger: "agent",
      trace_id,
      span_id: `f${suffix}00000000002`,
      parent_span_id: `e${suffix}00000000001`,
      at: at + 10,
      duration_ms: 80,
      steps: ["backlog_item.update", "time_entry.create"],
      agent_tool: { name: tool, access: "write", undo_offered: true },
    }),
  ];
}
