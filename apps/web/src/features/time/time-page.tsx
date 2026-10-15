import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { RiAddLine as Plus } from "@remixicon/react";
import { MessagePanel } from "@/components/app-surface";
import { SidePanel } from "@/components/side-panel";
import { Button } from "@/components/ui/button";
import { findPinnedTask } from "@/domain/projects/project-transitions";
import { formatClockDuration } from "@/domain/time/duration";
import { getVisibleWeekDates } from "@/domain/time/weekly-time";
import {
  TimeEntryEditorForm,
  type TimeEntryEditorFormHandle,
  type TimeEntryEditorTarget,
} from "@/features/time/time-entry-editor-form";
import type { TimeEntryEditorFields } from "@/features/time/time-entry-editor";
import { DayStrip } from "@/features/time/day-strip";
import { TimePageHeader } from "@/features/time/time-page-header";
import {
  formatAddAnotherEntryLabel,
  isSameWeekGridCell,
  type WeekGridCell,
} from "@/features/time/week-grid";
import { WeekGridCellPanel } from "@/features/time/week-grid-cell-panel";
import { WeeklyTimeView } from "@/features/time/weekly-time-view";
import { TimerPanel } from "@/features/timer/timer-panel";
import { TimeEntryModal } from "@/features/timer/time-entry-modal";
import { useLocalState, useUserPreferences } from "@/lib/local-hooks";
import { localStore } from "@/lib/local-store";
import { useShortcut } from "@/lib/shortcut-handlers";
import { useActionRequest } from "@/lib/action-request";
import {
  getTimerContributionMs,
  getTimerDurationsMs,
} from "@/lib/timer-totals";
import { useIsNarrowView } from "@/lib/use-narrow-view";
import { useRunningClock } from "@/lib/use-now";
import { addDaysIsoDate, cn, getIsoWeekDates, todayIsoDate } from "@/lib/utils";

/**
 * The entry to open: `entryId`, the running `timerId`, or a new entry when both are
 * empty. `cell` is the Week Grid cell it came from: a new entry gets the cell's
 * project, task and day, and the panel offers to add another entry to the cell.
 * `task` fills in a new entry's project and task, as a pinned task's digit does.
 */
type EntryEditorRequest = {
  entryId?: string;
  timerId?: string;
  cell?: WeekGridCell;
  task?: { projectId: string; taskId: string };
};

