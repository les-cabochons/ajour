import { useEffect } from "react";
import { RiRefreshLine as Refresh } from "@remixicon/react";
import { AppPanel, SettingRow } from "@/components/app-surface";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { UpdateTrack } from "@/domain/local-state";
import {
  applyDesktopUpdate,
  checkDesktopUpdates,
  desktopUpdateLabel,
  isDesktopUpdateBusy,
  useDesktopUpdates,
} from "@/lib/desktop-updates";
import { useUserPreferences } from "@/lib/local-hooks";
import { localStore } from "@/lib/local-store";
import { onUpdateCheckRequest } from "@/lib/update-check-request";

const TRACKS: Record<UpdateTrack, { label: string; description: string }> = {
  stable: {
    label: "Stable",
    description: "Full releases intended for everyday use.",
  },
  nightly: {
    label: "Nightly",
    description: "Frequent preview builds from main that may be less tested.",
  },
};

export function ApplicationUpdatesSettings() {
  const { updateTrack } = useUserPreferences();
  const state = useDesktopUpdates();
  const busy = isDesktopUpdateBusy(state);
  const available =
    state.result?.updateAvailable && state.track === updateTrack;
  const supported = Boolean(window.ajourDesktop?.checkForUpdates);

  useEffect(() => {
    void checkDesktopUpdates(updateTrack);
  }, [updateTrack]);
  useEffect(
    () => onUpdateCheckRequest(() => void checkDesktopUpdates(updateTrack)),
    [updateTrack],
  );

  return (
    <section className="settings-section">
      <h2 className="settings-section-title">Application updates</h2>
      <p className="settings-section-desc">
        Ajour checks your selected release track in the background. Updates
        download only when you choose to update.
      </p>
      <AppPanel>
        <SettingRow
          label="Update track"
          description={TRACKS[updateTrack].description}
        >
          <ToggleGroup
            aria-label="Update track"
            disabled={state.status === "installing"}
            variant="outline"
            value={[updateTrack]}
            onValueChange={(values) => {
              const track = values[0];
              if (track === "stable" || track === "nightly")
                localStore.setUserPreferences({ updateTrack: track });
            }}
          >
            {(Object.keys(TRACKS) as UpdateTrack[]).map((track) => (
              <ToggleGroupItem
                key={track}
                value={track}
                aria-label={`Use ${track} updates`}
              >
                {TRACKS[track].label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </SettingRow>
        <div className="flex min-h-16 flex-col gap-3 pt-2 desktop:flex-row desktop:items-center desktop:justify-between">
          <div className="min-w-0" role="status">
            <p className="text-sm font-medium text-foreground">
              {supported ? desktopUpdateLabel(state) : "Desktop app required"}
            </p>
            <p className="text-sm leading-5 text-muted-foreground">
              {!supported
                ? "Release checks are unavailable in the web preview."
                : state.result
                  ? `Installed ${state.result.currentVersion}. Following ${updateTrack} releases.`
                  : "Checks do not download or install updates."}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {available ? (
              <Button
                disabled={busy}
                onClick={() => void applyDesktopUpdate(state)}
              >
                {state.canInstall ? "Update and restart" : "View release"}
              </Button>
            ) : null}
            <Button
              variant="outline"
              disabled={!supported || busy}
              onClick={() => void checkDesktopUpdates(updateTrack)}
            >
              <Refresh data-icon="inline-start" />
              {state.status === "checking" ? "Checking" : "Check again"}
            </Button>
          </div>
        </div>
      </AppPanel>
    </section>
  );
}
