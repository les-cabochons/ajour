import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { PluginManager } from "./plugin-host.ts";
import type { BrokerCaller } from "./broker-port.ts";
import { InProcessPluginRuntime } from "./test-support/in-process-plugin-runtime.ts";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

const connection = {
  id: "c1",
  pluginId: "tools",
  label: "Local OpenCode",
  tenantLabel: "Local",
  autoSync: false,
  autoSyncIntervalMinutes: 15,
  connectedAt: 1,
  config: { serverUrl: "http://127.0.0.1:4096" },
};

const startRequest = (tool: string) => ({
  tool,
  folder: { id: "f", name: "Repo" },
  title: "Title",
  prompt: "Prompt",
  item: { key: "KEY", url: "" },
  settings: {},
});

/**
 * A plugin with two tools: `opencode` reaches its server through a
 * connection, `t3` uses none. Each export records the arguments it got.
 */
async function setup() {
  const root = await mkdtemp(path.join(os.tmpdir(), "handoff-connection-"));
  roots.push(root);
  const directory = path.join(root, "plugin");
  await mkdir(directory);
  await writeFile(
    path.join(directory, "plugin.json"),
    JSON.stringify({
      id: "tools",
      version: "1.0.0",
      apiVersion: 4,
      displayName: "Tools",
      description: "Test",
      iconSvg: "<svg/>",
      entrypoint: "plugin.mjs",
      connectionFields: [
        { id: "serverUrl", label: "Server URL", type: "url", required: true },
      ],
      network: {
        baseAddress: { field: "serverUrl", allowOnPremises: true },
        endpoints: [{ method: "GET", path: "/session/*" }],
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
            { id: "t3", label: "T3", iconSvg: "<svg/>", settings: [] },
          ],
        },
      },
      processes: {
        executables: { probe: { names: ["probe"] } },
        commands: [
          { id: "probe", executable: "probe", args: [], mode: "capture" },
        ],
      },
    }),
  );
  await writeFile(
    path.join(directory, "plugin.mjs"),
    `
const seen = (globalThis.__handoffConnectionSeen ??= []);
const probe = () => ajour.process.run({ command: 'probe', args: {} });
export async function detectTools(...args) {
  seen.push(['detectTools', ...args]);
  await probe();
  return { tools: args[0] ? [{ id: 'opencode', available: true }] : [{ id: 't3', available: true }] };
}
export async function startHandoff(...args) {
  seen.push(['startHandoff', ...args]);
  await probe();
  return { threadId: 'session', native: {} };
}
export async function readHandoffStates(...args) {
  seen.push(['readHandoffStates', ...args]);
  const request = args.at(-1);
  return request.handoffs.map(h => ({ id: h.id, state: 'ready', native: {} }));
}
`,
  );
  const callers: BrokerCaller[] = [];
  const manager = new PluginManager({
    runtime: new InProcessPluginRuntime(),
    installedPluginDirectory: path.join(root, "installed"),
    allowDevelopmentPlugins: true,
    developmentPluginDirectories: [directory],
    processBroker: {
      forOperation(caller) {
        callers.push(caller);
        return {
          async open() {},
          async run() {
            return { exitCode: 0, stdout: "", stderr: "" };
          },
          close() {},
        };
      },
    },
  });
  const seen = () =>
    (globalThis as { __handoffConnectionSeen?: unknown[][] })
      .__handoffConnectionSeen ?? [];
  delete (globalThis as { __handoffConnectionSeen?: unknown })
    .__handoffConnectionSeen;
  return { manager, callers, seen };
}

it("passes the connection first to every operation of a tool that uses one", async () => {
  const { manager, callers, seen } = await setup();
  try {
    expect(await manager.detectTools("tools", "p", connection)).toMatchObject({
      tools: [{ id: "opencode", available: true }],
    });
    await manager.startHandoff(
      "tools",
      startRequest("opencode"),
      "p",
      connection,
    );
    const request = {
      tool: "opencode",
      handoffs: [{ id: "h", threadId: "session", folderId: "f", native: {} }],
    };
    await manager.readHandoffStates("tools", request, "p", connection);

    const visible = {
      id: "c1",
      pluginId: "tools",
      config: { serverUrl: "http://127.0.0.1:4096" },
      access: [],
    };
    expect(seen()).toEqual([
      ["detectTools", expect.objectContaining(visible)],
      [
        "startHandoff",
        expect.objectContaining(visible),
        expect.objectContaining({ tool: "opencode" }),
      ],
      [
        "readHandoffStates",
        expect.objectContaining(visible),
        expect.objectContaining({ tool: "opencode" }),
      ],
    ]);
    // Process calls made during these operations may fill connection-url.
    expect(
      callers.map((caller) => [caller.method, caller.connectionId]),
    ).toEqual([
      ["detectTools", "c1"],
      ["startHandoff", "c1"],
      ["readHandoffStates", "c1"],
    ]);
  } finally {
    await manager.shutdown();
  }
});

it("calls a tool without a connection exactly as before", async () => {
  const { manager, callers, seen } = await setup();
  try {
    await manager.detectTools("tools", "p");
    await manager.startHandoff("tools", startRequest("t3"), "p");
    await manager.readHandoffStates(
      "tools",
      {
        tool: "t3",
        handoffs: [{ id: "h", threadId: "t", folderId: "f", native: {} }],
      },
      "p",
    );
    expect(seen().map((entry) => entry.length)).toEqual([1, 2, 2]);
    expect(seen()[1]?.[1]).toMatchObject({ tool: "t3" });
    expect(callers.every((caller) => caller.connectionId === undefined)).toBe(
      true,
    );
  } finally {
    await manager.shutdown();
  }
});

it("refuses a tool's operation without the connection it needs, or with one it doesn't use", async () => {
  const { manager, seen } = await setup();
  try {
    await expect(
      manager.startHandoff("tools", startRequest("opencode"), "p"),
    ).rejects.toThrow("needs a connection");
    await expect(
      manager.readHandoffStates(
        "tools",
        {
          tool: "opencode",
          handoffs: [{ id: "h", threadId: "t", folderId: "f", native: {} }],
        },
        "p",
      ),
    ).rejects.toThrow("needs a connection");
    await expect(
      manager.startHandoff("tools", startRequest("t3"), "p", connection),
    ).rejects.toThrow("uses no connection");
    await expect(
      manager.startHandoff("tools", startRequest("opencode"), "p", {
        ...connection,
        pluginId: "other",
      }),
    ).rejects.toThrow("another plugin");
    expect(seen()).toEqual([]);
  } finally {
    await manager.shutdown();
  }
});
