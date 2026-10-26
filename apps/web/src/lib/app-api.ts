import {
  backlogSourceStatusListResponseSchema,
  backlogSourceStatusUpsertRequestSchema,
  backlogSourceStatusUpsertResponseSchema,
  pluginConnectionSaveResponseSchema,
  pluginConnectionSaveRequestSchema,
  pluginActivationUpdateSchema,
  pluginRuntimeSettingsUpdateSchema,
  pluginSystemActivationUpdateSchema,
  type PluginRuntimeSettingsUpdate,
  unsignedPluginsActivationUpdateSchema,
  pluginInstallResponseSchema,
  pluginUninstallResponseSchema,
  backlogSettleStatesRequestSchema,
  backlogSettleStatesResultSchema,
  backlogSettleWriteRequestSchema,
  backlogSettleWriteResultSchema,
  backlogReadDescriptionRequestSchema,
  backlogReadDescriptionResultSchema,
  backlogWriteDescriptionRequestSchema,
  backlogWriteDescriptionResultSchema,
  backlogSyncRequestSchema,
  backlogSyncResultSchema,
  type BacklogSettleWriteRequest,
  type BacklogWriteDescriptionRequest,
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
  type BacklogSyncRequestWorkItem,
  type BacklogSyncRequestEstimateFieldState,
  type PluginsOverview,
  type BacklogSyncResult,
} from "@ajour/shared";
import { newDescriptionConflicts } from "@/domain/backlog/description-sync";
import type { LocalWorkItemEstimateFieldState } from "@/domain/local-state";
import { announceDescriptionConflicts } from "@/lib/sync-conflict-events";
import {
  catalogPluginDownloadOutcomeSchema,
  pluginSourceInspectionSchema,
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
  type ProjectDataShapeExportProject,
  type ProjectDataShapeSheet,
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
import {
  APP_API_CLIENT,
  catalog,
  type AjourCatalog,
  type ClientEventName,
} from "@ajour/wide-events/catalog.ts";
import type { Trigger, Unit } from "@ajour/wide-events";
import { localStore, startStoreCommandFor } from "@/lib/local-store";
import { traceCarrier, wideEvents } from "@/lib/wide-events";
import { describeConnectionDelete } from "@/lib/store-command-fields";
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

/**
 * Syncs a connection's pull requests as one `pull_request.sync` job. A
 * manual and a scheduled call share one run, and its event. An answer for a
 * connection removed, turned off or saved again meanwhile is not applied.
 */
export function syncCodeHostConnection(
  pluginId: string,
  connectionId: string,
  options: { trigger?: Extract<Trigger, "user" | "schedule"> } = {},
): Promise<CodeHostSyncResult> {
  const key = connectionKey(pluginId, connectionId);
  const pending = pullRequestSyncs.get(key);
  if (pending) return pending;
  const generation = connectionGenerations.get(key) ?? 0;
  const run = async (job: Unit<AjourCatalog, "pull_request.sync">) => {
    job.set({ plugin: { id: pluginId }, connection: { id: connectionId } });
    const request = (tracked: { repository: string; number: number }[]) => {
      job.set({ pull_request: { tracked_count: tracked.length } });
      return job.enter(() =>
        appApiRequest(
          "syncCodeHostConnection",
          `/api/code-hosts/${encodeURIComponent(pluginId)}/connections/${encodeURIComponent(connectionId)}/syncPullRequests`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ tracked }),
          },
          codeHostSyncResultSchema,
        ),
      );
    };
    const discard = (
      reason: "generation_changed" | "capability_off" | "connection_gone",
    ) => {
      job.set({ pull_request: { discarded: reason } }).end("noop");
    };
    let result = await request(
      trackedPullRequestRefs(
        localStore.snapshot().pullRequests ?? [],
        pluginId,
        [connectionId],
      ),
    );
    job.set({ pull_request: { received_count: result.pullRequests.length } });
    await job.enter(() => getPluginsOverview());
    const overview = getCachedPluginsOverview()!;
    const group = overview.connectionGroups.find(
      (entry) => entry.plugin.id === pluginId,
    );
    const connection = group?.connections.find(
      (entry) => entry.id === connectionId,
    );
    if ((connectionGenerations.get(key) ?? 0) !== generation) {
      discard("generation_changed");
      return result;
    }
    if (
      overview.pluginsEnabled === false ||
      (group && !isCapabilityActive(group, "codeHost"))
    ) {
      discard("capability_off");
      return result;
    }
    if (!group || !connection) {
      discard("connection_gone");
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
      job.set({ pull_request: { reattached: true } });
      result = await request(
        trackedPullRequestRefs(
          localStore.snapshot().pullRequests ?? [],
          pluginId,
          [connectionId, reattachFrom],
        ),
      );
      job.set({ pull_request: { received_count: result.pullRequests.length } });
      if ((connectionGenerations.get(key) ?? 0) !== generation) {
        discard("generation_changed");
        return result;
      }
    }
    job.enter(() =>
      localStore.syncPullRequests(
        source,
        result,
        reattachFrom ? { reattachFrom } : {},
      ),
    );
    return result;
  };
  const promise = wideEvents
    .run(
      "pull_request.sync",
      { kind: "job", trigger: options.trigger ?? "user", detached: true },
      run,
    )
    .finally(() => {
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
/** Where the local API listens, as agents reach its `/mcp`. */
const APP_API_BASE_URL = (
  import.meta.env.VITE_APP_API_BASE_URL ?? DEFAULT_INTERNAL_APP_API_BASE_URL
).replace(/\/+$/, "");
/**
 * Where the window sends its `/api` requests. The desktop app calls the API
 * directly, and main adds the window token. In the browser, the dev server's
 * proxy on the page's own origin adds it.
 */
const APP_API_REQUEST_BASE_URL =
  import.meta.env.VITE_APP_API_THROUGH_PROXY === "true" ? "" : APP_API_BASE_URL;
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
 * A request the local API answered with an error. The message is the API's
 * own; `status` keeps the HTTP status, so a caller can tell a paused
 * connection (409) from a failure of the service (502).
 */
export class AppApiError extends Error {
  readonly status: number;
  /** The access choice a refusal names, when the connection's access is off. */
  readonly accessOff?: string;

  constructor(message: string, status: number, accessOff?: string) {
    super(message);
    // `name` stays "Error": it is the `error.type` of the events a failed
    // call records, which a status doesn't change.
    this.status = status;
    if (accessOff) this.accessOff = accessOff;
  }
}

/** The HTTP status the local API answered a failed request with, if it did. */
export function appApiErrorStatus(error: unknown): number | undefined {
  return error instanceof AppApiError ? error.status : undefined;
}

/**
 * Whether the local API refused the call because the connection's access
 * doesn't include the choice it needs, such as editing work items (#395).
 * Such a write is held on this computer instead of dropped.
 */
export function isAccessOffError(error: unknown): error is AppApiError {
  return error instanceof AppApiError && error.accessOff !== undefined;
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

export { APP_API_CLIENT };

export type AppApiClientFunction = keyof typeof APP_API_CLIENT;

/** Polls running now: their calls open no unit of their own. */
let polls = 0;

/**
 * Runs `poll`, whose local API calls open no unit of their own: a poll, such
 * as the scheduler's tick, is not a unit of work. A call it makes inside a
 * unit still counts on that unit. Only the calls `poll` starts before its
 * first `await` are quiet.
 */
export function asPoll<Result>(poll: () => Result): Result {
  polls += 1;
  try {
    return poll();
  } finally {
    polls -= 1;
  }
}

/** The event a client function's call opens when no unit is active. */
type ClientEvent<Client extends AppApiClientFunction> =
  (typeof APP_API_CLIENT)[Client];

/**
 * A unit a client call opened, as any client event: each declares the
 * request fields, `http` among them.
 */
type ClientUnit = Unit<AjourCatalog, ClientEventName>;

/** The unit a call opens when no unit is active, named from the client table. */
function startClientUnit<Client extends AppApiClientFunction>(
  client: Client,
  method: string,
): Unit<AjourCatalog, ClientEvent<Client>> {
  const name = APP_API_CLIENT[client];
  const kinds: readonly string[] = catalog.events[name].kinds;
  const unit = wideEvents.start(name, {
    kind: (kinds.includes("command") ? "command" : "job") as never,
    trigger: "user",
  });
  const request: ClientUnit = unit;
  request.set({
    http: { method: method === "POST" || method === "DELETE" ? method : "GET" },
  });
  return unit;
}

/**
 * Calls the local API. Every call sends the active unit's `traceparent`, so
 * its request event joins the renderer's trace, and adds its attempts,
 * duration and failure to that unit's counters. A call made while no unit
 * is active is its own unit, named from `APP_API_CLIENT`, unless a poll
 * makes it. The active unit is the one on top of the scope when the call
 * starts: a job runs its calls inside its own `enter`.
 */
async function appApiRequest<Client extends AppApiClientFunction, T>(
  client: Client,
  path: string,
  init: RequestInit | undefined,
  schema: { parse: (value: unknown) => T },
  /** Adds the call's own fields to the unit it opens, typed as its event. */
  describe?: (unit: Unit<AjourCatalog, ClientEvent<Client>>) => void,
): Promise<T> {
  const active = wideEvents.current();
  const opened =
    active || polls > 0
      ? undefined
      : startClientUnit(client, init?.method ?? "GET");
  // Only a call that is its own unit names an item: a unit another seam
  // opened keeps the fields of its own event.
  if (opened) describe?.(opened);
  const own: ClientUnit | undefined = opened;
  const unit = active ?? own;
  const traceparent = unit?.traceparent();
  const startedAt = Date.now();
  let attempts = 0;
  let status: number | undefined;
  try {
    const result = await requestAppApi(
      path,
      {
        ...init,
        headers: {
          ...(traceparent ? { traceparent } : {}),
          ...init?.headers,
        },
      },
      schema,
      {
        attempted: () => {
          attempts += 1;
        },
        answered: (code) => {
          status = code;
        },
      },
    );
    own?.set({ http: { status_code: status } });
    return result;
  } catch (error) {
    unit?.count("api_failed_call_count");
    if (own) {
      own.set({ http: { status_code: status } }).fail(error);
      if (status !== undefined && status >= 400 && status < 500) own.refuse();
    }
    throw error;
  } finally {
    unit
      ?.count("api_call_count")
      .count("api_attempt_count", attempts)
      .count("api_call_ms", Date.now() - startedAt);
    own?.end();
  }
}

async function requestAppApi<T>(
  path: string,
  init: RequestInit,
  schema: { parse: (value: unknown) => T },
  observe: { attempted(): void; answered(status: number): void },
): Promise<T> {
  let response: Response | null = null;
  let lastNetworkError: unknown;

  for (
    let attempt = 0;
    attempt <= APP_API_RETRY_DELAYS_MS.length;
    attempt += 1
  ) {
    try {
      observe.attempted();
      response = await fetch(appApiUrl(path), {
        ...init,
        headers: {
          "Content-Type": "application/json",
          ...init.headers,
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

  observe.answered(response.status);
  if (!response.ok) {
    let detail = response.statusText || "Request failed";
    let accessOff: string | undefined;
    try {
      const payload = (await response.json()) as {
        error?: string;
        reason?: unknown;
        access?: unknown;
      };
      if (
        typeof payload.error === "string" &&
        payload.error.trim().length > 0
      ) {
        detail = payload.error.trim();
      }
      if (payload.reason === "access_off" && typeof payload.access === "string")
        accessOff = payload.access;
    } catch {
      // Ignore non-JSON error responses.
    }

    throw new AppApiError(detail, response.status, accessOff);
  }

  return parseJsonResponse(response, schema);
}

export function getAppApiBaseUrl() {
  return APP_API_BASE_URL;
}

/** The URL the window calls for an `/api` path. */
export function appApiUrl(path: string) {
  return `${APP_API_REQUEST_BASE_URL}${path}`;
}

export function getAppApiDescription() {
  return isDefaultInternalAppApi() ? "Internal app runtime" : APP_API_BASE_URL;
}

export async function getPluginCatalog() {
  const getCatalog = window.ajourDesktop?.getPluginCatalog;
  if (!getCatalog) {
    throw new Error("The plugin catalog is available in the desktop app.");
  }
  return pluginCatalogResponseSchema.parse(await getCatalog(traceCarrier()));
}

export async function getPluginCatalogSettings() {
  const getSettings = window.ajourDesktop?.getPluginCatalogSettings;
  if (!getSettings) {
    return pluginCatalogSettingsSchema.parse({
      refreshMinutes: 15,
      allowUnsignedInstalls: false,
    });
  }
  return pluginCatalogSettingsSchema.parse(await getSettings(traceCarrier()));
}

export async function configurePluginCatalog(settings: PluginCatalogSettings) {
  const configure = window.ajourDesktop?.configurePluginCatalog;
  if (!configure) {
    throw new Error(
      "Plugin catalog settings are available in the desktop app.",
    );
  }
  return pluginCatalogSettingsSchema.parse(
    await configure(settings, traceCarrier()),
  );
}

/** Null when the person cancelled at the unsigned plugin warning. */
export async function downloadCatalogPlugin(
  pluginId: string,
  sourceUrl?: string,
) {
  const download = window.ajourDesktop?.downloadCatalogPlugin;
  if (!download) {
    throw new Error(
      "Plugin downloads are available in the production desktop app.",
    );
  }
  const result = catalogPluginDownloadOutcomeSchema.parse(
    await download(pluginId, sourceUrl, traceCarrier()),
  );
  if (result) cachePluginsOverview(result.result.overview);
  return result;
}

function sourceBridge<
  Name extends "inspectPluginSource" | "addPluginSource" | "removePluginSource",
>(name: Name) {
  const method = window.ajourDesktop?.[name];
  if (!method) {
    throw new Error("Plugin sources are available in the desktop app.");
  }
  return method;
}

/** Reads a plugin source before it is added: its name, plugins and key. */
export async function inspectPluginSource(url: string) {
  return pluginSourceInspectionSchema.parse(
    await sourceBridge("inspectPluginSource")(url, traceCarrier()),
  );
}

/** Adds a plugin source, or approves the key it is signed with now. */
export async function addPluginSource(
  url: string,
  keyFingerprint: string | null,
) {
  return pluginCatalogResponseSchema.parse(
    await sourceBridge("addPluginSource")(url, keyFingerprint, traceCarrier()),
  );
}

export async function removePluginSource(url: string) {
  return pluginCatalogResponseSchema.parse(
    await sourceBridge("removePluginSource")(url, traceCarrier()),
  );
}

export async function getProjectDataShapePlugins() {
  return (
    await appApiRequest(
      "getProjectDataShapePlugins",
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
    "exportProjectsWithDataShape",
    `/api/project-data-shapes/${encodeURIComponent(pluginId)}/export`,
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
    projectDataShapeExportResponseSchema,
  );
}

/** Has a schema plugin map a file's sheets to projects. */
export function importProjectsWithDataShape(
  pluginId: string,
  sheets: ProjectDataShapeSheet[],
) {
  const payload = projectDataShapeImportRequestSchema.parse({ sheets });
  return appApiRequest(
    "importProjectsWithDataShape",
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
  return appApiRequest(
    "fetchPluginsOverview",
    "/api/plugins",
    undefined,
    pluginsOverviewSchema,
  );
}

export async function getPluginsOverview(): Promise<PluginsOverview> {
  const requestRevision = pluginsOverviewRevision;
  const requestId = ++latestPluginsOverviewRequest;
  const overview = await appApiRequest(
    "getPluginsOverview",
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

/**
 * Turns a plugin, or one of its capabilities, on or off. `version` is the
 * version whose access the user reviewed: the API refuses to turn on
 * another.
 */
export async function setPluginEnabled(
  pluginId: string,
  enabled: boolean,
  capability?: SwitchableCapability,
  version?: string,
): Promise<PluginsOverview> {
  const payload = pluginActivationUpdateSchema.parse({
    enabled,
    ...(capability ? { capability } : {}),
    ...(version ? { version } : {}),
  });
  return cachePluginsOverview(
    await appApiRequest(
      "setPluginEnabled",
      `/api/plugins/${encodeURIComponent(pluginId)}/activation`,
      {
        method: "POST",
        body: JSON.stringify(payload),
      },
      pluginsOverviewSchema,
    ),
  );
}

/**
 * Saves a plugin API 4 plugin's Advanced section: Start and Memory ceiling,
 * which its renderer reads at its next start.
 */
export async function setPluginRuntimeSettings(
  pluginId: string,
  settings: PluginRuntimeSettingsUpdate,
): Promise<PluginsOverview> {
  const payload = pluginRuntimeSettingsUpdateSchema.parse(settings);
  return cachePluginsOverview(
    await appApiRequest(
      "setPluginRuntimeSettings",
      `/api/plugins/${encodeURIComponent(pluginId)}/runtime`,
      {
        method: "POST",
        body: JSON.stringify(payload),
      },
      pluginsOverviewSchema,
    ),
  );
}

/** Turn back on: a plugin that kept stopping runs again. */
export async function resumePlugin(pluginId: string): Promise<PluginsOverview> {
  return cachePluginsOverview(
    await appApiRequest(
      "resumePlugin",
      `/api/plugins/${encodeURIComponent(pluginId)}/resume`,
      { method: "POST" },
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
      "setPluginSystemEnabled",
      "/api/plugins/activation",
      {
        method: "POST",
        body: JSON.stringify(payload),
      },
      pluginsOverviewSchema,
    ),
  );
}

/** Lets unsigned plugins run again, or deactivates all of them. */
export async function setUnsignedPluginsEnabled(
  enabled: boolean,
): Promise<PluginsOverview> {
  const payload = unsignedPluginsActivationUpdateSchema.parse({ enabled });
  return cachePluginsOverview(
    await appApiRequest(
      "setUnsignedPluginsEnabled",
      "/api/plugins/unsigned-activation",
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

  const result = await install(traceCarrier());
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

  const result = pluginUninstallResponseSchema.parse(
    await uninstall(pluginId, traceCarrier()),
  );
  cachePluginsOverview(result.overview);
  return result;
}

export function getBacklogSourceStatuses() {
  return appApiRequest(
    "getBacklogSourceStatuses",
    "/api/backlog/source-statuses",
    undefined,
    backlogSourceStatusListResponseSchema,
  );
}

export function upsertBacklogSourceStatuses(items: BacklogSourceStatusInput[]) {
  const payload = backlogSourceStatusUpsertRequestSchema.parse({ items });
  return appApiRequest(
    "upsertBacklogSourceStatuses",
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
  /** The reminder date of each secret field, in epoch ms. `null` clears one. */
  secretExpiry?: Record<string, number | null>,
  /** The access choices turned on. Undefined keeps the saved ones. */
  access?: readonly string[],
): Promise<PluginConnectionSaveResponse> {
  const payload = pluginConnectionSaveRequestSchema.parse({
    id,
    values,
    ...(secretExpiry && Object.keys(secretExpiry).length > 0
      ? { secretExpiry }
      : {}),
    ...(access ? { access: [...access] } : {}),
  });
  const result = await appApiRequest(
    "savePluginConnection",
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
  // One event for the whole delete: the three cleanups below join it.
  const command = startStoreCommandFor("removeConnectionPullRequests");
  try {
    const key = connectionKey(pluginId, connectionId);
    connectionGenerations.set(key, (connectionGenerations.get(key) ?? 0) + 1);
    // The call runs inside the command, so it counts on its event.
    const overview = cachePluginsOverview(
      await command.enter(() =>
        appApiRequest(
          "deletePluginConnection",
          `/api/plugins/${encodeURIComponent(pluginId)}/connections/${encodeURIComponent(connectionId)}`,
          {
            method: "DELETE",
          },
          pluginsOverviewSchema,
        ),
      ),
    );

    // The local API deleted the connection, even when nothing is left to
    // clean up here.
    command.didWork();
    command.enter(() => {
      const before = localStore.snapshot();
      localStore.removeConnectionPullRequests(pluginId, connectionId);
      localStore.removeConnectionCalendarData(pluginId, connectionId);
      localStore.removeConnectionTeamData(connectionId);
      describeConnectionDelete(
        before,
        localStore.snapshot(),
        pluginId,
        connectionId,
      );
    });
    return overview;
  } catch (error) {
    command.fail(error);
    throw error;
  } finally {
    command.finish();
  }
}

/**
 * Deletes saved secrets of a connection. The connection keeps its settings
 * and data, and pauses until a new secret is saved if its plugin requires one.
 */
export async function removeConnectionSecrets(
  pluginId: string,
  connectionId: string,
  fieldIds: string[],
): Promise<PluginConnectionSaveResponse> {
  const result = await appApiRequest(
    "removeConnectionSecrets",
    `/api/plugins/${encodeURIComponent(pluginId)}/connections/${encodeURIComponent(connectionId)}/secrets/remove`,
    { method: "POST", body: JSON.stringify({ fieldIds }) },
    pluginConnectionSaveResponseSchema,
  );
  cachePluginsOverview(result.overview);
  return result;
}

/**
 * Deletes the connections and saved secrets of a plugin whose package is
 * missing. Synced backlog items stay.
 */
export async function removeMissingPluginData(
  pluginId: string,
): Promise<PluginsOverview> {
  return cachePluginsOverview(
    await appApiRequest(
      "removeMissingPluginData",
      `/api/plugins/${encodeURIComponent(pluginId)}/data`,
      { method: "DELETE" },
      pluginsOverviewSchema,
    ),
  );
}

/** Opens the vault again, which re-runs the encryption round trip. */
export async function retryVault(): Promise<PluginsOverview> {
  return cachePluginsOverview(
    await appApiRequest(
      "retryVault",
      "/api/vault/retry",
      { method: "POST" },
      pluginsOverviewSchema,
    ),
  );
}

/** A page of a synced item's comments, newest last (ADR 0008). */
/**
 * An agent's comment call carries `agent=1`, so the local API enforces the
 * connection's agent access at the operation (ADR 0004).
 */
type CommentCaller = { agent?: boolean } & CommentItem;
/**
 * Ajour's own item, for the call's `backlog_item.id`. Never the item's ID in
 * its source, which is content (ADR 0011).
 */
type CommentItem = { itemId?: string };
/** The comment calls' events, which name Ajour's item. */
type CommentEvent = ClientEvent<
  | "listItemComments"
  | "postItemComment"
  | "editItemComment"
  | "setItemCommentReaction"
  | "searchItemPeople"
>;
/** Names Ajour's item on the comment call's own event. */
const describeItem =
  (caller?: CommentItem) => (unit: Unit<AjourCatalog, CommentEvent>) => {
    if (caller?.itemId) unit.set({ backlog_item: { id: caller.itemId } });
  };
const agentQuery = (caller?: CommentCaller) =>
  caller?.agent ? "?agent=1" : "";

export function listItemComments(
  pluginId: string,
  connectionId: string,
  request: BacklogListItemCommentsRequest,
  caller?: CommentCaller & {
    /** False for a load: the cache didn't answer, so the call went out. */
    cacheHit?: boolean;
  },
): Promise<BacklogListItemCommentsResult> {
  return appApiRequest(
    "listItemComments",
    `/api/backlog-comments/${encodeURIComponent(pluginId)}/connections/${encodeURIComponent(connectionId)}/listItemComments${agentQuery(caller)}`,
    { method: "POST", body: JSON.stringify(request) },
    backlogListItemCommentsResultSchema,
    (unit) => {
      describeItem(caller)(unit);
      if (caller?.cacheHit !== undefined) {
        unit.set({ comment: { cache_hit: caller.cacheHit } });
      }
    },
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
    "postItemComment",
    `/api/backlog-comments/${encodeURIComponent(pluginId)}/connections/${encodeURIComponent(connectionId)}/postItemComment${agentQuery(caller)}`,
    { method: "POST", body: JSON.stringify(request) },
    backlogPostItemCommentResultSchema,
    describeItem(caller),
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
  caller?: CommentItem,
): Promise<BacklogEditItemCommentResult> {
  return appApiRequest(
    "editItemComment",
    commentOperationPath(pluginId, connectionId, "editItemComment"),
    { method: "POST", body: JSON.stringify(request) },
    backlogEditItemCommentResultSchema,
    describeItem(caller),
  );
}

/** Deletes one of the user's comments. Ajour calls it after the Undo window. */
export async function deleteItemComment(
  pluginId: string,
  connectionId: string,
  request: BacklogDeleteItemCommentRequest,
): Promise<void> {
  await appApiRequest(
    "deleteItemComment",
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
  caller?: CommentItem,
): Promise<BacklogSearchItemPeopleResult> {
  return appApiRequest(
    "searchItemPeople",
    commentOperationPath(pluginId, connectionId, "searchItemPeople"),
    { method: "POST", body: JSON.stringify(request) },
    backlogSearchItemPeopleResultSchema,
    describeItem(caller),
  );
}

/** Adds or removes the user's reaction on a comment. */
export function setItemCommentReaction(
  pluginId: string,
  connectionId: string,
  request: BacklogSetItemCommentReactionRequest,
  caller?: CommentItem,
): Promise<BacklogSetItemCommentReactionResult> {
  return appApiRequest(
    "setItemCommentReaction",
    commentOperationPath(pluginId, connectionId, "setItemCommentReaction"),
    { method: "POST", body: JSON.stringify(request) },
    backlogSetItemCommentReactionResultSchema,
    describeItem(caller),
  );
}

/** One connection's calendar events for a range of days (ADR 0005). */
export function listCalendarEvents(
  pluginId: string,
  connectionId: string,
  request: CalendarListEventsRequest,
): Promise<CalendarListEventsResult> {
  return appApiRequest(
    "listCalendarEvents",
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
    "createTeam",
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
    "runTeamSyncRound",
    `/api/teams/${encodeURIComponent(pluginId)}/connections/${encodeURIComponent(connectionId)}/sync`,
    { method: "POST", body: JSON.stringify(request) },
    teamSyncResultSchema,
  );
}

/** Who starts each kind of backlog sync: the user, the scheduler, or a time entry saved on a synced item. */
const BACKLOG_SYNC_TRIGGERS = {
  manual: "user",
  auto: "schedule",
  source_write: "system",
} as const satisfies Record<BacklogSyncRequest["trigger"], Trigger>;

/**
 * Syncs a connection's backlog as one `backlog.sync` job: the local API
 * call, then the store commands that apply the answer, which fold into it.
 */
export function syncBacklogConnection(
  pluginId: string,
  connectionId: string,
  input?: Pick<BacklogSyncRequest, "trigger">,
): Promise<SyncBacklogConnectionResult> {
  const trigger = input?.trigger ?? "manual";
  return wideEvents.run(
    "backlog.sync",
    { kind: "job", trigger: BACKLOG_SYNC_TRIGGERS[trigger], detached: true },
    (job) => runBacklogSync(job, pluginId, connectionId, trigger),
  );
}

/**
 * What a sync sends of an estimate field's state: the values both sides
 * agreed on and saw, Keep mine, and whether its change waits for review,
 * which the API keeps from uploading.
 */
function syncEstimateField(
  field: LocalWorkItemEstimateFieldState | undefined,
): BacklogSyncRequestEstimateFieldState | undefined {
  if (!field) return undefined;
  return {
    baselineValue: field.baselineValue,
    remoteValue: field.remoteValue,
    resolution: field.resolution,
    ...(field.held ? { held: true } : {}),
  };
}

async function runBacklogSync(
  job: Unit<AjourCatalog, "backlog.sync">,
  pluginId: string,
  connectionId: string,
  trigger: BacklogSyncRequest["trigger"],
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
                originalEstimateHours: syncEstimateField(
                  workItem.estimateSync.originalEstimateHours,
                ),
                remainingEstimateHours: syncEstimateField(
                  workItem.estimateSync.remainingEstimateHours,
                ),
                completedEstimateHours: syncEstimateField(
                  workItem.estimateSync.completedEstimateHours,
                ),
              }
            : undefined,
        }) satisfies BacklogSyncRequestWorkItem,
    );
  const payload = backlogSyncRequestSchema.parse({
    trigger,
    workItems: syncedWorkItems,
  });
  job.set({
    plugin: { id: pluginId },
    connection: { id: connectionId },
    backlog_sync: { trigger, items_sent: payload.workItems.length },
  });
  const result = await appApiRequest(
    "syncBacklogConnection",
    `/api/plugins/${encodeURIComponent(pluginId)}/connections/${encodeURIComponent(connectionId)}/sync`,
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
    backlogSyncResultSchema,
  );
  job.set({
    backlog_sync: {
      mode: result.mode,
      staged_count: result.stagedCount,
      updated_count: result.updatedCount,
      skipped_count: result.skippedCount,
      done_count: result.doneItems.length,
      work_item_update_count: result.workItemUpdates.length,
      comment_fact_count: result.commentFacts.length,
    },
  });
  // The answer's store commands fold into the sync's event.
  return job.enter(() => {
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
    // The estimate changes the connection didn't upload stay, held for
    // review: editing work items is off, or the user hasn't approved them.
    // After the answer, so a field it uploaded no longer differs and loses a
    // hold set while the sync ran.
    localStore.markHeldEstimates(
      { pluginId, connectionId },
      result.heldEstimates,
    );
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

    job.set({ backlog_sync: { imported_count: importResult.importedCount } });
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
    "listBacklogSettleStates",
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
    "writeBacklogSettle",
    `/api/plugins/${encodeURIComponent(pluginId)}/connections/${encodeURIComponent(connectionId)}/settle`,
    {
      method: "POST",
      body: JSON.stringify(backlogSettleWriteRequestSchema.parse(request)),
    },
    backlogSettleWriteResultSchema,
  );
}

/** An item's description as its source holds it now. */
export function readBacklogDescription(
  pluginId: string,
  connectionId: string,
  sourceId: string,
  /** For an agent, which the API checks against the connection's Agent access. */
  forAgent = false,
) {
  return appApiRequest(
    "readBacklogDescription",
    `/api/plugins/${encodeURIComponent(pluginId)}/connections/${encodeURIComponent(connectionId)}/description${forAgent ? "?agent=1" : ""}`,
    {
      method: "POST",
      body: JSON.stringify(
        backlogReadDescriptionRequestSchema.parse({ sourceId }),
      ),
    },
    backlogReadDescriptionResultSchema,
  );
}

/** Writes an item's description, unless the source changed since it was read. */
export function writeBacklogDescription(
  pluginId: string,
  connectionId: string,
  request: BacklogWriteDescriptionRequest,
  /** For an agent, which the API checks against the connection's Agent access. */
  forAgent = false,
) {
  return appApiRequest(
    "writeBacklogDescription",
    `/api/plugins/${encodeURIComponent(pluginId)}/connections/${encodeURIComponent(connectionId)}/description-write${forAgent ? "?agent=1" : ""}`,
    {
      method: "POST",
      body: JSON.stringify(backlogWriteDescriptionRequestSchema.parse(request)),
    },
    backlogWriteDescriptionResultSchema,
  );
}

export function listBacklogImportCandidates() {
  return appApiRequest(
    "listBacklogImportCandidates",
    "/api/backlog/imports",
    undefined,
    backlogImportListResponseSchema,
  );
}

export function updateBacklogImportSelection(ids: string[], selected: boolean) {
  const payload = backlogImportSelectionUpdateSchema.parse({ ids, selected });
  return appApiRequest(
    "updateBacklogImportSelection",
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
    "dismissBacklogImportCandidates",
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
    "restoreDismissedBacklogImports",
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
    "commitSelectedBacklogImportsToLocalStore",
    "/api/backlog/imports/commit-selected",
    {
      method: "POST",
      body: JSON.stringify({}),
    },
    backlogImportCommitResponseSchema,
  );

  const beforeImport = localStore.snapshot().workItems;
  const importResult = localStore.importSyncedWorkItems(committed.items);
  // Updating an item from review can put its description in conflict too.
  announceDescriptionConflicts(
    newDescriptionConflicts(beforeImport, localStore.snapshot().workItems),
  );
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
  return appApiRequest(
    "getAgentRunner",
    "/api/agents",
    undefined,
    agentRunnerOverviewSchema,
  );
}

export async function updateAgentRunnerSettings(
  patch: Partial<AgentRunnerSettings>,
) {
  return appApiRequest(
    "updateAgentRunnerSettings",
    "/api/agents/settings",
    { method: "POST", body: JSON.stringify(patch) },
    agentRunnerOverviewSchema,
  );
}

/** Saves the settings every agent task of the plugin shares. */
export async function saveAgentTaskSettings(
  pluginId: string,
  values: PluginFieldValues,
  /** Secret settings to delete. A secret left empty in `values` keeps its saved value. */
  removeSecrets?: string[],
  /** The reminder date of each secret setting, in epoch ms. `null` clears one. */
  secretExpiry?: Record<string, number | null>,
) {
  return appApiRequest(
    "saveAgentTaskSettings",
    `/api/agents/plugins/${encodeURIComponent(pluginId)}/settings`,
    {
      method: "POST",
      body: JSON.stringify({
        values,
        ...(removeSecrets?.length ? { removeSecrets } : {}),
        ...(secretExpiry && Object.keys(secretExpiry).length > 0
          ? { secretExpiry }
          : {}),
      }),
    },
    agentRunnerOverviewSchema,
  );
}

export async function startAgentRun(request: AgentRunStartRequest) {
  return appApiRequest(
    "startAgentRun",
    "/api/agent-runs",
    { method: "POST", body: JSON.stringify(request) },
    agentRunSchema,
  );
}

export async function getMcpSettings() {
  return appApiRequest(
    "getMcpSettings",
    "/api/mcp/settings",
    undefined,
    mcpSettingsSchema,
  );
}

export async function updateMcpSettings(enabled: boolean) {
  return appApiRequest(
    "updateMcpSettings",
    "/api/mcp/settings",
    { method: "POST", body: JSON.stringify({ enabled }) },
    mcpSettingsSchema,
  );
}

/** Creates an agent client. The response holds its token, shown once. */
export async function createMcpClient(name: string) {
  return appApiRequest(
    "createMcpClient",
    "/api/mcp/clients",
    { method: "POST", body: JSON.stringify({ name }) },
    mcpClientCreateResponseSchema,
  );
}

export async function revokeMcpClient(clientId: string) {
  return appApiRequest(
    "revokeMcpClient",
    `/api/mcp/clients/${encodeURIComponent(clientId)}/revoke`,
    { method: "POST", body: "{}" },
    mcpSettingsSchema,
  );
}

export async function postMcpBridgeResult(result: BridgeToolResult) {
  return appApiRequest(
    "postMcpBridgeResult",
    "/api/mcp/bridge/results",
    { method: "POST", body: JSON.stringify(result) },
    mcpBridgeResultAckSchema,
  );
}

/** Answers an agent's open question. Returns the new agents snapshot. */
export async function answerAgentQuestion(questionId: string, text: string) {
  return appApiRequest(
    "answerAgentQuestion",
    `/api/mcp/questions/${encodeURIComponent(questionId)}/answer`,
    { method: "POST", body: JSON.stringify({ text }) },
    agentsSnapshotSchema,
  );
}

/** Ends an agent session the user no longer waits for. Returns the new snapshot. */
export async function dismissAgentSession(sessionId: string) {
  return appApiRequest(
    "dismissAgentSession",
    `/api/mcp/sessions/${encodeURIComponent(sessionId)}/dismiss`,
    { method: "POST", body: "{}" },
    agentsSnapshotSchema,
  );
}

/** Stops the agent run Ajour started. Returns the new snapshot. */
export async function stopAgentRun(runId: string) {
  return appApiRequest(
    "stopAgentRun",
    `/api/agent-runs/${encodeURIComponent(runId)}/stop`,
    { method: "POST", body: "{}" },
    agentsSnapshotSchema,
  );
}

/** Marks past agent errors and failures as seen. Returns the new snapshot. */
export async function markAgentsSeen() {
  return appApiRequest(
    "markAgentsSeen",
    "/api/mcp/seen",
    { method: "POST", body: "{}" },
    agentsSnapshotSchema,
  );
}
