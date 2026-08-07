import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { existsSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  connectorBacklogStatusListResponseSchema,
  connectorBacklogStatusUpsertRequestSchema,
  connectorBacklogStatusUpsertResponseSchema,
  connectorConnectionSaveRequestSchema,
  connectorConnectionSaveResponseSchema,
  connectorFieldValuesSchema,
  connectorPluginActivationUpdateSchema,
  connectorPluginIdSchema,
  connectorPluginInstallResponseSchema,
  connectorPluginUninstallResponseSchema,
  connectorSyncRequestSchema,
  connectorSyncResultSchema,
  type ConnectorFieldValues,
  type ConnectorImportCandidate,
  type ConnectorImportCandidateInput,
  connectorImportCommitResponseSchema,
  connectorImportDismissRequestSchema,
  connectorImportDismissResponseSchema,
  connectorImportListResponseSchema,
  connectorImportPushRequestSchema,
  connectorImportPushResponseSchema,
  connectorImportSelectionResponseSchema,
  connectorImportSelectionUpdateSchema,
  connectorsOverviewSchema,
} from "../../../packages/shared/src/connectors.ts";
import {
  projectDataShapeExportRequestSchema,
  projectDataShapeExportResponseSchema,
  projectDataShapeImportRequestSchema,
  projectDataShapeImportResponseSchema,
  projectDataShapeListResponseSchema,
  projectDataShapePluginIdSchema,
} from "../../../packages/shared/src/project-data-shapes.ts";
import { mergeConnectionConfigForSave } from "./connection-values.ts";
import { ConnectorPluginManager } from "./plugin-host.ts";
import { ProjectDataShapePluginManager } from "./project-data-shape-host.ts";
import { AppApiStorage } from "./storage.ts";

interface AppApiServerOptions {
  host?: string;
  port?: number;
  statePath?: string;
  installedPluginDirectory?: string;
  developmentPluginDirectories?: string[];
  bundledPluginArchives?: string[];
  allowDevelopmentPlugins?: boolean;
  pluginRequestTimeoutMs?: number;
  projectDataShapePluginDirectories?: string[];
  allowedOrigins?: string[];
}

interface AppApiRuntime {
  storage: AppApiStorage;
  pluginManager: ConnectorPluginManager;
  projectDataShapePluginManager: ProjectDataShapePluginManager;
  stopping: boolean;
}

const appApiRuntimesByServer = new WeakMap<Server, AppApiRuntime>();
const MAX_JSON_BODY_BYTES = 16 * 1024 * 1024;

const RESERVED_CONNECTION_FIELDS = new Set([
  "label",
  "tenantLabel",
  "autoSync",
  "autoSyncIntervalMinutes",
]);

function materializeAutoSyncCandidates(items: ConnectorImportCandidateInput[]): ConnectorImportCandidate[] {
  const pushedAt = Date.now();

  return items.map((item) => ({
    id: `connector_${randomUUID()}`,
    ...item,
    selected: item.selectable ? item.selected ?? true : false,
    pushedAt: item.pushedAt ?? pushedAt,
  }));
}

function collectAutoSyncItems(items: ConnectorImportCandidateInput[]): ConnectorImportCandidate[] {
  const candidates = materializeAutoSyncCandidates(items);
  const candidatesBySourceKey = new Map(
    candidates.map((item) => [`${item.connectionId}:${item.sourceId}`, item] as const),
  );
  const committedIds = new Set(
    candidates.filter((item) => item.selectable && item.selected).map((item) => item.id),
  );

  for (const item of candidates) {
    if (!committedIds.has(item.id) || item.depth !== 1 || !item.parentSourceId) {
      continue;
    }

    const parent = candidatesBySourceKey.get(`${item.connectionId}:${item.parentSourceId}`);
    if (parent) {
      committedIds.add(parent.id);
    }
  }

  return candidates.filter((item) => committedIds.has(item.id));
}

function collectConnectorStatuses(items: ConnectorImportCandidateInput[]) {
  return items
    .filter((item): item is ConnectorImportCandidateInput & { state: string } => Boolean(item.state?.trim()))
    .map((item) => ({
      source: item.source,
      connectionId: item.connectionId,
      connectionLabel: item.connectionLabel,
      tenantLabel: item.tenantLabel,
      label: item.state.trim(),
    }));
}

