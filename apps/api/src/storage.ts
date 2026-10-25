import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  normalizeSourceStatusKey,
  pluginHasCapability,
  switchableCapabilitySchema,
  syncsPullRequestsAutomatically,
  AGENT_ACCESS_FIELD_ID,
  AJOUR_CONNECTION_FIELD_IDS,
  ALLOW_LOSSY_FIELD_ID,
  agentAccessSchema,
  connectionAgentAccess,
  type AgentAccess,
  type BacklogSourceStatus,
  type BacklogSourceStatusInput,
  type PluginConnectionSummary,
  type PluginFieldValues,
  type BacklogImportCandidate,
  type BacklogImportCandidateInput,
  type PluginManifest,
  type PluginOverviewItem,
  type PluginsOverview,
  type PluginSummaryValues,
  type SecretEntrySummary,
  type SecretFieldSummary,
  type SwitchableCapability,
} from "../../../packages/shared/plugins.ts";
import type { McpSettings } from "../../../packages/shared/agent-tools.ts";
import { removeOrphanedTempFiles, writeFileAtomically } from "./atomic-file.ts";
import {
  agentTaskMcpToolNames,
  type AgentTaskMcpTool,
} from "../../../packages/shared/plugin-api-4.ts";
import { withoutContent } from "./event-errors.ts";
import type { ApiEvents } from "./events.ts";
import {
  agentRunnerSettingsSchema,
  type AgentRunnerSettings,
} from "../../../packages/shared/agent-runs.ts";
import { boundConnectionError, connectionRedaction } from "./plugin-errors.ts";
import {
  ConnectionPausedError,
  connectionCredentials,
  decideSecretPause,
  editableValues as editableFieldValues,
  holderNeedsMove,
  holderNeedsSettling,
  nonSecretValues,
  readHolderSecrets,
  redactionFields,
  secretManifestOf,
  secretPauseMessage,
  secretStatusPause,
  splitSave,
  type HolderSecrets,
  type SplitSave,
  type SecretFieldDeclaration,
  type SecretHolder,
  type SecretManifest,
} from "./connection-credentials.ts";
import {
  defaultAgentRunnerSettings,
  normalizeAgentRunnerState,
  normalizeSecretFields,
  safeValues,
  UNSAFE_KEYS,
  type StoredAgentRunnerState,
  type StoredSecretFields,
} from "./agent-runner-state.ts";
import {
  NO_VAULT_REASON,
  NO_VAULT_STATUS,
  secretKeyId,
  VaultUnavailableError,
  type SecretEntryInfo,
  type SecretKey,
  type SecretVault,
  type VaultStatus,
} from "./secret-vault.ts";
import {
  runStateMigrations,
  STATE_VERSION,
  storedStateVersion,
  type StateMigrationContext,
  type StoredStateRecord,
} from "./state-migrations.ts";
import {
  emptyVaultMigrationReport,
  holderId,
  settleHolders,
  type VaultMigrationReport,
} from "./vault-migration.ts";

interface StoredConnection {
  id: string;
  pluginId: string;
  label: string;
  tenantLabel: string;
  autoSync: boolean;
  autoSyncIntervalMinutes: number;
  /** Absent until saved; see `syncsPullRequestsAutomatically`. */
  pullRequestAutoSync?: boolean;
  /** Absent means None; see `connectionAgentAccess`. */
  agentAccess?: AgentAccess;
  /** Absent means off; see `connectionAllowsLossyConversion`. */
  allowLossyConversion?: boolean;
  /** The plugin's settings, without the secrets the vault holds. */
  config: PluginFieldValues;
  /**
   * The fields whose values the vault holds. Absent until the config was
   * checked against its plugin's manifest, as for connections saved before
   * the vault; see `connection-credentials.ts`.
   */
  secrets?: StoredSecretFields;
  configSummary: PluginSummaryValues;
  connectedAt: number;
  lastSyncAt?: number;
  lastError?: string;
  /** When the sync that set `lastError` failed. */
  lastErrorAt?: number;
}

/**
 * A connection whose `config` holds its secrets, read from the vault for one
 * use. `secretsReadAt` is when that read started: a secret saved after it
 * isn't the one the call used (`markSecretsRejected`).
 */
export type ConnectionWithSecrets = StoredConnection & {
  secretsReadAt: number;
};

/** A connection field declaration list, for a save that splits secrets out. */
export interface SecretSaveFields {
  /** The plugin's fields, as its manifest declares them. */
  fields: readonly SecretFieldDeclaration[];
  /** The secret fields the save removes. */
  removeSecrets?: readonly string[];
  /** The secret fields the form gave a value, even one equal to the saved. */
  replacedSecrets?: readonly string[];
  /** The reminder dates the form shows, by field ID. `null` clears one. */
  secretExpiry?: Readonly<Record<string, number | null>>;
}

function needsSettling(
  holder: SecretHolder,
  manifests: ReadonlyMap<string, SecretManifest>,
) {
  return holderNeedsSettling(holder, manifests.get(holder.pluginId));
}

function connectionHolder(connection: StoredConnection): SecretHolder {
  return {
    pluginId: connection.pluginId,
    connectionId: connection.id,
    values: connection.config,
    secrets: connection.secrets,
  };
}

/**
 * An agent client. Ajour keeps only the SHA-256 hash of its token. A revoked
 * client stays in the file so a rejected request can name it.
 */
export interface StoredMcpClient {
  id: string;
  name: string;
  tokenHash: string;
  createdAt: number;
  lastUsedAt?: number;
  revokedAt?: number;
  /**
   * The data tools the client may list and call, besides the session tools:
   * an agent task run's client gets those its task declares (#396). Without
   * it, the client has every tool, as a client the user creates does.
   */
  tools?: AgentTaskMcpTool[];
}

interface StoredMcpState {
  enabled: boolean;
  clients: StoredMcpClient[];
}

/** Skips writing `lastUsedAt` more than once a minute per client. */
const MCP_LAST_USED_RESOLUTION_MS = 60_000;

function normalizeMcpState(raw: unknown): StoredMcpState {
  const value = (raw ?? {}) as Partial<StoredMcpState>;
  return {
    enabled: value.enabled === true,
    clients: (Array.isArray(value.clients) ? value.clients : [])
      .filter(
        (client): client is StoredMcpClient =>
          typeof client?.id === "string" &&
          typeof client.name === "string" &&
          typeof client.tokenHash === "string" &&
          typeof client.createdAt === "number",
      )
      .map(normalizeMcpClientTools),
  };
}

/**
 * A client limited to some tools stays limited: a list that isn't one of
 * names leaves it none, never every tool, and a name Ajour has no tool for
 * is dropped.
 */
function normalizeMcpClientTools(client: StoredMcpClient): StoredMcpClient {
  if (!Object.hasOwn(client, "tools")) return client;
  const { tools } = client as { tools: unknown };
  return {
    ...client,
    tools:
      Array.isArray(tools) &&
      tools.every((tool: unknown) => typeof tool === "string")
        ? tools.filter((tool): tool is AgentTaskMcpTool =>
            agentTaskMcpToolNames.includes(tool),
          )
        : [],
  };
}

interface AppApiStateV8 {
  version: number;
  connections: StoredConnection[];
  stagedImports: BacklogImportCandidate[];
  dismissedImportKeys: string[];
  connectorBacklogStatuses: BacklogSourceStatus[];
  disabledPluginIds: string[];
  /** Per plugin, the switchable capabilities the user turned off. */
  disabledCapabilities: Record<string, SwitchableCapability[]>;
  pluginsEnabled: boolean;
  mcp: StoredMcpState;
  agentRunner: StoredAgentRunnerState;
}

type AppApiState = AppApiStateV8;

interface MutationResult<T> {
  nextState: AppApiState;
  result: T;
  afterWrite?: () => Promise<void>;
}

/**
 * What one dismissal removed from review: the staged items as they were, and
 * the dismissed keys it added. Keys dismissed before it stay dismissed on Undo.
 */
interface ImportDismissal {
  token: string;
  items: BacklogImportCandidate[];
  addedKeys: string[];
}

interface StageImportItemsResult {
  queuedCount: number;
  updatedCount: number;
  skippedCount: number;
}

const MISSING_PLUGIN_ICON_SVG =
  "<svg viewBox='0 0 16 16' xmlns='http://www.w3.org/2000/svg'><rect width='16' height='16' rx='3' fill='currentColor' opacity='0.18'/><path d='M5 5h6v6H5z' fill='currentColor'/></svg>";

function importKey(
  item: Pick<
    BacklogImportCandidateInput,
    "source" | "connectionId" | "sourceId"
  >,
) {
  return `${item.source}:${item.connectionId}:${item.sourceId}`;
}

function normalizeDisabledCapabilities(
  raw: unknown,
): Record<string, SwitchableCapability[]> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return Object.fromEntries(
    Object.entries(raw).flatMap(([pluginId, capabilities]) => {
      const valid = Array.isArray(capabilities)
        ? Array.from(
            new Set(
              capabilities.filter(
                (capability): capability is SwitchableCapability =>
                  switchableCapabilitySchema.safeParse(capability).success,
              ),
            ),
          ).sort()
        : [];
      return pluginId.trim() && valid.length ? [[pluginId.trim(), valid]] : [];
    }),
  );
}

