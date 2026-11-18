import type { Envelope, Outcome, Trigger } from "@ajour/wide-events";
import { catalog } from "@ajour/wide-events/catalog.ts";
import { explainOutcomeReason } from "./outcome-reasons";

/*
 * The Actions tab's model (#444): a trace from the local log file as rows
 * of a waterfall, its root cause, its action row and an agent's tool calls.
 * The shapes are main's query service answers (`logs.trace`, `logs.actions`,
 * `logs.query`), structurally, so the rules stay pure.
 */

/** A logged event: the envelope and its catalog fields. */
export type TraceEvent = Envelope & Record<string, unknown>;

/** One span of a trace, as `logs.trace` builds the tree. */
export interface TraceSpan {
  event: TraceEvent;
  depth: number;
  children: TraceSpan[];
  deepest_failure: boolean;
  missing_parent: boolean;
}

export interface TraceTree {
  roots: TraceSpan[];
}

/** One row of `logs.actions`: a trace root and what its trace holds. */
export interface ActionRoot {
  event: TraceEvent;
  problem_count: number;
  slow: boolean;
}

/**
 * Where a span ran, for its color: the window, the local API, a plugin's
 * worker, the broker between a plugin and the network, or the desktop main
 * process for the rest of its work.
 */
export type TraceLane = "renderer" | "api" | "plugin" | "broker" | "main";

export const TRACE_LANES: ReadonlyArray<{
  lane: TraceLane;
  label: string;
  /** The lane as a place, for the root-cause note: "in the broker". */
  place: string;
}> = [
  { lane: "renderer", label: "Renderer", place: "the renderer" },
  { lane: "api", label: "Local API", place: "the local API" },
  { lane: "plugin", label: "Plugin worker", place: "a plugin worker" },
  { lane: "broker", label: "Broker", place: "the broker" },
  { lane: "main", label: "Main process", place: "the main process" },
];

/** The broker's own events: network requests, processes and opened links. */
const BROKER_EVENTS = new Set([
  "plugin.request",
  "plugin.process",
  "plugin.open",
]);

export function laneOf(event: TraceEvent): TraceLane {
  if (BROKER_EVENTS.has(event.name)) return "broker";
  if (
    event.kind === "plugin_operation" ||
    event.name.startsWith("plugin_renderer.")
  ) {
    return "plugin";
  }
  if (event.runtime === "renderer") return "renderer";
  return event.runtime === "api" ? "api" : "main";
}

export function laneInfo(lane: TraceLane) {
  return TRACE_LANES.find((info) => info.lane === lane)!;
}

/** Anything that didn't end `ok` or `noop`, as main counts problems. */
export function isProblem(outcome: Outcome): boolean {
  return outcome !== "ok" && outcome !== "noop";
}

export const OUTCOME_LABELS: Readonly<Record<Outcome, string>> = {
  ok: "OK",
  noop: "Nothing to do",
  refused: "Refused",
  cancelled: "Cancelled",
  timeout: "Timed out",
  error: "Error",
};

const OUTCOME_PHRASES: Readonly<Record<Outcome, string>> = {
  ok: "ended",
  noop: "had nothing to do",
  refused: "was refused",
  cancelled: "was cancelled",
  timeout: "timed out",
  error: "failed",
};

const TRIGGER_LABELS: Readonly<Record<Trigger, string>> = {
  user: "User",
  agent: "Agent",
  schedule: "Schedule",
  boot: "Launch",
  system: "System",
};

