/**
 * Moving secrets from the state file into the vault, for every holder: each
 * connection, whatever its plugin's API or activation, and each plugin's
 * agent task settings. State version 8 runs it at load (see
 * `state-migrations.ts`), and the storage runs it again at runtime for a
 * plugin that comes back or an update that marks a field secret.
 *
 * Each holder moves on its own (`moveHolderToVault`): its values are
 * encrypted, written and read back before the state file leaves them out.
 * A holder that fails keeps its plain text, its connection pauses, and the
 * move is tried again at the next launch. The texts stored beside a moved
 * secret, a connection's last error and summary, are redacted with it, so
 * the overview needs no secret to show them.
 */

import { connectionRedaction } from "./plugin-errors.ts";
import {
  holderNeedsMove,
  holderNeedsSettling,
  moveHolderToVault,
  type SecretHolder,
  type SecretManifest,
} from "./connection-credentials.ts";
import {
  normalizeAgentRunnerState,
  normalizeSecretFields,
  type StoredSecretFields,
} from "./agent-runner-state.ts";
import type { SecretSelection, SecretVault } from "./secret-vault.ts";
import type { PluginFieldValues } from "../../../packages/shared/plugins.ts";

/** What the vault step needs from a load. See `StateMigrationContext`. */
export interface VaultStepContext {
  /** The vault, when the API has one. */
  vault?: SecretVault;
  /**
   * The manifest of every installed plugin, runnable or not, by id.
   * Undefined when the plugins couldn't be listed.
   */
  manifests?: ReadonlyMap<string, SecretManifest>;
  /** Receives what the vault step did, for the load's event. */
  reportVaultMigration?: (report: VaultMigrationReport) => void;
}

type StoredStateRecord = Record<string, unknown>;

/** What one pass of the move did. */
export interface VaultMigrationReport {
  /** Holders whose values moved, or were checked and needed nothing. */
  moved: number;
  /** Holders that still keep a secret in plain text. */
  pending: number;
  /** The holders whose move failed in this pass, by `holderId`. */
  failed: string[];
  /** Sealed entries to delete once the state file is saved. */
  removeAfterSave: SecretSelection[];
}

/** One holder's id, for the set of holders whose move failed this launch. */
export function holderId(pluginId: string, connectionId: string | null) {
  return JSON.stringify([pluginId, connectionId]);
}

/** A connection record as far as the move goes, from any state version 7 on. */
export interface ConnectionSecretsRecord {
  id: string;
  pluginId: string;
  config: PluginFieldValues;
  secrets?: StoredSecretFields;
  lastError?: string;
  configSummary?: Record<string, string | number | boolean>;
}

function isConnectionRecord(value: unknown): value is ConnectionSecretsRecord {
  const record = value as Partial<ConnectionSecretsRecord> | null;
  return (
    typeof record === "object" &&
    record !== null &&
    typeof record.id === "string" &&
    typeof record.pluginId === "string" &&
    typeof record.config === "object" &&
    record.config !== null &&
    !Array.isArray(record.config)
  );
}

interface PassOptions {
  vault?: SecretVault;
  manifests: ReadonlyMap<string, SecretManifest>;
  /** Holders not to try again, as those that failed earlier this launch. */
  skip?: ReadonlySet<string>;
}

function emptyReport(): VaultMigrationReport {
  return { moved: 0, pending: 0, failed: [], removeAfterSave: [] };
}

/**
 * One connection after the move: its config without what moved, its secret
 * fields, and its stored texts redacted. Undefined when nothing changed.
 */
export async function settleConnection<C extends ConnectionSecretsRecord>(
  connection: C,
  options: PassOptions,
  report: VaultMigrationReport,
): Promise<C | undefined> {
  const manifest = options.manifests.get(connection.pluginId);
  const holder: SecretHolder = {
    pluginId: connection.pluginId,
    connectionId: connection.id,
    values: connection.config,
    secrets: normalizeSecretFields(connection.secrets),
  };
  const id = holderId(connection.pluginId, connection.id);
  if (options.skip?.has(id)) {
    if (holderNeedsMove(holder, manifest)) report.pending += 1;
    return undefined;
  }
  if (!holderNeedsSettling(holder, manifest)) return undefined;
  const move = await moveHolderToVault(holder, manifest, options.vault);
  if (move.outcome === "unchanged") return undefined;
  if (move.outcome === "failed") {
    report.failed.push(id);
    report.pending += 1;
    return undefined;
  }
  report.moved += 1;
  if (move.removeAfterSave) report.removeAfterSave.push(move.removeAfterSave);
  const { secrets: _secrets, ...rest } = connection;
  const moved = {
    ...rest,
    config: move.holder.values,
    ...(move.holder.secrets ? { secrets: move.holder.secrets } : {}),
  } as C;
  if (move.secrets.length === 0) return moved;
  const redaction = connectionRedaction(move.secrets);
  return {
    ...moved,
    ...(typeof connection.lastError === "string"
      ? { lastError: redaction.text(connection.lastError) }
      : {}),
    ...(typeof connection.configSummary === "object" &&
    connection.configSummary !== null
      ? { configSummary: redaction.summary(connection.configSummary) }
      : {}),
  };
}

