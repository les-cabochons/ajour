import { useEffect, useRef } from "react";
import {
  RiAddLine as Plus,
  RiCloseLine as X,
  RiLockLine as Lock,
} from "@remixicon/react";
import { ObjectContextMenu } from "@/components/object-actions-menu";
import { TooltipButton } from "@/components/tooltip-button";
import { Button } from "@/components/ui/button";
import { formatClockDuration } from "@/domain/time/duration";
import { selectWeeklyGridCell } from "@/domain/time/weekly-time";
import { useTimeEntryActions } from "@/features/time/time-entry-actions";
import type {
  WeekGridCell,
  WeekGridOpenRequest,
} from "@/features/time/week-grid";
import { formatWeekDay } from "@/features/time/weekly-capacity-value";
import { useLocalState } from "@/lib/local-hooks";
import { getTimerDurationsMs } from "@/lib/timer-totals";
import { useRunningClock } from "@/lib/use-now";

/**
 * The side panel content for a Grid cell with several entries: the cell's entries,
 * the running entry when it is in the cell, and "Add another entry". A click on an
 * entry opens it in the panel's editor; a right-click opens its action set.
 */
export function WeekGridCellPanel({
  cell,
  onClose,
  onOpen,
}: {
  cell: WeekGridCell;
  onClose: () => void;
  onOpen: (request: WeekGridOpenRequest) => void;
}) {
  const state = useLocalState();
  const currentTimer = state.timers[0] ?? null;
  const rootRef = useRef<HTMLDivElement>(null);
  const { rows, hasRunning } = selectWeeklyGridCell({
    entries: state.timesheetEntries,
    localDate: cell.localDate,
    rowKey: cell.rowKey,
    running: currentTimer,
  });
  const now = useRunningClock(hasRunning);
  const runningTarget =
    hasRunning && currentTimer
      ? { kind: "running" as const, timerId: currentTimer._id }
      : null;
  const entryActions = useTimeEntryActions({
    onEdit: (target) =>
      onOpen(
        target.kind === "running"
          ? { timerId: target.timerId, cell }
          : { entryId: target.entry._id, cell },
      ),
  });

  useEffect(() => {
    rootRef.current?.querySelector<HTMLElement>("[data-cell-entry]")?.focus();
  }, []);

  return (
    <div
      ref={rootRef}
      className="flex flex-col gap-4"
      onKeyDown={(event) => {
        if (
          event.key === "Escape" &&
          !event.defaultPrevented &&
          event.target instanceof Node &&
          event.currentTarget.contains(event.target)
        ) {
          event.preventDefault();
          onClose();
        }
      }}
    >
      <header className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 className="truncate text-sm font-semibold">{cell.taskName}</h2>
          <span className="truncate text-xs text-muted-foreground">
            {cell.projectName} ·{" "}
            {formatWeekDay(cell.localDate, {
              weekday: "short",
              month: "short",
              day: "numeric",
            })}
          </span>
        </div>
        <TooltipButton
          label="Close"
          render={<Button variant="ghost" size="icon" onClick={onClose} />}
        >
          <X />
        </TooltipButton>
      </header>

      <div
        className="weekly-grid-cell-entries"
        role="group"
        aria-label="Time entries"
      >
        {rows.map((row) => {
          if (row === "running") {
            return runningTarget && currentTimer ? (
              <div key="running" className="weekly-grid-cell-entry-row">
                <ObjectContextMenu
                  actions={entryActions.getActions(runningTarget)}
                  onAction={(actionId) =>
                    entryActions.runAction(runningTarget, actionId)
                  }
                  render={
                    <button
                      type="button"
                      data-cell-entry=""
                      className="weekly-grid-cell-entry is-running"
                      onClick={() =>
                        onOpen({ timerId: currentTimer._id, cell })
                      }
                    />
                  }
                >
                  <Lock />
                  <span>Running</span>
                  <strong>
                    {formatClockDuration(
                      getTimerDurationsMs(currentTimer, now).runningDurationMs,
                    )}
                  </strong>
                </ObjectContextMenu>
              </div>
            ) : null;
          }

          const target = { kind: "entry" as const, entry: row };
          return (
            <div key={row._id} className="weekly-grid-cell-entry-row">
              <ObjectContextMenu
                actions={entryActions.getActions(target)}
                onAction={(actionId) =>
                  entryActions.runAction(target, actionId)
                }
                render={
                  <button
                    type="button"
                    data-cell-entry=""
                    data-entry-id={row._id}
                    className="weekly-grid-cell-entry"
                    onClick={() => onOpen({ entryId: row._id, cell })}
                  />
                }
              >
                <span className={row.note ? undefined : "is-placeholder"}>
                  {row.note || "No note"}
                </span>
                <strong>{formatClockDuration(row.durationMs)}</strong>
              </ObjectContextMenu>
            </div>
          );
        })}
      </div>

      <Button
        type="button"
        variant="outline"

        className="self-start"
        onClick={() => onOpen({ cell })}
      >
        <Plus data-icon="inline-start" />
        Add another entry
      </Button>
      {entryActions.dialogs}
    </div>
  );
}
