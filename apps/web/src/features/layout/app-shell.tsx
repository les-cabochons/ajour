import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";
import { pluginHasConnector, pluginHasCodeHost } from "@ajour/shared";
import { Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  RiAddLine as Plus,
  RiArrowGoBackLine as ReturnIcon,
  RiPlayLine as Play,
} from "@remixicon/react";
import { PageTitle } from "@/components/page-header";
import { TooltipButton } from "@/components/tooltip-button";
import { Chip } from "@/components/ui/chip";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { SidebarProvider } from "@/components/ui/sidebar";
import { showErrorToast } from "@/components/ui/toast";
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
  useRunningEntryEditor,
} from "@/features/layout/timer-dock";
import { AppMenuBar } from "@/features/layout/app-menu-bar";
import { getAppSection } from "@/features/layout/app-section";
import { CommandPalette } from "@/features/command-palette/command-palette";
import { AgentBridgeHost } from "@/features/agents/agent-bridge-host";
import { AgentIndicator } from "@/features/agents/agent-indicator";
import { AgentPanelHost } from "@/features/agents/agent-panel-host";
import { ShortcutOverlay } from "@/features/layout/shortcut-overlay";
import { useGlobalShortcuts } from "@/features/layout/use-global-shortcuts";
import {
  NarrowBackBar,
  NarrowSectionSwitcher,
  NarrowSettingsButton,
} from "@/features/layout/narrow-titlebar";
import { TimeDatePicker } from "@/features/time/time-date-picker";
import { TimeEntryEditorPopover } from "@/features/time/time-entry-editor-popover";
import type { NewTimeEntryValues } from "@/features/time/time-entry-editor-form";
import {
  useNewEntryRequests,
  type NewEntryRequest,
} from "@/features/time/new-entry-request";
import { TimeEntryModal } from "@/features/timer/time-entry-modal";
import {
  SettingsNavigation,
  getSettingsPages,
} from "@/features/settings/settings-navigation";
import { SubmitWeekButton } from "@/features/time/submit-week-controls";
import { formatClockDuration } from "@/domain/time/duration";
import { findPinnedTask } from "@/domain/projects/project-transitions";
import {
  getConnectorsOverview,
  syncConnectorConnection,
  syncCodeHostConnection,
} from "@/lib/app-api";
import { localStore } from "@/lib/local-store";
import { setPageHeaderSlot, useHasPageHeader } from "@/lib/page-header";
import {
  getTimerContributionMs,
  getTimerDurationsMs,
} from "@/lib/timer-totals";
import { useAppSidebar } from "@/lib/app-sidebar";
import { resolveSidebarWidth, useSidebarLayout } from "@/lib/sidebar-layout";
import { sendPendingSourceWrites } from "@/features/backlog/backlog-source-writes";
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

