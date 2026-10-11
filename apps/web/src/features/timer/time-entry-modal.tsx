import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  TimeEntryEditorForm,
  type NewTimeEntryValues,
  type TimeEntryEditorTarget,
} from "@/features/time/time-entry-editor-form";
import type { TimeEntryEditorFields } from "@/features/time/time-entry-editor";
import { useLocalState } from "@/lib/local-hooks";

interface TimeEntryModalProps {
  /** The Date field's default for a new entry. */
  date: string;
  entryId?: string;
  /** Opens the running entry. Takes precedence over `entryId`. */
  timerId?: string;
  /** Used only for a new entry. Read once when the dialog opens. */
  initialValues?: NewTimeEntryValues;
  /** An unsaved draft carried over from another host, such as the side panel. */
  initialFields?: TimeEntryEditorFields;
  onFieldsChange?: (fields: TimeEntryEditorFields) => void;
  onClose: () => void;
}

/**
 * Dialog host for the entry editor: a saved entry, a new entry, or the running entry.
 * The narrow view uses it everywhere, and New entry… on tasks and backlog items uses
 * it on every width. It closes on its own when the entry it shows goes away.
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
  const state = useLocalState();
  const runningTimer = timerId
    ? state.timers.find((timer) => timer._id === timerId)
    : undefined;
  const entry =
    !timerId && entryId
      ? state.timesheetEntries.find((candidate) => candidate._id === entryId)
      : undefined;
  const isMissing = timerId ? !runningTimer : Boolean(entryId) && !entry;
  // Captured on open so a parent re-render cannot reset the draft.
  const [newEntryValues] = useState(initialValues);

  useEffect(() => {
    if (isMissing) onClose();
  }, [isMissing, onClose]);

  if (isMissing) {
    return null;
  }

  const target: TimeEntryEditorTarget = runningTimer
    ? { kind: "running", timer: runningTimer }
    : entry
      ? { kind: "edit", entry }
      : { kind: "create", localDate: date, initialValues: newEntryValues };

  return (
    <Dialog
      open
      disablePointerDismissal
      onOpenChange={(open) => !open && onClose()}
    >
      {/* The narrow view's full-width host: the dialog spans the window, less a
          small margin, at every width below the desktop breakpoint. */}
      <DialogContent
        className="max-w-xl narrow:max-w-[calc(100%-1rem)]"
        showCloseButton={false}
      >
        <TimeEntryEditorForm
          target={target}
          titleAs={DialogTitle}
          initialFields={initialFields}
          onFieldsChange={onFieldsChange}
          onClose={onClose}
        />
      </DialogContent>
    </Dialog>
  );
}
