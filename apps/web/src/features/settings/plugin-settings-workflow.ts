import type { syncTeamConnection, TeamSyncOutcome } from "@/lib/team-sync";
import type * as appApi from "@/lib/app-api";
import type { LocalAppState } from "@/domain/local-state";
import {
  pluginCatalogRefreshMinutesSchema,
  switchableCapabilityLabels,
} from "@ajour/shared";
import type {
  ConnectorFieldValues,
  ConnectorOverviewGroup,
  ConnectorPluginManifest,
  ConnectorsOverview,
  PluginCatalogCapability,
  PluginCatalogEntry,
  PluginCatalogResponse,
  PluginCatalogSettings,
  ProjectDataShapePluginManifest,
  SwitchableCapability,
} from "@ajour/shared";

export type PluginDisplayEntry = {
  catalog: PluginCatalogEntry;
  connectorGroup?: ConnectorOverviewGroup;
  dataShapePlugin?: ProjectDataShapePluginManifest;
};

export type PluginSettingsDependencies = Pick<
  typeof appApi,
  | "getCachedConnectorsOverview"
  | "getConnectorsOverview"
  | "subscribeConnectorsOverview"
  | "getPluginCatalog"
  | "getPluginCatalogSettings"
  | "getProjectDataShapePlugins"
  | "setConnectorPluginEnabled"
  | "saveConnectorConnection"
  | "deleteConnectorConnection"
  | "syncConnectorConnection"
  | "installConnectorPlugin"
  | "setPluginSystemEnabled"
  | "configurePluginCatalog"
  | "downloadCatalogPlugin"
  | "uninstallConnectorPlugin"
  | "isConnectorApiMissing"
> & {
  /** From `lib/team-sync.ts`: runs a team connection's rounds. */
  syncTeamConnection: typeof syncTeamConnection;
  subscribeCatalog(
    listener: (catalog: PluginCatalogResponse) => void,
  ): () => void;
};

type PluginSettingsCommand =
  | {
      type: "activate";
      plugin: ConnectorPluginManifest;
      enabled: boolean;
      /** Only this capability, for a plugin that declares both. */
      capability?: SwitchableCapability;
    }
  | {
      type: "save";
      pluginId: string;
      values: ConnectorFieldValues;
      connectionId?: string;
    }
  | { type: "delete"; pluginId: string; connectionId: string }
  | { type: "sync"; pluginId: string; connectionId: string }
  | { type: "teamSync"; pluginId: string; connectionId: string }
  | { type: "install" }
  | { type: "system"; enabled: boolean }
  | { type: "download"; pluginId: string }
  | { type: "uninstall"; plugin: ConnectorPluginManifest };

/** Fallback error text when a command fails with a non-Error value. */
const commandFailureMessages: Record<PluginSettingsCommand["type"], string> = {
  activate: "Unable to update the connector plugin.",
  save: "Unable to save the connector connection.",
  delete: "Unable to delete the connector connection.",
  sync: "Unable to sync connector items.",
  teamSync: "Unable to sync the team's projects.",
  install: "Unable to install the connector plugin.",
  system: "Unable to update the plugin system.",
  download: "Unable to download the plugin.",
  uninstall: "Unable to uninstall the connector plugin.",
};

/** Read sources that can be superseded by a newer request, a background event, or a mutation. */
type SnapshotSource = "connectors" | "shapes" | "catalog" | "settings";

interface PluginSettingsSnapshot {
  connectors: ConnectorsOverview | null;
  catalog: PluginCatalogResponse | null;
  catalogSettings: PluginCatalogSettings;
  dataShapePlugins: ProjectDataShapePluginManifest[];
  displayEntries: PluginDisplayEntry[];
  connectorError: string | null;
  catalogError: string | null;
  /** The web build runs without the connector API; the page shows one calm notice instead of errors. */
  connectorApiMissing: boolean;
  statusMessage: string | null;
  isMutatingConnector: boolean;
}

