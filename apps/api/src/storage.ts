import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  normalizeConnectorStatusKey,
  type ConnectorBacklogStatus,
  type ConnectorBacklogStatusInput,
  type ConnectorConnectionSummary,
  type ConnectorFieldValues,
  type ConnectorImportCandidate,
  type ConnectorImportCandidateInput,
  type ConnectorPluginManifest,
  type ConnectorsOverview,
  type ConnectorSummaryValues,
} from "../../../packages/shared/src/connectors.ts";

interface StoredConnection {
  id: string;
  pluginId: string;
  label: string;
  tenantLabel: string;
  autoSync: boolean;
  autoSyncIntervalMinutes: number;
  config: ConnectorFieldValues;
  configSummary: ConnectorSummaryValues;
  connectedAt: number;
  lastSyncAt?: number;
  lastError?: string;
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
  stagedImports?: ConnectorImportCandidate[];
  seenImportKeys?: string[];
}

interface AppApiStateV7 {
  version: 7;
  connections: StoredConnection[];
  stagedImports: ConnectorImportCandidate[];
  dismissedImportKeys: string[];
  connectorBacklogStatuses: ConnectorBacklogStatus[];
  disabledPluginIds: string[];
  pluginsEnabled: boolean;
}

type AppApiState = AppApiStateV7;

interface StageImportItemsResult {
  queuedCount: number;
  updatedCount: number;
  skippedCount: number;
}

const MISSING_PLUGIN_ICON_SVG =
  "<svg viewBox='0 0 16 16' xmlns='http://www.w3.org/2000/svg'><rect width='16' height='16' rx='3' fill='currentColor' opacity='0.18'/><path d='M5 5h6v6H5z' fill='currentColor'/></svg>";

function importKey(item: Pick<ConnectorImportCandidateInput, "source" | "connectionId" | "sourceId">) {
  return `${item.source}:${item.connectionId}:${item.sourceId}`;
}

function createDefaultState(): AppApiState {
  return {
    version: 7,
    connections: [],
    stagedImports: [],
    dismissedImportKeys: [],
    connectorBacklogStatuses: [],
    disabledPluginIds: [],
    pluginsEnabled: true,
  };
}

function compareConnections(left: StoredConnection, right: StoredConnection) {
  return (
    left.pluginId.localeCompare(right.pluginId) ||
    left.tenantLabel.localeCompare(right.tenantLabel) ||
    left.label.localeCompare(right.label)
  );
}

function compareImports(left: ConnectorImportCandidate, right: ConnectorImportCandidate) {
  if (left.connectionId !== right.connectionId) {
    return left.connectionId.localeCompare(right.connectionId);
  }

  if (left.depth !== right.depth) {
    return left.depth - right.depth;
  }

  if (left.parentSourceId !== right.parentSourceId) {
    return (left.parentSourceId ?? "").localeCompare(right.parentSourceId ?? "");
  }

  return right.pushedAt - left.pushedAt || left.title.localeCompare(right.title);
}

function compareBacklogStatuses(left: ConnectorBacklogStatus, right: ConnectorBacklogStatus) {
  if (left.tenantLabel !== right.tenantLabel) {
    return left.tenantLabel.localeCompare(right.tenantLabel);
  }

  if (left.connectionLabel !== right.connectionLabel) {
    return left.connectionLabel.localeCompare(right.connectionLabel);
  }

  return left.label.localeCompare(right.label);
}

function comparePluginManifests(left: ConnectorPluginManifest, right: ConnectorPluginManifest) {
  return left.displayName.localeCompare(right.displayName) || left.id.localeCompare(right.id);
}

function normalizeOrganizationUrl(value: string) {
  return value.replace(/\/+$/, "");
}

function compactFieldValues(values: Record<string, string | number | boolean | undefined>): ConnectorFieldValues {
  return Object.fromEntries(
    Object.entries(values).filter((entry): entry is [string, string | number | boolean] => entry[1] !== undefined),
  );
}

