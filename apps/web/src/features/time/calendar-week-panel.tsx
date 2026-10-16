import { useEffect, useMemo, useRef, useState } from "react";
import { RiCloseLine as X, RiRefreshLine as Refresh } from "@remixicon/react";
import { ObjectActionsButton } from "@/components/object-actions-menu";
import { TooltipButton } from "@/components/tooltip-button";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Value } from "@/components/ui/value";
import {
  getCalendarSuggestionActions,
  type CalendarSuggestionActionId,
} from "@/domain/actions/object-actions";
import { formatClockDuration } from "@/domain/time/duration";
import {
  groupCalendarSuggestionsByDay,
  selectCheckedSuggestions,
  type CalendarSuggestion,
} from "@/domain/time/calendar-suggestions";
import { offerUndo } from "@/features/feedback/undo-toast";
import {
  formatSuggestionTime,
  projectTaskLabel,
} from "@/features/time/calendar-suggestion-format";
import {
  SuggestionPicker,
  useCalendarSuggestionActions,
} from "@/features/time/calendar-suggestions";
import { formatWeekDay } from "@/features/time/weekly-capacity-value";
import {
  useCalendarSuggestions,
  type CalendarRange,
} from "@/lib/calendar-suggestions";
import { CALENDAR_SUGGESTION_ACTION_KEYS } from "@/lib/item-keys";
import { useLocalProjects } from "@/lib/local-hooks";
import { localStore } from "@/lib/local-store";

/**
 * The side panel's Calendar: the week's suggestions by day, with a checkbox
 * each. Suggestions with a project start checked, and one button adds every
 * checked one in one action with one Undo. A suggestion without a project
 * gets a picker, which adds it at once.
 */
