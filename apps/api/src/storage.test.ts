import os from "node:os";
import path from "node:path";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  pluginsOverviewSchema,
  type BacklogImportCandidateInput,
  type PluginManifest,
} from "../../../packages/shared/plugins.ts";
import { AppApiStorage } from "./storage.ts";
import { MemorySecretVault } from "./test-support/memory-secret-vault.ts";

function buildPlugin(
  id: string,
  displayName: string,
  extraFields: PluginManifest["connectionFields"] = [],
): PluginManifest {
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
      ...extraFields,
    ],
  };
}

/** A non-secret field, for a config value the plugin declares. */
function plainField(id: string): PluginManifest["connectionFields"][number] {
  return { id, label: id, type: "text", required: false, secret: false };
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
    const azurePlugin = buildPlugin("azure_devops", "Azure DevOps", [
      plainField("organizationUrl"),
      plainField("queryScope"),
    ]);
    const jiraPlugin = buildPlugin("jira", "Jira", [plainField("baseUrl")]);

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

  it("gives a run no secret still in plain text while encryption is unavailable", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "ajour-storage-"));
    tempDirs.push(tempDir);
    const statePath = path.join(tempDir, "app-api-state.json");
    await writeFile(
      statePath,
      JSON.stringify({
        version: 7,
        connections: [],
        agentRunner: {
          pluginValues: {
            workday: { url: "https://wd.example/t", apiKey: "wd-key-plain" },
          },
        },
      }),
      "utf8",
    );
    const manifest = {
      id: "workday",
      connectionFields: [],
      agentTaskFields: [{ id: "url" }, { id: "apiKey", secret: true }],
    };
    const storage = new AppApiStorage(statePath, {
      vault: new MemorySecretVault({ unavailable: "No keyring." }),
      manifests: async () => [manifest],
    });

    expect(await storage.getAgentTaskValues("workday", manifest)).toEqual({
      url: "https://wd.example/t",
    });
  });

  describe("the broker's records for Access review", () => {
    async function brokerStorage(windowMs: number) {
      const tempDir = await mkdtemp(path.join(os.tmpdir(), "ajour-storage-"));
      tempDirs.push(tempDir);
      const statePath = path.join(tempDir, "app-api-state.json");
      const storage = new AppApiStorage(statePath, {
        brokerActivityWindowMs: windowMs,
      });
      const connection = await storage.upsertConnection("jira", {
        label: "Acme",
        tenantLabel: "Acme",
        autoSync: false,
        autoSyncIntervalMinutes: 15,
        config: {},
        configSummary: {},
      });
      /** What the state file holds, read by a storage of its own. */
      const onDisk = async () =>
        await new AppApiStorage(statePath).brokerActivity("jira");
      return { storage, connectionId: connection.id, statePath, onDisk };
    }

    it("keeps a burst of blocked attempts in memory, writing the file once in the window and all of them on flush", async () => {
      const { storage, connectionId, statePath, onDisk } =
        await brokerStorage(60_000);
      const writes: string[] = [];

      for (let at = 1; at <= 50; at += 1) {
        await storage.recordBrokerActivity("jira", connectionId, "blocked", at);
        writes.push(await readFile(statePath, "utf8"));
      }

      // The first attempt is written at once, the others wait for the window.
      expect(new Set(writes.slice(1)).size).toBe(1);
      expect((await onDisk()).plugin).toMatchObject({ blockedCount: 1 });
      await expect(storage.brokerActivity("jira")).resolves.toEqual({
        plugin: { lastRequestAt: 50, blockedCount: 50, lastBlockedAt: 50 },
        connections: {
          [connectionId]: {
            lastRequestAt: 50,
            blockedCount: 50,
            lastBlockedAt: 50,
          },
        },
      });

      await storage.flushBrokerActivity();

      await expect(onDisk()).resolves.toEqual(
        await storage.brokerActivity("jira"),
      );
    });

    it("writes what a window gathered once it ends", async () => {
      const { storage, connectionId, onDisk } = await brokerStorage(30);

      await storage.recordBrokerActivity("jira", connectionId, "request", 10);
      await storage.recordBrokerActivity("jira", connectionId, "request", 20);
      await storage.recordBrokerActivity("jira", connectionId, "blocked", 25);

      await vi.waitFor(async () => {
        expect((await onDisk()).connections[connectionId]).toEqual({
          lastRequestAt: 25,
          blockedCount: 1,
          lastBlockedAt: 25,
        });
      });
    });

    it("counts a blocked direct attempt without taking it for a request", async () => {
      const { storage, connectionId, onDisk } = await brokerStorage(60_000);

      await storage.recordBrokerActivity(
        "jira",
        undefined,
        "blocked_direct",
        40,
      );
      await expect(storage.brokerActivity("jira")).resolves.toEqual({
        plugin: { blockedCount: 1, lastBlockedAt: 40 },
        connections: {},
      });

      await storage.recordBrokerActivity("jira", connectionId, "request", 10);
      await storage.recordBrokerActivity(
        "jira",
        undefined,
        "blocked_direct",
        50,
      );
      await storage.flushBrokerActivity();

      expect((await onDisk()).plugin).toEqual({
        lastRequestAt: 10,
        blockedCount: 2,
        lastBlockedAt: 50,
      });
    });

    it("forgets what it held for a plugin whose data was removed", async () => {
      const { storage, connectionId, onDisk } = await brokerStorage(60_000);

      await storage.recordBrokerActivity("jira", connectionId, "blocked", 1);
      await storage.recordBrokerActivity("jira", undefined, "blocked", 2);
      await storage.removePluginData("jira");
      await storage.flushBrokerActivity();

      await expect(onDisk()).resolves.toEqual({ connections: {} });
    });

    it("doesn't bring back the record of a plugin removed while a flush was in flight", async () => {
      const { storage, connectionId, onDisk } = await brokerStorage(60_000);
      await storage.recordBrokerActivity("jira", connectionId, "blocked", 1);
      await storage.recordBrokerActivity("jira", undefined, "blocked", 2);

      // The flush has taken the records when the removal runs, and writes after it.
      const removal = storage.removePluginData("jira");
      const flush = storage.flushBrokerActivity();
      await Promise.all([removal, flush]);

      await expect(onDisk()).resolves.toEqual({ connections: {} });
      await expect(storage.brokerActivity("jira")).resolves.toEqual({
        connections: {},
      });
    });

    it("records a plugin installed again after its data was removed", async () => {
      const { storage, onDisk } = await brokerStorage(60_000);
      await storage.removePluginData("jira");

      await storage.recordBrokerActivity("jira", undefined, "blocked", 7);
      await storage.flushBrokerActivity();

      expect((await onDisk()).plugin).toMatchObject({ blockedCount: 1 });
    });

    it("reads no record for a plugin id named like an Object method, and keeps its own", async () => {
      const { storage, statePath, onDisk } = await brokerStorage(60_000);

      await expect(storage.brokerActivity("constructor")).resolves.toEqual({
        connections: {},
      });
      await expect(storage.brokerActivity("toString")).resolves.toEqual({
        connections: {},
      });

      await storage.recordBrokerActivity(
        "constructor",
        undefined,
        "blocked",
        3,
      );
      await storage.recordBrokerActivity(
        "constructor",
        undefined,
        "request",
        4,
      );
      await storage.flushBrokerActivity();

      const expected = {
        plugin: { lastRequestAt: 4, blockedCount: 1, lastBlockedAt: 3 },
        connections: {},
      };
      await expect(storage.brokerActivity("constructor")).resolves.toEqual(
        expected,
      );
      const written = await new AppApiStorage(statePath).brokerActivity(
        "constructor",
      );
      expect(written).toEqual(expected);
      expect((await onDisk()).plugin).toBeUndefined();
    });
  });
});

