import type { IncomingMessage, ServerResponse } from "node:http";
import type { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  dataToolOutputSchemas,
  readToolInputSchemas,
  sessionToolInputSchemas,
  sessionToolOutputSchemas,
  writeToolInputSchemas,
  type AgentClientRef,
  type ReadToolName,
  type SessionToolName,
  type SessionToolOutput,
  type WriteToolName,
} from "../../../packages/shared/agent-tools.ts";
import { AgentSessionError, type AgentSessions } from "./agent-sessions.ts";
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
  sessions: AgentSessions;
  /** How long one wait_for_answer call holds. Capped at MAX_WAIT_FOR_ANSWER_MS. */
  waitForAnswerMs: number;
  logEvent: (event: Record<string, unknown>) => void;
  readBody: (request: IncomingMessage) => Promise<unknown>;
}

/** The longest one wait_for_answer call may hold. Agents call it again. */
export const MAX_WAIT_FOR_ANSWER_MS = 50_000;

type SessionInput<Name extends SessionToolName> = z.infer<
  (typeof sessionToolInputSchemas)[Name]
>;

interface ToolResult {
  [key: string]: unknown;
  content: { type: "text"; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

/** The wide event each MCP call logs. Never a tool input or output. */
type McpRequestEvent = {
  event: "mcp.request";
  client_id: string;
  /** The client's newest open session when the call ended. */
  session_id?: string;
  tool: string;
  outcome?: "ok" | "refused" | "error" | BridgeCallError["reason"];
  /** Why an `error` outcome happened, when Ajour knows. */
  error_kind?: "output_mismatch";
  bridge_ms?: number;
  duration_ms?: number;
};

/** What every agent reads first. Spec B's plugins add their own. */
const AJOUR_INSTRUCTIONS = [
  "Ajour is the user's local time tracker: timers, time entries, projects and tasks, and a backlog.",
  "Use the ids that the list tools return. Durations are in minutes unless a field says hours.",
  "A write refused by Ajour returns an error with the reason. Do not retry it unchanged.",
  "A submitted week is read-only: Ajour refuses writes to its entries until the user reopens it.",
].join("\n");

/** Tool descriptions, by tool name. */
const TOOL_DESCRIPTIONS: Record<
  ReadToolName | WriteToolName | SessionToolName,
  string
> = {
  get_running_timer:
    "The running entry, with its project, task, note and counted minutes. `running` is null when nothing runs.",
  list_time_entries:
    "Time entries between two dates (inclusive, at most 62 days), each with its state: saved, committed when the external timesheet holds it as it is, or running when the running entry continues it. The running entry itself is in `running`.",
  list_projects: "Active projects and their active tasks, with their ids.",
  list_work_items:
    "Backlog items. The default `sidebar` filter returns the user's current work list in their order. Filter by workflow state, project or text.",
  get_work_item: "One backlog item with its note, source link and subitems.",
  get_week_changes:
    "The week's changes since its last commit, one per entry: added, updated or deleted, with the entry's externalId, the change's version, its current values and, for updated and deleted ones, its committed values. `weekOf` is any date in the week. By default only the changes the user left checked on the Commit page. Write the externalId at the end of the external entry's comment, so later runs find the entry. An entry moved to another week shows in both weeks.",
  get_week_status:
    "The week's submission status: `locked` once it is submitted, the number of changes not committed yet, the hours the external timesheet holds each day and each committed entry with its externalId and committed values, from Ajour's committed copies, and Ajour's pace check. `weekOf` is any date in the week. When `pace.status` is not \"on-pace\", ask the user before submitting.",
  start_timer:
    "Starts an entry now on a backlog item, or on a project with an optional task. A running entry is saved first, as Switch does in Ajour. Refused when today is in a submitted week.",
  stop_timer: "Stops and saves the running entry.",
  edit_running_entry:
    "Changes the running entry's project, task or note, or corrects its counted minutes. It keeps running.",
  create_entry:
    "Adds a saved entry of `minutes` on a date. Refused on a submitted week.",
  edit_entry:
    "Changes a saved entry. A committed entry then shows as an updated change, as in Ajour. Refused on a submitted week.",
  move_entry: "Moves an entry to another date. Refused on a submitted week.",
  duplicate_entry:
    "Copies an entry, to the same date or another one. Refused on a submitted week.",
  mark_entries_committed:
    "Marks changes as committed once the external timesheet saved them: saves each entry's committed copy, or forgets a deleted entry. Pass each change's entryId and version from get_week_changes. When any change differs from its version, because the user edited, deleted or restored the entry since, Ajour refuses the whole call: call get_week_changes again and apply the current values. A deleted change's ID is accepted once: after its tombstone is cleared, the ID is unknown and the call refuses. Never mark a change you did not apply. Refused on a submitted week.",
  submit_week:
    "Submits the week in Ajour: locks it, so its entries are read-only, for agents too, until the user reopens it. Refuses while a change is not committed or the running entry is in the week, with the reason. Call it last, once the external timesheet holds the week. `weekOf` is any date in the week.",
  create_work_item:
    "Adds a manual backlog item, or a subitem with parentWorkItemId.",
  edit_work_item:
    "Changes a backlog item's title, note, priority, remaining estimate, project or task. Null clears a field.",
  move_work_item:
    "Moves a backlog item to a workflow state. A done state closes it. Pass includeSubitems when it has open subitems. A synced item writes its new source state when the Undo toast closes; when the workflow state stands for several source states, Ajour refuses with the options and you call again with sourceState.",
  settle_work_item:
    "Settles a backlog item: a manual item is archived, a synced item waits on someone else. When the item's source asks which state it settles in, Ajour refuses with the options and you call again with sourceState. The source write goes when the Undo toast closes.",
  unsettle_work_item: "Makes a settled item active again.",
  snooze_work_item:
    "Hides an item from the sidebar until a time (ISO 8601 with offset).",
  unsnooze_work_item: "Ends a snooze now.",
  archive_work_item:
    "Archives a synced item in Ajour and leaves its source unchanged. Settle a manual item instead.",
  restore_work_item: "Restores an archived item.",
  begin_session:
    "Call before any work longer than a minute: a title and your estimate in minutes. Ajour shows it to the user and adds a 25% margin. Send update_session at least every few minutes, extend before the deadline passes, and always call end_session.",
  update_session:
    "A short progress message for the user, with optional extra minutes when you need more time.",
  end_session:
    "Ends the session as done, failed or cancelled, with a one-paragraph summary.",
  ask: "Asks the user a question and returns its id at once. Ask only when you cannot go on otherwise. Offer choices when there are a few clear options. Then call wait_for_answer.",
  wait_for_answer:
    "Waits up to 50 seconds for the answer. Returns `waiting` if there is none yet: call it again. Returns `withdrawn` if the session ended.",
};

/** The text copy of `value` is for clients that ignore structured content. */
function structuredResult(value: Record<string, unknown>): ToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
    structuredContent: value,
  };
}

