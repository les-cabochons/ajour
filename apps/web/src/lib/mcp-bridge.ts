import {
  agentTurnEventSchema,
  type AgentTurnEvent,
} from "@ajour/shared/agent-runs";
import {
  DECK_DRAFT_COMMENT_TOOL,
  deckDraftCommentCallSchema,
} from "@ajour/shared/deck";
import { handoffsSnapshotSchema } from "@ajour/shared/handoffs";
import { setHandoffs } from "./handoffs";
import {
  agentsSnapshotSchema,
  bridgeToolCallSchema,
  dataToolOutputSchemas,
  readToolInputSchemas,
  type AgentsSnapshot,
  type BridgeToolCall,
  type BridgeToolResult,
} from "@ajour/shared/agent-tools";
import type { AjourCatalog } from "@ajour/wide-events/catalog.ts";
import type { Unit } from "@ajour/wide-events";
import type { AgentBridgeStatus } from "@/domain/agents/agent-indicator";
import { appApiUrl, postMcpBridgeResult } from "@/lib/app-api";
import { wideEvents } from "@/lib/wide-events";

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
 *
 * Each stream is one `mcp_bridge.connection` job, from open to close, which
 * counts the calls it carried and its own reconnects. Each tool call is one
 * `agent_tool.call` job, a child of the local API's tool call span, so one
 * trace runs from the MCP request to the renderer's run and its writes.
 */

/** The bridge's own statuses. `off` belongs to the MCP setting. */
export type McpBridgeStatus = Exclude<AgentBridgeStatus, "off">;

/** How long to wait before reopening a stream the browser closed for good. */
const REOPEN_DELAY_MS = 3000;

export interface McpBridgeHandlers {
  runToolCall(
    call: BridgeToolCall,
    /** The call's `agent_tool.call` job, for the fields only the tool knows. */
    unit: Unit<AjourCatalog, "agent_tool.call">,
  ): BridgeToolResult | Promise<BridgeToolResult>;
  onStatus(status: McpBridgeStatus): void;
  onStream?(stream: EventSource): void;
  /** The API's agents snapshot, on attach and after every change. */
  onAgents?(snapshot: AgentsSnapshot): void;
  /** A turn's progress, such as an ask's answer streaming in (#791). */
  onAgentTurn?(event: AgentTurnEvent): void;
}

/**
 * Runs a tool call. Refusals and invalid input come back as results from the
 * handler. Anything thrown is a bug, so it is marked `failed`.
 */
async function runSafely(
  handlers: McpBridgeHandlers,
  call: BridgeToolCall,
  unit: Unit<AjourCatalog, "agent_tool.call">,
): Promise<BridgeToolResult> {
  try {
    return await handlers.runToolCall(call, unit);
  } catch (error) {
    unit.fail(error, { reason: "tool_failed" });
    return {
      requestId: call.requestId,
      ok: false,
      error:
        error instanceof Error ? error.message : "The tool failed in Ajour.",
      failed: true,
    };
  }
}

/**
 * The turn a call may act only in: Deck's chat adds a draft comment only
 * while its turn runs (#796). Undefined for a call of no turn.
 */
function turnOfCall(call: BridgeToolCall): string | undefined {
  if (call.tool !== DECK_DRAFT_COMMENT_TOOL) return undefined;
  return deckDraftCommentCallSchema.safeParse(call.input).data?.turnId;
}

/** What a call whose turn ended while it waited in the queue answers. */
const TURN_ENDED =
  "This chat turn ended before Ajour ran the call, so it did nothing. Stop.";

/** Starts a tool call's job as it arrives, so its wait in the queue counts. */
function startToolCall(call: BridgeToolCall) {
  const unit = wideEvents.start("agent_tool.call", {
    kind: "job",
    trigger: "agent",
    // The local API's tool call span, when it sent one.
    ...(call.traceparent ? { parent: call.traceparent } : { detached: true }),
  });
  unit.set({
    agent: { client_id: call.client.id },
    agent_tool: {
      // One of Ajour's tools, never a name the agent made up.
      name: Object.hasOwn(dataToolOutputSchemas, call.tool)
        ? call.tool
        : "other",
      access: Object.hasOwn(readToolInputSchemas, call.tool) ? "read" : "write",
    },
  });
  return unit;
}

/**
 * Runs a tool call in its job, posts its result, and ends the job once. A
 * call whose turn ended while it waited runs no more and is refused.
 */
