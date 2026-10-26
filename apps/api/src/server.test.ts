import os from "node:os";
import path from "node:path";
import type { Server } from "node:http";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { create } from "tar";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AjourEvent } from "../../../packages/wide-events/catalog.ts";
import { createRecordingSink } from "../../../packages/wide-events/sinks.ts";
import {
  createAppApiServer,
  installPluginForServer,
  uninstallPluginForServer,
} from "./server.ts";
import { InProcessPluginRuntime } from "./test-support/in-process-plugin-runtime.ts";
import { MemorySecretVault } from "./test-support/memory-secret-vault.ts";
import { dispatchJsonRequest } from "./test-support/dispatch-json-request.ts";
import { windowServerOptions } from "./test-support/window-token.ts";

const ICON = "<svg viewBox='0 0 16 16'><path d='M0 0h16v16H0z' /></svg>";

async function createPlugin(
  parent: string,
  source: string,
  entrypoint = "plugin.mjs",
  manifestExtras: Record<string, unknown> = {},
) {
  const pluginDirectory = path.join(parent, "jira");
  await mkdir(pluginDirectory, { recursive: true });
  await writeFile(
    path.join(pluginDirectory, "plugin.json"),
    JSON.stringify({
      id: "jira",
      version: "1.0.0",
      apiVersion: 3,
      displayName: "Jira",
      description: "Test connector.",
      iconSvg: ICON,
      entrypoint,
      capabilities: { connector: {} },
      connectionFields: [
        {
          id: "label",
          label: "Connection label",
          type: "text",
          required: true,
        },
        {
          id: "tenantLabel",
          label: "Workspace",
          type: "text",
          required: true,
        },
        {
          id: "baseUrl",
          label: "Site URL",
          type: "url",
          required: true,
        },
      ],
      ...manifestExtras,
    }),
    "utf8",
  );
  await writeFile(path.join(pluginDirectory, entrypoint), source, "utf8");
  return pluginDirectory;
}

const projectDataShapePluginSource = [
  "export async function exportProjects(projects) {",
  "  return { datasets: [{ id: 'projects', rows: projects.map((project) => ({ project: project.name })) }] };",
  "}",
  "export async function importProjects(sheets) {",
  "  return { projects: sheets[0].rows.map((row) => ({ name: row[0], color: '#123456', status: 'active', tasks: [] })) };",
  "}",
].join("\n");

async function createProjectDataShapePlugin(
  parent: string,
  source = projectDataShapePluginSource,
) {
  const pluginDirectory = path.join(parent, "workday-project-data");
  await mkdir(pluginDirectory, { recursive: true });
  await writeFile(
    path.join(pluginDirectory, "plugin.json"),
    JSON.stringify({
      id: "workday-project-data",
      version: "1.0.0",
      apiVersion: 1,
      displayName: "Workday",
      description: "Test project data shape.",
      iconSvg: ICON,
      entrypoint: "plugin.mjs",
      capabilities: {
        projectDataShape: {
          apiVersion: 1,
          datasets: [
            {
              id: "projects",
              displayName: "Projects",
              columns: [
                {
                  key: "project",
                  header: "project",
                  type: "string",
                  required: true,
                },
              ],
            },
          ],
        },
      },
    }),
    "utf8",
  );
  await writeFile(path.join(pluginDirectory, "plugin.mjs"), source, "utf8");
  return pluginDirectory;
}

describe("plugin installation boundary", () => {
  const tempDirs: string[] = [];
  const servers: Server[] = [];

  async function tempDir() {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), "ajour-plugin-api-"),
    );
    tempDirs.push(directory);
    return directory;
  }

  afterEach(async () => {
    for (const server of servers.splice(0)) {
      server.emit("close");
    }
    await Promise.all(
      tempDirs
        .splice(0)
        .map((directory) => rm(directory, { recursive: true, force: true })),
    );
  });

  it("installs and uninstalls a packaged plugin through desktop-owned capabilities", async () => {
    const root = await tempDir();
    const pluginDirectory = await createPlugin(
      path.join(root, "source"),
      [
        "export async function validateConnection(config) {",
        "  return { normalizedConfig: config, connectionSummary: {} };",
        "}",
        "export async function syncConnection() {",
        "  return { items: [], workItemUpdates: [] };",
        "}",
      ].join("\n"),
    );
    const archivePath = path.join(root, "jira-1.0.0.ajour-connector");
    await create(
      {
        cwd: pluginDirectory,
        file: archivePath,
        gzip: true,
      },
      ["plugin.json", "plugin.mjs"],
    );
    const server = createAppApiServer({
      ...windowServerOptions,
      vault: new MemorySecretVault(),
      statePath: path.join(root, "state.json"),
      installedPluginDirectory: path.join(root, "installed"),
      allowDevelopmentPlugins: false,
    });
    servers.push(server);

    const archiveBytes = await readFile(archivePath);
    const response = await installPluginForServer(
      server,
      archiveBytes,
      path.basename(archivePath),
      { enableAfterInstall: false },
    );

    expect(response).toMatchObject({
      plugin: {
        id: "jira",
        version: "1.0.0",
      },
      replaced: false,
      overview: {
        plugins: [expect.objectContaining({ id: "jira" })],
        connectionGroups: [expect.objectContaining({ enabled: false })],
      },
    });

    const uninstallResponse = await uninstallPluginForServer(server, "jira");
    expect(uninstallResponse).toMatchObject({
      pluginId: "jira",
      overview: {
        plugins: [],
        connectionGroups: [],
      },
    });
    await expect(
      access(path.join(root, "installed", "jira")),
    ).rejects.toThrow();
  });

  it.each([true, false])(
    "updates an outdated package, preserves its connections, and holds it off for consent when it was on (on=%s)",
    async (enabled) => {
      const root = await tempDir();
      const installedRoot = path.join(root, "installed");
      const source = "export async function validateConnection() {}";
      await createPlugin(installedRoot, source, "plugin.mjs", {
        apiVersion: 2,
      });
      const statePath = path.join(root, "state.json");
      const savedConnection = {
        id: "saved-jira",
        pluginId: "jira",
        label: "My Jira",
        tenantLabel: "My workspace",
        autoSync: true,
        autoSyncIntervalMinutes: 30,
        connectedAt: 1,
        config: {
          baseUrl: "https://jira.example.com",
          token: "fixture-secret",
        },
        configSummary: { baseUrl: "https://jira.example.com" },
      };
      await writeFile(
        statePath,
        JSON.stringify({
          version: 7,
          connections: [savedConnection],
          disabledPluginIds: enabled ? [] : ["jira"],
          pluginsEnabled: true,
        }),
      );
      const pluginDirectory = await createPlugin(
        path.join(root, "source"),
        source,
      );
      const archivePath = path.join(root, "jira-1.0.0.ajour-connector");
      await create({ cwd: pluginDirectory, file: archivePath, gzip: true }, [
        "plugin.json",
        "plugin.mjs",
      ]);
      const server = createAppApiServer({
        ...windowServerOptions,
        vault: new MemorySecretVault(),
        statePath,
        installedPluginDirectory: installedRoot,
        allowDevelopmentPlugins: false,
      });
      servers.push(server);

      const before = await dispatchJsonRequest(server, {
        method: "GET",
        path: "/api/plugins",
      });
      expect(before.body).toMatchObject({
        connectionGroups: [
          {
            plugin: {
              id: "jira",
              version: "1.0.0",
              unavailableReason: expect.stringContaining(
                "Update the plugin to use it again.",
              ),
            },
            enabled: false,
          },
        ],
      });

      const update = await installPluginForServer(
        server,
        await readFile(archivePath),
        path.basename(archivePath),
        { enableAfterInstall: false },
      );

      expect(update.replaced).toBe(true);
      // The version replaced couldn't run, so nothing was allowed: a plugin
      // left on waits for the user to allow everything the update reaches,
      // and one left off stays off with nothing pending (#394).
      expect(update.overview.connectionGroups).toEqual([
        expect.objectContaining({
          plugin: expect.not.objectContaining({
            unavailableReason: expect.anything(),
          }),
          enabled: false,
        }),
      ]);
      expect(update.overview.connectionGroups[0]?.pendingAccess).toEqual(
        enabled
          ? expect.objectContaining({
              version: "1.0.0",
              difference: expect.objectContaining({
                capabilities: ["connector"],
              }),
            })
          : undefined,
      );
      expect(update.overview.connectionGroups[0]?.connections).toMatchObject([
        {
          id: savedConnection.id,
          label: savedConnection.label,
          autoSync: true,
        },
      ]);
      const savedState = JSON.parse(await readFile(statePath, "utf8"));
      // Its config was checked against the manifest, which doesn't declare
      // `token`: an undeclared value moves into the vault like a secret.
      expect(savedState.connections).toEqual([
        {
          ...savedConnection,
          config: { baseUrl: savedConnection.config.baseUrl },
          secrets: { fields: ["token"] },
          // Version 9 starts every connection reading only.
          access: [],
        },
      ]);
      expect(savedState.disabledPluginIds).toEqual(["jira"]);
    },
  );

  it.each([
    {
      added: "connector",
      before: { codeHost: {} },
      saved: { autoSync: true },
      // Auto sync was the pull requests' choice; backlog items stage for review.
      after: { autoSync: false, pullRequestAutoSync: true },
    },
    {
      added: "codeHost",
      before: { connector: {} },
      saved: { autoSync: false },
      // Auto sync stays the backlog items' choice; pull requests start at the default.
      after: { autoSync: false, pullRequestAutoSync: true },
    },
  ])(
    "starts the $added capability an update adds turned off and keeps each connection's sync choices",
    async ({ added, before, saved, after }) => {
      const root = await tempDir();
      const installedRoot = path.join(root, "installed");
      const statePath = path.join(root, "state.json");
      const source = "export async function validateConnection() {}";
      await createPlugin(installedRoot, source, "plugin.mjs", {
        capabilities: before,
      });
      await writeFile(
        statePath,
        JSON.stringify({
          version: 7,
          connections: [
            {
              id: "saved-jira",
              pluginId: "jira",
              label: "My Jira",
              tenantLabel: "My workspace",
              autoSyncIntervalMinutes: 15,
              connectedAt: 1,
              config: { baseUrl: "https://jira.example.com" },
              configSummary: {},
              ...saved,
            },
          ],
          disabledPluginIds: [],
          pluginsEnabled: true,
        }),
      );
      const pluginDirectory = await createPlugin(
        path.join(root, "source"),
        source,
        "plugin.mjs",
        { version: "1.1.0", capabilities: { connector: {}, codeHost: {} } },
      );
      const archivePath = path.join(root, "jira-1.1.0.ajour-connector");
      await create({ cwd: pluginDirectory, file: archivePath, gzip: true }, [
        "plugin.json",
        "plugin.mjs",
      ]);
      const server = createAppApiServer({
        ...windowServerOptions,
        vault: new MemorySecretVault(),
        statePath,
        installedPluginDirectory: installedRoot,
        allowDevelopmentPlugins: false,
      });
      servers.push(server);

      const update = await installPluginForServer(
        server,
        await readFile(archivePath),
        path.basename(archivePath),
      );

      expect(update.replaced).toBe(true);
      expect(update.overview.connectionGroups).toEqual([
        expect.objectContaining({
          // A new capability is more access, so the update waits for consent.
          enabled: false,
          pendingAccess: expect.objectContaining({
            difference: expect.objectContaining({ capabilities: [added] }),
          }),
          inactiveCapabilities: [added],
          connections: [expect.objectContaining(after)],
        }),
      ]);
    },
  );

  it("does not expose plugin package changes through the loopback HTTP server", async () => {
    const root = await tempDir();
    const server = createAppApiServer({
      ...windowServerOptions,
      vault: new MemorySecretVault(),
      statePath: path.join(root, "state.json"),
      installedPluginDirectory: path.join(root, "installed"),
      allowDevelopmentPlugins: false,
    });
    servers.push(server);

    const response = await dispatchJsonRequest(server, {
      method: "POST",
      path: "/api/plugins/plugins/install",
      headers: {
        "Content-Type": "application/octet-stream",
      },
      body: Buffer.from("untrusted-archive"),
    });

    expect(response).toEqual({
      status: 404,
      body: {
        error: "No route for POST /api/plugins/plugins/install",
      },
    });

    const uninstallResponse = await dispatchJsonRequest(server, {
      method: "DELETE",
      path: "/api/plugins/plugins/jira",
    });
    expect(uninstallResponse).toEqual({
      status: 404,
      body: {
        error: "No route for DELETE /api/plugins/plugins/jira",
      },
    });
  });

  it("records a signed install's origin and deactivates unsigned plugins on request", async () => {
    const root = await tempDir();
    const source = [
      "export async function validateConnection(config) {",
      "  return { normalizedConfig: config, connectionSummary: {} };",
      "}",
    ].join("\n");
    const server = createAppApiServer({
      ...windowServerOptions,
      statePath: path.join(root, "state.json"),
      installedPluginDirectory: path.join(root, "installed"),
      allowDevelopmentPlugins: false,
    });
    servers.push(server);
    async function archiveOf(id: string) {
      const directory = await createPlugin(
        path.join(root, "source", id),
        source,
        "plugin.mjs",
        { id },
      );
      const archivePath = path.join(root, `${id}-1.0.0.ajour-connector`);
      await create({ cwd: directory, file: archivePath, gzip: true }, [
        "plugin.json",
        "plugin.mjs",
      ]);
      return readFile(archivePath);
    }
    const signedOrigin = {
      kind: "source" as const,
      signed: true,
      sourceUrl: "https://github.com/les-cabochons/ajour-plugins",
      sourceName: "Ajour official plugins",
      official: true,
      keyFingerprint: "3f2a 9c1d 77e0 b4a2",
      commit: "888d80ba3fa8d53889011f03a5ab7848b0e06328",
      installedAt: "2026-10-24T12:00:00.000Z",
    };

    await installPluginForServer(
      server,
      await archiveOf("jira"),
      "jira-1.0.0.ajour-connector",
      { origin: signedOrigin },
    );
    const fileInstall = await installPluginForServer(
      server,
      await archiveOf("local"),
      "local-1.0.0.ajour-connector",
    );

    expect(fileInstall.overview.plugins).toMatchObject([
      { id: "jira", origin: signedOrigin },
      { id: "local", origin: { kind: "file", signed: false } },
    ]);
    await expect(
      dispatchJsonRequest(server, {
        method: "POST",
        path: "/api/plugins/unsigned-activation",
        body: JSON.stringify({ enabled: false }),
      }),
    ).resolves.toMatchObject({
      status: 200,
      body: {
        unsignedPluginsEnabled: false,
        connectionGroups: [
          { plugin: { id: "jira" }, enabled: true },
          { plugin: { id: "local" }, enabled: false },
        ],
      },
    });
  });

  it("deactivates the plugin system and hides data-shape plugins", async () => {
    const root = await tempDir();
    const server = createAppApiServer({
      ...windowServerOptions,
      vault: new MemorySecretVault(),
      statePath: path.join(root, "state.json"),
      installedPluginDirectory: path.join(root, "installed"),
      projectDataShapePluginDirectories: [],
      allowDevelopmentPlugins: false,
    });
    servers.push(server);

    await expect(
      dispatchJsonRequest(server, {
        method: "POST",
        path: "/api/plugins/activation",
        body: JSON.stringify({ enabled: false }),
      }),
    ).resolves.toMatchObject({
      status: 200,
      body: { pluginsEnabled: false },
    });
    await expect(
      dispatchJsonRequest(server, {
        method: "GET",
        path: "/api/project-data-shapes",
      }),
    ).resolves.toEqual({
      status: 200,
      body: { plugins: [] },
    });
  });

  it("lists and invokes project data shape plugins through validated routes", async () => {
    const root = await tempDir();
    const pluginDirectory = await createProjectDataShapePlugin(root);
    const server = createAppApiServer({
      ...windowServerOptions,
      vault: new MemorySecretVault(),
      statePath: path.join(root, "state.json"),
      installedPluginDirectory: path.join(root, "installed"),
      projectDataShapePluginDirectories: [pluginDirectory],
      allowDevelopmentPlugins: false,
    });
    servers.push(server);

    await expect(
      dispatchJsonRequest(server, {
        method: "GET",
        path: "/api/project-data-shapes",
      }),
    ).resolves.toMatchObject({
      status: 200,
      body: {
        plugins: [{ id: "workday-project-data", displayName: "Workday" }],
      },
    });

    await expect(
      dispatchJsonRequest(server, {
        method: "POST",
        path: "/api/project-data-shapes/workday-project-data/export",
        body: JSON.stringify({
          projects: [
            {
              name: "Mercury",
              color: "#123456",
              status: "active",
              tasks: [],
            },
          ],
        }),
      }),
    ).resolves.toEqual({
      status: 200,
      body: {
        datasets: [{ id: "projects", rows: [{ project: "Mercury" }] }],
      },
    });

    await expect(
      dispatchJsonRequest(server, {
        method: "POST",
        path: "/api/project-data-shapes/workday-project-data/import",
        body: JSON.stringify({
          sheets: [{ name: "Projects", rows: [["Mercury"]] }],
        }),
      }),
    ).resolves.toEqual({
      status: 200,
      body: {
        projects: [
          {
            name: "Mercury",
            color: "#123456",
            status: "active",
            tasks: [],
          },
        ],
      },
    });
  });

  it("reads data shapes from the development plugin directories, as the plugin host does", async () => {
    const root = await tempDir();
    const shapeDirectory = await createProjectDataShapePlugin(root);
    const options = {
      ...windowServerOptions,
      vault: new MemorySecretVault(),
      statePath: path.join(root, "state.json"),
      installedPluginDirectory: path.join(root, "installed"),
      developmentPluginDirectories: [shapeDirectory],
    };
    const development = createAppApiServer({
      ...options,
      allowDevelopmentPlugins: true,
    });
    servers.push(development);
    const packaged = createAppApiServer({
      ...options,
      allowDevelopmentPlugins: false,
    });
    servers.push(packaged);

    await expect(
      dispatchJsonRequest(development, {
        method: "GET",
        path: "/api/project-data-shapes",
      }),
    ).resolves.toMatchObject({
      status: 200,
      body: { plugins: [{ id: "workday-project-data" }] },
    });
    await expect(
      dispatchJsonRequest(packaged, {
        method: "GET",
        path: "/api/project-data-shapes",
      }),
    ).resolves.toEqual({ status: 200, body: { plugins: [] } });
  });

  it("refuses a data shape that takes the id of a plugin from another folder", async () => {
    const root = await tempDir();
    const pluginDirectory = await createPlugin(
      path.join(root, "source"),
      "export async function validateConnection(config) { return { normalizedConfig: config, connectionSummary: {} }; }",
    );
    const shapeDirectory = await createProjectDataShapePlugin(root);
    const manifestPath = path.join(shapeDirectory, "plugin.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    await writeFile(manifestPath, JSON.stringify({ ...manifest, id: "jira" }));
    const server = createAppApiServer({
      ...windowServerOptions,
      vault: new MemorySecretVault(),
      statePath: path.join(root, "state.json"),
      installedPluginDirectory: path.join(root, "installed"),
      developmentPluginDirectories: [pluginDirectory, shapeDirectory],
      allowDevelopmentPlugins: true,
    });
    servers.push(server);

    await expect(
      dispatchJsonRequest(server, {
        method: "GET",
        path: "/api/project-data-shapes",
      }),
    ).resolves.toEqual({ status: 200, body: { plugins: [] } });
    await expect(
      dispatchJsonRequest(server, {
        method: "POST",
        path: "/api/project-data-shapes/jira/export",
        body: JSON.stringify({ projects: [] }),
      }),
    ).resolves.toMatchObject({
      status: 400,
      body: { error: expect.stringContaining("shares its id") },
    });
  });

  it("runs both hosts' plugins through the runtime it is given", async () => {
    const root = await tempDir();
    const pluginDirectory = await createPlugin(
      path.join(root, "source"),
      [
        "export async function validateConnection(config) {",
        "  return { normalizedConfig: config, connectionSummary: { site: config.baseUrl } };",
        "}",
      ].join("\n"),
    );
    const shapeDirectory = await createProjectDataShapePlugin(root);
    const inProcess = new InProcessPluginRuntime();
    const started: string[] = [];
    const server = createAppApiServer({
      ...windowServerOptions,
      vault: new MemorySecretVault(),
      statePath: path.join(root, "state.json"),
      installedPluginDirectory: path.join(root, "installed"),
      developmentPluginDirectories: [pluginDirectory],
      projectDataShapePluginDirectories: [shapeDirectory],
      allowDevelopmentPlugins: true,
      pluginRuntime: {
        start(invocation) {
          started.push(`${invocation.pluginId}.${invocation.method}`);
          return inProcess.start(invocation);
        },
      },
    });
    servers.push(server);

    await expect(
      dispatchJsonRequest(server, {
        method: "POST",
        path: "/api/plugins/jira/connections",
        body: JSON.stringify({
          values: {
            label: "Main Jira",
            tenantLabel: "Acme",
            autoSync: false,
            autoSyncIntervalMinutes: 15,
            baseUrl: "https://acme.atlassian.net",
          },
        }),
      }),
    ).resolves.toMatchObject({ status: 200 });
    await expect(
      dispatchJsonRequest(server, {
        method: "POST",
        path: "/api/project-data-shapes/workday-project-data/export",
        body: JSON.stringify({
          projects: [
            { name: "Mercury", color: "#123456", status: "active", tasks: [] },
          ],
        }),
      }),
    ).resolves.toEqual({
      status: 200,
      body: { datasets: [{ id: "projects", rows: [{ project: "Mercury" }] }] },
    });
    expect(started).toEqual([
      "jira.validateConnection",
      "workday-project-data.exportProjects",
    ]);
  });

  it("rejects browser requests from untrusted origins", async () => {
    const root = await tempDir();
    const server = createAppApiServer({
      ...windowServerOptions,
      vault: new MemorySecretVault(),
      statePath: path.join(root, "state.json"),
      installedPluginDirectory: path.join(root, "installed"),
      allowDevelopmentPlugins: false,
      allowedOrigins: ["app://local"],
    });
    servers.push(server);

    await expect(
      dispatchJsonRequest(server, {
        method: "POST",
        path: "/api/plugins/jira/activation",
        headers: { Origin: "https://attacker.example" },
        body: JSON.stringify({ enabled: false }),
      }),
    ).resolves.toEqual({
      status: 403,
      body: { error: "Request origin is not allowed." },
    });
  });

  it("does not broaden allowed origins when development plugins are enabled", async () => {
    const root = await tempDir();
    const server = createAppApiServer({
      ...windowServerOptions,
      vault: new MemorySecretVault(),
      statePath: path.join(root, "state.json"),
      installedPluginDirectory: path.join(root, "installed"),
      allowDevelopmentPlugins: true,
      allowedOrigins: ["http://127.0.0.1:5173"],
    });
    servers.push(server);

    await expect(
      dispatchJsonRequest(server, {
        method: "GET",
        path: "/api/health",
        headers: { Origin: "http://127.0.0.1:5173" },
      }),
    ).resolves.toEqual({
      status: 200,
      body: { ok: true },
    });

    await expect(
      dispatchJsonRequest(server, {
        method: "GET",
        path: "/api/health",
        headers: { Origin: "http://127.0.0.1:9999" },
      }),
    ).resolves.toEqual({
      status: 403,
      body: { error: "Request origin is not allowed." },
    });
  });

  it("rejects DNS-rebinding host headers", async () => {
    const root = await tempDir();
    const server = createAppApiServer({
      ...windowServerOptions,
      vault: new MemorySecretVault(),
      statePath: path.join(root, "state.json"),
      installedPluginDirectory: path.join(root, "installed"),
      allowDevelopmentPlugins: false,
    });
    servers.push(server);

    await expect(
      dispatchJsonRequest(server, {
        method: "GET",
        path: "/api/plugins",
        headers: { Host: "attacker.example:8787" },
      }),
    ).resolves.toEqual({
      status: 403,
      body: { error: "Request host is not allowed." },
    });
  });

  it("persists plugin activation and blocks sync while inactive", async () => {
    const root = await tempDir();
    const pluginDirectory = await createPlugin(
      path.join(root, "source"),
      [
        "export async function validateConnection(config) {",
        "  return { normalizedConfig: config, connectionSummary: { site: config.baseUrl } };",
        "}",
        "export async function syncConnection() {",
        "  return { items: [], workItemUpdates: [] };",
        "}",
      ].join("\n"),
    );
    const server = createAppApiServer({
      ...windowServerOptions,
      vault: new MemorySecretVault(),
      statePath: path.join(root, "state.json"),
      installedPluginDirectory: path.join(root, "installed"),
      developmentPluginDirectories: [pluginDirectory],
      allowDevelopmentPlugins: true,
    });
    servers.push(server);

    const connectionResponse = await dispatchJsonRequest(server, {
      method: "POST",
      path: "/api/plugins/jira/connections",
      body: JSON.stringify({
        values: {
          label: "Main Jira",
          tenantLabel: "Acme",
          autoSync: false,
          autoSyncIntervalMinutes: 15,
          baseUrl: "https://acme.atlassian.net",
        },
      }),
    });
    expect(connectionResponse.status).toBe(200);
    const connectionId = (
      connectionResponse.body as { connection: { id: string } }
    ).connection.id;

    const deactivated = await dispatchJsonRequest(server, {
      method: "POST",
      path: "/api/plugins/jira/activation",
      body: JSON.stringify({ enabled: false }),
    });
    expect(deactivated).toMatchObject({
      status: 200,
      body: {
        connectionGroups: [
          {
            plugin: expect.objectContaining({ id: "jira" }),
            enabled: false,
          },
        ],
      },
    });

    await expect(
      dispatchJsonRequest(server, {
        method: "POST",
        path: `/api/plugins/jira/connections/${connectionId}/sync`,
        body: JSON.stringify({ trigger: "manual", workItems: [] }),
      }),
    ).resolves.toEqual({
      status: 409,
      body: {
        error: "Activate this plugin before syncing.",
      },
    });
  });
});

