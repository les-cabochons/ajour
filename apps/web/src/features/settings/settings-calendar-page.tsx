import { useMemo } from "react";
import { AppPanel, MessagePanel, SettingRow } from "@/components/app-surface";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  getLocalProjectDisplayName,
  type CalendarSuggestionSettings,
  type LocalCalendarEventRule,
  type LocalProject,
} from "@/domain/local-state";
import { normalizeCalendarSuggestionSettings } from "@/domain/time/calendar-suggestions";
import { offerUndo } from "@/features/feedback/undo-toast";
import { useCalendarSources } from "@/lib/calendar-suggestions";
import { useLocalState } from "@/lib/local-hooks";
import { localStore } from "@/lib/local-store";

const FILTERS: {
  key: keyof Pick<
    CalendarSuggestionSettings,
    "hideAllDay" | "hideDeclined" | "hideFree" | "hideUnanswered"
  >;
  id: string;
  label: string;
  description: string;
}[] = [
  {
    key: "hideAllDay",
    id: "calendar-hide-all-day",
    label: "Hide all-day events",
    description: "Holidays, trips and other events without a time.",
  },
  {
    key: "hideDeclined",
    id: "calendar-hide-declined",
    label: "Hide meetings you declined",
    description:
      "Needs your email on the calendar connection, or a calendar that lists your reply.",
  },
  {
    key: "hideFree",
    id: "calendar-hide-free",
    label: "Hide events marked free",
    description: "Reminders and other events that do not block your time.",
  },
  {
    key: "hideUnanswered",
    id: "calendar-hide-unanswered",
    label: "Hide meetings you have not answered",
    description:
      "Invitations you have not accepted, declined or marked tentative.",
  },
];

function updateSettings(
  current: CalendarSuggestionSettings,
  patch: Partial<CalendarSuggestionSettings>,
) {
  localStore.setUserPreferences({
    calendarSuggestions: normalizeCalendarSuggestionSettings({
      ...current,
      ...patch,
    }),
  });
}

function meetingTarget(
  rule: LocalCalendarEventRule,
  projects: readonly LocalProject[],
) {
  if (rule.action === "hide") return "Hidden";
  const project = projects.find((item) => item._id === rule.projectId);
  if (!project) return "Project deleted";
  const task = project.tasks.find((item) => item._id === rule.taskId);
  const name = getLocalProjectDisplayName(project);
  return task ? `${name} · ${task.name}` : name;
}

/**
 * Settings > Calendar: which calendar events the Time view suggests, how
 * often it refreshes them, and the meetings Ajour remembers. Shown while a
 * calendar plugin is on.
 */
export function SettingsCalendarPage() {
  const state = useLocalState();
  const sources = useCalendarSources();
  const settings = normalizeCalendarSuggestionSettings(
    state.userPreferences.calendarSuggestions,
  );
  const connectionLabels = useMemo(
    () =>
      new Map(
        sources.map((source) => [
          `${source.pluginId}:${source.connectionId}`,
          source.connectionLabel,
        ]),
      ),
    [sources],
  );
  const rules = [...(state.calendarEventRules ?? [])].sort((left, right) =>
    left.label.localeCompare(right.label),
  );

  return (
    <div className="settings-sections">
      {sources.length === 0 ? (
        <MessagePanel>
          Turn on a calendar plugin and add a connection in Settings, Plugins to
          see your meetings in the Time view.
        </MessagePanel>
      ) : null}

      <section className="settings-section">
        <h2 className="settings-section-title">Suggestions</h2>
        <p className="settings-section-desc">
          Which calendar events the Time view suggests as time entries.
        </p>

        <AppPanel>
          {FILTERS.map((filter) => (
            <SettingRow
              key={filter.key}
              label={filter.label}
              labelFor={filter.id}
              description={filter.description}
            >
              <Switch
                id={filter.id}
                checked={settings[filter.key]}
                onCheckedChange={(checked) =>
                  updateSettings(settings, { [filter.key]: checked })
                }
              />
            </SettingRow>
          ))}
          <SettingRow
            label="Hide events shorter than"
            labelFor="calendar-minimum-minutes"
            description="In minutes. 0 shows every length."
          >
            <Input
              id="calendar-minimum-minutes"
              type="number"
              min={0}
              max={480}
              step={5}
              className="w-20"
              value={settings.minimumMinutes}
              onChange={(event) => {
                const value = Number(event.target.value);
                if (Number.isFinite(value)) {
                  updateSettings(settings, { minimumMinutes: value });
                }
              }}
            />
          </SettingRow>
          <SettingRow
            label="Refresh every"
            labelFor="calendar-refresh-minutes"
            description="In minutes, while Ajour is open. Refresh in the Time view gets them at once."
          >
            <Input
              id="calendar-refresh-minutes"
              type="number"
              min={1}
              max={1440}
              step={5}
              className="w-20"
              value={settings.refreshMinutes}
              onChange={(event) => {
                const value = Number(event.target.value);
                if (Number.isFinite(value) && value >= 1) {
                  updateSettings(settings, { refreshMinutes: value });
                }
              }}
            />
          </SettingRow>
        </AppPanel>
      </section>

      <section className="settings-section">
        <h2 className="settings-section-title">Remembered meetings</h2>
        <p className="settings-section-desc">
          Recurring meetings Ajour fills in for you, and the ones you hid.
          Remove one to choose again next time.
        </p>

        <AppPanel>
          {rules.length === 0 ? (
            <MessagePanel>
              No remembered meetings yet. Add a recurring meeting with Remember
              this meeting checked, and it shows here.
            </MessagePanel>
          ) : (
            rules.map((rule) => (
              <SettingRow
                key={rule._id}
                label={rule.label}
                description={[
                  meetingTarget(rule, state.projects),
                  ...(connectionLabels.size > 1
                    ? [
                        connectionLabels.get(
                          `${rule.pluginId}:${rule.connectionId}`,
                        ) ?? "Removed connection",
                      ]
                    : []),
                ].join(" · ")}
              >
                <Button
                  variant="outline"
                  aria-label={`Remove ${rule.label}`}
                  onClick={() =>
                    offerUndo(localStore.forgetCalendarEventRule(rule._id), {
                      title: `${rule.label} removed.`,
                      subject: "meeting",
                    })
                  }
                >
                  Remove
                </Button>
              </SettingRow>
            ))
          )}
        </AppPanel>
      </section>
    </div>
  );
}
