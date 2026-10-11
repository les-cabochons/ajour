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
  RiStopLine as Stop,
} from "@remixicon/react";
import { ObjectActionsButton } from "@/components/object-actions-menu";
import { Button } from "@/components/ui/button";
import type { TimeEntryActionId } from "@/domain/actions/object-actions";
import type { LocalTimer, LocalTimesheetEntry } from "@/domain/local-state";
import { syncBacklogWorkItemToSource } from "@/features/backlog/work-item-source-sync";
import {
  commitTimeEntryDraft,
  createTimeEntryEditorFields,
  evaluateTimeEntryEditor,
  START_OR_ENTER_HOURS_HINT,
  type TimeEntryDraftCommitReason,
  type TimeEntryEditorFields,
  type TimeEntryValues,
} from "@/features/time/time-entry-editor";
import {
  useTimeEntryActions,
  type TimeEntryActionTarget,
} from "@/features/time/time-entry-actions";
import { TimeEntryFields } from "@/features/time/time-entry-fields";
import { useLocalProjects, useLocalState } from "@/lib/local-hooks";
import { localStore } from "@/lib/local-store";
import { getTimerDurationsMs } from "@/lib/timer-totals";
import { cn, todayIsoDate } from "@/lib/utils";

/** Prefills a new entry, for example from a task's or backlog item's New entry… action. */
export interface NewTimeEntryValues {
  projectId?: string;
  taskId?: string;
  note?: string;
  /** Links the new entry or running entry to a backlog item, whose estimates then follow it. */
  workItemId?: string;
}

/**
 * What the form edits: a saved entry, a new entry on a date (the Date field's default),
 * or the running entry.
 */
export type TimeEntryEditorTarget =
  | { kind: "edit"; entry: LocalTimesheetEntry }
  | { kind: "create"; localDate: string; initialValues?: NewTimeEntryValues }
  | { kind: "running"; timer: LocalTimer };

/** Lets a host save the draft before it loads another entry into the same form. */
export interface TimeEntryEditorFormHandle {
  /** Saves a valid draft. Returns false, and shows the error, when the draft blocks the switch. */
  commitBeforeSwitch: () => boolean;
}

