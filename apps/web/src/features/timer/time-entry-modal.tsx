import { useEffect, useMemo, useRef, useState } from "react";
import {
  RiCloseLine as X,
  RiDeleteBinLine as Trash2,
  RiPlayLine as Play,
  RiSaveLine as Save,
  RiStopLine as Square,
} from "@remixicon/react";
import { Button } from "@/components/ui/button";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { buildProjectTaskOptions } from "@/features/projects/project-task-options";
import {
  formatDurationHoursInput,
  normalizeHoursInput,
  parseHoursInput,
} from "@/domain/time/duration";
import { getLocalProjectDisplayName } from "@/domain/local-state";
import { localStore } from "@/lib/local-store";
import { useLocalProjects, useLocalState } from "@/lib/local-hooks";

interface TimeEntryModalProps {
  date: string;
  entryId?: string;
  timerId?: string;
  onClose: () => void;
}

export function TimeEntryModal({
  date,
  entryId,
  timerId,
  onClose,
}: TimeEntryModalProps) {
  const state = useLocalState();
  const projects = useLocalProjects();
  const overlayRef = useRef<HTMLDivElement>(null);
  const [now, setNow] = useState(() => Date.now());

  const currentTimer = state.timers[0] ?? null;
  const editingTimer = useMemo(
    () =>
      timerId &&
      currentTimer?._id === timerId &&
      currentTimer.localDate === date
        ? currentTimer
        : null,
    [currentTimer, date, timerId],
  );
  const editingEntry = useMemo(
    () =>
      entryId
        ? (state.timesheetEntries.find(
            (entry) => entry._id === entryId && entry.localDate === date,
          ) ?? null)
        : null,
    [date, entryId, state.timesheetEntries],
  );
  const isEditing = Boolean(editingEntry || editingTimer);
  const isEditingTimer = Boolean(editingTimer);
  const runningDurationMs = editingTimer
    ? editingTimer.accumulatedDurationMs +
      Math.max(0, now - editingTimer.startedAt)
    : 0;

  const [projectId, setProjectId] = useState("");
  const [taskId, setTaskId] = useState("");
  const [note, setNote] = useState("");
  const [durationHours, setDurationHours] = useState("");

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
  const availableTasks = useMemo(
    () =>
      projects
        .find((project) => project._id === projectId)
        ?.tasks.filter((task) => task.status === "active") ?? [],
    [projectId, projects],
  );
  const taskOptions = useMemo(
    () => buildProjectTaskOptions(availableTasks),
    [availableTasks],
  );

  const parsedDurationMs = useMemo(
    () => parseHoursInput(durationHours),
    [durationHours],
  );
  const canSave = Boolean(projectId) && (parsedDurationMs ?? 0) > 0;
  const startTimerLabel = currentTimer ? "Switch timer" : "Start timer";
  const isTimerMode = durationHours.trim() === "" || parsedDurationMs === 0;
  const title = isEditingTimer
    ? "Running timer"
    : isEditing
      ? "Edit time entry"
      : "New time entry";

  useEffect(() => {
    if (!editingTimer) {
      return;
    }

    setNow(Date.now());
    const intervalId = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(intervalId);
  }, [editingTimer]);

  useEffect(() => {
    if (editingTimer) {
      setProjectId(editingTimer.projectId ?? "");
      setTaskId(editingTimer.taskId ?? "");
      setNote(editingTimer.note ?? "");
      return;
    }

    if (!editingEntry) {
      setProjectId("");
      setTaskId("");
      setNote("");
      setDurationHours("");
      return;
    }

    setProjectId(editingEntry.projectId ?? "");
    setTaskId(editingEntry.taskId ?? "");
    setNote(editingEntry.note ?? "");
    setDurationHours(formatDurationHoursInput(editingEntry.durationMs));
  }, [editingEntry, editingTimer]);

  useEffect(() => {
    if (!editingTimer) {
      return;
    }

    setDurationHours(formatDurationHoursInput(runningDurationMs));
  }, [editingTimer, runningDurationMs]);

  useEffect(() => {
    if (timerId && !editingTimer) {
      onClose();
    }
  }, [editingTimer, onClose, timerId]);

  // Close on click outside
  useEffect(() => {
    function handleMouseDown(event: MouseEvent) {
      if (overlayRef.current === event.target) {
        onClose();
      }
    }

    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [onClose]);

  // Close on Escape
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  function handleProjectChange(nextProjectId: string) {
    const nextTaskId =
      projects
        .find((project) => project._id === nextProjectId)
        ?.tasks.find((task) => task.status === "active")?._id ?? "";

    setProjectId(nextProjectId);
    setTaskId(nextTaskId);
  }

  function handleSave() {
    if (editingTimer) {
      return;
    }

    if (!projectId || (parsedDurationMs ?? 0) <= 0) {
      return;
    }

    if (editingEntry) {
      localStore.updateTimesheetEntry(editingEntry._id, {
        projectId,
        taskId: taskId || undefined,
        note: note.trim() || undefined,
        durationMs: parsedDurationMs!,
      });
    } else {
      localStore.saveManualTimeEntry({
        localDate: date,
        projectId,
        taskId: taskId || undefined,
        note: note.trim() || undefined,
        durationMs: parsedDurationMs!,
      });
    }
    onClose();
  }

  function handleStartTimer() {
    localStore.startTimer({
      localDate: date,
      projectId,
      taskId: taskId || undefined,
      note: note.trim() || undefined,
      accumulatedDurationMs: editingEntry ? (parsedDurationMs ?? 0) : undefined,
      entryId: editingEntry?._id,
    });
    onClose();
  }

  function handleStopTimer() {
    if (!editingTimer) {
      return;
    }

    localStore.updateTimer(editingTimer._id, {
      projectId: projectId || undefined,
      taskId: taskId || undefined,
      note: note.trim() || undefined,
    });
    localStore.saveTimer(editingTimer._id);
    onClose();
  }

  function handleDelete() {
    if (!editingEntry) {
      return;
    }

    localStore.deleteTimesheetEntry(editingEntry._id);
    onClose();
  }

  return (
    <div ref={overlayRef} className="time-entry-modal-overlay">
      <div className="time-entry-modal">
        {/* Header */}
        <div className="time-entry-modal-header">
          <span className="time-entry-modal-title">{title}</span>
          <button
            type="button"
            className="time-entry-modal-close"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Form */}
        <div className="time-entry-modal-form">
          {/* Project */}
          <label className="field entry-field-span-2">
            <span className="field-label">Project</span>
            <SearchableSelect
              value={projectId}
              options={projectOptions}
              onChange={handleProjectChange}
              placeholder="Select project"
              clearLabel="Select project"
              emptyMessage="No matching projects"
              ariaLabel="Project"
            />
          </label>

          {/* Task */}
          <label className="field entry-field-span-2">
            <span className="field-label">Task</span>
            <SearchableSelect
              value={taskId}
              options={taskOptions}
              onChange={setTaskId}
              placeholder={projectId ? "Select task" : "Pick a project first"}
              clearLabel={projectId ? "No task" : undefined}
              emptyMessage={
                projectId ? "No matching tasks" : "Pick a project first"
              }
              ariaLabel="Task"
              disabled={!projectId || availableTasks.length === 0}
            />
          </label>

          {/* Note */}
          <label className="field entry-field-note">
            <span className="field-label">Note</span>
            <textarea
              className="field-input entry-note-input"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Notes (optional)"
              rows={2}
            />
          </label>

          {/* Hours */}
          <label className="field entry-field-hours">
            <span className="field-label">Hours</span>
            <input
              className="field-input entry-hours-input"
              type="text"
              placeholder="01:30"
              style={{ fontFamily: "var(--font-mono)" }}
              value={durationHours}
              disabled={isEditingTimer}
              onChange={(event) => setDurationHours(event.target.value)}
              onBlur={(event) =>
                setDurationHours(normalizeHoursInput(event.target.value))
              }
              onKeyDown={(event) => {
                if (isEditingTimer) {
                  return;
                }
                if (event.key === "Enter") {
                  event.preventDefault();
                  event.currentTarget.blur();
                }
              }}
              aria-label="Hours"
            />
          </label>
        </div>

        {/* Actions */}
        <div className="time-entry-modal-actions">
          {isEditingTimer ? (
            <Button size="sm" className="gap-1.5" onClick={handleStopTimer}>
              <Square className="h-3.5 w-3.5" />
              Stop timer
            </Button>
          ) : isTimerMode ? (
            <Button
              size="sm"
              className="gap-1.5"
              onClick={handleStartTimer}
            >
              <Play className="h-3.5 w-3.5" />
              {startTimerLabel}
            </Button>
          ) : (
            <>
              <Button
                size="sm"
                className="gap-1.5"
                disabled={!canSave}
                onClick={handleSave}
              >
                <Save className="h-3.5 w-3.5" />
                Save
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5"
                onClick={handleStartTimer}
              >
                <Play className="h-3.5 w-3.5" />
                {startTimerLabel}
              </Button>
            </>
          )}
          {editingEntry ? (
            <Button
              size="sm"
              variant="danger"
              className="gap-1.5"
              onClick={handleDelete}
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
