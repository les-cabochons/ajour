import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { request as httpRequest } from "node:http";
import { connect, type AddressInfo } from "node:net";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import type { AjourEvent } from "../../../packages/wide-events/catalog.ts";
import { createRecordingSink } from "../../../packages/wide-events/sinks.ts";
import { startAppApiServer, stopAppApiServer } from "./server.ts";

const APP_ORIGIN = "http://127.0.0.1:5173";
const running: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const stop of running.splice(0).reverse()) await stop();
});

type ApiOptions = Parameters<typeof startAppApiServer>[0] & object;

/**
 * Starts a real API on a free port, with a temporary state file. `setup`
 * writes fixtures into the temporary folder and returns more options.
 */
async function startTestApi(
  setup: (root: string) => Promise<ApiOptions> = async () => ({}),
) {
  const root = await mkdtemp(path.join(os.tmpdir(), "ajour-request-events-"));
  const sink = createRecordingSink<AjourEvent>();
  const server = await startAppApiServer({
    port: 0,
    statePath: path.join(root, "state.json"),
    installedPluginDirectory: path.join(root, "installed"),
    allowDevelopmentPlugins: false,
    projectDataShapePluginDirectories: [],
    allowedOrigins: [APP_ORIGIN],
    eventSink: sink,
    ...(await setup(root)),
  });
  const { port } = server.address() as AddressInfo;
  let stopped = false;
  running.push(async () => {
    if (!stopped) await stopAppApiServer(server);
    await rm(root, { recursive: true, force: true });
  });
  return {
    server,
    port,
    events: sink.events,
    markStopped: () => {
      stopped = true;
    },
  };
}

/** Sends one request with full control over its headers, Host included. */
function send(
  port: number,
  options: {
    method?: string;
    path: string;
    headers?: Record<string, string>;
    body?: string;
  },
) {
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const outgoing = httpRequest(
      {
        host: "127.0.0.1",
        port,
        method: options.method ?? "GET",
        path: options.path,
        headers: options.headers,
      },
      (incoming) => {
        let body = "";
        incoming.setEncoding("utf8");
        incoming.on("data", (chunk: string) => {
          body += chunk;
        });
        incoming.on("end", () =>
          resolve({ status: incoming.statusCode ?? 0, body }),
        );
      },
    );
    outgoing.on("error", reject);
    outgoing.end(options.body);
  });
}

/** The request events, once the one for the last request has been emitted. */
async function requestEvents(events: AjourEvent[], count: number) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const requests = events.filter((event) => event.kind === "request");
    if (requests.length >= count) return requests;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return events.filter((event) => event.kind === "request");
}

