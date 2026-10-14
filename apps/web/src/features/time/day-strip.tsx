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
 * The Day view's week strip: one tab per day with its total, and the week's
 * total at the end. The selected day is underlined; today's number is bold.
 * The date itself and the arrows live in the top bar.
 */
export function DayStrip({
  date,
  today,
  weekDates,
  totalLabel,
  totalValue,
  getDayValue,
  onSelectDate,
}: {
  date: string;
  today: string;
  weekDates: string[];
  totalLabel: string;
  totalValue: string;
  getDayValue: (localDate: string) => string;
  onSelectDate: (localDate: string) => void;
}) {
  return (
    <div className="day-strip" role="tablist" aria-label="Days of the week">
      {weekDates.map((day) => {
        const isSelected = day === date;
        const isToday = day === today;
        const value = getDayValue(day);
        return (
          <button
            key={day}
            type="button"
            role="tab"
            aria-selected={isSelected}
            onClick={() => onSelectDate(day)}
            className={cn(
              "day-strip-day",
              isSelected && "is-selected",
              isToday && "is-today",
            )}
          >
            <span className="day-strip-weekday">
              {formatWeekday(day).toUpperCase()}
            </span>
            <span className="day-strip-number">{formatDayNumber(day)}</span>
            <Value
              className={cn(
                "day-strip-hours",
                value === "0:00" && "is-empty",
              )}
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