export function TimePage({ date }: { date: string }) {
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as {
    entry?: string;
    timer?: string;
    view?: string;
    /** The project and task a new entry starts with, such as a pinned task. */
    project?: string;
    task?: string;
  };
  const state = useLocalState();
  const preferences = useUserPreferences();
  const today = todayIsoDate();
  const weekDates = useMemo(() => getIsoWeekDates(date), [date]);
  const currentTimer = state.timers[0] ?? null;
  // Week needs a desktop width. The narrow view does not offer it: a Week link
  // shows Day with a note and keeps `view=week`, so widening the window shows
  // Week. A remembered Week shows Day without the note. The narrow view also edits entries in a full-width dialog instead of
  // the side panel.
  const isNarrowView = useIsNarrowView();
  const weekAvailable = !isNarrowView;
  const editsInDialog = isNarrowView;
  // `view=week` and `view=day` pick a view. A link without `view`, such as the
  // sidebar's Time link, opens the view the user last picked.
  const wantsWeek =
    search.view === "week" ||
    (search.view !== "day" && preferences.timeView === "week");
  const isWeekView = wantsWeek && weekAvailable;
  const showsWeekUnavailableNote = search.view === "week" && !weekAvailable;
  const editorFormRef = useRef<TimeEntryEditorFormHandle>(null);
  // The unsaved draft of the open entry, kept above the side panel and the dialog so
  // crossing the dialog breakpoint mid-edit hands the draft to the other host.
  const editorDraftRef = useRef<{
    key: string;
    fields: TimeEntryEditorFields;
  } | null>(null);
  // `timer` opens the running entry; it takes precedence over `entry`.
  const editingTimer =
    search.timer && currentTimer?._id === search.timer
      ? currentTimer
      : undefined;
  // Grid cells live in memory, not in the URL, and only count while the Grid shows
  // their week. `gridCell` is the cell the editor came from; it only matters while
  // the URL opens an editor, so Back past the editor closes the panel.
  // `listedCell` is a cell with several entries, listed in the panel.
  const [gridCell, setGridCell] = useState<WeekGridCell | null>(null);
  const [listedCell, setListedCell] = useState<WeekGridCell | null>(null);
  const showsGrid = isWeekView && preferences.weeklyTimeViewStyle === "grid";
  const inShownWeek = (cell: WeekGridCell | null) =>
    showsGrid && cell && weekDates.includes(cell.localDate) ? cell : null;
  const panelCell = inShownWeek(gridCell);
  const editingEntry =
    !search.timer && search.entry && search.entry !== "new"
      ? state.timesheetEntries.find((entry) => entry._id === search.entry)
      : undefined;
  const newEntryValues =
    search.project && search.task
      ? { projectId: search.project, taskId: search.task }
      : undefined;
  const editorTarget: TimeEntryEditorTarget | null = editingTimer
    ? { kind: "running", timer: editingTimer }
    : editingEntry
      ? { kind: "edit", entry: editingEntry }
      : !search.timer && search.entry === "new"
        ? {
            kind: "create",
            localDate: date,
            initialValues: panelCell
              ? { projectId: panelCell.projectId, taskId: panelCell.taskId }
              : newEntryValues,
          }
        : null;
  // A new entry for another Grid row or pinned task is a new form, so its key names it.
  const editorKey = editingTimer
    ? `running-${editingTimer._id}`
    : editingEntry
      ? editingEntry._id
      : `new-${date}${panelCell ? `-${panelCell.rowKey}` : newEntryValues ? `-${newEntryValues.taskId}` : ""}`;
  // The Day list and Week cards key the running row by its resumed entry, if any.
  const activeEntryId = editingTimer
    ? (editingTimer.entryId ?? `running-${editingTimer._id}`)
    : editingEntry?._id;
  // A Grid cell with several entries lists them in the panel instead of the editor.
  const panelListedCell = editorTarget ? null : inShownWeek(listedCell);
  const showsCellEntries = panelListedCell !== null;
  const showsEditor = editorTarget !== null;

  // The view shown on a desktop width becomes the remembered view, whether it
  // came from the toggle, a shortcut or a link. The narrow view always shows
  // Day, so it leaves the choice alone.
  const shownView = isWeekView ? "week" : "day";
  useEffect(() => {
    if (weekAvailable && preferences.timeView !== shownView) {
      localStore.setUserPreferences({ timeView: shownView });
    }
  }, [weekAvailable, shownView, preferences.timeView]);

  // Once the URL opens an editor, the listed cell is done, so Back past the editor
  // closes the panel. It clears after the editor shows, so the panel never empties
  // between the click and the navigation.
  useEffect(() => {
    if (showsEditor) setListedCell(null);
  }, [showsEditor]);

  /**
   * Saves a valid draft in the side panel before the page shows something else.
   * Returns false when the draft is invalid; the form then shows why.
   */
  function leaveEditorDraft() {
    return editorFormRef.current?.commitBeforeSwitch() ?? true;
  }

  function clearGridCells() {
    setGridCell(null);
    setListedCell(null);
  }

  function goToDate(nextDate: string) {
    if (!leaveEditorDraft()) return;
    clearGridCells();
    navigate({
      to: "/time/$date",
      params: { date: nextDate },
      search: isWeekView
        ? ({ view: "week" } as never)
        : ({ view: undefined, entry: undefined, timer: undefined } as never),
    });
  }

  function changeTimeView(nextView: "day" | "week") {
    if (nextView === "day") {
      returnToDayView();
      return;
    }
    if (leaveEditorDraft()) {
      clearGridCells();
      void navigate({
        to: "/time/$date",
        params: { date },
        search: { view: "week" } as never,
      });
    }
  }

  function returnToDayView() {
    if (!leaveEditorDraft()) return;
    clearGridCells();
    // Written before the navigation: a link without `view` follows it.
    localStore.setUserPreferences({ timeView: "day" });
    void navigate({
      to: "/time/$date",
      params: { date },
      search: {
        view: undefined,
        entry: undefined,
        timer: undefined,
      } as never,
    });
  }

  function closeEditor() {
    editorDraftRef.current = null;
    clearGridCells();
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
  function openEditor(
    request: EntryEditorRequest,
    localDate = request.cell?.localDate ?? date,
  ) {
    const entry = request.timerId ? undefined : (request.entryId ?? "new");
    const cell = request.cell ?? null;
    const task = entry === "new" ? request.task : undefined;
    const isAlreadyOpen = request.timerId
      ? request.timerId === search.timer
      : !search.timer &&
        entry === search.entry &&
        task?.taskId === search.task &&
        task?.projectId === search.project;
    if (
      isAlreadyOpen &&
      localDate === date &&
      isSameWeekGridCell(cell, gridCell)
    ) {
      return;
    }
    if (!leaveEditorDraft()) return;

    setGridCell(cell);
    void navigate({
      to: "/time/$date",
      params: { date: localDate },
      search: {
        entry,
        timer: request.timerId,
        project: task?.projectId,
        task: task?.taskId,
        view: isWeekView ? "week" : undefined,
      } as never,
      // Switching entries in the panel should not stack history entries.
      replace: editorTarget !== null || showsCellEntries,
    });
  }

  /** Lists a Grid cell's entries in the side panel, after saving the open draft. */
  function openCellEntries(cell: WeekGridCell) {
    if (isSameWeekGridCell(cell, panelListedCell)) return;
    if (!leaveEditorDraft()) return;

    editorDraftRef.current = null;
    setListedCell(cell);
    if (search.entry || search.timer) {
      void navigate({
        to: "/time/$date",
        params: { date },
        search: { view: "week", entry: undefined, timer: undefined } as never,
        replace: true,
      });
    }
  }

  /** Saves and closes the side panel. Returns false when its draft is invalid. */
  function closePanel() {
    if (!leaveEditorDraft()) return false;
    closeEditor();
    return true;
  }

  function openSubmitPage() {
    if (!leaveEditorDraft()) return;
    void navigate({
      to: "/time/$date/submit",
      params: { date },
      search: { view: isWeekView ? "week" : undefined } as never,
    });
  }

  useActionRequest(({ action }) => {
    if (action === "submit-week") openSubmitPage();
  });

  // These win over the app shell's handlers while the Time page is open.
  useShortcut("entry.new", () => openEditor({}));
  useShortcut("pinned.new-entry", ({ digit }) => {
    const pinned = digit && findPinnedTask(state.projects, digit);
    if (pinned) {
      openEditor({
        task: { projectId: pinned.project._id, taskId: pinned.task._id },
      });
    }
  });
  useShortcut("time.today", () => {
    if (date !== today) goToDate(today);
  });
  useShortcut("time.previous", () =>
    goToDate(addDaysIsoDate(date, isWeekView ? -7 : -1)),
  );
  useShortcut("time.next", () =>
    goToDate(addDaysIsoDate(date, isWeekView ? 7 : 1)),
  );
  useShortcut("time.day-view", () => {
    if (isWeekView) returnToDayView();
  });
  useShortcut("time.week-view", () => {
    if (weekAvailable && !isWeekView) changeTimeView("week");
  });

  const carriedDraft =
    editorDraftRef.current?.key === editorKey
      ? editorDraftRef.current.fields
      : undefined;

  function keepEditorDraft(fields: TimeEntryEditorFields) {
    // The running entry's form reseeds its counted time on open, so a carried Hours
    // would read as a correction. Its draft is not carried across hosts.
    if (editingTimer) return;
    editorDraftRef.current = { key: editorKey, fields };
  }

  return (
    <div className={cn("time-page-stack", isWeekView && "is-week-view")}>
      {isNarrowView ? null : (
        <TimePageHeader
          date={date}
          today={today}
          view={isWeekView ? "week" : "day"}
          weekDates={weekDates}
          weekAvailable={weekAvailable}
          onSelectDate={goToDate}
          onChangeView={changeTimeView}
        />
      )}
      <div className="time-page-main">
        {isWeekView ? (
          <WeeklyTimeView
            weekDates={weekDates}
            activeEntryId={activeEntryId}
            activeCell={editorTarget ? panelCell : panelListedCell}
            onClosePanel={closePanel}
            onNewEntry={(localDate) => openEditor({}, localDate)}
            onOpenCellEntries={openCellEntries}
            onOpenEntry={(request) => openEditor(request)}
          />
        ) : (
          <>
            <DayTotalsStrip
              date={date}
              today={today}
              weekDates={weekDates}
              onSelectDate={goToDate}
            />
            {showsWeekUnavailableNote ? (
              <MessagePanel role="status" className="time-page-note">
                Week needs a wider window. Showing Day instead.
              </MessagePanel>
            ) : null}
            <TimerPanel
              date={date}
              activeEntryId={activeEntryId}
              onOpenEntry={openEditor}
            />
          </>
        )}
      </div>

      {editorTarget && !editsInDialog ? (
        <SidePanel
          contentKey={editorKey}
          widthKey="time"
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
          {panelCell && editorTarget.kind !== "create" ? (
            <div className="weekly-grid-add-another">
              <Button
                type="button"
                variant="outline"

                onClick={() => openEditor({ cell: panelCell })}
              >
                <Plus data-icon="inline-start" />
                {formatAddAnotherEntryLabel(panelCell)}
              </Button>
            </div>
          ) : null}
        </SidePanel>
      ) : panelListedCell ? (
        <SidePanel
          contentKey={`cell-${panelListedCell.rowKey}-${panelListedCell.localDate}`}
          widthKey="time"
          className="time-entry-side-panel"
          aria-label="Cell entries"
        >
          <WeekGridCellPanel
            key={`${panelListedCell.rowKey}-${panelListedCell.localDate}`}
            cell={panelListedCell}
            onClose={closeEditor}
            onOpen={openEditor}
          />
        </SidePanel>
      ) : null}
      {editorTarget && editsInDialog ? (
        <TimeEntryModal
          date={date}
          entryId={editingEntry?._id}
          timerId={editingTimer?._id}
          initialValues={newEntryValues}
          initialFields={carriedDraft}
          onFieldsChange={keepEditorDraft}
          onClose={closeEditor}
        />
      ) : null}
    </div>
  );
}

/**
 * The Day view's week strip with day and week totals. It ticks with the running
 * timer on its own, so the page and its open editor do not re-render each second.
 */
function DayTotalsStrip({
  date,
  today,
  weekDates,
  onSelectDate,
}: {
  date: string;
  today: string;
  weekDates: string[];
  onSelectDate: (date: string) => void;
}) {
  const state = useLocalState();
  const currentTimer = state.timers[0] ?? null;
  const now = useRunningClock(currentTimer !== null);

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
      const { runningDurationMs } = getTimerDurationsMs(currentTimer, now);
      const timerContribution = getTimerContributionMs({
        timer: currentTimer,
        timesheetEntries: state.timesheetEntries,
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

  return (
    <DayStrip
      date={date}
      today={today}
      weekDates={getVisibleWeekDates(
        weekDates,
        state.userPreferences.weeklyCapacityTargets,
        state.userPreferences.hideNonWorkingDays,
      )}
      totalLabel="Week"
      totalValue={formatClockDuration(weekTotalMs)}
      getDayValue={(day) => formatClockDuration(totalsByDate.get(day) ?? 0)}
      onSelectDate={onSelectDate}
    />
  );
}
