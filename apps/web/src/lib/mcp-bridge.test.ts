import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { connectMcpBridge, type McpBridgeStatus } from "./mcp-bridge";

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
  addEventListener() {}
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
    statuses = [];
    FakeEventSource.instances = [];
    vi.stubGlobal("EventSource", FakeEventSource);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
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
});