function createDefaultState(): AppApiState {
  return {
    version: STATE_VERSION,
    connections: [],
    stagedImports: [],
    dismissedImportKeys: [],
    connectorBacklogStatuses: [],
    disabledPluginIds: [],
    disabledCapabilities: {},
    pluginsEnabled: true,
    mcp: { enabled: false, clients: [] },
    agentRunner: {
      settings: defaultAgentRunnerSettings(),
      pluginValues: {},
      pluginSecrets: {},
    },
  };
}

function compareConnections(left: StoredConnection, right: StoredConnection) {
  return (
    left.pluginId.localeCompare(right.pluginId) ||
    left.tenantLabel.localeCompare(right.tenantLabel) ||
    left.label.localeCompare(right.label)
  );
}

function compareImports(
  left: BacklogImportCandidate,
  right: BacklogImportCandidate,
) {
  if (left.connectionId !== right.connectionId) {
    return left.connectionId.localeCompare(right.connectionId);
  }

  if (left.depth !== right.depth) {
    return left.depth - right.depth;
  }

  if (left.parentSourceId !== right.parentSourceId) {
    return (left.parentSourceId ?? "").localeCompare(
      right.parentSourceId ?? "",
    );
  }

  return (
    right.pushedAt - left.pushedAt || left.title.localeCompare(right.title)
  );
}

function compareBacklogStatuses(
  left: BacklogSourceStatus,
  right: BacklogSourceStatus,
) {
  if (left.tenantLabel !== right.tenantLabel) {
    return left.tenantLabel.localeCompare(right.tenantLabel);
  }

  if (left.connectionLabel !== right.connectionLabel) {
    return left.connectionLabel.localeCompare(right.connectionLabel);
  }

  return left.label.localeCompare(right.label);
}

function comparePluginManifests(left: PluginManifest, right: PluginManifest) {
  return (
    left.displayName.localeCompare(right.displayName) ||
    left.id.localeCompare(right.id)
  );
}

/** What the overview shows instead of a last error whose plugin is gone. */
const UNINSTALLED_PLUGIN_LAST_ERROR =
  "Hidden because this plugin is no longer installed.";

function createMissingPluginManifest(pluginId: string): PluginOverviewItem {
  return {
    id: pluginId,
    version: "0.0.0",
    apiVersion: 1,
    displayName: pluginId,
    description: "Plugin unavailable.",
    unavailableReason:
      "This plugin is not installed. Download it again to use its saved connections.",
    iconSvg: MISSING_PLUGIN_ICON_SVG,
    capabilities: { connector: {} },
    connectionFields: [
      {
        id: "label",
        label: "Connection label",
        type: "text",
        required: true,
        secret: false,
      },
      {
        id: "tenantLabel",
        label: "Workspace",
        type: "text",
        required: true,
        secret: false,
      },
    ],
  };
}

function toEditableValues(
  connection: StoredConnection,
  plugin: PluginManifest,
): PluginFieldValues {
  const editableValues: PluginFieldValues = {
    label: connection.label,
    tenantLabel: connection.tenantLabel,
    autoSync: connection.autoSync,
    autoSyncIntervalMinutes: connection.autoSyncIntervalMinutes,
    pullRequestAutoSync: syncsPullRequestsAutomatically(connection),
    ...editableFieldValues(plugin.connectionFields, connection.config),
  };
  // Ajour's own setting, set last so no plugin field or config can stand in.
  if (
    plugin.capabilities.connector?.comments ||
    plugin.capabilities.connector?.description?.write
  ) {
    editableValues[AGENT_ACCESS_FIELD_ID] = connectionAgentAccess(connection);
  } else {
    delete editableValues[AGENT_ACCESS_FIELD_ID];
  }
  if (plugin.capabilities.connector?.description?.write) {
    editableValues[ALLOW_LOSSY_FIELD_ID] =
      connection.allowLossyConversion === true;
  } else {
    delete editableValues[ALLOW_LOSSY_FIELD_ID];
  }

  return editableValues;
}

/** What the vault says about a connection's secrets, without reading one. */
interface VaultView {
  status: VaultStatus;
  /** The entries the vault holds, by `secretKeyId`. */
  entries: ReadonlyMap<string, SecretEntryInfo>;
}

/** What the overview says about one entry: never a value, only its state and dates. */
function entrySummary(
  key: SecretKey,
  vault: VaultView,
): Pick<SecretFieldSummary, "setAt" | "lastUsedAt" | "expiresAt"> & {
  readable: boolean;
} {
  const info = vault.entries.get(secretKeyId(key));
  return {
    readable: info?.unreadable === false && vault.status.state === "available",
    ...(info ? { setAt: info.setAt } : {}),
    ...(info?.lastUsedAt !== undefined ? { lastUsedAt: info.lastUsedAt } : {}),
    ...(info?.expiresAt !== undefined ? { expiresAt: info.expiresAt } : {}),
  };
}

/** The saved secret fields of a holder and their states. */
function secretFieldSummaries(
  owner: Pick<SecretHolder, "pluginId" | "connectionId">,
  secrets: StoredSecretFields | undefined,
  vault: VaultView,
): SecretFieldSummary[] {
  const rejected = new Set(secrets?.rejected);
  return (secrets?.fields ?? []).map((id) => {
    const { readable, ...dates } = entrySummary(
      { ...owner, fieldId: id },
      vault,
    );
    return {
      id,
      // A secret that can't be read can't be said to be refused.
      state: !readable
        ? ("unreadable" as const)
        : rejected.has(id)
          ? ("rejected" as const)
          : ("saved" as const),
      ...dates,
    };
  });
}

/** A holder's settings kept whole in the vault, while their plugin is missing. */
function sealedSummary(
  owner: Pick<SecretHolder, "pluginId" | "connectionId">,
  secrets: StoredSecretFields | undefined,
  vault: VaultView,
): SecretEntrySummary | undefined {
  if (secrets?.sealed !== true) return undefined;
  const { readable, ...dates } = entrySummary(
    { ...owner, fieldId: null },
    vault,
  );
  return { state: readable ? "saved" : "unreadable", ...dates };
}

/**
 * The connection's secret fields and their states, and why its operations
 * pause, if they do. Known without decrypting: an entry is unreadable once
 * a read failed, or the whole vault is.
 */
function connectionSecretState(
  connection: StoredConnection,
  plugin: PluginManifest,
  installed: boolean,
  vault: VaultView,
): Pick<PluginConnectionSummary, "secretFields" | "sealedConfig" | "paused"> {
  const fields = connection.secrets?.fields ?? [];
  const owner = { pluginId: connection.pluginId, connectionId: connection.id };
  const secretFields = secretFieldSummaries(owner, connection.secrets, vault);
  const sealedConfig = sealedSummary(owner, connection.secrets, vault);
  const sealed = sealedConfig !== undefined;
  const notMoved =
    installed &&
    holderNeedsMove(connectionHolder(connection), secretManifestOf(plugin));
  const { pause, reason } = decideSecretPause({
    needsVault: fields.length > 0 || sealed || notMoved,
    status: vault.status,
    unreadable:
      secretFields.some((field) => field.state === "unreadable") ||
      sealedConfig?.state === "unreadable",
    notMoved,
    ...(installed
      ? secretStatusPause(connection.secrets, secretManifestOf(plugin))
      : {}),
  });
  return {
    ...(secretFields.length > 0 ? { secretFields } : {}),
    ...(sealedConfig ? { sealedConfig } : {}),
    ...(pause
      ? {
          paused: {
            reason: pause,
            message: secretPauseMessage(pause, reason),
          },
        }
      : {}),
  };
}

/** `installed` is false when the plugin is gone and `plugin` only stands in for it. */
function buildConnectionSummary(
  state: AppApiState,
  connection: StoredConnection,
  plugin: PluginManifest,
  installed: boolean,
  vault: VaultView,
): PluginConnectionSummary {
  const connectionItems = state.stagedImports.filter(
    (item) => item.connectionId === connection.id,
  );
  // The plugin wrote the last error and the summary, and either may hold a
  // secret: an error stored before every route redacted plugin errors, or a
  // summary stored before saves redacted it. A stand-in says nothing about
  // which stored values are secret, so then none of their text is shown.
  const redaction = installed
    ? connectionCredentials(
        redactionFields(plugin.connectionFields, connection.secrets),
        connection.config,
      ).redaction
    : connectionRedaction([]);

  return {
    id: connection.id,
    pluginId: connection.pluginId,
    label: connection.label,
    tenantLabel: connection.tenantLabel,
    autoSync: connection.autoSync,
    autoSyncIntervalMinutes: connection.autoSyncIntervalMinutes,
    ...(connection.pullRequestAutoSync !== undefined
      ? { pullRequestAutoSync: connection.pullRequestAutoSync }
      : {}),
    ...(connection.agentAccess ? { agentAccess: connection.agentAccess } : {}),
    ...(connection.allowLossyConversion ? { allowLossyConversion: true } : {}),
    connectedAt: connection.connectedAt,
    lastSyncAt: connection.lastSyncAt,
    lastError:
      connection.lastError &&
      (installed
        ? redaction.text(connection.lastError)
        : UNINSTALLED_PLUGIN_LAST_ERROR),
    lastErrorAt: connection.lastErrorAt,
    pendingImportCount: connectionItems.length,
    selectedImportCount: connectionItems.filter((item) => item.selected).length,
    configSummary: installed ? redaction.summary(connection.configSummary) : {},
    editableValues: toEditableValues(connection, plugin),
    ...connectionSecretState(connection, plugin, installed, vault),
  };
}

