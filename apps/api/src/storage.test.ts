import os from "node:os";
import path from "node:path";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import {
  pluginsOverviewSchema,
  type BacklogImportCandidateInput,
  type PluginManifest,
} from "../../../packages/shared/plugins.ts";
import { AppApiStorage } from "./storage.ts";

function buildPlugin(id: string, displayName: string): PluginManifest {
  return {
    id,
    version: "1.0.0",
    apiVersion: 3,
    displayName,
    description: `${displayName} connector`,
    iconSvg: `<svg viewBox="0 0 16 16" data-plugin="${id}"><path d="M0 0h16v16H0z" /></svg>`,
    entrypoint: "worker.mjs",
    capabilities: { connector: {} },
    connectionFields: [
      {
        id: "label",
        label: "Connection label",
        type: "text",
        required: true,
        secret: false,
      },
      {
        id: "tenantLabel",
        label: "Workspace",
        type: "text",
        required: true,
        secret: false,
      },
    ],
  };
}

function buildImportCandidate(
  overrides: Partial<BacklogImportCandidateInput> = {},
): BacklogImportCandidateInput {
  return {
    source: "azure_devops",
    connectionId: "ado-1",
    connectionLabel: "Main connection",
    tenantLabel: "Contoso",
    sourceId: "https://dev.azure.com/contoso/project/_workitems/edit/123",
    externalId: "123",
    sourceUrl: "https://dev.azure.com/contoso/project/_workitems/edit/123",
    title: "Initial title",
    note: "Initial note",
    projectName: "Project Mercury",
    workItemType: "Task",
    state: "Active",
    assignedTo: "Ada Lovelace",
    depth: 0,
    selectable: true,
    childCount: 0,
    ...overrides,
  };
}

