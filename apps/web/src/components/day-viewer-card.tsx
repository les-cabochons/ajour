import type { ReactNode } from "react";
import {
  RiArrowLeftSLine as ChevronLeft,
  RiArrowRightSLine as ChevronRight,
  RiArrowGoBackLine as ReturnIcon,
} from "@remixicon/react";
import { addDaysIsoDate, cn } from "@/lib/utils";

function dateAtNoon(localDate: string) {
  return new Date(`${localDate}T12:00:00`);
}

function formatWeekdayLong(localDate: string) {
  return new Intl.DateTimeFormat("en-CA", { weekday: "long" }).format(dateAtNoon(localDate));
}

function formatMonthDay(localDate: string) {
  return new Intl.DateTimeFormat("en-CA", { month: "short", day: "numeric" }).format(
    dateAtNoon(localDate),
  );
}

function formatWeekday(localDate: string) {
  return new Intl.DateTimeFormat("en-CA", { weekday: "short" }).format(dateAtNoon(localDate));
}

function formatDayNumber(localDate: string) {
  return new Intl.DateTimeFormat("en-CA", { day: "2-digit" }).format(dateAtNoon(localDate));
}

interface DayViewerCardProps {
  date: string;
  today: string;
  weekDates: string[];
  totalLabel: string;
  totalValue: string;
  getDayValue: (localDate: string) => string;
  onSelectDate: (localDate: string) => void;
  dateScopeControl?: ReactNode;
  headerActions?: ReactNode;
}

export function DayViewerCard({
  date,
  today,
  weekDates,
  totalLabel,
  totalValue,
  getDayValue,
  onSelectDate,
  dateScopeControl,
  headerActions,
}: DayViewerCardProps) {
  return (
    <div className="day-viewer">
      {/* Mobile layout */}
      <div className="day-viewer-mobile lg:hidden">
        <div className="day-viewer-date-section-mobile">
          <div className="day-viewer-arrows">
            <button
              type="button"
              className="day-viewer-arrow"
              onClick={() => onSelectDate(addDaysIsoDate(date, -1))}
              aria-label="Previous day"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              className="day-viewer-arrow"
              onClick={() => onSelectDate(addDaysIsoDate(date, 1))}
              aria-label="Next day"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
          <div>
            <p className="day-viewer-date-kicker">
              <span className="day-viewer-weekday-label">{formatWeekdayLong(date)}</span>
              {date === today ? <span className="day-viewer-today-muted">Today</span> : null}
            </p>
            <p className="day-viewer-date-big">{formatMonthDay(date).toUpperCase()}</p>
          </div>
        </div>

        {date !== today ? (
          <button
            type="button"
            className="day-viewer-today-link"
            onClick={() => onSelectDate(today)}
          >
            Today
          </button>
        ) : null}
      </div>

      {/* Desktop layout: single horizontal strip */}
      <div className="day-viewer-strip hidden lg:flex">
        {/* Left: arrows + date */}
        <div className="day-viewer-date-section">
          <div className="day-viewer-arrows">
            <button
              type="button"
              className="day-viewer-arrow"
              onClick={() => onSelectDate(addDaysIsoDate(date, -1))}
              aria-label="Previous day"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              className="day-viewer-arrow"
              onClick={() => onSelectDate(addDaysIsoDate(date, 1))}
              aria-label="Next day"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
          <div className="day-viewer-date-text">
            <span className="day-viewer-date-kicker">
              <span className="day-viewer-weekday-label">{formatWeekdayLong(date)}</span>
              {date === today ? (
                <span className="day-viewer-today-muted">Today</span>
              ) : (
                <button
                  type="button"
                  className="day-viewer-return-to-today"
                  onClick={() => onSelectDate(today)}
                  aria-label="Return to today"
                >
                  <ReturnIcon className="h-2.5 w-2.5" />
                </button>
              )}
            </span>
            <span className="day-viewer-date-big-row">
              <span className="day-viewer-date-big">{formatMonthDay(date).toUpperCase()}</span>
              {dateScopeControl}
            </span>
          </div>
        </div>

        {/* Center: week day columns */}
        <div className="day-viewer-days">
          {weekDates.map((day) => {
            const isSelected = day === date;
            const isToday = day === today;

            return (
              <button
                key={day}
                type="button"
                onClick={() => onSelectDate(day)}
                className={cn("day-viewer-day", isSelected && "is-selected", isToday && "is-today")}
              >
                <span
                  className={cn(
                    "day-viewer-day-name",
                    isSelected && "is-selected",
                    isToday && "is-today",
                  )}
                >
                  {formatWeekday(day).toUpperCase()}
                </span>
                <span className="day-viewer-day-number">{formatDayNumber(day)}</span>
                <span className="day-viewer-day-hours">{getDayValue(day)}</span>
              </button>
            );
          })}
        </div>

        {/* Right: week total + actions */}
        <div className="day-viewer-end">
          <div className="day-viewer-week-total">
            <span className="day-viewer-week-total-label">{totalLabel.toUpperCase()}</span>
            <span className="day-viewer-week-total-value">{totalValue}</span>
          </div>
          {headerActions}
        </div>
      </div>
    </div>
  );
}
