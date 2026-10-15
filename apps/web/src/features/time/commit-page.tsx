import { useEffect, useMemo, useRef, useState } from "react";
import {
  RiArrowLeftLine as ArrowLeft,
  RiCheckLine as Check,
  RiErrorWarningLine as Warning,
  RiFileCopyLine as Copy,
} from "@remixicon/react";
import { useNavigate } from "@tanstack/react-router";
import { PageHeader } from "@/components/page-header";
import { SectionHeading } from "@/components/section-heading";
import { TooltipButton } from "@/components/tooltip-button";
import { Button } from "@/components/ui/button";
import { Empty, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Value } from "@/components/ui/value";
import {
  formatClockDuration,
  formatDecimalHours,
} from "@/domain/time/duration";
import { listWeekChanges } from "@/domain/time/timesheet-commit";
import {
  groupSubmitLines,
  summarizeWeek,
  type SubmitGroupBy,
  type SubmitLine,
  type SubmitWarning,
} from "@/domain/time/timesheet-submission";
import type { LocalProjectIcon } from "@/domain/projects/project-icon";
import {
  AgentTaskButtons,
  AgentTaskWeekLinks,
} from "@/features/agents/agent-task-buttons";
import { offerUndo } from "@/features/feedback/undo-toast";
import {
  CommitChangeList,
  formatShortDay,
} from "@/features/time/commit-changes";
import { copyTextToClipboard } from "@/lib/clipboard";
import {
  resetCheckedChanges,
  setChangesChecked,
  useUncheckedChangeIds,
} from "@/lib/commit-selection";
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
      className={cn("submit-copy", className)}
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
        <Check aria-hidden className="is-copied" />
      ) : (
        <Copy aria-hidden />
      )}
    </button>
  );
}

function SubmitLineRow({
  line,
  projectColor,
  projectIcon,
}: {
  line: SubmitLine;
  projectColor?: string;
  projectIcon?: LocalProjectIcon;
}) {
  return (
    <li className="submit-line">
      <div className="submit-line-main">
        <ProjectIcon
          icon={projectIcon}
          color={projectColor ?? "var(--text-tertiary)"}
          className="submit-line-dot"
          fallback="dot"
        />
        <CopyValue
          label="project"
          text={line.projectName}
          placeholder="No project"
        />
        <span aria-hidden className="submit-line-sep">
          /
        </span>
        <CopyValue label="task" text={line.taskName} placeholder="No task" />
      </div>
      <CopyValue
        label="hours"
        text={formatClockDuration(line.durationMs)}
        copyValue={formatDecimalHours(line.durationMs)}
        placeholder=""
        className="submit-copy-hours"
      />
      <CopyValue
        label="comments"
        text={line.comments}
        placeholder="No comments"
        className="submit-line-comments"
      />
    </li>
  );
}

/**
 * The Commit page for the week that holds `date`: the changes since the last
 * commit, each with a checkbox, then the week's lines to copy into the
 * external timesheet. Mark as committed saves the checked changes.
 */
