import { RiCloseLine as Close } from "@remixicon/react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { TimerDock } from "@/features/layout/timer-dock";
import {
  SettingsLink,
  useCloseSettings,
} from "@/features/settings/settings-link";
import type { SettingsLocation } from "@/features/settings/settings-location";
import { getSettingsGroups } from "@/features/settings/settings-navigation";
import { SettingsWindowPage } from "@/features/settings/settings-pages";
import { useCalendarSources } from "@/lib/calendar-suggestions";
import { useCodeHostConnections } from "@/lib/code-host-connections";

/** The settings page a navigation entry opens: its route without `/settings/`. */
function pageOf(to: string) {
  return to.replace(/^\/settings\/?/, "");
}

/** True when `page`, or a page under it such as a plugin's, is open. */
function isOpen(page: string, entry: string) {
  return page === entry || page.startsWith(`${entry}/`);
}

/**
 * Settings in wide windows: a window over the page, as in T3 Code. The page
 * behind stays where it was, blurred and dimmed, and Esc or Close returns to
 * it with nothing moved. The window has the settings pages in a column at
 * the left, under their App, Work and Data groups, with the timer card at
 * its foot, and the open page at the right under a "Settings / Page" header.
 * Which page is open lives in the page's `settings` search, so the browser
 * shows `/settings/...` meanwhile and Back closes the window.
 */
export function SettingsWindow({ location }: { location: SettingsLocation }) {
  const close = useCloseSettings();
  const { groups: codeHosts } = useCodeHostConnections();
  const calendars = useCalendarSources();
  const groups = getSettingsGroups(
    "wide",
    codeHosts.length > 0,
    calendars.length > 0,
  );
  const openEntry = groups
    .flatMap((group) => group.pages)
    .find((entry) => isOpen(location.page, pageOf(entry.to)));

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) void close();
      }}
    >
      <DialogContent
        className="settings-window"
        overlayClassName="settings-window-backdrop"
        showCloseButton={false}
        aria-label="Settings"
      >
        <nav className="settings-window-nav" aria-label="Settings sections">
          <div className="settings-window-nav-groups">
            {groups.map((group) => (
              <div key={group.label} className="settings-window-nav-group">
                <div className="settings-window-nav-label">{group.label}</div>
                {group.pages.map((entry) => {
                  const Icon = entry.icon;
                  const page = pageOf(entry.to);
                  const active = isOpen(location.page, page);
                  return (
                    <SettingsLink
                      key={entry.to}
                      page={page}
                      // Switching pages replaces the history entry, so
                      // Back leaves Settings in one step.
                      replace
                      className="settings-window-nav-link"
                      data-active={active || undefined}
                      aria-current={active ? "page" : undefined}
                    >
                      <Icon aria-hidden />
                      <span>{entry.label}</span>
                    </SettingsLink>
                  );
                })}
              </div>
            ))}
          </div>
          {/* The app sidebar's timer card, so Settings shows the one form of
              the timer beside a sidebar (council round 25). */}
          <div className="settings-window-nav-foot">
            <TimerDock />
          </div>
        </nav>
        <div className="settings-window-body">
          <header className="settings-window-header">
            <span className="settings-window-crumb">Settings</span>
            <span className="settings-window-crumb-separator" aria-hidden>
              /
            </span>
            {/* The page's name heads it; the page restates it nowhere
                (forms council round 3). */}
            <DialogTitle render={<h1 />} className="settings-window-title">
              {openEntry?.label ?? "Settings"}
            </DialogTitle>
            <DialogClose
              render={
                <Button
                  variant="ghost"
                  size="icon"
                  className="settings-window-close"
                  aria-label="Close settings"
                />
              }
            >
              <Close />
            </DialogClose>
          </header>
          <ScrollArea className="settings-window-scroll">
            <div className="settings-content">
              <SettingsWindowPage location={location} />
            </div>
          </ScrollArea>
        </div>
      </DialogContent>
    </Dialog>
  );
}