/**
 * The current version's state from a migrated file: malformed records
 * dropped, and the fields added without a new version filled with their
 * defaults. Earlier versions reach this shape through `state-migrations.ts`.
 */
function normalizeState(migrated: StoredStateRecord): AppApiState {
  const raw = migrated as Partial<AppApiState>;
  const defaults = createDefaultState();

  return {
    // A step that held keeps the file below the current version.
    version:
      typeof raw.version === "number"
        ? Math.min(raw.version, STATE_VERSION)
        : STATE_VERSION,
    connections: (Array.isArray(raw.connections) ? raw.connections : [])
      .filter((connection): connection is StoredConnection =>
        Boolean(
          connection?.id &&
          connection.pluginId &&
          connection.label &&
          connection.tenantLabel &&
          connection.config &&
          typeof connection.autoSync === "boolean" &&
          connection.autoSyncIntervalMinutes &&
          connection.connectedAt,
        ),
      )
      .map(
        ({
          pullRequestAutoSync,
          agentAccess,
          allowLossyConversion,
          secrets,
          ...connection
        }) => ({
          ...connection,
          ...(normalizeSecretFields(secrets)
            ? { secrets: normalizeSecretFields(secrets) }
            : {}),
          // Ajour's own settings never live in the plugin's config.
          config: Object.fromEntries(
            Object.entries(connection.config).filter(
              ([key]) => !AJOUR_CONNECTION_FIELD_IDS.has(key),
            ),
          ),
          ...(allowLossyConversion === true ? { allowLossyConversion } : {}),
          ...(typeof pullRequestAutoSync === "boolean"
            ? { pullRequestAutoSync }
            : {}),
          // Anything else than a known level is None.
          ...(agentAccessSchema.safeParse(agentAccess).success
            ? { agentAccess }
            : {}),
        }),
      )
      .sort(compareConnections),
    stagedImports: (raw.stagedImports ?? defaults.stagedImports)
      .filter((item): item is BacklogImportCandidate =>
        Boolean(
          item?.id &&
          item.source &&
          item.connectionId &&
          item.sourceId &&
          item.title,
        ),
      )
      .map((item) => ({
        ...item,
        selected: item.selectable ? item.selected : false,
      }))
      .sort(compareImports),
    dismissedImportKeys: Array.from(
      new Set(
        (raw.dismissedImportKeys as string[] | undefined) ??
          defaults.dismissedImportKeys,
      ),
    ),
    connectorBacklogStatuses: (
      raw.connectorBacklogStatuses ?? defaults.connectorBacklogStatuses
    )
      .filter((status): status is BacklogSourceStatus =>
        Boolean(
          status?.source &&
          status.connectionId &&
          status.connectionLabel &&
          status.tenantLabel &&
          status.key &&
          status.label &&
          status.lastSeenAt,
        ),
      )
      .sort(compareBacklogStatuses),
    disabledPluginIds: Array.from(
      new Set(
        (Array.isArray(raw.disabledPluginIds)
          ? raw.disabledPluginIds!
          : defaults.disabledPluginIds
        )
          .filter(
            (pluginId): pluginId is string =>
              typeof pluginId === "string" && pluginId.trim().length > 0,
          )
          .map((pluginId) => pluginId.trim()),
      ),
    ).sort(),
    disabledCapabilities: normalizeDisabledCapabilities(
      raw.disabledCapabilities,
    ),
    pluginsEnabled:
      typeof raw.pluginsEnabled === "boolean"
        ? raw.pluginsEnabled!
        : defaults.pluginsEnabled,
    mcp: normalizeMcpState(raw.mcp),
    agentRunner: normalizeAgentRunnerState(raw.agentRunner),
  };
}

/** The state file's path: the one given, else AJOUR_APP_API_STATE_PATH, else ~/.ajour. */
export function resolveStatePath(
  statePath = process.env.AJOUR_APP_API_STATE_PATH,
): string {
  return statePath && statePath.trim().length > 0
    ? statePath
    : path.join(os.homedir(), ".ajour", "app-api-state.json");
}

/**
 * The error for a state file Ajour can't read: any failure while it is
 * parsed, migrated or normalized. Their messages quote the file, secrets
 * included, so this fixed one stands in, for the event and the caller.
 */
function unreadableStateError() {
  const error = new Error("The state file can't be read.");
  error.name = "StateFileError";
  return Object.assign(error, { code: "unreadable" });
}

/**
 * The state a file holds, migrated, and the version it was written in. A
 * file that holds null loads the defaults, like a missing one. Undefined for
 * a file that isn't state: not JSON, a root that isn't an object, or any
 * value migration can't read, however deep.
 */
async function readStateFile(
  text: string,
  context: () => Promise<StateMigrationContext>,
): Promise<{ state: AppApiState; versionFrom: number } | undefined> {
  let raw: StoredStateRecord;
  try {
    const parsed: unknown = JSON.parse(text);
    if (
      parsed !== null &&
      (typeof parsed !== "object" || Array.isArray(parsed))
    ) {
      return undefined;
    }
    if (parsed === null) {
      return { state: createDefaultState(), versionFrom: 1 };
    }
    raw = parsed as StoredStateRecord;
  } catch {
    return undefined;
  }
  const versionFrom = storedStateVersion(raw);
  // The context lists the plugins, so only a file a step will change pays for it.
  const migrationContext = versionFrom < STATE_VERSION ? await context() : {};
  try {
    return {
      state: normalizeState(
        await runStateMigrations(raw, versionFrom, undefined, migrationContext),
      ),
      versionFrom,
    };
  } catch {
    return undefined;
  }
}

export class AppApiStorage {
  private readonly statePath: string;
  private readonly events?: ApiEvents;
  private cache?: AppApiState;
  private mutationQueue: Promise<unknown> = Promise.resolve();
  private loading?: Promise<AppApiState>;
  /**
   * The last Sync review dismissal, for Undo. Only the last one can be undone,
   * and it lives in memory, so it does not survive a restart.
   */
  private lastDismissal?: ImportDismissal;
  private readonly vault?: SecretVault;
  private readonly listManifests?: () => Promise<readonly SecretManifest[]>;
  /** Holders whose move into the vault failed this launch; tried again at the next. */
  private readonly failedMoves = new Set<string>();

  /**
   * `events` receives a `storage.load` event for each load of the state file.
   * `vault` holds the secrets; without it, as in the standalone API, the
   * storage holds none. `manifests` lists every installed plugin's manifest,
   * runnable or not, for the move of secrets into the vault.
   */
  constructor(
    statePath?: string,
    options: {
      events?: ApiEvents;
      vault?: SecretVault;
      manifests?: () => Promise<readonly SecretManifest[]>;
    } = {},
  ) {
    this.statePath = resolveStatePath(statePath);
    this.events = options.events;
    this.vault = options.vault;
    this.listManifests = options.manifests;
  }

  /** The folder that holds the state file. Agent browser data lives next to it. */
  get dataDirectory(): string {
    return path.dirname(this.statePath);
  }

  /** Loads the state file now, with its migrations, if it isn't loaded yet. */
  async ready(): Promise<void> {
    await this.readState();
  }

  /** Whether the vault can keep and give back secrets now. */
  async vaultStatus(): Promise<VaultStatus> {
    return this.vault ? (await this.vault.open()).status : NO_VAULT_STATUS;
  }

  /** What the vault says about every secret it holds, without reading one. */
  async vaultView(): Promise<VaultView> {
    const status = await this.vaultStatus();
    return {
      status,
      entries: new Map(
        (this.vault ? await this.vault.list() : []).map((entry) => [
          secretKeyId(entry),
          entry,
        ]),
      ),
    };
  }

  /**
   * Opens the vault again, for "Try again" after a failure that may have
   * passed. Secrets that failed to move into it at this launch are tried
   * again at the next operation.
   */
  async reopenVault(): Promise<VaultStatus> {
    if (!this.vault) return NO_VAULT_STATUS;
    const { status } = await this.vault.reopen();
    this.failedMoves.clear();
    return status;
  }

  /** A plugin's agent task settings that the vault holds, with their states. */
  async agentTaskSecretFields(pluginId: string): Promise<SecretFieldSummary[]> {
    if (UNSAFE_KEYS.has(pluginId)) return [];
    const state = await this.readState();
    return secretFieldSummaries(
      { pluginId, connectionId: null },
      state.agentRunner.pluginSecrets[pluginId],
      await this.vaultView(),
    );
  }

