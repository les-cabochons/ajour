import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { placeFloatingComposer } from "@/lib/floating-composer";
import {
  TimeEntryEditorForm,
  type NewTimeEntryValues,
  type TimeEntryEditorFormHandle,
  type TimeEntryEditorTarget,
} from "@/features/time/time-entry-editor-form";
import type { TimeEntryEditorFields } from "@/features/time/time-entry-editor";
import { useLocalState } from "@/lib/local-hooks";

interface TimeEntryModalProps {
  /**
   * A floating composer: no backdrop, and the page stays live behind it, so
   * another entry or row can be opened from it (forms council round 8).
   */
  floating?: boolean;
  /** The page's handle on the form, so it can save the draft first. */
  formRef?: RefObject<TimeEntryEditorFormHandle | null>;
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
 * The narrow view uses it everywhere, including New entry… on tasks and backlog
 * items. It closes on its own when the entry it shows goes away. A click
 * outside the running entry's dialog saves a valid draft and closes it; the
 * entry keeps running. On the other dialogs a click outside does nothing.
 */
export function TimeEntryModal({
  floating = false,
  formRef: pageFormRef,
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
  const ownFormRef = useRef<TimeEntryEditorFormHandle>(null);
  // Where focus was when the composer opened, such as the entry's row: it
  // goes back there on close, as it did from the side panel.
  const [returnFocusTo] = useState(() =>
    typeof document === "undefined"
      ? null
      : (document.activeElement as HTMLElement | null),
  );
  const formRef = pageFormRef ?? ownFormRef;
  // Captured on open so a parent re-render cannot reset the draft.
  const [newEntryValues] = useState(initialValues);

  useEffect(() => {
    if (isMissing) onClose();
  }, [isMissing, onClose]);

  // Placed once, as the card mounts, before it paints: below the Time
  // page's day strip, or the Week's day headers, and off the edited entry's
  // row. A new entry has no row.
  const editsAnEntry = Boolean(entry || runningTimer);
  const placeComposer = useCallback(
    (popup: HTMLDivElement | null) => {
      if (!floating) return;
      placeFloatingComposer(popup, editsAnEntry ? returnFocusTo : null, {
        restBelow: document.querySelector(
          "main :is(.day-strip, .weekly-grid-table thead, .weekly-days-column-header)",
        ),
      });
    },
    [floating, editsAnEntry, returnFocusTo],
  );

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
      modal={!floating}
      onOpenChange={(open, details) => {
        if (open) return;
        // A floating composer leaves the page live: a click or focus
        // elsewhere is the page's to handle, which saves the draft first.
        // Only Escape closes it here; Cancel and × close it themselves.
        if (floating && details.reason !== "escape-key") return;
        if (details.reason === "outside-press") {
          // Other entries wait for Save or Cancel. The running entry keeps
          // running without its editor, so a click outside saves the draft,
          // or keeps the dialog open with the error when it is invalid.
          if (!runningTimer || !formRef.current?.commitBeforeSwitch()) return;
        }
        onClose();
      }}
    >
      {/* The narrow view's full-width host: the dialog spans the window, less a
          small margin, at every width below the desktop breakpoint. */}
      <DialogContent
        className={cn(
          "max-w-xl narrow:w-[calc(100%-1rem)] narrow:max-w-[calc(100%-1rem)]",
          floating && "composer-floating",
        )}
        overlay={!floating}
        showCloseButton={false}
        ref={placeComposer}
        finalFocus={
          floating
            ? () =>
                returnFocusTo?.isConnected && returnFocusTo !== document.body
                  ? returnFocusTo
                  : null
            : undefined
        }
      >
        <TimeEntryEditorForm
          ref={formRef}
          target={target}
          titleAs={DialogTitle}
          initialFields={initialFields}
          onFieldsChange={onFieldsChange}
          onClose={onClose}
          host="dialog"
        />
      </DialogContent>
    </Dialog>
  );
}