export function CalendarWeekPanel({
  range,
  today,
  focusDate,
  onClose,
}: {
  range: CalendarRange;
  today: string;
  /** The day to scroll to, from a Grid count chip. */
  focusDate?: string;
  onClose: () => void;
}) {
  const projects = useLocalProjects();
  const calendar = useCalendarSuggestions(range);
  const actions = useCalendarSuggestionActions();
  // Unchecked keys, so a suggestion that gains a project starts checked.
  const [unchecked, setUnchecked] = useState<Set<string>>(() => new Set());
  const rootRef = useRef<HTMLDivElement>(null);

  const days = useMemo(
    () =>
      [...groupCalendarSuggestionsByDay(calendar.suggestions)]
        .filter(([, day]) => day.visible.length > 0)
        .sort(([left], [right]) => left.localeCompare(right)),
    [calendar.suggestions],
  );
  const { checked, totalMs: checkedMs } = selectCheckedSuggestions(
    calendar.suggestions,
    unchecked,
  );

  useEffect(() => {
    if (!focusDate) return;
    rootRef.current
      ?.querySelector(`[data-calendar-day="${focusDate}"]`)
      ?.scrollIntoView({ block: "start" });
  }, [focusDate, days.length]);

  function toggle(suggestion: CalendarSuggestion, isChecked: boolean) {
    setUnchecked((current) => {
      const next = new Set(current);
      if (isChecked) next.delete(suggestion.key);
      else next.add(suggestion.key);
      return next;
    });
  }

  function addChecked() {
    const result = localStore.acceptCalendarSuggestions(
      checked.map((suggestion) => ({
        suggestion,
        projectId: suggestion.projectId!,
        taskId: suggestion.taskId,
      })),
    );
    const count = result.entryIds.length;
    offerUndo(result.undoToken, {
      title: count === 1 ? "Added 1 entry." : `Added ${count} entries.`,
      subject: "entry",
    });
  }

  function dismissChecked() {
    const count = checked.length;
    offerUndo(localStore.dismissCalendarSuggestions(checked), {
      title:
        count === 1 ? "Dismissed 1 meeting." : `Dismissed ${count} meetings.`,
      subject: "meeting",
    });
  }

  return (
    <div
      ref={rootRef}
      className="calendar-week-panel"
      onKeyDown={(event) => {
        if (
          event.key === "Escape" &&
          !event.defaultPrevented &&
          event.target instanceof Node &&
          event.currentTarget.contains(event.target)
        ) {
          event.preventDefault();
          onClose();
        }
      }}
    >
      <header className="calendar-week-panel-header">
        <h2>Calendar</h2>
        <TooltipButton
          label="Refresh calendar"
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              disabled={calendar.loading}
              onClick={calendar.refresh}
            />
          }
        >
          <Refresh />
        </TooltipButton>
        <TooltipButton
          label="Close"
          render={<Button variant="ghost" size="icon" onClick={onClose} />}
        >
          <X />
        </TooltipButton>
      </header>

      {calendar.errors.map((error) => (
        <p
          key={`${error.source.pluginId}:${error.source.connectionId}`}
          className="calendar-day-section-error"
          role="status"
        >
          {error.source.connectionLabel}: {error.message}
        </p>
      ))}

      <div className="calendar-week-panel-days">
        {days.length === 0 ? (
          <p className="calendar-week-panel-empty">
            {calendar.loading && calendar.fetched.length === 0
              ? "Reading your calendar…"
              : "No meetings to add this week."}
          </p>
        ) : null}
        {days.map(([localDate, day]) => (
          <section
            key={localDate}
            data-calendar-day={localDate}
            aria-label={formatWeekDay(localDate, {
              weekday: "long",
              month: "long",
              day: "numeric",
            })}
          >
            <h3 className="calendar-week-panel-day">
              {formatWeekDay(localDate, { weekday: "short", day: "numeric" })}
              {localDate === today ? " · today" : null}
            </h3>
            {day.visible.map((suggestion) => {
              const rowActions = getCalendarSuggestionActions(suggestion);
              const project = projectTaskLabel(
                projects,
                suggestion.projectId,
                suggestion.taskId,
              );
              return (
                <div key={suggestion.key} className="calendar-week-panel-row">
                  <Checkbox
                    checked={Boolean(
                      suggestion.projectId && !unchecked.has(suggestion.key),
                    )}
                    disabled={!suggestion.projectId}
                    aria-label={`Add ${suggestion.title}`}
                    onCheckedChange={(next) => toggle(suggestion, next)}
                  />
                  <div className="calendar-week-panel-meta">
                    <span className="calendar-week-panel-title">
                      {suggestion.title}
                    </span>
                    <span className="calendar-week-panel-sub">
                      <span className="calendar-suggestion-time">
                        {formatSuggestionTime(suggestion)}
                      </span>
                      {project ? (
                        <span className="calendar-week-panel-project">
                          {project.task
                            ? `${project.name} · ${project.task}`
                            : project.name}
                        </span>
                      ) : null}
                    </span>
                    {project ? null : (
                      <SuggestionPicker
                        suggestion={suggestion}
                        actions={actions}
                        projects={projects}
                        className="mt-1 h-7 text-xs"
                      />
                    )}
                  </div>
                  <Value className="calendar-week-panel-duration">
                    {formatClockDuration(suggestion.durationMs)}
                  </Value>
                  <ObjectActionsButton
                    actions={rowActions}
                    keys={CALENDAR_SUGGESTION_ACTION_KEYS}
                    onAction={(actionId: CalendarSuggestionActionId) =>
                      actions.run(suggestion, actionId)
                    }
                    label="Meeting actions"
                  />
                </div>
              );
            })}
          </section>
        ))}
      </div>

      <footer className="calendar-week-panel-footer">
        <Button disabled={checked.length === 0} onClick={addChecked}>
          {checked.length === 1
            ? `Add 1 entry · ${formatClockDuration(checkedMs)}`
            : `Add ${checked.length} entries · ${formatClockDuration(checkedMs)}`}
        </Button>
        <Button
          variant="ghost"
          disabled={checked.length === 0}
          onClick={dismissChecked}
        >
          Dismiss
        </Button>
      </footer>
    </div>
  );
}
