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
  agentTaskSettingFields,
  backlogSourceStatusListResponseSchema,
  backlogSourceStatusUpsertRequestSchema,
  backlogSourceStatusUpsertResponseSchema,
  pluginConnectionSaveRequestSchema,
  pluginConnectionSaveResponseSchema,
  pluginFieldValuesSchema,
  pluginActivationUpdateSchema,
  pluginSystemActivationUpdateSchema,
  pluginIdSchema,
  pluginHasCapability,
  pluginHasCodeHost,
  pluginHasCalendar,
  pluginHasTeam,
  pluginHasSwitchableCapabilities,
  pluginSwitchableCapabilities,
  switchableCapabilityLabels,
  switchableCapabilitySchema,
  type SwitchableCapability,
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
  type PluginField,
  type PluginFieldValues,
  type PluginManifest,
  type PluginValidationResult,
  type BacklogImportCandidate,
  type BacklogImportCandidateInput,
  type BacklogSyncWorkItemUpdate,
  backlogImportCommitResponseSchema,
  backlogImportDismissRequestSchema,
  backlogImportDismissResponseSchema,
  backlogImportListResponseSchema,
  backlogImportPushRequestSchema,
  backlogImportPushResponseSchema,
  backlogImportRestoreRequestSchema,
  backlogImportRestoreResponseSchema,
  backlogImportSelectionResponseSchema,
  backlogImportSelectionUpdateSchema,
  pluginsOverviewSchema,
  teamCreateRouteRequestSchema,
  AGENT_ACCESS_FIELD_ID,
  ALLOW_LOSSY_FIELD_ID,
  agentAccessAllows,
  agentAccessSchema,
  connectionAgentAccess,
  type AgentAccess,
} from "../../../packages/shared/plugins.ts";
import {
  codeHostOperationSchema,
  codeHostOperations,
} from "../../../packages/shared/code-host.ts";
import {
  calendarOperationSchema,
  calendarOperations,
} from "../../../packages/shared/calendar.ts";
import {
  backlogCommentOperationAllowed,
  backlogCommentOperationSchema,
  backlogCommentOperations,
} from "../../../packages/shared/backlog-comments.ts";
import { teamSyncRequestSchema } from "../../../packages/shared/team-sync.ts";
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
import {
  mergeConnectionConfigForSave,
  RESERVED_CONNECTION_FIELD_IDS,
} from "./connection-values.ts";
import { AgentSessions, sessionEndedEvent } from "./agent-sessions.ts";
import { McpBridge } from "./mcp-bridge.ts";
import { createMcpClient } from "./mcp-clients.ts";
import { handleMcpRequest, MAX_WAIT_FOR_ANSWER_MS } from "./mcp-server.ts";
import { claudeCodeAdapter } from "./agent-runner/adapters/claude-code.ts";
import { codexAdapter } from "./agent-runner/adapters/codex.ts";
import { opencodeAdapter } from "./agent-runner/adapters/opencode.ts";
import { isChromeInstalled } from "./agent-runner/chrome.ts";
import {
  findExecutable,
  resolveLoginShellPath,
} from "./agent-runner/cli-path.ts";
import { playwrightMcpServer } from "./agent-runner/playwright-mcp.ts";
import { AgentRunError, AgentRunner } from "./agent-runner/runner.ts";
import { capabilityOfMethod, PluginManager } from "./plugin-host.ts";
import { ProjectDataShapePluginManager } from "./project-data-shape-host.ts";
import {
  ConnectionRedaction,
  connectionlessPluginErrorMessage,
  connectionSecretValues,
  errorMessage,
  pluginErrorMessage,
  redactConnectionSummary,
} from "./plugin-errors.ts";
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
  /** Receives wide events: MCP, agent runs and calendar calls. Defaults to one JSON line on stdout. */
  mcpLogEvent?: (event: Record<string, unknown>) => void;
  /** How long one wait_for_answer call holds. Tests shorten it. */
  mcpWaitForAnswerMs?: number;
  /**
   * The PATH the agent runner finds the agent CLIs on. Defaults to the login
   * shell's PATH. Tests point it at a fake CLI.
   */
  agentCliPath?: string;
}

interface AppApiRuntime {
  storage: AppApiStorage;
  pluginManager: PluginManager;
  projectDataShapePluginManager: ProjectDataShapePluginManager;
  agentRunner: AgentRunner;
  stopping: boolean;
}

const appApiRuntimesByServer = new WeakMap<Server, AppApiRuntime>();
const MAX_JSON_BODY_BYTES = 16 * 1024 * 1024;

function materializeAutoSyncCandidates(
  items: BacklogImportCandidateInput[],
): BacklogImportCandidate[] {
  const pushedAt = Date.now();

  return items.map((item) => ({
    id: `connector_${randomUUID()}`,
    ...item,
    selected: item.selectable ? (item.selected ?? true) : false,
    pushedAt: item.pushedAt ?? pushedAt,
  }));
}

