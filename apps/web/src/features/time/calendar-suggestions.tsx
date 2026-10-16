import { useMemo, useState, type CSSProperties } from "react";
import {
  RiCloseLine as Close,
  RiRefreshLine as Refresh,
} from "@remixicon/react";
import {
  ObjectActionsButton,
  ObjectContextMenu,
} from "@/components/object-actions-menu";
import { TooltipButton } from "@/components/tooltip-button";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { Value } from "@/components/ui/value";
import {
  getCalendarSuggestionActions,
  type CalendarSuggestionActionId,
} from "@/domain/actions/object-actions";
import {
  getLocalProjectDisplayName,
  type LocalProject,
} from "@/domain/local-state";
import { formatClockDuration } from "@/domain/time/duration";
import {
  groupCalendarSuggestionsByDay,
  type CalendarHiddenReason,
  type CalendarSuggestion,
} from "@/domain/time/calendar-suggestions";
import { offerUndo } from "@/features/feedback/undo-toast";
import { ProjectTaskPicker } from "@/features/projects/project-task-picker";
import {
  useCalendarSuggestions,
  type CalendarRange,
} from "@/lib/calendar-suggestions";
import {
  CALENDAR_SUGGESTION_ACTION_KEYS,
  handleItemKeyDown,
} from "@/lib/item-keys";
import { useLocalProjects } from "@/lib/local-hooks";
import { localStore } from "@/lib/local-store";
import { cn } from "@/lib/utils";

/*
 * Calendar suggestions in the Time view: a section under the Day view's
 * entries and cards under each Days column. Every surface runs the same
 * actions through `useCalendarSuggestionActions`. The copy says meeting,
 * never rule, series or occurrence.
 */

const HIDDEN_REASON_LABELS: Record<CalendarHiddenReason, string> = {
  allDay: "All day",
  declined: "Declined",
  free: "Free",
  unanswered: "Not answered",
  short: "Short",
};

const timeFormat = new Intl.DateTimeFormat(undefined, {
  hour: "2-digit",
  minute: "2-digit",
});

/** "09:00 – 09:15", "09:00–09:15" when `compact`, or "All day". */
function formatSuggestionTime(
  suggestion: CalendarSuggestion,
  { compact = false } = {},
) {
  return suggestion.allDay
    ? "All day"
    : [
        timeFormat.format(suggestion.startsAt),
        timeFormat.format(suggestion.endsAt),
      ].join(compact ? "–" : " – ");
}

function projectTaskLabel(
  projects: readonly LocalProject[],
  projectId: string | undefined,
  taskId: string | undefined,
) {
  const project = projects.find((item) => item._id === projectId);
  if (!project) return undefined;
  const task = project.tasks.find((item) => item._id === taskId);
  const name = getLocalProjectDisplayName(project);
  return { name, task: task?.name, color: project.color };
}

/**
 * Runs suggestion actions for every surface. `openPicker` is which
 * suggestion's project picker is open, for the menu's "Choose project…".
 */
export function useCalendarSuggestionActions() {
  const [openPicker, setOpenPicker] = useState<string | null>(null);

  function add(
    suggestion: CalendarSuggestion,
    selection: { projectId: string; taskId?: string },
    remember: boolean,
  ) {
    const result = localStore.acceptCalendarSuggestions([
      {
        suggestion,
        projectId: selection.projectId,
        taskId: selection.taskId || undefined,
        remember: remember && Boolean(suggestion.seriesId),
      },
    ]);
    offerUndo(result.undoToken, {
      title: `Added ${suggestion.title}.`,
      subject: "entry",
    });
  }

  function run(
    suggestion: CalendarSuggestion,
    actionId: CalendarSuggestionActionId,
  ) {
    switch (actionId) {
      case "add":
        if (suggestion.projectId) {
          add(
            suggestion,
            { projectId: suggestion.projectId, taskId: suggestion.taskId },
            false,
          );
        } else {
          setOpenPicker(suggestion.key);
        }
        return;
      case "choose-project":
        setOpenPicker(suggestion.key);
        return;
      case "dismiss":
        offerUndo(localStore.dismissCalendarSuggestions([suggestion]), {
          title: `Dismissed ${suggestion.title}.`,
          subject: "meeting",
        });
        return;
      case "hide-meeting":
        offerUndo(localStore.hideCalendarMeeting(suggestion), {
          title: `${suggestion.title} hidden. Settings, Calendar can bring it back.`,
          subject: "meeting",
        });
        return;
      case "forget-meeting":
        if (suggestion.ruleId) {
          offerUndo(localStore.forgetCalendarEventRule(suggestion.ruleId), {
            title: `Ajour no longer fills in ${suggestion.title}.`,
            subject: "meeting",
          });
        }
        return;
    }
  }

  return { openPicker, setOpenPicker, add, run };
}

