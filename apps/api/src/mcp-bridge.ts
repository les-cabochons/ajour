import { randomUUID } from "node:crypto";
import type { ServerResponse } from "node:http";
import type {
  AgentClientRef,
  BridgeToolResult,
} from "../../../packages/shared/agent-tools.ts";

/**
 * The event stream from the local API to the Ajour window. The renderer owns
 * all data, so every data tool runs there: the API sends a `tool-call` event,
 * the renderer posts the result to /api/mcp/bridge/results. One stream is
 * active at a time. A new one, such as after a reload, replaces the old one.
 */

export const BRIDGE_UNAVAILABLE_MESSAGE =
  "Open the Ajour window to use this tool.";
export const BRIDGE_TIMEOUT_MESSAGE = "Ajour did not answer in time.";

const DEFAULT_TIMEOUT_MS = 10_000;
const KEEP_ALIVE_MS = 25_000;

export class BridgeCallError extends Error {
  readonly reason: "unavailable" | "timeout";

  // No parameter property: Node runs the API with type stripping, which
  // rejects that syntax.
  constructor(message: string, reason: "unavailable" | "timeout") {
    super(message);
    this.name = "BridgeCallError";
    this.reason = reason;
  }
}

interface PendingCall {
  resolve: (result: BridgeToolResult) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

export class McpBridge {
  private stream?: ServerResponse;
  private keepAlive?: NodeJS.Timeout;
  private readonly pending = new Map<string, PendingCall>();
  private readonly timeoutMs: number;
  private readonly onAttach?: () => void;

  constructor(options: { timeoutMs?: number; onAttach?: () => void } = {}) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.onAttach = options.onAttach;
  }

  get connected() {
    return this.stream !== undefined && !this.stream.writableEnded;
  }

  /** Makes `response` the renderer's stream. Ends the previous one. */
  attach(response: ServerResponse) {
    this.detach();
    response.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    });
    response.write("retry: 2000\n\n");
    this.stream = response;
    this.keepAlive = setInterval(() => {
      response.write(": keep-alive\n\n");
    }, KEEP_ALIVE_MS);
    this.keepAlive.unref();
    response.on("close", () => {
      if (this.stream === response) this.clearStream();
    });
    this.onAttach?.();
  }

  /** Runs a data tool in the renderer. Rejects with a `BridgeCallError`. */
  call(
    tool: string,
    input: unknown,
    client: AgentClientRef,
  ): Promise<BridgeToolResult> {
    if (!this.connected) {
      return Promise.reject(
        new BridgeCallError(BRIDGE_UNAVAILABLE_MESSAGE, "unavailable"),
      );
    }

    const requestId = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new BridgeCallError(BRIDGE_TIMEOUT_MESSAGE, "timeout"));
      }, this.timeoutMs);
      this.pending.set(requestId, { resolve, reject, timer });
      this.send("tool-call", { requestId, tool, input, client });
    });
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

  /** Ends the stream and fails pending calls, when MCP turns off or the API stops. */
  close() {
    this.detach();
    for (const [requestId, pending] of this.pending) {
      clearTimeout(pending.timer);
      this.pending.delete(requestId);
      pending.reject(
        new BridgeCallError(BRIDGE_UNAVAILABLE_MESSAGE, "unavailable"),
      );
    }
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
    if (this.keepAlive) clearInterval(this.keepAlive);
    this.keepAlive = undefined;
    this.stream = undefined;
  }
}