function errorResult(message: string): ToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

/** Runs one tool call and logs its `mcp.request` event when it ends. */
async function withRequestEvent(
  tool: string,
  client: AgentClientRef,
  context: McpRequestContext,
  run: (event: McpRequestEvent) => Promise<ToolResult>,
): Promise<ToolResult> {
  const startedAt = Date.now();
  const event: McpRequestEvent = {
    event: "mcp.request",
    client_id: client.id,
    tool,
  };
  try {
    return await run(event);
  } catch (error) {
    event.outcome = "error";
    throw error;
  } finally {
    const sessionId = context.sessions.currentSessionId(client);
    if (sessionId) event.session_id = sessionId;
    event.duration_ms = Date.now() - startedAt;
    context.logEvent(event);
  }
}

/**
 * Sends a data tool to the renderer. Its output must match the tool's output
 * schema. A mismatch is a bug in Ajour, so the indicator shows it.
 */
function forwardToRenderer(
  tool: ReadToolName | WriteToolName,
  input: unknown,
  client: AgentClientRef,
  context: McpRequestContext,
): Promise<ToolResult> {
  return withRequestEvent(tool, client, context, async (event) => {
    const startedAt = Date.now();
    let result;
    try {
      result = await context.bridge.call(tool, input, client);
    } catch (error) {
      if (!(error instanceof BridgeCallError)) throw error;
      event.outcome = error.reason;
      context.sessions.recordError(error.message, client);
      return errorResult(error.message);
    }
    event.bridge_ms = Date.now() - startedAt;
    if (!result.ok) {
      // A refusal is the tool working as designed. A failure is an exception
      // in the renderer, so the indicator shows it.
      event.outcome = result.failed ? "error" : "refused";
      if (result.failed) {
        context.sessions.recordError(result.error, client);
      } else if (Object.hasOwn(writeToolInputSchemas, tool)) {
        context.sessions.recordActivity(client, {
          outcome: "refused",
          tool,
          reason: result.error,
        });
      }
      return errorResult(result.error);
    }
    const output = dataToolOutputSchemas[tool].safeParse(result.output);
    if (!output.success) {
      event.outcome = "error";
      event.error_kind = "output_mismatch";
      const message = `Ajour returned ${tool} output that does not match its schema.`;
      context.sessions.recordError(message, client);
      return errorResult(message);
    }
    event.outcome = "ok";
    if (result.activity) {
      context.sessions.recordActivity(client, {
        outcome: "ok",
        tool,
        ...result.activity,
      });
    }
    return structuredResult(output.data);
  });
}

