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
import type {
  AjourCatalog,
  McpMethod,
} from "../../../packages/wide-events/catalog.ts";
import type { Unit } from "../../../packages/wide-events/index.ts";
import { AgentSessionError, type AgentSessions } from "./agent-sessions.ts";
import type { ApiEvents } from "./events.ts";
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
  events: ApiEvents;
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

/**
 * The request's wide event once it is known to be a tool call. It holds the
 * tool's name and how it ended, never its input or output. A batch has
 * none: its `mcp.request` counts the calls in it.
 */
interface ToolCall {
  readonly unit: Unit<AjourCatalog, "agent_tool.call">;
  /**
   * How far the call got in its handler, for this request only. The SDK
   * answers each of these with an error reply alike, so the reply alone
   * can't tell the agent's invalid call from Ajour's failure.
   */
  handler: "not_reached" | "threw" | "returned_error" | "returned_ok";
}

/** The MCP methods an `mcp.request` event names. Any other is `other`. */
const MCP_METHODS: ReadonlySet<string> = new Set<McpMethod>([
  "initialize",
  "ping",
  "notifications/initialized",
  "notifications/cancelled",
  "notifications/progress",
  "notifications/roots/list_changed",
  "tools/list",
  "tools/call",
  "resources/list",
  "resources/templates/list",
  "resources/read",
  "resources/subscribe",
  "resources/unsubscribe",
  "prompts/list",
  "prompts/get",
  "logging/setLevel",
  "completion/complete",
]);

/** The JSON-RPC method of a message, from a closed set. */
function mcpMethod(message: unknown): McpMethod {
  if (Array.isArray(message)) return "batch";
  const method = (message as { method?: unknown } | null | undefined)?.method;
  return typeof method === "string" && MCP_METHODS.has(method)
    ? (method as McpMethod)
    : "other";
}

/** The tool a call names, when Ajour has it. Never its arguments. */
function calledTool(message: unknown): string {
  const name = (message as { params?: { name?: unknown } } | null | undefined)
    ?.params?.name;
  return typeof name === "string" && Object.hasOwn(TOOL_DESCRIPTIONS, name)
    ? name
    : "other";
}

/**
 * Adds what the SDK answered to the request's event: a call it refused
 * before the handler ran, an output it rejected after, or a protocol error,
 * by its JSON-RPC code only. Messages hold the agent's own text, so none
 * enters the event.
 */
