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
import { useNumberDraft, type NumberDraftRule } from "@/lib/number-draft";
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
 * A minutes field that saves on Enter or when focus leaves it. It can be
 * empty while the user types; a value out of range says why under the
 * description and saves nothing.
 */
function CalendarNumberRow({
  id,
  label,
  description,
  value,
  rule,
  onCommit,
}: {
  id: string;
  label: string;
  description: string;
  value: number;
  rule: NumberDraftRule;
  onCommit: (value: number) => void;
}) {
  const { inputProps, error } = useNumberDraft({ value, rule, onCommit });
  return (
    <SettingRow
      label={label}
      labelFor={id}
      description={
        <>
          {description}
          {error ? (
            <span role="alert" className="mt-1 block text-destructive">
              {error}
            </span>
          ) : null}
        </>
      }
    >
      <Input
        id={id}
        type="number"
        min={rule.min}
        max={rule.max}
        step={5}
        className="w-20"
        {...inputProps}
      />
    </SettingRow>
  );
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
    <div className="settings-sections settings-measure">
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
          <CalendarNumberRow
            id="calendar-minimum-minutes"
            label="Hide events shorter than"
            description="In minutes. 0 shows every length."
            value={settings.minimumMinutes}
            rule={{
              min: 0,
              max: 480,
              integer: true,
              message: "Enter a whole number of minutes from 0 to 480.",
            }}
            onCommit={(minimumMinutes) =>
              updateSettings(settings, { minimumMinutes })
            }
          />
          <CalendarNumberRow
            id="calendar-refresh-minutes"
            label="Refresh every"
            description="In minutes, while Ajour is open. Refresh in the Time view gets them at once."
            value={settings.refreshMinutes}
            rule={{
              min: 1,
              max: 1440,
              integer: true,
              message: "Enter a whole number of minutes from 1 to 1440.",
            }}
            onCommit={(refreshMinutes) =>
              updateSettings(settings, { refreshMinutes })
            }
          />
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
              No remembered meetings yet. Choose a project for a recurring
              meeting in the Time view, and it shows here.
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
