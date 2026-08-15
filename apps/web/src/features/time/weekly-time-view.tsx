import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  RiAddLine as Plus,
  RiAlertLine as AlertTriangle,
  RiArrowLeftLine as ArrowLeft,
  RiArrowLeftSLine as ChevronLeft,
  RiArrowRightSLine as ChevronRight,
  RiCloseLine as X,
  RiLockLine as Lock,
} from "@remixicon/react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type {
  LocalTimesheetEntry,
  WeeklyTimeViewStyle,
} from "@/domain/local-state";
import { formatClockDuration } from "@/domain/time/duration";
import { projectWeeklyTime } from "@/domain/time/weekly-time";
import {
  createCrossDayEntryDragPointerSession,
} from "@/lib/cross-day-entry-drag";
import {
  useLocalProjects,
  useLocalState,
  useUserPreferences,
} from "@/lib/local-hooks";
import { localStore } from "@/lib/local-store";
import {
  setSharedTableDragDocumentState,
  SHARED_TABLE_DRAG_CLICK_SUPPRESSION_MS,
  type SharedTableDragPointerSession,
} from "@/lib/table-drag";
import { getTimerContributionMs, getTimerDurationsMs } from "@/lib/timer-totals";
import { ProjectIcon } from "@/lib/project-icons";
import { addDaysIsoDate, cn, todayIsoDate } from "@/lib/utils";

type LedgerCellSelection = {
  entryIds: string[];
  localDate: string;
  rowKey: string;
  taskName: string;
};

type CrossDayDragState = {
  entryId: string;
  height: number;
  offsetX: number;
  offsetY: number;
  pointerId: number;
  pointerX: number;
  pointerY: number;
  targetDate: string | null;
  width: number;
};

function dateAtNoon(localDate: string) {
  return new Date(`${localDate}T12:00:00`);
}

function formatWeekRange(weekDates: string[]) {
  const start = weekDates[0];
  const end = weekDates.at(-1);
  if (!start || !end) return "";
  const startDate = dateAtNoon(start);
  const endDate = dateAtNoon(end);
  const startLabel = new Intl.DateTimeFormat("en-CA", {
    month: "long",
    day: "numeric",
  }).format(startDate);
  const endLabel = new Intl.DateTimeFormat("en-CA", {
    month: startDate.getMonth() === endDate.getMonth() ? undefined : "long",
    day: "numeric",
  }).format(endDate);
  return `${startLabel}–${endLabel}`;
}

function formatDay(localDate: string, options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat("en-CA", options).format(dateAtNoon(localDate));
}

function CapacityValue({
  capacityMs,
  label,
  microLabel,
  overCapacity,
  showWarning,
  totalMs,
}: {
  capacityMs: number;
  label: string;
  microLabel?: string;
  overCapacity: boolean;
  showWarning: boolean;
  totalMs: number;
}) {
  const utilization = capacityMs > 0 ? Math.round((totalMs / capacityMs) * 100) : null;
  return (
    <div className={cn("weekly-capacity-value", microLabel && "is-summary")}>
      {microLabel ? <span className="weekly-capacity-label">{microLabel}</span> : null}
      <HoverCard>
        <HoverCardTrigger className="weekly-capacity-trigger">
          {formatClockDuration(totalMs)}
        </HoverCardTrigger>
        <HoverCardContent className="w-56" align="end">
          <span className="font-medium">{label}</span>
          <span className="text-muted-foreground">
            {formatClockDuration(totalMs)} logged · {formatClockDuration(capacityMs)} target
          </span>
          <span className="text-muted-foreground">
            {utilization === null ? "No capacity target" : `${utilization}% of capacity`}
          </span>
        </HoverCardContent>
      </HoverCard>
      {showWarning && overCapacity ? (
        <AlertTriangle className="weekly-capacity-warning" aria-label="Over capacity" />
      ) : null}
    </div>
  );
}

