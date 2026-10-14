import { useState } from "react";
import { RiArrowDownSLine as ChevronDown } from "@remixicon/react";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export function dateAtNoon(localDate: string) {
  return new Date(`${localDate}T12:00:00`);
}

/** "Oct 14": the narrow titlebar's date. */
export function formatShortTitlebarDate(localDate: string) {
  return new Intl.DateTimeFormat("en-CA", {
    month: "short",
    day: "numeric",
  }).format(dateAtNoon(localDate));
}

/** "Wednesday, Oct 14": the Time page's title in the top bar. */
export function formatLongTitlebarDate(localDate: string) {
  return new Intl.DateTimeFormat("en-CA", {
    weekday: "long",
    month: "short",
    day: "numeric",
  }).format(dateAtNoon(localDate));
}

export function formatCalendarIsoDate(date: Date) {
  return new Intl.DateTimeFormat("en-CA").format(date);
}

/**
 * The selected day with a calendar popover. The narrow titlebar shows it short
 * ("Oct 14"); as the Time page's title (`long`) it reads "Wednesday, Oct 14"
 * with a chevron.
 */
export function TimeDatePicker({
  date,
  onSelectDate,
  long = false,
  className,
}: {
  date: string;
  onSelectDate: (date: string) => void;
  long?: boolean;
  className?: string;
}) {
  const [isOpen, setIsOpen] = useState(false);

  function selectDate(nextDate: string) {
    setIsOpen(false);
    if (nextDate !== date) {
      onSelectDate(nextDate);
    }
  }

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger
        className={cn(
          long ? "ajour-page-title-date" : "ajour-titlebar-date-trigger",
          "desktop-no-drag",
          className,
        )}
        aria-label={`Select time entry date. Current date ${formatShortTitlebarDate(date)}`}
      >
        {long ? formatLongTitlebarDate(date) : formatShortTitlebarDate(date)}
        {long ? <ChevronDown aria-hidden="true" /> : null}
      </PopoverTrigger>
      <PopoverContent
        className="ajour-titlebar-date-popover"
        align="start"
        sideOffset={8}
      >
        <Calendar
          mode="single"
          selected={dateAtNoon(date)}
          onSelect={(selectedDate) => {
            if (selectedDate) {
              selectDate(formatCalendarIsoDate(selectedDate));
            }
          }}
          captionLayout="label"
          buttonVariant="ghost"
          className="ajour-titlebar-calendar"
        />
      </PopoverContent>
    </Popover>
  );
}
