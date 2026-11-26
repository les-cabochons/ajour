import { randomUUID } from "node:crypto";
import type { ServerResponse } from "node:http";
import {
  BRIDGE_CALL_TIMEOUT_MS,
  BRIDGE_CLAIMED_CALL_TIMEOUT_MS,
  BRIDGE_TIMEOUT_MESSAGE,
  BRIDGE_UNAVAILABLE_MESSAGE,
  type AgentClientRef,
  type BridgeClaimRefusalReason,
  type BridgeClaimResponse,
  type BridgeToolResult,
} from "../../../packages/shared/agent-tools.ts";

/**
 * The event stream from the local API to the Ajour window. The renderer owns
 * all data, so every data tool runs there: the API sends a `tool-call` event,
 * the renderer posts the result to /api/mcp/bridge/results. One stream is
 * active at a time. A new one, such as after a reload, replaces the old one.
 *
 * A call sent with a claim, such as a draft comment of Deck's chat (#796),
 * runs in the window only once the API grants the window's claim of it
 * (ADR 0024). The API grants it while it still waits for the call and the
 * call's own last check passes, all in one synchronous step, so a call the
 * window hears of late, or after its turn stopped while the stream was
 * down, does nothing. A granted call waits for its answer as long as
 * `BRIDGE_CLAIMED_CALL_TIMEOUT_MS`: the window acts on it at once.
 */

export { BRIDGE_TIMEOUT_MESSAGE, BRIDGE_UNAVAILABLE_MESSAGE };

const DEFAULT_TIMEOUT_MS = BRIDGE_CALL_TIMEOUT_MS;
const KEEP_ALIVE_MS = 25_000;

export class BridgeCallError extends Error {
  readonly reason: "unavailable" | "timeout";
  /** The window had claimed the call, so it may have acted on it. */
  readonly claimed: boolean;

  constructor(
    message: string,
    reason: "unavailable" | "timeout",
    claimed = false,
  ) {
    super(message);
    this.name = "BridgeCallError";
    this.reason = reason;
    this.claimed = claimed;
  }
}

/** A claim's own last check refused it, with a sentence for the agent. */
export interface BridgeClaimRefusal {
  reason: Extract<
    BridgeClaimRefusalReason,
    "chat_turn_ended" | "consent_revoked"
  >;
  message: string;
}

/** What the window must claim before it acts on a call. */
export interface BridgeClaim {
  turnId: string;
  /**
   * The call's last check, synchronous: why the claim is refused, or
   * undefined to grant it. Nothing may await between it and the grant.
   */
  refusal(): BridgeClaimRefusal | undefined;
}

interface PendingCall {
  resolve: (result: BridgeToolResult) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
  claim?: BridgeClaim;
  claimed: boolean;
}

export class McpBridge {
  private stream?: ServerResponse;
  private onStreamCall?: () => void;
  private keepAlive?: NodeJS.Timeout;
  private readonly pending = new Map<string, PendingCall>();
  private readonly timeoutMs: number;
  private readonly onAttach?: () => void;
  private readonly onDetach?: () => void;

