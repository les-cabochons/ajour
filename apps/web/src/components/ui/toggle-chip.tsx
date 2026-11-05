import type { ComponentProps, ReactNode } from "react";
import { RiCheckLine } from "@remixicon/react";

import { cn } from "@/lib/utils";

/**
 * A composer chip that is itself the checkbox, as Linear's toggles are: no
 * square inside the pill. On, it shows a check and the foreground; off, the
 * property's icon and the muted color (forms council round 8). It keeps the
 * checkbox role, so assistive tech and keys treat it as one.
 */
export function ToggleChip({
  checked,
  onCheckedChange,
  icon,
  className,
  children,
  onClick,
  ...props
}: Omit<ComponentProps<"button">, "onChange"> & {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  /** The property's mark while off. */
  icon?: ReactNode;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      data-checked={checked ? "true" : undefined}
      className={cn("composer-pill composer-toggle-chip", className)}
      {...props}
      // A host such as a tooltip trigger may add its own click; both run.
      onClick={(event) => {
        onClick?.(event);
        onCheckedChange(!checked);
      }}
    >
      {checked ? <RiCheckLine aria-hidden className="size-3.5" /> : icon}
      {children}
    </button>
  );
}
