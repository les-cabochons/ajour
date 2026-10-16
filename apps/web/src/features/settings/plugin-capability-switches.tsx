import {
  isCapabilitySwitchedOn,
  pluginHasSwitchableCapabilities,
  switchableCapabilityLabels,
  switchableCapabilitySchema,
  type ConnectorOverviewGroup,
  type SwitchableCapability,
} from "@ajour/shared";
import { SettingRow } from "@/components/app-surface";
import { Switch } from "@/components/ui/switch";

const capabilityDescriptions: Record<SwitchableCapability, string> = {
  connector: "Sync items into your backlog and write settles back.",
  codeHost: "List the pull requests you wrote or were asked to review.",
  team: "Keep shared projects and tasks in step with your team.",
};

/**
 * The Capabilities section of a plugin that declares more than one of
 * connector, code host and team: one switch each, under the plugin's own switch. Turning one off
 * pauses it and keeps its connections and data.
 */
export function PluginCapabilitySwitches({
  group,
  title,
  disabled,
  onChange,
}: {
  group: ConnectorOverviewGroup;
  title: string;
  disabled: boolean;
  onChange: (capability: SwitchableCapability, enabled: boolean) => void;
}) {
  if (!pluginHasSwitchableCapabilities(group.plugin)) {
    return null;
  }

  return (
    <section className="settings-section">
      <div>
        <h2 className="settings-section-title">Capabilities</h2>
        <p className="settings-section-desc mt-1">
          Turn each part on or off. Its connections and imported data stay.
        </p>
      </div>
      {switchableCapabilitySchema.options.map((capability) => {
        const on = isCapabilitySwitchedOn(group, capability);
        const label = switchableCapabilityLabels[capability];
        return (
          <SettingRow
            key={capability}
            label={label}
            description={capabilityDescriptions[capability]}
          >
            <Switch
              checked={on}
              disabled={disabled || !group.enabled}
              aria-label={`${on ? "Deactivate" : "Activate"} ${label.toLowerCase()} for ${title}`}
              onCheckedChange={(enabled) => onChange(capability, enabled)}
            />
          </SettingRow>
        );
      })}
    </section>
  );
}
