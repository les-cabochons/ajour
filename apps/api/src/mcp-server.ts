import type { IncomingMessage, ServerResponse } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  readToolInputSchemas,
  type AgentClientRef,
  type ReadToolName,
} from "../../../packages/shared/agent-tools.ts";
import { BridgeCallError, type McpBridge } from "./mcp-bridge.ts";
import { authenticateMcpRequest } from "./mcp-clients.ts";
import type { AppApiStorage } from "./storage.ts";

/**
 * Ajour's MCP endpoint, /mcp/ajour, over Streamable HTTP. Each request gets
 * its own server and transport (stateless mode), bound to the client its
 * token names. Data tools run in the renderer through the bridge.
 */

export interface McpRequestContext {
  storage: AppApiStorage;
  bridge: McpBridge;
  logEvent: (event: Record<string, unknown>) => void;
  readBody: (request: IncomingMessage) => Promise<unknown>;
}

export interface ToolResult {
  [key: string]: unknown;
  content: { type: "text"; text: string }[];
  isError?: boolean;
}

/** What every agent reads first. Spec B's plugins add their own. */
const AJOUR_INSTRUCTIONS = [
  "Ajour is the user's local time tracker: timers, time entries, projects and tasks, and a backlog.",
  "Use the ids that the list tools return. Durations are in minutes unless a field says hours.",
  "A write refused by Ajour returns an error with the reason. Do not retry it unchanged.",
].join("\n");

/** Tool descriptions, by tool name. Later tasks add write and session tools. */
export const TOOL_DESCRIPTIONS: Record<ReadToolName, string> = {
  get_running_timer:
    "The running entry, with its project, task, note and counted minutes. Null when nothing runs.",
  list_time_entries:
    "Time entries between two dates (inclusive, at most 62 days), each with its state: saved or submitted. The running entry is returned separately.",
  list_projects: "Active projects and their active tasks, with their ids.",
  list_work_items:
    "Backlog items. The default `sidebar` filter returns the user's current work list in their order. Filter by workflow state, project or text.",
  get_work_item: "One backlog item with its note, source link and subitems.",
  get_submit_lines:
    "The week's timesheet lines as the Submit page groups them, with hours, merged comments and warnings. `weekOf` is any date in the week.",
};

export function textResult(value: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

export function errorResult(message: string): ToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

/** Sends a data tool to the renderer and logs one `mcp.request` event. */
export async function forwardToRenderer(
  tool: string,
  input: unknown,
  client: AgentClientRef,
  context: McpRequestContext,
): Promise<ToolResult> {
  const startedAt = Date.now();
  // Wide event: one per call. It names the tool but never carries the input.
  const event: Record<string, unknown> = {
    event: "mcp.request",
    client_id: client.id,
    tool,
  };
  try {
    const result = await context.bridge.call(tool, input, client);
    event.bridge_ms = Date.now() - startedAt;
    if (!result.ok) {
      event.outcome = "refused";
      return errorResult(result.error);
    }
    event.outcome = "ok";
    return textResult(result.output);
  } catch (error) {
    if (error instanceof BridgeCallError) {
      event.outcome = error.reason;
      return errorResult(error.message);
    }
    event.outcome = "error";
    throw error;
  } finally {
    event.duration_ms = Date.now() - startedAt;
    context.logEvent(event);
  }
}

/** Registers every tool for one request, bound to its client. */
export function registerTools(
  server: McpServer,
  client: AgentClientRef,
  context: McpRequestContext,
) {
  for (const name of Object.keys(readToolInputSchemas) as ReadToolName[]) {
    server.registerTool(
      name,
      {
        description: TOOL_DESCRIPTIONS[name],
        inputSchema: readToolInputSchemas[name].shape,
      },
      // The SDK has already parsed `input` against this tool's schema. The
      // bridge only forwards it, so `unknown` is enough (and the union of
      // schemas in this loop gives the SDK nothing to infer from).
      async (input: unknown) => forwardToRenderer(name, input, client, context),
    );
  }
}

function writeError(response: ServerResponse, status: number, message: string) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json; charset=utf-8",
  };
  if (status === 401) headers["WWW-Authenticate"] = "Bearer";
  response.writeHead(status, headers);
  response.end(JSON.stringify({ error: message }));
}

export async function handleMcpRequest(
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
  context: McpRequestContext,
) {
  // Agents are not browsers. An Origin header means a web page is calling.
  if (request.headers.origin) {
    context.logEvent({ event: "mcp.request", outcome: "browser_refused" });
    writeError(response, 403, "MCP does not accept browser requests.");
    return;
  }
  if (
    pathname !== "/mcp/ajour" ||
    !(await context.storage.getMcpSettings()).enabled
  ) {
    writeError(response, 404, "Not found.");
    return;
  }

  const authentication = await authenticateMcpRequest(
    context.storage,
    request.headers.authorization,
  );
  if (authentication.kind !== "ok") {
    context.logEvent({
      event: "mcp.request",
      outcome: "unauthorized",
      reason: authentication.kind,
      client_id:
        authentication.kind === "revoked"
          ? authentication.client.id
          : undefined,
    });
    writeError(response, 401, "Unknown or revoked token.");
    return;
  }

  const client = {
    id: authentication.client.id,
    name: authentication.client.name,
  };
  const server = new McpServer(
    { name: "ajour", version: "1.0.0" },
    { instructions: AJOUR_INSTRUCTIONS },
  );
  registerTools(server, client, context);
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  response.on("close", () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport);
  const body =
    request.method === "POST" ? await context.readBody(request) : undefined;
  await transport.handleRequest(request, response, body);
}