function writeJson(response: ServerResponse, statusCode: number, body?: unknown) {
  const headers = {
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
  };

  if (body === undefined) {
    response.writeHead(statusCode, headers);
    response.end();
    return;
  }

  const payload = JSON.stringify(body);
  response.writeHead(statusCode, {
    ...headers,
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
  });
  response.end(payload);
}

function isAllowedRequestOrigin(
  origin: string,
  allowedOrigins: ReadonlySet<string>,
) {
  return allowedOrigins.has(origin);
}

function configuredAllowedOrigins() {
  return (process.env.TIMETRACKER_APP_API_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function isAllowedRequestHost(hostHeader: string) {
  try {
    const hostname = new URL(`http://${hostHeader}`).hostname;
    return (
      hostname === "127.0.0.1" ||
      hostname === "localhost" ||
      hostname === "[::1]"
    );
  } catch {
    return false;
  }
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.byteLength;
    if (totalBytes > MAX_JSON_BODY_BYTES) {
      throw new Error(
        `JSON request body exceeds ${MAX_JSON_BODY_BYTES} bytes.`,
      );
    }
    chunks.push(buffer);
  }

  if (chunks.length === 0) {
    return undefined;
  }

  const rawBody = Buffer.concat(chunks).toString("utf8").trim();
  if (!rawBody) {
    return undefined;
  }

  return JSON.parse(rawBody);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown error";
}

function matchConnectorRoute(pathname: string) {
  return pathname.match(/^\/api\/connectors\/([^/]+)\/connections(?:\/([^/]+)(?:\/(sync))?)?$/);
}

function matchConnectorPluginActivationRoute(pathname: string) {
  return pathname.match(/^\/api\/connectors\/([^/]+)\/activation$/);
}

function matchProjectDataShapeRoute(pathname: string) {
  return pathname.match(/^\/api\/project-data-shapes\/([^/]+)\/(export|import)$/);
}

function parseBooleanValue(value: unknown, fieldId: string) {
  if (typeof value === "boolean") {
    return value;
  }

  throw new Error(`Connector field "${fieldId}" must be a boolean.`);
}

function parseRequiredStringValue(value: unknown, fieldId: string) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Connector field "${fieldId}" is required.`);
  }

  return value.trim();
}

function parseAutoSyncIntervalValue(value: unknown) {
  if (typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 1440) {
    return value;
  }

  throw new Error('Connector field "autoSyncIntervalMinutes" must be an integer between 1 and 1440.');
}

function parseConnectionValues(values: ConnectorFieldValues) {
  const parsedValues = connectorFieldValuesSchema.parse(values);
  const label = parseRequiredStringValue(parsedValues.label, "label");
  const tenantLabel = parseRequiredStringValue(parsedValues.tenantLabel, "tenantLabel");
  const autoSync = parseBooleanValue(parsedValues.autoSync ?? false, "autoSync");
  const autoSyncIntervalMinutes = parseAutoSyncIntervalValue(parsedValues.autoSyncIntervalMinutes ?? 15);

  const config = Object.fromEntries(
    Object.entries(parsedValues).filter(([key]) => !RESERVED_CONNECTION_FIELDS.has(key)),
  );

  return {
    label,
    tenantLabel,
    autoSync,
    autoSyncIntervalMinutes,
    config,
  };
}

async function getOverview(storage: AppApiStorage, pluginManager: ConnectorPluginManager) {
  const plugins = await pluginManager.listPlugins();
  return connectorsOverviewSchema.parse(await storage.getConnectorsOverview(plugins));
}

async function findConnectionSummary(
  storage: AppApiStorage,
  pluginManager: ConnectorPluginManager,
  pluginId: string,
  connectionId: string,
) {
  const overview = await getOverview(storage, pluginManager);
  const summary = overview.connectionGroups
    .flatMap((group) => group.connections)
    .find((connection) => connection.pluginId === pluginId && connection.id === connectionId);

  if (!summary) {
    throw new Error(`Connector connection "${connectionId}" not found.`);
  }

  return {
    overview,
    summary,
  };
}

function defaultInstalledPluginDirectory(statePath?: string) {
  return statePath
    ? path.join(path.dirname(statePath), "plugins")
    : path.join(os.homedir(), ".timetracker", "plugins");
}

function defaultDevelopmentPluginDirectories() {
  const configuredDirectories = process.env.TIMETRACKER_DEV_PLUGIN_DIRS
    ?.split(path.delimiter)
    .map((directory) => directory.trim())
    .filter(Boolean);
  if (configuredDirectories?.length) {
    return configuredDirectories;
  }

  const repoRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../..",
  );
  const connectorRoot = path.join(repoRoot, "connectors");
  if (!existsSync(connectorRoot)) {
    return [];
  }

  return readdirSync(connectorRoot, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() &&
        existsSync(path.join(connectorRoot, entry.name, "plugin.json")),
    )
    .map((entry) => path.join(connectorRoot, entry.name));
}

function defaultProjectDataShapePluginDirectories() {
  const repoRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../..",
  );
  const pluginRoot = path.join(repoRoot, "plugins");
  if (!existsSync(pluginRoot)) {
    return [];
  }

  return readdirSync(pluginRoot, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() &&
        existsSync(path.join(pluginRoot, entry.name, "plugin.json")),
    )
    .map((entry) => path.join(pluginRoot, entry.name));
}

export function createAppApiServer(options: AppApiServerOptions = {}) {
  const host = options.host ?? process.env.TIMETRACKER_APP_API_HOST ?? "127.0.0.1";
  const port = options.port ?? Number(process.env.TIMETRACKER_APP_API_PORT ?? 8787);
  const storage = new AppApiStorage(options.statePath);
  const allowDevelopmentPlugins =
    options.allowDevelopmentPlugins ??
    process.env.TIMETRACKER_ALLOW_DEVELOPMENT_PLUGINS === "1";
  const pluginManager = new ConnectorPluginManager({
    installedPluginDirectory:
      options.installedPluginDirectory ??
      defaultInstalledPluginDirectory(options.statePath),
    developmentPluginDirectories:
      options.developmentPluginDirectories ??
      (allowDevelopmentPlugins ? defaultDevelopmentPluginDirectories() : []),
    bundledPluginArchives: options.bundledPluginArchives,
    allowDevelopmentPlugins,
    requestTimeoutMs: options.pluginRequestTimeoutMs,
  });
  const projectDataShapePluginManager = new ProjectDataShapePluginManager({
    pluginDirectories:
      options.projectDataShapePluginDirectories ??
      defaultProjectDataShapePluginDirectories(),
    requestTimeoutMs: options.pluginRequestTimeoutMs,
  });
  const allowedOrigins = new Set(
    options.allowedOrigins ?? configuredAllowedOrigins(),
  );
  const runtime: AppApiRuntime = {
    storage,
    pluginManager,
    projectDataShapePluginManager,
    stopping: false,
  };

  const server = createServer(async (request, response) => {
    if (runtime.stopping) {
      writeJson(response, 503, { error: "App API is shutting down." });
      return;
    }
    if (
      request.headers.host &&
      !isAllowedRequestHost(request.headers.host)
    ) {
      writeJson(response, 403, { error: "Request host is not allowed." });
      return;
    }
    const requestOrigin = request.headers.origin;
    if (
      requestOrigin &&
      !isAllowedRequestOrigin(
        requestOrigin,
        allowedOrigins,
      )
    ) {
      writeJson(response, 403, { error: "Request origin is not allowed." });
      return;
    }
    if (requestOrigin) {
      response.setHeader("Access-Control-Allow-Origin", requestOrigin);
      response.setHeader("Vary", "Origin");
    }

    if (request.method === "OPTIONS") {
      writeJson(response, 204);
      return;
    }

    const requestUrl = new URL(request.url ?? "/", `http://${host}:${port}`);

    try {
      if (request.method === "GET" && requestUrl.pathname === "/api/health") {
        writeJson(response, 200, { ok: true });
        return;
      }

      if (request.method === "GET" && requestUrl.pathname === "/api/connectors") {
        writeJson(response, 200, await getOverview(storage, pluginManager));
        return;
      }

      if (request.method === "GET" && requestUrl.pathname === "/api/connectors/plugins") {
        writeJson(response, 200, await pluginManager.listPlugins());
        return;
      }

      if (
        request.method === "GET" &&
        requestUrl.pathname === "/api/project-data-shapes"
      ) {
        writeJson(
          response,
          200,
          projectDataShapeListResponseSchema.parse({
            plugins: await projectDataShapePluginManager.listPlugins(),
          }),
        );
        return;
      }

      const projectDataShapeRoute = matchProjectDataShapeRoute(
        requestUrl.pathname,
      );
      if (request.method === "POST" && projectDataShapeRoute) {
        const pluginId = projectDataShapePluginIdSchema.parse(
          decodeURIComponent(projectDataShapeRoute[1] ?? ""),
        );
        const operation = projectDataShapeRoute[2];
        if (operation === "export") {
          const payload = projectDataShapeExportRequestSchema.parse(
            await readJsonBody(request),
          );
          writeJson(
            response,
            200,
            projectDataShapeExportResponseSchema.parse(
              await projectDataShapePluginManager.exportProjects(
                pluginId,
                payload.projects,
              ),
            ),
          );
          return;
        }

        const payload = projectDataShapeImportRequestSchema.parse(
          await readJsonBody(request),
        );
        writeJson(
          response,
          200,
          projectDataShapeImportResponseSchema.parse(
            await projectDataShapePluginManager.importProjects(
              pluginId,
              payload.datasets,
            ),
          ),
        );
        return;
      }

      const pluginActivationRoute = matchConnectorPluginActivationRoute(
        requestUrl.pathname,
      );
      if (request.method === "POST" && pluginActivationRoute) {
        const pluginId = connectorPluginIdSchema.parse(
          decodeURIComponent(pluginActivationRoute[1] ?? ""),
        );
        const plugin = (await pluginManager.listPlugins()).find(
          (candidate) => candidate.id === pluginId,
        );
        if (!plugin) {
          writeJson(response, 404, { error: "Connector plugin not found." });
          return;
        }

        const payload = connectorPluginActivationUpdateSchema.parse(
          await readJsonBody(request),
        );
        await storage.setConnectorPluginEnabled(pluginId, payload.enabled);
        if (!payload.enabled) {
          await pluginManager.cancelPluginOperations(
            pluginId,
            new Error(`Connector plugin "${pluginId}" was deactivated.`),
          );
        }
        writeJson(response, 200, await getOverview(storage, pluginManager));
        return;
      }

      if (request.method === "GET" && requestUrl.pathname === "/api/backlog/source-statuses") {
        writeJson(
          response,
          200,
          connectorBacklogStatusListResponseSchema.parse(await storage.listConnectorBacklogStatuses()),
        );
        return;
      }

      if (request.method === "POST" && requestUrl.pathname === "/api/backlog/source-statuses") {
        const payload = connectorBacklogStatusUpsertRequestSchema.parse(await readJsonBody(request));
        writeJson(
          response,
          200,
          connectorBacklogStatusUpsertResponseSchema.parse({
            items: await storage.upsertConnectorBacklogStatuses(payload.items),
          }),
        );
        return;
      }

      const connectorRoute = matchConnectorRoute(requestUrl.pathname);
      if (connectorRoute) {
        const [, rawPluginId, rawConnectionId, action] = connectorRoute;
        const pluginId = connectorPluginIdSchema.parse(
          decodeURIComponent(rawPluginId ?? ""),
        );

        if (request.method === "POST" && !rawConnectionId && !action) {
          const payload = connectorConnectionSaveRequestSchema.parse(await readJsonBody(request));
          const parsedValues = parseConnectionValues(payload.values);
          const plugin = (await pluginManager.listPlugins()).find(
            (candidate) => candidate.id === pluginId,
          );
          const existingConnection = payload.id
            ? await storage.getConnection(pluginId, payload.id)
            : null;
          const configForSave = plugin
            ? mergeConnectionConfigForSave(
                plugin,
                parsedValues.config,
                existingConnection?.config,
              )
            : parsedValues.config;
          const validation = await pluginManager.validateConnection(
            pluginId,
            configForSave,
          );
          const storedConnection = await storage.upsertConnection(pluginId, {
            id: payload.id,
            label: parsedValues.label,
            tenantLabel: parsedValues.tenantLabel,
            autoSync: parsedValues.autoSync,
            autoSyncIntervalMinutes: parsedValues.autoSyncIntervalMinutes,
            config: validation.normalizedConfig,
            configSummary: validation.connectionSummary,
          });
          const { overview, summary } = await findConnectionSummary(
            storage,
            pluginManager,
            pluginId,
            storedConnection.id,
          );

          writeJson(
            response,
            200,
            connectorConnectionSaveResponseSchema.parse({
              overview,
              connection: summary,
            }),
          );
          return;
        }

        const connectionId = decodeURIComponent(rawConnectionId ?? "");
        if (!connectionId) {
          writeJson(response, 404, { error: "Connector connection not found." });
          return;
        }

        if (request.method === "DELETE" && !action) {
          const deleted = await storage.deleteConnection(pluginId, connectionId);
          if (!deleted) {
            writeJson(response, 404, { error: "Connector connection not found." });
            return;
          }

          writeJson(response, 200, await getOverview(storage, pluginManager));
          return;
        }

        if (request.method === "POST" && action === "sync") {
          const availablePluginIds = new Set(
            (await pluginManager.listPlugins()).map((plugin) => plugin.id),
          );
          if (!(await storage.isConnectorPluginEnabled(pluginId, availablePluginIds))) {
            writeJson(response, 409, {
              error: "Activate this connector plugin before syncing.",
            });
            return;
          }

          const connection = await storage.getConnection(pluginId, connectionId);
          if (!connection) {
            writeJson(response, 404, { error: "Connector connection not found." });
            return;
          }

          const payload = connectorSyncRequestSchema.parse(await readJsonBody(request));
          const isSourceWriteOnly = payload.trigger === "source_write";
          const shouldAutoSyncToBacklog = connection.autoSync && payload.trigger === "auto";

          try {
            const fetched = await pluginManager.syncConnection(pluginId, {
              id: connection.id,
              pluginId: connection.pluginId,
              label: connection.label,
              tenantLabel: connection.tenantLabel,
              autoSync: connection.autoSync,
              autoSyncIntervalMinutes: connection.autoSyncIntervalMinutes,
              connectedAt: connection.connectedAt,
              lastSyncAt: connection.lastSyncAt,
              lastError: connection.lastError,
              config: connection.config,
            }, payload.workItems);
            if (!(await storage.isConnectorPluginEnabled(pluginId, availablePluginIds))) {
              writeJson(response, 409, {
                error: "Connector plugin was deactivated while syncing.",
              });
              return;
            }
            const discoveredStatuses = collectConnectorStatuses(fetched.items);
            if (discoveredStatuses.length > 0) {
              await storage.upsertConnectorBacklogStatuses(discoveredStatuses);
            }

            const autoSyncItems = shouldAutoSyncToBacklog ? collectAutoSyncItems(fetched.items) : [];
            const stageResult = isSourceWriteOnly
              ? {
                  queuedCount: 0,
                  updatedCount: 0,
                  skippedCount: 0,
                }
              : shouldAutoSyncToBacklog
              ? {
                  queuedCount: autoSyncItems.length,
                  updatedCount: 0,
                  skippedCount: 0,
                }
              : await storage.stageImportItems(fetched.items);
            await storage.recordConnectionSyncSuccess(pluginId, connectionId, Date.now());
            const { summary } = await findConnectionSummary(storage, pluginManager, pluginId, connectionId);

            writeJson(
              response,
              200,
              connectorSyncResultSchema.parse({
                connection: summary,
                mode: shouldAutoSyncToBacklog ? "backlog" : "review",
                items: isSourceWriteOnly ? [] : autoSyncItems,
                stagedCount: stageResult.queuedCount,
                updatedCount: stageResult.updatedCount,
                skippedCount: stageResult.skippedCount,
                workItemUpdates: fetched.workItemUpdates,
              }),
            );
          } catch (error) {
            await storage.recordConnectionError(pluginId, connectionId, errorMessage(error));
            const { summary } = await findConnectionSummary(storage, pluginManager, pluginId, connectionId);
            writeJson(
              response,
              502,
              connectorSyncResultSchema.parse({
                connection: summary,
                mode: shouldAutoSyncToBacklog ? "backlog" : "review",
                items: [],
                stagedCount: 0,
                updatedCount: 0,
                skippedCount: 0,
                workItemUpdates: [],
              }),
            );
          }

          return;
        }
      }

      if (request.method === "POST" && requestUrl.pathname === "/api/backlog/items") {
        const payload = connectorImportPushRequestSchema.parse(await readJsonBody(request));
        writeJson(
          response,
          200,
          connectorImportPushResponseSchema.parse(await storage.stageImportItems(payload.items)),
        );
        return;
      }

      if (request.method === "GET" && requestUrl.pathname === "/api/backlog/imports") {
        writeJson(
          response,
          200,
          connectorImportListResponseSchema.parse(await storage.listStagedImports()),
        );
        return;
      }

      if (request.method === "POST" && requestUrl.pathname === "/api/backlog/imports/selection") {
        const payload = connectorImportSelectionUpdateSchema.parse(await readJsonBody(request));
        writeJson(
          response,
          200,
          connectorImportSelectionResponseSchema.parse({
            updatedCount: await storage.updateImportSelection(payload.ids, payload.selected),
          }),
        );
        return;
      }

      if (request.method === "POST" && requestUrl.pathname === "/api/backlog/imports/dismiss") {
        const payload = connectorImportDismissRequestSchema.parse(await readJsonBody(request));
        writeJson(
          response,
          200,
          connectorImportDismissResponseSchema.parse({
            dismissedCount: await storage.dismissImports(payload.ids),
          }),
        );
        return;
      }

      if (request.method === "POST" && requestUrl.pathname === "/api/backlog/imports/commit-selected") {
        const items = await storage.commitSelectedImports();
        writeJson(
          response,
          200,
          connectorImportCommitResponseSchema.parse({
            items,
            committedCount: items.length,
          }),
        );
        return;
      }

      writeJson(response, 404, {
        error: `No route for ${request.method ?? "GET"} ${requestUrl.pathname}`,
      });
    } catch (error) {
      writeJson(response, 400, {
        error: errorMessage(error),
      });
    }
  });

  appApiRuntimesByServer.set(server, runtime);
  server.once("close", () => {
    void pluginManager.shutdown();
    void projectDataShapePluginManager.shutdown();
  });
  return server;
}

