import { useState } from "react";
import { RiPlayFill, RiStopFill } from "@remixicon/react";
import { Value } from "@/components/ui/value";
import { formatClockDuration } from "@/domain/time/duration";
import { summarizeRunningEntry } from "@/domain/time/running-entry";
import { placeRunningRow } from "@/domain/time/timesheet-entry";
import { TrackButton } from "@/features/layout/compact-timer-controls";
import { DayStrip } from "@/features/time/day-strip";
import type { TimeEntryEditorTarget } from "@/features/time/time-entry-editor-form";
import { useLocalState } from "@/lib/local-hooks";
import { localStore } from "@/lib/local-store";
import {
  getTimerContributionMs,
  getTimerDurationsMs,
} from "@/lib/timer-totals";
import { useRunningClock, useTodayIsoDate } from "@/lib/use-now";
import { cn, getIsoWeekDates } from "@/lib/utils";

export function PanelDays({
  query,
  onEdit,
}: {
  query: string;
  onEdit: (target: TimeEntryEditorTarget) => void;
}) {
  const state = useLocalState();
  const today = useTodayIsoDate();
  const [date, setDate] = useState(today);
  const timer = state.timers[0] ?? null;
  const now = useRunningClock(Boolean(timer));
  const runningMs = getTimerDurationsMs(timer, now).runningDurationMs;
  const contribution = getTimerContributionMs({
    timer,
    timesheetEntries: state.timesheetEntries,
    runningDurationMs: runningMs,
  });
  const week = getIsoWeekDates(date);
  const total = (day: string) =>
    state.timesheetEntries
      .filter((entry) => entry.localDate === day)
      .reduce((sum, entry) => sum + entry.durationMs, 0) +
    (timer?.localDate === day ? contribution : 0);
  const savedRows = state.timesheetEntries
    .filter((entry) => entry.localDate === date)
    .sort((a, b) => a.committedAt - b.committedAt)
    .map((entry) => ({
      _id: entry._id,
      duration: entry.durationMs,
      summary: summarizeRunningEntry(entry, {
        projects: state.projects,
        workItems: state.workItems,
        unsavedDurationMs: 0,
      }),
      target: { kind: "edit" as const, entry },
    }));
  const runningRow =
    timer?.localDate === date
      ? {
          _id: timer._id,
          duration: runningMs,
          summary: summarizeRunningEntry(timer, {
            projects: state.projects,
            workItems: state.workItems,
            unsavedDurationMs: contribution,
          }),
          target: { kind: "running" as const, timer },
        }
      : null;
  const all = placeRunningRow(
    savedRows,
    runningRow ? { row: runningRow, resumedEntryId: timer?.entryId } : null,
  );
  const shown = all.filter((row) =>
    `${row.summary.title} ${row.summary.meta}`
      .toLocaleLowerCase()
      .includes(query.trim().toLocaleLowerCase()),
  );
  return (
    <>
      <DayStrip
        compact
        date={date}
        today={today}
        weekDates={week}
        totalLabel="Week"
        totalValue=""
        getDayValue={(day) => formatClockDuration(total(day))}
        onSelectDate={setDate}
      />
      <ul className="m-0 list-none p-1" aria-label="Time entries">
        {shown.map((row) => (
          <li
            key={row._id}
            className={cn(
              "flex min-h-14 items-center gap-2 border-b px-2",
              row.target.kind === "running" &&
                "border-l-2 border-l-[var(--success)]",
            )}
          >
            <button
              className="min-w-0 flex-1 text-left"
              onClick={() => onEdit(row.target)}
            >
              <span className="block truncate text-sm">
                {row.summary.title}
              </span>
              <span className="mt-1 block truncate text-xs text-muted-foreground">
                {row.summary.meta}
              </span>
            </button>
            <Value>{formatClockDuration(row.duration)}</Value>
            <TrackButton
              label={
                row.target.kind === "running" ? "Stop timer" : "Continue entry"
              }
              onClick={() => {
                if (row.target.kind === "running") {
                  if (
                    localStore
                      .snapshot()
                      .timers.some((item) => item._id === row._id)
                  )
                    localStore.saveTimer(row._id);
                } else localStore.continueTimesheetEntry(row._id);
              }}
            >
              {row.target.kind === "running" ? (
                <RiStopFill className="text-[var(--success)]" />
              ) : (
                <RiPlayFill />
              )}
            </TrackButton>
          </li>
        ))}
        {!shown.length ? (
          <li className="px-2 py-6 text-xs text-muted-foreground">
            {query ? "No matching entries." : "No entries on this day."}
          </li>
        ) : null}
      </ul>
    </>
  );
}
