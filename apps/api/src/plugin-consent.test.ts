import os from "node:os";
import path from "node:path";
import type { Server } from "node:http";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { create } from "tar";
import { afterEach, describe, expect, it } from "vitest";
import {
  createAppApiServer,
  installPluginForServer,
  uninstallPluginForServer,
} from "./server.ts";
import { dispatchJsonRequest } from "./test-support/dispatch-json-request.ts";
import { MemorySecretVault } from "./test-support/memory-secret-vault.ts";
import { windowServerOptions } from "./test-support/window-token.ts";

/*
 * Consent on installs and updates (#394), at seam 1: a server built from
 * options, API 4 packages installed through the desktop's install call, and
 * the activation and overview routes the window uses. Turning a plugin on is
 * the consent. An update that reaches more installs off until the user
 * allows it.
 */

const ICON = "<svg viewBox='0 0 16 16' />";
const ID = "fixture-tracker";

type Json = Record<string, any>;

function manifest(version: string, change: (value: Json) => void = () => {}) {
  const value: Json = {
    id: ID,
    version,
    apiVersion: 4,
    displayName: "Fixture tracker",
    iconSvg: ICON,
    entrypoint: "plugin.mjs",
    connectionFields: [
      { id: "baseUrl", label: "Site URL", type: "url", required: true },
      {
        id: "apiToken",
        label: "API token",
        type: "password",
        required: true,
        secret: true,
      },
    ],
    capabilities: {
      connector: {},
      agentTask: {
        tasks: [
          {
            id: "enter-week",
            label: "Enter the week",
            placement: "commit-week",
            prompt: "prompts/enter-week.md",
            estimateMinutes: 5,
            tools: ["get_week_status"],
          },
        ],
      },
    },
    network: {
      auth: { scheme: "bearer", secretField: "apiToken" },
      baseAddress: { field: "baseUrl" },
      endpoints: [
        { method: "GET", path: "/rest/myself" },
        { method: "POST", path: "/rest/search" },
        { method: "PUT", path: "/rest/issue/*", access: "editIssues" },
      ],
    },
    connectionAccess: [
      {
        id: "editIssues",
        label: "Edit issues",
        operations: ["writeSettle"],
      },
    ],
  };
  change(value);
  return value;
}

