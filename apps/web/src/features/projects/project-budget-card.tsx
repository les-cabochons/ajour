import { useId, useMemo, useState } from "react";
import type { ProjectSourceBudgetStatus } from "@ajour/shared";
import { PropertyList, PropertyRow } from "@/components/property-list";
import { Value } from "@/components/ui/value";
import type {
  LocalProject,
  LocalProjectSource,
  LocalTimesheetEntry,
} from "@/domain/local-state";
import {
  notCountedMs,
  reconciliation,
  remainingEstimate,
  type Reconciliation,
} from "@/domain/projects/project-budget";
import {
  formatClockDuration,
  formatCompactDuration,
} from "@/domain/time/duration";

/*
 * A managed project's budget card (#509, ADR 0016). Two writers: the source's
 * figures as of its time, and Ajour's Not counted yet with the Remaining it
 * estimates from both. Then a note on the user's own hours: what the source
 * has for them against what they committed, or the plugin's sentence on why
 * it can't say. The card names the source by its label only.
 */

const HOUR_MS = 3_600_000;

const STATUS_LABELS: Record<ProjectSourceBudgetStatus, string> = {
  ok: "Within budget",
  warning: "Near its budget",
  over: "Over budget",
  unknown: "Unknown",
};

/** "Oct 31, 7:59 PM": when the source's figures are from. */
function formatAsOf(asOf: string) {
  return new Date(asOf).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatSignedClock(durationMs: number) {
  return durationMs < 0
    ? `-${formatClockDuration(-durationMs)}`
    : formatClockDuration(durationMs);
}

function formatEntryDay(localDate: string) {
  return new Date(`${localDate}T12:00:00`).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

/**
 * A row whose value has a quieter line under it, such as its time. The
 * label lines up with the value. `text` is a word, such as a status, rather
 * than a number.
 */
function TwoLineRow({
  label,
  value,
  line,
  tone,
  text = false,
}: {
  label: string;
  value: string;
  line: string;
  tone?: "danger";
  text?: boolean;
}) {
  return (
    <PropertyRow label={label} className="self-start">
      <span className="flex min-w-0 flex-col py-1">
        {text ? (
          <span>{value}</span>
        ) : (
          <Value size="base" tone={tone}>
            {value}
          </Value>
        )}
        <span className="text-xs text-muted-foreground">{line}</span>
      </span>
    </PropertyRow>
  );
}

function ReconciliationList({
  id,
  label,
  result,
}: {
  id: string;
  label: string;
  result: Reconciliation;
}) {
  return (
    <ul id={id} aria-label="Committed entries" className="project-budget-tasks">
      {result.tasks.map((task) => (
        <li key={task.taskId ?? ""} className="flex flex-col gap-1">
          <span className="truncate font-medium">{task.name}</span>
          <span className="text-xs text-muted-foreground">
            {label} <Value>{formatClockDuration(task.sourceMs)}</Value>
            {" · "}You <Value>{formatClockDuration(task.committedMs)}</Value>
          </span>
          {task.entries.length > 0 ? (
            <ul className="flex flex-col">
              {task.entries.map((entry) => (
                <li key={entry._id} className="project-budget-entry">
                  <span className="truncate">
                    {formatEntryDay(entry.commit!.localDate)}
                    {entry.commit!.note ? (
                      <span className="text-muted-foreground">
                        {" · "}
                        {entry.commit!.note}
                      </span>
                    ) : null}
                  </span>
                  <Value>{formatClockDuration(entry.commit!.durationMs)}</Value>
                </li>
              ))}
            </ul>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

export function ProjectBudgetCard({
  project,
  entries,
  source,
}: {
  project: LocalProject;
  /**
   * The entries on the project, and those whose committed copy is on it, so
   * an entry moved off it counts.
   */
  entries: readonly LocalTimesheetEntry[];
  /** The connection's record: the source's label and the user's hours. */
  source: LocalProjectSource | undefined;
}) {
  const [listOpen, setListOpen] = useState(false);
  const listId = useId();
  const { budget } = project;
  const asOf = budget?.asOf ?? source?.asOf;
  const figures = useMemo(() => {
    if (!budget || budget.unit !== "hours") return undefined;
    const notCounted = notCountedMs(
      project,
      entries,
      budget.asOf,
      budget.since,
    );
    return {
      notCounted,
      sourceRemaining: remainingEstimate(budget, 0),
      remaining: remainingEstimate(budget, notCounted),
    };
  }, [project, entries, budget]);
  const reconciled = useMemo(
    () => (asOf ? reconciliation(project, entries, source?.me, asOf) : null),
    [project, entries, source?.me, asOf],
  );
  const hoursNote =
    source?.me && !source.me.hoursAvailable ? source.me.hoursNote : undefined;

  if (!budget && !reconciled && !hoursNote) return null;
  const label = source?.label ?? "The source";

  return (
    <section className="project-budget-card" aria-label="Budget">
      {budget ? (
        <PropertyList>
          {budget.unit === "money" ? (
            <TwoLineRow
              label="Status"
              text
              value={STATUS_LABELS[budget.status ?? "unknown"]}
              line={`as of ${formatAsOf(budget.asOf)}`}
            />
          ) : (
            <>
              {budget.total === undefined ? null : (
                <PropertyRow label="Budget">
                  <Value size="base">
                    {formatClockDuration(budget.total * HOUR_MS)}
                  </Value>
                </PropertyRow>
              )}
              <TwoLineRow
                label="Consumed"
                value={formatClockDuration(budget.consumed * HOUR_MS)}
                line={`as of ${formatAsOf(budget.asOf)}`}
              />
              <PropertyRow label="Not counted yet">
                <Value size="base">
                  {formatSignedClock(figures!.notCounted)}
                </Value>
              </PropertyRow>
              {figures!.remaining === undefined ? null : (
                // The two lines it comes from: the source's remaining, less
                // Not counted yet.
                <TwoLineRow
                  label="≈ Remaining"
                  value={formatSignedClock(figures!.remaining)}
                  tone={figures!.remaining < 0 ? "danger" : undefined}
                  line={`Estimate: ${formatSignedClock(
                    figures!.sourceRemaining!,
                  )} ${figures!.notCounted < 0 ? "+" : "−"} ${formatClockDuration(
                    Math.abs(figures!.notCounted),
                  )}`}
                />
              )}
            </>
          )}
        </PropertyList>
      ) : null}
      {reconciled && asOf ? (
        <p className="project-budget-note">
          {label} has {formatCompactDuration(reconciled.sourceMs)} for you. You
          committed {formatCompactDuration(reconciled.committedMs)} before{" "}
          {formatAsOf(asOf)}.
          {reconciled.tasks.length > 0 ? (
            <>
              {" "}
              <button
                type="button"
                className="text-primary underline-offset-4 hover:underline"
                aria-expanded={listOpen}
                aria-controls={listId}
                onClick={() => setListOpen((open) => !open)}
              >
                See the {formatCompactDuration(reconciled.differenceMs)}
              </button>
            </>
          ) : null}
        </p>
      ) : hoursNote ? (
        <p className="project-budget-note">{hoursNote}</p>
      ) : null}
      {reconciled && listOpen && reconciled.tasks.length > 0 ? (
        <ReconciliationList id={listId} label={label} result={reconciled} />
      ) : null}
    </section>
  );
}
