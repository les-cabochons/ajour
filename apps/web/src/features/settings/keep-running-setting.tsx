import { useEffect, useRef, useState } from "react";
import { AppPanel, SettingRow } from "@/components/app-surface";
import { showErrorToast } from "@/components/ui/toast";
import { Switch } from "@/components/ui/switch";

/**
 * Settings › General › "Keep Ajour running when the window closes" (#534).
 * Main stores it, since it needs it before the window exists. The browser
 * build has no window to keep, so the section is absent there.
 */
export function KeepRunningSetting() {
  const desktop = window.ajourDesktop;
  // Main's default until it answers.
  const [keepRunning, setKeepRunning] = useState(true);
  const [loaded, setLoaded] = useState(false);
  // One write at a time, so a failed save rolls back to what main confirmed
  // and never to a value that was itself still unsaved.
  const [saving, setSaving] = useState(false);
  const confirmed = useRef(true);
  const supported = Boolean(
    desktop?.getWindowSettings && desktop.configureWindowSettings,
  );

  useEffect(() => {
    if (!supported) return;
    let current = true;
    void desktop!.getWindowSettings!().then(
      (settings) => {
        if (!current) return;
        confirmed.current = settings.keepRunning;
        setKeepRunning(settings.keepRunning);
        setLoaded(true);
      },
      () => {
        if (current) setLoaded(true);
      },
    );
    return () => {
      current = false;
    };
  }, [desktop, supported]);

  if (!supported) return null;

  const where =
    desktop?.runtime?.platform === "darwin" ? "the menu bar" : "the tray icon";

  return (
    <section className="settings-section">
      <h2 className="settings-section-title">Desktop app</h2>
      <p className="settings-section-desc">
        What happens when you close the Ajour window.
      </p>
      <AppPanel>
        <SettingRow
          label="Keep Ajour running when the window closes"
          labelFor="keep-running"
          description={`The terminal and agents keep working while the window is closed. Quit Ajour from ${where}.`}
        >
          <Switch
            id="keep-running"
            checked={keepRunning}
            disabled={!loaded || saving}
            onCheckedChange={(checked) => {
              setSaving(true);
              setKeepRunning(checked);
              void desktop!.configureWindowSettings!({
                keepRunning: checked,
              }).then(
                (settings) => {
                  confirmed.current = settings.keepRunning;
                  setKeepRunning(settings.keepRunning);
                  setSaving(false);
                },
                (error: unknown) => {
                  setKeepRunning(confirmed.current);
                  setSaving(false);
                  showErrorToast({
                    title: "The setting was not saved.",
                    description:
                      error instanceof Error ? error.message : undefined,
                  });
                },
              );
            }}
          />
        </SettingRow>
      </AppPanel>
    </section>
  );
}
