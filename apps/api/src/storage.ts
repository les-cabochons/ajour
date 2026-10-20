import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  pluginFieldValuesSchema,
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
  type SwitchableCapability,
} from "../../../packages/shared/plugins.ts";
import type { McpSettings } from "../../../packages/shared/agent-tools.ts";
import {
  agentRunnerSettingsSchema,
  type AgentRunnerSettings,
} from "../../../packages/shared/agent-runs.ts";

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
  config: PluginFieldValues;
  configSummary: PluginSummaryValues;
  connectedAt: number;
  lastSyncAt?: number;
  lastError?: string;
  /** When the sync that set `lastError` failed. */
  lastErrorAt?: number;
}

interface AppApiStateV1 {
  version?: 1;
  connectors?: {
    azureDevOps?: {
      organizationUrl: string;
      project: string;
      personalAccessToken: string;
      queryScope: string;
      connectedAt: number;
      lastSyncAt?: number;
      lastError?: string;
    };
  };
  backlogInbox?: Array<{
    id?: string;
    source?: "azure_devops";
    sourceId?: string;
    sourceUrl?: string;
    title?: string;
    note?: string;
    pushedAt?: number;
  }>;
  seenBacklogKeys?: string[];
}

interface AppApiStateV2 {
  version: 2;
  connectors?: {
    azureDevOpsConnections?: Array<{
      id: string;
      label: string;
      tenantLabel: string;
      organizationUrl: string;
      project?: string;
      personalAccessToken: string;
      queryScope: string;
      priorityFieldName?: string;
      priorityFieldResolvedName?: string;
      priorityFieldResolvedReferenceName?: string;
      priorityFieldType?: string;
      priorityFieldIsQueryable?: boolean;
      autoSync?: boolean;
      autoSyncIntervalMinutes?: number;
      connectedAt: number;
      lastSyncAt?: number;
      lastError?: string;
    }>;
  };
  stagedImports?: BacklogImportCandidate[];
  seenImportKeys?: string[];
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
    clients: (Array.isArray(value.clients) ? value.clients : []).filter(
      (client): client is StoredMcpClient =>
        typeof client?.id === "string" &&
        typeof client.name === "string" &&
        typeof client.tokenHash === "string" &&
        typeof client.createdAt === "number",
    ),
  };
}

interface StoredAgentRunnerState {
  settings: AgentRunnerSettings;
  /** Agent task setting values by plugin ID, shared by the plugin's tasks. */
  pluginValues: Record<string, PluginFieldValues>;
}

function defaultAgentRunnerSettings(): AgentRunnerSettings {
  return { cli: null, browserMode: "ajour-chrome", model: "" };
}

/** Keys that would reach Object.prototype if a stored name were used as a key. */
const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/**
 * Copies `values` into a map without a prototype and without the unsafe
 * keys, so a stored key can never write to Object.prototype.
 */
function safeValues(values: PluginFieldValues): PluginFieldValues {
  const copy: PluginFieldValues = Object.create(null);
  for (const [key, value] of Object.entries(values)) {
    if (!UNSAFE_KEYS.has(key)) copy[key] = value;
  }
  return copy;
}

function normalizeAgentRunnerState(raw: unknown): StoredAgentRunnerState {
  const record =
    typeof raw === "object" && raw !== null
      ? (raw as Record<string, unknown>)
      : {};
  const settings = agentRunnerSettingsSchema.safeParse(record.settings);
  const pluginValues: StoredAgentRunnerState["pluginValues"] =
    Object.create(null);
  const merge = (pluginId: string, values: unknown) => {
    if (UNSAFE_KEYS.has(pluginId)) return;
    const parsed = pluginFieldValuesSchema.safeParse(values);
    if (!parsed.success) return;
    const merged = (pluginValues[pluginId] ??= Object.create(null));
    for (const [key, value] of Object.entries(safeValues(parsed.data))) {
      if (merged[key] === undefined || merged[key] === "") merged[key] = value;
    }
  };
  if (typeof record.pluginValues === "object" && record.pluginValues !== null) {
    for (const [pluginId, values] of Object.entries(record.pluginValues)) {
      merge(pluginId, values);
    }
  }
  // Before a plugin's tasks shared their settings, each task kept its own
  // values. The first non-empty value of each setting wins.
  if (typeof record.taskValues === "object" && record.taskValues !== null) {
    for (const [pluginId, tasks] of Object.entries(record.taskValues)) {
      if (typeof tasks !== "object" || tasks === null) continue;
      for (const [taskId, values] of Object.entries(tasks)) {
        if (!UNSAFE_KEYS.has(taskId)) merge(pluginId, values);
      }
    }
  }
  return {
    settings: settings.success ? settings.data : defaultAgentRunnerSettings(),
    pluginValues,
  };
}

