import { describe, expect, it } from "vitest";
import type { LoggedEvent } from "@/lib/desktop-bridge";
import {
  AGENT_TOOL_TRACE,
  agentToolCall,
  actionOf,
  loggedEvent,
  rateLimitedBacklogSync,
  traceOf,
} from "@/test-support/log-trace-fixtures";
import {
  describeAction,
  describeToolCallSteps,
  formatDurationMs,
  laneOf,
  rootCauseOf,
  toolCallsOfEvents,
  toolCallsOfTrace,
  waterfallRows,
} from "./action-trace";

const span = (fields: Parameters<typeof loggedEvent>[0]) => loggedEvent(fields);
const TRACE = "0af7651916cd43dd8448eb211c80319c";

describe("the waterfall", () => {
  it("draws a backlog sync that failed at the broker in four levels, the three broker requests failed", () => {
    const trace = rateLimitedBacklogSync();
    const rows = waterfallRows(trace);

    expect(rows.map((row) => [row.event.name, row.depth, row.lane])).toEqual([
      ["backlog.sync", 0, "renderer"],
      ["backlog.sync", 1, "api"],
      ["backlog.sync", 2, "plugin"],
      ["plugin.request", 3, "broker"],
      ["plugin.request", 3, "broker"],
      ["plugin.request", 3, "broker"],
    ]);
    expect(new Set(rows.map((row) => row.depth)).size).toBe(4);
    const broker = rows.filter((row) => row.lane === "broker");
    expect(broker.map((row) => row.failed)).toEqual([true, true, true]);
    // Retries are bars of their own, each where it started.
    expect(broker.map((row) => row.offset)).toEqual([
      100 / 1500,
      600 / 1500,
      1200 / 1500,
    ]);
    expect(rootCauseOf(trace)!.event).toBe(broker[0]!.event);
  });

  it("places each bar by its start and length within the whole trace", () => {
    const [root, child] = waterfallRows(
      traceOf(TRACE, [
        span({
          name: "a",
          trace_id: TRACE,
          span_id: "1",
          at: 0,
          duration_ms: 200,
        }),
        span({
          name: "b",
          trace_id: TRACE,
          span_id: "2",
          parent_span_id: "1",
          at: 50,
          duration_ms: 100,
        }),
      ]),
    );

    expect([root!.offset, root!.width]).toEqual([0, 1]);
    expect([child!.offset, child!.width]).toEqual([0.25, 0.5]);
  });

  it("spans a child that ends after its parent, and a trace of instant spans", () => {
    const rows = waterfallRows(
      traceOf(TRACE, [
        span({
          name: "a",
          trace_id: TRACE,
          span_id: "1",
          at: 0,
          duration_ms: 0,
        }),
        span({
          name: "b",
          trace_id: TRACE,
          span_id: "2",
          parent_span_id: "1",
          at: 0,
          duration_ms: 0,
        }),
      ]),
    );
    expect(rows.map((row) => [row.offset, row.width])).toEqual([
      [0, 0],
      [0, 0],
    ]);

    const late = waterfallRows(
      traceOf(TRACE, [
        span({
          name: "a",
          trace_id: TRACE,
          span_id: "1",
          at: 0,
          duration_ms: 100,
        }),
        span({
          name: "b",
          trace_id: TRACE,
          span_id: "2",
          parent_span_id: "1",
          at: 50,
          duration_ms: 150,
        }),
      ]),
    );
    expect(late.map((row) => row.offset + row.width)).toEqual([0.5, 1]);
  });
});

describe("the runtime lanes", () => {
  it.each([
    [
      { runtime: "renderer", kind: "command", name: "time_entry.create" },
      "renderer",
    ],
    [{ runtime: "api", kind: "request", name: "backlog.sync" }, "api"],
    [
      { runtime: "api", kind: "plugin_operation", name: "backlog.sync" },
      "plugin",
    ],
    [{ runtime: "main", kind: "ipc", name: "plugin_renderer.call" }, "plugin"],
    [{ runtime: "api", kind: "job", name: "plugin.request" }, "broker"],
    [{ runtime: "api", kind: "job", name: "plugin.process" }, "broker"],
    [{ runtime: "api", kind: "job", name: "plugin.open" }, "broker"],
    [{ runtime: "main", kind: "ipc", name: "logs.query" }, "main"],
  ] as const)("puts %o in the %s lane", (fields, lane) => {
    expect(laneOf(span({ trace_id: TRACE, span_id: "1", ...fields }))).toBe(
      lane,
    );
  });
});

describe("the root cause", () => {
  it("names the broker and the reason of the deepest failed span, and explains it", () => {
    const cause = rootCauseOf(rateLimitedBacklogSync())!;

    expect(cause.event.span_id).toBe("d000000000000004");
    expect(cause.title).toBe("plugin.request was refused in the broker");
    expect(cause.reason).toBe("rate_limited");
    expect(cause.explanation).toMatch(/broker holds each plugin to a rate/);
  });

  it("explains an error without a reason by its type", () => {
    const cause = rootCauseOf(
      traceOf(TRACE, [
        span({
          name: "time_entry.create",
          runtime: "renderer",
          trace_id: TRACE,
          span_id: "1",
          outcome: "error",
          error: { type: "TypeError" },
        }),
      ]),
    )!;

    expect(cause.title).toBe("time_entry.create failed in the renderer");
    expect(cause.reason).toBeUndefined();
    expect(cause.explanation).toBe("It ended with an error: TypeError.");
  });

  it("is absent from a trace where nothing failed", () => {
    expect(
      rootCauseOf(
        traceOf(TRACE, [span({ name: "a", trace_id: TRACE, span_id: "1" })]),
      ),
    ).toBeNull();
  });
});

