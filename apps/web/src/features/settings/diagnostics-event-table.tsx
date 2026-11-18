import {
  memo,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import type { Outcome } from "@ajour/wide-events";
import { Value } from "@/components/ui/value";
import type { LoggedEvent } from "@/lib/desktop-bridge";
import { cn } from "@/lib/utils";
import {
  eventKey,
  formatEventDuration,
  formatEventTime,
  visibleRows,
} from "./diagnostics-events-model";

/** Every row is this tall, so the rows in view follow from the scroll position. */
export const EVENT_ROW_HEIGHT = 28;
const OVERSCAN = 8;
/** The list's height before it is measured, as tall as its CSS gives it. */
const UNMEASURED_HEIGHT = 448;

/**
 * In a table narrower than 28rem (a 390px window) the runtime column is left
 * out and duration narrows, so the name keeps room to read.
 */
const COLUMNS =
  "grid grid-cols-[7rem_0.75rem_minmax(0,1fr)_3.5rem] items-center gap-x-2 px-2 @md:grid-cols-[7.5rem_0.75rem_minmax(0,1fr)_4.5rem_4.5rem]";
const RUNTIME_COLUMN = "hidden @md:block";

/**
 * An outcome as a dot: failed red, refused or cancelled amber, `ok` a quiet
 * disc and `noop` an empty ring, so it never reads by color alone. Its name is
 * its label.
 */
export function OutcomeDot({ outcome }: { outcome: Outcome }) {
  return (
    <span
      role="img"
      aria-label={outcome}
      data-outcome={outcome}
      className={cn(
        "inline-block size-2 shrink-0 rounded-full",
        outcome === "error" || outcome === "timeout"
          ? "bg-destructive"
          : outcome === "refused" || outcome === "cancelled"
            ? "bg-[var(--warning)]"
            : outcome === "noop"
              ? "border border-[var(--text-tertiary)]"
              : "bg-[var(--text-tertiary)]",
      )}
    />
  );
}

const EventRow = memo(function EventRow({
  event,
  index,
  selected,
  now,
  onSelect,
}: {
  event: LoggedEvent;
  index: number;
  selected: boolean;
  now: number;
  onSelect: (event: LoggedEvent) => void;
}) {
  return (
    <div
      role="row"
      aria-rowindex={index + 2}
      aria-selected={selected}
      data-event-key={eventKey(event)}
      className={cn(
        COLUMNS,
        "absolute inset-x-0 top-0 h-7 border-b border-[var(--border-row)] text-sm hover:bg-[var(--hover-bg)]",
        selected && "bg-[var(--highlight-bg)] hover:bg-[var(--highlight-bg)]",
      )}
      style={{ transform: `translateY(${index * EVENT_ROW_HEIGHT}px)` }}
      onClick={() => onSelect(event)}
    >
      <span role="gridcell" className="truncate">
        <Value tone="muted">{formatEventTime(event.started_at, now)}</Value>
      </span>
      <span role="gridcell" className="flex items-center">
        <OutcomeDot outcome={event.outcome} />
      </span>
      <span role="gridcell" className="truncate">
        {event.name}
      </span>
      <span
        role="gridcell"
        className={cn(RUNTIME_COLUMN, "truncate text-xs text-muted-foreground")}
      >
        {event.runtime}
      </span>
      <span role="gridcell" className="truncate text-right">
        <Value>{formatEventDuration(event.duration_ms)}</Value>
      </span>
    </div>
  );
});

/**
 * The Events table: time, outcome, name, runtime and duration, newest first.
 * Only the rows in view and a few around them are rendered, each placed by
 * its index, so thousands of rows scroll as lightly as forty. Reaching the
 * end asks for the next page. Arrow keys move the selection.
 */
export function EventTable({
  events,
  selectedKey,
  now,
  onSelect,
  onNearEnd,
}: {
  events: LoggedEvent[];
  selectedKey: string | null;
  now: number;
  onSelect: (event: LoggedEvent) => void;
  onNearEnd: () => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(UNMEASURED_HEIGHT);

  useLayoutEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const measure = () =>
      setViewportHeight(element.clientHeight || UNMEASURED_HEIGHT);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const { start, end } = visibleRows({
    scrollTop,
    viewportHeight,
    rowHeight: EVENT_ROW_HEIGHT,
    count: events.length,
    overscan: OVERSCAN,
  });

  const nearEnd = events.length > 0 && end >= events.length - OVERSCAN;
  useEffect(() => {
    if (nearEnd) onNearEnd();
  }, [nearEnd, events.length, onNearEnd]);

  const selectedIndex = selectedKey
    ? events.findIndex((event) => eventKey(event) === selectedKey)
    : -1;

  const onKeyDown = (keyEvent: KeyboardEvent<HTMLDivElement>) => {
    const step =
      keyEvent.key === "ArrowDown" ? 1 : keyEvent.key === "ArrowUp" ? -1 : 0;
    if (step === 0 || events.length === 0) return;
    keyEvent.preventDefault();
    const next = Math.min(
      events.length - 1,
      Math.max(0, selectedIndex === -1 ? 0 : selectedIndex + step),
    );
    onSelect(events[next]!);
    const element = scroller.current;
    if (!element) return;
    const top = next * EVENT_ROW_HEIGHT;
    if (top < element.scrollTop) element.scrollTop = top;
    else if (top + EVENT_ROW_HEIGHT > element.scrollTop + viewportHeight)
      element.scrollTop = top + EVENT_ROW_HEIGHT - viewportHeight;
  };

  const rows = [];
  for (let index = start; index < end; index += 1) {
    const event = events[index]!;
    rows.push(
      <EventRow
        key={eventKey(event)}
        event={event}
        index={index}
        selected={index === selectedIndex}
        now={now}
        onSelect={onSelect}
      />,
    );
  }

  return (
    <div
      role="grid"
      aria-label="Events"
      aria-rowcount={events.length + 1}
      aria-colcount={5}
      className="@container flex min-w-0 flex-col border-y"
    >
      <div
        role="row"
        aria-rowindex={1}
        className={cn(
          COLUMNS,
          "h-7 shrink-0 border-b text-2xs font-medium text-muted-foreground",
        )}
      >
        <span role="columnheader">Time</span>
        <span role="columnheader" aria-label="Outcome" />
        <span role="columnheader">Name</span>
        <span role="columnheader" className={RUNTIME_COLUMN}>
          Runtime
        </span>
        <span role="columnheader" className="text-right">
          Duration
        </span>
      </div>
      <div
        ref={scroller}
        role="rowgroup"
        tabIndex={0}
        aria-label="Event rows"
        data-testid="event-rows"
        className="relative h-112 overflow-y-auto outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
        onScroll={(scrollEvent) =>
          setScrollTop(scrollEvent.currentTarget.scrollTop)
        }
        onKeyDown={onKeyDown}
      >
        <div
          className="relative"
          style={{ height: events.length * EVENT_ROW_HEIGHT }}
        >
          {rows}
        </div>
      </div>
    </div>
  );
}
