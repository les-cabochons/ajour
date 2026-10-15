import {
  connectorBacklogStatusListResponseSchema,
  connectorBacklogStatusUpsertRequestSchema,
  connectorBacklogStatusUpsertResponseSchema,
  connectorConnectionSaveResponseSchema,
  connectorConnectionSaveRequestSchema,
  connectorPluginActivationUpdateSchema,
  pluginSystemActivationUpdateSchema,
  connectorPluginInstallResponseSchema,
  connectorPluginUninstallResponseSchema,
  connectorSettleStatesRequestSchema,
  connectorSettleStatesResultSchema,
  connectorSettleWriteRequestSchema,
  connectorSettleWriteResultSchema,
  connectorSyncRequestSchema,
  connectorSyncResultSchema,
  type ConnectorSettleWriteRequest,
  type ConnectorSyncRequest,
  connectorImportCommitResponseSchema,
  connectorImportDismissRequestSchema,
  connectorImportDismissResponseSchema,
  connectorImportListResponseSchema,
  connectorImportRestoreRequestSchema,
  connectorImportRestoreResponseSchema,
  connectorImportSelectionResponseSchema,
  connectorImportSelectionUpdateSchema,
  connectorsOverviewSchema,
  type ConnectorBacklogStatusInput,
  type ConnectorConnectionSaveResponse,
  type ConnectorFieldValues,
  type ConnectorImportCandidate,
  type ConnectorPluginInstallResponse,
  type ConnectorSyncWorkItem,
  type ConnectorsOverview,
  type ConnectorSyncResult,
} from "@ajour/shared";
import {
  catalogConnectorDownloadResponseSchema,
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
import { localStore } from "@/lib/local-store";
import {
  codeHostSyncResultSchema,
  pluginHasCodeHost,
  type CodeHostSyncResult,
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
    await getConnectorsOverview();
    const overview = getCachedConnectorsOverview()!;
    const group = overview.connectionGroups.find(
      (entry) => entry.plugin.id === pluginId,
    );
    const connection = group?.connections.find(
      (entry) => entry.id === connectionId,
    );
    if (
      (connectionGenerations.get(key) ?? 0) !== generation ||
      overview.pluginsEnabled === false ||
      !group?.enabled ||
      !pluginHasCodeHost(group.plugin) ||
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

export type SyncConnectorConnectionResult = ConnectorSyncResult & {
  backlogImportedCount: number;
  backlogUpdatedCount: number;
};

const DEFAULT_INTERNAL_APP_API_BASE_URL = "http://127.0.0.1:8787";
const APP_API_BASE_URL = (
  import.meta.env.VITE_APP_API_BASE_URL ?? DEFAULT_INTERNAL_APP_API_BASE_URL
).replace(/\/+$/, "");
const APP_API_RETRY_DELAYS_MS = [150, 350] as const;
let cachedConnectorsOverview: ConnectorsOverview | null = null;
let connectorsOverviewRevision = 0;
let latestConnectorsOverviewRequest = 0;
const connectorsOverviewListeners = new Set<
  (overview: ConnectorsOverview) => void
>();

/**
 * Thrown when the local connector API cannot be reached at all, as in the web
 * build that runs without the desktop app. Pages use it to hide connector
 * features calmly instead of showing a failure.
 */
class AppApiUnavailableError extends Error {
  constructor(cause: unknown) {
    super(
      `Internal connector API unavailable. Restart the app. ${cause instanceof Error ? cause.message : ""}`.trim(),
      { cause },
    );
    this.name = "AppApiUnavailableError";
  }
}

/**
 * True when the connector API is unreachable because Ajour runs as a plain web
 * app. In the desktop app the API is internal, so an unreachable API stays a
 * real failure that the page reports.
 */
export function isConnectorApiMissing(error: unknown) {
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
  const result = catalogConnectorDownloadResponseSchema.parse(
    await download(pluginId),
  );
  cacheConnectorsOverview(result.result.overview);
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

export function getCachedConnectorsOverview() {
  return cachedConnectorsOverview;
}

export function cacheConnectorsOverview(overview: ConnectorsOverview) {
  connectorsOverviewRevision += 1;
  cachedConnectorsOverview = overview;
  for (const listener of connectorsOverviewListeners) listener(overview);
  return overview;
}

/** Observes validated snapshots, including background sync refreshes. */
export function subscribeConnectorsOverview(
  listener: (overview: ConnectorsOverview) => void,
) {
  connectorsOverviewListeners.add(listener);
  return () => {
    connectorsOverviewListeners.delete(listener);
  };
}

export async function getConnectorsOverview(): Promise<ConnectorsOverview> {
  const requestRevision = connectorsOverviewRevision;
  const requestId = ++latestConnectorsOverviewRequest;
  const overview = await appApiRequest(
    "/api/connectors",
    undefined,
    connectorsOverviewSchema,
  );
  if (
    requestRevision !== connectorsOverviewRevision ||
    requestId !== latestConnectorsOverviewRequest
  ) {
    return cachedConnectorsOverview ?? overview;
  }

  return cacheConnectorsOverview(overview);
}

export async function setConnectorPluginEnabled(
  pluginId: string,
  enabled: boolean,
): Promise<ConnectorsOverview> {
  const payload = connectorPluginActivationUpdateSchema.parse({ enabled });
  return cacheConnectorsOverview(
    await appApiRequest(
      `/api/connectors/${encodeURIComponent(pluginId)}/activation`,
      {
        method: "POST",
        body: JSON.stringify(payload),
      },
      connectorsOverviewSchema,
    ),
  );
}

export async function setPluginSystemEnabled(
  enabled: boolean,
): Promise<ConnectorsOverview> {
  const payload = pluginSystemActivationUpdateSchema.parse({ enabled });
  return cacheConnectorsOverview(
    await appApiRequest(
      "/api/plugins/activation",
      {
        method: "POST",
        body: JSON.stringify(payload),
      },
      connectorsOverviewSchema,
    ),
  );
}

export async function installConnectorPlugin(): Promise<ConnectorPluginInstallResponse | null> {
  const install = window.ajourDesktop?.installConnectorPlugin;
  if (!install) {
    throw new Error(
      "Connector plugin installation is only available in the desktop app.",
    );
  }

  const result = await install();
  if (result === null) {
    return null;
  }

  const parsed = connectorPluginInstallResponseSchema.parse(result);
  cacheConnectorsOverview(parsed.overview);
  return parsed;
}

export async function uninstallConnectorPlugin(pluginId: string) {
  const uninstall = window.ajourDesktop?.uninstallConnectorPlugin;
  if (!uninstall) {
    throw new Error(
      "Connector plugin uninstall is only available in the production desktop app.",
    );
  }

  const result = connectorPluginUninstallResponseSchema.parse(
    await uninstall(pluginId),
  );
  cacheConnectorsOverview(result.overview);
  return result;
}

export function getConnectorBacklogStatuses() {
  return appApiRequest(
    "/api/backlog/source-statuses",
    undefined,
    connectorBacklogStatusListResponseSchema,
  );
}

export function upsertConnectorBacklogStatuses(
  items: ConnectorBacklogStatusInput[],
) {
  const payload = connectorBacklogStatusUpsertRequestSchema.parse({ items });
  return appApiRequest(
    "/api/backlog/source-statuses",
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
    connectorBacklogStatusUpsertResponseSchema,
  );
}

export async function saveConnectorConnection(
  pluginId: string,
  values: ConnectorFieldValues,
  id?: string,
): Promise<ConnectorConnectionSaveResponse> {
  const payload = connectorConnectionSaveRequestSchema.parse({ id, values });
  const result = await appApiRequest(
    `/api/connectors/${encodeURIComponent(pluginId)}/connections`,
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
    connectorConnectionSaveResponseSchema,
  );
  cacheConnectorsOverview(result.overview);
  if (id) {
    const key = connectionKey(pluginId, id);
    connectionGenerations.set(key, (connectionGenerations.get(key) ?? 0) + 1);
  }
  return result;
}

export async function deleteConnectorConnection(
  pluginId: string,
  connectionId: string,
): Promise<ConnectorsOverview> {
  const key = connectionKey(pluginId, connectionId);
  connectionGenerations.set(key, (connectionGenerations.get(key) ?? 0) + 1);
  const overview = cacheConnectorsOverview(
    await appApiRequest(
      `/api/connectors/${encodeURIComponent(pluginId)}/connections/${encodeURIComponent(connectionId)}`,
      {
        method: "DELETE",
      },
      connectorsOverviewSchema,
    ),
  );
  localStore.removeConnectionPullRequests(pluginId, connectionId);
  return overview;
}

export function syncConnectorConnection(
  pluginId: string,
  connectionId: string,
  input?: Pick<ConnectorSyncRequest, "trigger">,
): Promise<SyncConnectorConnectionResult> {
  const connectorWorkItems = localStore
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
        }) satisfies ConnectorSyncWorkItem,
    );
  const payload = connectorSyncRequestSchema.parse({
    ...(input ?? { trigger: "manual" }),
    workItems: connectorWorkItems,
  });
  return appApiRequest(
    `/api/connectors/${encodeURIComponent(pluginId)}/connections/${encodeURIComponent(connectionId)}/sync`,
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
    connectorSyncResultSchema,
  ).then((result) => {
    // Done items go first, so a done item that left the open set is archived
    // as done rather than as missing from the sync.
    localStore.archiveDoneConnectorWorkItems(result.doneItems);
    const importResult =
      result.mode === "backlog"
        ? localStore.importConnectorWorkItems(result.items, {
            archiveMissingFromConnectionId:
              payload.trigger === "auto" ? connectionId : undefined,
          })
        : { importedCount: 0, updatedCount: 0 };
    localStore.applyConnectorSyncWorkItemUpdates(result.workItemUpdates);

    return {
      ...result,
      backlogImportedCount: importResult.importedCount,
      backlogUpdatedCount: importResult.updatedCount,
    };
  });
}

/** The states a backlog item can move to, for the settle dialog. */
export function listConnectorSettleStates(
  pluginId: string,
  connectionId: string,
  sourceId: string,
) {
  return appApiRequest(
    `/api/connectors/${encodeURIComponent(pluginId)}/connections/${encodeURIComponent(connectionId)}/settle-states`,
    {
      method: "POST",
      body: JSON.stringify(
        connectorSettleStatesRequestSchema.parse({ sourceId }),
      ),
    },
    connectorSettleStatesResultSchema,
  );
}

/** Writes a settle's changed state and priority to the source. */
export function writeConnectorSettle(
  pluginId: string,
  connectionId: string,
  request: ConnectorSettleWriteRequest,
) {
  return appApiRequest(
    `/api/connectors/${encodeURIComponent(pluginId)}/connections/${encodeURIComponent(connectionId)}/settle`,
    {
      method: "POST",
      body: JSON.stringify(connectorSettleWriteRequestSchema.parse(request)),
    },
    connectorSettleWriteResultSchema,
  );
}

export function listConnectorImportCandidates() {
  return appApiRequest(
    "/api/backlog/imports",
    undefined,
    connectorImportListResponseSchema,
  );
}

export function updateConnectorImportSelection(
  ids: string[],
  selected: boolean,
) {
  const payload = connectorImportSelectionUpdateSchema.parse({ ids, selected });
  return appApiRequest(
    "/api/backlog/imports/selection",
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
    connectorImportSelectionResponseSchema,
  );
}

/** Dismisses staged items. The response's `undoToken` restores them. */
export function dismissConnectorImportCandidates(ids: string[]) {
  const payload = connectorImportDismissRequestSchema.parse({ ids });
  return appApiRequest(
    "/api/backlog/imports/dismiss",
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
    connectorImportDismissResponseSchema,
  );
}

/** Puts the staged items of the last dismissal back in review. */
export async function restoreDismissedConnectorImports(undoToken: string) {
  const payload = connectorImportRestoreRequestSchema.parse({ undoToken });
  const { result } = await appApiRequest(
    "/api/backlog/imports/restore",
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
    connectorImportRestoreResponseSchema,
  );
  return result;
}

export async function commitSelectedConnectorImportsToLocalStore() {
  const committed = await appApiRequest(
    "/api/backlog/imports/commit-selected",
    {
      method: "POST",
      body: JSON.stringify({}),
    },
    connectorImportCommitResponseSchema,
  );

  const importResult = localStore.importConnectorWorkItems(committed.items);
  return {
    ...importResult,
    committedCount: committed.committedCount,
  };
}

export function buildImportHierarchy(items: ConnectorImportCandidate[]) {
  const itemsBySourceId = new Map(
    items.map((item) => [item.sourceId, item] as const),
  );
  const childrenByParent = new Map<string, ConnectorImportCandidate[]>();

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

/** Marks past agent errors and failures as seen. Returns the new snapshot. */
export async function markAgentsSeen() {
  return appApiRequest(
    "/api/mcp/seen",
    { method: "POST", body: "{}" },
    agentsSnapshotSchema,
  );
}