describe("AppApiStorage", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(
      tempDirs
        .splice(0)
        .map((dir) => rm(dir, { recursive: true, force: true })),
    );
  });

  it("re-stages an imported backlog item after it was previously committed", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "ajour-storage-"));
    tempDirs.push(tempDir);

    const storage = new AppApiStorage(path.join(tempDir, "app-api-state.json"));

    await expect(
      storage.stageImportItems([buildImportCandidate()]),
    ).resolves.toEqual({
      queuedCount: 1,
      updatedCount: 0,
      skippedCount: 0,
    });

    await expect(storage.commitSelectedImports()).resolves.toHaveLength(1);
    await expect(storage.listStagedImports()).resolves.toMatchObject({
      totalCount: 0,
      selectedCount: 0,
      items: [],
    });

    await expect(
      storage.stageImportItems([
        buildImportCandidate({
          title: "Updated title",
          note: "Updated note",
        }),
      ]),
    ).resolves.toEqual({
      queuedCount: 1,
      updatedCount: 0,
      skippedCount: 0,
    });

    await expect(storage.listStagedImports()).resolves.toMatchObject({
      totalCount: 1,
      selectedCount: 1,
      items: [
        expect.objectContaining({
          title: "Updated title",
          note: "Updated note",
          sourceId: "https://dev.azure.com/contoso/project/_workitems/edit/123",
        }),
      ],
    });
  });

  it("dismisses staged imports and keeps them out of later syncs", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "ajour-storage-"));
    tempDirs.push(tempDir);

    const storage = new AppApiStorage(path.join(tempDir, "app-api-state.json"));

    await storage.stageImportItems([buildImportCandidate()]);
    const staged = await storage.listStagedImports();

    await expect(
      storage.dismissImports(staged.items.map((item) => item.id)),
    ).resolves.toMatchObject({ dismissedCount: 1 });
    await expect(storage.listStagedImports()).resolves.toMatchObject({
      totalCount: 0,
      selectedCount: 0,
      items: [],
    });

    await expect(
      storage.stageImportItems([buildImportCandidate()]),
    ).resolves.toEqual({
      queuedCount: 0,
      updatedCount: 0,
      skippedCount: 1,
    });
  });

  it("restores the last dismissal exactly, so later syncs update the items again", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "ajour-storage-"));
    tempDirs.push(tempDir);

    const storage = new AppApiStorage(path.join(tempDir, "app-api-state.json"));

    await storage.stageImportItems([
      buildImportCandidate(),
      buildImportCandidate({ sourceId: "other-1", externalId: "124" }),
    ]);
    // An unselected item comes back unselected.
    await storage.updateImportSelection(
      (await storage.listStagedImports()).items
        .filter((item) => item.sourceId === "other-1")
        .map((item) => item.id),
      false,
    );
    const before = await storage.listStagedImports();

    const { undoToken } = await storage.dismissImports(
      before.items.map((item) => item.id),
    );
    await expect(storage.restoreDismissedImports(undoToken!)).resolves.toBe(
      "restored",
    );

    await expect(storage.listStagedImports()).resolves.toEqual(before);
    // The keys are no longer dismissed, so a sync updates the items.
    await expect(
      storage.stageImportItems([buildImportCandidate()]),
    ).resolves.toMatchObject({ updatedCount: 1, skippedCount: 0 });
    // Undo runs once.
    await expect(storage.restoreDismissedImports(undoToken!)).resolves.toBe(
      "expired",
    );
  });

  it("refuses to restore a dismissal after its connection was deleted", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "ajour-storage-"));
    tempDirs.push(tempDir);

    const storage = new AppApiStorage(path.join(tempDir, "app-api-state.json"));
    const connection = await storage.upsertConnection("azure_devops", {
      label: "Main Azure",
      tenantLabel: "Contoso",
      autoSync: false,
      autoSyncIntervalMinutes: 20,
      config: {},
      configSummary: {},
    });
    await storage.stageImportItems([
      buildImportCandidate({ connectionId: connection.id }),
    ]);
    const staged = await storage.listStagedImports();
    const { undoToken } = await storage.dismissImports(
      staged.items.map((item) => item.id),
    );
    await storage.deleteConnection("azure_devops", connection.id);

    await expect(storage.restoreDismissedImports(undoToken!)).resolves.toBe(
      "expired",
    );
    await expect(storage.listStagedImports()).resolves.toMatchObject({
      totalCount: 0,
      items: [],
    });
  });

  it("refuses to restore a dismissal when the plugin data was removed since", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "ajour-storage-"));
    tempDirs.push(tempDir);

    const storage = new AppApiStorage(path.join(tempDir, "app-api-state.json"));

    await storage.stageImportItems([buildImportCandidate()]);
    const staged = await storage.listStagedImports();
    const { undoToken } = await storage.dismissImports(
      staged.items.map((item) => item.id),
    );
    await storage.removePluginData("azure_devops");

    await expect(storage.restoreDismissedImports(undoToken!)).resolves.toBe(
      "stale",
    );
    await expect(storage.listStagedImports()).resolves.toMatchObject({
      totalCount: 0,
    });
  });

  it("ignores legacy seenImportKeys so previously committed backlog imports can stage again", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "ajour-storage-"));
    tempDirs.push(tempDir);

    const statePath = path.join(tempDir, "app-api-state.json");
    await writeFile(
      statePath,
      `${JSON.stringify(
        {
          version: 2,
          connectors: {
            azureDevOpsConnections: [],
          },
          stagedImports: [],
          seenImportKeys: [
            "azure_devops:ado-1:https://dev.azure.com/contoso/project/_workitems/edit/123",
          ],
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const storage = new AppApiStorage(statePath);

    await expect(
      storage.stageImportItems([buildImportCandidate()]),
    ).resolves.toEqual({
      queuedCount: 1,
      updatedCount: 0,
      skippedCount: 0,
    });
  });

  it("records when a connection's sync failed and clears it on the next success", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "ajour-storage-"));
    tempDirs.push(tempDir);

    const storage = new AppApiStorage(path.join(tempDir, "app-api-state.json"));
    const connection = await storage.upsertConnection("azure_devops", {
      label: "Main Azure",
      tenantLabel: "Contoso",
      autoSync: true,
      autoSyncIntervalMinutes: 20,
      config: {},
      configSummary: {},
    });

    const failed = await storage.recordConnectionError(
      "azure_devops",
      connection.id,
      "Token rejected",
    );
    expect(failed).toMatchObject({
      lastError: "Token rejected",
      lastErrorAt: expect.any(Number),
    });

    await expect(
      storage.recordConnectionSyncSuccess("azure_devops", connection.id, 50),
    ).resolves.toMatchObject({
      lastSyncAt: 50,
      lastError: undefined,
      lastErrorAt: undefined,
    });
  });

  it("stores plugin-shaped connections and groups them by plugin in the overview", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "ajour-storage-"));
    tempDirs.push(tempDir);

    const storage = new AppApiStorage(path.join(tempDir, "app-api-state.json"));
    const azurePlugin = buildPlugin("azure_devops", "Azure DevOps");
    const jiraPlugin = buildPlugin("jira", "Jira");

    await storage.upsertConnection("azure_devops", {
      label: "Main Azure",
      tenantLabel: "Contoso",
      autoSync: true,
      autoSyncIntervalMinutes: 20,
      config: {
        organizationUrl: "https://dev.azure.com/contoso",
        queryScope: "assigned_to_me",
      },
      configSummary: {
        organizationUrl: "https://dev.azure.com/contoso",
        scope: "Assigned to me",
      },
    });

    await storage.upsertConnection("jira", {
      label: "Main Jira",
      tenantLabel: "Acme",
      autoSync: false,
      autoSyncIntervalMinutes: 15,
      config: {
        baseUrl: "https://acme.atlassian.net",
      },
      configSummary: {
        site: "https://acme.atlassian.net",
        scope: "Assigned to me",
      },
    });

    await expect(
      storage.getPluginsOverview([azurePlugin, jiraPlugin]),
    ).resolves.toMatchObject({
      plugins: [
        expect.objectContaining({
          id: "azure_devops",
          displayName: "Azure DevOps",
        }),
        expect.objectContaining({ id: "jira", displayName: "Jira" }),
      ],
      connectionGroups: [
        expect.objectContaining({
          plugin: expect.objectContaining({ id: "azure_devops" }),
          connections: [
            expect.objectContaining({
              label: "Main Azure",
              autoSync: true,
              configSummary: {
                organizationUrl: "https://dev.azure.com/contoso",
                scope: "Assigned to me",
              },
            }),
          ],
        }),
        expect.objectContaining({
          plugin: expect.objectContaining({ id: "jira" }),
          connections: [
            expect.objectContaining({
              label: "Main Jira",
              autoSync: false,
              configSummary: {
                site: "https://acme.atlassian.net",
                scope: "Assigned to me",
              },
            }),
          ],
        }),
      ],
      totalPendingImportCount: 0,
      totalSelectedImportCount: 0,
    });
  });

  it("persists plugin activation without removing saved connections", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "ajour-storage-"));
    tempDirs.push(tempDir);

    const statePath = path.join(tempDir, "app-api-state.json");
    const storage = new AppApiStorage(statePath);
    const jiraPlugin = buildPlugin("jira", "Jira");
    const availablePluginIds = new Set(["jira"]);

    await storage.upsertConnection("jira", {
      label: "Main Jira",
      tenantLabel: "Acme",
      autoSync: true,
      autoSyncIntervalMinutes: 15,
      config: { baseUrl: "https://acme.atlassian.net" },
      configSummary: { site: "https://acme.atlassian.net" },
    });

    await storage.setPluginEnabled("jira", false);

    await expect(
      storage.isPluginEnabled("jira", availablePluginIds),
    ).resolves.toBe(false);
    await expect(
      storage.getPluginsOverview([jiraPlugin]),
    ).resolves.toMatchObject({
      connectionGroups: [
        {
          plugin: expect.objectContaining({ id: "jira" }),
          enabled: false,
          connections: [expect.objectContaining({ label: "Main Jira" })],
        },
      ],
    });

    const reloadedStorage = new AppApiStorage(statePath);
    await expect(
      reloadedStorage.isPluginEnabled("jira", availablePluginIds),
    ).resolves.toBe(false);

    await reloadedStorage.setPluginEnabled("jira", true);
    await expect(
      reloadedStorage.isPluginEnabled("jira", availablePluginIds),
    ).resolves.toBe(true);
    await expect(
      reloadedStorage.isPluginEnabled("jira", new Set()),
    ).resolves.toBe(false);
  });

  it("turns one capability off without deactivating the plugin", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "ajour-storage-"));
    tempDirs.push(tempDir);
    const statePath = path.join(tempDir, "app-api-state.json");
    const storage = new AppApiStorage(statePath);
    const plugin = {
      ...buildPlugin("github", "GitHub"),
      capabilities: { connector: {}, codeHost: {} },
    };
    const available = new Set(["github"]);

    await storage.setPluginCapabilityEnabled("github", "codeHost", false);

    const reloaded = new AppApiStorage(statePath);
    await expect(
      reloaded.isPluginCapabilityEnabled("github", "codeHost", available),
    ).resolves.toBe(false);
    await expect(
      reloaded.isPluginCapabilityEnabled("github", "connector", available),
    ).resolves.toBe(true);
    await expect(reloaded.isPluginEnabled("github", available)).resolves.toBe(
      true,
    );
    await expect(
      reloaded.listEnabledCapabilities("github", ["connector", "codeHost"]),
    ).resolves.toEqual(["connector"]);
    await expect(reloaded.getPluginsOverview([plugin])).resolves.toMatchObject({
      connectionGroups: [{ enabled: true, inactiveCapabilities: ["codeHost"] }],
    });

    await reloaded.setPluginCapabilityEnabled("github", "codeHost", true);
    await expect(reloaded.getPluginsOverview([plugin])).resolves.toMatchObject({
      connectionGroups: [{ inactiveCapabilities: [] }],
    });

    await reloaded.setPluginCapabilityEnabled("github", "connector", false);
    await reloaded.removePluginData("github");
    await expect(
      reloaded.isPluginCapabilityEnabled("github", "connector", available),
    ).resolves.toBe(true);
  });

  it("drops invalid stored capability choices", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "ajour-storage-"));
    tempDirs.push(tempDir);
    const statePath = path.join(tempDir, "app-api-state.json");
    const storage = new AppApiStorage(statePath);
    await storage.setPluginSystemEnabled(true);
    const state = JSON.parse(await readFile(statePath, "utf8"));
    await writeFile(
      statePath,
      JSON.stringify({
        ...state,
        disabledCapabilities: {
          github: ["codeHost", "schema", 3, "codeHost"],
          jira: "connector",
          " ": ["connector"],
        },
      }),
    );

    const reloaded = new AppApiStorage(statePath);
    const available = new Set(["github", "jira"]);
    await expect(
      reloaded.isPluginCapabilityEnabled("github", "codeHost", available),
    ).resolves.toBe(false);
    await expect(
      reloaded.isPluginCapabilityEnabled("jira", "connector", available),
    ).resolves.toBe(true);
  });

  it("deactivates every plugin globally without losing individual choices", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "ajour-storage-"));
    tempDirs.push(tempDir);
    const statePath = path.join(tempDir, "app-api-state.json");
    const storage = new AppApiStorage(statePath);
    const jiraPlugin = buildPlugin("jira", "Jira");
    const availablePluginIds = new Set(["jira"]);

    await storage.setPluginSystemEnabled(false);
    await expect(
      storage.getPluginsOverview([jiraPlugin]),
    ).resolves.toMatchObject({
      pluginsEnabled: false,
      connectionGroups: [{ enabled: false }],
    });
    await expect(
      storage.isPluginEnabled("jira", availablePluginIds),
    ).resolves.toBe(false);

    const reloaded = new AppApiStorage(statePath);
    await reloaded.setPluginSystemEnabled(true);
    await expect(
      reloaded.isPluginEnabled("jira", availablePluginIds),
    ).resolves.toBe(true);

    await reloaded.setPluginEnabled("jira", false);
    await reloaded.setPluginSystemEnabled(false);
    await reloaded.setPluginSystemEnabled(true);
    await expect(
      reloaded.isPluginEnabled("jira", availablePluginIds),
    ).resolves.toBe(false);
  });

  // Regression: a plugin that fails to load (for example an older plugin API
  // version) left its connections behind, and the whole overview failed the
  // shared schema because the placeholder had an empty entrypoint.
  it("keeps the overview valid when a saved connection's plugin is missing", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "ajour-storage-"));
    tempDirs.push(tempDir);
    const storage = new AppApiStorage(path.join(tempDir, "app-api-state.json"));
    await storage.upsertConnection("jira", {
      label: "Main Jira",
      tenantLabel: "Acme",
      autoSync: false,
      autoSyncIntervalMinutes: 15,
      config: {},
      configSummary: {},
    });

    const overview = pluginsOverviewSchema.parse(
      await storage.getPluginsOverview([]),
    );

    expect(overview.connectionGroups).toMatchObject([
      {
        plugin: {
          id: "jira",
          unavailableReason: expect.stringContaining("not installed"),
        },
        enabled: false,
        connections: [{ label: "Main Jira" }],
      },
    ]);
  });

  it("migrates version 5 activation state and tolerates invalid disabled IDs", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "ajour-storage-"));
    tempDirs.push(tempDir);
    const statePath = path.join(tempDir, "app-api-state.json");
    await writeFile(
      statePath,
      `${JSON.stringify({
        version: 5,
        connections: [],
        stagedImports: [],
        dismissedImportKeys: [],
        connectorBacklogStatuses: [
          {
            source: "Legacy Source",
            connectionId: "legacy-1",
            connectionLabel: "Legacy",
            tenantLabel: "Local",
            key: "active",
            label: "Active",
            lastSeenAt: 1,
          },
        ],
        disabledPluginIds: "jira",
      })}\n`,
      "utf8",
    );

    const storage = new AppApiStorage(statePath);
    await expect(storage.listBacklogSourceStatuses()).resolves.toMatchObject({
      items: [{ source: "Legacy Source", label: "Active" }],
    });
    await expect(
      storage.isPluginEnabled("jira", new Set(["jira"])),
    ).resolves.toBe(true);
  });

  it("removes plugin configuration and credentials for an uninstalled plugin", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "ajour-storage-"));
    tempDirs.push(tempDir);
    const statePath = path.join(tempDir, "app-api-state.json");
    const storage = new AppApiStorage(statePath);

    const connection = await storage.upsertConnection("jira", {
      label: "Main Jira",
      tenantLabel: "Acme",
      autoSync: false,
      autoSyncIntervalMinutes: 15,
      config: { token: "secret" },
      configSummary: { site: "Acme" },
    });
    await storage.stageImportItems([
      buildImportCandidate({
        source: "jira",
        connectionId: connection.id,
      }),
    ]);
    await storage.upsertBacklogSourceStatuses([
      {
        source: "jira",
        connectionId: connection.id,
        connectionLabel: connection.label,
        tenantLabel: connection.tenantLabel,
        label: "In Progress",
      },
    ]);
    await storage.setPluginEnabled("jira", false);

    await storage.removePluginData("jira");

    await expect(storage.getPluginsOverview([])).resolves.toMatchObject({
      plugins: [],
      connectionGroups: [],
      totalPendingImportCount: 0,
    });
    const persisted = JSON.parse(await readFile(statePath, "utf8"));
    expect(persisted).toMatchObject({
      connections: [],
      stagedImports: [],
      connectorBacklogStatuses: [],
      disabledPluginIds: [],
    });
    expect(JSON.stringify(persisted)).not.toContain("secret");
  });

  it("stores backlog source states discovered by any plugin source", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "ajour-storage-"));
    tempDirs.push(tempDir);

    const storage = new AppApiStorage(path.join(tempDir, "app-api-state.json"));

    await expect(
      storage.upsertBacklogSourceStatuses([
        {
          source: "jira",
          connectionId: "jira-1",
          connectionLabel: "Main Jira",
          tenantLabel: "Acme",
          label: "In Progress",
        },
      ]),
    ).resolves.toEqual([
      expect.objectContaining({
        source: "jira",
        connectionId: "jira-1",
        key: "in progress",
        label: "In Progress",
      }),
    ]);

    await expect(storage.listBacklogSourceStatuses()).resolves.toEqual({
      items: [
        expect.objectContaining({
          source: "jira",
          connectionId: "jira-1",
          key: "in progress",
          label: "In Progress",
        }),
      ],
    });
  });

  it("keeps the agent runner settings and task values", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "ajour-storage-"));
    tempDirs.push(tempDir);
    const statePath = path.join(tempDir, "app-api-state.json");
    const storage = new AppApiStorage(statePath);
    expect(await storage.getAgentRunnerSettings()).toEqual({
      cli: null,
      browserMode: "ajour-chrome",
      model: "",
    });
    await storage.updateAgentRunnerSettings({ cli: "claude-code" });
    await storage.setAgentTaskValues("ajp-workday", {
      timesheetUrl: "https://wd.example/t",
    });
    const reloaded = new AppApiStorage(statePath);
    expect((await reloaded.getAgentRunnerSettings()).cli).toBe("claude-code");
    expect(await reloaded.getAgentTaskValues("ajp-workday")).toEqual({
      timesheetUrl: "https://wd.example/t",
    });
    await reloaded.removePluginData("ajp-workday");
    expect(await reloaded.getAgentTaskValues("ajp-workday")).toEqual({});
  });

  it("merges values saved per task into one set for the plugin", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "ajour-storage-"));
    tempDirs.push(tempDir);
    const statePath = path.join(tempDir, "app-api-state.json");
    // Before tasks shared their settings, each task kept its own values.
    await writeFile(
      statePath,
      `${JSON.stringify({
        version: 7,
        connections: [],
        agentRunner: {
          taskValues: {
            "workday-agent": {
              "commit-week": {
                timesheetUrl: "https://wd.example/t",
                username: "",
              },
              "submit-week": {
                timesheetUrl: "https://wd.example/old",
                username: "me",
              },
            },
          },
        },
      })}\n`,
      "utf8",
    );
    const storage = new AppApiStorage(statePath);
    // The first non-empty value of each setting wins.
    expect(await storage.getAgentTaskValues("workday-agent")).toEqual({
      timesheetUrl: "https://wd.example/t",
      username: "me",
    });
  });

  it("ignores stored keys that would write to Object.prototype", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "ajour-storage-"));
    tempDirs.push(tempDir);
    const statePath = path.join(tempDir, "app-api-state.json");
    // JSON.parse gives the state an own "__proto__" key, as a file on disk can.
    await writeFile(
      statePath,
      `{"version":7,"connections":[],"agentRunner":{"taskValues":{"__proto__":{"x":{"a":"b"}},"ajp":{"constructor":{"a":"b"},"task":{"__proto__":"y","url":"https://wd.example/t"}}},"pluginValues":{"__proto__":{"x":"b"},"other":{"constructor":"z","url":"https://wd.example/o"}}}}\n`,
      "utf8",
    );
    const storage = new AppApiStorage(statePath);
    expect(await storage.getAgentTaskValues("ajp")).toEqual({
      url: "https://wd.example/t",
    });
    expect(await storage.getAgentTaskValues("other")).toEqual({
      url: "https://wd.example/o",
    });
    await storage.setAgentTaskValues("__proto__", { x: "b" });
    await storage.setAgentTaskValues("ajp", { a: "b" });
    await storage.getAgentTaskValues("__proto__");
    expect(({} as Record<string, unknown>).x).toBeUndefined();
    expect(await storage.getAgentTaskValues("ajp")).toEqual({ a: "b" });
    expect(await storage.getAgentTaskValues("constructor")).toEqual({});
  });
});