function localCatalogEntry(
  plugin: ConnectorPluginManifest | ProjectDataShapePluginManifest,
): PluginCatalogEntry {
  const capabilities: PluginCatalogCapability[] =
    "projectDataShape" in plugin.capabilities
      ? ["schema"]
      : [
          ...(plugin.capabilities.connector ? (["connector"] as const) : []),
          ...(plugin.capabilities.codeHost ? (["codeHost"] as const) : []),
          ...(plugin.capabilities.calendar ? (["calendar"] as const) : []),
          ...(plugin.capabilities.team ? (["team"] as const) : []),
          ...(plugin.capabilities.agentTask ? (["agentTask"] as const) : []),
        ];
  const features = capabilities.map((capability) =>
    capability === "connector"
      ? "work-item-sync"
      : capability === "codeHost"
        ? "pull-requests"
        : capability === "calendar"
          ? "calendar-events"
          : capability === "team"
            ? "project-sync"
            : capability === "agentTask"
              ? "agent-task"
              : "project-data-shape",
  );
  return {
    schemaVersion: 2,
    id: plugin.id,
    title: plugin.displayName,
    description:
      plugin.description ?? "Locally installed Ajour plugin capability.",
    author: {
      name: "Local plugin",
      url: "https://github.com/les-cabochons/ajour",
    },
    license: {
      name: "See plugin package",
      spdxId: "LicenseRef-Plugin",
      url: "https://github.com/les-cabochons/ajour",
    },
    website: "https://github.com/les-cabochons/ajour",
    repository: {
      provider: "github",
      slug: "les-cabochons/ajour",
      url: "https://github.com/les-cabochons/ajour",
    },
    status: "available",
    compatibility: { pluginApiVersion: plugin.apiVersion },
    capabilities,
    features,
    tags: capabilities.map((capability) =>
      capability === "connector"
        ? "connector"
        : capability === "codeHost"
          ? "code-host"
          : capability === "calendar"
            ? "calendar"
            : capability === "team"
              ? "team"
              : capability === "agentTask"
                ? "agent-task"
                : "data-shape",
    ),
  };
}

function reconcileEntries(snapshot: PluginSettingsSnapshot) {
  const entries = new Map<string, PluginDisplayEntry>(
    (snapshot.catalog?.entries ?? []).map((catalog) => [
      catalog.id,
      { catalog },
    ]),
  );
  for (const group of snapshot.connectors?.connectionGroups ?? []) {
    const current = entries.get(group.plugin.id);
    entries.set(group.plugin.id, {
      ...current,
      catalog: current?.catalog ?? localCatalogEntry(group.plugin),
      connectorGroup: group,
    });
  }
  for (const plugin of snapshot.dataShapePlugins) {
    const current = entries.get(plugin.id);
    entries.set(plugin.id, {
      ...current,
      catalog: current?.catalog ?? localCatalogEntry(plugin),
      dataShapePlugin: plugin,
    });
  }
  return Array.from(entries.values()).sort((left, right) =>
    left.catalog.title.localeCompare(right.catalog.title),
  );
}

