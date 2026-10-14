import { useEffect, useMemo, useRef, useState } from "react";
import {
  RiArrowLeftLine as ArrowLeft,
  RiCheckLine as Check,
  RiErrorWarningLine as Warning,
  RiFileCopyLine as Copy,
} from "@remixicon/react";
import { useNavigate } from "@tanstack/react-router";
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
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  formatClockDuration,
  formatDecimalHours,
} from "@/domain/time/duration";
import {
  getSubmitButtonLabel,
  getSubmitSelectionState,
  getSubmitWeekStatus,
  groupSubmitLines,
  reconcileSubmitSelection,
  setSubmitSelection,
  summarizeSubmitSelection,
  type SubmitGroupBy,
  type SubmitLine,
  type SubmitWarning,
  type SubmitWeekStatus,
} from "@/domain/time/timesheet-submission";
import type { LocalProjectIcon } from "@/domain/projects/project-icon";
import { copyTextToClipboard } from "@/lib/clipboard";
import { useLocalProjects, useLocalState } from "@/lib/local-hooks";
import { localStore } from "@/lib/local-store";
import { ProjectIcon } from "@/lib/project-icons";
import { cn, getIsoWeekDates } from "@/lib/utils";

const GROUP_BY_OPTIONS: { value: SubmitGroupBy; label: string }[] = [
  { value: "day-task", label: "Day and task" },
  { value: "day", label: "Day" },
  { value: "task", label: "Task" },
];

function dateAtNoon(localDate: string) {
  return new Date(`${localDate}T12:00:00`);
}

/** "Tue 6". Intl orders weekday and day as "6 Tue" in en-US. */
function formatShortDay(localDate: string) {
  const date = dateAtNoon(localDate);
  const weekday = new Intl.DateTimeFormat("en-US", { weekday: "short" }).format(
    date,
  );
  return `${weekday} ${date.getDate()}`;
}

function formatLongDay(localDate: string) {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
  }).format(dateAtNoon(localDate));
}

function formatMonthDay(localDate: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(dateAtNoon(localDate));
}

function formatSubmittedAt(timestamp: number) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(timestamp);
}

function countLabel(count: number, singular: string, plural: string) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function formatWarning(warning: SubmitWarning) {
  if (warning.kind === "missing-task") {
    return `${countLabel(warning.entryCount, "entry has", "entries have")} no task`;
  }
  return `${formatShortDay(warning.localDate)} has ${formatClockDuration(warning.loggedMs)} of ${formatClockDuration(warning.targetMs)}`;
}

/**
 * A value that copies itself. The icon is always visible, and a checkmark
 * replaces it for a second after copying. `copyValue` differs from the shown
 * text for hours, which show clock time and copy decimals.
 */
function CopyValue({
  label,
  text,
  copyValue = text,
  placeholder,
  className,
}: {
  label: string;
  text?: string;
  copyValue?: string;
  placeholder: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const resetRef = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(resetRef.current), []);

  if (!text || !copyValue) {
    return (
      <span className={cn("px-1 text-muted-foreground", className)}>
        {placeholder}
      </span>
    );
  }

  return (
    <button
      type="button"
      aria-label={`Copy ${label}: ${copyValue}`}
      title={`Copy ${copyValue}`}
      className={cn(
        "inline-flex max-w-full min-w-0 items-start gap-1 rounded-[var(--control-radius)] px-1 py-0.5 text-left outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/30",
        className,
      )}
      onClick={() => {
        void copyTextToClipboard(copyValue).then((ok) => {
          if (!ok) return;
          setCopied(true);
          window.clearTimeout(resetRef.current);
          resetRef.current = window.setTimeout(() => setCopied(false), 1000);
        });
      }}
    >
      <span className="min-w-0 break-words">{text}</span>
      {copied ? (
        <Check
          aria-hidden
          className="mt-0.5 size-3.5 shrink-0 text-[var(--success)]"
        />
      ) : (
        <Copy
          aria-hidden
          className="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
        />
      )}
    </button>
  );
}