function createMissingPluginManifest(pluginId: string): ConnectorPluginManifest {
  return {
    id: pluginId,
    version: "0.0.0",
    apiVersion: 1,
    displayName: pluginId,
    description: "Plugin unavailable.",
    iconSvg: MISSING_PLUGIN_ICON_SVG,
    entrypoint: "",
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

function toEditableValues(connection: StoredConnection, plugin: ConnectorPluginManifest): ConnectorFieldValues {
  const editableValues: ConnectorFieldValues = {
    label: connection.label,
    tenantLabel: connection.tenantLabel,
    autoSync: connection.autoSync,
    autoSyncIntervalMinutes: connection.autoSyncIntervalMinutes,
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

  return editableValues;
}

function buildConnectionSummary(
  state: AppApiState,
  connection: StoredConnection,
  plugin: ConnectorPluginManifest,
): ConnectorConnectionSummary {
  const connectionItems = state.stagedImports.filter((item) => item.connectionId === connection.id);

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
          organizationUrl: normalizeOrganizationUrl(raw.connectors.azureDevOps.organizationUrl),
          project: raw.connectors.azureDevOps.project,
          personalAccessToken: raw.connectors.azureDevOps.personalAccessToken,
          queryScope: raw.connectors.azureDevOps.queryScope,
        }),
        configSummary: compactFieldValues({
          organizationUrl: normalizeOrganizationUrl(raw.connectors.azureDevOps.organizationUrl),
          queryScope: raw.connectors.azureDevOps.queryScope,
        }),
        connectedAt: raw.connectors.azureDevOps.connectedAt ?? Date.now(),
        lastSyncAt: raw.connectors.azureDevOps.lastSyncAt,
        lastError: raw.connectors.azureDevOps.lastError,
      } satisfies StoredConnection)
    : undefined;

  const stagedImports = (raw.backlogInbox ?? [])
    .filter((item): item is NonNullable<AppApiStateV1["backlogInbox"]>[number] =>
      Boolean(item?.source && item.sourceId && item.title),
    )
    .map((item) => ({
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
    } satisfies ConnectorImportCandidate));

  return {
    ...defaults,
    connections: legacyConnection ? [legacyConnection] : [],
    stagedImports,
  };
}

