import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import { Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  RiAddLine as Plus,
  RiArrowGoBackLine as ReturnIcon,
  RiPlayLine as Play,
} from "@remixicon/react";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SidebarProvider } from "@/components/ui/sidebar";
import { showErrorToast } from "@/components/ui/toast";
import {
  AppNavigationSidebar,
  isAppNavigationItemActive,
} from "@/features/layout/app-navigation-sidebar";
import { AppMenuBar } from "@/features/layout/app-menu-bar";
import { CommandPalette } from "@/features/command-palette/command-palette";
import { ShortcutOverlay } from "@/features/layout/shortcut-overlay";
import { useGlobalShortcuts } from "@/features/layout/use-global-shortcuts";
import {
  NarrowBackBar,
  NarrowSectionSwitcher,
  NarrowSettingsButton,
} from "@/features/layout/narrow-titlebar";
import { TimeEntryEditorPopover } from "@/features/time/time-entry-editor-popover";
import { TimeEntryModal } from "@/features/timer/time-entry-modal";
import { formatClockDuration } from "@/domain/time/duration";
import { getLocalProjectDisplayName } from "@/domain/local-state";
import { getConnectorsOverview, syncConnectorConnection } from "@/lib/app-api";
import { localStore } from "@/lib/local-store";
import {
  getTimerContributionMs,
  getTimerDurationsMs,
} from "@/lib/timer-totals";
import { useAppSidebar } from "@/lib/app-sidebar";
import { useShortcut } from "@/lib/shortcut-handlers";
import { useIsNarrowView } from "@/lib/use-narrow-view";
import { isDesktopShell } from "@/lib/runtime";
import { cn, getIsoWeekDates, todayIsoDate } from "@/lib/utils";
import {
  useLocalProjects,
  useLocalState,
  useUserPreferences,
} from "@/lib/local-hooks";
import { useApplyTheme } from "@/lib/use-theme";

const isWindowsDesktopShell =
  isDesktopShell &&
  typeof window !== "undefined" &&
  window.ajourDesktop?.runtime?.platform === "win32";

const isMacDesktopShell =
  isDesktopShell &&
  typeof window !== "undefined" &&
  window.ajourDesktop?.runtime?.platform === "darwin";

const AUTO_SYNC_POLL_INTERVAL_MS = 30_000;

function dateAtNoon(localDate: string) {
  return new Date(`${localDate}T12:00:00`);
}

function formatTitlebarDate(localDate: string) {
  return new Intl.DateTimeFormat("en-CA", {
    month: "short",
    day: "numeric",
  }).format(dateAtNoon(localDate));
}

function formatCalendarIsoDate(date: Date) {
  return new Intl.DateTimeFormat("en-CA").format(date);
}