/** A catalog field by its path, such as `agent_tool.name`. */
export function fieldOf(event: TraceEvent, path: string): unknown {
  let value: unknown = event;
  for (const key of path.split(".")) {
    if (typeof value !== "object" || value === null) return undefined;
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}

function textField(event: TraceEvent, path: string): string | undefined {
  const value = fieldOf(event, path);
  return typeof value === "string" && value !== "" ? value : undefined;
}

export interface WaterfallRow {
  key: string;
  event: TraceEvent;
  depth: number;
  lane: TraceLane;
  failed: boolean;
  /** Where the bar starts, as a share of the whole trace: 0 to 1. */
  offset: number;
  /** How long the bar is, as a share of the whole trace. */
  width: number;
}

const startOf = (event: TraceEvent) => Date.parse(event.started_at);
const endOf = (event: TraceEvent) =>
  startOf(event) + Math.max(0, event.duration_ms);

function flatten(trace: TraceTree): TraceSpan[] {
  const spans: TraceSpan[] = [];
  const stack = [...trace.roots].reverse();
  while (stack.length > 0) {
    const span = stack.pop()!;
    spans.push(span);
    for (let index = span.children.length - 1; index >= 0; index -= 1) {
      stack.push(span.children[index]!);
    }
  }
  return spans;
}

/**
 * The trace's spans in tree order, each under its parent, with its bar
 * placed by its start and duration within the trace, from its first start
 * to its last end. A retry is a span of its own, so it is a bar of its own.
 */
export function waterfallRows(trace: TraceTree): WaterfallRow[] {
  const spans = flatten(trace);
  if (spans.length === 0) return [];
  let start = Infinity;
  let end = -Infinity;
  for (const { event } of spans) {
    start = Math.min(start, startOf(event));
    end = Math.max(end, endOf(event));
  }
  const total = end - start;
  return spans.map(({ event, depth }) => ({
    key: `${event.runtime}:${event.span_id}`,
    event,
    depth,
    lane: laneOf(event),
    failed: isProblem(event.outcome),
    offset: total > 0 ? (startOf(event) - start) / total : 0,
    width: total > 0 ? Math.max(0, event.duration_ms) / total : 0,
  }));
}

export interface RootCause {
  event: TraceEvent;
  lane: TraceLane;
  /** "plugin.request was refused in the broker". */
  title: string;
  reason?: string;
  /** The reason's plain-language line from the fixed table. */
  explanation: string;
}

/** The deepest failed span, as main marked it, with what its reason means. */
export function rootCauseOf(trace: TraceTree): RootCause | null {
  const span = flatten(trace).find((candidate) => candidate.deepest_failure);
  if (!span) return null;
  const { event } = span;
  const lane = laneOf(event);
  const reason = event.outcome_reason || undefined;
  const errorType =
    typeof event.error?.type === "string" ? event.error.type : undefined;
  const explanation =
    (reason ? explainOutcomeReason(reason, event.name) : null) ??
    (errorType
      ? `It ended with an error: ${errorType}${event.error?.code ? ` (${event.error.code})` : ""}.`
      : reason
        ? "This version of Ajour has no explanation for this reason."
        : "It ended without a reason.");
  return {
    event,
    lane,
    title: `${event.name} ${OUTCOME_PHRASES[event.outcome]} in ${laneInfo(lane).place}`,
    ...(reason ? { reason } : {}),
    explanation,
  };
}

export interface ActionSummary {
  name: string;
  /** "User · button", or the agent tool: "Agent · update_backlog_item". */
  detail: string;
  outcome: string;
  reason?: string;
  /** A span of its trace didn't end ok or noop. */
  failed: boolean;
  slow: boolean;
  startedAt: string;
  durationMs: number;
  connectionId?: string;
  pluginId?: string;
}

export function describeAction(action: ActionRoot): ActionSummary {
  const { event } = action;
  const tool = textField(event, "agent_tool.name");
  const second = tool ?? event.surface?.replaceAll("_", " ");
  const connectionId = textField(event, "connection.id");
  const pluginId = textField(event, "plugin.id");
  return {
    name: event.name,
    detail: [TRIGGER_LABELS[event.trigger] ?? event.trigger, second]
      .filter(Boolean)
      .join(" · "),
    outcome: OUTCOME_LABELS[event.outcome] ?? event.outcome,
    ...(event.outcome_reason ? { reason: event.outcome_reason } : {}),
    failed: isProblem(event.outcome) || action.problem_count > 0,
    slow: action.slow,
    startedAt: event.started_at,
    durationMs: event.duration_ms,
    ...(connectionId ? { connectionId } : {}),
    ...(pluginId ? { pluginId } : {}),
  };
}

const TOOL_CALL = "agent_tool.call";

/** A unit folded into a tool call's event, as that event recorded it. */
export interface ToolCallStep {
  name: string;
  outcome: Outcome;
  reason?: string;
}

export interface ToolCall {
  key: string;
  traceId: string;
  tool: string;
  access?: string;
  outcome: Outcome;
  reason?: string;
  startedAt: string;
  durationMs: number;
  /** The units folded into it, in the order they started, each with its outcome. */
  steps: ToolCallStep[];
  /**
   * The store writes its trace counted. The log doesn't say which step made
   * them, so a step that ended ok is only known to have run.
   */
  writeCount: number;
  /** Steps past the first 50 each event keeps. */
  droppedStepCount: number;
  undoOffered: boolean;
}

const EVENT_SPECS: Readonly<
  Record<string, { readonly kinds: readonly string[] } | undefined>
> = catalog.events;

/** A store command: the only folded unit that writes the local state. */
function isStoreCommand(name: string): boolean {
  return EVENT_SPECS[name]?.kinds.includes("command") ?? false;
}

/**
 * An event's folded units with their outcomes. A unit that failed is in
 * `step_failures`, matched to its step by name. One that ended ok or noop
 * records nothing of its own, but a store command ends ok only when it
 * wrote, so when the call counted no store write, its store commands ended
 * noop.
 */
function stepsOf(event: TraceEvent, callWrote: boolean): ToolCallStep[] {
  const failures = [...(event.step_failures ?? [])];
  return (event.steps ?? []).map((name) => {
    const index = failures.findIndex((failure) => failure.name === name);
    const command = isStoreCommand(name);
    if (index >= 0) {
      const [failure] = failures.splice(index, 1);
      return {
        name,
        outcome: failure!.outcome,
        ...(failure!.outcome_reason ? { reason: failure!.outcome_reason } : {}),
      };
    }
    if (command && !callWrote) return { name, outcome: "noop" };
    return { name, outcome: "ok" };
  });
}

/** A call from its outermost event and the events under it. */
function toolCallOf(call: TraceEvent, events: TraceEvent[]): ToolCall {
  const writeCount = events.reduce(
    (sum, event) => sum + (event.counts?.store_write_count ?? 0),
    0,
  );
  const callWrote = writeCount > 0;
  const steps: ToolCallStep[] = [];
  let dropped = 0;
  let undoOffered = false;
  for (const event of events) {
    steps.push(...stepsOf(event, callWrote));
    dropped += event.dropped_step_count ?? 0;
    if (fieldOf(event, "agent_tool.undo_offered") === true) undoOffered = true;
  }
  const access = events
    .map((event) => textField(event, "agent_tool.access"))
    .find(Boolean);
  return {
    key: `${call.runtime}:${call.span_id}`,
    traceId: call.trace_id,
    tool:
      events
        .map((event) => textField(event, "agent_tool.name"))
        .find(Boolean) ?? "other",
    ...(access ? { access } : {}),
    outcome: call.outcome,
    ...(call.outcome_reason ? { reason: call.outcome_reason } : {}),
    startedAt: call.started_at,
    durationMs: call.duration_ms,
    steps,
    writeCount,
    droppedStepCount: dropped,
    undoOffered,
  };
}

/**
 * What a call's trace recorded it did: "1 write recorded · Ran
 * backlog_item.update · time_entry.create was refused (locked_week)". The
 * writes are counted for the call, not per step, so the store commands that
 * ended ok are said to have run. Work a call only queues, such as a comment
 * sent after its Undo, runs later in a trace of its own, so a call without a
 * write says only that this trace recorded none.
 */
export function describeToolCallSteps(call: ToolCall): string {
  const ran = (step: ToolCallStep) =>
    step.outcome === "ok" && isStoreCommand(step.name);
  const commands = call.steps.filter(ran);
  return [
    call.writeCount > 0
      ? `${call.writeCount} ${call.writeCount === 1 ? "write" : "writes"} recorded`
      : "No write recorded in this trace",
    commands.length > 0
      ? `Ran ${commands.map((step) => step.name).join(", ")}`
      : null,
    ...call.steps
      .filter((step) => !ran(step))
      .map(
        (step) =>
          `${step.name} ${OUTCOME_PHRASES[step.outcome]}${step.reason ? ` (${step.reason})` : ""}`,
      ),
    call.droppedStepCount > 0 ? `${call.droppedStepCount} more steps` : null,
    call.undoOffered ? "Undo offered" : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/**
 * The tool calls in a trace: each outermost `agent_tool.call` span, with
 * the steps folded into it and into the spans under it, such as the
 * window's answer to the local API's call.
 */
export function toolCallsOfTrace(trace: TraceTree): ToolCall[] {
  const calls: ToolCall[] = [];
  const visit = (span: TraceSpan) => {
    if (span.event.name === TOOL_CALL) {
      calls.push(
        toolCallOf(
          span.event,
          flatten({ roots: [span] }).map((s) => s.event),
        ),
      );
      return;
    }
    span.children.forEach(visit);
  };
  trace.roots.forEach(visit);
  return calls;
}

/**
 * An agent run's tool calls, from the `agent_tool.call` events logged while
 * it ran: an agent's calls reach Ajour over MCP, each in a trace of its own,
 * so they are joined to the run by its client. Oldest first.
 */
export function toolCallsOfEvents(
  events: TraceEvent[],
  clientId: string,
): ToolCall[] {
  const byTrace = new Map<string, TraceEvent[]>();
  for (const event of events) {
    if (event.name !== TOOL_CALL) continue;
    byTrace.set(event.trace_id, [
      ...(byTrace.get(event.trace_id) ?? []),
      event,
    ]);
  }
  const calls: ToolCall[] = [];
  for (const group of byTrace.values()) {
    const spans = new Set(group.map((event) => event.span_id));
    const outer =
      group.find(
        (event) => !event.parent_span_id || !spans.has(event.parent_span_id),
      ) ?? group[0]!;
    if (textField(outer, "agent.client_id") !== clientId) continue;
    calls.push(toolCallOf(outer, group));
  }
  return calls.sort(
    (a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt),
  );
}

/** "245 ms", "1.45 s", "1 min 5 s". */
export function formatDurationMs(ms: number): string {
  if (ms <= 0) return "0 ms";
  if (ms < 1) return "<1 ms";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 10_000) return `${(ms / 1000).toFixed(2)} s`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  const seconds = Math.round(ms / 1000);
  return `${Math.floor(seconds / 60)} min ${seconds % 60} s`;
}
