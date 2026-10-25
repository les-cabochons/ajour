import type { syncTeamConnection, TeamSyncOutcome } from "@/lib/team-sync";
import type * as appApi from "@/lib/app-api";
import type { LocalAppState } from "@/domain/local-state";
import {
  pluginCatalogRefreshMinutesSchema,
  switchableCapabilityLabels,
} from "@ajour/shared";
import type {
  PluginConnectionSummary,
  PluginFieldValues,
  PluginOverviewGroup,
  PluginManifest,
  PluginsOverview,
  PluginCatalogCapability,
  PluginCatalogEntry,
  PluginCatalogResponse,
  PluginCatalogSettings,
  ProjectDataShapePluginManifest,
  SwitchableCapability,
} from "@ajour/shared";

export type PluginDisplayEntry = {
  catalog: PluginCatalogEntry;
  pluginGroup?: PluginOverviewGroup;
  dataShapePlugin?: ProjectDataShapePluginManifest;
};

export type PluginSettingsDependencies = Pick<
  typeof appApi,
  | "getCachedPluginsOverview"
  | "getPluginsOverview"
  | "subscribePluginsOverview"
  | "getPluginCatalog"
  | "getPluginCatalogSettings"
  | "getProjectDataShapePlugins"
  | "setPluginEnabled"
  | "savePluginConnection"
  | "deletePluginConnection"
  | "syncBacklogConnection"
  | "installPlugin"
  | "setPluginSystemEnabled"
  | "setUnsignedPluginsEnabled"
  | "configurePluginCatalog"
  | "downloadCatalogPlugin"
  | "inspectPluginSource"
  | "addPluginSource"
  | "removePluginSource"
  | "uninstallPlugin"
  | "isPluginApiMissing"
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
      plugin: PluginManifest;
      enabled: boolean;
      /** Only this capability, for a plugin that declares both. */
      capability?: SwitchableCapability;
    }
  | {
      type: "save";
      pluginId: string;
      values: PluginFieldValues;
      connectionId?: string;
      /** Gets the connection the API saved, such as a new one's ID. */
      onSaved?: (connection: PluginConnectionSummary) => void;
    }
  | { type: "delete"; pluginId: string; connectionId: string }
  | { type: "sync"; pluginId: string; connectionId: string }
  | { type: "teamSync"; pluginId: string; connectionId: string }
  | { type: "install" }
  | { type: "system"; enabled: boolean }
  /** Lets unsigned plugins run, or deactivates every one of them. */
  | { type: "unsigned"; enabled: boolean }
  | { type: "download"; pluginId: string; sourceUrl?: string }
  /** Adds a source, or approves its current key: `keyFingerprint` is the one shown. */
  | { type: "addSource"; url: string; keyFingerprint: string | null }
  | { type: "removeSource"; url: string; name: string }
  | { type: "uninstall"; plugin: PluginManifest };

/** Fallback error text when a command fails with a non-Error value. */
const commandFailureMessages: Record<PluginSettingsCommand["type"], string> = {
  activate: "Unable to update the plugin.",
  save: "Unable to save the plugin connection.",
  delete: "Unable to delete the plugin connection.",
  sync: "Unable to sync backlog items.",
  teamSync: "Unable to sync the team's projects.",
  install: "Unable to install the plugin.",
  system: "Unable to update the plugin system.",
  unsigned: "Unable to change unsigned plugins.",
  download: "Unable to download the plugin.",
  addSource: "Unable to add the plugin source.",
  removeSource: "Unable to remove the plugin source.",
  uninstall: "Unable to uninstall the plugin.",
};

/** Read sources that can be superseded by a newer request, a background event, or a mutation. */
type SnapshotSource = "overview" | "shapes" | "catalog" | "settings";

interface PluginSettingsSnapshot {
  overview: PluginsOverview | null;
  catalog: PluginCatalogResponse | null;
  catalogSettings: PluginCatalogSettings;
  dataShapePlugins: ProjectDataShapePluginManifest[];
  displayEntries: PluginDisplayEntry[];
  pluginError: string | null;
  catalogError: string | null;
  /** The web build runs without the app API; the page shows one calm notice instead of errors. */
  pluginApiMissing: boolean;
  statusMessage: string | null;
  isMutatingPlugin: boolean;
}

