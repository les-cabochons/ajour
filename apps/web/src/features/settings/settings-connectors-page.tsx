import { useMemo, useState, type ReactNode } from "react";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getAppApiBaseUrl, getAppApiDescription } from "@/lib/app-api";
import { usePluginSettingsWorkflow } from "./use-plugin-settings-workflow";
import type { PluginDisplayEntry } from "./plugin-settings-workflow";
import { useLocalState } from "@/lib/local-hooks";
import { cn } from "@/lib/utils";
import type {
  ConnectorConnectionSummary,
  ConnectorFieldValues,
  ConnectorOverviewGroup,
  ConnectorPluginManifest,
  PluginCatalogCapability,
  PluginCatalogEntry,
  PluginCatalogSettings,
} from "@ajour/shared";
import { pluginHasConnector } from "@ajour/shared";
import {
  areConnectorFormValuesEqual,
  buildConnectorFormValues,
  canSubmitConnectorForm,
  normalizeConnectorFormValuesForSave,
} from "./connector-form-state";
import { ConnectorFieldInput } from "./connector-settings-ui";
import {
  canInstallCatalogPlugin,
  PluginCapabilityBand,
  PluginCapabilityList,
  PluginIdentityMark,
  PluginInfoList,
  pluginCapabilitiesLabel,
} from "./plugin-catalog-ui";

type ConnectorFormState = {
  pluginId: string;
  editingConnectionId: string | null;
  initialValues: ConnectorFieldValues;
  values: ConnectorFieldValues;
};

type PluginCatalogFilter = "all" | PluginCatalogCapability;

/** The one notice Plugins shows when the web build runs without the connector API. */
const CONNECTORS_NEED_DESKTOP_APP = "Connectors need the desktop app.";

function formatConnectorTimestamp(timestamp?: number) {
  return timestamp ? new Date(timestamp).toLocaleString() : "Never";
}

