import {
  useEffect,
  useMemo,
  useSyncExternalStore,
  type CSSProperties,
} from "react";
import {
  RiAddLine as PlusIcon,
  RiPlayFill as PlayIcon,
  RiStopFill as StopIcon,
} from "@remixicon/react";
import { RunningDot } from "@/components/running-dot";
import { TooltipButton } from "@/components/tooltip-button";
import { formatClockDuration } from "@/domain/time/duration";
import {
  formatElapsedDuration,
  formatRemainingEstimate,
  summarizeRunningEntry,
} from "@/domain/time/running-entry";
import type { LocalWorkItem } from "@/domain/local-state";
import { runBacklogItemAction } from "@/features/backlog/backlog-item-actions";
import type { TimeEntryEditorFields } from "@/features/time/time-entry-editor";
import { openBlankEntryEditor } from "@/features/time/new-entry-request";
import { TimeEntryEditorPopover } from "@/features/time/time-entry-editor-popover";
import { useLocalState } from "@/lib/local-hooks";
import { localStore } from "@/lib/local-store";
import {
  getTimerContributionMs,
  getTimerDurationsMs,
} from "@/lib/timer-totals";
import { useRunningClock, useTodayIsoDate } from "@/lib/use-now";
import { cn } from "@/lib/utils";

let runningEntryEditorOpen = false;
/** The unsaved draft, kept with its timer so it never seeds another entry. */
let runningEntryDraft:
  { timerId: string; fields: TimeEntryEditorFields } | undefined;
const runningEntryEditorListeners = new Set<() => void>();

/**
 * Opens or closes the running entry's editor on whichever host shows: the
 * sidebar's dock, the floating dock, or the narrow view's dialog. Start
 * (`startBlankEntry`) opens it after starting an empty entry. Closing drops the
 * draft.
 */
export function setRunningEntryEditorOpen(open: boolean) {
  if (!open) runningEntryDraft = undefined;
  if (runningEntryEditorOpen === open) return;
  runningEntryEditorOpen = open;
  runningEntryEditorListeners.forEach((listener) => listener());
}

/**
 * Starts an empty running entry today, then opens it so the user can fill it
 * in: on the sidebar's dock, or in the dialog in the narrow view.
 */
export function startBlankEntry() {
  localStore.startTimer({});
  setRunningEntryEditorOpen(true);
}

/**
 * What a host passes to the editor so an unsaved draft survives a move to
 * another host, as when the window crosses the narrow view's breakpoint.
 */
export function runningEntryDraftProps(timerId: string) {
  return {
    initialFields:
      runningEntryDraft?.timerId === timerId
        ? runningEntryDraft.fields
        : undefined,
    onFieldsChange: (fields: TimeEntryEditorFields) => {
      runningEntryDraft = { timerId, fields };
    },
  };
}

