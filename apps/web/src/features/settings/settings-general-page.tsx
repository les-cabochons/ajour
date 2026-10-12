import { useCallback, useEffect, useRef, useState } from "react";
import {
  RiCheckboxCircleLine as CheckCircle,
  RiComputerLine as Monitor,
  RiErrorWarningLine as Alert,
  RiExternalLinkLine as ExternalLink,
  RiGitBranchLine as GitBranch,
  RiMoonLine as Moon,
  RiRefreshLine as Refresh,
  RiSunLine as Sun,
} from "@remixicon/react";
import { AppPanel } from "@/components/app-surface";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  updateSidebarLayout,
  useSidebarLayout,
  type SidebarDensity,
} from "@/lib/sidebar-layout";
import type {
  ThemeMode,
  UpdateTrack,
  WeeklyCapacityTargets,
} from "@/domain/local-state";
import {
  formatDurationHoursInput,
  parseHoursInput,
} from "@/domain/time/duration";
import type { DesktopUpdateCheckResult } from "@/lib/desktop-bridge";
import { cn } from "@/lib/utils";
import { useUserPreferences } from "@/lib/local-hooks";
import { localStore } from "@/lib/local-store";
import { onUpdateCheckRequest } from "@/lib/update-check-request";
import { getThemeModeLabel, useResolvedTheme } from "@/lib/use-theme";

const THEME_OPTIONS: Array<{
  value: ThemeMode;
  icon: typeof Sun;
  description: string;
}> = [
  {
    value: "system",
    icon: Monitor,
    description: "Follows your operating system preference",
  },
  {
    value: "light",
    icon: Sun,
    description: "Always use light appearance",
  },
  {
    value: "dark",
    icon: Moon,
    description: "Always use dark appearance",
  },
];

const UPDATE_TRACK_DETAILS: Record<
  UpdateTrack,
  { label: string; description: string }
> = {
  stable: {
    label: "Stable",
    description: "Full releases intended for everyday use.",
  },
  nightly: {
    label: "Nightly",
    description: "Frequent preview builds from main that may be less tested.",
  },
};

type UpdateCheckState =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "success"; result: DesktopUpdateCheckResult }
  | { status: "error"; message: string };

const CAPACITY_DAYS: Array<{
  key: keyof WeeklyCapacityTargets;
  label: string;
}> = [
  { key: "monday", label: "Monday" },
  { key: "tuesday", label: "Tuesday" },
  { key: "wednesday", label: "Wednesday" },
  { key: "thursday", label: "Thursday" },
  { key: "friday", label: "Friday" },
  { key: "saturday", label: "Saturday" },
  { key: "sunday", label: "Sunday" },
];

function CapacityInput({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: number;
  onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState(() => formatDurationHoursInput(value));

  useEffect(() => {
    setDraft(formatDurationHoursInput(value));
  }, [value]);

  return (
    <Field>
      <FieldLabel htmlFor={`capacity-${label.toLowerCase()}`}>
        {label}
      </FieldLabel>
      <Input
        id={`capacity-${label.toLowerCase()}`}
        className="font-mono"
        value={draft}
        placeholder="08:00"
        onChange={(event) => setDraft(event.target.value)}
        onBlur={(event) => {
          const parsed = parseHoursInput(event.target.value);
          if (parsed !== null && parsed >= 0) {
            onCommit(parsed);
            setDraft(formatDurationHoursInput(parsed));
          } else {
            setDraft(formatDurationHoursInput(value));
          }
        }}
      />
    </Field>
  );
}

function formatCheckedAt(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "just now"
    : date.toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      });
}