describe("local API request events", () => {
  it("names a request from its route, with its pattern, status and sizes", async () => {
    const { port, events } = await startTestApi();

    const response = await send(port, {
      path: "/api/health",
      headers: { Origin: APP_ORIGIN },
    });

    expect(response.status).toBe(200);
    expect(await requestEvents(events, 1)).toEqual([
      expect.objectContaining({
        name: "api.health",
        kind: "request",
        runtime: "api",
        outcome: "ok",
        trigger: "system",
        http: {
          method: "GET",
          route: "/api/health",
          status_code: 200,
          request_bytes: 0,
          response_bytes: Buffer.byteLength(response.body),
          origin: "app",
        },
      }),
    ]);
  });

  it("names a route with parameters by its pattern, never its values", async () => {
    const { port, events } = await startTestApi();
    const body = JSON.stringify({ text: "Ship it" });

    const response = await send(port, {
      method: "POST",
      path: "/api/mcp/questions/question-secret-id/answer",
      headers: { Origin: APP_ORIGIN, "Content-Type": "application/json" },
      body,
    });

    expect(response.status).toBe(409);
    const [event] = await requestEvents(events, 1);
    expect(event).toMatchObject({
      name: "question.answer",
      outcome: "refused",
      outcome_reason: "question_closed",
      http: {
        method: "POST",
        route: "/api/mcp/questions/:questionId/answer",
        status_code: 409,
        request_bytes: Buffer.byteLength(body),
      },
    });
    expect(JSON.stringify(event)).not.toContain("Ship it");
  });

  it("records a request that matches no route as api.request", async () => {
    const { port, events } = await startTestApi();

    const response = await send(port, {
      path: "/api/nothing-here/private-name",
      headers: { Origin: APP_ORIGIN },
    });

    expect(response.status).toBe(404);
    const [event] = await requestEvents(events, 1);
    expect(event).toMatchObject({
      name: "api.request",
      outcome: "refused",
      outcome_reason: "no_route",
      http: { method: "GET", status_code: 404, origin: "app" },
    });
    expect(event?.http?.route).toBeUndefined();
    expect(JSON.stringify(event)).not.toContain("private-name");
  });

  it("records a request refused for its host, before anything else", async () => {
    const { port, events } = await startTestApi();

    const response = await send(port, {
      path: "/mcp/ajour",
      headers: { Host: "attacker.example" },
    });

    expect(response.status).toBe(403);
    const [event] = await requestEvents(events, 1);
    expect(event).toMatchObject({
      name: "api.request",
      outcome: "refused",
      outcome_reason: "host_refused",
      http: {
        status_code: 403,
        origin: "none",
        response_bytes: expect.any(Number),
      },
    });
    expect(JSON.stringify(event)).not.toContain("attacker.example");
  });

  it("records a request refused for its origin", async () => {
    const { port, events } = await startTestApi();

    const response = await send(port, {
      path: "/api/health",
      headers: { Origin: "https://evil.example" },
    });

    expect(response.status).toBe(403);
    const [event] = await requestEvents(events, 1);
    expect(event).toMatchObject({
      name: "api.request",
      outcome: "refused",
      outcome_reason: "origin_refused",
      http: { status_code: 403, origin: "refused" },
    });
    expect(JSON.stringify(event)).not.toContain("evil.example");
  });

  // A real socket can't reach this branch on demand: stopping closes every
  // idle connection at once, so a new request has no connection to arrive
  // on, and gets no answer or event. Only a request a busy connection had
  // already started sees `stopping`, which this hands over directly.
  it("records a request that arrives while the API stops", async () => {
    const { server, events, markStopped } = await startTestApi();
    markStopped();

    const stopping = stopAppApiServer(server);
    const status = await dispatch(server, "/api/health");
    await stopping;

    expect(status).toBe(503);
    const requests = events.filter((event) => event.kind === "request");
    expect(requests).toEqual([
      expect.objectContaining({
        name: "api.request",
        outcome: "refused",
        outcome_reason: "stopping",
        http: expect.objectContaining({ status_code: 503, origin: "none" }),
      }),
    ]);
  });

  it("makes the request a child of the caller's span", async () => {
    const { port, events } = await startTestApi();
    const traceId = "4bf92f3577b34da6a3ce929d0e0e4736";
    const spanId = "00f067aa0ba902b7";

    await send(port, {
      path: "/api/health",
      headers: { traceparent: `00-${traceId}-${spanId}-01` },
    });

    const [event] = await requestEvents(events, 1);
    expect(event).toMatchObject({
      trace_id: traceId,
      parent_span_id: spanId,
      http: { origin: "none" },
    });
    expect(event?.span_id).not.toBe(spanId);
  });

  it("records a body that isn't valid as a refused request, without the body", async () => {
    const { port, events } = await startTestApi();

    const response = await send(port, {
      method: "POST",
      path: "/api/mcp/settings",
      headers: { Origin: APP_ORIGIN, "Content-Type": "application/json" },
      body: '{"enabled": "Lunch with Ana"}',
    });

    expect(response.status).toBe(400);
    const [event] = await requestEvents(events, 1);
    expect(event).toMatchObject({
      name: "mcp.configure",
      outcome: "refused",
      outcome_reason: "invalid_request",
      error: { type: "ZodError" },
    });
    expect(JSON.stringify(event)).not.toContain("Ana");
  });
});

