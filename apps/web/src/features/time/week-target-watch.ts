import {
  findWeekReachingTarget,
  listTouchedWeeks,
  type WeekTargetReached,
} from "@/domain/time/week-target-prompt";
import { localStore } from "@/lib/local-store";

/**
 * Watches this window's store writes. When one brings a week's saved total to
 * its target (`findWeekReachingTarget`), it marks the week as asked at once, so
 * Ajour never asks twice whatever the answer, then calls `onReach`. A write
 * from another window only moves the starting point: that window asks.
 * Returns the unsubscribe function.
 */
export function watchWeekTargets(
  onReach: (week: WeekTargetReached) => void,
): () => void {
  let previous = localStore.snapshot();
  return localStore.subscribe(({ local }) => {
    const before = previous;
    const after = localStore.snapshot();
    // Set first: marking the week below writes again and calls back here.
    previous = after;
    if (!local) return;
    const week = findWeekReachingTarget({
      before,
      after,
      touchedWeeks: listTouchedWeeks(before, after),
    });
    if (!week) return;
    localStore.markCommitPrompted(week.weekOf);
    onReach(week);
  });
}