/** The running entry editor's open state. Stop or Discard from anywhere closes it. */
export function useRunningEntryEditor(hasTimer: boolean) {
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

  // Rolls over at midnight even while nothing runs.
  const today = useTodayIsoDate();
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

const startRowClassName =
  "flex h-7 min-w-0 flex-1 items-center gap-2 rounded-md border pr-2 pl-1 text-left text-sm outline-none hover:bg-foreground/5 focus-visible:ring-1 focus-visible:ring-ring";

function StartIcon() {
  return (
    <span className="flex size-5 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-foreground text-background">
      <PlayIcon className="size-3" />
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

/** The dock's "+". It opens the new entry editor in a popover anchored to it. */
function NewEntryButton() {
  return (
    <TooltipButton
      label="Create time entry"
      shortcut="entry.new"
      className="flex size-7 shrink-0 items-center justify-center rounded-md border text-muted-foreground outline-none hover:bg-foreground/5 hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
      onClick={(event) => openBlankEntryEditor(event.currentTarget)}
    >
      <PlusIcon className="size-4" />
    </TooltipButton>
  );
}

/**
 * The timer box in the expanded sidebar. While an entry runs: its title, the
 * time counted, "+", Stop, and how much of the item's remaining estimate it
 * uses. Clicking it opens the running entry's editor. Otherwise: today's total,
 * "+" and a one-click start for `upNext`, or for an empty entry when the
 * backlog is empty.
 */
export function TimerDock({ upNext }: { upNext?: LocalWorkItem }) {
  const { timer, summary, runningDurationMs, todayTotalMs } = useRunningEntry();
  const editorOpen = useRunningEntryEditor(Boolean(timer));

  if (!timer || !summary) {
    return (
      <section
        aria-label="Timer"
        className="mx-2 mt-1 mb-2 rounded-md border bg-background p-2.5 text-xs"
      >
        <div className="flex items-center justify-between text-muted-foreground">
          <span>Nothing running</span>
          <span className="tabular-nums">
            Today {formatClockDuration(todayTotalMs)}
          </span>
        </div>
        <div className="mt-2 flex gap-1.5">
          <NewEntryButton />
          {upNext ? (
            <button
              type="button"
              className={startRowClassName}
              aria-label={`Start entry on ${upNext.title}`}
              onClick={() =>
                runBacklogItemAction(upNext, "start-entry", () => undefined)
              }
            >
              <StartIcon />
              <span className="min-w-0 flex-1 truncate font-medium">
                {upNext.title}
              </span>
              <span className="shrink-0 text-xs text-muted-foreground">
                Up next
              </span>
            </button>
          ) : (
            <button
              type="button"
              className={startRowClassName}
              aria-label="Start"
              onClick={startBlankEntry}
            >
              <StartIcon />
              <span className="min-w-0 flex-1 truncate text-muted-foreground">
                Start an entry
              </span>
            </button>
          )}
        </div>
      </section>
    );
  }

  return (
    <section
      aria-label="Running entry"
      className="relative mx-2 mt-1 mb-2 rounded-md border bg-background"
    >
      <TimeEntryEditorPopover
        target={{ kind: "running", timer }}
        open={editorOpen}
        onOpenChange={setRunningEntryEditorOpen}
        {...runningEntryDraftProps(timer._id)}
        triggerLabel="Edit the running entry"
        triggerClassName="block w-full rounded-md p-2.5 text-left outline-none hover:bg-foreground/[0.03] focus-visible:ring-1 focus-visible:ring-ring"
      >
        <span className="flex min-w-0 items-center gap-2 pr-16">
          <RunningDot />
          <span className="min-w-0 flex-1 truncate text-sm font-medium">
            {summary.title}
          </span>
        </span>
        <span className="mt-2 mb-1.5 block font-mono text-xl leading-none font-medium tabular-nums">
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
          <span className="mt-1.5 flex justify-between gap-2 text-xs text-muted-foreground">
            <span className="min-w-0 truncate">{summary.meta}</span>
            {summary.remainingMs !== undefined ? (
              <span className="shrink-0">
                {formatRemainingEstimate(summary.remainingMs)}
              </span>
            ) : null}
          </span>
        ) : null}
      </TimeEntryEditorPopover>
      <span className="absolute top-2 right-2 flex gap-1">
        <NewEntryButton />
        <StopButton timerId={timer._id} />
      </span>
    </section>
  );
}

/**
 * The floating dock while nothing runs and the sidebar is not on screen on
 * desktop: "+" and Start, the only buttons that start an entry there. Start
 * turns it into the running `FloatingTimerDock`, with the editor open.
 */
export function FloatingStartDock({
  className,
  style,
}: {
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div
      style={style}
      className={cn(
        "ajour-floating-dock flex h-10 items-center gap-1.5 rounded-lg border bg-popover px-1.5 shadow-[var(--shadow-popup)]",
        className,
      )}
    >
      <NewEntryButton />
      <TooltipButton
        label="Start"
        shortcut="entry.stop-or-start"
        className="flex size-7 shrink-0 items-center justify-center rounded-md bg-foreground text-background hover:bg-foreground/85"
        onClick={startBlankEntry}
      >
        <PlayIcon className="size-3.5" />
      </TooltipButton>
    </div>
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
      <span className="min-w-0 flex-1 truncate text-sm font-medium">
        {summary.title}
      </span>
      <span className="shrink-0 font-mono text-xs font-medium tabular-nums">
        {formatElapsedDuration(runningDurationMs)}
      </span>
    </>
  );
  const triggerClassName =
    "flex h-full min-w-0 flex-1 items-center gap-2 rounded-lg pl-3 text-left outline-none focus-visible:ring-1 focus-visible:ring-ring";

  return (
    <div
      className={cn(
        "ajour-floating-dock flex h-10 max-w-[22rem] items-center gap-2 rounded-lg border bg-popover pr-1.5 shadow-[var(--shadow-popup)]",
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
          {...runningEntryDraftProps(timer._id)}
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
