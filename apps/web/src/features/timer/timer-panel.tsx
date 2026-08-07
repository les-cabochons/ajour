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
  RiDeleteBinLine as Trash2,
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
import { ScrollArea } from "@/components/ui/scroll-area";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { buildProjectTaskOptions } from "@/features/projects/project-task-options";
import {
  formatClockDuration,
  formatDurationHoursInput,
  normalizeHoursInput,
  parseHoursInput,
} from "@/domain/time/duration";
import {
  getLocalProjectDisplayName,
  type LocalTimesheetEntry,
} from "@/domain/local-state";
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
  const [pendingDeleteEntryId, setPendingDeleteEntryId] = useState<
    string | null
  >(null);
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

  const projectOptions = useMemo(
    () =>
      projects.map((project) => ({
        value: project._id,
        label: project.code
          ? `[${project.code}] ${getLocalProjectDisplayName(project)}`
          : getLocalProjectDisplayName(project),
        keywords: [
          project.name,
          getLocalProjectDisplayName(project),
          project.code ?? "",
        ],
      })),
    [projects],
  );
  const currentTimer = state.timers[0] ?? null;
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
  const expandedTaskOptions = useMemo(
    () => buildProjectTaskOptions(expandedAvailableTasks),
    [expandedAvailableTasks],
  );
  const expandedParsedDurationMs = useMemo(
    () => parseHoursInput(expandedDurationHours),
    [expandedDurationHours],
  );
  const expandedOriginalDurationHours = useMemo(
    () =>
      expandedEntry ? formatDurationHoursInput(expandedEntry.durationMs) : "",
    [expandedEntry],
  );
  const hasExpandedTimeChanged = Boolean(
    expandedEntry && expandedDurationHours !== expandedOriginalDurationHours,
  );
  const expandedDurationError = !hasExpandedTimeChanged
    ? null
    : expandedParsedDurationMs === null
      ? "Enter a valid duration"
      : expandedParsedDurationMs <= 0
        ? "Enter a positive duration"
        : null;
  const newAvailableTasks = useMemo(
    () =>
      projects
        .find((project) => project._id === newProjectId)
        ?.tasks.filter((task) => task.status === "active") ?? [],
    [newProjectId, projects],
  );
  const newTaskOptions = useMemo(
    () => buildProjectTaskOptions(newAvailableTasks),
    [newAvailableTasks],
  );
  const newParsedDurationMs = useMemo(
    () => parseHoursInput(newDurationHours),
    [newDurationHours],
  );
  const newDurationError = useMemo(
    () =>
      newDurationHours.trim() !== "" && newParsedDurationMs === null
        ? "Enter a valid duration"
        : null,
    [newDurationHours, newParsedDurationMs],
  );
  const hasNewEntryContent = Boolean(
    newProjectId || newTaskId || newNote.trim() || newDurationHours.trim(),
  );
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
    if (!pendingDeleteEntryId) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setPendingDeleteEntryId((current) =>
        current === pendingDeleteEntryId ? null : current,
      );
    }, 2500);

    return () => window.clearTimeout(timeoutId);
  }, [pendingDeleteEntryId]);

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
    setPendingDeleteEntryId(null);
  }

  function resetNewEntry() {
    setIsCreatingEntry(false);
    setNewProjectId("");
    setNewTaskId("");
    setNewNote("");
    setNewDurationHours("");
  }

  function closeNewEntry() {
    if (newDurationHours.trim() !== "" && newParsedDurationMs === null) {
      return;
    }

    if (hasNewEntryContent) {
      localStore.saveManualTimeEntry({
        localDate: date,
        projectId: newProjectId || undefined,
        taskId: newTaskId || undefined,
        note: newNote.trim() || undefined,
        durationMs: newParsedDurationMs ?? 0,
      });
    }

    resetNewEntry();
  }

  function discardNewEntry() {
    resetNewEntry();
  }

  function persistExpandedMetadata(nextValues?: {
    projectId?: string;
    taskId?: string;
    note?: string;
  }) {
    if (!expandedEntry) {
      return;
    }

    const nextProjectId =
      (nextValues?.projectId ?? expandedProjectId) || undefined;
    const nextTaskId = (nextValues?.taskId ?? expandedTaskId) || undefined;
    const nextNote = (nextValues?.note ?? expandedNote).trim() || undefined;
    const hasMetadataChanges =
      nextProjectId !== expandedEntry.projectId ||
      nextTaskId !== expandedEntry.taskId ||
      nextNote !== expandedEntry.note;

    if (!hasMetadataChanges) {
      return;
    }

    localStore.updateTimesheetEntry(expandedEntry._id, {
      projectId: nextProjectId,
      taskId: nextTaskId,
      note: nextNote,
      durationMs: expandedEntry.durationMs,
    });
  }

  function persistExpandedDuration(nextDurationHours: string) {
    if (!expandedEntry) {
      return;
    }

    const nextDurationMs = parseHoursInput(nextDurationHours);
    if (
      nextDurationMs === null ||
      nextDurationMs <= 0 ||
      nextDurationMs === expandedEntry.durationMs
    ) {
      return;
    }

    localStore.updateTimesheetEntry(expandedEntry._id, {
      projectId: expandedProjectId || undefined,
      taskId: expandedTaskId || undefined,
      note: expandedNote.trim() || undefined,
      durationMs: nextDurationMs,
    });
  }

  function closeExpandedEntry() {
    if (!expandedEntry) {
      resetExpandedEntry();
      return true;
    }

    if (expandedParsedDurationMs === null) {
      return false;
    }

    const nextProjectId = expandedProjectId || undefined;
    const nextTaskId = expandedTaskId || undefined;
    const nextNote = expandedNote.trim() || undefined;
    const hasChanges =
      nextProjectId !== expandedEntry.projectId ||
      nextTaskId !== expandedEntry.taskId ||
      nextNote !== expandedEntry.note ||
      expandedParsedDurationMs !== expandedEntry.durationMs;

    if (hasChanges) {
      localStore.updateTimesheetEntry(expandedEntry._id, {
        projectId: nextProjectId,
        taskId: nextTaskId,
        note: nextNote,
        durationMs: expandedParsedDurationMs,
      });
    }

    resetExpandedEntry();
    return true;
  }

  function discardExpandedEntry() {
    resetExpandedEntry();
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
      setPendingDeleteEntryId(null);
      onOpenEntry?.({});
      return;
    }

    setPendingDeleteEntryId(null);
    setIsCreatingEntry(true);
  }

  function handleToggleEntry(entry: LocalTimesheetEntry | RunningEntryRow) {
    if (performance.now() < suppressEntryClickUntilRef.current) {
      return;
    }

    setPendingDeleteEntryId(null);

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
    setExpandedProjectId(entry.projectId ?? "");
    setExpandedTaskId(entry.taskId ?? "");
    setExpandedNote(entry.note ?? "");
    setExpandedDurationHours(formatDurationHoursInput(entry.durationMs));
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

  useEffect(() => {
    if (!expandedEntryId) {
      return;
    }

    function handleDocumentMouseDown(event: MouseEvent) {
      if (
        !isInlineEditorOutsideClick(
          event.target,
          expandedEntryEditorRef.current,
        )
      ) {
        return;
      }

      closeExpandedEntry();
    }

    document.addEventListener("mousedown", handleDocumentMouseDown);
    return () => {
      document.removeEventListener("mousedown", handleDocumentMouseDown);
    };
  }, [expandedEntryId]);

  function handleExpandedProjectChange(nextProjectId: string) {
    const nextTaskId =
      nextProjectId === expandedProjectId ? expandedTaskId : "";
    setExpandedProjectId(nextProjectId);
    setExpandedTaskId(nextTaskId);
    persistExpandedMetadata({
      projectId: nextProjectId,
      taskId: nextTaskId,
      note: expandedNote,
    });
  }

  function handleExpandedTaskChange(nextTaskId: string) {
    setExpandedTaskId(nextTaskId);
    persistExpandedMetadata({
      projectId: expandedProjectId,
      taskId: nextTaskId,
      note: expandedNote,
    });
  }

  function handleNewProjectChange(nextProjectId: string) {
    const nextTaskId =
      projects
        .find((project) => project._id === nextProjectId)
        ?.tasks.find((task) => task.status === "active")?._id ?? "";

    setNewProjectId(nextProjectId);
    setNewTaskId(nextTaskId);
  }

  function handleRestartEntry(entryId: string) {
    setPendingDeleteEntryId(null);
    resetExpandedEntry();
    localStore.restartTimesheetEntry(entryId);
  }

  function handleDeleteEntry(entryId: string) {
    if (pendingDeleteEntryId === entryId) {
      localStore.deleteTimesheetEntry(entryId);
      if (expandedEntryId === entryId) {
        resetExpandedEntry();
      } else {
        setPendingDeleteEntryId(null);
      }
      return;
    }

    setPendingDeleteEntryId(entryId);
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
      setPendingDeleteEntryId(null);
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
                        <label className="field entry-field-span-2">
                          <span className="field-label">Project</span>
                          <SearchableSelect
                            value={newProjectId}
                            options={projectOptions}
                            onChange={handleNewProjectChange}
                            placeholder="No project"
                            clearLabel="No project"
                            emptyMessage="No matching projects"
                            ariaLabel="Project"
                          />
                        </label>

                        <label className="field entry-field-span-2">
                          <span className="field-label">Task</span>
                          <SearchableSelect
                            value={newTaskId}
                            options={newTaskOptions}
                            onChange={setNewTaskId}
                            placeholder={
                              newProjectId
                                ? "Select task"
                                : "Pick a project first"
                            }
                            clearLabel={newProjectId ? "No task" : undefined}
                            emptyMessage={
                              newProjectId
                                ? "No matching tasks"
                                : "Pick a project first"
                            }
                            ariaLabel="Task"
                            disabled={
                              !newProjectId || newAvailableTasks.length === 0
                            }
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
                const isDeletePending = pendingDeleteEntryId === entry._id;
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
                          ? { transform: `translate3d(0, ${rowShift}px, 0)` }
                          : undefined
                      }
                      aria-grabbed={isDraggedEntry}
                      onClick={() => handleToggleEntry(entry)}
                      onPointerDown={(event) =>
                        handleEntryPointerDown(entry, event)
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
                          {isRunning ? (
                            <span className="stat-pill stat-pill-active entry-running-pill">
                              <span className="status-dot status-dot-pulse" />
                              <span className="stat-pill-value">
                                {formatClockDuration(entry.durationMs)}
                              </span>
                            </span>
                          ) : (
                            <div
                              className={cn(
                                "entry-row-actions",
                                isDeletePending && "is-confirming",
                              )}
                            >
                              <button
                                type="button"
                                className="entry-row-action entry-row-action-play"
                                aria-label={
                                  currentTimer
                                    ? "Switch timer to this entry"
                                    : "Restart entry"
                                }
                                data-no-entry-drag="true"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  handleRestartEntry(entry._id);
                                }}
                              >
                                <Play className="h-3.5 w-3.5" />
                              </button>
                              <span className="entry-row-action-slot">
                                <button
                                  type="button"
                                  className={cn(
                                    "entry-row-action",
                                    "entry-row-action-delete",
                                    isDeletePending && "is-confirming",
                                  )}
                                  aria-label={
                                    isDeletePending
                                      ? "Confirm delete entry"
                                      : "Delete entry"
                                  }
                                  data-no-entry-drag="true"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    handleDeleteEntry(entry._id);
                                  }}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                  {isDeletePending ? (
                                    <span>Confirm</span>
                                  ) : null}
                                </button>
                              </span>
                            </div>
                          )}
                          {isRunning ? null : (
                            <span className="hours-badge">
                              {formatClockDuration(entry.durationMs)}
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
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
                            <div className="entry-edit-dropdown-grid">
                              {/* Project */}
                              <label className="field entry-field-span-2">
                                <span className="field-label">Project</span>
                                <SearchableSelect
                                  value={expandedProjectId}
                                  options={projectOptions}
                                  onChange={handleExpandedProjectChange}
                                  placeholder="No project"
                                  clearLabel="No project"
                                  emptyMessage="No matching projects"
                                  ariaLabel="Project"
                                />
                              </label>

                              {/* Task */}
                              <label className="field entry-field-span-2">
                                <span className="field-label">Task</span>
                                <SearchableSelect
                                  value={expandedTaskId}
                                  options={expandedTaskOptions}
                                  onChange={handleExpandedTaskChange}
                                  placeholder={
                                    expandedProjectId
                                      ? "Select task"
                                      : "Pick a project first"
                                  }
                                  clearLabel={
                                    expandedProjectId ? "No task" : undefined
                                  }
                                  emptyMessage={
                                    expandedProjectId
                                      ? "No matching tasks"
                                      : "Pick a project first"
                                  }
                                  ariaLabel="Task"
                                  disabled={
                                    !expandedProjectId ||
                                    expandedAvailableTasks.length === 0
                                  }
                                />
                              </label>

                              {/* Note */}
                              <label className="field entry-field-note">
                                <span className="field-label">Note</span>
                                <textarea
                                  className="field-input entry-note-input"
                                  value={expandedNote}
                                  onChange={(event) =>
                                    setExpandedNote(event.target.value)
                                  }
                                  onBlur={(event) => {
                                    const nextNote = event.target.value.trim();
                                    setExpandedNote(nextNote);
                                    persistExpandedMetadata({ note: nextNote });
                                  }}
                                  placeholder="Notes (optional)"
                                  rows={2}
                                />
                              </label>

                              {/* Hours */}
                              <label className="field entry-field-hours">
                                <span className="field-label">Hours</span>
                                <div className="inline-hours-input-shell">
                                  <input
                                    className="field-input entry-hours-input inline-hours-input"
                                    type="text"
                                    placeholder="01:30"
                                    style={{ fontFamily: "var(--font-mono)" }}
                                    value={expandedDurationHours}
                                    onChange={(event) =>
                                      setExpandedDurationHours(
                                        event.target.value,
                                      )
                                    }
                                    onBlur={(event) => {
                                      const normalizedValue =
                                        normalizeHoursInput(event.target.value);
                                      setExpandedDurationHours(normalizedValue);
                                      const nextTarget = event.relatedTarget;
                                      if (
                                        nextTarget instanceof HTMLElement &&
                                        nextTarget.closest(
                                          ".inline-hours-actions",
                                        )
                                      ) {
                                        return;
                                      }

                                      persistExpandedDuration(normalizedValue);
                                    }}
                                    onKeyDown={(event) => {
                                      if (event.key === "Enter") {
                                        event.preventDefault();
                                        closeExpandedEntry();
                                      }
                                    }}
                                    aria-label="Hours"
                                  />
                                  {hasExpandedTimeChanged ? (
                                    <div className="inline-hours-actions">
                                      <button
                                        type="button"
                                        className="inline-hours-action"
                                        aria-label="Save and close entry"
                                        disabled={Boolean(
                                          expandedDurationError,
                                        )}
                                        onMouseDown={(event) =>
                                          event.preventDefault()
                                        }
                                        onClick={closeExpandedEntry}
                                      >
                                        <Check className="h-3.5 w-3.5" />
                                      </button>
                                      <button
                                        type="button"
                                        className="inline-hours-action"
                                        aria-label="Cancel entry changes"
                                        onMouseDown={(event) =>
                                          event.preventDefault()
                                        }
                                        onClick={discardExpandedEntry}
                                      >
                                        <X className="h-3.5 w-3.5" />
                                      </button>
                                    </div>
                                  ) : null}
                                </div>
                                {expandedDurationError ? (
                                  <span className="field-error">
                                    {expandedDurationError}
                                  </span>
                                ) : null}
                              </label>
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
                  transform:
                    getSharedTableDragOverlayTransform(entryDragState),
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
    </div>
  );
}
