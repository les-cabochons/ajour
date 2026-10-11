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
  RiCloseLine as X,
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
import { Button } from "@/components/ui/button";
import {
  ObjectActionsButton,
  ObjectContextMenu,
} from "@/components/object-actions-menu";
import { useTimeEntryActions } from "@/features/time/time-entry-actions";
import { TimeEntryFields } from "@/features/time/time-entry-fields";
import {
  createTimeEntryEditorFields,
  evaluateTimeEntryEditor,
} from "@/features/time/time-entry-editor";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  ProjectTaskPicker,
  type ProjectTaskSelection,
} from "@/features/projects/project-task-picker";
import {
  formatClockDuration,
  normalizeHoursInput,
} from "@/domain/time/duration";
import {
  getLocalProjectDisplayName,
  type LocalTimesheetEntry,
} from "@/domain/local-state";
import type { TimeEntryActionId } from "@/domain/actions/object-actions";
import { localStore } from "@/lib/local-store";
import { isInlineEditorOutsideClick } from "@/lib/inline-editor-close";
import {
  createSharedTableDragPointerSession,
  getSharedTableDragOverlayTransform,
  getSharedTableDragRowShift,
  getSharedTableDragTargetIndex,
  setSharedTableDragDocumentState,
  SHARED_TABLE_DRAG_CLICK_SUPPRESSION_MS,
  type SharedTableDragPointerSession,
} from "@/lib/table-drag";
import { ProjectIcon } from "@/lib/project-icons";
import { cn } from "@/lib/utils";
import { useLocalProjects, useLocalState } from "@/lib/local-hooks";

const DESKTOP_ENTRY_MEDIA_QUERY = "(min-width: 641px)";

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

function moveId(ids: string[], fromIndex: number, toIndex: number) {
  const nextIds = [...ids];
  const [id] = nextIds.splice(fromIndex, 1);
  if (!id) {
    return ids;
  }

  nextIds.splice(toIndex, 0, id);
  return nextIds;
}

