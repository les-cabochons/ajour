import type { IncomingMessage, ServerResponse } from "node:http";
import type { BacklogCommentOperation } from "../../../packages/shared/backlog-comments.ts";
import type { CalendarOperation } from "../../../packages/shared/calendar.ts";
import type { CodeHostOperation } from "../../../packages/shared/code-host.ts";
import type {
  AjourCatalog,
  EventName,
  HttpMethod,
  KindOf,
} from "../../../packages/wide-events/catalog.ts";
import type { Unit } from "../../../packages/wide-events/index.ts";
import type { ApiEvents } from "./events.ts";

/** An event the request seam may name a request: one whose kinds include `request`. */
export type RequestEventName = {
  [Name in EventName<AjourCatalog>]: "request" extends KindOf<
    AjourCatalog,
    Name
  >
    ? Name
    : never;
}[EventName<AjourCatalog>];

/** The event each comment operation's request emits. A new operation needs one. */
export const COMMENT_EVENTS = {
  listItemComments: "comment.list",
  postItemComment: "comment.post",
  editItemComment: "comment.edit",
  deleteItemComment: "comment.delete",
  setItemCommentReaction: "comment.react",
  searchItemPeople: "mention.search",
} as const satisfies Record<BacklogCommentOperation, RequestEventName>;

/** The event each calendar operation's request emits. */
export const CALENDAR_EVENTS = {
  listCalendarEvents: "calendar.fetch",
} as const satisfies Record<CalendarOperation, RequestEventName>;

/** The event each code host operation's request emits. */
export const CODE_HOST_EVENTS = {
  syncPullRequests: "pull_request.sync",
  getPullRequestContent: "pull_request.load",
  getFileContent: "pull_request.load_file",
  getPullRequestConversation: "pull_request.load_conversation",
  browsePullRequests: "pull_request.browse",
  submitReview: "pull_request.submit_review",
  postComment: "pull_request.comment",
  replyToThread: "pull_request.reply",
  setThreadResolved: "pull_request.resolve_thread",
  setFileViewed: "pull_request.mark_file_viewed",
  updatePullRequest: "pull_request.update",
  mergePullRequest: "pull_request.merge",
} as const satisfies Record<CodeHostOperation, RequestEventName>;

/** A table that names a route by one of its parameters, such as `:operation`. */
interface NameByParam {
  readonly param: string;
  readonly names: Readonly<Record<string, RequestEventName>>;
}

interface RouteSpec {
  readonly method: "GET" | "POST" | "DELETE";
  /** The route's pattern. `:name` matches one path segment. */
  readonly path: string;
  /**
   * The request event's name. A route that serves several operations names
   * each from a table; an operation the table lacks keeps `api.request`.
   */
  readonly name: RequestEventName | NameByParam;
}

/**
 * Every route of the local API, by ID, in matching order. A route needs a
 * name, and each ID needs a handler in `createAppApiServer`, so a route
 * without a name or a handler fails to compile. MCP's `/mcp/ajour` is
 * served on its own, before the origin check, and named `mcp.request`.
 */
