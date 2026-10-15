import { useMemo } from "react";
import {
  RiCheckLine as Check,
  RiSendPlaneLine as Send,
} from "@remixicon/react";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { listWeekChanges } from "@/domain/time/timesheet-commit";
import { useLocalState } from "@/lib/local-hooks";

/** Opens the selected week's Commit page from the titlebar totals popover. */
export function CommitWeekButton({ onClick }: { onClick: () => void }) {
  return (
    <Button variant="outline" onClick={onClick}>
      <Send data-icon="inline-start" />
      Commit week
    </Button>
  );
}

/** Shows "Committed" once a week with entries has no change left to commit. */
export function WeekCommittedBadge({ weekDates }: { weekDates: string[] }) {
  const state = useLocalState();
  const isCommitted = useMemo(() => {
    const weekDateSet = new Set(weekDates);
    return (
      state.timesheetEntries.some((entry) =>
        weekDateSet.has(entry.localDate),
      ) &&
      listWeekChanges({
        entries: state.timesheetEntries,
        tombstones: state.timesheetTombstones,
        weekDates,
      }).length === 0
    );
  }, [state.timesheetEntries, state.timesheetTombstones, weekDates]);

  if (!isCommitted) {
    return null;
  }

  return (
    <Chip tone="success">
      <Check />
      Committed
    </Chip>
  );
}