export async function installConnectorPluginForServer(
  server: Server,
  archiveBytes: Uint8Array,
  archiveFilename: string,
) {
  const runtime = appApiRuntimesByServer.get(server);
  if (!runtime) {
    throw new Error("Connector plugin installation requires an active app API runtime.");
  }

  const installedPlugin = await runtime.pluginManager.installPluginArchive(
    archiveBytes,
    archiveFilename,
  );
  return connectorPluginInstallResponseSchema.parse({
    plugin: installedPlugin.manifest,
    replaced: installedPlugin.replaced,
    overview: await getOverview(runtime.storage, runtime.pluginManager),
  });
}

export async function uninstallConnectorPluginForServer(
  server: Server,
  pluginId: string,
) {
  const runtime = appApiRuntimesByServer.get(server);
  if (!runtime) {
    throw new Error("Connector plugin uninstall requires an active app API runtime.");
  }

  const removedPlugin = await runtime.pluginManager.uninstallPlugin(pluginId);
  await runtime.storage.removeConnectorPluginData(removedPlugin.id);
  return connectorPluginUninstallResponseSchema.parse({
    pluginId: removedPlugin.id,
    overview: await getOverview(runtime.storage, runtime.pluginManager),
  });
}

export async function startAppApiServer(options: AppApiServerOptions = {}): Promise<Server> {
  const host = options.host ?? process.env.TIMETRACKER_APP_API_HOST ?? "127.0.0.1";
  const port = options.port ?? Number(process.env.TIMETRACKER_APP_API_PORT ?? 8787);
  const server = createAppApiServer(options);

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      console.log(`TimeTracker app API listening on http://${host}:${port}`);
      resolve();
    });
  });

  return server;
}

export async function stopAppApiServer(server: Server): Promise<void> {
  const runtime = appApiRuntimesByServer.get(server);
  if (runtime) {
    runtime.stopping = true;
  }
  const closePromise = new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
  server.closeIdleConnections();
  await Promise.all([
    runtime?.pluginManager.shutdown(),
    runtime?.projectDataShapePluginManager.shutdown(),
  ]);
  server.closeAllConnections();
  await closePromise;
}

const executedDirectly =
  typeof process.argv[1] === "string" && import.meta.url === pathToFileURL(process.argv[1]).toString();

if (executedDirectly) {
  void startAppApiServer();
}
