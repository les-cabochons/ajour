import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";
import { Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  RiAddLine as Plus,
  RiArrowGoBackLine as ReturnIcon,
  RiArrowRightSLine as ChevronRight,
  RiPlayLine as Play,
  RiStopFill as Stop,
} from "@remixicon/react";
import { PageTitle } from "@/components/page-header";
import { RunningDot } from "@/components/running-dot";
import { TooltipButton } from "@/components/tooltip-button";
import { Chip } from "@/components/ui/chip";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SidebarProvider } from "@/components/ui/sidebar";
import {
  AppNavigationSidebar,
  SidebarToggleButton,
} from "@/features/layout/app-navigation-sidebar";
import {
  FloatingStartDock,
  FloatingTimerDock,
  RunningEntryWindowTitle,
  runningEntryDraftProps,
  setRunningEntryEditorOpen,
  startBlankEntry,
  useRunningEntry,
  useRunningEntryEditor,
} from "@/features/layout/timer-dock";
import { AppMenuBar } from "@/features/layout/app-menu-bar";
import { getAppSection } from "@/features/layout/app-section";
import { CommandPalette } from "@/features/command-palette/command-palette";
import { AgentBridgeHost } from "@/features/agents/agent-bridge-host";
import { SyncConflictToasts } from "@/features/backlog/sync-conflicts";
import { LossySaveDialogHost } from "@/features/backlog/lossy-save-dialog";
import { AgentIndicator } from "@/features/agents/agent-indicator";
import { AgentPanelHost } from "@/features/agents/agent-panel-host";
import { ShortcutOverlay } from "@/features/layout/shortcut-overlay";
import { useGlobalShortcuts } from "@/features/layout/use-global-shortcuts";
import {
  NarrowBackBar,
  NarrowSectionSwitcher,
} from "@/features/layout/narrow-titlebar";
import { TimeDatePicker } from "@/features/time/time-date-picker";
import { TimeEntryEditorPopover } from "@/features/time/time-entry-editor-popover";
import type { NewTimeEntryValues } from "@/features/time/time-entry-editor-form";
import {
  useNewEntryRequests,
  type NewEntryRequest,
} from "@/features/time/new-entry-request";
import { TimeEntryModal } from "@/features/timer/time-entry-modal";
import { WeekTargetPromptHost } from "@/features/time/week-target-prompt";
import { CommitWeekButton } from "@/features/time/commit-week-button";
import {
  SettingsNavigation,
  getSettingsPages,
} from "@/features/settings/settings-navigation";
import { formatClockDuration } from "@/domain/time/duration";
import { formatElapsedDuration } from "@/domain/time/running-entry";
import { findPinnedTask } from "@/domain/projects/project-transitions";
import { traceCarrier } from "@/lib/wide-events";
import { localStore } from "@/lib/local-store";
import { setPageHeaderSlot, useHasPageHeader } from "@/lib/page-header";
import {
  getTimerContributionMs,
  getTimerDurationsMs,
} from "@/lib/timer-totals";
import { useAppSidebar } from "@/lib/app-sidebar";
import { resolveSidebarWidth, useSidebarLayout } from "@/lib/sidebar-layout";
import { watchSettleEnds } from "@/features/backlog/backlog-source-writes";
import { flushPendingWrites } from "@/features/layout/pending-writes-flush";
import { BacklogAutoSyncScheduler } from "@/features/layout/backlog-auto-sync-scheduler";
import { CloseSubitemsDialogHost } from "@/features/backlog/close-subitems-dialog";
import { SourceStateDialogHost } from "@/features/backlog/source-state-dialog";
import { SettleDialogHost } from "@/features/backlog/settle-dialog";
import { SnoozePickerHost } from "@/features/backlog/snooze-picker";
import { useShortcut } from "@/lib/shortcut-handlers";
import { useIsNarrowView } from "@/lib/use-narrow-view";
import { useRunningClock } from "@/lib/use-now";
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

