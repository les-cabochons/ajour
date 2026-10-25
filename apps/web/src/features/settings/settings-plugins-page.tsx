import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
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
import {
  describeConnectionRemoval,
  type PluginDisplayEntry,
} from "./plugin-settings-workflow";
import { useLocalState } from "@/lib/local-hooks";
import type {
  PluginConnectionSummary,
  PluginFieldValues,
  PluginOverviewGroup,
  PluginManifest,
  PluginCatalogCapability,
  PluginCatalogEntry,
  PluginCatalogSettings,
  SwitchableCapability,
} from "@ajour/shared";
import {
  connectionAgentAccess,
  isCapabilityActive,
  isCapabilitySwitchedOn,
  pluginConnectionFormFields,
  pluginHasBacklog,
  pluginHasTeam,
  pluginRunsCode,
  syncsPullRequestsAutomatically,
} from "@ajour/shared";
import {
  createPluginFormState,
  expiryForSave,
  secretFieldIds,
  type PluginFormState,
} from "./plugin-form-state";
import { heldEditCount, useHeldEdits } from "@/lib/held-edits";
import {
  ConnectionAccessBadge,
  connectionEdits,
  HeldEditsLine,
} from "./connection-access-ui";
import { type PluginReplaceTarget } from "./plugin-detail-search";
import { PluginCapabilitySwitches } from "./plugin-capability-switches";
import { PluginConnectionForm } from "./connection-form";
import {
  ConnectionStatusChip,
  ConnectionStatusNote,
} from "./connection-status-ui";
import { HeldArrivalsLine, TeamPickerDialog } from "./team-connection-ui";
import { PluginAgentTasks } from "./agent-task-settings";
import {
  canInstallCatalogPlugin,
  canUpdateFromCatalog,
  PluginCapabilityBand,
  PluginCapabilityList,
  PluginIdentityMark,
  PluginInfoList,
  pluginCapabilitiesLabel,
} from "./plugin-catalog-ui";

type PluginCatalogFilter = "all" | PluginCatalogCapability;

/** The one notice Plugins shows when the web build runs without the app API. */
const PLUGINS_NEED_DESKTOP_APP = "Plugins need the desktop app.";

/**
 * What agents may do with the connection's comments and synced descriptions,
 * when the user allowed any.
 */
function agentAccessLabel(
  group: PluginOverviewGroup,
  connection: PluginConnectionSummary,
) {
  const connector = group.plugin.capabilities.connector;
  const comments = Boolean(connector?.comments);
  const descriptions = Boolean(connector?.description?.write);
  if (
    (!comments && !descriptions) ||
    !isCapabilitySwitchedOn(group, "connector")
  ) {
    return null;
  }
  switch (connectionAgentAccess(connection)) {
    case "read":
      return comments ? "Agents read comments" : null;
    case "readWrite":
      if (!comments) return "Agents change descriptions";
      return descriptions
        ? "Agents read and write comments and descriptions"
        : "Agents read and write comments";
    default:
      return null;
  }
}

/**
 * How the connection syncs, per capability that is on. Auto sync imports work
 * items straight to the backlog; without it they stage for review. Pull
 * requests have their own automatic sync.
 */
