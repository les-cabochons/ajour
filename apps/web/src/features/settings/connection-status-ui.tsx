import type {
  PluginConnectionSummary,
  PluginOverviewGroup,
} from "@ajour/shared";
import { Chip } from "@/components/ui/chip";
import {
  connectionStatusIn,
  expiryWarnings,
} from "@/domain/plugins/connection-status";

type StatusProps = {
  group: Pick<PluginOverviewGroup, "plugin" | "enabled">;
  connection: PluginConnectionSummary;
  pluginsEnabled: boolean;
};

/** The chip of a connection's row: Connected, Paused, Error, Token rejected… */
export function ConnectionStatusChip({
  group,
  connection,
  pluginsEnabled,
}: StatusProps) {
  const status = connectionStatusIn(group, connection, pluginsEnabled);
  return (
    <Chip tone={status.tone} data-connection-status={status.label}>
      {status.label}
    </Chip>
  );
}

/**
 * Under a connection's name: why sync is paused when its secret needs the
 * user, or the plugin's last error. A refused token says so in place of the
 * plugin's error text.
 */
export function ConnectionStatusNote({
  group,
  connection,
  pluginsEnabled,
}: StatusProps) {
  const status = connectionStatusIn(group, connection, pluginsEnabled);
  const labels = new Map(
    group.plugin.connectionFields.map((field) => [field.id, field.label]),
  );
  // Ajour keeps using a secret past its reminder date, so this only warns.
  const warnings = expiryWarnings(
    connection.secretFields,
    (id) => labels.get(id) ?? id,
    Date.now(),
  );
  return (
    <>
      {status.note ? (
        <p className="text-sm break-words text-muted-foreground">
          {status.note}
        </p>
      ) : null}
      {warnings.map((warning) => (
        <p
          key={warning.fieldId}
          className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground"
        >
          <span className="break-words">{warning.label}</span>
          <Chip tone={warning.tone} data-secret-state="expiry-warning">
            {warning.text}
          </Chip>
        </p>
      ))}
      {connection.lastError && !status.needsSecret ? (
        <p className="text-sm break-words text-destructive">
          {connection.lastError}
        </p>
      ) : null}
    </>
  );
}
