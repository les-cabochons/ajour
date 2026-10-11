import { useEffect, useMemo, useState } from "react";
import {
  RiDeleteBinLine as Trash2,
  RiPlayLine as Play,
  RiSaveLine as Save,
  RiStopLine as Square,
} from "@remixicon/react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatDurationHoursInput } from "@/domain/time/duration";
import {
  createTimeEntryEditorFields,
  evaluateTimeEntryEditor,
} from "@/features/time/time-entry-editor";
import { ObjectActionsButton } from "@/components/object-actions-menu";
import type { TimeEntryActionId } from "@/domain/actions/object-actions";
import { useTimeEntryActions } from "@/features/time/time-entry-actions";
import type { ProjectTaskSelection } from "@/features/projects/project-task-picker";
import { TimeEntryFields } from "@/features/time/time-entry-fields";
import { useLocalProjects, useLocalState } from "@/lib/local-hooks";
import { localStore } from "@/lib/local-store";

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
  const [now, setNow] = useState(() => Date.now());
  const currentTimer = state.timers[0] ?? null;
  const editingTimer = useMemo(
    () => (timerId && currentTimer?._id === timerId ? currentTimer : null),
    [currentTimer, timerId],
  );
  const editingEntry = useMemo(
    () =>
      entryId
        ? (state.timesheetEntries.find((entry) => entry._id === entryId) ??
          null)
        : null,
    [entryId, state.timesheetEntries],
  );
  const entryDate = editingEntry?.localDate ?? editingTimer?.localDate ?? date;
  const runningDurationMs = editingTimer
    ? editingTimer.accumulatedDurationMs +
      Math.max(0, now - editingTimer.startedAt)
    : 0;
  const [projectId, setProjectId] = useState("");
  const [taskId, setTaskId] = useState("");
  const [note, setNote] = useState("");
  const [durationHours, setDurationHours] = useState("");
  const editor = evaluateTimeEntryEditor(
    { projectId, taskId, note, durationHours },
    { original: editingEntry ?? undefined, allowEmptyDuration: true },
  );
  const { canSave, isTimerMode } = editor;
  const entryActions = useTimeEntryActions({
    onEdit: () => undefined,
    onAfterAction: onClose,
  });
  const title = editingTimer
    ? "Running timer"
    : editingEntry
      ? "Edit time entry"
      : "New time entry";

  useEffect(() => {
    if (!editingTimer) return;
    setNow(Date.now());
    const intervalId = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(intervalId);
  }, [editingTimer]);

  useEffect(() => {
    const fields = createTimeEntryEditorFields(
      editingTimer ?? editingEntry ?? undefined,
    );
    setProjectId(fields.projectId);
    setTaskId(fields.taskId);
    setNote(fields.note);
    if (!editingTimer) setDurationHours(fields.durationHours);
  }, [editingEntry, editingTimer]);

  useEffect(() => {
    if (editingTimer)
      setDurationHours(formatDurationHoursInput(runningDurationMs));
  }, [editingTimer, runningDurationMs]);

  useEffect(() => {
    if (timerId && !editingTimer) onClose();
  }, [editingTimer, onClose, timerId]);

  function handleProjectTaskChange(selection: ProjectTaskSelection) {
    setProjectId(selection.projectId);
    setTaskId(selection.taskId);
  }

  function handleSave() {
    if (editingTimer || !editor.canSave || !editor.values) return;
    if (editingEntry) {
      localStore.updateTimesheetEntry(editingEntry._id, editor.values);
    } else {
      localStore.saveManualTimeEntry({ ...editor.values, localDate: date });
    }
    onClose();
  }

  /** Starts a timer from a new entry's draft. Saved entries use Continue instead. */
  function handleStartTimer() {
    if (editor.durationMs === null) return;
    localStore.startTimer({ localDate: entryDate, ...editor.metadata });
    onClose();
  }

  function handleStopTimer() {
    if (!editingTimer) return;
    localStore.updateTimer(editingTimer._id, editor.metadata);
    localStore.saveTimer(editingTimer._id);
    onClose();
  }

  /** Saves draft changes, then continues the entry's work (see Continue in GLOSSARY.md). */
  function handleContinue() {
    if (!editingEntry || !editor.canSave || !editor.values) return;
    localStore.updateTimesheetEntry(editingEntry._id, editor.values);
    localStore.continueTimesheetEntry(editingEntry._id);
    onClose();
  }

  const actionTarget = editingTimer
    ? { kind: "running" as const, timerId: editingTimer._id }
    : editingEntry
      ? { kind: "entry" as const, entry: editingEntry }
      : null;

  function handleEntryAction(actionId: TimeEntryActionId) {
    if (!actionTarget) return;
    if (actionId === "stop") {
      handleStopTimer();
    } else if (actionId === "continue") {
      handleContinue();
    } else {
      entryActions.runAction(actionTarget, actionId, {
        resolveValues: editor.relocationValues,
      });
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-xl gap-5">
        <DialogHeader className="flex-row items-start justify-between gap-3 pr-9">
          <DialogTitle>{title}</DialogTitle>
          {actionTarget ? (
            <ObjectActionsButton
              actions={entryActions.getActions(actionTarget, {
                isEditing: true,
                invalidDraftReason: canSave
                  ? undefined
                  : "Enter a valid duration first",
              })}
              onAction={handleEntryAction}
              label="Entry actions"
            />
          ) : null}
        </DialogHeader>

        <TimeEntryFields
          idPrefix="time-entry-modal"
          className="sm:grid sm:grid-cols-[minmax(0,1fr)_8rem]"
          projects={projects}
          projectId={projectId}
          taskId={taskId}
          note={note}
          durationHours={durationHours}
          durationDisabled={Boolean(editingTimer)}
          durationError={editor.durationError}
          onProjectTaskChange={handleProjectTaskChange}
          onNoteChange={setNote}
          onDurationChange={setDurationHours}
        />

        <DialogFooter className="sm:justify-between">
          <div className="flex flex-wrap gap-2">
            {editingEntry && !editingTimer ? (
              <Button
                type="button"
                size="sm"
                variant="danger"
                onClick={() =>
                  entryActions.runAction(
                    { kind: "entry", entry: editingEntry },
                    "delete",
                  )
                }
              >
                <Trash2 data-icon="inline-start" />
                Delete
              </Button>
            ) : null}
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            {editingTimer ? (
              <Button size="sm" onClick={handleStopTimer}>
                <Square data-icon="inline-start" />
                Stop timer
              </Button>
            ) : isTimerMode ? (
              <Button size="sm" onClick={handleStartTimer}>
                <Play data-icon="inline-start" />
                {currentTimer ? "Switch timer" : "Start timer"}
              </Button>
            ) : (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={
                    editingEntry ? !canSave : editor.durationMs === null
                  }
                  onClick={editingEntry ? handleContinue : handleStartTimer}
                >
                  <Play data-icon="inline-start" />
                  {editingEntry
                    ? "Continue"
                    : currentTimer
                      ? "Switch timer"
                      : "Start timer"}
                </Button>
                <Button size="sm" disabled={!canSave} onClick={handleSave}>
                  <Save data-icon="inline-start" />
                  Save
                </Button>
              </>
            )}
          </div>
        </DialogFooter>
        {entryActions.dialogs}
      </DialogContent>
    </Dialog>
  );
}
