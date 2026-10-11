import {
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ElementType,
  type KeyboardEvent,
  type Ref,
} from "react";
import {
  RiCloseLine as X,
  RiPlayLine as Play,
  RiSaveLine as Save,
} from "@remixicon/react";
import { ObjectActionsButton } from "@/components/object-actions-menu";
import { Button } from "@/components/ui/button";
import type { TimeEntryActionId } from "@/domain/actions/object-actions";
import type { LocalTimesheetEntry } from "@/domain/local-state";
import { syncBacklogWorkItemToSource } from "@/features/backlog/work-item-source-sync";
import {
  commitTimeEntryDraft,
  createTimeEntryEditorFields,
  evaluateTimeEntryEditor,
  type TimeEntryDraftCommitReason,
  type TimeEntryEditorFields,
  type TimeEntryValues,
} from "@/features/time/time-entry-editor";
import { useTimeEntryActions } from "@/features/time/time-entry-actions";
import { TimeEntryFields } from "@/features/time/time-entry-fields";
import { useLocalProjects, useLocalState } from "@/lib/local-hooks";
import { localStore } from "@/lib/local-store";
import { cn } from "@/lib/utils";

/** Prefills a new entry, for example from a task's or backlog item's New entry… action. */
export interface NewTimeEntryValues {
  projectId?: string;
  taskId?: string;
  note?: string;
  /** Links the new entry or timer to a backlog item, whose estimates then follow it. */
  workItemId?: string;
}

/** What the form edits: a saved entry, or a new entry on a date. */
export type TimeEntryEditorTarget =
  | { kind: "edit"; entry: LocalTimesheetEntry }
  | { kind: "create"; localDate: string; initialValues?: NewTimeEntryValues };

/** Lets a host save the draft before it loads another entry into the same form. */
export interface TimeEntryEditorFormHandle {
  /** Saves a valid draft. Returns false, and shows the error, when the draft blocks the switch. */
  commitBeforeSwitch: () => boolean;
}

