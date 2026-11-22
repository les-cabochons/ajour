import { useEffect, useState } from "react";
import { SettingRow } from "@/components/app-surface";
import { OptionSelect } from "@/components/ui/option-select";
import type { DesktopTerminalApps } from "@/lib/desktop-bridge";

/**
 * Settings › General › Terminal: which installed terminal app opens plugin
 * commands, each shown with its own icon.
 */
export function TerminalAppSetting() {
  const desktop = window.ajourDesktop;
  const [value, setValue] = useState<string | null>(null);
  const [choices, setChoices] = useState<DesktopTerminalApps["choices"]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    let active = true;
    if (!["win32", "darwin"].includes(desktop?.runtime?.platform ?? "")) return;
    void desktop?.getTerminalApp?.().then(
      (apps) => {
        if (!active) return;
        setChoices(apps.choices);
        setValue(apps.value ?? null);
      },
      () => {
        if (active) setError("Couldn't read the terminal app.");
      },
    );
    return () => {
      active = false;
    };
  }, [desktop]);
  if (
    !desktop?.getTerminalApp ||
    !desktop.setTerminalApp ||
    !["win32", "darwin"].includes(desktop.runtime?.platform ?? "")
  )
    return null;
  return (
    <SettingRow
      label="Terminal app"
      description={
        <span className="flex h-8 min-w-0 flex-col overflow-hidden">
          <span className="truncate">
            Open plugin commands in this terminal.
          </span>
          <span
            role="alert"
            className="truncate text-destructive"
            title={error ?? undefined}
          >
            {error ?? "\u00a0"}
          </span>
        </span>
      }
    >
      <OptionSelect
        label="Terminal app"
        value={value ?? ""}
        options={choices.map((choice) => ({
          value: choice.value,
          label: choice.label,
          icon: choice.icon && (
            <img
              alt=""
              aria-hidden="true"
              className="size-4 shrink-0"
              src={choice.icon}
            />
          ),
        }))}
        iconLabel
        disabled={saving || value === null}
        onChange={(next) => {
          if (next === value) return;
          setSaving(true);
          setError(null);
          void desktop.setTerminalApp!(next)
            .then(setValue, () => setError("Couldn't save the terminal app."))
            .finally(() => setSaving(false));
        }}
      />
    </SettingRow>
  );
}
