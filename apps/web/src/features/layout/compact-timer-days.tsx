import { memo, useMemo, useState } from "react";
import { RiPlayFill, RiStopFill } from "@remixicon/react";
import type { LocalTimer, LocalTimesheetEntry } from "@/domain/local-state";
import { Value } from "@/components/ui/value";
import { formatClockDuration } from "@/domain/time/duration";
import {
  summarizeRunningEntry,
  type RunningEntrySummary,
} from "@/domain/time/running-entry";
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

type EntryRow = {
  _id: string;
  duration: number;
  summary: RunningEntrySummary;
  target: Exclude<TimeEntryEditorTarget, { kind: "create" }>;
};
type EditEntry = (target: TimeEntryEditorTarget) => void;

const EntryRowView = memo(function EntryRowView({
  row,
  onEdit,
}: {
  row: EntryRow;
  onEdit: EditEntry;
}) {
  const running = row.target.kind === "running";
  return (
    <li
      className={cn(
        "flex min-h-14 items-center gap-2 border-b px-2",
        running && "border-l-2 border-l-[var(--success)]",
      )}
    >
      <button
        className="min-w-0 flex-1 text-left"
        onClick={() => onEdit(row.target)}
      >
        <span className="block truncate text-sm">{row.summary.title}</span>
        <span className="mt-1 block truncate text-xs text-muted-foreground">
          {row.summary.meta}
        </span>
      </button>
      <Value>{formatClockDuration(row.duration)}</Value>
      <TrackButton
        label={running ? "Stop timer" : "Continue entry"}
        onClick={() => {
          if (running) {
            if (
              localStore.snapshot().timers.some((item) => item._id === row._id)
            )
              localStore.saveTimer(row._id);
          } else localStore.continueTimesheetEntry(row._id);
        }}
      >
        {running ? (
          <RiStopFill className="text-[var(--success)]" />
        ) : (
          <RiPlayFill />
        )}
      </TrackButton>
    </li>
  );
});

function RunningRow({ row, onEdit }: { row: EntryRow; onEdit: EditEntry }) {
  const now = useRunningClock(true);
  if (row.target.kind !== "running") return null;
  const duration = getTimerDurationsMs(row.target.timer, now).runningDurationMs;
  return <EntryRowView row={{ ...row, duration }} onEdit={onEdit} />;
}

/** Only the seven small totals tick; saved entries and their controls stay out of the clock. */
function PanelWeek({
  date,
  today,
  totals,
  timer,
  baseline,
  onSelectDate,
}: {
  date: string;
  today: string;
  totals: Map<string, number>;
  timer: LocalTimer | null;
  baseline: LocalTimesheetEntry | undefined;
  onSelectDate: (date: string) => void;
}) {
  const week = getIsoWeekDates(date);
  const now = useRunningClock(Boolean(timer && week.includes(timer.localDate)));
  const contribution = getTimerContributionMs({
    timer,
    timesheetEntries: baseline ? [baseline] : [],
    runningDurationMs: getTimerDurationsMs(timer, now).runningDurationMs,
  });
  return (
    <DayStrip
      compact
      date={date}
      today={today}
      weekDates={week}
      totalLabel="Week"
      totalValue=""
      getDayValue={(day) =>
        formatClockDuration(
          (totals.get(day) ?? 0) +
            (timer?.localDate === day ? contribution : 0),
        )
      }
      onSelectDate={onSelectDate}
    />
  );
}

export function PanelDays({
  query,
  onEdit,
}: {
  query: string;
  onEdit: EditEntry;
}) {
  const state = useLocalState();
  const today = useTodayIsoDate();
  const [date, setDate] = useState(today);
  const timer = state.timers[0] ?? null;
  const totals = useMemo(() => {
    const result = new Map<string, number>();
    for (const entry of state.timesheetEntries)
      result.set(
        entry.localDate,
        (result.get(entry.localDate) ?? 0) + entry.durationMs,
      );
    return result;
  }, [state.timesheetEntries]);
  const savedRows = useMemo<EntryRow[]>(
    () =>
      state.timesheetEntries
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
          target: { kind: "edit", entry },
        })),
    [state.timesheetEntries, state.projects, state.workItems, date],
  );
  const baseline = useMemo(
    () => state.timesheetEntries.find((entry) => entry._id === timer?.entryId),
    [state.timesheetEntries, timer?.entryId],
  );
  const runningRow: EntryRow | null =
    timer?.localDate === date
      ? {
          _id: timer._id,
          duration: 0,
          summary: summarizeRunningEntry(timer, {
            projects: state.projects,
            workItems: state.workItems,
            unsavedDurationMs: 0,
          }),
          target: { kind: "running", timer },
        }
      : null;
  const all = placeRunningRow(
    savedRows,
    runningRow ? { row: runningRow, resumedEntryId: timer?.entryId } : null,
  );
  const shown = all.filter((row) =>
    (row.summary.title + " " + row.summary.meta)
      .toLocaleLowerCase()
      .includes(query.trim().toLocaleLowerCase()),
  );
  return (
    <>
      <PanelWeek
        date={date}
        today={today}
        totals={totals}
        timer={timer}
        baseline={baseline}
        onSelectDate={setDate}
      />
      <ul className="m-0 list-none p-1" aria-label="Time entries">
        {shown.map((row) =>
          row.target.kind === "running" ? (
            <RunningRow key={row._id} row={row} onEdit={onEdit} />
          ) : (
            <EntryRowView key={row._id} row={row} onEdit={onEdit} />
          ),
        )}
        {!shown.length ? (
          <li className="px-2 py-6 text-xs text-muted-foreground">
            {query ? "No matching entries." : "No entries on this day."}
          </li>
        ) : null}
      </ul>
    </>
  );
}
