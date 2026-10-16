import { RiSendPlaneLine as Send } from "@remixicon/react";
import { Button } from "@/components/ui/button";

/** Opens the selected week's Commit page from the titlebar totals popover. */
export function CommitWeekButton({ onClick }: { onClick: () => void }) {
  return (
    <Button variant="outline" onClick={onClick}>
      <Send data-icon="inline-start" />
      Commit week
    </Button>
  );
}