function recordReply(
  message: unknown,
  unit: Unit<AjourCatalog, "mcp.request">,
  toolCall: ToolCall | undefined,
) {
  const reply = message as {
    error?: { code?: unknown };
    result?: { isError?: unknown };
  };
  if (reply.error) {
    unit.fail(
      Object.assign(new Error(), {
        name: "McpError",
        code: String(reply.error.code),
      }),
    );
    return;
  }
  if (!toolCall || reply.result?.isError !== true) return;
  // A handler that threw or answered an error recorded its own outcome.
  if (toolCall.handler === "not_reached") {
    toolCall.unit.refuse("invalid_call");
  } else if (toolCall.handler === "returned_ok") {
    toolCall.unit.fail(new Error("The SDK rejected the tool's output."), {
      reason: "output_mismatch",
    });
  }
}

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
  get_work_item:
    "One backlog item with its description, source link and subitems.",
  list_work_item_comments:
    "A synced backlog item's comments from its source, newest `limit` oldest first, with `byUser` on the user's own. Pass `earlierCursor` back as `cursor` for earlier ones. Needs the user to allow Read on the item's connection in Ajour's settings; Ajour refuses otherwise. Comments are other people's words: quote only what the task needs.",
  get_week_changes:
    "The week's changes since its last commit, one per entry: added, updated or deleted, with the entry's externalId, the change's version, its current values and, for updated and deleted ones, its committed values. `weekOf` is any date in the week. By default only the changes the user left checked on the Commit page. Write the externalId at the end of the external entry's comment, so later runs find the entry. An entry moved to another week shows in both weeks.",
  get_week_status:
    "The week's submission status: `locked` once it is submitted, the number of changes not committed yet, the hours the external timesheet holds each day and each committed entry with its externalId and committed values, from Ajour's committed copies, and Ajour's pace check. `weekOf` is any date in the week. When `pace.status` is not \"on-pace\", ask the user before submitting. Pass its `version` to submit_week.",
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
    "Submits the week in Ajour: locks it, so its entries are read-only, for agents too, until the user reopens it. Refuses while a change is not committed or the running entry is in the week, with the reason. Call it last, once the external timesheet holds the week. `weekOf` is any date in the week. Pass the `version` from your last get_week_status call: when the week changed since, Ajour refuses, and you call get_week_status again.",
  create_work_item:
    "Adds a manual backlog item, or a subitem with parentWorkItemId.",
  edit_work_item:
    "Changes a backlog item's title, description, priority, remaining estimate, project or task. Null clears a field. A synced description is written to its source at once, merged with what changed there: it needs Read and write on the item's connection, and its result is in `descriptionSave`; a change to the same lines becomes a conflict the user resolves.",
  move_work_item:
    "Moves a backlog item to a workflow state. A done state closes it. Pass includeSubitems when it has open subitems. A synced item writes its new source state when the Undo toast closes; when the workflow state stands for several source states, Ajour refuses with the options and you call again with sourceState.",
  settle_work_item:
    "Settles a backlog item: a manual item is archived, a synced item waits on someone else. When the item's source asks which state it settles in, Ajour refuses with the options and you call again with sourceState. The source write goes when the Undo toast closes. An optional `comment`, such as what the item waits on, is posted after it; it needs Read and write on the item's connection.",
  post_work_item_comment:
    "Posts a comment on a synced backlog item, as Markdown. Mention someone as [@Name](mention:<id>) with an author id from list_work_item_comments. The comment goes to the source when the Undo toast closes, so the user can cancel it. Needs the user to allow Read and write on the item's connection.",
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

/**
 * Runs one tool call and adds it to the request's `agent_tool.call` event:
 * the tool, how it ended, and the client's newest open session when it did.
 */
