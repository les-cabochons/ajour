import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
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
  pluginSystemActivationUpdateSchema,
  connectorPluginIdSchema,
  pluginHasCodeHost,
  connectorPluginInstallResponseSchema,
  connectorPluginUninstallResponseSchema,
  connectorSettleStatesRequestSchema,
  connectorSettleStatesResultSchema,
  connectorSettleWriteRequestSchema,
  connectorSettleWriteResultSchema,
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
  connectorImportRestoreRequestSchema,
  connectorImportRestoreResponseSchema,
  connectorImportSelectionResponseSchema,
  connectorImportSelectionUpdateSchema,
  connectorsOverviewSchema,
} from "../../../packages/shared/connectors.ts";
import {
  codeHostOperationSchema,
  codeHostOperations,
} from "../../../packages/shared/code-host.ts";
import {
  projectDataShapeExportRequestSchema,
  projectDataShapeExportResponseSchema,
  projectDataShapeImportRequestSchema,
  projectDataShapeImportResponseSchema,
  projectDataShapeListResponseSchema,
  projectDataShapePluginIdSchema,
} from "../../../packages/shared/project-data-shapes.ts";
import {
  agentRunnerSettingsUpdateSchema,
  agentRunStartRequestSchema,
  agentTaskSettingsUpdateSchema,
} from "../../../packages/shared/agent-runs.ts";
import {
  agentAnswerRequestSchema,
  bridgeToolResultSchema,
  mcpClientCreateRequestSchema,
  mcpSettingsUpdateSchema,
} from "../../../packages/shared/agent-tools.ts";
import { mergeConnectionConfigForSave } from "./connection-values.ts";
import { AgentSessions } from "./agent-sessions.ts";
import { McpBridge } from "./mcp-bridge.ts";
import { createMcpClient } from "./mcp-clients.ts";
import { handleMcpRequest, MAX_WAIT_FOR_ANSWER_MS } from "./mcp-server.ts";
import { claudeCodeAdapter } from "./agent-runner/adapters/claude-code.ts";
import { isChromeInstalled } from "./agent-runner/chrome.ts";
import {
  findExecutable,
  resolveLoginShellPath,
} from "./agent-runner/cli-path.ts";
import { playwrightMcpServer } from "./agent-runner/playwright-mcp.ts";
import { AgentRunError, AgentRunner } from "./agent-runner/runner.ts";
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
  /** How long a data tool waits for the renderer. Tests shorten it. */
  mcpBridgeTimeoutMs?: number;
  /** Receives MCP wide events. Defaults to one JSON line on stdout. */
  mcpLogEvent?: (event: Record<string, unknown>) => void;
  /** How long one wait_for_answer call holds. Tests shorten it. */
  mcpWaitForAnswerMs?: number;
}