type SuggestionActions = ReturnType<typeof useCalendarSuggestionActions>;

/**
 * The project and task picker of a suggestion. Choosing adds the entry, and
 * remembers the choice for a recurring meeting.
 */
function SuggestionPicker({
  suggestion,
  actions,
  projects,
  className,
}: {
  suggestion: CalendarSuggestion;
  actions: SuggestionActions;
  projects: LocalProject[];
  className?: string;
}) {
  return (
    <ProjectTaskPicker
      projects={projects}
      projectId={suggestion.projectId ?? ""}
      taskId={suggestion.taskId ?? ""}
      allowNoProject={false}
      placeholder="Choose project…"
      ariaLabel={`Project for ${suggestion.title}`}
      className={className}
      open={actions.openPicker === suggestion.key}
      onOpenChange={(open) =>
        actions.setOpenPicker(open ? suggestion.key : null)
      }
      onChange={(selection) => {
        if (selection.projectId) {
          actions.add(suggestion, selection, true);
        }
      }}
    />
  );
}

/**
 * The Day view's "From your calendar" section: one row per suggestion of the
 * day, then how many the Settings filters hide, with Show hidden.
 */
export function CalendarDaySection({
  date,
  range,
}: {
  date: string;
  range: CalendarRange;
}) {
  const projects = useLocalProjects();
  const calendar = useCalendarSuggestions(range);
  const actions = useCalendarSuggestionActions();
  const [showHidden, setShowHidden] = useState(false);
  const day = useMemo(
    () =>
      groupCalendarSuggestionsByDay(calendar.suggestions).get(date) ?? {
        visible: [],
        hidden: [],
      },
    [calendar.suggestions, date],
  );

  if (!calendar.hasCalendar) return null;
  if (
    day.visible.length === 0 &&
    day.hidden.length === 0 &&
    calendar.errors.length === 0
  ) {
    return null;
  }

  const rows = showHidden ? [...day.visible, ...day.hidden] : day.visible;

  return (
    <section className="calendar-day-section" aria-label="From your calendar">
      <header className="calendar-day-section-header">
        <h2>From your calendar</h2>
        {day.visible.length > 0 ? <Chip>{day.visible.length}</Chip> : null}
        <TooltipButton
          label="Refresh calendar"
          className="calendar-day-section-refresh"
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
      <div className="calendar-suggestion-rows" data-focus-scope>
        {rows.map((suggestion) => (
          <SuggestionRow
            key={suggestion.key}
            suggestion={suggestion}
            actions={actions}
            projects={projects}
          />
        ))}
      </div>
      {day.hidden.length > 0 ? (
        <p className="calendar-day-section-footer">
          {day.hidden.length === 1
            ? "1 event hidden by your calendar settings."
            : `${day.hidden.length} events hidden by your calendar settings.`}{" "}
          <button
            type="button"
            className="calendar-day-section-toggle"
            onClick={() => setShowHidden((shown) => !shown)}
          >
            {showHidden ? "Hide them" : "Show hidden"}
          </button>
        </p>
      ) : null}
    </section>
  );
}

