import { useMemo } from "react";
import {
  RiCheckLine as Check,
  RiSendPlaneLine as Send,
} from "@remixicon/react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getSubmitWeekStatus } from "@/domain/time/timesheet-submission";
import { useLocalState } from "@/lib/local-hooks";

/** The one "Submit week" button of the Day and Week headers. */
export function SubmitWeekButton({ onClick }: { onClick: () => void }) {
  return (
    <Button variant="outline" size="sm" onClick={onClick}>
      <Send data-icon="inline-start" />
      Submit week
    </Button>
  );
}

/** Shows "Submitted" once every entry of the week is marked as submitted. */
export function WeekSubmittedBadge({ weekDates }: { weekDates: string[] }) {
  const state = useLocalState();
  const isSubmitted = useMemo(() => {
    const weekDateSet = new Set(weekDates);
    const weekEntries = state.timesheetEntries.filter((entry) =>
      weekDateSet.has(entry.localDate),
    );
    return getSubmitWeekStatus(weekEntries).kind === "submitted";
  }, [state.timesheetEntries, weekDates]);

  if (!isSubmitted) {
    return null;
  }

  return (
    <Badge variant="outline" className="text-[var(--success)]">
      <Check data-icon="inline-start" />
      Submitted
    </Badge>
  );
}