interface AppApiRuntime {
  storage: AppApiStorage;
  pluginManager: ConnectorPluginManager;
  projectDataShapePluginManager: ProjectDataShapePluginManager;
  agentRunner: AgentRunner;
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

function materializeAutoSyncCandidates(
  items: ConnectorImportCandidateInput[],
): ConnectorImportCandidate[] {
  const pushedAt = Date.now();

  return items.map((item) => ({
    id: `connector_${randomUUID()}`,
    ...item,
    selected: item.selectable ? (item.selected ?? true) : false,
    pushedAt: item.pushedAt ?? pushedAt,
  }));
}

function collectAutoSyncItems(
  items: ConnectorImportCandidateInput[],
): ConnectorImportCandidate[] {
  const candidates = materializeAutoSyncCandidates(items);
  const candidatesBySourceKey = new Map(
    candidates.map(
      (item) => [`${item.connectionId}:${item.sourceId}`, item] as const,
    ),
  );
  const committedIds = new Set(
    candidates
      .filter((item) => item.selectable && item.selected)
      .map((item) => item.id),
  );

  for (const item of candidates) {
    if (
      !committedIds.has(item.id) ||
      item.depth !== 1 ||
      !item.parentSourceId
    ) {
      continue;
    }

    const parent = candidatesBySourceKey.get(
      `${item.connectionId}:${item.parentSourceId}`,
    );
    if (parent) {
      committedIds.add(parent.id);
    }
  }

  return candidates.filter((item) => committedIds.has(item.id));
}

/** Done items go back as `doneItems` so Ajour archives them, never to review. */
function splitDoneItems(items: ConnectorImportCandidateInput[]) {
  return {
    openItems: items.filter((item) => !item.stateDone),
    doneItems: items
      .filter((item) => item.stateDone)
      .map((item) => ({
        source: item.source,
        connectionId: item.connectionId,
        sourceId: item.sourceId,
        state: item.state,
      })),
  };
}

function collectConnectorStatuses(items: ConnectorImportCandidateInput[]) {
  return items
    .filter((item): item is ConnectorImportCandidateInput & { state: string } =>
      Boolean(item.state?.trim()),
    )
    .map((item) => ({
      source: item.source,
      connectionId: item.connectionId,
      connectionLabel: item.connectionLabel,
      tenantLabel: item.tenantLabel,
      label: item.state.trim(),
    }));
}

function writeJson(
  response: ServerResponse,
  statusCode: number,
  body?: unknown,
) {
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
  return (process.env.AJOUR_APP_API_ALLOWED_ORIGINS ?? "")
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
  return pathname.match(
    /^\/api\/connectors\/([^/]+)\/connections(?:\/([^/]+)(?:\/(sync|settle-states|settle))?)?$/,
  );
}

function matchCodeHostRoute(pathname: string) {
  return pathname.match(
    /^\/api\/code-hosts\/([^/]+)\/connections\/([^/]+)\/([A-Za-z]+)$/,
  );
}

function matchConnectorPluginActivationRoute(pathname: string) {
  return pathname.match(/^\/api\/connectors\/([^/]+)\/activation$/);
}

function matchProjectDataShapeRoute(pathname: string) {
  return pathname.match(
    /^\/api\/project-data-shapes\/([^/]+)\/(export|import)$/,
  );
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
  if (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= 1440
  ) {
    return value;
  }

  throw new Error(
    'Connector field "autoSyncIntervalMinutes" must be an integer between 1 and 1440.',
  );
}

function parseConnectionValues(values: ConnectorFieldValues) {
  const parsedValues = connectorFieldValuesSchema.parse(values);
  const label = parseRequiredStringValue(parsedValues.label, "label");
  const tenantLabel = parseRequiredStringValue(
    parsedValues.tenantLabel,
    "tenantLabel",
  );
  const autoSync = parseBooleanValue(
    parsedValues.autoSync ?? false,
    "autoSync",
  );
  const autoSyncIntervalMinutes = parseAutoSyncIntervalValue(
    parsedValues.autoSyncIntervalMinutes ?? 15,
  );

  const config = Object.fromEntries(
    Object.entries(parsedValues).filter(
      ([key]) => !RESERVED_CONNECTION_FIELDS.has(key),
    ),
  );

  return {
    label,
    tenantLabel,
    autoSync,
    autoSyncIntervalMinutes,
    config,
  };
}

async function getOverview(
  storage: AppApiStorage,
  pluginManager: ConnectorPluginManager,
) {
  const { plugins, unavailable } = await pluginManager.inspectPlugins();
  return connectorsOverviewSchema.parse(
    await storage.getConnectorsOverview(plugins, unavailable),
  );
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
    .find(
      (connection) =>
        connection.pluginId === pluginId && connection.id === connectionId,
    );

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
    : path.join(os.homedir(), ".ajour", "plugins");
}

function defaultDevelopmentPluginDirectories() {
  const configuredDirectories = process.env.AJOUR_DEV_PLUGIN_DIRS?.split(
    path.delimiter,
  )
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
  const host = options.host ?? process.env.AJOUR_APP_API_HOST ?? "127.0.0.1";
  const port = options.port ?? Number(process.env.AJOUR_APP_API_PORT ?? 8787);
  const storage = new AppApiStorage(options.statePath);
  const allowDevelopmentPlugins =
    options.allowDevelopmentPlugins ??
    process.env.AJOUR_ALLOW_DEVELOPMENT_PLUGINS === "1";
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
  const logMcpEvent =
    options.mcpLogEvent ??
    ((event: Record<string, unknown>) =>
      console.info(
        JSON.stringify({
          timestamp: new Date().toISOString(),
          level: "info",
          ...event,
        }),
      ));
  // The bridge and the sessions publish through each other. Both closures
  // run after both constants exist, so the forward reference is safe.
  const mcpBridge: McpBridge = new McpBridge({
    timeoutMs: options.mcpBridgeTimeoutMs,
    onAttach: () => mcpBridge.publish("agents", agentSessions.snapshot()),
  });
  const agentSessions = new AgentSessions({
    onChange: () => mcpBridge.publish("agents", agentSessions.snapshot()),
    // Ids, outcome, counts and durations only. Messages hold what the agent
    // and the user wrote, so they stay out of the log.
    onEnded: (session) =>
      logMcpEvent({
        event: "mcp.session_ended",
        client_id: session.client.id,
        session_id: session.id,
        outcome: session.state,
        duration_ms: (session.endedAt ?? Date.now()) - session.startedAt,
        update_count: session.messages.filter(
          (message) => message.kind === "update",
        ).length,
        question_count: session.messages.filter(
          (message) => message.kind === "question",
        ).length,
      }),
  });
  const agentRunner = new AgentRunner({
    storage: {
      getMcpSettings: () => storage.getMcpSettings(),
      getAgentRunnerSettings: () => storage.getAgentRunnerSettings(),
      getAgentTaskValues: (pluginId, taskId) =>
        storage.getAgentTaskValues(pluginId, taskId),
      createMcpClient: (name) => createMcpClient(storage, name),
      revokeMcpClient: (clientId) =>
        storage.revokeMcpClient(clientId, Date.now()),
    },
    sessions: agentSessions,
    plugins: {
      listPlugins: () => pluginManager.listPlugins(),
      isPluginEnabled: async (pluginId) =>
        storage.isConnectorPluginEnabled(
          pluginId,
          new Set(
            (await pluginManager.listPlugins()).map((plugin) => plugin.id),
          ),
        ),
      readAgentTaskPrompt: (pluginId, taskId) =>
        pluginManager.readAgentTaskPrompt(pluginId, taskId),
    },
    adapters: [claudeCodeAdapter],
    findExecutable: (name, pathValue) => findExecutable(name, pathValue),
    loginShellPath: resolveLoginShellPath,
    chromeInstalled: () => isChromeInstalled(),
    playwright: playwrightMcpServer,
    profileDirectory: path.join(storage.dataDirectory, "agent-browser-profile"),
    tempRoot: os.tmpdir(),
    ajourMcpUrl: `http://${host}:${port}/mcp/ajour`,
    logEvent: logMcpEvent,
  });
  const runtime: AppApiRuntime = {
    storage,
    pluginManager,
    projectDataShapePluginManager,
    agentRunner,
    stopping: false,
  };
  const stallTimer = setInterval(() => {
    agentSessions.tick();
    agentRunner.tick();
  }, 15_000);
  stallTimer.unref();
  const mcpContext = {
    storage,
    bridge: mcpBridge,
    sessions: agentSessions,
    waitForAnswerMs: Math.min(
      options.mcpWaitForAnswerMs ?? MAX_WAIT_FOR_ANSWER_MS,
      MAX_WAIT_FOR_ANSWER_MS,
    ),
    logEvent: logMcpEvent,
    readBody: readJsonBody,
  };

  const server = createServer(async (request, response) => {
    if (runtime.stopping) {
      writeJson(response, 503, { error: "App API is shutting down." });
      return;
    }
    if (request.headers.host && !isAllowedRequestHost(request.headers.host)) {
      writeJson(response, 403, { error: "Request host is not allowed." });
      return;
    }
    const requestPath = new URL(request.url ?? "/", "http://127.0.0.1")
      .pathname;
    // MCP has its own rules: bearer tokens, and no browser origins at all.
    if (requestPath === "/mcp" || requestPath.startsWith("/mcp/")) {
      try {
        await handleMcpRequest(request, response, requestPath, mcpContext);
      } catch (error) {
        if (!response.headersSent) {
          writeJson(response, 500, { error: errorMessage(error) });
        }
      }
      return;
    }
    const requestOrigin = request.headers.origin;
    if (
      requestOrigin &&
      !isAllowedRequestOrigin(requestOrigin, allowedOrigins)
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

      if (request.method === "GET" && requestUrl.pathname === "/api/agents") {
        writeJson(response, 200, await agentRunner.overview());
        return;
      }

      if (
        request.method === "POST" &&
        requestUrl.pathname === "/api/agents/settings"
      ) {
        const payload = agentRunnerSettingsUpdateSchema.parse(
          await readJsonBody(request),
        );
        await storage.updateAgentRunnerSettings(payload);
        writeJson(response, 200, await agentRunner.overview());
        return;
      }

      const agentTaskSettingsRoute = requestUrl.pathname.match(
        /^\/api\/agents\/tasks\/([^/]+)\/([^/]+)\/settings$/,
      );
      if (request.method === "POST" && agentTaskSettingsRoute) {
        const payload = agentTaskSettingsUpdateSchema.parse(
          await readJsonBody(request),
        );
        await storage.setAgentTaskValues(
          decodeURIComponent(agentTaskSettingsRoute[1] ?? ""),
          decodeURIComponent(agentTaskSettingsRoute[2] ?? ""),
          payload.values,
        );
        writeJson(response, 200, await agentRunner.overview());
        return;
      }

      if (
        request.method === "POST" &&
        requestUrl.pathname === "/api/agent-runs"
      ) {
        const payload = agentRunStartRequestSchema.parse(
          await readJsonBody(request),
        );
        try {
          writeJson(response, 201, await agentRunner.start(payload));
        } catch (error) {
          if (!(error instanceof AgentRunError)) throw error;
          writeJson(response, error.status, { error: error.message });
        }
        return;
      }

      if (
        request.method === "GET" &&
        requestUrl.pathname === "/api/agent-runs/current"
      ) {
        writeJson(response, 200, {
          run: (await agentRunner.overview()).currentRun,
        });
        return;
      }

      const agentRunStopRoute = requestUrl.pathname.match(
        /^\/api\/agent-runs\/([^/]+)\/stop$/,
      );
      if (request.method === "POST" && agentRunStopRoute) {
        if (!agentRunner.stop(decodeURIComponent(agentRunStopRoute[1] ?? ""))) {
          writeJson(response, 404, {
            error: "That agent task is not running.",
          });
          return;
        }
        writeJson(response, 200, agentSessions.snapshot());
        return;
      }

      if (requestUrl.pathname === "/api/mcp/settings") {
        if (request.method === "POST") {
          const payload = mcpSettingsUpdateSchema.parse(
            await readJsonBody(request),
          );
          await storage.setMcpEnabled(payload.enabled);
          if (!payload.enabled) mcpBridge.close();
        }
        writeJson(response, 200, await storage.getMcpSettings());
        return;
      }

      if (
        request.method === "POST" &&
        requestUrl.pathname === "/api/mcp/clients"
      ) {
        const payload = mcpClientCreateRequestSchema.parse(
          await readJsonBody(request),
        );
        writeJson(response, 201, await createMcpClient(storage, payload.name));
        return;
      }

      const mcpRevokeRoute = requestUrl.pathname.match(
        /^\/api\/mcp\/clients\/([^/]+)\/revoke$/,
      );
      if (request.method === "POST" && mcpRevokeRoute) {
        const revoked = await storage.revokeMcpClient(
          decodeURIComponent(mcpRevokeRoute[1] ?? ""),
          Date.now(),
        );
        if (!revoked) {
          writeJson(response, 404, { error: "Unknown MCP client." });
          return;
        }
        writeJson(response, 200, await storage.getMcpSettings());
        return;
      }

      if (
        request.method === "GET" &&
        requestUrl.pathname === "/api/mcp/bridge"
      ) {
        // A new stream replaces the renderer's. A web page can open one with
        // an <img> tag, which sends no Origin, so require the renderer's.
        // EventSource sends Origin because the renderer is cross-origin:
        // http://127.0.0.1:5173 in development, app://local when packaged.
        if (!requestOrigin) {
          writeJson(response, 403, { error: "The bridge needs an Origin." });
          return;
        }
        if (!(await storage.getMcpSettings()).enabled) {
          writeJson(response, 404, { error: "MCP is off." });
          return;
        }
        mcpBridge.attach(response);
        return;
      }

      if (
        request.method === "POST" &&
        requestUrl.pathname === "/api/mcp/bridge/results"
      ) {
        const result = bridgeToolResultSchema.parse(
          await readJsonBody(request),
        );
        writeJson(response, 200, { ok: mcpBridge.resolve(result) });
        return;
      }

      // The user's answer to an agent's question, from the agent panel.
      const mcpAnswerRoute = requestUrl.pathname.match(
        /^\/api\/mcp\/questions\/([^/]+)\/answer$/,
      );
      if (request.method === "POST" && mcpAnswerRoute) {
        const payload = agentAnswerRequestSchema.parse(
          await readJsonBody(request),
        );
        try {
          agentSessions.answer(
            decodeURIComponent(mcpAnswerRoute[1] ?? ""),
            payload.text,
          );
        } catch (error) {
          writeJson(response, 409, { error: errorMessage(error) });
          return;
        }
        writeJson(response, 200, agentSessions.snapshot());
        return;
      }

      // The user clears a session from the panel, for an agent that died
      // without ending it.
      const mcpDismissRoute = requestUrl.pathname.match(
        /^\/api\/mcp\/sessions\/([^/]+)\/dismiss$/,
      );
      if (request.method === "POST" && mcpDismissRoute) {
        try {
          agentSessions.dismiss(decodeURIComponent(mcpDismissRoute[1] ?? ""));
        } catch (error) {
          writeJson(response, 409, { error: errorMessage(error) });
          return;
        }
        writeJson(response, 200, agentSessions.snapshot());
        return;
      }

      // The user opened the agent panel: earlier errors and failures are seen.
      if (
        request.method === "POST" &&
        requestUrl.pathname === "/api/mcp/seen"
      ) {
        agentSessions.markSeen();
        writeJson(response, 200, agentSessions.snapshot());
        return;
      }

      if (
        request.method === "GET" &&
        requestUrl.pathname === "/api/connectors"
      ) {
        writeJson(response, 200, await getOverview(storage, pluginManager));
        return;
      }

      if (
        request.method === "GET" &&
        requestUrl.pathname === "/api/connectors/plugins"
      ) {
        writeJson(response, 200, await pluginManager.listPlugins());
        return;
      }

      if (
        request.method === "POST" &&
        requestUrl.pathname === "/api/plugins/activation"
      ) {
        const payload = pluginSystemActivationUpdateSchema.parse(
          await readJsonBody(request),
        );
        await storage.setPluginSystemEnabled(payload.enabled);
        if (!payload.enabled) {
          const plugins = await pluginManager.listPlugins();
          await Promise.allSettled(
            plugins.map((plugin) =>
              pluginManager.cancelPluginOperations(
                plugin.id,
                new Error("The Ajour plugin system was deactivated."),
              ),
            ),
          );
          await projectDataShapePluginManager.cancelOperations(
            new Error("The Ajour plugin system was deactivated."),
          );
        }
        writeJson(response, 200, await getOverview(storage, pluginManager));
        return;
      }

      if (
        request.method === "GET" &&
        requestUrl.pathname === "/api/project-data-shapes"
      ) {
        const pluginsEnabled = await storage.getPluginSystemEnabled();
        writeJson(
          response,
          200,
          projectDataShapeListResponseSchema.parse({
            plugins: pluginsEnabled
              ? await projectDataShapePluginManager.listPlugins()
              : [],
          }),
        );
        return;
      }

      const projectDataShapeRoute = matchProjectDataShapeRoute(
        requestUrl.pathname,
      );
      if (request.method === "POST" && projectDataShapeRoute) {
        if (!(await storage.getPluginSystemEnabled())) {
          writeJson(response, 409, {
            error: "The Ajour plugin system is deactivated.",
          });
          return;
        }
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

      if (
        request.method === "GET" &&
        requestUrl.pathname === "/api/backlog/source-statuses"
      ) {
        writeJson(
          response,
          200,
          connectorBacklogStatusListResponseSchema.parse(
            await storage.listConnectorBacklogStatuses(),
          ),
        );
        return;
      }

      if (
        request.method === "POST" &&
        requestUrl.pathname === "/api/backlog/source-statuses"
      ) {
        const payload = connectorBacklogStatusUpsertRequestSchema.parse(
          await readJsonBody(request),
        );
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
          const payload = connectorConnectionSaveRequestSchema.parse(
            await readJsonBody(request),
          );
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
          writeJson(response, 404, {
            error: "Connector connection not found.",
          });
          return;
        }

        if (request.method === "DELETE" && !action) {
          const deleted = await storage.deleteConnection(
            pluginId,
            connectionId,
          );
          if (!deleted) {
            writeJson(response, 404, {
              error: "Connector connection not found.",
            });
            return;
          }

          writeJson(response, 200, await getOverview(storage, pluginManager));
          return;
        }

        if (
          request.method === "POST" &&
          (action === "settle-states" || action === "settle")
        ) {
          const connection = await storage.getConnection(
            pluginId,
            connectionId,
          );
          if (!connection) {
            writeJson(response, 404, {
              error: "Connector connection not found.",
            });
            return;
          }
          if (
            !(await storage.isConnectorPluginEnabled(
              pluginId,
              new Set(
                (await pluginManager.listPlugins()).map((plugin) => plugin.id),
              ),
            ))
          ) {
            writeJson(response, 409, {
              error: "Activate this connector plugin before settling.",
            });
            return;
          }
          if (!(await pluginManager.supportsSettle(pluginId))) {
            writeJson(response, 409, {
              error: "This connector plugin does not support settling.",
            });
            return;
          }

          const body = await readJsonBody(request);
          const pluginConnection = {
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
          };
          // A malformed body fails here, outside the try, as a 400.
          const statesRequest =
            action === "settle-states"
              ? connectorSettleStatesRequestSchema.parse(body)
              : undefined;
          const writeRequest =
            action === "settle"
              ? connectorSettleWriteRequestSchema.parse(body)
              : undefined;
          try {
            if (statesRequest) {
              const result = await pluginManager.listSettleStates(
                pluginId,
                pluginConnection,
                statesRequest,
              );
              writeJson(
                response,
                200,
                connectorSettleStatesResultSchema.parse(result),
              );
              return;
            }
            if (writeRequest) {
              const result = await pluginManager.writeSettle(
                pluginId,
                pluginConnection,
                writeRequest,
              );
              writeJson(
                response,
                200,
                connectorSettleWriteResultSchema.parse(result),
              );
            }
          } catch (error) {
            writeJson(response, 502, { error: errorMessage(error) });
          }
          return;
        }

        if (request.method === "POST" && action === "sync") {
          const availablePluginIds = new Set(
            (await pluginManager.listPlugins()).map((plugin) => plugin.id),
          );
          if (!(await pluginManager.hasCapability(pluginId, "connector"))) {
            writeJson(response, 409, {
              error: "This plugin does not sync backlog items.",
            });
            return;
          }
          if (
            !(await storage.isConnectorPluginEnabled(
              pluginId,
              availablePluginIds,
            ))
          ) {
            writeJson(response, 409, {
              error: "Activate this connector plugin before syncing.",
            });
            return;
          }

          const connection = await storage.getConnection(
            pluginId,
            connectionId,
          );
          if (!connection) {
            writeJson(response, 404, {
              error: "Connector connection not found.",
            });
            return;
          }

          const payload = connectorSyncRequestSchema.parse(
            await readJsonBody(request),
          );
          const isSourceWriteOnly = payload.trigger === "source_write";
          const shouldAutoSyncToBacklog =
            connection.autoSync && payload.trigger === "auto";

          try {
            const fetched = await pluginManager.syncConnection(
              pluginId,
              {
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
              },
              payload.workItems,
            );
            const { openItems, doneItems } = splitDoneItems(fetched.items);
            if (
              !(await storage.isConnectorPluginEnabled(
                pluginId,
                availablePluginIds,
              ))
            ) {
              writeJson(response, 409, {
                error: "Connector plugin was deactivated while syncing.",
              });
              return;
            }
            const discoveredStatuses = collectConnectorStatuses(fetched.items);
            if (discoveredStatuses.length > 0) {
              await storage.upsertConnectorBacklogStatuses(discoveredStatuses);
            }

            const autoSyncItems = shouldAutoSyncToBacklog
              ? collectAutoSyncItems(openItems)
              : [];
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
                : await storage.stageImportItems(openItems);
            await storage.recordConnectionSyncSuccess(
              pluginId,
              connectionId,
              Date.now(),
            );
            const { summary } = await findConnectionSummary(
              storage,
              pluginManager,
              pluginId,
              connectionId,
            );

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
                doneItems,
              }),
            );
          } catch (error) {
            const message = errorMessage(error);
            await storage.recordConnectionError(
              pluginId,
              connectionId,
              message,
            );
            const { summary } = await findConnectionSummary(
              storage,
              pluginManager,
              pluginId,
              connectionId,
            );
            // `error` gives the client the reason, as other failed requests do.
            writeJson(response, 502, {
              ...connectorSyncResultSchema.parse({
                connection: summary,
                mode: shouldAutoSyncToBacklog ? "backlog" : "review",
                items: [],
                stagedCount: 0,
                updatedCount: 0,
                skippedCount: 0,
                workItemUpdates: [],
              }),
              error: message,
            });
          }

          return;
        }
      }

      const codeHostRoute = matchCodeHostRoute(requestUrl.pathname);
      if (codeHostRoute && request.method === "POST") {
        const [, rawPluginId, rawConnectionId, rawOperation] = codeHostRoute;
        const pluginId = connectorPluginIdSchema.parse(
          decodeURIComponent(rawPluginId ?? ""),
        );
        const connectionId = decodeURIComponent(rawConnectionId ?? "");
        const operation = codeHostOperationSchema.safeParse(rawOperation);
        if (!operation.success) {
          writeJson(response, 404, { error: "Unknown code host operation." });
          return;
        }
        const plugins = await pluginManager.listPlugins();
        const plugin = plugins.find((candidate) => candidate.id === pluginId);
        if (!plugin || !pluginHasCodeHost(plugin)) {
          writeJson(response, 404, {
            error: "This plugin does not provide pull requests.",
          });
          return;
        }
        if (
          !(await storage.isConnectorPluginEnabled(
            pluginId,
            new Set(plugins.map((candidate) => candidate.id)),
          ))
        ) {
          writeJson(response, 409, {
            error: "Activate this plugin before using its pull requests.",
          });
          return;
        }
        const connection = await storage.getConnection(pluginId, connectionId);
        if (!connection) {
          writeJson(response, 404, { error: "Connection not found." });
          return;
        }

        // A malformed body fails here, outside the try, as a 400.
        const codeHostRequest = codeHostOperations[
          operation.data
        ].request.parse(await readJsonBody(request));
        try {
          const result = await pluginManager.runCodeHostOperation(
            pluginId,
            operation.data,
            {
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
            },
            codeHostRequest,
          );
          if (operation.data === "syncPullRequests") {
            await storage.recordConnectionSyncSuccess(
              pluginId,
              connectionId,
              Date.now(),
            );
          }
          writeJson(response, 200, result);
        } catch (error) {
          const message = errorMessage(error);
          if (operation.data === "syncPullRequests") {
            await storage.recordConnectionError(
              pluginId,
              connectionId,
              message,
            );
          }
          writeJson(response, 502, { error: message });
        }
        return;
      }

      if (
        request.method === "POST" &&
        requestUrl.pathname === "/api/backlog/items"
      ) {
        const payload = connectorImportPushRequestSchema.parse(
          await readJsonBody(request),
        );
        writeJson(
          response,
          200,
          connectorImportPushResponseSchema.parse(
            await storage.stageImportItems(payload.items),
          ),
        );
        return;
      }

      if (
        request.method === "GET" &&
        requestUrl.pathname === "/api/backlog/imports"
      ) {
        writeJson(
          response,
          200,
          connectorImportListResponseSchema.parse(
            await storage.listStagedImports(),
          ),
        );
        return;
      }

      if (
        request.method === "POST" &&
        requestUrl.pathname === "/api/backlog/imports/selection"
      ) {
        const payload = connectorImportSelectionUpdateSchema.parse(
          await readJsonBody(request),
        );
        writeJson(
          response,
          200,
          connectorImportSelectionResponseSchema.parse({
            updatedCount: await storage.updateImportSelection(
              payload.ids,
              payload.selected,
            ),
          }),
        );
        return;
      }

      if (
        request.method === "POST" &&
        requestUrl.pathname === "/api/backlog/imports/dismiss"
      ) {
        const payload = connectorImportDismissRequestSchema.parse(
          await readJsonBody(request),
        );
        writeJson(
          response,
          200,
          connectorImportDismissResponseSchema.parse(
            await storage.dismissImports(payload.ids),
          ),
        );
        return;
      }

      if (
        request.method === "POST" &&
        requestUrl.pathname === "/api/backlog/imports/restore"
      ) {
        const payload = connectorImportRestoreRequestSchema.parse(
          await readJsonBody(request),
        );
        writeJson(
          response,
          200,
          connectorImportRestoreResponseSchema.parse({
            result: await storage.restoreDismissedImports(payload.undoToken),
          }),
        );
        return;
      }

      if (
        request.method === "POST" &&
        requestUrl.pathname === "/api/backlog/imports/commit-selected"
      ) {
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
    mcpBridge.close();
    clearInterval(stallTimer);
    agentSessions.close();
    void agentRunner.shutdown();
    void pluginManager.shutdown();
    void projectDataShapePluginManager.shutdown();
  });
  return server;
}

