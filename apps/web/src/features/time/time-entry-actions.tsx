import { useState } from "react";
import {
  formatEntryCount,
  getTimeEntryActions,
  getTimeEntryActionState,
  type ObjectAction,
  type TimeEntryActionId,
  type TimeEntryActionOptions,
} from "@/domain/actions/object-actions";
import type { LocalTimesheetEntry } from "@/domain/local-state";
import { getDateLockReason, isDateLocked } from "@/domain/time/locked-weeks";
import { isTimesheetEntryCommitted } from "@/domain/time/timesheet-commit";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { offerUndo, skipUndo } from "@/features/feedback/undo-toast";
import { useLocalState } from "@/lib/local-hooks";
import { localStore } from "@/lib/local-store";
import { withEventAttribution } from "@/lib/wide-events";

/** The object a time entry action applies to: a saved entry, or the running entry. */
export type TimeEntryActionTarget =
  | { kind: "entry"; entry: LocalTimesheetEntry }
  | { kind: "running"; timerId: string };

/** Values written by Duplicate, Duplicate to… and Move to…. */
export interface TimeEntryRelocationValues {
  localDate: string;
  projectId?: string;
  taskId?: string;
  note?: string;
  durationMs: number;
}

export interface TimeEntryActionRunOptions {
  /**
   * Editors pass their draft so relocation uses the values on screen instead of the
   * saved entry. Returns null when the draft cannot be saved.
   */
  resolveValues?: (localDate: string) => TimeEntryRelocationValues | null;
}

type DateActionKind = "duplicate-to" | "move-to";

/** The actions `runOnEntries` runs on several entries, such as a selection. */
export type TimeEntryManyActionId = "duplicate" | DateActionKind;

/**
 * Move to… or Duplicate to… waiting for its date: on one entry, or on several,
 * with `onDone` getting the entries that landed.
 */
type PendingDateAction =
  | {
      kind: DateActionKind;
      entry: LocalTimesheetEntry;
      resolveValues?: TimeEntryActionRunOptions["resolveValues"];
    }
  | {
      kind: DateActionKind;
      entries: readonly LocalTimesheetEntry[];
      onDone?: (entryIds: string[]) => void;
    };

function dateAtNoon(localDate: string) {
  return new Date(`${localDate}T12:00:00`);
}

function formatIsoDate(date: Date) {
  return new Intl.DateTimeFormat("en-CA").format(date);
}

/** Formats a day for toasts, such as "Thu, Oct 8". */
export function formatToastDay(localDate: string) {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(dateAtNoon(localDate));
}

/**
 * Shows the Undo toast for a time entry action. `token` is what the local store
 * returned for the action; null means the action changed nothing.
 */
export function offerTimeEntryUndo(token: string | null, title: string) {
  offerUndo(token, { title, subject: "entry" });
}

function savedValues(
  entry: LocalTimesheetEntry,
  localDate: string,
): TimeEntryRelocationValues {
  return {
    localDate,
    projectId: entry.projectId,
    taskId: entry.taskId,
    note: entry.note,
    durationMs: entry.durationMs,
  };
}

/**
 * Runs the time entry action set from any surface: Day rows, Week cards, Grid cells
 * and the entry editors. Each surface renders `dialogs` once and supplies how Edit
 * opens the entry there. Delete, Discard, Move to…, Duplicate to… another day and
 * Mark as not committed happen at once and show an Undo toast instead of asking
 * first. Entries of a submitted week list their actions disabled with the lock
 * reason, and the date dialog greys out submitted days.
 */
