import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import type { AjourEvent } from "../../../packages/wide-events/catalog.ts";
import { createRecordingSink } from "../../../packages/wide-events/sinks.ts";
import {
  addRepositoryFolderForServer,
  createAppApiServer,
  stopAppApiServer,
} from "./server.ts";
import { dispatchJsonRequest } from "./test-support/dispatch-json-request.ts";
import { InProcessPluginRuntime } from "./test-support/in-process-plugin-runtime.ts";
import { MemorySecretVault } from "./test-support/memory-secret-vault.ts";
import { nodeBrokerTransport } from "./test-support/node-broker-transport.ts";
import { windowServerOptions } from "./test-support/window-token.ts";

/**
 * An OpenCode-like tool: its sessions live only on a loopback HTTP server,
 * which the plugin reaches through an on-premises connection and the
 * broker. A second tool uses no connection.
 */
const MANIFEST = {
  id: "opencode",
  version: "1.0.0",
  apiVersion: 4,
  displayName: "OpenCode",
  description: "Test",
  iconSvg: "<svg/>",
  entrypoint: "plugin.mjs",
  connectionFields: [
    { id: "serverUrl", label: "Server URL", type: "url", required: true },
  ],
  network: {
    baseAddress: { field: "serverUrl", allowOnPremises: true },
    endpoints: [
      { method: "GET", path: "/global/health" },
      { method: "POST", path: "/session" },
      { method: "GET", path: "/session/*" },
    ],
  },
  capabilities: {
    handoff: {
      tools: [
        {
          id: "opencode",
          label: "OpenCode",
          iconSvg: "<svg/>",
          settings: [],
          connection: "required",
        },
        { id: "plain", label: "Plain", iconSvg: "<svg/>", settings: [] },
      ],
    },
  },
};

const PLUGIN_SOURCE = `
async function get(connection, path, method = "GET") {
  const response = await ajour.http({ connectionId: connection.id, method, path });
  if (!response.ok) throw new Error("OpenCode answered " + response.status);
  return JSON.parse(await response.text());
}
export async function validateConnection(connection) {
  const health = await get(connection, "/global/health");
  return { normalizedConfig: connection.config, connectionSummary: { version: health.version } };
}
export async function detectTools(connection) {
  if (!connection) return { tools: [{ id: "plain", available: true }] };
  const health = await get(connection, "/global/health");
  return { tools: [{ id: "opencode", available: true, version: health.version }] };
}
export async function startHandoff(...args) {
  if (args.length === 1) return { threadId: "plain-thread", native: {} };
  const [connection] = args;
  const session = await get(connection, "/session", "POST");
  return { threadId: session.id, native: { status: "busy" } };
}
export async function readHandoffStates(...args) {
  const request = args.at(-1);
  if (args.length === 1) return request.handoffs.map((h) => ({ id: h.id, state: "working", native: {} }));
  const [connection] = args;
  return Promise.all(request.handoffs.map(async (h) => {
    const session = await get(connection, "/session/" + h.threadId);
    return { id: h.id, state: session.idle ? "ready" : "working", native: { status: session.status } };
  }));
}
`;

