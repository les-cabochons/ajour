import { describe, expect, it, vi } from "vitest";
import type {
  PluginsOverview,
  PluginCatalogResponse,
  ProjectDataShapePluginManifest,
} from "@ajour/shared";
import {
  createPluginSettingsWorkflow,
  describeConnectionRemoval,
  describeMissingPluginRemoval,
  describeTeamSync,
  type PluginSettingsDependencies,
} from "./plugin-settings-workflow";

const plugin = {
  id: "test-connector",
  version: "1.0.0",
  apiVersion: 3 as const,
  displayName: "Test connector",
  description: "Test",
  iconSvg: "<svg />",
  entrypoint: "plugin.mjs",
  capabilities: { connector: {} },
  connectionFields: [],
};
const overview: PluginsOverview = {
  pluginsEnabled: true,
  unsignedPluginsEnabled: true,
  plugins: [plugin],
  connectionGroups: [{ plugin, enabled: true, connections: [] }],
  totalPendingImportCount: 0,
  totalSelectedImportCount: 0,
};
const shape: ProjectDataShapePluginManifest = {
  id: "test-shape",
  version: "1.0.0",
  apiVersion: 1,
  displayName: "Test shape",
  description: "Test",
  iconSvg: "<svg />",
  entrypoint: "plugin.mjs",
  capabilities: { projectDataShape: { apiVersion: 1, datasets: [] } },
};
const catalog: PluginCatalogResponse = {
  entries: [],
  sources: [],
  source: "cache",
  checkedAt: "2026-10-10T00:00:00Z",
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

/** Stands in for the error the app API throws when it cannot be reached from the web build. */
const missingApiError = new Error("Failed to fetch");

function dependencies() {
  let receivePlugins: (value: PluginsOverview) => void = () => {};
  const unused = vi.fn(async () => {
    throw new Error("Unexpected operation");
  });
  const deps: PluginSettingsDependencies = {
    getCachedPluginsOverview: () => overview,
    getPluginsOverview: vi.fn(async () => overview),
    getPluginCatalog: vi.fn(async () => catalog),
    getPluginCatalogSettings: vi.fn(async () => ({
      refreshMinutes: 15 as const,
      allowUnsignedInstalls: false,
    })),
    getProjectDataShapePlugins: vi.fn(async () => [shape]),
    subscribePluginsOverview: vi.fn((listener) => {
      receivePlugins = listener;
      return () => {
        receivePlugins = () => {};
      };
    }),
    subscribeCatalog: () => () => {},
    setPluginEnabled: unused,
    savePluginConnection: unused,
    deletePluginConnection: unused,
    removeConnectionSecrets: unused,
    removeMissingPluginData: unused,
    retryVault: unused,
    syncBacklogConnection: unused,
    syncTeamConnection: unused,
    installPlugin: vi.fn(async () => null),
    setPluginSystemEnabled: vi.fn(async (enabled) => ({
      ...overview,
      pluginsEnabled: enabled,
    })),
    setUnsignedPluginsEnabled: vi.fn(async (enabled) => ({
      ...overview,
      unsignedPluginsEnabled: enabled,
    })),
    configurePluginCatalog: vi.fn(async (settings) => settings),
    downloadCatalogPlugin: unused,
    inspectPluginSource: unused,
    addPluginSource: unused,
    removePluginSource: unused,
    uninstallPlugin: unused,
    isPluginApiMissing: (error) => error === missingApiError,
    holdPendingEstimates: vi.fn(),
    connectionHeldEditCount: () => 0,
    discardConnectionHeldEdits: vi.fn(),
  };
  return {
    deps,
    publish: (value: PluginsOverview) => receivePlugins(value),
  };
}

describe("plugin settings workflow", () => {
  it.each([
    {
      capabilities: { codeHost: {} },
      expected: ["codeHost"],
      features: ["pull-requests"],
    },
    {
      capabilities: { connector: {}, codeHost: {} },
      expected: ["connector", "codeHost"],
      features: ["work-item-sync", "pull-requests"],
    },
  ])(
    "keeps every installed capability when the catalog is unavailable: $expected",
    async ({ capabilities, expected, features }) => {
      const { deps } = dependencies();
      const installed = { ...plugin, capabilities };
      deps.getPluginsOverview = async () => ({
        ...overview,
        plugins: [installed],
        connectionGroups: [
          { plugin: installed, enabled: true, connections: [] },
        ],
      });
      const workflow = createPluginSettingsWorkflow(deps);
      await workflow.refresh();
      expect(
        workflow
          .getSnapshot()
          .displayEntries.find((entry) => entry.catalog.id === plugin.id)
          ?.catalog,
      ).toMatchObject({
        capabilities: expected,
        features,
      });
      expect(
        workflow
          .getSnapshot()
          .displayEntries.find((entry) => entry.catalog.id === shape.id)
          ?.catalog.capabilities,
      ).toEqual(["schema"]);
    },
  );

  it("lists an agent task plugin with the agentTask capability", async () => {
    const { deps } = dependencies();
    const agentPlugin = {
      id: "ajp-workday",
      version: "1.0.0",
      apiVersion: 3 as const,
      displayName: "Workday",
      iconSvg: "<svg />",
      connectionFields: [],
      capabilities: {
        agentTask: {
          tasks: [
            {
              id: "enter-week",
              label: "Enter in Workday",
              placement: "commit-week" as const,
              prompt: "prompts/enter-week.md",
              estimateMinutes: 10,
              settings: [],
            },
          ],
        },
      },
    };
    deps.getPluginsOverview = async () => ({
      ...overview,
      plugins: [agentPlugin],
      connectionGroups: [
        { plugin: agentPlugin, enabled: true, connections: [] },
      ],
    });
    const workflow = createPluginSettingsWorkflow(deps);
    await workflow.refresh();
    const entry = workflow
      .getSnapshot()
      .displayEntries.find((item) => item.catalog.id === agentPlugin.id);
    expect(entry?.catalog.capabilities).toEqual(["agentTask"]);
    expect(entry?.catalog.features).toEqual(["agent-task"]);
    expect(entry?.catalog.tags).toEqual(["agent-task"]);
  });

  it("retains installed capabilities when the remote catalog fails", async () => {
    const { deps } = dependencies();
    deps.getPluginCatalog = vi.fn(async () => {
      throw new Error("Offline");
    });
    const workflow = createPluginSettingsWorkflow(deps);
    await workflow.refresh();
    expect(
      workflow.getSnapshot().displayEntries.map((entry) => entry.catalog.id),
    ).toEqual([plugin.id, shape.id]);
    expect(workflow.getSnapshot().catalogError).toBe("Offline");
  });

  it("accepts background plugin updates and ignores an older refresh response", async () => {
    const { deps, publish } = dependencies();
    const pending = deferred<PluginsOverview>();
    deps.getPluginsOverview = () => pending.promise;
    const workflow = createPluginSettingsWorkflow(deps);
    const disconnect = workflow.connect();
    const refresh = workflow.refresh();
    const updated = { ...overview, totalPendingImportCount: 7 };
    publish(updated);
    pending.resolve(overview);
    await refresh;
    expect(workflow.getSnapshot().overview).toEqual(updated);
    disconnect();
    publish(overview);
    expect(workflow.getSnapshot().overview).toEqual(updated);
  });

  it("hides shapes immediately on master deactivation and rejects stale shape discovery", async () => {
    const { deps } = dependencies();
    const workflow = createPluginSettingsWorkflow(deps);
    await workflow.refresh();
    const pending = deferred<ProjectDataShapePluginManifest[]>();
    deps.getProjectDataShapePlugins = () => pending.promise;
    const refresh = workflow.refresh();
    await workflow.execute({ type: "system", enabled: false });
    expect(workflow.getSnapshot().dataShapePlugins).toEqual([]);
    pending.resolve([shape]);
    await refresh;
    expect(workflow.getSnapshot().dataShapePlugins).toEqual([]);
    deps.getProjectDataShapePlugins = async () => [shape];
    await workflow.execute({ type: "system", enabled: true });
    expect(workflow.getSnapshot().dataShapePlugins).toEqual([shape]);
  });

  it("serializes mutations and clears pending state when the file picker is cancelled", async () => {
    const { deps } = dependencies();
    const pending = deferred<null>();
    deps.installPlugin = () => pending.promise;
    const workflow = createPluginSettingsWorkflow(deps);
    const install = workflow.execute({ type: "install" });
    expect(workflow.getSnapshot().isMutatingPlugin).toBe(true);
    await expect(
      workflow.execute({ type: "system", enabled: false }),
    ).resolves.toBe(false);
    expect(deps.setPluginSystemEnabled).not.toHaveBeenCalled();
    pending.resolve(null);
    await expect(install).resolves.toBe(false);
    expect(workflow.getSnapshot()).toMatchObject({
      isMutatingPlugin: false,
      statusMessage: null,
    });
  });

  it("deactivates every unsigned plugin and says so", async () => {
    const { deps } = dependencies();
    const workflow = createPluginSettingsWorkflow(deps);

    await expect(
      workflow.execute({ type: "unsigned", enabled: false }),
    ).resolves.toBe(true);

    expect(deps.setUnsignedPluginsEnabled).toHaveBeenCalledWith(false);
    expect(workflow.getSnapshot()).toMatchObject({
      overview: { unsignedPluginsEnabled: false },
      statusMessage:
        "Unsigned plugins deactivated. Signed plugins keep running.",
    });
  });

  it("keeps the refresh interval when unsigned installs change, and the other way round", async () => {
    const { deps } = dependencies();
    const workflow = createPluginSettingsWorkflow(deps);

    await workflow.setAllowUnsignedInstalls(true);
    await workflow.setCatalogRefreshInterval(60);

    expect(deps.configurePluginCatalog).toHaveBeenNthCalledWith(1, {
      refreshMinutes: 15,
      allowUnsignedInstalls: true,
    });
    expect(deps.configurePluginCatalog).toHaveBeenNthCalledWith(2, {
      refreshMinutes: 60,
      allowUnsignedInstalls: true,
    });
    expect(workflow.getSnapshot().catalogSettings).toEqual({
      refreshMinutes: 60,
      allowUnsignedInstalls: true,
    });
  });

  it("changes nothing when the person cancels at the unsigned plugin warning", async () => {
    const { deps } = dependencies();
    deps.downloadCatalogPlugin = vi.fn(async () => null);
    const workflow = createPluginSettingsWorkflow(deps);

    await expect(
      workflow.execute({
        type: "download",
        pluginId: "weather",
        sourceUrl: "https://codeberg.org/alice/plugins",
      }),
    ).resolves.toBe(false);

    expect(deps.downloadCatalogPlugin).toHaveBeenCalledWith(
      "weather",
      "https://codeberg.org/alice/plugins",
    );
    expect(workflow.getSnapshot()).toMatchObject({
      pluginError: null,
      statusMessage: null,
      isMutatingPlugin: false,
    });
  });

  it("adds a source and shows what it lists", async () => {
    const { deps } = dependencies();
    const withSource: PluginCatalogResponse = {
      ...catalog,
      sources: [
        {
          url: "https://codeberg.org/alice/plugins",
          name: "Alice's plugins",
          official: false,
          hostKind: "gitea",
          state: "unsigned",
          pluginCount: 1,
        },
      ],
    };
    deps.addPluginSource = vi.fn(async () => withSource);
    const workflow = createPluginSettingsWorkflow(deps);

    await workflow.execute({
      type: "addSource",
      url: "https://codeberg.org/alice/plugins",
      keyFingerprint: null,
    });

    expect(deps.addPluginSource).toHaveBeenCalledWith(
      "https://codeberg.org/alice/plugins",
      null,
    );
    expect(workflow.getSnapshot()).toMatchObject({
      catalog: { sources: [{ name: "Alice's plugins" }] },
      statusMessage: "Alice's plugins is added.",
    });
  });

  it("keeps a changed catalog interval when startup settings arrive later", async () => {
    const { deps } = dependencies();
    const startup = deferred<{
      refreshMinutes: 15;
      allowUnsignedInstalls: boolean;
    }>();
    deps.getPluginCatalogSettings = () => startup.promise;
    const workflow = createPluginSettingsWorkflow(deps);
    const disconnect = workflow.connect();
    await workflow.setCatalogRefreshInterval(60);
    startup.resolve({ refreshMinutes: 15, allowUnsignedInstalls: false });
    await startup.promise;
    expect(workflow.getSnapshot().catalogSettings.refreshMinutes).toBe(60);
    disconnect();
  });

  it("changes the catalog interval while a plugin operation is running", async () => {
    const { deps } = dependencies();
    const pending = deferred<null>();
    deps.installPlugin = () => pending.promise;
    const workflow = createPluginSettingsWorkflow(deps);
    const install = workflow.execute({ type: "install" });
    await workflow.setCatalogRefreshInterval(30);
    expect(workflow.getSnapshot().catalogSettings.refreshMinutes).toBe(30);
    pending.resolve(null);
    await install;
  });

  it("reports the command-specific message when a command fails without an Error", async () => {
    const { deps } = dependencies();
    deps.setPluginSystemEnabled = vi.fn(async () => {
      throw "offline";
    });
    const workflow = createPluginSettingsWorkflow(deps);
    await expect(
      workflow.execute({ type: "system", enabled: false }),
    ).resolves.toBe(false);
    expect(workflow.getSnapshot().pluginError).toBe(
      "Unable to update the plugin system.",
    );
  });

  it("flags a missing app API instead of reporting an error, and clears it once the overview loads", async () => {
    const { deps, publish } = dependencies();
    deps.getPluginsOverview = vi.fn(async () => {
      throw missingApiError;
    });
    const workflow = createPluginSettingsWorkflow(deps);
    await workflow.refresh();
    expect(workflow.getSnapshot()).toMatchObject({
      pluginApiMissing: true,
      pluginError: null,
    });
    const disconnect = workflow.connect();
    publish(overview);
    expect(workflow.getSnapshot().pluginApiMissing).toBe(false);
    disconnect();
  });

  it("flags a missing app API when a command cannot reach it", async () => {
    const { deps } = dependencies();
    deps.setPluginSystemEnabled = vi.fn(async () => {
      throw missingApiError;
    });
    const workflow = createPluginSettingsWorkflow(deps);
    await expect(
      workflow.execute({ type: "system", enabled: false }),
    ).resolves.toBe(false);
    expect(workflow.getSnapshot()).toMatchObject({
      pluginApiMissing: true,
      pluginError: null,
    });
  });

  it("uses the cached plugin overview on mount instead of requesting it again", () => {
    const { deps } = dependencies();
    const workflow = createPluginSettingsWorkflow(deps);
    const disconnect = workflow.connect();
    expect(deps.getPluginsOverview).not.toHaveBeenCalled();
    disconnect();
  });
});

describe("saving a connection", () => {
  it("hands the saved connection to the caller, such as a new one's ID", async () => {
    const { deps } = dependencies();
    const connection = {
      id: "new-connection",
      pluginId: plugin.id,
      label: "Acme",
      tenantLabel: "Acme",
      autoSync: false,
      autoSyncIntervalMinutes: 15,
      connectedAt: 1,
      pendingImportCount: 0,
      selectedImportCount: 0,
      configSummary: {},
      editableValues: {},
    };
    deps.savePluginConnection = vi.fn(async () => ({
      overview,
      connection,
    }));
    const workflow = createPluginSettingsWorkflow(deps);
    const onSaved = vi.fn();

    await expect(
      workflow.execute({
        type: "save",
        pluginId: plugin.id,
        values: { label: "Acme" },
        onSaved,
      }),
    ).resolves.toBe(true);
    expect(onSaved).toHaveBeenCalledWith(connection);
  });

  it("turns a plugin on for the version the user reviewed, and a capability without one", async () => {
    const { deps } = dependencies();
    const setPluginEnabled = vi.fn(async () => overview);
    deps.setPluginEnabled = setPluginEnabled;
    const workflow = createPluginSettingsWorkflow(deps);

    await workflow.execute({ type: "activate", plugin, enabled: true });
    await workflow.execute({ type: "activate", plugin, enabled: false });
    await workflow.execute({
      type: "activate",
      plugin,
      enabled: true,
      capability: "connector",
    });

    expect(setPluginEnabled.mock.calls).toEqual([
      ["test-connector", true, undefined, "1.0.0"],
      ["test-connector", false, undefined, undefined],
      ["test-connector", true, "connector", undefined],
    ]);
  });

  it("sends the reminder dates with the save", async () => {
    const { deps } = dependencies();
    deps.savePluginConnection = vi.fn(async () => {
      throw new Error("stop");
    });
    const workflow = createPluginSettingsWorkflow(deps);

    await workflow.execute({
      type: "save",
      pluginId: plugin.id,
      values: { label: "Acme" },
      connectionId: "c1",
      secretExpiry: { token: 1_800_000_000_000, other: null },
    });

    expect(deps.savePluginConnection).toHaveBeenCalledWith(
      plugin.id,
      { label: "Acme" },
      "c1",
      { token: 1_800_000_000_000, other: null },
      // The access choices stay as saved.
      undefined,
    );
  });
});

describe("turning editing work items on", () => {
  const choices = [
    { id: "readBacklog", label: "Read", always: true, operations: [] },
    {
      id: "editWorkItems",
      label: "Edit work items",
      always: false,
      operations: ["writeSettle", "pushEstimates"],
    },
  ];
  const saved = {
    id: "c1",
    pluginId: plugin.id,
    label: "Acme",
    tenantLabel: "Acme",
    autoSync: false,
    autoSyncIntervalMinutes: 15,
    connectedAt: 1,
    pendingImportCount: 0,
    selectedImportCount: 0,
    configSummary: {},
    editableValues: {},
    access: ["readBacklog"],
  };
  const withAccess: PluginsOverview = {
    ...overview,
    connectionGroups: [
      {
        plugin,
        enabled: true,
        connectionAccess: choices,
        connections: [saved],
      },
    ],
  };

  function setUp(held: number) {
    const { deps } = dependencies();
    const order: string[] = [];
    deps.getCachedPluginsOverview = () => withAccess;
    deps.holdPendingEstimates = vi.fn(() => void order.push("hold"));
    deps.connectionHeldEditCount = vi.fn(() => held);
    deps.savePluginConnection = vi.fn(async () => {
      order.push("save");
      return { overview: withAccess, connection: saved };
    });
    const onHeldForReview = vi.fn();
    const save = (access: string[]) =>
      createPluginSettingsWorkflow(deps).execute({
        type: "save",
        pluginId: plugin.id,
        values: { label: "Acme" },
        connectionId: "c1",
        access,
        onHeldForReview,
      });
    return { deps, order, onHeldForReview, save };
  }

  it("holds the estimates waiting to upload before the save that turns editing on goes, then opens their review", async () => {
    const { deps, order, onHeldForReview, save } = setUp(2);

    await expect(save(["editWorkItems"])).resolves.toBe(true);

    // Held first: a quit or a sync during the save sends none of them.
    expect(order).toEqual(["hold", "save"]);
    expect(deps.holdPendingEstimates).toHaveBeenCalledWith({
      pluginId: plugin.id,
      connectionId: "c1",
    });
    expect(onHeldForReview).toHaveBeenCalledWith("c1");
  });

  it("stays on the page when nothing is held", async () => {
    const { onHeldForReview, save } = setUp(0);

    await save(["editWorkItems"]);

    expect(onHeldForReview).not.toHaveBeenCalled();
  });

  it.each([
    ["inactive", { enabled: false }],
    ["held for more access", { enabled: false, pendingAccess: {} }],
  ])(
    "holds nothing for a save the server refuses because the plugin is %s",
    async (_state, change) => {
      const { deps, onHeldForReview, save } = setUp(2);
      const off = {
        ...withAccess,
        connectionGroups: [{ ...withAccess.connectionGroups[0]!, ...change }],
      } as PluginsOverview;
      deps.getCachedPluginsOverview = () => off;
      deps.savePluginConnection = vi.fn(async () => {
        throw new Error("Activate this plugin before saving a connection.");
      });

      await expect(save(["editWorkItems"])).resolves.toBe(false);

      expect(deps.holdPendingEstimates).not.toHaveBeenCalled();
      expect(onHeldForReview).not.toHaveBeenCalled();
    },
  );

  it("holds nothing more for a save that leaves editing off", async () => {
    const { deps, onHeldForReview, save } = setUp(2);

    await save([]);

    expect(deps.holdPendingEstimates).not.toHaveBeenCalled();
    expect(onHeldForReview).not.toHaveBeenCalled();
  });
});

describe("removing a connection that holds changes", () => {
  it("discards its held changes once the connection is removed", async () => {
    const { deps } = dependencies();
    deps.deletePluginConnection = vi.fn(async () => overview);
    deps.discardConnectionHeldEdits = vi.fn();

    await createPluginSettingsWorkflow(deps).execute({
      type: "delete",
      pluginId: plugin.id,
      connectionId: "c1",
    });

    expect(deps.discardConnectionHeldEdits).toHaveBeenCalledWith({
      pluginId: plugin.id,
      connectionId: "c1",
    });
  });

  it("names the held changes the removal discards", () => {
    expect(
      describeConnectionRemoval(
        { id: "ms", capabilities: {} },
        "work",
        { pullRequests: [], calendarEventRules: [], projects: [] },
        3,
      ),
    ).toBe(
      "This removes the connection from this device. Its 3 held changes are discarded and never sent.",
    );
  });
});

describe("saved secrets", () => {
  it("removes a saved secret and takes the overview the API answers with", async () => {
    const { deps } = dependencies();
    const paused = {
      ...overview,
      connectionGroups: [{ ...overview.connectionGroups[0]!, connections: [] }],
      totalPendingImportCount: 0,
    };
    deps.removeConnectionSecrets = vi.fn(async () => ({
      overview: paused,
      connection: { label: "Acme" } as never,
    }));
    const workflow = createPluginSettingsWorkflow(deps);

    await expect(
      workflow.execute({
        type: "removeSecrets",
        pluginId: plugin.id,
        connectionId: "c1",
        fieldIds: ["token"],
      }),
    ).resolves.toBe(true);

    expect(deps.removeConnectionSecrets).toHaveBeenCalledWith(plugin.id, "c1", [
      "token",
    ]);
    expect(workflow.getSnapshot().overview).toBe(paused);
    expect(workflow.getSnapshot().statusMessage).toBe(
      "Removed the saved secret from Acme.",
    );
  });

  it("reads the overview again after a refused sync, so the row shows Token rejected", async () => {
    const { deps } = dependencies();
    deps.syncBacklogConnection = vi.fn(async () => {
      throw new Error("The service answered 401.");
    });
    const workflow = createPluginSettingsWorkflow(deps);
    const reads = vi.mocked(deps.getPluginsOverview).mock.calls.length;

    await workflow.execute({
      type: "sync",
      pluginId: plugin.id,
      connectionId: "c1",
    });

    await vi.waitFor(() =>
      expect(vi.mocked(deps.getPluginsOverview).mock.calls.length).toBe(
        reads + 1,
      ),
    );
    // The new overview doesn't hide why the sync failed.
    await vi.waitFor(() =>
      expect(workflow.getSnapshot().pluginError).toBe(
        "The service answered 401.",
      ),
    );
  });

  it("opens the vault again and says whether it works now", async () => {
    const { deps } = dependencies();
    deps.retryVault = vi.fn(async () => ({
      ...overview,
      vault: { state: "available" as const },
    }));
    const workflow = createPluginSettingsWorkflow(deps);

    await workflow.execute({ type: "retryVault" });

    expect(workflow.getSnapshot().statusMessage).toBe(
      "Ajour can protect credentials on this computer.",
    );
    expect(workflow.getSnapshot().overview?.vault).toEqual({
      state: "available",
    });
  });

  it("removes a missing plugin's connections, then the rest of its data", async () => {
    const { deps } = dependencies();
    const missing = {
      ...overview,
      connectionGroups: [
        {
          ...overview.connectionGroups[0]!,
          connections: [{ id: "a" }, { id: "b" }] as never,
        },
      ],
    };
    deps.getCachedPluginsOverview = () => missing;
    deps.deletePluginConnection = vi.fn(async () => missing);
    deps.removeMissingPluginData = vi.fn(async () => overview);
    const workflow = createPluginSettingsWorkflow(deps);

    await workflow.execute({
      type: "removeMissingData",
      pluginId: plugin.id,
      pluginName: "Jira",
    });

    expect(deps.deletePluginConnection).toHaveBeenNthCalledWith(
      1,
      plugin.id,
      "a",
    );
    expect(deps.deletePluginConnection).toHaveBeenNthCalledWith(
      2,
      plugin.id,
      "b",
    );
    expect(deps.removeMissingPluginData).toHaveBeenCalledWith(plugin.id);
    expect(workflow.getSnapshot().statusMessage).toBe(
      "Jira connections and saved secrets removed.",
    );
  });
});

describe("describeConnectionRemoval", () => {
  const ofWork = { pluginId: "ms", connectionId: "work" };
  const state = {
    pullRequests: [ofWork, { ...ofWork, connectionId: "other" }],
    calendarEventRules: [ofWork, ofWork],
  } as unknown as Parameters<typeof describeConnectionRemoval>[2];

  it("names what a code host, a calendar or both lose", () => {
    expect(
      describeConnectionRemoval(
        { id: "ms", capabilities: { codeHost: {} } },
        "work",
        state,
      ),
    ).toBe(
      "This removes the connection and its 1 saved pull request from this device.",
    );
    expect(
      describeConnectionRemoval(
        { id: "ms", capabilities: { codeHost: {}, calendar: {} } },
        "work",
        state,
      ),
    ).toBe(
      "This removes the connection and its 1 saved pull request and 2 remembered meetings from this device.",
    );
  });
});

describe("describeMissingPluginRemoval", () => {
  it("counts the held changes the removal discards, as a connection's removal does", () => {
    expect(describeMissingPluginRemoval(0)).not.toContain("held change");
    expect(describeMissingPluginRemoval(1)).toContain(
      "Its 1 held change is discarded and never sent.",
    );
    expect(describeMissingPluginRemoval(3)).toContain(
      "Its 3 held changes are discarded and never sent.",
    );
  });
});

describe("team connections", () => {
  const shared = (connectionId: string) => ({
    _id: `p-${connectionId}`,
    team: { connectionId },
  });

  it("says shared projects become local when a team connection goes", () => {
    const state = {
      pullRequests: [],
      calendarEventRules: [],
      projects: [
        shared("acme"),
        shared("acme"),
        shared("other"),
        { _id: "local" },
      ],
    } as unknown as Parameters<typeof describeConnectionRemoval>[2];

    expect(
      describeConnectionRemoval(
        { id: "team", capabilities: { team: {} } },
        "acme",
        state,
      ),
    ).toBe(
      "This removes the connection from this device. Its 2 shared projects become local here, with their tasks and time entries. The team keeps them.",
    );
    expect(
      describeConnectionRemoval(
        { id: "team", capabilities: { team: {} } },
        "none",
        state,
      ),
    ).toBe("This removes the connection from this device.");
  });

  it("sums up a team sync", () => {
    const outcome = {
      rounds: 2,
      sentProjectCount: 1,
      createdProjectIds: ["a", "b"],
      updatedProjectIds: ["c"],
      heldArrivals: [{ remoteId: "r", localProjectId: "l" }],
      unsendable: [],
      incomplete: false,
    };
    expect(describeTeamSync("Acme", outcome)).toBe(
      "Acme · 1 sent · 2 added · 1 updated · 1 waits for you",
    );
    expect(
      describeTeamSync("Acme", {
        ...outcome,
        sentProjectCount: 0,
        createdProjectIds: [],
        updatedProjectIds: [],
        heldArrivals: [],
      }),
    ).toBe("Acme · up to date");
  });
});
