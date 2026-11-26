import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BridgeToolResult } from "@ajour/shared/agent-tools";
import type { AjourEvent } from "@ajour/wide-events/catalog.ts";
import { createRecordingSink } from "@ajour/wide-events/sinks.ts";
import { connectMcpBridge, type McpBridgeStatus } from "./mcp-bridge";
import { replaceEventSink, wideEvents } from "./wide-events";

const { postMcpBridgeResult, postedIn } = vi.hoisted(() => {
  /** The traceparent of the unit active when each result was posted. */
  const postedIn: (string | undefined)[] = [];
  return {
    postedIn,
    postMcpBridgeResult: vi.fn((_result: BridgeToolResult) => {
      postedIn.push(wideEvents.current()?.traceparent());
      return Promise.resolve({ ok: true });
    }),
  };
});
vi.mock("@/lib/app-api", () => ({
  // Where the window calls /api, which may differ from where the API listens.
  appApiUrl: (path: string) => `http://window-requests.test${path}`,
  postMcpBridgeResult,
}));

/** An EventSource the test drives by hand. */
class FakeEventSource {
  static instances: FakeEventSource[] = [];
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;
  readyState = FakeEventSource.CONNECTING;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  close = vi.fn(() => {
    this.readyState = FakeEventSource.CLOSED;
  });
  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }
  listeners = new Map<string, (message: { data: string }) => void>();
  addEventListener(
    name: string,
    listener: (message: { data: string }) => void,
  ) {
    this.listeners.set(name, listener);
  }
  /** The API sends a tool call. */
  sendToolCall(call: object) {
    this.listeners.get("tool-call")?.({ data: JSON.stringify(call) });
  }
  /** The API sends an event of a turn. */
  sendTurnEvent(event: object) {
    this.listeners.get("agent-turn")?.({ data: JSON.stringify(event) });
  }
  open() {
    this.readyState = FakeEventSource.OPEN;
    this.onopen?.();
  }
  /** The browser is retrying by itself. */
  failAndRetry() {
    this.readyState = FakeEventSource.CONNECTING;
    this.onerror?.();
  }
  /** The browser gave up, as after a non-2xx answer. */
  failForGood() {
    this.readyState = FakeEventSource.CLOSED;
    this.onerror?.();
  }
}