function SubmitLineRow({
  line,
  dayLabel,
  projectColor,
  projectIcon,
  selection,
  onSelectionChange,
}: {
  line: SubmitLine;
  dayLabel?: string;
  projectColor?: string;
  projectIcon?: LocalProjectIcon;
  /** Undefined when the line is read-only, after the week is submitted. */
  selection?: "all" | "some" | "none";
  onSelectionChange: (include: boolean) => void;
}) {
  const lineName = [line.projectName, line.taskName, dayLabel]
    .filter(Boolean)
    .join(", ");

  return (
    <li
      className={cn(
        "grid grid-cols-[1rem_minmax(0,1fr)_auto] items-start gap-x-2 gap-y-0.5 px-3 py-2",
        selection === "none" && "opacity-60",
      )}
    >
      <div className="pt-1">
        {selection ? (
          <Checkbox
            checked={selection === "all"}
            indeterminate={selection === "some"}
            aria-label={`Include ${lineName || "entry"}`}
            onCheckedChange={(checked) => onSelectionChange(checked)}
          />
        ) : null}
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-x-1 text-sm">
        <ProjectIcon
          icon={projectIcon}
          color={projectColor ?? "var(--text-tertiary)"}
          className="entry-project-dot"
          fallback="dot"
        />
        <CopyValue
          label="project"
          text={line.projectName}
          placeholder="No project"
        />
        <span aria-hidden className="text-muted-foreground">
          /
        </span>
        <CopyValue label="task" text={line.taskName} placeholder="No task" />
      </div>
      <CopyValue
        label="hours"
        text={formatClockDuration(line.durationMs)}
        copyValue={formatDecimalHours(line.durationMs)}
        placeholder=""
        className="font-mono text-sm font-semibold tabular-nums"
      />
      <CopyValue
        label="comments"
        text={line.comments}
        placeholder="No comments"
        className="col-start-2 col-end-4 justify-self-start text-xs text-[var(--text-secondary)]"
      />
    </li>
  );
}

function StatusLine({ status }: { status: SubmitWeekStatus }) {
  if (status.kind === "not-submitted") {
    return null;
  }

  if (status.kind === "changed") {
    return (
      <p className="text-sm">
        {countLabel(status.changedEntryIds.length, "entry", "entries")} changed
        since you submitted
      </p>
    );
  }

  return (
    <p
      role="status"
      className="flex items-start gap-2 rounded-[var(--radius-sm)] border border-[var(--success-ring)] bg-[var(--success-bg)] px-3 py-2 text-sm"
    >
      <Check
        aria-hidden
        className="mt-0.5 size-4 shrink-0 text-[var(--success)]"
      />
      <span>
        {status.kind === "submitted" ? "Week submitted" : "Partly submitted"} on{" "}
        {formatSubmittedAt(status.submittedAt)}
        <span className="text-muted-foreground">
          {" "}
          · {countLabel(status.entryCount, "entry", "entries")} ·{" "}
          {formatClockDuration(status.totalMs)}
        </span>
      </span>
    </p>
  );
}

/**
 * The submit page for the week that holds `date`. The user copies each line
 * into the external timesheet, then marks the selected entries as submitted.
 */
