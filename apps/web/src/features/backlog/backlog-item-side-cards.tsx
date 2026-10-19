import { useId, useRef, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import {
  RiAddLine as AddIcon,
  RiArrowRightSLine as ChevronIcon,
} from "@remixicon/react";
import { TooltipButton } from "@/components/tooltip-button";
import { Button } from "@/components/ui/button";
import { Value } from "@/components/ui/value";
import {
  getSubitemHoursLeft,
  getSubitemProgress,
} from "@/domain/backlog/backlog-view";
import type { LocalTimesheetEntry, LocalWorkItem } from "@/domain/local-state";
import { formatClockDuration } from "@/domain/time/duration";
import { formatHours } from "@/features/backlog/backlog-estimates";
import { AddSubitemRow } from "@/features/backlog/backlog-item-inline-edit";
import { PriorityIcon } from "@/features/backlog/priority-icon";
import {
  WorkItemIcon,
  resolveWorkItemIcon,
  type useWorkItemIconData,
} from "@/features/backlog/work-item-icons";
import { cn } from "@/lib/utils";

/** Above this many subitems the segments would be too thin to read. */
const MAX_PROGRESS_SEGMENTS = 10;

/** "Fri, Oct 17", the day an entry was logged. */
function formatEntryDay(localDate: string) {
  return new Date(`${localDate}T12:00:00`).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

/**
 * A card under the properties on the item page. The header opens and closes
 * it, and its + adds a row. A closed card shows `summary` instead of its rows.
 */
function FoldingCard({
  label,
  trailing,
  open,
  onOpenChange,
  addLabel,
  onAdd,
  summary,
  children,
}: {
  label: string;
  trailing?: ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  addLabel: string;
  /** Missing on a read-only item. */
  onAdd?: (button: HTMLElement) => void;
  summary: ReactNode;
  children: ReactNode;
}) {
  const contentId = useId();
  // The state shown when the primary button went down on the title. Pressing
  // it can blur an empty name field, which folds the card before the click
  // lands; the click must still fold it, not reopen it. Keyboard clicks act
  // on the current state.
  const openAtPress = useRef<boolean | null>(null);
  return (
    <section className="backlog-item-card" aria-label={label}>
      <div className="backlog-item-card-header">
        <h2 className="min-w-0 flex-1">
          <button
            type="button"
            aria-expanded={open}
            aria-controls={contentId}
            className="backlog-item-card-toggle"
            onPointerDown={(event) => {
              openAtPress.current = event.button === 0 ? open : null;
            }}
            onPointerLeave={() => {
              openAtPress.current = null;
            }}
            onClick={(event) => {
              const wasOpen =
                event.detail > 0 ? (openAtPress.current ?? open) : open;
              openAtPress.current = null;
              onOpenChange(!wasOpen);
            }}
          >
            <ChevronIcon
              aria-hidden="true"
              className={cn("size-4 shrink-0", open && "rotate-90")}
            />
            <span className="min-w-0 flex-1 truncate">{label}</span>
            {trailing !== undefined ? (
              <span className="shrink-0 font-normal">{trailing}</span>
            ) : null}
          </button>
        </h2>
        {onAdd ? (
          <TooltipButton
            label={addLabel}
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                className="text-muted-foreground"
              />
            }
            onClick={(event) => onAdd(event.currentTarget)}
          >
            <AddIcon className="size-4" />
          </TooltipButton>
        ) : null}
      </div>
      <div
        id={contentId}
        className={
          open ? "backlog-item-card-body" : "backlog-item-card-summary"
        }
      >
        {open ? children : summary}
      </div>
    </section>
  );
}

/**
 * The item's subitems. Closed, it shows one segment per subitem, filled when
 * done, and the hours left on the open ones. Adding opens it until the name
 * field closes, without changing the saved open state.
 */
export function SubitemsCard({
  parent,
  subitems,
  iconData,
  from,
  open,
  onOpenChange,
  readOnly,
  adding,
  onAdd,
  onAddingClose,
}: {
  parent: LocalWorkItem;
  subitems: LocalWorkItem[];
  iconData: ReturnType<typeof useWorkItemIconData>;
  /** The page the item page was opened from, which subitem links keep. */
  from: string | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  readOnly: boolean;
  adding: boolean;
  onAdd: () => void;
  /** `escaped` when Escape closed the name field, rather than a blur or a fold. */
  onAddingClose: (escaped: boolean) => void;
}) {
  const progress = getSubitemProgress(subitems);
  const hoursLeft = getSubitemHoursLeft(subitems);
  const empty = <p className="text-xs text-muted-foreground">No subitems.</p>;

  return (
    <FoldingCard
      label="Subitems"
      trailing={
        progress ? (
          <>
            <Value>{progress.closed}</Value> of <Value>{progress.total}</Value>{" "}
            done
          </>
        ) : undefined
      }
      open={open || adding}
      onOpenChange={(next) => {
        if (!next && adding) onAddingClose(false);
        onOpenChange(next);
      }}
      addLabel="Add subitem"
      onAdd={readOnly ? undefined : onAdd}
      summary={
        progress ? (
          <>
            <div
              aria-hidden="true"
              className="backlog-item-card-progress"
              data-continuous={
                progress.total > MAX_PROGRESS_SEGMENTS || undefined
              }
            >
              {progress.total > MAX_PROGRESS_SEGMENTS ? (
                <i
                  data-done=""
                  style={{
                    width: `${(progress.closed / progress.total) * 100}%`,
                  }}
                />
              ) : (
                subitems.map((subitem) => (
                  <i
                    key={subitem._id}
                    data-done={subitem.status === "archived" || undefined}
                  />
                ))
              )}
            </div>
            {hoursLeft !== undefined ? (
              <span>
                <Value tone="muted">{formatHours(hoursLeft)}</Value> left
              </span>
            ) : null}
          </>
        ) : (
          empty
        )
      }
    >
      {subitems.length === 0 && !adding ? (
        empty
      ) : (
        <div className="backlog-item-rows">
          {subitems.map((subitem) => (
            <Link
              key={subitem._id}
              to="/backlog/$itemId"
              params={{ itemId: subitem._id }}
              search={{ from }}
              className="backlog-item-row"
            >
              <WorkItemIcon icon={resolveWorkItemIcon(subitem, iconData)} />
              <span
                className={cn(
                  "backlog-item-row-title",
                  subitem.status === "archived" && "text-muted-foreground",
                )}
              >
                {subitem.title}
              </span>
              {subitem.priority !== undefined ? (
                <PriorityIcon priority={subitem.priority} />
              ) : null}
              <Value tone="muted" className="w-10 text-right">
                {formatHours(subitem.remainingEstimateHours)}
              </Value>
            </Link>
          ))}
        </div>
      )}
      {!readOnly ? (
        <AddSubitemRow
          parent={parent}
          adding={adding}
          onClose={onAddingClose}
        />
      ) : null}
    </FoldingCard>
  );
}

/**
 * The time logged on the item, newest first. Closed, it shows how many
 * entries there are and the last day one was logged.
 */
export function TimeEntriesCard({
  entries,
  loggedMs,
  open,
  onOpenChange,
  onAdd,
}: {
  /** Newest first. */
  entries: LocalTimesheetEntry[];
  loggedMs: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Opens the new entry popover on the + button; missing when read-only. */
  onAdd?: (button: HTMLElement) => void;
}) {
  const last = entries[0];
  const empty = (
    <p className="text-xs text-muted-foreground">No time logged yet.</p>
  );
  return (
    <FoldingCard
      label="Time entries"
      trailing={
        entries.length ? (
          <Value>{formatClockDuration(loggedMs)}</Value>
        ) : undefined
      }
      open={open}
      onOpenChange={onOpenChange}
      addLabel="Add time entry"
      onAdd={onAdd}
      summary={
        last ? (
          <span>
            <Value tone="muted">{entries.length}</Value>{" "}
            {entries.length === 1 ? "entry" : "entries"} · last on{" "}
            {formatEntryDay(last.localDate)}
          </span>
        ) : (
          empty
        )
      }
    >
      {entries.length === 0 ? (
        empty
      ) : (
        <div className="backlog-item-rows">
          {entries.map((entry) => (
            <Link
              key={entry._id}
              to="/time/$date"
              params={{ date: entry.localDate }}
              className="backlog-item-row"
            >
              <span className="w-20 shrink-0 text-muted-foreground">
                {formatEntryDay(entry.localDate)}
              </span>
              <span className="backlog-item-row-title">
                {entry.note ?? (
                  <span className="text-muted-foreground">No note</span>
                )}
              </span>
              <Value>{formatClockDuration(entry.durationMs)}</Value>
            </Link>
          ))}
        </div>
      )}
    </FoldingCard>
  );
}
