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
import { EntryActionsMenu } from "@/features/time/entry-actions-menu";
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

  function handleStartTimer() {
    if (editor.durationMs === null) return;
    localStore.startTimer({
      localDate: entryDate,
      ...editor.metadata,
      accumulatedDurationMs: editingEntry ? editor.durationMs : undefined,
      entryId: editingEntry?._id,
    });
    onClose();
  }

  function handleStopTimer() {
    if (!editingTimer) return;
    localStore.updateTimer(editingTimer._id, editor.metadata);
    localStore.saveTimer(editingTimer._id);
    onClose();
  }

  function duplicateTo(localDate: string) {
    const values = editor.relocationValues(localDate);
    if (!editingEntry || !values) return;
    localStore.duplicateTimesheetEntry(editingEntry._id, values);
    onClose();
  }

  function moveTo(localDate: string) {
    const values = editor.relocationValues(localDate);
    if (!editingEntry || !values) return;
    localStore.moveTimesheetEntry(editingEntry._id, values);
    onClose();
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-xl gap-5">
        <DialogHeader className="flex-row items-start justify-between gap-3 pr-9">
          <DialogTitle>{title}</DialogTitle>
          {editingEntry && !editingTimer ? (
            <EntryActionsMenu
              currentDate={editingEntry.localDate}
              disabled={!canSave}
              onDuplicate={() => duplicateTo(editingEntry.localDate)}
              onDuplicateTo={duplicateTo}
              onMoveTo={moveTo}
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
                onClick={() => {
                  localStore.deleteTimesheetEntry(editingEntry._id);
                  onClose();
                }}
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
                  disabled={editor.durationMs === null}
                  onClick={handleStartTimer}
                >
                  <Play data-icon="inline-start" />
                  {currentTimer ? "Switch timer" : "Start timer"}
                </Button>
                <Button size="sm" disabled={!canSave} onClick={handleSave}>
                  <Save data-icon="inline-start" />
                  Save
                </Button>
              </>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
