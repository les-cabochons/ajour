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
import type { AjourCatalog } from "../../../packages/wide-events/catalog.ts";
import type { Unit } from "../../../packages/wide-events/index.ts";
import { teamSyncRequestSchema } from "../../../packages/shared/team-sync.ts";
import { ZodError } from "zod";
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
import type { Sink } from "../../../packages/wide-events/sinks.ts";
import { AgentSessions } from "./agent-sessions.ts";
import {
  createApiEvents,
  watchProcessCrashes,
  type ApiEvents,
  type ApiLaunch,
} from "./events.ts";
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
import { PluginOperationRefused } from "./plugin-worker-lifetime.ts";
import { ProjectDataShapePluginManager } from "./project-data-shape-host.ts";
import {
  connectionlessPluginErrorMessage,
  connectionRedaction,
  connectionSecretValues,
  errorMessage,
  pluginErrorMessage,
  redactConnectionSummary,
  redactPluginText,
  type ConnectionRedaction,
} from "./plugin-errors.ts";
import {
  decodeParams,
  matchRoute,
  serveWithEvent,
  type RouteContext,
  type RouteHandlers,
  type RouteId,
  type RouteParams,
} from "./routes.ts";
import {
  AppApiStorage,
  resolveStatePath,
  type StoredConnection,
} from "./storage.ts";

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
  /**
   * Receives the API's wide events. Defaults to where AJOUR_WIDE_EVENTS sends
   * them: nowhere, or one JSON line each on stdout with `console`.
   */
  eventSink?: Sink;
  /** The launch the API runs in: its ID, the app version and the channel. */
  launch?: ApiLaunch;
  /**
   * Records the process's uncaught exceptions and unhandled rejections as
   * `app.error`, from start to stop. For a process the API owns, such as
   * the standalone API; off by default, since a host process reports its own.
   */
  reportProcessCrashes?: boolean;
  /** How long one wait_for_answer call holds. Tests shorten it. */
  mcpWaitForAnswerMs?: number;
  /**
   * The PATH the agent runner finds the agent CLIs on. Defaults to the login
   * shell's PATH. Tests point it at a fake CLI.
   */
  agentCliPath?: string;
}

interface AppApiRuntime {
  events: ApiEvents;
  port: number;
  /** Stops recording the process's crashes, when the API was asked to. */
  stopWatchingCrashes?: () => void;
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

  try {
    return JSON.parse(rawBody);
  } catch {
    // The parser's message can quote the body, which may hold the user's
    // text, so it never travels on.
    throw new InvalidJsonError();
  }
}

/** A request body that isn't JSON. Its message is fixed, whatever the body held. */
class InvalidJsonError extends SyntaxError {
  readonly code = "invalid_json";

  constructor() {
    super("The request body is not valid JSON.");
    this.name = "SyntaxError";
  }
}

/**
 * The request's URL. A request line Node accepted can still fail to parse,
 * such as `//`, and then the request reaches no route.
 */
function requestUrlOf(request: IncomingMessage) {
  try {
    return new URL(request.url ?? "/", "http://127.0.0.1");
  } catch {
    return new URL("http://127.0.0.1/");
  }
}

/**
 * A request Ajour couldn't read, as its event holds it: a body that isn't
 * JSON, a malformed path segment, or values that don't match the route's
 * schema, whose message can quote what the caller sent. Undefined for any
 * other error.
 */
function invalidRequestError(error: unknown): Error | undefined {
  if (error instanceof InvalidJsonError || error instanceof URIError) {
    return error;
  }
  if (error instanceof ZodError) {
    const standIn = new Error("The request does not match its schema.");
    standIn.name = "ZodError";
    return standIn;
  }
  return undefined;
}

