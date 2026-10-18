import { RiCalendarCheckLine as CommitIcon } from "@remixicon/react";
import { Button } from "@/components/ui/button";

/** Opens the selected week's Commit page from the titlebar totals popover. */
export function CommitWeekButton({ onClick }: { onClick: () => void }) {
  return (
    <Button variant="outline" className="w-full" onClick={onClick}>
      <CommitIcon data-icon="inline-start" />
      Commit
    </Button>
  );
}
