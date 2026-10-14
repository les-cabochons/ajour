import {
  useEffect,
  useMemo,
  useSyncExternalStore,
  type CSSProperties,
} from "react";
import {
  RiPlayFill as PlayIcon,
  RiStopFill as StopIcon,
} from "@remixicon/react";
import { TooltipButton } from "@/components/tooltip-button";
import { formatClockDuration } from "@/domain/time/duration";
import {
  formatElapsedDuration,
  formatRemainingEstimate,
  summarizeRunningEntry,
} from "@/domain/time/running-entry";
import type { LocalWorkItem } from "@/domain/local-state";
import { runBacklogItemAction } from "@/features/backlog/backlog-item-actions";
import { TimeEntryEditorPopover } from "@/features/time/time-entry-editor-popover";
import { useLocalState } from "@/lib/local-hooks";
import { localStore } from "@/lib/local-store";
import {
  getTimerContributionMs,
  getTimerDurationsMs,
} from "@/lib/timer-totals";
import { useRunningClock } from "@/lib/use-now";
import { cn, todayIsoDate } from "@/lib/utils";

let runningEntryEditorOpen = false;
const runningEntryEditorListeners = new Set<() => void>();

/**
 * Opens or closes the running entry's editor on whichever dock shows: the
 * sidebar's or the floating one. The titlebar's Start opens it after starting
 * an empty entry.
 */
export function setRunningEntryEditorOpen(open: boolean) {
  if (runningEntryEditorOpen === open) return;
  runningEntryEditorOpen = open;
  runningEntryEditorListeners.forEach((listener) => listener());
}

/** The running entry editor's open state. Stop or Discard from anywhere closes it. */
function useRunningEntryEditor(hasTimer: boolean) {
  const open = useSyncExternalStore(
    (listener) => {
      runningEntryEditorListeners.add(listener);
      return () => runningEntryEditorListeners.delete(listener);
    },
    () => runningEntryEditorOpen,
    () => false,
  );
  useEffect(() => {
    if (!hasTimer) setRunningEntryEditorOpen(false);
  }, [hasTimer]);
  return open;
}

/**
 * The running entry and today's total, ticking every second while an entry
 * runs. Call it in the component that shows them, so the surface around it
 * does not re-render each second.
 */
export function useRunningEntry() {
  const state = useLocalState();
  const timer = state.timers[0] ?? null;
  const now = useRunningClock(timer !== null);

  const { runningDurationMs } = getTimerDurationsMs(timer, now);
  // The running time not saved to an entry yet. A continued entry has
  // already counted its saved time, in today's total and in the estimate.
  const unsavedDurationMs = getTimerContributionMs({
    timer,
    timesheetEntries: state.timesheetEntries,
    runningDurationMs,
  });
  const summary = timer
    ? summarizeRunningEntry(timer, {
        projects: state.projects,
        workItems: state.workItems,
        unsavedDurationMs,
      })
    : null;

  const today = todayIsoDate();
  // Saved entries change rarely; only the running part ticks.
  const savedTodayMs = useMemo(
    () =>
      state.timesheetEntries
        .filter((entry) => entry.localDate === today)
        .reduce((sum, entry) => sum + entry.durationMs, 0),
    [state.timesheetEntries, today],
  );
  const todayTotalMs =
    savedTodayMs + (timer?.localDate === today ? unsavedDurationMs : 0);

  return { timer, summary, runningDurationMs, todayTotalMs };
}

function RunningDot() {
  return (
    <span className="relative flex size-2 shrink-0" aria-hidden="true">
      <span className="absolute inline-flex size-full animate-ping rounded-full bg-[var(--success)] opacity-60 motion-reduce:hidden" />
      <span className="relative inline-flex size-2 rounded-full bg-[var(--success)]" />
    </span>
  );
}

function StopButton({
  timerId,
  className,
}: {
  timerId: string;
  className?: string;
}) {
  return (
    <TooltipButton
      label="Stop"
      shortcut="entry.stop-or-start"
      className={cn(
        "flex size-7 shrink-0 items-center justify-center rounded-md bg-foreground text-background hover:bg-foreground/85",
        className,
      )}
      onClick={() => localStore.saveTimer(timerId)}
    >
      <StopIcon className="size-3.5" />
    </TooltipButton>
  );
}

/**
 * The top of the expanded sidebar. While an entry runs: its title, the time
 * counted, Stop, and how much of the item's remaining estimate it uses.
 * Clicking it opens the running entry's editor. Otherwise: today's total and a
 * one-click start for `upNext`.
 */