function formatEntryDate(localDate: string) {
  const date = new Date(`${localDate}T12:00:00`);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return new Intl.DateTimeFormat("en-CA", {
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(date);
}

/**
 * Seeds the draft once, on mount. The running entry's Hours shows the time counted
 * when the form opened and does not tick; `runningOriginal` keeps that value so an
 * untouched Hours leaves the count alone.
 */
function seedEditor(target: TimeEntryEditorTarget): {
  fields: TimeEntryEditorFields;
  runningOriginal?: TimeEntryValues;
} {
  switch (target.kind) {
    case "create":
      return {
        fields: createTimeEntryEditorFields(
          target.localDate,
          target.initialValues,
        ),
      };
    case "edit":
      return {
        fields: createTimeEntryEditorFields(
          target.entry.localDate,
          target.entry,
        ),
      };
    case "running": {
      const { timer } = target;
      const runningOriginal: TimeEntryValues = {
        projectId: timer.projectId,
        taskId: timer.taskId,
        note: timer.note,
        localDate: timer.localDate,
        durationMs: getTimerDurationsMs(timer, Date.now()).runningDurationMs,
      };
      return {
        fields: createTimeEntryEditorFields(timer.localDate, runningOriginal),
        runningOriginal,
      };
    }
  }
}

/**
 * The one form for creating and editing a time entry, the running entry included.
 * Hosts (the side panel, the dialog, the titlebar popovers) only supply the container,
 * so keys, buttons and save rules stay the same everywhere.
 *
 * Footer: Cancel · Start (Switch while another entry runs, Continue on a saved entry,
 * Stop on the running entry) · Save. Save: the Save button, Enter in Hours or Note, or
 * Cmd/Ctrl+Enter. A new entry with no hours cannot be saved; those keys press Start.
 * Escape, Cancel or × discard the draft. Save on the running entry keeps it running.
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
  const today = todayIsoDate();
  const entry = target.kind === "edit" ? target.entry : undefined;
  const runningTimer = target.kind === "running" ? target.timer : undefined;
  const workItemId =
    target.kind === "create" ? target.initialValues?.workItemId : undefined;
  const [seed] = useState(() => seedEditor(target));
  const runningOriginal = seed.runningOriginal;
  const original: TimeEntryValues | undefined = entry ?? runningOriginal;
  const [fields, setFields] = useState(() => initialFields ?? seed.fields);
  const onFieldsChangeRef = useRef(onFieldsChange);
  onFieldsChangeRef.current = onFieldsChange;
  useEffect(() => {
    onFieldsChangeRef.current?.(fields);
  }, [fields]);
  // A blocked save or switch shows its reason until the user changes a field.
  const [commitError, setCommitError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const editor = evaluateTimeEntryEditor(fields, {
    original,
    allowEmptyDuration: target.kind === "create",
    isRunning: Boolean(runningTimer),
    // A switch drops a new entry the user left as it opened, prefilled task included.
    prefill: target.kind === "create" ? seed.fields : undefined,
  });
  const entryActions = useTimeEntryActions({
    onEdit: () => undefined,
    onAfterAction: onClose,
  });
  const actionTarget: TimeEntryActionTarget | null = entry
    ? { kind: "entry", entry }
    : runningTimer
      ? { kind: "running", timerId: runningTimer._id }
      : null;
  const isAnotherEntryRunning = state.timers.some(
    (timer) => timer._id !== runningTimer?._id,
  );
  // Start and Continue always count on today, whatever day the form shows.
  const startsToday = !runningTimer && fields.localDate !== today;

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
    if (runningTimer) {
      localStore.editRunningEntry(runningTimer._id, {
        ...editor.metadata,
        // Only a changed Hours resets the count; otherwise it keeps counting as is.
        countedDurationMs:
          values.durationMs === runningOriginal?.durationMs
            ? undefined
            : values.durationMs,
      });
      return;
    }

    if (entry) {
      if (values.localDate === entry.localDate) {
        localStore.updateTimesheetEntry(entry._id, values);
      } else {
        localStore.moveTimesheetEntry(entry._id, values);
      }
      return;
    }

    localStore.saveManualTimeEntry({ ...values, workItemId });
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

  /**
   * Starts a running entry today from a new entry's draft, counting on from typed
   * Hours. Another running entry is saved first (Switch). Saved entries use Continue.
   */
  function start() {
    if (editor.durationMs === null) return;
    localStore.startTimer({
      ...editor.metadata,
      workItemId,
      accumulatedDurationMs: editor.durationMs,
    });
    onClose();
  }

  /** Saves draft changes, then continues the entry's work (see Continue in GLOSSARY.md). */
  function continueEntry() {
    if (!entry || !commit("save")) return;
    localStore.continueTimesheetEntry(entry._id);
    onClose();
  }

  /** Saves draft changes to the running entry, then stops it. */
  function stop() {
    if (!runningTimer || !commit("save")) return;
    localStore.saveTimer(runningTimer._id);
    onClose();
  }

  /** Save, unless a new entry has no hours: then Start, since 0h is never saved. */
  function submit() {
    if (editor.isTimerMode) {
      start();
    } else {
      save();
    }
  }

  function handleAction(actionId: TimeEntryActionId) {
    if (!actionTarget) return;
    if (actionId === "continue") {
      continueEntry();
      return;
    }
    if (actionId === "stop") {
      stop();
      return;
    }
    entryActions.runAction(actionTarget, actionId, {
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
      submit();
    }
  }

  function submitOnEnter(event: KeyboardEvent<HTMLElement>) {
    if (
      event.key !== "Enter" ||
      event.shiftKey ||
      event.nativeEvent.isComposing
    ) {
      return;
    }
    event.preventDefault();
    submit();
  }

  return (
    <div
      ref={rootRef}
      // Pinned task digits stay quiet while focus is in the form. See
      // ENTRY_EDITOR_ATTRIBUTE in lib/shortcuts.ts.
      data-entry-editor=""
      className={cn("flex flex-col gap-4", className)}
      onKeyDown={handleKeyDown}
    >
      <header className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <Title className="text-sm font-semibold">
            {target.kind === "create" ? "New time entry" : "Edit time entry"}
          </Title>
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            {runningTimer ? (
              <>
                <span className="status-dot status-dot-pulse" />
                Running · {formatEntryDate(runningTimer.localDate)}
              </>
            ) : (
              formatEntryDate(fields.localDate)
            )}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {actionTarget ? (
            <ObjectActionsButton
              actions={entryActions.getActions(actionTarget, {
                isEditing: true,
                invalidDraftReason: editor.canSave
                  ? undefined
                  : "Enter a valid duration first",
              })}
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
        idPrefix={`time-entry-editor-${entry?._id ?? runningTimer?._id ?? "new"}`}
        projects={projects}
        projectId={fields.projectId}
        taskId={fields.taskId}
        note={fields.note}
        durationHours={fields.durationHours}
        durationError={editor.durationError ?? commitError}
        durationHint={editor.isTimerMode ? START_OR_ENTER_HOURS_HINT : null}
        localDate={runningTimer ? undefined : fields.localDate}
        dateError={editor.dateError}
        onProjectTaskChange={(selection) =>
          updateFields({
            projectId: selection.projectId,
            taskId: selection.taskId,
          })
        }
        onNoteChange={(note) => updateFields({ note })}
        onNoteKeyDown={submitOnEnter}
        onDurationChange={(durationHours) => updateFields({ durationHours })}
        onDurationKeyDown={submitOnEnter}
        onDateChange={(localDate) => updateFields({ localDate })}
      />

      <footer className="flex flex-wrap items-center justify-end gap-2">
        {startsToday ? (
          <span className="mr-auto text-xs text-muted-foreground">
            Starts today
          </span>
        ) : null}
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          Cancel
        </Button>
        {runningTimer ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={editor.hasChanges && !editor.canSave}
            onClick={stop}
          >
            <Stop data-icon="inline-start" />
            Stop
          </Button>
        ) : entry ? (
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
            {isAnotherEntryRunning ? "Switch" : "Start"}
          </Button>
        )}
        <Button
          type="button"
          size="sm"
          disabled={!editor.canSave}
          title={editor.isTimerMode ? START_OR_ENTER_HOURS_HINT : undefined}
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
