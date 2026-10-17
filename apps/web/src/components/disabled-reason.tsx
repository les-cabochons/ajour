import type { ReactNode } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

/**
 * Says why a control is disabled. A disabled button gets no pointer events and
 * no focus, so this wrapper carries the tooltip, takes focus, and names the
 * control with its reason, as "Submit week: Commit your changes first". The
 * caller disables the child. Without a reason it renders the child alone.
 */
export function DisabledReason({
  label,
  reason,
  className,
  children,
}: {
  label: string;
  reason?: string;
  /** Classes for the wrapper, such as a width the child needs. */
  className?: string;
  children: ReactNode;
}) {
  if (!reason) return children;

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            tabIndex={0}
            aria-label={`${label}: ${reason}`}
            className={className}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>{reason}</TooltipContent>
    </Tooltip>
  );
}
