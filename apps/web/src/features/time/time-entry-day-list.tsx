import type { CSSProperties } from "react";
import { getLocalProjectDisplayName } from "@/domain/local-state";
import { formatClockDuration } from "@/domain/time/duration";
import {
  placeRunningRow,
  selectSortableDayEntries,
} from "@/domain/time/timesheet-entry";
import { useLocalProjects, useLocalState } from "@/lib/local-hooks";
import {
  getTimerContributionMs,
  getTimerDurationsMs,
} from "@/lib/timer-totals";
import { useRunningClock } from "@/lib/use-now";
import { cn } from "@/lib/utils";

/** What a row of the list opens: a saved entry, or the running entry. */
export type TimeEntryDayListRequest = { entryId: string } | { timerId: string };

function formatListDay(localDate: string, weekday: "short" | "long") {
  const date = new Date(`${localDate}T12:00:00`);
  if (Number.isNaN(date.getTime())) return localDate;
  return new Intl.DateTimeFormat("en-CA", {
    weekday,
    month: weekday === "long" ? "long" : "short",
    day: "numeric",
  }).format(date);
}

/**
 * The entries of the editor's date, under the Week's entry editor. Below 1160px
 * the panel covers the right of the Week, often the very day being edited, so
 * the panel shows that day itself: its entries in the Days order, the running
 * entry in place, and the day total. It follows the form's Date.
 *
 * The open entry is marked in place. A draft that is not on this day yet, a new
 * entry or an entry moved by its Date, shows as a dashed "This entry" row with
 * its typed hours. A click on a row opens it through `onOpen`, which saves a
 * valid draft first, as any click on the Week does.
 */
export function TimeEntryDayList({
  localDate,
  current,
  draftDurationMs,
  onOpen,
}: {
  localDate: string;
  /** The entry or running entry open in the editor; empty for a new entry. */
  current: { entryId?: string; timerId?: string };
  /** The draft's typed hours, or `null` while they do not parse. */
  draftDurationMs: number | null;
  onOpen: (request: TimeEntryDayListRequest) => void;
}) {
  const state = useLocalState();
  const projects = useLocalProjects();
  // The running entry, when it counts on this day.
  const timer =
    state.timers[0]?.localDate === localDate ? state.timers[0] : null;
  const now = useRunningClock(timer !== null);
  const entries = selectSortableDayEntries(state.timesheetEntries, localDate);
  const durations = getTimerDurationsMs(timer, now);
  const totalMs =
    entries.reduce((total, entry) => total + entry.durationMs, 0) +
    getTimerContributionMs({
      timer,
      timesheetEntries: state.timesheetEntries,
      ...durations,
    });
  // A continued entry's row turns into the running row in place, as its card does.
  const rows = placeRunningRow(
    entries,
    timer ? { row: timer, resumedEntryId: timer.entryId } : null,
  );
  const isCurrent = (row: (typeof rows)[number]) =>
    row === timer
      ? current.timerId === timer._id
      : !current.timerId && row._id === current.entryId;
  const draftIsListed = rows.some(isCurrent);

  function describe(values: {
    projectId?: string;
    taskId?: string;
    note?: string;
  }) {
    const project = projects.find((p) => p._id === values.projectId);
    const task = project?.tasks.find((t) => t._id === values.taskId);
    const projectName = project
      ? getLocalProjectDisplayName(project)
      : "No project";
    return {
      color: project?.color,
      title: values.note?.trim() || task?.name || projectName,
      context: task ? `${projectName} · ${task.name}` : projectName,
    };
  }

  return (
    <section
      className="time-entry-day-list"
      aria-label={`Entries on ${formatListDay(localDate, "long")}`}
    >
      <h3 className="time-entry-day-list-heading">
        <span>{formatListDay(localDate, "short")}</span>
        <span className="time-entry-day-list-total">
          {formatClockDuration(totalMs)}
        </span>
      </h3>
      {rows.map((row) => {
        const running = row === timer;
        const { color, title, context } = describe(row);
        return (
          <button
            key={row._id}
            type="button"
            className={cn(
              "time-entry-day-list-row",
              running && "is-running",
              isCurrent(row) && "is-current",
            )}
            aria-current={isCurrent(row) ? "true" : undefined}
            style={color ? ({ "--rail": color } as CSSProperties) : undefined}
            onClick={() =>
              onOpen(running ? { timerId: row._id } : { entryId: row._id })
            }
          >
            <span className="time-entry-day-list-text">
              <span>{title}</span>
              <small>{context}</small>
            </span>
            <span className="time-entry-day-list-hours">
              {formatClockDuration(
                "durationMs" in row
                  ? row.durationMs
                  : durations.runningDurationMs,
              )}
            </span>
          </button>
        );
      })}
      {draftIsListed ? null : (
        <div className="time-entry-day-list-row is-draft">
          <span className="time-entry-day-list-text">
            <span>This entry</span>
          </span>
          <span className="time-entry-day-list-hours">
            {draftDurationMs === null
              ? "–"
              : formatClockDuration(draftDurationMs)}
          </span>
        </div>
      )}
    </section>
  );
}