export function SubmitPage({
  date,
  returnView,
}: {
  date: string;
  /** The Time view to return to. */
  returnView?: "week";
}) {
  const navigate = useNavigate();
  const state = useLocalState();
  const projects = useLocalProjects();
  const weekDates = useMemo(() => getIsoWeekDates(date), [date]);
  const [groupBy, setGroupBy] = useState<SubmitGroupBy>("day-task");
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);

  const weekEntries = useMemo(() => {
    const weekDateSet = new Set(weekDates);
    return state.timesheetEntries.filter((entry) =>
      weekDateSet.has(entry.localDate),
    );
  }, [state.timesheetEntries, weekDates]);
  const selectableEntries = useMemo(
    () => weekEntries.filter((entry) => entry.submittedAt === undefined),
    [weekEntries],
  );
  const selectableIds = useMemo(
    () => selectableEntries.map((entry) => entry._id),
    [selectableEntries],
  );
  // Once nothing is left to submit, the lines stay as a read-only copy source.
  const isReadOnly = selectableEntries.length === 0;

  const [selectedIds, setSelectedIds] = useState(
    () => new Set<string>(selectableIds),
  );
  const knownSelectableIdsRef = useRef(new Set(selectableIds));
  useEffect(() => {
    setSelectedIds((current) =>
      reconcileSubmitSelection(
        current,
        knownSelectableIdsRef.current,
        selectableIds,
      ),
    );
    knownSelectableIdsRef.current = new Set(selectableIds);
  }, [selectableIds]);

  const sections = useMemo(
    () =>
      groupSubmitLines({
        entries: weekEntries,
        groupBy,
        onlyUnsubmitted: !isReadOnly,
        projects,
        weekDates,
      }),
    [groupBy, isReadOnly, projects, weekDates, weekEntries],
  );
  const projectMap = useMemo(
    () => new Map(projects.map((project) => [project._id, project])),
    [projects],
  );
  const status = useMemo(() => getSubmitWeekStatus(weekEntries), [weekEntries]);
  const summary = useMemo(
    () =>
      summarizeSubmitSelection({
        capacityTargets: state.userPreferences.weeklyCapacityTargets,
        selectedIds,
        weekDates,
        weekEntries,
      }),
    [
      selectedIds,
      state.userPreferences.weeklyCapacityTargets,
      weekDates,
      weekEntries,
    ],
  );
  const progress =
    summary.targetMs > 0
      ? Math.min(100, (summary.totalMs / summary.targetMs) * 100)
      : 100;

  function changeSelection(entryIds: string[], include: boolean) {
    setSelectedIds((current) => setSubmitSelection(current, entryIds, include));
  }

  function markSelected() {
    localStore.markTimesheetEntriesSubmitted([...selectedIds]);
    setIsConfirmOpen(false);
  }

  function handleMark() {
    if (selectedIds.size === 0) {
      return;
    }
    if (
      state.userPreferences.warnWhenSubmittingUnderCapacity &&
      summary.isUnderTarget
    ) {
      setIsConfirmOpen(true);
      return;
    }
    markSelected();
  }

  function goBack() {
    void navigate({
      to: "/time/$date",
      params: { date },
      search: { view: returnView } as never,
    });
  }

  return (
    <div className="mx-auto flex w-full max-w-[1100px] flex-col gap-4 p-4">
      <header className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" onClick={goBack}>
          <ArrowLeft data-icon="inline-start" />
          {returnView === "week" ? "Week" : "Day"}
        </Button>
        <h1 className="text-base font-semibold">
          Submit week of {formatMonthDay(weekDates[0]!)} to{" "}
          {formatMonthDay(weekDates[6]!)}
        </h1>
      </header>

      <div className="grid items-start gap-4 desktop:grid-cols-[300px_minmax(0,1fr)]">
        <section
          aria-label="Week summary"
          className="flex flex-col gap-3 rounded-[var(--radius-md)] border border-border p-4 desktop:sticky desktop:top-4"
        >
          <span className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            This week
          </span>
          <p className="font-mono text-3xl font-semibold tabular-nums">
            {formatClockDuration(summary.totalMs)}
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              of {formatClockDuration(summary.targetMs)}
            </span>
          </p>
          <div
            role="progressbar"
            aria-label="Week total against target"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(progress)}
            className="h-2 overflow-hidden rounded-full bg-muted"
          >
            <div
              className={cn(
                "h-full",
                summary.isUnderTarget ? "bg-primary" : "bg-[var(--success)]",
              )}
              style={{ width: `${progress}%` }}
            />
          </div>
          {summary.warnings.length > 0 ? (
            <ul className="flex flex-col gap-1 text-xs text-destructive">
              {summary.warnings.map((warning) => (
                <li
                  key={
                    warning.kind === "missing-task"
                      ? warning.kind
                      : warning.localDate
                  }
                  className="flex items-center gap-1.5"
                >
                  <Warning aria-hidden className="size-3.5 shrink-0" />
                  {formatWarning(warning)}
                </li>
              ))}
            </ul>
          ) : null}
          <StatusLine status={status} />
          {isReadOnly ? (
            weekEntries.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No entries this week.
              </p>
            ) : null
          ) : (
            <Button disabled={selectedIds.size === 0} onClick={handleMark}>
              {getSubmitButtonLabel(status, selectedIds)}
            </Button>
          )}
        </section>

        <div className="flex min-w-0 flex-col gap-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <div className="flex items-center gap-2">
              <span
                id="submit-group-by-label"
                className="text-xs text-muted-foreground"
              >
                Group by
              </span>
              <ToggleGroup
                value={[groupBy]}
                onValueChange={(values: unknown[]) => {
                  const next = GROUP_BY_OPTIONS.find(
                    (option) => option.value === values[0],
                  );
                  if (next) setGroupBy(next.value);
                }}
                variant="outline"

                aria-labelledby="submit-group-by-label"
              >
                {GROUP_BY_OPTIONS.map((option) => (
                  <ToggleGroupItem key={option.value} value={option.value}>
                    {option.label}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </div>

            {isReadOnly ? null : (
              <div
                role="group"
                aria-label="Days to submit"
                className="flex flex-wrap gap-1"
              >
                {weekDates.map((localDate) => {
                  const dayIds = selectableEntries
                    .filter((entry) => entry.localDate === localDate)
                    .map((entry) => entry._id);
                  const dayState = getSubmitSelectionState(selectedIds, dayIds);
                  return (
                    <Button
                      key={localDate}
                      variant={dayState === "all" ? "secondary" : "outline"}
                      size="sm"
                      disabled={dayIds.length === 0}
                      aria-pressed={
                        dayState === "some" ? "mixed" : dayState === "all"
                      }
                      aria-label={formatLongDay(localDate)}
                      className={cn(
                        dayState === "some" && "border-dashed border-border",
                      )}
                      onClick={() =>
                        changeSelection(dayIds, dayState !== "all")
                      }
                    >
                      {formatShortDay(localDate)}
                    </Button>
                  );
                })}
              </div>
            )}
          </div>

          {sections.map((section) => (
            <section
              key={section.key}
              aria-label={
                section.localDate ? formatLongDay(section.localDate) : "Week"
              }
              className="rounded-[var(--radius-md)] border border-border"
            >
              {section.localDate ? (
                <h2 className="border-b border-border px-3 py-2 text-xs font-semibold text-muted-foreground">
                  {formatLongDay(section.localDate)}
                </h2>
              ) : null}
              <ul className="divide-y divide-border">
                {section.lines.map((line) => {
                  const project = line.projectId
                    ? projectMap.get(line.projectId)
                    : undefined;
                  return (
                    <SubmitLineRow
                      key={line.key}
                      line={line}
                      dayLabel={
                        section.localDate
                          ? formatShortDay(section.localDate)
                          : undefined
                      }
                      projectColor={project?.color}
                      projectIcon={project?.icon}
                      selection={
                        isReadOnly
                          ? undefined
                          : getSubmitSelectionState(
                              selectedIds,
                              line.unsubmittedEntryIds,
                            )
                      }
                      onSelectionChange={(include) =>
                        changeSelection(line.unsubmittedEntryIds, include)
                      }
                    />
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      </div>

      <AlertDialog open={isConfirmOpen} onOpenChange={setIsConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Submit below the week target?</AlertDialogTitle>
            <AlertDialogDescription>
              This week has {formatClockDuration(summary.totalMs)} against a{" "}
              {formatClockDuration(summary.targetMs)} target.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Review</AlertDialogCancel>
            <AlertDialogAction onClick={markSelected}>
              Submit anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