export function TimerPanel({
  date,
  onOpenEntry,
}: {
  date: string;
  onOpenEntry?: (target: { entryId?: string; timerId?: string }) => void;
}) {
  const state = useLocalState();
  const projects = useLocalProjects();
  const [now, setNow] = useState(() => Date.now());
  const [expandedEntryId, setExpandedEntryId] = useState<string | null>(null);
  const [expandedProjectId, setExpandedProjectId] = useState("");
  const [expandedTaskId, setExpandedTaskId] = useState("");
  const [expandedNote, setExpandedNote] = useState("");
  const [expandedDurationHours, setExpandedDurationHours] = useState("");
  const [isCreatingEntry, setIsCreatingEntry] = useState(false);
  const [newProjectId, setNewProjectId] = useState("");
  const [newTaskId, setNewTaskId] = useState("");
  const [newNote, setNewNote] = useState("");
  const [newDurationHours, setNewDurationHours] = useState("");
  const entryRowRefs = useRef(new Map<string, HTMLTableRowElement>());
  const expandedEntryEditorRef = useRef<HTMLDivElement>(null);
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
    onEdit: (target) => {
      if (target.kind === "running") {
        resetExpandedEntry();
        onOpenEntry?.({ timerId: target.timerId });
      } else if (expandedEntryId !== target.entry._id) {
        handleToggleEntry(target.entry);
      }
    },
    onAfterAction: () => resetExpandedEntry(),
  });
  const expandedEntry = expandedEntryId
    ? (state.timesheetEntries.find(
        (entry) => entry._id === expandedEntryId && entry.localDate === date,
      ) ?? null)
    : null;
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
  const expandedAvailableTasks = useMemo(
    () =>
      projects
        .find((project) => project._id === expandedProjectId)
        ?.tasks.filter((task) => task.status === "active") ?? [],
    [expandedProjectId, projects],
  );
  const expandedEditor = evaluateTimeEntryEditor(
    {
      projectId: expandedProjectId,
      taskId: expandedTaskId,
      note: expandedNote,
      durationHours: expandedDurationHours,
    },
    { original: expandedEntry ?? undefined },
  );
  const expandedDurationError = expandedEditor.durationError;
  const newAvailableTasks = useMemo(
    () =>
      projects
        .find((project) => project._id === newProjectId)
        ?.tasks.filter((task) => task.status === "active") ?? [],
    [newProjectId, projects],
  );
  const newEditor = evaluateTimeEntryEditor(
    {
      projectId: newProjectId,
      taskId: newTaskId,
      note: newNote,
      durationHours: newDurationHours,
    },
    { allowEmptyDuration: true },
  );
  const newDurationError = newEditor.durationError;
  const showNewTimeActions = newDurationHours.trim() !== "";

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
  const canReorderEntries =
    !isCreatingEntry && !expandedEntryId && draggableEntryIds.length > 1;

  useEffect(() => {
    if (!currentTimer || currentTimer.localDate !== date) {
      return;
    }

    setNow(Date.now());
    const intervalId = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(intervalId);
  }, [currentTimer?._id, currentTimer?.localDate, date]);

  useEffect(() => {
    if (!expandedEntryId) {
      return;
    }

    if (!expandedEntry) {
      resetExpandedEntry();
    }
  }, [expandedEntry, expandedEntryId]);

  useEffect(() => {
    if (!expandedEntry || !expandedProjectId) {
      return;
    }

    if (expandedAvailableTasks.some((task) => task._id === expandedTaskId)) {
      return;
    }

    setExpandedTaskId("");
  }, [
    expandedAvailableTasks,
    expandedEntry,
    expandedProjectId,
    expandedTaskId,
  ]);

  useEffect(() => {
    if (!isCreatingEntry || !newProjectId) {
      return;
    }

    if (newAvailableTasks.some((task) => task._id === newTaskId)) {
      return;
    }

    setNewTaskId("");
  }, [isCreatingEntry, newAvailableTasks, newProjectId, newTaskId]);

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

      if (
        shouldCommit &&
        currentDrag &&
        currentDrag.originIndex !== currentDrag.targetIndex
      ) {
        localStore.reorderTimesheetEntries(
          date,
          moveId(
            draggableEntryIds,
            currentDrag.originIndex,
            currentDrag.targetIndex,
          ),
        );
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

  function resetExpandedEntry() {
    setExpandedEntryId(null);
    setExpandedProjectId("");
    setExpandedTaskId("");
    setExpandedNote("");
    setExpandedDurationHours("");
  }

  function resetNewEntry() {
    setIsCreatingEntry(false);
    setNewProjectId("");
    setNewTaskId("");
    setNewNote("");
    setNewDurationHours("");
  }

  function closeNewEntry() {
    if (!newEditor.values) {
      return;
    }

    if (newEditor.hasContent) {
      localStore.saveManualTimeEntry({ ...newEditor.values, localDate: date });
    }

    resetNewEntry();
  }

  function discardNewEntry() {
    resetNewEntry();
  }

  function closeExpandedEntry() {
    if (!expandedEntry) {
      resetExpandedEntry();
      return true;
    }

    if (!expandedEditor.values) {
      return false;
    }

    if (expandedEditor.hasChanges) {
      localStore.updateTimesheetEntry(expandedEntry._id, expandedEditor.values);
    }

    resetExpandedEntry();
    return true;
  }

  function discardExpandedEntry() {
    resetExpandedEntry();
  }

  function handleExpandedEntryAction(actionId: TimeEntryActionId) {
    if (!expandedEntry) {
      return;
    }

    // Continue counts time on the saved entry, so keep the draft first.
    if (actionId === "continue") {
      if (closeExpandedEntry()) {
        localStore.continueTimesheetEntry(expandedEntry._id);
      }
      return;
    }

    entryActions.runAction({ kind: "entry", entry: expandedEntry }, actionId, {
      resolveValues: expandedEditor.relocationValues,
    });
  }

  function handleCreateToggle() {
    if (isCreatingEntry) {
      closeNewEntry();
      return;
    }

    if (expandedEntryId && !closeExpandedEntry()) {
      return;
    }

    if (
      typeof window !== "undefined" &&
      !window.matchMedia(DESKTOP_ENTRY_MEDIA_QUERY).matches
    ) {
      resetExpandedEntry();
      onOpenEntry?.({});
      return;
    }
    setIsCreatingEntry(true);
  }

  function handleToggleEntry(entry: LocalTimesheetEntry | RunningEntryRow) {
    if (performance.now() < suppressEntryClickUntilRef.current) {
      return;
    }

    if (isCreatingEntry) {
      closeNewEntry();
    }

    if (isRunningEntry(entry)) {
      resetExpandedEntry();
      onOpenEntry?.({ entryId: entry.entryId, timerId: entry.timerId });
      return;
    }

    if (
      typeof window !== "undefined" &&
      !window.matchMedia(DESKTOP_ENTRY_MEDIA_QUERY).matches
    ) {
      resetExpandedEntry();
      onOpenEntry?.({ entryId: entry._id });
      return;
    }

    if (expandedEntryId === entry._id) {
      closeExpandedEntry();
      return;
    }

    if (expandedEntryId && !closeExpandedEntry()) {
      return;
    }

    setExpandedEntryId(entry._id);
    const fields = createTimeEntryEditorFields(entry);
    setExpandedProjectId(fields.projectId);
    setExpandedTaskId(fields.taskId);
    setExpandedNote(fields.note);
    setExpandedDurationHours(fields.durationHours);
  }

  useEffect(() => {
    if (!isCreatingEntry) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        discardNewEntry();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isCreatingEntry]);

  useEffect(() => {
    if (!expandedEntryId) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        discardExpandedEntry();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [expandedEntryId]);

  // The outside-click listener stays bound while the entry is open and reads
  // the latest draft through this ref, so it saves what the user typed.
  const closeExpandedEntryRef = useRef(closeExpandedEntry);
  useEffect(() => {
    closeExpandedEntryRef.current = closeExpandedEntry;
  });

  useEffect(() => {
    if (!expandedEntryId) {
      return;
    }

    function handleDocumentMouseDown(event: MouseEvent) {
      if (
        !isInlineEditorOutsideClick(
          event.target,
          expandedEntryEditorRef.current,
          // Menus and dialogs opened from the editor's action set render in portals.
          [
            '[data-slot="dropdown-menu-content"]',
            '[data-slot="context-menu-content"]',
            '[role="dialog"]',
            '[role="alertdialog"]',
          ],
        )
      ) {
        return;
      }

      closeExpandedEntryRef.current();
    }

    document.addEventListener("mousedown", handleDocumentMouseDown);
    return () => {
      document.removeEventListener("mousedown", handleDocumentMouseDown);
    };
  }, [expandedEntryId]);

  function handleExpandedProjectTaskChange(selection: ProjectTaskSelection) {
    setExpandedProjectId(selection.projectId);
    setExpandedTaskId(selection.taskId);
  }

  function handleNewProjectTaskChange(selection: ProjectTaskSelection) {
    setNewProjectId(selection.projectId);
    setNewTaskId(selection.taskId);
  }

  function handleContinueEntry(entryId: string) {
    resetExpandedEntry();
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

    event.currentTarget.setPointerCapture(event.pointerId);
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
              <th className="entry-notes-heading hidden lg:table-cell">
                Notes
              </th>
              <th className="entry-notes-heading lg:hidden">Entries</th>
              <th className="entry-hours-heading entry-hours-heading-create lg:hidden">
                <div className="flex justify-end">
                  <button
                    type="button"
                    className={cn(
                      "entries-header-add entries-header-bubble",
                      isCreatingEntry && "is-open",
                    )}
                    aria-label={
                      isCreatingEntry ? "Close new entry" : "Add new entry"
                    }
                    onClick={handleCreateToggle}
                  >
                    <span className="entries-header-add-label">New entry</span>
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                </div>
              </th>
              <th className="entry-hours-heading entry-hours-heading-actions hidden lg:table-cell">
                <button
                  type="button"
                  className={cn(
                    "entries-header-add",
                    isCreatingEntry && "is-open",
                  )}
                  aria-label={
                    isCreatingEntry ? "Close new entry" : "Add new entry"
                  }
                  onClick={handleCreateToggle}
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
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
            <tbody className="entries-table-scroll-region">
              {isCreatingEntry ? (
                <tr
                  className="entry-edit-row"
                  onClick={(event) => event.stopPropagation()}
                >
                  <td colSpan={3}>
                    <div className="entry-edit-dropdown entry-create-dropdown">
                      <div className="entry-edit-dropdown-grid">
                        <label className="field col-span-full">
                          <span className="field-label">Project / task</span>
                          <ProjectTaskPicker
                            projects={projects}
                            projectId={newProjectId}
                            taskId={newTaskId}
                            onChange={handleNewProjectTaskChange}
                            placeholder="No project"
                          />
                        </label>

                        <label className="field entry-field-note">
                          <span className="field-label">Note</span>
                          <textarea
                            className="field-input entry-note-input"
                            value={newNote}
                            onChange={(event) => setNewNote(event.target.value)}
                            placeholder="Notes (optional)"
                            rows={2}
                          />
                        </label>

                        <label className="field entry-field-hours">
                          <span className="field-label">Hours</span>
                          <div className="inline-hours-input-shell">
                            <input
                              className="field-input entry-hours-input inline-hours-input"
                              type="text"
                              placeholder="01:30"
                              style={{ fontFamily: "var(--font-mono)" }}
                              value={newDurationHours}
                              onChange={(event) =>
                                setNewDurationHours(event.target.value)
                              }
                              onBlur={(event) =>
                                setNewDurationHours(
                                  normalizeHoursInput(event.target.value),
                                )
                              }
                              onKeyDown={(event) => {
                                if (event.key === "Enter") {
                                  event.preventDefault();
                                  closeNewEntry();
                                }
                              }}
                              aria-label="Hours"
                            />
                            {showNewTimeActions ? (
                              <div className="inline-hours-actions">
                                <button
                                  type="button"
                                  className="inline-hours-action"
                                  aria-label="Save and close new entry"
                                  disabled={Boolean(newDurationError)}
                                  onClick={closeNewEntry}
                                >
                                  <Check className="h-3.5 w-3.5" />
                                </button>
                                <button
                                  type="button"
                                  className="inline-hours-action"
                                  aria-label="Discard new entry"
                                  onClick={discardNewEntry}
                                >
                                  <X className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            ) : null}
                          </div>
                          {newDurationError ? (
                            <span className="field-error">
                              {newDurationError}
                            </span>
                          ) : null}
                        </label>
                      </div>
                    </div>
                  </td>
                </tr>
              ) : null}

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
                          Saved manual and timer-based entries for this day will
                          appear here.
                        </EmptyDescription>
                      </EmptyHeader>
                      <EmptyContent>
                        <Button
                          size="sm"
                          className="gap-1.5"
                          onClick={handleCreateToggle}
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
                const isExpanded = expandedEntry?._id === entry._id;
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
                            isExpanded && "entry-row-expanded",
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
                          onClick={() => handleToggleEntry(entry)}
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
                              <button
                                type="button"
                                className="entry-row-action entry-row-action-play"
                                aria-label={
                                  currentTimer
                                    ? "Continue and stop the running entry"
                                    : "Continue"
                                }
                                data-no-entry-drag="true"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  handleContinueEntry(entry._id);
                                }}
                              >
                                <Play className="h-3.5 w-3.5" />
                              </button>
                            )}
                            <ObjectActionsButton
                              actions={rowActions}
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
                    {!isRunning && isExpanded && expandedEntry ? (
                      <tr
                        className="entry-edit-row"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <td colSpan={3}>
                          <div
                            ref={expandedEntryEditorRef}
                            className="entry-edit-dropdown"
                          >
                            <div className="entry-edit-dropdown-content">
                              <div className="entry-edit-dropdown-actions">
                                <ObjectActionsButton
                                  actions={entryActions.getActions(
                                    { kind: "entry", entry: expandedEntry },
                                    {
                                      isEditing: true,
                                      invalidDraftReason: expandedEditor.canSave
                                        ? undefined
                                        : "Enter a valid duration first",
                                    },
                                  )}
                                  onAction={handleExpandedEntryAction}
                                  label="Entry actions"
                                />
                              </div>
                              <TimeEntryFields
                                idPrefix={`day-entry-${expandedEntry._id}`}
                                className="entry-edit-dropdown-grid"
                                projects={projects}
                                projectId={expandedProjectId}
                                taskId={expandedTaskId}
                                note={expandedNote}
                                durationHours={expandedDurationHours}
                                durationError={expandedDurationError}
                                onProjectTaskChange={
                                  handleExpandedProjectTaskChange
                                }
                                onNoteChange={setExpandedNote}
                                onDurationChange={setExpandedDurationHours}
                                onDurationKeyDown={(event) => {
                                  if (event.key === "Enter") {
                                    event.preventDefault();
                                    closeExpandedEntry();
                                  }
                                }}
                              />
                            </div>
                          </div>
                        </td>
                      </tr>
                    ) : null}
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
