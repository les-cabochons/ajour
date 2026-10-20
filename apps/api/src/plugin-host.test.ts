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
import { afterEach, describe, expect, it, vi } from "vitest";
import { codeHostOperations } from "../../../packages/shared/code-host.ts";
import { calendarOperations } from "../../../packages/shared/calendar.ts";
import type { TeamProjectChange } from "../../../packages/shared/team-sync.ts";
import { capabilityOfMethod, PluginManager } from "./plugin-host.ts";
import { readPlugin } from "./plugin-package.ts";

const ICON = "<svg viewBox='0 0 16 16'><path d='M0 0h16v16H0z' /></svg>";

function pluginManifest(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    version: "1.0.0",
    apiVersion: 3,
    displayName: id === "jira" ? "Jira" : id,
    description: "Test plugin.",
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

const AGENT_TASK_PROMPT =
  "Enter week {{weekOf}} at {{settings.url}} in session {{sessionId}}.";

/** Everything a console.error spy received, as one string. */
function logged(spy: { mock: { calls: unknown[][] } }) {
  return spy.mock.calls
    .flat()
    .map((value) => (value instanceof Error ? value.message : String(value)))
    .join("\n");
}

/** Files of a plugin that only declares an agent task: no entrypoint. */
function agentTaskPluginFiles(overrides: { prompt?: string } = {}) {
  return {
    "plugin.json": JSON.stringify({
      id: "ajp-test",
      version: "1.0.0",
      apiVersion: 3,
      displayName: "Test tasks",
      iconSvg: "<svg/>",
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
                { id: "url", label: "URL", type: "url", required: true },
              ],
            },
          ],
        },
      },
    }),
    "prompts/enter-week.md": overrides.prompt ?? AGENT_TASK_PROMPT,
  };
}