export function TimerDock({ upNext }: { upNext?: LocalWorkItem }) {
  const { timer, summary, runningDurationMs, todayTotalMs } = useRunningEntry();
  const editorOpen = useRunningEntryEditor(Boolean(timer));

  if (!timer || !summary) {
    return (
      <section
        aria-label="Timer"
        className="mx-2 mt-1 mb-2 rounded-lg border bg-background p-2.5 text-[12px]"
      >
        <div className="flex items-center justify-between text-muted-foreground">
          <span>Nothing running</span>
          <span className="tabular-nums">
            Today {formatClockDuration(todayTotalMs)}
          </span>
        </div>
        {upNext ? (
          <button
            type="button"
            className="mt-2 flex h-8 w-full items-center gap-2 rounded-md border pr-2 pl-1 text-left text-[13px] outline-none hover:bg-foreground/5 focus-visible:ring-1 focus-visible:ring-ring"
            aria-label={`Start entry on ${upNext.title}`}
            onClick={() =>
              runBacklogItemAction(upNext, "start-entry", () => undefined)
            }
          >
            <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-foreground text-background">
              <PlayIcon className="size-3" />
            </span>
            <span className="min-w-0 flex-1 truncate font-medium">
              {upNext.title}
            </span>
            <span className="shrink-0 text-[11px] text-muted-foreground">
              Up next
            </span>
          </button>
        ) : null}
      </section>
    );
  }

  return (
    <section
      aria-label="Running entry"
      className="relative mx-2 mt-1 mb-2 rounded-lg border bg-background"
    >
      <TimeEntryEditorPopover
        target={{ kind: "running", timer }}
        open={editorOpen}
        onOpenChange={setRunningEntryEditorOpen}
        triggerLabel="Edit the running entry"
        triggerClassName="block w-full rounded-lg p-2.5 text-left outline-none hover:bg-foreground/[0.03] focus-visible:ring-1 focus-visible:ring-ring"
      >
        <span className="flex min-w-0 items-center gap-2 pr-8">
          <RunningDot />
          <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">
            {summary.title}
          </span>
        </span>
        <span className="mt-2 mb-1.5 block font-mono text-xl leading-none font-semibold tabular-nums">
          {formatElapsedDuration(runningDurationMs)}
        </span>
        {summary.estimateUsed !== undefined ? (
          <span className="block h-[3px] overflow-hidden rounded-full bg-foreground/10">
            <span
              className={cn(
                "block h-full",
                summary.remainingMs !== undefined && summary.remainingMs < 0
                  ? "bg-destructive"
                  : "bg-[var(--success)]",
              )}
              style={{ width: `${summary.estimateUsed * 100}%` }}
            />
          </span>
        ) : null}
        {summary.meta || summary.remainingMs !== undefined ? (
          <span className="mt-1.5 flex justify-between gap-2 text-[11px] text-muted-foreground">
            <span className="min-w-0 truncate">{summary.meta}</span>
            {summary.remainingMs !== undefined ? (
              <span className="shrink-0">
                {formatRemainingEstimate(summary.remainingMs)}
              </span>
            ) : null}
          </span>
        ) : null}
      </TimeEntryEditorPopover>
      <StopButton timerId={timer._id} className="absolute top-2 right-2" />
    </section>
  );
}

/**
 * The dock on one line, shown while an entry runs and the sidebar is not on
 * screen: floating at the bottom left on desktop, and with the narrow view's
 * entry buttons. Desktop opens the editor in a popover; the narrow view passes
 * `onEdit` to open its dialog.
 */
export function FloatingTimerDock({
  onEdit,
  className,
  style,
}: {
  onEdit?: () => void;
  className?: string;
  style?: CSSProperties;
}) {
  const { timer, summary, runningDurationMs } = useRunningEntry();
  const editorOpen = useRunningEntryEditor(Boolean(timer));
  if (!timer || !summary) return null;

  const content = (
    <>
      <RunningDot />
      <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">
        {summary.title}
      </span>
      <span className="shrink-0 font-mono text-[12px] font-semibold tabular-nums">
        {formatElapsedDuration(runningDurationMs)}
      </span>
    </>
  );
  const triggerClassName =
    "flex h-full min-w-0 flex-1 items-center gap-2 rounded-lg pl-3 text-left outline-none focus-visible:ring-1 focus-visible:ring-ring";

  return (
    <div
      className={cn(
        "ajour-floating-dock flex h-10 max-w-[22rem] items-center gap-2 rounded-lg border bg-background pr-1.5 shadow-[var(--shadow-popup)]",
        className,
      )}
      style={style}
    >
      {onEdit ? (
        <button
          type="button"
          className={triggerClassName}
          aria-label="Edit the running entry"
          onClick={onEdit}
        >
          {content}
        </button>
      ) : (
        <TimeEntryEditorPopover
          target={{ kind: "running", timer }}
          open={editorOpen}
          onOpenChange={setRunningEntryEditorOpen}
          triggerLabel="Edit the running entry"
          triggerClassName={triggerClassName}
        >
          {content}
        </TimeEntryEditorPopover>
      )}
      <StopButton timerId={timer._id} />
    </div>
  );
}

/**
 * Puts the running entry in the window title, such as "● 1:24 · Fix export
 * rounding — Ajour", so it shows on the taskbar or Dock while Ajour is behind
 * other windows. It changes once a minute.
 */
export function RunningEntryWindowTitle() {
  const { summary, runningDurationMs } = useRunningEntry();
  const title = summary
    ? `● ${formatClockDuration(runningDurationMs)} · ${summary.title} — Ajour`
    : "Ajour";

  useEffect(() => {
    document.title = title;
  }, [title]);

  useEffect(() => () => void (document.title = "Ajour"), []);

  return null;
}

/** Today's total, counting the running entry, as "5:12". */
export function TodayTotal() {
  return formatClockDuration(useRunningEntry().todayTotalMs);
}
