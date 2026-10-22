import type { IncomingMessage, ServerResponse } from "node:http";
import type {
  AjourCatalog,
  HttpMethod,
} from "../../../packages/wide-events/catalog.ts";
import type { Outcome, Unit } from "../../../packages/wide-events/index.ts";
import { withoutContent } from "./event-errors.ts";
import type { ApiEvents } from "./events.ts";
import {
  CALENDAR_EVENTS,
  CODE_HOST_EVENTS,
  COMMENT_EVENTS,
  type RequestEventName,
} from "./operation-events.ts";

export type { RequestEventName };

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
    name: "agent_client.create",
  },
  mcpClientRevoke: {
    method: "POST",
    path: "/api/mcp/clients/:clientId/revoke",
    name: "agent_client.revoke",
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
    name: "question.answer",
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
    name: "source_state.list",
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

/** A body chunk's size in bytes: a string's in its encoding, or a buffer's. */
function chunkBytes(chunk: unknown, encoding: unknown): number {
  if (typeof chunk === "string") {
    return Buffer.byteLength(
      chunk,
      typeof encoding === "string" ? (encoding as BufferEncoding) : "utf8",
    );
  }
  return chunk instanceof Uint8Array ? chunk.byteLength : 0;
}

/**
 * Counts the body bytes the request receives, as Node's parser pushes them
 * into its stream, so reading the body is untouched and a chunked body is
 * counted too. A request with no stream behind it, such as a test's, is
 * counted from its Content-Length.
 */
function countRequestBytes(request: IncomingMessage): () => number | undefined {
  const push = (request as { push?: IncomingMessage["push"] }).push;
  if (typeof push !== "function") {
    const header = Number(request.headers["content-length"]);
    return () => (Number.isInteger(header) && header >= 0 ? header : undefined);
  }
  let bytes = 0;
  request.push = function (chunk: unknown, encoding?: BufferEncoding) {
    bytes += chunkBytes(chunk, encoding);
    return push.call(this, chunk, encoding);
  };
  return () => bytes;
}

/** Counts the body bytes written to the response, by every writer. */
function countResponseBytes(response: ServerResponse): () => number {
  let bytes = 0;
  const { write, end } = response;
  if (typeof write === "function") {
    response.write = function (this: ServerResponse, ...args: unknown[]) {
      bytes += chunkBytes(args[0], args[1]);
      return (write as (...rest: unknown[]) => boolean).apply(this, args);
    } as ServerResponse["write"];
  }
  if (typeof end === "function") {
    response.end = function (this: ServerResponse, ...args: unknown[]) {
      if (typeof args[0] !== "function") bytes += chunkBytes(args[0], args[1]);
      return (end as (...rest: unknown[]) => ServerResponse).apply(this, args);
    } as ServerResponse["end"];
  }
  return () => bytes;
}

/**
 * Resolves once the response has flushed, or its connection closed: `end()`
 * only starts the flush.
 */
function responseDone(response: ServerResponse): Promise<void> {
  if (response.writableFinished || response.destroyed) return Promise.resolve();
  return new Promise((resolve) => {
    response.once("finish", () => resolve());
    response.once("close", () => resolve());
  });
}

/**
 * How a handler that counts outcomes itself, such as MCP's for a batch,
 * ends the request: the seam ends it once, after the status and the sizes.
 */
export interface Settlement {
  outcome: Outcome;
  reason?: string;
}

/**
 * The request seam: one `request` event per HTTP request. It opens before
 * any check, as `api.request`, a child of the caller's span when the request
 * carries a `traceparent`, and `serve` renames it once it knows the route.
 * It ends once `serve` settles and the response has flushed or closed, so a
 * stream such as the MCP bridge ends when it closes. An outcome `serve`
 * didn't record follows the status: a 4xx is `refused`, a 5xx an `error`.
 */
export async function serveWithEvent(
  events: ApiEvents,
  request: IncomingMessage,
  response: ServerResponse,
  options: {
    trigger: "system" | "agent";
    origin: "app" | "none" | "refused";
  },
  serve: (
    unit: Unit<AjourCatalog, "api.request">,
  ) => Promise<Settlement | void>,
): Promise<void> {
  const traceparent = request.headers.traceparent;
  const unit = events.start("api.request", {
    kind: "request",
    trigger: options.trigger,
    ...(typeof traceparent === "string" ? { parent: traceparent } : {}),
  });
  const requestBytes = countRequestBytes(request);
  const responseBytes = countResponseBytes(response);
  unit.set({
    http: { method: httpMethod(request.method), origin: options.origin },
  });
  let settlement: Settlement | void = undefined;
  try {
    settlement = await unit.enter(() => serve(unit));
  } catch (error) {
    unit.fail(withoutContent(error));
  }
  await responseDone(response);
  const status = response.statusCode;
  const received = requestBytes();
  unit.set({
    http: {
      status_code: status,
      ...(received !== undefined ? { request_bytes: received } : {}),
      response_bytes: responseBytes(),
    },
  });
  if (settlement) {
    unit.end(
      settlement.outcome,
      settlement.reason as Parameters<typeof unit.end>[1],
    );
  } else if (unit.outcome === undefined) {
    if (status >= 500) unit.end("error");
    else if (status >= 400) unit.end("refused");
  }
  unit.end();
}
