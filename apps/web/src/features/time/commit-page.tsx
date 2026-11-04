import { useEffect, useMemo, useRef, useState } from "react";
import {
  RiArrowLeftLine as ArrowLeft,
  RiArrowRightSLine as ChevronIcon,
  RiCheckLine as Check,
  RiErrorWarningLine as Warning,
  RiFileCopyLine as Copy,
  RiLockLine as Lock,
  RiLockUnlockLine as Unlock,
  RiTimeLine as Ahead,
} from "@remixicon/react";
import { Link, useNavigate } from "@tanstack/react-router";
import { DisabledReason } from "@/components/disabled-reason";
import { PageHeader } from "@/components/page-header";
import { SectionHeading } from "@/components/section-heading";
import { TooltipButton } from "@/components/tooltip-button";
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
import { Empty, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { showToast } from "@/components/ui/toast";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Value } from "@/components/ui/value";
import {
  formatClockDuration,
  formatDecimalHours,
} from "@/domain/time/duration";
import {
  getLockedWeek,
  getSubmitWeekRefusal,
  type SubmitWeekRefusal,
} from "@/domain/time/locked-weeks";
import { listWeekChanges } from "@/domain/time/timesheet-commit";
import {
  buildCommitLines,
  describeLineNames,
  listLineNameSources,
  resolveLineNameSource,
  summarizeWeek,
  type LineNames,
  type SubmitGroupBy,
  type SubmitLine,
  type SubmitWarning,
} from "@/domain/time/timesheet-submission";
import {
  computeWeekPace,
  getPaceTolerancePercent,
  needsPaceConfirmation,
  type WeekPace,
} from "@/domain/time/week-pace";
import {
  NO_PROPERTY_PLUGINS,
  type PropertyPlugins,
} from "@/domain/projects/plugin-properties";
import type { LocalProjectIcon } from "@/domain/projects/project-icon";
import {
  AgentTaskButtons,
  AgentTaskWeekLinks,
  AGENT_RUN_GOING_REASON,
  useAgentRunGoing,
  useAgentTaskPresence,
} from "@/features/agents/agent-task-buttons";
import { offerUndo } from "@/features/feedback/undo-toast";
import {
  CommitChangeList,
  CommitChangeStat,
  formatShortDay,
} from "@/features/time/commit-changes";
import { WeekLockChip } from "@/features/time/week-lock";
import { copyTextToClipboard } from "@/lib/clipboard";
import {
  setCommitChangesSection,
  useCommitChangesSection,
} from "@/lib/commit-changes-section";
import {
  resetCheckedChanges,
  setChangesChecked,
  useUncheckedChangeIds,
} from "@/lib/commit-selection";
import { useLocalState } from "@/lib/local-hooks";
import { localStore, runStoreCommandWith } from "@/lib/local-store";
import { listPropertyPlugins } from "@/lib/plugin-project-properties";
import { ProjectIcon } from "@/lib/project-icons";
import { cn, getIsoWeekDates, todayIsoDate } from "@/lib/utils";
import { useTodayIsoDate } from "@/lib/use-now";

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

const HOUR = 3_600_000;

/** Decimal hours as clock time, such as 4:00. */
function formatHours(hours: number) {
  return formatClockDuration(hours * HOUR);
}

/** The day a week was submitted, such as "Oct 16". */
function formatLockedDay(lockedAt: number) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(new Date(lockedAt));
}

/**
 * Why Submit week, or a plugin's submit task, is disabled: the short copy for
 * each refusal. A submitted week shows Reopen week instead.
 */
export function getSubmitButtonReason(
  refusal: SubmitWeekRefusal | undefined,
): string | undefined {
  if (refusal?.kind === "uncommitted-changes")
    return "Commit your changes first";
  if (refusal?.kind === "running-entry") return "Stop the running entry first";
  return undefined;
}

function countLabel(count: number, singular: string, plural: string) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function warningKey(warning: SubmitWarning) {
  if (warning.kind === "day-under-target") return warning.localDate;
  if (warning.kind === "waiting-task") return `waiting:${warning.taskId}`;
  if (warning.kind === "days-ahead") return "days-ahead";
  return warning.kind;
}

