import os from "node:os";
import path from "node:path";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { create } from "tar";
import { afterEach, describe, expect, it } from "vitest";
import { codeHostOperations } from "../../../packages/shared/code-host.ts";
import { ConnectorPluginManager } from "./plugin-host.ts";
import { readConnectorPlugin } from "./plugin-package.ts";

const ICON = "<svg viewBox='0 0 16 16'><path d='M0 0h16v16H0z' /></svg>";

function pluginManifest(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    version: "1.0.0",
    apiVersion: 3,
    displayName: id === "jira" ? "Jira" : id,
    description: "Test connector plugin.",
    iconSvg: ICON,
    entrypoint: "plugin.mjs",
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
    ...overrides,
  };
}

async function createPluginDirectory(
  parent: string,
  id: string,
  source: string,
  manifestOverrides: Record<string, unknown> = {},
) {
  const pluginDirectory = path.join(parent, id);
  await mkdir(pluginDirectory, { recursive: true });
  await writeFile(
    path.join(pluginDirectory, "plugin.json"),
    JSON.stringify(pluginManifest(id, manifestOverrides), null, 2),
    "utf8",
  );
  await writeFile(path.join(pluginDirectory, "plugin.mjs"), source, "utf8");
  return pluginDirectory;
}

async function packagePlugin(pluginDirectory: string, archivePath: string) {
  await create(
    {
      cwd: pluginDirectory,
      file: archivePath,
      gzip: true,
      portable: true,
    },
    ["plugin.json", "plugin.mjs"],
  );
}

