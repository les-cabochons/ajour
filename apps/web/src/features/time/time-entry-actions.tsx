import { useState } from "react";
import {
  getTimeEntryActions,
  type ObjectAction,
  type TimeEntryActionId,
  type TimeEntryActionOptions,
} from "@/domain/actions/object-actions";
import type { LocalTimesheetEntry } from "@/domain/local-state";
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
import { localStore } from "@/lib/local-store";
import { todayIsoDate } from "@/lib/utils";

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

interface PendingDateAction {
  kind: DateActionKind;
  entry: LocalTimesheetEntry;
  resolveValues?: TimeEntryActionRunOptions["resolveValues"];
}

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
 * opens the entry there. Delete, Discard, Move to… and Duplicate to… another day
 * happen at once and show an Undo toast instead of asking first.
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

  function getActions(
    target: TimeEntryActionTarget,
    options: Omit<TimeEntryActionOptions, "isToday"> = {},
  ): ObjectAction<TimeEntryActionId>[] {
    if (target.kind === "running") {
      return getTimeEntryActions("running", options);
    }

    return getTimeEntryActions("saved", {
      ...options,
      isToday: target.entry.localDate === todayIsoDate(),
    });
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

  const isMove = dateAction?.kind === "move-to";
  const dialogs = (
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

            onClick={() => setDateAction(null)}
          >
            Cancel
          </Button>
          <Button type="button" onClick={confirmDateAction}>
            {isMove ? "Move" : "Duplicate"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  return { getActions, runAction, dialogs };
}