/** The connection as a plugin receives it. */
function invocationConnection(connection: StoredConnection) {
  return {
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
}

/**
 * A code host request's catalog fields: counts, a review's verdict and a
 * merge's method. Never a repository, a number, a path or a body.
 */
function codeHostRequestFields(request: object) {
  const fields: {
    pull_request?: {
      tracked_count?: number;
      verdict?: "approve" | "request_changes" | "comment";
      comment_count?: number;
      merge_method?: string;
    };
  } = {};
  if ("tracked" in request && Array.isArray(request.tracked)) {
    fields.pull_request = { tracked_count: request.tracked.length };
  }
  if ("verdict" in request && "comments" in request) {
    const review = request as {
      verdict: "approve" | "request_changes" | "comment";
      comments: unknown[];
    };
    fields.pull_request = {
      verdict: review.verdict,
      comment_count: review.comments.length,
    };
  }
  if ("method" in request && typeof request.method === "string") {
    fields.pull_request = { merge_method: request.method };
  }
  return fields;
}

/** A code host result's catalog fields: how many pull requests, files or threads. */
function codeHostResultFields(result: object) {
  const fields: {
    pull_request?: {
      received_count?: number;
      file_count?: number;
      thread_count?: number;
    };
  } = {};
  if ("pullRequests" in result && Array.isArray(result.pullRequests)) {
    fields.pull_request = { received_count: result.pullRequests.length };
  } else if ("files" in result && Array.isArray(result.files)) {
    fields.pull_request = { file_count: result.files.length };
  } else if ("threads" in result && Array.isArray(result.threads)) {
    fields.pull_request = { thread_count: result.threads.length };
  }
  return fields;
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
 * Why a capability cannot run now, and the reason its events record: the
 * plugin system or the plugin is off, or the user turned the capability off.
 * Undefined when it can run.
 */
async function inactiveCapability(
  storage: AppApiStorage,
  pluginId: string,
  capability: SwitchableCapability,
  availablePluginIds: ReadonlySet<string>,
  action: string,
): Promise<
  | { message: string; reason: "system_off" | "plugin_off" | "capability_off" }
  | undefined
> {
  if (!(await storage.isPluginEnabled(pluginId, availablePluginIds))) {
    return {
      message: `Activate this plugin before ${action}.`,
      reason: (await storage.getPluginSystemEnabled())
        ? "plugin_off"
        : "system_off",
    };
  }
  if (
    !(await storage.isPluginCapabilityEnabled(
      pluginId,
      capability,
      availablePluginIds,
    ))
  ) {
    return {
      message: `Turn on ${switchableCapabilityLabels[capability].toLowerCase()} for this plugin before ${action}.`,
      reason: "capability_off",
    };
  }
  return undefined;
}

/** The plugins overview. `unit`, the overview's own request, gets its counts. */
async function getOverview(
  storage: AppApiStorage,
  pluginManager: PluginManager,
  unit?: Unit<AjourCatalog, "plugin.list">,
) {
  const startedAt = Date.now();
  const { plugins, unavailable } = await pluginManager.inspectPlugins();
  unit?.set({
    plugin_list: {
      plugin_count: plugins.length,
      unavailable_count: unavailable.length,
      discovery_ms: Date.now() - startedAt,
    },
  });
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
  const statePath = resolveStatePath(options.statePath);
  const events = createApiEvents({
    sink: options.eventSink,
    launch: options.launch,
    userDataPath: path.dirname(statePath),
  });
  const storage = new AppApiStorage(statePath, { events });
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
    events,
    // The routes check activation before reading the request. This repeats
    // the check once the operation can be cancelled, so a capability turned
    // off meanwhile never runs.
    operationGate: async (pluginId, method) => {
      const capability = capabilityOfMethod(method);
      if (!capability) return;
      const inactive = await inactiveCapability(
        storage,
        pluginId,
        capability,
        new Set([pluginId]),
        "running it",
      );
      if (inactive) {
        throw new PluginOperationRefused(inactive.message, inactive.reason);
      }
    },
  });
  const projectDataShapePluginManager = new ProjectDataShapePluginManager({
    pluginDirectories:
      options.projectDataShapePluginDirectories ??
      defaultProjectDataShapePluginDirectories(),
    requestTimeoutMs: options.pluginRequestTimeoutMs,
    events,
  });
  const allowedOrigins = new Set(
    options.allowedOrigins ?? configuredAllowedOrigins(),
  );
  // The bridge and the sessions publish through each other. Both closures
  // run after both constants exist, so the forward reference is safe.
  const mcpBridge: McpBridge = new McpBridge({
    timeoutMs: options.mcpBridgeTimeoutMs,
    onAttach: () => mcpBridge.publish("agents", agentSessions.snapshot()),
  });
  const agentSessions = new AgentSessions({
    onChange: () => mcpBridge.publish("agents", agentSessions.snapshot()),
    events,
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
    events,
  });
  const runtime: AppApiRuntime = {
    events,
    port,
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
    events,
    readBody: readJsonBody,
  };

  // One handler per route in ROUTES. Each adds its catalog fields to the
  // request's event; the seam records the method, route, status and sizes.
  const handlers: RouteHandlers = {
    health: ({ response }) => {
      writeJson(response, 200, { ok: true });
    },

    agentRunnerStatus: async ({ response }) => {
      writeJson(response, 200, await agentRunner.overview());
    },

    agentRunnerConfigure: async ({ request, response }) => {
      const payload = agentRunnerSettingsUpdateSchema.parse(
        await readJsonBody(request),
      );
      await storage.updateAgentRunnerSettings(payload);
      writeJson(response, 200, await agentRunner.overview());
    },

    // A plugin's agent tasks share their settings, so they save together.
    agentTaskConfigure: async ({ request, response, params, unit }) => {
      const payload = agentTaskSettingsUpdateSchema.parse(
        await readJsonBody(request),
      );
      const { pluginId } = params;
      unit.set({ plugin: { id: pluginId } });
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
      unit.set({
        agent_task: { field_count: Object.keys(parsed.values).length },
      });
      await storage.setAgentTaskValues(pluginId, parsed.values);
      writeJson(response, 200, await agentRunner.overview());
    },

    agentRunStart: async ({ request, response, unit }) => {
      const payload = agentRunStartRequestSchema.parse(
        await readJsonBody(request),
      );
      unit.set({
        agent: { task_id: payload.taskId },
        plugin: { id: payload.pluginId },
      });
      try {
        const run = await agentRunner.start(payload);
        unit.set({ agent: { run_id: run.id } });
        writeJson(response, 201, run);
      } catch (error) {
        if (!(error instanceof AgentRunError)) throw error;
        writeJson(response, error.status, { error: error.message });
      }
    },

    agentRunStatus: ({ response }) => {
      writeJson(response, 200, { run: agentRunner.currentRun() });
    },

    agentRunStop: ({ response, params, unit }) => {
      unit.set({ agent: { run_id: params.runId } });
      if (!agentRunner.stop(params.runId)) {
        writeJson(response, 404, {
          error: "That agent task is not running.",
        });
        return;
      }
      writeJson(response, 200, agentSessions.snapshot());
    },

    mcpStatus: async ({ response }) => {
      writeJson(response, 200, await storage.getMcpSettings());
    },

    mcpConfigure: async ({ request, response, unit }) => {
      const payload = mcpSettingsUpdateSchema.parse(
        await readJsonBody(request),
      );
      unit.set({ mcp: { enabled: payload.enabled } });
      await storage.setMcpEnabled(payload.enabled);
      if (!payload.enabled) mcpBridge.close();
      writeJson(response, 200, await storage.getMcpSettings());
    },

    mcpClientCreate: async ({ request, response, unit }) => {
      const payload = mcpClientCreateRequestSchema.parse(
        await readJsonBody(request),
      );
      const created = await createMcpClient(storage, payload.name);
      unit.set({ agent: { client_id: created.client.id } });
      writeJson(response, 201, created);
    },

    mcpClientRevoke: async ({ response, params, unit }) => {
      unit.set({ agent: { client_id: params.clientId } });
      const revoked = await storage.revokeMcpClient(
        params.clientId,
        Date.now(),
      );
      if (!revoked) {
        writeJson(response, 404, { error: "Unknown MCP client." });
        return;
      }
      writeJson(response, 200, await storage.getMcpSettings());
    },

    // A new stream replaces the renderer's. A web page can open one with an
    // <img> tag, which sends no Origin, so require the renderer's.
    // EventSource sends Origin because the renderer is cross-origin:
    // http://127.0.0.1:5173 in development, app://local when packaged. The
    // request's event ends when the stream closes.
    mcpBridge: async ({ response, origin, unit }) => {
      if (!origin) {
        unit.refuse("no_origin");
        writeJson(response, 403, { error: "The bridge needs an Origin." });
        return;
      }
      if (!(await storage.getMcpSettings()).enabled) {
        unit.refuse("mcp_off");
        writeJson(response, 404, { error: "MCP is off." });
        return;
      }
      let calls = 0;
      unit.set({ mcp_bridge: { call_count: calls } });
      mcpBridge.attach(response, {
        onCall: () => {
          calls += 1;
          unit.set({ mcp_bridge: { call_count: calls } });
        },
      });
    },

    mcpBridgeResult: async ({ request, response, unit }) => {
      const result = bridgeToolResultSchema.parse(await readJsonBody(request));
      const resolved = mcpBridge.resolve(result);
      unit.set({ mcp_bridge: { resolved } });
      writeJson(response, 200, { ok: resolved });
    },

    // The user's answer to an agent's question, from the agent panel.
    agentQuestionAnswer: async ({ request, response, params, unit }) => {
      unit.set({ agent: { question_id: params.questionId } });
      const payload = agentAnswerRequestSchema.parse(
        await readJsonBody(request),
      );
      try {
        agentSessions.answer(params.questionId, payload.text);
      } catch (error) {
        writeJson(response, 409, { error: errorMessage(error) });
        return;
      }
      writeJson(response, 200, agentSessions.snapshot());
    },

    // The user clears a session from the panel, for an agent that died
    // without ending it.
    agentSessionDismiss: ({ response, params, unit }) => {
      unit.set({ agent: { session_id: params.sessionId } });
      try {
        agentSessions.dismiss(params.sessionId);
      } catch (error) {
        writeJson(response, 409, { error: errorMessage(error) });
        return;
      }
      writeJson(response, 200, agentSessions.snapshot());
    },

    // The user opened the agent panel: earlier errors and failures are seen.
    agentSessionMarkSeen: ({ response }) => {
      agentSessions.markSeen();
      writeJson(response, 200, agentSessions.snapshot());
    },

    pluginOverview: async ({ response, unit }) => {
      writeJson(response, 200, await getOverview(storage, pluginManager, unit));
    },

    pluginManifests: async ({ response, unit }) => {
      const startedAt = Date.now();
      const plugins = await pluginManager.listPlugins();
      unit.set({
        plugin_list: {
          plugin_count: plugins.length,
          discovery_ms: Date.now() - startedAt,
        },
      });
      writeJson(response, 200, plugins);
    },

    pluginSystemToggle: async ({ request, response, unit }) => {
      const payload = pluginSystemActivationUpdateSchema.parse(
        await readJsonBody(request),
      );
      unit.set({ activation: { enabled: payload.enabled } });
      await storage.setPluginSystemEnabled(payload.enabled);
      if (!payload.enabled) {
        const running =
          pluginManager.activeOperationCount +
          projectDataShapePluginManager.activeOperationCount;
        const plugins = await pluginManager.listPlugins();
        await Promise.allSettled(
          plugins.map((plugin) =>
            pluginManager.cancelPluginOperations(
              plugin.id,
              new Error("The Ajour plugin system was deactivated."),
              "system_off",
            ),
          ),
        );
        await projectDataShapePluginManager.cancelOperations(
          new Error("The Ajour plugin system was deactivated."),
          "system_off",
        );
        unit.set({ activation: { operations_cancelled: running } });
      }
      writeJson(response, 200, await getOverview(storage, pluginManager));
    },

    schemaList: async ({ response, unit }) => {
      const pluginsEnabled = await storage.getPluginSystemEnabled();
      const plugins = pluginsEnabled
        ? await projectDataShapePluginManager.listPlugins()
        : [];
      unit.set({ schema_list: { plugin_count: plugins.length } });
      writeJson(
        response,
        200,
        projectDataShapeListResponseSchema.parse({ plugins }),
      );
    },

    projectExport: async ({ request, response, params, unit }) => {
      if (!(await storage.getPluginSystemEnabled())) {
        unit.refuse("system_off");
        writeJson(response, 409, {
          error: "The Ajour plugin system is deactivated.",
        });
        return;
      }
      const pluginId = projectDataShapePluginIdSchema.parse(params.pluginId);
      unit.set({ plugin: { id: pluginId } });
      // A malformed body fails here, outside the try, as a 400.
      const exportRequest = projectDataShapeExportRequestSchema.parse(
        await readJsonBody(request),
      );
      unit.set({
        project_data: {
          project_count: exportRequest.projects.length,
          task_count: exportRequest.projects.reduce(
            (count, project) => count + project.tasks.length,
            0,
          ),
        },
      });
      try {
        const result = projectDataShapeExportResponseSchema.parse(
          await projectDataShapePluginManager.exportProjects(
            pluginId,
            exportRequest.projects,
          ),
        );
        unit.set({
          project_data: {
            row_count: result.datasets.reduce(
              (count, dataset) => count + dataset.rows.length,
              0,
            ),
          },
        });
        writeJson(response, 200, result);
      } catch (error) {
        unit.fail(error);
        writeJson(response, 400, {
          error: connectionlessPluginErrorMessage(error),
        });
      }
    },

    projectImport: async ({ request, response, params, unit }) => {
      if (!(await storage.getPluginSystemEnabled())) {
        unit.refuse("system_off");
        writeJson(response, 409, {
          error: "The Ajour plugin system is deactivated.",
        });
        return;
      }
      const pluginId = projectDataShapePluginIdSchema.parse(params.pluginId);
      unit.set({ plugin: { id: pluginId } });
      // A malformed body fails here, outside the try, as a 400.
      const importRequest = projectDataShapeImportRequestSchema.parse(
        await readJsonBody(request),
      );
      unit.set({
        project_data: {
          row_count: importRequest.datasets.reduce(
            (count, dataset) => count + dataset.rows.length,
            0,
          ),
        },
      });
      try {
        const result = projectDataShapeImportResponseSchema.parse(
          await projectDataShapePluginManager.importProjects(
            pluginId,
            importRequest.datasets,
          ),
        );
        unit.set({
          project_data: {
            project_count: result.projects.length,
            task_count: result.projects.reduce(
              (count, project) => count + project.tasks.length,
              0,
            ),
          },
        });
        writeJson(response, 200, result);
      } catch (error) {
        unit.fail(error);
        writeJson(response, 400, {
          error: connectionlessPluginErrorMessage(error),
        });
      }
    },

    pluginActivate: async ({ request, response, params, unit }) => {
      const pluginId = pluginIdSchema.parse(params.pluginId);
      unit.set({ plugin: { id: pluginId } });
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
      unit.set({
        activation: {
          enabled: payload.enabled,
          ...(payload.capability ? { capability: payload.capability } : {}),
        },
      });
      const running = pluginManager.activeOperationCount;
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
          unit.set({
            activation: {
              operations_cancelled:
                running - pluginManager.activeOperationCount,
            },
          });
        }
        writeJson(response, 200, await getOverview(storage, pluginManager));
        return;
      }
      await storage.setPluginEnabled(pluginId, payload.enabled);
      if (!payload.enabled) {
        await pluginManager.cancelPluginOperations(
          pluginId,
          new Error(`Plugin "${pluginId}" was deactivated.`),
          "plugin_off",
        );
        unit.set({
          activation: {
            operations_cancelled: running - pluginManager.activeOperationCount,
          },
        });
      }
      writeJson(response, 200, await getOverview(storage, pluginManager));
    },

    sourceStateList: async ({ response, unit }) => {
      const statuses = backlogSourceStatusListResponseSchema.parse(
        await storage.listBacklogSourceStatuses(),
      );
      unit.set({ source_state: { count: statuses.items.length } });
      writeJson(response, 200, statuses);
    },

    sourceStateUpdate: async ({ request, response, unit }) => {
      const payload = backlogSourceStatusUpsertRequestSchema.parse(
        await readJsonBody(request),
      );
      unit.set({ source_state: { count: payload.items.length } });
      writeJson(
        response,
        200,
        backlogSourceStatusUpsertResponseSchema.parse({
          items: await storage.upsertBacklogSourceStatuses(payload.items),
        }),
      );
    },

    connectionSave: async ({ request, response, params, unit }) => {
      const pluginId = pluginIdSchema.parse(params.pluginId);
      unit.set({ plugin: { id: pluginId } });
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
        unit.refuse("not_installed");
        writeJson(response, 400, {
          error: unavailableReason ?? `Plugin "${pluginId}" is not installed.`,
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
      unit.set({
        connection: {
          is_new: !existingConnection,
          field_count: Object.keys(configForSave).length,
          capability_count: capabilities.length,
          ...(existingConnection ? { id: existingConnection.id } : {}),
        },
      });
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
        unit.fail(error, {
          secrets: connectionSecretValues(call.manifest, [
            configForSave,
            existingConnection?.config,
          ]),
        });
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
      unit.set({ connection: { id: storedConnection.id } });
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
    },

    connectionDelete: async ({ response, params, unit }) => {
      const pluginId = pluginIdSchema.parse(params.pluginId);
      const { connectionId } = params;
      unit.set({ plugin: { id: pluginId }, connection: { id: connectionId } });
      const deleted = await storage.deleteConnection(pluginId, connectionId);
      if (!deleted) {
        writeJson(response, 404, {
          error: "Plugin connection not found.",
        });
        return;
      }

      writeJson(response, 200, await getOverview(storage, pluginManager));
    },

    settleStateList: (context) => serveSettle(context, "settle-states"),

    settleWrite: (context) => serveSettle(context, "settle"),

    descriptionRead: (context) => serveDescription(context, false),

    descriptionWrite: (context) => serveDescription(context, true),

    backlogSync: async ({ request, response, params, unit }) => {
      const pluginId = pluginIdSchema.parse(params.pluginId);
      const { connectionId } = params;
      unit.set({ plugin: { id: pluginId }, connection: { id: connectionId } });
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
      const inactive = await inactiveCapability(
        storage,
        pluginId,
        "connector",
        availablePluginIds,
        "syncing",
      );
      if (inactive) {
        unit.refuse(inactive.reason);
        writeJson(response, 409, { error: inactive.message });
        return;
      }

      const connection = await storage.getConnection(pluginId, connectionId);
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
      unit.set({
        backlog_sync: {
          trigger: payload.trigger,
          mode: shouldAutoSyncToBacklog ? "backlog" : "review",
          items_sent: payload.workItems.length,
        },
      });

      const call = admittedCall(plugin);
      try {
        const fetched = await pluginManager.syncConnection(
          pluginId,
          invocationConnection(connection),
          payload.workItems,
          call.admit,
        );
        const { openItems, doneItems } = splitDoneItems(fetched.items);
        unit.set({
          backlog_sync: {
            items_received: fetched.items.length,
            done_count: doneItems.length,
            work_item_update_count: fetched.workItemUpdates.length,
            comment_fact_count: fetched.commentFacts.length,
          },
        });
        if (
          !(await storage.isPluginCapabilityEnabled(
            pluginId,
            "connector",
            availablePluginIds,
          ))
        ) {
          unit.refuse("deactivated_during_sync");
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
        unit.set({
          backlog_sync: {
            staged_count: stageResult.queuedCount,
            updated_count: stageResult.updatedCount,
            skipped_count: stageResult.skippedCount,
          },
        });
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
              connectionRedaction(
                connectionSecretValues(call.manifest, [connection.config]),
              ),
            ),
            doneItems,
            viewer: fetched.viewer,
            commentFacts: fetched.commentFacts,
          }),
        );
      } catch (error) {
        unit.fail(error, {
          secrets: connectionSecretValues(call.manifest, [connection.config]),
        });
        const message = pluginErrorMessage(
          error,
          call.manifest,
          connection.config,
        );
        await storage.recordConnectionError(pluginId, connectionId, message);
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
    },

    codeHost: async ({ request, response, params, unit }) => {
      const pluginId = pluginIdSchema.parse(params.pluginId);
      const { connectionId } = params;
      unit.set({ plugin: { id: pluginId }, connection: { id: connectionId } });
      const operation = codeHostOperationSchema.safeParse(params.operation);
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
      const inactive = await inactiveCapability(
        storage,
        pluginId,
        "codeHost",
        pluginIds,
        "using its pull requests",
      );
      if (inactive) {
        unit.refuse(inactive.reason);
        writeJson(response, 409, { error: inactive.message });
        return;
      }
      const connection = await storage.getConnection(pluginId, connectionId);
      if (!connection) {
        writeJson(response, 404, { error: "Connection not found." });
        return;
      }

      // A malformed body fails here, outside the try, as a 400.
      const codeHostRequest = codeHostOperations[operation.data].request.parse(
        await readJsonBody(request),
      );
      unit.set(codeHostRequestFields(codeHostRequest));
      const call = admittedCall(plugin);
      try {
        const result = await pluginManager.runCodeHostOperation(
          pluginId,
          operation.data,
          invocationConnection(connection),
          codeHostRequest,
          call.admit,
        );
        unit.set(codeHostResultFields(result));
        if (operation.data === "syncPullRequests") {
          await storage.recordConnectionSyncSuccess(
            pluginId,
            connectionId,
            Date.now(),
          );
        }
        writeJson(response, 200, result);
      } catch (error) {
        unit.fail(error, {
          secrets: connectionSecretValues(call.manifest, [connection.config]),
        });
        const message = pluginErrorMessage(
          error,
          call.manifest,
          connection.config,
        );
        if (operation.data === "syncPullRequests") {
          await storage.recordConnectionError(pluginId, connectionId, message);
        }
        writeJson(response, 502, { error: message });
      }
    },

    backlogComment: async ({ request, response, url, params, unit }) => {
      const pluginId = pluginIdSchema.parse(params.pluginId);
      const { connectionId } = params;
      unit.set({ plugin: { id: pluginId }, connection: { id: connectionId } });
      const operation = backlogCommentOperationSchema.safeParse(
        params.operation,
      );
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
      const inactive = await inactiveCapability(
        storage,
        pluginId,
        "connector",
        pluginIds,
        "using its comments",
      );
      if (inactive) {
        unit.refuse(inactive.reason);
        writeJson(response, 409, { error: inactive.message });
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
      // An agent's call says so; Ajour's own pages don't. The access it
      // needs follows from the operation, not from the caller.
      const forAgent = url.searchParams.get("agent") === "1";
      const agentNeed =
        operation.data === "listItemComments" ||
        operation.data === "searchItemPeople"
          ? "read"
          : "readWrite";
      // Ids, counts and duration only. Comment text and authors stay out
      // of the event (ADR 0008).
      if (operation.data === "listItemComments") {
        unit.set({
          comment: {
            page:
              "cursor" in commentRequest && commentRequest.cursor
                ? "earlier"
                : "latest",
          },
        });
      } else if ("body" in commentRequest) {
        // Its size and its mentions, never its text.
        unit.set({
          comment: {
            body_length: commentRequest.body.length,
            mention_count:
              commentRequest.body.match(/\]\(mention:/g)?.length ?? 0,
          },
        });
      }
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
        unit.refuse("agent_access");
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
        throw new PluginOperationRefused(agentRefusal, "agent_access");
      };
      try {
        const result = await pluginManager.runBacklogCommentOperation(
          pluginId,
          operation.data,
          invocationConnection(connection),
          commentRequest,
          admit,
        );
        // A read's text leaves only while the agent may still read. A
        // change was allowed at admission and has happened: it stands.
        if (agentNeed === "read" && !(await agentAllowed())) {
          refuseAgent();
          return;
        }
        if ("comments" in result) {
          unit.set({
            comment: { comment_count: result.comments.length },
          });
        } else if ("people" in result) {
          unit.set({ mention: { result_count: result.people.length } });
        }
        writeJson(response, 200, result);
      } catch (error) {
        if (refusedAtAdmission) {
          refuseAgent();
          return;
        }
        const secrets = connectionSecretValues(call.manifest, [
          connection.config,
        ]);
        unit.fail(error, { secrets });
        writeJson(response, 502, {
          error: redactPluginText(errorMessage(error), secrets),
        });
      }
    },

    calendar: async ({ request, response, params, unit }) => {
      const pluginId = pluginIdSchema.parse(params.pluginId);
      const { connectionId } = params;
      unit.set({ plugin: { id: pluginId }, connection: { id: connectionId } });
      const operation = calendarOperationSchema.safeParse(params.operation);
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
      const inactive = await inactiveCapability(
        storage,
        pluginId,
        "calendar",
        pluginIds,
        "using its calendar",
      );
      if (inactive) {
        unit.refuse(inactive.reason);
        writeJson(response, 409, { error: inactive.message });
        return;
      }
      const connection = await storage.getConnection(pluginId, connectionId);
      if (!connection) {
        writeJson(response, 404, { error: "Connection not found." });
        return;
      }

      // A malformed body fails here, outside the try, as a 400.
      const calendarRequest = calendarOperations[operation.data].request.parse(
        await readJsonBody(request),
      );
      // Ids, range, counts and duration only. Titles and the calendar
      // address stay out of the event (ADR 0005).
      unit.set({
        calendar: {
          range_days:
            (Date.parse(`${calendarRequest.to}T00:00:00Z`) -
              Date.parse(`${calendarRequest.from}T00:00:00Z`)) /
              86_400_000 +
            1,
        },
      });
      const call = admittedCall(plugin);
      try {
        const result = await pluginManager.runCalendarOperation(
          pluginId,
          operation.data,
          invocationConnection(connection),
          calendarRequest,
          call.admit,
        );
        await storage.recordConnectionSyncSuccess(
          pluginId,
          connectionId,
          Date.now(),
        );
        unit.set({ calendar: { event_count: result.events.length } });
        writeJson(response, 200, result);
      } catch (error) {
        const secrets = connectionSecretValues(call.manifest, [
          connection.config,
        ]);
        const message = redactPluginText(errorMessage(error), secrets);
        unit.fail(error, { secrets });
        await storage.recordConnectionError(pluginId, connectionId, message);
        writeJson(response, 502, { error: message });
      }
    },

    teamCreate: async ({ request, response, params, unit }) => {
      const pluginId = pluginIdSchema.parse(params.pluginId);
      unit.set({ plugin: { id: pluginId } });
      const plugin = await teamPlugin(pluginId, response, unit, true);
      if (!plugin) return;
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
        unit.fail(error, {
          secrets: connectionSecretValues(call.manifest, [payload.values]),
        });
        writeJson(response, 502, {
          error: pluginErrorMessage(error, call.manifest, payload.values),
        });
      }
    },

    teamSync: async ({ request, response, params, unit }) => {
      const pluginId = pluginIdSchema.parse(params.pluginId);
      const { connectionId } = params;
      unit.set({ plugin: { id: pluginId }, connection: { id: connectionId } });
      const plugin = await teamPlugin(pluginId, response, unit, false);
      if (!plugin) return;
      const connection = await storage.getConnection(pluginId, connectionId);
      if (!connection) {
        writeJson(response, 404, { error: "Connection not found." });
        return;
      }
      const syncRequest = teamSyncRequestSchema.parse(
        await readJsonBody(request),
      );
      unit.set({ team_sync: { projects_sent: syncRequest.changes.length } });
      const call = admittedCall(plugin);
      try {
        const result = await pluginManager.syncTeamProjects(
          pluginId,
          invocationConnection(connection),
          syncRequest,
          call.admit,
        );
        unit.set({
          team_sync: {
            projects_received: result.projects.length,
            assigned_count: result.assigned.length,
            has_more: result.hasMore,
          },
        });
        await storage.recordConnectionSyncSuccess(
          pluginId,
          connectionId,
          Date.now(),
        );
        writeJson(response, 200, result);
      } catch (error) {
        unit.fail(error, {
          secrets: connectionSecretValues(call.manifest, [connection.config]),
        });
        const message = pluginErrorMessage(
          error,
          call.manifest,
          connection.config,
        );
        await storage.recordConnectionError(pluginId, connectionId, message);
        writeJson(response, 502, { error: message });
      }
    },

    backlogImportStage: async ({ request, response, unit }) => {
      const payload = backlogImportPushRequestSchema.parse(
        await readJsonBody(request),
      );
      const staged = backlogImportPushResponseSchema.parse(
        await storage.stageImportItems(payload.items),
      );
      unit.set({
        backlog_import: {
          candidate_count: payload.items.length,
          staged_count: staged.queuedCount,
          updated_count: staged.updatedCount,
        },
      });
      writeJson(response, 200, staged);
    },

    backlogImportList: async ({ response, unit }) => {
      const imports = backlogImportListResponseSchema.parse(
        await storage.listStagedImports(),
      );
      unit.set({ backlog_import: { candidate_count: imports.items.length } });
      writeJson(response, 200, imports);
    },

    backlogImportSelect: async ({ request, response, unit }) => {
      const payload = backlogImportSelectionUpdateSchema.parse(
        await readJsonBody(request),
      );
      const updatedCount = await storage.updateImportSelection(
        payload.ids,
        payload.selected,
      );
      unit.set({
        backlog_import: {
          candidate_count: payload.ids.length,
          updated_count: updatedCount,
        },
      });
      writeJson(
        response,
        200,
        backlogImportSelectionResponseSchema.parse({ updatedCount }),
      );
    },

    backlogImportDismiss: async ({ request, response, unit }) => {
      const payload = backlogImportDismissRequestSchema.parse(
        await readJsonBody(request),
      );
      unit.set({ backlog_import: { candidate_count: payload.ids.length } });
      writeJson(
        response,
        200,
        backlogImportDismissResponseSchema.parse(
          await storage.dismissImports(payload.ids),
        ),
      );
    },

    backlogImportRestore: async ({ request, response }) => {
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
    },

    backlogImportCommit: async ({ response, unit }) => {
      const items = await storage.commitSelectedImports();
      unit.set({ backlog_import: { committed_count: items.length } });
      writeJson(
        response,
        200,
        backlogImportCommitResponseSchema.parse({
          items,
          committedCount: items.length,
        }),
      );
    },
  };

  /** The settle routes: the states a settle can write, and the write itself. */
  async function serveSettle(
    {
      request,
      response,
      params,
      unit,
    }: RouteContext<"settleStateList" | "settleWrite">,
    action: "settle-states" | "settle",
  ) {
    const pluginId = pluginIdSchema.parse(params.pluginId);
    const { connectionId } = params;
    unit.set({ plugin: { id: pluginId }, connection: { id: connectionId } });
    const connection = await storage.getConnection(pluginId, connectionId);
    if (!connection) {
      writeJson(response, 404, {
        error: "Plugin connection not found.",
      });
      return;
    }
    const { plugin, pluginIds } = await findPlugin(pluginManager, pluginId);
    const inactive = await inactiveCapability(
      storage,
      pluginId,
      "connector",
      pluginIds,
      "settling",
    );
    if (inactive) {
      unit.refuse(inactive.reason);
      writeJson(response, 409, { error: inactive.message });
      return;
    }
    if (!plugin?.capabilities.connector?.settle) {
      writeJson(response, 409, {
        error: "This plugin does not support settling.",
      });
      return;
    }

    const body = await readJsonBody(request);
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
        const result = backlogSettleStatesResultSchema.parse(
          await pluginManager.listSettleStates(
            pluginId,
            invocationConnection(connection),
            statesRequest,
            call.admit,
          ),
        );
        (unit as Unit<AjourCatalog, "settle_state.list">).set({
          settle_state: { count: result.states.length },
        });
        writeJson(response, 200, result);
        return;
      }
      if (writeRequest) {
        (unit as Unit<AjourCatalog, "backlog.write_source">).set({
          source_write: {
            state_sent: writeRequest.state !== undefined,
            priority_sent: writeRequest.priority !== undefined,
          },
        });
        const result = await pluginManager.writeSettle(
          pluginId,
          invocationConnection(connection),
          writeRequest,
          call.admit,
        );
        writeJson(response, 200, backlogSettleWriteResultSchema.parse(result));
      }
    } catch (error) {
      unit.fail(error, {
        secrets: connectionSecretValues(call.manifest, [connection.config]),
      });
      writeJson(response, 502, {
        error: pluginErrorMessage(error, call.manifest, connection.config),
      });
    }
  }

  /** A synced item's description: read as its source holds it, or written. */
  async function serveDescription(
    {
      request,
      response,
      url,
      params,
      unit,
    }: RouteContext<"descriptionRead" | "descriptionWrite">,
    writes: boolean,
  ) {
    const pluginId = pluginIdSchema.parse(params.pluginId);
    const { connectionId } = params;
    unit.set({ plugin: { id: pluginId }, connection: { id: connectionId } });
    const connection = await storage.getConnection(pluginId, connectionId);
    if (!connection) {
      writeJson(response, 404, {
        error: "Plugin connection not found.",
      });
      return;
    }
    const { plugin, pluginIds } = await findPlugin(pluginManager, pluginId);
    const inactive = await inactiveCapability(
      storage,
      pluginId,
      "connector",
      pluginIds,
      "syncing descriptions",
    );
    if (inactive) {
      unit.refuse(inactive.reason);
      writeJson(response, 409, { error: inactive.message });
      return;
    }
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
    // A malformed body fails here, outside the try, as a 400.
    const readRequest = writes
      ? undefined
      : backlogReadDescriptionRequestSchema.parse(body);
    const writeRequest = writes
      ? backlogWriteDescriptionRequestSchema.parse(body)
      : undefined;
    if (writeRequest) {
      (unit as Unit<AjourCatalog, "description.write">).set({
        description: {
          length: writeRequest.text.length,
          allowed_loss_count: writeRequest.allowedLoss?.length ?? 0,
        },
      });
    }
    // An agent's call says so; it needs Read to read the description
    // and Read and write to change it, whatever the page asks.
    if (
      url.searchParams.get("agent") === "1" &&
      !agentAccessAllows(
        connectionAgentAccess(connection),
        writes ? "readWrite" : "read",
      )
    ) {
      unit.refuse("agent_access");
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
      (unit as Unit<AjourCatalog, "description.write">).refuse(
        "lossy_not_allowed",
      );
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
          invocationConnection(connection),
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
          invocationConnection(connection),
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
      unit.fail(error, {
        secrets: connectionSecretValues(call.manifest, [connection.config]),
      });
      // The message reaches the user and is stored with the item.
      writeJson(response, 502, {
        error: pluginErrorMessage(error, call.manifest, connection.config),
      });
    }
  }

  /**
   * The team plugin a team route runs, or undefined once it answered why
   * not: the plugin has no team, or it or its team capability is off.
   */
  async function teamPlugin(
    pluginId: string,
    response: ServerResponse,
    unit: Unit<AjourCatalog, "team.create" | "team.sync">,
    create: boolean,
  ) {
    const { plugin, pluginIds } = await findPlugin(pluginManager, pluginId);
    if (!plugin || !pluginHasTeam(plugin)) {
      writeJson(response, 404, {
        error: "This plugin does not sync a team's projects.",
      });
      return undefined;
    }
    const inactive = await inactiveCapability(
      storage,
      pluginId,
      "team",
      pluginIds,
      create ? "creating a team" : "syncing its projects",
    );
    if (inactive) {
      unit.refuse(inactive.reason);
      writeJson(response, 409, { error: inactive.message });
      return undefined;
    }
    return plugin;
  }

  const server = createServer((request, response) => {
    void serveRequest(request, response);
  });

  /**
   * Serves one request inside its event. The host check comes first, then
   * MCP, which has its own rules (bearer tokens, and no browser origins at
   * all), then the origin check and the route table.
   */
  async function serveRequest(
    request: IncomingMessage,
    response: ServerResponse,
  ) {
    const url = requestUrlOf(request);
    const isMcp = url.pathname === "/mcp" || url.pathname.startsWith("/mcp/");
    const fromAgent = isMcp || url.searchParams.get("agent") === "1";
    await serveWithEvent(
      events,
      request,
      response,
      { trigger: fromAgent ? "agent" : "system" },
      async (unit) => {
        if (runtime.stopping) {
          unit.refuse("stopping");
          writeJson(response, 503, { error: "App API is shutting down." });
          return;
        }
        if (
          request.headers.host &&
          !isAllowedRequestHost(request.headers.host)
        ) {
          unit.refuse("host_refused");
          writeJson(response, 403, { error: "Request host is not allowed." });
          return;
        }
        if (isMcp) {
          try {
            await handleMcpRequest(request, response, url.pathname, {
              ...mcpContext,
              unit,
            });
          } catch (error) {
            // An outcome MCP recorded stands, as a thrown error never
            // downgrades it.
            if (unit.outcome === undefined) unit.fail(error);
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
          unit.set({ http: { origin: "refused" } }).refuse("origin_refused");
          writeJson(response, 403, { error: "Request origin is not allowed." });
          return;
        }
        unit.set({ http: { origin: requestOrigin ? "app" : "none" } });
        if (requestOrigin) {
          response.setHeader("Access-Control-Allow-Origin", requestOrigin);
          response.setHeader("Vary", "Origin");
        }

        if (request.method === "OPTIONS") {
          writeJson(response, 204);
          return;
        }

        const route = matchRoute(request.method, url.pathname);
        if (!route) {
          unit.refuse("no_route");
          writeJson(response, 404, {
            error: `No route for ${request.method ?? "GET"} ${url.pathname}`,
          });
          return;
        }
        const routed = route.name ? unit.rename(route.name) : unit;
        routed.set({ http: { route: route.path } });
        try {
          const handle = handlers[route.id] as (
            context: RouteContext<RouteId>,
          ) => Promise<void> | void;
          await handle({
            request,
            response,
            url,
            origin: requestOrigin,
            params: decodeParams(route.rawParams) as RouteParams<RouteId>,
            unit: routed as RouteContext<RouteId>["unit"],
          });
        } catch (error) {
          // Ajour's own errors only. Only a route knows the connection whose
          // secrets a plugin error may echo, so each catches its plugin call
          // and answers with `pluginErrorMessage`.
          const invalid = invalidRequestError(error);
          if (invalid) routed.fail(invalid).refuse("invalid_request");
          else routed.fail(error);
          writeJson(response, 400, {
            error: errorMessage(error),
          });
        }
      },
    );
  }

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
  const runtime = appApiRuntimesByServer.get(server)!;
  const unit = runtime.events.start("api.start", {
    kind: "lifecycle",
    trigger: "boot",
  });
  unit.set({ api: { port } });
  const listenStartedAt = Date.now();

  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, host, () => {
        server.off("error", reject);
        resolve();
      });
    });
  } catch (error) {
    unit.fail(error, {
      reason:
        (error as { code?: unknown } | null)?.code === "EADDRINUSE"
          ? "port_in_use"
          : "listen_error",
    });
    throw error;
  } finally {
    const address = server.address();
    unit.set({
      api: {
        listen_ms: Date.now() - listenStartedAt,
        ...(address && typeof address === "object"
          ? { port: address.port }
          : {}),
      },
    });
    unit.end();
  }
  runtime.port =
    (server.address() as { port?: number } | null)?.port ?? runtime.port;
  if (options.reportProcessCrashes) {
    runtime.stopWatchingCrashes = watchProcessCrashes(runtime.events);
  }

  return server;
}