describe("backlog settle routes", () => {
  const tempDirs: string[] = [];
  const servers: Server[] = [];

  afterEach(async () => {
    for (const server of servers.splice(0)) {
      server.emit("close");
    }
    await Promise.all(
      tempDirs
        .splice(0)
        .map((directory) => rm(directory, { recursive: true, force: true })),
    );
  });

  const settlePluginSource = [
    "export async function validateConnection(config) {",
    "  return { normalizedConfig: config, connectionSummary: {} };",
    "}",
    "const item = (sourceId, state, stateDone) => ({",
    "  source: 'jira', connectionId: 'ignored', connectionLabel: 'Main Jira',",
    "  tenantLabel: 'Acme', sourceId, externalId: sourceId, title: sourceId,",
    "  workItemType: 'Task', state, stateDone, depth: 0, selectable: true, childCount: 0,",
    "  description: { text: `About ${sourceId}` },",
    "});",
    "export async function syncConnection(connection, workItems) {",
    "  return {",
    "    items: [item('OPEN-1', 'In Progress', false), item('DONE-1', 'Done', true)]",
    "      .map((candidate) => ({ ...candidate, connectionId: connection.id })),",
    "    workItemUpdates: [],",
    "    viewer: { id: 'me', displayName: 'Alex' },",
    "    commentFacts: workItems",
    "      .filter((workItem) => workItem.commentsSince)",
    "      .map((workItem) => ({ localWorkItemId: workItem.localWorkItemId, comments: [",
    "        { id: 'c1', author: { id: 'ana', displayName: 'Ana' }, createdAt: workItem.commentsSince },",
    "      ] })),",
    "  };",
    "}",
    "export async function listSettleStates(connection, request) {",
    "  return { states: [",
    "    { name: 'Waiting', category: 'In Progress', done: false },",
    "    { name: 'Done ' + request.sourceId, category: 'Done', done: true },",
    "  ] };",
    "}",
    "export async function writeSettle(connection, request) {",
    "  if (request.sourceId === 'FAIL-1') throw new Error('Transition not allowed.');",
    "  return { state: request.state, priority: request.priority };",
    "}",
  ].join("\n");

  async function createServer(capabilities?: { settle: boolean }) {
    const root = await mkdtemp(path.join(os.tmpdir(), "ajour-settle-api-"));
    tempDirs.push(root);
    const pluginDirectory = await createPlugin(
      path.join(root, "source"),
      settlePluginSource,
      "plugin.mjs",
      capabilities ? { capabilities: { connector: capabilities } } : {},
    );
    const server = createAppApiServer({
      ...windowServerOptions,
      vault: new MemorySecretVault(),
      statePath: path.join(root, "state.json"),
      installedPluginDirectory: path.join(root, "installed"),
      developmentPluginDirectories: [pluginDirectory],
      allowDevelopmentPlugins: true,
    });
    servers.push(server);
    const connectionResponse = await dispatchJsonRequest(server, {
      method: "POST",
      path: "/api/plugins/jira/connections",
      body: JSON.stringify({
        values: {
          label: "Main Jira",
          tenantLabel: "Acme",
          autoSync: false,
          autoSyncIntervalMinutes: 15,
          baseUrl: "https://acme.atlassian.net",
        },
      }),
    });
    const connectionId = (
      connectionResponse.body as { connection: { id: string } }
    ).connection.id;
    return { server, connectionId };
  }

  it("lists settle states and writes a settle through the plugin", async () => {
    const { server, connectionId } = await createServer({ settle: true });

    await expect(
      dispatchJsonRequest(server, {
        method: "POST",
        path: `/api/plugins/jira/connections/${connectionId}/settle-states`,
        body: JSON.stringify({ sourceId: "OPEN-1" }),
      }),
    ).resolves.toEqual({
      status: 200,
      body: {
        states: [
          { name: "Waiting", category: "In Progress", done: false },
          { name: "Done OPEN-1", category: "Done", done: true },
        ],
      },
    });

    await expect(
      dispatchJsonRequest(server, {
        method: "POST",
        path: `/api/plugins/jira/connections/${connectionId}/settle`,
        body: JSON.stringify({
          sourceId: "OPEN-1",
          state: "Waiting",
          priority: "high",
        }),
      }),
    ).resolves.toEqual({
      status: 200,
      body: { state: "Waiting", priority: "high" },
    });
  });

  it("rejects an empty write and reports a failed write as a gateway error", async () => {
    const { server, connectionId } = await createServer({ settle: true });

    const empty = await dispatchJsonRequest(server, {
      method: "POST",
      path: `/api/plugins/jira/connections/${connectionId}/settle`,
      body: JSON.stringify({ sourceId: "OPEN-1" }),
    });
    expect(empty.status).toBe(400);

    await expect(
      dispatchJsonRequest(server, {
        method: "POST",
        path: `/api/plugins/jira/connections/${connectionId}/settle`,
        body: JSON.stringify({ sourceId: "FAIL-1", state: "Waiting" }),
      }),
    ).resolves.toEqual({
      status: 502,
      body: { error: "Transition not allowed." },
    });
  });

  it("refuses to settle through a plugin without the capability", async () => {
    const { server, connectionId } = await createServer();

    await expect(
      dispatchJsonRequest(server, {
        method: "POST",
        path: `/api/plugins/jira/connections/${connectionId}/settle-states`,
        body: JSON.stringify({ sourceId: "OPEN-1" }),
      }),
    ).resolves.toEqual({
      status: 409,
      body: { error: "This plugin does not support settling." },
    });
  });

  it("returns done items from a sync instead of staging them for review", async () => {
    const { server, connectionId } = await createServer({ settle: true });

    const synced = await dispatchJsonRequest(server, {
      method: "POST",
      path: `/api/plugins/jira/connections/${connectionId}/sync`,
      body: JSON.stringify({ trigger: "manual", workItems: [] }),
    });
    expect(synced).toMatchObject({
      status: 200,
      body: {
        stagedCount: 1,
        doneItems: [
          {
            source: "jira",
            connectionId,
            sourceId: "DONE-1",
            state: "Done",
            description: { text: "About DONE-1" },
          },
        ],
      },
    });

    const staged = await dispatchJsonRequest(server, {
      method: "GET",
      path: "/api/backlog/imports",
    });
    expect(
      (staged.body as { items: { sourceId: string }[] }).items.map(
        (item) => item.sourceId,
      ),
    ).toEqual(["OPEN-1"]);
  });

  it("passes on the comment facts a sync reports for settled items", async () => {
    const { server, connectionId } = await createServer({ settle: true });

    const synced = await dispatchJsonRequest(server, {
      method: "POST",
      path: `/api/plugins/jira/connections/${connectionId}/sync`,
      body: JSON.stringify({
        trigger: "manual",
        workItems: [
          {
            localWorkItemId: "settled-1",
            sourceId: "OPEN-1",
            commentsSince: "2026-10-18T10:00:00.000Z",
          },
          { localWorkItemId: "active-1", sourceId: "OPEN-2" },
        ],
      }),
    });
    expect(synced).toMatchObject({
      status: 200,
      body: {
        viewer: { id: "me", displayName: "Alex" },
        commentFacts: [
          {
            localWorkItemId: "settled-1",
            comments: [
              {
                id: "c1",
                author: { id: "ana", displayName: "Ana" },
                createdAt: "2026-10-18T10:00:00.000Z",
              },
            ],
          },
        ],
      },
    });
  });
});