function SuggestionRow({
  suggestion,
  actions,
  projects,
}: {
  suggestion: CalendarSuggestion;
  actions: SuggestionActions;
  projects: LocalProject[];
}) {
  const rowActions = getCalendarSuggestionActions(suggestion);
  const run = (actionId: CalendarSuggestionActionId) =>
    actions.run(suggestion, actionId);

  return (
    <ObjectContextMenu
      actions={rowActions}
      keys={CALENDAR_SUGGESTION_ACTION_KEYS}
      onAction={run}
      render={
        <div
          className={cn(
            "calendar-suggestion-row",
            suggestion.hiddenBy && "is-filtered",
          )}
          tabIndex={0}
          data-focus-column="0"
          aria-label={`${suggestion.title}, ${formatSuggestionTime(suggestion)}`}
          onKeyDown={(event) =>
            handleItemKeyDown(event, {
              actions: rowActions,
              keys: CALENDAR_SUGGESTION_ACTION_KEYS,
              onAction: run,
            })
          }
        />
      }
    >
      <span className="calendar-suggestion-time">
        {formatSuggestionTime(suggestion)}
      </span>
      <span className="calendar-suggestion-title">
        {suggestion.title}
        {suggestion.hiddenBy ? (
          <Chip className="calendar-suggestion-reason">
            {HIDDEN_REASON_LABELS[suggestion.hiddenBy]}
          </Chip>
        ) : null}
      </span>
      <SuggestionPicker
        suggestion={suggestion}
        actions={actions}
        projects={projects}
        className="calendar-suggestion-picker h-7"
      />
      <Value className="calendar-suggestion-duration">
        {formatClockDuration(suggestion.durationMs)}
      </Value>
      <Button
        size="sm"
        disabled={!suggestion.projectId}
        onClick={() => run("add")}
      >
        Add
      </Button>
      <TooltipButton
        label="Dismiss"
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground"
            onClick={() => run("dismiss")}
          />
        }
      >
        <Close />
      </TooltipButton>
      <ObjectActionsButton
        actions={rowActions}
        keys={CALENDAR_SUGGESTION_ACTION_KEYS}
        onAction={run}
        label="Meeting actions"
      />
    </ObjectContextMenu>
  );
}

/**
 * A Days column's suggestions, under its entry cards: dashed cards with the
 * time, the title and the project, or a picker. A card with a project adds
 * on click and Enter.
 */
export function CalendarDayCards({
  suggestions,
  focusColumn,
  actions,
}: {
  suggestions: readonly CalendarSuggestion[];
  focusColumn: number;
  actions: SuggestionActions;
}) {
  const projects = useLocalProjects();
  if (suggestions.length === 0) return null;

  return (
    <div className="calendar-day-cards" role="group" aria-label="From calendar">
      <span className="calendar-day-cards-label">From calendar</span>
      {suggestions.map((suggestion) => {
        const cardActions = getCalendarSuggestionActions(suggestion);
        const run = (actionId: CalendarSuggestionActionId) =>
          actions.run(suggestion, actionId);
        const project = projectTaskLabel(
          projects,
          suggestion.projectId,
          suggestion.taskId,
        );
        return (
          <ObjectContextMenu
            key={suggestion.key}
            actions={cardActions}
            keys={CALENDAR_SUGGESTION_ACTION_KEYS}
            onAction={run}
            render={
              <div
                className="calendar-suggestion-card"
                role="button"
                tabIndex={0}
                data-focus-column={focusColumn}
                aria-label={`Suggested: ${suggestion.title}, ${formatSuggestionTime(suggestion)}${project ? `, ${project.name}` : ""}`}
                style={
                  project
                    ? ({ "--project-color": project.color } as CSSProperties)
                    : undefined
                }
                onClick={(event) => {
                  // The picker's list is a portal whose clicks still bubble
                  // here, and the card's own buttons act for themselves.
                  const target = event.target;
                  if (
                    target instanceof Element &&
                    event.currentTarget.contains(target) &&
                    !target.closest("button")
                  ) {
                    run("add");
                  }
                }}
                onKeyDown={(event) => {
                  if (
                    event.target === event.currentTarget &&
                    event.key === " "
                  ) {
                    event.preventDefault();
                    run("add");
                    return;
                  }
                  handleItemKeyDown(event, {
                    actions: cardActions,
                    keys: CALENDAR_SUGGESTION_ACTION_KEYS,
                    onAction: run,
                  });
                }}
              />
            }
          >
            <div className="calendar-suggestion-card-time">
              <span>{formatSuggestionTime(suggestion, { compact: true })}</span>
              <ObjectActionsButton
                actions={cardActions}
                keys={CALENDAR_SUGGESTION_ACTION_KEYS}
                onAction={run}
                label="Meeting actions"
              />
            </div>
            <span className="calendar-suggestion-card-title">
              {suggestion.title}
            </span>
            {project ? (
              <span className="calendar-suggestion-card-project">
                <span>
                  {project.task
                    ? `${project.name} · ${project.task}`
                    : project.name}
                </span>
                <span className="calendar-suggestion-card-add">Add</span>
              </span>
            ) : (
              <SuggestionPicker
                suggestion={suggestion}
                actions={actions}
                projects={projects}
                className="calendar-suggestion-card-picker mt-0.5 h-[26px] px-2 text-xs"
              />
            )}
          </ObjectContextMenu>
        );
      })}
    </div>
  );
}