/** Owns settings snapshot reconciliation and operation ordering; transports stay in their adapters. */
export function createPluginSettingsWorkflow(deps: PluginSettingsDependencies) {
  let snapshot: PluginSettingsSnapshot = {
    connectors: deps.getCachedConnectorsOverview(),
    catalog: null,
    catalogSettings: { refreshMinutes: 15 },
    dataShapePlugins: [],
    displayEntries: [],
    connectorError: null,
    catalogError: null,
    connectorApiMissing: false,
    statusMessage: null,
    isMutatingConnector: false,
  };
  snapshot.displayEntries = reconcileEntries(snapshot);
  const listeners = new Set<() => void>();
  // Generation rejects completions from a previous React subscription lifetime.
  // Source revisions reject older requests and requests superseded by events or mutations.
  let generation = 0;
  let active = true;
  const revisions: Record<SnapshotSource, number> = {
    connectors: 0,
    shapes: 0,
    catalog: 0,
    settings: 0,
  };

  /** Starts a read of `source` and returns a check that is true only while no newer write replaced it. */
  const beginRead = (source: SnapshotSource) => {
    const epoch = generation;
    const revision = ++revisions[source];
    return () => epoch === generation && revision === revisions[source];
  };

  const update = (patch: Partial<PluginSettingsSnapshot>) => {
    if (!active) return;
    snapshot = { ...snapshot, ...patch };
    // A disabled master gate hides executable capabilities immediately.
    if (snapshot.connectors?.pluginsEnabled === false)
      snapshot.dataShapePlugins = [];
    snapshot.displayEntries = reconcileEntries(snapshot);
    for (const listener of listeners) listener();
  };
  const receiveConnectors = (connectors: ConnectorsOverview) => {
    revisions.connectors += 1;
    update({ connectors, connectorError: null, connectorApiMissing: false });
  };
  const errorMessage = (error: unknown, fallback: string) =>
    error instanceof Error ? error.message : fallback;
  /** Patch for a failed API call: a missing API becomes the notice flag, anything else an error. */
  const connectorFailure = (
    error: unknown,
    fallback: string,
  ): Partial<PluginSettingsSnapshot> =>
    deps.isConnectorApiMissing(error)
      ? { connectorApiMissing: true, connectorError: null }
      : { connectorError: errorMessage(error, fallback) };

  async function refreshConnectors() {
    const isLatest = beginRead("connectors");
    try {
      const connectors = await deps.getConnectorsOverview();
      if (isLatest()) receiveConnectors(connectors);
    } catch (error) {
      if (isLatest())
        update(connectorFailure(error, "Unable to reach the app API."));
    }
  }

  async function refreshShapes() {
    const isLatest = beginRead("shapes");
    try {
      const dataShapePlugins = await deps.getProjectDataShapePlugins();
      if (isLatest()) update({ dataShapePlugins });
    } catch {
      if (isLatest()) update({ dataShapePlugins: [] });
    }
  }

  async function refreshCatalog() {
    const isLatest = beginRead("catalog");
    try {
      const catalog = await deps.getPluginCatalog();
      if (isLatest()) update({ catalog, catalogError: null });
    } catch (error) {
      if (isLatest())
        update({
          catalogError: errorMessage(
            error,
            "Unable to load the plugin catalog.",
          ),
        });
    }
  }

  /** The connection's label, for status lines. */
  function connectionLabel(command: {
    pluginId: string;
    connectionId: string;
  }) {
    return (
      snapshot.connectors?.connectionGroups
        .find((group) => group.plugin.id === command.pluginId)
        ?.connections.find(
          (connection) => connection.id === command.connectionId,
        )?.label ?? "Team"
    );
  }

  async function refresh() {
    await Promise.all([refreshConnectors(), refreshCatalog(), refreshShapes()]);
  }

  /** Runs one plugin operation at a time. Resolves false when skipped, cancelled, failed, or outlived. */
  async function execute(command: PluginSettingsCommand): Promise<boolean> {
    if (!active || snapshot.isMutatingConnector) return false;
    const epoch = generation;
    const isCurrent = () => active && epoch === generation;
    update({
      isMutatingConnector: true,
      statusMessage: null,
      connectorError: null,
    });
    const finish = (statusMessage: string, connectors?: ConnectorsOverview) => {
      if (!isCurrent()) return;
      if (connectors) receiveConnectors(connectors);
      update({ statusMessage });
    };
    try {
      switch (command.type) {
        case "activate": {
          const connectors = await deps.setConnectorPluginEnabled(
            command.plugin.id,
            command.enabled,
            command.capability,
          );
          finish(
            command.capability
              ? `${switchableCapabilityLabels[command.capability]} ${command.enabled ? "turned on" : "turned off"} for ${command.plugin.displayName}.`
              : `${command.plugin.displayName} ${command.enabled ? "activated" : "deactivated"}.`,
            connectors,
          );
          break;
        }
        case "save": {
          const result = await deps.saveConnectorConnection(
            command.pluginId,
            command.values,
            command.connectionId,
          );
          finish(
            `${result.connection.label} connection ${command.connectionId ? "updated" : "added"}.`,
            result.overview,
          );
          break;
        }
        case "delete": {
          finish(
            "Connection removed.",
            await deps.deleteConnectorConnection(
              command.pluginId,
              command.connectionId,
            ),
          );
          break;
        }
        case "sync": {
          const result = await deps.syncConnectorConnection(
            command.pluginId,
            command.connectionId,
          );
          if (!isCurrent()) return false;
          await refreshConnectors();
          const conflictCount = result.workItemUpdates.reduce(
            (sum, item) =>
              sum +
              Object.values(item.fields).filter(
                (field) => field?.status === "conflict",
              ).length,
            0,
          );
          const counts =
            result.mode === "backlog"
              ? [
                  `${result.backlogImportedCount} imported`,
                  `${result.backlogUpdatedCount} updated`,
                ]
              : [
                  `${result.stagedCount} staged`,
                  `${result.updatedCount} refreshed`,
                  `${result.skippedCount} skipped`,
                ];
          finish(
            [
              result.connection.label,
              ...counts,
              ...(conflictCount
                ? [`${conflictCount} conflict${conflictCount === 1 ? "" : "s"}`]
                : []),
            ].join(" · "),
          );
          break;
        }
        case "teamSync": {
          const outcome = await deps.syncTeamConnection(
            command.pluginId,
            command.connectionId,
          );
          if (!isCurrent()) return false;
          await refreshConnectors();
          finish(describeTeamSync(connectionLabel(command), outcome));
          break;
        }
        case "install": {
          const result = await deps.installConnectorPlugin();
          // A cancelled file picker returns null.
          if (!result) return false;
          finish(
            `${result.plugin.displayName} ${result.plugin.version} ${result.replaced ? "replaced the installed plugin" : "installed"}.`,
            result.overview,
          );
          break;
        }
        case "system": {
          const connectors = await deps.setPluginSystemEnabled(command.enabled);
          if (!isCurrent()) return false;
          receiveConnectors(connectors);
          // Invalidate any shape discovery started before the gate changed.
          revisions.shapes += 1;
          if (command.enabled) await refreshShapes();
          finish(
            command.enabled
              ? "Plugins enabled. Each plugin has returned to its previous activation state."
              : "Plugins deactivated. Sync and plugin-provided schemas are paused.",
          );
          break;
        }
        case "download": {
          const { result } = await deps.downloadCatalogPlugin(command.pluginId);
          // A download over an installed package is an update.
          finish(
            result.replaced
              ? `${result.plugin.displayName} updated to ${result.plugin.version}.`
              : `${result.plugin.displayName} ${result.plugin.version} downloaded. Activate it when you are ready to configure it.`,
            result.overview,
          );
          break;
        }
        case "uninstall": {
          const result = await deps.uninstallConnectorPlugin(command.plugin.id);
          finish(
            `${command.plugin.displayName} uninstalled. Imported backlog items were preserved.`,
            result.overview,
          );
          break;
        }
      }
      return isCurrent();
    } catch (error) {
      if (epoch === generation)
        update(connectorFailure(error, commandFailureMessages[command.type]));
      return false;
    } finally {
      if (epoch === generation) update({ isMutatingConnector: false });
    }
  }

  /** Saves the catalog refresh interval. It does not wait for plugin operations, matching the catalog's own lifecycle. */
  async function setCatalogRefreshInterval(minutes: number) {
    const parsed = pluginCatalogRefreshMinutesSchema.safeParse(minutes);
    const refreshMinutes = parsed.success ? parsed.data : 15;
    // Supersede the startup settings read so a late response cannot revert this choice.
    const isLatest = beginRead("settings");
    try {
      const catalogSettings = await deps.configurePluginCatalog({
        refreshMinutes,
      });
      if (!isLatest()) return;
      update({
        catalogSettings,
        statusMessage:
          refreshMinutes === 0
            ? "Catalog will refresh at app launch only."
            : `Catalog refresh set to every ${refreshMinutes} minutes.`,
      });
    } catch (error) {
      if (isLatest())
        update({
          connectorError: errorMessage(
            error,
            "Unable to update catalog refresh settings.",
          ),
        });
    }
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    clearFeedback: () => update({ connectorError: null, statusMessage: null }),
    refresh,
    execute,
    setCatalogRefreshInterval,
    connect() {
      active = true;
      generation += 1;
      update({ isMutatingConnector: false });
      const unsubscribeConnectors =
        deps.subscribeConnectorsOverview(receiveConnectors);
      const unsubscribeCatalog = deps.subscribeCatalog((catalog) => {
        revisions.catalog += 1;
        update({ catalog, catalogError: null });
      });
      // The subscription keeps a cached overview current, so only an empty cache needs a request.
      if (!deps.getCachedConnectorsOverview()) void refreshConnectors();
      void refreshCatalog();
      void refreshShapes();
      const isLatestSettings = beginRead("settings");
      void deps.getPluginCatalogSettings().then(
        (catalogSettings) => {
          if (isLatestSettings()) update({ catalogSettings });
        },
        (error: unknown) => {
          if (isLatestSettings())
            update({
              connectorError: errorMessage(
                error,
                "Unable to load catalog refresh settings.",
              ),
            });
        },
      );
      return () => {
        active = false;
        generation += 1;
        unsubscribeConnectors();
        unsubscribeCatalog();
      };
    },
  };
}

