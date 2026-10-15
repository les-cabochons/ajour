import {
  agentsSnapshotSchema,
  bridgeToolCallSchema,
  type AgentsSnapshot,
  type BridgeToolCall,
  type BridgeToolResult,
} from "@ajour/shared/agent-tools";
import type { AgentBridgeStatus } from "@/domain/agents/agent-indicator";
import { getAppApiBaseUrl, postMcpBridgeResult } from "@/lib/app-api";

/**
 * The Ajour window's end of the MCP bridge. The local API sends data tool
 * calls on an event stream; this runs them one at a time, in arrival order,
 * and posts each result back. It also hands over the agents snapshot the API
 * publishes.
 *
 * EventSource reconnects on its own after a network error, such as the API
 * process dying. That is `reconnecting`. When the API answers with an error
 * status, EventSource closes for good, so the bridge opens a new stream a few
 * seconds later and reports `disconnected` until it succeeds.
 */

/** The bridge's own statuses. `off` belongs to the MCP setting. */
export type McpBridgeStatus = Exclude<AgentBridgeStatus, "off">;

/** How long to wait before reopening a stream the browser closed for good. */
const REOPEN_DELAY_MS = 3000;

export interface McpBridgeHandlers {
  runToolCall(
    call: BridgeToolCall,
  ): BridgeToolResult | Promise<BridgeToolResult>;
  onStatus(status: McpBridgeStatus): void;
  /** The API's agents snapshot, on attach and after every change. */
  onAgents?(snapshot: AgentsSnapshot): void;
}

/**
 * Runs a tool call. Refusals and invalid input come back as results from the
 * handler. Anything thrown is a bug, so it is marked `failed`.
 */
async function runSafely(
  handlers: McpBridgeHandlers,
  call: BridgeToolCall,
): Promise<BridgeToolResult> {
  try {
    return await handlers.runToolCall(call);
  } catch (error) {
    return {
      requestId: call.requestId,
      ok: false,
      error:
        error instanceof Error ? error.message : "The tool failed in Ajour.",
      failed: true,
    };
  }
}

/** Opens the bridge. Returns a function that closes it. */
export function connectMcpBridge(handlers: McpBridgeHandlers): () => void {
  let source: EventSource | undefined;
  let reopenTimer: ReturnType<typeof setTimeout> | undefined;
  let queue: Promise<void> = Promise.resolve();

  const open = () => {
    const stream = new EventSource(`${getAppApiBaseUrl()}/api/mcp/bridge`);
    source = stream;
    stream.onopen = () => handlers.onStatus("connected");
    stream.onerror = () => {
      if (stream.readyState !== EventSource.CLOSED) {
        handlers.onStatus("reconnecting");
        return;
      }
      handlers.onStatus("disconnected");
      stream.close();
      reopenTimer = setTimeout(open, REOPEN_DELAY_MS);
    };
    stream.addEventListener("agents", (message) => {
      const parsed = agentsSnapshotSchema.safeParse(
        JSON.parse((message as MessageEvent<string>).data),
      );
      if (parsed.success) handlers.onAgents?.(parsed.data);
    });
    stream.addEventListener("tool-call", (message) => {
      const parsed = bridgeToolCallSchema.safeParse(
        JSON.parse((message as MessageEvent<string>).data),
      );
      if (!parsed.success) return;
      queue = queue.then(async () => {
        const result = await runSafely(handlers, parsed.data);
        // A lost post leaves the API to time the call out, which the agent sees.
        await postMcpBridgeResult(result).catch(() => undefined);
      });
    });
  };

  handlers.onStatus("connecting");
  open();

  return () => {
    clearTimeout(reopenTimer);
    source?.close();
    handlers.onStatus("disconnected");
  };
}