function syncModeLabel(
  group: PluginOverviewGroup,
  connection: PluginConnectionSummary,
) {
  const interval = `Auto every ${connection.autoSyncIntervalMinutes} min`;
  const backlogItems = connection.autoSync ? interval : "Stage for review";
  const pullRequests = syncsPullRequestsAutomatically(connection)
    ? interval
    : "Manual sync";
  const backlog = isCapabilitySwitchedOn(group, "connector");
  const codeHost = isCapabilitySwitchedOn(group, "codeHost");
  if (!backlog && !codeHost && isCapabilitySwitchedOn(group, "team")) {
    return interval;
  }
  if (backlog && codeHost && backlogItems !== pullRequests) {
    return `Backlog items: ${backlogItems} · Pull requests: ${pullRequests}`;
  }
  return backlog || !codeHost ? backlogItems : pullRequests;
}

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
  const { catalog, pluginGroup, dataShapePlugin } = entry;
  const installed = Boolean(pluginGroup || dataShapePlugin);
  const unavailableReason = pluginGroup?.plugin.unavailableReason;
  const version = pluginGroup?.plugin.version ?? dataShapePlugin?.version;
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
          iconSvg={pluginGroup?.plugin.iconSvg ?? dataShapePlugin?.iconSvg}
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
      ) : pluginGroup ? (
        <Switch
          className="shrink-0"
          checked={pluginGroup.enabled}
          disabled={
            isMutating ||
            !pluginsEnabled ||
            pluginGroup.plugin.unavailableReason !== undefined
          }
          aria-label={`${pluginGroup.enabled ? "Deactivate" : "Activate"} ${catalog.title}`}
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
          // Six filters: the row wraps instead of overflowing a narrow window.
          className="h-auto! max-w-full flex-wrap justify-start! gap-0 p-0 desktop:gap-1 desktop:p-1"
        >
          <TabsTrigger value="all" className="px-1.5 desktop:px-3">
            All
          </TabsTrigger>
          <TabsTrigger value="connector" className="px-1.5 desktop:px-3">
            Backlog
          </TabsTrigger>
          <TabsTrigger value="codeHost" className="px-1.5 desktop:px-3">
            Code hosts
          </TabsTrigger>
          <TabsTrigger value="calendar" className="px-1.5 desktop:px-3">
            Calendars
          </TabsTrigger>
          <TabsTrigger value="agentTask" className="px-1.5 desktop:px-3">
            Agent tasks
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

export function SettingsPluginsPage({
  pluginId,
  replace,
}: {
  pluginId?: string;
  /** The secret the Vault sent the user to replace. */
  replace?: PluginReplaceTarget;
}) {
  const state = useLocalState();
  const navigate = useNavigate();
  const heldEdits = useHeldEdits();
  const isDevelopmentBuild =
    window.ajourDesktop?.runtime?.developmentBuild === true;
  const canInstallPlugins =
    Boolean(window.ajourDesktop?.installPlugin) && !isDevelopmentBuild;
  const canUninstallPlugins =
    Boolean(window.ajourDesktop?.uninstallPlugin) && !isDevelopmentBuild;
  const canDownloadCatalogPlugins =
    Boolean(window.ajourDesktop?.downloadCatalogPlugin) && !isDevelopmentBuild;
  const {
    overview,
    catalog,
    catalogSettings,
    displayEntries,
    catalogError,
    pluginError,
    pluginApiMissing,
    statusMessage,
    isMutatingPlugin,
    workflow,
  } = usePluginSettingsWorkflow();
  const [catalogFilter, setCatalogFilter] =
    useState<PluginCatalogFilter>("all");
  const [formState, setFormState] = useState<PluginFormState | null>(null);
  const formInstances = useRef(0);
  /** The team connection whose picker is open. */
  const [teamPicker, setTeamPicker] = useState<{
    pluginId: string;
    connectionId: string;
    teamName: string;
  } | null>(null);

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

  const pluginGroups = overview?.connectionGroups ?? [];
  const filteredDisplayEntries = displayEntries.filter(
    (entry) =>
      catalogFilter === "all" ||
      entry.catalog.capabilities.includes(catalogFilter),
  );
  const pluginsById = useMemo(
    () =>
      new Map(
        (overview?.plugins ?? []).map((plugin) => [plugin.id, plugin] as const),
      ),
    [overview?.plugins],
  );
  const activePlugin = formState
    ? (pluginGroups.find((group) => group.plugin.id === formState.pluginId)
        ?.plugin ?? pluginsById.get(formState.pluginId))
    : undefined;

  const handlePluginActivation = (
    group: PluginOverviewGroup,
    enabled: boolean,
    capability?: SwitchableCapability,
  ) =>
    workflow.execute({
      type: "activate",
      plugin: group.plugin,
      enabled,
      capability,
    });

  const accessChoicesOf = (pluginId: string) =>
    pluginGroups.find((group) => group.plugin.id === pluginId)
      ?.connectionAccess ?? [];

  const handleCreate = (plugin: PluginManifest) => {
    workflow.clearFeedback();
    setFormState(
      createPluginFormState(
        (formInstances.current += 1),
        plugin,
        undefined,
        undefined,
        accessChoicesOf(plugin.id),
      ),
    );
  };

  /**
   * Opens the connection's form. `replaceFieldId` opens that secret's Replace
   * at once; without it, a secret the service refused opens its own.
   */
  const handleEdit = (
    plugin: PluginManifest,
    connection: PluginConnectionSummary,
    replaceFieldId?: string,
  ) => {
    workflow.clearFeedback();
    setFormState(
      createPluginFormState(
        (formInstances.current += 1),
        plugin,
        connection,
        replaceFieldId ??
          connection.secretFields?.find((secret) => secret.state === "rejected")
            ?.id,
        accessChoicesOf(plugin.id),
      ),
    );
  };

  // The Vault's Replace opens the connection's form with Replace open, once
  // the overview lists the connection.
  const openedReplace = useRef<string | null>(null);
  useEffect(() => {
    if (!replace?.connectionId || !pluginId) return;
    const key = `${pluginId}/${replace.connectionId}/${replace.fieldId}`;
    if (openedReplace.current === key) return;
    const group = pluginGroups.find(
      (candidate) => candidate.plugin.id === pluginId,
    );
    const connection = group?.connections.find(
      (candidate) => candidate.id === replace.connectionId,
    );
    if (!group || !connection) return;
    openedReplace.current = key;
    handleEdit(group.plugin, connection, replace.fieldId);
  }, [pluginGroups, pluginId, replace]);

  const handleSave = async () => {
    if (!formState || !activePlugin) return;
    let saved: PluginConnectionSummary | undefined;
    let heldForReview: string | undefined;
    const completed = await workflow.execute({
      type: "save",
      pluginId: formState.pluginId,
      values: formState.values,
      // Only the dates the user changed, and those of secrets pasted anew.
      secretExpiry: expiryForSave(
        formState.expiry,
        formState.initialExpiry,
        secretFieldIds(activePlugin).filter(
          (id) => String(formState.values[id] ?? "").trim() !== "",
        ),
      ),
      connectionId: formState.editingConnectionId ?? undefined,
      ...(accessChoicesOf(formState.pluginId).length > 0
        ? { access: formState.access }
        : {}),
      onSaved: (connection) => {
        saved = connection;
      },
      // Changes made while editing was off wait in Sync review.
      onHeldForReview: (connectionId) => {
        heldForReview = connectionId;
      },
    });
    if (!completed) return;
    setFormState(null);
    if (heldForReview) {
      void navigate({
        to: "/settings/sync-review",
        search: { held: heldForReview } as never,
      });
      return;
    }
    if (formState.editingConnectionId || !pluginHasTeam(activePlugin)) return;
    if (!saved) return;
    const added = saved;
    // The first sync brings the team's projects and holds the ones whose name
    // a local project has; the picker then links or adds them. A failed sync
    // leaves the connection saved, with its error, and no picker: Sync again,
    // then Choose projects.
    const synced = await workflow.execute({
      type: "teamSync",
      pluginId: formState.pluginId,
      connectionId: added.id,
    });
    if (!synced) return;
    setTeamPicker({
      pluginId: formState.pluginId,
      connectionId: added.id,
      teamName: added.tenantLabel,
    });
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
  const handleUninstallPlugin = async (group: PluginOverviewGroup) => {
    if (await workflow.execute({ type: "uninstall", plugin: group.plugin }))
      setFormState(null);
  };

  const renderMessages = () =>
    pluginApiMissing ? (
      <MessagePanel>{PLUGINS_NEED_DESKTOP_APP}</MessagePanel>
    ) : (
      <>
        {statusMessage ? <MessagePanel>{statusMessage}</MessagePanel> : null}
        {pluginError ? (
          <MessagePanel tone="warning">{pluginError}</MessagePanel>
        ) : null}
        {catalog?.warning ? (
          <MessagePanel tone="warning">
            The catalog was loaded from its local cache. Artwork and metadata
            will refresh when the index is reachable.
          </MessagePanel>
        ) : null}
        {catalog?.skippedPluginIds?.length ? (
          <MessagePanel>
            This version of Ajour can't read these catalog entries:{" "}
            {catalog.skippedPluginIds.join(", ")}. Update Ajour to see them.
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

  const renderPluginDetail = (
    entry: PluginCatalogEntry,
    group: PluginOverviewGroup,
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
                isMutating={isMutatingPlugin}
                onUpdate={() => void handleDownloadPlugin(entry)}
              />
            ) : unavailableReason && canInstallPlugins ? (
              <Button
                variant="outline"
                disabled={isMutatingPlugin}
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
                    isMutatingPlugin ||
                    overview?.pluginsEnabled === false ||
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
              {pluginHasBacklog(group.plugin) ? (
                <Badge variant="outline">
                  {importedCountsByPlugin[group.plugin.id] ?? 0} backlog items
                </Badge>
              ) : null}
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

        {overview?.pluginsEnabled === false ? (
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

        <PluginCapabilitySwitches
          group={group}
          title={entry.title}
          disabled={
            isMutatingPlugin ||
            overview?.pluginsEnabled === false ||
            Boolean(unavailableReason)
          }
          onChange={(capability, enabled) =>
            void handlePluginActivation(group, enabled, capability)
          }
        />

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
                  isMutatingPlugin ||
                  overview?.pluginsEnabled === false ||
                  Boolean(unavailableReason)
                }
                onClick={() => handleCreate(group.plugin)}
              >
                Add a connection
              </Button>
            </div>

            {groupFormState ? (
              <PluginConnectionForm
                group={group}
                form={groupFormState}
                setForm={setFormState}
                connection={group.connections.find(
                  (connection) =>
                    connection.id === groupFormState.editingConnectionId,
                )}
                vault={overview?.vault}
                isMutating={isMutatingPlugin}
                heldCount={
                  groupFormState.editingConnectionId
                    ? heldEditCount(
                        heldEdits,
                        group.plugin.id,
                        groupFormState.editingConnectionId,
                      )
                    : 0
                }
                now={Date.now()}
                onCancel={() => setFormState(null)}
                onSave={() => void handleSave()}
                onRemoveSecret={(fieldId) =>
                  groupFormState.editingConnectionId
                    ? void workflow.execute({
                        type: "removeSecrets",
                        pluginId: group.plugin.id,
                        connectionId: groupFormState.editingConnectionId,
                        fieldIds: [fieldId],
                      })
                    : undefined
                }
              />
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
                        <ConnectionStatusChip
                          group={group}
                          connection={connection}
                          pluginsEnabled={overview?.pluginsEnabled !== false}
                        />
                        <Badge variant="outline">
                          {syncModeLabel(group, connection)}
                        </Badge>
                        {agentAccessLabel(group, connection) ? (
                          <Badge variant="outline">
                            {agentAccessLabel(group, connection)}
                          </Badge>
                        ) : null}
                        <ConnectionAccessBadge
                          group={group}
                          connection={connection}
                        />
                      </div>
                      <p className="text-[13px] break-words text-muted-foreground">
                        {connection.tenantLabel}
                      </p>
                      {!connection.autoSync &&
                      pluginHasBacklog(group.plugin) ? (
                        <p className="text-xs text-[var(--text-tertiary)]">
                          {connection.pendingImportCount} staged ·{" "}
                          {connection.selectedImportCount} selected
                        </p>
                      ) : null}
                      {pluginHasTeam(group.plugin) ? (
                        <HeldArrivalsLine
                          count={
                            state.teamConnections?.[connection.id]?.heldArrivals
                              .length ?? 0
                          }
                        />
                      ) : null}
                      <HeldEditsLine
                        count={heldEditCount(
                          heldEdits,
                          group.plugin.id,
                          connection.id,
                        )}
                        editing={connectionEdits(group, connection)}
                        connectionId={connection.id}
                      />
                      <ConnectionStatusNote
                        group={group}
                        connection={connection}
                        pluginsEnabled={overview?.pluginsEnabled !== false}
                      />
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2">
                      <Button
                        variant="outline"
                        disabled={
                          isMutatingPlugin || Boolean(unavailableReason)
                        }
                        onClick={() => handleEdit(group.plugin, connection)}
                      >
                        <Pencil data-icon="inline-start" />
                        Edit
                      </Button>
                      {pluginHasBacklog(group.plugin) ? (
                        <Button
                          variant="outline"
                          disabled={
                            isMutatingPlugin ||
                            overview?.pluginsEnabled === false ||
                            !isCapabilityActive(group, "connector") ||
                            Boolean(connection.paused)
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
                      {pluginHasTeam(group.plugin) ? (
                        <>
                          <Button
                            variant="outline"
                            disabled={
                              isMutatingPlugin ||
                              overview?.pluginsEnabled === false ||
                              !isCapabilityActive(group, "team") ||
                              Boolean(connection.paused)
                            }
                            onClick={() =>
                              void workflow.execute({
                                type: "teamSync",
                                pluginId: group.plugin.id,
                                connectionId: connection.id,
                              })
                            }
                          >
                            <RefreshCw data-icon="inline-start" />
                            {pluginHasBacklog(group.plugin)
                              ? "Sync projects"
                              : "Sync"}
                          </Button>
                          <Button
                            variant="outline"
                            disabled={
                              isMutatingPlugin ||
                              !isCapabilityActive(group, "team")
                            }
                            onClick={() =>
                              setTeamPicker({
                                pluginId: group.plugin.id,
                                connectionId: connection.id,
                                teamName: connection.tenantLabel,
                              })
                            }
                          >
                            Choose projects
                          </Button>
                        </>
                      ) : null}
                      {group.plugin.capabilities.codeHost ||
                      group.plugin.capabilities.calendar ||
                      group.plugin.capabilities.team ||
                      // Its held changes go with it: the user confirms that.
                      heldEditCount(heldEdits, group.plugin.id, connection.id) >
                        0 ? (
                        <AlertDialog>
                          <AlertDialogTrigger
                            render={
                              <Button
                                variant="destructive"
                                disabled={isMutatingPlugin}
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
                                {describeConnectionRemoval(
                                  group.plugin,
                                  connection.id,
                                  state,
                                  heldEditCount(
                                    heldEdits,
                                    group.plugin.id,
                                    connection.id,
                                  ),
                                )}
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
                          disabled={isMutatingPlugin}
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
        ) : null}

        {teamPicker && teamPicker.pluginId === group.plugin.id ? (
          <TeamPickerDialog
            open
            onOpenChange={(open) => {
              if (!open) setTeamPicker(null);
            }}
            connectionId={teamPicker.connectionId}
            teamName={teamPicker.teamName}
            onApplied={() =>
              void workflow.execute({
                type: "teamSync",
                pluginId: teamPicker.pluginId,
                connectionId: teamPicker.connectionId,
              })
            }
          />
        ) : null}

        {group.plugin.capabilities.agentTask ? (
          <PluginAgentTasks
            pluginId={group.plugin.id}
            tasks={group.plugin.capabilities.agentTask.tasks}
            replaceFieldId={
              replace?.connectionId ? undefined : replace?.fieldId
            }
            vault={overview?.vault}
          />
        ) : null}

        {canUninstallPlugins ? (
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
                    <Button variant="destructive" disabled={isMutatingPlugin} />
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
                      credentials, staged imports, and source states. Already
                      imported backlog items are preserved.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      variant="destructive"
                      disabled={isMutatingPlugin}
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
                disabled={!canDownloadThisEntry || isMutatingPlugin}
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
        {selectedDisplayEntry?.pluginGroup ? (
          renderPluginDetail(
            selectedDisplayEntry.catalog,
            selectedDisplayEntry.pluginGroup,
          )
        ) : selectedDisplayEntry ? (
          renderCatalogDetail(selectedDisplayEntry)
        ) : catalog === null || overview === null ? (
          <section className="settings-section">
            <AllPluginsLink />
            {renderMessages()}
            {pluginApiMissing ? null : (
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

  if (pluginApiMissing) {
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
        canInstall={canInstallPlugins}
        isMutating={isMutatingPlugin}
        onInstall={() => void workflow.execute({ type: "install" })}
        filter={catalogFilter}
        onFilterChange={setCatalogFilter}
        pluginsEnabled={overview?.pluginsEnabled ?? true}
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
                    pluginsEnabled={overview?.pluginsEnabled ?? true}
                    isMutating={isMutatingPlugin}
                    onDownload={() => void handleDownloadPlugin(entry.catalog)}
                    onEnabledChange={(enabled) =>
                      entry.pluginGroup
                        ? void handlePluginActivation(
                            entry.pluginGroup,
                            enabled,
                          )
                        : undefined
                    }
                  />
                ))}
              </div>
            ) : catalog || overview ? (
              <EmptyListText title="No matching plugins">
                Choose another category or install a compatible plugin from a
                local file.
              </EmptyListText>
            ) : null}
            {catalog === null && overview === null && !pluginError ? (
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
            {!canInstallPlugins
              ? " · Downloads and packaged installation are available in the desktop app."
              : ""}
          </p>
        </>
      </PluginsHeader>
    </div>
  );
}
