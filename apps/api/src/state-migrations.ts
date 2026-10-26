/**
 * The state file's versions and the numbered steps between them. A file
 * loads by running, in order, every step above the version it was written
 * in, then the current version's normalization in `storage.ts`, which drops
 * malformed records and fills fields added without a new version.
 *
 * To add version N: append `{ version: N, migrate }`, taking the state as
 * version N - 1 left it and returning it as version N expects it, then
 * update `AppApiState` in `storage.ts`. `STATE_VERSION` follows the last
 * step. A step never runs twice on a file: once saved, the file carries
 * the version it reached.
 *
 * A step may be asynchronous and use the load's context, such as the vault
 * and the plugins' manifests. Such a step may also fail partway, as when
 * the vault can't encrypt: it then returns `holdVersion(state)`, the state
 * with whatever it did, and the file stays at the version before it, so the
 * step runs again at the next load. The steps after it wait until it
 * completes, since they may count on it.
 */

import { randomUUID } from "node:crypto";
import type {
  BacklogImportCandidate,
  PluginFieldValues,
} from "../../../packages/shared/plugins.ts";
import { toVersion8, type VaultStepContext } from "./vault-migration.ts";

/** A state file's JSON root, whatever its version. */
export type StoredStateRecord = Record<string, unknown>;

/**
 * What a load gives its steps: the vault, the installed plugins' manifests
 * and where the vault step reports what it did.
 */
export type StateMigrationContext = VaultStepContext;

/** A step that did what it could: the file keeps the version before it. */
class HeldStateMigration {
  readonly state: StoredStateRecord;

  constructor(state: StoredStateRecord) {
    this.state = state;
  }
}

export function holdVersion(state: StoredStateRecord): HeldStateMigration {
  return new HeldStateMigration(state);
}

type StepResult = StoredStateRecord | HeldStateMigration;

export interface StateMigration {
  /** The version the step produces, from the one the step before produced. */
  readonly version: number;
  migrate(
    state: StoredStateRecord,
    context: StateMigrationContext,
  ): StepResult | Promise<StepResult>;
}