describe("ConnectorPluginManager", () => {
  const tempDirs: string[] = [];
  const managers: ConnectorPluginManager[] = [];

  async function tempDir(prefix = "ajour-plugin-host-") {
    const directory = await mkdtemp(path.join(os.tmpdir(), prefix));
    tempDirs.push(directory);
    return directory;
  }

  function manager(
    options: ConstructorParameters<typeof ConnectorPluginManager>[0],
  ) {
    const pluginManager = new ConnectorPluginManager(options);
    managers.push(pluginManager);
    return pluginManager;
  }

  afterEach(async () => {
    await Promise.allSettled(
      managers.splice(0).map((pluginManager) => pluginManager.shutdown()),
    );
    await Promise.all(
      tempDirs
        .splice(0)
        .map((dir) => rm(dir, { recursive: true, force: true })),
    );
  });

  it("loads a development plugin and executes each operation in a worker", async () => {
    const root = await tempDir();
    const pluginDirectory = await createPluginDirectory(
      root,
      "jira",
      [
        "export async function validateConnection(config) {",
        "  return { normalizedConfig: config, connectionSummary: { site: config.baseUrl } };",
        "}",
        "export async function syncConnection(connection) {",
        "  return {",
        "    items: [{",
        "      source: 'jira',",
        "      connectionId: connection.id,",
        "      connectionLabel: connection.label,",
        "      tenantLabel: connection.tenantLabel,",
        "      sourceId: 'ENG-123',",
        "      externalId: 'ENG-123',",
        "      title: 'Fix production issue',",
        "      workItemType: 'Task',",
        "      depth: 0,",
        "      selectable: true,",
        "      childCount: 0",
        "    }],",
        "    workItemUpdates: []",
        "  };",
        "}",
      ].join("\n"),
    );
    const pluginManager = manager({
      installedPluginDirectory: path.join(root, "installed"),
      developmentPluginDirectories: [pluginDirectory],
      allowDevelopmentPlugins: true,
    });

    await expect(pluginManager.listPlugins()).resolves.toEqual([
      expect.objectContaining({
        id: "jira",
        version: "1.0.0",
        apiVersion: 3,
      }),
    ]);
    await expect(
      pluginManager.validateConnection("jira", {
        baseUrl: "https://example.atlassian.net",
      }),
    ).resolves.toEqual({
      normalizedConfig: {
        baseUrl: "https://example.atlassian.net",
      },
      connectionSummary: {
        site: "https://example.atlassian.net",
      },
    });
    await expect(
      pluginManager.syncConnection("jira", {
        id: "jira_1",
        label: "Product backlog",
        tenantLabel: "Example workspace",
        autoSync: false,
        autoSyncIntervalMinutes: 15,
        connectedAt: Date.now(),
        pluginId: "jira",
        config: {
          baseUrl: "https://example.atlassian.net",
        },
      }),
    ).resolves.toMatchObject({
      items: [
        expect.objectContaining({
          source: "jira",
          externalId: "ENG-123",
        }),
      ],
    });
    expect(pluginManager.activeOperationCount).toBe(0);
  });

  it("does not load development directories in production mode", async () => {
    const root = await tempDir();
    const pluginDirectory = await createPluginDirectory(
      root,
      "jira",
      "export async function validateConnection() {}",
    );
    const pluginManager = manager({
      installedPluginDirectory: path.join(root, "installed"),
      developmentPluginDirectories: [pluginDirectory],
      allowDevelopmentPlugins: false,
    });

    await expect(pluginManager.listPlugins()).resolves.toEqual([]);
  });

  it("bounds plugin error messages before they cross the worker boundary", async () => {
    const root = await tempDir();
    const pluginDirectory = await createPluginDirectory(
      root,
      "jira",
      "export async function validateConnection() { throw new Error('x'.repeat(20_000)); }",
    );
    const pluginManager = manager({
      installedPluginDirectory: path.join(root, "installed"),
      developmentPluginDirectories: [pluginDirectory],
      allowDevelopmentPlugins: true,
    });

    const error = await pluginManager.validateConnection("jira", {}).then(
      () => null,
      (reason: unknown) => reason,
    );

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toHaveLength(4_096);
    expect((error as Error).message.endsWith("…")).toBe(true);
  });

  it("installs and replaces one packaged connector archive", async () => {
    const root = await tempDir();
    const sourceRoot = path.join(root, "source");
    const pluginDirectory = await createPluginDirectory(
      sourceRoot,
      "jira",
      [
        "export async function validateConnection(config) {",
        "  return { normalizedConfig: config, connectionSummary: { installed: true } };",
        "}",
      ].join("\n"),
    );
    const archivePath = path.join(root, "jira-1.0.0.ajour-connector");
    await packagePlugin(pluginDirectory, archivePath);
    const pluginManager = manager({
      installedPluginDirectory: path.join(root, "installed"),
    });

    const firstInstall = await pluginManager.installPluginArchive(
      await readFile(archivePath),
      path.basename(archivePath),
    );
    expect(firstInstall).toMatchObject({
      manifest: { id: "jira", version: "1.0.0" },
      replaced: false,
      installed: true,
    });
    await expect(pluginManager.listPlugins()).resolves.toHaveLength(1);

    const replacement = await pluginManager.installPluginArchive(
      await readFile(archivePath),
      path.basename(archivePath),
    );
    expect(replacement.replaced).toBe(true);
  });

  it("explains an installed package built for an older plugin API and replaces it on update", async () => {
    const root = await tempDir();
    const installedRoot = path.join(root, "installed");
    const source = "export async function validateConnection() {}";
    await createPluginDirectory(installedRoot, "jira", source, {
      apiVersion: 2,
    });
    const pluginManager = manager({ installedPluginDirectory: installedRoot });
    const reason =
      "Jira 1.0.0 uses plugin API 2, but this version of Ajour needs plugin API 3. Update the plugin to use it again.";

    await expect(pluginManager.inspectPlugins()).resolves.toMatchObject({
      plugins: [],
      unavailable: [{ manifest: { id: "jira", apiVersion: 2 }, reason }],
    });
    await expect(pluginManager.validateConnection("jira", {})).rejects.toThrow(
      reason,
    );

    const pluginDirectory = await createPluginDirectory(
      path.join(root, "source"),
      "jira",
      source,
    );
    const archivePath = path.join(root, "jira-1.0.0.ajour-connector");
    await packagePlugin(pluginDirectory, archivePath);
    const update = await pluginManager.installPluginArchive(
      await readFile(archivePath),
      path.basename(archivePath),
    );

    expect(update.replaced).toBe(true);
    await expect(pluginManager.inspectPlugins()).resolves.toMatchObject({
      plugins: [{ id: "jira", apiVersion: 3 }],
      unavailable: [],
    });
  });

  it("uninstalls a package built for another plugin API", async () => {
    const root = await tempDir();
    const installedRoot = path.join(root, "installed");
    await createPluginDirectory(
      installedRoot,
      "jira",
      "export async function validateConnection() {}",
      { apiVersion: 2 },
    );
    const pluginManager = manager({ installedPluginDirectory: installedRoot });

    await expect(pluginManager.uninstallPlugin("jira")).resolves.toMatchObject({
      id: "jira",
    });
    await expect(access(path.join(installedRoot, "jira"))).rejects.toThrow();
  });

  it("serializes plugin discovery behind package installation", async () => {
    const root = await tempDir();
    const pluginDirectory = await createPluginDirectory(
      path.join(root, "source"),
      "jira",
      "export async function validateConnection(config) { return { normalizedConfig: config, connectionSummary: {} }; }",
    );
    const archivePath = path.join(root, "jira-1.0.0.ajour-connector");
    await packagePlugin(pluginDirectory, archivePath);
    const pluginManager = manager({
      installedPluginDirectory: path.join(root, "installed"),
    });

    const installation = pluginManager.installPluginArchive(
      await readFile(archivePath),
      path.basename(archivePath),
    );
    const discovery = pluginManager.listPlugins();

    await expect(installation).resolves.toMatchObject({ installed: true });
    await expect(discovery).resolves.toEqual([
      expect.objectContaining({ id: "jira" }),
    ]);

    const uninstall = pluginManager.uninstallPlugin("jira");
    const discoveryAfterUninstall = pluginManager.listPlugins();
    await expect(uninstall).resolves.toMatchObject({ id: "jira" });
    await expect(discoveryAfterUninstall).resolves.toEqual([]);
  });

  it("terminates active plugin work and removes only managed packages on uninstall", async () => {
    const root = await tempDir();
    const pluginDirectory = await createPluginDirectory(
      path.join(root, "source"),
      "jira",
      "export async function validateConnection() { await new Promise(() => setInterval(() => {}, 1000)); }",
    );
    const archivePath = path.join(root, "jira-1.0.0.ajour-connector");
    await packagePlugin(pluginDirectory, archivePath);
    const installedRoot = path.join(root, "installed");
    const pluginManager = manager({
      installedPluginDirectory: installedRoot,
      requestTimeoutMs: 5_000,
    });
    await pluginManager.installPluginArchive(
      await readFile(archivePath),
      path.basename(archivePath),
    );

    const operation = pluginManager.validateConnection("jira", {});
    const operationResult = operation.then(
      () => null,
      (error: unknown) => error,
    );
    await new Promise((resolve) => setTimeout(resolve, 30));

    await expect(pluginManager.uninstallPlugin("jira")).resolves.toMatchObject({
      id: "jira",
    });
    expect(await operationResult).toEqual(
      expect.objectContaining({
        message: 'Connector plugin "jira" was uninstalled.',
      }),
    );
    await expect(pluginManager.listPlugins()).resolves.toEqual([]);
    await expect(access(path.join(installedRoot, "jira"))).rejects.toThrow();
  });

  it("does not uninstall a development directory plugin", async () => {
    const root = await tempDir();
    const pluginDirectory = await createPluginDirectory(
      root,
      "jira",
      "export async function validateConnection(config) { return { normalizedConfig: config, connectionSummary: {} }; }",
    );
    const pluginManager = manager({
      installedPluginDirectory: path.join(root, "installed"),
      developmentPluginDirectories: [pluginDirectory],
      allowDevelopmentPlugins: true,
    });

    await expect(pluginManager.uninstallPlugin("jira")).rejects.toThrow(
      "is not installed as a managed package",
    );
    await expect(
      access(path.join(pluginDirectory, "plugin.json")),
    ).resolves.toBeUndefined();
  });

  it("executes compiled ESM JavaScript from an installed archive", async () => {
    const root = await tempDir();
    const pluginDirectory = await createPluginDirectory(
      path.join(root, "source"),
      "jira",
      "",
      { entrypoint: "dist/plugin.js" },
    );
    const distDirectory = path.join(pluginDirectory, "dist");
    await mkdir(distDirectory, { recursive: true });
    await writeFile(
      path.join(distDirectory, "package.json"),
      JSON.stringify({ type: "module" }),
      "utf8",
    );
    await writeFile(
      path.join(distDirectory, "plugin.js"),
      [
        "export async function validateConnection(config) {",
        "  return { normalizedConfig: config, connectionSummary: { runtime: 'esm' } };",
        "}",
      ].join("\n"),
      "utf8",
    );
    const archivePath = path.join(root, "jira-1.0.0.ajour-connector");
    await create(
      {
        cwd: pluginDirectory,
        file: archivePath,
        gzip: true,
      },
      ["plugin.json", "dist"],
    );
    const pluginManager = manager({
      installedPluginDirectory: path.join(root, "installed"),
    });

    await pluginManager.installPluginArchive(
      await readFile(archivePath),
      path.basename(archivePath),
    );
    await expect(pluginManager.validateConnection("jira", {})).resolves.toEqual(
      {
        normalizedConfig: {},
        connectionSummary: { runtime: "esm" },
      },
    );
  });

  it("rejects packaged archives containing symbolic links", async () => {
    const root = await tempDir();
    const pluginDirectory = await createPluginDirectory(
      path.join(root, "source"),
      "jira",
      "export async function validateConnection() {}",
    );
    await symlink(
      "plugin.mjs",
      path.join(pluginDirectory, "linked-plugin.mjs"),
    );
    const archivePath = path.join(root, "jira-1.0.0.ajour-connector");
    await create(
      {
        cwd: pluginDirectory,
        file: archivePath,
        gzip: true,
      },
      ["plugin.json", "plugin.mjs", "linked-plugin.mjs"],
    );
    const pluginManager = manager({
      installedPluginDirectory: path.join(root, "installed"),
    });

    await expect(
      pluginManager.installPluginArchive(
        await readFile(archivePath),
        path.basename(archivePath),
      ),
    ).rejects.toThrow("unsupported type");
  });

  it("rejects an entrypoint whose parent directory is a symbolic link", async () => {
    const root = await tempDir();
    const pluginDirectory = await createPluginDirectory(
      root,
      "jira",
      "export async function validateConnection() {}",
      { entrypoint: "linked/plugin.mjs" },
    );
    const externalDirectory = path.join(root, "external");
    await mkdir(externalDirectory, { recursive: true });
    await writeFile(
      path.join(externalDirectory, "plugin.mjs"),
      "export async function validateConnection() {}",
      "utf8",
    );
    await symlink(externalDirectory, path.join(pluginDirectory, "linked"));
    const pluginManager = manager({
      installedPluginDirectory: path.join(root, "installed"),
      developmentPluginDirectories: [pluginDirectory],
      allowDevelopmentPlugins: true,
    });

    await expect(
      readConnectorPlugin(pluginDirectory, "development"),
    ).rejects.toThrow("must not traverse symbolic links");
    await expect(pluginManager.listPlugins()).resolves.toEqual([]);
  });

  it("skips development plugins requiring a different host API version", async () => {
    const root = await tempDir();
    const pluginDirectory = await createPluginDirectory(
      root,
      "jira",
      "export async function validateConnection() {}",
      { apiVersion: 99 },
    );
    const pluginManager = manager({
      installedPluginDirectory: path.join(root, "installed"),
      developmentPluginDirectories: [pluginDirectory],
      allowDevelopmentPlugins: true,
    });

    await expect(pluginManager.listPlugins()).resolves.toEqual([]);
  });

  it("runs code host operations only for plugins that declare the capability", async () => {
    const root = await tempDir();
    const source = [
      "export async function syncPullRequests(connection, request) {",
      "  return { viewer: { login: connection.label, isBot: false }, pullRequests: [], ignored: request.tracked.length };",
      "}",
    ].join("\n");
    const codeHostDirectory = await createPluginDirectory(
      root,
      "github",
      source,
      { capabilities: { codeHost: {} } },
    );
    const connectorDirectory = await createPluginDirectory(
      root,
      "jira",
      source,
    );
    const pluginManager = manager({
      installedPluginDirectory: path.join(root, "installed"),
      developmentPluginDirectories: [codeHostDirectory, connectorDirectory],
      allowDevelopmentPlugins: true,
    });
    const connection = {
      id: "connection-1",
      pluginId: "github",
      label: "octocat",
      tenantLabel: "github.com",
      autoSync: true,
      autoSyncIntervalMinutes: 5,
      connectedAt: 1,
      config: {},
    };

    await expect(
      pluginManager.runCodeHostOperation(
        "github",
        "syncPullRequests",
        connection,
        {
          tracked: [],
        },
      ),
    ).resolves.toEqual({
      viewer: { login: "octocat", isBot: false },
      pullRequests: [],
    });
    await expect(
      pluginManager.hasCapability("github", "connector"),
    ).resolves.toBe(false);
    await expect(
      pluginManager.syncConnection("github", connection),
    ).rejects.toThrow('Plugin "github" does not sync backlog items.');
    await expect(
      pluginManager.runCodeHostOperation(
        "jira",
        "syncPullRequests",
        connection,
        {
          tracked: [],
        },
      ),
    ).rejects.toThrow('Plugin "jira" does not provide pull requests.');
  });

  it("dispatches every code host operation in the worker", async () => {
    const worker = await readFile(
      new URL("./plugin-worker.mjs", import.meta.url),
      "utf8",
    );
    for (const operation of Object.keys(codeHostOperations)) {
      expect(worker).toContain(`"${operation}"`);
    }
  });
});