describe("code host routes", () => {
  const tempDirs: string[] = [];
  const servers: Server[] = [];

  afterEach(async () => {
    for (const server of servers.splice(0)) {
      server.emit("close");
    }
    await Promise.all(
      tempDirs
        .splice(0)
        .map((directory) => rm(directory, { recursive: true, force: true })),
    );
  });

  const codeHostPluginSource = [
    "export async function validateConnection(config) {",
    "  return { normalizedConfig: config, connectionSummary: {} };",
    "}",
    "export async function syncPullRequests(connection, request) {",
    "  if (request.tracked.some((ref) => ref.number === 500)) throw new Error('Bad credentials.');",
    "  return { viewer: { login: 'octocat', isBot: false }, pullRequests: [] };",
    "}",
  ].join("\n");

  async function createServer(
    capabilities: Record<string, unknown>,
    source = codeHostPluginSource,
  ) {
    const root = await mkdtemp(path.join(os.tmpdir(), "ajour-code-host-api-"));
    tempDirs.push(root);
    const pluginDirectory = await createPlugin(
      path.join(root, "source"),
      source,
      "plugin.mjs",
      { capabilities },
    );
    const server = createAppApiServer({
      ...windowServerOptions,
      vault: new MemorySecretVault(),
      statePath: path.join(root, "state.json"),
      installedPluginDirectory: path.join(root, "installed"),
      developmentPluginDirectories: [pluginDirectory],
      allowDevelopmentPlugins: true,
    });
    servers.push(server);
    const connectionResponse = await dispatchJsonRequest(server, {
      method: "POST",
      path: "/api/plugins/jira/connections",
      body: JSON.stringify({
        values: {
          label: "Work",
          tenantLabel: "github.com",
          autoSync: true,
          autoSyncIntervalMinutes: 5,
          baseUrl: "https://github.com",
        },
      }),
    });
    const connectionId = (
      connectionResponse.body as { connection: { id: string } }
    ).connection.id;
    return { server, connectionId };
  }

  it("syncs pull requests through a code host plugin and records the sync", async () => {
    const { server, connectionId } = await createServer({ codeHost: {} });

    await expect(
      dispatchJsonRequest(server, {
        method: "POST",
        path: `/api/code-hosts/jira/connections/${connectionId}/syncPullRequests`,
        body: JSON.stringify({ tracked: [] }),
      }),
    ).resolves.toEqual({
      status: 200,
      body: { viewer: { login: "octocat", isBot: false }, pullRequests: [] },
    });

    const overview = await dispatchJsonRequest(server, {
      method: "GET",
      path: "/api/plugins",
    });
    const connection = (
      overview.body as {
        connectionGroups: { connections: { lastSyncAt?: number }[] }[];
      }
    ).connectionGroups[0]?.connections[0];
    expect(connection?.lastSyncAt).toEqual(expect.any(Number));
  });

  it("refuses backlog sync for a plugin without the backlog capability", async () => {
    const { server, connectionId } = await createServer({ codeHost: {} });

    await expect(
      dispatchJsonRequest(server, {
        method: "POST",
        path: `/api/plugins/jira/connections/${connectionId}/sync`,
        body: JSON.stringify({ trigger: "manual" }),
      }),
    ).resolves.toEqual({
      status: 409,
      body: { error: "This plugin does not sync backlog items." },
    });
  });

  it("rejects unknown operations, backlog-only plugins and malformed requests", async () => {
    const backlogOnly = await createServer({ connector: {} });
    await expect(
      dispatchJsonRequest(backlogOnly.server, {
        method: "POST",
        path: `/api/code-hosts/jira/connections/${backlogOnly.connectionId}/syncPullRequests`,
        body: JSON.stringify({ tracked: [] }),
      }),
    ).resolves.toMatchObject({ status: 404 });

    const { server, connectionId } = await createServer({ codeHost: {} });
    await expect(
      dispatchJsonRequest(server, {
        method: "POST",
        path: `/api/code-hosts/jira/connections/${connectionId}/deleteRepository`,
        body: JSON.stringify({}),
      }),
    ).resolves.toMatchObject({ status: 404 });
    await expect(
      dispatchJsonRequest(server, {
        method: "POST",
        path: `/api/code-hosts/jira/connections/${connectionId}/syncPullRequests`,
        body: JSON.stringify({ tracked: "all" }),
      }),
    ).resolves.toMatchObject({ status: 400 });
  });

  it("turns pull requests off without stopping backlog items", async () => {
    const { server, connectionId } = await createServer({
      connector: {},
      codeHost: {},
    });

    const activation = await dispatchJsonRequest(server, {
      method: "POST",
      path: "/api/plugins/jira/activation",
      body: JSON.stringify({ enabled: false, capability: "codeHost" }),
    });
    expect(activation).toMatchObject({
      status: 200,
      body: {
        connectionGroups: [
          { enabled: true, inactiveCapabilities: ["codeHost"] },
        ],
      },
    });
    await expect(
      dispatchJsonRequest(server, {
        method: "POST",
        path: `/api/code-hosts/jira/connections/${connectionId}/syncPullRequests`,
        body: JSON.stringify({ tracked: [] }),
      }),
    ).resolves.toEqual({
      status: 409,
      body: {
        error:
          "Turn on pull requests for this plugin before using its pull requests.",
      },
    });

    await dispatchJsonRequest(server, {
      method: "POST",
      path: "/api/plugins/jira/activation",
      body: JSON.stringify({ enabled: false, capability: "connector" }),
    });
    await expect(
      dispatchJsonRequest(server, {
        method: "POST",
        path: `/api/plugins/jira/connections/${connectionId}/sync`,
        body: JSON.stringify({ trigger: "manual" }),
      }),
    ).resolves.toEqual({
      status: 409,
      body: { error: "Turn on backlog items for this plugin before syncing." },
    });
  });

  it("keeps the pull request sync setting apart from auto sync", async () => {
    const { server, connectionId } = await createServer({ codeHost: {} });
    const connection = async () =>
      (
        (
          await dispatchJsonRequest(server, {
            method: "GET",
            path: "/api/plugins",
          })
        ).body as {
          connectionGroups: {
            connections: {
              autoSync: boolean;
              pullRequestAutoSync?: boolean;
              editableValues: Record<string, unknown>;
            }[];
          }[];
        }
      ).connectionGroups[0]!.connections[0]!;
    const save = (values: Record<string, unknown>) =>
      dispatchJsonRequest(server, {
        method: "POST",
        path: "/api/plugins/jira/connections",
        body: JSON.stringify({
          id: connectionId,
          values: {
            label: "Work",
            tenantLabel: "github.com",
            autoSyncIntervalMinutes: 5,
            baseUrl: "https://github.com",
            ...values,
          },
        }),
      });

    // Saved before the setting existed: pull requests follow auto sync.
    expect(await connection()).toMatchObject({
      autoSync: true,
      editableValues: { pullRequestAutoSync: true },
    });
    expect((await connection()).pullRequestAutoSync).toBeUndefined();

    await save({ autoSync: true, pullRequestAutoSync: false });
    expect(await connection()).toMatchObject({
      autoSync: true,
      pullRequestAutoSync: false,
      editableValues: { pullRequestAutoSync: false },
    });

    await save({ autoSync: false });
    expect(await connection()).toMatchObject({
      autoSync: false,
      pullRequestAutoSync: false,
    });
  });

  it("refuses to switch a capability the plugin does not declare", async () => {
    const { server } = await createServer({ codeHost: {} });

    await expect(
      dispatchJsonRequest(server, {
        method: "POST",
        path: "/api/plugins/jira/activation",
        body: JSON.stringify({ enabled: false, capability: "connector" }),
      }),
    ).resolves.toMatchObject({ status: 400 });
  });

  it("tells the plugin which capabilities are on when it validates a connection", async () => {
    const { server } = await createServer(
      { connector: {}, codeHost: {} },
      [
        "export async function validateConnection(config, context) {",
        "  return { normalizedConfig: config, connectionSummary: { capabilities: context.capabilities.join(',') } };",
        "}",
      ].join("\n"),
    );
    await dispatchJsonRequest(server, {
      method: "POST",
      path: "/api/plugins/jira/activation",
      body: JSON.stringify({ enabled: false, capability: "connector" }),
    });

    const response = await dispatchJsonRequest(server, {
      method: "POST",
      path: "/api/plugins/jira/connections",
      body: JSON.stringify({
        values: {
          label: "Second",
          tenantLabel: "github.com",
          autoSync: false,
          autoSyncIntervalMinutes: 5,
          baseUrl: "https://github.com",
        },
      }),
    });
    expect(response).toMatchObject({
      status: 200,
      body: { connection: { configSummary: { capabilities: "codeHost" } } },
    });
  });

  it("reports a failed sync as a gateway error and records it", async () => {
    const { server, connectionId } = await createServer({ codeHost: {} });

    await expect(
      dispatchJsonRequest(server, {
        method: "POST",
        path: `/api/code-hosts/jira/connections/${connectionId}/syncPullRequests`,
        body: JSON.stringify({
          tracked: [{ repository: "acme/api", number: 500 }],
        }),
      }),
    ).resolves.toEqual({ status: 502, body: { error: "Bad credentials." } });
  });
});

describe("calendar routes", () => {
  const tempDirs: string[] = [];
  const servers: Server[] = [];
  const FEED =
    "https://calendar.google.com/calendar/ical/me%40example.com/private-5f3a9c0d1e2f3a4b5c6d7e8f9a0b1c21e/basic.ics";

  afterEach(async () => {
    for (const server of servers.splice(0)) {
      server.emit("close");
    }
    await Promise.all(
      tempDirs
        .splice(0)
        .map((directory) => rm(directory, { recursive: true, force: true })),
    );
  });

  const calendarPluginSource = [
    "export async function validateConnection(config) {",
    "  return { normalizedConfig: config, connectionSummary: {} };",
    "}",
    "export async function listCalendarEvents(connection, request) {",
    "  if (request.from === '2026-01-05') throw new Error('Could not read ' + connection.config.feedUrl + ': 404');",
    "  return { events: [{ eventId: 'standup', seriesId: 'standup', startsAt: 1, endsAt: 900001, allDay: false, title: 'Secret project sync', status: 'confirmed', response: 'accepted', busy: true }] };",
    "}",
  ].join("\n");

  async function createServer(capabilities: Record<string, unknown>) {
    const root = await mkdtemp(path.join(os.tmpdir(), "ajour-calendar-api-"));
    tempDirs.push(root);
    const pluginDirectory = await createPlugin(
      path.join(root, "source"),
      calendarPluginSource,
      "plugin.mjs",
      {
        capabilities,
        connectionFields: [
          { id: "label", label: "Label", type: "text", required: true },
          {
            id: "tenantLabel",
            label: "Calendar",
            type: "text",
            required: true,
          },
          {
            id: "feedUrl",
            label: "Calendar address",
            type: "url",
            required: true,
            secret: true,
          },
        ],
      },
    );
    const sink = createRecordingSink<AjourEvent>();
    const { events } = sink;
    const server = createAppApiServer({
      ...windowServerOptions,
      vault: new MemorySecretVault(),
      statePath: path.join(root, "state.json"),
      installedPluginDirectory: path.join(root, "installed"),
      developmentPluginDirectories: [pluginDirectory],
      allowDevelopmentPlugins: true,
      eventSink: sink,
    });
    servers.push(server);
    const connectionResponse = await dispatchJsonRequest(server, {
      method: "POST",
      path: "/api/plugins/jira/connections",
      body: JSON.stringify({
        values: {
          label: "Work",
          tenantLabel: "Google Calendar",
          autoSync: false,
          autoSyncIntervalMinutes: 10,
          feedUrl: FEED,
        },
      }),
    });
    const connectionId = (
      connectionResponse.body as { connection: { id: string } }
    ).connection.id;
    return { server, connectionId, events };
  }

  const week = {
    from: "2026-10-12",
    to: "2026-10-18",
    timeZone: "America/Toronto",
  };

  it("lists a week's events through a calendar plugin and logs no title", async () => {
    const { server, connectionId, events } = await createServer({
      calendar: {},
    });

    await expect(
      dispatchJsonRequest(server, {
        method: "POST",
        path: `/api/calendars/jira/connections/${connectionId}/listCalendarEvents`,
        body: JSON.stringify(week),
      }),
    ).resolves.toMatchObject({
      status: 200,
      body: { events: [{ eventId: "standup", title: "Secret project sync" }] },
    });

    const logged = events.filter(
      (event) => event.name === "calendar.fetch" && event.kind === "request",
    );
    expect(logged).toEqual([
      expect.objectContaining({
        kind: "request",
        runtime: "api",
        outcome: "ok",
        plugin: { id: "jira" },
        connection: { id: connectionId },
        calendar: { range_days: 7, event_count: 1 },
      }),
    ]);
    expect(JSON.stringify(logged)).not.toContain("Secret project sync");
  });

  it("rejects unknown operations, plugins without a calendar and malformed requests", async () => {
    const codeHostOnly = await createServer({ codeHost: {} });
    await expect(
      dispatchJsonRequest(codeHostOnly.server, {
        method: "POST",
        path: `/api/calendars/jira/connections/${codeHostOnly.connectionId}/listCalendarEvents`,
        body: JSON.stringify(week),
      }),
    ).resolves.toMatchObject({ status: 404 });

    const { server, connectionId } = await createServer({ calendar: {} });
    await expect(
      dispatchJsonRequest(server, {
        method: "POST",
        path: `/api/calendars/jira/connections/${connectionId}/createEvent`,
        body: JSON.stringify({}),
      }),
    ).resolves.toMatchObject({ status: 404 });
    await expect(
      dispatchJsonRequest(server, {
        method: "POST",
        path: `/api/calendars/jira/connections/${connectionId}/listCalendarEvents`,
        body: JSON.stringify({ ...week, to: "2027-10-18" }),
      }),
    ).resolves.toMatchObject({ status: 400 });
    await expect(
      dispatchJsonRequest(server, {
        method: "POST",
        path: "/api/calendars/jira/connections/missing/listCalendarEvents",
        body: JSON.stringify(week),
      }),
    ).resolves.toMatchObject({ status: 404 });
  });

  it("turns calendar events off without stopping backlog items, and stops with the plugin", async () => {
    const { server, connectionId } = await createServer({
      connector: {},
      calendar: {},
    });

    await expect(
      dispatchJsonRequest(server, {
        method: "POST",
        path: "/api/plugins/jira/activation",
        body: JSON.stringify({ enabled: false, capability: "calendar" }),
      }),
    ).resolves.toMatchObject({
      status: 200,
      body: {
        connectionGroups: [
          { enabled: true, inactiveCapabilities: ["calendar"] },
        ],
      },
    });
    await expect(
      dispatchJsonRequest(server, {
        method: "POST",
        path: `/api/calendars/jira/connections/${connectionId}/listCalendarEvents`,
        body: JSON.stringify(week),
      }),
    ).resolves.toEqual({
      status: 409,
      body: {
        error:
          "Turn on calendar events for this plugin before using its calendar.",
      },
    });

    const calendarOnly = await createServer({ calendar: {} });
    await dispatchJsonRequest(calendarOnly.server, {
      method: "POST",
      path: "/api/plugins/jira/activation",
      body: JSON.stringify({ enabled: false }),
    });
    await expect(
      dispatchJsonRequest(calendarOnly.server, {
        method: "POST",
        path: `/api/calendars/jira/connections/${calendarOnly.connectionId}/listCalendarEvents`,
        body: JSON.stringify(week),
      }),
    ).resolves.toEqual({
      status: 409,
      body: { error: "Activate this plugin before using its calendar." },
    });
  });

  it("keeps the calendar address out of a failed call's error and log", async () => {
    const { server, connectionId, events } = await createServer({
      calendar: {},
    });

    const failed = await dispatchJsonRequest(server, {
      method: "POST",
      path: `/api/calendars/jira/connections/${connectionId}/listCalendarEvents`,
      body: JSON.stringify({
        from: "2026-01-05",
        to: "2026-01-11",
        timeZone: "America/Toronto",
      }),
    });
    expect(failed).toEqual({
      status: 502,
      body: { error: "Could not read [secret]: 404" },
    });

    const overview = await dispatchJsonRequest(server, {
      method: "GET",
      path: "/api/plugins",
    });
    expect(JSON.stringify(overview.body)).not.toContain(FEED);
    expect(JSON.stringify(events)).not.toContain(FEED);
    expect(events).toContainEqual(
      expect.objectContaining({
        name: "calendar.fetch",
        outcome: "error",
        error: { type: "Error", message: "Could not read [secret]: 404" },
      }),
    );
  });
});

