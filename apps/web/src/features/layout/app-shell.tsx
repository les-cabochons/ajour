import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";
import { pluginHasConnector } from "@ajour/shared";
import { Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  RiAddLine as Plus,
  RiArrowGoBackLine as ReturnIcon,
  RiPlayLine as Play,
} from "@remixicon/react";
import { TooltipButton } from "@/components/tooltip-button";
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
import type { NewTimeEntryValues } from "@/features/time/time-entry-editor-form";
import {
  useNewEntryRequests,
  type NewEntryRequest,
} from "@/features/time/new-entry-request";
import { TimeEntryModal } from "@/features/timer/time-entry-modal";
import { SubmitWeekButton } from "@/features/time/submit-week-controls";
import { formatClockDuration } from "@/domain/time/duration";
import { getLocalProjectDisplayName } from "@/domain/local-state";
import { findPinnedTask } from "@/domain/projects/project-transitions";
import { getConnectorsOverview, syncConnectorConnection } from "@/lib/app-api";
import { localStore } from "@/lib/local-store";
import {
  getTimerContributionMs,
  getTimerDurationsMs,
} from "@/lib/timer-totals";
import { useAppSidebar } from "@/lib/app-sidebar";
import { resolveSidebarWidth, useSidebarLayout } from "@/lib/sidebar-layout";
import { sendPendingSourceWrites } from "@/features/backlog/backlog-source-writes";
import { SettleDialogHost } from "@/features/backlog/settle-dialog";
import { SnoozePickerHost } from "@/features/backlog/snooze-picker";
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
/**
 * Sends the settle writes left from a session that quit during their Undo
 * window (ADR 0001). There is no offline queue beyond that: a write that fails
 * here puts its item back to active.
 */
function PendingSourceWritesFlush() {
  useEffect(() => {
    void sendPendingSourceWrites();
  }, []);
  return null;
}

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
          !group.enabled || !pluginHasConnector(group.plugin)
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

/**
 * The selected day's titlebar pill, with day and week totals and Submit week.
 */
