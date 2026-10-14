import type { ComponentProps, ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * A cardless section's heading: 12px, medium, muted, with room for a count or
 * total on the right. Sections sit 20px apart; the heading sits 6px above its
 * rows.
 */
export function SectionHeading({
  children,
  trailing,
  className,
  ...props
}: ComponentProps<"h2"> & { trailing?: ReactNode }) {
  return (
    <h2
      className={cn(
        "mt-5 mb-1.5 flex h-5 items-center gap-2 text-xs font-medium text-muted-foreground first:mt-0",
        className,
      )}
      {...props}
    >
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {trailing !== undefined ? (
        <span className="shrink-0 font-normal">{trailing}</span>
      ) : null}
    </h2>
  );
}