describe("agent task settings route", () => {
  const tempDirs: string[] = [];
  const servers: Server[] = [];

  afterEach(async () => {
    for (const server of servers.splice(0)) {
      server.emit("close");
    }
    await Promise.all(
      tempDirs
        .splice(0)
        .map((directory) => rm(directory, { recursive: true, force: true })),
    );
  });

  async function createServer(
    options: Pick<
      Parameters<typeof createAppApiServer>[0] & object,
      "eventSink" | "agentCliPath" | "vault"
    > = {},
  ) {
    const root = await mkdtemp(path.join(os.tmpdir(), "ajour-agent-task-"));
    tempDirs.push(root);
    const pluginDirectory = await createPlugin(
      path.join(root, "source"),
      "export async function validateConnection(config) {\n  return { normalizedConfig: config, connectionSummary: {} };\n}",
      "plugin.mjs",
      {
        capabilities: {
          agentTask: {
            tasks: [
              {
                id: "enter-week",
                label: "Enter",
                placement: "commit-week",
                prompt: "prompts/enter-week.md",
                estimateMinutes: 5,
                settings: [
                  { id: "url", label: "Timesheet URL", type: "url" },
                  { id: "note", label: "Note", type: "text" },
                  {
                    id: "apiKey",
                    label: "API key",
                    type: "password",
                    secret: true,
                  },
                ],
              },
              {
                id: "submit-week",
                label: "Submit",
                placement: "submit-week",
                prompt: "prompts/enter-week.md",
                estimateMinutes: 5,
                settings: [
                  {
                    id: "url",
                    label: "Timesheet URL",
                    type: "url",
                    required: true,
                  },
                ],
              },
            ],
          },
        },
      },
    );
    await mkdir(path.join(pluginDirectory, "prompts"));
    await writeFile(
      path.join(pluginDirectory, "prompts", "enter-week.md"),
      "Enter week {{weekOf}} in {{settings.url}}.",
      "utf8",
    );
    const statePath = path.join(root, "state.json");
    const server = createAppApiServer({
      ...windowServerOptions,
      vault: new MemorySecretVault(),
      statePath,
      installedPluginDirectory: path.join(root, "installed"),
      developmentPluginDirectories: [pluginDirectory],
      allowDevelopmentPlugins: true,
      ...options,
    });
    servers.push(server);
    statePaths.set(server, statePath);
    return server;
  }

  const statePaths = new WeakMap<Server, string>();
  async function createServerWithState() {
    const server = await createServer();
    return { server, statePath: statePaths.get(server)! };
  }

  it(
    "joins a run's session end to its agent.run in the server's events",
    {
      timeout: 20_000,
    },
    async () => {
      const bin = await mkdtemp(path.join(os.tmpdir(), "ajour-agent-cli-"));
      tempDirs.push(bin);
      // A `claude` that exits at once on macOS and Linux. Windows cannot run a
      // file without an extension, so there the spawn fails. Either way the
      // run ends its session and emits its agent.run.
      await writeFile(path.join(bin, "claude"), "#!/bin/sh\nexit 0\n", {
        mode: 0o755,
      });
      const sink = createRecordingSink<AjourEvent>();
      const { events } = sink;
      const server = await createServer({
        eventSink: sink,
        agentCliPath: bin,
      });
      const post = (pathname: string, body: object) =>
        dispatchJsonRequest(server, {
          method: "POST",
          path: pathname,
          body: JSON.stringify(body),
        });
      await post("/api/mcp/settings", { enabled: true });
      await post("/api/agents/settings", {
        cli: "claude-code",
        browserMode: "my-chrome",
      });
      await post("/api/agent-runs", {
        pluginId: "jira",
        taskId: "enter-week",
        weekOf: "2026-10-12",
      });
      await vi.waitFor(
        () =>
          expect(
            events
              .map((event) => event.name)
              .filter((name) => name.startsWith("agent.")),
          ).toEqual(["agent.session", "agent.run"]),
        { timeout: 10_000 },
      );
      const [ended, run] = events.filter((event) =>
        event.name.startsWith("agent."),
      );
      expect(run!.agent?.run_id).toEqual(expect.any(String));
      expect(ended).toMatchObject({
        agent: {
          run_id: run!.agent?.run_id,
          session_id: run!.agent?.session_id,
          client_id: run!.agent?.client_id,
        },
      });
    },
  );

  const save = (server: Server, pluginId: string, values: object) =>
    dispatchJsonRequest(server, {
      method: "POST",
      path: `/api/agents/plugins/${pluginId}/settings`,
      body: JSON.stringify({ values }),
    });

  it("answers 404 for a plugin without agent tasks", async () => {
    const server = await createServer();
    await expect(save(server, "nope", {})).resolves.toMatchObject({
      status: 404,
      body: { error: expect.any(String) },
    });
  });

  it("keeps only declared settings and refuses a bad URL", async () => {
    const server = await createServer();
    const saved = await save(server, "jira", {
      url: "https://wd.example/t",
      note: "hi",
      stray: "dropped",
    });
    expect(saved.status).toBe(200);
    const [task] = (saved.body as { tasks: { values: object }[] }).tasks;
    expect(task!.values).toEqual({ url: "https://wd.example/t", note: "hi" });

    await expect(
      save(server, "jira", { url: "javascript:alert(1)" }),
    ).resolves.toMatchObject({ status: 400 });
    await expect(
      save(server, "jira", { url: "not a url" }),
    ).resolves.toMatchObject({ status: 400 });
    // An empty value is allowed: the runner blocks the run until it is filled.
    await expect(save(server, "jira", { url: "" })).resolves.toMatchObject({
      status: 200,
    });
  });

  it("shares a setting between every task of the plugin", async () => {
    const server = await createServer();
    const saved = await save(server, "jira", { url: "https://wd.example/t" });
    const tasks = (
      saved.body as {
        tasks: {
          taskId: string;
          values: { url?: string };
          blockers: string[];
        }[];
      }
    ).tasks;
    expect(tasks.map((task) => [task.taskId, task.values.url])).toEqual([
      ["enter-week", "https://wd.example/t"],
      ["submit-week", "https://wd.example/t"],
    ]);
    const submit = tasks.find((task) => task.taskId === "submit-week")!;
    expect(submit.blockers.some((blocker) => blocker.includes("URL"))).toBe(
      false,
    );
  });

  it("keeps a secret setting out of its answers and the state file, keeps it when left empty, and removes it on request", async () => {
    const KEY = "wd-key-5e0c7a91b3f2";
    const vault = new MemorySecretVault();
    const server = await createServer({ vault });
    const statePath = statePaths.get(server)!;
    const storedValues = async () =>
      (
        JSON.parse(await readFile(statePath, "utf8")) as {
          agentRunner: { pluginValues: Record<string, object> };
        }
      ).agentRunner.pluginValues.jira;
    const vaultKey = () =>
      vault
        .contents()
        .filter((entry) => entry.pluginId === "jira")
        .map(({ connectionId, fieldId, value }) => ({
          connectionId,
          fieldId,
          value,
        }));

    const saved = await save(server, "jira", {
      url: "https://wd.example/t",
      apiKey: KEY,
    });
    expect(saved.status).toBe(200);
    expect(JSON.stringify(saved.body)).not.toContain(KEY);
    await expect(storedValues()).resolves.toEqual({
      url: "https://wd.example/t",
    });
    expect(await readFile(statePath, "utf8")).not.toContain(KEY);
    expect(vaultKey()).toEqual([
      { connectionId: null, fieldId: "apiKey", value: JSON.stringify(KEY) },
    ]);

    const kept = await save(server, "jira", {
      url: "https://wd.example/u",
      apiKey: "",
    });
    expect(kept.status).toBe(200);
    await expect(storedValues()).resolves.toEqual({
      url: "https://wd.example/u",
    });
    expect(vaultKey()).toEqual([
      { connectionId: null, fieldId: "apiKey", value: JSON.stringify(KEY) },
    ]);

    const NEW_KEY = "wd-key-9a41d6c2e7b8";
    const replaced = await save(server, "jira", {
      url: "https://wd.example/u",
      apiKey: NEW_KEY,
    });
    expect(replaced.status).toBe(200);
    expect(JSON.stringify(replaced.body)).not.toContain(NEW_KEY);
    expect(vaultKey()).toEqual([
      {
        connectionId: null,
        fieldId: "apiKey",
        value: JSON.stringify(NEW_KEY),
      },
    ]);

    const removed = await dispatchJsonRequest(server, {
      method: "POST",
      path: "/api/agents/plugins/jira/settings",
      body: JSON.stringify({
        values: { url: "https://wd.example/u" },
        removeSecrets: ["apiKey"],
      }),
    });
    expect(removed.status).toBe(200);
    await expect(storedValues()).resolves.toEqual({
      url: "https://wd.example/u",
    });
    expect(vaultKey()).toEqual([]);
  });
});

