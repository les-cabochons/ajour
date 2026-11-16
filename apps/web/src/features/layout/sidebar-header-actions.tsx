import { memo } from "react";
import { RiSettings3Line as Settings } from "@remixicon/react";
import { TooltipButton } from "@/components/tooltip-button";
import { buttonVariants } from "@/components/ui/button";
import { SettingsLink } from "@/features/settings/settings-link";
import { isDesktopShell } from "@/lib/runtime";
import { cn } from "@/lib/utils";

/**
 * The end of the sidebar header, beside the logo: Settings. Commit week
 * lives in the Day and Week headers, and the version and the desktop update
 * button at the end of the Settings window's left column.
 */
export const SidebarHeaderActions = memo(function SidebarHeaderActions() {
  return (
    <div
      data-sidebar-actions=""
      className={cn(
        "ml-auto flex shrink-0 items-center",
        isDesktopShell && "desktop-no-drag",
      )}
    >
      <TooltipButton
        label="Settings"
        shortcut="app.settings"
        render={
          <SettingsLink
            page="general"
            className={cn(
              buttonVariants({ variant: "ghost", size: "icon" }),
              "text-muted-foreground",
            )}
          />
        }
      >
        <Settings />
      </TooltipButton>
    </div>
  );
});