const AUTO_SYNC_POLL_INTERVAL_MS = 30_000;

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
    ? getSettingsPages("wide").find((page) => pathname.startsWith(page.to))
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
          overview.pluginsEnabled === false ||
          !group.enabled ||
          (!pluginHasConnector(group.plugin) &&
            !pluginHasCodeHost(group.plugin))
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
                  plugin: group.plugin,
                  connection,
                })),
        );

        for (const dueConnection of dueConnections) {
          if (loopState.cancelled) {
            break;
          }

          const operations = [
            ...(pluginHasConnector(dueConnection.plugin)
              ? [
                  {
                    capability: "connector",
                    run: () =>
                      syncConnectorConnection(
                        dueConnection.pluginId,
                        dueConnection.connection.id,
                        { trigger: "auto" },
                      ),
                  },
                ]
              : []),
            ...(pluginHasCodeHost(dueConnection.plugin)
              ? [
                  {
                    capability: "codeHost",
                    run: () =>
                      syncCodeHostConnection(
                        dueConnection.pluginId,
                        dueConnection.connection.id,
                      ),
                  },
                ]
              : []),
          ];
          for (const operation of operations) {
            if (loopState.cancelled) break;
            const failureKey = `${dueConnection.pluginId}:${dueConnection.connection.id}:${operation.capability}`;
            try {
              await operation.run();
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
  onSubmit,
}: {
  date: string;
  onSubmit: () => void;
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
        <span className="ajour-nav-total-label">
          {date === todayIsoDate() ? "Today" : "Day"}
        </span>
        <span className="ajour-nav-total-value">
          {formatClockDuration(dayTotalMs)}
        </span>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        className="w-auto min-w-38 gap-2 rounded-lg px-3 py-2.5"
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

/**
 * Whether the new entry editor is open. The running entry's editor state lives
 * with the timer dock (`setRunningEntryEditorOpen`).
 */
type TitlebarEditor = "new" | null;

/**
 * The titlebar totals and the host of the new entry editor. In the sidebar,
 * "+" sits beside Search and the project filter, and Start in the timer dock.
 * While the sidebar is off screen (`showsFloatingDock`), the running entry floats at the bottom left
 * instead, or "+" and Start while nothing runs. In the narrow view, New entry
 * (+) and Start (▶) float at the bottom right, with the floating dock beside
 * them, and open the dialog. Elsewhere the editor opens in a popover anchored
 * to where it was asked for: the "+" button, or the task or backlog row of New
 * entry… (`openNewEntryEditor`). N and requests whose row is off screen anchor
 * it to the titlebar's totals. New entries default to today; Start starts one
 * at once.
 */
function GlobalTimerBar({
  date,
  showsFloatingDock,
  floatingDockWidth,
  onSubmit,
}: {
  date: string;
  showsFloatingDock: boolean;
  /** Fits the floating dock inside the left column, as in Settings. */
  floatingDockWidth?: number;
  onSubmit: () => void;
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

  // The narrow view has no sidebar, so its entry buttons float on the page.
  const narrowControls = (
    <div className="global-timer-controls">
      <div className="quick-timer-button-group">
        <TooltipButton
          className="quick-timer-group-button"
          onClick={() => openNewEntry()}
          label="Create time entry"
          shortcut="entry.new"
          side="top"
        >
          <Plus className="h-3.5 w-3.5" />
        </TooltipButton>
        {currentTimer ? null : (
          <TooltipButton
            className="quick-timer-group-button quick-timer-group-button-play"
            onClick={startBlankEntry}
            label="Start"
            shortcut="entry.stop-or-start"
            side="top"
          >
            <Play className="h-3.5 w-3.5" />
          </TooltipButton>
        )}
      </div>
      {currentTimer ? (
        <div className="quick-timer-popup-anchor">
          <FloatingTimerDock
            onEdit={() => setRunningEntryEditorOpen(true)}
            className="h-11"
          />
        </div>
      ) : null}
    </div>
  );

  return (
    <div className="global-timer" ref={setTotalsElement}>
      {/* The titlebar's backdrop filter would contain fixed-position children. */}
      {isNarrowView ? createPortal(narrowControls, document.body) : null}
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
      <DayTotalsPill date={date} onSubmit={onSubmit} />
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

/**
 * Whether a click or Enter in the sidebar chose a page: a link or an item row,
 * not a button inside a row such as Start entry or "…".
 */
function isDestination(target: EventTarget) {
  if (!(target instanceof Element)) return false;
  const destination = target.closest('a[href], [role="link"]');
  const button = target.closest("button");
  return (
    destination !== null && (button === null || !destination.contains(button))
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
  const { closeOverlay } = appSidebar;
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

  // Opening a page from the sidebar over the page closes it.
  useEffect(() => {
    closeOverlay();
  }, [pathname, closeOverlay]);

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
    !showsSettingsSidebar && appSidebar.display === "inline" && !isNarrowView;
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
      <ConnectorAutoSyncScheduler />
      <PendingSourceWritesFlush />
      <ShortcutOverlay />
      <AgentBridgeHost />
      <AgentIndicator />
      <CommandPalette />
      <SnoozePickerHost />
      <SettleDialogHost />
      <CloseSubitemsDialogHost />
      <SourceStateDialogHost />
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
            navigation instead. Narrow desktop windows show the sidebar over
            the page while the user has it open. */}
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
        {!isNarrowView && !showsSettingsSidebar && appSidebar.isHiddenForced ? (
          <Sheet
            open={appSidebar.display === "overlay"}
            onOpenChange={(open) => {
              if (!open) closeOverlay();
            }}
          >
            <SheetContent
              side="left"
              showCloseButton={false}
              className="ajour-sidebar-overlay gap-0 p-0 data-[side=left]:w-(--app-sidebar-width) data-[side=left]:sm:max-w-none"
              style={
                { "--app-sidebar-width": `${sidebarWidth}px` } as CSSProperties
              }
              // Choosing a destination closes the overlay, even the page
              // already open, which leaves the route as it is.
              onClick={(event) => {
                if (
                  !event.metaKey &&
                  !event.ctrlKey &&
                  isDestination(event.target)
                )
                  closeOverlay();
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && isDestination(event.target))
                  closeOverlay();
              }}
            >
              <SheetTitle className="sr-only">Navigation</SheetTitle>
              <AppNavigationSidebar
                pathname={pathname}
                selectedTimeDate={selectedTimeDate}
                overlay
                onToggle={appSidebar.toggle}
                onStateChange={appSidebar.setState}
              />
            </SheetContent>
          </Sheet>
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
                <AppMenuBar />
                {isNarrowView ? (
                  <NarrowSectionSwitcher
                    pathname={pathname}
                    selectedTimeDate={selectedTimeDate}
                  />
                ) : null}
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
                  showsSettingsSidebar || appSidebar.display === "none"
                }
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
        </div>
      </SidebarProvider>
    </div>
  );
}
