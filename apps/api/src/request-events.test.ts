import os from "node:os";
import path from "node:path";
import { request as httpRequest } from "node:http";
import type { AddressInfo } from "node:net";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import type { AjourEvent } from "../../../packages/wide-events/catalog.ts";
import { createRecordingSink } from "../../../packages/wide-events/sinks.ts";
import { startAppApiServer, stopAppApiServer } from "./server.ts";

const APP_ORIGIN = "http://127.0.0.1:5173";
const running: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const stop of running.splice(0).reverse()) await stop();
});

/** Starts a real API on a free port, with a temporary state file. */
async function startTestApi() {
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
      name: "agent_question.answer",
      outcome: "refused",
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
      http: { status_code: 403 },
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
