import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AjourEvent } from "@ajour/wide-events/catalog.ts";
import { createRecordingSink } from "@ajour/wide-events/sinks.ts";
import {
  FetchEventSource,
  fetchAsTheApp,
  startLocalApi,
  waitForEvent,
} from "@/test-support/local-api";

/*
 * An agent's tool call, end to end against the started local API (#310):
 * the MCP request, the renderer's run of the call it got over the bridge,
 * and the result it posted back are one trace.
 */

/** The agent's own fetch, which sends no browser origin. */
const agentFetch = globalThis.fetch;
let api: Awaited<ReturnType<typeof startLocalApi>>;

function installWindow() {
  const values = new Map<string, string>();
  vi.stubGlobal("window", {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
    setTimeout,
    clearTimeout,
    localStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => void values.set(key, value),
      removeItem: (key: string) => void values.delete(key),
    },
  });
}

beforeEach(async () => {
  api = await startLocalApi();
  vi.resetModules();
  vi.stubEnv("VITE_APP_API_BASE_URL", api.baseUrl);
  vi.stubGlobal("fetch", fetchAsTheApp);
  vi.stubGlobal("EventSource", FetchEventSource);
  installWindow();
});

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  await api.stop();
});

describe("an agent's tool call", () => {
  it("keeps one trace from the MCP request, through the bridge, to the renderer's run", async () => {
    const sink = createRecordingSink<AjourEvent>();
    (await import("@/lib/wide-events")).replaceEventSink(sink);
    const appApi = await import("@/lib/app-api");
    const { connectMcpBridge } = await import("@/lib/mcp-bridge");
    const { runAgentToolCall } =
      await import("@/features/agents/agent-tool-runner");
    const { localStore } = await import("@/lib/local-store");
    localStore.addProject({ name: "Canary project", color: "#123456" });
    await appApi.updateMcpSettings(true);
    const { token } = await appApi.createMcpClient("Canary agent");
    const statuses: string[] = [];
    const close = connectMcpBridge({
      runToolCall: runAgentToolCall,
      onStatus: (status) => statuses.push(status),
    });

    try {
      await vi.waitFor(() => expect(statuses).toContain("connected"));
      const response = await agentFetch(`${api.baseUrl}/mcp/ajour`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "list_projects", arguments: {} },
        }),
      });
      expect(await response.text()).toContain("Canary project");
    } finally {
      close();
    }

    const request = await waitForEvent(
      api.events,
      (event) => event.name === "agent_tool.call" && event.kind === "request",
    );
    const run = await waitForEvent(
      sink.events,
      (event) => event.name === "agent_tool.call",
    );
    const posted = await waitForEvent(
      api.events,
      (event) => event.name === "mcp_bridge.result",
    );
    expect(request).toMatchObject({
      runtime: "api",
      trigger: "agent",
      outcome: "ok",
      agent_tool: expect.objectContaining({ name: "list_projects" }),
    });
    expect(run).toMatchObject({
      kind: "job",
      runtime: "renderer",
      trigger: "agent",
      outcome: "ok",
      trace_id: request.trace_id,
      parent_span_id: request.span_id,
      agent_tool: expect.objectContaining({
        name: "list_projects",
        access: "read",
      }),
      // The result it posted back.
      counts: expect.objectContaining({ api_call_count: 1 }),
    });
    expect(posted).toMatchObject({
      runtime: "api",
      outcome: "ok",
      trace_id: request.trace_id,
      parent_span_id: run.span_id,
    });
    expect(JSON.stringify([...sink.events, ...api.events])).not.toContain(
      "Canary",
    );
  });
});
