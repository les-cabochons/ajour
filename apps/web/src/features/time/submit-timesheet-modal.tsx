import { useEffect, useMemo, useRef, useState } from "react";
import {
  RiCloseLine as X,
  RiFileCopyLine as Copy,
  RiFilter3Line as Filter,
} from "@remixicon/react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Checkbox } from "@/components/ui/checkbox";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { getProjectTaskBillableValueLabel } from "@/features/projects/project-task-options";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatClockDuration } from "@/domain/time/duration";
import type { LocalTimesheetEntry } from "@/domain/local-state";
import type { LocalProjectIcon } from "@/domain/projects/project-icon";
import { useLocalProjects, useLocalState } from "@/lib/local-hooks";
import { localStore } from "@/lib/local-store";
import { ProjectIcon } from "@/lib/project-icons";
import { cn } from "@/lib/utils";

function formatCountLabel(count: number, singular: string, plural: string) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function formatDayHeading(localDate: string) {
  return new Intl.DateTimeFormat("en-CA", {
    weekday: "long",
    month: "short",
    day: "numeric",
  }).format(new Date(`${localDate}T12:00:00`));
}

function formatDayColumnHeading(localDate: string) {
  return new Intl.DateTimeFormat("en-CA", {
    weekday: "short",
    day: "numeric",
  }).format(new Date(`${localDate}T12:00:00`));
}

function formatWeekRange(weekDates: string[]) {
  const firstDay = weekDates[0];
  const lastDay = weekDates.at(-1);
  if (!firstDay || !lastDay) {
    return "";
  }

  const formatter = new Intl.DateTimeFormat("en-CA", {
    month: "short",
    day: "numeric",
  });

  return `${formatter.format(new Date(`${firstDay}T12:00:00`))} to ${formatter.format(new Date(`${lastDay}T12:00:00`))}`;
}

function createTaskKey(projectId: string | undefined, taskId: string | undefined, taskLabel: string) {
  return `${projectId ?? "no-project"}::${taskId ?? taskLabel}`;
}

function formatCommentSummary(comments: string[]) {
  return comments.join(" | ");
}

