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
import {
  findWeekReachingTarget,
  listTouchedWeeks,
  type WeekTargetReached,
} from "@/domain/time/week-target-prompt";
import { dateAtNoon } from "@/features/time/time-date-picker";
import { localStore } from "@/lib/local-store";

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

/**
 * Watches every store write. When one brings a week's saved total to its
 * target (`findWeekReachingTarget`), it marks the week as asked at once, so
 * Ajour never asks twice whatever the answer, and returns the week to ask
 * about. A write from another window counts too.
 */
function useWeekTargetPrompt() {
  const [reached, setReached] = useState<WeekTargetReached | null>(null);

  useEffect(() => {
    let previous = localStore.snapshot();
    return localStore.subscribe(() => {
      const before = previous;
      const after = localStore.snapshot();
      // Set first: marking the week below writes again and calls back here.
      previous = after;
      const week = findWeekReachingTarget({
        before,
        after,
        touchedWeeks: listTouchedWeeks(before, after),
      });
      if (!week) return;
      localStore.markCommitPrompted(week.weekOf);
      setReached(week);
    });
  }, []);

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
