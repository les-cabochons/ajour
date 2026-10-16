import os from "node:os";
import path from "node:path";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { create } from "tar";
import { afterEach, describe, expect, it } from "vitest";
import {
  createAppApiServer,
  installConnectorPluginForServer,
  uninstallConnectorPluginForServer,
} from "./server.ts";

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

async function createProjectDataShapePlugin(parent: string) {
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
  await writeFile(
    path.join(pluginDirectory, "plugin.mjs"),
    [
      "export async function exportProjects(projects) {",
      "  return { datasets: [{ id: 'projects', rows: projects.map((project) => ({ project: project.name })) }] };",
      "}",
      "export async function importProjects(datasets) {",
      "  return { projects: datasets[0].rows.map((row) => ({ name: row.project, color: '#123456', status: 'active', tasks: [] })) };",
      "}",
    ].join("\n"),
    "utf8",
  );
  return pluginDirectory;
}

async function dispatchJsonRequest(
  server: Server,
  options: {
    method: string;
    path: string;
    headers?: Record<string, string>;
    body?: Uint8Array | string;
  },
) {
  return await new Promise<{ status: number; body: unknown }>((resolve) => {
    const requestBody =
      options.body === undefined
        ? []
        : [
            typeof options.body === "string"
              ? Buffer.from(options.body)
              : Buffer.from(options.body),
          ];
    const request = {
      method: options.method,
      url: options.path,
      headers: Object.fromEntries(
        Object.entries(options.headers ?? {}).map(([key, value]) => [
          key.toLowerCase(),
          value,
        ]),
      ),
      async *[Symbol.asyncIterator]() {
        yield* requestBody;
      },
    } as unknown as IncomingMessage;
    let status = 0;
    const response = {
      setHeader() {
        return response;
      },
      writeHead(statusCode: number) {
        status = statusCode;
        return response;
      },
      end(payload?: string) {
        resolve({
          status,
          body: payload ? JSON.parse(payload) : undefined,
        });
        return response;
      },
    } as unknown as ServerResponse;

    server.emit("request", request, response);
  });
}