  /**
   * Marks a connection's saved secrets as refused by the service (a 401),
   * which pauses the connection until the user adds a new one. Without
   * `fieldIds`, every saved secret of the connection is marked: an API 3
   * plugin can't say which of them the service refused. Returns false when
   * the connection holds no saved secret.
   *
   * `readAt` is when the failed call read its secrets. A secret saved after
   * that is a newer one than the service refused, so it isn't marked: a 401
   * that arrives late must not fault the token the user just replaced.
   */
  async markSecretsRejected(
    pluginId: string,
    connectionId: string,
    options: { fieldIds?: readonly string[]; readAt?: number } = {},
  ): Promise<boolean> {
    const { fieldIds, readAt } = options;
    return this.mutate(async (state) => {
      const connection = state.connections.find(
        (candidate) =>
          candidate.pluginId === pluginId && candidate.id === connectionId,
      );
      const saved = connection?.secrets?.fields ?? [];
      const vault = readAt === undefined ? undefined : await this.vaultView();
      const targets = (fieldIds ?? saved).filter(
        (id) =>
          saved.includes(id) &&
          (readAt === undefined ||
            (vault?.entries.get(
              secretKeyId({ pluginId, connectionId, fieldId: id }),
            )?.setAt ?? 0) <= readAt),
      );
      if (!connection?.secrets || targets.length === 0) {
        return { nextState: state, result: false };
      }
      const rejected = [
        ...new Set([...(connection.secrets.rejected ?? []), ...targets]),
      ].sort();
      return {
        nextState: this.replaceConnection(state, {
          ...connection,
          secrets: { ...connection.secrets, rejected },
        }),
        result: true,
      };
    });
  }

  /**
   * Deletes saved secrets of a connection and says they were removed, so a
   * required one pauses the connection until a new one is saved. The
   * connection's other settings and its data stay. Null when the connection
   * doesn't exist. Throws `VaultUnavailableError` when the vault can't be
   * changed this launch; nothing changes then.
   */
  async removeConnectionSecrets(
    pluginId: string,
    connectionId: string,
    fieldIds: readonly string[],
  ): Promise<StoredConnection | null> {
    return this.mutate(async (state) => {
      const connection = state.connections.find(
        (candidate) =>
          candidate.pluginId === pluginId && candidate.id === connectionId,
      );
      if (!connection) return { nextState: state, result: null };
      const secrets = connection.secrets ?? { fields: [] };
      const targets = fieldIds.filter((id) => secrets.fields.includes(id));
      if (targets.length > 0) {
        await this.vault?.remove({ pluginId, connectionId, fieldIds: targets });
      }
      const removed = [...new Set([...(secrets.removed ?? []), ...fieldIds])];
      const rejected = (secrets.rejected ?? []).filter(
        (id) => !fieldIds.includes(id),
      );
      const { rejected: _previouslyRejected, ...kept } = secrets;
      const next: StoredConnection = {
        ...connection,
        secrets: {
          ...kept,
          fields: secrets.fields.filter((id) => !targets.includes(id)),
          removed: removed.sort(),
          ...(rejected.length > 0 ? { rejected } : {}),
        },
      };
      return {
        nextState: this.replaceConnection(state, next),
        result: next,
      };
    });
  }

  /**
   * Throws `VaultUnavailableError` when the vault can't be changed this
   * launch, so a caller with other work to do first, such as removing a
   * package, can refuse before it starts what a refused removal would leave
   * half done.
   */
  async assertSecretsChangeable(): Promise<void> {
    const opened = await this.vault?.open();
    if (opened?.changeRefusedReason) {
      throw new VaultUnavailableError(opened.changeRefusedReason, "change");
    }
  }

  /**
   * Moves into the vault what the state file still keeps of a secret: a
   * plugin that came back after its connections were sealed, or an update
   * that marks a field secret. `manifests` must list every installed plugin
   * unless `only` names the plugin whose holders to settle; a plugin missing
   * from a full list has its holders sealed. A holder whose move failed this
   * launch waits for the next.
   */
  async settleSecrets(
    manifests: readonly SecretManifest[],
    only?: string,
  ): Promise<void> {
    const byId = new Map(manifests.map((manifest) => [manifest.id, manifest]));
    const state = await this.readState();
    const inScope = (pluginId: string) =>
      only === undefined ? true : pluginId === only;
    const needed =
      state.connections.some(
        (connection) =>
          inScope(connection.pluginId) &&
          !this.failedMoves.has(holderId(connection.pluginId, connection.id)) &&
          needsSettling(connectionHolder(connection), byId),
      ) ||
      Object.entries(state.agentRunner.pluginValues).some(
        ([pluginId, values]) =>
          inScope(pluginId) &&
          !this.failedMoves.has(holderId(pluginId, null)) &&
          needsSettling(
            {
              pluginId,
              connectionId: null,
              values,
              secrets: state.agentRunner.pluginSecrets[pluginId],
            },
            byId,
          ),
      );
    if (!needed) return;
    await this.mutate(async (current) => {
      const report = emptyVaultMigrationReport();
      const settled = await settleHolders(
        current.connections,
        current.agentRunner,
        {
          vault: this.vault,
          manifests: byId,
          skip: this.failedMoves,
          ...(only !== undefined ? { only } : {}),
        },
        report,
      );
      for (const id of report.failed) this.failedMoves.add(id);
      return {
        nextState: {
          ...current,
          connections: settled.connections.sort(compareConnections),
          agentRunner: {
            ...current.agentRunner,
            pluginValues: settled.pluginValues,
            pluginSecrets: settled.pluginSecrets,
          },
        },
        result: undefined,
        afterWrite: () => this.removeSealedEntries(report),
      };
    });
  }

  /**
   * A connection with the secrets the vault holds for it, as far as they can
   * be read, for a save that merges them or a plugin operation. Null when
   * the connection doesn't exist. `usedAt` records the read as a use.
   */
  async readConnectionSecrets(
    pluginId: string,
    connectionId: string,
    manifest: SecretManifest | undefined,
    options: { usedAt?: number } = {},
  ): Promise<(HolderSecrets & { connection: ConnectionWithSecrets }) | null> {
    const connection = await this.getConnection(pluginId, connectionId);
    if (!connection) return null;
    const secretsReadAt = options.usedAt ?? Date.now();
    const read = await readHolderSecrets(
      connectionHolder(connection),
      manifest,
      this.vault,
      options,
    );
    return {
      ...read,
      connection: { ...connection, config: read.values, secretsReadAt },
    };
  }

  /**
   * The connection a plugin operation runs with: its config with its
   * secrets, decrypted for this one operation. Null when it doesn't exist.
   * Throws `ConnectionPausedError` when a secret it needs can't reach the
   * plugin: the vault can't encrypt or read it, or it hasn't moved into the
   * vault yet. A connection without secrets always runs.
   */
  async connectionForOperation(
    pluginId: string,
    connectionId: string,
    manifest: SecretManifest,
  ): Promise<ConnectionWithSecrets | null> {
    await this.settleSecrets([manifest], pluginId);
    const read = await this.readConnectionSecrets(
      pluginId,
      connectionId,
      manifest,
      { usedAt: Date.now() },
    );
    if (!read) return null;
    if (read.pause) throw new ConnectionPausedError(read.pause, read.reason);
    return read.connection;
  }

  /** Deletes the sealed entries a settled pass split, once the state no longer needs them. */
  private async removeSealedEntries(report: VaultMigrationReport) {
    for (const selection of report.removeAfterSave) {
      // A sealed entry left behind is never read again and goes with its
      // connection or plugin.
      await this.vault?.remove(selection).catch(() => undefined);
    }
  }

