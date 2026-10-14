import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, describe, expect, it } from "vitest";
import type {
  BridgeToolCall,
  BridgeToolResult,
} from "../../../packages/shared/agent-tools.ts";
import { startAppApiServer, stopAppApiServer } from "./server.ts";

const TEST_ORIGIN = "http://127.0.0.1:5173";
const running: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const stop of running.splice(0).reverse()) await stop();
});

type TestApiOptions = Omit<
  Parameters<typeof startAppApiServer>[0] & object,
  "port" | "statePath"
>;

/** Starts a real API on a free port, with a temporary state file. */
async function startTestApi(options: TestApiOptions = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "ajour-mcp-"));
  const logged: Record<string, unknown>[] = [];
  const server = await startAppApiServer({
    port: 0,
    statePath: path.join(root, "state.json"),
    installedPluginDirectory: path.join(root, "installed"),
    allowDevelopmentPlugins: false,
    projectDataShapePluginDirectories: [],
    allowedOrigins: [TEST_ORIGIN],
    mcpLogEvent: (event) => logged.push(event),
    ...options,
  });
  const { port } = server.address() as AddressInfo;
  running.push(async () => {
    await stopAppApiServer(server);
    await rm(root, { recursive: true, force: true });
  });
  return { baseUrl: `http://127.0.0.1:${port}`, logged };
}

/** Calls an /api route the way the renderer does, with its origin. */
async function apiRequest(baseUrl: string, pathname: string, body?: unknown) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { Origin: TEST_ORIGIN, "Content-Type": "application/json" },
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
    headers: { Origin: TEST_ORIGIN },
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
  it("answers 404 while MCP is off", async () => {
    const { baseUrl } = await startTestApi();
    const response = await fetch(`${baseUrl}/mcp/ajour`, {
      method: "POST",
      headers: { Authorization: "Bearer ajour_x" },
    });
    expect(response.status).toBe(404);
  });

  it("refuses browser requests even with a valid token", async () => {
    const { baseUrl } = await startTestApi();
    const { token } = await enableMcpWithClient(baseUrl);
    const response = await fetch(`${baseUrl}/mcp/ajour`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, Origin: TEST_ORIGIN },
    });
    expect(response.status).toBe(403);
  });

  it("answers 401 without a token and with a revoked one", async () => {
    const { baseUrl } = await startTestApi();
    const created = await enableMcpWithClient(baseUrl);
    const missing = await fetch(`${baseUrl}/mcp/ajour`, { method: "POST" });
    expect(missing.status).toBe(401);

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
  });

  it("runs a read tool in the renderer and names the client", async () => {
    const { baseUrl, logged } = await startTestApi();
    const { token } = await enableMcpWithClient(baseUrl, "Claude Code");
    const calls: BridgeToolCall[] = [];
    await openFakeRenderer(baseUrl, (call) => {
      calls.push(call);
      return {
        requestId: call.requestId,
        ok: true,
        output: { projects: ["Acme"] },
      };
    });
    const agent = await connectAgent(baseUrl, token);

    const result = await agent.callTool({
      name: "list_projects",
      arguments: {},
    });

    expect(JSON.parse(resultText(result))).toEqual({ projects: ["Acme"] });
    expect(calls[0]).toMatchObject({
      tool: "list_projects",
      client: { name: "Claude Code" },
    });
    expect(logged).toContainEqual(
      expect.objectContaining({
        event: "mcp.request",
        tool: "list_projects",
        outcome: "ok",
      }),
    );
    expect(logged.every((event) => !("input" in event))).toBe(true);
  });

  it("lists the read and write tools and forwards a write with its input", async () => {
    const { baseUrl } = await startTestApi();
    const { token } = await enableMcpWithClient(baseUrl, "Claude Code");
    const calls: BridgeToolCall[] = [];
    await openFakeRenderer(baseUrl, (call) => {
      calls.push(call);
      return { requestId: call.requestId, ok: true, output: { marked: 1 } };
    });
    const agent = await connectAgent(baseUrl, token);

    const { tools } = await agent.listTools();
    expect(tools).toHaveLength(14);
    expect(tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining(["start_timer", "mark_entries_submitted"]),
    );

    await agent.callTool({
      name: "mark_entries_submitted",
      arguments: { entryIds: ["e1"] },
    });
    expect(calls[0]).toMatchObject({
      tool: "mark_entries_submitted",
      input: { entryIds: ["e1"] },
    });
  });

  it("returns the renderer's refusal as a tool error", async () => {
    const { baseUrl } = await startTestApi();
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
  });

  it("tells the agent to open Ajour when no window is connected", async () => {
    const { baseUrl } = await startTestApi();
    const { token } = await enableMcpWithClient(baseUrl);
    const agent = await connectAgent(baseUrl, token);

    const result = await agent.callTool({
      name: "list_projects",
      arguments: {},
    });

    expect(result.isError).toBe(true);
    expect(resultText(result)).toBe("Open the Ajour window to use this tool.");
  });

  it("times out when the window does not answer", async () => {
    const { baseUrl } = await startTestApi({ mcpBridgeTimeoutMs: 100 });
    const { token } = await enableMcpWithClient(baseUrl);
    await openFakeRenderer(baseUrl, () => undefined);
    const agent = await connectAgent(baseUrl, token);

    const result = await agent.callTool({
      name: "list_projects",
      arguments: {},
    });

    expect(resultText(result)).toBe("Ajour did not answer in time.");
  });
});
