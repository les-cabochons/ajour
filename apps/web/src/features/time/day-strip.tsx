import { Value } from "@/components/ui/value";
import { cn } from "@/lib/utils";

function dateAtNoon(localDate: string) {
  return new Date(`${localDate}T12:00:00`);
}

function formatWeekday(localDate: string) {
  return new Intl.DateTimeFormat("en-CA", { weekday: "short" }).format(
    dateAtNoon(localDate),
  );
}

function formatDayNumber(localDate: string) {
  return new Intl.DateTimeFormat("en-CA", { day: "numeric" }).format(
    dateAtNoon(localDate),
  );
}

/**
 * The Day view's week strip: one tab per visible day with its total, and the week's
 * total at the end. The selected day is underlined; today's number is bold.
 * The date itself and the arrows live in the top bar. While Day rows are dragged,
 * every other day's tab is a drop target: `registerDropTarget` hands the Day list
 * its element, and `dropTargetDate` lights up the one under the pointer.
 */
export function DayStrip({
  date,
  today,
  weekDates,
  totalLabel,
  totalValue,
  getDayValue,
  onSelectDate,
  dropTargetDate,
  registerDropTarget,
}: {
  date: string;
  today: string;
  weekDates: string[];
  totalLabel: string;
  totalValue: string;
  getDayValue: (localDate: string) => string;
  onSelectDate: (localDate: string) => void;
  dropTargetDate?: string | null;
  registerDropTarget?: (localDate: string, node: HTMLElement | null) => void;
}) {
  return (
    <div
      className="day-strip"
      style={{
        gridTemplateColumns: weekDates.length
          ? `repeat(${weekDates.length}, minmax(0, 1fr)) auto`
          : "auto",
      }}
      role="tablist"
      aria-label="Days of the week"
    >
      {weekDates.map((day) => {
        const isSelected = day === date;
        const isToday = day === today;
        const value = getDayValue(day);
        return (
          <button
            key={day}
            // The shown day is not a drop target: its rows are already there.
            ref={
              registerDropTarget && !isSelected
                ? (node) => registerDropTarget(day, node)
                : undefined
            }
            type="button"
            role="tab"
            aria-selected={isSelected}
            onClick={() => onSelectDate(day)}
            className={cn(
              "day-strip-day",
              isSelected && "is-selected",
              isToday && "is-today",
              day === dropTargetDate && "is-drop-target",
            )}
          >
            <span className="day-strip-weekday">
              {formatWeekday(day).toUpperCase()}
            </span>
            <span className="day-strip-number">{formatDayNumber(day)}</span>
            <Value
              className={cn("day-strip-hours", value === "0:00" && "is-empty")}
              tone={isSelected ? "default" : "muted"}
            >
              {value === "0:00" ? "—" : value}
            </Value>
          </button>
        );
      })}
      <div className="day-strip-total">
        <span className="day-strip-total-label">{totalLabel}</span>
        <Value size="base" className="day-strip-total-value">
          {totalValue}
        </Value>
      </div>
    </div>
  );
}
