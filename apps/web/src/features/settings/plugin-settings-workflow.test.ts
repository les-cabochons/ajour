import { describe, expect, it, vi } from "vitest";
import type {
  ConnectorsOverview,
  PluginCatalogResponse,
  ProjectDataShapePluginManifest,
} from "@ajour/shared";
import {
  createPluginSettingsWorkflow,
  type PluginSettingsDependencies,
} from "./plugin-settings-workflow";

const plugin = {
  id: "test-connector",
  version: "1.0.0",
  apiVersion: 2 as const,
  displayName: "Test connector",
  description: "Test",
  iconSvg: "<svg />",
  entrypoint: "plugin.mjs",
  capabilities: { connector: {} },
  connectionFields: [],
};
const overview: ConnectorsOverview = {
  pluginsEnabled: true,
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
  let receiveConnectors: (value: ConnectorsOverview) => void = () => {};
  const unused = vi.fn(async () => {
    throw new Error("Unexpected operation");
  });
  const deps: PluginSettingsDependencies = {
    getCachedConnectorsOverview: () => overview,
    getConnectorsOverview: vi.fn(async () => overview),
    getPluginCatalog: vi.fn(async () => catalog),
    getPluginCatalogSettings: vi.fn(async () => ({
      refreshMinutes: 15 as const,
    })),
    getProjectDataShapePlugins: vi.fn(async () => [shape]),
    subscribeConnectorsOverview: vi.fn((listener) => {
      receiveConnectors = listener;
      return () => {
        receiveConnectors = () => {};
      };
    }),
    subscribeCatalog: () => () => {},
    setConnectorPluginEnabled: unused,
    saveConnectorConnection: unused,
    deleteConnectorConnection: unused,
    syncConnectorConnection: unused,
    installConnectorPlugin: vi.fn(async () => null),
    setPluginSystemEnabled: vi.fn(async (enabled) => ({
      ...overview,
      pluginsEnabled: enabled,
    })),
    configurePluginCatalog: vi.fn(async (settings) => settings),
    downloadCatalogPlugin: unused,
    uninstallConnectorPlugin: unused,
    isConnectorApiMissing: (error) => error === missingApiError,
  };
  return {
    deps,
    publish: (value: ConnectorsOverview) => receiveConnectors(value),
  };
}

describe("plugin settings workflow", () => {
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

  it("accepts background connector updates and ignores an older refresh response", async () => {
    const { deps, publish } = dependencies();
    const pending = deferred<ConnectorsOverview>();
    deps.getConnectorsOverview = () => pending.promise;
    const workflow = createPluginSettingsWorkflow(deps);
    const disconnect = workflow.connect();
    const refresh = workflow.refresh();
    const updated = { ...overview, totalPendingImportCount: 7 };
    publish(updated);
    pending.resolve(overview);
    await refresh;
    expect(workflow.getSnapshot().connectors).toEqual(updated);
    disconnect();
    publish(overview);
    expect(workflow.getSnapshot().connectors).toEqual(updated);
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
    deps.installConnectorPlugin = () => pending.promise;
    const workflow = createPluginSettingsWorkflow(deps);
    const install = workflow.execute({ type: "install" });
    expect(workflow.getSnapshot().isMutatingConnector).toBe(true);
    await expect(
      workflow.execute({ type: "system", enabled: false }),
    ).resolves.toBe(false);
    expect(deps.setPluginSystemEnabled).not.toHaveBeenCalled();
    pending.resolve(null);
    await expect(install).resolves.toBe(false);
    expect(workflow.getSnapshot()).toMatchObject({
      isMutatingConnector: false,
      statusMessage: null,
    });
  });

  it("keeps a changed catalog interval when startup settings arrive later", async () => {
    const { deps } = dependencies();
    const startup = deferred<{ refreshMinutes: 15 }>();
    deps.getPluginCatalogSettings = () => startup.promise;
    const workflow = createPluginSettingsWorkflow(deps);
    const disconnect = workflow.connect();
    await workflow.setCatalogRefreshInterval(60);
    startup.resolve({ refreshMinutes: 15 });
    await startup.promise;
    expect(workflow.getSnapshot().catalogSettings.refreshMinutes).toBe(60);
    disconnect();
  });

  it("changes the catalog interval while a plugin operation is running", async () => {
    const { deps } = dependencies();
    const pending = deferred<null>();
    deps.installConnectorPlugin = () => pending.promise;
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
    expect(workflow.getSnapshot().connectorError).toBe(
      "Unable to update the plugin system.",
    );
  });

  it("flags a missing connector API instead of reporting an error, and clears it once connectors load", async () => {
    const { deps, publish } = dependencies();
    deps.getConnectorsOverview = vi.fn(async () => {
      throw missingApiError;
    });
    const workflow = createPluginSettingsWorkflow(deps);
    await workflow.refresh();
    expect(workflow.getSnapshot()).toMatchObject({
      connectorApiMissing: true,
      connectorError: null,
    });
    const disconnect = workflow.connect();
    publish(overview);
    expect(workflow.getSnapshot().connectorApiMissing).toBe(false);
    disconnect();
  });

  it("flags a missing connector API when a command cannot reach it", async () => {
    const { deps } = dependencies();
    deps.setPluginSystemEnabled = vi.fn(async () => {
      throw missingApiError;
    });
    const workflow = createPluginSettingsWorkflow(deps);
    await expect(
      workflow.execute({ type: "system", enabled: false }),
    ).resolves.toBe(false);
    expect(workflow.getSnapshot()).toMatchObject({
      connectorApiMissing: true,
      connectorError: null,
    });
  });

  it("uses the cached connector overview on mount instead of requesting it again", () => {
    const { deps } = dependencies();
    const workflow = createPluginSettingsWorkflow(deps);
    const disconnect = workflow.connect();
    expect(deps.getConnectorsOverview).not.toHaveBeenCalled();
    disconnect();
  });
});
