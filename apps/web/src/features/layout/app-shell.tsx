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
  RiArrowDownSLine as ChevronDown,
  RiArrowGoBackLine as ReturnIcon,
  RiCheckLine as Check,
  RiCloseLine as X,
  RiFolderChartLine as FolderKanban,
  RiListCheck3 as ListTodo,
  RiPlayLine as Play,
  RiSettings3Line as Settings,
  RiStopLine as Square,
  RiTimerLine as Timer,
} from "@remixicon/react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { buildProjectTaskOptions } from "@/features/projects/project-task-options";
import {
  formatClockDuration,
  normalizeHoursInput,
  parseHoursInput,
} from "@/domain/time/duration";
import { getLocalProjectDisplayName } from "@/domain/local-state";
import { getConnectorsOverview, syncConnectorConnection } from "@/lib/app-api";
import { localStore } from "@/lib/local-store";
import {
  getTimerContributionMs,
  getTimerDurationsMs,
} from "@/lib/timer-totals";
import { isDesktopShell } from "@/lib/runtime";
import { cn, getIsoWeekDates, todayIsoDate } from "@/lib/utils";
import { useLocalProjects, useLocalState } from "@/lib/local-hooks";
import { MOBILE_BREAKPOINT } from "@/hooks/use-mobile";
import { useApplyTheme } from "@/lib/use-theme";

const isWindowsDesktopShell =
  isDesktopShell &&
  typeof window !== "undefined" &&
  window.timetrackerDesktop?.runtime?.platform === "win32";

const navItems = [
  { to: "/time/$date", params: { date: "today" }, label: "Time", icon: Timer },
  { to: "/backlog", label: "Backlog", icon: ListTodo },
  { to: "/projects", label: "Projects", icon: FolderKanban },
  { to: "/settings", label: "Settings", icon: Settings },
] as const;

const AUTO_SYNC_POLL_INTERVAL_MS = 30_000;

function isNavItemActive(
  pathname: string,
  to: (typeof navItems)[number]["to"],
) {
  if (to === "/time/$date") {
    return pathname.startsWith("/time/") || pathname.startsWith("/review/");
  }

  if (to === "/projects") {
    return pathname === "/projects" || pathname.startsWith("/projects/");
  }

  if (to === "/settings") {
    return pathname.startsWith("/settings");
  }

  return pathname === to;
}

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
        className="harday-titlebar-date-trigger desktop-no-drag"
        aria-label={`Select time entry date. Current date ${formatTitlebarDate(date)}`}
      >
        {formatTitlebarDate(date)}
      </PopoverTrigger>
      <PopoverContent
        className="harday-titlebar-date-popover"
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
          className="harday-titlebar-calendar"
        />
      </PopoverContent>
    </Popover>
  );
}

