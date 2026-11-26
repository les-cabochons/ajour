import type { ServerResponse } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BRIDGE_TIMEOUT_MESSAGE,
  BRIDGE_UNAVAILABLE_MESSAGE,
  McpBridge,
} from "./mcp-bridge.ts";
import { BRIDGE_CLAIMED_CALL_TIMEOUT_MS } from "../../../packages/shared/agent-tools.ts";

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
    disconnect: () => closeHandlers.forEach((handler) => handler()),
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

it("reports detach once on disconnect, replacement and shutdown", () => {
  const detached = vi.fn();
  const bridge = new McpBridge({ onDetach: detached });
  const first = fakeStream();
  bridge.attach(first.response);
  first.disconnect();
  expect(detached).toHaveBeenCalledTimes(1);
  const second = fakeStream();
  bridge.attach(second.response);
  bridge.attach(fakeStream().response);
  expect(detached).toHaveBeenCalledTimes(2);
  second.disconnect();
  expect(detached).toHaveBeenCalledTimes(2);
  bridge.close();
  bridge.close();
  expect(detached).toHaveBeenCalledTimes(3);
});

describe("a claimed call (#796)", () => {
  /** A call the window must claim, with a last check the test controls. */
  function claimable(timeoutMs = 10_000) {
    const bridge = new McpBridge({ timeoutMs });
    const renderer = fakeStream();
    bridge.attach(renderer.response);
    const check = {
      refusal: undefined as
        | { reason: "chat_turn_ended" | "consent_revoked"; message: string }
        | undefined,
    };
    const pending = bridge.call(
      "deck_add_draft_comment",
      {},
      client,
      undefined,
      {
        turnId: "turn-1",
        refusal: () => check.refusal,
      },
    );
    pending.catch(() => undefined);
    const [requestId] = renderer.requestIds();
    return { bridge, renderer, check, pending, requestId: requestId! };
  }

  it("tells the window to claim it, with its turn", () => {
    const { renderer } = claimable();
    const sent = renderer.written.find((chunk) =>
      chunk.startsWith("event: tool-call"),
    )!;
    expect(JSON.parse(sent.split("data: ")[1]!)).toMatchObject({
      claim: { turnId: "turn-1" },
    });
  });

  it("refuses a claim once the call timed out, as for a window that heard of it late", async () => {
    vi.useFakeTimers();
    const { bridge, pending, requestId } = claimable();
    const timedOut = expect(pending).rejects.toThrow(BRIDGE_TIMEOUT_MESSAGE);
    await vi.advanceTimersByTimeAsync(10_000);
    await timedOut;

    expect(bridge.claim(requestId, "turn-1")).toEqual({
      granted: false,
      reason: "call_not_waiting",
    });
  });

  it("grants one claim only", () => {
    const { bridge, requestId } = claimable();
    expect(bridge.claim(requestId, "turn-1")).toEqual({ granted: true });
    expect(bridge.claim(requestId, "turn-1")).toEqual({
      granted: false,
      reason: "call_already_claimed",
    });
  });

  it("refuses a claim that names another turn, and a call sent without a claim", () => {
    const { bridge, renderer, requestId } = claimable();
    expect(bridge.claim(requestId, "turn-2")).toEqual({
      granted: false,
      reason: "claim_turn_mismatch",
    });
    void bridge.call("list_projects", {}, client).catch(() => undefined);
    const plain = renderer.requestIds()[1]!;
    expect(bridge.claim(plain, "turn-1")).toEqual({
      granted: false,
      reason: "claim_turn_mismatch",
    });
    // Neither refusal settles the call: the window may still claim it.
    expect(bridge.claim(requestId, "turn-1")).toEqual({ granted: true });
  });

  it("refuses a claim its last check refuses, and answers the call with its sentence", async () => {
    const { bridge, check, pending, requestId } = claimable();
    check.refusal = { reason: "chat_turn_ended", message: "The turn ended." };

    expect(bridge.claim(requestId, "turn-1")).toEqual({
      granted: false,
      reason: "chat_turn_ended",
    });
    await expect(pending).resolves.toEqual({
      requestId,
      ok: false,
      error: "The turn ended.",
    });
    expect(bridge.claim(requestId, "turn-1")).toMatchObject({
      reason: "call_not_waiting",
    });
  });

  it("waits longer for a call it granted, which its own timeout no longer fails", async () => {
    vi.useFakeTimers();
    const { bridge, pending, requestId } = claimable();
    await vi.advanceTimersByTimeAsync(9_000);
    expect(bridge.claim(requestId, "turn-1")).toEqual({ granted: true });
    await vi.advanceTimersByTimeAsync(5_000);

    expect(
      bridge.resolve({ requestId, ok: true, output: { draftId: "d-1" } }),
    ).toBe(true);
    await expect(pending).resolves.toMatchObject({ ok: true });
  });

  it("still gives up on a granted call the window never answers, and says the window had claimed it", async () => {
    vi.useFakeTimers();
    const { bridge, pending, requestId } = claimable();
    bridge.claim(requestId, "turn-1");
    const timedOut = expect(pending).rejects.toMatchObject({
      message: BRIDGE_TIMEOUT_MESSAGE,
      claimed: true,
    });
    await vi.advanceTimersByTimeAsync(BRIDGE_CLAIMED_CALL_TIMEOUT_MS);
    await timedOut;
  });

  it("keeps waiting for a granted call when MCP turns off, and fails the others", async () => {
    const { bridge, pending, requestId } = claimable();
    // A second call of the turn, which the window never claims.
    const unclaimed = bridge.call(
      "deck_add_draft_comment",
      {},
      client,
      undefined,
      { turnId: "turn-1", refusal: () => undefined },
    );
    bridge.claim(requestId, "turn-1");
    bridge.failPendingCalls();

    await expect(unclaimed).rejects.toThrow(BRIDGE_UNAVAILABLE_MESSAGE);
    expect(
      bridge.resolve({ requestId, ok: true, output: { draftId: "d-1" } }),
    ).toBe(true);
    await expect(pending).resolves.toMatchObject({ ok: true });
  });
});
