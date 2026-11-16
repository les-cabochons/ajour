import { memo } from "react";
import {
  RiArrowUpCircleFill as UpdateReady,
  RiSettings3Line as Settings,
  RiSparkling2Line as Sparkle,
} from "@remixicon/react";
import { TooltipButton } from "@/components/tooltip-button";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLinkItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { releaseLabel } from "@/domain/release-notes";
import { SettingsLink } from "@/features/settings/settings-link";
import type { DesktopUpdateState } from "@/lib/desktop-bridge";
import { applyDesktopUpdate, useDesktopUpdates } from "@/lib/desktop-updates";
import { isDesktopShell } from "@/lib/runtime";
import {
  formatShortcutKeys,
  getShortcut,
  getShortcutPlatform,
} from "@/lib/shortcuts";
import { cn } from "@/lib/utils";

const platform = getShortcutPlatform();

/**
 * The end of the sidebar header, beside the logo: Settings. Commit week
 * lives in the Day and Week headers, and the version and the desktop update
 * button at the end of the Settings window's left column. While an update
 * waits, the gear takes the accent and a dot, and opens a menu instead:
 * Update and restart, What's new, then Settings.
 */
export const SidebarHeaderActions = memo(function SidebarHeaderActions() {
  const update = useDesktopUpdates();
  const waiting =
    update.status === "available" && update.result?.updateAvailable
      ? update.result.latestVersion
      : null;
  return (
    <div
      data-sidebar-actions=""
      className={cn(
        "ml-auto flex shrink-0 items-center",
        isDesktopShell && "desktop-no-drag",
      )}
    >
      {waiting ? (
        <UpdateMenu update={update} version={waiting} />
      ) : (
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
      )}
    </div>
  );
});

function UpdateMenu({
  update,
  version,
}: {
  update: DesktopUpdateState;
  version: string;
}) {
  const label = releaseLabel(version);
  return (
    <DropdownMenu>
      <TooltipButton
        label={`Settings, ${label} is ready`}
        render={
          <DropdownMenuTrigger
            data-update-ready=""
            render={
              <Button
                variant="ghost"
                size="icon"
                className="relative text-primary"
              />
            }
          />
        }
      >
        <Settings />
        <span
          aria-hidden
          className="absolute top-1 right-1 size-1.5 rounded-full bg-primary ring-2 ring-sidebar"
        />
      </TooltipButton>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuItem onClick={() => void applyDesktopUpdate(update)}>
          <UpdateReady className="text-primary" />
          <span className="whitespace-nowrap">
            {update.canInstall ? "Restart to update" : "View release"}
          </span>
          <DropdownMenuShortcut className="tracking-normal">
            {label}
          </DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuLinkItem render={<SettingsLink page="whats-new" />}>
          <Sparkle />
          What's new
        </DropdownMenuLinkItem>
        <DropdownMenuSeparator />
        <DropdownMenuLinkItem render={<SettingsLink page="general" />}>
          <Settings />
          Settings
          <DropdownMenuShortcut>
            {formatShortcutKeys(getShortcut("app.settings"), platform).join(
              " ",
            )}
          </DropdownMenuShortcut>
        </DropdownMenuLinkItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