/** Runs a session tool in the API. */
function runSessionTool<Name extends SessionToolName>(
  tool: Name,
  client: AgentClientRef,
  context: McpRequestContext,
  run: () => SessionToolOutput<Name> | Promise<SessionToolOutput<Name>>,
): Promise<ToolResult> {
  return withRequestEvent(tool, client, context, async (event) => {
    try {
      const output = await run();
      event.outcome = "ok";
      return structuredResult(output);
    } catch (error) {
      if (!(error instanceof AgentSessionError)) throw error;
      event.outcome = "refused";
      return errorResult(error.message);
    }
  });
}

/** Registers every tool for one request, bound to its client. */
function registerTools(
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
        outputSchema: dataToolOutputSchemas[name].shape,
      },
      // The SDK has already parsed `input` against this tool's schema. The
      // bridge only forwards it, so `unknown` is enough (and the union of
      // schemas in this loop gives the SDK nothing to infer from).
      async (input: unknown) => forwardToRenderer(name, input, client, context),
    );
  }
  for (const name of Object.keys(writeToolInputSchemas) as WriteToolName[]) {
    server.registerTool(
      name,
      {
        description: TOOL_DESCRIPTIONS[name],
        inputSchema: writeToolInputSchemas[name].shape,
        outputSchema: dataToolOutputSchemas[name].shape,
      },
      async (input: unknown) => forwardToRenderer(name, input, client, context),
    );
  }

  // Session tools run in the API: sessions live here, not in the renderer.
  const { sessions } = context;
  // The SDK has already parsed each input against its schema, but it does not
  // infer the type from `.shape` here, so each handler names it.
  const sessionToolConfig = (name: SessionToolName) => ({
    description: TOOL_DESCRIPTIONS[name],
    inputSchema: sessionToolInputSchemas[name].shape,
    outputSchema: sessionToolOutputSchemas[name].shape,
  });
  server.registerTool(
    "begin_session",
    sessionToolConfig("begin_session"),
    async (input: SessionInput<"begin_session">) =>
      runSessionTool("begin_session", client, context, () => {
        const session = sessions.begin(client, input);
        return {
          sessionId: session.id,
          deadline: new Date(session.deadlineAt!).toISOString(),
        };
      }),
  );
  server.registerTool(
    "update_session",
    sessionToolConfig("update_session"),
    async (input: SessionInput<"update_session">) =>
      runSessionTool("update_session", client, context, () => {
        const session = sessions.update(client, input);
        return {
          state: session.state,
          deadline: session.deadlineAt
            ? new Date(session.deadlineAt).toISOString()
            : null,
        };
      }),
  );
  server.registerTool(
    "end_session",
    sessionToolConfig("end_session"),
    async (input: SessionInput<"end_session">) =>
      runSessionTool("end_session", client, context, () => {
        sessions.end(client, input);
        return { ended: true as const };
      }),
  );
  server.registerTool(
    "ask",
    sessionToolConfig("ask"),
    async (input: SessionInput<"ask">) =>
      runSessionTool("ask", client, context, () => ({
        questionId: sessions.ask(client, input).id,
      })),
  );
  server.registerTool(
    "wait_for_answer",
    sessionToolConfig("wait_for_answer"),
    async (input: SessionInput<"wait_for_answer">) =>
      runSessionTool("wait_for_answer", client, context, () =>
        sessions.waitForAnswer(
          client,
          input.questionId,
          Math.min(context.waitForAnswerMs, MAX_WAIT_FOR_ANSWER_MS),
        ),
      ),
  );
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
  // While MCP is off, every /mcp path is absent, whoever asks.
  if (
    pathname !== "/mcp/ajour" ||
    !(await context.storage.getMcpSettings()).enabled
  ) {
    writeError(response, 404, "Not found.");
    return;
  }
  // Agents are not browsers. An Origin header means a web page is calling.
  if (request.headers.origin) {
    context.logEvent({ event: "mcp.request", outcome: "browser_refused" });
    writeError(response, 403, "MCP does not accept browser requests.");
    return;
  }

  const authentication = await authenticateMcpRequest(
    context.storage,
    request.headers.authorization,
  );
  if (authentication.kind !== "ok") {
    if (authentication.kind === "revoked") {
      context.sessions.recordError(
        `${authentication.client.name}: its token was revoked.`,
        { id: authentication.client.id, name: authentication.client.name },
      );
    }
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
