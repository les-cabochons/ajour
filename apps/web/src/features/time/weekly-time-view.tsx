import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  RiAddLine as Plus,
  RiArrowLeftLine as ArrowLeft,
  RiArrowLeftSLine as ChevronLeft,
  RiArrowRightSLine as ChevronRight,
  RiLockLine as Lock,
} from "@remixicon/react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  ObjectActionsButton,
  ObjectContextMenu,
} from "@/components/object-actions-menu";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type {
  LocalTimesheetEntry,
  WeeklyTimeViewStyle,
} from "@/domain/local-state";
import { formatClockDuration } from "@/domain/time/duration";
import {
  projectWeeklyTime,
  type WeeklyGridAddedRow,
} from "@/domain/time/weekly-time";
import { createCrossDayEntryDragPointerSession } from "@/lib/cross-day-entry-drag";
import {
  useLocalProjects,
  useLocalState,
  useUserPreferences,
} from "@/lib/local-hooks";
import {
  SubmitWeekButton,
  WeekSubmittedBadge,
} from "@/features/time/submit-week-controls";
import {
  formatToastDay,
  offerTimeEntryUndo,
  useTimeEntryActions,
} from "@/features/time/time-entry-actions";
import { handleItemKeyDown, TIME_ENTRY_ACTION_KEYS } from "@/lib/item-keys";
import { localStore } from "@/lib/local-store";
import {
  getSharedTableStepOrder,
  setSharedTableDragDocumentState,
  SHARED_TABLE_DRAG_CLICK_SUPPRESSION_MS,
  type SharedTableDragPointerSession,
} from "@/lib/table-drag";
import {
  getTimerContributionMs,
  getTimerDurationsMs,
} from "@/lib/timer-totals";
import { WeekGrid, type WeekGridCell } from "@/features/time/week-grid";
import {
  CapacityValue,
  formatWeekDay,
} from "@/features/time/weekly-capacity-value";
import { addDaysIsoDate, cn, todayIsoDate } from "@/lib/utils";

type CrossDayDragState = {
  entryId: string;
  height: number;
  offsetX: number;
  offsetY: number;
  pointerId: number;
  pointerX: number;
  pointerY: number;
  targetDate: string | null;
  width: number;
};

function dateAtNoon(localDate: string) {
  return new Date(`${localDate}T12:00:00`);
}

function formatWeekRange(weekDates: string[]) {
  const start = weekDates[0];
  const end = weekDates.at(-1);
  if (!start || !end) return "";
  const startDate = dateAtNoon(start);
  const endDate = dateAtNoon(end);
  const startLabel = new Intl.DateTimeFormat("en-CA", {
    month: "long",
    day: "numeric",
  }).format(startDate);
  const endLabel = new Intl.DateTimeFormat("en-CA", {
    month: startDate.getMonth() === endDate.getMonth() ? undefined : "long",
    day: "numeric",
  }).format(endDate);
  return `${startLabel}–${endLabel}`;
}

/**
 * The Week view: the Grid of project and task rows by day, or the Days columns of
 * entry cards. Clicks open entries and cells in the page's side panel. Dragging a
 * card to another day moves it.
 */