describe("connector plugin installation boundary", () => {
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

  it("installs and uninstalls a packaged connector through desktop-owned capabilities", async () => {
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
      statePath: path.join(root, "state.json"),
      installedPluginDirectory: path.join(root, "installed"),
      allowDevelopmentPlugins: false,
    });
    servers.push(server);

    const archiveBytes = await readFile(archivePath);
    const response = await installConnectorPluginForServer(
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

    const uninstallResponse = await uninstallConnectorPluginForServer(
      server,
      "jira",
    );
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
    "updates an outdated package and preserves its connections and enabled=%s choice",
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
        statePath,
        installedPluginDirectory: installedRoot,
        allowDevelopmentPlugins: false,
      });
      servers.push(server);

      const before = await dispatchJsonRequest(server, {
        method: "GET",
        path: "/api/connectors",
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

      const update = await installConnectorPluginForServer(
        server,
        await readFile(archivePath),
        path.basename(archivePath),
        { enableAfterInstall: false },
      );

      expect(update.replaced).toBe(true);
      // An update keeps the activation state instead of switching the plugin off.
      expect(update.overview.connectionGroups).toEqual([
        expect.objectContaining({
          plugin: expect.not.objectContaining({
            unavailableReason: expect.anything(),
          }),
          enabled,
        }),
      ]);
      expect(update.overview.connectionGroups[0]?.connections).toMatchObject([
        {
          id: savedConnection.id,
          label: savedConnection.label,
          autoSync: true,
        },
      ]);
      const savedState = JSON.parse(await readFile(statePath, "utf8"));
      expect(savedState.connections).toEqual([savedConnection]);
      expect(savedState.disabledPluginIds).toEqual(enabled ? [] : ["jira"]);
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
        statePath,
        installedPluginDirectory: installedRoot,
        allowDevelopmentPlugins: false,
      });
      servers.push(server);

      const update = await installConnectorPluginForServer(
        server,
        await readFile(archivePath),
        path.basename(archivePath),
      );

      expect(update.replaced).toBe(true);
      expect(update.overview.connectionGroups).toEqual([
        expect.objectContaining({
          enabled: true,
          inactiveCapabilities: [added],
          connections: [expect.objectContaining(after)],
        }),
      ]);
    },
  );

  it("does not expose connector package changes through the loopback HTTP server", async () => {
    const root = await tempDir();
    const server = createAppApiServer({
      statePath: path.join(root, "state.json"),
      installedPluginDirectory: path.join(root, "installed"),
      allowDevelopmentPlugins: false,
    });
    servers.push(server);

    const response = await dispatchJsonRequest(server, {
      method: "POST",
      path: "/api/connectors/plugins/install",
      headers: {
        "Content-Type": "application/octet-stream",
      },
      body: Buffer.from("untrusted-archive"),
    });

    expect(response).toEqual({
      status: 404,
      body: {
        error: "No route for POST /api/connectors/plugins/install",
      },
    });

    const uninstallResponse = await dispatchJsonRequest(server, {
      method: "DELETE",
      path: "/api/connectors/plugins/jira",
    });
    expect(uninstallResponse).toEqual({
      status: 404,
      body: {
        error: "No route for DELETE /api/connectors/plugins/jira",
      },
    });
  });

  it("deactivates the plugin system and hides data-shape plugins", async () => {
    const root = await tempDir();
    const server = createAppApiServer({
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
          datasets: [{ id: "projects", rows: [{ project: "Mercury" }] }],
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

  it("rejects browser requests from untrusted origins", async () => {
    const root = await tempDir();
    const server = createAppApiServer({
      statePath: path.join(root, "state.json"),
      installedPluginDirectory: path.join(root, "installed"),
      allowDevelopmentPlugins: false,
      allowedOrigins: ["app://local"],
    });
    servers.push(server);

    await expect(
      dispatchJsonRequest(server, {
        method: "POST",
        path: "/api/connectors/jira/activation",
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
      statePath: path.join(root, "state.json"),
      installedPluginDirectory: path.join(root, "installed"),
      allowDevelopmentPlugins: false,
    });
    servers.push(server);

    await expect(
      dispatchJsonRequest(server, {
        method: "GET",
        path: "/api/connectors",
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
      statePath: path.join(root, "state.json"),
      installedPluginDirectory: path.join(root, "installed"),
      developmentPluginDirectories: [pluginDirectory],
      allowDevelopmentPlugins: true,
    });
    servers.push(server);

    const connectionResponse = await dispatchJsonRequest(server, {
      method: "POST",
      path: "/api/connectors/jira/connections",
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
      path: "/api/connectors/jira/activation",
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
        path: `/api/connectors/jira/connections/${connectionId}/sync`,
        body: JSON.stringify({ trigger: "manual", workItems: [] }),
      }),
    ).resolves.toEqual({
      status: 409,
      body: {
        error: "Activate this connector plugin before syncing.",
      },
    });
  });
});

describe("connector settle routes", () => {
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
    "});",
    "export async function syncConnection(connection) {",
    "  return {",
    "    items: [item('OPEN-1', 'In Progress', false), item('DONE-1', 'Done', true)]",
    "      .map((candidate) => ({ ...candidate, connectionId: connection.id })),",
    "    workItemUpdates: [],",
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
      statePath: path.join(root, "state.json"),
      installedPluginDirectory: path.join(root, "installed"),
      developmentPluginDirectories: [pluginDirectory],
      allowDevelopmentPlugins: true,
    });
    servers.push(server);
    const connectionResponse = await dispatchJsonRequest(server, {
      method: "POST",
      path: "/api/connectors/jira/connections",
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
        path: `/api/connectors/jira/connections/${connectionId}/settle-states`,
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
        path: `/api/connectors/jira/connections/${connectionId}/settle`,
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
      path: `/api/connectors/jira/connections/${connectionId}/settle`,
      body: JSON.stringify({ sourceId: "OPEN-1" }),
    });
    expect(empty.status).toBe(400);

    await expect(
      dispatchJsonRequest(server, {
        method: "POST",
        path: `/api/connectors/jira/connections/${connectionId}/settle`,
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
        path: `/api/connectors/jira/connections/${connectionId}/settle-states`,
        body: JSON.stringify({ sourceId: "OPEN-1" }),
      }),
    ).resolves.toEqual({
      status: 409,
      body: { error: "This connector plugin does not support settling." },
    });
  });

  it("returns done items from a sync instead of staging them for review", async () => {
    const { server, connectionId } = await createServer({ settle: true });

    const synced = await dispatchJsonRequest(server, {
      method: "POST",
      path: `/api/connectors/jira/connections/${connectionId}/sync`,
      body: JSON.stringify({ trigger: "manual", workItems: [] }),
    });
    expect(synced).toMatchObject({
      status: 200,
      body: {
        stagedCount: 1,
        doneItems: [
          { source: "jira", connectionId, sourceId: "DONE-1", state: "Done" },
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
      statePath: path.join(root, "state.json"),
      installedPluginDirectory: path.join(root, "installed"),
      developmentPluginDirectories: [pluginDirectory],
      allowDevelopmentPlugins: true,
    });
    servers.push(server);
    const connectionResponse = await dispatchJsonRequest(server, {
      method: "POST",
      path: "/api/connectors/jira/connections",
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
      path: "/api/connectors",
    });
    const connection = (
      overview.body as {
        connectionGroups: { connections: { lastSyncAt?: number }[] }[];
      }
    ).connectionGroups[0]?.connections[0];
    expect(connection?.lastSyncAt).toEqual(expect.any(Number));
  });

  it("refuses backlog sync for a plugin without the connector capability", async () => {
    const { server, connectionId } = await createServer({ codeHost: {} });

    await expect(
      dispatchJsonRequest(server, {
        method: "POST",
        path: `/api/connectors/jira/connections/${connectionId}/sync`,
        body: JSON.stringify({ trigger: "manual" }),
      }),
    ).resolves.toEqual({
      status: 409,
      body: { error: "This plugin does not sync backlog items." },
    });
  });

  it("rejects unknown operations, connector-only plugins and malformed requests", async () => {
    const connectorOnly = await createServer({ connector: {} });
    await expect(
      dispatchJsonRequest(connectorOnly.server, {
        method: "POST",
        path: `/api/code-hosts/jira/connections/${connectorOnly.connectionId}/syncPullRequests`,
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
      path: "/api/connectors/jira/activation",
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
      path: "/api/connectors/jira/activation",
      body: JSON.stringify({ enabled: false, capability: "connector" }),
    });
    await expect(
      dispatchJsonRequest(server, {
        method: "POST",
        path: `/api/connectors/jira/connections/${connectionId}/sync`,
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
            path: "/api/connectors",
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
        path: "/api/connectors/jira/connections",
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
        path: "/api/connectors/jira/activation",
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
      path: "/api/connectors/jira/activation",
      body: JSON.stringify({ enabled: false, capability: "connector" }),
    });

    const response = await dispatchJsonRequest(server, {
      method: "POST",
      path: "/api/connectors/jira/connections",
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

  async function createServer() {
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
    const server = createAppApiServer({
      statePath: path.join(root, "state.json"),
      installedPluginDirectory: path.join(root, "installed"),
      developmentPluginDirectories: [pluginDirectory],
      allowDevelopmentPlugins: true,
    });
    servers.push(server);
    return server;
  }

  const save = (server: Server, route: string, values: object) =>
    dispatchJsonRequest(server, {
      method: "POST",
      path: `/api/agents/tasks/${route}/settings`,
      body: JSON.stringify({ values }),
    });

  it("answers 404 for a plugin or task the plugins do not declare", async () => {
    const server = await createServer();
    await expect(save(server, "nope/enter-week", {})).resolves.toMatchObject({
      status: 404,
      body: { error: expect.any(String) },
    });
    await expect(save(server, "jira/nope", {})).resolves.toMatchObject({
      status: 404,
      body: { error: expect.any(String) },
    });
  });

  it("keeps only declared settings and refuses a bad URL", async () => {
    const server = await createServer();
    const saved = await save(server, "jira/enter-week", {
      url: "https://wd.example/t",
      note: "hi",
      stray: "dropped",
    });
    expect(saved.status).toBe(200);
    const [task] = (saved.body as { tasks: { values: object }[] }).tasks;
    expect(task!.values).toEqual({ url: "https://wd.example/t", note: "hi" });

    await expect(
      save(server, "jira/enter-week", { url: "javascript:alert(1)" }),
    ).resolves.toMatchObject({ status: 400 });
    await expect(
      save(server, "jira/enter-week", { url: "not a url" }),
    ).resolves.toMatchObject({ status: 400 });
    // An empty value is allowed: the runner blocks the run until it is filled.
    await expect(
      save(server, "jira/enter-week", { url: "" }),
    ).resolves.toMatchObject({ status: 200 });
  });
});