function TitlebarNewEntryPopover({ date }: { date: string }) {
  const projects = useLocalProjects();
  const [isOpen, setIsOpen] = useState(false);
  const [projectId, setProjectId] = useState("");
  const [taskId, setTaskId] = useState("");
  const [note, setNote] = useState("");
  const [durationHours, setDurationHours] = useState("");

  const projectOptions = useMemo(
    () =>
      projects.map((project) => ({
        value: project._id,
        label: project.code
          ? `[${project.code}] ${getLocalProjectDisplayName(project)}`
          : getLocalProjectDisplayName(project),
        keywords: [
          project.name,
          getLocalProjectDisplayName(project),
          project.code ?? "",
        ],
      })),
    [projects],
  );
  const availableTasks = useMemo(
    () =>
      projects
        .find((project) => project._id === projectId)
        ?.tasks.filter((task) => task.status === "active") ?? [],
    [projectId, projects],
  );
  const taskOptions = useMemo(
    () => buildProjectTaskOptions(availableTasks),
    [availableTasks],
  );
  const parsedDurationMs = useMemo(
    () => parseHoursInput(durationHours),
    [durationHours],
  );
  const durationError =
    durationHours.trim() !== "" && parsedDurationMs === null
      ? "Enter a valid duration"
      : null;
  const hasContent = Boolean(
    projectId || taskId || note.trim() || durationHours.trim(),
  );

  useEffect(() => {
    if (availableTasks.some((task) => task._id === taskId)) {
      return;
    }

    setTaskId("");
  }, [availableTasks, taskId]);

  function reset() {
    setProjectId("");
    setTaskId("");
    setNote("");
    setDurationHours("");
  }

  function handleProjectChange(nextProjectId: string) {
    const nextTaskId =
      projects
        .find((project) => project._id === nextProjectId)
        ?.tasks.find((task) => task.status === "active")?._id ?? "";

    setProjectId(nextProjectId);
    setTaskId(nextTaskId);
  }

  function saveEntry() {
    if (durationError || !hasContent) {
      return;
    }

    localStore.saveManualTimeEntry({
      localDate: date,
      projectId: projectId || undefined,
      taskId: taskId || undefined,
      note: note.trim() || undefined,
      durationMs: parsedDurationMs ?? 0,
    });
    reset();
    setIsOpen(false);
  }

  function cancelEntry() {
    reset();
    setIsOpen(false);
  }

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger
        className="quick-timer-group-button desktop-no-drag"
        aria-label="Create time entry"
        title="Create time entry"
      >
        <Plus className="h-3.5 w-3.5" />
      </PopoverTrigger>
      <PopoverContent
        className="quick-timer-create-popover"
        align="end"
        sideOffset={8}
      >
        <div className="quick-timer-create-form">
          <div className="quick-timer-popup-header">
            <span className="quick-timer-popup-title">New time entry</span>
            <span className="quick-timer-create-date">
              {formatTitlebarDate(date)}
            </span>
          </div>

          <label className="field">
            <span className="field-label">Project</span>
            <SearchableSelect
              value={projectId}
              options={projectOptions}
              onChange={handleProjectChange}
              placeholder="No project"
              clearLabel="No project"
              emptyMessage="No matching projects"
              ariaLabel="Project"
            />
          </label>

          <label className="field">
            <span className="field-label">Task</span>
            <SearchableSelect
              value={taskId}
              options={taskOptions}
              onChange={setTaskId}
              placeholder={projectId ? "Select task" : "Pick a project first"}
              clearLabel={projectId ? "No task" : undefined}
              emptyMessage={
                projectId ? "No matching tasks" : "Pick a project first"
              }
              ariaLabel="Task"
              disabled={!projectId || availableTasks.length === 0}
            />
          </label>

          <label className="field">
            <span className="field-label">Note</span>
            <textarea
              className="field-input entry-note-input"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Notes (optional)"
              rows={2}
            />
          </label>

          <label className="field">
            <span className="field-label">Hours</span>
            <input
              className="field-input entry-hours-input"
              type="text"
              placeholder="01:30"
              style={{ fontFamily: "var(--font-mono)" }}
              value={durationHours}
              onChange={(event) => setDurationHours(event.target.value)}
              onBlur={(event) =>
                setDurationHours(normalizeHoursInput(event.target.value))
              }
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  saveEntry();
                }
              }}
              aria-label="Hours"
            />
            {durationError ? (
              <span className="field-error">{durationError}</span>
            ) : null}
          </label>

          <div className="quick-timer-popup-actions">
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={cancelEntry}
            >
              <X className="h-3.5 w-3.5" />
              Cancel
            </Button>
            <Button
              size="sm"
              className="gap-1.5"
              disabled={Boolean(durationError) || !hasContent}
              onClick={saveEntry}
            >
              <Check className="h-3.5 w-3.5" />
              Save
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function ConnectorAutoSyncScheduler() {
  const loopStateRef = useRef({
    cancelled: false,
    running: false,
    timeoutId: undefined as number | undefined,
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

          try {
            await syncConnectorConnection(
              dueConnection.pluginId,
              dueConnection.connection.id,
              { trigger: "auto" },
            );
          } catch (error) {
            console.error(
              `Connector auto sync failed for "${dueConnection.pluginId}".`,
              error,
            );
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

/* ── Quick Timer Popup ─────────────────────────────────────────────── */

function QuickTimerPopup({
  anchorRef,
  runningDurationMs,
  onClose,
}: {
  anchorRef: RefObject<HTMLDivElement | null>;
  runningDurationMs: number;
  onClose: () => void;
}) {
  const state = useLocalState();
  const projects = useLocalProjects();
  const popupRef = useRef<HTMLDivElement>(null);

  const currentTimer = state.timers[0] ?? null;

  const projectId = currentTimer?.projectId ?? "";
  const taskId = currentTimer?.taskId ?? "";
  const note = currentTimer?.note ?? "";

  const projectOptions = useMemo(
    () =>
      projects.map((project) => ({
        value: project._id,
        label: project.code
          ? `[${project.code}] ${getLocalProjectDisplayName(project)}`
          : getLocalProjectDisplayName(project),
        keywords: [
          project.name,
          getLocalProjectDisplayName(project),
          project.code ?? "",
        ],
      })),
    [projects],
  );
  const availableTasks = useMemo(
    () =>
      projects
        .find((p) => p._id === projectId)
        ?.tasks.filter((t) => t.status === "active") ?? [],
    [projectId, projects],
  );
  const taskOptions = useMemo(
    () => buildProjectTaskOptions(availableTasks),
    [availableTasks],
  );

  // Close on click outside
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

  // Close on Escape
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  if (!currentTimer) {
    return null;
  }

  function handleProjectChange(nextProjectId: string) {
    if (!currentTimer) return;
    localStore.updateTimer(currentTimer._id, {
      projectId: nextProjectId || undefined,
      taskId: undefined,
    });
  }

  function handleTaskChange(nextTaskId: string) {
    if (!currentTimer) return;
    localStore.updateTimer(currentTimer._id, {
      taskId: nextTaskId || undefined,
    });
  }

  function handleNoteChange(nextNote: string) {
    if (!currentTimer) return;
    localStore.updateTimer(currentTimer._id, { note: nextNote || undefined });
  }

  function handleSave() {
    if (!currentTimer) return;
    localStore.saveTimer(currentTimer._id);
    onClose();
  }

  function handleCancel() {
    if (!currentTimer) return;
    localStore.cancelTimer(currentTimer._id);
    onClose();
  }

  return (
    <div ref={popupRef} className="quick-timer-popup">
      {/* Header */}
      <div className="quick-timer-popup-header">
        <span className="quick-timer-popup-title">Running timer</span>
        <span className="quick-timer-popup-duration">
          {formatClockDuration(runningDurationMs)}
        </span>
      </div>

      {/* Project */}
      <label className="field">
        <span className="field-label">Project</span>
        <SearchableSelect
          value={projectId}
          options={projectOptions}
          onChange={handleProjectChange}
          placeholder="No project"
          clearLabel="No project"
          emptyMessage="No matching projects"
          ariaLabel="Project"
        />
      </label>

      {/* Task */}
      <label className="field">
        <span className="field-label">Task</span>
        <SearchableSelect
          value={taskId}
          options={taskOptions}
          onChange={handleTaskChange}
          placeholder={projectId ? "No task" : "Pick a project first"}
          clearLabel={projectId ? "No task" : undefined}
          emptyMessage={
            projectId ? "No matching tasks" : "Pick a project first"
          }
          ariaLabel="Task"
          disabled={!projectId || availableTasks.length === 0}
        />
      </label>

      {/* Note */}
      <label className="field">
        <span className="field-label">Note</span>
        <input
          className="field-input"
          value={note}
          onChange={(e) => handleNoteChange(e.target.value)}
          placeholder="Optional note"
        />
      </label>

      {/* Actions */}
      <div className="quick-timer-popup-actions">
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5"
          onClick={handleCancel}
        >
          <X className="h-3.5 w-3.5" />
          Cancel
        </Button>
        <Button size="sm" className="gap-1.5" onClick={handleSave}>
          <Square className="h-3.5 w-3.5" />
          Stop timer
        </Button>
      </div>
    </div>
  );
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

function GlobalTimerBar({ selectedDate }: { selectedDate: string }) {
  const state = useLocalState();
  const projects = useLocalProjects();
  const [now, setNow] = useState(() => Date.now());
  const [popupOpen, setPopupOpen] = useState(false);
  const [dayTotalsOpen, setDayTotalsOpen] = useState(false);
  const quickTimerAnchorRef = useRef<HTMLDivElement>(null);
  const dayTotalsAnchorRef = useRef<HTMLDivElement>(null);

  const currentTimer = state.timers[0] ?? null;
  const today = todayIsoDate();
  const weekDates = useMemo(() => getIsoWeekDates(today), [today]);

  // Auto-close popup when timer stops (e.g. saved from the Time page)
  useEffect(() => {
    if (!currentTimer) {
      setPopupOpen(false);
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

  const { elapsedDurationMs, runningDurationMs } = getTimerDurationsMs(
    currentTimer,
    now,
  );
  const timerContributionMs = getTimerContributionMs({
    timer: currentTimer,
    timesheetEntries: state.timesheetEntries,
    elapsedDurationMs,
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
    .join(" \u00B7 ");

  function handlePlayClick() {
    localStore.startTimer({ localDate: selectedDate });
    setPopupOpen(true);
  }

  function handleTimerPillClick() {
    setPopupOpen((prev) => !prev);
  }

  function handleDayTotalsClick() {
    setDayTotalsOpen((prev) => !prev);
  }

  const handlePopupClose = useCallback(() => {
    setPopupOpen(false);
  }, []);

  const handleDayTotalsClose = useCallback(() => {
    setDayTotalsOpen(false);
  }, []);

  return (
    <div className="global-timer">
      {currentTimer ? (
        <div
          ref={quickTimerAnchorRef}
          className={cn(
            "quick-timer-popup-anchor",
            isDesktopShell && "desktop-no-drag",
          )}
        >
          {timerMeta ? (
            <span className="global-timer-meta">{timerMeta}</span>
          ) : null}
          <div
            className="stat-pill stat-pill-active stat-pill-active-clickable"
            onClick={handleTimerPillClick}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") handleTimerPillClick();
            }}
          >
            <span className="status-dot status-dot-pulse" />
            <span className="stat-pill-value">
              {formatClockDuration(runningDurationMs)}
            </span>
          </div>
          {popupOpen ? (
            <QuickTimerPopup
              anchorRef={quickTimerAnchorRef}
              runningDurationMs={runningDurationMs}
              onClose={handlePopupClose}
            />
          ) : null}
        </div>
      ) : (
        <div
          className={cn(
            "quick-timer-button-group",
            isDesktopShell && "desktop-no-drag",
          )}
        >
          <TitlebarNewEntryPopover date={selectedDate} />
          <button
            type="button"
            className="quick-timer-group-button quick-timer-group-button-play"
            onClick={handlePlayClick}
            title="Start timer"
            aria-label="Start timer"
          >
            <Play className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
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
    </div>
  );
}

/* ── App Shell ─────────────────────────────────────────────────────── */

export function AppShell() {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  const navigate = useNavigate();
  const visibleNavItems = navItems;
  const activeNavItem =
    visibleNavItems.find((item) => isNavItemActive(pathname, item.to)) ??
    visibleNavItems[0];
  const ActiveNavIcon = activeNavItem.icon;
  const isTimeActive = isNavItemActive(pathname, "/time/$date");
  const isBacklogActive = isNavItemActive(pathname, "/backlog");
  const timeRouteDate = getTimeRouteDate(pathname);
  const [selectedTimeDate, setSelectedTimeDate] = useState(
    () => timeRouteDate ?? todayIsoDate(),
  );
  const [showMobileModeToggle, setShowMobileModeToggle] = useState(() =>
    typeof window === "undefined"
      ? false
      : window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT}px)`).matches,
  );
  const mobileModeValue = isTimeActive
    ? ["time"]
    : isBacklogActive
      ? ["backlog"]
      : [];

  useApplyTheme();

  useEffect(() => {
    if (timeRouteDate) {
      setSelectedTimeDate(timeRouteDate);
    }
  }, [timeRouteDate]);

  useEffect(() => {
    const mediaQuery = window.matchMedia(
      `(max-width: ${MOBILE_BREAKPOINT}px)`,
    );
    const handleViewportChange = () => {
      setShowMobileModeToggle(mediaQuery.matches);
    };

    handleViewportChange();
    mediaQuery.addEventListener("change", handleViewportChange);
    return () =>
      mediaQuery.removeEventListener("change", handleViewportChange);
  }, []);

  return (
    <div
      className={cn(
        "flex h-dvh min-h-0 flex-col bg-background",
        isDesktopShell && "desktop-shell-app",
        isWindowsDesktopShell && "desktop-shell-windows",
      )}
    >
      <ConnectorAutoSyncScheduler />
      {/* Top sticky nav */}
      <nav
        className={cn(
          "harday-nav",
          isDesktopShell && "desktop-shell-nav desktop-drag-region",
        )}
      >
        <div
          className={cn(
            "harday-nav-inner",
            isDesktopShell && "desktop-shell-nav-inner",
          )}
        >
          <div
            className={cn(
              "harday-nav-main",
              isDesktopShell && "desktop-shell-nav-main",
            )}
          >
            <DropdownMenu>
              <DropdownMenuTrigger
                className={cn(
                  "harday-nav-menu-trigger",
                  isDesktopShell && "desktop-no-drag",
                )}
                aria-label="Open primary navigation"
              >
                <ActiveNavIcon className="h-3.5 w-3.5" />
                <span>{activeNavItem.label}</span>
                <ChevronDown className="harday-nav-menu-trigger-arrow h-3.5 w-3.5" />
              </DropdownMenuTrigger>
              <DropdownMenuContent
                className="harday-nav-menu-content"
                align="start"
                sideOffset={6}
              >
                {visibleNavItems.map((item) => {
                  const Icon = item.icon;
                  const isActive = isNavItemActive(pathname, item.to);
                  return (
                    <DropdownMenuItem
                      key={item.label}
                      className="harday-nav-menu-item"
                      onClick={() => {
                        void navigate({
                          to: item.to as never,
                          params: (item.to === "/time/$date"
                            ? { date: selectedTimeDate }
                            : "params" in item
                              ? item.params
                              : undefined) as never,
                        });
                      }}
                    >
                      <Icon className="h-4 w-4" />
                      <span>{item.label}</span>
                      {isActive ? <Check className="ml-auto h-4 w-4" /> : null}
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
            {showMobileModeToggle ? (
              <ToggleGroup
                className={cn(
                  "harday-mobile-mode-toggle",
                  isDesktopShell && "desktop-no-drag",
                )}
                aria-label="Primary navigation"
                value={mobileModeValue}
                onValueChange={(value) => {
                  const nextValue = value[0];
                  if (!nextValue) {
                    return;
                  }

                  if (nextValue === "time") {
                    void navigate({
                      to: "/time/$date",
                      params: { date: selectedTimeDate },
                    });
                    return;
                  }

                  void navigate({ to: "/backlog" });
                }}
              >
                <ToggleGroupItem
                  value="time"
                  size="sm"
                  variant="default"
                  className={cn(
                    "harday-mobile-mode-toggle-item !h-6 !w-7 !min-w-7 !gap-0 !rounded-[4px] !px-0",
                    isDesktopShell && "desktop-no-drag",
                  )}
                  aria-label="Time"
                  title="Time"
                >
                  <Timer className="h-4 w-4" />
                  <span className="sr-only">Time</span>
                </ToggleGroupItem>
                <ToggleGroupItem
                  value="backlog"
                  size="sm"
                  variant="default"
                  className={cn(
                    "harday-mobile-mode-toggle-item !h-6 !w-7 !min-w-7 !gap-0 !rounded-[4px] !px-0",
                    isDesktopShell && "desktop-no-drag",
                  )}
                  aria-label="Backlog"
                  title="Backlog"
                >
                  <ListTodo className="h-4 w-4" />
                  <span className="sr-only">Backlog</span>
                </ToggleGroupItem>
              </ToggleGroup>
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
                  "harday-nav-return-today",
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

          <GlobalTimerBar selectedDate={selectedTimeDate} />
        </div>
      </nav>

      {/* Page content */}
      <main className="app-content-shell flex-1">
        <ScrollArea className="app-content-scroll-area">
          {pathname.startsWith("/settings") ? (
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
  );
}
