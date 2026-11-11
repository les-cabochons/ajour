import {
  useEffect,
  useImperativeHandle,
  useMemo,
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
  type LocalAppState,
  type LocalTimer,
  type LocalTimesheetEntry,
} from "@/domain/local-state";
import { getDateLockReason } from "@/domain/time/locked-weeks";
import { isTimesheetEntryCommitted } from "@/domain/time/timesheet-commit";
import { syncBacklogWorkItemToSource } from "@/features/backlog/work-item-source-sync";
import {
  commitTimeEntryDraft,
  createTimeEntryEditorFields,
  enterPressesPrimaryAction,
  evaluateTimeEntryEditor,
  getTimeEntryPrimaryAction,
  START_OR_ENTER_HOURS_HINT,
  START_STOPS_RUNNING_HINT,
  type TimeEntryDraftCommitReason,
  type TimeEntryEditorFields,
  type TimeEntryValues,
} from "@/features/time/time-entry-editor";
import {
  formatToastDay,
  offerTimeEntryUndo,
  useTimeEntryActions,
  type TimeEntryActionTarget,
} from "@/features/time/time-entry-actions";
import { skipUndo } from "@/features/feedback/undo-toast";
import {
  DraftConflictNotice,
  type DraftConflictView,
} from "@/components/draft-conflict-notice";
import {
  findDraftConflicts,
  keepMineInDraft,
  reconcileDraft,
  useTheirsInDraft,
  type DraftFieldGroup,
  type ReconciledDraft,
} from "@/domain/draft-reconcile";
import { WeekLockChip } from "@/features/time/week-lock";
import { TimeEntryFields } from "@/features/time/time-entry-fields";
import {
  dropComposerDraft,
  getComposerDraft,
  keepComposerDraft,
} from "@/lib/composer-drafts";
import { useOpenEntryEditor } from "@/lib/entry-editor-presence";
import { ignoreSecondClick } from "@/lib/double-click-guard";
import { focusWhenLost } from "@/lib/focus-return";
import { useLocalProjects, useLocalState } from "@/lib/local-hooks";
import { localStore, runStoreCommandWith } from "@/lib/local-store";
import { recordsEqual } from "@/domain/records-equal";
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
  /**
   * The page is leaving the form by any way, such as a sidebar link: a valid
   * draft is saved, with the Undo toast, and an invalid one is kept.
   */
  leave: () => void;
  /** The host closes on Escape: the draft is kept, not saved, for the next opening. */
  keepDraft: () => void;
}

/** Where a form's unsaved draft is kept between openings (`lib/composer-drafts.ts`). */
export function getTimeEntryDraftKey(target: TimeEntryEditorTarget) {
  switch (target.kind) {
    case "edit":
      return `time-entry:${target.entry._id}`;
    case "running":
      return `time-entry:running:${target.timer._id}`;
    case "create": {
      const values = target.initialValues;
      return [
        "time-entry:new",
        target.localDate,
        values?.projectId ?? "",
        values?.taskId ?? "",
        values?.workItemId ?? "",
      ].join(":");
    }
  }
}

/**
 * A kept draft, with the entry's fields it started from (`base`), so the
 * next opening can tell what the user changed from what changed since. The
 * running entry's Hours shows the time counted when the form opens, so its
 * draft keeps typed hours only.
 */
interface KeptTimeEntryDraft {
  fields: TimeEntryEditorFields;
  base: TimeEntryEditorFields;
  hoursTyped: boolean;
}

/** The project and its task change together, as one pick. */
const DRAFT_FIELD_GROUPS: readonly DraftFieldGroup<TimeEntryEditorFields>[] = [
  ["projectId", "taskId"],
];

const CONFLICT_LABELS: Record<keyof TimeEntryEditorFields, string> = {
  projectId: "Task",
  taskId: "Task",
  note: "Note",
  durationHours: "Hours",
  localDate: "Date",
};

