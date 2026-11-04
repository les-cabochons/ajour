import { useEffect, useState } from "react";
import {
  RiComputerLine as Monitor,
  RiMoonLine as Moon,
  RiSunLine as Sun,
} from "@remixicon/react";
import { ApplicationUpdatesSettings } from "@/features/settings/application-updates-settings";
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
  formatDurationHoursInput,
  parseHoursInput,
} from "@/domain/time/duration";
import { getPaceTolerancePercent } from "@/domain/time/week-pace";
import { cn } from "@/lib/utils";
import { useUserPreferences } from "@/lib/local-hooks";
import { localStore } from "@/lib/local-store";
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

export function SettingsGeneralPage() {
  const sidebarLayout = useSidebarLayout();
  const preferences = useUserPreferences();
  const resolvedTheme = useResolvedTheme();
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
        <h2 className="settings-section-title">Sidebar</h2>
        <p className="settings-section-desc">
          How items in the sidebar look and return on this device.
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
          <SettingRow
            label="Density"
            description="Comfortable shows three lines. Compact shows one line in a narrower sidebar."
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
            description="Show a compact warning on a day more than 50% over its target, or a week over its target."
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
            description="Hide days with 0 hours of capacity in the Time day strip and Week layouts. Logged time still counts in weekly totals."
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
            description="Ask before Submit week locks a week that is behind its targets."
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
            description="How far, in percent, the week may run ahead of or behind its targets before Submit week or an agent asks you. Going over the week's target always asks."
          >
            {/* The unit sits in the field, so the value reads alone
                (council round 12). */}
            <div className="relative w-20">
              <Input
                id="pace-tolerance"
                type="number"
                min={0}
                max={100}
                step={5}
                className="w-20 pr-6"
                value={getPaceTolerancePercent(preferences)}
                onChange={(event) => {
                  const value = Number(event.target.value);
                  if (Number.isFinite(value)) {
                    localStore.setUserPreferences({
                      paceTolerancePercent: Math.min(
                        100,
                        Math.max(0, Math.round(value)),
                      ),
                    });
                  }
                }}
              />
              <span
                aria-hidden
                className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-xs text-muted-foreground"
              >
                %
              </span>
            </div>
          </SettingRow>
        </AppPanel>
      </section>

      <ApplicationUpdatesSettings />
    </div>
  );
}