/** Version 1: one Azure DevOps connection and its inbox. */
interface StateV1 {
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

/** Version 2: several Azure DevOps connections, and staged imports. */
interface StateV2 {
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
  dismissedImportKeys?: string[];
  seenImportKeys?: string[];
  connectorBacklogStatuses?: unknown[];
}

const LEGACY_CONNECTION_ID = "legacy_azure_devops";
const LEGACY_TENANT_LABEL = "Legacy tenant";

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

/** Version 2 keeps several Azure DevOps connections, and the inbox becomes staged imports. */
function toVersion2(raw: StoredStateRecord): StoredStateRecord {
  const state = raw as StateV1;
  const legacy = state.connectors?.azureDevOps;
  const connections: NonNullable<
    NonNullable<StateV2["connectors"]>["azureDevOpsConnections"]
  > = legacy
    ? [
        {
          id: LEGACY_CONNECTION_ID,
          label: legacy.project,
          tenantLabel: LEGACY_TENANT_LABEL,
          organizationUrl: legacy.organizationUrl,
          project: legacy.project,
          personalAccessToken: legacy.personalAccessToken,
          queryScope: legacy.queryScope,
          autoSync: false,
          autoSyncIntervalMinutes: 15,
          connectedAt: legacy.connectedAt ?? Date.now(),
          lastSyncAt: legacy.lastSyncAt,
          lastError: legacy.lastError,
        },
      ]
    : [];
  const stagedImports = (state.backlogInbox ?? [])
    .filter((item): item is NonNullable<StateV1["backlogInbox"]>[number] =>
      Boolean(item?.source && item.sourceId && item.title),
    )
    .map(
      (item) =>
        ({
          id: item.id ?? `connector_${randomUUID()}`,
          source: "azure_devops",
          connectionId: LEGACY_CONNECTION_ID,
          connectionLabel: legacy?.project ?? "Legacy Azure DevOps",
          tenantLabel: LEGACY_TENANT_LABEL,
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
    version: 2,
    connectors: { azureDevOpsConnections: connections },
    stagedImports,
  } satisfies StateV2;
}

/**
 * Version 5 keeps connections of any plugin, each with the plugin's config.
 * Versions 3 and 4 left no file this one reads differently from version 2.
 */
function toVersion5(raw: StoredStateRecord): StoredStateRecord {
  const state = raw as Partial<StateV2>;
  const connections = (state.connectors?.azureDevOpsConnections ?? []).map(
    (connection) => ({
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
        priorityFieldResolvedReferenceName:
          connection.priorityFieldResolvedReferenceName,
        priorityFieldType: connection.priorityFieldType,
        priorityFieldIsQueryable: connection.priorityFieldIsQueryable,
      }),
      connectedAt: connection.connectedAt,
      lastSyncAt: connection.lastSyncAt,
      lastError: connection.lastError,
    }),
  );
  return {
    version: 5,
    connections,
    stagedImports: state.stagedImports ?? [],
    dismissedImportKeys: state.dismissedImportKeys ?? [],
    connectorBacklogStatuses: state.connectorBacklogStatuses ?? [],
  };
}

/** Version 6 lets the user deactivate a plugin; none is at first. */
function toVersion6(state: StoredStateRecord): StoredStateRecord {
  return { ...state, disabledPluginIds: state.disabledPluginIds ?? [] };
}

/** Version 7 lets the user turn the whole plugin system off; it starts on. */
function toVersion7(state: StoredStateRecord): StoredStateRecord {
  return { ...state, pluginsEnabled: state.pluginsEnabled ?? true };
}

/**
 * Version 9 gives every connection its access choices (#395): reading
 * only, whatever its token allows. Editing work items, pull requests and
 * people search wait until the user turns them on, so the first sync after
 * the migration sends no change. Settings and local values stay as they are.
 */
function toVersion9(state: StoredStateRecord): StoredStateRecord {
  if (!Array.isArray(state.connections)) return state;
  return {
    ...state,
    connections: state.connections.map((connection: unknown) =>
      typeof connection === "object" && connection !== null
        ? {
            ...connection,
            // Version 8 may be held while the user changes a connection's
            // access: a choice already saved stays.
            access: Array.isArray((connection as { access?: unknown }).access)
              ? (connection as { access: unknown[] }).access
              : [],
          }
        : connection,
    ),
  };
}

/** Every step, in order. The last one's version is the current one. */
export const STATE_MIGRATIONS: readonly StateMigration[] = [
  { version: 2, migrate: toVersion2 },
  { version: 5, migrate: toVersion5 },
  { version: 6, migrate: toVersion6 },
  { version: 7, migrate: toVersion7 },
  // Secrets move into the vault (#388). Held until every one has moved.
  {
    version: 8,
    migrate: async (state, context) => {
      const { state: next, complete } = await toVersion8(state, context);
      return complete ? next : holdVersion(next);
    },
  },
  // Connections read only until the user allows more (#395).
  { version: 9, migrate: toVersion9 },
];

/** The version this build writes. */
export const STATE_VERSION = STATE_MIGRATIONS.at(-1)!.version;

/**
 * The version a file was written in. From version 5, the one it names. Files
 * before it don't reliably name theirs, so their shape tells it: staged
 * imports or a version 2 mean version 2, anything else version 1. A file
 * that names a later version than this build knows keeps that number, and
 * no step runs for it.
 */
export function storedStateVersion(raw: StoredStateRecord): number {
  const version =
    typeof raw.version === "number" && Number.isInteger(raw.version)
      ? raw.version
      : undefined;
  if (Array.isArray(raw.connections)) {
    return version !== undefined && version >= 5 ? version : 5;
  }
  if ("stagedImports" in raw || version === 2) return 2;
  return 1;
}

/**
 * The state after every step above `fromVersion`, in order, stamped with
 * the version the last step reached. A file of a later version than the
 * last step's is stamped with the last step's. A step that holds the
 * version stops the run there, and the state is stamped with the version
 * before it.
 */
export async function runStateMigrations(
  raw: StoredStateRecord,
  fromVersion: number,
  steps: readonly StateMigration[] = STATE_MIGRATIONS,
  context: StateMigrationContext = {},
): Promise<StoredStateRecord> {
  let state = raw;
  let reached = fromVersion;
  for (const step of steps) {
    if (step.version <= fromVersion) continue;
    const result = await step.migrate(state, context);
    if (result instanceof HeldStateMigration) {
      return { ...result.state, version: reached };
    }
    state = { ...result, version: step.version };
    reached = step.version;
  }
  const current = steps.at(-1)?.version;
  return current === undefined ? state : { ...state, version: current };
}
