import type { z } from "zod";
import type {
  LogToolOutput,
  logToolInputSchemas,
} from "../../../packages/shared/agent-tools.ts";

/**
 * The local log file's reads that the MCP log tools use. The desktop app
 * passes main's query service (apps/desktop/electron/local-log-query.cjs),
 * the one Settings › Diagnostics reads through IPC. The standalone API has
 * none, so its MCP server lists no log tool.
 */
export interface LocalLogReader {
  /** Whether Ajour writes the local log file now. */
  writing(): boolean;
  /** `logs.query`: the events that pass the filter, newest first, one page. */
  query(
    filter: LogQueryFilter,
    page: { limit: number; cursor?: string },
  ): Promise<{
    events: Record<string, unknown>[];
    next_cursor: string | null;
    match_count: number;
  }>;
  /** `logs.trace`: every event of the trace, as a tree. */
  trace(traceId: string): Promise<{
    trace_id: string;
    roots: LogTraceNode[];
    event_count: number;
    deepest_failure_span_id: string | null;
  }>;
}

/** The query service's filter, in the log's own field names. */
export type LogQueryFilter = Partial<
  Record<
    | "from"
    | "to"
    | "outcome"
    | "name"
    | "name_prefix"
    | "outcome_reason"
    | "plugin_id"
    | "trace_id"
    | "runtime",
    string
  >
>;

interface LogTraceNode {
  event: Record<string, unknown>;
  depth: number;
  deepest_failure: boolean;
  missing_parent: boolean;
  children: LogTraceNode[];
}

/** The query service refuses a filter outside its formats with this code. */
export const INVALID_LOG_QUERY = "invalid_log_query";

/** The most events one find_log_events page holds when the agent names none. */
const DEFAULT_LIMIT = 50;
/** The most spans get_log_trace returns. A backlog sync can run hundreds. */
export const MAX_TRACE_SPANS = 500;

type FindInput = z.infer<(typeof logToolInputSchemas)["find_log_events"]>;

/** find_log_events: the agent's camelCase filter, read by the query service. */
export async function findLogEvents(
  reader: LocalLogReader,
  input: FindInput,
): Promise<LogToolOutput<"find_log_events">> {
  const filter: LogQueryFilter = {};
  const names = {
    from: "from",
    to: "to",
    outcome: "outcome",
    name: "name",
    namePrefix: "name_prefix",
    outcomeReason: "outcome_reason",
    pluginId: "plugin_id",
    traceId: "trace_id",
    runtime: "runtime",
  } as const;
  for (const [key, field] of Object.entries(names)) {
    const value = input[key as keyof typeof names];
    if (value !== undefined) filter[field] = value;
  }
  const result = await reader.query(filter, {
    limit: input.limit ?? DEFAULT_LIMIT,
    ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
  });
  return {
    logging: reader.writing() ? "on" : "off",
    events: result.events,
    matchCount: result.match_count,
    nextCursor: result.next_cursor,
  };
}

/**
 * get_log_trace: the trace's tree as a flat list, depth first from the
 * oldest root, so an agent reads it top to bottom like the Actions tab.
 */
export async function getLogTrace(
  reader: LocalLogReader,
  traceId: string,
): Promise<LogToolOutput<"get_log_trace">> {
  const trace = await reader.trace(traceId);
  const spans: LogToolOutput<"get_log_trace">["spans"] = [];
  const stack = [...trace.roots].reverse();
  while (stack.length > 0 && spans.length < MAX_TRACE_SPANS) {
    const node = stack.pop()!;
    spans.push({
      depth: node.depth,
      deepestFailure: node.deepest_failure,
      missingParent: node.missing_parent,
      event: node.event,
    });
    for (let i = node.children.length - 1; i >= 0; i -= 1)
      stack.push(node.children[i]!);
  }
  return {
    traceId: trace.trace_id,
    eventCount: trace.event_count,
    deepestFailureSpanId: trace.deepest_failure_span_id,
    spans,
    truncated: spans.length < trace.event_count,
  };
}