interface AppApiStateV7 {
  version: 7;
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

type AppApiState = AppApiStateV7;

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
    version: 7,
    connections: [],
    stagedImports: [],
    dismissedImportKeys: [],
    connectorBacklogStatuses: [],
    disabledPluginIds: [],
    disabledCapabilities: {},
    pluginsEnabled: true,
    mcp: { enabled: false, clients: [] },
    agentRunner: { settings: defaultAgentRunnerSettings(), pluginValues: {} },
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

function normalizeOrganizationUrl(value: string) {
  return value.replace(/\/+$/, "");
}

function compactFieldValues(
  values: Record<string, string | number | boolean | undefined>,
): PluginFieldValues {
  return Object.fromEntries(
    Object.entries(values).filter(
      (entry): entry is [string, string | number | boolean] =>
        entry[1] !== undefined,
    ),
  );
}

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
  };

  for (const field of plugin.connectionFields) {
    if (field.secret) {
      continue;
    }

    const value = connection.config[field.id];
    if (value !== undefined) {
      editableValues[field.id] = value;
    }
  }
  // Ajour's own setting, set last so no plugin field or config can stand in.
  if (plugin.capabilities.connector?.comments) {
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

function buildConnectionSummary(
  state: AppApiState,
  connection: StoredConnection,
  plugin: PluginManifest,
): PluginConnectionSummary {
  const connectionItems = state.stagedImports.filter(
    (item) => item.connectionId === connection.id,
  );

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
    lastError: connection.lastError,
    lastErrorAt: connection.lastErrorAt,
    pendingImportCount: connectionItems.length,
    selectedImportCount: connectionItems.filter((item) => item.selected).length,
    configSummary: connection.configSummary,
    editableValues: toEditableValues(connection, plugin),
  };
}

function migrateLegacyState(raw: AppApiStateV1): AppApiState {
  const defaults = createDefaultState();
  const legacyConnection = raw.connectors?.azureDevOps
    ? ({
        id: "legacy_azure_devops",
        pluginId: "azure_devops",
        label: raw.connectors.azureDevOps.project,
        tenantLabel: "Legacy tenant",
        autoSync: false,
        autoSyncIntervalMinutes: 15,
        config: compactFieldValues({
          organizationUrl: normalizeOrganizationUrl(
            raw.connectors.azureDevOps.organizationUrl,
          ),
          project: raw.connectors.azureDevOps.project,
          personalAccessToken: raw.connectors.azureDevOps.personalAccessToken,
          queryScope: raw.connectors.azureDevOps.queryScope,
        }),
        configSummary: compactFieldValues({
          organizationUrl: normalizeOrganizationUrl(
            raw.connectors.azureDevOps.organizationUrl,
          ),
          queryScope: raw.connectors.azureDevOps.queryScope,
        }),
        connectedAt: raw.connectors.azureDevOps.connectedAt ?? Date.now(),
        lastSyncAt: raw.connectors.azureDevOps.lastSyncAt,
        lastError: raw.connectors.azureDevOps.lastError,
      } satisfies StoredConnection)
    : undefined;

  const stagedImports = (raw.backlogInbox ?? [])
    .filter(
      (item): item is NonNullable<AppApiStateV1["backlogInbox"]>[number] =>
        Boolean(item?.source && item.sourceId && item.title),
    )
    .map(
      (item) =>
        ({
          id: item.id ?? `connector_${randomUUID()}`,
          source: "azure_devops",
          connectionId: legacyConnection?.id ?? "legacy_azure_devops",
          connectionLabel: legacyConnection?.label ?? "Legacy Azure DevOps",
          tenantLabel: legacyConnection?.tenantLabel ?? "Legacy tenant",
          sourceId: item.sourceId!,
          externalId: item.sourceId!.split("/").pop() ?? item.sourceId!,
          sourceUrl: item.sourceUrl,
          title: item.title!,
          note: item.note,
          workItemType: "Task",
          depth: 0,
          selectable: true,
          selected: true,
          childCount: 0,
          pushedAt: item.pushedAt ?? Date.now(),
        }) satisfies BacklogImportCandidate,
    );

  return {
    ...defaults,
    connections: legacyConnection ? [legacyConnection] : [],
    stagedImports,
  };
}

