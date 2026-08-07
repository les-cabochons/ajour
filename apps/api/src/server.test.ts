import os from "node:os";
import path from "node:path";
import type {
  IncomingMessage,
  Server,
  ServerResponse,
} from "node:http";
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
) {
  const pluginDirectory = path.join(parent, "jira");
  await mkdir(pluginDirectory, { recursive: true });
  await writeFile(
    path.join(pluginDirectory, "plugin.json"),
    JSON.stringify({
      id: "jira",
      version: "1.0.0",
      apiVersion: 1,
      displayName: "Jira",
      description: "Test connector.",
      iconSvg: ICON,
      entrypoint,
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
  return await new Promise<{ status: number; body: unknown }>(
    (resolve) => {
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
    },
  );
}

describe("connector plugin installation boundary", () => {
  const tempDirs: string[] = [];
  const servers: Server[] = [];

  async function tempDir() {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), "timetracker-plugin-api-"),
    );
    tempDirs.push(directory);
    return directory;
  }

  afterEach(async () => {
    for (const server of servers.splice(0)) {
      server.emit("close");
    }
    await Promise.all(
      tempDirs.splice(0).map((directory) =>
        rm(directory, { recursive: true, force: true }),
      ),
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
    const archivePath = path.join(root, "jira-1.0.0.harday-connector");
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
    );

    expect(response).toMatchObject({
      plugin: {
        id: "jira",
        version: "1.0.0",
      },
      replaced: false,
      overview: {
        plugins: [expect.objectContaining({ id: "jira" })],
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
        datasets: [
          { id: "projects", rows: [{ project: "Mercury" }] },
        ],
      },
    });

    await expect(
      dispatchJsonRequest(server, {
        method: "POST",
        path: "/api/project-data-shapes/workday-project-data/import",
        body: JSON.stringify({
          datasets: [
            { id: "projects", rows: [{ project: "Mercury" }] },
          ],
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