export const ROUTES = {
  health: { method: "GET", path: "/api/health", name: "api.health" },
  agentRunnerStatus: {
    method: "GET",
    path: "/api/agents",
    name: "agent_runner.status",
  },
  agentRunnerConfigure: {
    method: "POST",
    path: "/api/agents/settings",
    name: "agent_runner.configure",
  },
  agentTaskConfigure: {
    method: "POST",
    path: "/api/agents/plugins/:pluginId/settings",
    name: "agent_task.configure",
  },
  agentRunStart: {
    method: "POST",
    path: "/api/agent-runs",
    name: "agent_run.start",
  },
  agentRunStatus: {
    method: "GET",
    path: "/api/agent-runs/current",
    name: "agent_run.status",
  },
  agentRunStop: {
    method: "POST",
    path: "/api/agent-runs/:runId/stop",
    name: "agent_run.stop",
  },
  mcpStatus: { method: "GET", path: "/api/mcp/settings", name: "mcp.status" },
  mcpConfigure: {
    method: "POST",
    path: "/api/mcp/settings",
    name: "mcp.configure",
  },
  mcpClientCreate: {
    method: "POST",
    path: "/api/mcp/clients",
    name: "mcp_client.create",
  },
  mcpClientRevoke: {
    method: "POST",
    path: "/api/mcp/clients/:clientId/revoke",
    name: "mcp_client.revoke",
  },
  mcpBridge: {
    method: "GET",
    path: "/api/mcp/bridge",
    name: "mcp_bridge.connection",
  },
  mcpBridgeResult: {
    method: "POST",
    path: "/api/mcp/bridge/results",
    name: "mcp_bridge.result",
  },
  agentQuestionAnswer: {
    method: "POST",
    path: "/api/mcp/questions/:questionId/answer",
    name: "agent_question.answer",
  },
  agentSessionDismiss: {
    method: "POST",
    path: "/api/mcp/sessions/:sessionId/dismiss",
    name: "agent_session.dismiss",
  },
  agentSessionMarkSeen: {
    method: "POST",
    path: "/api/mcp/seen",
    name: "agent_session.mark_seen",
  },
  pluginOverview: { method: "GET", path: "/api/plugins", name: "plugin.list" },
  pluginManifests: {
    method: "GET",
    path: "/api/plugins/plugins",
    name: "plugin.list",
  },
  pluginSystemToggle: {
    method: "POST",
    path: "/api/plugins/activation",
    name: "plugin_system.toggle",
  },
  schemaList: {
    method: "GET",
    path: "/api/project-data-shapes",
    name: "schema.list",
  },
  projectExport: {
    method: "POST",
    path: "/api/project-data-shapes/:pluginId/export",
    name: "project.export",
  },
  projectImport: {
    method: "POST",
    path: "/api/project-data-shapes/:pluginId/import",
    name: "project.import",
  },
  pluginActivate: {
    method: "POST",
    path: "/api/plugins/:pluginId/activation",
    name: "plugin.activate",
  },
  sourceStateList: {
    method: "GET",
    path: "/api/backlog/source-statuses",
    name: "source_state.list",
  },
  sourceStateUpdate: {
    method: "POST",
    path: "/api/backlog/source-statuses",
    name: "source_state.update",
  },
  connectionSave: {
    method: "POST",
    path: "/api/plugins/:pluginId/connections",
    name: "connection.save",
  },
  connectionDelete: {
    method: "DELETE",
    path: "/api/plugins/:pluginId/connections/:connectionId",
    name: "connection.delete",
  },
  settleStateList: {
    method: "POST",
    path: "/api/plugins/:pluginId/connections/:connectionId/settle-states",
    name: "settle_state.list",
  },
  settleWrite: {
    method: "POST",
    path: "/api/plugins/:pluginId/connections/:connectionId/settle",
    name: "backlog.write_source",
  },
  descriptionRead: {
    method: "POST",
    path: "/api/plugins/:pluginId/connections/:connectionId/description",
    name: "description.read",
  },
  descriptionWrite: {
    method: "POST",
    path: "/api/plugins/:pluginId/connections/:connectionId/description-write",
    name: "description.write",
  },
  backlogSync: {
    method: "POST",
    path: "/api/plugins/:pluginId/connections/:connectionId/sync",
    name: "backlog.sync",
  },
  codeHost: {
    method: "POST",
    path: "/api/code-hosts/:pluginId/connections/:connectionId/:operation",
    name: { param: "operation", names: CODE_HOST_EVENTS },
  },
  backlogComment: {
    method: "POST",
    path: "/api/backlog-comments/:pluginId/connections/:connectionId/:operation",
    name: { param: "operation", names: COMMENT_EVENTS },
  },
  calendar: {
    method: "POST",
    path: "/api/calendars/:pluginId/connections/:connectionId/:operation",
    name: { param: "operation", names: CALENDAR_EVENTS },
  },
  teamCreate: {
    method: "POST",
    path: "/api/teams/:pluginId/create",
    name: "team.create",
  },
  teamSync: {
    method: "POST",
    path: "/api/teams/:pluginId/connections/:connectionId/sync",
    name: "team.sync",
  },
  backlogImportStage: {
    method: "POST",
    path: "/api/backlog/items",
    name: "backlog_import.stage",
  },
  backlogImportList: {
    method: "GET",
    path: "/api/backlog/imports",
    name: "backlog_import.list",
  },
  backlogImportSelect: {
    method: "POST",
    path: "/api/backlog/imports/selection",
    name: "backlog_import.select",
  },
  backlogImportDismiss: {
    method: "POST",
    path: "/api/backlog/imports/dismiss",
    name: "backlog_import.dismiss",
  },
  backlogImportRestore: {
    method: "POST",
    path: "/api/backlog/imports/restore",
    name: "backlog_import.restore",
  },
  backlogImportCommit: {
    method: "POST",
    path: "/api/backlog/imports/commit-selected",
    name: "backlog_import.commit",
  },
} as const satisfies Record<string, RouteSpec>;

export type RouteId = keyof typeof ROUTES;

type ParamNames<Path extends string> =
  Path extends `${string}:${infer Param}/${infer Rest}`
    ? Param | ParamNames<Rest>
    : Path extends `${string}:${infer Param}`
      ? Param
      : never;

/** A route's parameters, decoded, by the names its pattern gives them. */
export type RouteParams<Id extends RouteId> = {
  readonly [Name in ParamNames<(typeof ROUTES)[Id]["path"]>]: string;
};