function getTimeRouteDate(pathname: string) {
  const match = pathname.match(/^\/(?:time|review)\/([^/?#]+)/);
  if (!match) {
    return null;
  }

  return match[1] === "today" ? todayIsoDate() : match[1];
}

/** The top bar's title while the page has not mounted its own `PageHeader`. */
function DefaultPageHeader({
  pathname,
  selectedTimeDate,
  onSelectDate,
}: {
  pathname: string;
  selectedTimeDate: string;
  onSelectDate: (date: string) => void;
}) {
  if (pathname.startsWith("/time/")) {
    return (
      <>
        <TimeDatePicker
          date={selectedTimeDate}
          onSelectDate={onSelectDate}
          long
        />
        {selectedTimeDate === todayIsoDate() ? <Chip>Today</Chip> : null}
      </>
    );
  }
  const settingsPage = pathname.startsWith("/settings")
    ? getSettingsPages("wide", false, true).find((page) =>
        pathname.startsWith(page.to),
      )
    : undefined;
  const title = settingsPage
    ? settingsPage.label
    : pathname.startsWith("/settings")
      ? "Settings"
      : pathname.startsWith("/backlog")
        ? "Backlog"
        : pathname.startsWith("/projects")
          ? "Projects"
          : pathname.startsWith("/pull-requests")
            ? "Pull requests"
            : "Ajour";
  return <PageTitle as="div">{title}</PageTitle>;
}

/**
 * Where a page's `PageHeader` lands in the top bar: its title,
 * then its actions. Until a page mounts one, the route's default title shows.
 */
function PageHeaderSlot({
  pathname,
  selectedTimeDate,
  onSelectDate,
}: {
  pathname: string;
  selectedTimeDate: string;
  onSelectDate: (date: string) => void;
}) {
  const hasPageHeader = useHasPageHeader();
  // The header stays a drag region: the title fills most of the bar, and the
  // page's controls opt out of dragging individually (see `.desktop-shell-nav`
  // in styles.css).
  return (
    <div className="ajour-page-header">
      <div ref={setPageHeaderSlot} className="ajour-page-header-slot" />
      {hasPageHeader ? null : (
        <DefaultPageHeader
          pathname={pathname}
          selectedTimeDate={selectedTimeDate}
          onSelectDate={onSelectDate}
        />
      )}
    </div>
  );
}

/**
 * Sends the settle writes and comments left from a session that quit
 * during their Undo window, once at launch (`flushPendingWrites`).
 */
function PendingSourceWritesFlush() {
  useEffect(() => {
    void flushPendingWrites();
  }, []);
  // A settle that ends turns its waiting comments into drafts.
  useEffect(() => watchSettleEnds(), []);
  return null;
}

/**
 * The selected day's titlebar pill: "Today" and the day total on today, the
 * day total alone on another day. Its popover has the day and week totals.
 * With `showsRunningEntry`, as in the narrow view, a running entry replaces
 * the day total on the pill with its own time, and the popover gets a Current
 * timer row that opens the entry's editor.
 */
function DayTotalsPill({
  date,
  showsRunningEntry = false,
}: {
  date: string;
  showsRunningEntry?: boolean;
}) {
  const state = useLocalState();
  const [open, setOpen] = useState(false);
  const currentTimer = state.timers[0] ?? null;
  const now = useRunningClock(currentTimer !== null);
  const weekDates = useMemo(() => getIsoWeekDates(date), [date]);

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

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className={cn(
          "ajour-nav-total shrink-0",
          isDesktopShell && "desktop-no-drag",
        )}
        aria-label="Show day and week totals"
      >
        {showsRunningEntry && currentTimer ? (
          <>
            <RunningDot />
            <span className="ajour-nav-total-value">
              {formatElapsedDuration(runningDurationMs)}
            </span>
          </>
        ) : (
          <>
            {date === todayIsoDate() ? (
              <span className="ajour-nav-total-label">Today</span>
            ) : null}
            <span className="ajour-nav-total-value">
              {formatClockDuration(dayTotalMs)}
            </span>
          </>
        )}
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        className="w-auto min-w-38 gap-2 rounded-lg px-3 py-2.5"
        aria-label="Current time totals"
      >
        {showsRunningEntry && currentTimer ? (
          <CurrentTimerRow onOpen={() => setOpen(false)} />
        ) : null}
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
      </PopoverContent>
    </Popover>
  );
}

/**
 * The totals popover's Current timer row: the running entry's title and an
 * arrow. A click opens the running entry in its editor dialog.
 */
function CurrentTimerRow({ onOpen }: { onOpen: () => void }) {
  const { summary } = useRunningEntry();
  return (
    <button
      type="button"
      className="day-totals-popup-row day-totals-popup-link"
      aria-label="Edit the current timer"
      onClick={() => {
        onOpen();
        setRunningEntryEditorOpen(true);
      }}
    >
      <span className="day-totals-popup-label">Current timer</span>
      <span className="flex min-w-0 items-center gap-1">
        <span className="max-w-40 truncate text-xs">{summary?.title}</span>
        <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
      </span>
    </button>
  );
}

/* ── Global Timer Bar ──────────────────────────────────────────────── */

/**
 * Whether the new entry editor is open. The running entry's editor state lives
 * with the timer dock (`setRunningEntryEditorOpen`).
 */
type TitlebarEditor = "new" | null;

/**
 * The titlebar totals and the host of the new entry editor. In the sidebar,
 * "+" sits in the timer dock, before Start or Stop. The "+" beside Search and
 * the project filter creates a backlog item instead.
 * While the sidebar is off screen (`showsFloatingDock`), the running entry floats at the bottom left
 * instead, or "+" and Start while nothing runs. In the narrow view, New entry
 * (+) and Start (▶) sit in the titlebar before the totals and open the dialog.
 * Start turns into Stop while an entry runs, and the totals pill shows the
 * running time, with a Current timer row in its popover. Elsewhere the editor
 * opens in a popover anchored
 * to where it was asked for: the "+" button, or the task or backlog row of New
 * entry… (`openNewEntryEditor`). N and requests whose row is off screen anchor
 * it to the titlebar's totals. New entries default to today; Start starts one
 * at once.
 */
function GlobalTimerBar({
  date,
  showsFloatingDock,
  floatingDockWidth,
}: {
  date: string;
  showsFloatingDock: boolean;
  /** Fits the floating dock inside the left column, as in Settings. */
  floatingDockWidth?: number;
}) {
  const state = useLocalState();
  const projects = useLocalProjects();
  const isNarrowView = useIsNarrowView();
  const [editor, setEditor] = useState<TitlebarEditor>(null);
  /** The project and task a new entry starts with, such as a pinned task. */
  const [newEntryValues, setNewEntryValues] = useState<NewTimeEntryValues>();
  /** The row or "+" the editor was asked from. Null anchors it to the totals. */
  const [newEntryAnchor, setNewEntryAnchor] = useState<HTMLElement | null>(
    null,
  );
  const [totalsElement, setTotalsElement] = useState<HTMLElement | null>(null);

  const currentTimer = state.timers[0] ?? null;
  const today = todayIsoDate();
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
      // One entry editor at a time: the new entry closes the running one.
      setRunningEntryEditorOpen(false);
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

  // The running entry's editor state lives with the timer dock, so it and its
  // draft survive a move between the dock's popover and the narrow dialog.
  const runningEditorOpen = useRunningEntryEditor(currentTimer !== null);
  // ...and opening the running entry, from a dock or Start, closes the new one.
  useEffect(() => {
    if (runningEditorOpen) setEditor(null);
  }, [runningEditorOpen]);

  const handleEditorClose = useCallback(() => {
    setEditor(null);
  }, []);
  const closeRunningEditor = useCallback(
    () => setRunningEntryEditorOpen(false),
    [],
  );

  return (
    <div className="global-timer" ref={setTotalsElement}>
      {isNarrowView ? null : (
        <TimeEntryEditorPopover
          target={newEntryTarget}
          open={editor === "new"}
          onOpenChange={(open) => {
            if (!open) setEditor(null);
          }}
          triggerLabel="Create time entry"
          anchor={newEntryAnchor ?? totalsElement}
        />
      )}
      {currentTimer && showsFloatingDock && !isNarrowView
        ? createPortal(
            <FloatingTimerDock
              className="ajour-floating-dock-desktop"
              style={
                floatingDockWidth
                  ? { left: 8, width: floatingDockWidth - 16, maxWidth: "none" }
                  : undefined
              }
            />,
            document.body,
          )
        : null}
      {!currentTimer && showsFloatingDock && !isNarrowView
        ? createPortal(
            <FloatingStartDock
              className="ajour-floating-dock-desktop"
              // In Settings it sits inside the left column, like the running dock.
              style={floatingDockWidth ? { left: 8 } : undefined}
            />,
            document.body,
          )
        : null}
      {/* The narrow view has no sidebar, so its entry buttons sit before the
          totals. Start turns into Stop while an entry runs, and the totals
          pill shows the running time. */}
      {isNarrowView ? (
        <div className="quick-timer-button-group">
          <TooltipButton
            className="quick-timer-group-button"
            onClick={() => openNewEntry()}
            label="Create time entry"
            shortcut="entry.new"
          >
            <Plus className="h-3.5 w-3.5" />
          </TooltipButton>
          {currentTimer ? (
            <TooltipButton
              className="quick-timer-group-button"
              onClick={() => localStore.saveTimer(currentTimer._id)}
              label="Stop"
              shortcut="entry.stop-or-start"
            >
              <Stop className="h-3.5 w-3.5" />
            </TooltipButton>
          ) : (
            <TooltipButton
              className="quick-timer-group-button quick-timer-group-button-play"
              onClick={startBlankEntry}
              label="Start"
              shortcut="entry.stop-or-start"
            >
              <Play className="h-3.5 w-3.5" />
            </TooltipButton>
          )}
        </div>
      ) : null}
      <DayTotalsPill date={date} showsRunningEntry={isNarrowView} />
      {isNarrowView && editor === "new" ? (
        <TimeEntryModal
          date={today}
          initialValues={newEntryValues}
          onClose={handleEditorClose}
        />
      ) : null}
      {isNarrowView && runningEditorOpen && currentTimer ? (
        <TimeEntryModal
          date={today}
          timerId={currentTimer._id}
          {...runningEntryDraftProps(currentTimer._id)}
          onClose={closeRunningEditor}
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
  const section = getAppSection(pathname);
  const isTimeActive = section === "time";
  const isSettingsActive = section === "settings";
  const timeRouteDate = getTimeRouteDate(pathname);
  const [selectedTimeDate, setSelectedTimeDate] = useState(
    () => timeRouteDate ?? todayIsoDate(),
  );
  const isNarrowView = useIsNarrowView();
  // In wide windows Settings fills the left column, so Cmd/Ctrl+B waits.
  const appSidebar = useAppSidebar({
    suspended: isSettingsActive && !isNarrowView,
  });
  const sidebarWidth = resolveSidebarWidth(useSidebarLayout());
  useGlobalShortcuts(selectedTimeDate);

  useApplyTheme();

  const selectTimeDate = useCallback(
    (nextDate: string) => {
      setSelectedTimeDate(nextDate);
      if (isTimeActive) {
        void navigate({ to: "/time/$date", params: { date: nextDate } });
      }
    },
    [isTimeActive, navigate],
  );

  useEffect(() => {
    // The main process's IPC event records a failure.
    void window.ajourDesktop
      ?.configureAutomaticUpdates?.(updateTrack, traceCarrier())
      .catch(() => undefined);
  }, [updateTrack]);

  useEffect(() => {
    if (timeRouteDate) {
      setSelectedTimeDate(timeRouteDate);
    }
  }, [timeRouteDate]);

  // Back to app returns to the last page outside Settings, with its search
  // state, such as the Week view or the entry open in the side panel.
  const href = useRouterState({ select: (state) => state.location.href });
  const lastAppHrefRef = useRef("/time/today");
  useEffect(() => {
    if (!isSettingsActive) lastAppHrefRef.current = href;
  }, [isSettingsActive, href]);

  // In wide windows Settings takes the left column with its own pages list.
  const showsSettingsSidebar = isSettingsActive && !isNarrowView;
  const isSidebarInline =
    !showsSettingsSidebar && appSidebar.state === "expanded" && !isNarrowView;
  const leftColumnWidth =
    showsSettingsSidebar || isSidebarInline ? sidebarWidth : 0;

  return (
    <div
      className={cn(
        "flex h-dvh min-h-0 flex-col bg-background",
        isDesktopShell && "desktop-shell-app",
        isWindowsDesktopShell && "desktop-shell-windows",
        isMacDesktopShell && "desktop-shell-macos",
      )}
    >
      <RunningEntryWindowTitle />
      <BacklogAutoSyncScheduler />
      <PendingSourceWritesFlush />
      <ShortcutOverlay />
      <AgentBridgeHost />
      <SyncConflictToasts />
      <LossySaveDialogHost />
      <AgentIndicator />
      <CommandPalette />
      <SnoozePickerHost />
      <SettleDialogHost />
      <CloseSubitemsDialogHost />
      <SourceStateDialogHost />
      <WeekTargetPromptHost />
      {/* useAppSidebar owns the state, persistence and Cmd/Ctrl+B, so the
          provider is controlled and its own shortcut stays off. */}
      <SidebarProvider
        className="ajour-app-body"
        data-app-sidebar={leftColumnWidth ? "inline" : "none"}
        style={
          {
            "--app-sidebar-width": `${leftColumnWidth}px`,
            // Custom properties resolve where they are declared, so the
            // centering offset is restated with the dragged width.
            "--app-centered-workspace-right-offset": `calc(${leftColumnWidth / 2}px + var(--app-workspace-half-width))`,
          } as CSSProperties
        }
        open={isSidebarInline}
        keyboardShortcut={false}
      >
        {/* The narrow view has no sidebars. Its titlebar holds the
            navigation instead. */}
        {showsSettingsSidebar ? (
          <SettingsNavigation
            pathname={pathname}
            view="wide"
            // Replacing the Settings entry keeps the browser's Back from
            // reopening Settings.
            onBack={() =>
              void navigate({ href: lastAppHrefRef.current, replace: true })
            }
          />
        ) : null}
        {isSidebarInline ? (
          <AppNavigationSidebar
            pathname={pathname}
            selectedTimeDate={selectedTimeDate}
            onToggle={appSidebar.toggle}
            onStateChange={appSidebar.setState}
          />
        ) : null}

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
                {isNarrowView || leftColumnWidth ? null : (
                  <SidebarToggleButton
                    label="Show sidebar"
                    onToggle={appSidebar.toggle}
                    className={cn(isDesktopShell && "desktop-no-drag")}
                  />
                )}
                {/* Commit week lives in the sidebar foot. While the sidebar
                    is hidden on a Time page, it sits here, after Show
                    sidebar. Other pages do without it. */}
                {isNarrowView || isSidebarInline || !isTimeActive ? null : (
                  <CommitWeekButton
                    selectedTimeDate={selectedTimeDate}
                    className={cn(isDesktopShell && "desktop-no-drag")}
                  />
                )}
                <AppMenuBar />
                <TimeDatePicker
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
                {isNarrowView ? null : (
                  <PageHeaderSlot
                    pathname={pathname}
                    selectedTimeDate={selectedTimeDate}
                    onSelectDate={selectTimeDate}
                  />
                )}
              </div>

              <GlobalTimerBar
                date={selectedTimeDate}
                floatingDockWidth={
                  showsSettingsSidebar ? leftColumnWidth : undefined
                }
                showsFloatingDock={
                  showsSettingsSidebar || appSidebar.state === "hidden"
                }
              />
            </div>
          </nav>

          {isNarrowView ? <NarrowBackBar pathname={pathname} /> : null}

          {/* Page content */}
          {/* The agent panel docks beside the page, below the titlebar. In
              the row, main takes the row's height: its own explicit height
              would overflow under the narrow back bar. */}
          <div className="flex min-h-0 flex-1">
            <main className="app-content-shell h-auto min-w-0 flex-1 self-stretch">
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
            <AgentPanelHost />
          </div>

          {/* Floats at the bottom left, over the page. */}
          {isNarrowView ? (
            <NarrowSectionSwitcher
              pathname={pathname}
              selectedTimeDate={selectedTimeDate}
            />
          ) : null}
        </div>
      </SidebarProvider>
    </div>
  );
}
