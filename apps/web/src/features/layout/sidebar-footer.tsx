import { memo } from "react";
import { Link } from "@tanstack/react-router";
import {
  RiSettings3Line as Settings,
  RiArrowUpCircleLine as CheckUpdates,
  RiLoader4Line as Loading,
  RiErrorWarningLine as Warning,
} from "@remixicon/react";
import { TooltipButton } from "@/components/tooltip-button";
import { Button, buttonVariants } from "@/components/ui/button";
import { SidebarFooter } from "@/components/ui/sidebar";
import { CommitWeekButton } from "@/features/time/commit-week-button";
import { useUserPreferences } from "@/lib/local-hooks";
import {
  applyDesktopUpdate,
  checkDesktopUpdates,
  desktopUpdateLabel,
  isDesktopUpdateBusy,
  useDesktopUpdates,
} from "@/lib/desktop-updates";
import { cn } from "@/lib/utils";

function SidebarUpdateButton() {
  const state = useDesktopUpdates();
  const { updateTrack } = useUserPreferences();
  const busy = isDesktopUpdateBusy(state);
  const label = desktopUpdateLabel(state);
  const Icon = busy
    ? Loading
    : state.status === "error"
      ? Warning
      : CheckUpdates;
  return (
    <>
      <TooltipButton
        label={label}
        side="top"
        render={
          <Button
            variant="ghost"
            size="icon"
            aria-disabled={busy}
            className={cn(
              "text-muted-foreground",
              state.status === "available" && "text-foreground",
              state.status === "error" && "text-destructive",
              busy && "opacity-50",
            )}
            onClick={() => {
              if (busy) return;
              void (state.status === "available"
                ? applyDesktopUpdate(state)
                : checkDesktopUpdates(updateTrack));
            }}
          />
        }
      >
        <Icon
          className={cn(busy && "animate-spin motion-reduce:animate-none")}
        />
      </TooltipButton>
      <span className="sr-only" role="status">
        {label}
      </span>
    </>
  );
}

export const AppSidebarFooter = memo(function AppSidebarFooter({
  selectedTimeDate,
}: {
  selectedTimeDate: string;
}) {
  return (
    <SidebarFooter className="flex-row items-center justify-between gap-2">
      <div className="flex items-center gap-0.5">
        <TooltipButton
          label="Settings"
          shortcut="app.settings"
          side="top"
          render={
            <Link
              to="/settings/general"
              className={cn(
                buttonVariants({ variant: "ghost", size: "icon" }),
                "text-muted-foreground",
              )}
            />
          }
        >
          <Settings />
        </TooltipButton>
        <CommitWeekButton selectedTimeDate={selectedTimeDate} side="top" />
      </div>
      {window.ajourDesktop?.checkForUpdates ? <SidebarUpdateButton /> : null}
    </SidebarFooter>
  );
});
