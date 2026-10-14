"use client";

import * as React from "react";
import { Popover as PopoverPrimitive } from "@base-ui/react/popover";
import { cn } from "@/lib/utils";

function HoverCard({ ...props }: PopoverPrimitive.Root.Props) {
  return <PopoverPrimitive.Root data-slot="hover-card" {...props} />;
}

function HoverCardTrigger({
  openOnHover = true,
  delay = 120,
  closeDelay = 80,
  ...props
}: PopoverPrimitive.Trigger.Props) {
  return (
    <PopoverPrimitive.Trigger
      data-slot="hover-card-trigger"
      openOnHover={openOnHover}
      delay={delay}
      closeDelay={closeDelay}
      {...props}
    />
  );
}

function HoverCardContent({
  className,
  positionerClassName,
  align = "center",
  alignOffset = 0,
  side = "top",
  sideOffset = 10,
  ...props
}: PopoverPrimitive.Popup.Props &
  Pick<
    PopoverPrimitive.Positioner.Props,
    "align" | "alignOffset" | "side" | "sideOffset"
  > & {
    positionerClassName?: string;
  }) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Positioner
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
        className={cn("isolate", positionerClassName ?? "z-50")}
      >
        <PopoverPrimitive.Popup
          data-slot="hover-card-content"
          className={cn(
            "flex w-72 origin-(--transform-origin) flex-col gap-2 rounded-sm border border-border bg-popover p-3 text-sm text-popover-foreground shadow-[var(--shadow-popup)] ring-1 ring-foreground/5 outline-hidden duration-100 data-[side=bottom]:slide-in-from-top-2 data-[side=inline-end]:slide-in-from-left-2 data-[side=inline-start]:slide-in-from-right-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 dark:ring-foreground/10 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
            className,
          )}
          {...props}
        />
      </PopoverPrimitive.Positioner>
    </PopoverPrimitive.Portal>
  );
}

export { HoverCard, HoverCardContent, HoverCardTrigger };