export function CommitPage({
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
  // Agents read the unchecked changes under the same Monday key.
  const weekOf = weekDates[0]!;
  const [groupBy, setGroupBy] = useState<SubmitGroupBy>("day-task");

  // Opening a week's page checks every change again.
  useEffect(() => resetCheckedChanges(weekOf), [weekOf]);
  const uncheckedIds = useUncheckedChangeIds(weekOf);

  const weekEntries = useMemo(() => {
    const weekDateSet = new Set(weekDates);
    return state.timesheetEntries.filter((entry) =>
      weekDateSet.has(entry.localDate),
    );
  }, [state.timesheetEntries, weekDates]);
  const changes = useMemo(
    () =>
      listWeekChanges({
        entries: state.timesheetEntries,
        tombstones: state.timesheetTombstones,
        weekDates,
      }),
    [state.timesheetEntries, state.timesheetTombstones, weekDates],
  );
  const checkedIds = useMemo(
    () =>
      changes
        .map((change) => change.entryId)
        .filter((entryId) => !uncheckedIds.has(entryId)),
    [changes, uncheckedIds],
  );
  const sections = useMemo(
    () =>
      groupSubmitLines({ entries: weekEntries, groupBy, projects, weekDates }),
    [groupBy, projects, weekDates, weekEntries],
  );
  const projectMap = useMemo(
    () => new Map(projects.map((project) => [project._id, project])),
    [projects],
  );
  const summary = useMemo(
    () =>
      summarizeWeek({
        capacityTargets: state.userPreferences.weeklyCapacityTargets,
        weekDates,
        weekEntries,
      }),
    [state.userPreferences.weeklyCapacityTargets, weekDates, weekEntries],
  );
  const progress =
    summary.targetMs > 0
      ? Math.min(100, (summary.totalMs / summary.targetMs) * 100)
      : 100;

  function markCommitted() {
    const count = checkedIds.length;
    offerUndo(localStore.markTimesheetEntriesCommitted(checkedIds), {
      title: `${count} ${count === 1 ? "change" : "changes"} committed`,
      subject: "entry",
    });
  }

  function goBack() {
    void navigate({
      to: "/time/$date",
      params: { date },
      search: { view: returnView } as never,
    });
  }

  const title = `Commit week of ${formatMonthDay(weekDates[0]!)} to ${formatMonthDay(weekDates[6]!)}`;

  return (
    <div className="commit-page">
      <PageHeader title={title}>
        <TooltipButton
          label={`Back to ${returnView === "week" ? "Week" : "Day"}`}
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              className="order-first -ml-1 text-muted-foreground"
              onClick={goBack}
            />
          }
        >
          <ArrowLeft />
        </TooltipButton>
      </PageHeader>

      <section aria-label="Week summary" className="submit-summary">
        <div className="submit-summary-total">
          <Value size="figure">{formatClockDuration(summary.totalMs)}</Value>
          <span className="text-sm text-muted-foreground">
            of {formatClockDuration(summary.targetMs)} this week
          </span>
        </div>
        <div
          role="progressbar"
          aria-label="Week total against target"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress)}
          className={cn("submit-progress", !summary.isUnderTarget && "is-met")}
        >
          <div style={{ width: `${progress}%` }} />
        </div>
        {summary.warnings.length > 0 ? (
          <ul className="submit-warnings">
            {summary.warnings.map((warning) => (
              <li
                key={
                  warning.kind === "missing-task"
                    ? warning.kind
                    : warning.localDate
                }
              >
                <Warning aria-hidden />
                {formatWarning(warning)}
              </li>
            ))}
          </ul>
        ) : null}
        <AgentTaskWeekLinks weekOf={weekOf} />
      </section>

      <section aria-labelledby="commit-changes-heading">
        <SectionHeading
          id="commit-changes-heading"
          trailing={
            changes.length > 0
              ? `${checkedIds.length} of ${changes.length} checked`
              : undefined
          }
        >
          Changes
        </SectionHeading>
        <CommitChangeList
          changes={changes}
          // Every project: a deleted entry may be on an archived one.
          projects={state.projects}
          uncheckedIds={uncheckedIds}
          onCheckedChange={(entryId, checked) =>
            setChangesChecked(weekOf, [entryId], checked)
          }
        />
      </section>

      <div
        role="group"
        aria-label="Commit actions"
        className="flex flex-wrap items-center gap-2 empty:hidden"
      >
        <AgentTaskButtons weekOf={weekOf} />
        {changes.length > 0 ? (
          <Button disabled={checkedIds.length === 0} onClick={markCommitted}>
            Mark as committed
          </Button>
        ) : null}
      </div>

      <section
        aria-labelledby="commit-lines-heading"
        className="flex flex-col gap-3"
      >
        <SectionHeading id="commit-lines-heading">Lines</SectionHeading>
        {weekEntries.length === 0 ? (
          <Empty align="start" className="px-0">
            <EmptyHeader>
              <EmptyTitle>No entries this week.</EmptyTitle>
            </EmptyHeader>
          </Empty>
        ) : (
          <>
            <div className="submit-toolbar">
              <div className="flex items-center gap-2">
                <span
                  id="commit-group-by-label"
                  className="submit-toolbar-label"
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
                  aria-labelledby="commit-group-by-label"
                >
                  {GROUP_BY_OPTIONS.map((option) => (
                    <ToggleGroupItem key={option.value} value={option.value}>
                      {option.label}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </div>
            </div>

            <div>
              {sections.map((section) => (
                <section
                  key={section.key}
                  aria-label={
                    section.localDate
                      ? formatLongDay(section.localDate)
                      : "Week"
                  }
                >
                  {section.localDate ? (
                    <SectionHeading>
                      {formatLongDay(section.localDate)}
                    </SectionHeading>
                  ) : null}
                  <ul className="submit-lines">
                    {section.lines.map((line) => {
                      const project = line.projectId
                        ? projectMap.get(line.projectId)
                        : undefined;
                      return (
                        <SubmitLineRow
                          key={line.key}
                          line={line}
                          projectColor={project?.color}
                          projectIcon={project?.icon}
                        />
                      );
                    })}
                  </ul>
                </section>
              ))}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
