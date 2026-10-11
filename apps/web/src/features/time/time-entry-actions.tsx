import { useState } from "react";
import {
  getTimeEntryActions,
  type ObjectAction,
  type TimeEntryActionId,
  type TimeEntryActionOptions,
} from "@/domain/actions/object-actions";
import type { LocalTimesheetEntry } from "@/domain/local-state";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
import { localStore } from "@/lib/local-store";
import { todayIsoDate } from "@/lib/utils";

/** The object a time entry action applies to: a saved or submitted entry, or the running entry. */
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

interface PendingDateAction {
  kind: DateActionKind;
  entry: LocalTimesheetEntry;
  resolveValues?: TimeEntryActionRunOptions["resolveValues"];
}

type PendingConfirmation =
  { kind: "delete"; entryId: string } | { kind: "discard"; timerId: string };

function dateAtNoon(localDate: string) {
  return new Date(`${localDate}T12:00:00`);
}

function formatIsoDate(date: Date) {
  return new Intl.DateTimeFormat("en-CA").format(date);
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
 * Runs the time entry action set from any surface: Day rows, Week cards, the Grid tray
 * and the entry editors. Each surface renders `dialogs` once and supplies how Edit
 * opens the entry there.
 */
export function useTimeEntryActions({
  onEdit,
  onAfterAction,
}: {
  onEdit: (target: TimeEntryActionTarget) => void;
  /** Called after an action changes or removes the entry, so editors can close. */
  onAfterAction?: () => void;
}) {
  const [dateAction, setDateAction] = useState<PendingDateAction | null>(null);
  const [selectedDate, setSelectedDate] = useState(() => new Date());
  const [confirmation, setConfirmation] = useState<PendingConfirmation | null>(
    null,
  );

  function getActions(
    target: TimeEntryActionTarget,
    options: Omit<TimeEntryActionOptions, "isToday"> = {},
  ): ObjectAction<TimeEntryActionId>[] {
    if (target.kind === "running") {
      return getTimeEntryActions("running", options);
    }

    return getTimeEntryActions(
      target.entry.submittedAt ? "submitted" : "saved",
      { ...options, isToday: target.entry.localDate === todayIsoDate() },
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

    if (kind === "move-to") {
      localStore.moveTimesheetEntry(entry._id, values);
    } else {
      localStore.duplicateTimesheetEntry(entry._id, values);
    }
    onAfterAction?.();
  }

  function runAction(
    target: TimeEntryActionTarget,
    actionId: TimeEntryActionId,
    options: TimeEntryActionRunOptions = {},
  ) {
    if (actionId === "edit") {
      onEdit(target);
      return;
    }

    if (target.kind === "running") {
      if (actionId === "stop") {
        localStore.saveTimer(target.timerId);
        onAfterAction?.();
      } else if (actionId === "discard") {
        setConfirmation({ kind: "discard", timerId: target.timerId });
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
      case "delete":
        setConfirmation({ kind: "delete", entryId: entry._id });
        return;
      default:
        return;
    }
  }

  function confirmDateAction() {
    if (!dateAction) {
      return;
    }

    relocate(
      dateAction.kind,
      dateAction.entry,
      formatIsoDate(selectedDate),
      dateAction.resolveValues,
    );
    setDateAction(null);
  }

  function confirmDestructiveAction() {
    if (!confirmation) {
      return;
    }

    if (confirmation.kind === "delete") {
      localStore.deleteTimesheetEntry(confirmation.entryId);
    } else {
      localStore.cancelTimer(confirmation.timerId);
    }
    setConfirmation(null);
    onAfterAction?.();
  }

  const isMove = dateAction?.kind === "move-to";
  const dialogs = (
    <>
      <Dialog
        open={dateAction !== null}
        onOpenChange={(open) => !open && setDateAction(null)}
      >
        <DialogContent className="w-auto gap-4">
          <DialogHeader>
            <DialogTitle>
              {isMove ? "Move time entry" : "Duplicate time entry"}
            </DialogTitle>
            <DialogDescription>Choose the destination date.</DialogDescription>
          </DialogHeader>
          <Calendar
            mode="single"
            selected={selectedDate}
            onSelect={(date) => date && setSelectedDate(date)}
          />
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setDateAction(null)}
            >
              Cancel
            </Button>
            <Button type="button" size="sm" onClick={confirmDateAction}>
              {isMove ? "Move" : "Duplicate"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <AlertDialog
        open={confirmation !== null}
        onOpenChange={(open) => !open && setConfirmation(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmation?.kind === "discard"
                ? "Discard the running entry?"
                : "Delete this time entry?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmation?.kind === "discard"
                ? "The time counted since it started will be lost."
                : "This can't be undone."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="danger"
              onClick={confirmDestructiveAction}
            >
              {confirmation?.kind === "discard" ? "Discard" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );

  return { getActions, runAction, dialogs };
}