export function WeeklyTimeView({
  activeCell,
  activeEntryId,
  anchorDate,
  now,
  onClosePanel,
  onNewEntry,
  onOpenCellEntries,
  onOpenEntry,
  onReturnToDay,
  onSelectWeek,
  onSubmit,
  weekDates,
}: {
  /** The Grid cell shown in the side panel, highlighted in the Grid. */
  activeCell?: WeekGridCell | null;
  /** The entry open in the editor, highlighted on its card or Grid cell. */
  activeEntryId?: string;
  anchorDate: string;
  now: number;
  /** Saves and closes the side panel. Returns false when its draft is invalid and stays open. */
  onClosePanel: () => boolean;
  onNewEntry: (localDate: string) => void;
  /** Lists the entries of a Grid cell that holds several, in the side panel. */
  onOpenCellEntries: (cell: WeekGridCell) => void;
  /** Opens an entry or the running entry. With a Grid `cell` and no id, opens a new entry for that cell. */
  onOpenEntry: (request: {
    entryId?: string;
    timerId?: string;
    cell?: WeekGridCell;
  }) => void;
  onReturnToDay: () => void;
  onSelectWeek: (anchorDate: string) => void;
  onSubmit: () => void;
  weekDates: string[];
}) {
  const state = useLocalState();
  const projects = useLocalProjects();
  const preferences = useUserPreferences();
  // Rows added with "+ Add row" are dropped when the user leaves the week. A row
  // that got hours stays, because its entries show it.
  const [addedRows, setAddedRows] = useState<{
    weekStart: string | undefined;
    rows: WeeklyGridAddedRow[];
  }>({ weekStart: weekDates[0], rows: [] });
  if (addedRows.weekStart !== weekDates[0]) {
    setAddedRows({ weekStart: weekDates[0], rows: [] });
  }
  const weekAddedRows = addedRows.rows;
  const [dragState, setDragState] = useState<CrossDayDragState | null>(null);
  const dragStateRef = useRef<CrossDayDragState | null>(null);
  const dragSessionRef = useRef<SharedTableDragPointerSession | null>(null);
  const dayTargetRefs = useRef(new Map<string, HTMLElement>());
  const suppressClickUntilRef = useRef(0);
  const currentTimer = state.timers[0] ?? null;
  const entryActions = useTimeEntryActions({
    onEdit: (target) =>
      onOpenEntry(
        target.kind === "running"
          ? { timerId: target.timerId }
          : { entryId: target.entry._id },
      ),
  });
  const runningTarget = currentTimer
    ? { kind: "running" as const, timerId: currentTimer._id }
    : null;
  const today = todayIsoDate();
  const projectsById = useMemo(
    () => new Map(projects.map((project) => [project._id, project])),
    [projects],
  );
  const runningTime = useMemo(() => {
    if (!currentTimer) return null;
    const durations = getTimerDurationsMs(currentTimer, now);
    return {
      entryId: currentTimer.entryId,
      localDate: currentTimer.localDate,
      projectId: currentTimer.projectId,
      taskId: currentTimer.taskId,
      durationMs: getTimerContributionMs({
        timer: currentTimer,
        timesheetEntries: state.timesheetEntries,
        ...durations,
      }),
      displayDurationMs: durations.runningDurationMs,
    };
  }, [currentTimer, now, state.timesheetEntries]);
  const projection = useMemo(
    () =>
      projectWeeklyTime({
        addedRows: weekAddedRows,
        capacityTargets: preferences.weeklyCapacityTargets,
        entries: state.timesheetEntries,
        projects,
        runningTime,
        weekDates,
      }),
    [
      preferences.weeklyCapacityTargets,
      projects,
      runningTime,
      state.timesheetEntries,
      weekAddedRows,
      weekDates,
    ],
  );
  const draggedEntry = dragState
    ? (state.timesheetEntries.find(
        (entry) => entry._id === dragState.entryId,
      ) ?? null)
    : null;

  useEffect(() => {
    dragStateRef.current = dragState;
  }, [dragState]);

  const clearDrag = useCallback(() => {
    dragSessionRef.current?.dispose();
    dragSessionRef.current = null;
    dragStateRef.current = null;
    setDragState(null);
    setSharedTableDragDocumentState(false, "cross-day-entry-drag-active");
  }, []);

  useEffect(() => clearDrag, [clearDrag]);

  function changeStyle(values: unknown[]) {
    const style = values[0];
    if (style === "grid" || style === "days") {
      localStore.setUserPreferences({
        weeklyTimeViewStyle: style as WeeklyTimeViewStyle,
      });
    }
  }

  function moveEntry(entry: LocalTimesheetEntry, localDate: string) {
    if (entry.localDate === localDate) return;
    const token = localStore.moveTimesheetEntry(entry._id, {
      localDate,
      projectId: entry.projectId,
      taskId: entry.taskId,
      note: entry.note,
      durationMs: entry.durationMs,
    });
    offerTimeEntryUndo(token, `Moved to ${formatToastDay(localDate)}`);
  }

  /** Move up and Move down within a day's cards, persisted like the Day list's drag reorder. */
  function reorderEntry(
    localDate: string,
    dayEntries: LocalTimesheetEntry[],
    entryId: string,
    step: -1 | 1,
  ) {
    const next = getSharedTableStepOrder(
      dayEntries.map((entry) => entry._id),
      entryId,
      step,
    );
    if (next) {
      localStore.reorderTimesheetEntries(localDate, next.order);
    }
  }

  function registerDayTarget(localDate: string, node: HTMLElement | null) {
    if (node) {
      dayTargetRefs.current.set(localDate, node);
    } else {
      dayTargetRefs.current.delete(localDate);
    }
  }

  function handleEntryPointerDown(
    entry: LocalTimesheetEntry,
    event: ReactPointerEvent<HTMLElement>,
  ) {
    if (
      event.button !== 0 ||
      dragSessionRef.current !== null ||
      currentTimer?.entryId === entry._id ||
      event.currentTarget.closest("[data-running-entry='true']")
    ) {
      return;
    }

    const rect = event.currentTarget.getBoundingClientRect();
    const { clientX, clientY, pointerId, pointerType } = event;
    dragSessionRef.current = createCrossDayEntryDragPointerSession({
      pointerId,
      pointerType,
      originX: clientX,
      originY: clientY,
      targets: dayTargetRefs.current,
      isDragging: () => dragStateRef.current?.pointerId === pointerId,
      onStart: (pointer, targetDate) => {
        setSharedTableDragDocumentState(true, "cross-day-entry-drag-active");
        const nextState: CrossDayDragState = {
          entryId: entry._id,
          height: rect.height,
          offsetX: clientX - rect.left,
          offsetY: clientY - rect.top,
          pointerId,
          pointerX: pointer.clientX,
          pointerY: pointer.clientY,
          targetDate,
          width: rect.width,
        };
        dragStateRef.current = nextState;
        setDragState(nextState);
      },
      onMove: (pointer, targetDate) => {
        const active = dragStateRef.current;
        if (!active) return;
        const nextState = {
          ...active,
          pointerX: pointer.clientX,
          pointerY: pointer.clientY,
          targetDate,
        };
        dragStateRef.current = nextState;
        setDragState(nextState);
      },
      onEnd: (targetDate, commit) => {
        suppressClickUntilRef.current =
          performance.now() + SHARED_TABLE_DRAG_CLICK_SUPPRESSION_MS;
        dragSessionRef.current = null;
        if (commit && targetDate) moveEntry(entry, targetDate);
        clearDrag();
      },
      onPressEnd: () => {
        dragSessionRef.current = null;
      },
    });
  }

  function openEntry(entryId: string) {
    if (performance.now() >= suppressClickUntilRef.current) {
      onOpenEntry({ entryId });
    }
  }

  function renderEntrySummary(entry: LocalTimesheetEntry) {
    const project = entry.projectId
      ? projectsById.get(entry.projectId)
      : undefined;
    const task = project?.tasks.find(
      (candidate) => candidate._id === entry.taskId,
    );
    return {
      note: entry.note,
      projectColor: project?.color ?? "#3b82f6",
      projectName: project?.displayName ?? project?.name ?? "No project",
      taskName: task?.name ?? (entry.label || "No task"),
    };
  }

  function addGridRow(row: WeeklyGridAddedRow) {
    setAddedRows({ weekStart: weekDates[0], rows: [...weekAddedRows, row] });
  }

  return (
    <section className="weekly-time-view" aria-label="Week">
      <header className="weekly-time-header">
        <div className="weekly-time-heading">
          <Button
            className="weekly-return-day"
            variant="ghost"
            size="sm"
            onClick={onReturnToDay}
          >
            <ArrowLeft data-icon="inline-start" />
            Day
          </Button>
          <div className="weekly-time-navigation">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Previous week"
              onClick={() => onSelectWeek(addDaysIsoDate(anchorDate, -7))}
            >
              <ChevronLeft />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Next week"
              onClick={() => onSelectWeek(addDaysIsoDate(anchorDate, 7))}
            >
              <ChevronRight />
            </Button>
          </div>
          <h2 className="weekly-time-title">{formatWeekRange(weekDates)}</h2>
          <WeekSubmittedBadge weekDates={weekDates} />
        </div>
        <div className="weekly-time-actions">
          <ToggleGroup
            value={[preferences.weeklyTimeViewStyle]}
            onValueChange={changeStyle}
            variant="outline"
            size="sm"
            aria-label="Week layout"
          >
            <ToggleGroupItem value="grid">Grid</ToggleGroupItem>
            <ToggleGroupItem value="days">Days</ToggleGroupItem>
          </ToggleGroup>
          <CapacityValue
            microLabel="Week total"
            capacityMs={projection.capacityMs}
            totalMs={projection.totalMs}
            label="Week capacity"
            overCapacity={projection.overCapacity}
            showWarning={preferences.warnWhenOverCapacity}
          />
          <SubmitWeekButton onClick={onSubmit} />
        </div>
      </header>

      {preferences.weeklyTimeViewStyle === "grid" ? (
        <WeekGrid
          activeCell={activeCell}
          activeEntryId={activeEntryId}
          onAddRow={addGridRow}
          onClosePanel={onClosePanel}
          onOpen={onOpenEntry}
          onOpenCellEntries={onOpenCellEntries}
          projection={projection}
          projects={projects}
          projectsById={projectsById}
          runningTimerId={currentTimer?._id}
          showCapacityWarning={preferences.warnWhenOverCapacity}
          today={today}
          weekDates={weekDates}
        />
      ) : (
        <div className="weekly-days-grid" data-focus-scope>
          {projection.days.map((day, index) => {
            const visibleEntries = currentTimer?.entryId
              ? day.entries.filter(
                  (entry) => entry._id !== currentTimer.entryId,
                )
              : day.entries;
            const runningHere = runningTime?.localDate === day.localDate;
            const isToday = day.localDate === today;
            return (
              <section
                key={day.localDate}
                ref={(node) => registerDayTarget(day.localDate, node)}
                className={cn(
                  "weekly-days-column",
                  index >= 5 && "is-weekend",
                  isToday && "is-today",
                  dragState?.targetDate === day.localDate && "is-drop-target",
                )}
                aria-label={formatWeekDay(day.localDate, {
                  weekday: "long",
                  month: "long",
                  day: "numeric",
                })}
              >
                <header className="weekly-days-column-header">
                  <div>
                    <span className="weekly-days-column-weekday">
                      {formatWeekDay(day.localDate, { weekday: "short" })}
                    </span>
                    <span
                      className={cn(
                        "weekly-days-column-date",
                        isToday && "is-today",
                      )}
                    >
                      {formatWeekDay(day.localDate, {
                        month: "short",
                        day: "numeric",
                      })}
                    </span>
                  </div>
                  <CapacityValue
                    capacityMs={day.capacityMs}
                    totalMs={day.totalMs}
                    label={formatWeekDay(day.localDate, { weekday: "long" })}
                    overCapacity={day.overCapacity}
                    showWarning={preferences.warnWhenOverCapacity}
                  />
                </header>
                <div
                  className="weekly-days-column-entries"
                  role="group"
                  aria-label={`${formatWeekDay(day.localDate, { weekday: "long" })} entries`}
                >
                  {runningHere && runningTarget ? (
                    <ObjectContextMenu
                      actions={entryActions.getActions(runningTarget)}
                      keys={TIME_ENTRY_ACTION_KEYS}
                      onAction={(actionId) =>
                        entryActions.runAction(runningTarget, actionId)
                      }
                      render={
                        <Card
                          size="sm"
                          tabIndex={0}
                          aria-label={`Running entry, ${formatClockDuration(runningTime.displayDurationMs)}`}
                          className="weekly-entry-card is-running"
                          data-running-entry="true"
                          data-entry-id={currentTimer?.entryId ?? ""}
                          data-focus-column={index}
                          onKeyDown={(event) =>
                            handleItemKeyDown(event, {
                              actions: entryActions.getActions(runningTarget),
                              keys: TIME_ENTRY_ACTION_KEYS,
                              onAction: (actionId) =>
                                entryActions.runAction(runningTarget, actionId),
                            })
                          }
                        />
                      }
                    >
                      <div className="weekly-entry-card-project">
                        <Badge>
                          <Lock data-icon="inline-start" /> Running
                        </Badge>
                        <ObjectActionsButton
                          actions={entryActions.getActions(runningTarget)}
                          keys={TIME_ENTRY_ACTION_KEYS}
                          onAction={(actionId) =>
                            entryActions.runAction(runningTarget, actionId)
                          }
                          label="Entry actions"
                        />
                      </div>
                      <strong>
                        {formatClockDuration(runningTime.displayDurationMs)}
                      </strong>
                    </ObjectContextMenu>
                  ) : null}
                  {visibleEntries.map((entry) => {
                    const summary = renderEntrySummary(entry);
                    const target = { kind: "entry" as const, entry };
                    const actions = entryActions.getActions(target);
                    return (
                      <ObjectContextMenu
                        key={entry._id}
                        actions={actions}
                        keys={TIME_ENTRY_ACTION_KEYS}
                        onAction={(actionId) =>
                          entryActions.runAction(target, actionId)
                        }
                        render={
                          <Card
                            size="sm"
                            tabIndex={0}
                            role="button"
                            data-entry-id={entry._id}
                            data-focus-column={index}
                            aria-label={`${summary.projectName}, ${summary.taskName}, ${formatClockDuration(entry.durationMs)}`}
                            style={
                              {
                                "--project-color": summary.projectColor,
                              } as CSSProperties
                            }
                            className={cn(
                              "weekly-entry-card",
                              activeEntryId === entry._id && "is-selected",
                              dragState?.entryId === entry._id && "is-dragging",
                            )}
                            onClick={() => openEntry(entry._id)}
                            onKeyDown={(event) => {
                              // Space presses the card like a button; Enter is Edit.
                              if (
                                event.target === event.currentTarget &&
                                event.key === " "
                              ) {
                                event.preventDefault();
                                openEntry(entry._id);
                                return;
                              }
                              handleItemKeyDown(event, {
                                actions,
                                keys: TIME_ENTRY_ACTION_KEYS,
                                onAction: (actionId) =>
                                  entryActions.runAction(target, actionId),
                                onReorder: (step) =>
                                  reorderEntry(
                                    day.localDate,
                                    visibleEntries,
                                    entry._id,
                                    step,
                                  ),
                              });
                            }}
                            onPointerDown={(event) =>
                              handleEntryPointerDown(entry, event)
                            }
                          />
                        }
                      >
                        <div className="weekly-entry-card-project">
                          <span>{summary.projectName}</span>
                          <strong>
                            {formatClockDuration(entry.durationMs)}
                          </strong>
                        </div>
                        <span className="weekly-entry-card-task">
                          {summary.taskName}
                        </span>
                        {summary.note ? (
                          <span className="weekly-entry-card-note">
                            {summary.note}
                          </span>
                        ) : null}
                        <footer className="weekly-entry-card-footer">
                          <span className="weekly-entry-card-status">
                            {entry.submittedAt ? "submitted" : "saved"}
                          </span>
                          <ObjectActionsButton
                            actions={actions}
                            keys={TIME_ENTRY_ACTION_KEYS}
                            onAction={(actionId) =>
                              entryActions.runAction(target, actionId)
                            }
                            label="Entry actions"
                          />
                        </footer>
                      </ObjectContextMenu>
                    );
                  })}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="weekly-days-column-add"
                    onClick={() => onNewEntry(day.localDate)}
                  >
                    <Plus data-icon="inline-start" /> Add
                  </Button>
                </div>
              </section>
            );
          })}
        </div>
      )}

      {draggedEntry && dragState ? (
        <div
          className="weekly-entry-drag-preview"
          style={{
            height: dragState.height,
            width: dragState.width,
            transform: `translate3d(${Math.round(dragState.pointerX - dragState.offsetX)}px, ${Math.round(dragState.pointerY - dragState.offsetY)}px, 0)`,
          }}
        >
          <span>{renderEntrySummary(draggedEntry).projectName}</span>
          <strong>{formatClockDuration(draggedEntry.durationMs)}</strong>
        </div>
      ) : null}
      {entryActions.dialogs}
    </section>
  );
}
