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
  installPluginForServer,
  uninstallPluginForServer,
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

      const update = await installPluginForServer(
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

  it("does not expose plugin package changes through the loopback HTTP server", async () => {
    const root = await tempDir();
    const server = createAppApiServer({
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
    const events: Record<string, unknown>[] = [];
    const server = createAppApiServer({
      statePath: path.join(root, "state.json"),
      installedPluginDirectory: path.join(root, "installed"),
      developmentPluginDirectories: [pluginDirectory],
      allowDevelopmentPlugins: true,
      mcpLogEvent: (event) => events.push(event),
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
      (event) => event.event === "calendar.operation",
    );
    expect(logged).toEqual([
      expect.objectContaining({
        operation: "listCalendarEvents",
        plugin_id: "jira",
        connection_id: connectionId,
        range_days: 7,
        event_count: 1,
        outcome: "ok",
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
        event: "calendar.operation",
        outcome: "error",
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
    "  if (request.sourceId === 'slow') await new Promise((resolve) => setTimeout(resolve, 300));",
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
    const events: Record<string, unknown>[] = [];
    const server = createAppApiServer({
      statePath: path.join(root, "state.json"),
      installedPluginDirectory: path.join(root, "installed"),
      developmentPluginDirectories: [pluginDirectory],
      allowDevelopmentPlugins: true,
      mcpLogEvent: (event) => events.push(event),
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
    const { server, connectionId, events } = await createServer({
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
    const slow = call("listItemComments", { sourceId: "slow", limit: 5 });
    await new Promise((resolve) => setTimeout(resolve, 50));
    await setAccess("none");
    expect(await slow).toMatchObject({ status: 403 });
    expect(events.filter((event) => event.outcome === "refused")).toHaveLength(
      3,
    );
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

    const logged = events.filter((event) => event.event === "backlog.comments");
    expect(logged).toEqual([
      expect.objectContaining({
        operation: "listItemComments",
        plugin_id: "jira",
        connection_id: connectionId,
        comment_count: 1,
        outcome: "ok",
      }),
    ]);
    expect(JSON.stringify(logged)).not.toContain("Secret client detail");
    expect(JSON.stringify(logged)).not.toContain("Ana Silva");
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
    const logged = events.filter((event) => event.event === "backlog.comments");
    expect(logged).toEqual([
      expect.objectContaining({
        operation: "postItemComment",
        comment_count: 1,
        outcome: "ok",
      }),
    ]);
    expect(JSON.stringify(logged)).not.toContain("Private reply");

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
        body: JSON.stringify({ ...ref, body: "Changed" }),
      }),
    ).resolves.toMatchObject({
      status: 200,
      body: { comment: { id: "c1", body: "Changed" } },
    });
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
    const logged = events.filter((event) => event.event === "backlog.comments");
    expect(JSON.stringify(logged)).not.toContain("Ana Silva");
  });

  it("keeps the connection's secret out of a failed read", async () => {
    const { server, connectionId } = await createServer({
      connector: { comments: {} },
    });

    const response = await dispatchJsonRequest(server, {
      method: "POST",
      path: listPath(connectionId),
      body: JSON.stringify({ sourceId: "broken", limit: 5 }),
    });

    expect(response.status).toBe(502);
    expect(JSON.stringify(response.body)).not.toContain(TOKEN);
  });
});