describe("team routes", () => {
  const tempDirs: string[] = [];
  const servers: Server[] = [];

  afterEach(async () => {
    for (const server of servers.splice(0)) {
      server.emit("close");
    }
    await Promise.all(
      tempDirs
        .splice(0)
        .map((directory) => rm(directory, { recursive: true, force: true })),
    );
  });

  const teamPluginSource = [
    "export async function validateConnection(config) {",
    "  return { normalizedConfig: config, connectionSummary: {} };",
    "}",
    "export async function createTeam(config, request) {",
    "  if (request.name === 'Taken') throw new Error('That team name is taken.');",
    "  if (request.name === 'Leak') throw new Error(`Bad secret ${config.teamSecret}`);",
    "  return { values: { teamId: `team-${request.name}`, teamSecret: 's3cret' } };",
    "}",
    "export async function syncTeamProjects(connection, request) {",
    "  if (request.cursor === 'broken') throw new Error('The team refused the secret.');",
    "  if (request.cursor === 'leak') throw new Error(`Invalid team secret ${connection.config.teamSecret}`);",
    "  if (request.cursor === 'invalid') return { cursor: 'c', projects: Array.from({ length: 25 }, () => ({})) };",
    "  return { cursor: 'c2', projects: [], assigned: [] };",
    "}",
  ].join("\n");

  async function createServer(capabilities: Record<string, unknown>) {
    const root = await mkdtemp(path.join(os.tmpdir(), "ajour-team-api-"));
    tempDirs.push(root);
    const pluginDirectory = await createPlugin(
      path.join(root, "source"),
      teamPluginSource,
      "plugin.mjs",
      {
        capabilities,
        connectionFields: [
          {
            id: "label",
            label: "Connection label",
            type: "text",
            required: true,
          },
          {
            id: "tenantLabel",
            label: "Workspace",
            type: "text",
            required: true,
          },
          {
            id: "baseUrl",
            label: "Deployment URL",
            type: "url",
            required: true,
          },
          {
            id: "teamSecret",
            label: "Team secret",
            type: "password",
            secret: true,
          },
        ],
      },
    );
    const server = createAppApiServer({
      ...windowServerOptions,
      vault: new MemorySecretVault(),
      statePath: path.join(root, "state.json"),
      installedPluginDirectory: path.join(root, "installed"),
      developmentPluginDirectories: [pluginDirectory],
      allowDevelopmentPlugins: true,
    });
    servers.push(server);
    const connectionResponse = await dispatchJsonRequest(server, {
      method: "POST",
      path: "/api/plugins/jira/connections",
      body: JSON.stringify({
        values: {
          label: "Acme team",
          tenantLabel: "acme",
          autoSync: true,
          autoSyncIntervalMinutes: 15,
          baseUrl: "https://team.example",
          teamSecret: "s3cret",
        },
      }),
    });
    const connectionId = (
      connectionResponse.body as { connection: { id: string } }
    ).connection.id;
    return { server, connectionId };
  }

  async function lastError(server: Server) {
    const overview = await dispatchJsonRequest(server, {
      method: "GET",
      path: "/api/plugins",
    });
    return (
      overview.body as {
        connectionGroups: {
          connections: { lastError?: string; lastSyncAt?: number }[];
        }[];
      }
    ).connectionGroups[0]?.connections[0];
  }

  it("creates a team from the form's values before a connection exists", async () => {
    const { server } = await createServer({ team: { apiVersion: 1 } });

    await expect(
      dispatchJsonRequest(server, {
        method: "POST",
        path: "/api/teams/jira/create",
        body: JSON.stringify({
          values: { baseUrl: "https://team.example" },
          team: { name: "Acme" },
        }),
      }),
    ).resolves.toEqual({
      status: 200,
      body: { values: { teamId: "team-Acme", teamSecret: "s3cret" } },
    });
    await expect(
      dispatchJsonRequest(server, {
        method: "POST",
        path: "/api/teams/jira/create",
        body: JSON.stringify({ values: {}, team: { name: "Taken" } }),
      }),
    ).resolves.toEqual({
      status: 502,
      body: { error: "That team name is taken." },
    });
  });

  it("runs a sync round and records the sync, or the error on the connection", async () => {
    const { server, connectionId } = await createServer({
      team: { apiVersion: 1 },
    });

    await expect(
      dispatchJsonRequest(server, {
        method: "POST",
        path: `/api/teams/jira/connections/${connectionId}/sync`,
        body: JSON.stringify({ changes: [] }),
      }),
    ).resolves.toEqual({
      status: 200,
      body: { cursor: "c2", projects: [], assigned: [], hasMore: false },
    });
    expect((await lastError(server))?.lastSyncAt).toEqual(expect.any(Number));

    await expect(
      dispatchJsonRequest(server, {
        method: "POST",
        path: `/api/teams/jira/connections/${connectionId}/sync`,
        body: JSON.stringify({ cursor: "broken", changes: [] }),
      }),
    ).resolves.toEqual({
      status: 502,
      body: { error: "The team refused the secret." },
    });
    expect((await lastError(server))?.lastError).toBe(
      "The team refused the secret.",
    );
  });

  it("keeps a short team secret out of both routes' errors", async () => {
    const { server, connectionId } = await createServer({
      team: { apiVersion: 1 },
    });

    const created = await dispatchJsonRequest(server, {
      method: "POST",
      path: "/api/teams/jira/create",
      body: JSON.stringify({
        values: { teamSecret: "s3cret" },
        team: { name: "Leak" },
      }),
    });
    expect(created).toEqual({
      status: 502,
      body: { error: "Bad secret [secret]" },
    });

    const synced = await dispatchJsonRequest(server, {
      method: "POST",
      path: `/api/teams/jira/connections/${connectionId}/sync`,
      body: JSON.stringify({ cursor: "leak", changes: [] }),
    });
    expect(synced).toEqual({
      status: 502,
      body: { error: "Invalid team secret [secret]" },
    });
    expect((await lastError(server))?.lastError).toBe(
      "Invalid team secret [secret]",
    );
  });

  it("stores a huge contract error within the overview's limit, and syncs again after it", async () => {
    const { server, connectionId } = await createServer({
      team: { apiVersion: 1 },
    });

    const invalid = await dispatchJsonRequest(server, {
      method: "POST",
      path: `/api/teams/jira/connections/${connectionId}/sync`,
      body: JSON.stringify({ cursor: "invalid", changes: [] }),
    });
    expect(invalid.status).toBe(502);
    expect(
      (invalid.body as { error: string }).error.length,
    ).toBeLessThanOrEqual(1_000);

    const overview = await dispatchJsonRequest(server, {
      method: "GET",
      path: "/api/plugins",
    });
    expect(overview.status).toBe(200);
    expect((await lastError(server))?.lastError?.length).toBe(1_000);

    await expect(
      dispatchJsonRequest(server, {
        method: "POST",
        path: `/api/teams/jira/connections/${connectionId}/sync`,
        body: JSON.stringify({ changes: [] }),
      }),
    ).resolves.toMatchObject({ status: 200 });
  });

  it("refuses plugins without a team, a turned-off team, and malformed rounds", async () => {
    const backlogOnly = await createServer({ connector: {} });
    await expect(
      dispatchJsonRequest(backlogOnly.server, {
        method: "POST",
        path: `/api/teams/jira/connections/${backlogOnly.connectionId}/sync`,
        body: JSON.stringify({ changes: [] }),
      }),
    ).resolves.toEqual({
      status: 404,
      body: { error: "This plugin does not sync a team's projects." },
    });

    const { server, connectionId } = await createServer({
      connector: {},
      team: { apiVersion: 1 },
    });
    await expect(
      dispatchJsonRequest(server, {
        method: "POST",
        path: `/api/teams/jira/connections/${connectionId}/sync`,
        body: JSON.stringify({ changes: [{ localId: "p1" }] }),
      }),
    ).resolves.toMatchObject({ status: 400 });

    await dispatchJsonRequest(server, {
      method: "POST",
      path: "/api/plugins/jira/activation",
      body: JSON.stringify({ enabled: false, capability: "team" }),
    });
    await expect(
      dispatchJsonRequest(server, {
        method: "POST",
        path: `/api/teams/jira/connections/${connectionId}/sync`,
        body: JSON.stringify({ changes: [] }),
      }),
    ).resolves.toEqual({
      status: 409,
      body: {
        error: "Turn on projects for this plugin before syncing its projects.",
      },
    });
  });
});

describe("backlog comment routes", () => {
  const tempDirs: string[] = [];
  const servers: Server[] = [];
  const TOKEN = "pat-5f3a9c0d1e2f3a4b5c6d7e8f";

  afterEach(async () => {
    for (const server of servers.splice(0)) {
      server.emit("close");
    }
    await Promise.all(
      tempDirs
        .splice(0)
        .map((directory) => rm(directory, { recursive: true, force: true })),
    );
  });

  const commentPluginSource = [
    "export async function validateConnection(config) {",
    "  return { normalizedConfig: config, connectionSummary: {} };",
    "}",
    "export async function syncConnection() {",
    "  return { items: [] };",
    "}",
    "export async function listItemComments(connection, request) {",
    "  if (request.sourceId === 'broken') throw new Error('Could not read with ' + connection.config.token);",
    "  if (request.sourceId.startsWith('slow:')) {",
    "    const [, entered, release] = request.sourceId.split('|');",
    "    const fs = await import('node:fs/promises');",
    "    await fs.writeFile(entered, '');",
    "    while (!(await fs.access(release).then(() => true, () => false))) await new Promise((resolve) => setTimeout(resolve, 10));",
    "  }",
    "  return {",
    "    viewer: { id: 'me', displayName: 'Me' },",
    "    comments: [{ id: 'c1', author: { id: 'ana', displayName: 'Ana Silva' }, body: 'Secret client detail', createdAt: '2026-10-13T10:42:00Z' }],",
    "    total: 1,",
    "  };",
    "}",
    "export async function editItemComment(connection, request) {",
    "  return { comment: { id: request.commentId, author: { id: 'me', displayName: 'Me' }, body: request.body, createdAt: '2026-10-17T10:00:00Z', updatedAt: '2026-10-17T11:00:00Z' } };",
    "}",
    "export async function deleteItemComment() {",
    "  return {};",
    "}",
    "export async function setItemCommentReaction(connection, request) {",
    "  return { reactions: request.reacted ? [{ reaction: request.reaction, count: 1, viewerReacted: true }] : [] };",
    "}",
    "export async function searchItemPeople(connection, request) {",
    "  return { people: [{ id: 'ana', displayName: 'Ana Silva ' + request.query }] };",
    "}",
    "export async function postItemComment(connection, request) {",
    "  if (request.body.startsWith('slow|')) {",
    "    const [, entered, release] = request.body.split('|');",
    "    const fs = await import('node:fs/promises');",
    "    await fs.writeFile(entered, '');",
    "    while (!(await fs.access(release).then(() => true, () => false))) await new Promise((resolve) => setTimeout(resolve, 10));",
    "  }",
    "  return { comment: { id: 'c2', author: { id: 'me', displayName: 'Me' }, body: request.body, createdAt: '2026-10-17T10:00:00Z' } };",
    "}",
  ].join("\n");

  async function createServer(
    capabilities: Record<string, unknown>,
    plugin: { source?: string; extraFields?: Record<string, unknown>[] } = {},
  ) {
    const root = await mkdtemp(path.join(os.tmpdir(), "ajour-comments-api-"));
    tempDirs.push(root);
    const pluginDirectory = await createPlugin(
      path.join(root, "source"),
      plugin.source ?? commentPluginSource,
      "plugin.mjs",
      {
        capabilities,
        connectionFields: [
          ...(plugin.extraFields ?? []),
          { id: "label", label: "Label", type: "text", required: true },
          {
            id: "tenantLabel",
            label: "Organization",
            type: "text",
            required: true,
          },
          {
            id: "token",
            label: "Token",
            type: "text",
            required: true,
            secret: true,
          },
        ],
      },
    );
    // The comment routes' request events only.
    const events: AjourEvent[] = [];
    const server = createAppApiServer({
      ...windowServerOptions,
      vault: new MemorySecretVault(),
      statePath: path.join(root, "state.json"),
      installedPluginDirectory: path.join(root, "installed"),
      developmentPluginDirectories: [pluginDirectory],
      allowDevelopmentPlugins: true,
      eventSink: {
        emit(event) {
          if (
            event.kind === "request" &&
            /^(comment|mention)\./.test(event.name)
          ) {
            events.push(event as AjourEvent);
          }
        },
      },
    });
    servers.push(server);
    const connectionResponse = await dispatchJsonRequest(server, {
      method: "POST",
      path: "/api/plugins/jira/connections",
      body: JSON.stringify({
        values: {
          label: "Work",
          tenantLabel: "Contoso",
          autoSync: false,
          autoSyncIntervalMinutes: 10,
          token: TOKEN,
        },
      }),
    });
    const connectionId = (
      connectionResponse.body as { connection: { id: string } }
    ).connection.id;
    return { server, connectionId, events, root };
  }

  const listPath = (connectionId: string, operation = "listItemComments") =>
    `/api/backlog-comments/jira/connections/${connectionId}/${operation}`;

  it("keeps Allow lossy conversion as Ajour's setting, off until the user turns it on", async () => {
    const { server, connectionId, root } = await createServer({
      connector: { description: { write: true } },
    });
    const connection = async () =>
      (
        (
          await dispatchJsonRequest(server, {
            method: "GET",
            path: "/api/plugins",
          })
        ).body as {
          connectionGroups: {
            connections: {
              allowLossyConversion?: boolean;
              editableValues: Record<string, unknown>;
            }[];
          }[];
        }
      ).connectionGroups[0]!.connections[0]!;
    const save = (values: Record<string, unknown>) =>
      dispatchJsonRequest(server, {
        method: "POST",
        path: "/api/plugins/jira/connections",
        body: JSON.stringify({
          id: connectionId,
          values: {
            label: "Work",
            tenantLabel: "Contoso",
            autoSyncIntervalMinutes: 10,
            token: TOKEN,
            ...values,
          },
        }),
      });

    expect(await connection()).toMatchObject({
      editableValues: { allowLossyConversion: false },
    });
    expect((await connection()).allowLossyConversion).toBeUndefined();

    expect((await save({ allowLossyConversion: true })).status).toBe(200);
    expect(await connection()).toMatchObject({
      allowLossyConversion: true,
      editableValues: { allowLossyConversion: true },
    });

    // A save without it keeps it; a value that is not a boolean is refused.
    await save({});
    expect((await connection()).allowLossyConversion).toBe(true);
    expect((await save({ allowLossyConversion: "yes" })).status).toBe(400);
    expect((await save({ allowLossyConversion: false })).status).toBe(200);
    expect((await connection()).allowLossyConversion).toBeUndefined();

    // The plugin never receives the setting with its config.
    const stored = JSON.parse(
      await readFile(path.join(root, "state.json"), "utf8"),
    ) as { connections: { config: Record<string, unknown> }[] };
    expect(stored.connections[0]!.config).not.toHaveProperty(
      "allowLossyConversion",
    );
  });

  it("keeps agent access to comments as Ajour's setting, None until the user changes it", async () => {
    const { server, connectionId, root } = await createServer({
      connector: { comments: {} },
    });
    const connection = async () =>
      (
        (
          await dispatchJsonRequest(server, {
            method: "GET",
            path: "/api/plugins",
          })
        ).body as {
          connectionGroups: {
            connections: {
              agentAccess?: string;
              editableValues: Record<string, unknown>;
            }[];
          }[];
        }
      ).connectionGroups[0]!.connections[0]!;
    const save = (values: Record<string, unknown>) =>
      dispatchJsonRequest(server, {
        method: "POST",
        path: "/api/plugins/jira/connections",
        body: JSON.stringify({
          id: connectionId,
          values: {
            label: "Work",
            tenantLabel: "Contoso",
            autoSyncIntervalMinutes: 10,
            token: TOKEN,
            ...values,
          },
        }),
      });

    expect(await connection()).toMatchObject({
      editableValues: { agentAccess: "none" },
    });
    expect((await connection()).agentAccess).toBeUndefined();

    expect((await save({ agentAccess: "read" })).status).toBe(200);
    expect(await connection()).toMatchObject({
      agentAccess: "read",
      editableValues: { agentAccess: "read" },
    });

    // A save without it keeps it; an unknown level is refused.
    await save({});
    expect((await connection()).agentAccess).toBe("read");
    expect((await save({ agentAccess: "everything" })).status).toBe(400);
    expect((await connection()).agentAccess).toBe("read");

    // The plugin never receives the setting with its config.
    const stored = JSON.parse(
      await readFile(path.join(root, "state.json"), "utf8"),
    ) as { connections: { config: Record<string, unknown> }[] };
    expect(stored.connections[0]!.config).not.toHaveProperty("agentAccess");
  });

  it("keeps agent access Ajour's even when the plugin declares and returns it", async () => {
    const { server, connectionId, root } = await createServer(
      { connector: { comments: {} } },
      {
        source: commentPluginSource.replace(
          "return { normalizedConfig: config, connectionSummary: {} };",
          "return { normalizedConfig: { ...config, agentAccess: 'readWrite' }, connectionSummary: {} };",
        ),
        extraFields: [
          {
            id: "agentAccess",
            label: "Agents",
            type: "text",
            defaultValue: "readWrite",
          },
        ],
      },
    );

    const overview = (
      await dispatchJsonRequest(server, { method: "GET", path: "/api/plugins" })
    ).body as {
      connectionGroups: {
        connections: {
          id: string;
          agentAccess?: string;
          editableValues: Record<string, unknown>;
        }[];
      }[];
    };
    const connection = overview.connectionGroups[0]!.connections.find(
      (candidate) => candidate.id === connectionId,
    )!;
    expect(connection.agentAccess).toBeUndefined();
    expect(connection.editableValues.agentAccess).toBe("none");
    const stored = JSON.parse(
      await readFile(path.join(root, "state.json"), "utf8"),
    ) as { connections: { config: Record<string, unknown> }[] };
    expect(stored.connections[0]!.config).not.toHaveProperty("agentAccess");
  });

  it("enforces agent access on an agent's comment calls, even when revoked mid-read", async () => {
    const { server, connectionId, events, root } = await createServer({
      connector: { comments: {} },
    });
    const call = (operation: string, body: unknown, agent = true) =>
      dispatchJsonRequest(server, {
        method: "POST",
        path: `${listPath(connectionId, operation)}${agent ? "?agent=1" : ""}`,
        body: JSON.stringify(body),
      });
    const setAccess = (agentAccess: string) =>
      dispatchJsonRequest(server, {
        method: "POST",
        path: "/api/plugins/jira/connections",
        body: JSON.stringify({
          id: connectionId,
          values: {
            label: "Work",
            tenantLabel: "Contoso",
            autoSyncIntervalMinutes: 10,
            token: TOKEN,
            agentAccess,
          },
        }),
      });
    const list = { sourceId: "4821", limit: 5 };

    // None: an agent gets nothing; Ajour's own page still reads.
    expect(await call("listItemComments", list)).toEqual({
      status: 403,
      body: {
        error:
          'The user hasn\'t allowed agents to read comments on the "Work" connection.',
      },
    });
    expect((await call("listItemComments", list, false)).status).toBe(200);

    // Read: an agent reads, but can't post.
    await setAccess("read");
    expect((await call("listItemComments", list)).status).toBe(200);
    expect(
      (await call("postItemComment", { sourceId: "4821", body: "Hi" })).status,
    ).toBe(403);

    // Revoked while the plugin answers: the text doesn't leave.
    const entered = path.join(root, "entered");
    const release = path.join(root, "release");
    const slow = call("listItemComments", {
      sourceId: `slow:|${entered}|${release}`,
      limit: 5,
    });
    await expect
      .poll(() =>
        access(entered).then(
          () => true,
          () => false,
        ),
      )
      .toBe(true);
    await setAccess("none");
    await writeFile(release, "");
    expect(await slow).toMatchObject({ status: 403 });
    const refused = events.filter((event) => event.outcome === "refused");
    expect(
      refused.map(({ name, trigger, outcome_reason }) => ({
        name,
        trigger,
        outcome_reason,
      })),
    ).toEqual(
      ["comment.list", "comment.post", "comment.list"].map((name) => ({
        name,
        trigger: "agent",
        outcome_reason: "agent_access",
      })),
    );

    // A post allowed at admission stands, even if access drops meanwhile.
    await setAccess("readWrite");
    const posting = path.join(root, "posting");
    const posted = path.join(root, "posted");
    const post = call("postItemComment", {
      sourceId: "4821",
      body: `slow|${posting}|${posted}`,
    });
    await expect
      .poll(() =>
        access(posting).then(
          () => true,
          () => false,
        ),
      )
      .toBe(true);
    await setAccess("read");
    await writeFile(posted, "");
    expect(await post).toMatchObject({ status: 200 });
  });

  it("lists an item's comments and logs no text or author", async () => {
    const { server, connectionId, events } = await createServer({
      connector: { comments: { reactions: ["like"] } },
    });

    await expect(
      dispatchJsonRequest(server, {
        method: "POST",
        path: listPath(connectionId),
        body: JSON.stringify({ sourceId: "42", limit: 5 }),
      }),
    ).resolves.toMatchObject({
      status: 200,
      body: {
        viewer: { id: "me" },
        comments: [{ id: "c1", body: "Secret client detail" }],
        total: 1,
      },
    });

    expect(events).toEqual([
      expect.objectContaining({
        name: "comment.list",
        kind: "request",
        trigger: "system",
        outcome: "ok",
        plugin: { id: "jira" },
        connection: { id: connectionId },
        comment: { comment_count: 1, page: "latest" },
      }),
    ]);
    expect(JSON.stringify(events)).not.toContain("Secret client detail");
    expect(JSON.stringify(events)).not.toContain("Ana Silva");
  });

  it("rejects plugins without comments, unknown operations and malformed requests", async () => {
    const backlogOnly = await createServer({ connector: {} });
    await expect(
      dispatchJsonRequest(backlogOnly.server, {
        method: "POST",
        path: listPath(backlogOnly.connectionId),
        body: JSON.stringify({ sourceId: "42", limit: 5 }),
      }),
    ).resolves.toMatchObject({ status: 404 });

    const { server, connectionId } = await createServer({
      connector: { comments: {} },
    });
    await expect(
      dispatchJsonRequest(server, {
        method: "POST",
        path: listPath(connectionId, "deleteEverything"),
        body: JSON.stringify({}),
      }),
    ).resolves.toMatchObject({ status: 404 });
    await expect(
      dispatchJsonRequest(server, {
        method: "POST",
        path: listPath(connectionId),
        body: JSON.stringify({ sourceId: "42", limit: 500 }),
      }),
    ).resolves.toMatchObject({ status: 400 });
    await expect(
      dispatchJsonRequest(server, {
        method: "POST",
        path: listPath("missing"),
        body: JSON.stringify({ sourceId: "42", limit: 5 }),
      }),
    ).resolves.toMatchObject({ status: 404 });
  });

  it("posts a comment and logs no text", async () => {
    const { server, connectionId, events } = await createServer({
      connector: { comments: {} },
    });

    await expect(
      dispatchJsonRequest(server, {
        method: "POST",
        path: listPath(connectionId, "postItemComment"),
        body: JSON.stringify({ sourceId: "42", body: "Private reply" }),
      }),
    ).resolves.toMatchObject({
      status: 200,
      body: { comment: { id: "c2", body: "Private reply" } },
    });
    expect(events).toEqual([
      expect.objectContaining({
        name: "comment.post",
        outcome: "ok",
        // Its length, never its text.
        comment: { body_length: 13, mention_count: 0 },
      }),
    ]);
    expect(JSON.stringify(events)).not.toContain("Private reply");

    await expect(
      dispatchJsonRequest(server, {
        method: "POST",
        path: listPath(connectionId, "postItemComment"),
        body: JSON.stringify({ sourceId: "42", body: "   " }),
      }),
    ).resolves.toMatchObject({ status: 400 });
  });

  it("runs edit, delete and reactions only when the plugin declares them", async () => {
    const limited = await createServer({ connector: { comments: {} } });
    const ref = { sourceId: "42", commentId: "c1" };
    for (const [operation, body] of [
      ["editItemComment", { ...ref, body: "Changed" }],
      ["deleteItemComment", ref],
      ["setItemCommentReaction", { ...ref, reaction: "like", reacted: true }],
    ] as const) {
      await expect(
        dispatchJsonRequest(limited.server, {
          method: "POST",
          path: listPath(limited.connectionId, operation),
          body: JSON.stringify(body),
        }),
      ).resolves.toMatchObject({ status: 404 });
    }

    const full = await createServer({
      connector: {
        comments: { edit: true, delete: true, reactions: ["like"] },
      },
    });
    await expect(
      dispatchJsonRequest(full.server, {
        method: "POST",
        path: listPath(full.connectionId, "editItemComment"),
        body: JSON.stringify({
          ...ref,
          body: "Changed for [@Ana](mention:ana) and [@Bo](mention:bo)",
        }),
      }),
    ).resolves.toMatchObject({ status: 200 });
    await expect(
      dispatchJsonRequest(full.server, {
        method: "POST",
        path: listPath(full.connectionId, "deleteItemComment"),
        body: JSON.stringify(ref),
      }),
    ).resolves.toMatchObject({ status: 200, body: {} });
    await expect(
      dispatchJsonRequest(full.server, {
        method: "POST",
        path: listPath(full.connectionId, "setItemCommentReaction"),
        body: JSON.stringify({ ...ref, reaction: "like", reacted: true }),
      }),
    ).resolves.toMatchObject({
      status: 200,
      body: {
        reactions: [{ reaction: "like", count: 1, viewerReacted: true }],
      },
    });
    await expect(
      dispatchJsonRequest(full.server, {
        method: "POST",
        path: listPath(full.connectionId, "setItemCommentReaction"),
        body: JSON.stringify({ ...ref, reaction: "heart", reacted: true }),
      }),
    ).resolves.toMatchObject({ status: 404 });
    expect(full.events.map(({ name, outcome }) => ({ name, outcome }))).toEqual(
      [
        { name: "comment.edit", outcome: "ok" },
        { name: "comment.delete", outcome: "ok" },
        { name: "comment.react", outcome: "ok" },
        // A reaction the plugin doesn't declare is refused before it runs.
        { name: "comment.react", outcome: "refused" },
      ],
    );
    expect(full.events[0]!.comment).toEqual({
      body_length: 53,
      mention_count: 2,
    });
    expect(JSON.stringify(full.events)).not.toMatch(/Changed|Ana|mention:/);
  });

  it("searches people only for a plugin that declares mentions", async () => {
    const request = { sourceId: "42", query: "an", limit: 8 };
    const without = await createServer({ connector: { comments: {} } });
    await expect(
      dispatchJsonRequest(without.server, {
        method: "POST",
        path: listPath(without.connectionId, "searchItemPeople"),
        body: JSON.stringify(request),
      }),
    ).resolves.toMatchObject({ status: 404 });

    const { server, connectionId, events } = await createServer({
      connector: { comments: { mentions: true } },
    });
    await expect(
      dispatchJsonRequest(server, {
        method: "POST",
        path: listPath(connectionId, "searchItemPeople"),
        body: JSON.stringify(request),
      }),
    ).resolves.toMatchObject({
      status: 200,
      body: { people: [{ id: "ana", displayName: "Ana Silva an" }] },
    });
    expect(events).toEqual([
      expect.objectContaining({
        name: "mention.search",
        mention: { result_count: 1 },
      }),
    ]);
    expect(JSON.stringify(events)).not.toContain("Ana Silva");
  });

  it("keeps the connection's secret out of a failed read and its event", async () => {
    const { server, connectionId, events } = await createServer({
      connector: { comments: {} },
    });

    const response = await dispatchJsonRequest(server, {
      method: "POST",
      path: listPath(connectionId),
      body: JSON.stringify({ sourceId: "broken", limit: 5 }),
    });

    expect(response.status).toBe(502);
    expect(JSON.stringify(response.body)).not.toContain(TOKEN);
    expect(events).toEqual([
      expect.objectContaining({
        name: "comment.list",
        outcome: "error",
        error: { type: "Error", message: "Could not read with [secret]" },
      }),
    ]);
    expect(JSON.stringify(events)).not.toContain(TOKEN);
  });
});

