import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { secretManifestOf } from "./connection-credentials.ts";
import { handoffConnectionAddress } from "./handoff-connection-address.ts";
import { PluginManager } from "./plugin-host.ts";
import { pluginApi4ManifestSchema } from "../../../packages/shared/plugin-api-4.ts";
import { ProcessBroker } from "./process-broker.ts";
import { FolderResolver } from "./repository-folders.ts";
import { AppApiStorage } from "./storage.ts";
import { InProcessPluginRuntime } from "./test-support/in-process-plugin-runtime.ts";

// Reopening a handoff runs its resume command in a terminal through the real
// process broker. Only the terminal launch is replaced, so the test reads the
// argv the terminal would get.
const launched = vi.hoisted(() => [] as string[][]);
vi.mock("./process-launch.ts", async (actual) => ({
  ...(await actual<typeof import("./process-launch.ts")>()),
  launchProcess: async (plan: { args: string[] }) => {
    launched.push(plan.args);
  },
}));

const roots: string[] = [];
afterEach(async () => {
  launched.length = 0;
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

/**
 * An OpenCode-like plugin: its tool reaches a server through a connection,
 * and a thread reopens with `opencode attach <url> -s <id> --dir <folder>`.
 */
async function setup() {
  const root = await mkdtemp(path.join(os.tmpdir(), "handoff-open-conn-"));
  roots.push(root);
  const directory = path.join(root, "plugin");
  await mkdir(directory);
  const manifest = {
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
    network: { baseAddress: { field: "serverUrl", allowOnPremises: true } },
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
        ],
      },
    },
    processes: {
      executables: { opencode: { names: ["opencode"] } },
      commands: [
        {
          id: "attach",
          executable: "opencode",
          args: [
            "attach",
            "{server:connection-url}",
            "-s",
            "{session:id}",
            "--dir",
            "{dir:folder}",
          ],
          mode: "terminal",
        },
      ],
      openSchemes: [],
    },
  };
  await writeFile(
    path.join(directory, "plugin.json"),
    JSON.stringify(manifest),
  );
  await writeFile(path.join(directory, "plugin.mjs"), "export {};\n");
  const storage = new AppApiStorage(path.join(root, "state.json"));
  const repository = path.join(root, "repo");
  await mkdir(repository);
  const folder = await storage.addRepositoryFolder("p", repository, "Repo");
  const connection = await storage.upsertConnection(
    "tools",
    {
      label: "Local OpenCode",
      tenantLabel: "",
      autoSync: false,
      autoSyncIntervalMinutes: 15,
      onPremises: true,
      config: { serverUrl: "http://127.0.0.1:4096" },
      configSummary: {},
    },
    {
      fields: secretManifestOf(pluginApi4ManifestSchema.parse(manifest))
        .connectionFields,
    },
  );
  const manager = new PluginManager({
    runtime: new InProcessPluginRuntime(),
    installedPluginDirectory: path.join(root, "installed"),
    allowDevelopmentPlugins: true,
    developmentPluginDirectories: [directory],
    processBroker: new ProcessBroker({
      folders: new FolderResolver(storage, {}),
      gate: async () => undefined,
      executableOverride: async () => process.execPath,
      connectionAddress: (caller) => handoffConnectionAddress(storage, caller),
    }),
  });
  return { manager, connection, folder };
}

it("reopens a thread of a tool that uses a connection with its connection's address", async () => {
  const { manager, connection, folder } = await setup();
  try {
    await manager.openHandoff("tools", "p", {
      toolId: "opencode",
      connectionId: connection.id,
      resume: { command: "attach", args: { session: "ses_123" } },
      folderId: folder.id,
    });
    expect(launched).toHaveLength(1);
    expect(launched[0]!.slice(-6, -1)).toEqual([
      "attach",
      "http://127.0.0.1:4096",
      "-s",
      "ses_123",
      "--dir",
    ]);
  } finally {
    await manager.shutdown();
  }
});

it("refuses to reopen a record without a connection once its tool needs one", async () => {
  const { manager, folder } = await setup();
  try {
    for (const target of [
      { resume: { command: "attach", args: { session: "ses_123" } } },
      { link: "https://example.test/session/ses_123" },
    ])
      await expect(
        manager.openHandoff("tools", "p", {
          toolId: "opencode",
          folderId: folder.id,
          ...target,
        }),
      ).rejects.toMatchObject({
        reason: "not_supported",
        message:
          "This tool now hands off through a connection. Start a new handoff.",
      });
    expect(launched).toEqual([]);
  } finally {
    await manager.shutdown();
  }
});
