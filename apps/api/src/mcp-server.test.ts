import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  BridgeToolCall,
  BridgeToolResult,
} from "../../../packages/shared/agent-tools.ts";
import type { AjourEvent } from "../../../packages/wide-events/catalog.ts";
import { createRecordingSink } from "../../../packages/wide-events/sinks.ts";
import { AgentSessions } from "./agent-sessions.ts";
import { startAppApiServer, stopAppApiServer } from "./server.ts";
import { fakeCliAdapter } from "./test-support/fake-cli-adapter.ts";
import {
  TEST_WINDOW_TOKEN,
  windowTokenHeader,
} from "./test-support/window-token.ts";

const TEST_ORIGIN = "http://127.0.0.1:5173";
const MCP_EVENT_NAMES: ReadonlySet<string> = new Set([
  "mcp.request",
  "agent_tool.call",
  "agent.session",
  "agent.run",
]);
const running: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const stop of running.splice(0).reverse()) await stop();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

type TestApiOptions = Omit<
  Parameters<typeof startAppApiServer>[0] & object,
  "port" | "statePath"
>;

/** Starts a real API on a free port, with a temporary state file. */
async function startTestApi(options: TestApiOptions = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "ajour-mcp-"));
  const sink = createRecordingSink<AjourEvent>();
  // The MCP and agent events. Each /api request the test makes emits its
  // own, which request-events.test.ts covers.
  const logged: AjourEvent[] = [];
  const recordMcp = (event: Parameters<typeof sink.emit>[0]) => {
    sink.emit(event);
    if (MCP_EVENT_NAMES.has(event.name)) logged.push(event as AjourEvent);
  };
  const server = await startAppApiServer({
    port: 0,
    statePath: path.join(root, "state.json"),
    installedPluginDirectory: path.join(root, "installed"),
    allowDevelopmentPlugins: false,
    projectDataShapePluginDirectories: [],
    allowedOrigins: [TEST_ORIGIN],
    windowToken: TEST_WINDOW_TOKEN,
    eventSink: { emit: recordMcp },
    ...options,
  });
  const { port } = server.address() as AddressInfo;
  running.push(async () => {
    await stopAppApiServer(server);
    await rm(root, { recursive: true, force: true });
  });
  return { baseUrl: `http://127.0.0.1:${port}`, logged, all: sink.events };
}

/** Calls an /api route the way the renderer does, with its origin. */
async function apiRequest(baseUrl: string, pathname: string, body?: unknown) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      ...windowTokenHeader,
      Origin: TEST_ORIGIN,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json()) as any };
}

async function enableMcpWithClient(baseUrl: string, name = "Claude Code") {
  await apiRequest(baseUrl, "/api/mcp/settings", { enabled: true });
  const created = await apiRequest(baseUrl, "/api/mcp/clients", { name });
  return created.body as {
    client: { id: string; name: string };
    token: string;
  };
}

interface SseEvent {
  event: string;
  data: unknown;
}

/**
 * A fake Ajour window: opens the bridge stream, answers tool calls with
 * `handle`, and records every event. `ended` resolves when the API ends the stream.
 */
async function openFakeRenderer(
  baseUrl: string,
  handle: (call: BridgeToolCall) => BridgeToolResult | undefined = () =>
    undefined,
) {
  const controller = new AbortController();
  const response = await fetch(`${baseUrl}/api/mcp/bridge`, {
    headers: { ...windowTokenHeader, Origin: TEST_ORIGIN },
    signal: controller.signal,
  });
  const events: SseEvent[] = [];
  const listeners = new Set<() => void>();
  if (!response.ok || !response.body) {
    return {
      status: response.status,
      events,
      ended: Promise.resolve(),
      close: () => undefined,
      waitFor: async () => undefined as never,
    };
  }

  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  const ended = (async () => {
    let buffer = "";
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return;
        buffer += value;
        let boundary = buffer.indexOf("\n\n");
        while (boundary >= 0) {
          const raw = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          boundary = buffer.indexOf("\n\n");
          const event = raw.match(/^event: (.+)$/m)?.[1];
          const data = raw.match(/^data: (.+)$/m)?.[1];
          if (!event || data === undefined) continue;
          const parsed = { event, data: JSON.parse(data) as unknown };
          events.push(parsed);
          listeners.forEach((listener) => listener());
          if (event === "tool-call") {
            const result = handle(parsed.data as BridgeToolCall);
            if (result)
              await apiRequest(baseUrl, "/api/mcp/bridge/results", result);
          }
        }
      }
    } catch {
      // Aborted by the test.
    }
  })();

  /**
   * Resolves with the first event named `name` whose data passes `matches`,
   * whether it already arrived or arrives later.
   */
  function waitFor(
    name: string,
    matches: (data: any) => boolean = () => true,
  ): Promise<SseEvent> {
    return new Promise((resolve) => {
      const check = () => {
        const match = events.find(
          (event) => event.event === name && matches(event.data),
        );
        if (match) {
          listeners.delete(check);
          resolve(match);
        }
      };
      listeners.add(check);
      check();
    });
  }

  return {
    status: response.status,
    events,
    ended,
    close: () => controller.abort(),
    waitFor,
  };
}