function normalizeState(raw: Partial<AppApiState | AppApiStateV1 | AppApiStateV2> | undefined): AppApiState {
  if (!raw) {
    return createDefaultState();
  }

  if ("connections" in raw && Array.isArray(raw.connections)) {
    const defaults = createDefaultState();

    return {
      version: 7,
      connections: raw.connections
        .filter(
          (connection): connection is StoredConnection =>
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
        .sort(compareConnections),
      stagedImports: (raw.stagedImports ?? defaults.stagedImports)
        .filter(
          (item): item is ConnectorImportCandidate =>
            Boolean(item?.id && item.source && item.connectionId && item.sourceId && item.title),
        )
        .map((item) => ({
          ...item,
          selected: item.selectable ? item.selected : false,
        }))
        .sort(compareImports),
      dismissedImportKeys: Array.from(
        new Set((raw.dismissedImportKeys as string[] | undefined) ?? defaults.dismissedImportKeys),
      ),
      connectorBacklogStatuses: ((raw as AppApiState).connectorBacklogStatuses ?? defaults.connectorBacklogStatuses)
        .filter(
          (status): status is ConnectorBacklogStatus =>
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
            : defaults.disabledPluginIds)
            .filter((pluginId): pluginId is string =>
              typeof pluginId === "string" && pluginId.trim().length > 0,
            )
            .map((pluginId) => pluginId.trim()),
        ),
      ).sort(),
      pluginsEnabled:
        typeof (raw as Partial<AppApiState>).pluginsEnabled === "boolean"
          ? (raw as Partial<AppApiState>).pluginsEnabled!
          : defaults.pluginsEnabled,
    };
  }

  if ("stagedImports" in raw || raw.version === 2) {
    const defaults = createDefaultState();
    const legacyConnections =
      (((raw as AppApiStateV2).connectors?.azureDevOpsConnections ?? []).map((connection) => ({
        id: connection.id,
        pluginId: "azure_devops",
        label: connection.label,
        tenantLabel: connection.tenantLabel,
        autoSync: connection.autoSync ?? false,
        autoSyncIntervalMinutes: connection.autoSyncIntervalMinutes ?? 15,
        config: compactFieldValues({
          organizationUrl: normalizeOrganizationUrl(connection.organizationUrl),
          project: connection.project,
          personalAccessToken: connection.personalAccessToken,
          queryScope: connection.queryScope,
          priorityFieldName: connection.priorityFieldName,
        }),
        configSummary: compactFieldValues({
          organizationUrl: normalizeOrganizationUrl(connection.organizationUrl),
          queryScope: connection.queryScope,
          priorityFieldName: connection.priorityFieldName,
          priorityFieldResolvedName: connection.priorityFieldResolvedName,
          priorityFieldResolvedReferenceName: connection.priorityFieldResolvedReferenceName,
          priorityFieldType: connection.priorityFieldType,
          priorityFieldIsQueryable: connection.priorityFieldIsQueryable,
        }),
        connectedAt: connection.connectedAt,
        lastSyncAt: connection.lastSyncAt,
        lastError: connection.lastError,
      })) ?? defaults.connections);

    return {
      version: 7,
      connections: legacyConnections.sort(compareConnections),
      stagedImports: (raw.stagedImports ?? defaults.stagedImports)
        .filter(
          (item): item is ConnectorImportCandidate =>
            Boolean(item?.id && item.source && item.connectionId && item.sourceId && item.title),
        )
        .map((item) => ({
          ...item,
          selected: item.selectable ? item.selected : false,
        }))
        .sort(compareImports),
      dismissedImportKeys: Array.from(
        new Set(
          "dismissedImportKeys" in raw
            ? ((raw.dismissedImportKeys as string[] | undefined) ?? defaults.dismissedImportKeys)
            : defaults.dismissedImportKeys,
        ),
      ),
      connectorBacklogStatuses: ((raw as AppApiState).connectorBacklogStatuses ?? defaults.connectorBacklogStatuses)
        .filter(
          (status): status is ConnectorBacklogStatus =>
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
      pluginsEnabled: defaults.pluginsEnabled,
    };
  }

  return migrateLegacyState(raw as AppApiStateV1);
}

export class AppApiStorage {
  private readonly statePath: string;
  private cache?: AppApiState;
  private mutationQueue: Promise<unknown> = Promise.resolve();

  constructor(statePath = process.env.TIMETRACKER_APP_API_STATE_PATH) {
    this.statePath =
      statePath && statePath.trim().length > 0
        ? statePath
        : path.join(os.homedir(), ".timetracker", "app-api-state.json");
  }

  async getConnectorsOverview(plugins: ConnectorPluginManifest[]): Promise<ConnectorsOverview> {
    const state = await this.readState();
    const pluginMap = new Map(plugins.map((plugin) => [plugin.id, plugin] as const));

    for (const connection of state.connections) {
      if (!pluginMap.has(connection.pluginId)) {
        pluginMap.set(connection.pluginId, createMissingPluginManifest(connection.pluginId));
      }
    }

    const allPlugins = Array.from(pluginMap.values()).sort(comparePluginManifests);
    const connectionGroups = allPlugins.map((plugin) => ({
      plugin,
      enabled:
        state.pluginsEnabled &&
        plugin.entrypoint.length > 0 &&
        !state.disabledPluginIds.includes(plugin.id),
      connections: state.connections
        .filter((connection) => connection.pluginId === plugin.id)
        .map((connection) => buildConnectionSummary(state, connection, plugin)),
    }));

    return {
      pluginsEnabled: state.pluginsEnabled,
      plugins: allPlugins,
      connectionGroups,
      totalPendingImportCount: connectionGroups.reduce(
        (sum, group) => sum + group.connections.reduce((groupSum, connection) => groupSum + connection.pendingImportCount, 0),
        0,
      ),
      totalSelectedImportCount: connectionGroups.reduce(
        (sum, group) => sum + group.connections.reduce((groupSum, connection) => groupSum + connection.selectedImportCount, 0),
        0,
      ),
    };
  }

