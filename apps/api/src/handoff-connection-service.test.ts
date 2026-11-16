import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { Handoffs, HandoffRefused } from "./handoffs.ts";
import { AppApiStorage } from "./storage.ts";
import type {
  ReadHandoffStatesRequest,
  StartHandoffRequest,
} from "../../../packages/shared/handoffs.ts";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

interface Call {
  method: string;
  connection?: string;
  tool?: string;
  ids?: string[];
}

/**
 * A plugin with `opencode`, which hands off through a connection, and `t3`,
 * which uses none, over real storage and a recording plugin port.
 */
async function setup() {
  const root = await mkdtemp(path.join(os.tmpdir(), "handoff-connections-"));
  roots.push(root);
  const storage = new AppApiStorage(path.join(root, "state.json"));
  const folder = await storage.addRepositoryFolder("p", root, "Repo");
  const connectionInput = (label: string) => ({
    label,
    tenantLabel: label,
    autoSync: false,
    autoSyncIntervalMinutes: 15,
    onPremises: true,
    config: { serverUrl: "http://127.0.0.1:4096" },
    configSummary: {},
  });
  const first = await storage.upsertConnection(
    "tools",
    connectionInput("First"),
  );
  const second = await storage.upsertConnection(
    "tools",
    connectionInput("Second"),
  );
  const calls: Call[] = [];
  let now = 1000;
  const service = new Handoffs({
    storage,
    now: () => now,
    onChange: () => undefined,
    connection: async (pluginId, connectionId) => {
      const saved = await storage.getConnection(pluginId, connectionId);
      return saved
        ? {
            id: saved.id,
            pluginId: saved.pluginId,
            label: saved.label,
            tenantLabel: saved.tenantLabel,
            autoSync: saved.autoSync,
            autoSyncIntervalMinutes: saved.autoSyncIntervalMinutes,
            connectedAt: saved.connectedAt,
            config: saved.config,
          }
        : undefined;
    },
    plugins: {
      async listPlugins() {
        return [
          {
            id: "tools",
            capabilities: {
              handoff: {
                tools: [
                  {
                    id: "opencode",
                    label: "OpenCode",
                    connection: "required" as const,
                  },
                  { id: "t3", label: "T3", connection: "none" as const },
                ],
              },
            },
          },
        ];
      },
      async detectTools(_pluginId, _projectId, connection) {
        calls.push({
          method: "detectTools",
          ...(connection ? { connection: connection.id } : {}),
        });
        if (connection?.id === second.id) throw new Error("Server is down.");
        return {
          tools: connection
            ? [
                { id: "opencode", available: true, version: connection.label },
                // Detection with a connection answers only for its tools.
                { id: "t3", available: false },
              ]
            : [
                { id: "t3", available: true },
                { id: "opencode", available: true },
              ],
        };
      },
      async startHandoff(
        _pluginId,
        request: StartHandoffRequest,
        _projectId,
        connection,
      ) {
        calls.push({
          method: "startHandoff",
          tool: request.tool,
          ...(connection ? { connection: connection.id } : {}),
        });
        return { threadId: `${request.tool}-session`, native: {} };
      },
      async readHandoffStates(
        _pluginId,
        request: ReadHandoffStatesRequest,
        _projectId,
        connection,
      ) {
        calls.push({
          method: "readHandoffStates",
          tool: request.tool,
          ids: request.handoffs.map((h) => h.id),
          ...(connection ? { connection: connection.id } : {}),
        });
        return request.handoffs.map((h) => ({
          id: h.id,
          state: "ready" as const,
          native: {},
        }));
      },
    },
  });
  const input = {
    pluginId: "tools",
    toolId: "opencode",
    projectId: "p",
    folderId: folder.id,
    workItemId: "item",
    projectName: "Project",
    item: { key: "PAY-12", title: "Title", type: "Bug", url: "" },
    settings: {},
  };
  return {
    storage,
    service,
    calls,
    input,
    first,
    second,
    tick: (ms: number) => {
      now += ms;
    },
  };
}

it("starts through the connection the tool's settings picked, and keeps it on the record", async () => {
  const { storage, service, calls, input, first, second } = await setup();
  await expect(service.start(input)).rejects.toThrow(
    "Pick a connection for OpenCode",
  );
  await storage.setHandoffToolConnections("tools", { opencode: second.id });
  expect(await storage.getHandoffToolConnections("tools")).toEqual({
    opencode: second.id,
  });
  const picked = await service.start(input);
  expect(picked.connectionId).toBe(second.id);
  // The start route may name the connection itself.
  const named = await service.start({ ...input, connectionId: first.id });
  expect(named.connectionId).toBe(first.id);
  expect(calls).toEqual([
    { method: "startHandoff", tool: "opencode", connection: second.id },
    { method: "startHandoff", tool: "opencode", connection: first.id },
  ]);
  expect(
    (await storage.listHandoffs()).map((record) => record.connectionId),
  ).toEqual([second.id, first.id]);
});