  /**
   * `unavailable` lists installed packages the host cannot run. They show up
   * with their own name and version, and the reason.
   */
  async getPluginsOverview(
    plugins: PluginManifest[],
    unavailable: Array<{
      manifest: PluginManifest;
      reason: string;
    }> = [],
  ): Promise<PluginsOverview> {
    const state = await this.readState();
    const vault = await this.vaultView();
    const status = vault.status;
    const pluginMap = new Map<string, PluginOverviewItem>(
      plugins.map((plugin) => [plugin.id, plugin] as const),
    );
    for (const { manifest, reason } of unavailable) {
      if (!pluginMap.has(manifest.id)) {
        pluginMap.set(manifest.id, {
          ...manifest,
          unavailableReason: reason,
        });
      }
    }

    const missingPluginIds = new Set<string>();
    for (const connection of state.connections) {
      if (!pluginMap.has(connection.pluginId)) {
        missingPluginIds.add(connection.pluginId);
        pluginMap.set(
          connection.pluginId,
          createMissingPluginManifest(connection.pluginId),
        );
      }
    }

    // A missing plugin may still have agent task settings in the vault.
    for (const pluginId of Object.keys(state.agentRunner.pluginSecrets)) {
      if (!pluginMap.has(pluginId)) {
        missingPluginIds.add(pluginId);
        pluginMap.set(pluginId, createMissingPluginManifest(pluginId));
      }
    }

    const allPlugins = Array.from(pluginMap.values()).sort(
      comparePluginManifests,
    );
    const connectionGroups = allPlugins.map((plugin) => {
      const agentTaskSecrets = state.agentRunner.pluginSecrets[plugin.id];
      const agentOwner = { pluginId: plugin.id, connectionId: null };
      const agentTaskSecretFields = secretFieldSummaries(
        agentOwner,
        agentTaskSecrets,
        vault,
      );
      const agentTaskSealedConfig = sealedSummary(
        agentOwner,
        agentTaskSecrets,
        vault,
      );
      return {
        plugin,
        enabled:
          state.pluginsEnabled &&
          plugin.unavailableReason === undefined &&
          !state.disabledPluginIds.includes(plugin.id),
        inactiveCapabilities: (
          state.disabledCapabilities[plugin.id] ?? []
        ).filter((capability) => pluginHasCapability(plugin, capability)),
        ...(missingPluginIds.has(plugin.id) ? { missing: true } : {}),
        ...(agentTaskSecretFields.length > 0 ? { agentTaskSecretFields } : {}),
        ...(agentTaskSealedConfig ? { agentTaskSealedConfig } : {}),
        connections: state.connections
          .filter((connection) => connection.pluginId === plugin.id)
          .map((connection) =>
            buildConnectionSummary(
              state,
              connection,
              plugin,
              !missingPluginIds.has(plugin.id),
              vault,
            ),
          ),
      };
    });

    return {
      vault: status,
      pluginsEnabled: state.pluginsEnabled,
      plugins: allPlugins,
      connectionGroups,
      totalPendingImportCount: connectionGroups.reduce(
        (sum, group) =>
          sum +
          group.connections.reduce(
            (groupSum, connection) => groupSum + connection.pendingImportCount,
            0,
          ),
        0,
      ),
      totalSelectedImportCount: connectionGroups.reduce(
        (sum, group) =>
          sum +
          group.connections.reduce(
            (groupSum, connection) => groupSum + connection.selectedImportCount,
            0,
          ),
        0,
      ),
    };
  }

  async isPluginEnabled(
    pluginId: string,
    availablePluginIds: ReadonlySet<string>,
  ): Promise<boolean> {
    const state = await this.readState();
    return (
      availablePluginIds.has(pluginId) &&
      state.pluginsEnabled &&
      !state.disabledPluginIds.includes(pluginId)
    );
  }

  /** Whether the plugin is enabled and the capability is not turned off. */
  async isPluginCapabilityEnabled(
    pluginId: string,
    capability: SwitchableCapability,
    availablePluginIds: ReadonlySet<string>,
  ): Promise<boolean> {
    return (
      (await this.isPluginEnabled(pluginId, availablePluginIds)) &&
      !(await this.readState()).disabledCapabilities[pluginId]?.includes(
        capability,
      )
    );
  }

  /** The switchable capabilities that are on, among those the plugin declares. */
  async listEnabledCapabilities(
    pluginId: string,
    declared: readonly SwitchableCapability[],
  ): Promise<SwitchableCapability[]> {
    const disabled = (await this.readState()).disabledCapabilities[pluginId];
    return declared.filter((capability) => !disabled?.includes(capability));
  }

  async getPluginSystemEnabled(): Promise<boolean> {
    return (await this.readState()).pluginsEnabled;
  }

  async setPluginSystemEnabled(enabled: boolean): Promise<void> {
    await this.mutate(async (state) => ({
      nextState: { ...state, pluginsEnabled: enabled },
      result: undefined,
    }));
  }

  /** MCP settings for the Settings page. Revoked clients and token hashes stay out. */
  async getMcpSettings(): Promise<McpSettings> {
    const { mcp } = await this.readState();
    return {
      enabled: mcp.enabled,
      clients: mcp.clients
        .filter((client) => client.revokedAt === undefined)
        .map(({ id, name, createdAt, lastUsedAt }) => ({
          id,
          name,
          createdAt,
          ...(lastUsedAt === undefined ? {} : { lastUsedAt }),
        })),
    };
  }

  async setMcpEnabled(enabled: boolean): Promise<void> {
    await this.mutate((state) => ({
      nextState: { ...state, mcp: { ...state.mcp, enabled } },
      result: undefined,
    }));
  }

  async addMcpClient(client: StoredMcpClient): Promise<void> {
    await this.mutate((state) => ({
      nextState: {
        ...state,
        mcp: { ...state.mcp, clients: [...state.mcp.clients, client] },
      },
      result: undefined,
    }));
  }

  /** Revokes a client. False when no active client has the id. */
  async revokeMcpClient(clientId: string, at: number): Promise<boolean> {
    return this.mutate((state) => {
      const target = state.mcp.clients.find(
        (client) => client.id === clientId && client.revokedAt === undefined,
      );
      if (!target) return { nextState: state, result: false };
      return {
        nextState: {
          ...state,
          mcp: {
            ...state.mcp,
            clients: state.mcp.clients.map((client) =>
              client === target ? { ...client, revokedAt: at } : client,
            ),
          },
        },
        result: true,
      };
    });
  }

  /** Finds a client by token hash, revoked or not. */
  async findMcpClientByTokenHash(
    tokenHash: string,
  ): Promise<StoredMcpClient | undefined> {
    return (await this.readState()).mcp.clients.find(
      (client) => client.tokenHash === tokenHash,
    );
  }

  async touchMcpClient(clientId: string, at: number): Promise<void> {
    const client = (await this.readState()).mcp.clients.find(
      (candidate) => candidate.id === clientId,
    );
    if (
      !client ||
      (client.lastUsedAt !== undefined &&
        at - client.lastUsedAt < MCP_LAST_USED_RESOLUTION_MS)
    ) {
      return;
    }
    await this.mutate((state) => ({
      nextState: {
        ...state,
        mcp: {
          ...state.mcp,
          clients: state.mcp.clients.map((candidate) =>
            candidate.id === clientId
              ? { ...candidate, lastUsedAt: at }
              : candidate,
          ),
        },
      },
      result: undefined,
    }));
  }

  async getAgentRunnerSettings(): Promise<AgentRunnerSettings> {
    return (await this.readState()).agentRunner.settings;
  }

  async updateAgentRunnerSettings(
    patch: Partial<AgentRunnerSettings>,
  ): Promise<AgentRunnerSettings> {
    return await this.mutate((state) => {
      const settings = agentRunnerSettingsSchema.parse({
        ...state.agentRunner.settings,
        ...patch,
      });
      return {
        nextState: {
          ...state,
          agentRunner: { ...state.agentRunner, settings },
        },
        result: settings,
      };
    });
  }

  /**
   * The agent task settings the user filled in for a plugin, or none, with
   * the secrets the vault holds as far as they can be read. With the
   * plugin's `manifest`, a secret still in plain text, waiting to move into
   * the vault, is left out, as an unreadable one is.
   */
  async getAgentTaskValues(
    pluginId: string,
    manifest?: SecretManifest,
  ): Promise<PluginFieldValues> {
    const read = await this.readAgentTaskSecrets(pluginId, manifest);
    // Whatever the pause says, a secret still in plain text never reaches a run.
    return manifest && holderNeedsMove(read.holder, manifest)
      ? nonSecretValues(read.holder, manifest, read.values)
      : read.values;
  }

  /** The plugin's agent task settings with their secrets, and what the vault holds. */
  async readAgentTaskSecrets(
    pluginId: string,
    manifest?: SecretManifest,
  ): Promise<HolderSecrets & { holder: SecretHolder }> {
    if (UNSAFE_KEYS.has(pluginId)) {
      const holder = { pluginId, connectionId: null, values: {} };
      return { holder, values: {}, unreadable: [] };
    }
    const holder = this.agentTaskHolder(await this.readState(), pluginId);
    return {
      holder,
      ...(await readHolderSecrets(holder, manifest, this.vault)),
    };
  }

  /**
   * Saves a plugin's agent task settings. With `save`, the values marked
   * secret go to the vault, as a connection's do (see `upsertConnection`).
   */
  async setAgentTaskValues(
    pluginId: string,
    values: PluginFieldValues,
    save?: SecretSaveFields,
  ): Promise<void> {
    if (UNSAFE_KEYS.has(pluginId)) return;
    await this.mutate(async (state) => {
      const holder = this.agentTaskHolder(state, pluginId);
      const split = save
        ? await this.writeSecretsOfSave(holder, save, values)
        : undefined;
      const pluginValues: StoredAgentRunnerState["pluginValues"] =
        Object.create(null);
      Object.assign(pluginValues, state.agentRunner.pluginValues);
      pluginValues[pluginId] = safeValues(split?.values ?? values);
      const pluginSecrets: StoredAgentRunnerState["pluginSecrets"] =
        Object.create(null);
      Object.assign(pluginSecrets, state.agentRunner.pluginSecrets);
      if (split) pluginSecrets[pluginId] = split.secrets;
      return {
        nextState: {
          ...state,
          agentRunner: { ...state.agentRunner, pluginValues, pluginSecrets },
        },
        result: undefined,
        afterWrite: () => this.removeAfterSave(holder, split),
      };
    });
  }

  private agentTaskHolder(state: AppApiState, pluginId: string): SecretHolder {
    return {
      pluginId,
      connectionId: null,
      values: state.agentRunner.pluginValues[pluginId] ?? {},
      secrets: state.agentRunner.pluginSecrets[pluginId],
    };
  }