function localCatalogEntry(
  plugin: PluginManifest | ProjectDataShapePluginManifest,
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
    id: plugin.id,
    title: plugin.displayName,
    description:
      plugin.description ?? "Locally installed Ajour plugin capability.",
    version: plugin.version,
    author: {
      name: "Local plugin",
      url: "https://github.com/les-cabochons/ajour",
    },
    license: {
      name: "See plugin package",
      spdxId: "LicenseRef-Plugin",
    },
    status: "available",
    compatibility: { pluginApiVersion: plugin.apiVersion },
    capabilities,
    features,
    tags: capabilities.map((capability) =>
      capability === "connector"
        ? "backlog"
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
  for (const group of snapshot.overview?.connectionGroups ?? []) {
    const current = entries.get(group.plugin.id);
    entries.set(group.plugin.id, {
      ...current,
      catalog: current?.catalog ?? localCatalogEntry(group.plugin),
      pluginGroup: group,
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
    overview: deps.getCachedPluginsOverview(),
    catalog: null,
    catalogSettings: { refreshMinutes: 15, allowUnsignedInstalls: false },
    dataShapePlugins: [],
    displayEntries: [],
    pluginError: null,
    catalogError: null,
    pluginApiMissing: false,
    statusMessage: null,
    isMutatingPlugin: false,
  };
  snapshot.displayEntries = reconcileEntries(snapshot);
  const listeners = new Set<() => void>();
  // Generation rejects completions from a previous React subscription lifetime.
  // Source revisions reject older requests and requests superseded by events or mutations.
  let generation = 0;
  let active = true;
  const revisions: Record<SnapshotSource, number> = {
    overview: 0,
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
    if (snapshot.overview?.pluginsEnabled === false)
      snapshot.dataShapePlugins = [];
    snapshot.displayEntries = reconcileEntries(snapshot);
    for (const listener of listeners) listener();
  };
  const receivePlugins = (overview: PluginsOverview) => {
    revisions.overview += 1;
    update({ overview, pluginError: null, pluginApiMissing: false });
  };
  const errorMessage = (error: unknown, fallback: string) =>
    error instanceof Error ? error.message : fallback;
  /** Patch for a failed API call: a missing API becomes the notice flag, anything else an error. */
  const pluginFailure = (
    error: unknown,
    fallback: string,
  ): Partial<PluginSettingsSnapshot> =>
    deps.isPluginApiMissing(error)
      ? { pluginApiMissing: true, pluginError: null }
      : { pluginError: errorMessage(error, fallback) };

  async function refreshPlugins() {
    const isLatest = beginRead("overview");
    try {
      const overview = await deps.getPluginsOverview();
      if (isLatest()) receivePlugins(overview);
    } catch (error) {
      if (isLatest())
        update(pluginFailure(error, "Unable to reach the app API."));
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
      snapshot.overview?.connectionGroups
        .find((group) => group.plugin.id === command.pluginId)
        ?.connections.find(
          (connection) => connection.id === command.connectionId,
        )?.label ?? "Team"
    );
  }

  async function refresh() {
    await Promise.all([refreshPlugins(), refreshCatalog(), refreshShapes()]);
  }

  /** Runs one plugin operation at a time. Resolves false when skipped, cancelled, failed, or outlived. */
  async function execute(command: PluginSettingsCommand): Promise<boolean> {
    if (!active || snapshot.isMutatingPlugin) return false;
    const epoch = generation;
    const isCurrent = () => active && epoch === generation;
    update({
      isMutatingPlugin: true,
      statusMessage: null,
      pluginError: null,
    });
    const finish = (statusMessage: string, overview?: PluginsOverview) => {
      if (!isCurrent()) return;
      if (overview) receivePlugins(overview);
      update({ statusMessage });
    };
    try {
      switch (command.type) {
        case "activate": {
          const overview = await deps.setPluginEnabled(
            command.plugin.id,
            command.enabled,
            command.capability,
          );
          finish(
            command.capability
              ? `${switchableCapabilityLabels[command.capability]} ${command.enabled ? "turned on" : "turned off"} for ${command.plugin.displayName}.`
              : `${command.plugin.displayName} ${command.enabled ? "activated" : "deactivated"}.`,
            overview,
          );
          break;
        }
        case "save": {
          const result = await deps.savePluginConnection(
            command.pluginId,
            command.values,
            command.connectionId,
          );
          finish(
            `${result.connection.label} connection ${command.connectionId ? "updated" : "added"}.`,
            result.overview,
          );
          if (isCurrent()) command.onSaved?.(result.connection);
          break;
        }
        case "delete": {
          finish(
            "Connection removed.",
            await deps.deletePluginConnection(
              command.pluginId,
              command.connectionId,
            ),
          );
          break;
        }
        case "sync": {
          const result = await deps.syncBacklogConnection(
            command.pluginId,
            command.connectionId,
          );
          if (!isCurrent()) return false;
          await refreshPlugins();
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
          await refreshPlugins();
          finish(describeTeamSync(connectionLabel(command), outcome));
          break;
        }
        case "install": {
          const result = await deps.installPlugin();
          // A cancelled file picker returns null.
          if (!result) return false;
          finish(
            `${result.plugin.displayName} ${result.plugin.version} ${result.replaced ? "replaced the installed plugin" : "installed"}.`,
            result.overview,
          );
          break;
        }
        case "system": {
          const overview = await deps.setPluginSystemEnabled(command.enabled);
          if (!isCurrent()) return false;
          receivePlugins(overview);
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
        case "unsigned": {
          finish(
            command.enabled
              ? "Unsigned plugins can run again. Each one is back to its own activation."
              : "Unsigned plugins deactivated. Signed plugins keep running.",
            await deps.setUnsignedPluginsEnabled(command.enabled),
          );
          break;
        }
        case "addSource": {
          const catalog = await deps.addPluginSource(
            command.url,
            command.keyFingerprint,
          );
          if (!isCurrent()) return false;
          revisions.catalog += 1;
          update({ catalog, catalogError: null });
          const source = catalog.sources.find(
            (candidate) => candidate.url === command.url,
          );
          finish(
            `${source?.name ?? "The source"} is ${command.keyFingerprint ? "trusted with its key" : "added"}.`,
          );
          break;
        }
        case "removeSource": {
          const catalog = await deps.removePluginSource(command.url);
          if (!isCurrent()) return false;
          revisions.catalog += 1;
          update({ catalog, catalogError: null });
          finish(
            `${command.name} removed. Plugins you installed from it stay installed.`,
          );
          break;
        }
        case "download": {
          const outcome = await deps.downloadCatalogPlugin(
            command.pluginId,
            command.sourceUrl,
          );
          // Null: the person cancelled at the unsigned plugin warning.
          if (!outcome) return false;
          const { result } = outcome;
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
          const result = await deps.uninstallPlugin(command.plugin.id);
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
        update(pluginFailure(error, commandFailureMessages[command.type]));
      return false;
    } finally {
      if (epoch === generation) update({ isMutatingPlugin: false });
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
        ...snapshot.catalogSettings,
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
          pluginError: errorMessage(
            error,
            "Unable to update catalog refresh settings.",
          ),
        });
    }
  }

  /** Allows installing unsigned plugins, each after a warning, or stops it. */
  async function setAllowUnsignedInstalls(allowUnsignedInstalls: boolean) {
    const isLatest = beginRead("settings");
    try {
      const catalogSettings = await deps.configurePluginCatalog({
        ...snapshot.catalogSettings,
        allowUnsignedInstalls,
      });
      if (!isLatest()) return;
      update({
        catalogSettings,
        statusMessage: allowUnsignedInstalls
          ? "Unsigned plugins can be installed. Ajour warns you each time."
          : "Unsigned plugins can't be installed.",
      });
    } catch (error) {
      if (isLatest())
        update({
          pluginError: errorMessage(
            error,
            "Unable to change unsigned plugin installs.",
          ),
        });
    }
  }

  return {
    getSnapshot: () => snapshot,
    /** Reads a source before it is added. Not a mutation: nothing waits on it. */
    inspectSource: (url: string) => deps.inspectPluginSource(url),
    setAllowUnsignedInstalls,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    clearFeedback: () => update({ pluginError: null, statusMessage: null }),
    refresh,
    execute,
    setCatalogRefreshInterval,
    connect() {
      active = true;
      generation += 1;
      update({ isMutatingPlugin: false });
      const unsubscribePlugins = deps.subscribePluginsOverview(receivePlugins);
      const unsubscribeCatalog = deps.subscribeCatalog((catalog) => {
        revisions.catalog += 1;
        update({ catalog, catalogError: null });
      });
      // The subscription keeps a cached overview current, so only an empty cache needs a request.
      if (!deps.getCachedPluginsOverview()) void refreshPlugins();
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
              pluginError: errorMessage(
                error,
                "Unable to load catalog refresh settings.",
              ),
            });
        },
      );
      return () => {
        active = false;
        generation += 1;
        unsubscribePlugins();
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