/** The name a route's request event takes. */
export type RouteEventName<Id extends RouteId> =
  (typeof ROUTES)[Id]["name"] extends infer Name
    ? Name extends RequestEventName
      ? Name
      : Name extends { names: infer Names }
        ? Names[keyof Names] | "api.request"
        : never
    : never;

/** What a route's handler gets: the exchange, its parameters and its event. */
export interface RouteContext<Id extends RouteId> {
  request: IncomingMessage;
  response: ServerResponse;
  url: URL;
  /** The caller's browser origin, already allowed, if it sent one. */
  origin: string | undefined;
  params: RouteParams<Id>;
  unit: Unit<AjourCatalog, RouteEventName<Id>>;
}

/** One handler per route ID: a route without one, or a handler without a route, fails to compile. */
export type RouteHandlers = {
  [Id in RouteId]: (context: RouteContext<Id>) => Promise<void> | void;
};

const COMPILED = Object.entries(ROUTES).map(([id, spec]) => {
  const names: string[] = [];
  const pattern = spec.path.replace(/:([A-Za-z]+)/g, (_, name: string) => {
    names.push(name);
    return "([^/]+)";
  });
  return {
    id: id as RouteId,
    spec: spec as RouteSpec,
    names,
    pattern: new RegExp(`^${pattern}$`),
  };
});

/** A request matched to a route, with its parameters still encoded. */
export interface MatchedRoute {
  id: RouteId;
  path: string;
  /** Undefined when the route names its operations and this one is unknown. */
  name: RequestEventName | undefined;
  rawParams: Record<string, string>;
}

/** The route a method and path reach, in table order, or undefined. */
export function matchRoute(
  method: string | undefined,
  pathname: string,
): MatchedRoute | undefined {
  for (const route of COMPILED) {
    if (route.spec.method !== method) continue;
    const match = route.pattern.exec(pathname);
    if (!match) continue;
    const rawParams: Record<string, string> = {};
    route.names.forEach((name, index) => {
      rawParams[name] = match[index + 1]!;
    });
    const { name } = route.spec;
    return {
      id: route.id,
      path: route.spec.path,
      name:
        typeof name === "string"
          ? name
          : Object.hasOwn(name.names, rawParams[name.param]!)
            ? name.names[rawParams[name.param]!]
            : undefined,
      rawParams,
    };
  }
  return undefined;
}

/** Decodes a route's parameters. Throws a URIError on a malformed one. */
export function decodeParams(
  rawParams: Record<string, string>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(rawParams).map(([name, value]) => [
      name,
      decodeURIComponent(value),
    ]),
  );
}

const HTTP_METHODS: ReadonlySet<string> = new Set<HttpMethod>([
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
]);

function httpMethod(method: string | undefined): HttpMethod {
  return method && HTTP_METHODS.has(method) ? (method as HttpMethod) : "other";
}

/** A header's byte count, when the peer sent or set one. */
function byteCount(value: unknown): number | undefined {
  const count = Number(Array.isArray(value) ? value[0] : value);
  return Number.isInteger(count) && count >= 0 ? count : undefined;
}

/**
 * The request seam: one `request` event per HTTP request. It opens before
 * any check, as `api.request`, a child of the caller's span when the request
 * carries a `traceparent`, and `serve` renames it once it knows the route.
 * It ends once `serve` settles and the response is done, so a stream such as
 * the MCP bridge ends when it closes. An outcome `serve` didn't record
 * follows the status: a 4xx is `refused`, a 5xx an `error`.
 */
export async function serveWithEvent(
  events: ApiEvents,
  request: IncomingMessage,
  response: ServerResponse,
  options: { trigger: "system" | "agent" },
  serve: (unit: Unit<AjourCatalog, "api.request">) => Promise<void>,
): Promise<void> {
  const traceparent = request.headers.traceparent;
  const unit = events.start("api.request", {
    kind: "request",
    trigger: options.trigger,
    ...(typeof traceparent === "string" ? { parent: traceparent } : {}),
  });
  const requestBytes = byteCount(request.headers["content-length"]);
  unit.set({
    http: {
      method: httpMethod(request.method),
      ...(requestBytes !== undefined ? { request_bytes: requestBytes } : {}),
    },
  });
  try {
    await unit.enter(() => serve(unit));
  } catch (error) {
    unit.fail(error);
  }
  const end = () => {
    const status = response.statusCode;
    const responseBytes = byteCount(response.getHeader?.("content-length"));
    unit.set({
      http: {
        status_code: status,
        ...(responseBytes !== undefined
          ? { response_bytes: responseBytes }
          : {}),
      },
    });
    if (unit.outcome === undefined) {
      if (status >= 500) unit.end("error");
      else if (status >= 400) unit.end("refused");
    }
    unit.end();
  };
  if (response.writableEnded || response.destroyed) end();
  else response.once("close", end);
}