  /**
   * Splits a save between the state and the vault, and writes the vault's
   * part: the new or changed secrets, and the removal of those the save
   * dropped. Throws `VaultUnavailableError` when a secret can't be
   * encrypted, before the state changes. A sealed entry is removed only
   * after the state is saved (`removeAfterSave`).
   */
  private async writeSecretsOfSave(
    holder: SecretHolder,
    save: SecretSaveFields,
    values: PluginFieldValues,
  ): Promise<SplitSave> {
    const previous = await readHolderSecrets(holder, undefined, this.vault);
    // The dates held now, so a date the form repeats isn't a change.
    const held =
      this.vault && save.secretExpiry
        ? await this.vault.list()
        : ([] as SecretEntryInfo[]);
    const currentExpiry: Record<string, number | undefined> = {};
    for (const entry of held) {
      if (
        entry.pluginId === holder.pluginId &&
        entry.connectionId === holder.connectionId &&
        entry.fieldId !== null
      ) {
        currentExpiry[entry.fieldId] = entry.expiresAt;
      }
    }
    const split = splitSave(
      holder,
      save.fields,
      values,
      previous,
      save.removeSecrets,
      {
        replaced: save.replacedSecrets,
        expiry: save.secretExpiry,
        currentExpiry,
      },
    );
    if (split.writes.length > 0) {
      if (!this.vault) throw new VaultUnavailableError(NO_VAULT_REASON);
      await this.vault.write(split.writes);
    }
    if (split.expiryUpdates.length > 0 && this.vault) {
      await this.vault.setExpiry(
        split.expiryUpdates.map(({ fieldId, expiresAt }) => ({
          pluginId: holder.pluginId,
          connectionId: holder.connectionId,
          fieldId,
          expiresAt,
        })),
      );
    }
    const fieldIds = split.removals.filter(
      (fieldId): fieldId is string => fieldId !== null,
    );
    if (fieldIds.length > 0 && this.vault) {
      await this.vault.remove({
        pluginId: holder.pluginId,
        connectionId: holder.connectionId,
        fieldIds,
      });
    }
    return split;
  }

  private async removeAfterSave(holder: SecretHolder, split?: SplitSave) {
    if (!split?.removals.includes(null) || !this.vault) return;
    // The save stands either way. A sealed entry left behind is never read
    // again, and goes with its connection or plugin.
    await this.vault
      .remove({
        pluginId: holder.pluginId,
        connectionId: holder.connectionId,
        fieldIds: [null],
      })
      .catch(() => undefined);
  }

  async setPluginEnabled(pluginId: string, enabled: boolean): Promise<void> {
    await this.mutate(async (state) => {
      const disabledPluginIds = enabled
        ? state.disabledPluginIds.filter((candidate) => candidate !== pluginId)
        : Array.from(new Set([...state.disabledPluginIds, pluginId])).sort();

      return {
        nextState: {
          ...state,
          disabledPluginIds,
        },
        result: undefined,
      };
    });
  }

  async setPluginCapabilityEnabled(
    pluginId: string,
    capability: SwitchableCapability,
    enabled: boolean,
  ): Promise<void> {
    await this.mutate(async (state) => {
      const current = state.disabledCapabilities[pluginId] ?? [];
      const next = enabled
        ? current.filter((candidate) => candidate !== capability)
        : Array.from(new Set([...current, capability])).sort();
      const { [pluginId]: _previous, ...others } = state.disabledCapabilities;
      return {
        nextState: {
          ...state,
          disabledCapabilities: next.length
            ? { ...others, [pluginId]: next }
            : others,
        },
        result: undefined,
      };
    });
  }

  /**
   * Keeps the plugin's connections meaning what their user chose when an
   * update adds a capability. Auto sync described the plugin's only
   * capability; once it has both, auto sync imports backlog items. Adding
   * backlog items moves that choice to pull requests and lets backlog items
   * stage for review. Adding pull requests starts their own sync at
   * `pullRequestAutoSyncDefault`, the default of a new connection.
   */
  async adoptAddedCapability(
    pluginId: string,
    added: SwitchableCapability,
    pullRequestAutoSyncDefault: boolean,
  ): Promise<void> {
    // A calendar has no automatic sync of its own to keep, and a team always
    // syncs on the interval.
    if (added === "calendar" || added === "team") return;
    await this.mutate(async (state) => ({
      nextState: {
        ...state,
        connections: state.connections.map((connection) =>
          connection.pluginId !== pluginId
            ? connection
            : added === "connector"
              ? {
                  ...connection,
                  autoSync: false,
                  pullRequestAutoSync:
                    connection.pullRequestAutoSync ?? connection.autoSync,
                }
              : {
                  ...connection,
                  pullRequestAutoSync:
                    connection.pullRequestAutoSync ??
                    pullRequestAutoSyncDefault,
                },
        ),
      },
      result: undefined,
    }));
  }

  /**
   * Deletes what a plugin's uninstall takes: its connections and their
   * vault entries, its agent task settings, staged items and statuses.
   * Deactivating a plugin keeps all of them. Throws
   * `VaultUnavailableError`, and changes nothing, when the vault can't drop
   * the plugin's entries: the state would then forget secrets the vault
   * still holds.
   */
  async removePluginData(pluginId: string): Promise<void> {
    await this.mutate(async (state) => {
      await this.vault?.remove({ pluginId });
      return this.withoutPluginData(state, pluginId);
    });
  }

  private withoutPluginData(state: AppApiState, pluginId: string) {
    return {
      nextState: {
        ...state,
        connections: state.connections.filter(
          (connection) => connection.pluginId !== pluginId,
        ),
        stagedImports: state.stagedImports.filter(
          (item) => item.source !== pluginId,
        ),
        dismissedImportKeys: state.dismissedImportKeys.filter(
          (key) => !key.startsWith(`${pluginId}:`),
        ),
        connectorBacklogStatuses: state.connectorBacklogStatuses.filter(
          (status) => status.source !== pluginId,
        ),
        disabledPluginIds: state.disabledPluginIds.filter(
          (candidate) => candidate !== pluginId,
        ),
        disabledCapabilities: Object.fromEntries(
          Object.entries(state.disabledCapabilities).filter(
            ([candidate]) => candidate !== pluginId,
          ),
        ),
        agentRunner: {
          ...state.agentRunner,
          pluginValues: Object.fromEntries(
            Object.entries(state.agentRunner.pluginValues).filter(
              ([candidate]) => candidate !== pluginId,
            ),
          ),
          pluginSecrets: Object.fromEntries(
            Object.entries(state.agentRunner.pluginSecrets).filter(
              ([candidate]) => candidate !== pluginId,
            ),
          ),
        },
      } satisfies AppApiState,
      result: undefined,
    };
  }

  async listBacklogSourceStatuses() {
    const state = await this.readState();
    return {
      items: state.connectorBacklogStatuses,
    };
  }

  async listConnections(pluginId?: string): Promise<StoredConnection[]> {
    const state = await this.readState();
    return pluginId
      ? state.connections.filter(
          (connection) => connection.pluginId === pluginId,
        )
      : state.connections;
  }

  async getConnection(
    pluginId: string,
    connectionId: string,
  ): Promise<StoredConnection | null> {
    const state = await this.readState();
    return (
      state.connections.find(
        (connection) =>
          connection.pluginId === pluginId && connection.id === connectionId,
      ) ?? null
    );
  }

  async upsertConnection(
    pluginId: string,
    input: {
      id?: string;
      label: string;
      tenantLabel: string;
      autoSync: boolean;
      autoSyncIntervalMinutes: number;
      /** Undefined keeps the saved value. */
      pullRequestAutoSync?: boolean;
      /** Undefined keeps the saved value. */
      agentAccess?: AgentAccess;
      /** Undefined keeps the saved value. */
      allowLossyConversion?: boolean;
      config: PluginFieldValues;
      configSummary: PluginSummaryValues;
    },
    save?: SecretSaveFields,
  ): Promise<StoredConnection> {
    return this.mutate(async (state) => {
      const connectionId = input.id ?? `${pluginId}_${randomUUID()}`;
      const existing = state.connections.find(
        (connection) =>
          connection.pluginId === pluginId && connection.id === connectionId,
      );
      // With the plugin's fields, `config` holds the secrets too: the vault
      // gets them, and the state file which fields it holds.
      const holder: SecretHolder = existing
        ? connectionHolder(existing)
        : { pluginId, connectionId, values: {} };
      const split = save
        ? await this.writeSecretsOfSave(holder, save, input.config)
        : undefined;

      const nextConnection: StoredConnection = {
        id: connectionId,
        pluginId,
        label: input.label,
        tenantLabel: input.tenantLabel,
        autoSync: input.autoSync,
        autoSyncIntervalMinutes: input.autoSyncIntervalMinutes,
        ...((input.pullRequestAutoSync ?? existing?.pullRequestAutoSync) !==
        undefined
          ? {
              pullRequestAutoSync:
                input.pullRequestAutoSync ?? existing?.pullRequestAutoSync,
            }
          : {}),
        ...((input.agentAccess ?? existing?.agentAccess)
          ? { agentAccess: input.agentAccess ?? existing?.agentAccess }
          : {}),
        ...((input.allowLossyConversion ?? existing?.allowLossyConversion)
          ? { allowLossyConversion: true }
          : {}),
        config: split?.values ?? input.config,
        ...((split?.secrets ?? existing?.secrets)
          ? { secrets: split?.secrets ?? existing?.secrets }
          : {}),
        configSummary: input.configSummary,
        connectedAt: existing?.connectedAt ?? Date.now(),
        lastSyncAt: existing?.lastSyncAt,
        lastError: undefined,
        lastErrorAt: undefined,
      };

      const nextState: AppApiState = {
        ...state,
        connections: [
          ...state.connections.filter(
            (connection) =>
              !(
                connection.pluginId === pluginId &&
                connection.id === connectionId
              ),
          ),
          nextConnection,
        ].sort(compareConnections),
        stagedImports: state.stagedImports
          .map((item) =>
            item.connectionId === connectionId
              ? {
                  ...item,
                  connectionLabel: nextConnection.label,
                  tenantLabel: nextConnection.tenantLabel,
                }
              : item,
          )
          .sort(compareImports),
      };

      return {
        nextState,
        result: nextConnection,
        afterWrite: () => this.removeAfterSave(holder, split),
      };
    });
  }

