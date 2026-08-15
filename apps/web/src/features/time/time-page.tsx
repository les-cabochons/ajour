import { useEffect, useMemo, useState } from "react";
import {
  RiCalendar2Line as CalendarDays,
  RiSendPlaneLine as SendHorizontal,
} from "@remixicon/react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { DayViewerCard } from "@/components/day-viewer-card";
import { Button } from "@/components/ui/button";
import { formatClockDuration } from "@/domain/time/duration";
import { SubmitTimesheetModal } from "@/features/time/submit-timesheet-modal";
import { WeeklyTimeView } from "@/features/time/weekly-time-view";
import { TimerPanel } from "@/features/timer/timer-panel";
import { TimeEntryModal } from "@/features/timer/time-entry-modal";
import { useLocalState } from "@/lib/local-hooks";
import {
  getTimerContributionMs,
  getTimerDurationsMs,
} from "@/lib/timer-totals";
import { getIsoWeekDates, todayIsoDate } from "@/lib/utils";

export function TimePage({ date }: { date: string }) {
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as {
    entry?: string;
    timer?: string;
    view?: string;
  };
  const state = useLocalState();
  const [now, setNow] = useState(() => Date.now());
  const today = todayIsoDate();
  const weekDates = useMemo(() => getIsoWeekDates(date), [date]);
  const currentTimer = state.timers[0] ?? null;
  const [isSubmitModalOpen, setIsSubmitModalOpen] = useState(false);
  const [weekAvailable, setWeekAvailable] = useState(() =>
    typeof window !== "undefined"
      ? window.matchMedia("(min-width: 1024px)").matches
      : false,
  );
  const isWeekView = search.view === "week" && weekAvailable;
  const modalEntryId = search.entry && search.entry !== "new" ? search.entry : undefined;
  const modalTimerId = search.timer;
  const modalOpen = search.entry === "new" || Boolean(modalEntryId) || Boolean(modalTimerId);

  useEffect(() => {
    if (!currentTimer) {
      return;
    }

    setNow(Date.now());
    const intervalId = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(intervalId);
  }, [currentTimer]);

  useEffect(() => {
    const media = window.matchMedia("(min-width: 1024px)");
    const handleChange = () => setWeekAvailable(media.matches);
    handleChange();
    media.addEventListener("change", handleChange);
    return () => media.removeEventListener("change", handleChange);
  }, []);

  useEffect(() => {
    if (weekAvailable || search.view !== "week") {
      return;
    }

    void navigate({
      to: "/time/$date",
      params: { date },
      search: { view: undefined, entry: undefined, timer: undefined } as never,
      replace: true,
    });
  }, [date, navigate, search.view, weekAvailable]);

  const totalsByDate = useMemo(() => {
    const totals = new Map(weekDates.map((day) => [day, 0]));

    for (const entry of state.timesheetEntries) {
      if (!totals.has(entry.localDate)) {
        continue;
      }

      totals.set(entry.localDate, (totals.get(entry.localDate) ?? 0) + entry.durationMs);
    }

    if (currentTimer && totals.has(currentTimer.localDate)) {
      const { elapsedDurationMs, runningDurationMs } = getTimerDurationsMs(
        currentTimer,
        now,
      );
      const timerContribution = getTimerContributionMs({
        timer: currentTimer,
        timesheetEntries: state.timesheetEntries,
        elapsedDurationMs,
        runningDurationMs,
      });
      totals.set(
        currentTimer.localDate,
        (totals.get(currentTimer.localDate) ?? 0) + timerContribution,
      );
    }

    return totals;
  }, [currentTimer, now, state.timesheetEntries, weekDates]);

  const weekTotalMs = Array.from(totalsByDate.values()).reduce((sum, value) => sum + value, 0);

  function goToDate(nextDate: string) {
    navigate({
      to: "/time/$date",
      params: { date: nextDate },
      search: isWeekView
        ? ({ view: "week" } as never)
        : ({ view: undefined, entry: undefined, timer: undefined } as never),
    });
  }

  function closeModal() {
    void navigate({
      to: "/time/$date",
      params: { date },
      search: isWeekView
        ? ({ view: "week", entry: undefined, timer: undefined } as never)
        : ({ view: undefined, entry: undefined, timer: undefined } as never),
      replace: true,
    });
  }

  function openModal(target?: { entryId?: string; timerId?: string }) {
    void navigate({
      to: "/time/$date",
      params: { date },
      search: target?.timerId
        ? ({ entry: target.entryId, timer: target.timerId, view: isWeekView ? "week" : undefined } as never)
        : ({ entry: target?.entryId ?? "new", view: isWeekView ? "week" : undefined } as never),
    });
  }

  function openWeekEntry(entryId: string) {
    void navigate({
      to: "/time/$date",
      params: { date },
      search: { entry: entryId, view: "week" } as never,
    });
  }

  function openWeekNewEntry(localDate: string) {
    void navigate({
      to: "/time/$date",
      params: { date: localDate },
      search: { entry: "new", view: "week" } as never,
    });
  }

  return (
    <div className="time-page-stack">
      {isWeekView ? (
        <WeeklyTimeView
          anchorDate={date}
          now={now}
          weekDates={weekDates}
          onNewEntry={openWeekNewEntry}
          onOpenEntry={openWeekEntry}
          onReturnToDay={() => {
            void navigate({
              to: "/time/$date",
              params: { date },
              search: { view: undefined, entry: undefined, timer: undefined } as never,
            });
          }}
          onSelectWeek={goToDate}
          onSubmit={() => setIsSubmitModalOpen(true)}
        />
      ) : (
      <>
      <DayViewerCard
        date={date}
        today={today}
        weekDates={weekDates}
        totalLabel="Week total"
        totalValue={formatClockDuration(weekTotalMs)}
        getDayValue={(day) => formatClockDuration(totalsByDate.get(day) ?? 0)}
        onSelectDate={goToDate}
        headerActions={
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="day-viewer-week-pill"
              aria-label="Open week overview"
              onClick={() => {
                void navigate({
                  to: "/time/$date",
                  params: { date },
                  search: { view: "week" } as never,
                });
              }}
            >
              <CalendarDays data-icon="inline-start" />
              <span>Week overview</span>
            </Button>
            <button
              type="button"
              className="day-viewer-submit-pill"
              aria-label="Submit timesheet"
              onClick={() => setIsSubmitModalOpen(true)}
            >
              <SendHorizontal className="h-4 w-4" />
              <span>Submit</span>
            </button>
          </div>
        }
      />

      <TimerPanel date={date} onOpenEntry={openModal} />
      </>
      )}

      {modalOpen ? (
        <TimeEntryModal date={date} entryId={modalEntryId} timerId={modalTimerId} onClose={closeModal} />
      ) : null}
      {isSubmitModalOpen ? <SubmitTimesheetModal weekDates={weekDates} onClose={() => setIsSubmitModalOpen(false)} /> : null}
    </div>
  );
}