describe("backlog description routes", () => {
  const tempDirs: string[] = [];
  const servers: Server[] = [];

  afterEach(async () => {
    for (const server of servers.splice(0)) {
      server.emit("close");
    }
    await Promise.all(
      tempDirs
        .splice(0)
        .map((directory) => rm(directory, { recursive: true, force: true })),
    );
  });

  const descriptionPluginSource = [
    "export async function validateConnection(config) {",
    "  return { normalizedConfig: config, connectionSummary: {} };",
    "}",
    "export async function syncConnection() {",
    "  return { items: [], workItemUpdates: [] };",
    "}",
    "let text = 'Held by the source';",
    "export async function readDescription(connection, request) {",
    "  if (request.sourceId === 'FAIL-1') throw new Error('Item not found.');",
    "  if (request.sourceId === 'LEAK-1') {",
    "    throw new Error(`Refused token ${connection.config.apiToken}`);",
    "  }",
    "  return { description: { text } };",
    "}",
    "export async function writeDescription(connection, request) {",
    "  if (request.expected !== text) {",
    "    return { outcome: 'conflict', description: { text } };",
    "  }",
    "  text = request.text;",
    "  return { outcome: 'written', description: { text } };",
    "}",
  ].join("\n");

  async function createServer(description?: { write?: boolean }) {
    const root = await mkdtemp(
      path.join(os.tmpdir(), "ajour-description-api-"),
    );
    tempDirs.push(root);
    const pluginDirectory = await createPlugin(
      path.join(root, "source"),
      descriptionPluginSource,
      "plugin.mjs",
      {
        ...(description
          ? { capabilities: { connector: { description } } }
          : {}),
        connectionFields: [
          { id: "label", label: "Label", type: "text", required: true },
          {
            id: "tenantLabel",
            label: "Workspace",
            type: "text",
            required: true,
          },
          { id: "baseUrl", label: "Site URL", type: "url", required: true },
          {
            id: "apiToken",
            label: "API token",
            type: "password",
            required: true,
            secret: true,
          },
        ],
      },
    );
    const server = createAppApiServer({
      ...windowServerOptions,
      vault: new MemorySecretVault(),
      statePath: path.join(root, "state.json"),
      installedPluginDirectory: path.join(root, "installed"),
      developmentPluginDirectories: [pluginDirectory],
      allowDevelopmentPlugins: true,
    });
    servers.push(server);
    const connectionResponse = await dispatchJsonRequest(server, {
      method: "POST",
      path: "/api/plugins/jira/connections",
      body: JSON.stringify({
        values: {
          label: "Main Jira",
          tenantLabel: "Acme",
          autoSync: false,
          autoSyncIntervalMinutes: 15,
          baseUrl: "https://acme.atlassian.net",
          apiToken: "tok-12345",
        },
      }),
    });
    const connectionId = (
      connectionResponse.body as { connection: { id: string } }
    ).connection.id;
    const post = (action: string, body: unknown) =>
      dispatchJsonRequest(server, {
        method: "POST",
        path: `/api/plugins/jira/connections/${connectionId}/${action}`,
        body: JSON.stringify(body),
      });
    const saveSettings = (settings: Record<string, unknown>) =>
      dispatchJsonRequest(server, {
        method: "POST",
        path: "/api/plugins/jira/connections",
        body: JSON.stringify({
          id: connectionId,
          values: {
            label: "Main Jira",
            tenantLabel: "Acme",
            autoSync: false,
            autoSyncIntervalMinutes: 15,
            baseUrl: "https://acme.atlassian.net",
            apiToken: "tok-12345",
            ...settings,
          },
        }),
      });
    const allowLossy = (on: boolean) =>
      dispatchJsonRequest(server, {
        method: "POST",
        path: "/api/plugins/jira/connections",
        body: JSON.stringify({
          id: connectionId,
          values: {
            label: "Main Jira",
            tenantLabel: "Acme",
            autoSync: false,
            autoSyncIntervalMinutes: 15,
            baseUrl: "https://acme.atlassian.net",
            apiToken: "tok-12345",
            allowLossyConversion: on,
          },
        }),
      });
    return { post, allowLossy, saveSettings };
  }

  it("reads a description, and writes one only over the text it expects", async () => {
    const { post } = await createServer({ write: true });

    await expect(post("description", { sourceId: "OPEN-1" })).resolves.toEqual({
      status: 200,
      body: { description: { text: "Held by the source" } },
    });
    await expect(
      post("description-write", {
        sourceId: "OPEN-1",
        text: "Mine",
        expected: "Something older",
      }),
    ).resolves.toEqual({
      status: 200,
      body: {
        outcome: "conflict",
        description: { text: "Held by the source" },
      },
    });
    await expect(
      post("description-write", {
        sourceId: "OPEN-1",
        text: "Mine",
        expected: "Held by the source",
      }),
    ).resolves.toEqual({
      status: 200,
      body: { outcome: "written", description: { text: "Mine" } },
    });
  });

  it("rejects a malformed write and reports a failed read as a gateway error", async () => {
    const { post } = await createServer({ write: true });

    expect(
      (await post("description-write", { sourceId: "OPEN-1", text: "Mine" }))
        .status,
    ).toBe(400);
    await expect(post("description", { sourceId: "FAIL-1" })).resolves.toEqual({
      status: 502,
      body: { error: "Item not found." },
    });
  });

  it("hides the connection's secrets in a plugin's error", async () => {
    const { post } = await createServer({ write: true });

    await expect(post("description", { sourceId: "LEAK-1" })).resolves.toEqual({
      status: 502,
      body: { error: "Refused token [secret]" },
    });
  });

  it("checks an agent's description calls against the connection's Agent access", async () => {
    const { post, saveSettings } = await createServer({ write: true });
    const read = () => post("description?agent=1", { sourceId: "OPEN-1" });
    const write = () =>
      post("description-write?agent=1", {
        sourceId: "OPEN-1",
        text: "Mine",
        expected: "Held by the source",
      });

    await expect(read()).resolves.toEqual({
      status: 409,
      body: {
        error: `The user hasn't allowed agents to read descriptions on the "Main Jira" connection.`,
      },
    });
    expect((await saveSettings({ agentAccess: "read" })).status).toBe(200);
    expect((await read()).status).toBe(200);
    await expect(write()).resolves.toEqual({
      status: 409,
      body: {
        error: `The user hasn't allowed agents to change descriptions on the "Main Jira" connection.`,
      },
    });
    expect((await saveSettings({ agentAccess: "readWrite" })).status).toBe(200);
    expect((await write()).status).toBe(200);
    // Ajour's own pages are not agents.
    expect((await post("description", { sourceId: "OPEN-1" })).status).toBe(
      200,
    );
  });

  it("writes with losses only through a connection that allows lossy conversion", async () => {
    const { post, allowLossy } = await createServer({ write: true });
    const write = () =>
      post("description-write", {
        sourceId: "OPEN-1",
        text: "Mine",
        expected: "Held by the source",
        allowedLoss: ["underline"],
      });

    await expect(write()).resolves.toEqual({
      status: 409,
      body: { error: "This connection does not allow lossy conversion." },
    });
    expect((await allowLossy(true)).status).toBe(200);
    expect((await write()).status).toBe(200);
  });

  it("refuses to write through a plugin that only reads descriptions", async () => {
    const { post } = await createServer({});

    expect((await post("description", { sourceId: "OPEN-1" })).status).toBe(
      200,
    );
    await expect(
      post("description-write", {
        sourceId: "OPEN-1",
        text: "Mine",
        expected: "Held by the source",
      }),
    ).resolves.toEqual({
      status: 409,
      body: { error: "This plugin does not write descriptions." },
    });
  });

  it("refuses descriptions through a plugin that does not sync them", async () => {
    const { post } = await createServer();

    await expect(post("description", { sourceId: "OPEN-1" })).resolves.toEqual({
      status: 409,
      body: { error: "This plugin does not sync descriptions." },
    });
  });
});