function prettifySummaryKey(key: string) {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());
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
    <AppPanel className="group min-h-32 flex-col items-stretch gap-3 p-4 transition-colors hover:bg-[var(--surface-high)] desktop:flex-row desktop:items-start">
      <Link
        to="/settings/plugins/$pluginId"
        params={{ pluginId: catalog.id }}
        replace
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
            <Badge variant="outline">{pluginCapabilitiesLabel(catalog)}</Badge>
            <Badge variant={installed ? "secondary" : "outline"}>
              {statusLabel}
            </Badge>
            {version ? <Badge variant="outline">v{version}</Badge> : null}
          </span>
        </span>
      </Link>
      {connectorGroup ? (
        <Switch
          className="self-end desktop:self-auto"
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
          className="w-full desktop:w-auto"
          size="sm"
          variant="outline"
          disabled={
            !canDownload || isMutating || !canInstallCatalogPlugin(catalog)
          }
          title={
            !canInstallCatalogPlugin(catalog)
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
            <Button size="sm" disabled={isMutating} onClick={onInstall}>
              <Upload data-icon="inline-start" />
              Install from file
            </Button>
          ) : null}
        </div>

        <TabsList
          variant="line"
          aria-label="Filter plugins"
          className="max-w-full gap-0 border-b border-border/70 p-0 desktop:gap-1 desktop:p-1"
        >
          <TabsTrigger value="all" className="px-1.5 desktop:px-3">
            All
          </TabsTrigger>
          <TabsTrigger value="connector" className="px-1.5 desktop:px-3">
            Connectors
          </TabsTrigger>
          <TabsTrigger value="codeHost" className="px-1.5 desktop:px-3">
            Code hosts
          </TabsTrigger>
          <TabsTrigger value="schema" className="px-1.5 desktop:px-3">
            Schemas
          </TabsTrigger>
        </TabsList>

        <div className="flex flex-col gap-3 border-y border-border/60 py-3 desktop:flex-row desktop:items-center desktop:justify-between">
          <div className="flex min-w-0 items-center justify-between gap-4 desktop:justify-start">
            <div>
              <p className="text-sm font-medium text-foreground">
                Plugin system
              </p>
              <p className="text-xs text-muted-foreground">
                Deactivating pauses every installed plugin without removing its
                data.
              </p>
            </div>
            <Switch
              checked={pluginsEnabled}
              disabled={isMutating}
              aria-label={`${pluginsEnabled ? "Deactivate" : "Activate"} all plugins`}
              onCheckedChange={onPluginsEnabledChange}
            />
          </div>
          <label className="flex items-center justify-between gap-3 text-xs text-muted-foreground desktop:justify-end">
            Refresh catalog
            <NativeSelect
              className="w-36"
              value={String(refreshMinutes)}
              disabled={!canConfigureRefresh}
              onChange={(event) =>
                onRefreshMinutesChange(
                  Number(
                    event.target.value,
                  ) as PluginCatalogSettings["refreshMinutes"],
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
        replace
        className="inline-flex w-fit items-center gap-1.5 rounded-[var(--control-radius)] text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/30"
      >
        <ArrowLeft className="size-4" />
        All plugins
      </Link>
      <AppPanel as="section" className="gap-5 p-5">
        <div className="flex flex-col items-start gap-4 desktop:flex-row">
          <PluginIdentityMark
            entry={entry}
            iconSvg={iconSvg}
            className="size-14"
          />
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-semibold text-foreground">
              {entry.title}
            </h1>
            <p className="mt-1 max-w-2xl text-sm leading-5 text-muted-foreground">
              {entry.description}
            </p>
            <p className="mt-2 text-xs text-[var(--text-tertiary)]">
              {entry.author.name} · {pluginCapabilitiesLabel(entry)} ·{" "}
              {entry.license.spdxId}
            </p>
          </div>
          {action ? (
            <div className="w-full desktop:w-auto">{action}</div>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">{badges}</div>
      </AppPanel>
    </>
  );
}

export function SettingsPluginsPage({ pluginId }: { pluginId?: string }) {
  const state = useLocalState();
  const isDevelopmentBuild =
    window.ajourDesktop?.runtime?.developmentBuild === true;
  const canInstallConnectorPlugins =
    Boolean(window.ajourDesktop?.installConnectorPlugin) && !isDevelopmentBuild;
  const canUninstallConnectorPlugins =
    Boolean(window.ajourDesktop?.uninstallConnectorPlugin) &&
    !isDevelopmentBuild;
  const canDownloadCatalogPlugins =
    Boolean(window.ajourDesktop?.downloadCatalogPlugin) && !isDevelopmentBuild;
  const {
    connectors,
    catalog,
    catalogSettings,
    displayEntries,
    catalogError,
    connectorError,
    connectorApiMissing,
    statusMessage,
    isMutatingConnector,
    workflow,
  } = usePluginSettingsWorkflow();
  const [catalogFilter, setCatalogFilter] =
    useState<PluginCatalogFilter>("all");
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

  const connectorGroups = connectors?.connectionGroups ?? [];
  const filteredDisplayEntries = displayEntries.filter(
    (entry) =>
      catalogFilter === "all" ||
      entry.catalog.capabilities.includes(catalogFilter),
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
    ? (connectorGroups.find((group) => group.plugin.id === formState.pluginId)
        ?.plugin ?? pluginsById.get(formState.pluginId))
    : undefined;
  const isFormDirty =
    formState && activePlugin
      ? !areConnectorFormValuesEqual(
          activePlugin,
          formState.values,
          formState.initialValues,
        )
      : false;

  const handlePluginActivation = (
    group: ConnectorOverviewGroup,
    enabled: boolean,
  ) => workflow.execute({ type: "activate", plugin: group.plugin, enabled });

  const handleCreate = (plugin: ConnectorPluginManifest) => {
    const initialValues = buildConnectorFormValues(plugin);
    workflow.clearFeedback();
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
    workflow.clearFeedback();
    setFormState({
      pluginId: plugin.id,
      editingConnectionId: connection.id,
      initialValues,
      values: initialValues,
    });
  };

  const handleSave = async () => {
    if (!formState || !activePlugin) return;
    const completed = await workflow.execute({
      type: "save",
      pluginId: formState.pluginId,
      values: normalizeConnectorFormValuesForSave(
        activePlugin,
        formState.values,
        {
          allowSavedSecrets: Boolean(formState.editingConnectionId),
        },
      ),
      connectionId: formState.editingConnectionId ?? undefined,
    });
    if (completed) setFormState(null);
  };

  const handleDelete = async (pluginId: string, connectionId: string) => {
    if (await workflow.execute({ type: "delete", pluginId, connectionId })) {
      if (
        formState?.editingConnectionId === connectionId &&
        formState.pluginId === pluginId
      ) {
        setFormState(null);
      }
    }
  };
  const handleDownloadPlugin = (entry: PluginCatalogEntry) =>
    workflow.execute({ type: "download", pluginId: entry.id });
  const handleUninstallPlugin = async (group: ConnectorOverviewGroup) => {
    if (await workflow.execute({ type: "uninstall", plugin: group.plugin }))
      setFormState(null);
  };

  const renderMessages = () =>
    connectorApiMissing ? (
      <MessagePanel>{CONNECTORS_NEED_DESKTOP_APP}</MessagePanel>
    ) : (
      <>
        {statusMessage ? <MessagePanel>{statusMessage}</MessagePanel> : null}
        {connectorError ? (
          <MessagePanel tone="warning">{connectorError}</MessagePanel>
        ) : null}
        {catalog?.warning ? (
          <MessagePanel tone="warning">
            The catalog was loaded from its local cache. Artwork and metadata
            will refresh when the index is reachable.
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
            <div className="flex w-full items-center justify-between gap-3 desktop:w-auto desktop:justify-end">
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
          <h2 className="settings-section-title">Features</h2>
          <PluginCapabilityList entry={entry} />
        </section>

        <section className="settings-section">
          <h2 className="settings-section-title">Information</h2>
          <PluginInfoList entry={entry} version={group.plugin.version} />
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
              <FieldGroup className="desktop:grid desktop:grid-cols-2 desktop:gap-x-6 desktop:gap-y-5">
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
            <div className="grid gap-3 desktop:grid-cols-2">
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
                      <CardDescription>
                        {connection.tenantLabel}
                      </CardDescription>
                    </div>
                    <CardAction>
                      <Badge
                        variant={
                          connection.lastError ? "destructive" : "outline"
                        }
                      >
                        {connection.autoSync
                          ? `Auto every ${connection.autoSyncIntervalMinutes} min`
                          : pluginHasConnector(group.plugin)
                            ? "Stage for review"
                            : "Manual sync"}
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
                        Last sync:{" "}
                        {formatConnectorTimestamp(connection.lastSyncAt)}
                      </span>
                      {connection.lastError ? (
                        <span className="text-destructive">
                          Last sync failed
                          {connection.lastErrorAt
                            ? `: ${formatConnectorTimestamp(connection.lastErrorAt)}`
                            : null}
                        </span>
                      ) : null}
                      {!connection.autoSync &&
                      pluginHasConnector(group.plugin) ? (
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
                        (!group.enabled
                          ? "Plugin inactive; this connection will not sync."
                          : !pluginHasConnector(group.plugin)
                            ? "Connection ready to sync pull requests."
                            : connection.autoSync
                              ? "Connection ready to sync directly into backlog."
                              : "Connection ready to stage imports.")}
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
                      {pluginHasConnector(group.plugin) ? (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={
                            isMutatingConnector ||
                            connectors?.pluginsEnabled === false ||
                            !group.enabled
                          }
                          onClick={() =>
                            void workflow.execute({
                              type: "sync",
                              pluginId: group.plugin.id,
                              connectionId: connection.id,
                            })
                          }
                        >
                          <RefreshCw data-icon="inline-start" />
                          Sync
                        </Button>
                      ) : null}
                      {group.plugin.capabilities.codeHost ? (
                        <AlertDialog>
                          <AlertDialogTrigger
                            render={
                              <Button
                                size="sm"
                                variant="destructive"
                                disabled={isMutatingConnector}
                              >
                                <Trash2 data-icon="inline-start" />
                                Remove
                              </Button>
                            }
                          />
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>
                                Remove {connection.label}?
                              </AlertDialogTitle>
                              <AlertDialogDescription>
                                This removes the connection and its{" "}
                                {
                                  (state.pullRequests ?? []).filter(
                                    (item) =>
                                      item.pluginId === group.plugin.id &&
                                      item.connectionId === connection.id,
                                  ).length
                                }{" "}
                                saved pull requests from this device.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction
                                variant="destructive"
                                onClick={() =>
                                  void handleDelete(
                                    group.plugin.id,
                                    connection.id,
                                  )
                                }
                              >
                                Remove connection
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      ) : (
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
                      )}
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
      available &&
      canInstallCatalogPlugin(catalogEntry) &&
      canDownloadCatalogPlugins;

    return (
      <>
        <PluginDetailHeader
          entry={catalogEntry}
          iconSvg={dataShapePlugin?.iconSvg}
          action={
            installed ? (
              <Button
                variant="outline"
                render={<Link to="/settings/projects" replace />}
              >
                Use in Projects
              </Button>
            ) : available ? (
              <Button
                className="w-full desktop:w-auto"
                disabled={!canDownloadThisEntry || isMutatingConnector}
                title={
                  !canInstallCatalogPlugin(catalogEntry)
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
              <Button
                className="w-full desktop:w-auto"
                variant="outline"
                disabled
              >
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
                {pluginCapabilitiesLabel(catalogEntry)}
              </Badge>
              <Badge variant="outline">
                Plugin API {catalogEntry.compatibility.pluginApiVersion}
              </Badge>
              {dataShapePlugin ? (
                <Badge variant="outline">
                  Version {dataShapePlugin.version}
                </Badge>
              ) : null}
            </>
          }
        />
        {renderMessages()}
        <PluginCapabilityBand entry={catalogEntry} />

        <section className="settings-section">
          <h2 className="settings-section-title">Features</h2>
          <PluginCapabilityList entry={catalogEntry} />
        </section>

        <section className="settings-section">
          <h2 className="settings-section-title">Information</h2>
          <PluginInfoList
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
        {selectedDisplayEntry?.connectorGroup ? (
          renderConnectorDetail(
            selectedDisplayEntry.catalog,
            selectedDisplayEntry.connectorGroup,
          )
        ) : selectedDisplayEntry ? (
          renderCatalogDetail(selectedDisplayEntry)
        ) : catalog === null || connectors === null ? (
          <>
            <Link
              to="/settings/plugins"
              replace
              className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground"
            >
              <ArrowLeft className="size-4" />
              All plugins
            </Link>
            {renderMessages()}
            {connectorApiMissing ? null : (
              <MessagePanel>Loading plugin…</MessagePanel>
            )}
          </>
        ) : (
          <>
            <Link
              to="/settings/plugins"
              replace
              className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground"
            >
              <ArrowLeft className="size-4" />
              All plugins
            </Link>
            {renderMessages()}
            <MessagePanel tone="warning">
              That plugin is not present in the Ajour index or installed on this
              device.
            </MessagePanel>
          </>
        )}
      </div>
    );
  }

  if (connectorApiMissing) {
    return (
      <div className="settings-sections gap-6">
        <section className="settings-section gap-4">
          <h1 className="text-lg font-semibold text-foreground">Plugins</h1>
          {renderMessages()}
        </section>
      </div>
    );
  }

  return (
    <div className="settings-sections gap-6">
      <PluginsHeader
        canInstall={canInstallConnectorPlugins}
        isMutating={isMutatingConnector}
        onInstall={() => void workflow.execute({ type: "install" })}
        filter={catalogFilter}
        onFilterChange={setCatalogFilter}
        pluginsEnabled={connectors?.pluginsEnabled ?? true}
        refreshMinutes={catalogSettings.refreshMinutes}
        canConfigureRefresh={Boolean(
          window.ajourDesktop?.configurePluginCatalog,
        )}
        onPluginsEnabledChange={(enabled) =>
          void workflow.execute({ type: "system", enabled })
        }
        onRefreshMinutesChange={(refreshMinutes) =>
          void workflow.setCatalogRefreshInterval(refreshMinutes)
        }
      >
        <>
          {renderMessages()}
          <section className="settings-section">
            {filteredDisplayEntries.length > 0 ? (
              <div className="grid gap-3 desktop:grid-cols-2">
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
                        ? void handlePluginActivation(
                            entry.connectorGroup,
                            enabled,
                          )
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
