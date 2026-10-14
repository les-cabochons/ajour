import type { ComponentProps, ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * An object's properties as label and value pairs, 10px apart, with no frame.
 * Replaces the boxed side panel on detail pages. A value may be a picker.
 */
export function PropertyList({ className, ...props }: ComponentProps<"dl">) {
  return (
    <dl
      data-slot="property-list"
      className={cn(
        "grid grid-cols-[minmax(5.5rem,auto)_minmax(0,1fr)] items-center gap-x-3 gap-y-2.5 text-sm",
        className,
      )}
      {...props}
    />
  );
}

export function PropertyRow({
  label,
  children,
  className,
}: {
  label: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <>
      <dt
        className={cn("min-h-7 self-center text-muted-foreground", className)}
      >
        {label}
      </dt>
      <dd className="flex min-h-7 min-w-0 items-center gap-1.5">{children}</dd>
    </>
  );
}
