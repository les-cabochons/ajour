import { useEffect, useRef, useState } from "react";
import { AppPanel, SettingRow } from "@/components/app-surface";
import { showErrorToast } from "@/components/ui/toast";
import { Switch } from "@/components/ui/switch";

/** How long main gets to answer a save before the switch is given back. */
const SAVE_DEADLINE_MS = 5_000;

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
  // Counts saves; an answer or a deadline for an older one is ignored.
  const request = useRef(0);
  const deadline = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
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
      request.current += 1;
      clearTimeout(deadline.current);
    };
  }, [desktop, supported]);

  if (!supported) return null;

  const where =
    desktop?.runtime?.platform === "darwin" ? "the menu bar" : "the tray icon";

  function fail(description: string | undefined) {
    setKeepRunning(confirmed.current);
    setSaving(false);
    showErrorToast({ title: "The setting was not saved.", description });
  }

  function save(checked: boolean) {
    const id = ++request.current;
    setSaving(true);
    setKeepRunning(checked);
    deadline.current = setTimeout(() => {
      if (request.current !== id) return;
      // Main may still apply it; read what it holds once the switch is back.
      request.current += 1;
      const reconciling = request.current;
      fail("Ajour did not answer in time.");
      void desktop!.getWindowSettings!().then(
        (settings) => {
          if (request.current !== reconciling) return;
          confirmed.current = settings.keepRunning;
          setKeepRunning(settings.keepRunning);
        },
        () => {},
      );
    }, SAVE_DEADLINE_MS);
    void desktop!.configureWindowSettings!({ keepRunning: checked }).then(
      (settings) => {
        if (request.current !== id) return;
        clearTimeout(deadline.current);
        confirmed.current = settings.keepRunning;
        setKeepRunning(settings.keepRunning);
        setSaving(false);
      },
      (error: unknown) => {
        if (request.current !== id) return;
        clearTimeout(deadline.current);
        fail(error instanceof Error ? error.message : undefined);
      },
    );
  }

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
            onCheckedChange={save}
          />
        </SettingRow>
      </AppPanel>
    </section>
  );
}
