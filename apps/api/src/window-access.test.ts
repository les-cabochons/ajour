import os from "node:os";
import path from "node:path";
import { request as httpRequest } from "node:http";
import { connect, type AddressInfo } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import type { AjourEvent } from "../../../packages/wide-events/catalog.ts";
import { createRecordingSink } from "../../../packages/wide-events/sinks.ts";
import { startAppApiServer, stopAppApiServer } from "./server.ts";
import { WINDOW_TOKEN_HEADER } from "./window-token.ts";

// `/api` is the window's private channel: Electron main, or vite's dev proxy,
// adds the launch's token to every window request. Anything else on the
// computer reaches only /api/health, and agents use /mcp.

const WINDOW_TOKEN = "window-token-for-this-launch-only-0123456789";
const APP_ORIGIN = "app://local";
const running: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const stop of running.splice(0).reverse()) await stop();
});

async function startTestApi(
  options: Partial<Parameters<typeof startAppApiServer>[0]> = {},
) {
  const root = await mkdtemp(path.join(os.tmpdir(), "ajour-window-access-"));
  const sink = createRecordingSink<AjourEvent>();
  const server = await startAppApiServer({
    port: 0,
    statePath: path.join(root, "state.json"),
    installedPluginDirectory: path.join(root, "installed"),
    allowDevelopmentPlugins: false,
    projectDataShapePluginDirectories: [],
    allowedOrigins: [APP_ORIGIN],
    windowToken: WINDOW_TOKEN,
    eventSink: sink,
    ...options,
  });
  running.push(async () => {
    await stopAppApiServer(server);
    await rm(root, { recursive: true, force: true });
  });
  return { port: (server.address() as AddressInfo).port, events: sink.events };
}

/** One request, with full control over its headers, Host included. */
function send(
  port: number,
  options: {
    method?: string;
    path: string;
    headers?: Record<string, string>;
    body?: string;
    /** Sends no Host header at all. */
    withoutHost?: boolean;
  },
) {
  return new Promise<{
    status: number;
    body: string;
    headers: Record<string, unknown>;
  }>((resolve, reject) => {
    const outgoing = httpRequest(
      {
        host: "127.0.0.1",
        port,
        method: options.method ?? "GET",
        path: options.path,
        headers: options.headers,
        setHost: !options.withoutHost,
      },
      (incoming) => {
        let body = "";
        incoming.setEncoding("utf8");
        incoming.on("data", (chunk: string) => {
          body += chunk;
        });
        incoming.on("end", () =>
          resolve({
            status: incoming.statusCode ?? 0,
            body,
            headers: incoming.headers,
          }),
        );
      },
    );
    outgoing.on("error", reject);
    outgoing.end(options.body);
  });
}

/** Writes a raw request on a socket, and resolves with the whole answer. */
function sendHttp10(port: number, raw: string) {
  return new Promise<string>((resolve, reject) => {
    const socket = connect(port, "127.0.0.1", () => socket.write(raw));
    let answer = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => {
      answer += chunk;
    });
    socket.on("end", () => resolve(answer));
    socket.on("error", reject);
  });
}

const windowHeaders = { [WINDOW_TOKEN_HEADER]: WINDOW_TOKEN };

