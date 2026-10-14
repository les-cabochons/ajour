import type { ComponentProps, CSSProperties } from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const chipVariants = cva(
  "inline-flex h-5 max-w-full shrink-0 items-center gap-1.5 rounded-[var(--radius-sm)] px-1.5 text-xs font-medium whitespace-nowrap [&>svg]:size-3 [&>svg]:shrink-0",
  {
    variants: {
      tone: {
        /* Metadata: project, type, code, count. */
        neutral: "bg-muted text-muted-foreground",
        /* A selected or highlighted value. */
        accent: "bg-[var(--indigo-muted)] text-primary",
        /* Something the user should look at. */
        warning: "bg-[var(--warning-bg)] text-[var(--warning)]",
        /* Running. */
        success: "bg-[var(--success-bg)] text-[var(--success)]",
        /* Failed or destructive. */
        danger: "bg-[var(--danger-muted)] text-destructive",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

/**
 * The one metadata chip: 20px, 4px corners, 12px text. `color` adds a dot in
 * that color before the label, for projects and workflow states.
 */
function Chip({
  className,
  tone = "neutral",
  color,
  children,
  ...props
}: ComponentProps<"span"> &
  VariantProps<typeof chipVariants> & { color?: string }) {
  return (
    <span
      data-slot="chip"
      className={cn(chipVariants({ tone }), className)}
      {...props}
    >
      {color ? (
        <span
          aria-hidden="true"
          className="size-1.5 shrink-0 rounded-full"
          style={{ background: color } as CSSProperties}
        />
      ) : null}
      <span className="truncate">{children}</span>
    </span>
  );
}

export { Chip, chipVariants };