async function runToolCall(
  handlers: McpBridgeHandlers,
  call: BridgeToolCall,
  unit: Unit<AjourCatalog, "agent_tool.call">,
  queuedAt: number,
  turnEnded: () => boolean,
) {
  try {
    unit.set({ agent_tool: { queue_ms: Date.now() - queuedAt } });
    const result: BridgeToolResult = turnEnded()
      ? { requestId: call.requestId, ok: false, error: TURN_ENDED }
      : await unit.enter(() => runSafely(handlers, call, unit));
    // A refusal is the tool working as designed; a failure, recorded above,
    // is a bug.
    if (!result.ok && !result.failed) unit.refuse("tool_refused");
    // A lost post leaves the API to time the call out, which the agent sees.
    await unit.enter(() => postMcpBridgeResult(result)).catch(() => undefined);
  } finally {
    unit.end();
  }
}

/** Opens the bridge. Returns a function that closes it. */
export function connectMcpBridge(
  handlers: McpBridgeHandlers,
  endpoint = "/api/mcp/bridge",
): () => void {
  let source: EventSource | undefined;
  let connection: Unit<AjourCatalog, "mcp_bridge.connection"> | undefined;
  let reopenTimer: ReturnType<typeof setTimeout> | undefined;
  let queue: Promise<void> = Promise.resolve();
  /**
   * The queued calls of each turn, whose flag its end sets. The stream
   * sends a turn's call before its end, so a call queued for a turn is one
   * the turn still ran for: the window needs no memory of older turns.
   */
  const queuedByTurn = new Map<string, Set<{ ended: boolean }>>();

  const open = () => {
    const stream = new EventSource(appApiUrl(endpoint));
    const job = wideEvents.start("mcp_bridge.connection", {
      kind: "job",
      trigger: "system",
      detached: true,
    });
    let reconnects = 0;
    let calls = 0;
    source = stream;
    connection = job;
    stream.onopen = () => handlers.onStatus("connected");
    stream.onerror = () => {
      if (stream.readyState !== EventSource.CLOSED) {
        reconnects += 1;
        job.set({ mcp_bridge: { reconnect_count: reconnects } });
        handlers.onStatus("reconnecting");
        return;
      }
      handlers.onStatus("disconnected");
      stream.close();
      job.end("error", "disconnected");
      reopenTimer = setTimeout(open, REOPEN_DELAY_MS);
    };
    handlers.onStream?.(stream);
    stream.addEventListener("handoffs", (message) => {
      try {
        const parsed = handoffsSnapshotSchema.safeParse(
          JSON.parse((message as MessageEvent<string>).data),
        );
        if (parsed.success) setHandoffs(parsed.data);
      } catch {
        /* Ignore an invalid snapshot. */
      }
    });
    stream.addEventListener("agents", (message) => {
      const parsed = agentsSnapshotSchema.safeParse(
        JSON.parse((message as MessageEvent<string>).data),
      );
      if (parsed.success) handlers.onAgents?.(parsed.data);
    });
    stream.addEventListener("agent-turn", (message) => {
      try {
        const parsed = agentTurnEventSchema.safeParse(
          JSON.parse((message as MessageEvent<string>).data),
        );
        if (!parsed.success) return;
        if (parsed.data.type === "ended") {
          const queued = queuedByTurn.get(parsed.data.turnId);
          queuedByTurn.delete(parsed.data.turnId);
          queued?.forEach((call) => (call.ended = true));
        }
        handlers.onAgentTurn?.(parsed.data);
      } catch {
        /* Ignore an invalid event. */
      }
    });
    stream.addEventListener("tool-call", (message) => {
      const parsed = bridgeToolCallSchema.safeParse(
        JSON.parse((message as MessageEvent<string>).data),
      );
      if (!parsed.success) return;
      calls += 1;
      job.set({ mcp_bridge: { call_count: calls } });
      const unit = startToolCall(parsed.data);
      const queuedAt = Date.now();
      const turnId = turnOfCall(parsed.data);
      const waiting = { ended: false };
      if (turnId !== undefined) {
        const queued = queuedByTurn.get(turnId) ?? new Set();
        queued.add(waiting);
        queuedByTurn.set(turnId, queued);
      }
      queue = queue.then(() => {
        if (turnId !== undefined) {
          const queued = queuedByTurn.get(turnId);
          queued?.delete(waiting);
          if (queued?.size === 0) queuedByTurn.delete(turnId);
        }
        return runToolCall(
          handlers,
          parsed.data,
          unit,
          queuedAt,
          () => waiting.ended,
        );
      });
    });
  };

  handlers.onStatus("connecting");
  open();

  return () => {
    clearTimeout(reopenTimer);
    source?.close();
    connection?.end();
    handlers.onStatus("disconnected");
  };
}