export function WeeklyTimeView({
  anchorDate,
  now,
  onNewEntry,
  onOpenEntry,
  onReturnToDay,
  onSelectWeek,
  onSubmit,
  weekDates,
}: {
  anchorDate: string;
  now: number;
  onNewEntry: (localDate: string) => void;
  onOpenEntry: (entryId: string) => void;
  onReturnToDay: () => void;
  onSelectWeek: (anchorDate: string) => void;
  onSubmit: () => void;
  weekDates: string[];
}) {
  const state = useLocalState();
  const projects = useLocalProjects();
  const preferences = useUserPreferences();
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);
  const [ledgerCell, setLedgerCell] = useState<LedgerCellSelection | null>(null);
  const [dragState, setDragState] = useState<CrossDayDragState | null>(null);
  const dragStateRef = useRef<CrossDayDragState | null>(null);
  const dragSessionRef = useRef<SharedTableDragPointerSession | null>(null);
  const dayTargetRefs = useRef(new Map<string, HTMLElement>());
  const suppressClickUntilRef = useRef(0);
  const currentTimer = state.timers[0] ?? null;
  const today = todayIsoDate();
  const projectsById = useMemo(
    () => new Map(projects.map((project) => [project._id, project])),
    [projects],
  );
  const runningTime = useMemo(() => {
    if (!currentTimer) return null;
    const durations = getTimerDurationsMs(currentTimer, now);
    return {
      entryId: currentTimer.entryId,
      localDate: currentTimer.localDate,
      projectId: currentTimer.projectId,
      taskId: currentTimer.taskId,
      durationMs: getTimerContributionMs({
        timer: currentTimer,
        timesheetEntries: state.timesheetEntries,
        ...durations,
      }),
      displayDurationMs: durations.runningDurationMs,
    };
  }, [currentTimer, now, state.timesheetEntries]);
  const projection = useMemo(
    () =>
      projectWeeklyTime({
        capacityTargets: preferences.weeklyCapacityTargets,
        entries: state.timesheetEntries,
        projects,
        runningTime,
        weekDates,
      }),
    [preferences.weeklyCapacityTargets, projects, runningTime, state.timesheetEntries, weekDates],
  );
  const draggedEntry = dragState
    ? state.timesheetEntries.find((entry) => entry._id === dragState.entryId) ?? null
    : null;

  useEffect(() => {
    dragStateRef.current = dragState;
  }, [dragState]);

  useEffect(() => {
    setLedgerCell(null);
  }, [preferences.weeklyTimeViewStyle, anchorDate]);

  const clearDrag = useCallback(() => {
    dragSessionRef.current?.dispose();
    dragSessionRef.current = null;
    dragStateRef.current = null;
    setDragState(null);
    setSharedTableDragDocumentState(false, "cross-day-entry-drag-active");
  }, []);

  useEffect(() => clearDrag, [clearDrag]);

  function changeStyle(values: unknown[]) {
    const style = values[0];
    if (style === "ledger" || style === "lanes") {
      localStore.setUserPreferences({ weeklyTimeViewStyle: style as WeeklyTimeViewStyle });
    }
  }

  function moveEntry(entry: LocalTimesheetEntry, localDate: string) {
    if (entry.localDate === localDate) return;
    localStore.moveTimesheetEntry(entry._id, {
      localDate,
      projectId: entry.projectId,
      taskId: entry.taskId,
      note: entry.note,
      durationMs: entry.durationMs,
    });
    setSelectedEntryId(entry._id);
  }

  function registerDayTarget(localDate: string, node: HTMLElement | null) {
    if (node) {
      dayTargetRefs.current.set(localDate, node);
    } else {
      dayTargetRefs.current.delete(localDate);
    }
  }

  function handleEntryPointerDown(
    entry: LocalTimesheetEntry,
    event: ReactPointerEvent<HTMLElement>,
  ) {
    if (
      event.button !== 0 ||
      dragSessionRef.current !== null ||
      currentTimer?.entryId === entry._id ||
      event.currentTarget.closest("[data-running-entry='true']")
    ) {
      return;
    }

    const rect = event.currentTarget.getBoundingClientRect();
    const { clientX, clientY, pointerId, pointerType } = event;
    dragSessionRef.current = createCrossDayEntryDragPointerSession({
      pointerId,
      pointerType,
      originX: clientX,
      originY: clientY,
      targets: dayTargetRefs.current,
      isDragging: () => dragStateRef.current?.pointerId === pointerId,
      onStart: (pointer, targetDate) => {
        setSharedTableDragDocumentState(true, "cross-day-entry-drag-active");
        const nextState: CrossDayDragState = {
          entryId: entry._id,
          height: rect.height,
          offsetX: clientX - rect.left,
          offsetY: clientY - rect.top,
          pointerId,
          pointerX: pointer.clientX,
          pointerY: pointer.clientY,
          targetDate,
          width: rect.width,
        };
        dragStateRef.current = nextState;
        setDragState(nextState);
      },
      onMove: (pointer, targetDate) => {
        const active = dragStateRef.current;
        if (!active) return;
        const nextState = {
          ...active,
          pointerX: pointer.clientX,
          pointerY: pointer.clientY,
          targetDate,
        };
        dragStateRef.current = nextState;
        setDragState(nextState);
      },
      onEnd: (targetDate, commit) => {
        suppressClickUntilRef.current =
          performance.now() + SHARED_TABLE_DRAG_CLICK_SUPPRESSION_MS;
        dragSessionRef.current = null;
        if (commit && targetDate) moveEntry(entry, targetDate);
        clearDrag();
      },
      onPressEnd: () => {
        dragSessionRef.current = null;
      },
    });
  }

  function openEntry(entryId: string) {
    if (performance.now() >= suppressClickUntilRef.current) {
      onOpenEntry(entryId);
    }
  }

  function renderEntrySummary(entry: LocalTimesheetEntry) {
    const project = entry.projectId ? projectsById.get(entry.projectId) : undefined;
    const task = project?.tasks.find((candidate) => candidate._id === entry.taskId);
    return {
      note: entry.note,
      projectColor: project?.color ?? "#3b82f6",
      projectName: project?.displayName ?? project?.name ?? "No project",
      taskName: task?.name ?? (entry.label || "No task"),
    };
  }

  const ledgerEntries = ledgerCell
    ? ledgerCell.entryIds
        .map((entryId) => state.timesheetEntries.find((entry) => entry._id === entryId))
        .filter(
          (entry): entry is LocalTimesheetEntry => {
            if (!entry) return false;
            return (
              entry.localDate === ledgerCell.localDate &&
              entry._id !== currentTimer?.entryId
            );
          },
        )
    : [];
  const ledgerRunning = Boolean(
    ledgerCell &&
      projection.ledgerRows.some(
        (row) =>
          row.rowKey === ledgerCell.rowKey &&
          row.runningLocalDate === ledgerCell.localDate,
      ),
  );

  return (
    <section className="weekly-time-view" aria-label="Week overview">
      <header className="weekly-time-header">
        <div className="weekly-time-heading">
          <Button
            className="weekly-return-day"
            variant="ghost"
            size="sm"
            onClick={onReturnToDay}
          >
            <ArrowLeft data-icon="inline-start" />
            Day
          </Button>
          <div className="weekly-time-navigation">
            <Button variant="ghost" size="icon-sm" aria-label="Previous week" onClick={() => onSelectWeek(addDaysIsoDate(anchorDate, -7))}>
              <ChevronLeft />
            </Button>
            <Button variant="ghost" size="icon-sm" aria-label="Next week" onClick={() => onSelectWeek(addDaysIsoDate(anchorDate, 7))}>
              <ChevronRight />
            </Button>
          </div>
          <h2 className="weekly-time-title">{formatWeekRange(weekDates)}</h2>
        </div>
        <div className="weekly-time-actions">
          <ToggleGroup value={[preferences.weeklyTimeViewStyle]} onValueChange={changeStyle} variant="outline" size="sm" aria-label="Week layout">
            <ToggleGroupItem value="ledger">Ledger</ToggleGroupItem>
            <ToggleGroupItem value="lanes">Lanes</ToggleGroupItem>
          </ToggleGroup>
          <CapacityValue microLabel="Week total" capacityMs={projection.capacityMs} totalMs={projection.totalMs} label="Week capacity" overCapacity={projection.overCapacity} showWarning={preferences.warnWhenOverCapacity} />
          <Button size="sm" onClick={onSubmit}>Submit</Button>
        </div>
      </header>

      {preferences.weeklyTimeViewStyle === "ledger" ? (
        <div className="weekly-ledger-stack">
          <div className="weekly-ledger-table-scroll">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="weekly-ledger-task-column">Project / task</TableHead>
                  {projection.days.map((day, index) => (
                    <TableHead
                      key={day.localDate}
                      className={cn(
                        "weekly-ledger-day-column",
                        index >= 5 && "is-weekend",
                        day.localDate === today && "is-today",
                      )}
                    >
                      <div
                        ref={(node) => registerDayTarget(day.localDate, node)}
                        className={cn(
                          "weekly-ledger-day-target",
                          dragState?.targetDate === day.localDate && "is-drop-target",
                        )}
                      >
                        <span className="weekly-ledger-weekday">{formatDay(day.localDate, { weekday: "short" })}</span>
                        <span className="weekly-ledger-day-number">{formatDay(day.localDate, { day: "numeric" })}</span>
                        <CapacityValue capacityMs={day.capacityMs} totalMs={day.totalMs} label={formatDay(day.localDate, { weekday: "long" })} overCapacity={day.overCapacity} showWarning={preferences.warnWhenOverCapacity} />
                      </div>
                    </TableHead>
                  ))}
                  <TableHead className="weekly-ledger-total-column">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {projection.ledgerRows.map((row) => {
                  const project = row.projectId ? projectsById.get(row.projectId) : undefined;
                  return (
                    <TableRow key={row.rowKey}>
                      <TableCell className="weekly-ledger-task-cell">
                        <ProjectIcon
                          icon={project?.icon}
                          color={project?.color ?? "#3b82f6"}
                          className="weekly-project-mark"
                          fallback="dot"
                        />
                        <div>
                          <span>{row.projectName}</span>
                          <strong>{row.taskName}</strong>
                        </div>
                      </TableCell>
                      {row.dayTotalsMs.map((durationMs, index) => (
                        <TableCell
                          key={weekDates[index]}
                          className={cn(
                            "weekly-ledger-time-cell",
                            index >= 5 && "is-weekend",
                            weekDates[index] === today && "is-today",
                          )}
                        >
                          {durationMs > 0 ? (
                            <button
                              type="button"
                              className={cn(
                                "weekly-ledger-time-button",
                                ledgerCell?.localDate === weekDates[index] &&
                                  ledgerCell?.rowKey === row.rowKey &&
                                  "is-selected",
                              )}
                              onClick={() =>
                                setLedgerCell({
                                  entryIds: row.entryIds,
                                  localDate: weekDates[index]!,
                                  rowKey: row.rowKey,
                                  taskName: row.taskName,
                                })
                              }
                            >
                              {formatClockDuration(durationMs)}
                            </button>
                          ) : (
                            <span className="text-muted-foreground/45">—</span>
                          )}
                        </TableCell>
                      ))}
                      <TableCell className="weekly-ledger-total-cell">{formatClockDuration(row.totalMs)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
              <TableFooter>
                <TableRow className="weekly-ledger-footer-row">
                  <TableCell className="weekly-ledger-task-cell">Daily totals</TableCell>
                  {projection.days.map((day, index) => (
                    <TableCell
                      key={day.localDate}
                      className={cn("weekly-ledger-time-cell", index >= 5 && "is-weekend")}
                    >
                      {formatClockDuration(day.totalMs)}
                    </TableCell>
                  ))}
                  <TableCell className="weekly-ledger-total-cell">
                    {formatClockDuration(projection.totalMs)}
                  </TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          </div>

          {ledgerCell ? (
            <div className="weekly-ledger-tray">
              <header className="weekly-ledger-tray-header">
                <div>
                  <span>{formatDay(ledgerCell.localDate, { weekday: "long", month: "short", day: "numeric" })}</span>
                  <strong>{ledgerCell.taskName}</strong>
                </div>
                <Button variant="ghost" size="icon-sm" aria-label="Close entry tray" onClick={() => setLedgerCell(null)}>
                  <X />
                </Button>
              </header>
              <div className="weekly-ledger-tray-entries" role="group" aria-label="Time entries">
                {ledgerRunning ? (
                  <div className="weekly-tray-entry is-running" data-running-entry="true">
                    <Lock />
                    <span>Running timer</span>
                    <strong>{formatClockDuration(runningTime!.displayDurationMs)}</strong>
                  </div>
                ) : null}
                {ledgerEntries.map((entry) => {
                  const summary = renderEntrySummary(entry);
                  return (
                    <button
                      key={entry._id}
                      type="button"
                      aria-pressed={selectedEntryId === entry._id}
                      className={cn(
                        "weekly-tray-entry",
                        selectedEntryId === entry._id && "is-selected",
                      )}
                      onClick={() => {
                        if (performance.now() >= suppressClickUntilRef.current) {
                          setSelectedEntryId(entry._id);
                        }
                      }}
                      onDoubleClick={() => openEntry(entry._id)}
                      onKeyDown={(event) => event.key === "Enter" && openEntry(entry._id)}
                      onPointerDown={(event) => handleEntryPointerDown(entry, event)}
                    >
                      <span>{summary.projectName}</span>
                      <span>{summary.note || summary.taskName}</span>
                      <strong>{formatClockDuration(entry.durationMs)}</strong>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="weekly-lanes-grid">
          {projection.days.map((day, index) => {
            const visibleEntries = currentTimer?.entryId
              ? day.entries.filter((entry) => entry._id !== currentTimer.entryId)
              : day.entries;
            const runningHere = runningTime?.localDate === day.localDate;
            const isToday = day.localDate === today;
            return (
              <section
                key={day.localDate}
                ref={(node) => registerDayTarget(day.localDate, node)}
                className={cn(
                  "weekly-lane",
                  index >= 5 && "is-weekend",
                  isToday && "is-today",
                  dragState?.targetDate === day.localDate && "is-drop-target",
                )}
                aria-label={formatDay(day.localDate, { weekday: "long", month: "long", day: "numeric" })}
              >
                <header className="weekly-lane-header">
                  <div>
                    <span className="weekly-lane-weekday">{formatDay(day.localDate, { weekday: "short" })}</span>
                    <span className={cn("weekly-lane-date", isToday && "is-today")}>{formatDay(day.localDate, { month: "short", day: "numeric" })}</span>
                  </div>
                  <CapacityValue capacityMs={day.capacityMs} totalMs={day.totalMs} label={formatDay(day.localDate, { weekday: "long" })} overCapacity={day.overCapacity} showWarning={preferences.warnWhenOverCapacity} />
                </header>
                <div className="weekly-lane-entries" role="group" aria-label={`${formatDay(day.localDate, { weekday: "long" })} entries`}>
                  {runningHere ? (
                    <Card size="sm" className="weekly-entry-card is-running" data-running-entry="true">
                      <Badge><Lock data-icon="inline-start" /> Running</Badge>
                      <strong>{formatClockDuration(runningTime.displayDurationMs)}</strong>
                    </Card>
                  ) : null}
                  {visibleEntries.map((entry) => {
                    const summary = renderEntrySummary(entry);
                    return (
                      <Card
                        key={entry._id}
                        size="sm"
                        tabIndex={0}
                        role="button"
                        aria-label={`${summary.projectName}, ${summary.taskName}, ${formatClockDuration(entry.durationMs)}`}
                        aria-pressed={selectedEntryId === entry._id}
                        style={{ "--project-color": summary.projectColor } as CSSProperties}
                        className={cn(
                          "weekly-entry-card",
                          selectedEntryId === entry._id && "is-selected",
                          dragState?.entryId === entry._id && "is-dragging",
                        )}
                        onClick={() => {
                          if (performance.now() >= suppressClickUntilRef.current) {
                            setSelectedEntryId(entry._id);
                          }
                        }}
                        onDoubleClick={() => openEntry(entry._id)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            openEntry(entry._id);
                          } else if (event.key === " ") {
                            event.preventDefault();
                            setSelectedEntryId(entry._id);
                          }
                        }}
                        onPointerDown={(event) => handleEntryPointerDown(entry, event)}
                      >
                        <div className="weekly-entry-card-project">
                          <span>{summary.projectName}</span>
                          <strong>{formatClockDuration(entry.durationMs)}</strong>
                        </div>
                        <span className="weekly-entry-card-task">{summary.taskName}</span>
                        {summary.note ? <span className="weekly-entry-card-note">{summary.note}</span> : null}
                        <footer className="weekly-entry-card-footer">
                          <span className="weekly-entry-card-status">
                            {entry.submittedAt ? "submitted" : "saved"}
                          </span>
                        </footer>
                      </Card>
                    );
                  })}
                  <Button variant="ghost" size="sm" className="weekly-lane-add" onClick={() => onNewEntry(day.localDate)}>
                    <Plus data-icon="inline-start" /> Add
                  </Button>
                </div>
              </section>
            );
          })}
        </div>
      )}

      {draggedEntry && dragState ? (
        <div
          className="weekly-entry-drag-preview"
          style={{
            height: dragState.height,
            width: dragState.width,
            transform: `translate3d(${Math.round(dragState.pointerX - dragState.offsetX)}px, ${Math.round(dragState.pointerY - dragState.offsetY)}px, 0)`,
          }}
        >
          <span>{renderEntrySummary(draggedEntry).projectName}</span>
          <strong>{formatClockDuration(draggedEntry.durationMs)}</strong>
        </div>
      ) : null}
    </section>
  );
}
