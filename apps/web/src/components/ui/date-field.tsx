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
  ...props
}: Omit<ComponentProps<typeof Input>, "value" | "onChange" | "type"> & {
  value: string;
  onChange: (value: string) => void;
  calendarLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = isValidLocalDate(value) ? dateAtNoon(value) : undefined;

  return (
    <div className={cn("relative", className)}>
      <Input
        {...props}
        value={value}
        inputMode="numeric"
        placeholder="YYYY-MM-DD"
        className="pr-8 font-mono"
        onChange={(event) => onChange(event.target.value)}
      />
      <Popover open={open} onOpenChange={setOpen}>
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
            defaultMonth={selected}
            onSelect={(date) => {
              if (date) {
                onChange(formatIsoDate(date));
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
