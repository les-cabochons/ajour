import { useEffect, useState } from "react";
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
import { formatShortLocalDate, getWeekDates } from "@/domain/time/local-date";
import type { WeekTargetReached } from "@/domain/time/week-target-prompt";
import { useOpenCommitPage } from "@/features/time/use-open-commit-page";
import { watchWeekTargets } from "@/features/time/week-target-watch";

/** The week to ask about, until the user answers. */
function useWeekTargetPrompt() {
  const [reached, setReached] = useState<WeekTargetReached | null>(null);
  useEffect(() => watchWeekTargets(setReached), []);
  return { reached, dismiss: () => setReached(null) };
}

/**
 * The "Week complete" question. Commit opens the week's Commit page through
 * `useOpenCommitPage`, which saves an open entry draft first; Later closes it. The app shell mounts it once.
 */
export function WeekTargetPromptHost() {
  const { reached, dismiss } = useWeekTargetPrompt();
  // The same path as the other Commit buttons, so an open entry draft is
  // saved first, or stays open when it is invalid.
  const openCommitPage = useOpenCommitPage(reached?.weekOf ?? "");

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
              ? `You logged ${formatClockDuration(reached.totalMs)} of ${formatClockDuration(reached.targetMs)} for the week of ${formatWeekRange(reached.weekOf)}. Commit and lock it now?`
              : null}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Later</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              const weekOf = reached?.weekOf;
              dismiss();
              if (weekOf) openCommitPage(weekOf);
            }}
          >
            Commit
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** "Oct 12 to 18", or "Sep 28 to Oct 4" across a month, with the year when it is not this year. */
function formatWeekRange(weekOf: string) {
  const year = new Date().getFullYear();
  const days = getWeekDates(weekOf);
  const monday = days[0]!;
  const sunday = days[6]!;
  const sameMonth = monday.slice(0, 7) === sunday.slice(0, 7);
  const end = sameMonth
    ? formatShortLocalDate(sunday, year).replace(/^\S+ /, "")
    : formatShortLocalDate(sunday, year);
  return `${formatShortLocalDate(monday, year)} to ${end}`;
}
