import {
  RiArrowUpCircleLine as UpdateAvailable,
  RiRefreshLine as CheckUpdates,
  RiLoader4Line as Loading,
  RiErrorWarningLine as Warning,
} from "@remixicon/react";
import { TooltipButton } from "@/components/tooltip-button";
import { Button } from "@/components/ui/button";
import { SettingsLink } from "@/features/settings/settings-link";
import { useUserPreferences } from "@/lib/local-hooks";
import {
  applyDesktopUpdate,
  checkDesktopUpdates,
  desktopUpdateLabel,
  isDesktopUpdateBusy,
  useDesktopUpdates,
} from "@/lib/desktop-updates";
import { cn } from "@/lib/utils";

/**
 * The desktop app's update button: a sync icon that checks for updates, an
 * up arrow once one is ready to install, a spinner while busy and a warning
 * after a failed check. Its tooltip and a live status say which.
 */
function AppUpdateButton() {
  const state = useDesktopUpdates();
  const { updateTrack } = useUserPreferences();
  const busy = isDesktopUpdateBusy(state);
  const label = desktopUpdateLabel(state);
  const Icon = busy
    ? Loading
    : state.status === "error"
      ? Warning
      : state.status === "available"
        ? UpdateAvailable
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
            data-app-update=""
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

/**
 * The end of the Settings window's left column: the installed version, then
 * the desktop app's update button. The version opens What's new, quietly: it
 * reads as plain text until hovered. The browser build knows no version and
 * has no update button, so it shows nothing.
 */
export function AppVersionFoot() {
  const version = window.ajourDesktop?.runtime?.version;
  const canUpdate = Boolean(window.ajourDesktop?.checkForUpdates);
  if (!version && !canUpdate) return null;
  return (
    <div
      data-app-version=""
      className="flex h-9 items-center justify-between gap-2 border-t pr-1 pl-2.5 text-xs text-muted-foreground"
    >
      {version ? (
        <SettingsLink
          page="whats-new"
          aria-label={`What's new in Ajour ${version}`}
          className="min-w-0 truncate rounded-sm underline-offset-2 hover:text-foreground hover:underline focus-visible:text-foreground"
        >
          Ajour <span className="font-mono tabular-nums">{version}</span>
        </SettingsLink>
      ) : (
        <span className="min-w-0 truncate">Ajour</span>
      )}
      {canUpdate ? <AppUpdateButton /> : null}
    </div>
  );
}
