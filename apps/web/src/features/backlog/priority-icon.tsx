import {
  getPriorityLevelName,
  type PriorityLevel,
} from "@/domain/backlog/priority";
import { cn } from "@/lib/utils";

/**
 * The priority level's icon: three dashes for No priority, an orange square
 * with "!" for Urgent, and signal bars for High, Medium and Low. It is labelled
 * with the level's name unless `decorative`.
 */
export function PriorityIcon({
  priority,
  className,
  decorative = false,
}: {
  priority: PriorityLevel | undefined;
  className?: string;
  decorative?: boolean;
}) {
  const a11y = decorative
    ? ({ "aria-hidden": true } as const)
    : ({ role: "img", "aria-label": getPriorityLevelName(priority) } as const);

  if (!priority) {
    return (
      <svg
        viewBox="0 0 14 14"
        className={cn("size-3.5 shrink-0 text-muted-foreground", className)}
        {...a11y}
      >
        {[1.5, 5.75, 10].map((x) => (
          <rect
            key={x}
            x={x}
            y="6.25"
            width="2.5"
            height="1.5"
            rx="0.5"
            fill="currentColor"
            opacity="0.7"
          />
        ))}
      </svg>
    );
  }

  if (priority === 1) {
    return (
      <svg
        viewBox="0 0 14 14"
        className={cn("size-3.5 shrink-0 text-orange-600", className)}
        {...a11y}
      >
        <rect x="1" y="1" width="12" height="12" rx="3" fill="currentColor" />
        <rect
          x="6.25"
          y="3.5"
          width="1.5"
          height="4.5"
          rx="0.75"
          fill="white"
        />
        <rect
          x="6.25"
          y="9.25"
          width="1.5"
          height="1.5"
          rx="0.75"
          fill="white"
        />
      </svg>
    );
  }

  const filledBars = 5 - priority;
  return (
    <svg
      viewBox="0 0 14 14"
      className={cn("size-3.5 shrink-0 text-foreground", className)}
      {...a11y}
    >
      {[0, 1, 2].map((bar) => (
        <rect
          key={bar}
          x={1.5 + bar * 4}
          y={9 - bar * 3}
          width="3"
          height={3 + bar * 3}
          rx="0.75"
          fill="currentColor"
          opacity={bar < filledBars ? 0.9 : 0.2}
        />
      ))}
    </svg>
  );
}
