import type {
  PluginConnectionSummary,
  PluginOverviewGroup,
} from "@ajour/shared";
import { Chip } from "@/components/ui/chip";
import { connectionStatusIn } from "@/domain/plugins/connection-status";

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
  return (
    <>
      {status.note ? (
        <p className="text-[13px] break-words text-muted-foreground">
          {status.note}
        </p>
      ) : null}
      {connection.lastError && !status.needsSecret ? (
        <p className="text-sm break-words text-destructive">
          {connection.lastError}
        </p>
      ) : null}
    </>
  );
}