const roots: string[] = [];
const services: Server[] = [];
afterEach(async () => {
  await Promise.all(
    services
      .splice(0)
      .map(
        (server) =>
          new Promise<void>((resolve) => server.close(() => resolve())),
      ),
  );
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

/** A loopback server that answers like OpenCode's, and records each path. */
async function openCodeServer() {
  const received: string[] = [];
  let sessions = 0;
  const server = createServer((request, response) => {
    received.push(`${request.method} ${request.url}`);
    response.writeHead(200, { "Content-Type": "application/json" });
    if (request.url === "/global/health")
      response.end(JSON.stringify({ version: "0.15.0" }));
    else if (request.url === "/session")
      response.end(JSON.stringify({ id: `ses_${++sessions}` }));
    else response.end(JSON.stringify({ idle: true, status: "idle" }));
  });
  services.push(server);
  await new Promise<void>((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve()),
  );
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}`, received };
}

async function setup() {
  const root = await mkdtemp(path.join(os.tmpdir(), "handoff-connection-"));
  roots.push(root);
  const plugin = path.join(root, "plugin");
  await mkdir(plugin);
  await mkdir(path.join(root, "repo"));
  await writeFile(path.join(plugin, "plugin.json"), JSON.stringify(MANIFEST));
  await writeFile(path.join(plugin, "plugin.mjs"), PLUGIN_SOURCE);
  const sink = createRecordingSink<AjourEvent>();
  const server = createAppApiServer({
    ...windowServerOptions,
    vault: new MemorySecretVault(),
    statePath: path.join(root, "data", "state.json"),
    installedPluginDirectory: path.join(root, "installed"),
    protectedRepositoryFolders: {
      userData: path.join(root, "data"),
      install: path.join(root, "install"),
    },
    developmentPluginDirectories: [plugin],
    projectDataShapePluginDirectories: [],
    allowDevelopmentPlugins: true,
    pluginRuntime: new InProcessPluginRuntime(),
    brokerTransport: nodeBrokerTransport(),
    brokerActivityWindowMs: 0,
    eventSink: sink,
  });
  const call = (method: string, route: string, body?: unknown) =>
    dispatchJsonRequest(server, {
      method,
      path: route,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const saveConnection = async (label: string, serverUrl: string) => {
    const saved = await call("POST", "/api/plugins/opencode/connections", {
      values: {
        label,
        tenantLabel: label,
        autoSync: false,
        autoSyncIntervalMinutes: 15,
        serverUrl,
        onPremises: true,
      },
    });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    return (saved.body as { connection: { id: string } }).connection.id;
  };
  const folder = await addRepositoryFolderForServer(
    server,
    "p",
    path.join(root, "repo"),
  );
  const input = {
    pluginId: "opencode",
    toolId: "opencode",
    workItemId: "i",
    projectId: "p",
    folderId: folder.id,
    projectName: "Project",
    item: { key: "PAY-1", title: "Title", type: "Bug", url: "" },
    settings: {},
  };
  return { server, call, saveConnection, input, sink };
}

it("detects, starts, refreshes and pauses a tool's handoffs through the connection its settings picked", async () => {
  const { server, call, saveConnection, input, sink } = await setup();
  try {
    const first = await openCodeServer();
    const second = await openCodeServer();
    const firstId = await saveConnection("First", first.url);
    const secondId = await saveConnection("Second", second.url);
    const connectionsPath = "/api/plugins/opencode/handoffs/connections";

    // Two connections and no pick: the tool is missing, with what to do.
    expect((await call("GET", connectionsPath)).body).toEqual({});
    const unpicked = await call(
      "POST",
      "/api/plugins/opencode/handoffs/detect",
      {
        projectId: "p",
      },
    );
    expect(unpicked.body).toEqual({
      tools: [
        { id: "plain", available: true },
        {
          id: "opencode",
          available: false,
          reason:
            "Pick a connection for OpenCode in its settings on the plugin's page.",
        },
      ],
    });
    expect((await call("POST", "/api/handoffs", input)).status).toBe(409);

    // The tool's settings pick the second server.
    expect(
      (await call("POST", connectionsPath, { opencode: "missing" })).status,
    ).toBe(400);
    expect(
      (await call("POST", connectionsPath, { opencode: secondId })).body,
    ).toEqual({ opencode: secondId });
    expect((await call("GET", connectionsPath)).body).toEqual({
      opencode: secondId,
    });
    const detected = await call(
      "POST",
      "/api/plugins/opencode/handoffs/detect",
      { projectId: "p" },
    );
    expect(detected.body).toEqual({
      tools: [
        { id: "plain", available: true },
        { id: "opencode", available: true, version: "0.15.0" },
      ],
    });

    const picked = await call("POST", "/api/handoffs", input);
    expect(picked.status, JSON.stringify(picked.body)).toBe(200);
    expect(picked.body).toMatchObject({
      connectionId: secondId,
      threadId: "ses_1",
    });
    const named = await call("POST", "/api/handoffs", {
      ...input,
      connectionId: firstId,
    });
    expect(named.body).toMatchObject({ connectionId: firstId });
    const plain = await call("POST", "/api/handoffs", {
      ...input,
      toolId: "plain",
    });
    expect(plain.status).toBe(200);
    expect(plain.body).not.toHaveProperty("connectionId");
    expect(
      (
        await call("POST", "/api/handoffs", {
          ...input,
          toolId: "plain",
          connectionId: firstId,
        })
      ).status,
    ).toBe(409);

    // Each server is asked only about its own sessions.
    const refreshed = await call("POST", "/api/handoffs/refresh");
    expect(refreshed.status).toBe(200);
    expect(first.received.filter((r) => r.startsWith("GET /session/"))).toEqual(
      ["GET /session/ses_1"],
    );
    expect(
      second.received.filter((r) => r.startsWith("GET /session/")),
    ).toEqual(["GET /session/ses_1"]);

    // Deleting the second connection pauses its handoff, and only it.
    expect(
      (await call("DELETE", `/api/plugins/opencode/connections/${secondId}`))
        .status,
    ).toBe(200);
    expect((await call("GET", connectionsPath)).body).toEqual({});
    const after = await call("POST", "/api/handoffs/refresh");
    expect(after.body).toMatchObject({
      failures: [
        {
          toolId: "opencode",
          connectionId: secondId,
          reason: "The connection this handoff ran through was deleted.",
        },
      ],
    });
    const records = (await call("GET", "/api/handoffs")).body as Array<{
      connectionId?: string;
      state: string;
      paused?: { reason: string };
    }>;
    expect(
      records.map((record) => [
        record.connectionId,
        record.state,
        record.paused?.reason,
      ]),
    ).toEqual([
      [
        secondId,
        "unknown",
        "The connection this handoff ran through was deleted.",
      ],
      [firstId, "ready", undefined],
      [undefined, "working", undefined],
    ]);
    // Events name the connection's id, never its address.
    expect(JSON.stringify(sink.events)).not.toContain(first.url);
  } finally {
    await stopAppApiServer(server);
  }
});