describe("the local API answers only Ajour's window", () => {
  it.each([
    ["GET", "/api/plugins"],
    ["GET", "/api/mcp/settings"],
    ["POST", "/api/mcp/clients"],
    ["GET", "/api/mcp/bridge"],
    ["GET", "/api/no-such-route"],
  ])(
    "refuses %s %s without the token, with a bare 401",
    async (method, url) => {
      const { port } = await startTestApi();

      const response = await send(port, {
        method,
        path: url,
        headers: { "Content-Type": "application/json" },
        body:
          method === "POST" ? JSON.stringify({ name: "Script" }) : undefined,
      });

      expect(response.status).toBe(401);
      expect(response.body).toBe("");
    },
  );

  it("refuses a wrong token, even one of the right length", async () => {
    const { port } = await startTestApi();
    const wrong = WINDOW_TOKEN.replace(/.$/u, "X");

    for (const token of [wrong, "short", `${WINDOW_TOKEN}-longer`]) {
      const response = await send(port, {
        path: "/api/mcp/settings",
        headers: { [WINDOW_TOKEN_HEADER]: token },
      });
      expect(response.status).toBe(401);
      expect(response.body).toBe("");
    }
  });

  it("answers the window, which carries the token", async () => {
    const { port } = await startTestApi();

    const response = await send(port, {
      path: "/api/mcp/settings",
      headers: { ...windowHeaders, Origin: APP_ORIGIN },
    });

    expect(response.status).toBe(200);
    expect(response.headers["access-control-allow-origin"]).toBe(APP_ORIGIN);
  });

  it("keeps the origin allowlist for a request that carries the token", async () => {
    const { port } = await startTestApi();

    const response = await send(port, {
      path: "/api/mcp/settings",
      headers: { ...windowHeaders, Origin: "https://evil.example" },
    });

    expect(response.status).toBe(403);
  });

  it("answers /api/health without the token, with only ok", async () => {
    const { port } = await startTestApi();

    const response = await send(port, { path: "/api/health" });

    expect(response.status).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ ok: true });
  });

  it.each(["/api/health", "/api/mcp/settings", "/mcp/ajour"])(
    "refuses %s without a Host header",
    async (url) => {
      const { port } = await startTestApi();

      // Node's parser refuses an HTTP/1.1 request without Host itself.
      const http11 = await send(port, {
        path: url,
        headers: windowHeaders,
        withoutHost: true,
      });
      // HTTP/1.0 doesn't require one, so the API refuses it.
      const http10 = await sendHttp10(
        port,
        `GET ${url} HTTP/1.0\r\n${WINDOW_TOKEN_HEADER}: ${WINDOW_TOKEN}\r\n\r\n`,
      );

      expect(http11.status).toBe(400);
      expect(http10).toMatch(/^HTTP\/1\.[01] 403 /u);
    },
  );

  it("records a refused token without the token, as token_refused", async () => {
    const { port, events } = await startTestApi();

    await send(port, {
      path: "/api/mcp/settings",
      headers: { [WINDOW_TOKEN_HEADER]: "a-guess" },
    });

    await expect
      .poll(() => events.filter((event) => event.kind === "request"))
      .toEqual([
        expect.objectContaining({
          name: "api.request",
          outcome: "refused",
          outcome_reason: "token_refused",
          http: expect.objectContaining({ status_code: 401 }),
        }),
      ]);
    expect(JSON.stringify(events)).not.toContain(WINDOW_TOKEN);
    expect(JSON.stringify(events)).not.toContain("a-guess");
  });

  it("answers no /api route but health when it was given no token", async () => {
    const { port } = await startTestApi({ windowToken: undefined });

    const settings = await send(port, {
      path: "/api/mcp/settings",
      headers: { [WINDOW_TOKEN_HEADER]: "" },
    });
    const health = await send(port, { path: "/api/health" });

    expect(settings.status).toBe(401);
    expect(health.status).toBe(200);
  });

  it("lets only the window create an agent client, which then connects to /mcp with its own bearer token", async () => {
    const { port } = await startTestApi();
    const post = (url: string, body: object, headers = {}) =>
      send(port, {
        method: "POST",
        path: url,
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify(body),
      });

    expect(
      (await post("/api/mcp/settings", { enabled: true }, windowHeaders))
        .status,
    ).toBe(200);
    expect((await post("/api/mcp/clients", { name: "Script" })).status).toBe(
      401,
    );
    const created = await post(
      "/api/mcp/clients",
      { name: "Claude Code" },
      windowHeaders,
    );
    expect(created.status).toBe(201);
    const { token } = JSON.parse(created.body) as { token: string };

    const mcp = await post(
      "/mcp/ajour",
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "test", version: "1" },
        },
      },
      {
        Accept: "application/json, text/event-stream",
        Authorization: `Bearer ${token}`,
      },
    );
    expect(mcp.status).toBe(200);
  });
});