/**
 * A plugin's agent task settings after the move, or undefined when nothing
 * changed. `values` and `secrets` are the plugin's entries in the state.
 */
export async function settleAgentTaskValues(
  pluginId: string,
  values: PluginFieldValues,
  secrets: StoredSecretFields | undefined,
  options: PassOptions,
  report: VaultMigrationReport,
): Promise<
  { values: PluginFieldValues; secrets?: StoredSecretFields } | undefined
> {
  const manifest = options.manifests.get(pluginId);
  const holder: SecretHolder = {
    pluginId,
    connectionId: null,
    values,
    secrets,
  };
  const id = holderId(pluginId, null);
  if (options.skip?.has(id)) {
    if (holderNeedsMove(holder, manifest)) report.pending += 1;
    return undefined;
  }
  if (!holderNeedsSettling(holder, manifest)) return undefined;
  const move = await moveHolderToVault(holder, manifest, options.vault);
  if (move.outcome === "unchanged") return undefined;
  if (move.outcome === "failed") {
    report.failed.push(id);
    report.pending += 1;
    return undefined;
  }
  report.moved += 1;
  if (move.removeAfterSave) report.removeAfterSave.push(move.removeAfterSave);
  return {
    values: move.holder.values,
    ...(move.holder.secrets ? { secrets: move.holder.secrets } : {}),
  };
}

/**
 * Version 8 keeps secrets in the vault. Each connection keeps `secrets`, the
 * fields the vault holds, and the agent runner `pluginSecrets`. The step is
 * complete once no holder keeps a secret in plain text; until then the file
 * stays at version 7 with what moved, and the step runs again at the next
 * load. Without the plugins' manifests nothing moves, since a plugin that
 * can't be listed isn't a missing one.
 */
export async function toVersion8(
  raw: StoredStateRecord,
  context: VaultStepContext,
): Promise<{ state: StoredStateRecord; complete: boolean }> {
  const report = emptyReport();
  const connections = Array.isArray(raw.connections) ? raw.connections : [];
  const agentRunner = normalizeAgentRunnerState(raw.agentRunner);
  const manifests = context.manifests;
  if (!manifests) {
    const unchecked = (holder: SecretHolder) =>
      holder.secrets === undefined && holderNeedsMove(holder, undefined);
    report.pending =
      connections.filter(
        (connection) =>
          isConnectionRecord(connection) &&
          unchecked({
            pluginId: connection.pluginId,
            connectionId: connection.id,
            values: connection.config,
            secrets: normalizeSecretFields(connection.secrets),
          }),
      ).length +
      Object.entries(agentRunner.pluginValues).filter(([pluginId, values]) =>
        unchecked({
          pluginId,
          connectionId: null,
          values,
          secrets: agentRunner.pluginSecrets[pluginId],
        }),
      ).length;
    context.reportVaultMigration?.(report);
    return { state: raw, complete: report.pending === 0 };
  }

  const options: PassOptions = { vault: context.vault, manifests };
  const nextConnections: unknown[] = [];
  for (const connection of connections) {
    nextConnections.push(
      isConnectionRecord(connection)
        ? ((await settleConnection(connection, options, report)) ?? connection)
        : connection,
    );
  }
  const pluginValues: Record<string, PluginFieldValues> = Object.create(null);
  const pluginSecrets: Record<string, StoredSecretFields> = Object.create(null);
  Object.assign(pluginSecrets, agentRunner.pluginSecrets);
  for (const [pluginId, values] of Object.entries(agentRunner.pluginValues)) {
    const settled = await settleAgentTaskValues(
      pluginId,
      values,
      agentRunner.pluginSecrets[pluginId],
      options,
      report,
    );
    pluginValues[pluginId] = settled?.values ?? values;
    if (settled?.secrets) pluginSecrets[pluginId] = settled.secrets;
  }
  context.reportVaultMigration?.(report);
  return {
    state: {
      ...raw,
      connections: nextConnections,
      agentRunner: { ...agentRunner, pluginValues, pluginSecrets },
    },
    complete: report.pending === 0,
  };
}

export { emptyReport as emptyVaultMigrationReport };