describe("an action row", () => {
  it("shows the trigger and surface, the outcome and the duration", () => {
    const row = describeAction(actionOf(rateLimitedBacklogSync()));

    expect(row).toMatchObject({
      name: "backlog.sync",
      detail: "User · button",
      outcome: "Error",
      reason: "plugin_error",
      failed: true,
      durationMs: 1500,
      connectionId: "conn-jira",
      pluginId: "jira",
    });
  });

  it("shows the agent tool in place of the trigger", () => {
    const row = describeAction(
      actionOf(traceOf("5cf92f3577b34da6a3ce929d0e0e4737", agentToolCall())),
    );

    expect(row.detail).toBe("Agent · update_backlog_item");
    expect(row.failed).toBe(false);
    expect(row.connectionId).toBeUndefined();
  });

  it("counts a failed span under a root that ended ok", () => {
    const trace = traceOf(TRACE, [
      span({ name: "a", trace_id: TRACE, span_id: "1" }),
      span({
        name: "b",
        trace_id: TRACE,
        span_id: "2",
        parent_span_id: "1",
        outcome: "timeout",
      }),
    ]);

    expect(describeAction(actionOf(trace))).toMatchObject({
      outcome: "OK",
      failed: true,
    });
  });
});

describe("an agent's tool calls", () => {
  it("lists the tool call of an agent_tool.call trace with the writes it caused", () => {
    const trace = traceOf("5cf92f3577b34da6a3ce929d0e0e4737", agentToolCall());

    const calls = toolCallsOfTrace(trace);
    expect(calls).toEqual([
      expect.objectContaining({
        tool: "update_backlog_item",
        access: "write",
        outcome: "ok",
        durationMs: 120,
        steps: [
          { name: "backlog_item.update", outcome: "ok" },
          { name: "time_entry.create", outcome: "ok" },
        ],
        writeCount: 2,
        undoOffered: true,
      }),
    ]);
    expect(describeToolCallSteps(calls[0]!)).toBe(
      "2 writes recorded · Ran backlog_item.update, time_entry.create · Undo offered",
    );
  });

  it.each([
    [
      "a refused step as refused, not as a write",
      {
        steps: ["backlog_item.update", "time_entry.create"],
        step_failures: [
          {
            name: "time_entry.create",
            outcome: "refused",
            outcome_reason: "locked_week",
          },
        ],
        counts: { store_write_count: 1 },
      },
      "1 write recorded · Ran backlog_item.update · time_entry.create was refused (locked_week) · Undo offered",
    ],
    [
      "the writes counted for the call, not claimed per step, when a step may have written nothing",
      {
        steps: ["backlog_item.update", "backlog_item.update"],
        counts: { store_write_count: 1 },
      },
      "1 write recorded · Ran backlog_item.update, backlog_item.update · Undo offered",
    ],
    [
      "the steps of a call that wrote nothing as having nothing to do",
      { steps: ["time_entry.stop"], counts: {} },
      "No write recorded in this trace · time_entry.stop had nothing to do · Undo offered",
    ],
    [
      "a call that only queued its work, such as a comment, without claiming it wrote nothing",
      { steps: undefined, counts: undefined },
      "No write recorded in this trace · Undo offered",
    ],
  ] as const)("shows %s", (_, fields, text) => {
    const [call, job] = agentToolCall();
    const trace = traceOf(AGENT_TOOL_TRACE, [
      call!,
      { ...job!, ...fields } as LoggedEvent,
    ]);

    expect(describeToolCallSteps(toolCallsOfTrace(trace)[0]!)).toBe(text);
  });

  it("lists none for a trace with no tool call", () => {
    expect(toolCallsOfTrace(rateLimitedBacklogSync())).toEqual([]);
  });

  it("finds an agent run's tool calls by its client among the logged calls, oldest first", () => {
    const calls = toolCallsOfEvents(
      [
        ...agentToolCall("6aa92f3577b34da6a3ce929d0e0e4738", {
          at: 5000,
          tool: "create_time_entry",
        }),
        ...agentToolCall("7bb92f3577b34da6a3ce929d0e0e4739", {
          at: 1000,
          tool: "list_backlog_items",
        }),
        ...agentToolCall("8cc92f3577b34da6a3ce929d0e0e4730", {
          at: 2000,
          clientId: "someone-else",
        }),
      ],
      "client-1",
    );

    expect(calls.map((call) => call.tool)).toEqual([
      "list_backlog_items",
      "create_time_entry",
    ]);
  });
});

describe("durations", () => {
  it.each([
    [0, "0 ms"],
    [0.4, "<1 ms"],
    [245, "245 ms"],
    [1450, "1.45 s"],
    [12_340, "12.3 s"],
    [65_000, "1 min 5 s"],
  ])("reads %d ms as %s", (ms, text) => {
    expect(formatDurationMs(ms)).toBe(text);
  });
});