function getTimeRouteDate(pathname: string) {
  const match = pathname.match(/^\/(?:time|review)\/([^/?#]+)/);
  if (!match) {
    return null;
  }

  return match[1] === "today" ? todayIsoDate() : match[1];
}

function CompactTimeDatePicker({
  date,
  onSelectDate,
}: {
  date: string;
  onSelectDate: (date: string) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);

  function selectDate(nextDate: string) {
    setIsOpen(false);
    if (nextDate !== date) {
      onSelectDate(nextDate);
    }
  }

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger
        className="ajour-titlebar-date-trigger desktop-no-drag"
        aria-label={`Select time entry date. Current date ${formatTitlebarDate(date)}`}
      >
        {formatTitlebarDate(date)}
      </PopoverTrigger>
      <PopoverContent
        className="ajour-titlebar-date-popover"
        align="start"
        sideOffset={8}
      >
        <Calendar
          mode="single"
          selected={dateAtNoon(date)}
          onSelect={(selectedDate) => {
            if (selectedDate) {
              selectDate(formatCalendarIsoDate(selectedDate));
            }
          }}
          captionLayout="label"
          buttonVariant="ghost"
          className="ajour-titlebar-calendar"
        />
      </PopoverContent>
    </Popover>
  );
}

/**
 * Syncs connections with automatic sync on when they are due. A failure shows
 * one error toast. A due connection retries on every poll, so the same failure
 * again shows nothing new until the connection syncs or fails differently.
 */
function ConnectorAutoSyncScheduler() {
  const loopStateRef = useRef({
    cancelled: false,
    running: false,
    timeoutId: undefined as number | undefined,
    /** The last failure shown per connection, by `pluginId:connectionId`. */
    shownFailures: new Map<string, string>(),
  });

  useEffect(() => {
    const loopState = loopStateRef.current;
    loopState.cancelled = false;

    const scheduleNext = (delayMs = AUTO_SYNC_POLL_INTERVAL_MS) => {
      if (loopState.cancelled) {
        return;
      }

      loopState.timeoutId = window.setTimeout(() => {
        void tick();
      }, delayMs);
    };

    const tick = async () => {
      if (loopState.cancelled || loopState.running) {
        scheduleNext();
        return;
      }

      loopState.running = true;
      try {
        const overview = await getConnectorsOverview();
        const now = Date.now();
        const dueConnections = overview.connectionGroups.flatMap((group) =>
          !group.enabled
            ? []
            : group.connections
                .filter((connection) => {
                  if (!connection.autoSync) {
                    return false;
                  }

                  if (!connection.lastSyncAt) {
                    return true;
                  }

                  return (
                    now - connection.lastSyncAt >=
                    connection.autoSyncIntervalMinutes * 60_000
                  );
                })
                .map((connection) => ({
                  pluginId: group.plugin.id,
                  connection,
                })),
        );

        for (const dueConnection of dueConnections) {
          if (loopState.cancelled) {
            break;
          }

          const failureKey = `${dueConnection.pluginId}:${dueConnection.connection.id}`;
          try {
            await syncConnectorConnection(
              dueConnection.pluginId,
              dueConnection.connection.id,
              { trigger: "auto" },
            );
            loopState.shownFailures.delete(failureKey);
          } catch (error) {
            console.error(
              `Connector auto sync failed for "${dueConnection.pluginId}".`,
              error,
            );
            const message =
              error instanceof Error ? error.message : "Unknown error";
            if (loopState.shownFailures.get(failureKey) !== message) {
              loopState.shownFailures.set(failureKey, message);
              showErrorToast({
                title: `${dueConnection.connection.label} sync failed`,
                description: message,
              });
            }
          }
        }
      } catch (error) {
        console.error("Connector auto sync failed.", error);
      } finally {
        loopState.running = false;
        scheduleNext();
      }
    };

    void tick();

    return () => {
      loopState.cancelled = true;
      if (loopState.timeoutId !== undefined) {
        window.clearTimeout(loopState.timeoutId);
      }
    };
  }, []);

  return null;
}

function DayTotalsPopup({
  anchorRef,
  dayTotalMs,
  weekTotalMs,
  onClose,
}: {
  anchorRef: RefObject<HTMLDivElement | null>;
  dayTotalMs: number;
  weekTotalMs: number;
  onClose: () => void;
}) {
  const popupRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleMouseDown(event: MouseEvent) {
      const target = event.target as Node;
      if (
        anchorRef.current?.contains(target) ||
        popupRef.current?.contains(target)
      ) {
        return;
      }

      if (popupRef.current) {
        onClose();
      }
    }

    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [anchorRef, onClose]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div
      ref={popupRef}
      className="day-totals-popup"
      role="dialog"
      aria-label="Current time totals"
    >
      <div className="day-totals-popup-row">
        <span className="day-totals-popup-label">Week total</span>
        <span className="day-totals-popup-value">
          {formatClockDuration(weekTotalMs)}
        </span>
      </div>
      <div className="day-totals-popup-row">
        <span className="day-totals-popup-label">Day total</span>
        <span className="day-totals-popup-value">
          {formatClockDuration(dayTotalMs)}
        </span>
      </div>
    </div>
  );
}

/* ── Global Timer Bar ──────────────────────────────────────────────── */

/** Which entry editor the titlebar has open: the "+" new entry, or the running entry. */
type TitlebarEditor = "new" | "running" | null;

/**
 * The titlebar's New entry (+), Start (▶), Running pill and totals pill. "+" and the
 * pill open the entry editor in a popover anchored to them, or in the dialog in the
 * narrow view. New entries default to today; the Start button starts one at once.
 */
function GlobalTimerBar() {
  const state = useLocalState();
  const projects = useLocalProjects();
  const isNarrowView = useIsNarrowView();
  const [now, setNow] = useState(() => Date.now());
  const [editor, setEditor] = useState<TitlebarEditor>(null);
  const [dayTotalsOpen, setDayTotalsOpen] = useState(false);
  const dayTotalsAnchorRef = useRef<HTMLDivElement>(null);

  const currentTimer = state.timers[0] ?? null;
  const today = todayIsoDate();
  const weekDates = useMemo(() => getIsoWeekDates(today), [today]);
  const newEntryTarget = useMemo(
    () => ({ kind: "create" as const, localDate: today }),
    [today],
  );

  // N off the Time pages. The Time page's own N opens its side panel instead.
  useShortcut("entry.new", () => setEditor("new"), "app");

  // Stop or Discard from another surface closes the running entry's editor.
  useEffect(() => {
    if (!currentTimer) {
      setEditor((current) => (current === "running" ? null : current));
    }
  }, [currentTimer]);

  useEffect(() => {
    if (!currentTimer) {
      return;
    }

    setNow(Date.now());
    const intervalId = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(intervalId);
  }, [currentTimer]);

  const { runningDurationMs } = getTimerDurationsMs(currentTimer, now);
  const timerContributionMs = getTimerContributionMs({
    timer: currentTimer,
    timesheetEntries: state.timesheetEntries,
    runningDurationMs,
  });

  const todayTotalMs = useMemo(() => {
    let total = state.timesheetEntries
      .filter((entry) => entry.localDate === today)
      .reduce((sum, entry) => sum + entry.durationMs, 0);

    if (currentTimer && currentTimer.localDate === today) {
      total += timerContributionMs;
    }

    return total;
  }, [state.timesheetEntries, today, currentTimer, timerContributionMs]);

  const weekTotalMs = useMemo(() => {
    const weekDateSet = new Set(weekDates);
    let total = state.timesheetEntries
      .filter((entry) => weekDateSet.has(entry.localDate))
      .reduce((sum, entry) => sum + entry.durationMs, 0);

    if (currentTimer && weekDateSet.has(currentTimer.localDate)) {
      total += timerContributionMs;
    }

    return total;
  }, [currentTimer, state.timesheetEntries, timerContributionMs, weekDates]);

  const timerProject = currentTimer
    ? projects.find((p) => p._id === currentTimer.projectId)
    : null;
  const timerTask = timerProject?.tasks.find(
    (t) => t._id === currentTimer?.taskId,
  );
  const timerProjectLabel = timerProject
    ? timerProject.code?.trim() || getLocalProjectDisplayName(timerProject)
    : undefined;
  const timerMeta = [timerProjectLabel, timerTask?.name]
    .filter(Boolean)
    .join(" · ");

  /** Starts an empty running entry today, then opens it so the user can fill it in. */
  function handleStartClick() {
    localStore.startTimer({});
    setEditor("running");
  }

  function handleDayTotalsClick() {
    setDayTotalsOpen((prev) => !prev);
  }

  const handleEditorClose = useCallback(() => {
    setEditor(null);
  }, []);

  const handleDayTotalsClose = useCallback(() => {
    setDayTotalsOpen(false);
  }, []);

  const runningPillContent = (
    <>
      <span className="status-dot status-dot-pulse" />
      <span className="stat-pill-label">Running</span>
      <span className="stat-pill-value">
        {formatClockDuration(runningDurationMs)}
      </span>
    </>
  );
  const runningPillClassName =
    "stat-pill stat-pill-active stat-pill-active-clickable";

  return (
    <div className="global-timer">
      <div
        className={cn(
          "quick-timer-button-group",
          isDesktopShell && "desktop-no-drag",
        )}
      >
        {isNarrowView ? (
          <button
            type="button"
            className="quick-timer-group-button"
            onClick={() => setEditor("new")}
            title="Create time entry"
            aria-label="Create time entry"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        ) : (
          <TimeEntryEditorPopover
            target={newEntryTarget}
            open={editor === "new"}
            onOpenChange={(open) => setEditor(open ? "new" : null)}
            triggerLabel="Create time entry"
            triggerClassName="quick-timer-group-button"
          >
            <Plus className="h-3.5 w-3.5" />
          </TimeEntryEditorPopover>
        )}
        {currentTimer ? null : (
          <button
            type="button"
            className="quick-timer-group-button quick-timer-group-button-play"
            onClick={handleStartClick}
            title="Start"
            aria-label="Start"
          >
            <Play className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      {currentTimer ? (
        <div
          className={cn(
            "quick-timer-popup-anchor",
            isDesktopShell && "desktop-no-drag",
          )}
        >
          {timerMeta ? (
            <span className="global-timer-meta">{timerMeta}</span>
          ) : null}
          {isNarrowView ? (
            <button
              type="button"
              className={runningPillClassName}
              onClick={() => setEditor("running")}
              title="Edit the running entry"
              aria-label="Edit the running entry"
            >
              {runningPillContent}
            </button>
          ) : (
            <TimeEntryEditorPopover
              target={{ kind: "running", timer: currentTimer }}
              open={editor === "running"}
              onOpenChange={(open) => setEditor(open ? "running" : null)}
              triggerLabel="Edit the running entry"
              triggerClassName={runningPillClassName}
            >
              {runningPillContent}
            </TimeEntryEditorPopover>
          )}
        </div>
      ) : null}
      <div
        ref={dayTotalsAnchorRef}
        className={cn(
          "day-totals-popup-anchor",
          isDesktopShell && "desktop-no-drag",
        )}
      >
        <button
          type="button"
          className="stat-pill global-timer-today stat-pill-clickable"
          onClick={handleDayTotalsClick}
          aria-label="Show day and week totals"
          aria-expanded={dayTotalsOpen}
        >
          <span className="stat-pill-label">Today</span>
          <span className="stat-pill-value">
            {formatClockDuration(todayTotalMs)}
          </span>
        </button>

        {dayTotalsOpen ? (
          <DayTotalsPopup
            anchorRef={dayTotalsAnchorRef}
            dayTotalMs={todayTotalMs}
            weekTotalMs={weekTotalMs}
            onClose={handleDayTotalsClose}
          />
        ) : null}
      </div>
      {isNarrowView && editor !== null ? (
        <TimeEntryModal
          date={today}
          timerId={editor === "running" ? (currentTimer?._id ?? "") : undefined}
          onClose={handleEditorClose}
        />
      ) : null}
    </div>
  );
}

/* ── App Shell ─────────────────────────────────────────────────────── */

export function AppShell() {
  const { updateTrack } = useUserPreferences();
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  const navigate = useNavigate();
  const isTimeActive = isAppNavigationItemActive(pathname, "/time/$date");
  const isSettingsActive = isAppNavigationItemActive(pathname, "/settings");
  const timeRouteDate = getTimeRouteDate(pathname);
  const [selectedTimeDate, setSelectedTimeDate] = useState(
    () => timeRouteDate ?? todayIsoDate(),
  );
  const appSidebar = useAppSidebar();
  const isNarrowView = useIsNarrowView();
  useGlobalShortcuts(selectedTimeDate);

  useApplyTheme();

  useEffect(() => {
    void window.ajourDesktop
      ?.configureAutomaticUpdates?.(updateTrack)
      .catch((error) =>
        console.error("Unable to configure automatic updates.", error),
      );
  }, [updateTrack]);

  useEffect(() => {
    if (timeRouteDate) {
      setSelectedTimeDate(timeRouteDate);
    }
  }, [timeRouteDate]);

  return (
    <div
      className={cn(
        "flex h-dvh min-h-0 flex-col bg-background",
        isDesktopShell && "desktop-shell-app",
        isWindowsDesktopShell && "desktop-shell-windows",
        isMacDesktopShell && "desktop-shell-macos",
      )}
    >
      <ConnectorAutoSyncScheduler />
      <ShortcutOverlay />
      <CommandPalette />
      {/* useAppSidebar owns the state, persistence and Cmd/Ctrl+B, so the
          provider is controlled and its own shortcut stays off. */}
      <SidebarProvider
        className="ajour-app-body"
        data-app-sidebar={appSidebar.state}
        open={appSidebar.state === "expanded"}
        keyboardShortcut={false}
      >
        {/* The narrow view has no rail and no sidebars. Its titlebar holds
            the navigation instead. */}
        {isNarrowView ? null : (
          <AppNavigationSidebar
            pathname={pathname}
            selectedTimeDate={selectedTimeDate}
            state={appSidebar.state}
            isRailForced={appSidebar.isRailForced}
            onToggle={appSidebar.toggle}
          />
        )}

        <div className="ajour-app-workspace">
          {/* Workspace titlebar. The sidebar owns the window's left chrome, except
              in the narrow view where the titlebar spans the window. */}
          <nav
            className={cn(
              "ajour-nav",
              isDesktopShell && "desktop-shell-nav desktop-drag-region",
            )}
          >
            <div
              className={cn(
                "ajour-nav-inner",
                isDesktopShell && "desktop-shell-nav-inner",
              )}
            >
              <div
                className={cn(
                  "ajour-nav-main",
                  isDesktopShell && "desktop-shell-nav-main",
                )}
              >
                <AppMenuBar />
                {isNarrowView ? (
                  <NarrowSectionSwitcher
                    pathname={pathname}
                    selectedTimeDate={selectedTimeDate}
                  />
                ) : null}
                <CompactTimeDatePicker
                  date={selectedTimeDate}
                  onSelectDate={(nextDate) => {
                    setSelectedTimeDate(nextDate);
                    if (isTimeActive) {
                      void navigate({
                        to: "/time/$date",
                        params: { date: nextDate },
                      });
                    }
                  }}
                />
                {selectedTimeDate !== todayIsoDate() ? (
                  <button
                    type="button"
                    className={cn(
                      "ajour-nav-return-today",
                      isDesktopShell && "desktop-no-drag",
                    )}
                    onClick={() => {
                      const today = todayIsoDate();
                      setSelectedTimeDate(today);
                      if (isTimeActive) {
                        void navigate({
                          to: "/time/$date",
                          params: { date: today },
                        });
                      }
                    }}
                    aria-label="Return to today"
                  >
                    <ReturnIcon className="h-2.5 w-2.5" />
                  </button>
                ) : null}
              </div>

              <GlobalTimerBar />
              {isNarrowView ? (
                <NarrowSettingsButton pathname={pathname} />
              ) : null}
            </div>
          </nav>

          {isNarrowView ? <NarrowBackBar pathname={pathname} /> : null}

          {/* Page content */}
          <main className="app-content-shell flex-1">
            <ScrollArea className="app-content-scroll-area">
              {isSettingsActive ? (
                <Outlet />
              ) : (
                <div
                  className={cn(
                    "page-container",
                    isDesktopShell && "desktop-page-container",
                  )}
                >
                  <Outlet />
                </div>
              )}
            </ScrollArea>
          </main>
        </div>
      </SidebarProvider>
    </div>
  );
}
