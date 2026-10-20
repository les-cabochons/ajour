import {
  backlogSourceStatusListResponseSchema,
  backlogSourceStatusUpsertRequestSchema,
  backlogSourceStatusUpsertResponseSchema,
  pluginConnectionSaveResponseSchema,
  pluginConnectionSaveRequestSchema,
  pluginActivationUpdateSchema,
  pluginSystemActivationUpdateSchema,
  pluginInstallResponseSchema,
  pluginUninstallResponseSchema,
  backlogSettleStatesRequestSchema,
  backlogSettleStatesResultSchema,
  backlogSettleWriteRequestSchema,
  backlogSettleWriteResultSchema,
  backlogSyncRequestSchema,
  backlogSyncResultSchema,
  type BacklogSettleWriteRequest,
  type BacklogSyncRequest,
  backlogImportCommitResponseSchema,
  backlogImportDismissRequestSchema,
  backlogImportDismissResponseSchema,
  backlogImportListResponseSchema,
  backlogImportRestoreRequestSchema,
  backlogImportRestoreResponseSchema,
  backlogImportSelectionResponseSchema,
  backlogImportSelectionUpdateSchema,
  pluginsOverviewSchema,
  type BacklogSourceStatusInput,
  type PluginConnectionSaveResponse,
  type PluginFieldValues,
  type BacklogImportCandidate,
  type PluginInstallResponse,
  type BacklogSyncWorkItem,
  type PluginsOverview,
  type BacklogSyncResult,
} from "@ajour/shared";
import { newDescriptionConflicts } from "@/domain/backlog/description-sync";
import { announceDescriptionConflicts } from "@/lib/sync-conflict-events";
import {
  catalogPluginDownloadResponseSchema,
  pluginCatalogResponseSchema,
  pluginCatalogSettingsSchema,
} from "@ajour/shared";
import type { PluginCatalogSettings } from "@ajour/shared";
import {
  projectDataShapeExportRequestSchema,
  projectDataShapeExportResponseSchema,
  projectDataShapeImportRequestSchema,
  projectDataShapeImportResponseSchema,
  projectDataShapeListResponseSchema,
  type ProjectDataShapeDataset,
  type ProjectDataShapeExportProject,
} from "@ajour/shared";
import {
  agentsSnapshotSchema,
  mcpBridgeResultAckSchema,
  mcpClientCreateResponseSchema,
  mcpSettingsSchema,
  type BridgeToolResult,
} from "@ajour/shared/agent-tools";
import {
  agentRunnerOverviewSchema,
  agentRunSchema,
  type AgentRunnerSettings,
  type AgentRunStartRequest,
} from "@ajour/shared/agent-runs";
import { localStore } from "@/lib/local-store";
import {
  calendarListEventsResultSchema,
  type CalendarListEventsRequest,
  backlogListItemCommentsResultSchema,
  type BacklogListItemCommentsRequest,
  type BacklogListItemCommentsResult,
  backlogPostItemCommentResultSchema,
  type BacklogPostItemCommentRequest,
  type BacklogPostItemCommentResult,
  backlogEditItemCommentResultSchema,
  type BacklogEditItemCommentRequest,
  type BacklogEditItemCommentResult,
  backlogDeleteItemCommentResultSchema,
  type BacklogDeleteItemCommentRequest,
  backlogSetItemCommentReactionResultSchema,
  type BacklogSetItemCommentReactionRequest,
  type BacklogSetItemCommentReactionResult,
  backlogSearchItemPeopleResultSchema,
  type BacklogSearchItemPeopleRequest,
  type BacklogSearchItemPeopleResult,
  teamCreateResultSchema,
  teamSyncResultSchema,
  type TeamCreateResult,
  type TeamCreateRouteRequest,
  type TeamSyncRequest,
  type TeamSyncResult,
  type CalendarListEventsResult,
} from "@ajour/shared";
import {
  codeHostSyncResultSchema,
  isCapabilityActive,
  type CodeHostSyncResult,
  type SwitchableCapability,
} from "@ajour/shared";
import {
  findRetainedConnection,
  trackedPullRequestRefs,
} from "@/domain/pull-requests/pull-request-lifecycle";

const pullRequestSyncs = new Map<string, Promise<CodeHostSyncResult>>();
const connectionGenerations = new Map<string, number>();
const connectionKey = (pluginId: string, connectionId: string) =>
  JSON.stringify([pluginId, connectionId]);