  /**
   * Deletes a connection with its staged items and statuses, and its vault
   * entries first. When the vault can't drop them it throws
   * `VaultUnavailableError` and keeps the connection, since the state would
   * otherwise forget secrets the vault still holds. If the state then can't
   * be saved, the secrets are gone and the connection stays, to be entered
   * again. A pending dismissal of its items can no longer be undone, since Undo
   * would bring back items for a connection that is gone.
   */
  async deleteConnection(
    pluginId: string,
    connectionId: string,
  ): Promise<boolean> {
    const deleted = await this.mutate(async (state) => {
      const exists = state.connections.some(
        (connection) =>
          connection.pluginId === pluginId && connection.id === connectionId,
      );
      if (!exists) {
        return {
          nextState: state,
          result: false,
        };
      }
      await this.vault?.remove({ pluginId, connectionId });

      const nextState: AppApiState = {
        ...state,
        connections: state.connections.filter(
          (connection) =>
            !(
              connection.pluginId === pluginId && connection.id === connectionId
            ),
        ),
        stagedImports: state.stagedImports.filter(
          (item) => item.connectionId !== connectionId,
        ),
        connectorBacklogStatuses: state.connectorBacklogStatuses.filter(
          (status) =>
            !(
              status.source === pluginId && status.connectionId === connectionId
            ),
        ),
      };

      return {
        nextState,
        result: true,
      };
    });

    if (
      deleted &&
      this.lastDismissal?.items.some(
        (item) =>
          item.source === pluginId && item.connectionId === connectionId,
      )
    ) {
      this.lastDismissal = undefined;
    }
    return deleted;
  }

  async upsertBacklogSourceStatuses(
    inputs: BacklogSourceStatusInput[],
    timestamp = Date.now(),
  ) {
    return this.mutate(async (state) => {
      if (inputs.length === 0) {
        return {
          nextState: state,
          result: state.connectorBacklogStatuses,
        };
      }

      const nextStatuses = [...state.connectorBacklogStatuses];

      for (const input of inputs) {
        const label = input.label.trim();
        const key = normalizeSourceStatusKey(label);
        if (!label || !key) {
          continue;
        }

        const existingIndex = nextStatuses.findIndex(
          (status) =>
            status.source === input.source &&
            status.connectionId === input.connectionId &&
            status.key === key,
        );
        const nextStatus = {
          source: input.source,
          connectionId: input.connectionId,
          connectionLabel: input.connectionLabel,
          tenantLabel: input.tenantLabel,
          key,
          label,
          lastSeenAt: timestamp,
        } satisfies BacklogSourceStatus;

        if (existingIndex >= 0) {
          nextStatuses[existingIndex] = nextStatus;
          continue;
        }

        nextStatuses.push(nextStatus);
      }

      nextStatuses.sort(compareBacklogStatuses);

      return {
        nextState: {
          ...state,
          connectorBacklogStatuses: nextStatuses,
        },
        result: nextStatuses,
      };
    });
  }

  async recordConnectionSyncSuccess(
    pluginId: string,
    connectionId: string,
    timestamp: number,
  ): Promise<StoredConnection> {
    return this.mutate(async (state) => {
      const connection = state.connections.find(
        (candidate) =>
          candidate.pluginId === pluginId && candidate.id === connectionId,
      );
      if (!connection) {
        throw new Error(`Plugin connection "${connectionId}" not found.`);
      }

      const nextConnection = {
        ...connection,
        lastSyncAt: timestamp,
        lastError: undefined,
        lastErrorAt: undefined,
      };
      const nextState = this.replaceConnection(state, nextConnection);

      return {
        nextState,
        result: nextConnection,
      };
    });
  }

  async recordConnectionError(
    pluginId: string,
    connectionId: string,
    message: string,
  ): Promise<StoredConnection> {
    return this.mutate(async (state) => {
      const connection = state.connections.find(
        (candidate) =>
          candidate.pluginId === pluginId && candidate.id === connectionId,
      );
      if (!connection) {
        throw new Error(`Plugin connection "${connectionId}" not found.`);
      }

      const nextConnection = {
        ...connection,
        lastError: boundConnectionError(message),
        lastErrorAt: Date.now(),
      };
      const nextState = this.replaceConnection(state, nextConnection);

      return {
        nextState,
        result: nextConnection,
      };
    });
  }

  async stageImportItems(
    items: BacklogImportCandidateInput[],
  ): Promise<StageImportItemsResult> {
    return this.mutate(async (state) => {
      const dismissedKeys = new Set(state.dismissedImportKeys);
      const stagedByKey = new Map(
        state.stagedImports.map((item) => [importKey(item), item] as const),
      );

      let queuedCount = 0;
      let updatedCount = 0;
      let skippedCount = 0;

      for (const item of items) {
        const key = importKey(item);
        const pushedAt = item.pushedAt ?? Date.now();

        const existing = stagedByKey.get(key);
        if (existing) {
          stagedByKey.set(key, {
            ...existing,
            ...item,
            selected: existing.selectable ? existing.selected : false,
            pushedAt,
          });
          updatedCount += 1;
          continue;
        }

        if (dismissedKeys.has(key)) {
          skippedCount += 1;
          continue;
        }

        stagedByKey.set(key, {
          id: `connector_${randomUUID()}`,
          ...item,
          selected: item.selectable ? (item.selected ?? true) : false,
          pushedAt,
        });
        queuedCount += 1;
      }

      return {
        nextState: {
          ...state,
          stagedImports: Array.from(stagedByKey.values()).sort(compareImports),
        },
        result: { queuedCount, updatedCount, skippedCount },
      };
    });
  }

  /**
   * Removes staged items from review, with their subitems and context parents,
   * and keeps their keys so later syncs skip them. Returns a token for
   * `restoreDismissedImports` when anything was dismissed.
   */
  async dismissImports(
    ids: string[],
  ): Promise<{ dismissedCount: number; undoToken?: string }> {
    const dismissal = await this.mutate<ImportDismissal | undefined>(
      async (state) => {
        const idSet = new Set(ids);
        const itemsById = new Map(
          state.stagedImports.map((item) => [item.id, item] as const),
        );
        const childrenByParentSourceId = new Map<
          string,
          BacklogImportCandidate[]
        >();

        for (const item of state.stagedImports) {
          if (!item.parentSourceId) {
            continue;
          }

          const siblings =
            childrenByParentSourceId.get(item.parentSourceId) ?? [];
          siblings.push(item);
          childrenByParentSourceId.set(item.parentSourceId, siblings);
        }

        const dismissedIds = new Set<string>();
        const queue = [...idSet];
        while (queue.length > 0) {
          const nextId = queue.shift();
          if (!nextId || dismissedIds.has(nextId)) {
            continue;
          }

          const item = itemsById.get(nextId);
          if (!item) {
            continue;
          }

          dismissedIds.add(nextId);

          const childItems = childrenByParentSourceId.get(item.sourceId) ?? [];
          for (const child of childItems) {
            if (!dismissedIds.has(child.id)) {
              queue.push(child.id);
            }
          }

          if (item.parentSourceId) {
            const parent = state.stagedImports.find(
              (candidate) =>
                candidate.connectionId === item.connectionId &&
                candidate.sourceId === item.parentSourceId,
            );
            if (parent && !parent.selectable && !dismissedIds.has(parent.id)) {
              queue.push(parent.id);
            }
          }
        }

        if (dismissedIds.size === 0) {
          return {
            nextState: state,
            result: undefined,
          };
        }

        const dismissedImportKeys = new Set(state.dismissedImportKeys);
        const items: BacklogImportCandidate[] = [];
        const addedKeys: string[] = [];
        for (const item of state.stagedImports) {
          if (dismissedIds.has(item.id)) {
            items.push(item);
            const key = importKey(item);
            if (!dismissedImportKeys.has(key)) {
              dismissedImportKeys.add(key);
              addedKeys.push(key);
            }
          }
        }

        return {
          nextState: {
            ...state,
            stagedImports: state.stagedImports.filter(
              (item) => !dismissedIds.has(item.id),
            ),
            dismissedImportKeys: Array.from(dismissedImportKeys),
          },
          result: { token: `dismissal_${randomUUID()}`, items, addedKeys },
        };
      },
    );

    if (!dismissal) {
      return { dismissedCount: 0 };
    }

    this.lastDismissal = dismissal;
    return {
      dismissedCount: dismissal.items.length,
      undoToken: dismissal.token,
    };
  }