describe("MCP bridge connection", () => {
  let statuses: McpBridgeStatus[];
  const connect = () =>
    connectMcpBridge({
      runToolCall: () => ({ requestId: "r", ok: true, output: null }),
      onStatus: (status) => statuses.push(status),
    });

  beforeEach(() => {
    vi.useFakeTimers();
    postMcpBridgeResult.mockClear();
    statuses = [];
    FakeEventSource.instances = [];
    vi.stubGlobal("EventSource", FakeEventSource);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("opens the stream where the window sends its /api requests", () => {
    connect();
    expect(FakeEventSource.instances[0]!.url).toBe(
      "http://window-requests.test/api/mcp/bridge",
    );
  });

  it("reports reconnecting, apart from the first connecting, after the stream errors", () => {
    connect();
    FakeEventSource.instances[0]!.open();
    FakeEventSource.instances[0]!.failAndRetry();
    expect(statuses).toEqual(["connecting", "connected", "reconnecting"]);
  });

  it("opens a new stream a few seconds after the browser gave up", () => {
    connect();
    FakeEventSource.instances[0]!.open();
    FakeEventSource.instances[0]!.failForGood();
    expect(statuses.at(-1)).toBe("disconnected");
    expect(FakeEventSource.instances).toHaveLength(1);

    vi.advanceTimersByTime(5000);
    expect(FakeEventSource.instances).toHaveLength(2);
    FakeEventSource.instances[1]!.open();
    expect(statuses.at(-1)).toBe("connected");
  });

  it("stops retrying once closed", () => {
    const close = connect();
    FakeEventSource.instances[0]!.failForGood();
    close();
    vi.advanceTimersByTime(60_000);
    expect(FakeEventSource.instances).toHaveLength(1);
  });

  it("posts an exception as a failure and a refusal as a plain refusal", async () => {
    const results = [
      { throws: new Error("Boom") },
      { returns: { requestId: "r2", ok: false, error: "Not allowed" } },
    ];
    let next = 0;
    connectMcpBridge({
      runToolCall: () => {
        const step = results[next++]!;
        if (step.throws) throw step.throws;
        return step.returns as BridgeToolResult;
      },
      onStatus: () => undefined,
    });
    const stream = FakeEventSource.instances[0]!;
    const client = { id: "c1", name: "Claude Code" };

    stream.sendToolCall({ requestId: "r1", tool: "list_projects", client });
    stream.sendToolCall({ requestId: "r2", tool: "list_projects", client });
    await vi.waitFor(() =>
      expect(postMcpBridgeResult).toHaveBeenCalledTimes(2),
    );

    expect(postMcpBridgeResult.mock.calls[0]![0]).toEqual({
      requestId: "r1",
      ok: false,
      error: "Boom",
      failed: true,
    });
    expect(postMcpBridgeResult.mock.calls[1]![0]).toEqual({
      requestId: "r2",
      ok: false,
      error: "Not allowed",
    });
  });
});

describe("a draft comment queued behind another call (#796)", () => {
  const client = { id: "c1", name: "Claude Code" };
  const draftCall = (requestId: string, turnId: string) => ({
    requestId,
    tool: "deck_add_draft_comment",
    client,
    input: {
      turnId,
      pluginId: "github",
      connectionId: "gh-1",
      repository: "acme/api",
      number: 7,
      headSha: "a41c9e2f0d",
      anchor: { path: "src/api.ts", side: "head", line: 2 },
      body: "Rename this.",
      lineText: "TWO",
    },
  });

  /** The runner's word on which turn a call acts in. */
  const turnOfCall = (call: { input?: unknown }) =>
    (call.input as { turnId?: string } | undefined)?.turnId;

  beforeEach(() => {
    postMcpBridgeResult.mockClear();
    FakeEventSource.instances = [];
    vi.stubGlobal("EventSource", FakeEventSource);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("runs no more once it waited longer than the local API waits for its answer, though its turn still runs", async () => {
    vi.useFakeTimers();
    const ran: string[] = [];
    const slow = (ms: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, ms));
    connectMcpBridge({
      runToolCall: async (call) => {
        ran.push(call.requestId);
        if (call.requestId === "r1") await slow(6_000);
        if (call.requestId === "r3") await slow(3_000);
        return { requestId: call.requestId, ok: true, output: null };
      },
      onStatus: () => undefined,
      turnOfCall,
    });
    const stream = FakeEventSource.instances[0]!;

    // Behind a call that takes longer than the API's answer is worth.
    stream.sendToolCall({ requestId: "r1", tool: "list_projects", client });
    stream.sendToolCall(draftCall("r2", "turn-1"));
    await vi.advanceTimersByTimeAsync(6_000);
    // Behind one that leaves time.
    stream.sendToolCall({ requestId: "r3", tool: "list_projects", client });
    stream.sendToolCall(draftCall("r4", "turn-1"));
    await vi.advanceTimersByTimeAsync(3_000);
    await vi.waitFor(() =>
      expect(postMcpBridgeResult).toHaveBeenCalledTimes(4),
    );

    expect(ran).toEqual(["r1", "r3", "r4"]);
    expect(postMcpBridgeResult.mock.calls[1]![0]).toEqual({
      requestId: "r2",
      ok: false,
      error: expect.stringContaining("busy"),
    });
  });

  it("runs no more once its turn ends, however many turns come after", async () => {
    let release!: () => void;
    const blocking = new Promise<void>((resolve) => {
      release = resolve;
    });
    const ran: string[] = [];
    const turnEvents: string[] = [];
    connectMcpBridge({
      runToolCall: async (call) => {
        ran.push(call.requestId);
        if (call.requestId === "r1") await blocking;
        return { requestId: call.requestId, ok: true, output: null };
      },
      onStatus: () => undefined,
      onAgentTurn: (event) => turnEvents.push(event.type),
      turnOfCall,
    });
    const stream = FakeEventSource.instances[0]!;

    stream.sendToolCall({ requestId: "r1", tool: "list_projects", client });
    stream.sendToolCall(draftCall("r2", "turn-1"));
    stream.sendToolCall(draftCall("r3", "turn-2"));
    stream.sendTurnEvent({
      type: "ended",
      turnId: "turn-1",
      conversationId: "conversation-1",
      outcome: "cancelled",
    });
    // Newer turns come and go while the call waits.
    for (let turn = 0; turn < 60; turn += 1) {
      stream.sendTurnEvent({
        type: "ended",
        turnId: `later-${turn}`,
        conversationId: "conversation-1",
        outcome: "done",
      });
    }
    release();
    await vi.waitFor(() =>
      expect(postMcpBridgeResult).toHaveBeenCalledTimes(3),
    );

    // The window still hears every event.
    expect(turnEvents).toHaveLength(61);
    expect(ran).toEqual(["r1", "r3"]);
    expect(postMcpBridgeResult.mock.calls[1]![0]).toEqual({
      requestId: "r2",
      ok: false,
      error: expect.stringContaining("ended"),
    });
  });
});

describe("MCP bridge events", () => {
  const TRACE_ID = "4bf92f3577b34da6a3ce929d0e0e4736";
  const SPAN_ID = "00f067aa0ba902b7";
  const client = { id: "c1", name: "Claude Code" };
  let sink: ReturnType<typeof createRecordingSink<AjourEvent>>;
  const named = (name: string) =>
    sink.events.filter((event) => event.name === name);

  beforeEach(() => {
    sink = createRecordingSink<AjourEvent>();
    replaceEventSink(sink);
    postMcpBridgeResult.mockClear();
    postedIn.length = 0;
    FakeEventSource.instances = [];
    vi.stubGlobal("EventSource", FakeEventSource);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("runs a tool call as a job in the local API's trace, and posts its result from it", async () => {
    const ranIn: (string | undefined)[] = [];
    connectMcpBridge({
      runToolCall: (call) => {
        ranIn.push(wideEvents.current()?.name);
        return { requestId: call.requestId, ok: true, output: null };
      },
      onStatus: () => undefined,
    });

    FakeEventSource.instances[0]!.sendToolCall({
      requestId: "r1",
      tool: "list_projects",
      input: { note: "Lunch with Ana" },
      client,
      traceparent: `00-${TRACE_ID}-${SPAN_ID}-01`,
    });
    await vi.waitFor(() => expect(named("agent_tool.call")).toHaveLength(1));

    const [call] = named("agent_tool.call");
    expect(call).toMatchObject({
      kind: "job",
      runtime: "renderer",
      trigger: "agent",
      outcome: "ok",
      trace_id: TRACE_ID,
      parent_span_id: SPAN_ID,
      agent: { client_id: "c1" },
      agent_tool: {
        name: "list_projects",
        access: "read",
        queue_ms: expect.any(Number),
      },
    });
    expect(ranIn).toEqual(["agent_tool.call"]);
    expect(postedIn).toEqual([`00-${TRACE_ID}-${call!.span_id}-01`]);
    expect(JSON.stringify(sink.events)).not.toMatch(/Ana|Claude/);
  });

  it("records a refusal, a failure and a tool Ajour doesn't have, each in its own event", async () => {
    connectMcpBridge({
      runToolCall: (call) => {
        if (call.requestId === "r2") throw new TypeError("Boom");
        return { requestId: call.requestId, ok: false, error: "Not allowed" };
      },
      onStatus: () => undefined,
    });
    const stream = FakeEventSource.instances[0]!;

    stream.sendToolCall({ requestId: "r1", tool: "stop_timer", client });
    stream.sendToolCall({ requestId: "r2", tool: "list_projects", client });
    stream.sendToolCall({ requestId: "r3", tool: "drop_tables", client });
    await vi.waitFor(() => expect(named("agent_tool.call")).toHaveLength(3));

    expect(named("agent_tool.call")).toEqual([
      expect.objectContaining({
        outcome: "refused",
        outcome_reason: "tool_refused",
        agent_tool: expect.objectContaining({
          name: "stop_timer",
          access: "write",
        }),
      }),
      expect.objectContaining({
        outcome: "error",
        outcome_reason: "tool_failed",
        error: { type: "TypeError" },
      }),
      expect.objectContaining({
        outcome: "refused",
        agent_tool: expect.objectContaining({ name: "other" }),
      }),
    ]);
  });

  it("records each stream from open to close, with its calls and reconnects", async () => {
    vi.useFakeTimers();
    const close = connectMcpBridge({
      runToolCall: (call) => ({
        requestId: call.requestId,
        ok: true,
        output: null,
      }),
      onStatus: () => undefined,
    });
    const first = FakeEventSource.instances[0]!;
    first.open();
    first.failAndRetry();
    first.failForGood();
    vi.advanceTimersByTime(5000);
    const second = FakeEventSource.instances[1]!;
    second.open();
    second.failAndRetry();
    second.failAndRetry();
    second.sendToolCall({ requestId: "r1", tool: "list_projects", client });
    await vi.waitFor(() => expect(named("agent_tool.call")).toHaveLength(1));
    close();

    expect(named("mcp_bridge.connection")).toEqual([
      expect.objectContaining({
        kind: "job",
        trigger: "system",
        outcome: "error",
        outcome_reason: "disconnected",
        mcp_bridge: { reconnect_count: 1 },
      }),
      expect.objectContaining({
        outcome: "ok",
        mcp_bridge: { reconnect_count: 2, call_count: 1 },
      }),
    ]);
  });
});
