import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
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
import { formatClockDuration } from "@/domain/time/duration";
import type { WeekTargetReached } from "@/domain/time/week-target-prompt";
import { dateAtNoon } from "@/features/time/time-date-picker";
import { watchWeekTargets } from "@/features/time/week-target-watch";

const shortDate = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
});

/** "Oct 12 to 18", or "Sep 28 to Oct 4" across a month boundary. */
export function formatWeekTargetRange(weekDates: readonly string[]) {
  const start = dateAtNoon(weekDates[0]!);
  const end = dateAtNoon(weekDates.at(-1)!);
  const endLabel =
    start.getMonth() === end.getMonth()
      ? String(end.getDate())
      : shortDate.format(end);
  return `${shortDate.format(start)} to ${endLabel}`;
}

/** The week to ask about, until the user answers. */
function useWeekTargetPrompt() {
  const [reached, setReached] = useState<WeekTargetReached | null>(null);
  useEffect(() => watchWeekTargets(setReached), []);
  return { reached, dismiss: () => setReached(null) };
}

/**
 * The "Week complete" question. Commit opens the week's Commit page; Later
 * closes it. The app shell mounts it once.
 */
export function WeekTargetPromptHost() {
  const navigate = useNavigate();
  const { reached, dismiss } = useWeekTargetPrompt();

  return (
    <AlertDialog
      open={reached !== null}
      onOpenChange={(open) => {
        if (!open) dismiss();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Week complete</AlertDialogTitle>
          <AlertDialogDescription>
            {reached
              ? `You logged ${formatClockDuration(reached.totalMs)} of ${formatClockDuration(reached.targetMs)} for the week of ${formatWeekTargetRange(reached.weekDates)}. Commit and lock it now?`
              : null}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Later</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              const weekOf = reached?.weekOf;
              dismiss();
              if (weekOf) {
                void navigate({
                  to: "/time/$date/commit",
                  params: { date: weekOf },
                });
              }
            }}
          >
            Commit
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
