import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { afterEach, expect, it } from "vitest";
import { PluginManager } from "./plugin-host.ts";
import { create as createArchive } from "tar";
import {
  createAppApiServer,
  installPluginForServer,
  stopAppApiServer,
} from "./server.ts";
import { dispatchJsonRequest } from "./test-support/dispatch-json-request.ts";
import { windowServerOptions } from "./test-support/window-token.ts";
import { MemorySecretVault } from "./test-support/memory-secret-vault.ts";
import { AppApiStorage } from "./storage.ts";
import { parsePluginManifest } from "./plugin-package.ts";
import { ProjectDataShapePluginManager } from "./project-data-shape-host.ts";
import { InProcessPluginRuntime } from "./test-support/in-process-plugin-runtime.ts";
import {
  PLUGIN_API_VERSION,
  type PluginCapabilities,
} from "../../../packages/shared/plugins.ts";
import type { PluginApi4Manifest } from "../../../packages/shared/plugin-api-4.ts";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
const manifest = (
  id: string,
  apiVersion: number,
  capabilities: PluginCapabilities | PluginApi4Manifest["capabilities"] = {
    connector: {},
  },
) => ({
  id,
  apiVersion,
  version: "1.0.0",
  displayName: id,
  iconSvg: "<svg/>",
  entrypoint: "plugin.mjs",
  capabilities,
  connectionFields: [
    { id: "baseUrl", label: "Site", type: "url" },
    { id: "filter", label: "Filter", type: "text" },
  ],
});

it("admits API 4, and only API 4, in every build", () => {
  expect(PLUGIN_API_VERSION).toBe(4);
  expect(parsePluginManifest(manifest("jira", 4))).toMatchObject({
    apiVersion: 4,
  });
  for (const apiVersion of [1, 2, 3]) {
    expect(() => parsePluginManifest(manifest("jira", apiVersion))).toThrow(
      "This plugin needs an update",
    );
  }
});

it.each(["jira", "team-sync"])(
  "keeps installed API 3 %s inactive with its connection and non-secret settings",
  async (id) => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ajour-cut-over-"));
    roots.push(root);
    const installed = path.join(root, "plugins");
    const directory = path.join(installed, id);
    await mkdir(directory, { recursive: true });
    await writeFile(
      path.join(directory, "plugin.json"),
      JSON.stringify(
        manifest(
          id,
          3,
          id === "team-sync" ? { team: { apiVersion: 1 } } : undefined,
        ),
      ),
    );
    await writeFile(
      path.join(directory, "plugin.mjs"),
      "throw new Error('API 3 must never execute');",
    );
    const storage = new AppApiStorage(path.join(root, "state.json"));
    await storage.ready();
    const saved = await storage.upsertConnection(id, {
      label: "Kept connection",
      tenantLabel: "Kept tenant",
      autoSync: false,
      autoSyncIntervalMinutes: 15,
      config: { baseUrl: "https://example.com", filter: "assigned" },
      configSummary: {},
    });
    const manager = new PluginManager({ installedPluginDirectory: installed });
    try {
      const found = await manager.inspectPlugins();
      expect(found.plugins).toEqual([]);
      expect(found.unavailable).toMatchObject([
        {
          manifest: { id, apiVersion: 3 },
          reason: "This plugin needs an update",
        },
      ]);
      await expect(manager.validateConnection(id, {})).rejects.toThrow(
        "This plugin needs an update",
      );
      const overview = await storage.getPluginsOverview(
        found.plugins,
        found.unavailable,
      );
      expect(overview.connectionGroups).toContainEqual(
        expect.objectContaining({ enabled: false }),
      );
      const reopened = new AppApiStorage(path.join(root, "state.json"));
      expect(await reopened.getConnection(id, saved.id)).toMatchObject({
        label: "Kept connection",
        config: { baseUrl: "https://example.com", filter: "assigned" },
      });
      expect(
        JSON.parse(await readFile(path.join(directory, "plugin.json"), "utf8"))
          .apiVersion,
      ).toBe(3);
    } finally {
      await manager.shutdown();
    }
  },
);