/** A project and task as a conflict names them, "Acme / Design". */
function describeTask(
  projects: readonly {
    _id: string;
    name: string;
    displayName?: string;
    tasks: readonly { _id: string; name: string }[];
  }[],
  projectId: string,
  taskId: string,
) {
  const project = projects.find((candidate) => candidate._id === projectId);
  const task = project?.tasks.find((candidate) => candidate._id === taskId);
  return [project?.displayName?.trim() || project?.name, task?.name]
    .filter(Boolean)
    .join(" / ");
}

const RESOLVE_CONFLICTS_FIRST =
  "Choose which version to keep for each changed field first.";

/**
 * The draft to resume for `key`, brought up to the entry as it is now
 * (`seed`): a field the user did not change takes the entry's value, and a
 * field both changed stays as typed, in conflict (`findDraftConflicts`).
 * The running entry's hours are counted afresh unless typed, and never
 * conflict. A new entry has no saved entry underneath.
 */
function resumeDraft(
  key: string,
  seed: TimeEntryEditorFields,
  { isRunning, isNew }: { isRunning: boolean; isNew: boolean },
  initialFields: TimeEntryEditorFields | undefined,
): ReconciledDraft<TimeEntryEditorFields> {
  const kept = getComposerDraft<KeptTimeEntryDraft>(key);
  const fields =
    initialFields ??
    (kept && isRunning && !kept.hoursTyped
      ? { ...kept.fields, durationHours: seed.durationHours }
      : kept?.fields);
  if (!fields) return { fields: seed, base: seed };
  if (isNew) return { fields, base: seed };

  const base = { ...(kept?.base ?? seed) };
  if (isRunning) base.durationHours = seed.durationHours;
  return reconcileDraft({ fields, base }, seed, DRAFT_FIELD_GROUPS);
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

/** The saved record under the form as it is now, with the fields it gives the draft. */
interface CurrentRecord {
  entry?: LocalTimesheetEntry;
  timer?: LocalTimer;
  /** The values an untouched draft equals; the running entry keeps its opening Hours. */
  original?: TimeEntryValues;
  fields?: TimeEntryEditorFields;
}

/**
 * Reads the record the form edits from `source`, falling back to the target's
 * own snapshot when it is gone. A new entry has no record underneath. The
 * running entry's Hours stays the time counted when the form opened
 * (`openedDurationMs`), because it does not tick.
 */
function readCurrentRecord(
  source: Pick<LocalAppState, "timesheetEntries" | "timers">,
  target: TimeEntryEditorTarget,
  openedDurationMs: number | undefined,
): CurrentRecord {
  switch (target.kind) {
    case "create":
      return {};
    case "edit": {
      const entry =
        source.timesheetEntries.find(
          (candidate) => candidate._id === target.entry._id,
        ) ?? target.entry;
      return {
        entry,
        original: entry,
        fields: createTimeEntryEditorFields(entry.localDate, entry),
      };
    }
    case "running": {
      const timer =
        source.timers.find((candidate) => candidate._id === target.timer._id) ??
        target.timer;
      const original: TimeEntryValues = {
        projectId: timer.projectId,
        taskId: timer.taskId,
        note: timer.note,
        localDate: timer.localDate,
        durationMs: openedDurationMs ?? 0,
      };
      return {
        timer,
        original,
        fields: createTimeEntryEditorFields(timer.localDate, original),
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
 * Note, and Cmd/Ctrl+Enter, press the main button, except that Enter does not
 * Start over another running entry. Escape closes and keeps the draft for the
 * next opening of the same target; Cancel or × discard it. Every save shows the
 * Undo toast. Save on the running entry keeps it running. An entry of a
 * submitted week opens read-only, with the lock under Date.
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
  const workItemId =
    target.kind === "create" ? target.initialValues?.workItemId : undefined;
  const [seed] = useState(() => seedEditor(target));
  const openedDurationMs = seed.runningOriginal?.durationMs;
  // The record as it is now, so a save in another window reaches the open form.
  const record = useMemo(
    () =>
      readCurrentRecord(
        { timesheetEntries: state.timesheetEntries, timers: state.timers },
        target,
        openedDurationMs,
      ),
    [openedDurationMs, state.timesheetEntries, state.timers, target],
  );
  const { entry, timer: runningTimer, original } = record;
  const currentFields = record.fields;
  // Escape, or leaving the page, keeps the draft for the same target.
  const [draftKey] = useState(() => getTimeEntryDraftKey(target));
  const [resumed] = useState(() =>
    resumeDraft(
      draftKey,
      seed.fields,
      { isRunning: Boolean(runningTimer), isNew: target.kind === "create" },
      initialFields,
    ),
  );
  const [fields, setFields] = useState(resumed.fields);
  // The entry's fields the draft started from. A field the entry changed
  // since, which the draft changed too, is a conflict until it is settled.
  const [base, setBase] = useState(resumed.base);
  // A field the user did not change follows the record while the form stays
  // open, as the Backlog editor's does; a field both changed stays as typed,
  // in conflict, until it is settled.
  useEffect(() => {
    if (!currentFields) return;
    const next = reconcileDraft(
      { fields, base },
      currentFields,
      DRAFT_FIELD_GROUPS,
    );
    if (!recordsEqual(next.fields, fields)) setFields(next.fields);
    if (!recordsEqual(next.base, base)) setBase(next.base);
  }, [base, currentFields, fields]);
  const conflictGroups = currentFields
    ? findDraftConflicts({ fields, base }, currentFields, DRAFT_FIELD_GROUPS)
    : [];
  // Set once the draft was saved, kept or discarded on purpose, so leaving
  // the page afterwards writes nothing more.
  const settledRef = useRef(false);
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
  const evaluateDraft = (
    draftFields: TimeEntryEditorFields,
    draftOriginal: TimeEntryValues | undefined,
  ) =>
    evaluateTimeEntryEditor(draftFields, {
      original: draftOriginal,
      lockReasonFor: runningTimer ? undefined : lockReasonFor,
      allowEmptyDuration: target.kind === "create",
      isRunning: Boolean(runningTimer),
      // A switch drops a new entry the user left as it opened, prefilled task included.
      prefill: target.kind === "create" ? seed.fields : undefined,
    });
  const editor = evaluateDraft(fields, original);
  const entryActions = useTimeEntryActions({
    onEdit: () => undefined,
    onAfterAction: () => finish(),
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

  // The draft is kept while it holds something to save, until it is saved
  // or discarded.
  const holdsDraft = editor.isNew ? editor.hasContent : editor.hasChanges;
  useEffect(() => {
    if (settledRef.current) return;
    if (holdsDraft) {
      keepComposerDraft(draftKey, {
        fields,
        base,
        hoursTyped: fields.durationHours !== seed.fields.durationHours,
      } satisfies KeptTimeEntryDraft);
    } else {
      dropComposerDraft(draftKey);
    }
  }, [base, draftKey, fields, holdsDraft, seed.fields.durationHours]);

  const conflicts = conflictGroups.map((group): DraftConflictView => {
    const describe = (values: TimeEntryEditorFields) => {
      switch (group[0]) {
        case "projectId":
          return describeTask(projects, values.projectId, values.taskId);
        case "localDate":
          return formatEntryDate(values.localDate);
        default:
          return values[group[0]!] as string;
      }
    };
    return {
      id: group.join(","),
      label: CONFLICT_LABELS[group[0]!],
      theirs: describe(currentFields ?? seed.fields),
      mine: describe(fields),
    };
  });

  /** Settles a changed field: the draft's version stays, or the entry's now. */
  function settleConflict(id: string, keep: "mine" | "theirs") {
    const group = conflictGroups.find(
      (candidate) => candidate.join(",") === id,
    );
    if (!group || !currentFields) return;
    const settle = keep === "mine" ? keepMineInDraft : useTheirsInDraft;
    const settled = settle({ fields, base }, currentFields, group);
    setFields(settled.fields);
    setBase(settled.base);
    setCommitError(null);
  }

  useImperativeHandle(ref, () => ({
    commitBeforeSwitch: () => {
      if (settledRef.current) return true;
      const committed = commit("switch");
      if (committed) settle();
      return committed;
    },
    leave: () => {
      if (settledRef.current) return;
      const latest = readLatest();
      // A changed field nobody settled keeps the draft, as an invalid one is.
      const result =
        latest.conflicts.length > 0
          ? ({ kind: "invalid" } as const)
          : commitTimeEntryDraft(latest.editor, "switch");
      // An invalid draft stays kept, for the next opening.
      if (result.kind === "save") {
        writeEntry(result.values, { latest });
        dropComposerDraft(draftKey);
      }
      settledRef.current = true;
    },
    keepDraft: () => {
      settledRef.current = true;
    },
  }));

  /** The draft is done: saved, or discarded on purpose. */
  function settle() {
    settledRef.current = true;
    dropComposerDraft(draftKey);
  }

  /** Closes after a save or an action, or on Cancel and ×, ending the draft. */
  function finish() {
    settle();
    onClose();
  }

  /** Escape: closes and keeps the draft for the next opening. */
  function dismiss() {
    settledRef.current = true;
    onClose();
  }

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
    settledRef.current = false;
  }

  /**
   * Writes the draft when it has something to save, with the Undo toast
   * unless `offerUndo` is false. Returns false when it is blocked.
   */
  function commit(
    reason: TimeEntryDraftCommitReason,
    { offerUndo = true }: { offerUndo?: boolean } = {},
  ) {
    const latest = readLatest();
    // A change that landed since the last render counts, and shows as a
    // conflict, rather than being written over.
    if (!recordsEqual(latest.draft.fields, fields)) {
      setFields(latest.draft.fields);
    }
    if (!recordsEqual(latest.draft.base, base)) setBase(latest.draft.base);
    if (latest.conflicts.length > 0) {
      setCommitError(RESOLVE_CONFLICTS_FIRST);
      return false;
    }
    const result = commitTimeEntryDraft(latest.editor, reason);
    if (result.kind === "invalid") {
      setCommitError(result.error);
      return false;
    }

    if (result.kind === "save") {
      writeEntry(result.values, { offerUndo, latest });
    }
    return true;
  }

  /**
   * The draft against the record as the store holds it this moment, not as the
   * last render saw it: a save from another window can land between the two.
   */
  function readLatest() {
    const latestRecord = readCurrentRecord(
      localStore.snapshot(),
      target,
      openedDurationMs,
    );
    const latestFields = latestRecord.fields;
    const draft = latestFields
      ? reconcileDraft({ fields, base }, latestFields, DRAFT_FIELD_GROUPS)
      : { fields, base };
    return {
      record: latestRecord,
      draft,
      conflicts: latestFields
        ? findDraftConflicts(draft, latestFields, DRAFT_FIELD_GROUPS)
        : [],
      editor: evaluateDraft(draft.fields, latestRecord.original ?? original),
    };
  }

  /** Records, on the save's event, where the form sits. */
  const recordHost = (unit: {
    set(fields: { time_entry: { host: typeof host } }): unknown;
  }) => unit.set({ time_entry: { host } });

  /**
   * Saves the draft's values, with the Undo toast. Stop and Continue pass
   * `offerUndo: false`: the entry changes again at once, so that Undo
   * could only be refused.
   */
  function writeEntry(
    values: TimeEntryValues,
    {
      offerUndo = true,
      latest,
    }: { offerUndo?: boolean; latest: ReturnType<typeof readLatest> },
  ) {
    const {
      entry,
      timer: runningTimer,
      original: runningOriginal,
    } = latest.record;
    const { editor } = latest;
    const offer = (token: string | null, title: string) =>
      offerUndo ? offerTimeEntryUndo(token, title) : skipUndo(token);
    return withEventAttribution({ surface: editorSurface }, () => {
      if (runningTimer) {
        const token = runStoreCommandWith(
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
        offer(token, "Entry saved");
        return;
      }

      if (entry) {
        if (values.localDate === entry.localDate) {
          offer(
            runStoreCommandWith(
              "updateTimesheetEntry",
              [entry._id, values],
              recordHost,
            ),
            "Entry saved",
          );
        } else {
          offer(
            localStore.moveTimesheetEntry(entry._id, values),
            `Moved to ${formatToastDay(values.localDate)}`,
          );
        }
        return;
      }

      offer(
        runStoreCommandWith(
          "saveManualTimeEntry",
          [{ ...values, workItemId }],
          recordHost,
        ),
        "Entry created",
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

  /**
   * Closes the editor after `write`, and focuses the row or card of the entry
   * it wrote when focus fell to the page, as after N from the page or Stop on
   * a running row the save replaces. A host that gives focus back to the row
   * or button the editor came from keeps it there.
   */
  function closeOnEntry(write: () => boolean) {
    const before = new Set(
      localStore.snapshot().timesheetEntries.map((saved) => saved._id),
    );
    const savedId = entry?._id ?? runningTimer?.entryId;
    if (!write()) return;
    // Ends the draft as well as closing: a written draft is not kept.
    finish();
    focusWhenLost(() => {
      const id =
        localStore
          .snapshot()
          .timesheetEntries.find((saved) => !before.has(saved._id))?._id ??
        savedId;
      return id
        ? document.querySelector<HTMLElement>(
            `[data-entry-id="${CSS.escape(id)}"][data-focus-column]`,
          )
        : null;
    });
  }

  function save() {
    closeOnEntry(() => commit("save"));
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
    finish();
  }

  /** Saves draft changes, then continues the entry's work (see Continue in GLOSSARY.md). */
  function continueEntry() {
    if (!entry || !commit("save", { offerUndo: false })) return;
    withEventAttribution({ surface: editorSurface }, () =>
      localStore.continueTimesheetEntry(entry._id),
    );
    finish();
  }

  /** Saves draft changes to the running entry, then stops it. */
  function stop() {
    if (!runningTimer) return;
    closeOnEntry(() => {
      if (!commit("save", { offerUndo: false })) return false;
      withEventAttribution({ surface: editorSurface }, () =>
        localStore.saveTimer(runningTimer._id),
      );
      return true;
    });
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
      dismiss();
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
    // Cmd/Ctrl+Enter is the form's: it presses the main button whatever it reads.
    if (event.metaKey || event.ctrlKey) return;
    event.preventDefault();
    if (!enterPressesPrimaryAction(primary, { isAnotherEntryRunning })) {
      setCommitError(START_STOPS_RUNNING_HINT);
      return;
    }
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
        render={
          <Button
            variant="ghost"
            size="icon"
            onClick={(event) => {
              ignoreSecondClick(event);
              finish();
            }}
          />
        }
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

      <DraftConflictNotice
        conflicts={conflicts}
        onKeepMine={(id) => settleConflict(id, "mine")}
        onUseTheirs={(id) => settleConflict(id, "theirs")}
      />

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

      <footer
        className="flex items-center justify-end gap-2 pt-1"
        // Each button closes the editor, so a double-click's second click
        // would land on the row or button it uncovers.
        onClickCapture={ignoreSecondClick}
      >
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
        <Button type="button" variant="ghost" onClick={finish}>
          Cancel
        </Button>
        <Button
          type="button"
          disabled={
            conflicts.length > 0 ||
            (primary.kind === "start"
              ? editor.durationMs === null
              : primary.kind === "continue"
                ? false
                : !editor.canSave)
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