/** A warning's duration: the mono Value, in the list's muted tone. */
function WarningDuration({ ms }: { ms: number }) {
  return <Value tone="muted">{formatClockDuration(ms)}</Value>;
}

function formatWarning(warning: SubmitWarning) {
  if (warning.kind === "missing-task") {
    return `${countLabel(warning.entryCount, "entry has", "entries have")} no task`;
  }
  if (warning.kind === "waiting-task") {
    return (
      <>
        <WarningDuration ms={warning.durationMs} /> on {warning.taskName} waits
        for a task to commit as.
      </>
    );
  }
  if (warning.kind === "days-ahead") {
    const days =
      warning.fromDate === warning.toDate
        ? `${formatShortDay(warning.fromDate)} is`
        : `${formatShortDay(warning.fromDate)} – ${formatShortDay(warning.toDate)} are`;
    return (
      <>
        {days} still ahead: <WarningDuration ms={warning.remainingMs} /> of
        target left
      </>
    );
  }
  return (
    <>
      {formatShortDay(warning.localDate)} has{" "}
      <WarningDuration ms={warning.loggedMs} /> of{" "}
      <WarningDuration ms={warning.targetMs} />
    </>
  );
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

/**
 * One line: the project and task as one copy button ("Project / Task", copied
 * as "Project Task" for the timesheet's search box), then the hours and the
 * comments. `names` comes from `describeLineNames`.
 */
function SubmitLineRow({
  line,
  names,
  projectColor,
  projectIcon,
}: {
  line: SubmitLine;
  names?: LineNames;
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
        {names && "pending" in names ? (
          // The saved plugin names are loading: copy nothing rather than
          // Ajour's name.
          <span className="px-1 text-muted-foreground">Loading names…</span>
        ) : (
          <CopyValue
            label="project and task"
            text={names?.shown}
            copyValue={names?.copied}
            placeholder="No project or task"
          />
        )}
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
 * commit, each with a checkbox, under a heading that counts them by kind and
 * collapses them, saved per device, then the week's lines to copy into the
 * external timesheet. The Names switch picks Ajour's or a plugin's project
 * names for the lines, and is saved in the user preferences. Mark as committed
 * saves the checked changes. Submit week checks the pace, then locks the week;
 * a submitted week shows its lock and Reopen week instead.
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
  // Every project: a line may be on an archived one.
  const projects = state.projects;
  const weekDates = useMemo(() => getIsoWeekDates(date), [date]);
  // Agents read the unchecked changes under the same Monday key.
  const weekOf = weekDates[0]!;
  const [groupBy, setGroupBy] = useState<SubmitGroupBy>("day-task");
  // Saved per device, so a folded list stays folded on the next visit.
  const changesOpen = useCommitChangesSection() === "expanded";
  // Undefined until loaded, so a saved plugin choice waits instead of
  // showing Ajour's names first.
  const [plugins, setPlugins] = useState<PropertyPlugins>();
  const nameSources = useMemo(() => listLineNameSources(plugins), [plugins]);
  const nameSource = resolveLineNameSource(
    state.userPreferences.commitLinesNameSource,
    plugins,
  );

  useEffect(() => {
    let active = true;
    // A failed overview leaves only Ajour's names; the page works.
    void listPropertyPlugins()
      .then((next) => active && setPlugins(next))
      // The overview call's own event records the failure.
      .catch(() => {
        if (active) setPlugins(NO_PROPERTY_PLUGINS);
      });
    return () => {
      active = false;
    };
  }, []);

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
        projects,
        weekDates,
      }),
    [state.timesheetEntries, state.timesheetTombstones, projects, weekDates],
  );
  // A change on a Not known yet task is never checked: nobody commits it
  // under a temporary name.
  const checkedIds = useMemo(
    () =>
      changes
        .filter((change) => change.kind === "deleted" || !change.waiting)
        .map((change) => change.entryId)
        .filter((entryId) => !uncheckedIds.has(entryId)),
    [changes, uncheckedIds],
  );
  const sections = useMemo(
    () =>
      buildCommitLines({
        entries: weekEntries,
        groupBy,
        projects,
        weekDates,
      }),
    [groupBy, projects, weekDates, weekEntries],
  );
  const projectMap = useMemo(
    () => new Map(projects.map((project) => [project._id, project])),
    [projects],
  );
  // Refreshes at local midnight, so a day that arrives moves out of "still ahead".
  const today = useTodayIsoDate();
  const summary = useMemo(
    () =>
      summarizeWeek({
        capacityTargets: state.userPreferences.weeklyCapacityTargets,
        weekDates,
        weekEntries,
        projects,
        today,
      }),
    [
      state.userPreferences.weeklyCapacityTargets,
      weekDates,
      weekEntries,
      projects,
      today,
    ],
  );
  const submitTasks = useAgentTaskPresence("submit-week");
  const lockedWeek = getLockedWeek(state, weekOf);
  const submitReason = lockedWeek
    ? undefined
    : getSubmitButtonReason(getSubmitWeekRefusal(state, weekOf));
  // An agent run may submit the week itself. Locking it by hand meanwhile
  // would make the run's own submission fail.
  const agentRunGoing = useAgentRunGoing();
  const [agentStarting, setAgentStarting] = useState(false);
  const manualSubmitReason =
    submitReason ??
    (agentRunGoing || agentStarting ? AGENT_RUN_GOING_REASON : undefined);
  // The pace the confirmation shows. It stays set after the dialog closes, so
  // the closing dialog keeps its title; `paceCheckOpen` drives the dialog.
  const [paceCheck, setPaceCheck] = useState<WeekPace | null>(null);
  const [paceCheckOpen, setPaceCheckOpen] = useState(false);
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

  function lockWeek(paceWarningShown: boolean) {
    setPaceCheckOpen(false);
    const { undoToken, result } = runStoreCommandWith(
      "submitWeek",
      [weekOf],
      (unit) => unit.set({ week: { pace_warning_shown: paceWarningShown } }),
    );
    if (!result.ok) {
      showToast(result.message);
      return;
    }
    offerUndo(undoToken, { title: "Week submitted", subject: "week" });
  }

  /** Submit week: asks first when the week is off pace, then locks it. */
  function requestSubmit() {
    const pace = computeWeekPace({
      weekDates,
      today: todayIsoDate(),
      capacityTargets: state.userPreferences.weeklyCapacityTargets,
      loggedMs: summary.totalMs,
      tolerancePercent: getPaceTolerancePercent(state.userPreferences),
    });
    if (
      needsPaceConfirmation(
        pace.status,
        state.userPreferences.warnWhenSubmittingUnderCapacity,
      )
    ) {
      setPaceCheck(pace);
      setPaceCheckOpen(true);
      return;
    }
    lockWeek(false);
  }

  function reopen() {
    offerUndo(localStore.reopenWeek(weekOf), {
      title: "Week reopened",
      subject: "week",
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
                key={warningKey(warning)}
                className={cn(warning.kind === "days-ahead" && "is-calm")}
              >
                {warning.kind === "days-ahead" ? (
                  <Ahead aria-hidden />
                ) : (
                  <Warning aria-hidden />
                )}
                <span>{formatWarning(warning)}</span>
                {warning.kind === "waiting-task" ? (
                  <Link
                    to="/projects/$projectId"
                    params={{ projectId: warning.projectId }}
                    search={
                      {
                        action: "edit",
                        target: warning.taskId,
                        parent: warning.projectId,
                      } as never
                    }
                    className="submit-warning-action"
                  >
                    Edit task
                  </Link>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
        {lockedWeek ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <WeekLockChip />
            Submitted {formatLockedDay(lockedWeek.lockedAt)}. Its entries are
            read-only until you reopen the week.
          </p>
        ) : null}
        <AgentTaskWeekLinks weekOf={weekOf} />
      </section>

      <section aria-labelledby="commit-changes-heading">
        <SectionHeading
          id="commit-changes-heading"
          trailing={
            changes.length > 0 ? (
              <span className="flex items-center gap-3">
                {changesOpen ? (
                  <span>
                    {checkedIds.length} of {changes.length} checked
                  </span>
                ) : null}
                <CommitChangeStat changes={changes} />
              </span>
            ) : undefined
          }
        >
          <button
            type="button"
            aria-expanded={changesOpen}
            aria-controls="commit-changes-content"
            className="-ml-1 flex items-center gap-1 text-left hover:text-foreground"
            onClick={() =>
              setCommitChangesSection(changesOpen ? "collapsed" : "expanded")
            }
          >
            <ChevronIcon
              aria-hidden="true"
              className={cn("size-4", changesOpen && "rotate-90")}
            />
            Changes
          </button>
        </SectionHeading>
        {changesOpen ? (
          <div id="commit-changes-content">
            <CommitChangeList
              changes={changes}
              // Every project: a deleted entry may be on an archived one.
              projects={state.projects}
              taskPropertyPlugins={plugins?.tasks ?? []}
              uncheckedIds={uncheckedIds}
              onCheckedChange={(entryId, checked) =>
                setChangesChecked(weekOf, [entryId], checked)
              }
            />
            {summary.local.durationMs > 0 ? (
              <p className="commit-local-time">
                Not sent:{" "}
                {summary.local.items.map((item) => item.name).join(", ") ||
                  "local time"}{" "}
                <Value>{formatClockDuration(summary.local.durationMs)}</Value>
              </p>
            ) : null}
          </div>
        ) : null}
      </section>

      <div
        role="group"
        aria-label="Commit actions"
        className="flex flex-wrap items-center gap-2 empty:hidden"
      >
        {lockedWeek ? (
          <Button variant="outline" onClick={reopen}>
            <Unlock data-icon="inline-start" />
            Reopen week
          </Button>
        ) : (
          <>
            <AgentTaskButtons
              weekOf={weekOf}
              placement="commit-week"
              onStartingChange={setAgentStarting}
            />
            {changes.length > 0 ? (
              <Button
                disabled={checkedIds.length === 0}
                onClick={markCommitted}
              >
                Mark as committed
              </Button>
            ) : null}
            {submitTasks === "present" ? (
              <AgentTaskButtons
                weekOf={weekOf}
                placement="submit-week"
                disabledReason={submitReason}
                // Primary once nothing is left to commit, like Submit week.
                primary={changes.length === 0}
                onStartingChange={setAgentStarting}
              />
            ) : null}
            <DisabledReason label="Submit week" reason={manualSubmitReason}>
              <Button
                // Keep manual submission available; the agent is primary
                // when it provides the ready week's next step.
                variant={
                  changes.length > 0 || submitTasks === "present"
                    ? "outline"
                    : "default"
                }
                disabled={manualSubmitReason !== undefined}
                onClick={requestSubmit}
              >
                <Lock data-icon="inline-start" />
                Submit week
              </Button>
            </DisabledReason>
          </>
        )}
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
              {/* Only Ajour to choose from without a plugin: no switch. */}
              {nameSources.length > 1 ? (
                <div className="flex items-center gap-2">
                  <span
                    id="commit-names-label"
                    className="submit-toolbar-label"
                  >
                    Names
                  </span>
                  <ToggleGroup
                    value={nameSource ? [nameSource] : []}
                    onValueChange={(values: unknown[]) => {
                      const next = nameSources.find(
                        (option) => option.id === values[0],
                      );
                      if (next) {
                        localStore.setUserPreferences({
                          commitLinesNameSource: next.id,
                        });
                      }
                    }}
                    variant="outline"
                    aria-labelledby="commit-names-label"
                  >
                    {nameSources.map((option) => (
                      <ToggleGroupItem key={option.id} value={option.id}>
                        {option.label}
                      </ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                </div>
              ) : null}
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
                          names={describeLineNames(
                            line,
                            nameSource,
                            projects,
                            plugins,
                          )}
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

      <AlertDialog open={paceCheckOpen} onOpenChange={setPaceCheckOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {paceCheck?.status === "over"
                ? "Submit a week over pace?"
                : "Submit a week under pace?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {paceCheck
                ? `You logged ${formatHours(paceCheck.loggedHours)} of the ${formatHours(paceCheck.expectedHours)} expected by now.`
                : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Review</AlertDialogCancel>
            <AlertDialogAction onClick={() => lockWeek(true)}>
              Submit anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
