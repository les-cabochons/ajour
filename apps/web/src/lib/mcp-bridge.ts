import {
  bridgeToolCallSchema,
  type BridgeToolCall,
  type BridgeToolResult,
} from "@ajour/shared/agent-tools";
import { getAppApiBaseUrl, postMcpBridgeResult } from "@/lib/app-api";

/**
 * The Ajour window's end of the MCP bridge. The local API sends data tool
 * calls on an event stream; this runs them one at a time, in arrival order,
 * and posts each result back. EventSource reconnects on its own after a
 * network error. A refused connection (MCP off) closes it for good.
 */

export type McpBridgeStatus = "connecting" | "connected" | "disconnected";

export interface McpBridgeHandlers {
  runToolCall(
    call: BridgeToolCall,
  ): BridgeToolResult | Promise<BridgeToolResult>;
  onStatus(status: McpBridgeStatus): void;
}

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
    };
  }
}

/** Opens the bridge. Returns a function that closes it. */
export function connectMcpBridge(handlers: McpBridgeHandlers): () => void {
  const source = new EventSource(`${getAppApiBaseUrl()}/api/mcp/bridge`);
  let queue: Promise<void> = Promise.resolve();

  handlers.onStatus("connecting");
  source.onopen = () => handlers.onStatus("connected");
  source.onerror = () =>
    handlers.onStatus(
      source.readyState === EventSource.CLOSED ? "disconnected" : "connecting",
    );
  source.addEventListener("tool-call", (message) => {
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

  return () => {
    source.close();
    handlers.onStatus("disconnected");
  };
}