function formatEntryDate(localDate: string) {
  return new Intl.DateTimeFormat("en-CA", {
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(new Date(`${localDate}T12:00:00`));
}

/**
 * The one form for creating and editing a time entry. Hosts (the side panel, the
 * dialog) only supply the container, so keys, buttons and save rules stay the same
 * everywhere. Save: the Save button, Enter in Hours or Note, or Cmd/Ctrl+Enter.
 * Escape, Cancel or × discard the draft.
 *
 * Keep the host remount keyed by target: the draft is seeded once, on mount.
 * A host that can swap containers mid-edit (side panel and dialog across a
 * breakpoint) passes the draft back in through `initialFields`.
 */
export function TimeEntryEditorForm({
  target,
  onClose,
  ref,
  titleAs: Title = "h2",
  className,
  initialFields,
  onFieldsChange,
}: {
  target: TimeEntryEditorTarget;
  onClose: () => void;
  /** An unsaved draft to resume instead of the target's saved values. */
  initialFields?: TimeEntryEditorFields;
  /** Reports every draft change, so a host can carry it to another container. */
  onFieldsChange?: (fields: TimeEntryEditorFields) => void;
  ref?: Ref<TimeEntryEditorFormHandle>;
  /** A dialog host passes its title component so the heading labels the dialog. */
  titleAs?: ElementType;
  className?: string;
}) {
  const state = useLocalState();
  const projects = useLocalProjects();
  const entry = target.kind === "edit" ? target.entry : undefined;
  const localDate =
    target.kind === "edit" ? target.entry.localDate : target.localDate;
  const workItemId =
    target.kind === "create" ? target.initialValues?.workItemId : undefined;
  const [fields, setFields] = useState(
    () =>
      initialFields ??
      createTimeEntryEditorFields(
        target.kind === "edit" ? target.entry : target.initialValues,
      ),
  );
  const onFieldsChangeRef = useRef(onFieldsChange);
  onFieldsChangeRef.current = onFieldsChange;
  useEffect(() => {
    onFieldsChangeRef.current?.(fields);
  }, [fields]);
  // A blocked save or switch shows its reason until the user changes a field.
  const [commitError, setCommitError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const editor = evaluateTimeEntryEditor(fields, {
    original: entry,
    allowEmptyDuration: !entry,
  });
  const entryActions = useTimeEntryActions({
    onEdit: () => undefined,
    onAfterAction: onClose,
  });
  const isTimerRunning = state.timers.length > 0;

  useImperativeHandle(ref, () => ({
    commitBeforeSwitch: () => commit("switch"),
  }));

  useEffect(() => {
    rootRef.current
      ?.querySelector<HTMLElement>(
        "[data-slot='field'] :is(button, input, textarea)",
      )
      ?.focus();
  }, []);

  function updateFields(patch: Partial<TimeEntryEditorFields>) {
    setFields((current) => ({ ...current, ...patch }));
    setCommitError(null);
  }

  /** Writes the draft when it has something to save. Returns false when it is blocked. */
  function commit(reason: TimeEntryDraftCommitReason) {
    const result = commitTimeEntryDraft(editor, reason);
    if (result.kind === "invalid") {
      setCommitError(result.error);
      return false;
    }

    if (result.kind === "save") {
      writeEntry(result.values);
    }
    return true;
  }

  function writeEntry(values: TimeEntryValues) {
    if (entry) {
      localStore.updateTimesheetEntry(entry._id, values);
      return;
    }

    localStore.saveManualTimeEntry({ ...values, localDate, workItemId });
    // Logged time changes the backlog item's estimates, so push them to its source.
    const workItem = workItemId
      ? state.workItems.find((item) => item._id === workItemId)
      : undefined;
    if (workItem) {
      syncBacklogWorkItemToSource(workItem);
    }
  }

  function save() {
    if (commit("save")) {
      onClose();
    }
  }

  /** Starts a timer from a new entry's draft. Saved entries use Continue instead. */
  function start() {
    if (editor.durationMs === null) return;
    localStore.startTimer({ localDate, ...editor.metadata, workItemId });
    onClose();
  }

  /** Saves draft changes, then continues the entry's work (see Continue in GLOSSARY.md). */
  function continueEntry() {
    if (!entry || !commit("save")) return;
    localStore.continueTimesheetEntry(entry._id);
    onClose();
  }

  function handleAction(actionId: TimeEntryActionId) {
    if (!entry) return;
    if (actionId === "continue") {
      continueEntry();
      return;
    }
    entryActions.runAction({ kind: "entry", entry }, actionId, {
      resolveValues: editor.relocationValues,
    });
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    // Pickers, menus and confirmations render in portals; their keys stay theirs.
    // Fields that already saved on Enter mark the event as handled.
    if (
      event.defaultPrevented ||
      !(event.target instanceof Node) ||
      !rootRef.current?.contains(event.target)
    ) {
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    } else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      save();
    }
  }

  function saveOnEnter(event: KeyboardEvent<HTMLElement>) {
    if (
      event.key !== "Enter" ||
      event.shiftKey ||
      event.nativeEvent.isComposing
    ) {
      return;
    }
    event.preventDefault();
    save();
  }

  return (
    <div
      ref={rootRef}
      className={cn("flex flex-col gap-4", className)}
      onKeyDown={handleKeyDown}
    >
      <header className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <Title className="text-sm font-semibold">
            {entry ? "Edit time entry" : "New time entry"}
          </Title>
          <span className="text-xs text-muted-foreground">
            {formatEntryDate(localDate)}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {entry ? (
            <ObjectActionsButton
              actions={entryActions.getActions(
                { kind: "entry", entry },
                {
                  isEditing: true,
                  invalidDraftReason: editor.canSave
                    ? undefined
                    : "Enter a valid duration first",
                },
              )}
              onAction={handleAction}
              label="Entry actions"
            />
          ) : null}
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Close"
            onClick={onClose}
          >
            <X />
          </Button>
        </div>
      </header>

      <TimeEntryFields
        idPrefix={`time-entry-editor-${entry?._id ?? "new"}`}
        projects={projects}
        projectId={fields.projectId}
        taskId={fields.taskId}
        note={fields.note}
        durationHours={fields.durationHours}
        durationError={editor.durationError ?? commitError}
        onProjectTaskChange={(selection) =>
          updateFields({
            projectId: selection.projectId,
            taskId: selection.taskId,
          })
        }
        onNoteChange={(note) => updateFields({ note })}
        onNoteKeyDown={saveOnEnter}
        onDurationChange={(durationHours) => updateFields({ durationHours })}
        onDurationKeyDown={saveOnEnter}
      />

      <footer className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          Cancel
        </Button>
        {entry ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={editor.hasChanges && !editor.canSave}
            onClick={continueEntry}
          >
            <Play data-icon="inline-start" />
            Continue
          </Button>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={editor.durationMs === null}
            onClick={start}
          >
            <Play data-icon="inline-start" />
            {isTimerRunning ? "Switch" : "Start"}
          </Button>
        )}
        <Button
          type="button"
          size="sm"
          disabled={!editor.canSave}
          onClick={save}
        >
          <Save data-icon="inline-start" />
          Save
        </Button>
      </footer>
      {entryActions.dialogs}
    </div>
  );
}