/**
 * Stops the API: new requests are refused, the agent runner and the plugin
 * hosts stop, then the connections close. Its `api.stop` event times each
 * phase.
 */
export async function stopAppApiServer(server: Server): Promise<void> {
  const runtime = appApiRuntimesByServer.get(server);
  const unit = runtime?.events.start("api.stop", {
    kind: "lifecycle",
    trigger: "system",
  });
  try {
    if (runtime) {
      runtime.stopping = true;
      runtime.stopWatchingCrashes?.();
      unit?.set({
        api: {
          port: runtime.port,
          plugin_operations_running:
            runtime.pluginManager.activeOperationCount +
            runtime.projectDataShapePluginManager.activeOperationCount,
        },
      });
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
    let phaseStartedAt = Date.now();
    await runtime?.agentRunner.shutdown();
    unit?.set({ api: { agent_runner_ms: Date.now() - phaseStartedAt } });
    phaseStartedAt = Date.now();
    await Promise.all([
      runtime?.pluginManager.shutdown(),
      runtime?.projectDataShapePluginManager.shutdown(),
    ]);
    unit?.set({ api: { plugins_ms: Date.now() - phaseStartedAt } });
    phaseStartedAt = Date.now();
    server.closeAllConnections();
    await closePromise;
    unit?.set({ api: { close_ms: Date.now() - phaseStartedAt } });
  } catch (error) {
    unit?.fail(error);
    throw error;
  } finally {
    unit?.end();
  }
}

const executedDirectly =
  typeof process.argv[1] === "string" &&
  import.meta.url === pathToFileURL(process.argv[1]).toString();

// Run on its own, as `just api-start` does, the API says on stderr where it
// listens. Started by the desktop app or a test, it prints nothing.
if (executedDirectly) {
  // The standalone API owns its process, so it records the process's crashes.
  void startAppApiServer({ reportProcessCrashes: true }).then((server) => {
    const address = server.address();
    if (address && typeof address === "object") {
      // On stderr: stdout carries the console sink's JSON lines.
      console.error(
        `Ajour app API listening on http://${address.address}:${address.port}`,
      );
    }
  });
}
