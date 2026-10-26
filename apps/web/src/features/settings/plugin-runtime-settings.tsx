import { useEffect, useState } from "react";
import {
  PLUGIN_MEMORY_CEILING_MB,
  type PluginOverviewGroup,
  type PluginRuntimeSettingsUpdate,
  type PluginStartChoice,
  type PluginStopCause,
} from "@ajour/shared";
import { AppPanel, MessagePanel, SettingRow } from "@/components/app-surface";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { OptionSelect } from "@/components/ui/option-select";

/*
 * How a plugin API 4 plugin's renderer lives, on its page (#391, decided in
 * #217): the notice of a plugin that keeps stopping, with Turn back on, and
 * the Advanced section's Start and Memory ceiling, which the renderer reads
 * at its next start.
 */

/** The notice's title while a plugin is suspended. */
export const PLUGIN_KEEPS_STOPPING = "This plugin keeps stopping";

/** What the last of its stops was, in the notice's words. */
const LAST_STOP: Record<PluginStopCause, string> = {
  crashed: "its process crashed",
  oom: "it ran out of memory",
  killed: "the system ended it",
  memory: "it used more memory than its ceiling allows",
  timeout: "a call took longer than 30 seconds",
};

/** Why the plugin is off, for the notice under its title. */
export function suspensionReason(cause: PluginStopCause) {
  return `It stopped 3 times in 10 minutes. The last time, ${LAST_STOP[cause]}. Ajour keeps it off until you turn it back on or restart Ajour.`;
}

export function PluginSuspendedNotice({
  group,
  disabled,
  onTurnBackOn,
}: {
  group: PluginOverviewGroup;
  disabled: boolean;
  onTurnBackOn(): void;
}) {
  if (!group.suspended) return null;
  return (
    <MessagePanel tone="warning" data-plugin-suspended="">
      <p className="font-medium">{PLUGIN_KEEPS_STOPPING}</p>
      <p>{suspensionReason(group.suspended.cause)}</p>
      <div className="mt-2">
        <Button
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={onTurnBackOn}
        >
          Turn back on
        </Button>
      </div>
    </MessagePanel>
  );
}

const START_LABELS: Record<"whenNeeded" | "alwaysReady", string> = {
  whenNeeded: "Load when needed",
  alwaysReady: "Always ready",
};

/** Reads the ceiling field: a whole number in range, empty for the plugin's, or an error. */
export function readMemoryCeiling(
  text: string,
): { ok: true; value: number | null } | { ok: false; error: string } {
  const trimmed = text.trim();
  if (trimmed === "") return { ok: true, value: null };
  const value = Number(trimmed);
  if (
    !Number.isInteger(value) ||
    value < PLUGIN_MEMORY_CEILING_MB.min ||
    value > PLUGIN_MEMORY_CEILING_MB.max
  ) {
    return {
      ok: false,
      error: `Enter a whole number of MB from ${PLUGIN_MEMORY_CEILING_MB.min} to ${PLUGIN_MEMORY_CEILING_MB.max}.`,
    };
  }
  return { ok: true, value };
}

export function PluginAdvancedSettings({
  group,
  disabled,
  onSave,
}: {
  group: PluginOverviewGroup;
  disabled: boolean;
  onSave(settings: PluginRuntimeSettingsUpdate): void;
}) {
  const runtime = group.runtime;
  const saved = runtime?.settings.memoryCeilingMb;
  const [ceiling, setCeiling] = useState(
    saved === undefined ? "" : String(saved),
  );
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setCeiling(saved === undefined ? "" : String(saved));
    setError(null);
  }, [saved]);
  if (!runtime) return null;
  const { declared, settings } = runtime;
  const pluginId = group.plugin.id;

  const saveCeiling = () => {
    const read = readMemoryCeiling(ceiling);
    if (!read.ok) {
      setError(read.error);
      return;
    }
    setError(null);
    if ((read.value ?? undefined) === saved) return;
    onSave({ start: settings.start, memoryCeilingMb: read.value });
  };

  return (
    <section className="settings-section" data-plugin-advanced="">
      <div>
        <h2 className="settings-section-title">Advanced</h2>
        <p className="settings-section-desc mt-1">
          Changes take effect the next time the plugin starts.
        </p>
      </div>
      <AppPanel>
        <SettingRow
          label="Start"
          labelFor={`plugin-start-${pluginId}`}
          description="Always ready starts with Ajour and keeps running, using about 30 MB. Load when needed starts at the first call and closes 2 minutes after the last."
        >
          <OptionSelect
            id={`plugin-start-${pluginId}`}
            className="w-72"
            value={settings.start}
            disabled={disabled}
            onChange={(start) => {
              if (start === settings.start) return;
              onSave({
                start: start as PluginStartChoice,
                memoryCeilingMb: saved ?? null,
              });
            }}
            options={[
              {
                value: "plugin",
                label: `Plugin's choice (${START_LABELS[declared.start]})`,
              },
              { value: "alwaysReady", label: START_LABELS.alwaysReady },
              { value: "whenNeeded", label: START_LABELS.whenNeeded },
            ]}
          />
        </SettingRow>
        <SettingRow
          label="Memory ceiling"
          labelFor={`plugin-memory-${pluginId}`}
          description={
            <>
              In MB, from {PLUGIN_MEMORY_CEILING_MB.min} to{" "}
              {PLUGIN_MEMORY_CEILING_MB.max}. Above it, Ajour closes the plugin.
              Empty uses the plugin's, {declared.memoryCeilingMb} MB.
              {error ? (
                <span role="alert" className="mt-1 block text-destructive">
                  {error}
                </span>
              ) : null}
            </>
          }
        >
          <Input
            id={`plugin-memory-${pluginId}`}
            type="number"
            inputMode="numeric"
            min={PLUGIN_MEMORY_CEILING_MB.min}
            max={PLUGIN_MEMORY_CEILING_MB.max}
            step={16}
            className="w-24"
            placeholder={String(declared.memoryCeilingMb)}
            value={ceiling}
            disabled={disabled}
            aria-invalid={error ? true : undefined}
            onChange={(event) => setCeiling(event.target.value)}
            onBlur={saveCeiling}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
            }}
          />
        </SettingRow>
      </AppPanel>
    </section>
  );
}
