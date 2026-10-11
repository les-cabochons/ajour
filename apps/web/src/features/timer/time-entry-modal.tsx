import { useEffect, useMemo, useState } from "react";
import { RiStopLine as Square } from "@remixicon/react";
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
import {
  TimeEntryEditorForm,
  type NewTimeEntryValues,
} from "@/features/time/time-entry-editor-form";
import type { TimeEntryEditorFields } from "@/features/time/time-entry-editor";
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
  /** Used only for a new entry. Read once when the dialog opens. */
  initialValues?: NewTimeEntryValues;
  /** An unsaved draft carried over from another host, such as the side panel. */
  initialFields?: TimeEntryEditorFields;
  onFieldsChange?: (fields: TimeEntryEditorFields) => void;
  onClose: () => void;
}

/**
 * Dialog host for the entry editor, used by the narrow Time view and by New entry…
 * on tasks and backlog items. The running timer keeps its own live form here until
 * running entries move to the shared form.
 */
export function TimeEntryModal({
  date,
  entryId,
  timerId,
  initialValues,
  initialFields,
  onFieldsChange,
  onClose,
}: TimeEntryModalProps) {
  if (timerId) {
    return <RunningTimerModal timerId={timerId} onClose={onClose} />;
  }

  return (
    <TimeEntryEditorDialog
      date={date}
      entryId={entryId}
      initialValues={initialValues}
      initialFields={initialFields}
      onFieldsChange={onFieldsChange}
      onClose={onClose}
    />
  );
}

function TimeEntryEditorDialog({
  date,
  entryId,
  initialValues,
  initialFields,
  onFieldsChange,
  onClose,
}: Omit<TimeEntryModalProps, "timerId">) {
  const state = useLocalState();
  const entry = entryId
    ? state.timesheetEntries.find((candidate) => candidate._id === entryId)
    : undefined;
  // Captured on open so a parent re-render cannot reset the draft.
  const [newEntryValues] = useState(initialValues);

  useEffect(() => {
    if (entryId && !entry) onClose();
  }, [entry, entryId, onClose]);

  if (entryId && !entry) {
    return null;
  }

  return (
    <Dialog
      open
      disablePointerDismissal
      onOpenChange={(open) => !open && onClose()}
    >
      <DialogContent className="max-w-xl" showCloseButton={false}>
        <TimeEntryEditorForm
          target={
            entry
              ? { kind: "edit", entry }
              : {
                  kind: "create",
                  localDate: date,
                  initialValues: newEntryValues,
                }
          }
          titleAs={DialogTitle}
          initialFields={initialFields}
          onFieldsChange={onFieldsChange}
          onClose={onClose}
        />
      </DialogContent>
    </Dialog>
  );
}

function RunningTimerModal({
  timerId,
  onClose,
}: {
  timerId: string;
  onClose: () => void;
}) {
  const state = useLocalState();
  const projects = useLocalProjects();
  const [now, setNow] = useState(() => Date.now());
  const currentTimer = state.timers[0] ?? null;
  const editingTimer = useMemo(
    () => (currentTimer?._id === timerId ? currentTimer : null),
    [currentTimer, timerId],
  );
  const runningDurationMs = editingTimer
    ? editingTimer.accumulatedDurationMs +
      Math.max(0, now - editingTimer.startedAt)
    : 0;
  const [projectId, setProjectId] = useState("");
  const [taskId, setTaskId] = useState("");
  const [note, setNote] = useState("");
  const editor = evaluateTimeEntryEditor(
    {
      projectId,
      taskId,
      note,
      durationHours: formatDurationHoursInput(runningDurationMs),
    },
    {
      // Compared against the timer so an unchanged note is kept exactly.
      original: editingTimer
        ? {
            projectId: editingTimer.projectId,
            taskId: editingTimer.taskId,
            note: editingTimer.note,
            durationMs: runningDurationMs,
          }
        : undefined,
    },
  );
  const entryActions = useTimeEntryActions({
    onEdit: () => undefined,
    onAfterAction: onClose,
  });

  useEffect(() => {
    if (!editingTimer) return;
    setNow(Date.now());
    const intervalId = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(intervalId);
  }, [editingTimer]);

  useEffect(() => {
    const fields = createTimeEntryEditorFields(editingTimer ?? undefined);
    setProjectId(fields.projectId);
    setTaskId(fields.taskId);
    setNote(fields.note);
  }, [editingTimer]);

  useEffect(() => {
    if (!editingTimer) onClose();
  }, [editingTimer, onClose]);

  function handleProjectTaskChange(selection: ProjectTaskSelection) {
    setProjectId(selection.projectId);
    setTaskId(selection.taskId);
  }

  function handleStopTimer() {
    if (!editingTimer) return;
    localStore.updateTimer(editingTimer._id, editor.metadata);
    localStore.saveTimer(editingTimer._id);
    onClose();
  }

  function handleEntryAction(actionId: TimeEntryActionId) {
    if (actionId === "stop") {
      handleStopTimer();
    } else {
      entryActions.runAction({ kind: "running", timerId }, actionId);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-xl gap-5">
        <DialogHeader className="flex-row items-start justify-between gap-3 pr-9">
          <DialogTitle>Running timer</DialogTitle>
          <ObjectActionsButton
            actions={entryActions.getActions(
              { kind: "running", timerId },
              { isEditing: true },
            )}
            onAction={handleEntryAction}
            label="Entry actions"
          />
        </DialogHeader>

        <TimeEntryFields
          idPrefix="running-timer-modal"
          className="sm:grid sm:grid-cols-[minmax(0,1fr)_8rem]"
          projects={projects}
          projectId={projectId}
          taskId={taskId}
          note={note}
          durationHours={formatDurationHoursInput(runningDurationMs)}
          durationDisabled
          onProjectTaskChange={handleProjectTaskChange}
          onNoteChange={setNote}
          onDurationChange={() => undefined}
        />

        <DialogFooter>
          <Button size="sm" onClick={handleStopTimer}>
            <Square data-icon="inline-start" />
            Stop timer
          </Button>
        </DialogFooter>
        {entryActions.dialogs}
      </DialogContent>
    </Dialog>
  );
}
