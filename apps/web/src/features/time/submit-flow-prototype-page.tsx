/**
 * PROTOTYPE, throwaway. Never merge to main.
 *
 * Question: how does submitting a timesheet work, in a full window and in the narrow view?
 * (wayfinder ticket "Submit timesheet flow in full and narrow windows", issue #24)
 *
 * Submitting today means: copy the week into Workday by hand, then mark the entries as
 * submitted in Ajour. Route: /prototype/submit. Switch with `?submit=` or the floating bar:
 *   A: transcribe sheet. A full page shaped like a timesheet (tasks by days), click-to-copy
 *      cells, a tick per row as it is entered, then "Mark week as submitted".
 *   B: summary then mark. Week total against the target, warnings, a list per task with copy
 *      buttons, one "Mark week as submitted" button. The summary turns into the result.
 *   C: day by day. One day at a time with copy buttons, Next day, then Submit on the last day.
 * In every variant the result shows in place: no toast.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  RiArrowLeftSLine as ChevronLeft,
  RiArrowRightSLine as ChevronRight,
  RiCheckLine as Check,
  RiErrorWarningLine as Warning,
  RiFileCopyLine as Copy,
} from "@remixicon/react";
import { Button } from "@/components/ui/button";
import {
  getLocalProjectDisplayName,
  type LocalTimesheetEntry,
} from "@/domain/local-state";
import { formatClockDuration } from "@/domain/time/duration";
import { useLocalProjects, useLocalState } from "@/lib/local-hooks";
import { localStore } from "@/lib/local-store";
import { cn, getIsoWeekDates, todayIsoDate } from "@/lib/utils";

type SubmitVariant = "A" | "B" | "C";
const VARIANTS: { key: SubmitVariant; name: string }[] = [
  { key: "A", name: "Transcribe sheet" },
  { key: "B", name: "Summary then mark" },
  { key: "C", name: "Day by day" },
];
const WEEKDAY_KEYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const;

function readVariant(): SubmitVariant {
  const value = new URLSearchParams(window.location.search).get("submit");
  return VARIANTS.some((item) => item.key === value)
    ? (value as SubmitVariant)
    : "A";
}

function dayLabel(localDate: string, long = false) {
  return new Intl.DateTimeFormat(
    "en-US",
    long
      ? { weekday: "long", month: "short", day: "numeric" }
      : { weekday: "short", day: "numeric" },
  ).format(new Date(`${localDate}T12:00:00`));
}

function hoursDecimal(durationMs: number) {
  return (durationMs / 3600000).toFixed(2);
}

function CopyChip({ value, label }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      title={`Copy ${label ?? value}`}
      onClick={() => {
        void navigator.clipboard?.writeText(value).catch(() => undefined);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1200);
      }}
      className="group inline-flex max-w-full items-center gap-1 rounded-md px-1.5 py-0.5 text-left hover:bg-muted"
    >
      <span className="truncate">{value || "—"}</span>
      {copied ? (
        <Check className="size-3.5 shrink-0 text-emerald-600" />
      ) : (
        <Copy className="size-3.5 shrink-0 opacity-0 group-hover:opacity-60" />
      )}
    </button>
  );
}

function useWeek(anchorDate: string) {
  const state = useLocalState();
  const projects = useLocalProjects();
  const weekDates = useMemo(() => getIsoWeekDates(anchorDate), [anchorDate]);
  const entries = useMemo(
    () =>
      state.timesheetEntries.filter((entry) =>
        weekDates.includes(entry.localDate),
      ),
    [state.timesheetEntries, weekDates],
  );
  const targets = weekDates.map(
    (_, index) =>
      state.userPreferences.weeklyCapacityTargets[WEEKDAY_KEYS[index]!],
  );
  const describe = (entry: LocalTimesheetEntry) => {
    const project = projects.find((item) => item._id === entry.projectId);
    const task = project?.tasks.find((item) => item._id === entry.taskId);
    return {
      project: project ? getLocalProjectDisplayName(project) : "No project",
      task: task?.name ?? "",
      color: project?.color ?? "#94a3b8",
    };
  };
  const rows = useMemo(() => {
    const map = new Map<
      string,
      {
        key: string;
        sample: LocalTimesheetEntry;
        entries: LocalTimesheetEntry[];
      }
    >();
    for (const entry of entries) {
      const key = `${entry.projectId}:${entry.taskId}`;
      const row = map.get(key) ?? { key, sample: entry, entries: [] };
      row.entries.push(entry);
      map.set(key, row);
    }
    return [...map.values()];
  }, [entries]);
  const total = entries.reduce((sum, entry) => sum + entry.durationMs, 0);
  const target = targets.reduce((sum, value) => sum + value, 0);
  const unsubmitted = entries.filter((entry) => !entry.submittedAt);
  const lastSubmittedAt = entries.reduce(
    (max, entry) => Math.max(max, entry.submittedAt ?? 0),
    0,
  );
  const warnings = [
    ...weekDates
      .map((localDate, index) => ({
        localDate,
        target: targets[index]!,
        logged: entries
          .filter((entry) => entry.localDate === localDate)
          .reduce((sum, entry) => sum + entry.durationMs, 0),
      }))
      .filter((day) => day.target > 0 && day.logged < day.target)
      .map(
        (day) =>
          `${dayLabel(day.localDate)} has ${formatClockDuration(day.logged)} of ${formatClockDuration(day.target)}`,
      ),
    ...(entries.some((entry) => !entry.taskId)
      ? ["Some entries have no task"]
      : []),
  ];
  return {
    weekDates,
    entries,
    rows,
    describe,
    total,
    target,
    unsubmitted,
    lastSubmittedAt,
    warnings,
  };
}

type Week = ReturnType<typeof useWeek>;

function ResultBanner({
  week,
  onReopen,
}: {
  week: Week;
  onReopen?: () => void;
}) {
  if (week.unsubmitted.length > 0 || !week.lastSubmittedAt) return null;
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3">
      <span className="flex items-center gap-2 text-sm font-medium">
        <Check className="size-5 text-emerald-600" />
        Week submitted on{" "}
        {new Intl.DateTimeFormat("en-US", {
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        }).format(week.lastSubmittedAt)}
        <span className="font-normal text-muted-foreground">
          · {week.entries.length} entries · {formatClockDuration(week.total)}
        </span>
      </span>
      {onReopen ? (
        <Button variant="ghost" size="sm" onClick={onReopen}>
          Done
        </Button>
      ) : null}
    </div>
  );
}

function submitAll(week: Week) {
  localStore.markTimesheetEntriesSubmitted(
    week.unsubmitted.map((entry) => entry._id),
  );
}

/* ── A: transcribe sheet ── */

