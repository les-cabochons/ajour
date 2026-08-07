import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import {
  RiArrowLeftLine as ArrowLeft,
  RiDeleteBinLine as Trash2,
  RiDownloadLine as Download,
  RiPencilLine as Pencil,
  RiRefreshLine as RefreshCw,
  RiUpload2Line as Upload,
} from "@remixicon/react";
import { AppPanel, MessagePanel } from "@/components/app-surface";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { FieldGroup } from "@/components/ui/field";
import { NativeSelect } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  getCachedConnectorsOverview,
  deleteConnectorConnection,
  getAppApiBaseUrl,
  getAppApiDescription,
  getConnectorsOverview,
  getPluginCatalog,
  getPluginCatalogSettings,
  getProjectDataShapePlugins,
  configurePluginCatalog,
  downloadCatalogPlugin,
  installConnectorPlugin,
  saveConnectorConnection,
  setConnectorPluginEnabled,
  setPluginSystemEnabled,
  syncConnectorConnection,
  uninstallConnectorPlugin,
} from "@/lib/app-api";
import { useLocalState } from "@/lib/local-hooks";
import { cn } from "@/lib/utils";
import type {
  ConnectorConnectionSummary,
  ConnectorFieldValues,
  ConnectorOverviewGroup,
  ConnectorPluginManifest,
  ConnectorsOverview,
  PluginCatalogEntry,
  PluginCatalogResponse,
  PluginCatalogSettings,
  ProjectDataShapePluginManifest,
} from "@timetracker/shared";
import {
  areConnectorFormValuesEqual,
  buildConnectorFormValues,
  canSubmitConnectorForm,
  normalizeConnectorFormValuesForSave,
} from "./connector-form-state";
import { ConnectorFieldInput } from "./connector-settings-ui";
import {
  PluginCapabilityBand,
  PluginCapabilityList,
  PluginIdentityMark,
  PluginInfoLedger,
} from "./plugin-catalog-ui";

type ConnectorFormState = {
  pluginId: string;
  editingConnectionId: string | null;
  initialValues: ConnectorFieldValues;
  values: ConnectorFieldValues;
};

type PluginCatalogFilter = "all" | "connector" | "plugin";

type PluginDisplayEntry = {
  catalog: PluginCatalogEntry;
  connectorGroup?: ConnectorOverviewGroup;
  dataShapePlugin?: ProjectDataShapePluginManifest;
};

function formatConnectorTimestamp(timestamp?: number) {
  return timestamp ? new Date(timestamp).toLocaleString() : "Never";
}

