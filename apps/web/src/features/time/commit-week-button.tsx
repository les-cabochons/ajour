import type { ComponentProps } from "react";
import { RiCalendarCheckLine as CommitIcon } from "@remixicon/react";
import { TooltipButton } from "@/components/tooltip-button";
import { Button } from "@/components/ui/button";
import { useOpenCommitPage } from "@/features/time/use-open-commit-page";
import { cn } from "@/lib/utils";

/**
 * Commit week as an icon-only button with the "Commit" tooltip. It opens the
 * Commit page for the week on screen (`useOpenCommitPage`). The sidebar foot
 * shows it, and the top bar while the sidebar foot is not on screen.
 */
export function CommitWeekButton({
  selectedTimeDate,
  side,
  className,
}: {
  selectedTimeDate: string;
  side?: ComponentProps<typeof TooltipButton>["side"];
  className?: string;
}) {
  const openCommitPage = useOpenCommitPage(selectedTimeDate);
  return (
    <TooltipButton
      label="Commit"
      aria-label="Commit week"
      side={side}
      render={
        <Button
          variant="ghost"
          size="icon"
          className={cn("ajour-app-sidebar-toggle", className)}
          onClick={() => openCommitPage()}
        />
      }
    >
      <CommitIcon />
    </TooltipButton>
  );
}
