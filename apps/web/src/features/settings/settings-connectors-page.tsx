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
import { AppPanel, MessagePanel, SettingRow } from "@/components/app-surface";
import { isDesktopShell } from "@/lib/runtime";
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
import { Chip } from "@/components/ui/chip";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { FieldGroup } from "@/components/ui/field";
import { OptionSelect } from "@/components/ui/option-select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getAppApiBaseUrl, getAppApiDescription } from "@/lib/app-api";
import { usePluginSettingsWorkflow } from "./use-plugin-settings-workflow";
import type { PluginDisplayEntry } from "./plugin-settings-workflow";
import { useLocalState } from "@/lib/local-hooks";
import type {
  ConnectorConnectionSummary,
  ConnectorFieldValues,
  ConnectorOverviewGroup,
  ConnectorPluginManifest,
  PluginCatalogCapability,
  PluginCatalogEntry,
  PluginCatalogSettings,
} from "@ajour/shared";
import { pluginHasConnector, pluginRunsCode } from "@ajour/shared";
import {
  areConnectorFormValuesEqual,
  buildConnectorFormValues,
  canSubmitConnectorForm,
  normalizeConnectorFormValuesForSave,
} from "./connector-form-state";
import { ConnectorFieldInput } from "./connector-settings-ui";
import {
  canInstallCatalogPlugin,
  canUpdateFromCatalog,
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

/** An empty list as plain text in the list's place, with no frame. */
function EmptyListText({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <Empty className="items-start p-0 text-left">
      <EmptyHeader className="items-start gap-0.5">
        <EmptyTitle className="font-sans text-sm font-medium tracking-normal text-foreground">
          {title}
        </EmptyTitle>
        <EmptyDescription className="text-[13px]">{children}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

/**
 * Downloads the catalog package again over an installed package Ajour cannot
 * run. Replacing a package keeps its connections and activation state.
 */
function UpdatePluginButton({
  title,
  canDownload,
  isMutating,
  onUpdate,
}: {
  title: string;
  canDownload: boolean;
  isMutating: boolean;
  onUpdate: () => void;
}) {
  return (
    <Button
      className="shrink-0"
      variant="outline"
      disabled={!canDownload || isMutating}
      title={
        canDownload
          ? undefined
          : "Updates are available in the production desktop app."
      }
      aria-label={`Update ${title}`}
      onClick={onUpdate}
    >
      <RefreshCw data-icon="inline-start" />
      Update
    </Button>
  );
}

/**
 * One catalog entry as a plain row: identity mark, name and status, the
 * description, a line of metadata, and the trailing action. Spacing between
 * rows separates entries; only hover paints a background. An installed plugin
 * Ajour cannot run shows why in place of the description, with Update as the
 * action when the catalog has a compatible package.
 */
function PluginCatalogRow({
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
  const unavailableReason = connectorGroup?.plugin.unavailableReason;
  const version = connectorGroup?.plugin.version ?? dataShapePlugin?.version;
  const statusLabel = unavailableReason
    ? "Unavailable"
    : installed
      ? "Installed"
      : catalog.status === "coming-soon"
        ? "Coming soon"
        : catalog.status === "deprecated"
          ? "Deprecated"
          : "Available";

  return (
    <div className="-mx-2 flex items-center gap-3 rounded-lg px-2 py-2.5 transition-colors hover:bg-[var(--hover-bg)]">
      <Link
        to="/settings/plugins/$pluginId"
        params={{ pluginId: catalog.id }}
        replace
        className="flex min-w-0 flex-1 items-start gap-3 rounded-[var(--control-radius)] outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
        aria-label={`View ${catalog.title}`}
      >
        <PluginIdentityMark
          entry={catalog}
          iconSvg={connectorGroup?.plugin.iconSvg ?? dataShapePlugin?.iconSvg}
        />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <span className="min-w-0 text-sm font-medium break-words text-foreground">
              {catalog.title}
            </span>
            <Badge variant={installed ? "secondary" : "outline"}>
              {statusLabel}
            </Badge>
          </span>
          <span className="line-clamp-2 text-[13px] leading-5 text-muted-foreground">
            {unavailableReason ?? catalog.description}
          </span>
          <span className="text-xs text-[var(--text-tertiary)]">
            {pluginCapabilitiesLabel(catalog)}
            {version ? ` · v${version}` : null}
          </span>
        </span>
      </Link>
      {unavailableReason && canUpdateFromCatalog(catalog) ? (
        <UpdatePluginButton
          title={catalog.title}
          canDownload={canDownload}
          isMutating={isMutating}
          onUpdate={onDownload}
        />
      ) : connectorGroup ? (
        <Switch
          className="shrink-0"
          checked={connectorGroup.enabled}
          disabled={
            isMutating ||
            !pluginsEnabled ||
            connectorGroup.plugin.unavailableReason !== undefined
          }
          aria-label={`${connectorGroup.enabled ? "Deactivate" : "Activate"} ${catalog.title}`}
          onCheckedChange={onEnabledChange}
        />
      ) : !installed && catalog.status === "available" ? (
        <Button
          className="shrink-0"

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
    </div>
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
      <section className="settings-section">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-lg font-semibold text-foreground">Plugins</h1>
            <p className="settings-section-desc mt-1">
              Discover extensions, download the ones you need, then activate and
              configure them locally.
            </p>
          </div>
          {canInstall ? (
            <Button disabled={isMutating} onClick={onInstall}>
              <Upload data-icon="inline-start" />
              Install from file
            </Button>
          ) : null}
        </div>

        <AppPanel>
          <SettingRow
            label="Plugin system"
            description="Deactivating pauses every installed plugin without removing its data."
          >
            <Switch
              checked={pluginsEnabled}
              disabled={isMutating}
              aria-label={`${pluginsEnabled ? "Deactivate" : "Activate"} all plugins`}
              onCheckedChange={onPluginsEnabledChange}
            />
          </SettingRow>
          <SettingRow label="Refresh catalog" labelFor="plugin-catalog-refresh">
            <OptionSelect
              id="plugin-catalog-refresh"
              className="w-36"
              value={String(refreshMinutes)}
              disabled={!canConfigureRefresh}
              onChange={(minutes) =>
                onRefreshMinutesChange(
                  Number(minutes) as PluginCatalogSettings["refreshMinutes"],
                )
              }
              options={[
                { value: "0", label: "At launch only" },
                { value: "15", label: "Every 15 min" },
                { value: "30", label: "Every 30 min" },
                { value: "60", label: "Every hour" },
                { value: "240", label: "Every 4 hours" },
              ]}
            />
          </SettingRow>
        </AppPanel>
      </section>

      <section className="settings-section">
        <TabsList
          variant="line"
          aria-label="Filter plugins"
          className="max-w-full gap-0 p-0 desktop:gap-1 desktop:p-1"
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
        <TabsContent value={filter} className="contents">
          {children}
        </TabsContent>
      </section>
    </Tabs>
  );
}

function AllPluginsLink() {
  return (
    <Link
      to="/settings/plugins"
      replace
      className="inline-flex w-fit items-center gap-1.5 rounded-[var(--control-radius)] text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/30"
    >
      <ArrowLeft className="size-4" />
      All plugins
    </Link>
  );
}

/**
 * The top of a plugin's page: back link, identity, status badges, then any
 * notices and the capability band passed as children. No frame; the page's
 * sections follow with section spacing.
 */
function PluginDetailHeader({
  entry,
  iconSvg,
  action,
  badges,
  children,
}: {
  entry: PluginCatalogEntry;
  iconSvg?: string;
  action?: ReactNode;
  badges: ReactNode;
  children?: ReactNode;
}) {
  return (
    <section className="settings-section">
      <AllPluginsLink />
      <div className="flex flex-col items-start gap-4 desktop:flex-row">
        <PluginIdentityMark
          entry={entry}
          iconSvg={iconSvg}
          className="size-14"
        />
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-semibold break-words text-foreground">
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
        {action ? <div className="w-full desktop:w-auto">{action}</div> : null}
      </div>
      <div className="flex flex-wrap gap-2">{badges}</div>
      {children}
    </section>
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
          // The web build has no catalog: that is a notice, not a failure.
          <MessagePanel tone={isDesktopShell ? "warning" : "default"}>
            {catalogError}
          </MessagePanel>
        ) : null}
      </>
    );

  const renderConnectorDetail = (
    entry: PluginCatalogEntry,
    group: ConnectorOverviewGroup,
  ) => {
    const groupFormState =
      formState?.pluginId === group.plugin.id ? formState : null;
    const { unavailableReason } = group.plugin;

    return (
      <>
        <PluginDetailHeader
          entry={entry}
          iconSvg={group.plugin.iconSvg}
          action={
            unavailableReason &&
            canUpdateFromCatalog(entry) &&
            canDownloadCatalogPlugins ? (
              <UpdatePluginButton
                title={entry.title}
                canDownload={canDownloadCatalogPlugins}
                isMutating={isMutatingConnector}
                onUpdate={() => void handleDownloadPlugin(entry)}
              />
            ) : unavailableReason && canInstallConnectorPlugins ? (
              <Button
                variant="outline"
                disabled={isMutatingConnector}
                onClick={() => void workflow.execute({ type: "install" })}
              >
                <Upload data-icon="inline-start" />
                Update from file
              </Button>
            ) : (
              <div className="flex w-full items-center justify-between gap-3 desktop:w-auto desktop:justify-end">
                <span className="text-sm text-muted-foreground">
                  {group.enabled ? "Active" : "Inactive"}
                </span>
                <Switch
                  checked={group.enabled}
                  disabled={
                    isMutatingConnector ||
                    connectors?.pluginsEnabled === false ||
                    group.plugin.unavailableReason !== undefined
                  }
                  aria-label={`${group.enabled ? "Deactivate" : "Activate"} ${entry.title}`}
                  onCheckedChange={(enabled) =>
                    void handlePluginActivation(group, enabled)
                  }
                />
              </div>
            )
          }
          badges={
            <>
              <Badge variant="secondary">
                {unavailableReason ? "Unavailable" : "Installed"}
              </Badge>
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
        >
          {unavailableReason ? (
            <MessagePanel tone="warning">
              <p>{unavailableReason}</p>
              <p>
                Updating keeps your saved connections and activation settings.
              </p>
            </MessagePanel>
          ) : null}
          {renderMessages()}
          <PluginCapabilityBand entry={entry} />
        </PluginDetailHeader>

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
        ) : !group.enabled && !unavailableReason ? (
          <MessagePanel>
            This plugin is inactive. Its saved connections and imported data are
            preserved, but sync is paused until you reactivate it.
          </MessagePanel>
        ) : null}

        {pluginRunsCode(group.plugin) ? (
          <section className="settings-section">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="settings-section-title">Configuration</h2>
                <p className="settings-section-desc mt-1">
                  Manage the local connections used by this plugin.
                </p>
              </div>
              <Button
                disabled={
                  isMutatingConnector ||
                  connectors?.pluginsEnabled === false ||
                  Boolean(unavailableReason)
                }
                onClick={() => handleCreate(group.plugin)}
              >
                Add a connection
              </Button>
            </div>

            {groupFormState ? (
              <AppPanel className="pb-4">
                <div>
                  <h3 className="text-sm font-medium text-foreground">
                    {groupFormState.editingConnectionId
                      ? `Edit ${group.plugin.displayName} connection`
                      : `New ${group.plugin.displayName} connection`}
                  </h3>
                  <p className="mt-0.5 text-[13px] text-muted-foreground">
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
                <div className="flex flex-wrap justify-end gap-3 pt-2">
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
              <EmptyListText title="No connections yet">
                Add a {group.plugin.displayName} connection to configure its
                source and sync behavior.
              </EmptyListText>
            ) : (
              <div className="flex flex-col gap-6">
                {group.connections.map((connection) => (
                  <div
                    key={connection.id}
                    className="flex flex-col gap-3 desktop:flex-row desktop:items-start desktop:justify-between desktop:gap-8"
                  >
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                        <h3 className="min-w-0 text-sm font-medium break-words text-foreground">
                          {connection.label}
                        </h3>
                        <Chip
                          tone={connection.lastError ? "danger" : "neutral"}
                        >
                          {unavailableReason
                            ? "Unavailable"
                            : connectors?.pluginsEnabled === false ||
                                !group.enabled
                              ? "Paused"
                              : connection.lastError
                                ? "Error"
                                : "Connected"}
                        </Chip>
                        <Badge variant="outline">
                          {connection.autoSync
                            ? `Auto every ${connection.autoSyncIntervalMinutes} min`
                            : pluginHasConnector(group.plugin)
                              ? "Stage for review"
                              : "Manual sync"}
                        </Badge>
                      </div>
                      <p className="text-[13px] break-words text-muted-foreground">
                        {connection.tenantLabel}
                      </p>
                      {!connection.autoSync &&
                      pluginHasConnector(group.plugin) ? (
                        <p className="text-xs text-[var(--text-tertiary)]">
                          {connection.pendingImportCount} staged ·{" "}
                          {connection.selectedImportCount} selected
                        </p>
                      ) : null}
                      {connection.lastError ? (
                        <p className="text-sm break-words text-destructive">
                          {connection.lastError}
                        </p>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2">
                      <Button
                        variant="outline"
                        disabled={
                          isMutatingConnector || Boolean(unavailableReason)
                        }
                        onClick={() => handleEdit(group.plugin, connection)}
                      >
                        <Pencil data-icon="inline-start" />
                        Edit
                      </Button>
                      {pluginHasConnector(group.plugin) ? (
                        <Button
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
                  </div>
                ))}
              </div>
            )}
          </section>
        ) : (
          <section className="settings-section">
            <h2 className="settings-section-title">Tasks</h2>
            <p className="settings-section-desc">
              An agent runs these tasks from a prompt. Pick the agent and fill
              in each task's settings in{" "}
              <Link to="/settings/agents" className="underline">
                Settings &gt; Agents
              </Link>
              .
            </p>
            <AppPanel>
              {group.plugin.capabilities.agentTask?.tasks.map((task) => (
                <SettingRow key={task.id} label={task.label} />
              ))}
            </AppPanel>
          </section>
        )}

        {canUninstallConnectorPlugins ? (
          <section className="settings-section">
            <h2 className="settings-section-title">Uninstall plugin</h2>
            <p className="settings-section-desc">
              Remove the plugin package and its saved connections from this
              device. Imported backlog items will remain available.
            </p>
            <div className="flex flex-wrap items-center justify-between gap-x-8 gap-y-3">
              <p className="max-w-[62ch] min-w-0 flex-1 basis-64 text-[13px] text-muted-foreground">
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
            </div>
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
        >
          {renderMessages()}
          <PluginCapabilityBand entry={catalogEntry} />
        </PluginDetailHeader>

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
      <div className="settings-sections">
        {selectedDisplayEntry?.connectorGroup ? (
          renderConnectorDetail(
            selectedDisplayEntry.catalog,
            selectedDisplayEntry.connectorGroup,
          )
        ) : selectedDisplayEntry ? (
          renderCatalogDetail(selectedDisplayEntry)
        ) : catalog === null || connectors === null ? (
          <section className="settings-section">
            <AllPluginsLink />
            {renderMessages()}
            {connectorApiMissing ? null : (
              <MessagePanel>Loading plugin…</MessagePanel>
            )}
          </section>
        ) : (
          <section className="settings-section">
            <AllPluginsLink />
            {renderMessages()}
            <MessagePanel tone="warning">
              That plugin is not present in the Ajour index or installed on this
              device.
            </MessagePanel>
          </section>
        )}
      </div>
    );
  }

  if (connectorApiMissing) {
    return (
      <div className="settings-sections">
        <section className="settings-section">
          <h1 className="text-lg font-semibold text-foreground">Plugins</h1>
          {renderMessages()}
        </section>
      </div>
    );
  }

  return (
    <div className="settings-sections">
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
          <div className="flex flex-col gap-3">
            {filteredDisplayEntries.length > 0 ? (
              <div className="flex flex-col gap-1">
                {filteredDisplayEntries.map((entry) => (
                  <PluginCatalogRow
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
              <EmptyListText title="No matching plugins">
                Choose another category or install a compatible plugin from a
                local file.
              </EmptyListText>
            ) : null}
            {catalog === null && connectors === null && !connectorError ? (
              <MessagePanel>Loading plugins…</MessagePanel>
            ) : null}
          </div>

          <p className="pt-4 text-xs text-[var(--text-tertiary)]">
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