/**
 * What removing a connection deletes from this device, for its confirmation:
 * the saved pull requests of a code host and the remembered meetings of a
 * calendar. Imported backlog items and time entries stay.
 */
export function describeConnectionRemoval(
  plugin: {
    id: string;
    capabilities: { codeHost?: object; calendar?: object; team?: object };
  },
  connectionId: string,
  state: Pick<
    LocalAppState,
    "pullRequests" | "calendarEventRules" | "projects"
  >,
) {
  const ofConnection = (item: { pluginId: string; connectionId: string }) =>
    item.pluginId === plugin.id && item.connectionId === connectionId;
  const count = (value: number, one: string, many: string) =>
    `${value} ${value === 1 ? one : many}`;
  const losses = [
    ...(plugin.capabilities.codeHost
      ? [
          count(
            (state.pullRequests ?? []).filter(ofConnection).length,
            "saved pull request",
            "saved pull requests",
          ),
        ]
      : []),
    ...(plugin.capabilities.calendar
      ? [
          count(
            (state.calendarEventRules ?? []).filter(ofConnection).length,
            "remembered meeting",
            "remembered meetings",
          ),
        ]
      : []),
  ];
  const removal =
    losses.length > 0
      ? `This removes the connection and its ${losses.join(" and ")} from this device.`
      : "This removes the connection from this device.";
  if (!plugin.capabilities.team) return removal;
  const shared = state.projects.filter(
    (project) => project.team?.connectionId === connectionId,
  ).length;
  return shared === 0
    ? removal
    : `${removal} Its ${count(shared, "shared project", "shared projects")} become local here, with their tasks and time entries. The team keeps ${shared === 1 ? "it" : "them"}.`;
}

/** The status line after a team sync, such as "Acme · 2 added · 1 waits for you". */
export function describeTeamSync(label: string, outcome: TeamSyncOutcome) {
  const parts = [
    outcome.sentProjectCount ? `${outcome.sentProjectCount} sent` : null,
    outcome.createdProjectIds.length
      ? `${outcome.createdProjectIds.length} added`
      : null,
    outcome.updatedProjectIds.length
      ? `${outcome.updatedProjectIds.length} updated`
      : null,
    outcome.heldArrivals.length
      ? `${outcome.heldArrivals.length} ${outcome.heldArrivals.length === 1 ? "waits" : "wait"} for you`
      : null,
    outcome.unsendable.length
      ? `${outcome.unsendable.length} not sent: too long for the team`
      : null,
    outcome.incomplete ? "more at the next sync" : null,
  ].filter(Boolean);
  return [label, ...(parts.length ? parts : ["up to date"])].join(" · ");
}