function prettifySummaryKey(key: string) {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function localCatalogEntry(
  plugin:
    | ConnectorPluginManifest
    | ProjectDataShapePluginManifest,
  type: PluginCatalogEntry["type"],
): PluginCatalogEntry {
  return {
    schemaVersion: 1,
    id: plugin.id,
    type,
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
    capabilities:
      type === "connector"
        ? ["work-item-sync"]
        : ["project-data-shape"],
    tags: [type === "connector" ? "connector" : "data-shape"],
  };
}

function PluginCatalogCard({
  entry,
  canDownload,
  pluginsEnabled,
  isMutating,
  onDownload,
  onEnabledChange,
}: {
  entry: PluginDisplayEntry;
  canDownload: boolean;
  pluginsEnabled: boolean;
  isMutating: boolean;
  onDownload: () => void;
  onEnabledChange: (enabled: boolean) => void;
}) {
  const { catalog, connectorGroup, dataShapePlugin } = entry;
  const installed = Boolean(connectorGroup || dataShapePlugin);
  const version = connectorGroup?.plugin.version ?? dataShapePlugin?.version;
  const statusLabel = installed
    ? "Installed"
    : catalog.status === "coming-soon"
      ? "Coming soon"
      : catalog.status === "deprecated"
        ? "Deprecated"
        : "Available";

  return (
    <AppPanel className="group min-h-32 flex-col items-stretch gap-3 p-4 transition-colors hover:bg-[var(--surface-high)] sm:flex-row sm:items-start">
      <Link
        to="/settings/plugins/$pluginId"
        params={{ pluginId: catalog.id }}
        className="flex w-full min-w-0 flex-1 items-start gap-3 rounded-[var(--control-radius)] outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
        aria-label={`View ${catalog.title}`}
      >
        <PluginIdentityMark
          entry={catalog}
          iconSvg={connectorGroup?.plugin.iconSvg ?? dataShapePlugin?.iconSvg}
        />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-foreground">
            {catalog.title}
          </span>
          <span className="mt-1 line-clamp-2 block text-sm leading-5 text-muted-foreground">
            {catalog.description}
          </span>
          <span className="mt-3 flex flex-wrap gap-2">
            <Badge variant="outline">
              {catalog.type === "connector" ? "Connector" : "Plugin"}
            </Badge>
            <Badge variant={installed ? "secondary" : "outline"}>
              {statusLabel}
            </Badge>
            {version ? <Badge variant="outline">v{version}</Badge> : null}
          </span>
        </span>
      </Link>
      {connectorGroup ? (
        <Switch
          className="self-end sm:self-auto"
          checked={connectorGroup.enabled}
          disabled={
            isMutating ||
            !pluginsEnabled ||
            connectorGroup.plugin.entrypoint.length === 0
          }
          aria-label={`${connectorGroup.enabled ? "Deactivate" : "Activate"} ${catalog.title}`}
          onCheckedChange={onEnabledChange}
        />
      ) : !installed && catalog.status === "available" ? (
        <Button
          className="w-full sm:w-auto"
          size="sm"
          variant="outline"
          disabled={!canDownload || isMutating || catalog.type !== "connector"}
          title={
            catalog.type !== "connector"
              ? "Packaged schema-plugin installation is not available in this Ajour version."
              : !canDownload
                ? "Downloads are available in the production desktop app."
                : undefined
          }
          aria-label={`Download ${catalog.title}`}
          onClick={onDownload}
        >
          <Download data-icon="inline-start" />
          Download
        </Button>
      ) : null}
    </AppPanel>
  );
}

function PluginsHeader({
  canInstall,
  isMutating,
  onInstall,
  filter,
  onFilterChange,
  pluginsEnabled,
  refreshMinutes,
  canConfigureRefresh,
  onPluginsEnabledChange,
  onRefreshMinutesChange,
  children,
}: {
  canInstall: boolean;
  isMutating: boolean;
  onInstall: () => void;
  filter: PluginCatalogFilter;
  onFilterChange: (filter: PluginCatalogFilter) => void;
  pluginsEnabled: boolean;
  refreshMinutes: PluginCatalogSettings["refreshMinutes"];
  canConfigureRefresh: boolean;
  onPluginsEnabledChange: (enabled: boolean) => void;
  onRefreshMinutesChange: (
    refreshMinutes: PluginCatalogSettings["refreshMinutes"],
  ) => void;
  children: ReactNode;
}) {
  return (
    <Tabs
      value={filter}
      onValueChange={(value) => onFilterChange(value as PluginCatalogFilter)}
      className="contents"
    >
      <section className="settings-section gap-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-lg font-semibold text-foreground">Plugins</h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Discover extensions, download the ones you need, then activate and
              configure them locally.
            </p>
          </div>
          {canInstall ? (
            <Button
              size="sm"
              disabled={isMutating}
              onClick={onInstall}
            >
              <Upload data-icon="inline-start" />
              Install from file
            </Button>
          ) : null}
        </div>

        <TabsList
          variant="line"
          aria-label="Filter plugins"
          className="border-b border-border/70"
        >
          <TabsTrigger value="all">All</TabsTrigger>
          <TabsTrigger value="connector">Connectors</TabsTrigger>
          <TabsTrigger value="plugin">Plugins</TabsTrigger>
        </TabsList>

        <div className="flex flex-col gap-3 border-y border-border/60 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center justify-between gap-4 sm:justify-start">
            <div>
              <p className="text-sm font-medium text-foreground">Plugin system</p>
              <p className="text-xs text-muted-foreground">
                Deactivating pauses every installed plugin without removing its data.
              </p>
            </div>
            <Switch
              checked={pluginsEnabled}
              disabled={isMutating}
              aria-label={`${pluginsEnabled ? "Deactivate" : "Activate"} all plugins`}
              onCheckedChange={onPluginsEnabledChange}
            />
          </div>
          <label className="flex items-center justify-between gap-3 text-xs text-muted-foreground sm:justify-end">
            Refresh catalog
            <NativeSelect
              className="w-36"
              value={String(refreshMinutes)}
              disabled={!canConfigureRefresh}
              onChange={(event) =>
                onRefreshMinutesChange(
                  Number(event.target.value) as PluginCatalogSettings["refreshMinutes"],
                )
              }
            >
              <option value="0">At launch only</option>
              <option value="15">Every 15 min</option>
              <option value="30">Every 30 min</option>
              <option value="60">Every hour</option>
              <option value="240">Every 4 hours</option>
            </NativeSelect>
          </label>
        </div>
      </section>
      <TabsContent value={filter} className="contents">
        {children}
      </TabsContent>
    </Tabs>
  );
}

function PluginDetailHeader({
  entry,
  iconSvg,
  action,
  badges,
}: {
  entry: PluginCatalogEntry;
  iconSvg?: string;
  action?: ReactNode;
  badges: ReactNode;
}) {
  return (
    <>
      <Link
        to="/settings/plugins"
        className="inline-flex w-fit items-center gap-1.5 rounded-[var(--control-radius)] text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/30"
      >
        <ArrowLeft className="size-4" />
        All plugins
      </Link>
      <AppPanel as="section" className="gap-5 p-5">
        <div className="flex flex-col items-start gap-4 sm:flex-row">
          <PluginIdentityMark
            entry={entry}
            iconSvg={iconSvg}
            className="size-14"
          />
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-semibold text-foreground">{entry.title}</h1>
            <p className="mt-1 max-w-2xl text-sm leading-5 text-muted-foreground">
              {entry.description}
            </p>
            <p className="mt-2 text-xs text-[var(--text-tertiary)]">
              {entry.author.name} · {entry.type === "connector" ? "Connector" : "Plugin"} · {entry.license.spdxId}
            </p>
          </div>
          {action ? <div className="w-full sm:w-auto">{action}</div> : null}
        </div>
        <div className="flex flex-wrap gap-2">{badges}</div>
      </AppPanel>
    </>
  );
}

export function SettingsPluginsPage({ pluginId }: { pluginId?: string }) {
  const state = useLocalState();
  const isDevelopmentBuild =
    window.timetrackerDesktop?.runtime?.developmentBuild === true;
  const canInstallConnectorPlugins = Boolean(
    window.timetrackerDesktop?.installConnectorPlugin,
  ) && !isDevelopmentBuild;
  const canUninstallConnectorPlugins = Boolean(
    window.timetrackerDesktop?.uninstallConnectorPlugin,
  ) && !isDevelopmentBuild;
  const canDownloadCatalogPlugins = Boolean(
    window.timetrackerDesktop?.downloadCatalogPlugin,
  ) && !isDevelopmentBuild;
  const [connectors, setConnectors] = useState<ConnectorsOverview | null>(
    getCachedConnectorsOverview,
  );
  const [catalog, setCatalog] = useState<PluginCatalogResponse | null>(null);
  const [catalogSettings, setCatalogSettings] = useState<PluginCatalogSettings>({
    refreshMinutes: 15,
  });
  const [dataShapePlugins, setDataShapePlugins] = useState<
    ProjectDataShapePluginManifest[]
  >([]);
  const [catalogFilter, setCatalogFilter] =
    useState<PluginCatalogFilter>("all");
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [connectorError, setConnectorError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isMutatingConnector, setIsMutatingConnector] = useState(false);
  const [formState, setFormState] = useState<ConnectorFormState | null>(null);

  const importedCountsByPlugin = useMemo(
    () =>
      state.workItems.reduce<Record<string, number>>((counts, workItem) => {
        if (workItem.source === "manual") {
          return counts;
        }

        counts[workItem.source] = (counts[workItem.source] ?? 0) + 1;
        return counts;
      }, {}),
    [state.workItems],
  );

  const refreshConnectors = async () => {
    try {
      const overview = await getConnectorsOverview();
      setConnectors(overview);
      setConnectorError(null);
    } catch (error) {
      setConnectorError(
        error instanceof Error
          ? error.message
          : "Unable to reach the app API.",
      );
    }
  };

  const refreshCatalog = async () => {
    try {
      const nextCatalog = await getPluginCatalog();
      setCatalog(nextCatalog);
      setCatalogError(null);
    } catch (error) {
      setCatalogError(
        error instanceof Error
          ? error.message
          : "Unable to load the plugin catalog.",
      );
    }
  };

  const refreshDataShapePlugins = async () => {
    try {
      setDataShapePlugins(await getProjectDataShapePlugins());
    } catch {
      setDataShapePlugins([]);
    }
  };

  useEffect(() => {
    if (!getCachedConnectorsOverview()) {
      void refreshConnectors();
    }
    void refreshCatalog();
    void refreshDataShapePlugins();
    void getPluginCatalogSettings().then(setCatalogSettings);
    const unsubscribe = window.timetrackerDesktop?.onPluginCatalogUpdated?.(
      (nextCatalog) => setCatalog(nextCatalog),
    );
    return unsubscribe;
  }, []);

  const connectorGroups = connectors?.connectionGroups ?? [];
  const displayEntries = useMemo(() => {
    const entries = new Map<string, PluginDisplayEntry>(
      (catalog?.entries ?? []).map((entry) => [
        entry.id,
        { catalog: entry },
      ]),
    );

    for (const group of connectorGroups) {
      const current = entries.get(group.plugin.id);
      entries.set(group.plugin.id, {
        catalog:
          current?.catalog ?? localCatalogEntry(group.plugin, "connector"),
        connectorGroup: group,
        dataShapePlugin: current?.dataShapePlugin,
      });
    }
    for (const plugin of dataShapePlugins) {
      const current = entries.get(plugin.id);
      entries.set(plugin.id, {
        catalog: current?.catalog ?? localCatalogEntry(plugin, "plugin"),
        connectorGroup: current?.connectorGroup,
        dataShapePlugin: plugin,
      });
    }

    return Array.from(entries.values()).sort((left, right) =>
      left.catalog.title.localeCompare(right.catalog.title),
    );
  }, [catalog?.entries, connectorGroups, dataShapePlugins]);
  const filteredDisplayEntries = displayEntries.filter(
    (entry) =>
      catalogFilter === "all" || entry.catalog.type === catalogFilter,
  );
  const pluginsById = useMemo(
    () =>
      new Map(
        (connectors?.plugins ?? []).map(
          (plugin) => [plugin.id, plugin] as const,
        ),
      ),
    [connectors?.plugins],
  );
  const activePlugin = formState
    ? connectorGroups.find((group) => group.plugin.id === formState.pluginId)
        ?.plugin ?? pluginsById.get(formState.pluginId)
    : undefined;
  const isFormDirty =
    formState && activePlugin
      ? !areConnectorFormValuesEqual(
          activePlugin,
          formState.values,
          formState.initialValues,
        )
      : false;

  const handlePluginActivation = async (
    group: ConnectorOverviewGroup,
    enabled: boolean,
  ) => {
    setIsMutatingConnector(true);
    setStatusMessage(null);
    setConnectorError(null);
    try {
      const overview = await setConnectorPluginEnabled(
        group.plugin.id,
        enabled,
      );
      setConnectors(overview);
      setStatusMessage(
        `${group.plugin.displayName} ${enabled ? "activated" : "deactivated"}.`,
      );
    } catch (error) {
      setConnectorError(
        error instanceof Error
          ? error.message
          : "Unable to update the connector plugin.",
      );
    } finally {
      setIsMutatingConnector(false);
    }
  };

  const handleCreate = (plugin: ConnectorPluginManifest) => {
    const initialValues = buildConnectorFormValues(plugin);
    setConnectorError(null);
    setStatusMessage(null);
    setFormState({
      pluginId: plugin.id,
      editingConnectionId: null,
      initialValues,
      values: initialValues,
    });
  };

  const handleEdit = (
    plugin: ConnectorPluginManifest,
    connection: ConnectorConnectionSummary,
  ) => {
    const initialValues = buildConnectorFormValues(
      plugin,
      connection.editableValues,
    );
    setConnectorError(null);
    setStatusMessage(null);
    setFormState({
      pluginId: plugin.id,
      editingConnectionId: connection.id,
      initialValues,
      values: initialValues,
    });
  };

  const handleSave = async () => {
    if (!formState || !activePlugin) {
      return;
    }

    setIsMutatingConnector(true);
    setStatusMessage(null);
    setConnectorError(null);
    try {
      const result = await saveConnectorConnection(
        formState.pluginId,
        normalizeConnectorFormValuesForSave(activePlugin, formState.values, {
          allowSavedSecrets: Boolean(formState.editingConnectionId),
        }),
        formState.editingConnectionId ?? undefined,
      );
      setConnectors(result.overview);
      setStatusMessage(
        formState.editingConnectionId
          ? `${result.connection.label} connection updated.`
          : `${result.connection.label} connection added.`,
      );
      setFormState(null);
    } catch (error) {
      setConnectorError(
        error instanceof Error
          ? error.message
          : "Unable to save the connector connection.",
      );
    } finally {
      setIsMutatingConnector(false);
    }
  };

  const handleDelete = async (pluginId: string, connectionId: string) => {
    setIsMutatingConnector(true);
    setStatusMessage(null);
    setConnectorError(null);
    try {
      const overview = await deleteConnectorConnection(pluginId, connectionId);
      setConnectors(overview);
      if (
        formState?.editingConnectionId === connectionId &&
        formState.pluginId === pluginId
      ) {
        setFormState(null);
      }
      setStatusMessage("Connection removed.");
    } catch (error) {
      setConnectorError(
        error instanceof Error
          ? error.message
          : "Unable to delete the connector connection.",
      );
    } finally {
      setIsMutatingConnector(false);
    }
  };

  const handleSync = async (pluginId: string, connectionId: string) => {
    setIsMutatingConnector(true);
    setStatusMessage(null);
    setConnectorError(null);
    try {
      const result = await syncConnectorConnection(pluginId, connectionId);
      await refreshConnectors();
      const conflictCount = result.workItemUpdates.reduce(
        (sum, workItem) =>
          sum +
          Object.values(workItem.fields).filter(
            (field) => field?.status === "conflict",
          ).length,
        0,
      );
      setStatusMessage(
        result.mode === "backlog"
          ? [
              result.connection.label,
              `${result.backlogImportedCount} imported`,
              `${result.backlogUpdatedCount} updated`,
              ...(conflictCount > 0
                ? [
                    `${conflictCount} conflict${conflictCount === 1 ? "" : "s"}`,
                  ]
                : []),
            ].join(" · ")
          : [
              result.connection.label,
              `${result.stagedCount} staged`,
              `${result.updatedCount} refreshed`,
              `${result.skippedCount} skipped`,
              ...(conflictCount > 0
                ? [
                    `${conflictCount} conflict${conflictCount === 1 ? "" : "s"}`,
                  ]
                : []),
            ].join(" · "),
      );
    } catch (error) {
      setConnectorError(
        error instanceof Error
          ? error.message
          : "Unable to sync connector items.",
      );
    } finally {
      setIsMutatingConnector(false);
    }
  };

  const handleInstallPlugin = async () => {
    setIsMutatingConnector(true);
    setStatusMessage(null);
    setConnectorError(null);
    try {
      const result = await installConnectorPlugin();
      if (!result) {
        return;
      }
      setConnectors(result.overview);
      setStatusMessage(
        result.replaced
          ? `${result.plugin.displayName} ${result.plugin.version} replaced the installed plugin.`
          : `${result.plugin.displayName} ${result.plugin.version} installed.`,
      );
    } catch (error) {
      setConnectorError(
        error instanceof Error
          ? error.message
          : "Unable to install the connector plugin.",
      );
    } finally {
      setIsMutatingConnector(false);
    }
  };

  const handlePluginSystemActivation = async (enabled: boolean) => {
    setIsMutatingConnector(true);
    setStatusMessage(null);
    setConnectorError(null);
    try {
      const overview = await setPluginSystemEnabled(enabled);
      setConnectors(overview);
      if (enabled) {
        await refreshDataShapePlugins();
      }
      setStatusMessage(
        enabled
          ? "Plugins enabled. Each plugin has returned to its previous activation state."
          : "Plugins deactivated. Sync and plugin-provided schemas are paused.",
      );
    } catch (error) {
      setConnectorError(
        error instanceof Error
          ? error.message
          : "Unable to update the plugin system.",
      );
    } finally {
      setIsMutatingConnector(false);
    }
  };

  const handleCatalogRefreshInterval = async (refreshMinutes: number) => {
    const parsedMinutes = [0, 15, 30, 60, 240].includes(refreshMinutes)
      ? (refreshMinutes as PluginCatalogSettings["refreshMinutes"])
      : 15;
    try {
      setCatalogSettings(
        await configurePluginCatalog({ refreshMinutes: parsedMinutes }),
      );
      setStatusMessage(
        parsedMinutes === 0
          ? "Catalog will refresh at app launch only."
          : `Catalog refresh set to every ${parsedMinutes} minutes.`,
      );
    } catch (error) {
      setConnectorError(
        error instanceof Error
          ? error.message
          : "Unable to update catalog refresh settings.",
      );
    }
  };

  const handleDownloadPlugin = async (entry: PluginCatalogEntry) => {
    setIsMutatingConnector(true);
    setStatusMessage(null);
    setConnectorError(null);
    try {
      const downloaded = await downloadCatalogPlugin(entry.id);
      setConnectors(downloaded.result.overview);
      setStatusMessage(
        `${downloaded.result.plugin.displayName} ${downloaded.result.plugin.version} downloaded. Activate it when you are ready to configure it.`,
      );
    } catch (error) {
      setConnectorError(
        error instanceof Error
          ? error.message
          : "Unable to download the plugin.",
      );
    } finally {
      setIsMutatingConnector(false);
    }
  };

  const handleUninstallPlugin = async (group: ConnectorOverviewGroup) => {
    setIsMutatingConnector(true);
    setStatusMessage(null);
    setConnectorError(null);
    try {
      const result = await uninstallConnectorPlugin(group.plugin.id);
      setConnectors(result.overview);
      setFormState(null);
      setStatusMessage(
        `${group.plugin.displayName} uninstalled. Imported backlog items were preserved.`,
      );
    } catch (error) {
      setConnectorError(
        error instanceof Error
          ? error.message
          : "Unable to uninstall the connector plugin.",
      );
    } finally {
      setIsMutatingConnector(false);
    }
  };

  const renderMessages = () => (
    <>
      {statusMessage ? <MessagePanel>{statusMessage}</MessagePanel> : null}
      {connectorError ? (
        <MessagePanel tone="warning">{connectorError}</MessagePanel>
      ) : null}
      {catalog?.warning ? (
        <MessagePanel tone="warning">
          The catalog was loaded from its local cache. Artwork and metadata will
          refresh when the index is reachable.
        </MessagePanel>
      ) : null}
      {catalogError ? (
        <MessagePanel tone="warning">{catalogError}</MessagePanel>
      ) : null}
    </>
  );

  const renderConnectorDetail = (
    entry: PluginCatalogEntry,
    group: ConnectorOverviewGroup,
  ) => {
    const groupFormState =
      formState?.pluginId === group.plugin.id ? formState : null;

    return (
      <>
        <PluginDetailHeader
          entry={entry}
          iconSvg={group.plugin.iconSvg}
          action={
            <div className="flex w-full items-center justify-between gap-3 sm:w-auto sm:justify-end">
              <span className="text-sm text-muted-foreground">
                {group.enabled ? "Active" : "Inactive"}
              </span>
              <Switch
                checked={group.enabled}
                disabled={
                  isMutatingConnector ||
                  connectors?.pluginsEnabled === false ||
                  group.plugin.entrypoint.length === 0
                }
                aria-label={`${group.enabled ? "Deactivate" : "Activate"} ${entry.title}`}
                onCheckedChange={(enabled) =>
                  void handlePluginActivation(group, enabled)
                }
              />
            </div>
          }
          badges={
            <>
              <Badge variant="secondary">Installed</Badge>
              <Badge variant={group.enabled ? "secondary" : "outline"}>
                {group.enabled ? "Active" : "Inactive"}
              </Badge>
              <Badge variant="outline">Version {group.plugin.version}</Badge>
              <Badge variant="outline">
                {group.connections.length} connection
                {group.connections.length === 1 ? "" : "s"}
              </Badge>
              <Badge variant="outline">
                {importedCountsByPlugin[group.plugin.id] ?? 0} backlog items
              </Badge>
            </>
          }
        />
        {renderMessages()}

        <PluginCapabilityBand entry={entry} />

        <section className="settings-section">
          <h2 className="settings-section-title">Capabilities</h2>
          <PluginCapabilityList entry={entry} />
        </section>

        <section className="settings-section">
          <h2 className="settings-section-title">Information</h2>
          <PluginInfoLedger entry={entry} version={group.plugin.version} />
        </section>

        {connectors?.pluginsEnabled === false ? (
          <MessagePanel tone="warning">
            The plugin system is deactivated. All plugin execution and sync are
            paused until you enable it from the Plugins catalog.
          </MessagePanel>
        ) : !group.enabled ? (
          <MessagePanel>
            This plugin is inactive. Its saved connections and imported data are
            preserved, but sync is paused until you reactivate it.
          </MessagePanel>
        ) : null}

        <section className="settings-section">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="settings-section-title">Configuration</h3>
              <p className="settings-section-desc mt-1">
                Manage the local connections used by this plugin.
              </p>
            </div>
            <Button
              size="sm"
              disabled={
                isMutatingConnector || connectors?.pluginsEnabled === false
              }
              onClick={() => handleCreate(group.plugin)}
            >
              Add a connection
            </Button>
          </div>

          {groupFormState ? (
            <AppPanel className="gap-5 p-5">
              <div>
                <h4 className="text-sm font-semibold text-foreground">
                  {groupFormState.editingConnectionId
                    ? `Edit ${group.plugin.displayName} connection`
                    : `New ${group.plugin.displayName} connection`}
                </h4>
                <p className="mt-1 text-sm text-muted-foreground">
                  {groupFormState.editingConnectionId
                    ? "Update this connection without re-entering unchanged secrets."
                    : "The connection is validated by the plugin and stored locally."}
                </p>
              </div>
              <FieldGroup className="md:grid md:grid-cols-2 md:gap-x-6 md:gap-y-5">
                {group.plugin.connectionFields.map((field) => {
                  if (
                    field.id === "autoSyncIntervalMinutes" &&
                    groupFormState.values.autoSync !== true
                  ) {
                    return null;
                  }

                  return (
                    <ConnectorFieldInput
                      key={field.id}
                      field={field}
                      value={groupFormState.values[field.id]}
                      onChange={(nextValue) =>
                        setFormState((current) =>
                          current
                            ? {
                                ...current,
                                values: {
                                  ...current.values,
                                  [field.id]: nextValue,
                                },
                              }
                            : current,
                        )
                      }
                    />
                  );
                })}
              </FieldGroup>
              <Separator />
              <div className="flex flex-wrap justify-end gap-3">
                <Button
                  variant="outline"
                  disabled={isMutatingConnector}
                  onClick={() => setFormState(null)}
                >
                  Cancel
                </Button>
                <Button
                  disabled={
                    isMutatingConnector ||
                    !isFormDirty ||
                    !canSubmitConnectorForm(
                      activePlugin,
                      groupFormState.values,
                      {
                        allowSavedSecrets: Boolean(
                          groupFormState.editingConnectionId,
                        ),
                      },
                    )
                  }
                  onClick={() => void handleSave()}
                >
                  {groupFormState.editingConnectionId
                    ? "Update connection"
                    : "Add connection"}
                </Button>
              </div>
            </AppPanel>
          ) : null}

          {group.connections.length === 0 ? (
            <AppPanel>
              <Empty className="border border-dashed border-border/70 bg-muted/10 py-10">
                <EmptyHeader>
                  <EmptyTitle>No connections yet</EmptyTitle>
                  <EmptyDescription>
                    Add a {group.plugin.displayName} connection to configure its
                    source and sync behavior.
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            </AppPanel>
          ) : (
            <div className="grid gap-3 lg:grid-cols-2">
              {group.connections.map((connection) => (
                <Card
                  key={connection.id}
                  size="sm"
                  className="rounded-lg shadow-none ring-1 ring-border/70"
                >
                  <CardHeader className="rounded-t-lg">
                    <div>
                      <CardTitle className="font-sans tracking-normal">
                        {connection.label}
                      </CardTitle>
                      <CardDescription>{connection.tenantLabel}</CardDescription>
                    </div>
                    <CardAction>
                      <Badge
                        variant={
                          connection.lastError ? "destructive" : "outline"
                        }
                      >
                        {connection.autoSync
                          ? `Auto every ${connection.autoSyncIntervalMinutes} min`
                          : "Stage for review"}
                      </Badge>
                    </CardAction>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-4">
                    <div className="flex flex-col gap-1 text-sm text-muted-foreground">
                      {Object.entries(connection.configSummary).map(
                        ([key, value]) => (
                          <span key={key}>
                            {prettifySummaryKey(key)}: {String(value)}
                          </span>
                        ),
                      )}
                      <span>
                        Last sync: {formatConnectorTimestamp(connection.lastSyncAt)}
                      </span>
                      {!connection.autoSync ? (
                        <span>
                          {connection.pendingImportCount} staged ·{" "}
                          {connection.selectedImportCount} selected
                        </span>
                      ) : null}
                    </div>
                    <p
                      className={cn(
                        "text-sm text-muted-foreground",
                        connection.lastError && "text-destructive",
                      )}
                    >
                      {connection.lastError ??
                        (group.enabled
                          ? connection.autoSync
                            ? "Connection ready to sync directly into backlog."
                            : "Connection ready to stage imports."
                          : "Plugin inactive; this connection will not sync.")}
                    </p>
                  </CardContent>
                  <CardFooter className="rounded-b-lg border-t border-border/60">
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={isMutatingConnector}
                        onClick={() => handleEdit(group.plugin, connection)}
                      >
                        <Pencil data-icon="inline-start" />
                        Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={
                          isMutatingConnector ||
                          connectors?.pluginsEnabled === false ||
                          !group.enabled
                        }
                        onClick={() =>
                          void handleSync(group.plugin.id, connection.id)
                        }
                      >
                        <RefreshCw data-icon="inline-start" />
                        Sync
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        disabled={isMutatingConnector}
                        onClick={() =>
                          void handleDelete(group.plugin.id, connection.id)
                        }
                      >
                        <Trash2 data-icon="inline-start" />
                        Remove
                      </Button>
                    </div>
                  </CardFooter>
                </Card>
              ))}
            </div>
          )}
        </section>

        {canUninstallConnectorPlugins ? (
          <section className="settings-section">
            <h3 className="settings-section-title">Uninstall plugin</h3>
            <p className="settings-section-desc">
              Remove the plugin package and its saved connections from this
              device. Imported backlog items will remain available.
            </p>
            <AppPanel className="flex-row items-center justify-between gap-4 border-destructive/30">
              <p className="text-sm text-muted-foreground">
                Deactivate the plugin instead if you want to keep its
                configuration for later.
              </p>
              <AlertDialog>
                <AlertDialogTrigger
                  render={
                    <Button
                      variant="destructive"
                      disabled={isMutatingConnector}
                    />
                  }
                >
                  <Trash2 data-icon="inline-start" />
                  Uninstall
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>
                      Uninstall {group.plugin.displayName}?
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                      This removes the plugin package, saved connections,
                      credentials, staged imports, and connector statuses.
                      Already imported backlog items are preserved.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      variant="destructive"
                      disabled={isMutatingConnector}
                      onClick={() => void handleUninstallPlugin(group)}
                    >
                      Uninstall plugin
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </AppPanel>
          </section>
        ) : null}
      </>
    );
  };

  const renderCatalogDetail = (entry: PluginDisplayEntry) => {
    const { catalog: catalogEntry, dataShapePlugin } = entry;
    const installed = Boolean(dataShapePlugin);
    const available = catalogEntry.status === "available";
    const canDownloadThisEntry =
      available && catalogEntry.type === "connector" && canDownloadCatalogPlugins;

    return (
      <>
        <PluginDetailHeader
          entry={catalogEntry}
          iconSvg={dataShapePlugin?.iconSvg}
          action={
            installed ? (
              <Button
                variant="outline"
                render={<Link to="/settings/projects" />}
              >
                Use in Projects
              </Button>
            ) : available ? (
              <Button
                className="w-full sm:w-auto"
                disabled={!canDownloadThisEntry || isMutatingConnector}
                title={
                  catalogEntry.type !== "connector"
                    ? "Packaged schema-plugin installation is not available in this Ajour version."
                    : !canDownloadCatalogPlugins
                      ? "Downloads are available in the production desktop app."
                      : undefined
                }
                onClick={() => void handleDownloadPlugin(catalogEntry)}
              >
                <Download data-icon="inline-start" />
                Download
              </Button>
            ) : (
              <Button className="w-full sm:w-auto" variant="outline" disabled>
                {catalogEntry.status === "coming-soon"
                  ? "Coming soon"
                  : "Unavailable"}
              </Button>
            )
          }
          badges={
            <>
              <Badge variant={installed ? "secondary" : "outline"}>
                {installed
                  ? "Installed"
                  : catalogEntry.status === "coming-soon"
                    ? "Coming soon"
                    : catalogEntry.status === "deprecated"
                      ? "Deprecated"
                      : "Available"}
              </Badge>
              <Badge variant="outline">
                {catalogEntry.type === "connector" ? "Connector" : "Plugin"}
              </Badge>
              <Badge variant="outline">
                Plugin API {catalogEntry.compatibility.pluginApiVersion}
              </Badge>
              {dataShapePlugin ? (
                <Badge variant="outline">Version {dataShapePlugin.version}</Badge>
              ) : null}
            </>
          }
        />
        {renderMessages()}
        <PluginCapabilityBand entry={catalogEntry} />

        <section className="settings-section">
          <h2 className="settings-section-title">Capabilities</h2>
          <PluginCapabilityList entry={catalogEntry} />
        </section>

        <section className="settings-section">
          <h2 className="settings-section-title">Information</h2>
          <PluginInfoLedger
            entry={catalogEntry}
            version={dataShapePlugin?.version}
          />
        </section>

        {catalogEntry.status === "coming-soon" ? (
          <MessagePanel>
            {catalogEntry.title} is listed in the Ajour plugin index, but no
            installable release is available yet.
          </MessagePanel>
        ) : installed ? (
          <MessagePanel>
            This plugin is installed. Select its schema under Projects settings
            to use it for import and export.
          </MessagePanel>
        ) : null}
      </>
    );
  };

  const selectedDisplayEntry = pluginId
    ? displayEntries.find((entry) => entry.catalog.id === pluginId)
    : undefined;

  if (pluginId) {
    return (
      <div className="settings-sections gap-6">
        {selectedDisplayEntry?.connectorGroup
          ? renderConnectorDetail(
              selectedDisplayEntry.catalog,
              selectedDisplayEntry.connectorGroup,
            )
          : selectedDisplayEntry
            ? renderCatalogDetail(selectedDisplayEntry)
            : catalog === null || connectors === null
              ? (
                  <>
                    <Link
                      to="/settings/plugins"
                      className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground"
                    >
                      <ArrowLeft className="size-4" />
                      All plugins
                    </Link>
                    {renderMessages()}
                    <MessagePanel>Loading plugin…</MessagePanel>
                  </>
                )
              : (
                  <>
                    <Link
                      to="/settings/plugins"
                      className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground"
                    >
                      <ArrowLeft className="size-4" />
                      All plugins
                    </Link>
                    {renderMessages()}
                    <MessagePanel tone="warning">
                      That plugin is not present in the Ajour index or installed
                      on this device.
                    </MessagePanel>
                  </>
                )}
      </div>
    );
  }

  return (
    <div className="settings-sections gap-6">
      <PluginsHeader
        canInstall={canInstallConnectorPlugins}
        isMutating={isMutatingConnector}
        onInstall={() => void handleInstallPlugin()}
        filter={catalogFilter}
        onFilterChange={setCatalogFilter}
        pluginsEnabled={connectors?.pluginsEnabled ?? true}
        refreshMinutes={catalogSettings.refreshMinutes}
        canConfigureRefresh={Boolean(
          window.timetrackerDesktop?.configurePluginCatalog,
        )}
        onPluginsEnabledChange={(enabled) =>
          void handlePluginSystemActivation(enabled)
        }
        onRefreshMinutesChange={(refreshMinutes) =>
          void handleCatalogRefreshInterval(refreshMinutes)
        }
      >
        <>
          {renderMessages()}
          <section className="settings-section">
            {filteredDisplayEntries.length > 0 ? (
              <div className="grid gap-3 md:grid-cols-2">
                {filteredDisplayEntries.map((entry) => (
                  <PluginCatalogCard
                    key={entry.catalog.id}
                    entry={entry}
                    canDownload={canDownloadCatalogPlugins}
                    pluginsEnabled={connectors?.pluginsEnabled ?? true}
                    isMutating={isMutatingConnector}
                    onDownload={() => void handleDownloadPlugin(entry.catalog)}
                    onEnabledChange={(enabled) =>
                      entry.connectorGroup
                        ? void handlePluginActivation(entry.connectorGroup, enabled)
                        : undefined
                    }
                  />
                ))}
              </div>
            ) : catalog || connectors ? (
              <Empty className="border border-dashed border-border/70 bg-muted/10 py-10">
                <EmptyHeader>
                  <EmptyTitle>No matching plugins</EmptyTitle>
                  <EmptyDescription>
                    Choose another category or install a compatible plugin from
                    a local file.
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : null}
            {catalog === null && connectors === null && !connectorError ? (
              <MessagePanel>Loading plugins…</MessagePanel>
            ) : null}
          </section>

          <p className="text-xs text-muted-foreground">
            Plugin runtime: {getAppApiDescription()}
            {getAppApiDescription() !== getAppApiBaseUrl()
              ? ` · ${getAppApiBaseUrl()}`
              : ""}
            {catalog
              ? ` · Catalog checked ${new Date(catalog.checkedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
              : ""}
            {!canInstallConnectorPlugins
              ? " · Downloads and packaged installation are available in the desktop app."
              : ""}
          </p>
        </>
      </PluginsHeader>
    </div>
  );
}
