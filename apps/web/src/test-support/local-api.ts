import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import type { AjourEvent } from "@ajour/wide-events/catalog.ts";
import {
  createRecordingSink,
  fanOut,
  type Sink,
} from "@ajour/wide-events/sinks.ts";
import {
  startAppApiServer,
  stopAppApiServer,
} from "../../../api/src/server.ts";
import { WINDOW_TOKEN_HEADER } from "../../../api/src/window-token.ts";
import { MemorySecretVault } from "../../../api/src/test-support/memory-secret-vault.ts";

/*
 * The real local API, started on a free port with a temporary state file
 * and a recording sink, for tests that follow a trace from the renderer into
 * it. Each test stops its API with the returned `stop`.
 */

const ICON = "<svg viewBox='0 0 16 16'><path d='M0 0h16v16H0z' /></svg>";

/** The Ajour window's origin, which the API allows. */
const APP_ORIGIN = "http://127.0.0.1:5173";

/** The window token the test API starts with. */
const WINDOW_TOKEN = "test-window-token";

/**
 * Node's fetch, sending the Ajour window's origin as a browser would and
 * adding the window token to `/api` requests as Electron main does: stub it
 * as the global `fetch` for the renderer's calls.
 */
const nodeFetch = globalThis.fetch;
export const fetchAsTheApp: typeof fetch = (input, init) => {
  const headers = new Headers(init?.headers);
  headers.set("Origin", APP_ORIGIN);
  const url = new URL(input instanceof Request ? input.url : input.toString());
  if (url.pathname.startsWith("/api/")) {
    headers.set(WINDOW_TOKEN_HEADER, WINDOW_TOKEN);
  }
  return nodeFetch(input, { ...init, headers });
};

/** The `jira` plugin's code. */
const pluginSource = `
export async function validateConnection(config) {
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
`;

/** A development plugin the test API loads: its manifest's own parts and its code. */
export interface TestPlugin {
  id: string;
  displayName: string;
  capabilities: Record<string, unknown>;
  connectionFields: Record<string, unknown>[];
  source: string;
}

/** The `jira` development plugin: its connections sync one backlog item. */
const JIRA: TestPlugin = {
  id: "jira",
  displayName: "Jira",
  capabilities: { connector: {} },
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
  source: pluginSource,
};

async function writePlugin(root: string, plugin: TestPlugin) {
  const directory = path.join(root, "plugins", plugin.id);
  await mkdir(directory, { recursive: true });
  await writeFile(
    path.join(directory, "plugin.json"),
    JSON.stringify({
      id: plugin.id,
      version: "1.0.0",
      apiVersion: 3,
      displayName: plugin.displayName,
      description: "Test plugin.",
      iconSvg: ICON,
      entrypoint: "plugin.mjs",
      capabilities: plugin.capabilities,
      connectionFields: plugin.connectionFields,
    }),
  );
  await writeFile(path.join(directory, "plugin.mjs"), plugin.source);
  return directory;
}

/**
 * Starts the local API with a development plugin: `jira`, unless `plugin`
 * names another. Its events are recorded, and also go to `eventSink` when
 * given, as desktop main gives it the shared sink. `launch` is the launch it
 * reports, as main hands it over.
 */
export async function startLocalApi({
  plugin = JIRA,
  eventSink,
  launch,
}: {
  plugin?: TestPlugin;
  eventSink?: Sink;
  launch?: { id: string; appVersion: string; packaged: boolean };
} = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "ajour-web-trace-"));
  const sink = createRecordingSink<AjourEvent>();
  const server = await startAppApiServer({
    port: 0,
    statePath: path.join(root, "state.json"),
    installedPluginDirectory: path.join(root, "installed"),
    developmentPluginDirectories: [await writePlugin(root, plugin)],
    allowDevelopmentPlugins: true,
    projectDataShapePluginDirectories: [],
    allowedOrigins: [APP_ORIGIN],
    windowToken: WINDOW_TOKEN,
    eventSink: eventSink ? fanOut(sink, eventSink) : sink,
    ...(launch ? { launch } : {}),
    // The desktop app's vault, in memory: the standalone API holds no secret.
    vault: new MemorySecretVault(),
  });
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    /** The folder the API keeps its state in: what its events scrub as user data. */
    userDataPath: root,
    events: sink.events,
    async stop() {
      await stopAppApiServer(server);
      await rm(root, { recursive: true, force: true });
    },
  };
}

/** Resolves once `find` finds what it looks for in `events`. */
export async function waitForEvent(
  events: readonly AjourEvent[],
  find: (event: AjourEvent) => boolean,
): Promise<AjourEvent> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const found = events.find(find);
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("The event never came.");
}

/**
 * The browser's EventSource, which Node lacks, enough for the MCP bridge: it
 * reads one stream with fetch and dispatches its named events.
 */
export class FetchEventSource {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;
  readyState = FetchEventSource.CONNECTING;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  private readonly listeners = new Map<
    string,
    ((message: { data: string }) => void)[]
  >();
  private readonly controller = new AbortController();

  constructor(url: string) {
    void this.read(url);
  }

  addEventListener(
    name: string,
    listener: (message: { data: string }) => void,
  ) {
    this.listeners.set(name, [...(this.listeners.get(name) ?? []), listener]);
  }

  close() {
    this.readyState = FetchEventSource.CLOSED;
    this.controller.abort();
  }

  private async read(url: string) {
    try {
      const response = await fetchAsTheApp(url, {
        signal: this.controller.signal,
      });
      if (!response.ok || !response.body) throw new Error("No stream.");
      this.readyState = FetchEventSource.OPEN;
      this.onopen?.();
      const reader = response.body
        .pipeThrough(new TextDecoderStream())
        .getReader();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        let boundary = buffer.indexOf("\n\n");
        while (boundary >= 0) {
          const raw = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          boundary = buffer.indexOf("\n\n");
          const event = raw.match(/^event: (.+)$/m)?.[1];
          const data = raw.match(/^data: (.+)$/m)?.[1];
          if (!event || data === undefined) continue;
          for (const listener of this.listeners.get(event) ?? []) {
            listener({ data });
          }
        }
      }
    } catch {
      // Closed by the test.
    }
    if (this.readyState !== FetchEventSource.CLOSED) {
      this.readyState = FetchEventSource.CLOSED;
      this.onerror?.();
    }
  }
}
