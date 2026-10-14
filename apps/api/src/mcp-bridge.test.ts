import type { ServerResponse } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BRIDGE_TIMEOUT_MESSAGE,
  BRIDGE_UNAVAILABLE_MESSAGE,
  McpBridge,
} from "./mcp-bridge.ts";

const client = { id: "c1", name: "Claude Code" };

/** A stand-in for the renderer's event stream response. */
function fakeStream() {
  const written: string[] = [];
  const closeHandlers: (() => void)[] = [];
  const stream = {
    writableEnded: false,
    writeHead: vi.fn(),
    write: vi.fn((chunk: string) => {
      written.push(chunk);
      return true;
    }),
    end: vi.fn(() => {
      stream.writableEnded = true;
    }),
    on: vi.fn((event: string, handler: () => void) => {
      if (event === "close") closeHandlers.push(handler);
      return stream;
    }),
  };
  return {
    response: stream as unknown as ServerResponse,
    stream,
    written,
    requestIds: () =>
      written
        .filter((chunk) => chunk.startsWith("event: tool-call"))
        .map((chunk) => JSON.parse(chunk.split("data: ")[1]!).requestId),
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("McpBridge", () => {
  it("refuses a call while no renderer is attached", async () => {
    const bridge = new McpBridge();
    await expect(bridge.call("list_projects", {}, client)).rejects.toThrow(
      BRIDGE_UNAVAILABLE_MESSAGE,
    );
  });

  it("sends the call on the stream and settles it with the posted result", async () => {
    const bridge = new McpBridge();
    const renderer = fakeStream();
    bridge.attach(renderer.response);

    const pending = bridge.call("list_projects", {}, client);
    const [requestId] = renderer.requestIds();
    expect(
      bridge.resolve({
        requestId: requestId!,
        ok: true,
        output: { projects: [] },
      }),
    ).toBe(true);

    await expect(pending).resolves.toMatchObject({ ok: true });
  });

  it("times a call out when the renderer does not answer", async () => {
    vi.useFakeTimers();
    const bridge = new McpBridge({ timeoutMs: 10_000 });
    bridge.attach(fakeStream().response);

    const pending = bridge.call("list_projects", {}, client);
    const assertion = expect(pending).rejects.toThrow(BRIDGE_TIMEOUT_MESSAGE);
    await vi.advanceTimersByTimeAsync(10_000);
    await assertion;
  });

  it("a second bridge replaces the first", () => {
    const bridge = new McpBridge();
    const first = fakeStream();
    const second = fakeStream();
    bridge.attach(first.response);
    bridge.attach(second.response);

    expect(first.stream.end).toHaveBeenCalled();
    void bridge.call("list_projects", {}, client).catch(() => undefined);
    expect(first.requestIds()).toEqual([]);
    expect(second.requestIds()).toHaveLength(1);
  });
});
