import type { ReactNode } from "react";
import { RiAddLine, RiPlayFill, RiStopFill } from "@remixicon/react";
import { TooltipButton } from "@/components/tooltip-button";
import { Button } from "@/components/ui/button";
import {
  DOCK_PRIMARY_BUTTON_CLASS,
  NEW_ENTRY_BUTTON_CLASS,
  RunningEntryCardBody,
  useRunningEntry,
} from "@/features/layout/timer-dock";
import type { TimeEntryEditorTarget } from "@/features/time/time-entry-editor-form";
import { useLocalState } from "@/lib/local-hooks";
import { localStore } from "@/lib/local-store";
import { useTodayIsoDate } from "@/lib/use-now";

export function TrackButton({
  label,
  children,
  onClick,
  disabled = false,
}: {
  label: string;
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <TooltipButton
      label={label}
      render={
        <Button
          variant="ghost"
          size="icon"
          onClick={onClick}
          disabled={disabled}
        />
      }
    >
      {children}
    </TooltipButton>
  );
}

/**
 * The panel's timer card, the sidebar dock's twin: "+" and Start at rest; the
 * running entry's card with "+" and Stop in its corner while one runs. Its
 * editors open in the panel instead of a popover.
 */
export function PanelTimer({
  onEdit,
  disabled = false,
}: {
  onEdit: (target: TimeEntryEditorTarget) => void;
  disabled?: boolean;
}) {
  const { timer, summary, runningDurationMs } = useRunningEntry();
  const today = useTodayIsoDate();
  const newEntry = (
    <TooltipButton
      label="Create time entry"
      className={NEW_ENTRY_BUTTON_CLASS}
      render={<button type="button" disabled={disabled} />}
      onClick={() => onEdit({ kind: "create", localDate: today })}
    >
      <RiAddLine className="size-4" />
    </TooltipButton>
  );
  if (!timer || !summary) {
    return (
      <section
        aria-label="Timer"
        className="mx-2.5 mt-2.5 flex items-center gap-1.5 rounded-md border bg-background p-2.5"
      >
        {newEntry}
        <TooltipButton
          label="Start timer"
          className={DOCK_PRIMARY_BUTTON_CLASS}
          render={<button type="button" disabled={disabled} />}
          onClick={() => {
            localStore.startTimer({});
            const started = localStore.snapshot().timers[0];
            if (started) onEdit({ kind: "running", timer: started });
          }}
        >
          <RiPlayFill className="size-3.5" />
        </TooltipButton>
      </section>
    );
  }
  return (
    <section
      aria-label="Running entry"
      className="relative mx-2.5 mt-2.5 rounded-md border bg-background"
    >
      <button
        type="button"
        aria-label="Edit the running entry"
        disabled={disabled}
        className="block w-full rounded-md p-2.5 text-left outline-none hover:bg-foreground/[0.03] focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() => onEdit({ kind: "running", timer })}
      >
        <RunningEntryCardBody
          summary={summary}
          runningDurationMs={runningDurationMs}
        />
      </button>
      <span className="absolute top-2 right-2 flex gap-1">
        {newEntry}
        <TooltipButton
          label="Stop timer"
          className={DOCK_PRIMARY_BUTTON_CLASS}
          render={<button type="button" disabled={disabled} />}
          onClick={() => {
            if (localStore.snapshot().timers.some((t) => t._id === timer._id))
              localStore.saveTimer(timer._id);
          }}
        >
          <RiStopFill className="size-3.5" />
        </TooltipButton>
      </span>
    </section>
  );
}

export function PanelHeader({ today }: { today: string }) {
  const running = useLocalState().timers.length > 0;
  return (
    <header className="flex h-11 shrink-0 items-center justify-between border-b px-3">
      <span className="text-sm font-medium">
        {running ? "Timer running" : "Start a timer"}
      </span>
      <time className="text-xs text-muted-foreground">
        {new Intl.DateTimeFormat("en-CA", {
          weekday: "short",
          month: "short",
          day: "numeric",
        }).format(new Date(`${today}T12:00:00`))}
      </time>
    </header>
  );
}
