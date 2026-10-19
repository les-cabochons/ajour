import { RiAlertLine as AlertTriangle } from "@remixicon/react";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { formatClockDuration } from "@/domain/time/duration";
import { cn } from "@/lib/utils";

/** Formats a Week view day, such as "Mon" or "Monday", from a local date. */
export function formatWeekDay(
  localDate: string,
  options: Intl.DateTimeFormatOptions,
) {
  return new Intl.DateTimeFormat("en-CA", options).format(
    new Date(`${localDate}T12:00:00`),
  );
}

/**
 * A day or week total in the Week view. Hovering shows the capacity target and
 * how much of it is used; the warning icon marks a total more than 50% over
 * its target.
 */
export function CapacityValue({
  capacityMs,
  label,
  microLabel,
  overCapacity,
  showWarning,
  totalMs,
}: {
  capacityMs: number;
  label: string;
  microLabel?: string;
  overCapacity: boolean;
  showWarning: boolean;
  totalMs: number;
}) {
  const utilization =
    capacityMs > 0 ? Math.round((totalMs / capacityMs) * 100) : null;
  return (
    <div className={cn("weekly-capacity-value", microLabel && "is-summary")}>
      {microLabel ? (
        <span className="weekly-capacity-label">{microLabel}</span>
      ) : null}
      <HoverCard>
        <HoverCardTrigger className="weekly-capacity-trigger">
          {formatClockDuration(totalMs)}
        </HoverCardTrigger>
        <HoverCardContent className="w-56" align="end">
          <span className="font-medium">{label}</span>
          <span className="text-muted-foreground">
            {formatClockDuration(totalMs)} logged ·{" "}
            {formatClockDuration(capacityMs)} target
          </span>
          <span className="text-muted-foreground">
            {utilization === null
              ? "No capacity target"
              : `${utilization}% of capacity`}
          </span>
        </HoverCardContent>
      </HoverCard>
      {showWarning && overCapacity ? (
        <AlertTriangle
          className="weekly-capacity-warning"
          aria-label="Over capacity"
        />
      ) : null}
    </div>
  );
}
