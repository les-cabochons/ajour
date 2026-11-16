import { useEffect, useState } from "react";
import { SettingRow } from "@/components/app-surface";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
export function TerminalAppSetting() {
  const desktop = window.ajourDesktop;
  const [value, setValue] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    let active = true;
    void desktop?.getTerminalApp?.().then(
      (v) => {
        if (active) setValue(v);
      },
      () => {
        if (active) setError("Couldn't read the terminal app.");
      },
    );
    return () => {
      active = false;
    };
  }, [desktop]);
  if (!desktop?.getTerminalApp || !desktop.setTerminalApp) return null;
  const choices =
    desktop.runtime?.platform === "win32"
      ? [
          { value: "wt", label: "Windows Terminal" },
          { value: "powershell", label: "PowerShell" },
          { value: "cmd", label: "Command Prompt" },
        ]
      : [
          { value: "Terminal", label: "Terminal" },
          { value: "iTerm", label: "iTerm" },
        ];
  return (
    <>
      <SettingRow
        label="Terminal app"
        description="Open plugin commands in this terminal."
      >
        <Select
          value={value}
          disabled={saving || value === null}
          items={choices}
          onValueChange={(next) => {
            if (!next || next === value) return;
            setSaving(true);
            setError(null);
            void desktop.setTerminalApp!(next)
              .then(setValue, () => setError("Couldn't save the terminal app."))
              .finally(() => setSaving(false));
          }}
        >
          <SelectTrigger aria-label="Terminal app">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {choices.map((c) => (
              <SelectItem key={c.value} value={c.value}>
                {c.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </SettingRow>
      {error && <p role="alert">{error}</p>}
    </>
  );
}
