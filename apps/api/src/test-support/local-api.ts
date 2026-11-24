import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import type { AjourEvent } from "../../../../packages/wide-events/catalog.ts";
import { createRecordingSink } from "../../../../packages/wide-events/sinks.ts";
import { startAppApiServer, stopAppApiServer } from "../server.ts";
import { TEST_WINDOW_TOKEN, windowTokenHeader } from "./window-token.ts";

/** The renderer's origin in development, which the test API allows. */
export const TEST_ORIGIN = "http://127.0.0.1:5173";

export type LocalApiOptions = Omit<
  Parameters<typeof startAppApiServer>[0] & object,
  "port" | "statePath"
> & {
  /** A state file to start from, such as one a crash left. Defaults to a new one. */
  statePath?: string;
};

/**
 * Starts a real local API on a free port, with a temporary state file and a
 * recording sink. `stop` stops it and removes its folder.
 */
export async function startLocalApi(options: LocalApiOptions = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "ajour-local-api-"));
  const sink = createRecordingSink<AjourEvent>();
  const server = await startAppApiServer({
    port: 0,
    statePath: options.statePath ?? path.join(root, "state.json"),
    installedPluginDirectory: path.join(root, "installed"),
    allowDevelopmentPlugins: false,
    projectDataShapePluginDirectories: [],
    allowedOrigins: [TEST_ORIGIN],
    windowToken: TEST_WINDOW_TOKEN,
    eventSink: sink,
    ...options,
  });
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    /** Every event the API emitted so far. */
    events: sink.events,
    stop: async () => {
      await stopAppApiServer(server);
      await rm(root, { recursive: true, force: true, maxRetries: 5 });
    },
  };
}

/** Calls an /api route the way the renderer does: a POST when `body` is given. */
export async function apiRequest(
  baseUrl: string,
  pathname: string,
  body?: unknown,
) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      ...windowTokenHeader,
      Origin: TEST_ORIGIN,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  // Each test reads its own route's body.
  return { status: response.status, body: (await response.json()) as any };
}

export interface StreamEvent {
  event: string;
  data: unknown;
}

/**
 * Opens the window's event stream at `endpoint` and records its events.
 * `waitFor` resolves with the first event named `name` that `matches`,
 * whether it already came or comes later.
 */
export async function openEventStream(baseUrl: string, endpoint: string) {
  const controller = new AbortController();
  const response = await fetch(`${baseUrl}${endpoint}`, {
    headers: { ...windowTokenHeader, Origin: TEST_ORIGIN },
    signal: controller.signal,
  });
  if (!response.ok || !response.body) {
    throw new Error(`${endpoint} answered ${response.status}.`);
  }
  const events: StreamEvent[] = [];
  const listeners = new Set<() => void>();
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  void (async () => {
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
          events.push({ event, data: JSON.parse(data) as unknown });
          listeners.forEach((listener) => listener());
        }
      }
    } catch {
      // Closed by the test.
    }
  })();

  function waitFor<Data = unknown>(
    name: string,
    matches: (data: Data) => boolean = () => true,
  ): Promise<Data> {
    return new Promise((resolve) => {
      const check = () => {
        const match = events.find(
          (event) => event.event === name && matches(event.data as Data),
        );
        if (!match) return;
        listeners.delete(check);
        resolve(match.data as Data);
      };
      listeners.add(check);
      check();
    });
  }

  return { events, waitFor, close: () => controller.abort() };
}
