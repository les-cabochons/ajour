import {
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ElementType,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
} from "react";
import {
  RiCloseLine as X,
  RiPlayFill as Play,
  RiStopLine as Stop,
} from "@remixicon/react";
import { ObjectActionsButton } from "@/components/object-actions-menu";
import { TooltipButton } from "@/components/tooltip-button";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import type { TimeEntryActionId } from "@/domain/actions/object-actions";
import {
  getLocalProjectDisplayName,
  type LocalTimer,
  type LocalTimesheetEntry,
} from "@/domain/local-state";
import { getDateLockReason } from "@/domain/time/locked-weeks";
import { isTimesheetEntryCommitted } from "@/domain/time/timesheet-commit";
import { syncBacklogWorkItemToSource } from "@/features/backlog/work-item-source-sync";
import {
  commitTimeEntryDraft,
  createTimeEntryEditorFields,
  evaluateTimeEntryEditor,
  getTimeEntryPrimaryAction,
  START_OR_ENTER_HOURS_HINT,
  type TimeEntryDraftCommitReason,
  type TimeEntryEditorFields,
  type TimeEntryValues,
} from "@/features/time/time-entry-editor";
import {
  useTimeEntryActions,
  type TimeEntryActionTarget,
} from "@/features/time/time-entry-actions";
import { WeekLockChip } from "@/features/time/week-lock";
import { TimeEntryFields } from "@/features/time/time-entry-fields";
import { useOpenEntryEditor } from "@/lib/entry-editor-presence";
import { useLocalProjects, useLocalState } from "@/lib/local-hooks";
import { localStore, runStoreCommandWith } from "@/lib/local-store";
import { getTimerDurationsMs } from "@/lib/timer-totals";
import { cn, todayIsoDate } from "@/lib/utils";
import { withEventAttribution } from "@/lib/wide-events";

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
 * A composer: the hours as the title, the note, then the project and date chips. The
 * side panel opens it on a row with the title, the status, "…" and ×, as the backlog
 * peek; the popover and the dialog put "…" and × in the corner and the status above
 * the hours. Footer: Stop on the running entry, then Cancel and one main button
 * (`getTimeEntryPrimaryAction`): Start or Create entry on a new entry, Continue or
 * Save on a saved one, "Start today" when Start or Continue would count on another
 * day than the form's. Start also stops another running entry. Enter in Hours or
 * Note, and Cmd/Ctrl+Enter, press the main button. Escape, Cancel or × discard the
 * draft. Save on the running entry keeps it running. An entry of a submitted week
 * opens read-only, with the lock under Date.
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
  renderBelow,
  host,
}: {
  target: TimeEntryEditorTarget;
  onClose: () => void;
  /** Where the form sits, for the wide event of the entry it saves. */
  host: "side_panel" | "dialog" | "popover";
  /** An unsaved draft to resume instead of the target's saved values. */
  initialFields?: TimeEntryEditorFields;
  /** Reports every draft change, so a host can carry it to another container. */
  onFieldsChange?: (fields: TimeEntryEditorFields) => void;
  /**
   * Host content under the footer that follows the draft's date and hours, such
   * as the Week's day list. It renders with the form, so typing re-renders only
   * the form, not the page.
   */
  renderBelow?: (draft: {
    localDate: string;
    durationMs: number | null;
  }) => ReactNode;
  ref?: Ref<TimeEntryEditorFormHandle>;
  /** A dialog host passes its title component so the heading labels the dialog. */
  titleAs?: ElementType;
  className?: string;
}) {
  const state = useLocalState();
  const editorSurface = host === "side_panel" ? "editor" : host;
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
  // Pinned task digits do nothing while any entry editor is on screen.
  useOpenEntryEditor();
  // A submitted week's entry opens read-only, and a draft on one of its days
  // cannot be saved. The running entry is never on a submitted day.
  const lockReasonFor = (localDate: string) =>
    getDateLockReason(state, localDate);
  const lockReason = entry ? lockReasonFor(entry.localDate) : undefined;
  const editor = evaluateTimeEntryEditor(fields, {
    original,
    lockReasonFor: runningTimer ? undefined : lockReasonFor,
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
  // One main button follows the draft: Start, Create entry, Continue, Start
  // today or Save. Enter and Cmd/Ctrl+Enter press it.
  const primary = getTimeEntryPrimaryAction(editor, {
    isRunning: Boolean(runningTimer),
    localDate: fields.localDate,
    today,
  });

  useImperativeHandle(ref, () => ({
    commitBeforeSwitch: () => commit("switch"),
  }));

  useEffect(() => {
    const first = rootRef.current?.querySelector<HTMLElement>(
      ".time-entry-fields :is(button, input, textarea)",
    );
    first?.focus();
    // The hours open selected, so typing replaces them: correcting an
    // entry's time is the editor's first job, and a caret after "0:15"
    // turned "0:30" into "0:150:30" (usability council U2).
    if (first instanceof HTMLInputElement) first.select();
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

  /** Records, on the save's event, where the form sits. */
  const recordHost = (unit: {
    set(fields: { time_entry: { host: typeof host } }): unknown;
  }) => unit.set({ time_entry: { host } });

  function writeEntry(values: TimeEntryValues) {
    return withEventAttribution({ surface: editorSurface }, () => {
      if (runningTimer) {
        runStoreCommandWith(
          "editRunningEntry",
          [
            runningTimer._id,
            {
              ...editor.metadata,
              // Only a changed Hours resets the count; otherwise it keeps counting as is.
              countedDurationMs:
                values.durationMs === runningOriginal?.durationMs
                  ? undefined
                  : values.durationMs,
            },
          ],
          recordHost,
        );
        return;
      }

      if (entry) {
        if (values.localDate === entry.localDate) {
          runStoreCommandWith(
            "updateTimesheetEntry",
            [entry._id, values],
            recordHost,
          );
        } else {
          localStore.moveTimesheetEntry(entry._id, values);
        }
        return;
      }

      runStoreCommandWith(
        "saveManualTimeEntry",
        [{ ...values, workItemId }],
        recordHost,
      );
      // Logged time changes the backlog item's estimates, so push them to its source.
      const workItem = workItemId
        ? state.workItems.find((item) => item._id === workItemId)
        : undefined;
      if (workItem) {
        syncBacklogWorkItemToSource(workItem);
      }
    });
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
    const durationMs = editor.durationMs;
    if (durationMs === null) return;
    withEventAttribution({ surface: editorSurface }, () =>
      localStore.startTimer({
        ...editor.metadata,
        workItemId,
        accumulatedDurationMs: durationMs,
      }),
    );
    onClose();
  }

  /** Saves draft changes, then continues the entry's work (see Continue in GLOSSARY.md). */
  function continueEntry() {
    if (!entry || !commit("save")) return;
    withEventAttribution({ surface: editorSurface }, () =>
      localStore.continueTimesheetEntry(entry._id),
    );
    onClose();
  }

  /** Saves draft changes to the running entry, then stops it. */
  function stop() {
    if (!runningTimer || !commit("save")) return;
    withEventAttribution({ surface: editorSurface }, () =>
      localStore.saveTimer(runningTimer._id),
    );
    onClose();
  }

  /** Runs the main button: Enter and Cmd/Ctrl+Enter press it too. */
  function submit() {
    switch (primary.kind) {
      case "start":
        start();
        return;
      case "continue":
        continueEntry();
        return;
      case "create":
      case "save":
        save();
        return;
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
      resolveValues: lockReason ? undefined : editor.relocationValues,
    });
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    // Pickers, menus and confirmations render in portals; their keys stay theirs.
    // Fields that already saved on Enter mark the event as handled.
    if (
      event.defaultPrevented ||
      !(
        event.target instanceof
        (rootRef.current?.ownerDocument.defaultView?.Node ?? Node)
      ) ||
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

  // Start reads Start even while another entry runs: people know it takes
  // over, where "Switch" left them guessing (forms council round 12).
  const hoursHint = START_OR_ENTER_HOURS_HINT;
  const title = target.kind === "create" ? "New time entry" : "Edit time entry";
  // Only the status sits above the hours: the chips below already name the
  // task and the date (forms council round 7).
  const status = runningTimer ? (
    <Chip tone="success">Running</Chip>
  ) : lockReason ? (
    <WeekLockChip />
  ) : entry && isTimesheetEntryCommitted(entry) ? (
    <Chip>Committed</Chip>
  ) : null;
  const actions = (
    <div className="composer-actions">
      {actionTarget ? (
        <ObjectActionsButton
          actions={entryActions.getActions(actionTarget, {
            isEditing: true,
            invalidDraftReason:
              lockReason || editor.canSave
                ? undefined
                : "Enter a valid duration first",
          })}
          onAction={(actionId) =>
            withEventAttribution({ surface: editorSurface }, () =>
              handleAction(actionId),
            )
          }
          label="Entry actions"
        />
      ) : null}
      <TooltipButton
        label="Close"
        render={<Button variant="ghost" size="icon" onClick={onClose} />}
      >
        <X />
      </TooltipButton>
    </div>
  );

  return (
    <div
      ref={rootRef}
      className={cn(
        "time-entry-editor composer-root flex flex-col gap-5",
        className,
      )}
      data-mode={target.kind}
      onKeyDown={handleKeyDown}
    >
      {host === "side_panel" ? (
        // The side panel is a docked column, not a card: like the backlog
        // peek, it opens on a row that names it, with the status, ⋯ and ×.
        <header className="time-entry-editor-bar">
          <Title className="time-entry-editor-title">{title}</Title>
          {status}
          {actions}
        </header>
      ) : (
        <>
          {/* No "New time entry" line: the hours open the composer. The
              title stays for assistive tech, naming the dialog, and ⋯ and ×
              sit in the corner, so the composer starts with what the user
              writes (forms council round 15). */}
          <Title className="sr-only">{title}</Title>
          {actions}
          {status ? (
            <header className="time-entry-editor-meta">{status}</header>
          ) : null}
        </>
      )}

      {/* A disabled fieldset disables every field, picker and calendar button inside. */}
      <fieldset
        disabled={lockReason !== undefined}
        className="m-0 min-w-0 border-0 p-0"
      >
        <TimeEntryFields
          idPrefix={`time-entry-editor-${entry?._id ?? runningTimer?._id ?? "new"}`}
          projects={projects}
          projectId={fields.projectId}
          taskId={fields.taskId}
          note={fields.note}
          durationHours={fields.durationHours}
          durationError={
            editor.durationError === START_OR_ENTER_HOURS_HINT
              ? hoursHint
              : (editor.durationError ?? commitError)
          }
          durationHint={editor.isTimerMode ? hoursHint : null}
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
      </fieldset>

      <footer className="flex items-center justify-end gap-2 pt-1">
        {/* Stop opens the running entry's footer. Start and Continue are the
            main button's own verbs, and stay in the ⋯ menu. */}
        {runningTimer ? (
          <Button
            type="button"
            variant="outline"
            className="mr-auto"
            disabled={editor.hasChanges && !editor.canSave}
            onClick={stop}
          >
            <Stop data-icon="inline-start" />
            Stop
          </Button>
        ) : null}
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button
          type="button"
          disabled={
            primary.kind === "start"
              ? editor.durationMs === null
              : primary.kind === "continue"
                ? false
                : !editor.canSave
          }
          onClick={submit}
        >
          {primary.kind === "start" || primary.kind === "continue" ? (
            <Play data-icon="inline-start" />
          ) : null}
          {primary.label}
        </Button>
      </footer>
      {renderBelow?.({
        localDate: fields.localDate,
        durationMs: editor.durationMs,
      })}
      {entryActions.dialogs}
    </div>
  );
}