  constructor(
    options: {
      timeoutMs?: number;
      onAttach?: () => void;
      onDetach?: () => void;
    } = {},
  ) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.onAttach = options.onAttach;
    this.onDetach = options.onDetach;
  }

  get connected() {
    return this.stream !== undefined && !this.stream.writableEnded;
  }

  /**
   * Makes `response` the renderer's stream. Ends the previous one.
   * `onCall` runs for each tool call the stream carries.
   */
  attach(response: ServerResponse, options: { onCall?: () => void } = {}) {
    this.detach();
    response.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    });
    response.write("retry: 2000\n\n");
    this.stream = response;
    this.onStreamCall = options.onCall;
    this.keepAlive = setInterval(() => {
      response.write(": keep-alive\n\n");
    }, KEEP_ALIVE_MS);
    this.keepAlive.unref();
    response.on("close", () => {
      if (this.stream === response) this.clearStream();
    });
    this.onAttach?.();
  }

  /**
   * Runs a data tool in the renderer. Rejects with a `BridgeCallError`.
   * `traceparent` is the tool call's span, which the renderer's run joins.
   */
  call(
    tool: string,
    input: unknown,
    client: AgentClientRef,
    traceparent?: string,
    /** Set when the window must claim the call before it acts. */
    claim?: BridgeClaim,
  ): Promise<BridgeToolResult> {
    if (!this.connected) {
      return Promise.reject(
        new BridgeCallError(BRIDGE_UNAVAILABLE_MESSAGE, "unavailable"),
      );
    }

    const requestId = randomUUID();
    return new Promise((resolve, reject) => {
      this.pending.set(requestId, {
        resolve,
        reject,
        timer: this.timeOut(requestId, this.timeoutMs),
        ...(claim ? { claim } : {}),
        claimed: false,
      });
      this.send("tool-call", {
        requestId,
        tool,
        input,
        client,
        ...(traceparent ? { traceparent } : {}),
        ...(claim ? { claim: { turnId: claim.turnId } } : {}),
      });
      this.onStreamCall?.();
    });
  }

  /**
   * Grants the window's claim of a call sent with one, or refuses it. A
   * refusal by the call's own last check answers the call with its
   * sentence; the others leave it as it was.
   */
  claim(requestId: string, turnId: string): BridgeClaimResponse {
    const pending = this.pending.get(requestId);
    if (!pending) return { granted: false, reason: "call_not_waiting" };
    // A call sent without a claim is of no turn, so no claim matches it.
    if (pending.claim?.turnId !== turnId) {
      return { granted: false, reason: "claim_turn_mismatch" };
    }
    if (pending.claimed) {
      return { granted: false, reason: "call_already_claimed" };
    }
    const refusal = pending.claim.refusal();
    if (refusal) {
      this.resolve({ requestId, ok: false, error: refusal.message });
      return { granted: false, reason: refusal.reason };
    }
    pending.claimed = true;
    clearTimeout(pending.timer);
    pending.timer = this.timeOut(requestId, BRIDGE_CLAIMED_CALL_TIMEOUT_MS);
    return { granted: true };
  }

  /** Settles a pending call. False when it already timed out. */
  resolve(result: BridgeToolResult) {
    const pending = this.pending.get(result.requestId);
    if (!pending) return false;
    clearTimeout(pending.timer);
    this.pending.delete(result.requestId);
    pending.resolve(result);
    return true;
  }

  /** Sends a named event, such as the agents snapshot, when a renderer listens. */
  publish(event: string, data: unknown) {
    if (this.connected) this.send(event, data);
  }

  /** Ends the stream and fails pending calls, when the API stops. */
  close() {
    this.detach();
    this.failPendingCalls();
  }

  /**
   * Fails the tool calls the window hasn't answered, when MCP turns off. The
   * stream stays: it also carries handoffs and agent turns, which need no MCP.
   * A call the window claimed keeps waiting: the window is acting on it.
   */
  failPendingCalls() {
    for (const [requestId, pending] of this.pending) {
      if (pending.claimed) continue;
      clearTimeout(pending.timer);
      this.pending.delete(requestId);
      pending.reject(
        new BridgeCallError(BRIDGE_UNAVAILABLE_MESSAGE, "unavailable"),
      );
    }
  }

  private timeOut(requestId: string, ms: number) {
    return setTimeout(() => {
      const pending = this.pending.get(requestId);
      this.pending.delete(requestId);
      pending?.reject(
        new BridgeCallError(BRIDGE_TIMEOUT_MESSAGE, "timeout", pending.claimed),
      );
    }, ms);
  }

  private send(event: string, data: unknown) {
    this.stream?.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  private detach() {
    const stream = this.stream;
    this.clearStream();
    stream?.end();
  }

  private clearStream() {
    if (this.stream) this.onDetach?.();
    if (this.keepAlive) clearInterval(this.keepAlive);
    this.keepAlive = undefined;
    this.stream = undefined;
    this.onStreamCall = undefined;
  }
}