describe("plugin errors that echo a secret", () => {
  const tempDirs: string[] = [];
  const servers: Server[] = [];
  const TOKEN = "pat-7c1e9a2b4d6f8a0c";
  const PIN = 482913;
  const SITE = "https://acme.atlassian.net";

  afterEach(async () => {
    for (const server of servers.splice(0)) {
      server.emit("close");
    }
    await Promise.all(
      tempDirs
        .splice(0)
        .map((directory) => rm(directory, { recursive: true, force: true })),
    );
  });

  // Every operation fails with a message that names the token it was given.
  const leakingPluginSource = [
    "export async function validateConnection(config) {",
    "  if (config.baseUrl.endsWith('/refused')) throw new Error(`Token ${config.token} was refused.`);",
    "  const connectionSummary = { site: config.baseUrl, auth: `Bearer ${config.token}` };",
    "  if (config.pin !== undefined) connectionSummary.pin = config.pin;",
    "  if (config.token?.length <= 120) connectionSummary[config.token] = 'Connected';",
    "  return { normalizedConfig: config, connectionSummary };",
    "}",
    "const leak = (what) => async (connection) => {",
    "  throw new Error(`${what} failed with token ${connection.config.token}.`);",
    "};",
    "export async function syncConnection(connection, workItems) {",
    "  if (workItems.some((workItem) => workItem.localWorkItemId === 'many')) {",
    "    return { items: [], workItemUpdates: Array.from({ length: 20000 }, (_, index) => ({",
    "      localWorkItemId: `w${index}`, sourceId: `S-${index}`, fields: { remainingEstimateHours: {",
    "        status: 'error',",
    "        message: index === 0 ? `PATCH failed with token ${connection.config.token}.` : 'Estimate rejected…',",
    "      } },",
    "    })) };",
    "  }",
    "  if (workItems.some((workItem) => workItem.localWorkItemId === 'estimate')) {",
    "    return { items: [], workItemUpdates: [{ localWorkItemId: 'estimate', sourceId: 'OPEN-1', fields: {",
    "      remainingEstimateHours: { status: 'error', message: `PATCH failed with token ${connection.config.token}` },",
    "      originalEstimateHours: { status: 'pushed', localValue: 3 },",
    "    } }] };",
    "  }",
    "  throw new Error(`Sync failed with token ${connection.config.token} and PIN ${connection.config.pin}.`);",
    "}",
    "export async function listSettleStates(connection, request) {",
    "  if (request.sourceId === 'LONG') throw new Error(`${connection.config.token} `.repeat(11));",
    "  return leak('Listing states')(connection);",
    "}",
    "export async function writeSettle(connection, request) {",
    "  if (request.sourceId === 'EDGE') throw new Error(`${connection.config.token} failed`);",
    "  return leak('Settling')(connection);",
    "}",
    "export const syncPullRequests = leak('Pull request sync');",
    "export const getPullRequestContent = leak('Reading the pull request');",
    "export const readDescription = leak('Reading the description');",
    "export const writeDescription = leak('Writing the description');",
  ].join("\n");

  /** The fixture's fields; `token` is secret unless a test says otherwise. */
  const leakingFields = (tokenSecret = true) => [
    { id: "label", label: "Label", type: "text", required: true },
    { id: "tenantLabel", label: "Site", type: "text", required: true },
    { id: "baseUrl", label: "Site URL", type: "url", required: true },
    {
      id: "token",
      label: "API token",
      type: "password",
      secret: tokenSecret,
    },
    { id: "pin", label: "PIN", type: "number", secret: true },
  ];

  async function createServer(
    savedState?: object,
    plugin: { source?: string; connectionFields?: object[] } = {},
  ) {
    const root = await mkdtemp(path.join(os.tmpdir(), "ajour-leak-api-"));
    tempDirs.push(root);
    const statePath = path.join(root, "state.json");
    if (savedState) {
      await writeFile(statePath, JSON.stringify(savedState), "utf8");
    }
    const pluginDirectory = await createPlugin(
      path.join(root, "source"),
      plugin.source ?? leakingPluginSource,
      "plugin.mjs",
      {
        capabilities: {
          connector: { settle: true, description: { write: true } },
          codeHost: {},
        },
        connectionFields: plugin.connectionFields ?? leakingFields(),
      },
    );
    const server = createAppApiServer({
      ...windowServerOptions,
      vault: new MemorySecretVault(),
      statePath,
      installedPluginDirectory: path.join(root, "installed"),
      developmentPluginDirectories: [pluginDirectory],
      allowDevelopmentPlugins: true,
    });
    servers.push(server);
    return { server, statePath, pluginDirectory };
  }

  const saveConnection = (
    server: Server,
    values: Record<string, unknown>,
    id?: string,
  ) =>
    dispatchJsonRequest(server, {
      method: "POST",
      path: "/api/plugins/jira/connections",
      body: JSON.stringify({
        ...(id ? { id } : {}),
        values: {
          label: "Main Jira",
          tenantLabel: "Acme",
          autoSync: false,
          autoSyncIntervalMinutes: 15,
          baseUrl: SITE,
          ...values,
        },
      }),
    });

  it("keeps the submitted and the stored token out of a refused save", async () => {
    const { server } = await createServer();

    await expect(
      saveConnection(server, {
        baseUrl: `${SITE}/refused`,
        token: TOKEN,
      }),
    ).resolves.toEqual({
      status: 400,
      body: { error: "Token [secret] was refused." },
    });

    const saved = await saveConnection(server, { token: TOKEN });
    const connectionId = (saved.body as { connection: { id: string } })
      .connection.id;
    // A blank secret keeps the stored one, so the plugin gets the stored token.
    await expect(
      saveConnection(
        server,
        { baseUrl: `${SITE}/refused`, token: "" },
        connectionId,
      ),
    ).resolves.toEqual({
      status: 400,
      body: { error: "Token [secret] was refused." },
    });
  });

  it("refuses to save a connection for a plugin that is not installed", async () => {
    const { server } = await createServer();

    await expect(
      dispatchJsonRequest(server, {
        method: "POST",
        path: "/api/plugins/gone/connections",
        body: JSON.stringify({
          values: {
            label: "Old",
            tenantLabel: "Acme",
            baseUrl: SITE,
            token: TOKEN,
          },
        }),
      }),
    ).resolves.toEqual({
      status: 400,
      body: { error: 'Plugin "gone" is not installed.' },
    });
  });

  async function createConnection(values: Record<string, unknown> = {}) {
    const { server, statePath } = await createServer();
    const saved = await saveConnection(server, {
      token: TOKEN,
      pin: PIN,
      ...values,
    });
    const connectionId = (saved.body as { connection: { id: string } })
      .connection.id;
    return { server, statePath, connectionId };
  }

  it("keeps the token out of a failed settle", async () => {
    const { server, connectionId } = await createConnection();

    await expect(
      dispatchJsonRequest(server, {
        method: "POST",
        path: `/api/plugins/jira/connections/${connectionId}/settle-states`,
        body: JSON.stringify({ sourceId: "OPEN-1" }),
      }),
    ).resolves.toEqual({
      status: 502,
      body: { error: "Listing states failed with token [secret]." },
    });
    await expect(
      dispatchJsonRequest(server, {
        method: "POST",
        path: `/api/plugins/jira/connections/${connectionId}/settle`,
        body: JSON.stringify({ sourceId: "OPEN-1", state: "Done" }),
      }),
    ).resolves.toEqual({
      status: 502,
      body: { error: "Settling failed with token [secret]." },
    });
  });

  it("redacts 20,000 field messages of one sync against long secrets in one go", async () => {
    // 20 undeclared values of 4,000 characters, and every message cut, so
    // each one needs the cut rule against every long value.
    const { server, connectionId } = await createConnection(
      Object.fromEntries(
        Array.from({ length: 20 }, (_, index) => [
          `old${index}`,
          `${"k".repeat(3_990)}${index}`,
        ]),
      ),
    );

    const started = performance.now();
    const synced = await dispatchJsonRequest(server, {
      method: "POST",
      path: `/api/plugins/jira/connections/${connectionId}/sync`,
      body: JSON.stringify({
        trigger: "manual",
        workItems: [{ localWorkItemId: "many", sourceId: "OPEN-1" }],
      }),
    });
    const milliseconds = performance.now() - started;

    expect(synced.status).toBe(200);
    expect(milliseconds).toBeLessThan(2_000);
    const messages = (
      synced.body as {
        workItemUpdates: {
          fields: { remainingEstimateHours: { message: string } };
        }[];
      }
    ).workItemUpdates.map(
      (update) => update.fields.remainingEstimateHours.message,
    );
    expect(messages).toHaveLength(20_000);
    expect(messages[0]).toBe("PATCH failed with token [secret].");
    // Once the request's budget is spent, the rest are hidden.
    expect(
      messages
        .slice(1)
        .every(
          (message) =>
            message === "Estimate rejected…" ||
            message === "Hidden because it couldn't be checked for secrets.",
        ),
    ).toBe(true);
    expect(JSON.stringify(synced.body)).not.toContain(TOKEN);
  }, 30_000);

  it("keeps the token out of the field messages of a successful sync", async () => {
    const { server, connectionId } = await createConnection();

    const synced = await dispatchJsonRequest(server, {
      method: "POST",
      path: `/api/plugins/jira/connections/${connectionId}/sync`,
      body: JSON.stringify({
        trigger: "manual",
        workItems: [{ localWorkItemId: "estimate", sourceId: "OPEN-1" }],
      }),
    });

    expect(synced).toMatchObject({
      status: 200,
      body: {
        workItemUpdates: [
          {
            localWorkItemId: "estimate",
            fields: {
              remainingEstimateHours: {
                status: "error",
                message: "PATCH failed with token [secret]",
              },
              originalEstimateHours: { status: "pushed", localValue: 3 },
            },
          },
        ],
      },
    });
    expect(JSON.stringify(synced.body)).not.toContain(TOKEN);
  });

  it("keeps the token and the PIN out of the connection summary the plugin wrote", async () => {
    const { server } = await createConnection();

    const overview = await dispatchJsonRequest(server, {
      method: "GET",
      path: "/api/plugins",
    });

    expect(JSON.stringify(overview.body)).not.toContain(TOKEN);
    expect(
      (
        overview.body as {
          connectionGroups: {
            connections: { configSummary: Record<string, unknown> }[];
          }[];
        }
      ).connectionGroups[0]?.connections[0]?.configSummary,
    ).toEqual({ site: SITE, auth: "Bearer [secret]", pin: "[secret]" });
  });

  it("keeps a password the plugin swapped for a token out of the stored summary", async () => {
    const { server, statePath } = await createServer(undefined, {
      source: [
        "export async function validateConnection(config) {",
        "  return {",
        "    normalizedConfig: { baseUrl: config.baseUrl, accessToken: 'access-7f3e' },",
        "    connectionSummary: { signedIn: `Signed in with ${config.password}` },",
        "  };",
        "}",
      ].join("\n"),
      connectionFields: [
        ...leakingFields().slice(0, 3),
        { id: "password", label: "Password", type: "password", secret: true },
      ],
    });

    const saved = await saveConnection(server, { password: "hunter2-pw" });

    expect(saved.status).toBe(200);
    expect(JSON.stringify(saved.body)).not.toContain("hunter2-pw");
    const state = await readFile(statePath, "utf8");
    expect(state).not.toContain("hunter2-pw");
    expect(JSON.parse(state).connections[0].configSummary).toEqual({
      signedIn: "Signed in with [secret]",
    });
  });

  /**
   * Saves a connection whose token is not secret yet, posts `body` to the
   * connection's `action`, and marks the token secret in an update while the
   * route waits for the body.
   */
  async function postWhileTheTokenTurnsSecret(action: string, body: object) {
    const { server, pluginDirectory } = await createServer(undefined, {
      connectionFields: leakingFields(false),
    });
    const saved = await saveConnection(server, { token: TOKEN, pin: PIN });
    const connectionId = (saved.body as { connection: { id: string } })
      .connection.id;
    let reached!: () => void;
    const bodyRequested = new Promise<void>((resolve) => {
      reached = resolve;
    });
    let release!: () => void;
    const bodyReleased = new Promise<void>((resolve) => {
      release = resolve;
    });

    const posting = dispatchJsonRequest(server, {
      method: "POST",
      path: `/api/plugins/jira/connections/${connectionId}/${action}`,
      body: JSON.stringify(body),
      bodyGate: { reached, release: bodyReleased },
    });
    await bodyRequested;
    const manifestPath = path.join(pluginDirectory, "plugin.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    await writeFile(
      manifestPath,
      JSON.stringify({ ...manifest, connectionFields: leakingFields(true) }),
    );
    release();
    return await posting;
  }

  it("redacts with the manifest the call ran with, when an update lands while the request waits", async () => {
    await expect(
      postWhileTheTokenTurnsSecret("settle-states", { sourceId: "OPEN-1" }),
    ).resolves.toEqual({
      status: 502,
      body: { error: "Listing states failed with token [secret]." },
    });
  });

  it("redacts a description call with the manifest it ran with, too", async () => {
    await expect(
      postWhileTheTokenTurnsSecret("description", { sourceId: "OPEN-1" }),
    ).resolves.toEqual({
      status: 502,
      body: { error: "Reading the description failed with token [secret]." },
    });
  });

  it("redacts a description write with the manifest it ran with, too", async () => {
    await expect(
      postWhileTheTokenTurnsSecret("description-write", {
        sourceId: "OPEN-1",
        text: "New text",
        expected: "Old text",
      }),
    ).resolves.toEqual({
      status: 502,
      body: { error: "Writing the description failed with token [secret]." },
    });
  });

  it("keeps out a token with a space in front, which the host's trim takes off", async () => {
    const { server, connectionId } = await createConnection({
      token: " pat-edge-7c1e",
    });

    await expect(
      dispatchJsonRequest(server, {
        method: "POST",
        path: `/api/plugins/jira/connections/${connectionId}/settle`,
        body: JSON.stringify({ sourceId: "EDGE", state: "Done" }),
      }),
    ).resolves.toEqual({ status: 502, body: { error: "[secret] failed" } });
  });

  it("keeps out the start of a token that the worker's cut splits", async () => {
    const longToken = `pat-${"7c1e9a2b".repeat(50)}`;
    const { server, connectionId } = await createConnection({
      token: longToken,
    });

    // 11 copies of 405 characters: the worker keeps 4,095 of them, 10 whole
    // copies and the first 45 characters of the 11th, then adds "…".
    await expect(
      dispatchJsonRequest(server, {
        method: "POST",
        path: `/api/plugins/jira/connections/${connectionId}/settle-states`,
        body: JSON.stringify({ sourceId: "LONG" }),
      }),
    ).resolves.toEqual({
      status: 502,
      body: { error: `${"[secret] ".repeat(10)}[secret]…` },
    });
  });

  /** The last error as saved, read from the state file rather than the overview, which redacts again. */
  async function storedLastError(statePath: string, connectionId: string) {
    const state = JSON.parse(await readFile(statePath, "utf8")) as {
      connections: { id: string; lastError?: string }[];
    };
    return state.connections.find(
      (connection) => connection.id === connectionId,
    )?.lastError;
  }

  /** The last error as `GET /api/plugins` shows it. */
  async function shownLastError(server: Server) {
    const overview = await dispatchJsonRequest(server, {
      method: "GET",
      path: "/api/plugins",
    });
    expect(overview.status).toBe(200);
    return (
      overview.body as {
        connectionGroups: { connections: { lastError?: string }[] }[];
      }
    ).connectionGroups[0]?.connections[0]?.lastError;
  }

  it("keeps the token and the numeric PIN out of a failed backlog sync and its stored error", async () => {
    const { server, statePath, connectionId } = await createConnection();

    const synced = await dispatchJsonRequest(server, {
      method: "POST",
      path: `/api/plugins/jira/connections/${connectionId}/sync`,
      body: JSON.stringify({ trigger: "manual", workItems: [] }),
    });

    const redacted = "Sync failed with token [secret] and PIN [secret].";
    expect(synced).toMatchObject({
      status: 502,
      body: { error: redacted, connection: { lastError: redacted } },
    });
    expect(JSON.stringify(synced.body)).not.toContain(TOKEN);
    expect(await storedLastError(statePath, connectionId)).toBe(redacted);
  });

  it("keeps the token out of failed pull request calls and the stored error", async () => {
    const { server, statePath, connectionId } = await createConnection();

    await expect(
      dispatchJsonRequest(server, {
        method: "POST",
        path: `/api/code-hosts/jira/connections/${connectionId}/getPullRequestContent`,
        body: JSON.stringify({ repository: "acme/api", number: 7 }),
      }),
    ).resolves.toEqual({
      status: 502,
      body: { error: "Reading the pull request failed with token [secret]." },
    });
    await expect(
      dispatchJsonRequest(server, {
        method: "POST",
        path: `/api/code-hosts/jira/connections/${connectionId}/syncPullRequests`,
        body: JSON.stringify({ tracked: [] }),
      }),
    ).resolves.toEqual({
      status: 502,
      body: { error: "Pull request sync failed with token [secret]." },
    });
    expect(await storedLastError(statePath, connectionId)).toBe(
      "Pull request sync failed with token [secret].",
    );
  });

  /** A state file holding one saved connection with a last error. */
  const savedState = (connection: Record<string, unknown>) => ({
    version: 7,
    connections: [
      {
        id: "saved-jira",
        pluginId: "jira",
        label: "Main Jira",
        tenantLabel: "Acme",
        autoSync: false,
        autoSyncIntervalMinutes: 15,
        connectedAt: 1,
        configSummary: {},
        lastErrorAt: 2,
        ...connection,
      },
    ],
    disabledPluginIds: [],
    pluginsEnabled: true,
  });

  it("hides the token in a last error stored before errors were redacted", async () => {
    const { server } = await createServer(
      savedState({
        config: { baseUrl: SITE, token: TOKEN },
        lastError: `Sync failed with token ${TOKEN}.`,
      }),
    );

    const overview = await dispatchJsonRequest(server, {
      method: "GET",
      path: "/api/plugins",
    });

    expect(JSON.stringify(overview.body)).not.toContain(TOKEN);
    expect(await shownLastError(server)).toBe(
      "Sync failed with token [secret].",
    );
  });

  it("shows a redacted stored error as it is, even when the token's value is secret", async () => {
    const { server } = await createServer(
      savedState({
        config: { baseUrl: SITE, token: "secret" },
        lastError: "Sync failed with token [secret].",
      }),
    );

    expect(await shownLastError(server)).toBe(
      "Sync failed with token [secret].",
    );
  });

  it("keeps a stored error within the overview's limit when a short secret grows into [secret]", async () => {
    const { server } = await createServer(
      savedState({
        config: { baseUrl: SITE, token: "k9x" },
        // 1,000 characters, the most a last error keeps.
        lastError: "k9x ".repeat(250),
      }),
    );

    // 111 replacements of 9 characters fill 999, then the ellipsis.
    expect(await shownLastError(server)).toBe(`${"[secret] ".repeat(111)}…`);
  });

  /** The overview, timed after a first request has warmed the server up. */
  async function timedOverview(server: Server) {
    await dispatchJsonRequest(server, { method: "GET", path: "/api/plugins" });
    const started = performance.now();
    const overview = await dispatchJsonRequest(server, {
      method: "GET",
      path: "/api/plugins",
    });
    const connection = (
      overview.body as {
        connectionGroups: {
          connections: {
            lastError?: string;
            configSummary: Record<string, unknown>;
          }[];
        }[];
      }
    ).connectionGroups[0]?.connections[0];
    return {
      status: overview.status,
      body: JSON.stringify(overview.body),
      connection,
      milliseconds: performance.now() - started,
    };
  }

  it("answers the overview quickly when many stored values grow into one another", async () => {
    // 1,000 undeclared values, "a" to "a".repeat(1000).
    const { server } = await createServer(
      savedState({
        config: {
          baseUrl: SITE,
          token: TOKEN,
          ...Object.fromEntries(
            Array.from({ length: 1_000 }, (_, index) => [
              `old${index}`,
              "a".repeat(index + 1),
            ]),
          ),
        },
        configSummary: Object.fromEntries(
          Array.from({ length: 50 }, (_, index) => [
            `key${index}`,
            "a".repeat(1_000),
          ]),
        ),
        lastError: "a".repeat(1_000),
      }),
    );

    const overview = await timedOverview(server);

    expect(overview.status).toBe(200);
    expect(overview.milliseconds).toBeLessThan(200);
    expect(overview.connection).toMatchObject({
      lastError: "Hidden because it couldn't be checked for secrets.",
      configSummary: {},
    });
    expect(overview.body).not.toContain("a".repeat(50));
  });

  it("answers the overview quickly when long stored values almost match a cut summary", async () => {
    // 20 undeclared values of "a".repeat(3990) and an id.
    const { server } = await createServer(
      savedState({
        config: {
          baseUrl: SITE,
          token: TOKEN,
          ...Object.fromEntries(
            Array.from({ length: 20 }, (_, index) => [
              `old${index}`,
              `${"a".repeat(3_990)}${index}`,
            ]),
          ),
        },
        configSummary: Object.fromEntries(
          Array.from({ length: 50 }, (_, index) => [
            `key${index}`,
            `${"a".repeat(998)}b…`,
          ]),
        ),
        lastError: `x ${"a".repeat(997)}…`,
      }),
    );

    const overview = await timedOverview(server);

    expect(overview.status).toBe(200);
    expect(overview.milliseconds).toBeLessThan(200);
    expect(overview.connection).toMatchObject({
      lastError: "x [secret]…",
      // Every value is shorter than every secret and ends in "b…", which no
      // secret starts with, so the summary stays as it is.
      configSummary: Object.fromEntries(
        Array.from({ length: 50 }, (_, index) => [
          `key${index}`,
          `${"a".repeat(998)}b…`,
        ]),
      ),
    });
    // Each secret holds 3,990 "a"s, and no text shows more than 998.
    expect(overview.body).not.toContain("a".repeat(999));
  });

  it("hides a stored value whose field a plugin update dropped", async () => {
    // The fixture declares token but no longer apiKey.
    const { server } = await createServer(
      savedState({
        config: { baseUrl: SITE, token: TOKEN, apiKey: "old-key-4f2a" },
        lastError: `Old key old-key-4f2a failed for Acme at ${SITE}.`,
      }),
    );

    expect(await shownLastError(server)).toBe(
      `Old key [secret] failed for Acme at ${SITE}.`,
    );
  });

  it("hides the whole last error of an uninstalled plugin's connection", async () => {
    const { server } = await createServer(
      savedState({
        id: "saved-gitea",
        pluginId: "gitea",
        label: "Old Gitea",
        config: { baseUrl: SITE, token: TOKEN, pin: PIN },
        configSummary: { auth: `Bearer ${TOKEN}` },
        lastError: `Sync of ${SITE} failed with token ${TOKEN} and PIN ${PIN}.`,
      }),
    );

    const overview = await dispatchJsonRequest(server, {
      method: "GET",
      path: "/api/plugins",
    });

    expect(overview.status).toBe(200);
    expect(JSON.stringify(overview.body)).not.toContain(TOKEN);
    const gitea = (
      overview.body as {
        connectionGroups: {
          plugin: { id: string };
          connections: { lastError?: string }[];
        }[];
      }
    ).connectionGroups.find((group) => group.plugin.id === "gitea");
    // Without its manifest, nothing says which stored values are secret.
    expect(gitea?.connections[0]?.lastError).toBe(
      "Hidden because this plugin is no longer installed.",
    );
  });

  it("bounds a data shape plugin's error like a connection's", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ajour-leak-shape-"));
    tempDirs.push(root);
    const pluginDirectory = await createProjectDataShapePlugin(
      root,
      [
        "const fail = async () => { throw new Error(`Bad row ${'x'.repeat(3000)}`); };",
        "export const exportProjects = fail;",
        "export const importProjects = fail;",
      ].join("\n"),
    );
    const server = createAppApiServer({
      ...windowServerOptions,
      vault: new MemorySecretVault(),
      statePath: path.join(root, "state.json"),
      installedPluginDirectory: path.join(root, "installed"),
      projectDataShapePluginDirectories: [pluginDirectory],
      allowDevelopmentPlugins: false,
    });
    servers.push(server);

    for (const [operation, body] of [
      ["export", { projects: [] }],
      ["import", { sheets: [{ name: "Projects", rows: [] }] }],
    ] as const) {
      const response = await dispatchJsonRequest(server, {
        method: "POST",
        path: `/api/project-data-shapes/workday-project-data/${operation}`,
        body: JSON.stringify(body),
      });
      expect(response.status).toBe(400);
      const { error } = response.body as { error: string };
      expect(error).toMatch(/^Bad row x+…$/);
      expect(error).toHaveLength(1_000);
    }
  });
});