/** Hands the server a request directly, as a connection already open would. */
function dispatch(server: Server, url: string) {
  return new Promise<number>((resolve) => {
    let status = 0;
    const response = {
      statusCode: 200,
      writableEnded: false,
      writableFinished: false,
      headersSent: false,
      setHeader: () => response,
      getHeader: () => undefined,
      once: () => response,
      on: () => response,
      writeHead(statusCode: number) {
        status = statusCode;
        response.statusCode = statusCode;
        response.headersSent = true;
        return response;
      },
      end() {
        response.writableEnded = true;
        response.writableFinished = true;
        setImmediate(() => resolve(status));
        return response;
      },
    };
    server.emit(
      "request",
      {
        method: "GET",
        url,
        headers: { host: "127.0.0.1" },
        async *[Symbol.asyncIterator]() {},
      } as unknown as IncomingMessage,
      response as unknown as ServerResponse,
    );
  });
}

const ICON = "<svg viewBox='0 0 16 16'><path d='M0 0h16v16H0z' /></svg>";
const TOKEN = "tok_request_canary_51c2";

/** A plugin with backlog items (and settle), pull requests and a team. */
const pluginSource = `
export async function validateConnection(config) {
  if (config.token === 'slow') await new Promise((resolve) => setTimeout(resolve, 300));
  return { normalizedConfig: config, connectionSummary: {} };
}
export async function syncConnection(connection) {
  return {
    items: [{
      source: 'jira', connectionId: connection.id,
      connectionLabel: connection.label, tenantLabel: connection.tenantLabel,
      sourceId: 'ENG-1', externalId: 'ENG-1', title: 'Secret roadmap item',
      workItemType: 'Task', depth: 0, selectable: true, childCount: 0,
    }],
    workItemUpdates: [],
  };
}
export async function listSettleStates() {
  return { states: [
    { name: 'Waiting', category: 'In Progress', done: false },
    { name: 'Done', category: 'Done', done: true },
  ] };
}
export async function writeSettle(connection, request) {
  if (request.sourceId === 'FAIL-1') throw new Error('Rejected ' + connection.config.token);
  if (request.sourceId === 'BAD-1') return { priority: 'Secret priority' };
  return { state: request.state };
}
export async function syncPullRequests() {
  return { viewer: { login: 'octocat', isBot: false }, pullRequests: [] };
}
export async function syncTeamProjects(connection, request) {
  if (request.cursor === 'slow') await new Promise((resolve) => setTimeout(resolve, 300));
  return { cursor: 'c2', projects: [], assigned: [] };
}
`;

async function writePlugin(root: string) {
  const directory = path.join(root, "plugins", "jira");
  await mkdir(directory, { recursive: true });
  await writeFile(
    path.join(directory, "plugin.json"),
    JSON.stringify({
      id: "jira",
      version: "1.0.0",
      apiVersion: 3,
      displayName: "Jira",
      description: "Test plugin.",
      iconSvg: ICON,
      entrypoint: "plugin.mjs",
      capabilities: {
        connector: { settle: true },
        codeHost: {},
        team: { apiVersion: 1 },
      },
      connectionFields: [
        { id: "label", label: "Label", type: "text", required: true },
        { id: "tenantLabel", label: "Site", type: "text", required: true },
        {
          id: "token",
          label: "Token",
          type: "password",
          required: true,
          secret: true,
        },
      ],
    }),
  );
  await writeFile(path.join(directory, "plugin.mjs"), pluginSource);
  const schema = path.join(root, "schemas", "workday");
  await mkdir(schema, { recursive: true });
  await writeFile(
    path.join(schema, "plugin.json"),
    JSON.stringify({
      id: "workday",
      version: "1.0.0",
      apiVersion: 1,
      displayName: "Workday",
      description: "Test schema.",
      iconSvg: ICON,
      entrypoint: "plugin.mjs",
      capabilities: {
        projectDataShape: {
          apiVersion: 1,
          datasets: [
            {
              id: "projects",
              displayName: "Projects",
              columns: [
                {
                  key: "project",
                  header: "project",
                  type: "string",
                  required: true,
                },
              ],
            },
          ],
        },
      },
    }),
  );
  await writeFile(
    path.join(schema, "plugin.mjs"),
    "export async function exportProjects(projects) { return { datasets: [{ id: 'projects', rows: projects.map((p) => ({ project: p.name })) }] }; }",
  );
  return {
    developmentPluginDirectories: [directory],
    allowDevelopmentPlugins: true,
    projectDataShapePluginDirectories: [schema],
  };
}