it("rewrites a legacy GitHub.com address once at the upgrade and keeps the connection's other settings", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ajour-github-address-"));
  roots.push(root);
  const statePath = path.join(root, "state.json");
  const connection = (id: string, pluginId: string, hostUrl: string) => ({
    id,
    pluginId,
    label: id,
    tenantLabel: "Account",
    autoSync: true,
    autoSyncIntervalMinutes: 10,
    config: { hostUrl, include: "acme/api" },
    secrets: { fields: [] },
    configSummary: { host: new URL(hostUrl).host },
    connectedAt: 1,
    access: [],
  });
  await writeFile(
    statePath,
    JSON.stringify({
      version: 9,
      connections: [
        connection("www", "github", "https://www.github.com"),
        connection("plain", "github", "http://github.com"),
        connection("enterprise", "github", "https://github.acme.com"),
        connection("other", "jira", "http://www.github.com"),
      ],
      stagedImports: [],
      dismissedImportKeys: [],
      connectorBacklogStatuses: [],
      disabledPluginIds: [],
      pluginsEnabled: true,
    }),
  );

  const storage = new AppApiStorage(statePath);
  await storage.setPluginSystemEnabled(true);

  const saved = JSON.parse(await readFile(statePath, "utf8"));
  expect(saved.version).toBe(10);
  const addresses = Object.fromEntries(
    saved.connections.map(
      (entry: { id: string; config: { hostUrl: string } }) => [
        entry.id,
        entry.config.hostUrl,
      ],
    ),
  );
  expect(addresses).toEqual({
    www: "https://github.com",
    plain: "https://github.com",
    enterprise: "https://github.acme.com",
    other: "http://www.github.com",
  });
  expect(
    saved.connections.find((entry: { id: string }) => entry.id === "www"),
  ).toMatchObject({
    id: "www",
    label: "www",
    autoSync: true,
    autoSyncIntervalMinutes: 10,
    config: { include: "acme/api" },
    configSummary: { host: "github.com" },
  });
  // A second load changes nothing.
  await new AppApiStorage(statePath).setPluginSystemEnabled(true);
  expect(JSON.parse(await readFile(statePath, "utf8"))).toEqual(saved);
});

it("answers every plugin route of an installed API 3 package with the update notice", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ajour-api3-routes-"));
  roots.push(root);
  const directory = path.join(root, "plugins", "jira");
  await mkdir(directory, { recursive: true });
  await writeFile(
    path.join(directory, "plugin.json"),
    JSON.stringify(manifest("jira", 3)),
  );
  await writeFile(
    path.join(directory, "plugin.mjs"),
    "throw new Error('API 3 must never execute');",
  );
  const statePath = path.join(root, "state.json");
  const storage = new AppApiStorage(statePath);
  await storage.ready();
  const saved = await storage.upsertConnection("jira", {
    label: "Kept connection",
    tenantLabel: "Kept tenant",
    autoSync: false,
    autoSyncIntervalMinutes: 15,
    config: { baseUrl: "https://example.com" },
    configSummary: {},
  });
  const server = createAppApiServer({
    ...windowServerOptions,
    statePath,
    installedPluginDirectory: path.join(root, "plugins"),
    pluginRuntime: new InProcessPluginRuntime(),
    vault: new MemorySecretVault(),
  });
  try {
    const base = `/api/plugins/jira/connections/${saved.id}`;
    for (const [route, body] of [
      [`${base}/sync`, {}],
      [`${base}/settle-states`, { sourceId: "1" }],
      [`${base}/settle`, { sourceId: "1", state: "Done" }],
      [`${base}/description`, { sourceId: "1" }],
      [
        `${base}/description-write`,
        { sourceId: "1", text: "x", expected: "y" },
      ],
      [`/api/code-hosts/jira/connections/${saved.id}/syncPullRequests`, {}],
      [
        `/api/backlog-comments/jira/connections/${saved.id}/listItemComments`,
        {},
      ],
      [`/api/calendars/jira/connections/${saved.id}/listCalendarEvents`, {}],
    ] as const) {
      const answer = await dispatchJsonRequest(server, {
        method: "POST",
        path: route,
        body: JSON.stringify(body),
      });
      expect(
        [answer.status, answer.body],
        `${route} says the package needs an update`,
      ).toEqual([409, { error: "This plugin needs an update" }]);
    }
  } finally {
    await stopAppApiServer(server);
  }
});