describe("state files from earlier versions", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(
      tempDirs
        .splice(0)
        .map((dir) => rm(dir, { recursive: true, force: true })),
    );
  });

  /** The state file as it is saved once a file in `saved` loads and changes. */
  async function migrated(saved: object) {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "ajour-migrate-"));
    tempDirs.push(tempDir);
    const statePath = path.join(tempDir, "app-api-state.json");
    await writeFile(statePath, `${JSON.stringify(saved)}\n`, "utf8");
    await new AppApiStorage(statePath).setPluginSystemEnabled(true);
    return JSON.parse(await readFile(statePath, "utf8")) as unknown;
  }

  const emptyCurrentState = {
    version: 8,
    connections: [],
    stagedImports: [],
    dismissedImportKeys: [],
    connectorBacklogStatuses: [],
    disabledPluginIds: [],
    disabledCapabilities: {},
    pluginsEnabled: true,
    mcp: { enabled: false, clients: [] },
    agentRunner: {
      settings: { cli: null, browserMode: "ajour-chrome", model: "" },
      pluginValues: {},
      pluginSecrets: {},
    },
    pluginBrokerActivity: {},
  };
  /**
   * A file with a connection's token: without a vault, as here, the token
   * can't move, so the file stays at version 7 until a launch with one.
   */
  const heldBeforeVault = { ...emptyCurrentState, version: 7 };

  it("moves version 1's one Azure DevOps connection and its inbox to the current version", async () => {
    await expect(
      migrated({
        connectors: {
          azureDevOps: {
            organizationUrl: "https://dev.azure.com/contoso/",
            project: "Apollo",
            personalAccessToken: "pat-v1-fixture",
            queryScope: "assigned",
            connectedAt: 100,
            lastSyncAt: 200,
          },
        },
        backlogInbox: [
          {
            id: "inbox-1",
            source: "azure_devops",
            sourceId: "https://dev.azure.com/contoso/Apollo/_workitems/edit/7",
            title: "Fix login",
            pushedAt: 300,
          },
          { id: "inbox-2", source: "azure_devops", sourceId: "8" },
        ],
        seenBacklogKeys: ["azure_devops:8"],
      }),
    ).resolves.toEqual({
      ...heldBeforeVault,
      connections: [
        {
          id: "legacy_azure_devops",
          pluginId: "azure_devops",
          label: "Apollo",
          tenantLabel: "Legacy tenant",
          autoSync: false,
          autoSyncIntervalMinutes: 15,
          config: {
            organizationUrl: "https://dev.azure.com/contoso",
            project: "Apollo",
            personalAccessToken: "pat-v1-fixture",
            queryScope: "assigned",
          },
          configSummary: {
            organizationUrl: "https://dev.azure.com/contoso",
            queryScope: "assigned",
          },
          connectedAt: 100,
          lastSyncAt: 200,
        },
      ],
      stagedImports: [
        {
          id: "inbox-1",
          source: "azure_devops",
          connectionId: "legacy_azure_devops",
          connectionLabel: "Apollo",
          tenantLabel: "Legacy tenant",
          sourceId: "https://dev.azure.com/contoso/Apollo/_workitems/edit/7",
          externalId: "7",
          title: "Fix login",
          workItemType: "Task",
          depth: 0,
          selectable: true,
          selected: true,
          childCount: 0,
          pushedAt: 300,
        },
      ],
    });
  });

  it("moves version 2's Azure DevOps connections to plugin connections", async () => {
    await expect(
      migrated({
        version: 2,
        connectors: {
          azureDevOpsConnections: [
            {
              id: "ado-1",
              label: "Main",
              tenantLabel: "Contoso",
              organizationUrl: "https://dev.azure.com/contoso/",
              project: "Apollo",
              personalAccessToken: "pat-v2-fixture",
              queryScope: "assigned",
              priorityFieldName: "Priority",
              priorityFieldResolvedName: "Priority",
              autoSync: true,
              connectedAt: 100,
              lastError: "Sync failed.",
            },
          ],
        },
        stagedImports: [],
        dismissedImportKeys: ["azure_devops:ado-1:7"],
        seenImportKeys: ["azure_devops:ado-1:8"],
      }),
    ).resolves.toEqual({
      ...heldBeforeVault,
      connections: [
        {
          id: "ado-1",
          pluginId: "azure_devops",
          label: "Main",
          tenantLabel: "Contoso",
          autoSync: true,
          autoSyncIntervalMinutes: 15,
          config: {
            organizationUrl: "https://dev.azure.com/contoso",
            project: "Apollo",
            personalAccessToken: "pat-v2-fixture",
            queryScope: "assigned",
            priorityFieldName: "Priority",
          },
          configSummary: {
            organizationUrl: "https://dev.azure.com/contoso",
            queryScope: "assigned",
            priorityFieldName: "Priority",
            priorityFieldResolvedName: "Priority",
          },
          connectedAt: 100,
          lastError: "Sync failed.",
        },
      ],
      dismissedImportKeys: ["azure_devops:ado-1:7"],
    });
  });

  it("keeps version 6's plugin choices and turns the plugin system on, as version 7 added it", async () => {
    await expect(
      migrated({
        version: 6,
        connections: [],
        stagedImports: [],
        dismissedImportKeys: [],
        connectorBacklogStatuses: [],
        disabledPluginIds: ["jira"],
      }),
    ).resolves.toEqual({ ...emptyCurrentState, disabledPluginIds: ["jira"] });
  });
});