export function SettingsGeneralPage() {
  const sidebarLayout = useSidebarLayout();
  const preferences = useUserPreferences();
  const resolvedTheme = useResolvedTheme();
  const [updateCheck, setUpdateCheck] = useState<UpdateCheckState>({
    status: "idle",
  });
  const [releaseOpenError, setReleaseOpenError] = useState<string | null>(null);
  const updateRequestId = useRef(0);
  const releaseOpenRequestId = useRef(0);
  const desktopUpdates = window.ajourDesktop?.checkForUpdates;
  const automaticUpdatesEnabled =
    window.ajourDesktop?.runtime?.automaticUpdatesEnabled === true;

  const handleThemeChange = (mode: ThemeMode) => {
    localStore.setUserPreferences({ themeMode: mode });
  };

  const runUpdateCheck = useCallback(async (track: UpdateTrack) => {
    releaseOpenRequestId.current += 1;
    setReleaseOpenError(null);
    const checkForUpdates = window.ajourDesktop?.checkForUpdates;
    if (!checkForUpdates) {
      setUpdateCheck({ status: "idle" });
      return;
    }

    const requestId = ++updateRequestId.current;
    setUpdateCheck({ status: "checking" });
    try {
      const result = await checkForUpdates(track);
      if (requestId === updateRequestId.current) {
        setUpdateCheck({ status: "success", result });
      }
    } catch (error) {
      if (requestId === updateRequestId.current) {
        setUpdateCheck({
          status: "error",
          message:
            error instanceof Error
              ? error.message
              : "The update check could not be completed.",
        });
      }
    }
  }, []);

  useEffect(() => {
    void runUpdateCheck(preferences.updateTrack);
  }, [preferences.updateTrack, runUpdateCheck]);

  // The app menu's "Check for updates…" while this page is already open.
  useEffect(
    () =>
      onUpdateCheckRequest(() => void runUpdateCheck(preferences.updateTrack)),
    [preferences.updateTrack, runUpdateCheck],
  );

  const handleTrackChange = (values: unknown[]) => {
    const track = values[0];
    if (track === "stable" || track === "nightly") {
      localStore.setUserPreferences({ updateTrack: track });
    }
  };

  const handleOpenRelease = async (releaseUrl: string) => {
    const requestId = ++releaseOpenRequestId.current;
    setReleaseOpenError(null);
    try {
      await window.ajourDesktop?.openUpdateRelease?.(releaseUrl);
    } catch (error) {
      if (requestId === releaseOpenRequestId.current) {
        setReleaseOpenError(
          error instanceof Error
            ? error.message
            : "The release page could not be opened.",
        );
      }
    }
  };

  return (
    <div className="settings-sections">
      <section className="settings-section">
        <h2 className="settings-section-title">Appearance</h2>
        <p className="settings-section-desc">
          Customize how the app looks. Choose between light and dark modes, or
          let it follow your system settings.
        </p>

        <AppPanel>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium text-foreground/90">
                Theme
              </label>
              <p className="mt-0.5 text-sm text-foreground/60">
                {preferences.themeMode === "system"
                  ? `Currently using ${resolvedTheme} mode based on system preference`
                  : `Using ${preferences.themeMode} mode`}
              </p>
            </div>

            <div className="flex flex-wrap gap-3">
              {THEME_OPTIONS.map((option) => {
                const Icon = option.icon;
                const isSelected = preferences.themeMode === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => handleThemeChange(option.value)}
                    className={cn(
                      "theme-option-card",
                      isSelected && "theme-option-card-selected",
                    )}
                  >
                    <div className="theme-option-icon-wrapper">
                      <Icon className="theme-option-icon" />
                    </div>
                    <div className="theme-option-label">
                      {getThemeModeLabel(option.value)}
                    </div>
                    <div className="theme-option-description">
                      {option.description}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </AppPanel>
      </section>

      <section className="settings-section">
        <h2 className="settings-section-title">Sidebar</h2>
        <p className="settings-section-desc">
          How the backlog items in the sidebar look on this device.
        </p>

        <AppPanel>
          <div className="grid gap-3 desktop:grid-cols-2">
            <Field
              orientation="horizontal"
              className="rounded-2xl border border-border/70 p-4"
            >
              <div className="flex-1">
                <FieldLabel>Density</FieldLabel>
                <p className="mt-1 text-sm text-muted-foreground">
                  One line per item, narrower sidebar.
                </p>
              </div>
              <ToggleGroup
                aria-label="Sidebar density"
                variant="outline"
                size="sm"
                value={[sidebarLayout.density]}
                onValueChange={(next) => {
                  const density = next[0] as SidebarDensity | undefined;
                  if (density) updateSidebarLayout({ density });
                }}
              >
                <ToggleGroupItem value="comfortable">
                  Comfortable
                </ToggleGroupItem>
                <ToggleGroupItem value="compact">Compact</ToggleGroupItem>
              </ToggleGroup>
            </Field>
            <Field
              orientation="horizontal"
              className="rounded-2xl border border-border/70 p-4"
            >
              <div className="flex-1">
                <FieldLabel htmlFor="show-up-next">Show Up next</FieldLabel>
                <p className="mt-1 text-sm text-muted-foreground">
                  Show the first backlog item as a card with its actions.
                </p>
              </div>
              <Switch
                id="show-up-next"
                checked={sidebarLayout.showUpNext}
                onCheckedChange={(checked) =>
                  updateSidebarLayout({ showUpNext: checked })
                }
              />
            </Field>
          </div>
        </AppPanel>
      </section>

      <section className="settings-section">
        <h2 className="settings-section-title">Time capacity</h2>
        <p className="settings-section-desc">
          Set the target for each weekday and choose which capacity warnings
          Ajour shows.
        </p>

        <AppPanel>
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-3 desktop:grid-cols-4 desktop:xl:grid-cols-7">
              {CAPACITY_DAYS.map((day) => (
                <CapacityInput
                  key={day.key}
                  label={day.label}
                  value={preferences.weeklyCapacityTargets[day.key]}
                  onCommit={(value) =>
                    localStore.setUserPreferences({
                      weeklyCapacityTargets: {
                        ...preferences.weeklyCapacityTargets,
                        [day.key]: value,
                      },
                    })
                  }
                />
              ))}
            </div>

            <div className="grid gap-3 border-t border-border/70 pt-5 desktop:grid-cols-2">
              <Field
                orientation="horizontal"
                className="rounded-2xl border border-border/70 p-4"
              >
                <div className="flex-1">
                  <FieldLabel htmlFor="warn-over-capacity">
                    Over-capacity warning
                  </FieldLabel>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Show a compact warning when logged time exceeds a target.
                  </p>
                </div>
                <Switch
                  id="warn-over-capacity"
                  checked={preferences.warnWhenOverCapacity}
                  onCheckedChange={(checked) =>
                    localStore.setUserPreferences({
                      warnWhenOverCapacity: checked,
                    })
                  }
                />
              </Field>
              <Field
                orientation="horizontal"
                className="rounded-2xl border border-border/70 p-4"
              >
                <div className="flex-1">
                  <FieldLabel htmlFor="warn-under-capacity">
                    Under-target submit warning
                  </FieldLabel>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Ask for confirmation when submitted time is below the week
                    target.
                  </p>
                </div>
                <Switch
                  id="warn-under-capacity"
                  checked={preferences.warnWhenSubmittingUnderCapacity}
                  onCheckedChange={(checked) =>
                    localStore.setUserPreferences({
                      warnWhenSubmittingUnderCapacity: checked,
                    })
                  }
                />
              </Field>
            </div>
          </div>
        </AppPanel>
      </section>

      <section className="settings-section">
        <h2 className="settings-section-title">Application updates</h2>
        <p className="settings-section-desc">
          {automaticUpdatesEnabled
            ? "Choose which GitHub release track Ajour follows. Updates download in the background, and Ajour asks before restarting to install them."
            : "Choose which GitHub release track Ajour checks. Automatic installation is currently available on packaged Windows builds; use the release link to update this platform manually."}
        </p>

        <AppPanel>
          <div className="flex flex-col gap-5">
            <div className="flex flex-col gap-3 desktop:flex-row desktop:items-start desktop:justify-between">
              <div className="min-w-0 space-y-1">
                <div className="flex items-center gap-2 text-sm font-medium text-foreground/90">
                  <GitBranch className="h-4 w-4 text-muted-foreground" />
                  Update track
                </div>
                <p className="text-sm leading-5 text-foreground/60">
                  {UPDATE_TRACK_DETAILS[preferences.updateTrack].description}
                </p>
              </div>

              <ToggleGroup
                aria-label="Update track"
                className="shrink-0 rounded-[var(--control-radius)]"
                spacing={1}
                value={[preferences.updateTrack]}
                onValueChange={handleTrackChange}
              >
                {(Object.keys(UPDATE_TRACK_DETAILS) as UpdateTrack[]).map(
                  (track) => (
                    <ToggleGroupItem
                      key={track}
                      value={track}
                      variant="outline"
                      size="sm"
                      aria-label={`Use ${track} updates`}
                      className={cn(
                        "!rounded-[var(--control-radius)] px-4 capitalize",
                        preferences.updateTrack === track &&
                          "border-[var(--indigo)] bg-[var(--indigo-muted)] text-foreground hover:bg-[var(--indigo-muted)] hover:text-foreground",
                      )}
                    >
                      {UPDATE_TRACK_DETAILS[track].label}
                    </ToggleGroupItem>
                  ),
                )}
              </ToggleGroup>
            </div>

            <div
              className="flex min-h-16 flex-col gap-3 border-t border-border/70 pt-4 desktop:flex-row desktop:items-center desktop:justify-between"
              aria-live="polite"
            >
              <div className="flex min-w-0 items-start gap-3">
                {updateCheck.status === "error" ? (
                  <Alert className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                ) : (
                  <CheckCircle
                    className={cn(
                      "mt-0.5 h-4 w-4 shrink-0",
                      updateCheck.status === "success" &&
                        updateCheck.result.updateAvailable
                        ? "text-primary"
                        : "text-muted-foreground",
                    )}
                  />
                )}
                <div className="min-w-0">
                  {!desktopUpdates ? (
                    <>
                      <p className="text-sm font-medium text-foreground">
                        Desktop app required
                      </p>
                      <p className="text-sm leading-5 text-muted-foreground">
                        Release checks are unavailable in the web preview.
                      </p>
                    </>
                  ) : updateCheck.status === "checking" ? (
                    <>
                      <p className="text-sm font-medium text-foreground">
                        Checking {preferences.updateTrack} releases…
                      </p>
                      <p className="text-sm leading-5 text-muted-foreground">
                        Looking at the Ajour GitHub repository.
                      </p>
                    </>
                  ) : updateCheck.status === "success" ? (
                    <>
                      <p className="text-sm font-medium text-foreground">
                        {!updateCheck.result.latestTag
                          ? `No ${preferences.updateTrack} release has been published yet`
                          : updateCheck.result.updateAvailable
                            ? `${updateCheck.result.latestTag} is available`
                            : `Ajour ${updateCheck.result.currentVersion} is up to date`}
                      </p>
                      <p className="text-sm leading-5 text-muted-foreground">
                        {!updateCheck.result.latestTag
                          ? `Checked the Ajour GitHub repository ${formatCheckedAt(updateCheck.result.checkedAt)}`
                          : updateCheck.result.updateAvailable
                            ? `Installed ${updateCheck.result.currentVersion} · checked ${formatCheckedAt(updateCheck.result.checkedAt)}`
                            : `Latest ${preferences.updateTrack} release ${updateCheck.result.latestTag} · checked ${formatCheckedAt(updateCheck.result.checkedAt)}`}
                      </p>
                    </>
                  ) : updateCheck.status === "error" ? (
                    <>
                      <p className="text-sm font-medium text-destructive">
                        Update check failed
                      </p>
                      <p className="text-sm leading-5 text-muted-foreground">
                        {updateCheck.message}
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="text-sm font-medium text-foreground">
                        Ready to check
                      </p>
                      <p className="text-sm leading-5 text-muted-foreground">
                        Current version{" "}
                        {window.ajourDesktop?.runtime?.version ?? "unknown"}.
                      </p>
                    </>
                  )}
                  {releaseOpenError ? (
                    <p
                      className="mt-1 text-sm leading-5 text-destructive"
                      role="alert"
                    >
                      Release page could not be opened: {releaseOpenError}
                    </p>
                  ) : null}
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-2 pl-7 desktop:pl-0">
                {updateCheck.status === "success" &&
                updateCheck.result.updateAvailable &&
                updateCheck.result.releaseUrl ? (
                  <Button
                    type="button"
                    size="sm"
                    onClick={() =>
                      void handleOpenRelease(updateCheck.result.releaseUrl!)
                    }
                  >
                    View release
                    <ExternalLink data-icon="inline-end" />
                  </Button>
                ) : null}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={
                    !desktopUpdates || updateCheck.status === "checking"
                  }
                  onClick={() => void runUpdateCheck(preferences.updateTrack)}
                >
                  <Refresh data-icon="inline-start" />
                  {updateCheck.status === "checking"
                    ? "Checking"
                    : "Check again"}
                </Button>
              </div>
            </div>
          </div>
        </AppPanel>
      </section>
    </div>
  );
}
