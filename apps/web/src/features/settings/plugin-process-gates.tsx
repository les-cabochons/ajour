import type { PluginOverviewGroup } from "@ajour/shared";
import { SettingRow } from "@/components/app-surface";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
export function UnsignedProcessSwitch({
  enabled,
  disabled,
  onChange,
}: {
  enabled: boolean;
  disabled: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <SettingRow
      label="Unsigned plugins can start processes"
      description="Commands run as you, outside the sandbox, and can reach your files and credentials. Each plugin also needs your acceptance."
    >
      <Switch
        aria-label="Unsigned plugins can start processes"
        checked={enabled}
        disabled={disabled}
        onCheckedChange={onChange}
      />
    </SettingRow>
  );
}
export function PluginProcessAcceptance({
  gate,
  disabled,
  onChange,
}: {
  gate: NonNullable<PluginOverviewGroup["processGate"]>;
  disabled: boolean;
  onChange: (value: boolean) => void;
}) {
  if (!gate.required)
    return (
      <p className="text-sm text-muted-foreground">
        Signed plugin. No unsigned process gates required.
      </p>
    );
  const reason =
    gate.reason === "unsigned_processes_off"
      ? "Turn on Unsigned plugins can start processes in Settings › Plugins."
      : gate.reason === "process_acceptance_required"
        ? "Allow it below."
        : gate.reason === "package_unverified"
          ? "Ajour can't verify the package. Process access is blocked."
          : "Process access allowed.";
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-muted-foreground">{reason}</p>
      <SettingRow
        label="Allow this plugin to start processes"
        description="Applies to this package and version. An update clears your acceptance. Withdrawing access stops new starts, but does not end processes already running."
      >
        <Checkbox
          aria-label="Allow this plugin to start processes"
          checked={gate.accepted}
          disabled={disabled || gate.reason === "package_unverified"}
          onCheckedChange={onChange}
        />
      </SettingRow>
    </div>
  );
}
