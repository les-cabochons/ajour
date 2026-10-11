import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  RiAddLine as Plus,
  RiPlayLine as Play,
  RiTimerLine as Timer,
} from "@remixicon/react";
import {
  Empty,
  EmptyDescription,
  EmptyContent,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { TooltipButton } from "@/components/tooltip-button";
import { Button } from "@/components/ui/button";
import {
  ObjectActionsButton,
  ObjectContextMenu,
} from "@/components/object-actions-menu";
import { useTimeEntryActions } from "@/features/time/time-entry-actions";
import { ScrollArea } from "@/components/ui/scroll-area";
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

/**
 * The Day view's entry list. Rows and "New entry" ask the page to open the entry
 * editor through `onOpenEntry`; an empty target means a new entry on `date`.
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
  const [now, setNow] = useState(() => Date.now());
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

  useEffect(() => {
    if (!currentTimer || currentTimer.localDate !== date) {
      return;
    }

    setNow(Date.now());
    const intervalId = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(intervalId);
  }, [currentTimer?._id, currentTimer?.localDate, date]);

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

  return (
    <div className="space-y-3">
      <div className="entries-table-scroll-shell entries-table-scroll-shell-time">
        <table className="entries-table entries-table-header-table animate-in">
          <thead>
            <tr>
              <th className="entry-project-heading">Project</th>
              <th className="entry-notes-heading hidden desktop:table-cell">
                Notes
              </th>
              <th className="entry-notes-heading desktop:hidden">Entries</th>
              <th className="entry-hours-heading entry-hours-heading-create desktop:hidden">
                <div className="flex justify-end">
                  <button
                    type="button"
                    className="entries-header-add entries-header-bubble"
                    aria-label="New entry"
                    onClick={() => onOpenEntry({})}
                  >
                    <span className="entries-header-add-label">New entry</span>
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                </div>
              </th>
              <th className="entry-hours-heading entry-hours-heading-actions hidden desktop:table-cell">
                <TooltipButton
                  className="entries-header-add"
                  label="New entry"
                  shortcut="entry.new"
                  onClick={() => onOpenEntry({})}
                >
                  <Plus className="h-3.5 w-3.5" />
                </TooltipButton>
              </th>
            </tr>
          </thead>
        </table>
        <ScrollArea className="entries-table-scroll-area">
          <table
            className={cn(
              "entries-table entries-table-body-table animate-in",
              entryDragState && "is-entry-dragging",
            )}
          >
            <tbody className="entries-table-scroll-region" data-focus-scope>
              {visibleEntries.length === 0 ? (
                <tr className="entry-empty-row">
                  <td colSpan={3}>
                    <Empty className="entry-table-empty">
                      <EmptyHeader>
                        <EmptyMedia variant="icon">
                          <Timer className="h-5 w-5" />
                        </EmptyMedia>
                        <EmptyTitle className="font-sans text-[14px] font-semibold tracking-normal">
                          No time entries
                        </EmptyTitle>
                        <EmptyDescription>
                          Saved and running entries for this day appear here.
                        </EmptyDescription>
                      </EmptyHeader>
                      <EmptyContent>
                        <Button
                          size="sm"
                          className="gap-1.5"
                          onClick={() => onOpenEntry({})}
                        >
                          <Plus className="h-3.5 w-3.5" />
                          New entry
                        </Button>
                      </EmptyContent>
                    </Empty>
                  </td>
                </tr>
              ) : null}
              {visibleEntries.map((entry) => {
                const project = projects.find(
                  (item) => item._id === entry.projectId,
                );
                const task = project?.tasks.find(
                  (item) => item._id === entry.taskId,
                );
                const isRunning = "isRunning" in entry && entry.isRunning;
                const isEditing =
                  activeEntryId !== undefined && entry._id === activeEntryId;
                const rowTarget = isRunningEntry(entry)
                  ? { kind: "running" as const, timerId: entry.timerId }
                  : { kind: "entry" as const, entry };
                const rowActions = entryActions.getActions(rowTarget);
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

                return (
                  <React.Fragment key={entry._id}>
                    <ObjectContextMenu
                      actions={rowActions}
                      keys={TIME_ENTRY_ACTION_KEYS}
                      onAction={(actionId) =>
                        entryActions.runAction(rowTarget, actionId)
                      }
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
                            isEditing && "is-editing",
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
                          data-entry-id={entry._id}
                          data-running-entry={isRunning ? "true" : undefined}
                          data-focus-column="0"
                          tabIndex={0}
                          onClick={() => openEntry(entry)}
                          onKeyDown={(event) =>
                            handleItemKeyDown(event, {
                              actions: rowActions,
                              keys: TIME_ENTRY_ACTION_KEYS,
                              onAction: (actionId) =>
                                entryActions.runAction(rowTarget, actionId),
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
                      <td className="entry-project-column">
                        <div className="entry-project-cell">
                          <ProjectIcon
                            icon={project?.icon}
                            color={project?.color ?? "#3b82f6"}
                            className="entry-project-dot"
                            fallback="dot"
                          />
                          <span className="entry-project-name">
                            {project
                              ? getLocalProjectDisplayName(project)
                              : "No project"}
                          </span>
                        </div>
                      </td>
                      <td className="entry-notes-cell">
                        <div className="entry-notes-content">
                          <div className="entry-project-cell entry-project-cell-mobile">
                            <ProjectIcon
                              icon={project?.icon}
                              color={project?.color ?? "#3b82f6"}
                              className="entry-project-dot"
                              fallback="dot"
                            />
                            <span className="entry-project-name">
                              {project
                                ? getLocalProjectDisplayName(project)
                                : "No project"}
                            </span>
                          </div>
                          {task?.name && (
                            <span className="entry-task-name">{task.name}</span>
                          )}
                          {entry.note && (
                            <span className="entry-note-text">
                              {entry.note}
                            </span>
                          )}
                          {"submittedAt" in entry && entry.submittedAt ? (
                            <span className="entry-submitted-status">
                              submitted
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td className="entry-hours-cell">
                        <div className="entry-hours-content">
                          <div className="entry-row-actions">
                            {isRunning ? null : (
                              <TooltipButton
                                className="entry-row-action entry-row-action-play"
                                label={
                                  currentTimer
                                    ? "Continue and stop the running entry"
                                    : "Continue"
                                }
                                shortcut="entry.continue"
                                data-no-entry-drag="true"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  handleContinueEntry(entry._id);
                                }}
                              >
                                <Play className="h-3.5 w-3.5" />
                              </TooltipButton>
                            )}
                            <ObjectActionsButton
                              actions={rowActions}
                              keys={TIME_ENTRY_ACTION_KEYS}
                              onAction={(actionId) =>
                                entryActions.runAction(rowTarget, actionId)
                              }
                              label="Entry actions"
                              className="entry-row-action"
                            />
                          </div>
                          {isRunning ? (
                            <span className="stat-pill stat-pill-active entry-running-pill">
                              <span className="status-dot status-dot-pulse" />
                              <span className="stat-pill-value">
                                {formatClockDuration(entry.durationMs)}
                              </span>
                            </span>
                          ) : null}
                          {isRunning ? null : (
                            <span className="hours-badge">
                              {formatClockDuration(entry.durationMs)}
                            </span>
                          )}
                        </div>
                      </td>
                    </ObjectContextMenu>
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </ScrollArea>
      </div>

      {draggedEntry && entryDragState
        ? (() => {
            const project = projects.find(
              (item) => item._id === draggedEntry.projectId,
            );
            const task = project?.tasks.find(
              (item) => item._id === draggedEntry.taskId,
            );

            return (
              <div
                className="time-entry-drag-preview"
                style={{
                  width: entryDragState.width,
                  minHeight: entryDragState.height,
                  transform: getSharedTableDragOverlayTransform(entryDragState),
                }}
              >
                <div className="entry-project-column">
                  <div className="entry-project-cell">
                    <ProjectIcon
                      icon={project?.icon}
                      color={project?.color ?? "#3b82f6"}
                      className="entry-project-dot"
                      fallback="dot"
                    />
                    <span className="entry-project-name">
                      {project
                        ? getLocalProjectDisplayName(project)
                        : "No project"}
                    </span>
                  </div>
                </div>
                <div className="entry-notes-cell">
                  <div className="entry-notes-content">
                    {task?.name ? (
                      <span className="entry-task-name">{task.name}</span>
                    ) : null}
                    {draggedEntry.note ? (
                      <span className="entry-note-text">
                        {draggedEntry.note}
                      </span>
                    ) : null}
                  </div>
                </div>
                <div className="entry-hours-cell">
                  <div className="entry-hours-content">
                    <span className="hours-badge">
                      {formatClockDuration(draggedEntry.durationMs)}
                    </span>
                  </div>
                </div>
              </div>
            );
          })()
        : null}
      {entryActions.dialogs}
    </div>
  );
}