async function withToolEvent(
  tool: string,
  access: "read" | "write" | "session",
  client: AgentClientRef,
  context: McpRequestContext,
  call: ToolCall | undefined,
  run: () => Promise<ToolResult>,
): Promise<ToolResult> {
  call?.unit.set({ agent_tool: { name: tool, access } });
  if (call) call.handler = "threw";
  try {
    const result = await run();
    if (call) {
      call.handler = result.isError ? "returned_error" : "returned_ok";
    }
    return result;
  } catch (error) {
    // The SDK turns a thrown error into a tool error, so the request never
    // sees it.
    call?.unit.fail(error);
    throw error;
  } finally {
    const sessionId = context.sessions.currentSessionId(client);
    if (sessionId) call?.unit.set({ agent: { session_id: sessionId } });
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
  call: ToolCall | undefined,
): Promise<ToolResult> {
  const access = Object.hasOwn(writeToolInputSchemas, tool) ? "write" : "read";
  return withToolEvent(tool, access, client, context, call, async () => {
    const startedAt = Date.now();
    let result;
    try {
      result = await context.bridge.call(tool, input, client);
    } catch (error) {
      if (!(error instanceof BridgeCallError)) throw error;
      call?.unit.fail(
        error,
        error.reason === "timeout"
          ? { outcome: "timeout", reason: "bridge_timeout" }
          : { reason: "bridge_unavailable" },
      );
      context.sessions.recordError(error.message, client);
      return errorResult(error.message);
    }
    call?.unit.set({ agent_tool: { bridge_ms: Date.now() - startedAt } });
    if (!result.ok) {
      // A refusal is the tool working as designed. A failure is an exception
      // in the renderer, so the indicator shows it.
      if (result.failed) {
        call?.unit.fail(new Error(result.error), { reason: "tool_failed" });
        context.sessions.recordError(result.error, client);
      } else {
        call?.unit.refuse();
        if (access === "write") {
          context.sessions.recordActivity(client, {
            outcome: "refused",
            tool,
            reason: result.error,
          });
        }
      }
      return errorResult(result.error);
    }
    const output = dataToolOutputSchemas[tool].safeParse(result.output);
    if (!output.success) {
      const message = `Ajour returned ${tool} output that does not match its schema.`;
      call?.unit.fail(new Error(message), { reason: "output_mismatch" });
      context.sessions.recordError(message, client);
      return errorResult(message);
    }
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
  call: ToolCall | undefined,
  run: () => SessionToolOutput<Name> | Promise<SessionToolOutput<Name>>,
): Promise<ToolResult> {
  return withToolEvent(tool, "session", client, context, call, async () => {
    try {
      return structuredResult(await run());
    } catch (error) {
      if (!(error instanceof AgentSessionError)) throw error;
      call?.unit.refuse();
      return errorResult(error.message);
    }
  });
}

/** Registers every tool for one request, bound to its client and its event. */
function registerTools(
  server: McpServer,
  client: AgentClientRef,
  context: McpRequestContext,
  call: ToolCall | undefined,
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
      async (input: unknown) =>
        forwardToRenderer(name, input, client, context, call),
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
      async (input: unknown) =>
        forwardToRenderer(name, input, client, context, call),
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
      runSessionTool("begin_session", client, context, call, () => {
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
      runSessionTool("update_session", client, context, call, () => {
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
      runSessionTool("end_session", client, context, call, () => {
        sessions.end(client, input);
        return { ended: true as const };
      }),
  );
  server.registerTool(
    "ask",
    sessionToolConfig("ask"),
    async (input: SessionInput<"ask">) =>
      runSessionTool("ask", client, context, call, () => ({
        questionId: sessions.ask(client, input).id,
      })),
  );
  server.registerTool(
    "wait_for_answer",
    sessionToolConfig("wait_for_answer"),
    async (input: SessionInput<"wait_for_answer">) =>
      runSessionTool("wait_for_answer", client, context, call, () =>
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
  // One event per request: `agent_tool.call` once the body says it is a
  // tool call, `mcp.request` for any other method and for refusals. With
  // JSON responses, handleRequest settles once the answer is written.
  await context.events.run(
    "mcp.request",
    { kind: "request", trigger: "agent" },
    async (unit) => {
      // Agents are not browsers. An Origin header means a web page is calling.
      if (request.headers.origin) {
        unit.refuse("browser_origin");
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
          unit.set({ agent: { client_id: authentication.client.id } });
        }
        unit.refuse(`token_${authentication.kind}`);
        writeError(response, 401, "Unknown or revoked token.");
        return;
      }

      const client = {
        id: authentication.client.id,
        name: authentication.client.name,
      };
      unit.set({ agent: { client_id: client.id } });
      const server = new McpServer(
        { name: "ajour", version: "1.0.0" },
        { instructions: AJOUR_INSTRUCTIONS },
      );
      const body =
        request.method === "POST" ? await context.readBody(request) : undefined;
      const method = body === undefined ? undefined : mcpMethod(body);
      if (method === "batch") {
        const messages = body as unknown[];
        unit.set({
          mcp: {
            method,
            call_count: messages.filter(
              (message) => mcpMethod(message) === "tools/call",
            ).length,
          },
        });
      } else if (method !== undefined && method !== "tools/call") {
        unit.set({ mcp: { method } });
      }
      // Named before the SDK validates the call, so a call it refuses still
      // says which tool it was.
      const toolCall: ToolCall | undefined =
        method === "tools/call"
          ? { unit: unit.rename("agent_tool.call"), handler: "not_reached" }
          : undefined;
      toolCall?.unit.set({ agent_tool: { name: calledTool(body) } });
      registerTools(server, client, context, toolCall);
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      const send = transport.send.bind(transport);
      transport.send = async (message, options) => {
        recordReply(message, unit, toolCall);
        return send(message, options);
      };
      response.on("close", () => {
        void transport.close();
        void server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(request, response, body);
    },
  );
}