export async function installConnectorPluginForServer(
  server: Server,
  archiveBytes: Uint8Array,
  archiveFilename: string,
  options: { enableAfterInstall?: boolean } = {},
) {
  const runtime = appApiRuntimesByServer.get(server);
  if (!runtime) {
    throw new Error(
      "Connector plugin installation requires an active app API runtime.",
    );
  }

  const installedPlugin = await runtime.pluginManager.installPluginArchive(
    archiveBytes,
    archiveFilename,
  );
  // An update keeps the activation the user chose for the previous version.
  if (
    installedPlugin.installed &&
    !installedPlugin.replaced &&
    options.enableAfterInstall === false
  ) {
    await runtime.storage.setConnectorPluginEnabled(
      installedPlugin.manifest.id,
      false,
    );
  }
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
    throw new Error(
      "Connector plugin uninstall requires an active app API runtime.",
    );
  }

  const removedPlugin = await runtime.pluginManager.uninstallPlugin(pluginId);
  await runtime.storage.removeConnectorPluginData(removedPlugin.id);
  return connectorPluginUninstallResponseSchema.parse({
    pluginId: removedPlugin.id,
    overview: await getOverview(runtime.storage, runtime.pluginManager),
  });
}

export async function startAppApiServer(
  options: AppApiServerOptions = {},
): Promise<Server> {
  const host = options.host ?? process.env.AJOUR_APP_API_HOST ?? "127.0.0.1";
  const port = options.port ?? Number(process.env.AJOUR_APP_API_PORT ?? 8787);
  const server = createAppApiServer(options);

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      console.log(`Ajour app API listening on http://${host}:${port}`);
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
  // The run's cleanup revokes its MCP client, so finish it before the plugins stop.
  await runtime?.agentRunner.shutdown();
  await Promise.all([
    runtime?.pluginManager.shutdown(),
    runtime?.projectDataShapePluginManager.shutdown(),
  ]);
  server.closeAllConnections();
  await closePromise;
}

const executedDirectly =
  typeof process.argv[1] === "string" &&
  import.meta.url === pathToFileURL(process.argv[1]).toString();

if (executedDirectly) {
  void startAppApiServer();
}
