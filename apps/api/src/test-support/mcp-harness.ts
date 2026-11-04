import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import type {
  BridgeToolCall,
  BridgeToolResult,
} from "../../../../packages/shared/agent-tools.ts";
import { startAppApiServer, stopAppApiServer } from "../server.ts";
import { TEST_WINDOW_TOKEN, windowTokenHeader } from "./window-token.ts";

/**
 * A real local API with a fake Ajour window on its MCP bridge, for clients
 * of the MCP endpoint that live outside apps/api, such as the terminal.
 */

const TEST_ORIGIN = "http://127.0.0.1:5173";

export interface TestApi {
  baseUrl: string;
  /** Calls an /api route the way the Ajour window does. */
  windowRequest(pathname: string, body?: unknown): Promise<TestResponse>;
  stop(): Promise<void>;
}

interface TestResponse {
  status: number;
  body: any;
}

/**
 * Starts the API on a free port, with a temporary state file. With
 * `statePath` and `port`, a test can stop Ajour and start it again where it
 * was, with the same clients; the caller then owns that state file.
 */
export async function startTestApi(
  options: { port?: number; statePath?: string; appVersion?: string } = {},
): Promise<TestApi> {
  const root = await mkdtemp(path.join(os.tmpdir(), "ajour-mcp-harness-"));
  const server = await startAppApiServer({
    port: options.port ?? 0,
    launch: { appVersion: options.appVersion },
    statePath: options.statePath ?? path.join(root, "state.json"),
    installedPluginDirectory: path.join(root, "installed"),
    allowDevelopmentPlugins: false,
    projectDataShapePluginDirectories: [],
    allowedOrigins: [TEST_ORIGIN],
    windowToken: TEST_WINDOW_TOKEN,
    eventSink: { emit: () => undefined },
  });
  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;
  return {
    baseUrl,
    windowRequest: (pathname, body) => windowRequest(baseUrl, pathname, body),
    async stop() {
      await stopAppApiServer(server);
      await rm(root, { recursive: true, force: true });
    },
  };
}

async function windowRequest(
  baseUrl: string,
  pathname: string,
  body?: unknown,
): Promise<TestResponse> {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      ...windowTokenHeader,
      Origin: TEST_ORIGIN,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

/** Turns MCP on and creates an agent client, as Settings › MCP does. */
export async function enableMcpWithClient(api: TestApi, name = "Terminal") {
  await api.windowRequest("/api/mcp/settings", { enabled: true });
  const created = await api.windowRequest("/api/mcp/clients", { name });
  return created.body as {
    client: { id: string; name: string };
    token: string;
  };
}

export type FakeToolHandler = (
  call: BridgeToolCall,
) => BridgeToolResult | undefined;

/**
 * A fake Ajour window: opens the bridge stream and answers each tool call
 * with `handle`. Resolves once the stream is open, so calls made after it
 * reach the fake window.
 */
export async function openFakeWindow(api: TestApi, handle: FakeToolHandler) {
  const controller = new AbortController();
  const response = await fetch(`${api.baseUrl}/api/mcp/bridge`, {
    headers: { ...windowTokenHeader, Origin: TEST_ORIGIN },
    signal: controller.signal,
  });
  if (!response.ok || !response.body) {
    throw new Error(`The bridge answered ${response.status}.`);
  }
  const calls: BridgeToolCall[] = [];
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
          if (event !== "tool-call" || data === undefined) continue;
          const call = JSON.parse(data) as BridgeToolCall;
          calls.push(call);
          const result = handle(call);
          if (result) {
            await api.windowRequest("/api/mcp/bridge/results", result);
          }
        }
      }
    } catch {
      // Closed by the test.
    }
  })();
  return {
    calls,
    async close() {
      controller.abort();
      await ended;
    },
  };
}