function normalizeState(
  raw: Partial<AppApiState | AppApiStateV1 | AppApiStateV2> | undefined,
): AppApiState {
  if (!raw) {
    return createDefaultState();
  }

  if ("connections" in raw && Array.isArray(raw.connections)) {
    const defaults = createDefaultState();

    return {
      version: 7,
      connections: raw.connections
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
            ...connection
          }) => ({
            ...connection,
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
        (raw as AppApiState).connectorBacklogStatuses ??
        defaults.connectorBacklogStatuses
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
          (Array.isArray((raw as Partial<AppApiState>).disabledPluginIds)
            ? (raw as Partial<AppApiState>).disabledPluginIds!
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
        (raw as Partial<AppApiState>).disabledCapabilities,
      ),
      pluginsEnabled:
        typeof (raw as Partial<AppApiState>).pluginsEnabled === "boolean"
          ? (raw as Partial<AppApiState>).pluginsEnabled!
          : defaults.pluginsEnabled,
      mcp: normalizeMcpState((raw as Partial<AppApiState>).mcp),
      agentRunner: normalizeAgentRunnerState(
        (raw as Partial<AppApiState>).agentRunner,
      ),
    };
  }

  if ("stagedImports" in raw || raw.version === 2) {
    const defaults = createDefaultState();
    const legacyConnections =
      ((raw as AppApiStateV2).connectors?.azureDevOpsConnections ?? []).map(
        (connection) => ({
          id: connection.id,
          pluginId: "azure_devops",
          label: connection.label,
          tenantLabel: connection.tenantLabel,
          autoSync: connection.autoSync ?? false,
          autoSyncIntervalMinutes: connection.autoSyncIntervalMinutes ?? 15,
          config: compactFieldValues({
            organizationUrl: normalizeOrganizationUrl(
              connection.organizationUrl,
            ),
            project: connection.project,
            personalAccessToken: connection.personalAccessToken,
            queryScope: connection.queryScope,
            priorityFieldName: connection.priorityFieldName,
          }),
          configSummary: compactFieldValues({
            organizationUrl: normalizeOrganizationUrl(
              connection.organizationUrl,
            ),
            queryScope: connection.queryScope,
            priorityFieldName: connection.priorityFieldName,
            priorityFieldResolvedName: connection.priorityFieldResolvedName,
            priorityFieldResolvedReferenceName:
              connection.priorityFieldResolvedReferenceName,
            priorityFieldType: connection.priorityFieldType,
            priorityFieldIsQueryable: connection.priorityFieldIsQueryable,
          }),
          connectedAt: connection.connectedAt,
          lastSyncAt: connection.lastSyncAt,
          lastError: connection.lastError,
        }),
      ) ?? defaults.connections;

    return {
      version: 7,
      connections: legacyConnections.sort(compareConnections),
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
          "dismissedImportKeys" in raw
            ? ((raw.dismissedImportKeys as string[] | undefined) ??
                defaults.dismissedImportKeys)
            : defaults.dismissedImportKeys,
        ),
      ),
      connectorBacklogStatuses: (
        (raw as AppApiState).connectorBacklogStatuses ??
        defaults.connectorBacklogStatuses
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
      disabledPluginIds: defaults.disabledPluginIds,
      disabledCapabilities: defaults.disabledCapabilities,
      pluginsEnabled: defaults.pluginsEnabled,
      mcp: { enabled: false, clients: [] },
      agentRunner: { settings: defaultAgentRunnerSettings(), pluginValues: {} },
    };
  }

  return migrateLegacyState(raw as AppApiStateV1);
}

/** The longest last error a connection keeps, as its summary schema allows. */
export const MAX_CONNECTION_ERROR_CHARACTERS = 1_000;

/**
 * Cuts a connection error to the length its summary allows. A plugin result
 * that breaks the contract can give a validation error of many kilobytes, and
 * storing it whole would make the overview fail to load.
 */
export function boundConnectionError(message: string) {
  return message.length <= MAX_CONNECTION_ERROR_CHARACTERS
    ? message
    : `${message.slice(0, MAX_CONNECTION_ERROR_CHARACTERS - 1)}…`;
}