/** Calls a route the way the renderer does, and returns its JSON body. */
async function call(port: number, pathname: string, body?: unknown) {
  const response = await send(port, {
    method: body === undefined ? "GET" : "POST",
    path: pathname,
    headers: { Origin: APP_ORIGIN, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return {
    status: response.status,
    body: response.body ? (JSON.parse(response.body) as any) : undefined,
  };
}

/** The last request event named `name`, once it has been emitted. */
async function lastRequest(events: AjourEvent[], name: string) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const found = events.filter(
      (event) => event.kind === "request" && event.name === name,
    );
    if (found.length > 0) return found[found.length - 1]!;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`No ${name} request event.`);
}

describe("route events", () => {
  async function connectedApi() {
    const api = await startTestApi(writePlugin);
    const saved = await call(api.port, "/api/plugins/jira/connections", {
      values: {
        label: "Work",
        tenantLabel: "Acme",
        autoSync: false,
        autoSyncIntervalMinutes: 15,
        token: TOKEN,
      },
    });
    expect(saved.status).toBe(200);
    return { ...api, connectionId: saved.body.connection.id as string };
  }

  it("records a connection save with its plugin operation as a child span", async () => {
    const { events, connectionId } = await connectedApi();

    const request = await lastRequest(events, "connection.save");
    expect(request).toMatchObject({
      outcome: "ok",
      plugin: { id: "jira" },
      connection: {
        id: connectionId,
        is_new: true,
        field_count: 1,
      },
      http: { route: "/api/plugins/:pluginId/connections", status_code: 200 },
    });
    const operation = events.find(
      (event) =>
        event.kind === "plugin_operation" && event.name === "connection.save",
    );
    expect(operation).toMatchObject({
      trace_id: request.trace_id,
      parent_span_id: request.span_id,
      worker: expect.objectContaining({ method: "validateConnection" }),
    });
    expect(JSON.stringify(events)).not.toContain(TOKEN);
  });

  it("records a backlog sync's counts, never an item's title", async () => {
    const { port, events, connectionId } = await connectedApi();

    await call(port, `/api/plugins/jira/connections/${connectionId}/sync`, {
      trigger: "manual",
      workItems: [],
    });

    expect(await lastRequest(events, "backlog.sync")).toMatchObject({
      outcome: "ok",
      plugin: { id: "jira" },
      connection: { id: connectionId },
      backlog_sync: {
        trigger: "manual",
        mode: "review",
        items_sent: 0,
        items_received: 1,
        staged_count: 1,
        updated_count: 0,
        skipped_count: 0,
        done_count: 0,
      },
    });
    expect(JSON.stringify(events)).not.toContain("Secret roadmap item");
    expect(JSON.stringify(events)).not.toContain("ENG-1");
  });

  it("records a settle's states and writes, and a failed write scrubbed of the token", async () => {
    const { port, events, connectionId } = await connectedApi();
    const base = `/api/plugins/jira/connections/${connectionId}`;

    await call(port, `${base}/settle-states`, { sourceId: "ENG-1" });
    await call(port, `${base}/settle`, { sourceId: "ENG-1", state: "Done" });
    const failed = await call(port, `${base}/settle`, {
      sourceId: "FAIL-1",
      state: "Done",
    });

    expect(failed.status).toBe(502);
    expect(await lastRequest(events, "source_state.list")).toMatchObject({
      outcome: "ok",
      source_state: { count: 2 },
    });
    const writes = events.filter(
      (event) =>
        event.kind === "request" && event.name === "backlog.write_source",
    );
    expect(writes).toEqual([
      expect.objectContaining({
        outcome: "ok",
        source_write: { state_sent: true, priority_sent: false },
      }),
      expect.objectContaining({
        outcome: "error",
        error: expect.objectContaining({ message: "Rejected [secret]" }),
      }),
    ]);
    expect(JSON.stringify(events)).not.toContain(TOKEN);
    expect(JSON.stringify(events)).not.toContain("FAIL-1");
  });

  it("records a plugin result that breaks its contract without what it held", async () => {
    const { port, events, connectionId } = await connectedApi();

    const bad = await call(
      port,
      `/api/plugins/jira/connections/${connectionId}/settle`,
      { sourceId: "BAD-1", state: "Done" },
    );

    expect(bad.status).toBe(502);
    expect(await lastRequest(events, "backlog.write_source")).toMatchObject({
      outcome: "error",
      error: expect.objectContaining({ type: "ZodError" }),
    });
    expect(JSON.stringify(events)).not.toContain("Secret priority");
  });

  it("records a pull request sync and a team sync", async () => {
    const { port, events, connectionId } = await connectedApi();

    await call(
      port,
      `/api/code-hosts/jira/connections/${connectionId}/syncPullRequests`,
      { tracked: [] },
    );
    await call(port, `/api/teams/jira/connections/${connectionId}/sync`, {
      changes: [],
    });

    expect(await lastRequest(events, "pull_request.sync")).toMatchObject({
      outcome: "ok",
      pull_request: { tracked_count: 0, received_count: 0 },
      http: {
        route: "/api/code-hosts/:pluginId/connections/:connectionId/:operation",
      },
    });
    expect(await lastRequest(events, "team.sync")).toMatchObject({
      outcome: "ok",
      team_sync: {
        projects_sent: 0,
        projects_received: 0,
        assigned_count: 0,
        has_more: false,
      },
    });
  });

  it("records a turned-off capability, and the request it then refuses", async () => {
    const { port, events, connectionId } = await connectedApi();

    await call(port, "/api/plugins/jira/activation", {
      enabled: false,
      capability: "codeHost",
    });
    const refused = await call(
      port,
      `/api/code-hosts/jira/connections/${connectionId}/syncPullRequests`,
      { tracked: [] },
    );

    expect(refused.status).toBe(409);
    expect(await lastRequest(events, "plugin.activate")).toMatchObject({
      plugin: { id: "jira" },
      activation: {
        capability: "codeHost",
        enabled: false,
        operations_cancelled: 0,
      },
    });
    expect(await lastRequest(events, "pull_request.sync")).toMatchObject({
      outcome: "refused",
      outcome_reason: "capability_off",
    });
  });

  it("records the plugin system turned off, and a schema export", async () => {
    const { port, events } = await startTestApi(writePlugin);

    await call(port, "/api/project-data-shapes/workday/export", {
      projects: [
        {
          name: "Secret client",
          color: "#123456",
          status: "active",
          tasks: [],
        },
      ],
    });
    await call(port, "/api/plugins/activation", { enabled: false });

    expect(await lastRequest(events, "project.export")).toMatchObject({
      outcome: "ok",
      plugin: { id: "workday" },
      project_data: { project_count: 1, task_count: 0, row_count: 1 },
    });
    expect(await lastRequest(events, "plugin_system.toggle")).toMatchObject({
      activation: { enabled: false, operations_cancelled: 0 },
    });
    expect(JSON.stringify(events)).not.toContain("Secret client");
  });

  it("refuses a schema import whose rows break the definition, without their headings", async () => {
    const { port, events } = await startTestApi(writePlugin);

    const imported = await call(
      port,
      "/api/project-data-shapes/workday/import",
      {
        datasets: [{ id: "projects", rows: [{ "Private heading": "Acme" }] }],
      },
    );

    expect(imported.status).toBe(400);
    expect(imported.body.error).toContain("Private heading");
    expect(await lastRequest(events, "project.import")).toMatchObject({
      outcome: "refused",
      outcome_reason: "invalid_request",
    });
    expect(JSON.stringify(events)).not.toContain("Private heading");
  });

  it("records the bridge stream when it closes, with the calls it carried", async () => {
    const { port, events } = await startTestApi();
    await call(port, "/api/mcp/settings", { enabled: true });
    const controller = new AbortController();
    const stream = await fetch(`http://127.0.0.1:${port}/api/mcp/bridge`, {
      headers: { Origin: APP_ORIGIN },
      signal: controller.signal,
    });
    expect(stream.status).toBe(200);
    expect(events.some((event) => event.name === "mcp_bridge.connection")).toBe(
      false,
    );

    controller.abort();

    expect(await lastRequest(events, "mcp_bridge.connection")).toMatchObject({
      outcome: "ok",
      mcp_bridge: { call_count: 0 },
      http: expect.objectContaining({
        route: "/api/mcp/bridge",
        status_code: 200,
        origin: "app",
        response_bytes: expect.any(Number),
      }),
    });
    // Its first line and the agents snapshot it publishes on attach.
    expect(
      (await lastRequest(events, "mcp_bridge.connection")).http?.response_bytes,
    ).toBeGreaterThan(Buffer.byteLength("retry: 2000\n\n"));
  });
});

describe("request events: boundary and reasons", () => {
  it("counts a chunked request body", async () => {
    const { port, events } = await startTestApi();
    const body = JSON.stringify({ enabled: false });

    await new Promise<void>((resolve, reject) => {
      const outgoing = httpRequest(
        {
          host: "127.0.0.1",
          port,
          method: "POST",
          path: "/api/mcp/settings",
          headers: {
            Origin: APP_ORIGIN,
            "Content-Type": "application/json",
            "Transfer-Encoding": "chunked",
          },
        },
        (incoming) => {
          incoming.resume();
          incoming.on("end", () => resolve());
        },
      );
      outgoing.on("error", reject);
      outgoing.write(body.slice(0, 5));
      outgoing.end(body.slice(5));
    });

    expect(await lastRequest(events, "mcp.configure")).toMatchObject({
      outcome: "ok",
      http: {
        request_bytes: Buffer.byteLength(body),
        response_bytes: expect.any(Number),
      },
    });
  });

  it("ends a request's event once its response has flushed, not when it ends", async () => {
    const { server, events } = await startTestApi();
    const response = Object.assign(new EventEmitter(), {
      statusCode: 200,
      headersSent: false,
      writableEnded: false,
      writableFinished: false,
      destroyed: false,
      setHeader: () => response,
      getHeader: () => undefined,
      writeHead(statusCode: number) {
        response.statusCode = statusCode;
        response.headersSent = true;
        return response;
      },
      end() {
        // Called, but the bytes are still on their way.
        response.writableEnded = true;
        return response;
      },
    });

    server.emit(
      "request",
      {
        method: "GET",
        url: "/api/health",
        headers: { host: "127.0.0.1" },
        async *[Symbol.asyncIterator]() {},
      } as unknown as IncomingMessage,
      response as unknown as ServerResponse,
    );
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(response.writableEnded).toBe(true);
    expect(events.filter((event) => event.kind === "request")).toEqual([]);

    response.writableFinished = true;
    response.emit("finish");

    expect(await lastRequest(events, "api.health")).toMatchObject({
      outcome: "ok",
      http: { status_code: 200 },
    });
  });

  it("refuses a value Ajour checks itself as the caller's mistake, without the message", async () => {
    const { port, events } = await startTestApi();

    const saved = await call(port, "/api/plugins/jira/connections", {
      values: { tenantLabel: "Acme private workspace" },
    });

    expect(saved.status).toBe(400);
    const event = await lastRequest(events, "connection.save");
    expect(event).toMatchObject({
      outcome: "refused",
      outcome_reason: "invalid_request",
      error: { type: "Error", code: "invalid_request" },
    });
    expect(event.error?.message).toBeUndefined();
    expect(JSON.stringify(events)).not.toContain("Acme private");
  });

  it("gives each refusal a route answers with a 4xx its reason", async () => {
    const { port, events } = await startTestApi();

    await call(port, "/api/agents/plugins/nope/settings", { values: {} });
    await call(port, "/api/agent-runs/nope/stop", {});
    await call(port, "/api/mcp/clients/nope/revoke", {});
    await call(port, "/api/code-hosts/jira/connections/c1/rewriteHistory", {});

    expect(
      (await requestEvents(events, 4)).map(
        ({ name, outcome, outcome_reason }) => [name, outcome, outcome_reason],
      ),
    ).toEqual([
      ["agent_task.configure", "refused", "no_agent_task"],
      ["agent_run.stop", "refused", "not_running"],
      ["agent_client.revoke", "refused", "unknown_client"],
      ["api.request", "refused", "unknown_operation"],
    ]);
  });
});

describe("request events: abandoned requests", () => {
  /** Waits until a request event named `name` exists, for slow handlers. */
  async function eventually(events: AjourEvent[], name: string) {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const found = events.find(
        (event) => event.kind === "request" && event.name === name,
      );
      if (found) return found;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(`No ${name} request event.`);
  }

  it("records a request whose client dropped while sending its body as cancelled", async () => {
    const { port, events } = await startTestApi();
    const socket = connect(port, "127.0.0.1");
    await new Promise<void>((resolve) => socket.once("connect", resolve));

    socket.write(
      [
        "POST /api/mcp/settings HTTP/1.1",
        "Host: 127.0.0.1",
        `Origin: ${APP_ORIGIN}`,
        "Content-Type: application/json",
        "Content-Length: 100",
        "",
        '{"enab',
      ].join("\r\n"),
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    socket.destroy();

    const event = await eventually(events, "mcp.configure");
    expect(event).toMatchObject({
      outcome: "cancelled",
      outcome_reason: "client_closed",
    });
    // The body's read failed because the client left: no error of its own.
    expect(event.error).toBeUndefined();
    expect(event.http?.status_code).toBeUndefined();
    expect(event.http?.response_bytes).toBeUndefined();
  });

  it("records a request whose client left during a slow plugin call as cancelled", async () => {
    const api = await startTestApi(writePlugin);
    const saved = await call(api.port, "/api/plugins/jira/connections", {
      values: {
        label: "Work",
        tenantLabel: "Acme",
        autoSync: false,
        autoSyncIntervalMinutes: 15,
        token: TOKEN,
      },
    });
    const connectionId = saved.body.connection.id as string;
    const body = JSON.stringify({ cursor: "slow", changes: [] });

    const outgoing = httpRequest({
      host: "127.0.0.1",
      port: api.port,
      method: "POST",
      path: `/api/teams/jira/connections/${connectionId}/sync`,
      headers: {
        Origin: APP_ORIGIN,
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
      },
    });
    outgoing.on("error", () => undefined);
    outgoing.end(body);
    await new Promise((resolve) => setTimeout(resolve, 80));
    outgoing.destroy();

    const event = await eventually(api.events, "team.sync");
    expect(event).toMatchObject({
      outcome: "cancelled",
      outcome_reason: "client_closed",
      http: { request_bytes: Buffer.byteLength(body) },
    });
    expect(event.error).toBeUndefined();
    expect(event.http?.status_code).toBeUndefined();
    expect(event.http?.response_bytes).toBeUndefined();
  });

  it("keeps the outcome a route recorded after its client left", async () => {
    const api = await startTestApi(async (root) => ({
      ...(await writePlugin(root)),
      pluginRequestTimeoutMs: 150,
    }));
    const saved = await call(api.port, "/api/plugins/jira/connections", {
      values: {
        label: "Work",
        tenantLabel: "Acme",
        autoSync: false,
        autoSyncIntervalMinutes: 15,
        token: TOKEN,
      },
    });
    const connectionId = saved.body.connection.id as string;
    const body = JSON.stringify({ cursor: "slow", changes: [] });

    const outgoing = httpRequest({
      host: "127.0.0.1",
      port: api.port,
      method: "POST",
      path: `/api/teams/jira/connections/${connectionId}/sync`,
      headers: {
        Origin: APP_ORIGIN,
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
      },
    });
    outgoing.on("error", () => undefined);
    outgoing.end(body);
    await new Promise((resolve) => setTimeout(resolve, 50));
    outgoing.destroy();

    // The plugin timed out after the client left: the request says so, as
    // its operation does, still without a status nobody received.
    const event = await eventually(api.events, "team.sync");
    expect(event).toMatchObject({
      outcome: "timeout",
      outcome_reason: "timeout",
      error: expect.objectContaining({ type: "Error" }),
    });
    expect(event.http?.status_code).toBeUndefined();
    const operation = api.events.find(
      (candidate) =>
        candidate.kind === "plugin_operation" && candidate.name === "team.sync",
    );
    expect(operation).toMatchObject({
      outcome: "timeout",
      outcome_reason: "timeout",
    });
  });
});

describe("request events: a plugin operation's reason", () => {
  async function teamApi(pluginRequestTimeoutMs?: number) {
    const api = await startTestApi(async (root) => ({
      ...(await writePlugin(root)),
      ...(pluginRequestTimeoutMs ? { pluginRequestTimeoutMs } : {}),
    }));
    const saved = await call(api.port, "/api/plugins/jira/connections", {
      values: {
        label: "Work",
        tenantLabel: "Acme",
        autoSync: false,
        autoSyncIntervalMinutes: 15,
        token: TOKEN,
      },
    });
    return { ...api, connectionId: saved.body.connection.id as string };
  }

  /** The request event and the plugin operation event named `name`. */
  async function bothHops(events: AjourEvent[], name: string) {
    const request = await lastRequest(events, name);
    const operation = events.find(
      (event) => event.kind === "plugin_operation" && event.name === name,
    );
    return [request, operation].map((event) => [
      event?.outcome,
      event?.outcome_reason,
    ]);
  }

  it("says the plugin's error, as its operation does", async () => {
    const { port, events, connectionId } = await teamApi();

    await call(port, `/api/plugins/jira/connections/${connectionId}/settle`, {
      sourceId: "FAIL-1",
      state: "Done",
    });

    expect(await bothHops(events, "backlog.write_source")).toEqual([
      ["error", "plugin_error"],
      ["error", "plugin_error"],
    ]);
  });

  it("says the timeout, as its operation does", async () => {
    const { port, events, connectionId } = await teamApi(100);

    const timedOut = await call(
      port,
      `/api/teams/jira/connections/${connectionId}/sync`,
      { cursor: "slow", changes: [] },
    );

    expect(timedOut.status).toBe(502);
    expect(await bothHops(events, "team.sync")).toEqual([
      ["timeout", "timeout"],
      ["timeout", "timeout"],
    ]);
  });

  it("says why it was cancelled, as its operation does", async () => {
    const { port, events, connectionId } = await teamApi();

    const syncing = call(
      port,
      `/api/teams/jira/connections/${connectionId}/sync`,
      { cursor: "slow", changes: [] },
    );
    await new Promise((resolve) => setTimeout(resolve, 100));
    await call(port, "/api/plugins/jira/activation", { enabled: false });
    expect((await syncing).status).toBe(502);

    expect(await bothHops(events, "team.sync")).toEqual([
      ["cancelled", "plugin_off"],
      ["cancelled", "plugin_off"],
    ]);
  });
});

describe("request events: what the server does is not a hang-up", () => {
  /** Waits until a request event named `name` exists, for slow handlers. */
  async function eventually(events: AjourEvent[], name: string) {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const found = events.find(
        (event) => event.kind === "request" && event.name === name,
      );
      if (found) return found;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(`No ${name} request event.`);
  }

  it("answers a body over the limit with a 400 on an open connection", async () => {
    const { port, events } = await startTestApi();
    const body = JSON.stringify({ enabled: "a".repeat(17 * 1024 * 1024) });

    const response = await send(port, {
      method: "POST",
      path: "/api/mcp/settings",
      headers: { Origin: APP_ORIGIN, "Content-Type": "application/json" },
      body,
    });

    expect(response.status).toBe(400);
    expect(response.body).toContain("exceeds");
    const event = await eventually(events, "mcp.configure");
    expect(event).toMatchObject({
      outcome: "refused",
      outcome_reason: "invalid_request",
      http: { status_code: 400 },
    });
  });

  it("records a real failure after the client hung up, with its code", async () => {
    let root = "";
    const { port, events } = await startTestApi(async (folder) => {
      root = folder;
      return await writePlugin(folder);
    });
    const body = JSON.stringify({
      values: {
        label: "Work",
        tenantLabel: "Acme",
        autoSync: false,
        autoSyncIntervalMinutes: 15,
        token: "slow",
      },
    });

    // The plugin validates slowly; meanwhile the client hangs up, and the
    // state file becomes a folder, so the save that follows fails.
    const outgoing = httpRequest({
      host: "127.0.0.1",
      port,
      method: "POST",
      path: "/api/plugins/jira/connections",
      headers: {
        Origin: APP_ORIGIN,
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
      },
    });
    outgoing.on("error", () => undefined);
    outgoing.end(body);
    await new Promise((resolve) => setTimeout(resolve, 100));
    outgoing.destroy();
    await mkdir(path.join(root, "state.json"));

    const event = await eventually(events, "connection.save");
    expect(event).toMatchObject({
      outcome: "error",
      error: expect.objectContaining({ code: "EISDIR" }),
    });
    expect(event.http?.status_code).toBeUndefined();
  });
});