it("refuses a connection that isn't the plugin's, or one for a tool that uses none", async () => {
  const { service, input, calls } = await setup();
  await expect(
    service.start({ ...input, connectionId: "missing" }),
  ).rejects.toThrow("no longer exists");
  await expect(
    service.start({ ...input, toolId: "t3", connectionId: "missing" }),
  ).rejects.toBeInstanceOf(HandoffRefused);
  expect(calls).toEqual([]);
});

it("starts a tool without a connection exactly as before", async () => {
  const { storage, service, calls, input } = await setup();
  const record = await service.start({ ...input, toolId: "t3" });
  expect(record.connectionId).toBeUndefined();
  expect(calls).toEqual([{ method: "startHandoff", tool: "t3" }]);
  expect(JSON.stringify(await storage.listHandoffs())).not.toContain(
    "connectionId",
  );
});

it("uses the plugin's only connection when the tool's settings picked none", async () => {
  const { storage, service, input, second } = await setup();
  await storage.deleteConnection("tools", second.id);
  const record = await service.start(input);
  expect(record.connectionId).toBeDefined();
  expect(record.connectionId).not.toBe(second.id);
});

it("detects each tool with the connection its settings picked", async () => {
  const { storage, service, calls, first } = await setup();
  expect(await service.detect("tools", "p")).toEqual({
    tools: [
      { id: "t3", available: true },
      {
        id: "opencode",
        available: false,
        reason:
          "Pick a connection for OpenCode in its settings on the plugin's page.",
      },
    ],
  });
  await storage.setHandoffToolConnections("tools", { opencode: first.id });
  calls.length = 0;
  expect(await service.detect("tools", "p")).toEqual({
    tools: [
      { id: "t3", available: true },
      { id: "opencode", available: true, version: "First" },
    ],
  });
  expect(calls).toEqual([
    { method: "detectTools" },
    { method: "detectTools", connection: first.id },
  ]);
});

it("reports a connection's failed detection on its own tools only", async () => {
  const { storage, service, second } = await setup();
  await storage.setHandoffToolConnections("tools", { opencode: second.id });
  expect(await service.detect("tools", "p")).toEqual({
    tools: [
      { id: "t3", available: true },
      { id: "opencode", available: false, reason: "Server is down." },
    ],
  });
});

it("batches refreshes per connection, and each batch reads through its own", async () => {
  const { service, calls, input, first, second } = await setup();
  const a = await service.start({ ...input, connectionId: first.id });
  const b = await service.start({ ...input, connectionId: second.id });
  const c = await service.start({ ...input, connectionId: first.id });
  const d = await service.start({ ...input, toolId: "t3" });
  calls.length = 0;
  const result = await service.refresh();
  expect(result.failures).toEqual([]);
  expect(calls).toEqual([
    {
      method: "readHandoffStates",
      tool: "opencode",
      ids: [a.id, c.id],
      connection: first.id,
    },
    {
      method: "readHandoffStates",
      tool: "opencode",
      ids: [b.id],
      connection: second.id,
    },
    { method: "readHandoffStates", tool: "t3", ids: [d.id] },
  ]);
});

it("pauses a deleted connection's handoffs as unknown with a reason, and leaves the others", async () => {
  const { storage, service, calls, input, first, second, tick } = await setup();
  const gone = await service.start({ ...input, connectionId: second.id });
  const kept = await service.start({ ...input, connectionId: first.id });
  await storage.deleteConnection("tools", second.id);
  calls.length = 0;
  await service.refreshConnection("tools", second.id);
  expect(calls).toEqual([]);
  const records = await storage.listHandoffs();
  const paused = records.find((record) => record.id === gone.id)!;
  expect(paused.state).toBe("unknown");
  expect(paused.paused?.reason).toBe(
    "The connection this handoff ran through was deleted.",
  );
  expect(records.find((record) => record.id === kept.id)?.paused).toBe(
    undefined,
  );

  // The paused batch stays paused, without a plugin read, and is reported.
  tick(200_000);
  const manual = await service.refresh();
  expect(calls).toEqual([
    {
      method: "readHandoffStates",
      tool: "opencode",
      ids: [kept.id],
      connection: first.id,
    },
  ]);
  expect(manual.failures).toEqual([
    {
      pluginId: "tools",
      toolId: "opencode",
      projectId: "p",
      connectionId: second.id,
      reason: "The connection this handoff ran through was deleted.",
    },
  ]);
});

it("forgets a deleted connection as a tool's pick", async () => {
  const { storage, first, second } = await setup();
  await storage.setHandoffToolConnections("tools", { opencode: second.id });
  await storage.deleteConnection("tools", second.id);
  expect(await storage.getHandoffToolConnections("tools")).toEqual({});
  await expect(
    storage.setHandoffToolConnections("tools", { opencode: "missing" }),
  ).rejects.toThrow();
  await storage.setHandoffToolConnections("tools", { opencode: first.id });
  expect(await storage.getHandoffToolConnections("tools")).toEqual({
    opencode: first.id,
  });
});