function collectAutoSyncItems(
  items: BacklogImportCandidateInput[],
): BacklogImportCandidate[] {
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

/**
 * The manifest a plugin call ran with. An update can land while a request
 * waits, so the plugin host hands over, at admission, the manifest of the
 * package it runs, and the call's error and result are redacted with that
 * package's secret fields. Until then no plugin code has run, and the
 * manifest the route read stands in.
 */
function admittedCall(manifest: PluginManifest) {
  const call = {
    manifest,
    admit: (admitted: PluginManifest) => {
      call.manifest = admitted;
    },
  };
  return call;
}

/**
 * A sync's field updates with the connection's secrets redacted from each
 * message the plugin wrote, through one `redaction` for the whole sync. The
 * web stores a message as the field's sync error and shows it.
 */
function redactFieldUpdateMessages(
  updates: BacklogSyncWorkItemUpdate[],
  redaction: ConnectionRedaction,
): BacklogSyncWorkItemUpdate[] {
  return updates.map((update) => ({
    ...update,
    fields: Object.fromEntries(
      Object.entries(update.fields).map(([field, value]) => [
        field,
        value?.message === undefined
          ? value
          : { ...value, message: redaction.text(value.message) },
      ]),
    ) as BacklogSyncWorkItemUpdate["fields"],
  }));
}

/** Done items go back as `doneItems` so Ajour archives them, never to review. */
function splitDoneItems(items: BacklogImportCandidateInput[]) {
  return {
    openItems: items.filter((item) => !item.stateDone),
    doneItems: items
      .filter((item) => item.stateDone)
      .map((item) => ({
        source: item.source,
        connectionId: item.connectionId,
        sourceId: item.sourceId,
        state: item.state,
        ...(item.description ? { description: item.description } : {}),
      })),
  };
}

function collectSourceStatuses(items: BacklogImportCandidateInput[]) {
  return items
    .filter((item): item is BacklogImportCandidateInput & { state: string } =>
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

function matchPluginRoute(pathname: string) {
  return pathname.match(
    /^\/api\/plugins\/([^/]+)\/connections(?:\/([^/]+)(?:\/(sync|settle-states|settle|description|description-write))?)?$/,
  );
}

function matchCodeHostRoute(pathname: string) {
  return pathname.match(
    /^\/api\/code-hosts\/([^/]+)\/connections\/([^/]+)\/([A-Za-z]+)$/,
  );
}

function matchBacklogCommentRoute(pathname: string) {
  return pathname.match(
    /^\/api\/backlog-comments\/([^/]+)\/connections\/([^/]+)\/([A-Za-z]+)$/,
  );
}

function matchCalendarRoute(pathname: string) {
  return pathname.match(
    /^\/api\/calendars\/([^/]+)\/connections\/([^/]+)\/([A-Za-z]+)$/,
  );
}

/** `/api/teams/:pluginId/create` or `/api/teams/:pluginId/connections/:id/sync`. */
function matchTeamRoute(pathname: string) {
  return pathname.match(
    /^\/api\/teams\/([^/]+)\/(?:(create)|connections\/([^/]+)\/(sync))$/,
  );
}

function matchPluginActivationRoute(pathname: string) {
  return pathname.match(/^\/api\/plugins\/([^/]+)\/activation$/);
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

  throw new Error(`Plugin field "${fieldId}" must be a boolean.`);
}

function parseRequiredStringValue(value: unknown, fieldId: string) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Plugin field "${fieldId}" is required.`);
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
    'Plugin field "autoSyncIntervalMinutes" must be an integer between 1 and 1440.',
  );
}

function parseConnectionValues(values: PluginFieldValues) {
  const parsedValues = pluginFieldValuesSchema.parse(values);
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
  const pullRequestAutoSync =
    parsedValues.pullRequestAutoSync === undefined
      ? undefined
      : parseBooleanValue(
          parsedValues.pullRequestAutoSync,
          "pullRequestAutoSync",
        );
  const agentAccess = parseAgentAccessValue(
    parsedValues[AGENT_ACCESS_FIELD_ID],
  );
  // Undefined keeps the saved value.
  const allowLossyConversion =
    parsedValues[ALLOW_LOSSY_FIELD_ID] === undefined
      ? undefined
      : parseBooleanValue(
          parsedValues[ALLOW_LOSSY_FIELD_ID],
          ALLOW_LOSSY_FIELD_ID,
        );

  const config = Object.fromEntries(
    Object.entries(parsedValues).filter(
      ([key]) => !RESERVED_CONNECTION_FIELD_IDS.has(key),
    ),
  );

  return {
    label,
    tenantLabel,
    autoSync,
    autoSyncIntervalMinutes,
    pullRequestAutoSync,
    agentAccess,
    allowLossyConversion,
    config,
  };
}

/** The plugin's config without the fields Ajour owns, which it never received. */
function withoutReservedFields(config: PluginFieldValues): PluginFieldValues {
  return Object.fromEntries(
    Object.entries(config).filter(
      ([key]) => !RESERVED_CONNECTION_FIELD_IDS.has(key),
    ),
  );
}

/** Undefined keeps the saved value; a connection never saved with it has None. */
function parseAgentAccessValue(value: unknown): AgentAccess | undefined {
  if (value === undefined) return undefined;
  const parsed = agentAccessSchema.safeParse(value);
  if (parsed.success) return parsed.data;
  throw new Error(
    'Plugin field "agentAccess" must be "none", "read" or "readWrite".',
  );
}

function isHttpUrl(value: unknown): boolean {
  if (typeof value !== "string") return false;
  try {
    const { protocol } = new URL(value);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Keeps only the values for the task's declared settings fields and checks
 * each against its field. A required field may be saved empty: the runner
 * blocks a run until it is filled. Returns the error message when a value is bad.
 */
function parseAgentTaskValues(
  fields: readonly PluginField[],
  values: PluginFieldValues,
): { values: PluginFieldValues } | { error: string } {
  const kept: PluginFieldValues = {};
  for (const field of fields) {
    if (!Object.hasOwn(values, field.id)) continue;
    const value = values[field.id]!;
    if (field.type === "url" && value !== "") {
      if (!isHttpUrl(value)) {
        return { error: `${field.label} must be an http or https URL.` };
      }
    }
    kept[field.id] = value;
  }
  return { values: kept };
}

/**
 * Why a capability cannot run now: the plugin is off, or the user turned the
 * capability off. Undefined when it can run.
 */
async function inactiveCapabilityError(
  storage: AppApiStorage,
  pluginId: string,
  capability: SwitchableCapability,
  availablePluginIds: ReadonlySet<string>,
  action: string,
) {
  if (!(await storage.isPluginEnabled(pluginId, availablePluginIds))) {
    return capability === "connector"
      ? `Activate this plugin before ${action}.`
      : `Activate this plugin before ${action}.`;
  }
  if (
    !(await storage.isPluginCapabilityEnabled(
      pluginId,
      capability,
      availablePluginIds,
    ))
  ) {
    return `Turn on ${switchableCapabilityLabels[capability].toLowerCase()} for this plugin before ${action}.`;
  }
  return undefined;
}

async function getOverview(
  storage: AppApiStorage,
  pluginManager: PluginManager,
) {
  const { plugins, unavailable } = await pluginManager.inspectPlugins();
  return pluginsOverviewSchema.parse(
    await storage.getPluginsOverview(plugins, unavailable),
  );
}

/**
 * The installed plugin with `pluginId`, if any, and every installed plugin's
 * id. When the plugin is installed but can't run, such as one built for
 * another plugin API, `unavailableReason` says why.
 */
async function findPlugin(pluginManager: PluginManager, pluginId: string) {
  const { plugins, unavailable } = await pluginManager.inspectPlugins();
  return {
    plugin: plugins.find((candidate) => candidate.id === pluginId),
    pluginIds: new Set(plugins.map((candidate) => candidate.id)),
    unavailableReason: unavailable.find(
      (candidate) => candidate.manifest.id === pluginId,
    )?.reason,
  };
}

async function findConnectionSummary(
  storage: AppApiStorage,
  pluginManager: PluginManager,
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
    throw new Error(`Plugin connection "${connectionId}" not found.`);
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
  const pluginManager = new PluginManager({
    installedPluginDirectory:
      options.installedPluginDirectory ??
      defaultInstalledPluginDirectory(options.statePath),
    developmentPluginDirectories:
      options.developmentPluginDirectories ??
      (allowDevelopmentPlugins ? defaultDevelopmentPluginDirectories() : []),
    bundledPluginArchives: options.bundledPluginArchives,
    allowDevelopmentPlugins,
    requestTimeoutMs: options.pluginRequestTimeoutMs,
    // The routes check activation before reading the request. This repeats
    // the check once the operation can be cancelled, so a capability turned
    // off meanwhile never runs.
    operationGate: async (pluginId, method) => {
      const capability = capabilityOfMethod(method);
      if (!capability) return;
      const inactive = await inactiveCapabilityError(
        storage,
        pluginId,
        capability,
        new Set([pluginId]),
        "running it",
      );
      if (inactive) throw new Error(inactive);
    },
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
    onEnded: (session) => logMcpEvent(sessionEndedEvent(session, Date.now())),
  });
  const agentRunner = new AgentRunner({
    storage: {
      getMcpSettings: () => storage.getMcpSettings(),
      getAgentRunnerSettings: () => storage.getAgentRunnerSettings(),
      getAgentTaskValues: (pluginId) => storage.getAgentTaskValues(pluginId),
      createMcpClient: (name) => createMcpClient(storage, name),
      revokeMcpClient: (clientId) =>
        storage.revokeMcpClient(clientId, Date.now()),
    },
    sessions: agentSessions,
    plugins: {
      listPlugins: () => pluginManager.listPlugins(),
      isPluginEnabled: async (pluginId) =>
        storage.isPluginEnabled(
          pluginId,
          new Set(
            (await pluginManager.listPlugins()).map((plugin) => plugin.id),
          ),
        ),
      readAgentTaskPrompt: (pluginId, taskId) =>
        pluginManager.readAgentTaskPrompt(pluginId, taskId),
    },
    adapters: [claudeCodeAdapter, codexAdapter, opencodeAdapter],
    findExecutable: (name, pathValue) => findExecutable(name, pathValue),
    loginShellPath:
      options.agentCliPath === undefined
        ? resolveLoginShellPath
        : async () => options.agentCliPath!,
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

      // A plugin's agent tasks share their settings, so they save together.
      const agentTaskSettingsRoute = requestUrl.pathname.match(
        /^\/api\/agents\/plugins\/([^/]+)\/settings$/,
      );
      if (request.method === "POST" && agentTaskSettingsRoute) {
        const payload = agentTaskSettingsUpdateSchema.parse(
          await readJsonBody(request),
        );
        const pluginId = decodeURIComponent(agentTaskSettingsRoute[1] ?? "");
        const tasks = (await pluginManager.listPlugins()).find(
          (plugin) => plugin.id === pluginId,
        )?.capabilities.agentTask?.tasks;
        if (!tasks) {
          writeJson(response, 404, {
            error: "This plugin has no agent tasks.",
          });
          return;
        }
        const parsed = parseAgentTaskValues(
          agentTaskSettingFields(tasks),
          payload.values,
        );
        if ("error" in parsed) {
          writeJson(response, 400, { error: parsed.error });
          return;
        }
        await storage.setAgentTaskValues(pluginId, parsed.values);
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
        writeJson(response, 200, { run: agentRunner.currentRun() });
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

      if (request.method === "GET" && requestUrl.pathname === "/api/plugins") {
        writeJson(response, 200, await getOverview(storage, pluginManager));
        return;
      }

      if (
        request.method === "GET" &&
        requestUrl.pathname === "/api/plugins/plugins"
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
        // A malformed body fails here, outside the try, as a 400.
        const exportRequest =
          operation === "export"
            ? projectDataShapeExportRequestSchema.parse(
                await readJsonBody(request),
              )
            : undefined;
        const importRequest =
          operation === "import"
            ? projectDataShapeImportRequestSchema.parse(
                await readJsonBody(request),
              )
            : undefined;
        try {
          if (exportRequest) {
            writeJson(
              response,
              200,
              projectDataShapeExportResponseSchema.parse(
                await projectDataShapePluginManager.exportProjects(
                  pluginId,
                  exportRequest.projects,
                ),
              ),
            );
          }
          if (importRequest) {
            writeJson(
              response,
              200,
              projectDataShapeImportResponseSchema.parse(
                await projectDataShapePluginManager.importProjects(
                  pluginId,
                  importRequest.datasets,
                ),
              ),
            );
          }
        } catch (error) {
          writeJson(response, 400, {
            error: connectionlessPluginErrorMessage(error),
          });
        }
        return;
      }

      const pluginActivationRoute = matchPluginActivationRoute(
        requestUrl.pathname,
      );
      if (request.method === "POST" && pluginActivationRoute) {
        const pluginId = pluginIdSchema.parse(
          decodeURIComponent(pluginActivationRoute[1] ?? ""),
        );
        const plugin = (await pluginManager.listPlugins()).find(
          (candidate) => candidate.id === pluginId,
        );
        if (!plugin) {
          writeJson(response, 404, { error: "Plugin not found." });
          return;
        }

        const payload = pluginActivationUpdateSchema.parse(
          await readJsonBody(request),
        );
        if (payload.capability) {
          if (!pluginHasCapability(plugin, payload.capability)) {
            writeJson(response, 400, {
              error: "This plugin does not declare that capability.",
            });
            return;
          }
          await storage.setPluginCapabilityEnabled(
            pluginId,
            payload.capability,
            payload.enabled,
          );
          if (!payload.enabled) {
            await pluginManager.cancelCapabilityOperations(
              pluginId,
              payload.capability,
              new Error(
                `${switchableCapabilityLabels[payload.capability]} of plugin "${pluginId}" were turned off.`,
              ),
            );
          }
          writeJson(response, 200, await getOverview(storage, pluginManager));
          return;
        }
        await storage.setPluginEnabled(pluginId, payload.enabled);
        if (!payload.enabled) {
          await pluginManager.cancelPluginOperations(
            pluginId,
            new Error(`Plugin "${pluginId}" was deactivated.`),
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
          backlogSourceStatusListResponseSchema.parse(
            await storage.listBacklogSourceStatuses(),
          ),
        );
        return;
      }

      if (
        request.method === "POST" &&
        requestUrl.pathname === "/api/backlog/source-statuses"
      ) {
        const payload = backlogSourceStatusUpsertRequestSchema.parse(
          await readJsonBody(request),
        );
        writeJson(
          response,
          200,
          backlogSourceStatusUpsertResponseSchema.parse({
            items: await storage.upsertBacklogSourceStatuses(payload.items),
          }),
        );
        return;
      }

      const pluginRoute = matchPluginRoute(requestUrl.pathname);
      if (pluginRoute) {
        const [, rawPluginId, rawConnectionId, action] = pluginRoute;
        const pluginId = pluginIdSchema.parse(
          decodeURIComponent(rawPluginId ?? ""),
        );

        if (request.method === "POST" && !rawConnectionId && !action) {
          const payload = pluginConnectionSaveRequestSchema.parse(
            await readJsonBody(request),
          );
          const parsedValues = parseConnectionValues(payload.values);
          const { plugin, unavailableReason } = await findPlugin(
            pluginManager,
            pluginId,
          );
          if (!plugin) {
            // The host runs no code of a plugin it can't load, and would
            // refuse with this reason.
            writeJson(response, 400, {
              error:
                unavailableReason ?? `Plugin "${pluginId}" is not installed.`,
            });
            return;
          }
          const existingConnection = payload.id
            ? await storage.getConnection(pluginId, payload.id)
            : null;
          // A config saved before Ajour kept its own fields out may hold one.
          const configForSave = withoutReservedFields(
            mergeConnectionConfigForSave(
              plugin,
              parsedValues.config,
              existingConnection?.config,
            ),
          );
          const capabilities = await storage.listEnabledCapabilities(
            pluginId,
            pluginSwitchableCapabilities(plugin),
          );
          const call = admittedCall(plugin);
          let validation: PluginValidationResult;
          try {
            validation = await pluginManager.validateConnection(
              pluginId,
              configForSave,
              { capabilities },
              call.admit,
            );
          } catch (error) {
            writeJson(response, 400, {
              error: pluginErrorMessage(
                error,
                call.manifest,
                configForSave,
                existingConnection?.config,
              ),
            });
            return;
          }
          const storedConnection = await storage.upsertConnection(pluginId, {
            id: payload.id,
            label: parsedValues.label,
            tenantLabel: parsedValues.tenantLabel,
            autoSync: parsedValues.autoSync,
            autoSyncIntervalMinutes: parsedValues.autoSyncIntervalMinutes,
            pullRequestAutoSync: parsedValues.pullRequestAutoSync,
            agentAccess: parsedValues.agentAccess,
            allowLossyConversion: parsedValues.allowLossyConversion,
            // The plugin's answer can't set a field Ajour owns.
            config: withoutReservedFields(validation.normalizedConfig),
            // Redacted before it is stored: the normalized config may no
            // longer hold a value the plugin swapped out, such as a password
            // it traded for a token, so the overview couldn't find it later.
            configSummary: redactConnectionSummary(
              validation.connectionSummary,
              connectionSecretValues(call.manifest, [
                configForSave,
                existingConnection?.config,
                validation.normalizedConfig,
              ]),
            ),
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
            pluginConnectionSaveResponseSchema.parse({
              overview,
              connection: summary,
            }),
          );
          return;
        }

        const connectionId = decodeURIComponent(rawConnectionId ?? "");
        if (!connectionId) {
          writeJson(response, 404, {
            error: "Plugin connection not found.",
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
              error: "Plugin connection not found.",
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
              error: "Plugin connection not found.",
            });
            return;
          }
          const { plugin, pluginIds } = await findPlugin(
            pluginManager,
            pluginId,
          );
          const inactive = await inactiveCapabilityError(
            storage,
            pluginId,
            "connector",
            pluginIds,
            "settling",
          );
          if (inactive) {
            writeJson(response, 409, { error: inactive });
            return;
          }
          if (!plugin?.capabilities.connector?.settle) {
            writeJson(response, 409, {
              error: "This plugin does not support settling.",
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
              ? backlogSettleStatesRequestSchema.parse(body)
              : undefined;
          const writeRequest =
            action === "settle"
              ? backlogSettleWriteRequestSchema.parse(body)
              : undefined;
          const call = admittedCall(plugin);
          try {
            if (statesRequest) {
              const result = await pluginManager.listSettleStates(
                pluginId,
                pluginConnection,
                statesRequest,
                call.admit,
              );
              writeJson(
                response,
                200,
                backlogSettleStatesResultSchema.parse(result),
              );
              return;
            }
            if (writeRequest) {
              const result = await pluginManager.writeSettle(
                pluginId,
                pluginConnection,
                writeRequest,
                call.admit,
              );
              writeJson(
                response,
                200,
                backlogSettleWriteResultSchema.parse(result),
              );
            }
          } catch (error) {
            writeJson(response, 502, {
              error: pluginErrorMessage(
                error,
                call.manifest,
                connection.config,
              ),
            });
          }
          return;
        }

        if (
          request.method === "POST" &&
          (action === "description" || action === "description-write")
        ) {
          const connection = await storage.getConnection(
            pluginId,
            connectionId,
          );
          if (!connection) {
            writeJson(response, 404, {
              error: "Plugin connection not found.",
            });
            return;
          }
          const { plugin, pluginIds } = await findPlugin(
            pluginManager,
            pluginId,
          );
          const inactive = await inactiveCapabilityError(
            storage,
            pluginId,
            "connector",
            pluginIds,
            "syncing descriptions",
          );
          if (inactive) {
            writeJson(response, 409, { error: inactive });
            return;
          }
          const writes = action === "description-write";
          const description = plugin?.capabilities.connector?.description;
          if (!plugin || !description || (writes && !description.write)) {
            writeJson(response, 409, {
              error: writes
                ? "This plugin does not write descriptions."
                : "This plugin does not sync descriptions.",
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
          const readRequest = writes
            ? undefined
            : backlogReadDescriptionRequestSchema.parse(body);
          const writeRequest = writes
            ? backlogWriteDescriptionRequestSchema.parse(body)
            : undefined;
          // An agent's call says so; it needs Read to read the description
          // and Read and write to change it, whatever the page asks.
          if (
            requestUrl.searchParams.get("agent") === "1" &&
            !agentAccessAllows(
              connectionAgentAccess(connection),
              writes ? "readWrite" : "read",
            )
          ) {
            writeJson(response, 409, {
              error: `The user hasn't allowed agents to ${writes ? "change" : "read"} descriptions on the "${connection.label}" connection.`,
            });
            return;
          }
          // Only a connection that allows lossy conversion writes with losses,
          // whatever a client asks.
          if (
            writeRequest?.allowedLoss?.length &&
            connection.allowLossyConversion !== true
          ) {
            writeJson(response, 409, {
              error: "This connection does not allow lossy conversion.",
            });
            return;
          }
          const call = admittedCall(plugin);
          try {
            if (readRequest) {
              const result = await pluginManager.readDescription(
                pluginId,
                pluginConnection,
                readRequest,
                call.admit,
              );
              writeJson(
                response,
                200,
                backlogReadDescriptionResultSchema.parse(result),
              );
              return;
            }
            if (writeRequest) {
              const result = await pluginManager.writeDescription(
                pluginId,
                pluginConnection,
                writeRequest,
                call.admit,
              );
              writeJson(
                response,
                200,
                backlogWriteDescriptionResultSchema.parse(result),
              );
            }
          } catch (error) {
            // The message reaches the user and is stored with the item.
            writeJson(response, 502, {
              error: pluginErrorMessage(
                error,
                call.manifest,
                connection.config,
              ),
            });
          }
          return;
        }

        if (request.method === "POST" && action === "sync") {
          const { plugin, pluginIds: availablePluginIds } = await findPlugin(
            pluginManager,
            pluginId,
          );
          if (!plugin?.capabilities.connector) {
            writeJson(response, 409, {
              error: "This plugin does not sync backlog items.",
            });
            return;
          }
          const inactive = await inactiveCapabilityError(
            storage,
            pluginId,
            "connector",
            availablePluginIds,
            "syncing",
          );
          if (inactive) {
            writeJson(response, 409, { error: inactive });
            return;
          }

          const connection = await storage.getConnection(
            pluginId,
            connectionId,
          );
          if (!connection) {
            writeJson(response, 404, {
              error: "Plugin connection not found.",
            });
            return;
          }

          const payload = backlogSyncRequestSchema.parse(
            await readJsonBody(request),
          );
          const isSourceWriteOnly = payload.trigger === "source_write";
          const shouldAutoSyncToBacklog =
            connection.autoSync && payload.trigger === "auto";

          const call = admittedCall(plugin);
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
              call.admit,
            );
            const { openItems, doneItems } = splitDoneItems(fetched.items);
            if (
              !(await storage.isPluginCapabilityEnabled(
                pluginId,
                "connector",
                availablePluginIds,
              ))
            ) {
              writeJson(response, 409, {
                error: "Plugin was deactivated while syncing.",
              });
              return;
            }
            const discoveredStatuses = collectSourceStatuses(fetched.items);
            if (discoveredStatuses.length > 0) {
              await storage.upsertBacklogSourceStatuses(discoveredStatuses);
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
              backlogSyncResultSchema.parse({
                connection: summary,
                mode: shouldAutoSyncToBacklog ? "backlog" : "review",
                items: isSourceWriteOnly ? [] : autoSyncItems,
                stagedCount: stageResult.queuedCount,
                updatedCount: stageResult.updatedCount,
                skippedCount: stageResult.skippedCount,
                workItemUpdates: redactFieldUpdateMessages(
                  fetched.workItemUpdates,
                  new ConnectionRedaction(
                    connectionSecretValues(call.manifest, [connection.config]),
                  ),
                ),
                doneItems,
                viewer: fetched.viewer,
                commentFacts: fetched.commentFacts,
              }),
            );
          } catch (error) {
            const message = pluginErrorMessage(
              error,
              call.manifest,
              connection.config,
            );
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
              ...backlogSyncResultSchema.parse({
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
        const pluginId = pluginIdSchema.parse(
          decodeURIComponent(rawPluginId ?? ""),
        );
        const connectionId = decodeURIComponent(rawConnectionId ?? "");
        const operation = codeHostOperationSchema.safeParse(rawOperation);
        if (!operation.success) {
          writeJson(response, 404, { error: "Unknown code host operation." });
          return;
        }
        const { plugin, pluginIds } = await findPlugin(pluginManager, pluginId);
        if (!plugin || !pluginHasCodeHost(plugin)) {
          writeJson(response, 404, {
            error: "This plugin does not provide pull requests.",
          });
          return;
        }
        const inactive = await inactiveCapabilityError(
          storage,
          pluginId,
          "codeHost",
          pluginIds,
          "using its pull requests",
        );
        if (inactive) {
          writeJson(response, 409, { error: inactive });
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
        const call = admittedCall(plugin);
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
            call.admit,
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
          const message = pluginErrorMessage(
            error,
            call.manifest,
            connection.config,
          );
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

      const backlogCommentRoute = matchBacklogCommentRoute(requestUrl.pathname);
      if (backlogCommentRoute && request.method === "POST") {
        const [, rawPluginId, rawConnectionId, rawOperation] =
          backlogCommentRoute;
        const pluginId = pluginIdSchema.parse(
          decodeURIComponent(rawPluginId ?? ""),
        );
        const connectionId = decodeURIComponent(rawConnectionId ?? "");
        const operation = backlogCommentOperationSchema.safeParse(rawOperation);
        if (!operation.success) {
          writeJson(response, 404, { error: "Unknown comment operation." });
          return;
        }
        const { plugin, pluginIds } = await findPlugin(pluginManager, pluginId);
        if (!plugin?.capabilities.connector?.comments) {
          writeJson(response, 404, {
            error: "This plugin does not provide comments.",
          });
          return;
        }
        const inactive = await inactiveCapabilityError(
          storage,
          pluginId,
          "connector",
          pluginIds,
          "using its comments",
        );
        if (inactive) {
          writeJson(response, 409, { error: inactive });
          return;
        }
        const connection = await storage.getConnection(pluginId, connectionId);
        if (!connection) {
          writeJson(response, 404, { error: "Connection not found." });
          return;
        }

        // A malformed body fails here, outside the try, as a 400.
        const commentRequest = backlogCommentOperations[
          operation.data
        ].request.parse(await readJsonBody(request));
        if (
          !backlogCommentOperationAllowed(
            plugin.capabilities.connector.comments,
            operation.data,
            operation.data === "setItemCommentReaction"
              ? backlogCommentOperations.setItemCommentReaction.request.parse(
                  commentRequest,
                ).reaction
              : undefined,
          )
        ) {
          writeJson(response, 404, {
            error: "This plugin does not support that on comments.",
          });
          return;
        }
        const startedAt = Date.now();
        // An agent's call says so; Ajour's own pages don't. The access it
        // needs follows from the operation, not from the caller.
        const forAgent = requestUrl.searchParams.get("agent") === "1";
        const agentNeed =
          operation.data === "listItemComments" ||
          operation.data === "searchItemPeople"
            ? "read"
            : "readWrite";
        // Ids, counts and duration only. Comment text and authors stay out
        // of the log (ADR 0008).
        const logCommentEvent = (
          outcome: "ok" | "error" | "refused",
          commentCount?: number,
        ) =>
          logMcpEvent({
            event: "backlog.comments",
            operation: operation.data,
            plugin_id: pluginId,
            connection_id: connectionId,
            agent: forAgent,
            comment_count: commentCount,
            outcome,
            duration_ms: Date.now() - startedAt,
          });
        /**
         * Refuses an agent's call the user doesn't allow on the connection,
         * as stored now: before the plugin runs, and again before a read's
         * text leaves, so a revocation saved meanwhile holds.
         */
        const agentRefusal = `The user hasn't allowed agents to ${agentNeed === "read" ? "read" : "post"} comments on the "${connection.label}" connection.`;
        const agentAllowed = async () => {
          if (!forAgent) return true;
          const current = await storage.getConnection(pluginId, connectionId);
          return Boolean(
            current &&
            agentAccessAllows(connectionAgentAccess(current), agentNeed),
          );
        };
        const refuseAgent = () => {
          logCommentEvent("refused");
          writeJson(response, 403, { error: agentRefusal });
        };
        if (!(await agentAllowed())) {
          refuseAgent();
          return;
        }
        // Checked again at the plugin's admission, after the host's own
        // waits, so a revocation saved meanwhile stops a post.
        let refusedAtAdmission = false;
        const call = admittedCall(plugin);
        const admit = async (manifest: PluginManifest) => {
          call.admit(manifest);
          if (await agentAllowed()) return;
          refusedAtAdmission = true;
          throw new Error(agentRefusal);
        };
        try {
          const result = await pluginManager.runBacklogCommentOperation(
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
            commentRequest,
            admit,
          );
          // A read's text leaves only while the agent may still read. A
          // change was allowed at admission and has happened: it stands.
          if (agentNeed === "read" && !(await agentAllowed())) {
            refuseAgent();
            return;
          }
          logCommentEvent(
            "ok",
            "comments" in result
              ? result.comments.length
              : "people" in result
                ? result.people.length
                : "comment" in result
                  ? 1
                  : 0,
          );
          writeJson(response, 200, result);
        } catch (error) {
          if (refusedAtAdmission) {
            refuseAgent();
            return;
          }
          const message = pluginErrorMessage(
            error,
            call.manifest,
            connection.config,
          );
          logCommentEvent("error");
          writeJson(response, 502, { error: message });
        }
        return;
      }

      const calendarRoute = matchCalendarRoute(requestUrl.pathname);
      if (calendarRoute && request.method === "POST") {
        const [, rawPluginId, rawConnectionId, rawOperation] = calendarRoute;
        const pluginId = pluginIdSchema.parse(
          decodeURIComponent(rawPluginId ?? ""),
        );
        const connectionId = decodeURIComponent(rawConnectionId ?? "");
        const operation = calendarOperationSchema.safeParse(rawOperation);
        if (!operation.success) {
          writeJson(response, 404, { error: "Unknown calendar operation." });
          return;
        }
        const { plugin, pluginIds } = await findPlugin(pluginManager, pluginId);
        if (!plugin || !pluginHasCalendar(plugin)) {
          writeJson(response, 404, {
            error: "This plugin does not provide calendar events.",
          });
          return;
        }
        const inactive = await inactiveCapabilityError(
          storage,
          pluginId,
          "calendar",
          pluginIds,
          "using its calendar",
        );
        if (inactive) {
          writeJson(response, 409, { error: inactive });
          return;
        }
        const connection = await storage.getConnection(pluginId, connectionId);
        if (!connection) {
          writeJson(response, 404, { error: "Connection not found." });
          return;
        }

        // A malformed body fails here, outside the try, as a 400.
        const calendarRequest = calendarOperations[
          operation.data
        ].request.parse(await readJsonBody(request));
        const startedAt = Date.now();
        // Ids, range, counts and duration only. Titles and the calendar
        // address stay out of the log (ADR 0005).
        const logCalendarEvent = (
          outcome: "ok" | "error",
          eventCount?: number,
        ) =>
          logMcpEvent({
            event: "calendar.operation",
            operation: operation.data,
            plugin_id: pluginId,
            connection_id: connectionId,
            range_days:
              (Date.parse(`${calendarRequest.to}T00:00:00Z`) -
                Date.parse(`${calendarRequest.from}T00:00:00Z`)) /
                86_400_000 +
              1,
            event_count: eventCount,
            outcome,
            duration_ms: Date.now() - startedAt,
          });
        const call = admittedCall(plugin);
        try {
          const result = await pluginManager.runCalendarOperation(
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
            calendarRequest,
            call.admit,
          );
          await storage.recordConnectionSyncSuccess(
            pluginId,
            connectionId,
            Date.now(),
          );
          logCalendarEvent("ok", result.events.length);
          writeJson(response, 200, result);
        } catch (error) {
          const message = pluginErrorMessage(
            error,
            call.manifest,
            connection.config,
          );
          await storage.recordConnectionError(pluginId, connectionId, message);
          logCalendarEvent("error");
          writeJson(response, 502, { error: message });
        }
        return;
      }

      const teamRoute = matchTeamRoute(requestUrl.pathname);
      if (teamRoute && request.method === "POST") {
        const [, rawPluginId, create, rawConnectionId] = teamRoute;
        const pluginId = pluginIdSchema.parse(
          decodeURIComponent(rawPluginId ?? ""),
        );
        const { plugin, pluginIds } = await findPlugin(pluginManager, pluginId);
        if (!plugin || !pluginHasTeam(plugin)) {
          writeJson(response, 404, {
            error: "This plugin does not sync a team's projects.",
          });
          return;
        }
        const inactive = await inactiveCapabilityError(
          storage,
          pluginId,
          "team",
          pluginIds,
          create ? "creating a team" : "syncing its projects",
        );
        if (inactive) {
          writeJson(response, 409, { error: inactive });
          return;
        }

        if (create) {
          // A malformed body fails here, outside the try, as a 400.
          const payload = teamCreateRouteRequestSchema.parse(
            await readJsonBody(request),
          );
          const call = admittedCall(plugin);
          try {
            writeJson(
              response,
              200,
              await pluginManager.createTeam(
                pluginId,
                payload.values,
                payload.team,
                call.admit,
              ),
            );
          } catch (error) {
            writeJson(response, 502, {
              error: pluginErrorMessage(error, call.manifest, payload.values),
            });
          }
          return;
        }

        const connectionId = decodeURIComponent(rawConnectionId ?? "");
        const connection = await storage.getConnection(pluginId, connectionId);
        if (!connection) {
          writeJson(response, 404, { error: "Connection not found." });
          return;
        }
        const syncRequest = teamSyncRequestSchema.parse(
          await readJsonBody(request),
        );
        const call = admittedCall(plugin);
        try {
          const result = await pluginManager.syncTeamProjects(
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
            syncRequest,
            call.admit,
          );
          await storage.recordConnectionSyncSuccess(
            pluginId,
            connectionId,
            Date.now(),
          );
          writeJson(response, 200, result);
        } catch (error) {
          const message = pluginErrorMessage(
            error,
            call.manifest,
            connection.config,
          );
          await storage.recordConnectionError(pluginId, connectionId, message);
          writeJson(response, 502, { error: message });
        }
        return;
      }

      if (
        request.method === "POST" &&
        requestUrl.pathname === "/api/backlog/items"
      ) {
        const payload = backlogImportPushRequestSchema.parse(
          await readJsonBody(request),
        );
        writeJson(
          response,
          200,
          backlogImportPushResponseSchema.parse(
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
          backlogImportListResponseSchema.parse(
            await storage.listStagedImports(),
          ),
        );
        return;
      }

      if (
        request.method === "POST" &&
        requestUrl.pathname === "/api/backlog/imports/selection"
      ) {
        const payload = backlogImportSelectionUpdateSchema.parse(
          await readJsonBody(request),
        );
        writeJson(
          response,
          200,
          backlogImportSelectionResponseSchema.parse({
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
        const payload = backlogImportDismissRequestSchema.parse(
          await readJsonBody(request),
        );
        writeJson(
          response,
          200,
          backlogImportDismissResponseSchema.parse(
            await storage.dismissImports(payload.ids),
          ),
        );
        return;
      }

      if (
        request.method === "POST" &&
        requestUrl.pathname === "/api/backlog/imports/restore"
      ) {
        const payload = backlogImportRestoreRequestSchema.parse(
          await readJsonBody(request),
        );
        writeJson(
          response,
          200,
          backlogImportRestoreResponseSchema.parse({
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
          backlogImportCommitResponseSchema.parse({
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
      // Ajour's own errors only. Only a route knows the connection whose
      // secrets a plugin error may echo, so each catches its plugin call and
      // answers with `pluginErrorMessage`.
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

/**
 * A capability an update adds starts off, so the update changes nothing until
 * the user turns it on. A plugin with one switchable capability follows its
 * plugin switch alone, so it keeps no capability switch.
 */
async function applyCapabilityDefaults(
  storage: AppApiStorage,
  manifest: PluginManifest,
  previous: PluginManifest | undefined,
) {
  for (const capability of switchableCapabilitySchema.options) {
    if (!pluginHasSwitchableCapabilities(manifest)) {
      await storage.setPluginCapabilityEnabled(manifest.id, capability, true);
    } else if (
      previous &&
      pluginHasCapability(manifest, capability) &&
      !pluginHasCapability(previous, capability)
    ) {
      await storage.setPluginCapabilityEnabled(manifest.id, capability, false);
      const pullRequestAutoSync = manifest.connectionFields.find(
        (field) => field.id === "pullRequestAutoSync",
      )?.defaultValue;
      await storage.adoptAddedCapability(
        manifest.id,
        capability,
        typeof pullRequestAutoSync === "boolean" ? pullRequestAutoSync : true,
      );
    }
  }
}

export async function installPluginForServer(
  server: Server,
  archiveBytes: Uint8Array,
  archiveFilename: string,
  options: { enableAfterInstall?: boolean } = {},
) {
  const runtime = appApiRuntimesByServer.get(server);
  if (!runtime) {
    throw new Error("Plugin installation requires an active app API runtime.");
  }

  const before = await runtime.pluginManager.inspectPlugins();
  const installedPlugin = await runtime.pluginManager.installPluginArchive(
    archiveBytes,
    archiveFilename,
    // Saved before the package change ends, so nothing runs the new package
    // with activation state meant for the old one.
    async (installed) => {
      // An update keeps the activation the user chose for the previous version.
      if (!installed.replaced && options.enableAfterInstall === false) {
        await runtime.storage.setPluginEnabled(installed.manifest.id, false);
      }
      const previous = [
        ...before.plugins,
        ...before.unavailable.map((plugin) => plugin.manifest),
      ].find((plugin) => plugin.id === installed.manifest.id);
      await applyCapabilityDefaults(
        runtime.storage,
        installed.manifest,
        installed.replaced ? previous : undefined,
      );
    },
  );
  return pluginInstallResponseSchema.parse({
    plugin: installedPlugin.manifest,
    replaced: installedPlugin.replaced,
    overview: await getOverview(runtime.storage, runtime.pluginManager),
  });
}

export async function uninstallPluginForServer(
  server: Server,
  pluginId: string,
) {
  const runtime = appApiRuntimesByServer.get(server);
  if (!runtime) {
    throw new Error("Plugin uninstall requires an active app API runtime.");
  }

  const removedPlugin = await runtime.pluginManager.uninstallPlugin(pluginId);
  await runtime.storage.removePluginData(removedPlugin.id);
  return pluginUninstallResponseSchema.parse({
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
