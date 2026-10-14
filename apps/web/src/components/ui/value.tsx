import type { ComponentProps, ReactNode } from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const valueVariants = cva("font-mono tabular-nums", {
  variants: {
    size: {
      /* Durations and totals in rows, chips and the top bar. */
      sm: "text-xs",
      /* A value beside body text. */
      base: "text-sm",
      /* A figure's number, as on the backlog item page. */
      lg: "text-lg font-medium",
      /* The one large number on a page: a week or day total. */
      figure: "text-2xl font-medium tracking-tight",
    },
    tone: {
      default: "text-foreground",
      muted: "text-muted-foreground",
      success: "text-[var(--success)]",
      danger: "text-destructive",
    },
  },
  defaultVariants: { size: "sm", tone: "default" },
});

/** A duration, total, count or id: always mono, always tabular. */
function Value({
  className,
  size = "sm",
  tone = "default",
  ...props
}: ComponentProps<"span"> & VariantProps<typeof valueVariants>) {
  return (
    <span
      data-slot="value"
      className={cn(valueVariants({ size, tone }), className)}
      {...props}
    />
  );
}

/**
 * A labeled number, laid inline with its siblings: "Remaining" over "5h".
 * Replaces stat cards.
 */
function Figure({
  label,
  children,
  className,
}: {
  label: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-0.5", className)}>
      <span className="text-xs text-muted-foreground">{label}</span>
      <Value size="lg">{children}</Value>
    </div>
  );
}

/** A row of figures, 32px apart. */
function FigureRow({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="figure-row"
      className={cn("flex flex-wrap gap-x-8 gap-y-3", className)}
      {...props}
    />
  );
}

export { Figure, FigureRow, Value, valueVariants };
