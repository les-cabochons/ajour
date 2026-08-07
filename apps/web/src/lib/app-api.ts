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
  connectorSyncRequestSchema,
  connectorSyncResultSchema,
  type ConnectorSyncRequest,
  connectorImportCommitResponseSchema,
  connectorImportDismissRequestSchema,
  connectorImportDismissResponseSchema,
  connectorImportListResponseSchema,
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
} from "@timetracker/shared";
import {
  catalogConnectorDownloadResponseSchema,
  pluginCatalogResponseSchema,
  pluginCatalogSettingsSchema,
} from "@timetracker/shared";
import type { PluginCatalogSettings } from "@timetracker/shared";
import {
  projectDataShapeExportRequestSchema,
  projectDataShapeExportResponseSchema,
  projectDataShapeImportRequestSchema,
  projectDataShapeImportResponseSchema,
  projectDataShapeListResponseSchema,
  type ProjectDataShapeDataset,
  type ProjectDataShapeExportProject,
} from "@timetracker/shared";
import { localStore } from "@/lib/local-store";

export type SyncConnectorConnectionResult = ConnectorSyncResult & {
  backlogImportedCount: number;
  backlogUpdatedCount: number;
};

const DEFAULT_INTERNAL_APP_API_BASE_URL = "http://127.0.0.1:8787";
const APP_API_BASE_URL = (import.meta.env.VITE_APP_API_BASE_URL ?? DEFAULT_INTERNAL_APP_API_BASE_URL).replace(/\/+$/, "");
const APP_API_RETRY_DELAYS_MS = [150, 350] as const;
let cachedConnectorsOverview: ConnectorsOverview | null = null;
let connectorsOverviewRevision = 0;

function appApiUnavailableMessage() {
  return "Internal connector API unavailable. Restart the app.";
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

  for (let attempt = 0; attempt <= APP_API_RETRY_DELAYS_MS.length; attempt += 1) {
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
      if (!isDefaultInternalAppApi() || attempt === APP_API_RETRY_DELAYS_MS.length) {
        throw new Error(
          `${appApiUnavailableMessage()} ${error instanceof Error ? error.message : ""}`.trim(),
        );
      }

      const retryDelayMs = APP_API_RETRY_DELAYS_MS[attempt];
      if (retryDelayMs === undefined) {
        throw new Error(
          `${appApiUnavailableMessage()} ${error instanceof Error ? error.message : ""}`.trim(),
        );
      }

      await delay(retryDelayMs);
    }
  }

  if (lastNetworkError !== undefined || !response) {
    throw new Error(
      `${appApiUnavailableMessage()} ${lastNetworkError instanceof Error ? lastNetworkError.message : ""}`.trim(),
    );
  }

  if (!response.ok) {
    let detail = response.statusText || "Request failed";
    try {
      const payload = (await response.json()) as { error?: string };
      if (typeof payload.error === "string" && payload.error.trim().length > 0) {
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
  const getCatalog = window.timetrackerDesktop?.getPluginCatalog;
  if (!getCatalog) {
    throw new Error("The plugin catalog is available in the desktop app.");
  }
  return pluginCatalogResponseSchema.parse(await getCatalog());
}

export async function getPluginCatalogSettings() {
  const getSettings = window.timetrackerDesktop?.getPluginCatalogSettings;
  if (!getSettings) {
    return pluginCatalogSettingsSchema.parse({ refreshMinutes: 15 });
  }
  return pluginCatalogSettingsSchema.parse(await getSettings());
}

export async function configurePluginCatalog(settings: PluginCatalogSettings) {
  const configure = window.timetrackerDesktop?.configurePluginCatalog;
  if (!configure) {
    throw new Error("Plugin catalog settings are available in the desktop app.");
  }
  return pluginCatalogSettingsSchema.parse(await configure(settings));
}

export async function downloadCatalogPlugin(pluginId: string) {
  const download = window.timetrackerDesktop?.downloadCatalogPlugin;
  if (!download) {
    throw new Error("Plugin downloads are available in the production desktop app.");
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
  return overview;
}

export async function getConnectorsOverview(): Promise<ConnectorsOverview> {
  const requestRevision = connectorsOverviewRevision;
  const overview = await appApiRequest(
    "/api/connectors",
    undefined,
    connectorsOverviewSchema,
  );
  if (
    requestRevision !== connectorsOverviewRevision &&
    cachedConnectorsOverview
  ) {
    return cachedConnectorsOverview;
  }

  cachedConnectorsOverview = overview;
  return overview;
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
  const install = window.timetrackerDesktop?.installConnectorPlugin;
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
  const uninstall = window.timetrackerDesktop?.uninstallConnectorPlugin;
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

export function upsertConnectorBacklogStatuses(items: ConnectorBacklogStatusInput[]) {
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
  return result;
}

export async function deleteConnectorConnection(
  pluginId: string,
  connectionId: string,
): Promise<ConnectorsOverview> {
  return cacheConnectorsOverview(
    await appApiRequest(
      `/api/connectors/${encodeURIComponent(pluginId)}/connections/${encodeURIComponent(connectionId)}`,
      {
        method: "DELETE",
      },
      connectorsOverviewSchema,
    ),
  );
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
    .map((workItem) => ({
      localWorkItemId: workItem._id,
      sourceId: workItem.sourceId!,
      originalEstimateHours: workItem.originalEstimateHours,
      remainingEstimateHours: workItem.remainingEstimateHours,
      completedEstimateHours: workItem.completedEstimateHours,
      estimateSync: workItem.estimateSync
        ? {
            originalEstimateHours: workItem.estimateSync.originalEstimateHours
              ? {
                  baselineValue: workItem.estimateSync.originalEstimateHours.baselineValue,
                  remoteValue: workItem.estimateSync.originalEstimateHours.remoteValue,
                  resolution: workItem.estimateSync.originalEstimateHours.resolution,
                }
              : undefined,
            remainingEstimateHours: workItem.estimateSync.remainingEstimateHours
              ? {
                  baselineValue: workItem.estimateSync.remainingEstimateHours.baselineValue,
                  remoteValue: workItem.estimateSync.remainingEstimateHours.remoteValue,
                  resolution: workItem.estimateSync.remainingEstimateHours.resolution,
                }
              : undefined,
            completedEstimateHours: workItem.estimateSync.completedEstimateHours
              ? {
                  baselineValue: workItem.estimateSync.completedEstimateHours.baselineValue,
                  remoteValue: workItem.estimateSync.completedEstimateHours.remoteValue,
                  resolution: workItem.estimateSync.completedEstimateHours.resolution,
                }
              : undefined,
          }
        : undefined,
    } satisfies ConnectorSyncWorkItem));
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
    const importResult =
      result.mode === "backlog"
        ? localStore.importConnectorWorkItems(result.items, {
            archiveMissingFromConnectionId: payload.trigger === "auto" ? connectionId : undefined,
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

export function listConnectorImportCandidates() {
  return appApiRequest("/api/backlog/imports", undefined, connectorImportListResponseSchema);
}

export function updateConnectorImportSelection(ids: string[], selected: boolean) {
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
  const itemsBySourceId = new Map(items.map((item) => [item.sourceId, item] as const));
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

  const roots = items.filter((item) => !item.parentSourceId || !itemsBySourceId.has(item.parentSourceId));

  return roots.map((item) => ({
    item,
    children: childrenByParent.get(item.sourceId) ?? [],
  }));
}
