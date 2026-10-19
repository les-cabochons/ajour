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
 * how much of it is used; the warning icon marks a total far over its target.
 */
export function CapacityValue({
  capacityMs,
  farOverCapacity,
  label,
  microLabel,
  showWarning,
  totalMs,
}: {
  capacityMs: number;
  farOverCapacity: boolean;
  label: string;
  microLabel?: string;
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
      {showWarning && farOverCapacity ? (
        <AlertTriangle
          className="weekly-capacity-warning"
          aria-label="Over capacity"
        />
      ) : null}
    </div>
  );
}