function truncateLabel(value: string, maxLength = 30) {
  const trimmedValue = value.trim();
  if (trimmedValue.length <= maxLength) {
    return trimmedValue;
  }

  return `${trimmedValue.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

function SelectionCheckbox({
  checked,
  indeterminate,
  onChange,
  ariaLabel,
}: {
  checked: boolean;
  indeterminate?: boolean;
  onChange: (checked: boolean) => void;
  ariaLabel: string;
}) {
  return (
    <Checkbox
      className="submit-timesheet-checkbox"
      checked={checked}
      indeterminate={indeterminate}
      aria-label={ariaLabel}
      onCheckedChange={onChange}
    />
  );
}

function copyTextToClipboard(value: string) {
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.top = "0";
  document.body.appendChild(textarea);
  textarea.select();
  textarea.setSelectionRange(0, textarea.value.length);

  try {
    if (document.execCommand("copy")) {
      return;
    }
  } finally {
    document.body.removeChild(textarea);
  }

  void navigator.clipboard?.writeText(value);
}

function CopyHoverRow({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="submit-timesheet-comment-card-row">
      <span className="submit-timesheet-comment-card-row-label">{label}</span>
      <span className="submit-timesheet-comment-card-row-value">{value}</span>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        className="submit-timesheet-comment-card-copy"
        aria-label={`Copy ${label.toLowerCase()}`}
        onClick={(event) => {
          event.stopPropagation();
          copyTextToClipboard(value);
        }}
      >
        <Copy />
      </Button>
    </div>
  );
}

type SubmitViewMode = "day" | "task";
type SubmitGroupingMode = "single" | "grouped";

interface SubmitTimesheetModalProps {
  weekDates: string[];
  onClose: () => void;
}

interface EnrichedEntry {
  entry: LocalTimesheetEntry;
  projectColor: string;
  projectIcon?: LocalProjectIcon;
  projectName: string;
  taskId?: string;
  taskLabel: string;
  taskName?: string;
  taskBillableLabel?: string;
  taskKey: string;
  comments: string[];
}

interface EntryCollection {
  comments: string[];
  durationMs: number;
  entryCount: number;
  entryIds: string[];
  projectColor: string;
  projectIcon?: LocalProjectIcon;
  projectName: string;
  taskKey: string;
  taskLabel: string;
  taskName?: string;
  taskBillableLabel?: string;
}

interface DaySection {
  entryIds: string[];
  localDate: string;
  rows: EntryCollection[];
  totalMs: number;
}

interface TaskCell extends EntryCollection {
  localDate: string;
}

interface TaskRowData extends EntryCollection {
  cells: TaskCell[];
}

function mergeEntries(entries: EnrichedEntry[]): EntryCollection {
  const firstEntry = entries[0];
  return {
    comments: entries.flatMap((entry) => entry.comments),
    durationMs: entries.reduce((sum, entry) => sum + entry.entry.durationMs, 0),
    entryCount: entries.length,
    entryIds: entries.map((entry) => entry.entry._id),
    projectColor: firstEntry?.projectColor ?? "#3b82f6",
    projectIcon: firstEntry?.projectIcon,
    projectName: firstEntry?.projectName ?? "No project",
    taskKey: firstEntry?.taskKey ?? "unknown",
    taskLabel: firstEntry?.taskLabel ?? "No task",
    taskName: firstEntry?.taskName,
    taskBillableLabel: firstEntry?.taskBillableLabel,
  };
}

export function SubmitTimesheetModal({ weekDates, onClose }: SubmitTimesheetModalProps) {
  const state = useLocalState();
  const projects = useLocalProjects();
  const overlayRef = useRef<HTMLDivElement>(null);
  const filterRef = useRef<HTMLDivElement>(null);
  const initializedSelectionRef = useRef(false);
  const [selectedEntryIds, setSelectedEntryIds] = useState<string[]>([]);
  const [viewMode, setViewMode] = useState<SubmitViewMode>("day");
  const [groupingMode, setGroupingMode] = useState<SubmitGroupingMode>("single");
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [isUnderTargetWarningOpen, setIsUnderTargetWarningOpen] = useState(false);

  const weekDateSet = useMemo(() => new Set(weekDates), [weekDates]);
  const projectMap = useMemo(
    () => new Map(projects.map((project) => [project._id, project])),
    [projects],
  );
  const weekEntries = useMemo(
    () =>
      state.timesheetEntries
        .filter((entry) => weekDateSet.has(entry.localDate) && !entry.submittedAt)
        .sort((left, right) => right.committedAt - left.committedAt),
    [state.timesheetEntries, weekDateSet],
  );
  const enrichedEntries = useMemo<EnrichedEntry[]>(
    () =>
      weekEntries.map((entry) => {
        const project = entry.projectId ? projectMap.get(entry.projectId) : undefined;
        const task = entry.taskId ? project?.tasks.find((item) => item._id === entry.taskId) : undefined;
        const projectName = project?.name ?? "No project";
        const taskLabel =
          task?.name ?? (entry.label && entry.label !== projectName ? entry.label : "No task");

        return {
          entry,
          projectColor: project?.color ?? "#3b82f6",
          projectIcon: project?.icon,
          projectName,
          taskId: task?._id,
          taskKey: createTaskKey(project?._id, task?._id, taskLabel),
          taskLabel,
          taskName: task?.name,
          taskBillableLabel: task
            ? getProjectTaskBillableValueLabel(task)
            : undefined,
          comments: entry.note?.trim() ? [entry.note.trim()] : [],
        };
      }),
    [projectMap, weekEntries],
  );
  const submittedWeekEntryIds = useMemo(
    () =>
      new Set(
        state.timesheetEntries
          .filter((entry) => weekDateSet.has(entry.localDate) && entry.submittedAt)
          .map((entry) => entry._id),
      ),
    [state.timesheetEntries, weekDateSet],
  );
  const visibleEntryIds = useMemo(
    () => enrichedEntries.map((entry) => entry.entry._id),
    [enrichedEntries],
  );
  const visibleEntryIdsKey = useMemo(() => visibleEntryIds.join("|"), [visibleEntryIds]);
  const selectedEntryIdSet = useMemo(() => new Set(selectedEntryIds), [selectedEntryIds]);
  const activeGroupingMode = viewMode === "task" ? "grouped" : groupingMode;

  const daySections = useMemo<DaySection[]>(
    () =>
      weekDates
        .map((localDate) => {
          const entries = enrichedEntries.filter((entry) => entry.entry.localDate === localDate);
          const rows =
            activeGroupingMode === "single"
              ? entries.map((entry) => mergeEntries([entry]))
              : Array.from(
                  entries.reduce((groups, entry) => {
                    const current = groups.get(entry.taskKey) ?? [];
                    current.push(entry);
                    groups.set(entry.taskKey, current);
                    return groups;
                  }, new Map<string, EnrichedEntry[]>()),
                ).map(([, groupedEntries]) => mergeEntries(groupedEntries));

          return {
            entryIds: entries.map((entry) => entry.entry._id),
            localDate,
            rows,
            totalMs: entries.reduce((sum, entry) => sum + entry.entry.durationMs, 0),
          };
        })
        .filter((group) => group.rows.length > 0),
    [activeGroupingMode, enrichedEntries, weekDates],
  );

  const taskRows = useMemo<TaskRowData[]>(
    () =>
      Array.from(
        enrichedEntries.reduce((groups, entry) => {
          const current = groups.get(entry.taskKey) ?? [];
          current.push(entry);
          groups.set(entry.taskKey, current);
          return groups;
        }, new Map<string, EnrichedEntry[]>()),
      )
        .map(([, taskEntries]) => {
          const mergedRow = mergeEntries(taskEntries);
          const cells = weekDates.map((localDate) =>
            mergeEntries(taskEntries.filter((entry) => entry.entry.localDate === localDate)),
          );

          return {
            ...mergedRow,
            cells: cells.map((cell, index) => ({
              ...cell,
              localDate: weekDates[index]!,
            })),
          };
        })
        .sort((left, right) => {
          const projectCompare = left.projectName.localeCompare(right.projectName);
          if (projectCompare !== 0) {
            return projectCompare;
          }

          return left.taskLabel.localeCompare(right.taskLabel);
        }),
    [enrichedEntries, weekDates],
  );

  const selectedCount = selectedEntryIds.length;
  const submittedWeekCount = submittedWeekEntryIds.size;
  const selectedDurationMs = useMemo(
    () =>
      enrichedEntries.reduce(
        (sum, entry) => sum + (selectedEntryIdSet.has(entry.entry._id) ? entry.entry.durationMs : 0),
        0,
      ),
    [enrichedEntries, selectedEntryIdSet],
  );
  const weekCapacityMs = Object.values(
    state.userPreferences.weeklyCapacityTargets,
  ).reduce((sum, value) => sum + value, 0);
  const loggedWeekDurationMs = useMemo(
    () =>
      state.timesheetEntries
        .filter((entry) => weekDateSet.has(entry.localDate))
        .reduce((sum, entry) => sum + entry.durationMs, 0),
    [state.timesheetEntries, weekDateSet],
  );
  const primaryCountLabel =
    viewMode === "task"
      ? formatCountLabel(taskRows.length, "task", "tasks")
      : formatCountLabel(daySections.length, "day", "days");

  useEffect(() => {
    const nextVisibleEntryIdSet = new Set(visibleEntryIds);
    setSelectedEntryIds((current) => {
      const nextSelectedIds = current.filter((entryId) => nextVisibleEntryIdSet.has(entryId));
      if (!initializedSelectionRef.current) {
        initializedSelectionRef.current = true;
        return visibleEntryIds;
      }

      if (
        nextSelectedIds.length === current.length &&
        nextSelectedIds.every((entryId, index) => entryId === current[index])
      ) {
        return current;
      }

      return nextSelectedIds;
    });
  }, [visibleEntryIds, visibleEntryIdsKey]);

  useEffect(() => {
    function handleMouseDown(event: MouseEvent) {
      if (filterRef.current && event.target instanceof Node && !filterRef.current.contains(event.target)) {
        setIsFilterOpen(false);
      }

      if (overlayRef.current === event.target) {
        onClose();
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        if (isFilterOpen) {
          setIsFilterOpen(false);
          return;
        }

        onClose();
      }
    }

    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isFilterOpen, onClose]);

  function replaceSelection(nextEntryIds: string[]) {
    const nextIdSet = new Set(nextEntryIds);
    setSelectedEntryIds(visibleEntryIds.filter((entryId) => nextIdSet.has(entryId)));
  }

  function setEntrySelection(entryIds: string[], checked: boolean) {
    const entryIdSet = new Set(entryIds);
    setSelectedEntryIds((current) => {
      const nextSelectedSet = new Set(
        checked ? [...current, ...entryIds] : current.filter((entryId) => !entryIdSet.has(entryId)),
      );
      return visibleEntryIds.filter((entryId) => nextSelectedSet.has(entryId));
    });
  }

  function getSelectionState(entryIds: string[]) {
    const selectedCountForGroup = entryIds.filter((entryId) => selectedEntryIdSet.has(entryId)).length;
    return {
      checked: entryIds.length > 0 && selectedCountForGroup === entryIds.length,
      indeterminate: selectedCountForGroup > 0 && selectedCountForGroup < entryIds.length,
    };
  }

  function handleSubmit() {
    if (selectedEntryIds.length === 0) {
      return;
    }

    if (
      state.userPreferences.warnWhenSubmittingUnderCapacity &&
      weekCapacityMs > 0 &&
      loggedWeekDurationMs < weekCapacityMs
    ) {
      setIsUnderTargetWarningOpen(true);
      return;
    }

    localStore.markTimesheetEntriesSubmitted(selectedEntryIds);
  }

  function confirmSubmit() {
    localStore.markTimesheetEntriesSubmitted(selectedEntryIds);
    setIsUnderTargetWarningOpen(false);
  }

  function renderTimeHover(collection: EntryCollection, cellLabel: string, triggerClassName: string) {
    const commentSummary = collection.comments.length > 0 ? collection.comments.join(" || ") : "No comments";
    const durationLabel = formatClockDuration(collection.durationMs);

    return (
      <HoverCard>
        <HoverCardTrigger
          className={triggerClassName}
          aria-label={`${cellLabel} time details`}
        >
          {durationLabel}
        </HoverCardTrigger>
        <HoverCardContent
          className="submit-timesheet-comment-card"
          positionerClassName="submit-timesheet-comment-card-positioner"
          side="top"
          align="center"
        >
          <CopyHoverRow label="Project" value={collection.projectName} />
          <CopyHoverRow label="Task" value={collection.taskLabel} />
          {collection.taskBillableLabel ? (
            <CopyHoverRow
              label="Billable"
              value={collection.taskBillableLabel}
            />
          ) : null}
          <CopyHoverRow label="Time" value={durationLabel} />
          <CopyHoverRow label="Comments" value={commentSummary} />
        </HoverCardContent>
      </HoverCard>
    );
  }

  function renderTaskCell(cell: TaskCell, rowLabel: string) {
    if (cell.entryIds.length === 0) {
      return <span className="submit-timesheet-task-cell-empty">-</span>;
    }

    const selectionState = getSelectionState(cell.entryIds);
    const triggerClassName = cn(
      "submit-timesheet-task-cell-trigger",
      selectionState.checked && "is-selected",
      selectionState.indeterminate && "is-partial",
    );

    return renderTimeHover(cell, rowLabel, triggerClassName);
  }

  return (
    <div ref={overlayRef} className="time-entry-modal-overlay submit-timesheet-modal-overlay">
      <div className="submit-timesheet-modal">
        <div className="submit-timesheet-modal-header">
          <div className="submit-timesheet-modal-title-wrap">
            <span className="submit-timesheet-modal-title">Submit timesheet</span>
            <span className="submit-timesheet-modal-subtitle">Review and select the current week&apos;s unsubmitted entries.</span>
          </div>
          <button type="button" className="time-entry-modal-close" onClick={onClose} aria-label="Close submit timesheet modal">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="submit-timesheet-toolbar">
          <div className="submit-timesheet-toolbar-head">
            <div className="submit-timesheet-toolbar-copy">
              <span className="submit-timesheet-toolbar-label">Week of {formatWeekRange(weekDates)}</span>
              <span className="submit-timesheet-toolbar-value">
                {selectedCount} selected · {formatClockDuration(selectedDurationMs)}
              </span>
            </div>
          </div>

          <div className="submit-timesheet-toolbar-badges">
            <span className="submit-timesheet-toolbar-badge">{formatCountLabel(visibleEntryIds.length, "unsubmitted entry", "unsubmitted entries")}</span>
            <span className="submit-timesheet-toolbar-badge">{formatCountLabel(submittedWeekCount, "submitted", "submitted")}</span>
            <span className="submit-timesheet-toolbar-badge">{primaryCountLabel}</span>
          </div>

          <div className="submit-timesheet-toolbar-footer">
            <div className="submit-timesheet-toolbar-actions">
              <Button
                variant="outline"
                size="sm"
                disabled={visibleEntryIds.length === 0}
                onClick={() => replaceSelection(visibleEntryIds)}
              >
                Select All
              </Button>
              <Button variant="outline" size="sm" disabled={selectedEntryIds.length === 0} onClick={() => replaceSelection([])}>
                Clear Selection
              </Button>
            </div>

            <div ref={filterRef} className="submit-timesheet-filter">
              <Button
                variant="ghost"
                size="icon-sm"
                className="submit-timesheet-filter-trigger"
                aria-label="Open submit view options"
                aria-expanded={isFilterOpen}
                onClick={() => setIsFilterOpen((current) => !current)}
              >
                <Filter />
              </Button>

              {isFilterOpen ? (
                <div className="submit-timesheet-filter-menu" role="dialog" aria-label="Submit view options">
                  <fieldset className="submit-timesheet-option-group">
                    <legend className="submit-timesheet-option-group-label">View</legend>
                    <label
                      className="submit-timesheet-option-row"
                      htmlFor="submit-timesheet-view-day"
                      onClick={() => {
                        setViewMode("day");
                        setIsFilterOpen(false);
                      }}
                    >
                      <input
                        id="submit-timesheet-view-day"
                        type="radio"
                        value="day"
                        name="submit-timesheet-view"
                        className="submit-timesheet-option-radio"
                        checked={viewMode === "day"}
                        onChange={() => {
                          setViewMode("day");
                          setIsFilterOpen(false);
                        }}
                      />
                      <span>By day</span>
                    </label>
                    <label
                      className="submit-timesheet-option-row"
                      htmlFor="submit-timesheet-view-task"
                      onClick={() => {
                        setViewMode("task");
                        setIsFilterOpen(false);
                      }}
                    >
                      <input
                        id="submit-timesheet-view-task"
                        type="radio"
                        value="task"
                        name="submit-timesheet-view"
                        className="submit-timesheet-option-radio"
                        checked={viewMode === "task"}
                        onChange={() => {
                          setViewMode("task");
                          setIsFilterOpen(false);
                        }}
                      />
                      <span>By task</span>
                    </label>
                  </fieldset>
                  <div className="submit-timesheet-filter-divider" />
                  <fieldset className="submit-timesheet-option-group">
                    <legend className="submit-timesheet-option-group-label">Grouping</legend>
                    <label
                      className={cn("submit-timesheet-option-row", viewMode === "task" && "is-disabled")}
                      htmlFor="submit-timesheet-grouping-single"
                      onClick={() => {
                        if (viewMode !== "task") {
                          setGroupingMode("single");
                          setIsFilterOpen(false);
                        }
                      }}
                    >
                      <input
                        id="submit-timesheet-grouping-single"
                        type="radio"
                        value="single"
                        name="submit-timesheet-grouping"
                        className="submit-timesheet-option-radio"
                        checked={activeGroupingMode === "single"}
                        onChange={() => {
                          setGroupingMode("single");
                          setIsFilterOpen(false);
                        }}
                        disabled={viewMode === "task"}
                      />
                      <span>Single</span>
                    </label>
                    <label
                      className={cn("submit-timesheet-option-row", viewMode === "task" && "is-disabled")}
                      htmlFor="submit-timesheet-grouping-grouped"
                      onClick={() => {
                        if (viewMode !== "task") {
                          setGroupingMode("grouped");
                          setIsFilterOpen(false);
                        }
                      }}
                    >
                      <input
                        id="submit-timesheet-grouping-grouped"
                        type="radio"
                        value="grouped"
                        name="submit-timesheet-grouping"
                        className="submit-timesheet-option-radio"
                        checked={activeGroupingMode === "grouped"}
                        onChange={() => {
                          setGroupingMode("grouped");
                          setIsFilterOpen(false);
                        }}
                        disabled={viewMode === "task"}
                      />
                      <span>Grouped</span>
                    </label>
                  </fieldset>
                  {viewMode === "task" ? (
                    <div className="submit-timesheet-filter-note">
                      Grouping stays merged in the by-task view.
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
        </div>

        <div className="submit-timesheet-content">
          <div className="submit-timesheet-groups">
            {viewMode === "task" ? (
              taskRows.length === 0 ? (
                <div className="submit-timesheet-empty">
                  All entries in this week are already submitted.
                </div>
              ) : (
                <div className="submit-timesheet-task-table-shell">
                  <Table className="submit-timesheet-task-table">
                    <TableHeader>
                      <TableRow>
                        <TableHead className="submit-timesheet-task-main-head">Task</TableHead>
                        {weekDates.map((localDate) => (
                          <TableHead key={localDate} className="submit-timesheet-task-day-head">
                            {formatDayColumnHeading(localDate)}
                          </TableHead>
                        ))}
                        <TableHead className="submit-timesheet-task-total-head">Total</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {taskRows.map((row) => {
                        const selectionState = getSelectionState(row.entryIds);
                        const rowLabel = `${row.projectName} ${row.taskLabel}`.trim();

                        return (
                          <TableRow key={row.taskKey}>
                            <TableCell className="submit-timesheet-task-main-cell">
                              <div className="submit-timesheet-task-main">
                                <SelectionCheckbox
                                  checked={selectionState.checked}
                                  indeterminate={selectionState.indeterminate}
                                  onChange={(checked) => setEntrySelection(row.entryIds, checked)}
                                  ariaLabel={`Select ${rowLabel}`}
                                />
                                <div className="submit-timesheet-task-copy">
                                  <div className="submit-timesheet-entry-primary">
                                    <ProjectIcon
                                      icon={row.projectIcon}
                                      color={row.projectColor}
                                      className="entry-project-dot"
                                      fallback="dot"
                                    />
                                    <span className="submit-timesheet-entry-project">{row.projectName}</span>
                                  </div>
                                  <div className="submit-timesheet-entry-secondary" title={row.taskLabel}>
                                    {truncateLabel(row.taskLabel)}
                                  </div>
                                </div>
                              </div>
                            </TableCell>
                            {row.cells.map((cell) => (
                              <TableCell key={`${row.taskKey}-${cell.localDate}`} className="submit-timesheet-task-day-cell">
                                {renderTaskCell(cell, rowLabel)}
                              </TableCell>
                            ))}
                            <TableCell className="submit-timesheet-task-total-cell">{formatClockDuration(row.durationMs)}</TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )
            ) : daySections.length === 0 ? (
              <div className="submit-timesheet-empty">
                All entries in this week are already submitted.
              </div>
            ) : (
              daySections.map((group) => {
                const selectionState = getSelectionState(group.entryIds);

                return (
                  <section key={group.localDate} className="submit-timesheet-group">
                    <div className="submit-timesheet-group-header">
                      <div className="submit-timesheet-group-main">
                        <div className="submit-timesheet-group-copy">
                          <h3 className="submit-timesheet-group-title">{formatDayHeading(group.localDate)}</h3>
                          <p className="submit-timesheet-group-meta">
                            {formatCountLabel(group.entryIds.length, "entry", "entries")} · {formatClockDuration(group.totalMs)}
                          </p>
                        </div>
                      </div>

                      <div className="submit-timesheet-group-actions">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={selectionState.checked}
                          onClick={() => setEntrySelection(group.entryIds, true)}
                        >
                          Check All
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={!selectionState.checked && !selectionState.indeterminate}
                          onClick={() => setEntrySelection(group.entryIds, false)}
                        >
                          Uncheck All
                        </Button>
                      </div>
                    </div>

                    <div className="submit-timesheet-entry-list">
                      {group.rows.map((row, index) => {
                        const rowSelectionState = getSelectionState(row.entryIds);
                        const noteSummary = formatCommentSummary(row.comments);

                        return (
                          <div key={`${group.localDate}-${row.taskKey}-${index}`} className={cn("submit-timesheet-entry", rowSelectionState.checked && "is-selected")}>
                            <SelectionCheckbox
                              checked={rowSelectionState.checked}
                              indeterminate={rowSelectionState.indeterminate}
                              onChange={(checked) => setEntrySelection(row.entryIds, checked)}
                              ariaLabel={`Select ${row.projectName} ${row.taskLabel}`.trim()}
                            />
                            <div className="submit-timesheet-entry-body">
                              <div className="submit-timesheet-entry-primary">
                                <ProjectIcon
                                  icon={row.projectIcon}
                                  color={row.projectColor}
                                  className="entry-project-dot"
                                  fallback="dot"
                                />
                                <span className="submit-timesheet-entry-project">{row.projectName}</span>
                              </div>
                              <div className="submit-timesheet-entry-secondary" title={row.taskLabel}>
                                {row.taskLabel}
                              </div>
                              {noteSummary ? <div className="submit-timesheet-entry-note">{noteSummary}</div> : null}
                            </div>
                            {renderTimeHover(
                              row,
                              `${row.projectName} ${row.taskLabel}`.trim(),
                              "submit-timesheet-entry-hours",
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </section>
                );
              })
            )}
          </div>
        </div>

        <div className="submit-timesheet-modal-actions">
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          <Button onClick={handleSubmit} disabled={selectedEntryIds.length === 0}>
            Submit
          </Button>
        </div>
      </div>
      <AlertDialog
        open={isUnderTargetWarningOpen}
        onOpenChange={setIsUnderTargetWarningOpen}
      >
        <AlertDialogContent
          className="z-[240]"
          overlayClassName="z-[230]"
        >
          <AlertDialogHeader>
            <AlertDialogTitle>Submit below the week target?</AlertDialogTitle>
            <AlertDialogDescription>
              This week has {formatClockDuration(loggedWeekDurationMs)} logged against a {formatClockDuration(weekCapacityMs)} target. You can continue without changing the selected entries.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Review</AlertDialogCancel>
            <AlertDialogAction onClick={confirmSubmit}>Submit anyway</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
