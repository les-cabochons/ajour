import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  RiAddLine as Plus,
  RiCheckLine as Check,
  RiPlayLine as Play,
} from "@remixicon/react";
import {
  Empty,
  EmptyDescription,
  EmptyContent,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { TooltipButton } from "@/components/tooltip-button";
import { Button } from "@/components/ui/button";
import { Value } from "@/components/ui/value";
import { RunningDot } from "@/components/running-dot";
import {
  ObjectActionsButton,
  ObjectContextMenu,
} from "@/components/object-actions-menu";
import { useTimeEntryActions } from "@/features/time/time-entry-actions";
import {
  isSelectionDelete,
  useEntrySelection,
} from "@/features/time/use-entry-selection";
import type { TimeEntryActionId } from "@/domain/actions/object-actions";
import { formatClockDuration } from "@/domain/time/duration";
import {
  getLocalProjectDisplayName,
  type LocalTimesheetEntry,
} from "@/domain/local-state";
import { localStore } from "@/lib/local-store";
import {
  createSharedTableDragPointerSession,
  getSharedTableDropOrder,
  getSharedTableDragOverlayTransform,
  getSharedTableDragRowShift,
  getSharedTableDragTargetIndex,
  getSharedTableStepOrder,
  setSharedTableDragDocumentState,
  SHARED_TABLE_DRAG_CLICK_SUPPRESSION_MS,
  type SharedTableDragPointerSession,
} from "@/lib/table-drag";
import { handleItemKeyDown, TIME_ENTRY_ACTION_KEYS } from "@/lib/item-keys";
import { ProjectIcon } from "@/lib/project-icons";
import { cn } from "@/lib/utils";
import { useLocalProjects, useLocalState } from "@/lib/local-hooks";
import { useRunningClock } from "@/lib/use-now";

type EntryDragState = {
  entryId: string;
  pointerId: number;
  originIndex: number;
  targetIndex: number;
  pointerX: number;
  pointerY: number;
  offsetX: number;
  offsetY: number;
  originLeft: number;
  minTop: number;
  width: number;
  height: number;
};

interface RunningEntryRow {
  _id: string;
  localDate: string;
  projectId?: string;
  taskId?: string;
  note?: string;
  durationMs: number;
  committedAt: number;
  isRunning: true;
  timerId: string;
  entryId?: string;
}

function isRunningEntry(
  entry: LocalTimesheetEntry | RunningEntryRow,
): entry is RunningEntryRow {
  return "isRunning" in entry && entry.isRunning;
}

function isEntryDragBlockedTarget(target: EventTarget | null) {
  return target instanceof HTMLElement
    ? Boolean(
        target.closest(
          "button, input, textarea, select, option, a, [data-no-entry-drag='true']",
        ),
      )
    : false;
}

/** The one-line body of a row: dot, project, task and note. Also the drag preview. */
function EntryMain({
  projectName,
  projectColor,
  projectIcon,
  taskName,
  note,
}: {
  projectName: string;
  projectColor: string;
  projectIcon: React.ComponentProps<typeof ProjectIcon>["icon"];
  taskName?: string;
  note?: string;
}) {
  return (
    <>
      <ProjectIcon
        icon={projectIcon}
        color={projectColor}
        className="time-entry-dot"
        fallback="dot"
      />
      <span className="time-entry-project">{projectName}</span>
      {taskName ? <span className="time-entry-task">{taskName}</span> : null}
      {note ? <span className="time-entry-note">{note}</span> : null}
    </>
  );
}

/**
 * The Day view's entry list: one 40px row per entry, the running entry first,
 * and a "New entry" row at the end. A click selects a row for copy, cut and
 * paste; a double click, Enter and "New entry" ask the page to open the entry
 * editor through `onOpenEntry`. An empty target means a new entry on `date`.
 */
export function TimerPanel({
  date,
  activeEntryId,
  onOpenEntry,
}: {
  date: string;
  /** The entry open in the editor, highlighted in the list. */
  activeEntryId?: string;
  onOpenEntry: (target: { entryId?: string; timerId?: string }) => void;
}) {
  const state = useLocalState();
  const projects = useLocalProjects();
  const entryRowRefs = useRef(new Map<string, HTMLTableRowElement>());
  const entryPointerSessionRef = useRef<SharedTableDragPointerSession | null>(
    null,
  );
  const entryDragStateRef = useRef<EntryDragState | null>(null);
  const suppressEntryClickUntilRef = useRef(0);
  const [pressedEntryId, setPressedEntryId] = useState<string | null>(null);
  const [entryDragState, setEntryDragState] = useState<EntryDragState | null>(
    null,
  );

  const currentTimer = state.timers[0] ?? null;
  const now = useRunningClock(currentTimer?.localDate === date);
  const entryActions = useTimeEntryActions({
    onEdit: (target) =>
      onOpenEntry(
        target.kind === "running"
          ? { timerId: target.timerId }
          : { entryId: target.entry._id },
      ),
  });
  const runningEntry = useMemo<RunningEntryRow | null>(() => {
    if (!currentTimer || currentTimer.localDate !== date) {
      return null;
    }

    return {
      _id: currentTimer.entryId ?? `running-${currentTimer._id}`,
      localDate: currentTimer.localDate,
      projectId: currentTimer.projectId,
      taskId: currentTimer.taskId,
      note: currentTimer.note,
      durationMs:
        currentTimer.accumulatedDurationMs +
        Math.max(0, now - currentTimer.startedAt),
      committedAt: currentTimer.startedAt,
      isRunning: true,
      timerId: currentTimer._id,
      entryId: currentTimer.entryId,
    };
  }, [currentTimer, date, now]);
  const recentEntries = useMemo(
    () =>
      state.timesheetEntries
        .filter((entry) => entry.localDate === date)
        .sort((left, right) => right.committedAt - left.committedAt),
    [date, state.timesheetEntries],
  );
  const visibleEntries = useMemo(() => {
    const filteredEntries =
      runningEntry?.isRunning && currentTimer?.entryId
        ? recentEntries.filter((entry) => entry._id !== currentTimer.entryId)
        : recentEntries;

    return runningEntry ? [runningEntry, ...filteredEntries] : filteredEntries;
  }, [currentTimer?.entryId, recentEntries, runningEntry]);
  const draggableEntryIds = useMemo(
    () =>
      visibleEntries
        .filter((entry) => !isRunningEntry(entry))
        .map((entry) => entry._id),
    [visibleEntries],
  );
  const draggedEntry = useMemo(
    () =>
      entryDragState
        ? (visibleEntries.find(
            (entry) => entry._id === entryDragState.entryId,
          ) ?? null)
        : null,
    [entryDragState, visibleEntries],
  );
  const canReorderEntries = draggableEntryIds.length > 1;
  const visibleEntryIds = useMemo(
    () => visibleEntries.map((entry) => entry._id),
    [visibleEntries],
  );
  const pasteTarget = useMemo(
    () => ({ kind: "day" as const, localDate: date }),
    [date],
  );
  const selection = useEntrySelection({
    resetKey: date,
    orderedIds: visibleEntryIds,
    runningEntryId: runningEntry?._id,
    pasteTarget,
    onOpen: (entryId) => {
      const entry = visibleEntries.find((item) => item._id === entryId);
      if (entry) openEntry(entry);
    },
  });

  useEffect(() => {
    entryDragStateRef.current = entryDragState;
  }, [entryDragState]);

  const clearEntryPointerSession = useCallback(() => {
    const pendingSession = entryPointerSessionRef.current;
    if (!pendingSession) {
      return;
    }

    pendingSession.dispose();
    entryPointerSessionRef.current = null;
  }, []);

  const resetEntryDragVisuals = useCallback(() => {
    setSharedTableDragDocumentState(false, "time-entry-drag-active");
  }, []);

  const finishEntryDrag = useCallback(
    (shouldCommit: boolean) => {
      const currentDrag = entryDragStateRef.current;
      clearEntryPointerSession();

      const order = currentDrag
        ? getSharedTableDropOrder(
            draggableEntryIds,
            currentDrag.originIndex,
            currentDrag.targetIndex,
          )
        : null;
      if (shouldCommit && order) {
        localStore.reorderTimesheetEntries(date, order);
      }

      suppressEntryClickUntilRef.current =
        performance.now() + SHARED_TABLE_DRAG_CLICK_SUPPRESSION_MS;
      entryDragStateRef.current = null;
      setEntryDragState(null);
      setPressedEntryId(null);
      resetEntryDragVisuals();
    },
    [clearEntryPointerSession, date, draggableEntryIds, resetEntryDragVisuals],
  );

  useEffect(() => {
    return () => {
      clearEntryPointerSession();
      entryDragStateRef.current = null;
      setEntryDragState(null);
      setPressedEntryId(null);
      resetEntryDragVisuals();
    };
  }, [clearEntryPointerSession, resetEntryDragVisuals]);

  function openEntry(entry: LocalTimesheetEntry | RunningEntryRow) {
    if (performance.now() < suppressEntryClickUntilRef.current) {
      return;
    }

    onOpenEntry(
      isRunningEntry(entry)
        ? { entryId: entry.entryId, timerId: entry.timerId }
        : { entryId: entry._id },
    );
  }

  /** Move up and Move down, persisted like a drag reorder. */
  function reorderEntry(entryId: string, step: -1 | 1) {
    const next = getSharedTableStepOrder(draggableEntryIds, entryId, step);
    if (next) {
      localStore.reorderTimesheetEntries(date, next.order);
    }
  }

  function handleContinueEntry(entryId: string) {
    localStore.continueTimesheetEntry(entryId);
  }

  function handleEntryPointerDown(
    entry: LocalTimesheetEntry | RunningEntryRow,
    event: React.PointerEvent<HTMLTableRowElement>,
  ) {
    if (
      isRunningEntry(entry) ||
      !canReorderEntries ||
      event.button !== 0 ||
      isEntryDragBlockedTarget(event.target)
    ) {
      return;
    }

    const sourceIndex = draggableEntryIds.indexOf(entry._id);
    if (sourceIndex === -1) {
      return;
    }

    const captureTarget = event.currentTarget;
    captureTarget.setPointerCapture(event.pointerId);
    clearEntryPointerSession();
    setPressedEntryId(entry._id);

    const { clientX, clientY, pointerId, pointerType } = event;
    const startDrag = (pointerX: number, pointerY: number) => {
      const row = entryRowRefs.current.get(entry._id);
      if (!row) {
        setPressedEntryId(null);
        return;
      }

      const rect = row.getBoundingClientRect();
      const firstRowRect = entryRowRefs.current
        .get(draggableEntryIds[0] ?? entry._id)
        ?.getBoundingClientRect();
      setSharedTableDragDocumentState(true, "time-entry-drag-active");
      suppressEntryClickUntilRef.current =
        performance.now() + SHARED_TABLE_DRAG_CLICK_SUPPRESSION_MS;
      setPressedEntryId(null);
      const nextDragState = {
        entryId: entry._id,
        pointerId,
        originIndex: sourceIndex,
        targetIndex: sourceIndex,
        pointerX,
        pointerY,
        offsetX: pointerX - rect.left,
        offsetY: pointerY - rect.top,
        originLeft: rect.left,
        minTop: firstRowRect?.top ?? rect.top,
        width: rect.width,
        height: rect.height,
      };
      entryDragStateRef.current = nextDragState;
      setEntryDragState(nextDragState);
    };

    entryPointerSessionRef.current = createSharedTableDragPointerSession({
      captureTarget,
      pointerId,
      pointerType,
      originX: clientX,
      originY: clientY,
      isDragging: () => entryDragStateRef.current?.pointerId === pointerId,
      onStart: (pointer) => {
        startDrag(pointer.clientX, pointer.clientY);
      },
      onMove: (pointer) => {
        const currentDrag = entryDragStateRef.current;
        if (!currentDrag) {
          return;
        }

        const nextDragState: EntryDragState = {
          ...currentDrag,
          pointerX: pointer.clientX,
          pointerY: pointer.clientY,
          targetIndex: getSharedTableDragTargetIndex(
            draggableEntryIds,
            currentDrag.entryId,
            pointer.clientY,
            entryRowRefs.current,
          ),
        };
        entryDragStateRef.current = nextDragState;
        setEntryDragState(nextDragState);
      },
      onEnd: (shouldCommit) => {
        entryPointerSessionRef.current = null;
        finishEntryDrag(shouldCommit);
      },
      onPressEnd: () => {
        entryPointerSessionRef.current = null;
        setPressedEntryId(null);
      },
    });
  }

  function describeEntry(entry: LocalTimesheetEntry | RunningEntryRow) {
    const project = projects.find((item) => item._id === entry.projectId);
    const task = project?.tasks.find((item) => item._id === entry.taskId);
    return {
      projectName: project ? getLocalProjectDisplayName(project) : "No project",
      projectColor: project?.color ?? "var(--text-tertiary)",
      projectIcon: project?.icon,
      taskName: task?.name,
    };
  }

  return (
    <div
      className="time-entries"
      onPointerDown={selection.handleScopePointerDown}
      onKeyDown={selection.handleScopeKeyDown}
    >
      <table
        className={cn(
          "time-entries-table",
          entryDragState && "is-entry-dragging",
        )}
      >
        <tbody className="entries-table-scroll-region" data-focus-scope>
          {visibleEntries.length === 0 ? (
            <tr className="time-entries-empty-row">
              <td colSpan={2}>
                <Empty align="start">
                  <EmptyHeader>
                    <EmptyTitle>No time entries</EmptyTitle>
                    <EmptyDescription>
                      Saved and running entries for this day appear here.
                    </EmptyDescription>
                  </EmptyHeader>
                  <EmptyContent>
                    <Button variant="outline" onClick={() => onOpenEntry({})}>
                      <Plus data-icon="inline-start" />
                      New entry
                    </Button>
                  </EmptyContent>
                </Empty>
              </td>
            </tr>
          ) : null}
          {visibleEntries.map((entry) => {
            const summary = describeEntry(entry);
            const isRunning = isRunningEntry(entry);
            const isEditing =
              activeEntryId !== undefined && entry._id === activeEntryId;
            const rowTarget = isRunningEntry(entry)
              ? { kind: "running" as const, timerId: entry.timerId }
              : { kind: "entry" as const, entry };
            const rowActions = entryActions.getActions(rowTarget);
            // `key` is set when a key ran the action, not a menu.
            const runRowAction = (
              actionId: TimeEntryActionId,
              key?: object,
            ) => {
              if (
                isSelectionDelete(actionId, key) &&
                selection.deleteSelection(entry._id, { fromKey: Boolean(key) })
              ) {
                return;
              }
              entryActions.runAction(rowTarget, actionId);
            };
            const draggableIndex = draggableEntryIds.indexOf(entry._id);
            const isDraggedEntry = entryDragState?.entryId === entry._id;
            const rowShift =
              !isRunning && entryDragState && draggableIndex !== -1
                ? getSharedTableDragRowShift({
                    itemIndex: draggableIndex,
                    originIndex: entryDragState.originIndex,
                    targetIndex: entryDragState.targetIndex,
                    rowHeight: entryDragState.height,
                  })
                : 0;
            const isSubmitted = "submittedAt" in entry && entry.submittedAt;

            return (
              <React.Fragment key={entry._id}>
                <ObjectContextMenu
                  actions={rowActions}
                  keys={TIME_ENTRY_ACTION_KEYS}
                  onAction={runRowAction}
                  render={
                    <tr
                      ref={(node) => {
                        if (isRunning) {
                          return;
                        }

                        if (node) {
                          entryRowRefs.current.set(entry._id, node);
                          return;
                        }

                        entryRowRefs.current.delete(entry._id);
                      }}
                      className={cn(
                        "time-entry-row",
                        isRunning && "is-running",
                        isEditing && "is-editing",
                        selection.selectedIds.has(entry._id) && "is-selected",
                        selection.cutIds.has(entry._id) && "is-cut",
                        canReorderEntries &&
                          !isRunning &&
                          draggableIndex !== -1 &&
                          "is-reorderable",
                        pressedEntryId === entry._id && "is-pressing",
                        rowShift !== 0 && "is-shifting",
                        isDraggedEntry && "is-drag-source",
                      )}
                      style={
                        rowShift !== 0
                          ? {
                              transform: `translate3d(0, ${rowShift}px, 0)`,
                            }
                          : undefined
                      }
                      aria-grabbed={isDraggedEntry}
                      aria-selected={selection.selectedIds.has(entry._id)}
                      data-entry-id={entry._id}
                      data-running-entry={isRunning ? "true" : undefined}
                      data-focus-column="0"
                      tabIndex={0}
                      onClick={(event) => {
                        if (
                          performance.now() >=
                          suppressEntryClickUntilRef.current
                        ) {
                          selection.handleClick(entry._id, event);
                        }
                      }}
                      onDoubleClick={() => openEntry(entry)}
                      onFocus={(event) =>
                        selection.handleFocus(entry._id, event)
                      }
                      onKeyDown={(event) =>
                        handleItemKeyDown(event, {
                          actions: rowActions,
                          keys: TIME_ENTRY_ACTION_KEYS,
                          onAction: runRowAction,
                          // The running entry stays on top.
                          onReorder: isRunning
                            ? undefined
                            : (step) => reorderEntry(entry._id, step),
                        })
                      }
                      onPointerDown={(event) =>
                        handleEntryPointerDown(entry, event)
                      }
                    />
                  }
                >
                  <td className="time-entry-main">
                    <EntryMain {...summary} note={entry.note} />
                  </td>
                  <td className="time-entry-trailing">
                    <span className="time-entry-actions">
                      {isRunning ? null : (
                        <TooltipButton
                          label={
                            currentTimer
                              ? "Continue and stop the running entry"
                              : "Continue"
                          }
                          shortcut="entry.continue"
                          data-no-entry-drag="true"
                          render={
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              className="text-muted-foreground"
                              onClick={(event) => {
                                event.stopPropagation();
                                handleContinueEntry(entry._id);
                              }}
                            />
                          }
                        >
                          <Play />
                        </TooltipButton>
                      )}
                      <ObjectActionsButton
                        actions={rowActions}
                        keys={TIME_ENTRY_ACTION_KEYS}
                        onAction={runRowAction}
                        label="Entry actions"
                        className="time-entry-more"
                      />
                    </span>
                    {isSubmitted ? (
                      <Check
                        className="time-entry-submitted"
                        aria-label="Submitted"
                        role="img"
                      />
                    ) : null}
                    {isRunning ? (
                      <span className="time-entry-running">
                        <RunningDot />
                        <Value tone="success">
                          {formatClockDuration(entry.durationMs)}
                        </Value>
                      </span>
                    ) : (
                      <Value>{formatClockDuration(entry.durationMs)}</Value>
                    )}
                  </td>
                </ObjectContextMenu>
              </React.Fragment>
            );
          })}
          {visibleEntries.length === 0 ? null : (
            <tr className="time-entries-add-row">
              <td colSpan={2}>
                <TooltipButton
                  label="New entry"
                  shortcut="entry.new"
                  className="time-entries-add"
                  onClick={() => onOpenEntry({})}
                >
                  <Plus />
                  <span>New entry</span>
                </TooltipButton>
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {draggedEntry && entryDragState ? (
        <div
          className="time-entry-drag-preview"
          style={{
            width: entryDragState.width,
            minHeight: entryDragState.height,
            transform: getSharedTableDragOverlayTransform(entryDragState),
          }}
        >
          <div className="time-entry-main">
            <EntryMain
              {...describeEntry(draggedEntry)}
              note={draggedEntry.note}
            />
          </div>
          <div className="time-entry-trailing">
            <Value>{formatClockDuration(draggedEntry.durationMs)}</Value>
          </div>
        </div>
      ) : null}
      {entryActions.dialogs}
    </div>
  );
}
