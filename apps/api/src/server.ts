import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { randomUUID } from "node:crypto";
import type { Socket } from "node:net";
import { existsSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
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
  connectionSecretsRemoveRequestSchema,
  teamCreateRouteRequestSchema,
  AGENT_ACCESS_FIELD_ID,
  ALLOW_LOSSY_FIELD_ID,
  ON_PREMISES_FIELD_ID,
  agentAccessAllows,
  agentAccessSchema,
  connectionAgentAccess,
  type AgentAccess,
} from "../../../packages/shared/plugins.ts";
import {
  codeHostOperationSchema,
  codeHostOperations,
  type CodeHostOperation,
  type CodeHostOperationRequest,
  type CodeHostOperationResult,
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
import type {
  AjourCatalog,
  FieldsOf,
} from "../../../packages/wide-events/catalog.ts";
import type { FailOptions, Unit } from "../../../packages/wide-events/index.ts";
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
import { RESERVED_CONNECTION_FIELD_IDS } from "./connection-values.ts";
import {
  ConnectionPausedError,
  api4SavedConfig,
  connectionCredentials,
  effectiveSecretFields,
  isEmptySecretValue,
  mergeSecretsForSave,
  pluginConnection,
  redactionFields,
  secretManifestOf,
  type SecretFieldDeclaration,
} from "./connection-credentials.ts";
import { VaultUnavailableError, type SecretVault } from "./secret-vault.ts";
import {
  BrokerRequestError,
  CredentialBroker,
  type BrokerConnection,
  type BrokerResolver,
  type BrokerTransport,
} from "./credential-broker.ts";
import {
  isPluginApi4Manifest,
  pluginNetworkFieldIds,
  type PluginApi4Manifest,
} from "../../../packages/shared/plugin-api-4.ts";
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
import type { AgentCliAdapter } from "./agent-runner/adapter.ts";
import { isChromeInstalled } from "./agent-runner/chrome.ts";
import {
  findExecutable,
  resolveLoginShellPath,
} from "./agent-runner/cli-path.ts";
import { playwrightMcpServer } from "./agent-runner/playwright-mcp.ts";
import { AgentRunError, AgentRunner } from "./agent-runner/runner.ts";
import {
  capabilityOfMethod,
  PluginManager,
  type PluginAdmitted,
  type PluginMethod,
} from "./plugin-host.ts";
import {
  PluginOperationCancelled,
  PluginOperationRefused,
  PluginWorkerFailure,
  type PluginFailureReason,
} from "./plugin-worker-lifetime.ts";
import { ProjectDataShapePluginManager } from "./project-data-shape-host.ts";
import type { PluginRuntime } from "./plugin-runtime.ts";
import { WorkerPluginRuntime } from "./plugin-worker-runtime.ts";
import {
  connectionlessPluginErrorMessage,
  errorMessage,
  type ConnectionRedaction,
} from "./plugin-errors.ts";
import {
  InvalidPluginResultError,
  InvalidRequestError,
  readInput,
  RequestBodyInterrupted,
  withoutContent,
} from "./event-errors.ts";
import {
  decodeParams,
  matchRoute,
  ROUTES,
  serveWithEvent,
  type RouteContext,
  type RouteHandlers,
  type RouteId,
  type RouteParams,
  type Settlement,
} from "./routes.ts";
import {
  createWindowToken,
  holdsWindowToken,
  WINDOW_TOKEN_HEADER,
} from "./window-token.ts";
import {
  AppApiStorage,
  resolveStatePath,
  type ConnectionWithSecrets,
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
  /**
   * What runs plugin code, for both the plugin and the data-shape host. A
   * worker thread per operation by default. Tests run plugins in process.
   */
  pluginRuntime?: PluginRuntime;
  projectDataShapePluginDirectories?: string[];
  allowedOrigins?: string[];
  /**
   * The launch's window token. Every `/api` route but `/api/health` answers
   * only a request that carries it, as Electron main and vite's dev proxy add
   * it. Whoever starts the API generates it and keeps it in memory. Without
   * one, the API makes its own that nobody holds, so no caller reaches `/api`.
   */
  windowToken?: string;
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
  /**
   * Where secrets live, encrypted by the operating system. The desktop app
   * passes a `FileSecretVault` with Electron's `safeStorage`; tests pass a
   * fake. Without one, as in the standalone API, the API holds no secrets:
   * it refuses secret fields, and connections that need one pause.
   */
  vault?: SecretVault;
  /**
   * The agent CLIs the runner can start. Defaults to Claude Code, Codex and
   * OpenCode. Tests replace them with the fake CLI.
   */
  agentCliAdapters?: AgentCliAdapter[];
  /**
   * How the broker sends an API 4 plugin's requests. The desktop app passes
   * Electron's `net.request` on a session of the broker's own; tests pass a
   * fake. Without one, as in the standalone API, every request is refused:
   * plugins need the desktop app.
   */
  brokerTransport?: BrokerTransport;
  /** How the broker resolves a host, as its transport would. Node's `dns.lookup` by default. */
  brokerResolver?: BrokerResolver;
  /**
   * How long the broker's records for Access review gather in memory
   * between two writes of the state file: 30 s by default.
   */
  brokerActivityWindowMs?: number;
}

/** The vault file the desktop app keeps beside the state file. */
export { FileSecretVault } from "./secret-vault.ts";

interface AppApiRuntime {
  events: ApiEvents;
  /** The connections open now. */
  openSockets: Set<Socket>;
  /** The connections a stop closed, so their requests say `stopping`. */
  cutOffSockets: WeakSet<Socket>;
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
 * manifest the route read stands in. `secrets`, the fields the vault holds
 * for the call's connection, stay secret whatever the manifest says: the
 * admission gives the host those fields too, for the call's own event.
 */
function admittedCall(
  manifest: PluginManifest,
  secrets?: StoredConnection["secrets"],
) {
  const call = {
    manifest,
    admit: (admitted: PluginManifest): PluginAdmitted => {
      call.manifest = admitted;
      return redactionFields(admitted.connectionFields, secrets);
    },
    /** The credentials of `configs`, with the admitted package's secret fields. */
    credentials: (...configs: (PluginFieldValues | undefined)[]) =>
      connectionCredentials(
        redactionFields(call.manifest.connectionFields, secrets),
        ...configs,
      ),
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
  extraHeaders: Record<string, string> = {},
) {
  const headers = {
    // The renderer sends `traceparent` on every call, so its request events
    // join the renderer's trace. The window token is added by Electron main
    // or the dev proxy.
    "Access-Control-Allow-Headers": `Content-Type, ${WINDOW_TOKEN_HEADER}, traceparent`,
    "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
    ...extraHeaders,
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
  // Leaving the loop early must not destroy the request: a body over the
  // limit still gets its answer, before the connection closes.
  try {
    for await (const chunk of request.iterator({ destroyOnReturn: false })) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      totalBytes += buffer.byteLength;
      if (totalBytes > MAX_JSON_BODY_BYTES) {
        throw new InvalidRequestError(new BodyTooLargeError());
      }
      chunks.push(buffer);
    }
  } catch (error) {
    if (error instanceof InvalidRequestError) throw error;
    // The body stream itself failed, such as when its client hung up.
    throw new RequestBodyInterrupted(error);
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
    throw new InvalidRequestError(new InvalidJsonError());
  }
}

/** How long a connection that sent too large a body stays open after its answer. */
const BODY_TOO_LARGE_GRACE_MS = 1_000;

/** A JSON body over the limit. Ajour stops reading it and closes the connection. */
class BodyTooLargeError extends Error {
  readonly code = "body_too_large";

  constructor() {
    super(`JSON request body exceeds ${MAX_JSON_BODY_BYTES} bytes.`);
    this.name = "BodyTooLargeError";
  }
}

/**
 * Answers a request Ajour couldn't read with a 400. A body over the limit
 * isn't read further: the answer says the connection closes, and it closes
 * once the answer is out, so a client that keeps sending stops at once.
 */
function writeInvalidRequest(
  request: IncomingMessage,
  response: ServerResponse,
  error: InvalidRequestError,
) {
  if (!(error.cause instanceof BodyTooLargeError)) {
    writeJson(response, 400, { error: errorMessage(error) });
    return;
  }
  request.pause();
  const socket = request.socket;
  if (socket) {
    // The connection closes within the grace period of the limit being
    // crossed, whether or not the answer could go out: it may wait behind
    // another response on the same connection, such as the bridge stream.
    const deadline = setTimeout(
      () => socket.destroy(),
      BODY_TOO_LARGE_GRACE_MS,
    );
    deadline.unref();
    socket.once("close", () => clearTimeout(deadline));
    // Node closes a `Connection: close` socket as soon as the answer is
    // out. With the client's bytes still arriving, that close would reset
    // the connection and could drop the answer, so it ends the connection
    // instead and drops what still arrives until the deadline.
    socket.destroySoon = () => {
      socket.end();
      request.resume();
    };
  }
  writeJson(
    response,
    400,
    { error: errorMessage(error) },
    { Connection: "close" },
  );
}

/** Reads a JSON body and checks it against the route's schema. */
async function readRequest<Value>(
  request: IncomingMessage,
  schema: { parse(value: unknown): Value },
): Promise<Value> {
  const body = await readJsonBody(request);
  return readInput(() => schema.parse(body));
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
 * Records a failed plugin call on its route's event with the reason its
 * plugin operation ended with, so a request and its operation say the same:
 * a refusal or a cancellation, a timeout, a result that broke its contract
 * by its type and code, or the plugin's error scrubbed of the connection's
 * secrets. Every event a route that runs a plugin operation emits lists
 * these reasons in the catalog, or this fails to compile.
 */
function recordPluginFailure(
  unit: {
    refuse(reason?: PluginFailureReason): unknown;
    cancel(reason?: PluginFailureReason): unknown;
    fail(error: unknown, options?: FailOptions<PluginFailureReason>): unknown;
    count(counter: "secrets_rejected_mark_failed"): unknown;
  },
  error: unknown,
  secrets?: readonly string[],
) {
  if (error instanceof PluginOperationRefused) {
    unit.refuse(error.reason);
  } else if (error instanceof PluginOperationCancelled) {
    unit.cancel(error.reason);
  } else if (error instanceof PluginWorkerFailure) {
    unit.fail(error, {
      ...(error.reason === "timeout" ? { outcome: "timeout" } : {}),
      reason: error.reason,
      ...(secrets ? { secrets } : {}),
    });
  } else if (error instanceof InvalidPluginResultError) {
    unit.fail(withoutContent(error), { reason: "invalid_result" });
  } else {
    unit.fail(withoutContent(error), secrets ? { secrets } : {});
  }
}

/**
 * A code host request's catalog fields: counts, a review's verdict and a
 * merge's method. Never a repository, a number, a path or a body.
 */
function codeHostRequestFields(
  request: CodeHostOperationRequest<CodeHostOperation>,
): FieldsOf<
  AjourCatalog,
  "pull_request.sync" | "pull_request.submit_review" | "pull_request.merge"
> {
  if ("tracked" in request) {
    return { pull_request: { tracked_count: request.tracked.length } };
  }
  if ("verdict" in request) {
    return {
      pull_request: {
        verdict: request.verdict,
        comment_count: request.comments.length,
      },
    };
  }
  if ("method" in request) {
    return { pull_request: { merge_method: request.method } };
  }
  return {};
}

/** A code host result's catalog fields: how many pull requests, files or threads. */
function codeHostResultFields(
  result: CodeHostOperationResult<CodeHostOperation>,
): FieldsOf<
  AjourCatalog,
  "pull_request.sync" | "pull_request.load" | "pull_request.load_conversation"
> {
  if ("pullRequests" in result && "viewer" in result) {
    return { pull_request: { received_count: result.pullRequests.length } };
  }
  if ("files" in result && "headSha" in result) {
    return { pull_request: { file_count: result.files.length } };
  }
  if ("threads" in result && "timeline" in result) {
    return { pull_request: { thread_count: result.threads.length } };
  }
  return {};
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

  // Undefined keeps the saved value.
  const onPremises =
    parsedValues[ON_PREMISES_FIELD_ID] === undefined
      ? undefined
      : parseBooleanValue(
          parsedValues[ON_PREMISES_FIELD_ID],
          ON_PREMISES_FIELD_ID,
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
    onPremises,
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

/**
 * A plugin's own saved connection as the broker sends with it: its config
 * with the secrets the vault holds, read for this one request, and the
 * values to scrub. Undefined when the plugin has no connection with this id.
 * The broker applies the manifest's on-premises and access rules to it.
 */
async function brokerConnection(
  storage: AppApiStorage,
  pluginId: string,
  connectionId: string,
  manifest: PluginApi4Manifest,
): Promise<BrokerConnection | undefined> {
  let connection: StoredConnection | null;
  try {
    connection = await storage.connectionForOperation(
      pluginId,
      connectionId,
      secretManifestOf(manifest),
    );
  } catch (error) {
    if (error instanceof ConnectionPausedError) {
      throw new BrokerRequestError(
        "refused",
        "secret_unavailable",
        error.message,
      );
    }
    throw error;
  }
  if (!connection) return undefined;
  return {
    id: connection.id,
    values: connection.config,
    secrets: connectionCredentials(
      redactionFields(manifest.connectionFields, connection.secrets),
      connection.config,
    ).secrets,
    // The broker counts it only while the manifest allows it.
    onPremises: connection.onPremises === true,
    access: connection.access ?? [],
  };
}

/**
 * Records a failed plugin call on the request's event, and returns the
 * connection's credentials for the message the user sees. A 401 means the
 * service refused the connection's saved secrets: they are marked rejected,
 * which pauses the connection until the user replaces them. Only a 401
 * counts, and only when the failure carries it. A plugin error is a
 * message, so an API 3 plugin is detected only when its error names the
 * status (`PluginRunOutcome`); the broker will report every 401 it sees.
 * A secret saved after the call read its secrets isn't marked, since the
 * service refused an older one.
 * If marking fails, the failure is counted on the event and the call still ends
 * with the plugin's error.
 */
async function failedCall(
  storage: AppApiStorage,
  unit: Parameters<typeof recordPluginFailure>[0],
  error: unknown,
  call: ReturnType<typeof admittedCall>,
  connection: ConnectionWithSecrets,
) {
  const credentials = call.credentials(connection.config);
  recordPluginFailure(unit, error, credentials.secrets);
  if (error instanceof PluginWorkerFailure && error.httpStatus === 401) {
    // The plugin's answer and the connection's error matter more than the mark.
    try {
      await storage.markSecretsRejected(connection.pluginId, connection.id, {
        readAt: connection.secretsReadAt,
      });
    } catch {
      unit.count("secrets_rejected_mark_failed");
    }
  }
  return credentials;
}

/** The secret fields a form gave a value, which replaces the saved one. */
function givenSecrets(
  fields: readonly SecretFieldDeclaration[],
  submitted: PluginFieldValues,
) {
  return fields
    .filter((field) => field.secret && !isEmptySecretValue(submitted[field.id]))
    .map((field) => field.id);
}

/** Every installed plugin's secret fields, runnable or not, such as an API 3 package. */
async function installedSecretManifests(pluginManager: PluginManager) {
  const { plugins, unavailable } = await pluginManager.inspectPlugins();
  return [...plugins, ...unavailable.map((plugin) => plugin.manifest)].map(
    secretManifestOf,
  );
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
  // A plugin back since its connections were sealed is split here, before
  // its form shows their settings.
  await storage.settleSecrets(
    [...plugins, ...unavailable.map((plugin) => plugin.manifest)].map(
      secretManifestOf,
    ),
  );
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
  const storage = new AppApiStorage(statePath, {
    events,
    vault: options.vault,
    // Called only once the plugin manager below exists.
    manifests: async () => installedSecretManifests(pluginManager),
    ...(options.brokerActivityWindowMs !== undefined
      ? { brokerActivityWindowMs: options.brokerActivityWindowMs }
      : {}),
  });
  const allowDevelopmentPlugins =
    options.allowDevelopmentPlugins ??
    process.env.AJOUR_ALLOW_DEVELOPMENT_PLUGINS === "1";
  const pluginRuntime = options.pluginRuntime ?? new WorkerPluginRuntime();
  const broker: CredentialBroker = new CredentialBroker({
    ...(options.brokerTransport ? { transport: options.brokerTransport } : {}),
    ...(options.brokerResolver ? { resolver: options.brokerResolver } : {}),
    events,
    connections: {
      connection: (pluginId, connectionId, manifest) =>
        brokerConnection(storage, pluginId, connectionId, manifest),
      // As the operation gate, again at each request, so a plugin or a
      // capability turned off stops the requests still waiting.
      operationRefusal: async (pluginId, method) => {
        const capability = capabilityOfMethod(method as PluginMethod);
        if (!capability) return undefined;
        const inactive = await inactiveCapability(
          storage,
          pluginId,
          capability,
          new Set([pluginId]),
          "it sends requests",
        );
        return inactive
          ? { reason: inactive.reason, message: inactive.message }
          : undefined;
      },
    },
    activity: {
      recordRequest: (pluginId, connectionId, at) =>
        storage.recordBrokerActivity(pluginId, connectionId, "request", at),
      recordBlocked: (pluginId, connectionId, at) =>
        storage.recordBrokerActivity(pluginId, connectionId, "blocked", at),
    },
  });
  const pluginManager = new PluginManager({
    broker,
    installedPluginDirectory:
      options.installedPluginDirectory ??
      defaultInstalledPluginDirectory(options.statePath),
    developmentPluginDirectories:
      options.developmentPluginDirectories ??
      (allowDevelopmentPlugins ? defaultDevelopmentPluginDirectories() : []),
    bundledPluginArchives: options.bundledPluginArchives,
    allowDevelopmentPlugins,
    requestTimeoutMs: options.pluginRequestTimeoutMs,
    runtime: pluginRuntime,
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
    runtime: pluginRuntime,
    events,
  });
  const allowedOrigins = new Set(
    options.allowedOrigins ?? configuredAllowedOrigins(),
  );
  if (options.windowToken === "") {
    throw new Error("The window token can't be empty.");
  }
  const windowToken = options.windowToken ?? createWindowToken();
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
      // A run gets the secrets the vault can give back; a secret still in
      // plain text, or one that can't be read, is left out.
      getAgentTaskValues: async (pluginId) => {
        const plugin = (await pluginManager.listPlugins()).find(
          (candidate) => candidate.id === pluginId,
        );
        return storage.getAgentTaskValues(
          pluginId,
          plugin && secretManifestOf(plugin),
        );
      },
      getAgentTaskSecretFields: (pluginId) =>
        storage.agentTaskSecretFields(pluginId),
      createMcpClient: (name, scope) =>
        createMcpClient(storage, name, scope ?? {}),
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
    adapters: options.agentCliAdapters ?? [
      claudeCodeAdapter,
      codexAdapter,
      opencodeAdapter,
    ],
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
    openSockets: new Set(),
    cutOffSockets: new WeakSet(),
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
      const payload = await readRequest(
        request,
        agentRunnerSettingsUpdateSchema,
      );
      await storage.updateAgentRunnerSettings(payload);
      writeJson(response, 200, await agentRunner.overview());
    },

    // A plugin's agent tasks share their settings, so they save together.
    agentTaskConfigure: async ({ request, response, params, unit }) => {
      const payload = await readRequest(request, agentTaskSettingsUpdateSchema);
      const { pluginId } = params;
      unit.set({ plugin: { id: pluginId } });
      const taskPlugin = (await pluginManager.listPlugins()).find(
        (plugin) => plugin.id === pluginId,
      );
      const tasks = taskPlugin?.capabilities.agentTask?.tasks;
      if (!taskPlugin || !tasks) {
        unit.refuse("no_agent_task");
        writeJson(response, 404, {
          error: "This plugin has no agent tasks.",
        });
        return;
      }
      const fields = agentTaskSettingFields(tasks);
      const parsed = parseAgentTaskValues(fields, payload.values);
      if ("error" in parsed) {
        unit.refuse("invalid_request");
        writeJson(response, 400, { error: parsed.error });
        return;
      }
      const manifest = secretManifestOf(taskPlugin);
      await storage.settleSecrets([manifest], pluginId);
      const saved = await storage.readAgentTaskSecrets(pluginId, manifest);
      const secretFields = effectiveSecretFields(fields, saved.holder.secrets);
      if (
        await refuseSecretsWithoutVault(
          unit,
          response,
          secretFields,
          parsed.values,
        )
      ) {
        return;
      }
      const values = readInput(() =>
        mergeSecretsForSave(
          secretFields,
          parsed.values,
          saved.values,
          payload.removeSecrets,
        ),
      );
      unit.set({
        agent_task: { field_count: Object.keys(values).length },
      });
      await storage.setAgentTaskValues(pluginId, values, {
        fields: secretFields,
        removeSecrets: payload.removeSecrets,
        replacedSecrets: givenSecrets(secretFields, parsed.values),
        secretExpiry: payload.secretExpiry,
      });
      writeJson(response, 200, await agentRunner.overview());
    },

    agentRunStart: async ({ request, response, unit }) => {
      const payload = await readRequest(request, agentRunStartRequestSchema);
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
        unit.refuse(
          error.status === 409
            ? "already_running"
            : error.status === 404
              ? "no_agent_task"
              : "blocked",
        );
        writeJson(response, error.status, { error: error.message });
      }
    },

    agentRunStatus: ({ response }) => {
      writeJson(response, 200, { run: agentRunner.currentRun() });
    },

    agentRunStop: ({ response, params, unit }) => {
      unit.set({ agent: { run_id: params.runId } });
      if (!agentRunner.stop(params.runId)) {
        unit.refuse("not_running");
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
      const payload = await readRequest(request, mcpSettingsUpdateSchema);
      unit.set({ mcp: { enabled: payload.enabled } });
      await storage.setMcpEnabled(payload.enabled);
      if (!payload.enabled) mcpBridge.close();
      writeJson(response, 200, await storage.getMcpSettings());
    },

    mcpClientCreate: async ({ request, response, unit }) => {
      const payload = await readRequest(request, mcpClientCreateRequestSchema);
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
        unit.refuse("unknown_client");
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
    mcpBridge: async ({ response, origin, unit, stream }) => {
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
      stream();
      mcpBridge.attach(response, {
        onCall: () => {
          calls += 1;
          unit.set({ mcp_bridge: { call_count: calls } });
        },
      });
    },

    mcpBridgeResult: async ({ request, response, unit }) => {
      const result = await readRequest(request, bridgeToolResultSchema);
      const resolved = mcpBridge.resolve(result);
      unit.set({ mcp_bridge: { resolved } });
      writeJson(response, 200, { ok: resolved });
    },

    // The user's answer to an agent's question, from the agent panel.
    agentQuestionAnswer: async ({ request, response, params, unit }) => {
      unit.set({ agent: { question_id: params.questionId } });
      const payload = await readRequest(request, agentAnswerRequestSchema);
      try {
        agentSessions.answer(params.questionId, payload.text);
      } catch (error) {
        unit.refuse("question_closed");
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
        unit.refuse("session_closed");
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
      const payload = await readRequest(
        request,
        pluginSystemActivationUpdateSchema,
      );
      unit.set({ activation: { enabled: payload.enabled } });
      await storage.setPluginSystemEnabled(payload.enabled);
      if (!payload.enabled) {
        const plugins = await pluginManager.listPlugins();
        const cancelled = await Promise.allSettled(
          plugins.map((plugin) =>
            pluginManager.cancelPluginOperations(
              plugin.id,
              new Error("The Ajour plugin system was deactivated."),
              "system_off",
            ),
          ),
        );
        const schemaCancelled =
          await projectDataShapePluginManager.cancelOperations(
            new Error("The Ajour plugin system was deactivated."),
            "system_off",
          );
        unit.set({
          activation: {
            operations_cancelled: cancelled.reduce(
              (count, result) =>
                count + (result.status === "fulfilled" ? result.value : 0),
              schemaCancelled,
            ),
          },
        });
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
      const pluginId = readInput(() =>
        projectDataShapePluginIdSchema.parse(params.pluginId),
      );
      unit.set({ plugin: { id: pluginId } });
      // A malformed body fails here, outside the try, as a 400.
      const exportRequest = await readRequest(
        request,
        projectDataShapeExportRequestSchema,
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
        recordPluginFailure(unit, error);
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
      const pluginId = readInput(() =>
        projectDataShapePluginIdSchema.parse(params.pluginId),
      );
      unit.set({ plugin: { id: pluginId } });
      // A malformed body fails here, outside the try, as a 400.
      const importRequest = await readRequest(
        request,
        projectDataShapeImportRequestSchema,
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
        recordPluginFailure(unit, error);
        writeJson(response, 400, {
          error: connectionlessPluginErrorMessage(error),
        });
      }
    },

    pluginActivate: async ({ request, response, params, unit }) => {
      const pluginId = readInput(() => pluginIdSchema.parse(params.pluginId));
      unit.set({ plugin: { id: pluginId } });
      const plugin = (await pluginManager.listPlugins()).find(
        (candidate) => candidate.id === pluginId,
      );
      if (!plugin) {
        unit.refuse("not_installed");
        writeJson(response, 404, { error: "Plugin not found." });
        return;
      }

      const payload = await readRequest(request, pluginActivationUpdateSchema);
      unit.set({
        activation: {
          enabled: payload.enabled,
          ...(payload.capability ? { capability: payload.capability } : {}),
        },
      });
      if (payload.capability) {
        if (!pluginHasCapability(plugin, payload.capability)) {
          unit.refuse("not_supported");
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
          const cancelled = await pluginManager.cancelCapabilityOperations(
            pluginId,
            payload.capability,
            new Error(
              `${switchableCapabilityLabels[payload.capability]} of plugin "${pluginId}" were turned off.`,
            ),
          );
          unit.set({ activation: { operations_cancelled: cancelled } });
        }
        writeJson(response, 200, await getOverview(storage, pluginManager));
        return;
      }
      await storage.setPluginEnabled(pluginId, payload.enabled);
      if (!payload.enabled) {
        const cancelled = await pluginManager.cancelPluginOperations(
          pluginId,
          new Error(`Plugin "${pluginId}" was deactivated.`),
          "plugin_off",
        );
        unit.set({ activation: { operations_cancelled: cancelled } });
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
      const payload = await readRequest(
        request,
        backlogSourceStatusUpsertRequestSchema,
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
      const pluginId = readInput(() => pluginIdSchema.parse(params.pluginId));
      unit.set({ plugin: { id: pluginId } });
      const payload = await readRequest(
        request,
        pluginConnectionSaveRequestSchema,
      );
      const parsedValues = readInput(() =>
        parseConnectionValues(payload.values),
      );
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
      const manifest = secretManifestOf(plugin);
      await storage.settleSecrets([manifest], pluginId);
      // The saved connection with the secrets the vault can give back, so a
      // secret the save leaves empty stays.
      const existing = payload.id
        ? await storage.readConnectionSecrets(pluginId, payload.id, manifest)
        : null;
      const existingConnection = existing?.connection ?? null;
      const secretFields = effectiveSecretFields(
        plugin.connectionFields,
        existingConnection?.secrets,
      );
      if (
        await refuseSecretsWithoutVault(
          unit,
          response,
          secretFields,
          parsedValues.config,
        )
      ) {
        return;
      }
      // A config saved before Ajour kept its own fields out may hold one.
      const configForSave = withoutReservedFields(
        readInput(() =>
          mergeSecretsForSave(
            secretFields,
            parsedValues.config,
            existingConnection?.config,
            payload.removeSecrets,
          ),
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
      // Only a plugin whose manifest allows it reaches private addresses.
      const allowsOnPremises =
        isPluginApi4Manifest(plugin) &&
        plugin.network?.baseAddress?.allowOnPremises === true;
      if (parsedValues.onPremises === true && !allowsOnPremises) {
        readInput(() => {
          throw new Error("This plugin can't reach on-premises servers.");
        });
      }
      const onPremises =
        allowsOnPremises &&
        (parsedValues.onPremises ?? existingConnection?.onPremises ?? false);
      const call = admittedCall(plugin, existingConnection?.secrets);
      let validation: PluginValidationResult;
      try {
        validation = await pluginManager.validateConnection(
          pluginId,
          configForSave,
          { capabilities },
          call.admit,
          {
            label: parsedValues.label,
            tenantLabel: parsedValues.tenantLabel,
            autoSync: parsedValues.autoSync,
            autoSyncIntervalMinutes: parsedValues.autoSyncIntervalMinutes,
            onPremises,
            access: existingConnection?.access ?? [],
          },
        );
      } catch (error) {
        const credentials = call.credentials(
          configForSave,
          existingConnection?.config,
        );
        recordPluginFailure(unit, error, credentials.secrets);
        writeJson(response, 400, { error: credentials.errorMessage(error) });
        return;
      }
      // An API 4 plugin never saw the secrets, so they come from the save,
      // and so do the address and the user its credential is sent to.
      const normalizedConfig = isPluginApi4Manifest(plugin)
        ? api4SavedConfig(
            secretFields,
            validation.normalizedConfig,
            configForSave,
            pluginNetworkFieldIds(plugin.network),
          )
        : validation.normalizedConfig;
      // The plugin may answer with a key it didn't declare, which goes to
      // the vault as a secret does.
      if (
        await refuseSecretsWithoutVault(
          unit,
          response,
          secretFields,
          parsedValues.config,
          normalizedConfig,
        )
      ) {
        return;
      }
      const storedConnection = await storage.upsertConnection(
        pluginId,
        {
          id: payload.id,
          label: parsedValues.label,
          tenantLabel: parsedValues.tenantLabel,
          autoSync: parsedValues.autoSync,
          autoSyncIntervalMinutes: parsedValues.autoSyncIntervalMinutes,
          pullRequestAutoSync: parsedValues.pullRequestAutoSync,
          agentAccess: parsedValues.agentAccess,
          allowLossyConversion: parsedValues.allowLossyConversion,
          onPremises,
          // The plugin's answer can't set a field Ajour owns. Its secrets
          // go to the vault, and the state file keeps the rest.
          config: withoutReservedFields(normalizedConfig),
          // Redacted before it is stored: the normalized config may no
          // longer hold a value the plugin swapped out, such as a password
          // it traded for a token, so the overview couldn't find it later.
          configSummary: call
            .credentials(
              configForSave,
              existingConnection?.config,
              normalizedConfig,
            )
            .redaction.summary(validation.connectionSummary),
        },
        {
          fields: secretFields,
          removeSecrets: payload.removeSecrets,
          replacedSecrets: givenSecrets(secretFields, parsedValues.config),
          secretExpiry: payload.secretExpiry,
        },
      );
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
      const pluginId = readInput(() => pluginIdSchema.parse(params.pluginId));
      const { connectionId } = params;
      unit.set({ plugin: { id: pluginId }, connection: { id: connectionId } });
      const deleted = await storage.deleteConnection(pluginId, connectionId);
      if (!deleted) {
        unit.refuse("connection_not_found");
        writeJson(response, 404, {
          error: "Plugin connection not found.",
        });
        return;
      }

      writeJson(response, 200, await getOverview(storage, pluginManager));
    },

    connectionSecretsRemove: async ({ request, response, params, unit }) => {
      const pluginId = readInput(() => pluginIdSchema.parse(params.pluginId));
      const { connectionId } = params;
      unit.set({ plugin: { id: pluginId }, connection: { id: connectionId } });
      const payload = await readRequest(
        request,
        connectionSecretsRemoveRequestSchema,
      );
      unit.set({ secret: { field_count: payload.fieldIds.length } });
      const existing = await storage.getConnection(pluginId, connectionId);
      if (!existing) {
        unit.refuse("connection_not_found");
        writeJson(response, 404, { error: "Plugin connection not found." });
        return;
      }
      const { plugin } = await findPlugin(pluginManager, pluginId);
      // The fields the plugin marks secret, and those the vault holds.
      const secretIds = new Set(
        effectiveSecretFields(plugin?.connectionFields ?? [], existing.secrets)
          .filter((field) => field.secret)
          .map((field) => field.id),
      );
      const notSecret = payload.fieldIds.find((id) => !secretIds.has(id));
      if (notSecret !== undefined) {
        unit.refuse("not_secret");
        writeJson(response, 400, {
          error: `Plugin field "${notSecret}" is not a secret, so it can't be removed.`,
        });
        return;
      }
      await storage.removeConnectionSecrets(
        pluginId,
        connectionId,
        payload.fieldIds,
      );
      const { overview, summary } = await findConnectionSummary(
        storage,
        pluginManager,
        pluginId,
        connectionId,
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

    pluginDataRemove: async ({ response, params, unit }) => {
      const pluginId = readInput(() => pluginIdSchema.parse(params.pluginId));
      unit.set({ plugin: { id: pluginId } });
      const { plugins, unavailable } = await pluginManager.inspectPlugins();
      if (
        plugins.some((plugin) => plugin.id === pluginId) ||
        unavailable.some((plugin) => plugin.manifest.id === pluginId)
      ) {
        unit.refuse("installed");
        writeJson(response, 409, {
          error:
            "This plugin is installed. Uninstall it to remove its connections and saved secrets.",
        });
        return;
      }
      // Refused before anything goes: a vault that can't drop the secrets
      // would leave them behind a connection that is already gone.
      await storage.assertSecretsChangeable();
      await storage.removePluginData(pluginId);
      writeJson(response, 200, await getOverview(storage, pluginManager));
    },

    vaultRetry: async ({ response, unit }) => {
      const status = await storage.reopenVault();
      unit.set({ vault: { state: status.state } });
      writeJson(response, 200, await getOverview(storage, pluginManager));
    },

    settleStateList: async (context) => {
      const target = await backlogTarget(
        context,
        "settling",
        (plugin) => Boolean(plugin.capabilities.connector?.settle),
        "This plugin does not support settling.",
      );
      if (!target) return;
      const { request, response, unit } = context;
      // A malformed body fails here, outside the try, as a 400.
      const statesRequest = await readRequest(
        request,
        backlogSettleStatesRequestSchema,
      );
      try {
        const result = backlogSettleStatesResultSchema.parse(
          await pluginManager.listSettleStates(
            target.pluginId,
            pluginConnection(target.connection),
            statesRequest,
            target.call.admit,
          ),
        );
        unit.set({ source_state: { count: result.states.length } });
        writeJson(response, 200, result);
      } catch (error) {
        await failPluginCall(
          response,
          unit,
          error,
          target.call,
          target.connection,
        );
      }
    },

    settleWrite: async (context) => {
      const target = await backlogTarget(
        context,
        "settling",
        (plugin) => Boolean(plugin.capabilities.connector?.settle),
        "This plugin does not support settling.",
      );
      if (!target) return;
      const { request, response, unit } = context;
      // A malformed body fails here, outside the try, as a 400.
      const writeRequest = await readRequest(
        request,
        backlogSettleWriteRequestSchema,
      );
      unit.set({
        source_write: {
          state_sent: writeRequest.state !== undefined,
          priority_sent: writeRequest.priority !== undefined,
        },
      });
      try {
        const result = await pluginManager.writeSettle(
          target.pluginId,
          pluginConnection(target.connection),
          writeRequest,
          target.call.admit,
        );
        writeJson(response, 200, backlogSettleWriteResultSchema.parse(result));
      } catch (error) {
        await failPluginCall(
          response,
          unit,
          error,
          target.call,
          target.connection,
        );
      }
    },

    descriptionRead: async (context) => {
      const target = await backlogTarget(
        context,
        "syncing descriptions",
        (plugin) => Boolean(plugin.capabilities.connector?.description),
        "This plugin does not sync descriptions.",
      );
      if (!target) return;
      const { request, response } = context;
      // A malformed body fails here, outside the try, as a 400.
      const readRequestBody = await readRequest(
        request,
        backlogReadDescriptionRequestSchema,
      );
      if (refuseAgentDescription(context, target.connection, false)) return;
      try {
        const result = await pluginManager.readDescription(
          target.pluginId,
          pluginConnection(target.connection),
          readRequestBody,
          target.call.admit,
        );
        writeJson(
          response,
          200,
          backlogReadDescriptionResultSchema.parse(result),
        );
      } catch (error) {
        await failPluginCall(
          response,
          context.unit,
          error,
          target.call,
          target.connection,
        );
      }
    },

    descriptionWrite: async (context) => {
      const target = await backlogTarget(
        context,
        "syncing descriptions",
        (plugin) => Boolean(plugin.capabilities.connector?.description?.write),
        "This plugin does not write descriptions.",
      );
      if (!target) return;
      const { request, response, unit } = context;
      // A malformed body fails here, outside the try, as a 400.
      const writeRequest = await readRequest(
        request,
        backlogWriteDescriptionRequestSchema,
      );
      // Its length, never its text.
      unit.set({
        description: {
          length: writeRequest.text.length,
          allowed_loss_count: writeRequest.allowedLoss?.length ?? 0,
        },
      });
      if (refuseAgentDescription(context, target.connection, true)) return;
      // Only a connection that allows lossy conversion writes with losses,
      // whatever a client asks.
      if (
        writeRequest.allowedLoss?.length &&
        target.connection.allowLossyConversion !== true
      ) {
        unit.refuse("lossy_not_allowed");
        writeJson(response, 409, {
          error: "This connection does not allow lossy conversion.",
        });
        return;
      }
      try {
        const result = await pluginManager.writeDescription(
          target.pluginId,
          pluginConnection(target.connection),
          writeRequest,
          target.call.admit,
        );
        writeJson(
          response,
          200,
          backlogWriteDescriptionResultSchema.parse(result),
        );
      } catch (error) {
        await failPluginCall(
          response,
          unit,
          error,
          target.call,
          target.connection,
        );
      }
    },

    backlogSync: async ({ request, response, params, unit }) => {
      const pluginId = readInput(() => pluginIdSchema.parse(params.pluginId));
      const { connectionId } = params;
      unit.set({ plugin: { id: pluginId }, connection: { id: connectionId } });
      const { plugin, pluginIds: availablePluginIds } = await findPlugin(
        pluginManager,
        pluginId,
      );
      if (!plugin?.capabilities.connector) {
        unit.refuse("not_supported");
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

      // Paused, with a 409, when a secret it needs can't reach the plugin.
      const connection = await storage.connectionForOperation(
        pluginId,
        connectionId,
        secretManifestOf(plugin),
      );
      if (!connection) {
        unit.refuse("connection_not_found");
        writeJson(response, 404, {
          error: "Plugin connection not found.",
        });
        return;
      }

      const payload = await readRequest(request, backlogSyncRequestSchema);
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

      const call = admittedCall(plugin, connection.secrets);
      try {
        const fetched = await pluginManager.syncConnection(
          pluginId,
          pluginConnection(connection),
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
              call.credentials(connection.config).redaction,
            ),
            doneItems,
            viewer: fetched.viewer,
            commentFacts: fetched.commentFacts,
          }),
        );
      } catch (error) {
        const credentials = await failedCall(
          storage,
          unit,
          error,
          call,
          connection,
        );
        const message = credentials.errorMessage(error);
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
      const pluginId = readInput(() => pluginIdSchema.parse(params.pluginId));
      const { connectionId } = params;
      unit.set({ plugin: { id: pluginId }, connection: { id: connectionId } });
      const operation = codeHostOperationSchema.safeParse(params.operation);
      if (!operation.success) {
        unit.refuse("unknown_operation");
        writeJson(response, 404, { error: "Unknown code host operation." });
        return;
      }
      const { plugin, pluginIds } = await findPlugin(pluginManager, pluginId);
      if (!plugin || !pluginHasCodeHost(plugin)) {
        unit.refuse("not_supported");
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
      // Paused, with a 409, when a secret it needs can't reach the plugin.
      const connection = await storage.connectionForOperation(
        pluginId,
        connectionId,
        secretManifestOf(plugin),
      );
      if (!connection) {
        unit.refuse("connection_not_found");
        writeJson(response, 404, { error: "Connection not found." });
        return;
      }

      // A malformed body fails here, outside the try, as a 400.
      const codeHostBody = await readJsonBody(request);
      const codeHostRequest = readInput(() =>
        codeHostOperations[operation.data].request.parse(codeHostBody),
      );
      unit.set(codeHostRequestFields(codeHostRequest));
      const call = admittedCall(plugin, connection.secrets);
      try {
        const result = await pluginManager.runCodeHostOperation(
          pluginId,
          operation.data,
          pluginConnection(connection),
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
        const credentials = await failedCall(
          storage,
          unit,
          error,
          call,
          connection,
        );
        const message = credentials.errorMessage(error);
        if (operation.data === "syncPullRequests") {
          await storage.recordConnectionError(pluginId, connectionId, message);
        }
        writeJson(response, 502, { error: message });
      }
    },

    backlogComment: async ({ request, response, url, params, unit }) => {
      const pluginId = readInput(() => pluginIdSchema.parse(params.pluginId));
      const { connectionId } = params;
      unit.set({ plugin: { id: pluginId }, connection: { id: connectionId } });
      const operation = backlogCommentOperationSchema.safeParse(
        params.operation,
      );
      if (!operation.success) {
        unit.refuse("unknown_operation");
        writeJson(response, 404, { error: "Unknown comment operation." });
        return;
      }
      const { plugin, pluginIds } = await findPlugin(pluginManager, pluginId);
      if (!plugin?.capabilities.connector?.comments) {
        unit.refuse("not_supported");
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
      // Paused, with a 409, when a secret it needs can't reach the plugin.
      const connection = await storage.connectionForOperation(
        pluginId,
        connectionId,
        secretManifestOf(plugin),
      );
      if (!connection) {
        unit.refuse("connection_not_found");
        writeJson(response, 404, { error: "Connection not found." });
        return;
      }

      // A malformed body fails here, outside the try, as a 400.
      const commentBody = await readJsonBody(request);
      const commentRequest = readInput(() =>
        backlogCommentOperations[operation.data].request.parse(commentBody),
      );
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
        unit.refuse("not_supported");
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
      const call = admittedCall(plugin, connection.secrets);
      const admit = async (manifest: PluginManifest) => {
        const admitted = call.admit(manifest);
        if (await agentAllowed()) return admitted;
        refusedAtAdmission = true;
        throw new PluginOperationRefused(agentRefusal, "agent_access");
      };
      try {
        const result = await pluginManager.runBacklogCommentOperation(
          pluginId,
          operation.data,
          pluginConnection(connection),
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
        const credentials = await failedCall(
          storage,
          unit,
          error,
          call,
          connection,
        );
        writeJson(response, 502, { error: credentials.errorMessage(error) });
      }
    },

    calendar: async ({ request, response, params, unit }) => {
      const pluginId = readInput(() => pluginIdSchema.parse(params.pluginId));
      const { connectionId } = params;
      unit.set({ plugin: { id: pluginId }, connection: { id: connectionId } });
      const operation = calendarOperationSchema.safeParse(params.operation);
      if (!operation.success) {
        unit.refuse("unknown_operation");
        writeJson(response, 404, { error: "Unknown calendar operation." });
        return;
      }
      const { plugin, pluginIds } = await findPlugin(pluginManager, pluginId);
      if (!plugin || !pluginHasCalendar(plugin)) {
        unit.refuse("not_supported");
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
      // Paused, with a 409, when a secret it needs can't reach the plugin.
      const connection = await storage.connectionForOperation(
        pluginId,
        connectionId,
        secretManifestOf(plugin),
      );
      if (!connection) {
        unit.refuse("connection_not_found");
        writeJson(response, 404, { error: "Connection not found." });
        return;
      }

      // A malformed body fails here, outside the try, as a 400.
      const calendarRequest = await readRequest(
        request,
        calendarOperations[operation.data].request,
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
      const call = admittedCall(plugin, connection.secrets);
      try {
        const result = await pluginManager.runCalendarOperation(
          pluginId,
          operation.data,
          pluginConnection(connection),
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
        const credentials = await failedCall(
          storage,
          unit,
          error,
          call,
          connection,
        );
        const message = credentials.errorMessage(error);
        await storage.recordConnectionError(pluginId, connectionId, message);
        writeJson(response, 502, { error: message });
      }
    },

    teamCreate: async ({ request, response, params, unit }) => {
      const pluginId = readInput(() => pluginIdSchema.parse(params.pluginId));
      unit.set({ plugin: { id: pluginId } });
      const plugin = await teamPlugin(pluginId, response, unit, true);
      if (!plugin) return;
      // A malformed body fails here, outside the try, as a 400.
      const payload = await readRequest(request, teamCreateRouteRequestSchema);
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
        const credentials = call.credentials(payload.values);
        recordPluginFailure(unit, error, credentials.secrets);
        writeJson(response, 502, { error: credentials.errorMessage(error) });
      }
    },

    teamSync: async ({ request, response, params, unit }) => {
      const pluginId = readInput(() => pluginIdSchema.parse(params.pluginId));
      const { connectionId } = params;
      unit.set({ plugin: { id: pluginId }, connection: { id: connectionId } });
      const plugin = await teamPlugin(pluginId, response, unit, false);
      if (!plugin) return;
      // Paused, with a 409, when a secret it needs can't reach the plugin.
      const connection = await storage.connectionForOperation(
        pluginId,
        connectionId,
        secretManifestOf(plugin),
      );
      if (!connection) {
        unit.refuse("connection_not_found");
        writeJson(response, 404, { error: "Connection not found." });
        return;
      }
      const syncRequest = await readRequest(request, teamSyncRequestSchema);
      unit.set({ team_sync: { projects_sent: syncRequest.changes.length } });
      const call = admittedCall(plugin, connection.secrets);
      try {
        const result = await pluginManager.syncTeamProjects(
          pluginId,
          pluginConnection(connection),
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
        const credentials = await failedCall(
          storage,
          unit,
          error,
          call,
          connection,
        );
        const message = credentials.errorMessage(error);
        await storage.recordConnectionError(pluginId, connectionId, message);
        writeJson(response, 502, { error: message });
      }
    },

    backlogImportStage: async ({ request, response, unit }) => {
      const payload = await readRequest(
        request,
        backlogImportPushRequestSchema,
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
      const payload = await readRequest(
        request,
        backlogImportSelectionUpdateSchema,
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
      const payload = await readRequest(
        request,
        backlogImportDismissRequestSchema,
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
      const payload = await readRequest(
        request,
        backlogImportRestoreRequestSchema,
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

  /**
   * The connection and plugin a settle or description route runs, or
   * undefined once it answered why not: the connection is missing, the plugin
   * or its backlog capability is off, or the plugin lacks the feature.
   */
  async function backlogTarget(
    {
      response,
      params,
      unit,
    }: RouteContext<
      "settleStateList" | "settleWrite" | "descriptionRead" | "descriptionWrite"
    >,
    action: string,
    supported: (plugin: PluginManifest) => boolean,
    unsupported: string,
  ) {
    const pluginId = readInput(() => pluginIdSchema.parse(params.pluginId));
    const { connectionId } = params;
    unit.set({ plugin: { id: pluginId }, connection: { id: connectionId } });
    const connection = await storage.getConnection(pluginId, connectionId);
    if (!connection) {
      unit.refuse("connection_not_found");
      writeJson(response, 404, {
        error: "Plugin connection not found.",
      });
      return undefined;
    }
    const { plugin, pluginIds } = await findPlugin(pluginManager, pluginId);
    const inactive = await inactiveCapability(
      storage,
      pluginId,
      "connector",
      pluginIds,
      action,
    );
    if (inactive) {
      unit.refuse(inactive.reason);
      writeJson(response, 409, { error: inactive.message });
      return undefined;
    }
    if (!plugin || !supported(plugin)) {
      unit.refuse("not_supported");
      writeJson(response, 409, { error: unsupported });
      return undefined;
    }
    // Paused, with a 409, when a secret it needs can't reach the plugin.
    const withSecrets = await storage.connectionForOperation(
      pluginId,
      connectionId,
      secretManifestOf(plugin),
    );
    if (!withSecrets) {
      unit.refuse("connection_not_found");
      writeJson(response, 404, { error: "Plugin connection not found." });
      return undefined;
    }
    return {
      pluginId,
      connection: withSecrets,
      plugin,
      call: admittedCall(plugin, withSecrets.secrets),
    };
  }

  /**
   * Refuses a save that gives a secret field a value the vault can't keep:
   * there is no plain-text fallback. True when it refused. A save that
   * leaves every secret empty goes on, so a plugin without secrets works.
   * `normalizedConfig`, the plugin's answer, counts too: a key the manifest
   * doesn't declare goes to the vault, so it needs one as a secret does.
   */
  async function refuseSecretsWithoutVault(
    unit: Unit<AjourCatalog, "connection.save" | "agent_task.configure">,
    response: ServerResponse,
    fields: readonly SecretFieldDeclaration[],
    values: PluginFieldValues,
    normalizedConfig?: PluginFieldValues,
  ) {
    const declared = new Set(fields.map((field) => field.id));
    const needsVault =
      fields.some(
        (field) => field.secret && !isEmptySecretValue(values[field.id]),
      ) ||
      Object.entries(withoutReservedFields(normalizedConfig ?? {})).some(
        ([id, value]) => !declared.has(id) && !isEmptySecretValue(value),
      );
    if (!needsVault) return false;
    const status = await storage.vaultStatus();
    if (status.state !== "unavailable") return false;
    unit.refuse("vault_unavailable");
    writeJson(response, 400, {
      error: new VaultUnavailableError(status.reason).message,
    });
    return true;
  }

  /**
   * Refuses an agent's description call the user doesn't allow on the
   * connection: it needs Read to read the description and Read and write to
   * change it, whatever the page asks. True when it refused.
   */
  function refuseAgentDescription(
    {
      response,
      url,
      unit,
    }: RouteContext<"descriptionRead" | "descriptionWrite">,
    connection: StoredConnection,
    writes: boolean,
  ) {
    if (
      url.searchParams.get("agent") !== "1" ||
      agentAccessAllows(
        connectionAgentAccess(connection),
        writes ? "readWrite" : "read",
      )
    ) {
      return false;
    }
    unit.refuse("agent_access");
    writeJson(response, 409, {
      error: `The user hasn't allowed agents to ${writes ? "change" : "read"} descriptions on the "${connection.label}" connection.`,
    });
    return true;
  }

  /**
   * Answers a failed plugin call on a connection with the plugin's error,
   * redacted, and records it on the request's event.
   */
  async function failPluginCall(
    response: ServerResponse,
    unit: Parameters<typeof recordPluginFailure>[0],
    error: unknown,
    call: ReturnType<typeof admittedCall>,
    connection: ConnectionWithSecrets,
  ) {
    const credentials = await failedCall(
      storage,
      unit,
      error,
      call,
      connection,
    );
    // The message reaches the user, and a description's is stored with the item.
    writeJson(response, 502, { error: credentials.errorMessage(error) });
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
      unit.refuse("not_supported");
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
  server.on("connection", (socket: Socket) => {
    runtime.openSockets.add(socket);
    socket.once("close", () => runtime.openSockets.delete(socket));
  });

  /**
   * Serves one request inside its event. The host check comes first, then
   * MCP, which has its own rules (bearer tokens, and no browser origins at
   * all), then the origin check, the window token and the route table.
   */
  async function serveRequest(
    request: IncomingMessage,
    response: ServerResponse,
  ) {
    const url = requestUrlOf(request);
    const isMcp = url.pathname === "/mcp" || url.pathname.startsWith("/mcp/");
    const fromAgent = isMcp || url.searchParams.get("agent") === "1";
    const requestOrigin = request.headers.origin;
    const origin = !requestOrigin
      ? "none"
      : isAllowedRequestOrigin(requestOrigin, allowedOrigins)
        ? "app"
        : "refused";
    await serveWithEvent(
      events,
      request,
      response,
      {
        trigger: fromAgent ? "agent" : "system",
        origin,
        cutOff: () => runtime.cutOffSockets.has(request.socket),
      },
      async (unit, exchange): Promise<Settlement | void> => {
        if (runtime.stopping) {
          unit.refuse("stopping");
          writeJson(response, 503, { error: "App API is shutting down." });
          return;
        }
        if (
          !request.headers.host ||
          !isAllowedRequestHost(request.headers.host)
        ) {
          unit.refuse("host_refused");
          writeJson(response, 403, { error: "Request host is not allowed." });
          return;
        }
        if (isMcp) {
          try {
            return await handleMcpRequest(request, response, url.pathname, {
              ...mcpContext,
              unit,
            });
          } catch (error) {
            if (exchange.isHangUp(error)) return;
            if (error instanceof InvalidRequestError) {
              unit.fail(withoutContent(error)).refuse("invalid_request");
              if (!response.headersSent) {
                writeInvalidRequest(request, response, error);
              }
              return;
            }
            // An outcome MCP recorded stands, as a thrown error never
            // downgrades it.
            if (unit.outcome === undefined) unit.fail(withoutContent(error));
            if (!response.headersSent) {
              writeJson(response, 500, { error: errorMessage(error) });
            }
          }
          return;
        }
        if (origin === "refused") {
          unit.refuse("origin_refused");
          writeJson(response, 403, { error: "Request origin is not allowed." });
          return;
        }
        if (requestOrigin) {
          response.setHeader("Access-Control-Allow-Origin", requestOrigin);
          response.setHeader("Vary", "Origin");
        }

        // A preflight carries no token and runs nothing.
        if (request.method === "OPTIONS") {
          writeJson(response, 204);
          return;
        }

        // Only Ajour's window holds the token. The health check stays open,
        // with no token and no Origin, so main can tell whether another
        // Ajour holds the port.
        if (
          url.pathname !== ROUTES.health.path &&
          !holdsWindowToken(request.headers[WINDOW_TOKEN_HEADER], windowToken)
        ) {
          unit.refuse("token_refused");
          writeJson(response, 401);
          return;
        }

        // The window's requests carry an Origin: the desktop window's are
        // cross-origin, and the dev proxy adds one to a same-origin GET. A
        // request without one, such as a no-cors redirect from another page
        // in the window's session, is not the window's own.
        if (url.pathname !== ROUTES.health.path && !requestOrigin) {
          unit.refuse("origin_refused");
          writeJson(response, 403, { error: "Request origin is not allowed." });
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
            params: readInput(() =>
              decodeParams(route.rawParams),
            ) as RouteParams<RouteId>,
            unit: routed as RouteContext<RouteId>["unit"],
            stream: exchange.stream,
          });
        } catch (error) {
          // The client hung up, and the error is its interrupted body or
          // connection: the seam ends the request `cancelled`.
          if (exchange.isHangUp(error)) return;
          // A connection whose secrets can't reach its plugin is paused,
          // and a secret the vault can't encrypt is refused: neither is a
          // failure of Ajour's, and neither message holds a secret.
          if (error instanceof ConnectionPausedError) {
            (routed as Unit<AjourCatalog, "backlog.sync">).refuse(
              "secret_unavailable",
            );
            writeJson(response, 409, { error: error.message });
            return;
          }
          if (error instanceof VaultUnavailableError) {
            (routed as Unit<AjourCatalog, "connection.save">).refuse(
              "vault_unavailable",
            );
            writeJson(response, 400, { error: error.message });
            return;
          }
          // Ajour's own errors only. Only a route knows the connection whose
          // secrets a plugin error may echo, so each catches its plugin call
          // and answers with its connection's credentials' `errorMessage`.
          routed.fail(withoutContent(error));
          if (error instanceof InvalidRequestError) {
            routed.refuse("invalid_request");
            writeInvalidRequest(request, response, error);
            return;
          }
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
    // What the broker gathered for Access review since its last write.
    storage.flushBrokerActivity().catch(() => undefined);
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

  // The state loads, and its secrets move into the vault, before the
  // package change: the load lists the plugins, which waits for that change.
  await runtime.storage.ready();
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

  // Refused before the package goes: a vault that can't drop the plugin's
  // secrets would leave its data behind a package that is already gone.
  await runtime.storage.assertSecretsChangeable();
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
    unit.fail(withoutContent(error), {
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
    // No plugin sends a request now: write what the broker gathered for
    // Access review since its last write, so a quit loses none.
    await runtime?.storage.flushBrokerActivity().catch(() => undefined);
    phaseStartedAt = Date.now();
    // The connections still open are cut off by the stop, not by their
    // clients: their requests end `cancelled` with `stopping`.
    for (const socket of runtime?.openSockets ?? []) {
      runtime?.cutOffSockets.add(socket);
    }
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
