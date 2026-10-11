import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { DayViewerCard } from "@/components/day-viewer-card";
import { SidePanel } from "@/components/side-panel";
import { formatClockDuration } from "@/domain/time/duration";
import { SubmitWeekButton } from "@/features/time/submit-week-controls";
import {
  TimeEntryEditorForm,
  type TimeEntryEditorFormHandle,
  type TimeEntryEditorTarget,
} from "@/features/time/time-entry-editor-form";
import type { TimeEntryEditorFields } from "@/features/time/time-entry-editor";
import { TimeViewScopeMenu } from "@/features/time/time-view-scope-menu";
import { WeeklyTimeView } from "@/features/time/weekly-time-view";
import { TimerPanel } from "@/features/timer/timer-panel";
import { TimeEntryModal } from "@/features/timer/time-entry-modal";
import { useLocalState } from "@/lib/local-hooks";
import {
  getTimerContributionMs,
  getTimerDurationsMs,
} from "@/lib/timer-totals";
import { useIsNarrowView } from "@/lib/use-narrow-view";
import { cn, getIsoWeekDates, todayIsoDate } from "@/lib/utils";

/** The entry to open: `entryId`, the running `timerId`, or a new entry when both are empty. */
type EntryEditorRequest = { entryId?: string; timerId?: string };

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
  // Week needs a desktop width. The narrow view falls back to Day, and edits
  // entries in a full-width dialog instead of the side panel.
  const isNarrowView = useIsNarrowView();
  const weekAvailable = !isNarrowView;
  const editsInDialog = isNarrowView;
  const isWeekView = search.view === "week" && weekAvailable;
  const editorFormRef = useRef<TimeEntryEditorFormHandle>(null);
  // The unsaved draft of the open entry, kept above the side panel and the dialog so
  // crossing the dialog breakpoint mid-edit hands the draft to the other host.
  const editorDraftRef = useRef<{
    key: string;
    fields: TimeEntryEditorFields;
  } | null>(null);
  const editingEntry =
    search.entry && search.entry !== "new"
      ? state.timesheetEntries.find((entry) => entry._id === search.entry)
      : undefined;
  // The running timer keeps its own dialog until running entries use the shared form.
  const editorTarget: TimeEntryEditorTarget | null = search.timer
    ? null
    : editingEntry
      ? { kind: "edit", entry: editingEntry }
      : search.entry === "new"
        ? { kind: "create", localDate: date }
        : null;
  const editorKey = editingEntry ? editingEntry._id : `new-${date}`;

  useEffect(() => {
    if (!currentTimer) {
      return;
    }

    setNow(Date.now());
    const intervalId = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(intervalId);
  }, [currentTimer]);

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

      totals.set(
        entry.localDate,
        (totals.get(entry.localDate) ?? 0) + entry.durationMs,
      );
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

  const weekTotalMs = Array.from(totalsByDate.values()).reduce(
    (sum, value) => sum + value,
    0,
  );

  /**
   * Saves a valid draft in the side panel before the page shows something else.
   * Returns false when the draft is invalid; the form then shows why.
   */
  function leaveEditorDraft() {
    return editorFormRef.current?.commitBeforeSwitch() ?? true;
  }

  function goToDate(nextDate: string) {
    if (!leaveEditorDraft()) return;
    navigate({
      to: "/time/$date",
      params: { date: nextDate },
      search: isWeekView
        ? ({ view: "week" } as never)
        : ({ view: undefined, entry: undefined, timer: undefined } as never),
    });
  }

  function changeTimeView(nextView: "day" | "week") {
    if (nextView === "week" && leaveEditorDraft()) {
      void navigate({
        to: "/time/$date",
        params: { date },
        search: { view: "week" } as never,
      });
    }
  }

  function closeEditor() {
    editorDraftRef.current = null;
    void navigate({
      to: "/time/$date",
      params: { date },
      search: isWeekView
        ? ({ view: "week", entry: undefined, timer: undefined } as never)
        : ({ view: undefined, entry: undefined, timer: undefined } as never),
      replace: true,
    });
  }

  /**
   * Opens an entry, or a new entry on `localDate`, in the editor. Another entry already
   * in the side panel is saved first when valid; an invalid draft keeps it open.
   */
  function openEditor(request: EntryEditorRequest, localDate = date) {
    const entry = request.timerId ? undefined : (request.entryId ?? "new");
    if (entry !== undefined && entry === search.entry && localDate === date) {
      return;
    }
    if (!leaveEditorDraft()) return;

    void navigate({
      to: "/time/$date",
      params: { date: localDate },
      search: {
        entry: request.timerId ? request.entryId : entry,
        timer: request.timerId,
        view: isWeekView ? "week" : undefined,
      } as never,
      // Switching entries in the panel should not stack history entries.
      replace: editorTarget !== null,
    });
  }

  function openSubmitPage() {
    if (!leaveEditorDraft()) return;
    void navigate({
      to: "/time/$date/submit",
      params: { date },
      search: { view: isWeekView ? "week" : undefined } as never,
    });
  }

  const carriedDraft =
    editorDraftRef.current?.key === editorKey
      ? editorDraftRef.current.fields
      : undefined;

  function keepEditorDraft(fields: TimeEntryEditorFields) {
    editorDraftRef.current = { key: editorKey, fields };
  }

  return (
    <div className={cn("time-page-stack", isWeekView && "is-week-view")}>
      <div className="time-page-main">
        {isWeekView ? (
          <WeeklyTimeView
            anchorDate={date}
            now={now}
            weekDates={weekDates}
            activeEntryId={editingEntry?._id}
            onNewEntry={(localDate) => openEditor({}, localDate)}
            onOpenEntry={openEditor}
            onReturnToDay={() => {
              if (!leaveEditorDraft()) return;
              void navigate({
                to: "/time/$date",
                params: { date },
                search: {
                  view: undefined,
                  entry: undefined,
                  timer: undefined,
                } as never,
              });
            }}
            onSelectWeek={goToDate}
            onSubmit={openSubmitPage}
          />
        ) : (
          <>
            <DayViewerCard
              date={date}
              today={today}
              weekDates={weekDates}
              totalLabel="Week total"
              totalValue={formatClockDuration(weekTotalMs)}
              getDayValue={(day) =>
                formatClockDuration(totalsByDate.get(day) ?? 0)
              }
              onSelectDate={goToDate}
              dateScopeControl={
                <TimeViewScopeMenu value="day" onChange={changeTimeView} />
              }
              headerActions={<SubmitWeekButton onClick={openSubmitPage} />}
            />
            {/* The narrow view hides the Day viewer strip, so the button gets its own row. */}
            <div className="flex justify-end px-3 pt-2 desktop:hidden">
              <SubmitWeekButton onClick={openSubmitPage} />
            </div>

            <TimerPanel
              date={date}
              activeEntryId={editingEntry?._id}
              onOpenEntry={openEditor}
            />
          </>
        )}
      </div>

      {editorTarget && !editsInDialog ? (
        <SidePanel
          contentKey={editorKey}
          className="time-entry-side-panel"
          aria-label="Time entry editor"
        >
          <TimeEntryEditorForm
            key={editorKey}
            ref={editorFormRef}
            target={editorTarget}
            initialFields={carriedDraft}
            onFieldsChange={keepEditorDraft}
            onClose={closeEditor}
          />
        </SidePanel>
      ) : null}
      {search.timer || (editorTarget && editsInDialog) ? (
        <TimeEntryModal
          date={date}
          entryId={editingEntry?._id}
          timerId={search.timer}
          initialFields={carriedDraft}
          onFieldsChange={keepEditorDraft}
          onClose={closeEditor}
        />
      ) : null}
    </div>
  );
}
