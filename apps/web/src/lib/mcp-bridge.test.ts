import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BridgeToolResult } from "@ajour/shared/agent-tools";
import { connectMcpBridge, type McpBridgeStatus } from "./mcp-bridge";

const { postMcpBridgeResult } = vi.hoisted(() => ({
  postMcpBridgeResult: vi.fn((_result: BridgeToolResult) =>
    Promise.resolve({ ok: true }),
  ),
}));
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