function VariantA({ week, narrow }: { week: Week; narrow: boolean }) {
  const [ticked, setTicked] = useState<string[]>([]);
  const toggle = (key: string) =>
    setTicked((current) =>
      current.includes(key)
        ? current.filter((item) => item !== key)
        : [...current, key],
    );
  return (
    <div className="flex flex-col gap-3">
      <ResultBanner week={week} />
      <div className="text-xs text-muted-foreground">
        Click any value to copy it. Tick a row once it is in Workday.
      </div>
      {narrow ? (
        <div className="flex flex-col gap-2">
          {week.rows.map((row) => {
            const info = week.describe(row.sample);
            return (
              <div
                key={row.key}
                className={cn(
                  "rounded-xl border border-border p-3",
                  ticked.includes(row.key) && "opacity-50",
                )}
              >
                <div className="flex items-center justify-between">
                  <div className="min-w-0 text-sm">
                    <CopyChip value={info.project} label="project" />
                    <CopyChip value={info.task} label="task" />
                  </div>
                  <input
                    type="checkbox"
                    checked={ticked.includes(row.key)}
                    onChange={() => toggle(row.key)}
                    aria-label="Entered in Workday"
                    className="size-5"
                  />
                </div>
                <div className="mt-2 grid grid-cols-4 gap-1 text-xs">
                  {week.weekDates.map((localDate) => {
                    const ms = row.entries
                      .filter((entry) => entry.localDate === localDate)
                      .reduce((sum, entry) => sum + entry.durationMs, 0);
                    return ms ? (
                      <div
                        key={localDate}
                        className="rounded-md bg-muted px-1.5 py-1"
                      >
                        <div className="text-[10px] text-muted-foreground">
                          {dayLabel(localDate)}
                        </div>
                        <CopyChip value={hoursDecimal(ms)} label="hours" />
                      </div>
                    ) : null;
                  })}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <table className="w-full table-fixed rounded-xl border border-border text-sm">
          <thead>
            <tr className="border-b border-border text-xs text-muted-foreground">
              <th className="w-10" />
              <th className="w-44 px-2 py-2 text-left font-medium">Project</th>
              <th className="w-40 px-2 py-2 text-left font-medium">Task</th>
              {week.weekDates.map((localDate) => (
                <th key={localDate} className="py-2 font-medium">
                  {dayLabel(localDate)}
                </th>
              ))}
              <th className="w-48 px-2 py-2 text-left font-medium">Comments</th>
            </tr>
          </thead>
          <tbody>
            {week.rows.map((row) => {
              const info = week.describe(row.sample);
              const notes = [
                ...new Set(
                  row.entries.map((entry) => entry.note).filter(Boolean),
                ),
              ].join("; ");
              return (
                <tr
                  key={row.key}
                  className={cn(
                    "border-b border-border",
                    ticked.includes(row.key) && "opacity-50",
                  )}
                >
                  <td className="text-center">
                    <input
                      type="checkbox"
                      checked={ticked.includes(row.key)}
                      onChange={() => toggle(row.key)}
                      aria-label="Entered in Workday"
                    />
                  </td>
                  <td className="px-1 py-1.5">
                    <CopyChip value={info.project} label="project" />
                  </td>
                  <td className="px-1">
                    <CopyChip value={info.task} label="task" />
                  </td>
                  {week.weekDates.map((localDate) => {
                    const ms = row.entries
                      .filter((entry) => entry.localDate === localDate)
                      .reduce((sum, entry) => sum + entry.durationMs, 0);
                    return (
                      <td
                        key={localDate}
                        className="text-center font-mono text-xs"
                      >
                        {ms ? (
                          <CopyChip value={hoursDecimal(ms)} label="hours" />
                        ) : (
                          <span className="text-muted-foreground/50">—</span>
                        )}
                      </td>
                    );
                  })}
                  <td className="px-1 text-xs">
                    <CopyChip value={notes} label="comments" />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <div className="flex items-center justify-end gap-3">
        <span className="text-xs text-muted-foreground">
          {ticked.length} of {week.rows.length} rows ticked ·{" "}
          {formatClockDuration(week.total)}
        </span>
        <Button
          disabled={week.unsubmitted.length === 0}
          onClick={() => submitAll(week)}
        >
          Mark week as submitted
        </Button>
      </div>
    </div>
  );
}

/* ── B: summary then mark ── */

function VariantB({ week, narrow }: { week: Week; narrow: boolean }) {
  const under = week.total < week.target;
  return (
    <div
      className={cn("grid gap-4", !narrow && "grid-cols-[320px_minmax(0,1fr)]")}
    >
      <div className="flex h-fit flex-col gap-3 rounded-xl border border-border p-4">
        <div className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          This week
        </div>
        <div className="font-mono text-3xl font-semibold">
          {formatClockDuration(week.total)}
          <span className="ml-2 text-sm font-normal text-muted-foreground">
            of {formatClockDuration(week.target)}
          </span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-muted">
          <div
            className={cn("h-full", under ? "bg-amber-500" : "bg-emerald-500")}
            style={{
              width: `${Math.min(100, (week.total / Math.max(1, week.target)) * 100)}%`,
            }}
          />
        </div>
        {week.warnings.length ? (
          <ul className="flex flex-col gap-1 text-xs text-amber-700 dark:text-amber-400">
            {week.warnings.map((warning) => (
              <li key={warning} className="flex items-center gap-1.5">
                <Warning className="size-3.5 shrink-0" />
                {warning}
              </li>
            ))}
          </ul>
        ) : null}
        {week.unsubmitted.length === 0 && week.lastSubmittedAt ? (
          <ResultBanner week={week} />
        ) : (
          <Button onClick={() => submitAll(week)}>
            Mark week as submitted ({week.unsubmitted.length})
          </Button>
        )}
      </div>
      <div className="flex flex-col gap-2">
        {week.rows.map((row) => {
          const info = week.describe(row.sample);
          const total = row.entries.reduce(
            (sum, entry) => sum + entry.durationMs,
            0,
          );
          return (
            <div key={row.key} className="rounded-xl border border-border p-3">
              <div className="flex items-center justify-between gap-2 text-sm">
                <span className="flex min-w-0 items-center gap-1">
                  <span
                    className="size-2 shrink-0 rounded-full"
                    style={{ background: info.color }}
                  />
                  <CopyChip value={info.project} label="project" />
                  <span className="text-muted-foreground">/</span>
                  <CopyChip value={info.task} label="task" />
                </span>
                <span className="font-mono text-xs font-semibold">
                  <CopyChip value={hoursDecimal(total)} label="hours" />
                </span>
              </div>
              <div className="mt-1 flex flex-wrap gap-1 text-xs text-muted-foreground">
                {week.weekDates.map((localDate) => {
                  const ms = row.entries
                    .filter((entry) => entry.localDate === localDate)
                    .reduce((sum, entry) => sum + entry.durationMs, 0);
                  return ms ? (
                    <span key={localDate} className="rounded bg-muted px-1">
                      {dayLabel(localDate)}{" "}
                      <CopyChip value={hoursDecimal(ms)} label="hours" />
                    </span>
                  ) : null;
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ── C: day by day ── */

function VariantC({ week }: { week: Week; narrow: boolean }) {
  const days = week.weekDates.filter((localDate) =>
    week.entries.some((entry) => entry.localDate === localDate),
  );
  const [index, setIndex] = useState(0);
  const localDate = days[index] ?? week.weekDates[0]!;
  const entries = week.entries.filter((entry) => entry.localDate === localDate);
  const isLast = index >= days.length - 1;
  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-3">
      <ResultBanner week={week} />
      <div className="flex items-center gap-1">
        {days.map((day, dayIndex) => (
          <div
            key={day}
            className={cn(
              "h-1.5 flex-1 rounded-full",
              dayIndex <= index ? "bg-foreground" : "bg-muted",
            )}
          />
        ))}
      </div>
      <div className="flex items-baseline justify-between">
        <div className="text-lg font-semibold">{dayLabel(localDate, true)}</div>
        <div className="text-xs text-muted-foreground">
          Day {index + 1} of {days.length}
        </div>
      </div>
      {entries.map((entry) => {
        const info = week.describe(entry);
        return (
          <div
            key={entry._id}
            className="flex flex-col gap-1 rounded-xl border border-border p-3 text-sm"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-1">
                <span
                  className="size-2 shrink-0 rounded-full"
                  style={{ background: info.color }}
                />
                <CopyChip value={info.project} label="project" />
                <span className="text-muted-foreground">/</span>
                <CopyChip value={info.task} label="task" />
              </span>
              <span className="font-mono text-xs font-semibold">
                <CopyChip
                  value={hoursDecimal(entry.durationMs)}
                  label="hours"
                />
              </span>
            </div>
            {entry.note ? (
              <div className="text-xs text-muted-foreground">
                <CopyChip value={entry.note} label="comment" />
              </div>
            ) : null}
          </div>
        );
      })}
      <div className="flex items-center justify-between">
        <Button
          variant="ghost"
          disabled={index === 0}
          onClick={() => setIndex(index - 1)}
        >
          Previous day
        </Button>
        {isLast ? (
          <Button
            disabled={week.unsubmitted.length === 0}
            onClick={() => submitAll(week)}
          >
            Mark week as submitted
          </Button>
        ) : (
          <Button onClick={() => setIndex(index + 1)}>Next day</Button>
        )}
      </div>
    </div>
  );
}

export function SubmitFlowPrototypePage() {
  const [variant, setVariant] = useState<SubmitVariant>(readVariant);
  const anchorDate = useMemo(
    () =>
      new URLSearchParams(window.location.search).get("date") ?? todayIsoDate(),
    [],
  );
  const week = useWeek(anchorDate);
  const [narrow, setNarrow] = useState(() => window.innerWidth < 768);
  useEffect(() => {
    const update = () => setNarrow(window.innerWidth < 768);
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  function cycle(step: number) {
    const index = VARIANTS.findIndex((item) => item.key === variant);
    const next =
      VARIANTS[(index + step + VARIANTS.length) % VARIANTS.length]!.key;
    const url = new URL(window.location.href);
    url.searchParams.set("submit", next);
    window.history.replaceState(window.history.state, "", url);
    setVariant(next);
  }
  const cycleRef = useRef(cycle);
  cycleRef.current = cycle;
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (!event.altKey) return;
      if (event.key === "ArrowLeft") cycleRef.current(-1);
      if (event.key === "ArrowRight") cycleRef.current(1);
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);
  const current = VARIANTS.find((item) => item.key === variant)!;

  return (
    <div className="flex flex-col gap-4 p-4 pb-20">
      <div className="flex items-baseline justify-between gap-2">
        <h1 className="text-lg font-semibold">
          Submit week of {dayLabel(week.weekDates[0]!)} to{" "}
          {dayLabel(week.weekDates[6]!)}
        </h1>
        <span className="text-xs text-muted-foreground">
          Prototype · {current.name}
        </span>
      </div>
      {variant === "A" ? <VariantA week={week} narrow={narrow} /> : null}
      {variant === "B" ? <VariantB week={week} narrow={narrow} /> : null}
      {variant === "C" ? <VariantC week={week} narrow={narrow} /> : null}
      {import.meta.env.PROD ? null : (
        <div className="fixed bottom-4 left-1/2 z-[1000] flex -translate-x-1/2 items-center gap-2 rounded-full bg-fuchsia-600 px-2 py-1 text-xs font-semibold whitespace-nowrap text-white shadow-lg">
          <button
            type="button"
            onClick={() => cycle(-1)}
            aria-label="Previous variant"
          >
            <ChevronLeft className="size-4" />
          </button>
          <span>
            Submit {current.key}: {current.name}
          </span>
          <button
            type="button"
            onClick={() => cycle(1)}
            aria-label="Next variant"
          >
            <ChevronRight className="size-4" />
          </button>
        </div>
      )}
    </div>
  );
}
