import { useEffect, useState } from "react";
import {
  RiComputerLine as Monitor,
  RiMoonLine as Moon,
  RiSunLine as Sun,
} from "@remixicon/react";
import { ApplicationUpdatesSettings } from "@/features/settings/application-updates-settings";
import { CliCommandSetting } from "@/features/settings/cli-command-setting";
import { KeepRunningSetting } from "@/features/settings/keep-running-setting";
import { AppPanel, SettingRow } from "@/components/app-surface";
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
import type { ThemeMode, WeeklyCapacityTargets } from "@/domain/local-state";
import {
  formatClockDuration,
  DAY_CAPACITY_LIMIT,
  formatDurationHoursInput,
  readDurationInput,
} from "@/domain/time/duration";
import {
  computePaceRange,
  getPaceTolerancePercent,
} from "@/domain/time/week-pace";
import { cn, getIsoWeekDates, todayIsoDate } from "@/lib/utils";
import { useUserPreferences } from "@/lib/local-hooks";
import { localStore } from "@/lib/local-store";
import { useNumberDraft } from "@/lib/number-draft";
import { getThemeModeLabel, useResolvedTheme } from "@/lib/use-theme";

const THEME_OPTIONS: Array<{
  value: ThemeMode;
  icon: typeof Sun;
}> = [
  {
    value: "system",
    icon: Monitor,
  },
  {
    value: "light",
    icon: Sun,
  },
  {
    value: "dark",
    icon: Moon,
  },
];

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

/**
 * A weekday's capacity target. Enter or leaving the field saves it. Hours it
 * can't read, or more than 24:00, keep the typed text with a message under it.
 */
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
  const [error, setError] = useState<string | null>(null);
  const id = `capacity-${label.toLowerCase()}`;
  const errorId = `${id}-error`;

  useEffect(() => {
    setDraft(formatDurationHoursInput(value));
    setError(null);
  }, [value]);

  function commit(text: string) {
    if (!text.trim()) {
      setDraft(formatDurationHoursInput(value));
      setError(null);
      return;
    }
    const typed = readDurationInput(text, DAY_CAPACITY_LIMIT);
    if (!typed.ok) {
      setError(typed.error);
      return;
    }
    setError(null);
    setDraft(formatDurationHoursInput(typed.durationMs));
    if (typed.durationMs !== value) onCommit(typed.durationMs);
  }

  return (
    <Field data-invalid={error ? true : undefined}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        id={id}
        className="settings-time-input font-mono"
        value={draft}
        // The format to type, as every hours field shows it.
        placeholder="0:00"
        // A text keyboard: a numeric keypad has no ":" or "h" for "7:30" or "7h30".
        inputMode="text"
        autoComplete="off"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        onChange={(event) => {
          setDraft(event.target.value);
          setError(null);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.nativeEvent.isComposing) {
            event.preventDefault();
            commit(event.currentTarget.value);
          }
        }}
        onBlur={(event) => commit(event.target.value)}
      />
      {error ? (
        <span id={errorId} className="field-error">
          {error}
        </span>
      ) : null}
    </Field>
  );
}