  async isConnectorPluginEnabled(
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

  async getPluginSystemEnabled(): Promise<boolean> {
    return (await this.readState()).pluginsEnabled;
  }

  async setPluginSystemEnabled(enabled: boolean): Promise<void> {
    await this.mutate(async (state) => ({
      nextState: { ...state, pluginsEnabled: enabled },
      result: undefined,
    }));
  }

  async setConnectorPluginEnabled(
    pluginId: string,
    enabled: boolean,
  ): Promise<void> {
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

  async removeConnectorPluginData(pluginId: string): Promise<void> {
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
      },
      result: undefined,
    }));
  }

  async listConnectorBacklogStatuses() {
    const state = await this.readState();
    return {
      items: state.connectorBacklogStatuses,
    };
  }

  async listConnections(pluginId?: string): Promise<StoredConnection[]> {
    const state = await this.readState();
    return pluginId ? state.connections.filter((connection) => connection.pluginId === pluginId) : state.connections;
  }

  async getConnection(pluginId: string, connectionId: string): Promise<StoredConnection | null> {
    const state = await this.readState();
    return (
      state.connections.find(
        (connection) => connection.pluginId === pluginId && connection.id === connectionId,
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
      config: ConnectorFieldValues;
      configSummary: ConnectorSummaryValues;
    },
  ): Promise<StoredConnection> {
    return this.mutate(async (state) => {
      const connectionId = input.id ?? `${pluginId}_${randomUUID()}`;
      const existing = state.connections.find(
        (connection) => connection.pluginId === pluginId && connection.id === connectionId,
      );

      const nextConnection: StoredConnection = {
        id: connectionId,
        pluginId,
        label: input.label,
        tenantLabel: input.tenantLabel,
        autoSync: input.autoSync,
        autoSyncIntervalMinutes: input.autoSyncIntervalMinutes,
        config: input.config,
        configSummary: input.configSummary,
        connectedAt: existing?.connectedAt ?? Date.now(),
        lastSyncAt: existing?.lastSyncAt,
        lastError: undefined,
      };

      const nextState: AppApiState = {
        ...state,
        connections: [
          ...state.connections.filter(
            (connection) => !(connection.pluginId === pluginId && connection.id === connectionId),
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

  async deleteConnection(pluginId: string, connectionId: string): Promise<boolean> {
    return this.mutate(async (state) => {
      const exists = state.connections.some(
        (connection) => connection.pluginId === pluginId && connection.id === connectionId,
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
          (connection) => !(connection.pluginId === pluginId && connection.id === connectionId),
        ),
        stagedImports: state.stagedImports.filter((item) => item.connectionId !== connectionId),
        connectorBacklogStatuses: state.connectorBacklogStatuses.filter(
          (status) => !(status.source === pluginId && status.connectionId === connectionId),
        ),
      };

      return {
        nextState,
        result: true,
      };
    });
  }

  async upsertConnectorBacklogStatuses(
    inputs: ConnectorBacklogStatusInput[],
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
        const key = normalizeConnectorStatusKey(label);
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
        } satisfies ConnectorBacklogStatus;

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

  async recordConnectionSyncSuccess(pluginId: string, connectionId: string, timestamp: number): Promise<StoredConnection> {
    return this.mutate(async (state) => {
      const connection = state.connections.find(
        (candidate) => candidate.pluginId === pluginId && candidate.id === connectionId,
      );
      if (!connection) {
        throw new Error(`Connector connection "${connectionId}" not found.`);
      }

      const nextConnection = {
        ...connection,
        lastSyncAt: timestamp,
        lastError: undefined,
      };
      const nextState = this.replaceConnection(state, nextConnection);

      return {
        nextState,
        result: nextConnection,
      };
    });
  }

  async recordConnectionError(pluginId: string, connectionId: string, message: string): Promise<StoredConnection> {
    return this.mutate(async (state) => {
      const connection = state.connections.find(
        (candidate) => candidate.pluginId === pluginId && candidate.id === connectionId,
      );
      if (!connection) {
        throw new Error(`Connector connection "${connectionId}" not found.`);
      }

      const nextConnection = {
        ...connection,
        lastError: message,
      };
      const nextState = this.replaceConnection(state, nextConnection);

      return {
        nextState,
        result: nextConnection,
      };
    });
  }

  async stageImportItems(items: ConnectorImportCandidateInput[]): Promise<StageImportItemsResult> {
    return this.mutate(async (state) => {
      const dismissedKeys = new Set(state.dismissedImportKeys);
      const stagedByKey = new Map(state.stagedImports.map((item) => [importKey(item), item] as const));

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
          selected: item.selectable ? item.selected ?? true : false,
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

  async dismissImports(ids: string[]): Promise<number> {
    return this.mutate(async (state) => {
      const idSet = new Set(ids);
      const itemsById = new Map(state.stagedImports.map((item) => [item.id, item] as const));
      const childrenByParentSourceId = new Map<string, ConnectorImportCandidate[]>();

      for (const item of state.stagedImports) {
        if (!item.parentSourceId) {
          continue;
        }

        const siblings = childrenByParentSourceId.get(item.parentSourceId) ?? [];
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
          result: 0,
        };
      }

      const dismissedImportKeys = new Set(state.dismissedImportKeys);
      for (const item of state.stagedImports) {
        if (dismissedIds.has(item.id)) {
          dismissedImportKeys.add(importKey(item));
        }
      }

      return {
        nextState: {
          ...state,
          stagedImports: state.stagedImports.filter((item) => !dismissedIds.has(item.id)),
          dismissedImportKeys: Array.from(dismissedImportKeys),
        },
        result: dismissedIds.size,
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

  async updateImportSelection(ids: string[], selected: boolean): Promise<number> {
    return this.mutate(async (state) => {
      const idSet = new Set(ids);
      let updatedCount = 0;

      const nextItems = state.stagedImports.map((item) => {
        if (!idSet.has(item.id) || !item.selectable || item.selected === selected) {
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

  async commitSelectedImports(): Promise<ConnectorImportCandidate[]> {
    return this.mutate(async (state) => {
      const selectedItems = state.stagedImports.filter((item) => item.selectable && item.selected);
      if (selectedItems.length === 0) {
        return {
          nextState: state,
          result: [],
        };
      }

      const stagedByParentKey = new Map(
        state.stagedImports.map((item) => [`${item.connectionId}:${item.sourceId}`, item] as const),
      );
      const committedIds = new Set(selectedItems.map((item) => item.id));

      for (const item of selectedItems) {
        if (item.depth !== 1 || !item.parentSourceId) {
          continue;
        }

        const parent = stagedByParentKey.get(`${item.connectionId}:${item.parentSourceId}`);
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
          stagedImports: state.stagedImports.filter((item) => !committedIds.has(item.id)),
        },
        result: committedItems,
      };
    });
  }

  private replaceConnection(state: AppApiState, connection: StoredConnection): AppApiState {
    return {
      ...state,
      connections: [
        ...state.connections.filter(
          (candidate) => !(candidate.pluginId === connection.pluginId && candidate.id === connection.id),
        ),
        connection,
      ].sort(compareConnections),
    };
  }

  private async readState(): Promise<AppApiState> {
    if (this.cache) {
      return this.cache;
    }

    if (!existsSync(this.statePath)) {
      this.cache = createDefaultState();
      return this.cache;
    }

    const raw = await readFile(this.statePath, "utf8");
    this.cache = normalizeState(JSON.parse(raw) as Partial<AppApiState | AppApiStateV1 | AppApiStateV2>);
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
