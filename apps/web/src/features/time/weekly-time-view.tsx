import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { RiAddLine as Plus } from "@remixicon/react";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
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
  getWeeklyGridAddedRowKey,
  projectWeeklyTime,
  type WeeklyGridAddedRow,
} from "@/domain/time/weekly-time";
import {
  createCrossDayEntryDragPointerSession,
  getSameDayDropLine,
} from "@/lib/cross-day-entry-drag";
import {
  useLocalProjects,
  useLocalState,
  useUserPreferences,
} from "@/lib/local-hooks";
import {
  formatToastDay,
  offerTimeEntryUndo,
  useTimeEntryActions,
} from "@/features/time/time-entry-actions";
import { handleItemKeyDown, TIME_ENTRY_ACTION_KEYS } from "@/lib/item-keys";
import { localStore } from "@/lib/local-store";
import {
  getSharedTableDragTargetIndex,
  getSharedTableDropOrder,
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
import { useRunningClock } from "@/lib/use-now";
import { cn, todayIsoDate } from "@/lib/utils";

type EntryCardDragState = {
  entryId: string;
  height: number;
  offsetX: number;
  offsetY: number;
  /** The card's index among its day's cards when the drag started. */
  originIndex: number;
  pointerId: number;
  pointerX: number;
  pointerY: number;
  targetDate: string | null;
  /** The card's index after the drop, while the pointer is over its own day. Null over another day. */
  targetIndex: number | null;
  width: number;
};

/**
 * The Week view: the Grid of project and task rows by day, or the Days columns of
 * entry cards. Clicks open entries and cells in the page's side panel. Dragging a
 * card to another day moves it; dragging it within its day reorders the day.
 */
export function WeeklyTimeView({
  activeCell,
  activeEntryId,
  onClosePanel,
  onNewEntry,
  onOpenCellEntries,
  onOpenEntry,
  weekDates,
}: {
  /** The Grid cell shown in the side panel, highlighted in the Grid. */
  activeCell?: WeekGridCell | null;
  /** The entry open in the editor, highlighted on its card or Grid cell. */
  activeEntryId?: string;
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
  const [dragState, setDragState] = useState<EntryCardDragState | null>(null);
  const dragStateRef = useRef<EntryCardDragState | null>(null);
  const dragSessionRef = useRef<SharedTableDragPointerSession | null>(null);
  const dayTargetRefs = useRef(new Map<string, HTMLElement>());
  const suppressClickUntilRef = useRef(0);
  const currentTimer = state.timers[0] ?? null;
  const now = useRunningClock(currentTimer !== null);
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

  /**
   * Starts a card drag. Over another day the drop moves the entry there; over
   * its own day it reorders `dayEntries`, the day's cards without the running one.
   */
  function handleEntryPointerDown(
    entry: LocalTimesheetEntry,
    dayEntries: LocalTimesheetEntry[],
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
    const dayEntryIds = dayEntries.map((dayEntry) => dayEntry._id);
    const originIndex = dayEntryIds.indexOf(entry._id);
    // Cards keep their place during the drag (the drop line takes no space),
    // so the elements found now stay valid until the drop.
    const dayCards = new Map<string, HTMLElement>();
    dayTargetRefs.current
      .get(entry.localDate)
      ?.querySelectorAll<HTMLElement>(".weekly-entry-card[data-entry-id]")
      .forEach((card) => {
        if (card.dataset.entryId) dayCards.set(card.dataset.entryId, card);
      });
    const targetIndexAt = (pointerY: number, targetDate: string | null) =>
      targetDate === entry.localDate
        ? getSharedTableDragTargetIndex(
            dayEntryIds,
            entry._id,
            pointerY,
            dayCards,
          )
        : null;
    dragSessionRef.current = createCrossDayEntryDragPointerSession({
      pointerId,
      pointerType,
      originX: clientX,
      originY: clientY,
      targets: dayTargetRefs.current,
      isDragging: () => dragStateRef.current?.pointerId === pointerId,
      onStart: (pointer, targetDate) => {
        setSharedTableDragDocumentState(true, "cross-day-entry-drag-active");
        const nextState: EntryCardDragState = {
          entryId: entry._id,
          height: rect.height,
          offsetX: clientX - rect.left,
          offsetY: clientY - rect.top,
          originIndex,
          pointerId,
          pointerX: pointer.clientX,
          pointerY: pointer.clientY,
          targetDate,
          targetIndex: targetIndexAt(pointer.clientY, targetDate),
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
          targetIndex: targetIndexAt(pointer.clientY, targetDate),
        };
        dragStateRef.current = nextState;
        setDragState(nextState);
      },
      onEnd: (targetDate, commit) => {
        suppressClickUntilRef.current =
          performance.now() + SHARED_TABLE_DRAG_CLICK_SUPPRESSION_MS;
        dragSessionRef.current = null;
        if (commit && targetDate === entry.localDate) {
          const order = getSharedTableDropOrder(
            dayEntryIds,
            originIndex,
            dragStateRef.current?.targetIndex ?? originIndex,
          );
          if (order) localStore.reorderTimesheetEntries(entry.localDate, order);
        } else if (commit && targetDate) {
          moveEntry(entry, targetDate);
        }
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

  function removeGridRow(rowKey: string) {
    setAddedRows({
      weekStart: weekDates[0],
      rows: weekAddedRows.filter(
        (row) => getWeeklyGridAddedRowKey(row) !== rowKey,
      ),
    });
  }

  return (
    <section className="weekly-time-view" aria-label="Week">
      <div className="weekly-toolbar">
        <ToggleGroup
          value={[preferences.weeklyTimeViewStyle]}
          onValueChange={changeStyle}
          variant="outline"
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
      </div>

      {preferences.weeklyTimeViewStyle === "grid" ? (
        <WeekGrid
          activeCell={activeCell}
          activeEntryId={activeEntryId}
          onAddRow={addGridRow}
          onRemoveRow={removeGridRow}
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
            const isOriginDay = draggedEntry?.localDate === day.localDate;
            const dropLine =
              isOriginDay &&
              dragState?.targetDate === day.localDate &&
              dragState.targetIndex !== null
                ? getSameDayDropLine(
                    visibleEntries.map((entry) => entry._id),
                    dragState.entryId,
                    dragState.targetIndex,
                  )
                : null;
            return (
              <section
                key={day.localDate}
                ref={(node) => registerDayTarget(day.localDate, node)}
                className={cn(
                  "weekly-days-column",
                  index >= 5 && "is-weekend",
                  isToday && "is-today",
                  dragState?.targetDate === day.localDate &&
                    !isOriginDay &&
                    "is-drop-target",
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
                        <div
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
                        <Chip tone="success">Running</Chip>
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
                          <div
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
                              dropLine?.entryId === entry._id &&
                                `is-drop-${dropLine.edge}`,
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
                              handleEntryPointerDown(
                                entry,
                                visibleEntries,
                                event,
                              )
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
