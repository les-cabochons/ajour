import type { ReactNode, Ref } from "react";
import { RiArrowDownSLine as MenuIcon } from "@remixicon/react";

import { TooltipButton } from "@/components/tooltip-button";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

/**
 * A button with a menu of related actions: the main half runs the button's
 * action, and the arrow half, 1px apart, opens `menu`. The comment editor's
 * send button and the backlog item page's Start entry use it. Callers own
 * the menu's items and decide what the main half runs.
 */
export function SplitButton({
  ref,
  variant = "default",
  size = "default",
  onClick,
  disabled,
  title,
  children,
  menuLabel,
  menuDisabled,
  side = "bottom",
  menuClassName,
  menu,
}: {
  /** The pair's wrapper, for popovers anchored to the whole button. */
  ref?: Ref<HTMLSpanElement>;
  variant?: "default" | "outline";
  size?: "default" | "sm";
  onClick: () => void;
  disabled?: boolean;
  title?: string;
  children: ReactNode;
  /** The arrow's tooltip and accessible name. */
  menuLabel: string;
  menuDisabled?: boolean;
  side?: "top" | "bottom";
  menuClassName?: string;
  menu: ReactNode;
}) {
  return (
    <span ref={ref} className="flex">
      <Button
        variant={variant}
        size={size}
        className="rounded-r-none"
        onClick={onClick}
        disabled={disabled}
        title={title}
      >
        {children}
      </Button>
      <DropdownMenu>
        <TooltipButton
          label={menuLabel}
          side={side}
          disabled={menuDisabled}
          render={
            <DropdownMenuTrigger
              render={
                <Button
                  variant={variant}
                  size={size === "sm" ? "icon-sm" : "icon"}
                  // An outline pair shares one border; a filled one shows a 1px gap.
                  className={cn(
                    "rounded-l-none",
                    variant === "outline" ? "border-l-0" : "ml-px",
                  )}
                />
              }
            />
          }
        >
          <MenuIcon />
        </TooltipButton>
        <DropdownMenuContent
          align="end"
          side={side}
          className={cn("w-auto", menuClassName)}
        >
          {menu}
        </DropdownMenuContent>
      </DropdownMenu>
    </span>
  );
}
