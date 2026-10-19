import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { RiAddLine as Plus } from "@remixicon/react";
import { Button } from "@/components/ui/button";
import { DisabledReason } from "@/components/disabled-reason";
import { MessagePanel } from "@/components/app-surface";
import { Chip } from "@/components/ui/chip";
import {
  ObjectActionItems,
  ObjectContextMenu,
} from "@/components/object-actions-menu";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  formatEntryCount,
  type ObjectAction,
  type TimeEntryActionId,
} from "@/domain/actions/object-actions";
import type {
  LocalTimesheetEntry,
  WeeklyTimeViewStyle,
} from "@/domain/local-state";
import { formatClockDuration } from "@/domain/time/duration";
import { getLockedWeek, lockedWeekMessage } from "@/domain/time/locked-weeks";
import { isTimesheetEntryCommitted } from "@/domain/time/timesheet-commit";
import { placeRunningRow } from "@/domain/time/timesheet-entry";
import {
  getWeeklyGridAddedRowKey,
  projectWeeklyTime,
  type WeeklyGridAddedRow,
} from "@/domain/time/weekly-time";
import {
  createCrossDayEntryDragPointerSession,
  getEntryDropLine,
} from "@/lib/cross-day-entry-drag";
import {
  useLocalProjects,
  useLocalState,
  useUserPreferences,
} from "@/lib/local-hooks";
import {
  CalendarDayCards,
  useCalendarSuggestionActions,
} from "@/features/time/calendar-suggestions";
import {
  formatToastDay,
  offerTimeEntryUndo,
  useTimeEntryActions,
} from "@/features/time/time-entry-actions";
import { groupCalendarSuggestionsByDay } from "@/domain/time/calendar-suggestions";
import { useCalendarSuggestions } from "@/lib/calendar-suggestions";
import { useEntrySelection } from "@/features/time/use-entry-selection";
import { handleItemKeyDown, TIME_ENTRY_ACTION_KEYS } from "@/lib/item-keys";
import { localStore } from "@/lib/local-store";
import {
  getSharedTableBlockDropIndex,
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
import { WeekLockChip } from "@/features/time/week-lock";
import {
  CapacityValue,
  formatWeekDay,
} from "@/features/time/weekly-capacity-value";
import { useRunningClock } from "@/lib/use-now";
import { cn, todayIsoDate } from "@/lib/utils";

type EntryCardDragState = {
  /** The pressed card, which the drag preview shows. */
  entryId: string;
  /** Every card the drag carries, in reading order, the pressed one included. */
  entryIds: string[];
  height: number;
  offsetX: number;
  offsetY: number;
  pointerId: number;
  pointerX: number;
  pointerY: number;
  targetDate: string | null;
  /** Where the cards land among the target day's cards that stay. Null outside every day. */
  targetIndex: number | null;
  width: number;
};

type ColumnPasteActionId = "paste-here" | "paste-same-weekdays";

/**
 * The Week view: the Grid of project and task rows by day, or the Days columns of
 * entry cards. Grid clicks open cells in the page's side panel. A click selects a
 * card for copy, cut and paste, and a double click opens it. A double click on a
 * day's header or empty space opens a new entry for that day. Days lists each day
 * oldest first, with the running entry last. Dragging a selected card drags the
 * whole selection, and the cards land together at the drop line, on their own
 * day or another one. A submitted week shows its lock in the toolbar and lists
 * its entries read-only.
 */
export function WeeklyTimeView({
  activeCell,
  activeEntryId,
  onClosePanel,
  onNewEntry,
  onOpenCellEntries,
  onOpenEntry,
  onOpenCalendar,
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
  /** Opens the Calendar side panel on a day. */
  onOpenCalendar: (localDate: string) => void;
  weekDates: string[];
}) {
  const state = useLocalState();
  const projects = useLocalProjects();
  const preferences = useUserPreferences();
  const calendar = useCalendarSuggestions({
    from: weekDates[0] ?? "",
    to: weekDates[weekDates.length - 1] ?? "",
  });
  const suggestionsByDay = useMemo(
    () => groupCalendarSuggestionsByDay(calendar.suggestions),
    [calendar.suggestions],
  );
  const suggestionActions = useCalendarSuggestionActions();
  const suggestionCounts = useMemo(
    () =>
      new Map(
        [...suggestionsByDay].map(([localDate, day]) => [
          localDate,
          day.visible.length,
        ]),
      ),
    [suggestionsByDay],
  );
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
  // The Week shows one week, so the whole view is locked or open.
  const weekLock = getLockedWeek(state, weekDates[0]!);
  const lockReason = weekLock ? lockedWeekMessage(weekLock.weekOf) : undefined;
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
        hideNonWorkingDays: preferences.hideNonWorkingDays,
        projects,
        runningTime,
        weekDates,
      }),
    [
      preferences.weeklyCapacityTargets,
      preferences.hideNonWorkingDays,
      projects,
      runningTime,
      state.timesheetEntries,
      weekAddedRows,
      weekDates,
    ],
  );
  const runningEntryId = currentTimer
    ? (currentTimer.entryId ?? `running-${currentTimer._id}`)
    : undefined;
  // The Days cards in reading order: Monday's from the top, then Tuesday's.
  const orderedCardIds = useMemo(
    () =>
      projection.days.flatMap((day) =>
        placeRunningRow(
          day.entries,
          runningTime?.localDate === day.localDate && runningEntryId
            ? {
                row: { _id: runningEntryId },
                resumedEntryId: currentTimer?.entryId,
              }
            : null,
        ).map((card) => card._id),
      ),
    [currentTimer?.entryId, projection.days, runningEntryId, runningTime],
  );
  const sameWeekdayTarget = useMemo(
    () => ({ kind: "same-weekday" as const, weekDates }),
    [weekDates],
  );
  const selection = useEntrySelection({
    resetKey: `${weekDates[0]}:${preferences.weeklyTimeViewStyle}`,
    orderedIds:
      preferences.weeklyTimeViewStyle === "days" ? orderedCardIds : [],
    runningEntryId,
    pasteTarget: sameWeekdayTarget,
    entryActions,
    onOpen: (entryId) =>
      entryId === runningEntryId && currentTimer
        ? onOpenEntry({ timerId: currentTimer._id })
        : openEntry(entryId),
  });
  // One right-click menu for every column, outside the cards' menu trees.
  const [columnMenuDate, setColumnMenuDate] = useState<string | null>(null);
  const columnMenuTriggerRef = useRef<HTMLDivElement>(null);
  const pasteDisabledReason = selection.canPaste
    ? undefined
    : "Copy or cut entries first";
  const columnPasteActions: ObjectAction<ColumnPasteActionId>[] = [
    {
      id: "paste-here",
      label: "Paste here",
      disabledReason: lockReason ?? pasteDisabledReason,
    },
    {
      id: "paste-same-weekdays",
      label: "Paste on same weekdays",
      disabledReason: lockReason ?? pasteDisabledReason,
    },
  ];
  const draggedEntry = dragState
    ? (state.timesheetEntries.find(
        (entry) => entry._id === dragState.entryId,
      ) ?? null)
    : null;
  const draggedIds = useMemo(
    () => new Set(dragState?.entryIds ?? []),
    [dragState?.entryIds],
  );

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

  /**
   * Drops the dragged cards on `localDate` at `targetIndex`. A move to another
   * day shows one Undo; a reorder within a day stays silent.
   */
  function dropEntries(
    entryIds: readonly string[],
    localDate: string,
    targetIndex: number,
  ) {
    const { undoToken, movedIds } = localStore.dropTimesheetEntries(
      entryIds,
      localDate,
      targetIndex,
    );
    if (movedIds.length === 0) return;
    const day = formatToastDay(localDate);
    offerTimeEntryUndo(
      undoToken,
      entryIds.length === 1
        ? `Moved to ${day}`
        : `Moved ${formatEntryCount(movedIds.length)} to ${day}`,
    );
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
   * Starts a card drag. A selected card carries the whole selection, another
   * card only itself. The cards land together at the drop line of the day under
   * the pointer, in reading order, moving there from other days. A continued
   * entry counts at its running card's place, which cannot be dragged.
   */
  function handleEntryPointerDown(
    entry: LocalTimesheetEntry,
    event: ReactPointerEvent<HTMLElement>,
  ) {
    if (
      lockReason !== undefined ||
      event.button !== 0 ||
      dragSessionRef.current !== null ||
      currentTimer?.entryId === entry._id ||
      event.currentTarget.closest("[data-running-entry='true']")
    ) {
      return;
    }

    const rect = event.currentTarget.getBoundingClientRect();
    const { clientX, clientY, pointerId, pointerType } = event;
    // Read now: the press may have just changed the selection to this card.
    const entryIds = selection.getDragIds(entry._id);
    const dragged = new Set(entryIds);
    const dayEntryIds = new Map(
      projection.days.map((day) => [
        day.localDate,
        day.entries.map((dayEntry) => dayEntry._id),
      ]),
    );
    // Cards keep their place during the drag (the drop line takes no space),
    // so the elements found now stay valid until the drop.
    const cards = new Map<string, HTMLElement>();
    for (const column of dayTargetRefs.current.values()) {
      column
        .querySelectorAll<HTMLElement>(".weekly-entry-card[data-entry-id]")
        .forEach((card) => {
          if (card.dataset.entryId) cards.set(card.dataset.entryId, card);
        });
    }
    const targetIndexAt = (pointerY: number, targetDate: string | null) =>
      targetDate
        ? getSharedTableBlockDropIndex(
            dayEntryIds.get(targetDate) ?? [],
            dragged,
            pointerY,
            cards,
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
          entryIds,
          height: rect.height,
          offsetX: clientX - rect.left,
          offsetY: clientY - rect.top,
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
        if (commit && targetDate) {
          dropEntries(
            entryIds,
            targetDate,
            dragStateRef.current?.targetIndex ?? Number.MAX_SAFE_INTEGER,
          );
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

  function selectCard(entryId: string, event: ReactMouseEvent<HTMLElement>) {
    if (performance.now() >= suppressClickUntilRef.current) {
      selection.handleClick(entryId, event);
    }
  }

  /**
   * Runs a card's action. Delete, Duplicate, Duplicate to…, Move to… and Mark as
   * not committed can act on the whole selection instead. `key` is set when a key
   * ran the action, not a menu.
   */
  function runCardAction(
    target: Parameters<typeof entryActions.runAction>[0],
    entryId: string,
    actionId: TimeEntryActionId,
    key?: object,
  ) {
    if (selection.runSelectionAction(entryId, actionId, key)) {
      return;
    }
    entryActions.runAction(target, actionId);
  }

  /** Opens the paste menu for a column. A card's right-click opens its own menu. */
  function openColumnMenu(localDate: string, event: ReactMouseEvent) {
    if (
      event.target instanceof Element &&
      event.target.closest(".weekly-entry-card")
    ) {
      return;
    }
    event.preventDefault();
    setColumnMenuDate(localDate);
    columnMenuTriggerRef.current?.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: event.clientX,
        clientY: event.clientY,
      }),
    );
  }

  function runColumnPaste(actionId: ColumnPasteActionId) {
    if (actionId === "paste-same-weekdays") {
      selection.paste(sameWeekdayTarget);
    } else if (columnMenuDate) {
      selection.paste({ kind: "day", localDate: columnMenuDate });
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

  /**
   * True when a pointer event lands on a day column's own empty space: not on a
   * card or button, and not in a portal such as the capacity hover card, whose
   * React events still bubble to the column.
   */
  function isColumnEmptySpace(event: ReactMouseEvent<HTMLElement>) {
    return (
      event.target instanceof Element &&
      event.currentTarget.contains(event.target) &&
      !event.target.closest(
        ".weekly-entry-card, .calendar-suggestion-card, button",
      )
    );
  }

  /**
   * A double-click on a day column's header or empty space opens a new entry
   * for that day. Cards and buttons keep their own clicks.
   */
  function handleColumnDoubleClick(
    localDate: string,
    event: ReactMouseEvent<HTMLElement>,
  ) {
    if (!lockReason && isColumnEmptySpace(event)) onNewEntry(localDate);
  }

  /** Keeps the second press of a double-click from selecting nearby text. */
  function handleColumnMouseDown(event: ReactMouseEvent<HTMLElement>) {
    if (event.detail > 1 && isColumnEmptySpace(event)) event.preventDefault();
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
        <div className="flex items-center gap-3">
          {weekLock ? <WeekLockChip /> : null}
          <CapacityValue
            microLabel="Week total"
            capacityMs={projection.capacityMs}
            totalMs={projection.totalMs}
            label="Week capacity"
            farOverCapacity={projection.farOverCapacity}
            showWarning={preferences.warnWhenOverCapacity}
          />
        </div>
      </div>

      {projection.days.length === 0 ? (
        <MessagePanel>
          All days have 0 hours of capacity. Set a capacity target or turn off
          Hide non-working days in Settings to show them.
        </MessagePanel>
      ) : preferences.weeklyTimeViewStyle === "grid" ? (
        <WeekGrid
          activeCell={activeCell}
          activeEntryId={activeEntryId}
          onAddRow={addGridRow}
          onRemoveRow={removeGridRow}
          onClosePanel={onClosePanel}
          onOpen={onOpenEntry}
          onOpenCellEntries={onOpenCellEntries}
          onOpenSuggestions={onOpenCalendar}
          suggestionCounts={suggestionCounts}
          projection={projection}
          projects={projects}
          projectsById={projectsById}
          lockReason={lockReason}
          runningTimerId={currentTimer?._id}
          showCapacityWarning={preferences.warnWhenOverCapacity}
          today={today}
          weekDates={projection.days.map((day) => day.localDate)}
        />
      ) : (
        <div
          className="weekly-days-grid"
          style={{
            gridTemplateColumns: `repeat(${projection.days.length}, minmax(0, 1fr))`,
          }}
          data-focus-scope
          ref={selection.scopeRef}
          onPointerDown={selection.handleScopePointerDown}
          onKeyDown={selection.handleScopeKeyDown}
        >
          {projection.days.map((day, index) => {
            const runningHere = runningTime?.localDate === day.localDate;
            // A continued entry's card turns into the running card in place; a
            // new running entry's card comes last.
            const cards = placeRunningRow<LocalTimesheetEntry, "running">(
              day.entries,
              runningHere
                ? { row: "running", resumedEntryId: currentTimer?.entryId }
                : null,
            );
            const isToday = day.localDate === today;
            const isTargetDay =
              dragState !== null && dragState.targetDate === day.localDate;
            const dayEntryIds = isTargetDay
              ? day.entries.map((entry) => entry._id)
              : [];
            const dropLine =
              isTargetDay && dragState.targetIndex !== null
                ? getEntryDropLine(
                    dayEntryIds,
                    dragState.entryIds,
                    dragState.targetIndex,
                  )
                : null;
            // The column lights up when cards would arrive from another day.
            const receivesCards =
              isTargetDay &&
              dragState.entryIds.some((id) => !dayEntryIds.includes(id));
            return (
              <section
                key={day.localDate}
                ref={(node) => registerDayTarget(day.localDate, node)}
                onDoubleClick={(event) =>
                  handleColumnDoubleClick(day.localDate, event)
                }
                onMouseDown={handleColumnMouseDown}
                className={cn(
                  "weekly-days-column",
                  weekDates.indexOf(day.localDate) >= 5 && "is-weekend",
                  isToday && "is-today",
                  receivesCards && "is-drop-target",
                )}
                aria-label={formatWeekDay(day.localDate, {
                  weekday: "long",
                  month: "long",
                  day: "numeric",
                })}
                onContextMenu={(event) => openColumnMenu(day.localDate, event)}
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
                    farOverCapacity={day.farOverCapacity}
                    showWarning={preferences.warnWhenOverCapacity}
                  />
                </header>
                <div
                  className="weekly-days-column-entries"
                  role="group"
                  aria-label={`${formatWeekDay(day.localDate, { weekday: "long" })} entries`}
                >
                  {cards.map((entry) => {
                    if (entry === "running") {
                      return runningTarget && runningEntryId && runningTime ? (
                        <ObjectContextMenu
                          key={runningEntryId}
                          actions={selection.getMenuActions(
                            runningEntryId,
                            entryActions.getActions(runningTarget),
                          )}
                          keys={TIME_ENTRY_ACTION_KEYS}
                          onAction={(actionId) =>
                            runCardAction(
                              runningTarget,
                              runningEntryId,
                              actionId,
                            )
                          }
                          render={
                            <div
                              tabIndex={0}
                              aria-label={`Running entry, ${formatClockDuration(runningTime.displayDurationMs)}`}
                              // Cards are buttons, so their selection is a pressed state.
                              role="button"
                              aria-pressed={selection.selectedIds.has(
                                runningEntryId,
                              )}
                              className={cn(
                                "weekly-entry-card is-running",
                                selection.selectedIds.has(runningEntryId) &&
                                  "is-selected",
                                dropLine?.entryId === runningEntryId &&
                                  `is-drop-${dropLine.edge}`,
                              )}
                              data-running-entry="true"
                              data-entry-id={currentTimer?.entryId ?? ""}
                              data-selection-id={runningEntryId}
                              data-focus-column={index}
                              onPointerDown={(event) =>
                                selection.handlePress(runningEntryId, event)
                              }
                              onContextMenu={() =>
                                selection.handleMenu(runningEntryId)
                              }
                              onClick={(event) =>
                                selectCard(runningEntryId, event)
                              }
                              onDoubleClick={() =>
                                onOpenEntry({ timerId: runningTarget.timerId })
                              }
                              onFocus={(event) =>
                                selection.handleFocus(runningEntryId, event)
                              }
                              onKeyDown={(event) =>
                                handleItemKeyDown(event, {
                                  actions: selection.getKeyActions(
                                    runningEntryId,
                                    entryActions.getActions(runningTarget),
                                  ),
                                  keys: TIME_ENTRY_ACTION_KEYS,
                                  onAction: (actionId, key) =>
                                    runCardAction(
                                      runningTarget,
                                      runningEntryId,
                                      actionId,
                                      key,
                                    ),
                                  // A continued entry moves like its saved
                                  // entry; a new running entry stays last.
                                  onReorder:
                                    currentTimer?.entryId && !lockReason
                                      ? (step) =>
                                          reorderEntry(
                                            day.localDate,
                                            day.entries,
                                            runningEntryId,
                                            step,
                                          )
                                      : undefined,
                                })
                              }
                            />
                          }
                        >
                          <div className="weekly-entry-card-project">
                            <Chip tone="success">Running</Chip>
                          </div>
                          <strong>
                            {formatClockDuration(runningTime.displayDurationMs)}
                          </strong>
                        </ObjectContextMenu>
                      ) : null;
                    }
                    const summary = renderEntrySummary(entry);
                    const target = { kind: "entry" as const, entry };
                    const actions = entryActions.getActions(target);
                    const runAction = (
                      actionId: TimeEntryActionId,
                      key?: object,
                    ) => runCardAction(target, entry._id, actionId, key);
                    return (
                      <ObjectContextMenu
                        key={entry._id}
                        actions={selection.getMenuActions(entry._id, actions)}
                        keys={TIME_ENTRY_ACTION_KEYS}
                        onAction={runAction}
                        render={
                          <div
                            tabIndex={0}
                            role="button"
                            data-entry-id={entry._id}
                            data-selection-id={entry._id}
                            data-focus-column={index}
                            aria-pressed={selection.selectedIds.has(entry._id)}
                            aria-label={`${summary.projectName}, ${summary.taskName}, ${formatClockDuration(entry.durationMs)}`}
                            style={
                              {
                                "--project-color": summary.projectColor,
                              } as CSSProperties
                            }
                            className={cn(
                              "weekly-entry-card",
                              activeEntryId === entry._id && "is-editing",
                              selection.selectedIds.has(entry._id) &&
                                "is-selected",
                              selection.cutIds.has(entry._id) && "is-cut",
                              draggedIds.has(entry._id) && "is-dragging",
                              dropLine?.entryId === entry._id &&
                                `is-drop-${dropLine.edge}`,
                            )}
                            onClick={(event) => selectCard(entry._id, event)}
                            onDoubleClick={() => openEntry(entry._id)}
                            onFocus={(event) =>
                              selection.handleFocus(entry._id, event)
                            }
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
                                actions: selection.getKeyActions(
                                  entry._id,
                                  actions,
                                ),
                                keys: TIME_ENTRY_ACTION_KEYS,
                                onAction: runAction,
                                onReorder: lockReason
                                  ? undefined
                                  : (step) =>
                                      reorderEntry(
                                        day.localDate,
                                        day.entries,
                                        entry._id,
                                        step,
                                      ),
                              });
                            }}
                            onPointerDown={(event) => {
                              selection.handlePress(entry._id, event);
                              handleEntryPointerDown(entry, event);
                            }}
                            onContextMenu={() =>
                              selection.handleMenu(entry._id)
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
                            {isTimesheetEntryCommitted(entry)
                              ? "committed"
                              : "saved"}
                          </span>
                        </footer>
                      </ObjectContextMenu>
                    );
                  })}
                  <DisabledReason
                    label="Add"
                    reason={lockReason}
                    className="flex w-full"
                  >
                    <Button
                      variant="ghost"
                      className="weekly-days-column-add"
                      disabled={lockReason !== undefined}
                      onClick={() => onNewEntry(day.localDate)}
                    >
                      <Plus data-icon="inline-start" /> Add
                    </Button>
                  </DisabledReason>
                  <CalendarDayCards
                    suggestions={
                      suggestionsByDay.get(day.localDate)?.visible ?? []
                    }
                    focusColumn={index}
                    actions={suggestionActions}
                  />
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
          {dragState.entryIds.length > 1 ? (
            <span className="entry-drag-count" aria-hidden="true">
              {dragState.entryIds.length}
            </span>
          ) : null}
        </div>
      ) : null}
      {/* Keep this root outside the columns so card menus are not nested under it. */}
      <ContextMenu>
        <ContextMenuTrigger
          render={<div hidden ref={columnMenuTriggerRef} />}
        />
        <ContextMenuContent>
          <ObjectActionItems
            actions={columnPasteActions}
            onAction={runColumnPaste}
          />
        </ContextMenuContent>
      </ContextMenu>
      {entryActions.dialogs}
    </section>
  );
}