function DayTotalsPill({
  date,
  dayTotalMs,
  weekTotalMs,
  onSubmit,
}: {
  date: string;
  dayTotalMs: number;
  weekTotalMs: number;
  onSubmit: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className={cn(
          "stat-pill global-timer-today stat-pill-clickable shrink-0",
          isDesktopShell && "desktop-no-drag",
        )}
        aria-label="Show day and week totals"
      >
        <span className="stat-pill-label">
          {date === todayIsoDate() ? "Today" : "Day"}
        </span>
        <span className="stat-pill-value">
          {formatClockDuration(dayTotalMs)}
        </span>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        className="w-auto min-w-38 gap-2 rounded-2xl px-3 py-2.5"
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
        <div className="mt-1 border-t border-border pt-2">
          <SubmitWeekButton
            onClick={() => {
              setOpen(false);
              onSubmit();
            }}
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}

/* ── Global Timer Bar ──────────────────────────────────────────────── */

/** Which entry editor the titlebar has open: the "+" new entry, or the running entry. */
type TitlebarEditor = "new" | "running" | null;

/**
 * New entry (+), Start (▶), Running pill and titlebar totals. Entry controls float
 * at the bottom right in the narrow view. "+" and the
 * pill open the entry editor in a popover anchored to them, or in the dialog in the
 * narrow view. New entry… on a task or backlog item (`openNewEntryEditor`) opens the
 * same popover, anchored to its row. New entries default to today; the Start button
 * starts one at once.
 */
function GlobalTimerBar({
  date,
  onSubmit,
}: {
  date: string;
  onSubmit: () => void;
}) {
  const state = useLocalState();
  const projects = useLocalProjects();
  const isNarrowView = useIsNarrowView();
  const [now, setNow] = useState(() => Date.now());
  const [editor, setEditor] = useState<TitlebarEditor>(null);
  /** The project and task a new entry starts with, such as a pinned task. */
  const [newEntryValues, setNewEntryValues] = useState<NewTimeEntryValues>();
  /** The task or backlog row New entry… came from. Null anchors the popover to "+". */
  const [newEntryAnchor, setNewEntryAnchor] = useState<HTMLElement | null>(
    null,
  );

  const currentTimer = state.timers[0] ?? null;
  const today = todayIsoDate();
  const weekDates = useMemo(() => getIsoWeekDates(date), [date]);
  const newEntryTarget = useMemo(
    () => ({
      kind: "create" as const,
      localDate: today,
      initialValues: newEntryValues,
    }),
    [today, newEntryValues],
  );

  const openNewEntry = useCallback(
    (values?: NewTimeEntryValues, anchor: HTMLElement | null = null) => {
      setNewEntryValues(values);
      setNewEntryAnchor(anchor);
      setEditor("new");
    },
    [],
  );

  // New entry… on a task or backlog item, from its page or the command palette.
  useNewEntryRequests(
    useCallback(
      ({ values, anchor }: NewEntryRequest) => openNewEntry(values, anchor),
      [openNewEntry],
    ),
  );

  // N and the pinned task digits off the Time pages. The Time page's own
  // handlers open its side panel instead.
  useShortcut("entry.new", () => openNewEntry(), "app");
  useShortcut(
    "pinned.new-entry",
    ({ digit }) => {
      const pinned = digit && findPinnedTask(projects, digit);
      if (pinned) {
        openNewEntry({
          projectId: pinned.project._id,
          taskId: pinned.task._id,
        });
      }
    },
    "app",
  );

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

  const dayTotalMs = useMemo(() => {
    let total = state.timesheetEntries
      .filter((entry) => entry.localDate === date)
      .reduce((sum, entry) => sum + entry.durationMs, 0);

    if (currentTimer && currentTimer.localDate === date) {
      total += timerContributionMs;
    }

    return total;
  }, [state.timesheetEntries, date, currentTimer, timerContributionMs]);

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

  const handleEditorClose = useCallback(() => {
    setEditor(null);
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

  const controls = (
    <div className="global-timer-controls">
      <div
        className={cn(
          "quick-timer-button-group",
          isDesktopShell && "desktop-no-drag",
        )}
      >
        {isNarrowView ? (
          <TooltipButton
            className="quick-timer-group-button"
            onClick={() => openNewEntry()}
            label="Create time entry"
            shortcut="entry.new"
            side="top"
          >
            <Plus className="h-3.5 w-3.5" />
          </TooltipButton>
        ) : (
          <TimeEntryEditorPopover
            target={newEntryTarget}
            open={editor === "new"}
            onOpenChange={(open) => (open ? openNewEntry() : setEditor(null))}
            triggerLabel="Create time entry"
            triggerClassName="quick-timer-group-button"
            iconTrigger
            triggerShortcut="entry.new"
            anchor={newEntryAnchor}
          >
            <Plus className="h-3.5 w-3.5" />
          </TimeEntryEditorPopover>
        )}
        {currentTimer ? null : (
          <TooltipButton
            className="quick-timer-group-button quick-timer-group-button-play"
            onClick={handleStartClick}
            label="Start"
            shortcut="entry.stop-or-start"
            side={isNarrowView ? "top" : "bottom"}
          >
            <Play className="h-3.5 w-3.5" />
          </TooltipButton>
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
    </div>
  );

  return (
    <div className="global-timer">
      {/* The titlebar's backdrop filter would contain fixed-position children. */}
      {isNarrowView ? createPortal(controls, document.body) : controls}
      <DayTotalsPill
        date={date}
        dayTotalMs={dayTotalMs}
        weekTotalMs={weekTotalMs}
        onSubmit={onSubmit}
      />
      {isNarrowView && editor !== null ? (
        <TimeEntryModal
          date={today}
          timerId={editor === "running" ? (currentTimer?._id ?? "") : undefined}
          initialValues={editor === "new" ? newEntryValues : undefined}
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
  const sidebarWidth = resolveSidebarWidth(useSidebarLayout());
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
      <PendingSourceWritesFlush />
      <ShortcutOverlay />
      <CommandPalette />
      <SnoozePickerHost />
      <SettleDialogHost />
      {/* useAppSidebar owns the state, persistence and Cmd/Ctrl+B, so the
          provider is controlled and its own shortcut stays off. */}
      <SidebarProvider
        className="ajour-app-body"
        data-app-sidebar={appSidebar.state}
        style={
          appSidebar.state === "expanded"
            ? ({
                "--app-sidebar-width": `${sidebarWidth}px`,
                // Custom properties resolve where they are declared, so the
                // centering offset is restated with the dragged width.
                "--app-centered-workspace-right-offset": `calc(${sidebarWidth / 2}px + var(--app-workspace-half-width))`,
              } as CSSProperties)
            : undefined
        }
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
            onStateChange={appSidebar.setState}
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
                  <TooltipButton
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
                    label="Return to today"
                    shortcut="time.today"
                  >
                    <ReturnIcon className="h-2.5 w-2.5" />
                  </TooltipButton>
                ) : null}
              </div>

              <GlobalTimerBar
                date={selectedTimeDate}
                onSubmit={() => {
                  if (isTimeActive && /^\/time\/[^/]+$/.test(pathname)) {
                    void navigate({
                      to: "/time/$date",
                      params: {
                        date: pathname.split("/")[2] ?? selectedTimeDate,
                      },
                      search: ((previous: Record<string, unknown>) => ({
                        ...previous,
                        action: "submit-week",
                      })) as never,
                    });
                  } else {
                    void navigate({
                      to: "/time/$date/submit",
                      params: { date: selectedTimeDate },
                    });
                  }
                }}
              />
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