describe("saving a connection's secrets", () => {
  const tempDirs: string[] = [];
  const servers: Server[] = [];
  const TOKEN = "pat-3d9b0e71c4a2f6e8";
  const NEW_TOKEN = "pat-81f4c0a9d2e37b56";

  afterEach(async () => {
    for (const server of servers.splice(0)) {
      server.emit("close");
    }
    await Promise.all(
      tempDirs
        .splice(0)
        .map((directory) => rm(directory, { recursive: true, force: true })),
    );
  });

  async function createServer() {
    const root = await mkdtemp(path.join(os.tmpdir(), "ajour-secret-save-"));
    tempDirs.push(root);
    const statePath = path.join(root, "state.json");
    const pluginDirectory = await createPlugin(
      path.join(root, "source"),
      "export async function validateConnection(config) {\n  return { normalizedConfig: config, connectionSummary: {} };\n}",
      "plugin.mjs",
      {
        connectionFields: [
          { id: "label", label: "Label", type: "text", required: true },
          { id: "tenantLabel", label: "Site", type: "text", required: true },
          { id: "baseUrl", label: "Site URL", type: "url", required: true },
          { id: "token", label: "API token", type: "password", secret: true },
        ],
      },
    );
    const vault = new MemorySecretVault();
    const server = createAppApiServer({
      ...windowServerOptions,
      vault,
      statePath,
      installedPluginDirectory: path.join(root, "installed"),
      developmentPluginDirectories: [pluginDirectory],
      allowDevelopmentPlugins: true,
    });
    servers.push(server);
    return { server, statePath, vault };
  }

  /** The token the vault holds for the connection, if any. */
  const vaultedToken = (vault: MemorySecretVault) => {
    const entry = vault
      .contents()
      .find((candidate) => candidate.fieldId === "token");
    return entry && JSON.parse(entry.value);
  };

  const save = (
    server: Server,
    values: Record<string, unknown>,
    extras: { id?: string; removeSecrets?: string[] } = {},
  ) =>
    dispatchJsonRequest(server, {
      method: "POST",
      path: "/api/plugins/jira/connections",
      body: JSON.stringify({
        ...extras,
        values: {
          label: "Main Jira",
          tenantLabel: "Acme",
          baseUrl: "https://acme.atlassian.net",
          ...values,
        },
      }),
    });

  const storedConfig = async (statePath: string) =>
    (
      JSON.parse(await readFile(statePath, "utf8")) as {
        connections: { config: Record<string, unknown> }[];
      }
    ).connections[0]!.config;

  async function savedConnection(server: Server) {
    const saved = await save(server, { token: TOKEN });
    expect(saved.status).toBe(200);
    return (saved.body as { connection: { id: string } }).connection.id;
  }

  it("keeps the secret in the vault, and only which field it is in the state file", async () => {
    const { server, statePath, vault } = await createServer();
    await savedConnection(server);

    expect(vaultedToken(vault)).toBe(TOKEN);
    expect(await readFile(statePath, "utf8")).not.toContain(TOKEN);
    const [connection] = (
      JSON.parse(await readFile(statePath, "utf8")) as {
        connections: { config: object; secrets: object }[];
      }
    ).connections;
    expect(connection).toMatchObject({
      config: { baseUrl: "https://acme.atlassian.net" },
      secrets: { fields: ["token"] },
    });
  });

  it("keeps the saved secret when a save leaves it empty", async () => {
    const { server, statePath, vault } = await createServer();
    const id = await savedConnection(server);

    const saved = await save(server, { token: "" }, { id });

    expect(saved.status).toBe(200);
    expect(JSON.stringify(saved.body)).not.toContain(TOKEN);
    expect(vaultedToken(vault)).toBe(TOKEN);
    await expect(storedConfig(statePath)).resolves.not.toHaveProperty("token");
  });

  it("replaces the saved secret with a new value", async () => {
    const { server, statePath, vault } = await createServer();
    const id = await savedConnection(server);

    const saved = await save(server, { token: NEW_TOKEN }, { id });

    expect(saved.status).toBe(200);
    expect(JSON.stringify(saved.body)).not.toContain(NEW_TOKEN);
    expect(vaultedToken(vault)).toBe(NEW_TOKEN);
    expect(await readFile(statePath, "utf8")).not.toContain(NEW_TOKEN);
  });

  it("deletes the saved secret a save asks to remove", async () => {
    const { server, statePath, vault } = await createServer();
    const id = await savedConnection(server);

    const saved = await save(
      server,
      { token: "" },
      { id, removeSecrets: ["token"] },
    );

    expect(saved.status).toBe(200);
    expect(vaultedToken(vault)).toBeUndefined();
    const config = await storedConfig(statePath);
    expect(config).not.toHaveProperty("token");
    expect(await readFile(statePath, "utf8")).not.toContain(TOKEN);
  });

  it("refuses to remove a field that isn't secret, or a secret the save also replaces", async () => {
    const { server, vault } = await createServer();
    const id = await savedConnection(server);

    for (const [values, removeSecrets] of [
      [{}, ["baseUrl"]],
      [{ token: NEW_TOKEN }, ["token"]],
    ] as const) {
      const refused = await save(server, values, {
        id,
        removeSecrets: [...removeSecrets],
      });
      expect(refused.status).toBe(400);
      expect(JSON.stringify(refused.body)).not.toContain(NEW_TOKEN);
    }
    expect(vaultedToken(vault)).toBe(TOKEN);
  });
});
