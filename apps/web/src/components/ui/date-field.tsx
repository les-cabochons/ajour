import { useState, type ComponentProps } from "react";
import { RiCalendarLine as CalendarIcon } from "@remixicon/react";
import { TooltipButton } from "@/components/tooltip-button";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { isValidLocalDate } from "@/domain/time/local-date";
import { cn } from "@/lib/utils";

function dateAtNoon(localDate: string) {
  return new Date(`${localDate}T12:00:00`);
}

function formatIsoDate(date: Date) {
  return new Intl.DateTimeFormat("en-CA").format(date);
}

/** A date as people say it: Today, Yesterday, Tomorrow, or "Thu, Oct 15". */
function describeDate(localDate: string) {
  if (!isValidLocalDate(localDate)) return localDate || "Pick a date";
  const today = formatIsoDate(new Date());
  const shift = (days: number) => {
    const date = dateAtNoon(today);
    date.setDate(date.getDate() + days);
    return formatIsoDate(date);
  };
  if (localDate === today) return "Today";
  if (localDate === shift(-1)) return "Yesterday";
  if (localDate === shift(1)) return "Tomorrow";
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(dateAtNoon(localDate));
}

/**
 * A date as an ISO text input ("2026-10-14") with a calendar popover beside
 * it, in place of the browser's own date control. Typing and the calendar
 * both call `onChange` with an ISO date; a partial typed value is passed
 * through so the form can show its error.
 */
export function DateField({
  value,
  onChange,
  className,
  calendarLabel = "Pick a date",
  chip = false,
  ...props
}: Omit<ComponentProps<typeof Input>, "value" | "onChange" | "type"> & {
  value: string;
  onChange: (value: string) => void;
  calendarLabel?: string;
  /**
   * A composer chip: the date in words ("Today", "Thu, Oct 15"), the
   * calendar icon first, opening the calendar with a typed date in it
   * (forms council round 9).
   */
  chip?: boolean;
}) {
  const [open, setOpen] = useState(false);
  // The month the calendar shows. It follows a valid typed value, including
  // one typed while the picker is open, and the arrows move it from there.
  const [month, setMonth] = useState<Date | undefined>();
  const selected = isValidLocalDate(value) ? dateAtNoon(value) : undefined;

  function change(next: string) {
    onChange(next);
    if (isValidLocalDate(next)) setMonth(dateAtNoon(next));
  }

  if (chip) {
    return (
      <Popover
        open={open}
        onOpenChange={(next) => {
          if (next) setMonth(selected);
          setOpen(next);
        }}
      >
        <PopoverTrigger
          render={
            <button
              type="button"
              id={props.id}
              aria-label={
                props["aria-label"]
                  ? `${props["aria-label"]}: ${describeDate(value)}`
                  : undefined
              }
              aria-invalid={props["aria-invalid"]}
              disabled={props.disabled}
              className={cn("composer-pill composer-date-chip", className)}
            />
          }
        >
          <CalendarIcon
            aria-hidden
            className="size-3.5 text-muted-foreground"
          />
          <span data-placeholder={value ? undefined : ""}>
            {describeDate(value)}
          </span>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-2" align="start" sideOffset={6}>
          <Input
            aria-label={`${calendarLabel}, typed`}
            value={value}
            inputMode="numeric"
            placeholder="YYYY-MM-DD"
            className="mb-2 font-mono"
            onChange={(event) => change(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") setOpen(false);
            }}
          />
          <Calendar
            mode="single"
            selected={selected}
            month={month}
            onMonthChange={setMonth}
            onSelect={(date) => {
              if (date) {
                change(formatIsoDate(date));
                setOpen(false);
              }
            }}
            captionLayout="label"
            buttonVariant="ghost"
          />
        </PopoverContent>
      </Popover>
    );
  }

  return (
    <div className={cn("relative", className)}>
      <Input
        {...props}
        value={value}
        inputMode="numeric"
        placeholder="YYYY-MM-DD"
        className="pr-8 font-mono"
        onChange={(event) => change(event.target.value)}
      />
      <Popover
        open={open}
        onOpenChange={(next) => {
          if (next) setMonth(selected);
          setOpen(next);
        }}
      >
        <TooltipButton
          label={calendarLabel}
          render={
            <PopoverTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="absolute top-1/2 right-1 -translate-y-1/2 text-muted-foreground"
                />
              }
            />
          }
        >
          <CalendarIcon />
        </TooltipButton>
        <PopoverContent className="w-auto p-0" align="end" sideOffset={6}>
          <Calendar
            mode="single"
            selected={selected}
            month={month}
            onMonthChange={setMonth}
            onSelect={(date) => {
              if (date) {
                change(formatIsoDate(date));
                setOpen(false);
              }
            }}
            captionLayout="label"
            buttonVariant="ghost"
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}