/** Deduplicates manual and scheduled calls, and rejects results from a removed connection. */
export function syncCodeHostConnection(
  pluginId: string,
  connectionId: string,
): Promise<CodeHostSyncResult> {
  const key = connectionKey(pluginId, connectionId);
  const pending = pullRequestSyncs.get(key);
  if (pending) return pending;
  const generation = connectionGenerations.get(key) ?? 0;
  const run = async () => {
    const request = (tracked: { repository: string; number: number }[]) =>
      appApiRequest(
        `/api/code-hosts/${encodeURIComponent(pluginId)}/connections/${encodeURIComponent(connectionId)}/syncPullRequests`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tracked }),
        },
        codeHostSyncResultSchema,
      );
    let result = await request(
      trackedPullRequestRefs(
        localStore.snapshot().pullRequests ?? [],
        pluginId,
        [connectionId],
      ),
    );
    await getPluginsOverview();
    const overview = getCachedPluginsOverview()!;
    const group = overview.connectionGroups.find(
      (entry) => entry.plugin.id === pluginId,
    );
    const connection = group?.connections.find(
      (entry) => entry.id === connectionId,
    );
    if (
      (connectionGenerations.get(key) ?? 0) !== generation ||
      overview.pluginsEnabled === false ||
      !group ||
      !isCapabilityActive(group, "codeHost") ||
      !connection
    ) {
      return result;
    }
    const source = {
      pluginId,
      pluginName: group.plugin.displayName,
      connectionId,
      connectionLabel: connection.label,
    };
    // A reinstalled plugin gives connections new ids. Restore the records the
    // uninstall kept, after asking about them so the ones that closed report.
    const reattachFrom = findRetainedConnection(
      localStore.snapshot().pullRequests ?? [],
      source,
      result,
      new Set(group.connections.map((entry) => entry.id)),
    );
    if (reattachFrom) {
      result = await request(
        trackedPullRequestRefs(
          localStore.snapshot().pullRequests ?? [],
          pluginId,
          [connectionId, reattachFrom],
        ),
      );
      if ((connectionGenerations.get(key) ?? 0) !== generation) {
        return result;
      }
    }
    localStore.syncPullRequests(
      source,
      result,
      reattachFrom ? { reattachFrom } : {},
    );
    return result;
  };
  const promise = run().finally(() => {
    if (pullRequestSyncs.get(key) === promise) pullRequestSyncs.delete(key);
  });
  pullRequestSyncs.set(key, promise);
  return promise;
}

export type SyncBacklogConnectionResult = BacklogSyncResult & {
  backlogImportedCount: number;
  backlogUpdatedCount: number;
};

const DEFAULT_INTERNAL_APP_API_BASE_URL = "http://127.0.0.1:8787";
const APP_API_BASE_URL = (
  import.meta.env.VITE_APP_API_BASE_URL ?? DEFAULT_INTERNAL_APP_API_BASE_URL
).replace(/\/+$/, "");
const APP_API_RETRY_DELAYS_MS = [150, 350] as const;
let cachedPluginsOverview: PluginsOverview | null = null;
let pluginsOverviewRevision = 0;
let latestPluginsOverviewRequest = 0;
const pluginsOverviewListeners = new Set<(overview: PluginsOverview) => void>();

/**
 * Thrown when the local app API cannot be reached at all, as in the web
 * build that runs without the desktop app. Pages use it to hide plugin
 * features calmly instead of showing a failure.
 */
class AppApiUnavailableError extends Error {
  constructor(cause: unknown) {
    super(
      `Internal app API unavailable. Restart the app. ${cause instanceof Error ? cause.message : ""}`.trim(),
      { cause },
    );
    this.name = "AppApiUnavailableError";
  }
}

/**
 * True when the app API is unreachable because Ajour runs as a plain web
 * app. In the desktop app the API is internal, so an unreachable API stays a
 * real failure that the page reports.
 */
export function isPluginApiMissing(error: unknown) {
  return (
    error instanceof AppApiUnavailableError &&
    (typeof window === "undefined" || !window.ajourDesktop)
  );
}

function isDefaultInternalAppApi() {
  return APP_API_BASE_URL === DEFAULT_INTERNAL_APP_API_BASE_URL;
}

