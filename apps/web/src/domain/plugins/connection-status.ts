import type {
  PluginConnectionSummary,
  PluginOverviewGroup,
  SecretFieldSummary,
} from "@ajour/shared";
import { describeSecret } from "./secret-state";

/** The chip a connection's row shows, and the line under its name. */
export interface ConnectionStatus {
  label: string;
  tone: "neutral" | "danger" | "warning";
  /** Why sync is paused or failing, in a sentence, when the chip alone isn't enough. */
  note?: string;
  /** True when the user must replace or add a secret to resume sync. */
  needsSecret: boolean;
}

/** The status of a connection in its plugin's group. */
export function connectionStatusIn(
  group: Pick<PluginOverviewGroup, "plugin" | "enabled">,
  connection: Pick<PluginConnectionSummary, "lastError" | "paused">,
  pluginsEnabled: boolean,
): ConnectionStatus {
  return connectionStatus({
    connection,
    pluginName: group.plugin.displayName,
    unavailable: group.plugin.unavailableReason !== undefined,
    inactive: !pluginsEnabled || !group.enabled,
  });
}

/**
 * What a connection's row says. A refused token is "Token rejected" with sync
 * paused, in place of the generic Error chip; Edit leads to Replace.
 */
export function connectionStatus(input: {
  connection: Pick<PluginConnectionSummary, "lastError" | "paused">;
  pluginName: string;
  /** The plugin is installed but can't run. */
  unavailable: boolean;
  /** The plugin system or the plugin is off. */
  inactive: boolean;
}): ConnectionStatus {
  const { connection, pluginName } = input;
  if (input.unavailable) {
    return { label: "Unavailable", tone: "neutral", needsSecret: false };
  }
  if (input.inactive) {
    return { label: "Paused", tone: "neutral", needsSecret: false };
  }
  switch (connection.paused?.reason) {
    case "secret_rejected":
      return {
        label: "Token rejected",
        tone: "danger",
        note: `${pluginName} refused the token. Sync is paused. Edit the connection to replace it.`,
        needsSecret: true,
      };
    case "secret_unreadable":
      return {
        label: "Can't be read on this computer",
        tone: "danger",
        note: "Its settings and data are kept. Paste the token again to resume sync.",
        needsSecret: true,
      };
    case "secret_removed":
      return {
        label: "Paused",
        tone: "warning",
        note: "Its token was removed. Edit the connection to add one and resume sync.",
        needsSecret: true,
      };
    case "vault_unavailable":
    case "not_in_vault":
      return {
        label: "Paused",
        tone: "warning",
        note: connection.paused.message,
        needsSecret: false,
      };
    default:
      break;
  }
  return connection.lastError
    ? { label: "Error", tone: "danger", needsSecret: false }
    : { label: "Connected", tone: "neutral", needsSecret: false };
}

/** A saved secret on a connection's row that is about to expire, or has. */
export interface ExpiryWarning {
  fieldId: string;
  /** The field's label, as the form shows it. */
  label: string;
  /** "Expires in 3 days", "Expires today" or "Expired on 21 Oct 2026". */
  text: string;
  tone: "warning" | "danger";
}

/**
 * The secrets of a connection that expire within a week or already have, for
 * its row. Ajour keeps using them, so these warn and never pause. A rejected
 * or unreadable secret is left to the row's own chip.
 */
export function expiryWarnings(
  secretFields: readonly Pick<
    SecretFieldSummary,
    "id" | "state" | "expiresAt"
  >[] = [],
  labelOf: (fieldId: string) => string,
  now: number,
): ExpiryWarning[] {
  return secretFields.flatMap((secret) => {
    const state = describeSecret(secret, now);
    return (state.kind === "expiring" || state.kind === "expired") &&
      state.tone !== "neutral"
      ? [
          {
            fieldId: secret.id,
            label: labelOf(secret.id),
            text: state.label,
            tone: state.tone,
          },
        ]
      : [];
  });
}