describe("PluginManager", () => {
  const tempDirs: string[] = [];
  const managers: PluginManager[] = [];

  async function tempDir(prefix = "ajour-plugin-host-") {
    const directory = await mkdtemp(path.join(os.tmpdir(), prefix));
    tempDirs.push(directory);
    return directory;
  }

  function manager(options: ConstructorParameters<typeof PluginManager>[0]) {
    const pluginManager = new PluginManager(options);
    managers.push(pluginManager);
    return pluginManager;
  }

  /** A manager whose only development plugin is written from `files`. */
  async function createManagerWithDevelopmentPlugin(
    files: Record<string, string>,
  ) {
    const root = await tempDir();
    const pluginDirectory = path.join(root, "dev-plugin");
    for (const [relativePath, content] of Object.entries(files)) {
      const filePath = path.join(pluginDirectory, relativePath);
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, content, "utf8");
    }
    return manager({
      installedPluginDirectory: path.join(root, "installed"),
      developmentPluginDirectories: [pluginDirectory],
      allowDevelopmentPlugins: true,
    });
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

  it("lets a comment call's admission check stop the plugin at the last moment", async () => {
    const root = await tempDir();
    const marker = path.join(root, "posted.txt");
    const pluginDirectory = await createPluginDirectory(
      root,
      "jira",
      [
        "import { writeFile } from 'node:fs/promises';",
        "export async function validateConnection(config) {",
        "  return { normalizedConfig: config, connectionSummary: {} };",
        "}",
        "export async function postItemComment(connection, request) {",
        `  await writeFile(${JSON.stringify(marker)}, request.body);`,
        "  return { comment: { id: 'c1', author: { id: 'me', displayName: 'Me' }, body: request.body, createdAt: '2026-10-18T10:00:00Z' } };",
        "}",
      ].join("\n"),
      { capabilities: { connector: { comments: {} } } },
    );
    const pluginManager = manager({
      installedPluginDirectory: path.join(root, "installed"),
      developmentPluginDirectories: [pluginDirectory],
      allowDevelopmentPlugins: true,
    });
    const connection = {
      id: "connection-1",
      pluginId: "jira",
      label: "Work",
      tenantLabel: "Contoso",
      autoSync: false,
      autoSyncIntervalMinutes: 15,
      connectedAt: 1,
      config: {},
    };
    const request = { sourceId: "ENG-1", body: "Fixed" };

    await expect(
      pluginManager.runBacklogCommentOperation(
        "jira",
        "postItemComment",
        connection,
        request,
        async () => {
          throw new Error("Revoked.");
        },
      ),
    ).rejects.toThrow("Revoked.");
    await expect(access(marker)).rejects.toThrow();

    await expect(
      pluginManager.runBacklogCommentOperation(
        "jira",
        "postItemComment",
        connection,
        request,
        async () => undefined,
      ),
    ).resolves.toMatchObject({ comment: { body: "Fixed" } });
    await expect(access(marker)).resolves.toBeUndefined();
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

  it("installs and replaces one packaged plugin archive", async () => {
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

  it("runs the after-install step while plugin operations are still refused", async () => {
    const root = await tempDir();
    const pluginDirectory = await createPluginDirectory(
      path.join(root, "source"),
      "jira",
      "export async function syncConnection() { return { items: [], workItemUpdates: [] }; }",
    );
    const archivePath = path.join(root, "jira-1.0.0.ajour-connector");
    await packagePlugin(pluginDirectory, archivePath);
    const pluginManager = manager({
      installedPluginDirectory: path.join(root, "installed"),
    });
    const connection = {
      id: "connection-1",
      pluginId: "jira",
      label: "Jira",
      tenantLabel: "Acme",
      autoSync: false,
      autoSyncIntervalMinutes: 15,
      connectedAt: 1,
      config: {},
    };
    const events: string[] = [];
    let duringInstall: Promise<unknown> | undefined;

    await pluginManager.installPluginArchive(
      await readFile(archivePath),
      path.basename(archivePath),
      async (installed) => {
        expect(installed.manifest.id).toBe("jira");
        duringInstall = pluginManager
          .syncConnection("jira", connection)
          .then((result) => {
            events.push("operation ran");
            return result;
          });
        // The operation waits for the package change instead of running now.
        await new Promise((resolve) => setTimeout(resolve, 50));
        events.push("after-install finished");
      },
    );

    await expect(duringInstall).resolves.toEqual({
      items: [],
      workItemUpdates: [],
      commentFacts: [],
    });
    expect(events).toEqual(["after-install finished", "operation ran"]);
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
        message: 'Plugin "jira" was uninstalled.',
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

    await expect(readPlugin(pluginDirectory, "development")).rejects.toThrow(
      "must not traverse symbolic links",
    );
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
    const pluginDirectory = await createPluginDirectory(root, "jira", source);
    const pluginManager = manager({
      installedPluginDirectory: path.join(root, "installed"),
      developmentPluginDirectories: [codeHostDirectory, pluginDirectory],
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

  it("runs team operations only for plugins that declare a team", async () => {
    const root = await tempDir();
    const source = [
      "export async function createTeam(config, request) {",
      "  return { values: { teamId: `${config.baseUrl}#${request.name}`, teamSecret: 's3cret' } };",
      "}",
      "export async function syncTeamProjects(connection, request) {",
      "  return {",
      "    cursor: `after-${request.changes.length}`,",
      "    projects: [],",
      "    assigned: request.changes.map((change) => ({ localId: change.localId, remoteId: `r-${change.localId}` })),",
      "    note: connection.label,",
      "  };",
      "}",
    ].join("\n");
    const teamDirectory = await createPluginDirectory(root, "team", source, {
      capabilities: { team: { apiVersion: 1 } },
    });
    const pluginDirectory = await createPluginDirectory(root, "jira", source);
    const pluginManager = manager({
      installedPluginDirectory: path.join(root, "installed"),
      developmentPluginDirectories: [teamDirectory, pluginDirectory],
      allowDevelopmentPlugins: true,
    });
    const connection = {
      id: "connection-1",
      pluginId: "team",
      label: "Acme team",
      tenantLabel: "acme",
      autoSync: true,
      autoSyncIntervalMinutes: 15,
      connectedAt: 1,
      config: {},
    };
    const newProject: TeamProjectChange = {
      localId: "project-1",
      name: "Beta",
      displayName: "Beta",
      code: null,
      color: "#4f46e5",
      icon: { kind: "preset", name: "dot" },
      status: "active",
      tasks: [],
    };

    await expect(
      pluginManager.createTeam(
        "team",
        { baseUrl: "https://team.example" },
        { name: "Acme" },
      ),
    ).resolves.toEqual({
      values: { teamId: "https://team.example#Acme", teamSecret: "s3cret" },
    });
    await expect(
      pluginManager.syncTeamProjects("team", connection, {
        changes: [newProject],
      }),
    ).resolves.toEqual({
      cursor: "after-1",
      projects: [],
      assigned: [{ localId: "project-1", remoteId: "r-project-1" }],
      hasMore: false,
    });
    await expect(
      pluginManager.syncTeamProjects("jira", connection, { changes: [] }),
    ).rejects.toThrow('Plugin "jira" does not sync a team\'s projects.');
    await expect(
      pluginManager.createTeam("jira", {}, { name: "Acme" }),
    ).rejects.toThrow('Plugin "jira" does not sync a team\'s projects.');
  });

  it("refuses a team result that breaks the contract, such as an icon URL", async () => {
    const root = await tempDir();
    const pluginDirectory = await createPluginDirectory(
      root,
      "team",
      [
        "export async function syncTeamProjects() {",
        "  return { cursor: 'c', projects: [{ remoteId: 'r1', name: 'Beta', displayName: 'Beta', code: null,",
        "    color: '#4f46e5', status: 'active', tasks: [],",
        "    icon: { kind: 'upload', src: 'https://tracker.example/pixel.png' } }] };",
        "}",
      ].join("\n"),
      { capabilities: { team: { apiVersion: 1 } } },
    );
    const pluginManager = manager({
      installedPluginDirectory: path.join(root, "installed"),
      developmentPluginDirectories: [pluginDirectory],
      allowDevelopmentPlugins: true,
    });

    await expect(
      pluginManager.syncTeamProjects(
        "team",
        {
          id: "connection-1",
          pluginId: "team",
          label: "Acme team",
          tenantLabel: "acme",
          autoSync: true,
          autoSyncIntervalMinutes: 15,
          connectedAt: 1,
          config: {},
        },
        { changes: [] },
      ),
    ).rejects.toThrow();
  });

  it("cancels an operation that a turned-off capability catches at its gate", async () => {
    const root = await tempDir();
    const pluginDirectory = await createPluginDirectory(
      root,
      "github",
      [
        "export async function syncPullRequests() {",
        "  return { viewer: { login: 'octocat', isBot: false }, pullRequests: [] };",
        "}",
        "export async function syncConnection() {",
        "  return { items: [], workItemUpdates: [] };",
        "}",
      ].join("\n"),
      { capabilities: { connector: {}, codeHost: {} } },
    );
    let releaseGate!: () => void;
    const gate = new Promise<void>((release) => {
      releaseGate = release;
    });
    let reachGate!: () => void;
    const gateReached = new Promise<void>((reached) => {
      reachGate = reached;
    });
    let gateWait = async () => {
      reachGate();
      await gate;
    };
    let pullRequestsOn = true;
    const pluginManager = manager({
      installedPluginDirectory: path.join(root, "installed"),
      developmentPluginDirectories: [pluginDirectory],
      allowDevelopmentPlugins: true,
      operationGate: async (_pluginId, method) => {
        if (method !== "syncPullRequests") return;
        await gateWait();
        if (!pullRequestsOn) throw new Error("Pull requests are off.");
      },
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

    // Registered and waiting at the gate when the capability turns off.
    const pending = pluginManager.runCodeHostOperation(
      "github",
      "syncPullRequests",
      connection,
      { tracked: [] },
    );
    await gateReached;
    await pluginManager.cancelCapabilityOperations(
      "github",
      "codeHost",
      new Error("Pull requests were turned off."),
    );
    releaseGate();
    await expect(pending).rejects.toThrow("Pull requests were turned off.");

    // Started after the change, it sees the new state at the gate.
    pullRequestsOn = false;
    gateWait = async () => {};
    await expect(
      pluginManager.runCodeHostOperation(
        "github",
        "syncPullRequests",
        connection,
        { tracked: [] },
      ),
    ).rejects.toThrow("Pull requests are off.");
    await expect(
      pluginManager.syncConnection("github", connection),
    ).resolves.toEqual({ items: [], workItemUpdates: [], commentFacts: [] });
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

  it("runs calendar operations only for plugins that declare the capability", async () => {
    const root = await tempDir();
    const source = [
      "export async function listCalendarEvents(connection, request) {",
      "  return { events: [{",
      "    eventId: connection.label + '-' + request.from,",
      "    startsAt: 1, endsAt: 2, allDay: false, title: 'Standup',",
      "    status: 'confirmed', response: 'accepted', busy: true,",
      "    attendees: ['maria@example.com'],",
      "  }] };",
      "}",
    ].join("\n");
    const calendarDirectory = await createPluginDirectory(
      root,
      "outlook",
      source,
      { capabilities: { calendar: {} } },
    );
    const pluginDirectory = await createPluginDirectory(root, "jira", source);
    const pluginManager = manager({
      installedPluginDirectory: path.join(root, "installed"),
      developmentPluginDirectories: [calendarDirectory, pluginDirectory],
      allowDevelopmentPlugins: true,
    });
    const connection = {
      id: "connection-1",
      pluginId: "outlook",
      label: "work",
      tenantLabel: "Outlook",
      autoSync: false,
      autoSyncIntervalMinutes: 10,
      connectedAt: 1,
      config: {},
    };
    const week = {
      from: "2026-10-12",
      to: "2026-10-18",
      timeZone: "America/Toronto",
    };

    await expect(
      pluginManager.runCalendarOperation(
        "outlook",
        "listCalendarEvents",
        connection,
        week,
      ),
    ).resolves.toEqual({
      events: [
        {
          eventId: "work-2026-10-12",
          startsAt: 1,
          endsAt: 2,
          allDay: false,
          title: "Standup",
          status: "confirmed",
          response: "accepted",
          busy: true,
        },
      ],
    });
    await expect(
      pluginManager.runCalendarOperation(
        "jira",
        "listCalendarEvents",
        connection,
        week,
      ),
    ).rejects.toThrow('Plugin "jira" does not provide calendar events.');
  });

  it("gates calendar operations on the calendar switch", () => {
    expect(capabilityOfMethod("listCalendarEvents")).toBe("calendar");
    expect(capabilityOfMethod("syncPullRequests")).toBe("codeHost");
    expect(capabilityOfMethod("syncConnection")).toBe("connector");
    expect(capabilityOfMethod("validateConnection")).toBeUndefined();
  });

  it("dispatches every calendar operation in the worker", async () => {
    const worker = await readFile(
      new URL("./plugin-worker.mjs", import.meta.url),
      "utf8",
    );
    for (const operation of Object.keys(calendarOperations)) {
      expect(worker).toContain(`"${operation}"`);
    }
  });

  it("loads a plugin that only declares agent tasks and reads its prompt", async () => {
    const pluginManager = await createManagerWithDevelopmentPlugin(
      agentTaskPluginFiles(),
    );
    const plugins = await pluginManager.listPlugins();
    expect(plugins.map((plugin) => plugin.id)).toContain("ajp-test");
    await expect(
      pluginManager.readAgentTaskPrompt("ajp-test", "enter-week"),
    ).resolves.toBe(AGENT_TASK_PROMPT);
    await expect(
      pluginManager.readAgentTaskPrompt("ajp-test", "other"),
    ).rejects.toThrow('has no agent task "other"');
  });

  // Invalid development plugins are skipped and logged, not listed as unavailable.
  it("skips an agent task plugin whose prompt uses an unknown slot", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    try {
      const pluginManager = await createManagerWithDevelopmentPlugin(
        agentTaskPluginFiles({ prompt: "Hi {{settings.nope}}" }),
      );
      const { plugins } = await pluginManager.inspectPlugins();
      expect(plugins.map((plugin) => plugin.id)).not.toContain("ajp-test");
      expect(logged(consoleError)).toContain("settings.nope");
    } finally {
      consoleError.mockRestore();
    }
  });

  it("skips an agent task plugin whose prompt is over 64 KB", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    try {
      const pluginManager = await createManagerWithDevelopmentPlugin(
        agentTaskPluginFiles({ prompt: "x".repeat(65_537) }),
      );
      const { plugins } = await pluginManager.inspectPlugins();
      expect(plugins.map((plugin) => plugin.id)).not.toContain("ajp-test");
      expect(logged(consoleError)).toContain("64 KB");
    } finally {
      consoleError.mockRestore();
    }
  });

  it("refuses to run code for a plugin without an entrypoint", async () => {
    const pluginManager = await createManagerWithDevelopmentPlugin(
      agentTaskPluginFiles(),
    );
    await expect(
      pluginManager.validateConnection("ajp-test", {}),
    ).rejects.toThrow(/runs no code/);
  });
});