/** Connects an MCP client the way Claude Code or Codex would. */
async function connectAgent(baseUrl: string, token: string) {
  const agent = new Client({ name: "test-agent", version: "1.0.0" });
  await agent.connect(
    new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp/ajour`), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    }),
  );
  running.push(() => agent.close());
  return agent;
}

/** The text of a tool result's first content block. */
function resultText(result: Awaited<ReturnType<Client["callTool"]>>) {
  const [first] = result.content as { type: string; text: string }[];
  return first?.text ?? "";
}

const acmeProjects = {
  projects: [{ projectId: "p1", name: "Acme", tasks: [] }],
};

describe("MCP settings routes", () => {
  it("keeps MCP off by default and turns it on", async () => {
    const { baseUrl } = await startTestApi();
    expect((await apiRequest(baseUrl, "/api/mcp/settings")).body).toEqual({
      enabled: false,
      clients: [],
    });
    const updated = await apiRequest(baseUrl, "/api/mcp/settings", {
      enabled: true,
    });
    expect(updated.body.enabled).toBe(true);
  });

  it("shows a new client's token once and lists the client without it", async () => {
    const { baseUrl } = await startTestApi();
    const created = await enableMcpWithClient(baseUrl, "Codex");
    expect(created.token).toMatch(/^ajour_/);

    const settings = await apiRequest(baseUrl, "/api/mcp/settings");
    expect(settings.body.clients).toEqual([
      expect.objectContaining({ id: created.client.id, name: "Codex" }),
    ]);
    expect(JSON.stringify(settings.body)).not.toContain(created.token);

    const revoked = await apiRequest(
      baseUrl,
      `/api/mcp/clients/${created.client.id}/revoke`,
      {},
    );
    expect(revoked.body.clients).toEqual([]);
  });

  it("refuses the bridge while MCP is off", async () => {
    const { baseUrl } = await startTestApi();
    const renderer = await openFakeRenderer(baseUrl);
    expect(renderer.status).toBe(404);
  });

  it("refuses a bridge request with no Origin, as a web page's image tag sends", async () => {
    const { baseUrl } = await startTestApi();
    await apiRequest(baseUrl, "/api/mcp/settings", { enabled: true });
    const controller = new AbortController();

    const response = await fetch(`${baseUrl}/api/mcp/bridge`, {
      headers: windowTokenHeader,
      signal: controller.signal,
    });
    controller.abort();

    expect(response.status).toBe(403);
  });

  it("turning MCP off closes the bridge", async () => {
    const { baseUrl } = await startTestApi();
    await apiRequest(baseUrl, "/api/mcp/settings", { enabled: true });
    const renderer = await openFakeRenderer(baseUrl);
    expect(renderer.status).toBe(200);

    await apiRequest(baseUrl, "/api/mcp/settings", { enabled: false });
    await renderer.ended;
  });
});

describe("MCP endpoint", () => {
  it("answers 404 while MCP is off, to agents and web pages alike", async () => {
    const { baseUrl } = await startTestApi();
    const response = await fetch(`${baseUrl}/mcp/ajour`, {
      method: "POST",
      headers: { Authorization: "Bearer ajour_x" },
    });
    expect(response.status).toBe(404);
    const fromPage = await fetch(`${baseUrl}/mcp/ajour`, {
      method: "POST",
      headers: { Origin: TEST_ORIGIN },
    });
    expect(fromPage.status).toBe(404);
  });

  it("refuses browser requests even with a valid token", async () => {
    const { baseUrl, logged } = await startTestApi();
    const { token } = await enableMcpWithClient(baseUrl);
    const response = await fetch(`${baseUrl}/mcp/ajour`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, Origin: TEST_ORIGIN },
    });
    expect(response.status).toBe(403);
    expect(logged).toEqual([
      expect.objectContaining({
        name: "mcp.request",
        kind: "request",
        outcome: "refused",
        outcome_reason: "browser_origin",
      }),
    ]);
  });

  it("answers 401 without a token and with a revoked one", async () => {
    const { baseUrl, logged } = await startTestApi();
    const created = await enableMcpWithClient(baseUrl);
    const missing = await fetch(`${baseUrl}/mcp/ajour`, { method: "POST" });
    expect(missing.status).toBe(401);
    const unknown = await fetch(`${baseUrl}/mcp/ajour`, {
      method: "POST",
      headers: { Authorization: "Bearer ajour_nobody" },
    });
    expect(unknown.status).toBe(401);

    await apiRequest(
      baseUrl,
      `/api/mcp/clients/${created.client.id}/revoke`,
      {},
    );
    const revoked = await fetch(`${baseUrl}/mcp/ajour`, {
      method: "POST",
      headers: { Authorization: `Bearer ${created.token}` },
    });
    expect(revoked.status).toBe(401);
    expect(
      logged.map(({ name, outcome, outcome_reason, agent }) => ({
        name,
        outcome,
        outcome_reason,
        agent,
      })),
    ).toEqual([
      {
        name: "mcp.request",
        outcome: "refused",
        outcome_reason: "token_missing",
        agent: undefined,
      },
      {
        name: "mcp.request",
        outcome: "refused",
        outcome_reason: "token_unknown",
        agent: undefined,
      },
      {
        name: "mcp.request",
        outcome: "refused",
        outcome_reason: "token_revoked",
        agent: { client_id: created.client.id },
      },
    ]);
    // A token never enters an event.
    expect(JSON.stringify(logged)).not.toContain(created.token);
  });

  it("runs a read tool in the renderer and names the client", async () => {
    const { baseUrl, logged } = await startTestApi();
    const { token, client } = await enableMcpWithClient(baseUrl, "Claude Code");
    const calls: BridgeToolCall[] = [];
    await openFakeRenderer(baseUrl, (call) => {
      calls.push(call);
      return {
        requestId: call.requestId,
        ok: true,
        output: acmeProjects,
      };
    });
    const agent = await connectAgent(baseUrl, token);

    const result = await agent.callTool({
      name: "list_projects",
      arguments: {},
    });

    expect(result.structuredContent).toEqual(acmeProjects);
    expect(JSON.parse(resultText(result))).toEqual(acmeProjects);
    expect(calls[0]).toMatchObject({
      tool: "list_projects",
      client: { name: "Claude Code" },
    });
    const toolCalls = logged.filter(
      (event) => event.name === "agent_tool.call",
    );
    expect(toolCalls).toEqual([
      {
        schema: 1,
        name: "agent_tool.call",
        kind: "request",
        runtime: "api",
        outcome: "ok",
        started_at: expect.stringMatching(/^\d{4}-\d\d-\d\dT[\d:.]+Z$/),
        duration_ms: expect.any(Number),
        trace_id: expect.stringMatching(/^[0-9a-f]{32}$/),
        span_id: expect.stringMatching(/^[0-9a-f]{16}$/),
        launch_id: expect.any(String),
        trigger: "agent",
        app: expect.objectContaining({ channel: "dev", packaged: false }),
        device: expect.objectContaining({ platform: process.platform }),
        agent: { client_id: client.id },
        agent_tool: {
          name: "list_projects",
          access: "read",
          bridge_ms: expect.any(Number),
        },
        http: {
          method: "POST",
          route: "/mcp/ajour",
          status_code: 200,
          request_bytes: expect.any(Number),
          response_bytes: expect.any(Number),
          origin: "none",
        },
      },
    ]);
    // Neither the tool's input nor its output enters an event.
    expect(JSON.stringify(logged)).not.toContain("Acme");
  });

  it("names every other MCP method mcp.request", async () => {
    const { baseUrl, logged } = await startTestApi();
    const { token, client } = await enableMcpWithClient(baseUrl);
    const agent = await connectAgent(baseUrl, token);

    await agent.listTools();

    expect(
      logged.map(({ name, outcome, mcp, agent: ids }) => ({
        name,
        outcome,
        mcp,
        agent: ids,
      })),
    ).toEqual(
      ["initialize", "notifications/initialized", "tools/list"].map(
        (method) => ({
          name: "mcp.request",
          outcome: "ok",
          mcp: { method },
          agent: { client_id: client.id },
        }),
      ),
    );
  });

  /** Posts a raw JSON-RPC body to the MCP endpoint, as an agent would. */
  const postMcp = (baseUrl: string, token: string, body: string) =>
    fetch(`${baseUrl}/mcp/ajour`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body,
    });

  it("refuses a body that isn't JSON as the agent's mistake, never with the body's text", async () => {
    const { baseUrl, logged } = await startTestApi();
    const { token } = await enableMcpWithClient(baseUrl);

    const response = await postMcp(
      baseUrl,
      token,
      '{"note": "Lunch with Ana about the raise",',
    );

    expect(response.status).toBe(400);
    expect(logged).toEqual([
      expect.objectContaining({
        name: "mcp.request",
        outcome: "refused",
        outcome_reason: "invalid_request",
        error: { type: "SyntaxError", code: "invalid_json" },
      }),
    ]);
    expect(JSON.stringify(logged)).not.toContain("Ana");
  });

  it("records a tool whose handler throws as an error, not as the agent's invalid call", async () => {
    const { baseUrl, logged } = await startTestApi();
    const { token } = await enableMcpWithClient(baseUrl);
    const agent = await connectAgent(baseUrl, token);
    vi.spyOn(AgentSessions.prototype, "begin").mockImplementation(() => {
      throw new TypeError("Cannot begin Fill Workday");
    });

    const result = await agent.callTool({
      name: "begin_session",
      arguments: { title: "Fill Workday", estimateMinutes: 10 },
    });

    expect(result.isError).toBe(true);
    const [call] = logged.filter((event) => event.name === "agent_tool.call");
    expect(call).toMatchObject({
      outcome: "error",
      agent_tool: { name: "begin_session", access: "session" },
      error: { type: "TypeError" },
    });
    expect(call).not.toHaveProperty("outcome_reason");
  });

  it("records a tool call the SDK rejects, with the tool's name and never its arguments", async () => {
    const { baseUrl, logged } = await startTestApi();
    const { token } = await enableMcpWithClient(baseUrl);
    const agent = await connectAgent(baseUrl, token);

    const unknown = await agent.callTool({
      name: "delete_everything",
      arguments: {},
    });
    const invalid = await agent.callTool({
      name: "list_time_entries",
      arguments: { from: "Lunch with Ana", to: 3 },
    });

    expect(unknown.isError).toBe(true);
    expect(invalid.isError).toBe(true);
    expect(
      logged
        .filter((event) => event.name === "agent_tool.call")
        .map(({ outcome, outcome_reason, agent_tool }) => ({
          outcome,
          outcome_reason,
          agent_tool,
        })),
    ).toEqual([
      {
        outcome: "refused",
        outcome_reason: "invalid_call",
        agent_tool: { name: "other" },
      },
      {
        outcome: "refused",
        outcome_reason: "invalid_call",
        agent_tool: { name: "list_time_entries" },
      },
    ]);
    expect(JSON.stringify(logged)).not.toMatch(/delete_everything|Ana/);
  });

  it("records a batch of messages as one mcp.request that counts its tool calls", async () => {
    const { baseUrl, logged } = await startTestApi();
    const { token } = await enableMcpWithClient(baseUrl);
    const call = (id: number) => ({
      jsonrpc: "2.0",
      id,
      method: "tools/call",
      params: { name: "list_projects", arguments: {} },
    });

    await postMcp(baseUrl, token, JSON.stringify([call(1), call(2)]));

    expect(logged).toEqual([
      expect.objectContaining({
        name: "mcp.request",
        mcp: { method: "batch", call_count: 2 },
      }),
    ]);
  });

  it("refuses a batch whose requests share an id before any of them runs", async () => {
    const { baseUrl, logged } = await startTestApi();
    const { token } = await enableMcpWithClient(baseUrl);
    const calls: BridgeToolCall[] = [];
    await openFakeRenderer(baseUrl, (call) => {
      calls.push(call);
      return { requestId: call.requestId, ok: true, output: acmeProjects };
    });
    const listProjects = {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "list_projects", arguments: {} },
    };

    const response = await postMcp(
      baseUrl,
      token,
      JSON.stringify([listProjects, listProjects]),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32600 },
    });
    expect(calls).toEqual([]);
    expect(logged).toEqual([
      expect.objectContaining({
        name: "mcp.request",
        outcome: "refused",
        outcome_reason: "duplicate_id",
        mcp: { method: "batch", call_count: 2 },
      }),
    ]);
  });

  it("ends a batch with its worst outcome: a timeout beside an ok call", async () => {
    const { baseUrl, logged } = await startTestApi({ mcpBridgeTimeoutMs: 100 });
    const { token } = await enableMcpWithClient(baseUrl);
    // The window answers list_projects and never get_running_timer.
    await openFakeRenderer(baseUrl, (call) =>
      call.tool === "list_projects"
        ? { requestId: call.requestId, ok: true, output: acmeProjects }
        : undefined,
    );

    await postMcp(
      baseUrl,
      token,
      JSON.stringify([
        {
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "list_projects", arguments: {} },
        },
        {
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: { name: "get_running_timer", arguments: {} },
        },
      ]),
    );

    expect(logged).toEqual([
      expect.objectContaining({
        name: "mcp.request",
        outcome: "timeout",
        // Settled by the batch, ended once by the request seam: it still
        // gets the status and the size.
        http: expect.objectContaining({
          status_code: 200,
          response_bytes: expect.any(Number),
        }),
        step_failures: [
          {
            name: "agent_tool.call",
            outcome: "timeout",
            outcome_reason: "bridge_timeout",
            error_type: "BridgeCallError",
          },
        ],
      }),
    ]);
  });

  it("never downgrades a batch's own error to a call's refusal", async () => {
    const { baseUrl, logged } = await startTestApi();
    const { token } = await enableMcpWithClient(baseUrl);

    await postMcp(
      baseUrl,
      token,
      JSON.stringify([
        { jsonrpc: "2.0", id: 1, method: "no/such_method" },
        {
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: { name: "delete_everything", arguments: {} },
        },
      ]),
    );

    expect(logged).toEqual([
      expect.objectContaining({
        name: "mcp.request",
        outcome: "error",
        error: { type: "McpError", code: "-32601" },
        step_failures: [
          {
            name: "agent_tool.call",
            outcome: "refused",
            outcome_reason: "invalid_call",
          },
        ],
      }),
    ]);
  });

  it("fails a batch whose call failed, and lists the call, never its text", async () => {
    const { baseUrl, logged } = await startTestApi();
    const { token } = await enableMcpWithClient(baseUrl);

    // No Ajour window: list_projects can't reach the renderer.
    await postMcp(
      baseUrl,
      token,
      JSON.stringify([
        {
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "list_projects", arguments: {} },
        },
        {
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: {
            name: "begin_session",
            arguments: { title: "Fill Workday", estimateMinutes: 10 },
          },
        },
      ]),
    );

    expect(logged).toEqual([
      expect.objectContaining({
        name: "mcp.request",
        outcome: "error",
        mcp: { method: "batch", call_count: 2 },
        steps: ["agent_tool.call", "agent_tool.call"],
        step_failures: [
          {
            name: "agent_tool.call",
            outcome: "error",
            outcome_reason: "bridge_unavailable",
            error_type: "BridgeCallError",
          },
        ],
      }),
    ]);
    expect(JSON.stringify(logged)).not.toContain("Fill Workday");
  });

  it("refuses a request the transport rejects, by its HTTP status", async () => {
    const { baseUrl, logged } = await startTestApi();
    const { token } = await enableMcpWithClient(baseUrl);

    const response = await postMcp(
      baseUrl,
      token,
      JSON.stringify({
        jsonrpc: "1.0",
        id: 1,
        method: "tools/call",
        params: { name: "list_projects", arguments: {} },
      }),
    );

    expect(response.status).toBe(400);
    expect(logged).toEqual([
      expect.objectContaining({
        outcome: "refused",
        outcome_reason: "protocol_error",
        http: expect.objectContaining({ status_code: 400, origin: "none" }),
      }),
    ]);
  });

  it("refuses a tool call that never reaches its handler: a notification, or one with no params", async () => {
    const { baseUrl, logged } = await startTestApi();
    const { token } = await enableMcpWithClient(baseUrl);

    await postMcp(
      baseUrl,
      token,
      JSON.stringify({
        jsonrpc: "2.0",
        method: "tools/call",
        params: { name: "list_projects", arguments: {} },
      }),
    );
    await postMcp(
      baseUrl,
      token,
      JSON.stringify({ jsonrpc: "2.0", id: 7, method: "tools/call" }),
    );

    expect(
      logged.map(({ name, outcome, outcome_reason }) => ({
        name,
        outcome,
        outcome_reason,
      })),
    ).toEqual([
      {
        name: "agent_tool.call",
        outcome: "refused",
        outcome_reason: "invalid_call",
      },
      {
        name: "agent_tool.call",
        outcome: "refused",
        outcome_reason: "invalid_call",
      },
    ]);
  });

  it("records an output the SDK rejects after the handler returned as an output mismatch", async () => {
    const { baseUrl, logged } = await startTestApi();
    const { token } = await enableMcpWithClient(baseUrl);
    const agent = await connectAgent(baseUrl, token);
    vi.spyOn(AgentSessions.prototype, "ask").mockImplementation(
      () => ({ id: 5 }) as never,
    );

    const result = await agent.callTool({
      name: "ask",
      arguments: { question: "Which project for Globex?" },
    });

    expect(result.isError).toBe(true);
    expect(logged.filter((event) => event.name === "agent_tool.call")).toEqual([
      expect.objectContaining({
        outcome: "error",
        outcome_reason: "output_mismatch",
        agent_tool: { name: "ask", access: "session" },
      }),
    ]);
    expect(JSON.stringify(logged)).not.toContain("Globex");
  });

  it("reports renderer output that breaks the tool's output schema as an error", async () => {
    const { baseUrl, logged } = await startTestApi();
    const { token } = await enableMcpWithClient(baseUrl, "Claude Code");
    const renderer = await openFakeRenderer(baseUrl, (call) => ({
      requestId: call.requestId,
      ok: true,
      output: { projects: ["Acme"] },
    }));
    const agent = await connectAgent(baseUrl, token);

    const result = await agent.callTool({
      name: "list_projects",
      arguments: {},
    });

    expect(result.isError).toBe(true);
    expect(resultText(result)).toBe(
      "Ajour returned list_projects output that does not match its schema.",
    );
    expect(logged).toContainEqual(
      expect.objectContaining({
        name: "agent_tool.call",
        agent_tool: expect.objectContaining({ name: "list_projects" }),
        outcome: "error",
        outcome_reason: "output_mismatch",
      }),
    );
    await renderer.waitFor("agents", (data) => data.errors.length > 0);
  });

  it("lists the read and write tools and forwards a write with its input", async () => {
    const { baseUrl } = await startTestApi();
    const { token } = await enableMcpWithClient(baseUrl, "Claude Code");
    const calls: BridgeToolCall[] = [];
    await openFakeRenderer(baseUrl, (call) => {
      calls.push(call);
      return { requestId: call.requestId, ok: true, output: { committed: 1 } };
    });
    const agent = await connectAgent(baseUrl, token);

    const { tools } = await agent.listTools();
    expect(tools).toHaveLength(32);
    expect(tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining([
        "start_timer",
        "get_week_changes",
        "get_week_status",
        "mark_entries_committed",
        "submit_week",
        "create_work_item",
        "restore_work_item",
        "list_work_item_comments",
        "post_work_item_comment",
      ]),
    );
    expect(tools.map((tool) => tool.name)).not.toContain("get_submit_lines");

    await agent.callTool({
      name: "mark_entries_committed",
      arguments: { changes: [{ entryId: "e1", version: "v:0a1b2c3d" }] },
    });
    expect(calls[0]).toMatchObject({
      tool: "mark_entries_committed",
      input: { changes: [{ entryId: "e1", version: "v:0a1b2c3d" }] },
    });
  });

  it("returns the renderer's refusal as a tool error", async () => {
    const { baseUrl, logged } = await startTestApi();
    const { token } = await enableMcpWithClient(baseUrl);
    await openFakeRenderer(baseUrl, (call) => ({
      requestId: call.requestId,
      ok: false,
      error: "No backlog item has the id x.",
    }));
    const agent = await connectAgent(baseUrl, token);

    const result = await agent.callTool({
      name: "get_work_item",
      arguments: { workItemId: "x" },
    });

    expect(result.isError).toBe(true);
    expect(resultText(result)).toBe("No backlog item has the id x.");
    expect(logged).toContainEqual(
      expect.objectContaining({
        name: "agent_tool.call",
        outcome: "refused",
        agent_tool: expect.objectContaining({ name: "get_work_item" }),
      }),
    );
  });

  it("logs a renderer exception as an error and shows it in the indicator", async () => {
    const { baseUrl, logged } = await startTestApi();
    const { token } = await enableMcpWithClient(baseUrl);
    const renderer = await openFakeRenderer(baseUrl, (call) => ({
      requestId: call.requestId,
      ok: false,
      error: "Cannot read properties of undefined",
      failed: true,
    }));
    const agent = await connectAgent(baseUrl, token);

    const result = await agent.callTool({
      name: "list_projects",
      arguments: {},
    });

    expect(result.isError).toBe(true);
    expect(resultText(result)).toBe("Cannot read properties of undefined");
    expect(logged).toContainEqual(
      expect.objectContaining({
        name: "agent_tool.call",
        agent_tool: expect.objectContaining({ name: "list_projects" }),
        outcome: "error",
        outcome_reason: "tool_failed",
        error: {
          type: "Error",
          message: "Cannot read properties of undefined",
        },
      }),
    );
    const published = await renderer.waitFor(
      "agents",
      (data) => data.errors.length === 1,
    );
    expect(published.data).toMatchObject({
      errors: [{ message: "Cannot read properties of undefined" }],
    });
  });

  it("tells the agent to open Ajour when no window is connected", async () => {
    const { baseUrl, logged } = await startTestApi();
    const { token } = await enableMcpWithClient(baseUrl);
    const agent = await connectAgent(baseUrl, token);

    const result = await agent.callTool({
      name: "list_projects",
      arguments: {},
    });

    expect(result.isError).toBe(true);
    expect(resultText(result)).toBe("Open the Ajour window to use this tool.");
    expect(logged).toContainEqual(
      expect.objectContaining({
        name: "agent_tool.call",
        outcome: "error",
        outcome_reason: "bridge_unavailable",
      }),
    );
  });

  it("times out when the window does not answer", async () => {
    const { baseUrl, logged } = await startTestApi({ mcpBridgeTimeoutMs: 100 });
    const { token } = await enableMcpWithClient(baseUrl);
    await openFakeRenderer(baseUrl, () => undefined);
    const agent = await connectAgent(baseUrl, token);

    const result = await agent.callTool({
      name: "list_projects",
      arguments: {},
    });

    expect(resultText(result)).toBe("Ajour did not answer in time.");
    expect(logged).toContainEqual(
      expect.objectContaining({
        name: "agent_tool.call",
        outcome: "timeout",
        outcome_reason: "bridge_timeout",
      }),
    );
  });
});

describe("agent sessions over MCP", () => {
  it("runs a session from begin to end and publishes it", async () => {
    const { baseUrl, logged } = await startTestApi();
    const { token } = await enableMcpWithClient(baseUrl);
    const renderer = await openFakeRenderer(baseUrl);
    const agent = await connectAgent(baseUrl, token);

    const begun = JSON.parse(
      resultText(
        await agent.callTool({
          name: "begin_session",
          arguments: { title: "Fill Workday", estimateMinutes: 10 },
        }),
      ),
    ) as { sessionId: string };
    const published = await renderer.waitFor(
      "agents",
      (data) => data.sessions.length === 1,
    );
    expect(published.data).toMatchObject({
      sessions: [{ title: "Fill Workday", state: "active" }],
    });
    expect(logged).toContainEqual(
      expect.objectContaining({
        name: "agent_tool.call",
        agent_tool: { name: "begin_session", access: "session" },
        agent: expect.objectContaining({ session_id: begun.sessionId }),
      }),
    );

    await agent.callTool({
      name: "end_session",
      arguments: {
        sessionId: begun.sessionId,
        outcome: "done",
        summary: "Entered 5 lines",
      },
    });
    const ended = logged.filter((event) => event.name === "agent.session");
    expect(ended).toEqual([
      expect.objectContaining({
        kind: "job",
        runtime: "api",
        trigger: "agent",
        outcome: "ok",
        agent: {
          client_id: expect.any(String),
          session_id: begun.sessionId,
          update_count: 0,
          question_count: 0,
          stall_count: 0,
        },
      }),
    ]);
    // The session is a child span of the begin_session call that started it.
    const begin = logged.find(
      (event) => event.agent_tool?.name === "begin_session",
    )!;
    expect(ended[0]).toMatchObject({
      trace_id: begin.trace_id,
      parent_span_id: begin.span_id,
    });
    // Wide events carry ids and counts, never what the agent or user wrote.
    expect(JSON.stringify(logged)).not.toContain("Entered 5 lines");
    expect(JSON.stringify(logged)).not.toContain("Fill Workday");
  });

  it("returns the user's answer to wait_for_answer", async () => {
    const { baseUrl } = await startTestApi();
    const { token } = await enableMcpWithClient(baseUrl);
    const renderer = await openFakeRenderer(baseUrl);
    const agent = await connectAgent(baseUrl, token);

    const asked = JSON.parse(
      resultText(
        await agent.callTool({
          name: "ask",
          arguments: {
            question: "Which project?",
            choices: ["Acme", "Globex"],
          },
        }),
      ),
    ) as { questionId: string };
    await renderer.waitFor("agents", (data) => data.openQuestions.length === 1);

    const waiting = agent.callTool({
      name: "wait_for_answer",
      arguments: { questionId: asked.questionId },
    });
    await apiRequest(baseUrl, `/api/mcp/questions/${asked.questionId}/answer`, {
      text: "Acme",
    });

    expect(JSON.parse(resultText(await waiting))).toEqual({
      status: "answered",
      answer: "Acme",
    });
  });

  it("answers 409 for a question that is closed", async () => {
    const { baseUrl } = await startTestApi();
    const { token } = await enableMcpWithClient(baseUrl);
    const agent = await connectAgent(baseUrl, token);
    const asked = JSON.parse(
      resultText(
        await agent.callTool({ name: "ask", arguments: { question: "Ok?" } }),
      ),
    ) as { questionId: string };
    const path = `/api/mcp/questions/${asked.questionId}/answer`;

    expect((await apiRequest(baseUrl, path, { text: "Yes" })).status).toBe(200);
    expect((await apiRequest(baseUrl, path, { text: "Again" })).status).toBe(
      409,
    );
  });

  it("dismisses a session, withdraws its question and answers 409 the second time", async () => {
    const { baseUrl, logged } = await startTestApi();
    const { token } = await enableMcpWithClient(baseUrl);
    const agent = await connectAgent(baseUrl, token);
    const begun = JSON.parse(
      resultText(
        await agent.callTool({
          name: "begin_session",
          arguments: { title: "Fill Workday", estimateMinutes: 10 },
        }),
      ),
    ) as { sessionId: string };
    const asked = JSON.parse(
      resultText(
        await agent.callTool({
          name: "ask",
          arguments: { question: "Which project?", sessionId: begun.sessionId },
        }),
      ),
    ) as { questionId: string };
    const waiting = agent.callTool({
      name: "wait_for_answer",
      arguments: { questionId: asked.questionId },
    });
    const path = `/api/mcp/sessions/${begun.sessionId}/dismiss`;

    const dismissed = await apiRequest(baseUrl, path, {});

    expect(dismissed.status).toBe(200);
    expect(dismissed.body.sessions[0]).toMatchObject({ state: "cancelled" });
    expect(dismissed.body.openQuestions).toEqual([]);
    expect(JSON.parse(resultText(await waiting))).toEqual({
      status: "withdrawn",
    });
    expect(logged).toContainEqual(
      expect.objectContaining({
        name: "agent.session",
        agent: expect.objectContaining({ session_id: begun.sessionId }),
        outcome: "cancelled",
        outcome_reason: "dismissed",
      }),
    );
    expect((await apiRequest(baseUrl, path, {})).status).toBe(409);
    expect(
      (await apiRequest(baseUrl, "/api/mcp/sessions/nope/dismiss", {})).status,
    ).toBe(409);
  });

  it("returns waiting when no answer comes within the wait", async () => {
    const { baseUrl } = await startTestApi({ mcpWaitForAnswerMs: 50 });
    const { token } = await enableMcpWithClient(baseUrl);
    const agent = await connectAgent(baseUrl, token);
    const asked = JSON.parse(
      resultText(
        await agent.callTool({ name: "ask", arguments: { question: "Ok?" } }),
      ),
    ) as { questionId: string };

    const result = await agent.callTool({
      name: "wait_for_answer",
      arguments: { questionId: asked.questionId },
    });

    expect(JSON.parse(resultText(result))).toEqual({ status: "waiting" });
  });

  it("publishes the seen time when the panel opens", async () => {
    const { baseUrl } = await startTestApi();
    await apiRequest(baseUrl, "/api/mcp/settings", { enabled: true });
    const renderer = await openFakeRenderer(baseUrl);
    await renderer.waitFor("agents", (data) => data.seenAt === 0);

    const seen = await apiRequest(baseUrl, "/api/mcp/seen", {});

    expect(seen.body.seenAt).toBeGreaterThan(0);
    await renderer.waitFor("agents", (data) => data.seenAt > 0);
  });

  it("records a write in the activity list and a missing window as an error", async () => {
    const { baseUrl } = await startTestApi();
    const { token } = await enableMcpWithClient(baseUrl, "Codex");
    const agent = await connectAgent(baseUrl, token);
    await agent.callTool({ name: "list_projects", arguments: {} });

    const renderer = await openFakeRenderer(baseUrl, (call) => ({
      requestId: call.requestId,
      ok: true,
      output: {
        running: { timerId: "t1", date: "2026-10-14", countedMinutes: 0 },
      },
      activity: {
        action: "Started an entry",
        objectId: "t1",
        objectTitle: "Acme \u00b7 Build",
      },
    }));
    const first = await renderer.waitFor(
      "agents",
      (data) => data.errors.length > 0,
    );
    expect(first.data).toMatchObject({
      errors: [
        {
          message: "Open the Ajour window to use this tool.",
          client: { name: "Codex" },
        },
      ],
    });

    await agent.callTool({
      name: "start_timer",
      arguments: { projectId: "p" },
    });
    const after = await renderer.waitFor(
      "agents",
      (data) => data.activity.length > 0,
    );
    expect(after.data).toMatchObject({
      activity: [
        {
          outcome: "ok",
          tool: "start_timer",
          objectTitle: "Acme \u00b7 Build",
        },
      ],
    });
  });

  it("lists a refused write in the activity list, but not a refused read", async () => {
    const { baseUrl } = await startTestApi();
    const { token } = await enableMcpWithClient(baseUrl, "Codex");
    const renderer = await openFakeRenderer(baseUrl, (call) => ({
      requestId: call.requestId,
      ok: false,
      error: "Restore the item first",
    }));
    const agent = await connectAgent(baseUrl, token);

    await agent.callTool({ name: "list_projects", arguments: {} });
    await agent.callTool({
      name: "edit_work_item",
      arguments: { workItemId: "w1", title: "New" },
    });
    const after = await renderer.waitFor(
      "agents",
      (data) => data.activity.length > 0,
    );
    expect(after.data).toMatchObject({
      activity: [
        expect.objectContaining({
          outcome: "refused",
          tool: "edit_work_item",
          reason: "Restore the item first",
        }),
      ],
    });
  });
});

describe("agent runner routes", () => {
  it("answers 404 to a run for an unknown task", async () => {
    const { baseUrl } = await startTestApi();
    const response = await fetch(`${baseUrl}/api/agent-runs`, {
      method: "POST",
      headers: {
        ...windowTokenHeader,
        Origin: TEST_ORIGIN,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        pluginId: "nope",
        taskId: "nothing",
        weekOf: "2026-10-12",
      }),
    });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: "This agent task is not available.",
    });
  });

  it("answers 404 to Stop for a run that is not going", async () => {
    const { baseUrl } = await startTestApi();
    const response = await fetch(`${baseUrl}/api/agent-runs/nope/stop`, {
      method: "POST",
      headers: { ...windowTokenHeader, Origin: TEST_ORIGIN },
    });
    expect(response.status).toBe(404);
  });

  it("lists the agents and keeps their settings", async () => {
    const { baseUrl } = await startTestApi();
    const update = await fetch(`${baseUrl}/api/agents/settings`, {
      method: "POST",
      headers: {
        ...windowTokenHeader,
        Origin: TEST_ORIGIN,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ browserMode: "my-chrome" }),
    });
    const overview = (await update.json()) as {
      settings: { browserMode: string };
      clis: { id: string }[];
    };
    expect(overview.settings.browserMode).toBe("my-chrome");
    expect(overview.clis.map((cli) => cli.id)).toEqual([
      "claude-code",
      "codex",
      "opencode",
    ]);
  });
});

describe("wide events on stdout", () => {
  const refusedBrowserCall = (baseUrl: string, token: string) =>
    fetch(`${baseUrl}/mcp/ajour`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, Origin: TEST_ORIGIN },
    });

  it("prints nothing by default", async () => {
    const log = vi.spyOn(console, "log");
    const info = vi.spyOn(console, "info");
    const write = vi.spyOn(process.stdout, "write");
    const { baseUrl } = await startTestApi({ eventSink: undefined });
    const { token } = await enableMcpWithClient(baseUrl);

    expect((await refusedBrowserCall(baseUrl, token)).status).toBe(403);

    expect(log).not.toHaveBeenCalled();
    expect(info).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });

  it("prints one JSON line per event when AJOUR_WIDE_EVENTS=console", async () => {
    vi.stubEnv("AJOUR_WIDE_EVENTS", "console");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const { baseUrl } = await startTestApi({ eventSink: undefined });
    const { token } = await enableMcpWithClient(baseUrl);

    await refusedBrowserCall(baseUrl, token);
    await refusedBrowserCall(baseUrl, token);

    for (const [line] of log.mock.calls) {
      expect(typeof line).toBe("string");
      expect(line).not.toContain("\n");
    }
    const lines = log.mock.calls.map(
      ([line]) => JSON.parse(line as string) as AjourEvent,
    );
    expect(lines.filter((event) => event.name === "mcp.request")).toEqual([
      expect.objectContaining({ outcome_reason: "browser_origin" }),
      expect.objectContaining({ outcome_reason: "browser_origin" }),
    ]);
  });
});

describe("an agent task's declared tools", () => {
  type McpMessage = { method: string; params?: unknown };
  /** A JSON-RPC result as the fake CLI reports it, or the replies of a batch. */
  type McpResult = {
    id: number;
    result: {
      tools?: { name: string }[];
      structuredContent?: unknown;
      content?: unknown;
      isError?: boolean;
    };
  };
  type McpReply = McpResult | McpResult[];
  const ICON = "<svg viewBox='0 0 16 16'><path d='M0 0h16v16H0z' /></svg>";

  /**
   * A development plugin with one agent task, "Enter in Workday". On plugin
   * API 4 the task declares `tools`; on API 3 it declares none.
   */
  async function createAgentTaskPlugin(
    root: string,
    task: { apiVersion: 3 | 4; tools?: string[] },
  ) {
    const directory = path.join(root, "plugins", "ajp-workday-agent");
    await mkdir(path.join(directory, "prompts"), { recursive: true });
    await writeFile(
      path.join(directory, "plugin.json"),
      JSON.stringify({
        id: "ajp-workday-agent",
        version: `${task.apiVersion}.0.0`,
        apiVersion: task.apiVersion,
        displayName: "Workday tasks",
        description: "Test agent tasks.",
        iconSvg: ICON,
        capabilities: {
          agentTask: {
            tasks: [
              {
                id: "enter-week",
                label: "Enter in Workday",
                placement: "commit-week",
                prompt: "prompts/enter-week.md",
                estimateMinutes: 5,
                ...(task.tools ? { tools: task.tools } : {}),
              },
            ],
          },
        },
      }),
      "utf8",
    );
    await writeFile(
      path.join(directory, "prompts", "enter-week.md"),
      "Enter the week of {{weekOf}}.",
      "utf8",
    );
    return directory;
  }

  /**
   * Starts the API with the plugin and the fake CLI as Claude Code, turns MCP
   * on with a fake window that answers `list_projects`, and runs the task,
   * whose CLI sends `requests` to Ajour's MCP server. Resolves with what each
   * request got, once the run ended.
   */
  async function runTask(
    task: { apiVersion: 3 | 4; tools?: string[] },
    /** Each is one MCP request, or a batch. */
    requests: (McpMessage | McpMessage[])[],
  ) {
    const root = await mkdtemp(path.join(os.tmpdir(), "ajour-agent-tools-"));
    running.push(() =>
      rm(root, { recursive: true, force: true, maxRetries: 5 }),
    );
    const pluginDirectory = await createAgentTaskPlugin(root, task);
    const report = path.join(root, "report.jsonl");
    // Where the runner finds `claude`. The fake CLI runs in its place.
    const bin = path.join(root, "bin");
    await mkdir(bin);
    await writeFile(path.join(bin, "claude"), "#!/bin/sh\nexit 0\n", {
      mode: 0o755,
    });
    let mcpUrl = "";
    const { baseUrl, logged } = await startTestApi({
      developmentPluginDirectories: [pluginDirectory],
      allowDevelopmentPlugins: true,
      agentCliPath: bin,
      agentCliAdapters: [
        fakeCliAdapter(
          [...requests.map((request) => ({ mcp: request })), { exit: 0 }],
          report,
          () => mcpUrl,
        ),
      ],
    });
    mcpUrl = `${baseUrl}/mcp/ajour`;
    await apiRequest(baseUrl, "/api/mcp/settings", { enabled: true });
    const renderer = await openFakeRenderer(baseUrl, (call) =>
      call.tool === "list_projects"
        ? { requestId: call.requestId, ok: true, output: acmeProjects }
        : undefined,
    );
    running.push(async () => renderer.close());
    await apiRequest(baseUrl, "/api/agents/settings", {
      cli: "claude-code",
      browserMode: "my-chrome",
    });
    const started = await apiRequest(baseUrl, "/api/agent-runs", {
      pluginId: "ajp-workday-agent",
      taskId: "enter-week",
      weekOf: "2026-10-12",
    });
    expect(started.body.error).toBeUndefined();
    await vi.waitFor(
      async () =>
        expect(
          (await apiRequest(baseUrl, "/api/agent-runs/current")).body.run,
        ).toBeNull(),
      { timeout: 10_000 },
    );
    const replies = (await readFile(report, "utf8"))
      .trim()
      .split("\n")
      .map(
        (line) =>
          JSON.parse(line) as { mcp?: { status: number; reply: McpReply } },
      )
      .flatMap((line) => (line.mcp ? [line.mcp] : []));
    return { replies, logged };
  }

  const SESSION_TOOLS = [
    "ask",
    "begin_session",
    "end_session",
    "update_session",
    "wait_for_answer",
  ];

  const toolNames = (reply: McpReply) =>
    (reply as McpResult).result.tools!.map((tool) => tool.name).sort();

  it(
    "lists only the tools an API 4 task declares, with the session tools",
    { timeout: 20_000 },
    async () => {
      const { replies } = await runTask(
        { apiVersion: 4, tools: ["list_projects", "get_week_status"] },
        [{ method: "tools/list" }],
      );

      expect(replies).toHaveLength(1);
      expect(toolNames(replies[0]!.reply)).toEqual(
        ["get_week_status", "list_projects", ...SESSION_TOOLS].sort(),
      );
    },
  );

  it(
    "lets the run call a tool its task declares, and refuses any other",
    { timeout: 20_000 },
    async () => {
      const { replies, logged } = await runTask(
        { apiVersion: 4, tools: ["list_projects"] },
        [
          {
            method: "tools/call",
            params: { name: "list_projects", arguments: {} },
          },
          {
            method: "tools/call",
            params: { name: "get_running_timer", arguments: {} },
          },
        ],
      );

      const [declared, other] = replies;
      expect((declared!.reply as McpResult).result.structuredContent).toEqual(
        acmeProjects,
      );
      expect((other!.reply as McpResult).result).toEqual({
        content: [
          {
            type: "text",
            text: "This agent task doesn't declare the tool get_running_timer, so Ajour refuses it. Use only the tools that tools/list returns.",
          },
        ],
        isError: true,
      });
      expect(
        logged
          .filter((event) => event.name === "agent_tool.call")
          .map((event) => ({
            kind: event.kind,
            tool: event.agent_tool?.name,
            outcome: event.outcome,
            reason: event.outcome_reason,
          })),
      ).toEqual([
        {
          kind: "request",
          tool: "list_projects",
          outcome: "ok",
          reason: undefined,
        },
        {
          kind: "request",
          tool: "get_running_timer",
          outcome: "refused",
          reason: "tool_not_declared",
        },
      ]);
    },
  );

  it(
    "refuses an undeclared tool inside a batch, and runs the declared one",
    { timeout: 20_000 },
    async () => {
      const { replies } = await runTask(
        { apiVersion: 4, tools: ["list_projects"] },
        [
          [
            {
              method: "tools/call",
              params: { name: "list_projects", arguments: {} },
            },
            {
              method: "tools/call",
              params: { name: "stop_timer", arguments: {} },
            },
          ],
        ],
      );

      const byId = new Map(
        (replies[0]!.reply as McpResult[]).map((reply) => [reply.id, reply]),
      );
      expect(byId.get(1)!.result.structuredContent).toEqual(acmeProjects);
      expect(byId.get(2)!.result).toMatchObject({
        isError: true,
        content: [
          {
            text: expect.stringContaining(
              "doesn't declare the tool stop_timer",
            ),
          },
        ],
      });
    },
  );

  it(
    "keeps every tool for an API 3 task's run, which declares none",
    { timeout: 20_000 },
    async () => {
      const everyTool = await (async () => {
        const { baseUrl } = await startTestApi();
        const { token } = await enableMcpWithClient(baseUrl);
        const agent = await connectAgent(baseUrl, token);
        return (await agent.listTools()).tools.map((tool) => tool.name).sort();
      })();

      const { replies } = await runTask({ apiVersion: 3 }, [
        { method: "tools/list" },
      ]);

      expect(everyTool).toContain("submit_week");
      expect(toolNames(replies[0]!.reply)).toEqual(everyTool);
    },
  );
});
