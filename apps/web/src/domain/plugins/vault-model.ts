import {
  agentTaskSettingFields,
  type PluginOverviewGroup,
  type PluginsOverview,
  type VaultStatusSummary,
} from "@ajour/shared";
import {
  describeLastUse,
  describeSecret,
  type SecretState,
} from "./secret-state";

/**
 * Settings > Vault: every secret Ajour holds, grouped by plugin. It never
 * holds a value, only what the overview says about each entry.
 */

export interface VaultRow {
  /** Stable across refreshes. */
  key: string;
  /** The connection's name, or "Agent tasks" for the plugin's task settings. */
  owner: string;
  /** What kind of secret it is: the field's label. */
  kind: string;
  state: SecretState;
  /** "Last used 2 hours ago". */
  lastUsed: string;
  /**
   * Where Replace goes. Absent for the settings of a plugin that is not
   * installed, which only Remove can clear.
   */
  replace?:
    | {
        type: "connection";
        pluginId: string;
        connectionId: string;
        fieldId: string;
      }
    | { type: "agentTask"; pluginId: string; fieldId: string };
}

export interface VaultGroup {
  pluginId: string;
  /** The plugin's name, then "(not installed)" when its package is missing. */
  title: string;
  installed: boolean;
  rows: VaultRow[];
}

const SEALED_KIND = "Saved settings and secrets";
const MISSING_FIELD_KIND = "Saved secret";

function groupRows(group: PluginOverviewGroup, now: number): VaultRow[] {
  const installed = group.missing !== true;
  const { plugin } = group;
  const fieldLabel = (fieldId: string, labels: Map<string, string>) =>
    installed ? (labels.get(fieldId) ?? fieldId) : MISSING_FIELD_KIND;
  const connectionLabels = new Map(
    plugin.connectionFields.map((field) => [field.id, field.label]),
  );
  const taskLabels = new Map(
    agentTaskSettingFields(plugin.capabilities.agentTask?.tasks ?? []).map(
      (field) => [field.id, field.label],
    ),
  );
  const rows: VaultRow[] = [];
  for (const connection of group.connections) {
    for (const secret of connection.secretFields ?? []) {
      rows.push({
        key: `${connection.id}/${secret.id}`,
        owner: connection.label,
        kind: fieldLabel(secret.id, connectionLabels),
        state: describeSecret(secret, now),
        lastUsed: describeLastUse(secret.lastUsedAt, now),
        ...(installed
          ? {
              replace: {
                type: "connection" as const,
                pluginId: plugin.id,
                connectionId: connection.id,
                fieldId: secret.id,
              },
            }
          : {}),
      });
    }
    if (connection.sealedConfig) {
      rows.push({
        key: `${connection.id}/sealed`,
        owner: connection.label,
        kind: SEALED_KIND,
        state: describeSecret(connection.sealedConfig, now),
        lastUsed: describeLastUse(connection.sealedConfig.lastUsedAt, now),
      });
    }
  }
  for (const secret of group.agentTaskSecretFields ?? []) {
    rows.push({
      key: `agent/${secret.id}`,
      owner: "Agent tasks",
      kind: fieldLabel(secret.id, taskLabels),
      state: describeSecret(secret, now),
      lastUsed: describeLastUse(secret.lastUsedAt, now),
      ...(installed
        ? {
            replace: {
              type: "agentTask" as const,
              pluginId: plugin.id,
              fieldId: secret.id,
            },
          }
        : {}),
    });
  }
  if (group.agentTaskSealedConfig) {
    rows.push({
      key: "agent/sealed",
      owner: "Agent tasks",
      kind: SEALED_KIND,
      state: describeSecret(group.agentTaskSealedConfig, now),
      lastUsed: describeLastUse(group.agentTaskSealedConfig.lastUsedAt, now),
    });
  }
  return rows;
}

/**
 * The plugins that hold a secret, by name, and last the plugins whose
 * package is missing, by name too. A plugin that holds none is left out.
 * A plugin installed but unable to run (another plugin API) is still
 * installed: it keeps its place and its Replace.
 */
export function buildVaultGroups(
  overview: Pick<PluginsOverview, "connectionGroups">,
  now: number,
  /** Better names for plugins, by ID, such as the catalog's. */
  names: ReadonlyMap<string, string> = new Map(),
): VaultGroup[] {
  const groups = overview.connectionGroups.flatMap((group) => {
    const missing = group.missing === true;
    const rows = groupRows(group, now);
    // An installed plugin names itself; a missing one has only its ID.
    const name = missing
      ? (names.get(group.plugin.id) ?? group.plugin.displayName)
      : group.plugin.displayName;
    return rows.length === 0
      ? []
      : [
          {
            pluginId: group.plugin.id,
            title: missing ? `${name} (not installed)` : name,
            installed: !missing,
            rows,
          },
        ];
  });
  return groups.sort(
    (left, right) =>
      Number(!left.installed) - Number(!right.installed) ||
      left.title.localeCompare(right.title),
  );
}

/** What the page says at its top when the vault itself is failing. */
export interface VaultNotice {
  title: string;
  /** Why, then what to do. */
  body: string;
  /** Offers Try again: the failure may pass. */
  retry: boolean;
}

export function vaultNotice(
  status: VaultStatusSummary | undefined,
): VaultNotice | null {
  if (!status || status.state === "available") return null;
  if (status.state === "unavailable") {
    return {
      title: "Ajour can't protect credentials on this computer",
      body: `${status.reason ? `${status.reason} ` : ""}Connections that need a token are paused, and token fields are disabled.`,
      retry: true,
    };
  }
  return {
    title: "Saved secrets can't be read on this computer",
    body: `${status.reason ? `${status.reason} ` : ""}This happens after moving Ajour's data to another computer or resetting the account password. Connections keep their settings. Paste each token again to resume sync.`,
    retry: false,
  };
}