export function useTimeEntryActions({
  onEdit,
  onAfterAction,
}: {
  onEdit: (target: TimeEntryActionTarget) => void;
  /**
   * Called after every action except Edit and Mark as not committed, so editors
   * can close. Mark as not committed keeps the entry as it is on screen.
   */
  onAfterAction?: () => void;
}) {
  const state = useLocalState();
  const [dateAction, setDateAction] = useState<PendingDateAction | null>(null);
  const [selectedDate, setSelectedDate] = useState(() => new Date());

  function getActions(
    target: TimeEntryActionTarget,
    options: TimeEntryActionOptions = {},
  ): ObjectAction<TimeEntryActionId>[] {
    return getTimeEntryActions(
      getTimeEntryActionState({
        isRunning: target.kind === "running",
        isCommitted:
          target.kind === "entry" && isTimesheetEntryCommitted(target.entry),
      }),
      {
        ...options,
        lockedReason:
          options.lockedReason ??
          (target.kind === "entry"
            ? getDateLockReason(state, target.entry.localDate)
            : undefined),
      },
    );
  }

  function relocate(
    kind: "duplicate" | DateActionKind,
    entry: LocalTimesheetEntry,
    localDate: string,
    resolveValues?: TimeEntryActionRunOptions["resolveValues"],
  ) {
    const values = resolveValues
      ? resolveValues(localDate)
      : savedValues(entry, localDate);
    if (!values) {
      return;
    }

    const token =
      kind === "move-to"
        ? localStore.moveTimesheetEntry(entry._id, values)
        : localStore.duplicateTimesheetEntry(entry._id, values);
    // Undo covers moves and copies to another day. A copy on the same day
    // shows where it happened.
    if (kind !== "duplicate" && localDate !== entry.localDate) {
      offerTimeEntryUndo(
        token,
        `${kind === "move-to" ? "Moved" : "Duplicated"} to ${formatToastDay(localDate)}`,
      );
    } else {
      skipUndo(token);
    }
    onAfterAction?.();
  }

  /**
   * Copies or moves saved entries, such as the selection, in one change with
   * one Undo, even for a single entry. Each
   * copy of Duplicate lands at the end of its own entry's day; Move to… and
   * Duplicate to… put every entry at the end of `localDate`, in the order of
   * `entries`. `onDone` gets the entries that landed.
   */
  function relocateMany(
    kind: TimeEntryManyActionId,
    entries: readonly LocalTimesheetEntry[],
    localDate: string | null,
    onDone?: (entryIds: string[]) => void,
  ) {
    const { undoToken, entryIds } = localStore.relocateTimesheetEntries(
      entries.map((entry) => ({
        entryId: entry._id,
        localDate: localDate ?? entry.localDate,
      })),
      kind === "move-to" ? "cut" : "copy",
    );
    // Every selection action offers one Undo. The toast counts the entries that
    // landed, and one entry reads like the entry's own action.
    const one = entryIds.length === 1;
    const count = formatEntryCount(entryIds.length);
    const day = localDate ? formatToastDay(localDate) : "";
    offerTimeEntryUndo(
      undoToken,
      kind === "move-to"
        ? one
          ? `Moved to ${day}`
          : `Moved ${count} to ${day}`
        : kind === "duplicate-to"
          ? one
            ? `Duplicated to ${day}`
            : `Duplicated ${count} to ${day}`
          : one
            ? "Entry duplicated"
            : `Duplicated ${count}`,
    );
    onDone?.(entryIds);
    onAfterAction?.();
  }

  /**
   * Runs Duplicate, Duplicate to… or Move to… on several saved entries, such as
   * the selection. Duplicate happens at once; the other two ask for the day
   * once, for all of them. `onDone` gets the copies or the moved entries.
   */
  function runOnEntries(
    actionId: TimeEntryManyActionId,
    entries: readonly LocalTimesheetEntry[],
    { onDone }: { onDone?: (entryIds: string[]) => void } = {},
  ) {
    const first = entries[0];
    if (!first) {
      return;
    }

    if (actionId === "duplicate") {
      relocateMany("duplicate", entries, null, onDone);
      return;
    }

    setSelectedDate(dateAtNoon(first.localDate));
    setDateAction({ kind: actionId, entries, onDone });
  }

  function runAction(
    target: TimeEntryActionTarget,
    actionId: TimeEntryActionId,
    options: TimeEntryActionRunOptions = {},
  ) {
    return withEventAttribution({ surface: "button" }, () => {
      if (actionId === "edit") {
        onEdit(target);
        return;
      }

      if (target.kind === "running") {
        if (actionId === "stop") {
          localStore.saveTimer(target.timerId);
          onAfterAction?.();
        } else if (actionId === "discard") {
          offerTimeEntryUndo(
            localStore.cancelTimer(target.timerId),
            "Running entry discarded",
          );
          onAfterAction?.();
        }
        return;
      }

      const { entry } = target;
      switch (actionId) {
        case "continue":
          localStore.continueTimesheetEntry(entry._id);
          onAfterAction?.();
          return;
        case "duplicate":
          relocate("duplicate", entry, entry.localDate, options.resolveValues);
          return;
        case "duplicate-to":
        case "move-to":
          setSelectedDate(dateAtNoon(entry.localDate));
          setDateAction({
            kind: actionId,
            entry,
            resolveValues: options.resolveValues,
          });
          return;
        case "mark-not-committed":
          // The editor stays open: the entry is still there, only its chip goes.
          offerTimeEntryUndo(
            localStore.markTimesheetEntriesNotCommitted([entry._id]),
            "Marked as not committed",
          );
          return;
        case "delete":
          offerTimeEntryUndo(
            localStore.deleteTimesheetEntry(entry._id),
            "Entry deleted",
          );
          onAfterAction?.();
          return;
        default:
          return;
      }
    });
  }

  function confirmDateAction() {
    if (!dateAction) {
      return;
    }

    const localDate = formatIsoDate(selectedDate);
    if ("entries" in dateAction) {
      relocateMany(
        dateAction.kind,
        dateAction.entries,
        localDate,
        dateAction.onDone,
      );
    } else {
      relocate(
        dateAction.kind,
        dateAction.entry,
        localDate,
        dateAction.resolveValues,
      );
    }
    setDateAction(null);
  }

  const isMove = dateAction?.kind === "move-to";
  const entryCount =
    dateAction && "entries" in dateAction ? dateAction.entries.length : 1;
  const dialogSubject =
    entryCount === 1 ? "time entry" : formatEntryCount(entryCount);
  const dialogs = (
    <Dialog
      open={dateAction !== null}
      onOpenChange={(open) => !open && setDateAction(null)}
    >
      <DialogContent className="w-auto gap-4">
        <DialogHeader>
          <DialogTitle>
            {isMove ? `Move ${dialogSubject}` : `Duplicate ${dialogSubject}`}
          </DialogTitle>
          <DialogDescription>Choose the destination date.</DialogDescription>
        </DialogHeader>
        <Calendar
          mode="single"
          selected={selectedDate}
          onSelect={(date) => date && setSelectedDate(date)}
          disabled={(date: Date) => isDateLocked(state, formatIsoDate(date))}
        />
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"

            onClick={() => setDateAction(null)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={confirmDateAction}
            disabled={isDateLocked(state, formatIsoDate(selectedDate))}
          >
            {isMove ? "Move" : "Duplicate"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  return { getActions, runAction, runOnEntries, dialogs };
}