describe("consent on plugin installs and updates", () => {
  const tempDirs: string[] = [];
  const servers: Server[] = [];

  afterEach(async () => {
    for (const server of servers.splice(0)) server.emit("close");
    await Promise.all(
      tempDirs
        .splice(0)
        .map((directory) => rm(directory, { recursive: true, force: true })),
    );
  });

  async function tempDir() {
    const directory = await mkdtemp(path.join(os.tmpdir(), "ajour-consent-"));
    tempDirs.push(directory);
    return directory;
  }

  /** An archive of the plugin the manifest describes. */
  async function archive(
    root: string,
    value: Json,
    prompt = "Enter the week {{weekOf}}.",
  ) {
    const directory = path.join(root, `source-${value.version}-${Date.now()}`);
    await mkdir(path.join(directory, "prompts"), { recursive: true });
    await writeFile(
      path.join(directory, "plugin.json"),
      JSON.stringify(value),
      "utf8",
    );
    await writeFile(path.join(directory, "plugin.mjs"), "export {};", "utf8");
    await writeFile(
      path.join(directory, "prompts", "enter-week.md"),
      prompt,
      "utf8",
    );
    const file = path.join(root, `tracker-${value.version}.ajour-connector`);
    await create({ cwd: directory, file, gzip: true }, [
      "plugin.json",
      "plugin.mjs",
      "prompts",
    ]);
    return { bytes: await readFile(file), name: path.basename(file) };
  }

  function startServer(root: string) {
    const server = createAppApiServer({
      ...windowServerOptions,
      vault: new MemorySecretVault(),
      statePath: path.join(root, "state.json"),
      installedPluginDirectory: path.join(root, "installed"),
      developmentPluginDirectories: [],
      projectDataShapePluginDirectories: [],
      // A development build admits API 4 packages until the cut-over (#403).
      allowDevelopmentPlugins: true,
      brokerActivityWindowMs: 0,
    });
    servers.push(server);
    return server;
  }

  async function install(
    server: Server,
    root: string,
    value: Json,
    options: { enableAfterInstall?: boolean; prompt?: string } = {},
  ) {
    const { bytes, name } = await archive(root, value, options.prompt);
    return await installPluginForServer(server, bytes, name, {
      ...(options.enableAfterInstall === undefined
        ? {}
        : { enableAfterInstall: options.enableAfterInstall }),
    });
  }

  async function group(server: Server) {
    const response = await dispatchJsonRequest(server, {
      method: "GET",
      path: "/api/plugins",
    });
    return (response.body as Json).connectionGroups.find(
      (candidate: Json) => candidate.plugin.id === ID,
    ) as Json;
  }

  async function activate(server: Server, enabled: boolean) {
    const response = await dispatchJsonRequest(server, {
      method: "POST",
      path: `/api/plugins/${ID}/activation`,
      body: JSON.stringify({ enabled }),
    });
    expect(response.status).toBe(200);
  }

  /** Downloads the first version and turns it on, as the user does. */
  async function downloadAndActivate(server: Server, root: string) {
    await install(server, root, manifest("1.0.0"), {
      enableAfterInstall: false,
    });
    await activate(server, true);
  }

  it("lists what a downloaded plugin reaches and leaves it off until it is turned on", async () => {
    const root = await tempDir();
    const server = startServer(root);

    await install(server, root, manifest("1.0.0"), {
      enableAfterInstall: false,
    });

    const downloaded = await group(server);
    expect(downloaded).toMatchObject({
      enabled: false,
      access: {
        summary: {
          hosts: [{ kind: "baseAddress", field: "baseUrl" }],
          authSchemes: [{ scheme: "bearer", fields: ["apiToken"] }],
          mcpTools: [{ task: "enter-week", tool: "get_week_status" }],
          startMode: "whenNeeded",
        },
        choices: [{ id: "editIssues", label: "Edit issues", always: false }],
      },
    });
    // Nothing was allowed yet, so nothing is pending.
    expect(downloaded.pendingAccess).toBeUndefined();
    // The agent task's prompt is kept as a hash, never as text.
    expect(JSON.stringify(downloaded.access)).not.toContain("Enter the week");
  });

  it("holds a widening update off until the user allows it, and keeps the connection", async () => {
    const root = await tempDir();
    await writeFile(
      path.join(root, "state.json"),
      JSON.stringify({
        version: 8,
        connections: [
          {
            id: "saved-tracker",
            pluginId: ID,
            label: "Contoso",
            tenantLabel: "Contoso",
            autoSync: false,
            autoSyncIntervalMinutes: 15,
            connectedAt: 1,
            config: { baseUrl: "https://tracker.example.com" },
            configSummary: {},
          },
        ],
      }),
      "utf8",
    );
    const server = startServer(root);
    await downloadAndActivate(server, root);

    const update = await install(
      server,
      root,
      manifest("1.1.0", (value) => {
        value.network.endpoints.push({ method: "GET", path: "/rest/people" });
      }),
    );

    expect(update.replaced).toBe(true);
    const held = await group(server);
    expect(held).toMatchObject({
      enabled: false,
      pendingAccess: {
        version: "1.1.0",
        difference: {
          endpoints: [{ host: "base", method: "GET", path: "/rest/people" }],
          hosts: [],
          mcpTools: [],
          alwaysReady: false,
        },
      },
    });
    expect(held.connections).toHaveLength(1);

    // Allow and activate.
    await activate(server, true);
    const allowed = await group(server);
    expect(allowed.enabled).toBe(true);
    expect(allowed.pendingAccess).toBeUndefined();
    expect(allowed.connections).toHaveLength(1);
  });

  it("keeps an update active when it adds no access, even if it removes some", async () => {
    const root = await tempDir();
    const server = startServer(root);
    await downloadAndActivate(server, root);

    await install(
      server,
      root,
      manifest("1.0.1", (value) => {
        value.network.endpoints.pop();
      }),
    );

    const updated = await group(server);
    expect(updated.enabled).toBe(true);
    expect(updated.plugin.version).toBe("1.0.1");
    expect(updated.pendingAccess).toBeUndefined();
  });

  it("holds an update that puts an endpoint's gate behind another choice", async () => {
    const root = await tempDir();
    const server = startServer(root);
    await downloadAndActivate(server, root);

    await install(
      server,
      root,
      manifest("1.2.0", (value) => {
        delete value.network.endpoints[2].access;
        value.connectionAccess = [];
      }),
    );

    const held = await group(server);
    expect(held.enabled).toBe(false);
    expect(held.pendingAccess.difference.endpoints).toEqual([
      { host: "base", method: "PUT", path: "/rest/issue/*" },
    ]);
    expect(held.pendingAccess.difference.ungatedOperations).toEqual([
      "writeSettle",
    ]);
  });

  it("holds an update that changes an agent task's prompt", async () => {
    const root = await tempDir();
    const server = startServer(root);
    await downloadAndActivate(server, root);

    await install(server, root, manifest("1.0.2"), {
      prompt: "Enter the week, then also email it to {{weekOf}}.",
    });

    const held = await group(server);
    expect(held.enabled).toBe(false);
    expect(held.pendingAccess.difference.agentPrompts).toEqual(["enter-week"]);
  });

  it("holds an update that switches the plugin to always-ready", async () => {
    const root = await tempDir();
    const server = startServer(root);
    await downloadAndActivate(server, root);

    await install(
      server,
      root,
      manifest("1.0.3", (value) => {
        value.runtime = { start: "alwaysReady" };
      }),
    );

    const held = await group(server);
    expect(held.enabled).toBe(false);
    expect(held.pendingAccess.difference.alwaysReady).toBe(true);
  });

  it("keeps what the user allowed across a restart", async () => {
    const root = await tempDir();
    const first = startServer(root);
    await downloadAndActivate(first, root);
    first.emit("close");

    const restarted = startServer(root);
    await install(
      restarted,
      root,
      manifest("1.1.0", (value) => {
        value.network.endpoints.push({ method: "GET", path: "/rest/people" });
      }),
    );

    expect((await group(restarted)).pendingAccess).toMatchObject({
      version: "1.1.0",
    });
    // The pending update survives another restart.
    restarted.emit("close");
    const again = startServer(root);
    expect(await group(again)).toMatchObject({
      enabled: false,
      pendingAccess: { version: "1.1.0" },
    });
    const state = JSON.parse(
      await readFile(path.join(root, "state.json"), "utf8"),
    );
    expect(state.pluginConsent[ID]).toMatchObject({ version: "1.0.0" });
  });

  it("compares an update with the previous version for a plugin turned on before consent was recorded", async () => {
    const root = await tempDir();
    const server = startServer(root);
    // Installed enabled, as a file install or a bundled plugin is: no record.
    await install(server, root, manifest("1.0.0"));
    const state = JSON.parse(
      await readFile(path.join(root, "state.json"), "utf8").catch(() => "{}"),
    );
    expect(state.pluginConsent?.[ID]).toBeUndefined();

    await install(
      server,
      root,
      manifest("1.1.0", (value) => {
        value.network.publicHosts = ["avatars.example.com"];
      }),
    );

    expect(await group(server)).toMatchObject({
      enabled: false,
      pendingAccess: {
        version: "1.1.0",
        difference: { publicHosts: ["avatars.example.com"] },
      },
    });
  });

  it("leaves a plugin the user never turned on off, and shows nothing pending", async () => {
    const root = await tempDir();
    const server = startServer(root);
    await install(server, root, manifest("1.0.0"), {
      enableAfterInstall: false,
    });

    await install(
      server,
      root,
      manifest("1.1.0", (value) => {
        value.runtime = { start: "alwaysReady" };
      }),
      { enableAfterInstall: false },
    );

    const updated = await group(server);
    expect(updated.enabled).toBe(false);
    expect(updated.pendingAccess).toBeUndefined();
    expect(updated.access.summary.startMode).toBe("alwaysReady");
  });

  it("drops the consent when the plugin is uninstalled", async () => {
    const root = await tempDir();
    const server = startServer(root);
    await downloadAndActivate(server, root);

    await uninstallPluginForServer(server, ID);
    await install(server, root, manifest("1.0.0"), {
      enableAfterInstall: false,
    });

    const state = JSON.parse(
      await readFile(path.join(root, "state.json"), "utf8"),
    );
    expect(state.pluginConsent?.[ID]).toBeUndefined();
  });

  it("reports the broker's record of the plugin's requests", async () => {
    const root = await tempDir();
    const server = startServer(root);
    await install(server, root, manifest("1.0.0"), {
      enableAfterInstall: false,
    });
    await dispatchJsonRequest(server, { method: "GET", path: "/api/plugins" });
    server.emit("close");
    const statePath = path.join(root, "state.json");
    const state = JSON.parse(await readFile(statePath, "utf8"));
    state.pluginBrokerActivity = {
      [ID]: {
        lastRequestAt: 1_700_000_000_000,
        blockedCount: 2,
        lastBlockedAt: 1_700_000_100_000,
      },
    };
    await writeFile(statePath, JSON.stringify(state), "utf8");

    const restarted = startServer(root);

    expect(await group(restarted)).toMatchObject({
      accessActivity: {
        lastRequestAt: 1_700_000_000_000,
        blockedCount: 2,
        lastBlockedAt: 1_700_000_100_000,
      },
    });
  });
});