  /**
   * Undoes the dismissal that returned `token`, if it is still the last one.
   * The items return to the review queue as they were. `stale` means one of
   * them was staged again or its dismissal was cleared since, and nothing
   * changes. `expired` also covers a dismissal whose connection was deleted.
   */
  async restoreDismissedImports(
    token: string,
  ): Promise<"restored" | "stale" | "expired"> {
    const dismissal = this.lastDismissal;
    if (dismissal?.token !== token) {
      return "expired";
    }
    this.lastDismissal = undefined;

    return this.mutate((state) => {
      const dismissedKeys = new Set(state.dismissedImportKeys);
      const stagedKeys = new Set(state.stagedImports.map(importKey));
      const unchanged = dismissal.items.every(
        (item) =>
          dismissedKeys.has(importKey(item)) &&
          !stagedKeys.has(importKey(item)),
      );
      if (!unchanged) {
        return { nextState: state, result: "stale" as const };
      }

      const addedKeys = new Set(dismissal.addedKeys);
      return {
        nextState: {
          ...state,
          stagedImports: [...state.stagedImports, ...dismissal.items].sort(
            compareImports,
          ),
          dismissedImportKeys: state.dismissedImportKeys.filter(
            (key) => !addedKeys.has(key),
          ),
        },
        result: "restored" as const,
      };
    });
  }

  async listStagedImports() {
    const state = await this.readState();
    const items = state.stagedImports.sort(compareImports);

    return {
      items,
      totalCount: items.length,
      selectedCount: items.filter((item) => item.selected).length,
    };
  }

  async updateImportSelection(
    ids: string[],
    selected: boolean,
  ): Promise<number> {
    return this.mutate(async (state) => {
      const idSet = new Set(ids);
      let updatedCount = 0;

      const nextItems = state.stagedImports.map((item) => {
        if (
          !idSet.has(item.id) ||
          !item.selectable ||
          item.selected === selected
        ) {
          return item;
        }

        updatedCount += 1;
        return {
          ...item,
          selected,
        };
      });

      return {
        nextState: {
          ...state,
          stagedImports: nextItems.sort(compareImports),
        },
        result: updatedCount,
      };
    });
  }

  async commitSelectedImports(): Promise<BacklogImportCandidate[]> {
    return this.mutate(async (state) => {
      const selectedItems = state.stagedImports.filter(
        (item) => item.selectable && item.selected,
      );
      if (selectedItems.length === 0) {
        return {
          nextState: state,
          result: [],
        };
      }

      const stagedByParentKey = new Map(
        state.stagedImports.map(
          (item) => [`${item.connectionId}:${item.sourceId}`, item] as const,
        ),
      );
      const committedIds = new Set(selectedItems.map((item) => item.id));

      for (const item of selectedItems) {
        if (item.depth !== 1 || !item.parentSourceId) {
          continue;
        }

        const parent = stagedByParentKey.get(
          `${item.connectionId}:${item.parentSourceId}`,
        );
        if (parent) {
          committedIds.add(parent.id);
        }
      }

      const committedItems = state.stagedImports
        .filter((item) => committedIds.has(item.id))
        .sort(compareImports);

      return {
        nextState: {
          ...state,
          stagedImports: state.stagedImports.filter(
            (item) => !committedIds.has(item.id),
          ),
        },
        result: committedItems,
      };
    });
  }

  private replaceConnection(
    state: AppApiState,
    connection: StoredConnection,
  ): AppApiState {
    return {
      ...state,
      connections: [
        ...state.connections.filter(
          (candidate) =>
            !(
              candidate.pluginId === connection.pluginId &&
              candidate.id === connection.id
            ),
        ),
        connection,
      ].sort(compareConnections),
    };
  }

  private async readState(): Promise<AppApiState> {
    if (this.cache) {
      return this.cache;
    }

    // Every first reader shares one load, so a load that finishes late can
    // never replace state a mutation saved meanwhile.
    this.loading ??= this.loadState().finally(() => {
      this.loading = undefined;
    });
    const loaded = await this.loading;
    return this.cache ?? loaded;
  }

  /**
   * Reads and migrates the state file, in its own `storage.load` event. A
   * file that isn't JSON fails every read until it is fixed, and its event
   * says it is unreadable.
   */
  private async loadState(): Promise<AppApiState> {
    const unit = this.events?.start("storage.load", {
      kind: "lifecycle",
      trigger: "system",
      // Shared by every first reader, so never folded into one of them.
      detached: true,
    });
    try {
      // They hold the state, secrets in plain text before the vault, and
      // nothing reads them.
      const orphans = await removeOrphanedTempFiles(this.statePath);
      if (orphans.undeletable > 0) {
        unit?.set({
          storage: { orphans_undeletable_count: orphans.undeletable },
        });
      }
      if (this.vault) {
        const opened = await this.vault.open();
        unit?.set({
          vault: {
            state: opened.status.state,
            entry_count: opened.entryCount,
            ...(opened.undeletableOrphans > 0
              ? { orphans_undeletable_count: opened.undeletableOrphans }
              : {}),
          },
        });
      } else {
        unit?.set({ vault: { state: "none" } });
      }
      let state: AppApiState;
      let migration: VaultMigrationReport | undefined;
      if (existsSync(this.statePath)) {
        const text = await readFile(this.statePath, "utf8");
        unit?.set({
          storage: { found: true, bytes: Buffer.byteLength(text) },
        });
        const read = await readStateFile(text, async () => ({
          vault: this.vault,
          manifests: await this.manifestsForMigration(),
          reportVaultMigration: (report) => {
            migration = report;
          },
        }));
        if (!read) {
          // The parser's and the migration's errors quote the file, so
          // neither the event nor the request that read it gets them.
          const unreadable = unreadableStateError();
          unit
            ?.set({ storage: { unreadable: true } })
            .fail(unreadable, { reason: "unreadable" });
          throw unreadable;
        }
        unit?.set({ storage: { version_from: read.versionFrom } });
        state = read.state;
      } else {
        unit?.set({ storage: { found: false } });
        state = createDefaultState();
      }
      unit?.set({ storage: { version_to: state.version } });
      if (migration) {
        for (const id of migration.failed) this.failedMoves.add(id);
        unit?.set({
          vault_migration: {
            moved_count: migration.moved,
            pending_count: migration.pending,
          },
        });
      }
      if (this.cache) return this.cache;
      if (migration && migration.moved > 0) {
        // Only once the vault holds each secret, read back, does the state
        // file lose its plain text. When this save fails, the plain text
        // stays on disk and the next launch moves it again.
        try {
          await this.writeState(state);
          unit?.set({ vault_migration: { saved: true } });
          await this.removeSealedEntries(migration);
        } catch {
          unit?.set({ vault_migration: { saved: false } });
          this.cache = state;
        }
      }
      this.cache ??= state;
      return this.cache;
    } catch (error) {
      if (unit?.outcome === undefined) unit?.fail(withoutContent(error));
      throw error;
    } finally {
      unit?.end();
    }
  }

  /**
   * Saves the state whole or not at all (`atomic-file.ts`). Only once the
   * file holds the new state does this storage read it from memory.
   */
  private async writeState(state: AppApiState) {
    await writeFileAtomically(
      this.statePath,
      `${JSON.stringify(state, null, 2)}\n`,
    );
    this.cache = state;
  }

  /**
   * The installed plugins' manifests for the vault step, or undefined when
   * they can't be listed: the step then moves nothing rather than take a
   * plugin it can't list for a missing one.
   */
  private async manifestsForMigration(): Promise<
    ReadonlyMap<string, SecretManifest> | undefined
  > {
    if (!this.listManifests) return undefined;
    try {
      const manifests = await this.listManifests();
      return new Map(manifests.map((manifest) => [manifest.id, manifest]));
    } catch {
      return undefined;
    }
  }

  /**
   * Runs `mutator` on the current state and saves what it returns, one
   * mutation at a time. `afterWrite` runs once the state is saved, for vault
   * entries the old state still needed.
   */
  private mutate<T>(
    mutator: (
      state: AppApiState,
    ) => Promise<MutationResult<T>> | MutationResult<T>,
  ): Promise<T> {
    const operation = this.mutationQueue.then(async () => {
      const current = await this.readState();
      const { nextState, result, afterWrite } = await mutator(current);
      await this.writeState(nextState);
      await afterWrite?.();
      return result;
    });

    this.mutationQueue = operation.catch(() => undefined);
    return operation;
  }
}

export type { StoredConnection };
