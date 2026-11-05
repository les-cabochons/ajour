import type { ReactNode } from "react";
import { RiAddLine, RiPlayFill, RiStopFill } from "@remixicon/react";
import { TooltipButton } from "@/components/tooltip-button";
import { Button } from "@/components/ui/button";
import { Value } from "@/components/ui/value";
import { formatElapsedDuration } from "@/domain/time/running-entry";
import { useRunningEntry } from "@/features/layout/timer-dock";
import type { TimeEntryEditorTarget } from "@/features/time/time-entry-editor-form";
import { useLocalState } from "@/lib/local-hooks";
import { localStore } from "@/lib/local-store";
import { useTodayIsoDate } from "@/lib/use-now";
import { cn } from "@/lib/utils";

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

export function PanelTimer({
  onEdit,
  disabled = false,
}: {
  onEdit: (target: TimeEntryEditorTarget) => void;
  disabled?: boolean;
}) {
  const { timer, summary, runningDurationMs } = useRunningEntry();
  const today = useTodayIsoDate();
  return (
    <section
      aria-label="Timer"
      className={cn(
        "mx-2.5 mt-2.5 rounded-md border bg-background p-2.5",
        timer && "border-l-2 border-l-[var(--success)]",
      )}
    >
      {timer && summary ? (
        <button
          disabled={disabled}
          className="mb-2 block w-full truncate text-left text-sm font-medium"
          onClick={() => onEdit({ kind: "running", timer })}
        >
          {summary.title}
        </button>
      ) : null}
      <div className="flex items-center gap-1.5">
        <TooltipButton
          label="Create time entry"
          render={
            <Button
              variant="outline"
              size="icon"
              disabled={disabled}
              onClick={() => onEdit({ kind: "create", localDate: today })}
            />
          }
        >
          <RiAddLine />
        </TooltipButton>
        <TooltipButton
          label={timer ? "Stop timer" : "Start timer"}
          render={
            <Button
              size="icon"
              disabled={disabled}
              className="bg-foreground text-background hover:bg-foreground/85"
              onClick={() => {
                if (timer) {
                  if (
                    localStore
                      .snapshot()
                      .timers.some((item) => item._id === timer._id)
                  )
                    localStore.saveTimer(timer._id);
                } else {
                  localStore.startTimer({});
                  const started = localStore.snapshot().timers[0];
                  if (started) onEdit({ kind: "running", timer: started });
                }
              }}
            />
          }
        >
          {timer ? <RiStopFill /> : <RiPlayFill />}
        </TooltipButton>
        {timer ? (
          <Value size="lg" className="ml-1">
            {formatElapsedDuration(runningDurationMs)}
          </Value>
        ) : null}
      </div>
      {summary?.meta ? (
        <div className="mt-2 truncate text-xs text-muted-foreground">
          {summary.meta}
        </div>
      ) : null}
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