async function delay(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function parseJsonResponse<T>(
  response: Response,
  schema: { parse: (value: unknown) => T },
): Promise<T> {
  const payload = (await response.json()) as unknown;
  return schema.parse(payload);
}

async function appApiRequest<T>(
  path: string,
  init: RequestInit | undefined,
  schema: { parse: (value: unknown) => T },
): Promise<T> {
  let response: Response | null = null;
  let lastNetworkError: unknown;

  for (
    let attempt = 0;
    attempt <= APP_API_RETRY_DELAYS_MS.length;
    attempt += 1
  ) {
    try {
      response = await fetch(`${APP_API_BASE_URL}${path}`, {
        ...init,
        headers: {
          "Content-Type": "application/json",
          ...init?.headers,
        },
      });
      lastNetworkError = undefined;
      break;
    } catch (error) {
      lastNetworkError = error;
      if (
        !isDefaultInternalAppApi() ||
        attempt === APP_API_RETRY_DELAYS_MS.length
      ) {
        throw new AppApiUnavailableError(error);
      }

      const retryDelayMs = APP_API_RETRY_DELAYS_MS[attempt];
      if (retryDelayMs === undefined) {
        throw new AppApiUnavailableError(error);
      }

      await delay(retryDelayMs);
    }
  }

  if (lastNetworkError !== undefined || !response) {
    throw new AppApiUnavailableError(lastNetworkError);
  }

  if (!response.ok) {
    let detail = response.statusText || "Request failed";
    try {
      const payload = (await response.json()) as { error?: string };
      if (
        typeof payload.error === "string" &&
        payload.error.trim().length > 0
      ) {
        detail = payload.error.trim();
      }
    } catch {
      // Ignore non-JSON error responses.
    }

    throw new Error(detail);
  }

  return parseJsonResponse(response, schema);
}

export function getAppApiBaseUrl() {
  return APP_API_BASE_URL;
}

export function getAppApiDescription() {
  return isDefaultInternalAppApi() ? "Internal app runtime" : APP_API_BASE_URL;
}

export async function getPluginCatalog() {
  const getCatalog = window.ajourDesktop?.getPluginCatalog;
  if (!getCatalog) {
    throw new Error("The plugin catalog is available in the desktop app.");
  }
  return pluginCatalogResponseSchema.parse(await getCatalog());
}

export async function getPluginCatalogSettings() {
  const getSettings = window.ajourDesktop?.getPluginCatalogSettings;
  if (!getSettings) {
    return pluginCatalogSettingsSchema.parse({ refreshMinutes: 15 });
  }
  return pluginCatalogSettingsSchema.parse(await getSettings());
}

export async function configurePluginCatalog(settings: PluginCatalogSettings) {
  const configure = window.ajourDesktop?.configurePluginCatalog;
  if (!configure) {
    throw new Error(
      "Plugin catalog settings are available in the desktop app.",
    );
  }
  return pluginCatalogSettingsSchema.parse(await configure(settings));
}

export async function downloadCatalogPlugin(pluginId: string) {
  const download = window.ajourDesktop?.downloadCatalogPlugin;
  if (!download) {
    throw new Error(
      "Plugin downloads are available in the production desktop app.",
    );
  }
  const result = catalogPluginDownloadResponseSchema.parse(
    await download(pluginId),
  );
  cachePluginsOverview(result.result.overview);
  return result;
}

export async function getProjectDataShapePlugins() {
  return (
    await appApiRequest(
      "/api/project-data-shapes",
      undefined,
      projectDataShapeListResponseSchema,
    )
  ).plugins;
}

export function exportProjectsWithDataShape(
  pluginId: string,
  projects: ProjectDataShapeExportProject[],
) {
  const payload = projectDataShapeExportRequestSchema.parse({ projects });
  return appApiRequest(
    `/api/project-data-shapes/${encodeURIComponent(pluginId)}/export`,
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
    projectDataShapeExportResponseSchema,
  );
}

export function importProjectsWithDataShape(
  pluginId: string,
  datasets: ProjectDataShapeDataset[],
) {
  const payload = projectDataShapeImportRequestSchema.parse({ datasets });
  return appApiRequest(
    `/api/project-data-shapes/${encodeURIComponent(pluginId)}/import`,
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
    projectDataShapeImportResponseSchema,
  );
}

export function getCachedPluginsOverview() {
  return cachedPluginsOverview;
}

export function cachePluginsOverview(overview: PluginsOverview) {
  pluginsOverviewRevision += 1;
  cachedPluginsOverview = overview;
  for (const listener of pluginsOverviewListeners) listener(overview);
  return overview;
}

/** Observes validated snapshots, including background sync refreshes. */
export function subscribePluginsOverview(
  listener: (overview: PluginsOverview) => void,
) {
  pluginsOverviewListeners.add(listener);
  return () => {
    pluginsOverviewListeners.delete(listener);
  };
}

/**
 * The overview exactly as the local API answers this request, never a
 * cached or newer one, for checks that grant access.
 */
export function fetchPluginsOverview(): Promise<PluginsOverview> {
  return appApiRequest("/api/plugins", undefined, pluginsOverviewSchema);
}

export async function getPluginsOverview(): Promise<PluginsOverview> {
  const requestRevision = pluginsOverviewRevision;
  const requestId = ++latestPluginsOverviewRequest;
  const overview = await appApiRequest(
    "/api/plugins",
    undefined,
    pluginsOverviewSchema,
  );
  if (
    requestRevision !== pluginsOverviewRevision ||
    requestId !== latestPluginsOverviewRequest
  ) {
    return cachedPluginsOverview ?? overview;
  }

  return cachePluginsOverview(overview);
}

/** Turns the plugin on or off, or only `capability` when given. */
export async function setPluginEnabled(
  pluginId: string,
  enabled: boolean,
  capability?: SwitchableCapability,
): Promise<PluginsOverview> {
  const payload = pluginActivationUpdateSchema.parse({
    enabled,
    ...(capability ? { capability } : {}),
  });
  return cachePluginsOverview(
    await appApiRequest(
      `/api/plugins/${encodeURIComponent(pluginId)}/activation`,
      {
        method: "POST",
        body: JSON.stringify(payload),
      },
      pluginsOverviewSchema,
    ),
  );
}

export async function setPluginSystemEnabled(
  enabled: boolean,
): Promise<PluginsOverview> {
  const payload = pluginSystemActivationUpdateSchema.parse({ enabled });
  return cachePluginsOverview(
    await appApiRequest(
      "/api/plugins/activation",
      {
        method: "POST",
        body: JSON.stringify(payload),
      },
      pluginsOverviewSchema,
    ),
  );
}

export async function installPlugin(): Promise<PluginInstallResponse | null> {
  const install = window.ajourDesktop?.installPlugin;
  if (!install) {
    throw new Error(
      "Plugin installation is only available in the desktop app.",
    );
  }

  const result = await install();
  if (result === null) {
    return null;
  }

  const parsed = pluginInstallResponseSchema.parse(result);
  cachePluginsOverview(parsed.overview);
  return parsed;
}

export async function uninstallPlugin(pluginId: string) {
  const uninstall = window.ajourDesktop?.uninstallPlugin;
  if (!uninstall) {
    throw new Error(
      "Plugin uninstall is only available in the production desktop app.",
    );
  }

  const result = pluginUninstallResponseSchema.parse(await uninstall(pluginId));
  cachePluginsOverview(result.overview);
  return result;
}

export function getBacklogSourceStatuses() {
  return appApiRequest(
    "/api/backlog/source-statuses",
    undefined,
    backlogSourceStatusListResponseSchema,
  );
}

export function upsertBacklogSourceStatuses(items: BacklogSourceStatusInput[]) {
  const payload = backlogSourceStatusUpsertRequestSchema.parse({ items });
  return appApiRequest(
    "/api/backlog/source-statuses",
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
    backlogSourceStatusUpsertResponseSchema,
  );
}

export async function savePluginConnection(
  pluginId: string,
  values: PluginFieldValues,
  id?: string,
): Promise<PluginConnectionSaveResponse> {
  const payload = pluginConnectionSaveRequestSchema.parse({ id, values });
  const result = await appApiRequest(
    `/api/plugins/${encodeURIComponent(pluginId)}/connections`,
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
    pluginConnectionSaveResponseSchema,
  );
  cachePluginsOverview(result.overview);
  if (id) {
    const key = connectionKey(pluginId, id);
    connectionGenerations.set(key, (connectionGenerations.get(key) ?? 0) + 1);
  }
  return result;
}

export async function deletePluginConnection(
  pluginId: string,
  connectionId: string,
): Promise<PluginsOverview> {
  const key = connectionKey(pluginId, connectionId);
  connectionGenerations.set(key, (connectionGenerations.get(key) ?? 0) + 1);
  const overview = cachePluginsOverview(
    await appApiRequest(
      `/api/plugins/${encodeURIComponent(pluginId)}/connections/${encodeURIComponent(connectionId)}`,
      {
        method: "DELETE",
      },
      pluginsOverviewSchema,
    ),
  );
  localStore.removeConnectionPullRequests(pluginId, connectionId);
  localStore.removeConnectionCalendarData(pluginId, connectionId);
  localStore.removeConnectionTeamData(connectionId);
  return overview;
}

/** A page of a synced item's comments, newest last (ADR 0008). */
/**
 * An agent's comment call carries `agent=1`, so the local API enforces the
 * connection's agent access at the operation (ADR 0004).
 */
type CommentCaller = { agent?: boolean };
const agentQuery = (caller?: CommentCaller) =>
  caller?.agent ? "?agent=1" : "";

export function listItemComments(
  pluginId: string,
  connectionId: string,
  request: BacklogListItemCommentsRequest,
  caller?: CommentCaller,
): Promise<BacklogListItemCommentsResult> {
  return appApiRequest(
    `/api/backlog-comments/${encodeURIComponent(pluginId)}/connections/${encodeURIComponent(connectionId)}/listItemComments${agentQuery(caller)}`,
    { method: "POST", body: JSON.stringify(request) },
    backlogListItemCommentsResultSchema,
  );
}

/** Posts a comment on a synced item at once (ADR 0008). */
export function postItemComment(
  pluginId: string,
  connectionId: string,
  request: BacklogPostItemCommentRequest,
  caller?: CommentCaller,
): Promise<BacklogPostItemCommentResult> {
  return appApiRequest(
    `/api/backlog-comments/${encodeURIComponent(pluginId)}/connections/${encodeURIComponent(connectionId)}/postItemComment${agentQuery(caller)}`,
    { method: "POST", body: JSON.stringify(request) },
    backlogPostItemCommentResultSchema,
  );
}

function commentOperationPath(
  pluginId: string,
  connectionId: string,
  operation: string,
) {
  return `/api/backlog-comments/${encodeURIComponent(pluginId)}/connections/${encodeURIComponent(connectionId)}/${operation}`;
}

/** Edits one of the user's comments at once (ADR 0008). */
export function editItemComment(
  pluginId: string,
  connectionId: string,
  request: BacklogEditItemCommentRequest,
): Promise<BacklogEditItemCommentResult> {
  return appApiRequest(
    commentOperationPath(pluginId, connectionId, "editItemComment"),
    { method: "POST", body: JSON.stringify(request) },
    backlogEditItemCommentResultSchema,
  );
}

/** Deletes one of the user's comments. Ajour calls it after the Undo window. */
export async function deleteItemComment(
  pluginId: string,
  connectionId: string,
  request: BacklogDeleteItemCommentRequest,
): Promise<void> {
  await appApiRequest(
    commentOperationPath(pluginId, connectionId, "deleteItemComment"),
    { method: "POST", body: JSON.stringify(request) },
    backlogDeleteItemCommentResultSchema,
  );
}

/** People the user can mention on the item, for the editor's @ suggestions. */
export function searchItemPeople(
  pluginId: string,
  connectionId: string,
  request: BacklogSearchItemPeopleRequest,
): Promise<BacklogSearchItemPeopleResult> {
  return appApiRequest(
    commentOperationPath(pluginId, connectionId, "searchItemPeople"),
    { method: "POST", body: JSON.stringify(request) },
    backlogSearchItemPeopleResultSchema,
  );
}

/** Adds or removes the user's reaction on a comment. */
export function setItemCommentReaction(
  pluginId: string,
  connectionId: string,
  request: BacklogSetItemCommentReactionRequest,
): Promise<BacklogSetItemCommentReactionResult> {
  return appApiRequest(
    commentOperationPath(pluginId, connectionId, "setItemCommentReaction"),
    { method: "POST", body: JSON.stringify(request) },
    backlogSetItemCommentReactionResultSchema,
  );
}

/** One connection's calendar events for a range of days (ADR 0005). */
export function listCalendarEvents(
  pluginId: string,
  connectionId: string,
  request: CalendarListEventsRequest,
): Promise<CalendarListEventsResult> {
  return appApiRequest(
    `/api/calendars/${encodeURIComponent(pluginId)}/connections/${encodeURIComponent(connectionId)}/listCalendarEvents`,
    { method: "POST", body: JSON.stringify(request) },
    calendarListEventsResultSchema,
  );
}

/**
 * Creates a team from the connection form's values, before the connection is
 * saved. The result holds the values that join it, such as its ID and secret.
 */
export function createTeam(
  pluginId: string,
  request: TeamCreateRouteRequest,
): Promise<TeamCreateResult> {
  return appApiRequest(
    `/api/teams/${encodeURIComponent(pluginId)}/create`,
    { method: "POST", body: JSON.stringify(request) },
    teamCreateResultSchema,
  );
}

/** One round of a team sync. `lib/team-sync.ts` runs the rounds. */
export function runTeamSyncRound(
  pluginId: string,
  connectionId: string,
  request: TeamSyncRequest,
): Promise<TeamSyncResult> {
  return appApiRequest(
    `/api/teams/${encodeURIComponent(pluginId)}/connections/${encodeURIComponent(connectionId)}/sync`,
    { method: "POST", body: JSON.stringify(request) },
    teamSyncResultSchema,
  );
}

export function syncBacklogConnection(
  pluginId: string,
  connectionId: string,
  input?: Pick<BacklogSyncRequest, "trigger">,
): Promise<SyncBacklogConnectionResult> {
  const syncedWorkItems = localStore
    .snapshot()
    .workItems.filter(
      (workItem) =>
        workItem.source === pluginId &&
        workItem.sourceConnectionId === connectionId &&
        typeof workItem.sourceId === "string",
    )
    .map(
      (workItem) =>
        ({
          localWorkItemId: workItem._id,
          sourceId: workItem.sourceId!,
          originalEstimateHours: workItem.originalEstimateHours,
          remainingEstimateHours: workItem.remainingEstimateHours,
          completedEstimateHours: workItem.completedEstimateHours,
          // A settled item waits on someone; their comment brings it back.
          commentsSince:
            workItem.status === "settled" && workItem.settledAt
              ? new Date(workItem.settledAt).toISOString()
              : undefined,
          estimateSync: workItem.estimateSync
            ? {
                originalEstimateHours: workItem.estimateSync
                  .originalEstimateHours
                  ? {
                      baselineValue:
                        workItem.estimateSync.originalEstimateHours
                          .baselineValue,
                      remoteValue:
                        workItem.estimateSync.originalEstimateHours.remoteValue,
                      resolution:
                        workItem.estimateSync.originalEstimateHours.resolution,
                    }
                  : undefined,
                remainingEstimateHours: workItem.estimateSync
                  .remainingEstimateHours
                  ? {
                      baselineValue:
                        workItem.estimateSync.remainingEstimateHours
                          .baselineValue,
                      remoteValue:
                        workItem.estimateSync.remainingEstimateHours
                          .remoteValue,
                      resolution:
                        workItem.estimateSync.remainingEstimateHours.resolution,
                    }
                  : undefined,
                completedEstimateHours: workItem.estimateSync
                  .completedEstimateHours
                  ? {
                      baselineValue:
                        workItem.estimateSync.completedEstimateHours
                          .baselineValue,
                      remoteValue:
                        workItem.estimateSync.completedEstimateHours
                          .remoteValue,
                      resolution:
                        workItem.estimateSync.completedEstimateHours.resolution,
                    }
                  : undefined,
              }
            : undefined,
        }) satisfies BacklogSyncWorkItem,
    );
  const payload = backlogSyncRequestSchema.parse({
    ...(input ?? { trigger: "manual" }),
    workItems: syncedWorkItems,
  });
  return appApiRequest(
    `/api/plugins/${encodeURIComponent(pluginId)}/connections/${encodeURIComponent(connectionId)}/sync`,
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
    backlogSyncResultSchema,
  ).then((result) => {
    // The items still in the settle this sync asked about, before its answer
    // changes any of them.
    const asked = new Map(
      payload.workItems.flatMap((workItem) =>
        workItem.commentsSince
          ? [
              [
                workItem.localWorkItemId,
                Date.parse(workItem.commentsSince),
              ] as const,
            ]
          : [],
      ),
    );
    const stillSettled = new Set(
      localStore
        .snapshot()
        .workItems.filter(
          (workItem) =>
            workItem.status === "settled" &&
            asked.get(workItem._id) === workItem.settledAt,
        )
        .map((workItem) => workItem._id),
    );
    // Items in a description conflict before the answer, so the app can tell
    // which ones it put there.
    const beforeSync = localStore.snapshot().workItems;
    // Done items go first, so a done item that left the open set is archived
    // as done rather than as missing from the sync.
    localStore.archiveDoneSyncedWorkItems(result.doneItems);
    const importResult =
      result.mode === "backlog"
        ? localStore.importSyncedWorkItems(result.items, {
            archiveMissingFromConnectionId:
              payload.trigger === "auto" ? connectionId : undefined,
          })
        : { importedCount: 0, updatedCount: 0 };
    localStore.applyBacklogSyncWorkItemUpdates(result.workItemUpdates);
    announceDescriptionConflicts(
      newDescriptionConflicts(beforeSync, localStore.snapshot().workItems),
    );
    if (result.viewer && result.commentFacts.length > 0) {
      // Returned by this answer's import: settled before it, active after.
      const returnedBySync = new Set(
        localStore
          .snapshot()
          .workItems.filter(
            (workItem) =>
              stillSettled.has(workItem._id) &&
              workItem.status === "active" &&
              workItem.returnedAt !== undefined,
          )
          .map((workItem) => workItem._id),
      );
      localStore.returnItemsWithNewComments(
        result.commentFacts,
        result.viewer,
        { settledSince: asked, returnedBySync },
      );
    }

    return {
      ...result,
      backlogImportedCount: importResult.importedCount,
      backlogUpdatedCount: importResult.updatedCount,
    };
  });
}

/** The states a backlog item can move to, for the settle dialog. */
export function listBacklogSettleStates(
  pluginId: string,
  connectionId: string,
  sourceId: string,
) {
  return appApiRequest(
    `/api/plugins/${encodeURIComponent(pluginId)}/connections/${encodeURIComponent(connectionId)}/settle-states`,
    {
      method: "POST",
      body: JSON.stringify(
        backlogSettleStatesRequestSchema.parse({ sourceId }),
      ),
    },
    backlogSettleStatesResultSchema,
  );
}

/** Writes a settle's changed state and priority to the source. */
export function writeBacklogSettle(
  pluginId: string,
  connectionId: string,
  request: BacklogSettleWriteRequest,
) {
  return appApiRequest(
    `/api/plugins/${encodeURIComponent(pluginId)}/connections/${encodeURIComponent(connectionId)}/settle`,
    {
      method: "POST",
      body: JSON.stringify(backlogSettleWriteRequestSchema.parse(request)),
    },
    backlogSettleWriteResultSchema,
  );
}

export function listBacklogImportCandidates() {
  return appApiRequest(
    "/api/backlog/imports",
    undefined,
    backlogImportListResponseSchema,
  );
}

export function updateBacklogImportSelection(ids: string[], selected: boolean) {
  const payload = backlogImportSelectionUpdateSchema.parse({ ids, selected });
  return appApiRequest(
    "/api/backlog/imports/selection",
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
    backlogImportSelectionResponseSchema,
  );
}

/** Dismisses staged items. The response's `undoToken` restores them. */
export function dismissBacklogImportCandidates(ids: string[]) {
  const payload = backlogImportDismissRequestSchema.parse({ ids });
  return appApiRequest(
    "/api/backlog/imports/dismiss",
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
    backlogImportDismissResponseSchema,
  );
}

/** Puts the staged items of the last dismissal back in review. */
export async function restoreDismissedBacklogImports(undoToken: string) {
  const payload = backlogImportRestoreRequestSchema.parse({ undoToken });
  const { result } = await appApiRequest(
    "/api/backlog/imports/restore",
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
    backlogImportRestoreResponseSchema,
  );
  return result;
}

export async function commitSelectedBacklogImportsToLocalStore() {
  const committed = await appApiRequest(
    "/api/backlog/imports/commit-selected",
    {
      method: "POST",
      body: JSON.stringify({}),
    },
    backlogImportCommitResponseSchema,
  );

  const importResult = localStore.importSyncedWorkItems(committed.items);
  return {
    ...importResult,
    committedCount: committed.committedCount,
  };
}

export function buildImportHierarchy(items: BacklogImportCandidate[]) {
  const itemsBySourceId = new Map(
    items.map((item) => [item.sourceId, item] as const),
  );
  const childrenByParent = new Map<string, BacklogImportCandidate[]>();

  for (const item of items) {
    if (!item.parentSourceId) {
      continue;
    }

    const siblings = childrenByParent.get(item.parentSourceId) ?? [];
    siblings.push(item);
    childrenByParent.set(item.parentSourceId, siblings);
  }

  for (const siblings of childrenByParent.values()) {
    siblings.sort((left, right) => left.title.localeCompare(right.title));
  }

  const roots = items.filter(
    (item) => !item.parentSourceId || !itemsBySourceId.has(item.parentSourceId),
  );

  return roots.map((item) => ({
    item,
    children: childrenByParent.get(item.sourceId) ?? [],
  }));
}

export async function getAgentRunner() {
  return appApiRequest("/api/agents", undefined, agentRunnerOverviewSchema);
}

export async function updateAgentRunnerSettings(
  patch: Partial<AgentRunnerSettings>,
) {
  return appApiRequest(
    "/api/agents/settings",
    { method: "POST", body: JSON.stringify(patch) },
    agentRunnerOverviewSchema,
  );
}

/** Saves the settings every agent task of the plugin shares. */
export async function saveAgentTaskSettings(
  pluginId: string,
  values: PluginFieldValues,
) {
  return appApiRequest(
    `/api/agents/plugins/${encodeURIComponent(pluginId)}/settings`,
    { method: "POST", body: JSON.stringify({ values }) },
    agentRunnerOverviewSchema,
  );
}

export async function startAgentRun(request: AgentRunStartRequest) {
  return appApiRequest(
    "/api/agent-runs",
    { method: "POST", body: JSON.stringify(request) },
    agentRunSchema,
  );
}

export async function getMcpSettings() {
  return appApiRequest("/api/mcp/settings", undefined, mcpSettingsSchema);
}

export async function updateMcpSettings(enabled: boolean) {
  return appApiRequest(
    "/api/mcp/settings",
    { method: "POST", body: JSON.stringify({ enabled }) },
    mcpSettingsSchema,
  );
}

/** Creates an agent client. The response holds its token, shown once. */
export async function createMcpClient(name: string) {
  return appApiRequest(
    "/api/mcp/clients",
    { method: "POST", body: JSON.stringify({ name }) },
    mcpClientCreateResponseSchema,
  );
}

export async function revokeMcpClient(clientId: string) {
  return appApiRequest(
    `/api/mcp/clients/${encodeURIComponent(clientId)}/revoke`,
    { method: "POST", body: "{}" },
    mcpSettingsSchema,
  );
}

export async function postMcpBridgeResult(result: BridgeToolResult) {
  return appApiRequest(
    "/api/mcp/bridge/results",
    { method: "POST", body: JSON.stringify(result) },
    mcpBridgeResultAckSchema,
  );
}

/** Answers an agent's open question. Returns the new agents snapshot. */
export async function answerAgentQuestion(questionId: string, text: string) {
  return appApiRequest(
    `/api/mcp/questions/${encodeURIComponent(questionId)}/answer`,
    { method: "POST", body: JSON.stringify({ text }) },
    agentsSnapshotSchema,
  );
}

/** Ends an agent session the user no longer waits for. Returns the new snapshot. */
export async function dismissAgentSession(sessionId: string) {
  return appApiRequest(
    `/api/mcp/sessions/${encodeURIComponent(sessionId)}/dismiss`,
    { method: "POST", body: "{}" },
    agentsSnapshotSchema,
  );
}

/** Stops the agent run Ajour started. Returns the new snapshot. */
export async function stopAgentRun(runId: string) {
  return appApiRequest(
    `/api/agent-runs/${encodeURIComponent(runId)}/stop`,
    { method: "POST", body: "{}" },
    agentsSnapshotSchema,
  );
}

/** Marks past agent errors and failures as seen. Returns the new snapshot. */
export async function markAgentsSeen() {
  return appApiRequest(
    "/api/mcp/seen",
    { method: "POST", body: "{}" },
    agentsSnapshotSchema,
  );
}
