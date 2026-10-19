import { useId, type ComponentProps, type ReactNode } from "react";
import { RiArrowRightSLine as ChevronIcon } from "@remixicon/react";

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

/**
 * The actions at the bottom of a properties card, under a rule. Each action
 * is one equal column.
 */
export function PropertyActions({
  className,
  ...props
}: ComponentProps<"div">) {
  return (
    <div
      data-slot="property-actions"
      className={cn(
        "grid auto-cols-fr grid-flow-col gap-2 border-t pt-3",
        className,
      )}
      {...props}
    />
  );
}

/**
 * A borderless action tile: a 20px icon over a small label in the muted
 * color. Hover only brightens the text, Archive included.
 */
export function PropertyAction({
  className,
  type = "button",
  ...props
}: ComponentProps<"button">) {
  return (
    <button
      type={type}
      data-slot="property-action"
      className={cn(
        "flex min-h-14 cursor-pointer flex-col items-center justify-center gap-1.5 rounded-md p-2 text-xs font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:text-muted-foreground [&_svg]:pointer-events-none [&_svg]:size-5 [&_svg]:shrink-0",
        className,
      )}
      {...props}
    />
  );
}

/**
 * A section of a properties card that its title opens and closes: a chevron,
 * the title and an optional trailing value. A top-level section sits under a
 * rule; a nested one does not. `indent` lines the content up under the title.
 * The project page's plugin sections and a description's frontmatter use it.
 */
export function PropertySection({
  title,
  trailing,
  open,
  onOpenChange,
  nested = false,
  indent = false,
  children,
}: {
  title: ReactNode;
  trailing?: ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  nested?: boolean;
  indent?: boolean;
  children: ReactNode;
}) {
  const contentId = useId();
  return (
    <div className={cn("flex flex-col gap-2.5", !nested && "border-t pt-3")}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={contentId}
        className="flex min-w-0 items-center gap-1 text-left text-xs font-medium text-muted-foreground hover:text-foreground"
        onClick={() => onOpenChange(!open)}
      >
        <ChevronIcon
          aria-hidden="true"
          className={cn("size-4 shrink-0", open && "rotate-90")}
        />
        <span className="truncate">{title}</span>
        {trailing}
      </button>
      {open ? (
        <div
          id={contentId}
          className={cn("flex min-w-0 flex-col gap-2.5", indent && "pl-5")}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}