export class AppApiStorage {
  private readonly statePath: string;
  private cache?: AppApiState;
  private mutationQueue: Promise<unknown> = Promise.resolve();
  private loading?: Promise<AppApiState>;
  /**
   * The last Sync review dismissal, for Undo. Only the last one can be undone,
   * and it lives in memory, so it does not survive a restart.
   */
  private lastDismissal?: ImportDismissal;

  constructor(statePath = process.env.AJOUR_APP_API_STATE_PATH) {
    this.statePath =
      statePath && statePath.trim().length > 0
        ? statePath
        : path.join(os.homedir(), ".ajour", "app-api-state.json");
  }

  /** The folder that holds the state file. Agent browser data lives next to it. */
  get dataDirectory(): string {
    return path.dirname(this.statePath);
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

    for (const connection of state.connections) {
      if (!pluginMap.has(connection.pluginId)) {
        pluginMap.set(
          connection.pluginId,
          createMissingPluginManifest(connection.pluginId),
        );
      }
    }

    const allPlugins = Array.from(pluginMap.values()).sort(
      comparePluginManifests,
    );
    const connectionGroups = allPlugins.map((plugin) => ({
      plugin,
      enabled:
        state.pluginsEnabled &&
        plugin.unavailableReason === undefined &&
        !state.disabledPluginIds.includes(plugin.id),
      inactiveCapabilities: (
        state.disabledCapabilities[plugin.id] ?? []
      ).filter((capability) => pluginHasCapability(plugin, capability)),
      connections: state.connections
        .filter((connection) => connection.pluginId === plugin.id)
        .map((connection) => buildConnectionSummary(state, connection, plugin)),
    }));

    return {
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

  /** The agent task settings the user filled in for a plugin, or none. */
  async getAgentTaskValues(pluginId: string): Promise<PluginFieldValues> {
    if (UNSAFE_KEYS.has(pluginId)) return {};
    return (await this.readState()).agentRunner.pluginValues[pluginId] ?? {};
  }

  async setAgentTaskValues(
    pluginId: string,
    values: PluginFieldValues,
  ): Promise<void> {
    if (UNSAFE_KEYS.has(pluginId)) return;
    await this.mutate((state) => {
      const pluginValues: StoredAgentRunnerState["pluginValues"] =
        Object.create(null);
      Object.assign(pluginValues, state.agentRunner.pluginValues);
      pluginValues[pluginId] = safeValues(values);
      return {
        nextState: {
          ...state,
          agentRunner: { ...state.agentRunner, pluginValues },
        },
        result: undefined,
      };
    });
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

  async removePluginData(pluginId: string): Promise<void> {
    await this.mutate(async (state) => ({
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
        },
      },
      result: undefined,
    }));
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
  ): Promise<StoredConnection> {
    return this.mutate(async (state) => {
      const connectionId = input.id ?? `${pluginId}_${randomUUID()}`;
      const existing = state.connections.find(
        (connection) =>
          connection.pluginId === pluginId && connection.id === connectionId,
      );

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
        config: input.config,
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
      };
    });
  }

  /**
   * Deletes a connection with its staged items and statuses. A pending
   * dismissal of its items can no longer be undone, since Undo would bring
   * back items for a connection that is gone.
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

  private async loadState(): Promise<AppApiState> {
    const state = existsSync(this.statePath)
      ? normalizeState(
          JSON.parse(await readFile(this.statePath, "utf8")) as Partial<
            AppApiState | AppApiStateV1 | AppApiStateV2
          >,
        )
      : createDefaultState();
    this.cache ??= state;
    return this.cache;
  }

  private async writeState(state: AppApiState) {
    this.cache = state;
    await mkdir(path.dirname(this.statePath), { recursive: true, mode: 0o700 });
    await writeFile(this.statePath, `${JSON.stringify(state, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await chmod(this.statePath, 0o600);
  }

  private mutate<T>(
    mutator:
      | ((state: AppApiState) => Promise<{ nextState: AppApiState; result: T }>)
      | ((state: AppApiState) => { nextState: AppApiState; result: T }),
  ): Promise<T> {
    const operation = this.mutationQueue.then(async () => {
      const current = await this.readState();
      const { nextState, result } = await mutator(current);
      await this.writeState(nextState);
      return result;
    });

    this.mutationQueue = operation.catch(() => undefined);
    return operation;
  }
}

export type { StoredConnection };