export function SettingsGeneralPage() {
  const sidebarLayout = useSidebarLayout();
  const preferences = useUserPreferences();
  const resolvedTheme = useResolvedTheme();
  const today = todayIsoDate();
  const paceRange = computePaceRange({
    weekDates: getIsoWeekDates(today),
    today,
    capacityTargets: preferences.weeklyCapacityTargets,
    tolerancePercent: getPaceTolerancePercent(preferences),
  });
  // Saves each valid keystroke, so the range under the field follows the
  // typed percent (council round 21).
  const paceToleranceDraft = useNumberDraft({
    value: getPaceTolerancePercent(preferences),
    rule: {
      min: 0,
      max: 100,
      integer: true,
      message: "Enter a whole percent from 0 to 100.",
    },
    live: true,
    onCommit: (paceTolerancePercent) =>
      localStore.setUserPreferences({ paceTolerancePercent }),
  });
  const handleThemeChange = (mode: ThemeMode) => {
    localStore.setUserPreferences({ themeMode: mode });
  };

  return (
    // Labels and controls within one 672px measure (council round 6).
    <div className="settings-sections settings-measure">
      <section className="settings-section">
        {/* The heading and the control say it all: no introduction, and a
            description only where it adds the resolved mode (council round
            10). */}
        <h2 className="settings-section-title">Appearance</h2>

        <AppPanel>
          <SettingRow
            label="Theme"
            description={
              preferences.themeMode === "system"
                ? `Currently using ${resolvedTheme} mode based on system preference.`
                : undefined
            }
          >
            <ToggleGroup
              aria-label="Theme"
              variant="outline"

              value={[preferences.themeMode]}
              onValueChange={(next) => {
                const mode = next[0] as ThemeMode | undefined;
                if (mode) handleThemeChange(mode);
              }}
            >
              {THEME_OPTIONS.map((option) => {
                const Icon = option.icon;
                return (
                  <ToggleGroupItem key={option.value} value={option.value}>
                    <Icon data-icon="inline-start" />
                    {getThemeModeLabel(option.value)}
                  </ToggleGroupItem>
                );
              })}
            </ToggleGroup>
          </SettingRow>
        </AppPanel>
      </section>

      <section className="settings-section">
        <h2 className="settings-section-title">Snoozing</h2>
        <p className="settings-section-desc">
          When snoozed items come back on this device.
        </p>

        <AppPanel>
          <SettingRow
            label="Changes end a snooze early"
            labelFor="changes-end-snooze"
            description="Return pull requests when someone asks you to act, and backlog items when their source state or priority changes."
          >
            <Switch
              id="changes-end-snooze"
              checked={preferences.changesEndSnoozeEarly === true}
              onCheckedChange={(checked) =>
                localStore.setUserPreferences({
                  changesEndSnoozeEarly: checked,
                })
              }
            />
          </SettingRow>
        </AppPanel>
      </section>

      {/* The narrow view has no sidebar to set up. */}
      <section className="settings-section narrow:hidden">
        <h2 className="settings-section-title">Sidebar</h2>
        <p className="settings-section-desc">
          How items in the sidebar look on this device.
        </p>

        <AppPanel>
          <SettingRow
            label="Density"
            description="Three lines, or one line in a narrower sidebar."
          >
            <ToggleGroup
              aria-label="Sidebar density"
              variant="outline"

              value={[sidebarLayout.density]}
              onValueChange={(next) => {
                const density = next[0] as SidebarDensity | undefined;
                if (density) updateSidebarLayout({ density });
              }}
            >
              <ToggleGroupItem value="comfortable">Comfortable</ToggleGroupItem>
              <ToggleGroupItem value="compact">Compact</ToggleGroupItem>
            </ToggleGroup>
          </SettingRow>
        </AppPanel>
      </section>

      <section className="settings-section">
        <h2 className="settings-section-title">Time capacity</h2>
        <p className="settings-section-desc">
          Set the target for each weekday and choose which capacity warnings
          Ajour shows.
        </p>

        <AppPanel>
          <div className="grid grid-cols-2 gap-3 pb-3 desktop:max-w-2xl desktop:grid-cols-4 desktop:xl:grid-cols-7">
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
          <SettingRow
            label="Over-capacity warning"
            labelFor="warn-over-capacity"
            description="Warn when a day exceeds 150% of its target or a week exceeds its target."
          >
            <Switch
              id="warn-over-capacity"
              checked={preferences.warnWhenOverCapacity}
              onCheckedChange={(checked) =>
                localStore.setUserPreferences({
                  warnWhenOverCapacity: checked,
                })
              }
            />
          </SettingRow>
          <SettingRow
            label="Hide non-working days"
            labelFor="hide-non-working-days"
            description="Hide zero-capacity days in Time. Their logged hours still count in weekly totals."
          >
            <Switch
              id="hide-non-working-days"
              checked={preferences.hideNonWorkingDays === true}
              onCheckedChange={(checked) =>
                localStore.setUserPreferences({ hideNonWorkingDays: checked })
              }
            />
          </SettingRow>
          <SettingRow
            label="Under-target submit warning"
            labelFor="warn-under-capacity"
            description="Ask for confirmation before submitting a week below target."
          >
            <Switch
              id="warn-under-capacity"
              checked={preferences.warnWhenSubmittingUnderCapacity}
              onCheckedChange={(checked) =>
                localStore.setUserPreferences({
                  warnWhenSubmittingUnderCapacity: checked,
                })
              }
            />
          </SettingRow>
          <SettingRow
            label="Pace tolerance"
            labelFor="pace-tolerance"
            description="Ask before submitting when the time logged is this far from the targets through today. Going over the week's target always asks."
          >
            {/* The unit sits in the field, so the value reads alone
                (council round 12); the range it allows today sits under it,
                from the user's own targets (council round 21). */}
            <div className="flex flex-col items-start gap-1 desktop:items-end">
              <div className="relative w-20">
                <Input
                  id="pace-tolerance"
                  aria-describedby={
                    paceRange.targetMs ? "pace-range" : undefined
                  }
                  type="number"
                  min={0}
                  max={100}
                  step={5}
                  className="w-20 pr-6"
                  {...paceToleranceDraft.inputProps}
                />
                <span
                  aria-hidden
                  className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-xs text-muted-foreground"
                >
                  %
                </span>
              </div>
              {paceToleranceDraft.error ? (
                <p
                  role="alert"
                  className="max-w-36 text-left text-xs text-destructive desktop:text-right"
                >
                  {paceToleranceDraft.error}
                </p>
              ) : null}
              {paceRange.targetMs ? (
                <p
                  id="pace-range"
                  // Names the period, so the range never reads as today's
                  // hours alone (council round 22).
                  className="max-w-36 text-left text-xs text-[var(--text-secondary)] tabular-nums desktop:text-right"
                >
                  Week through today: {formatClockDuration(paceRange.lowMs)}–
                  {formatClockDuration(paceRange.highMs)}
                </p>
              ) : null}
            </div>
          </SettingRow>
        </AppPanel>
      </section>

      <KeepRunningSetting />

      <CliCommandSetting />

      <ApplicationUpdatesSettings />
    </div>
  );
}
