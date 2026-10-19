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
    <div className="settings-sections">
      <section className="settings-section">
        <h2 className="settings-section-title">Appearance</h2>
        <p className="settings-section-desc">
          Customize how the app looks. Choose between light and dark modes, or
          let it follow your system settings.
        </p>

        <AppPanel>
          <SettingRow
            label="Theme"
            description={
              preferences.themeMode === "system"
                ? `Currently using ${resolvedTheme} mode based on system preference.`
                : THEME_OPTIONS.find(
                    (option) => option.value === preferences.themeMode,
                  )?.description
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
            description="Comfortable rows show the project and remaining estimate. Compact rows are one line, in a narrower sidebar."
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
          <div className="grid grid-cols-2 gap-3 pb-3 desktop:grid-cols-4 desktop:xl:grid-cols-7">
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
            description="Show a compact warning when logged time runs more than 50% over a target."
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
            <Input
              id="pace-tolerance"
              type="number"
              min={0}
              max={100}
              step={5}
              className="w-20"
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
          </SettingRow>
        </AppPanel>
      </section>

      <ApplicationUpdatesSettings />
    </div>
  );
}