it("installs a package that declares only a project data shape, as the catalog offers it", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ajour-shape-install-"));
  roots.push(root);
  const source = path.join(root, "source");
  await mkdir(source, { recursive: true });
  await writeFile(
    path.join(source, "plugin.json"),
    JSON.stringify({
      ...manifest("workday-project-data", 4, {
        projectDataShape: {
          apiVersion: 1,
          datasets: [
            {
              id: "projects",
              displayName: "Projects",
              columns: [
                { key: "name", header: "Name", type: "string", required: true },
              ],
            },
          ],
        },
      }),
      connectionFields: [],
      runtime: { start: "whenNeeded" },
    }),
  );
  await writeFile(
    path.join(source, "plugin.mjs"),
    "export async function exportProjects() { return { datasets: [] }; }",
  );
  const archive = path.join(root, "shape.ajour-connector");
  await createArchive({ cwd: source, file: archive, gzip: true }, ["."]);
  const server = createAppApiServer({
    ...windowServerOptions,
    statePath: path.join(root, "state.json"),
    installedPluginDirectory: path.join(root, "plugins"),
    pluginRuntime: new InProcessPluginRuntime(),
    vault: new MemorySecretVault(),
  });
  try {
    const installed = await installPluginForServer(
      server,
      await readFile(archive),
      "shape.ajour-connector",
    );
    expect(installed.plugin).toMatchObject({
      id: "workday-project-data",
      apiVersion: 4,
    });
    expect(
      installed.overview.plugins.map((plugin: { id: string }) => plugin.id),
    ).toContain("workday-project-data");
  } finally {
    await stopAppApiServer(server);
  }
});

it("discovers an installed API 4 schema in packaged mode without a development directory", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ajour-installed-schema-"));
  roots.push(root);
  const directory = path.join(root, "plugins", "workday-project-data");
  await mkdir(directory, { recursive: true });
  await writeFile(
    path.join(directory, "plugin.json"),
    JSON.stringify({
      ...manifest("workday-project-data", 4, {
        projectDataShape: {
          apiVersion: 1,
          datasets: [
            {
              id: "projects",
              displayName: "Projects",
              columns: [
                { key: "name", header: "Name", type: "string", required: true },
              ],
            },
          ],
        },
      }),
      connectionFields: [],
    }),
  );
  await writeFile(
    path.join(directory, "plugin.mjs"),
    "export async function exportProjects(projects) { return { datasets: [{id:'projects',rows:projects.map(project=>({name:project.name}))}] }; }",
  );
  const runtime = new InProcessPluginRuntime();
  const plugins = new PluginManager({
    installedPluginDirectory: path.join(root, "plugins"),
    runtime,
  });
  const shapes = new ProjectDataShapePluginManager({
    runtime,
    pluginHost: plugins,
  });
  try {
    expect(
      await shapes.exportProjects("workday-project-data", [
        { name: "Fixture", color: "#123456", status: "active", tasks: [] },
      ]),
    ).toEqual({ datasets: [{ id: "projects", rows: [{ name: "Fixture" }] }] });
  } finally {
    await shapes.shutdown();
    await plugins.shutdown();
  }
});
