import type { ComponentProps } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  formatAriaKeyShortcuts,
  formatShortcutKeys,
  getShortcut,
  getShortcutPlatform,
  type ShortcutActionId,
} from "@/lib/shortcuts";

const platform = getShortcutPlatform();

type TooltipButtonProps = ComponentProps<typeof TooltipTrigger> & {
  /** The button's accessible name and the tooltip text. */
  label: string;
  /** The registered shortcut that runs the same action. The tooltip shows its key. */
  shortcut?: ShortcutActionId;
  side?: ComponentProps<typeof TooltipContent>["side"];
  /** Classes for the tooltip, such as one that shows it only in the icon rail. */
  tooltipClassName?: string;
};

/**
 * An icon-only button with a tooltip that names it and shows its shortcut from
 * the registry, as "Previous day [". It renders a plain `<button>`; pass
 * `render` to use a `Button`, a `Link` or a menu or popover trigger instead.
 * `label` becomes the `aria-label` unless the caller passes a longer one.
 */
export function TooltipButton({
  label,
  shortcut,
  side = "bottom",
  tooltipClassName,
  ...props
}: TooltipButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger
        // Only the default <button> needs it; Button and Link set their own.
        type={props.render ? undefined : "button"}
        aria-label={label}
        aria-keyshortcuts={
          shortcut
            ? formatAriaKeyShortcuts(getShortcut(shortcut), platform)
            : undefined
        }
        {...props}
      />
      <TooltipContent side={side} className={tooltipClassName}>
        <ShortcutTooltipLabel label={label} shortcut={shortcut} />
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * Tooltip text for an icon control: its label, then the key of its registered
 * shortcut, if any. For tooltips that `TooltipButton` does not render, such as
 * the sidebar rail's.
 */
export function ShortcutTooltipLabel({
  label,
  shortcut,
}: {
  label: string;
  shortcut?: ShortcutActionId;
}) {
  return (
    <>
      {label}
      {shortcut ? (
        <kbd className="ajour-tooltip-shortcut">
          {formatShortcutKeys(getShortcut(shortcut), platform).join(" ")}
        </kbd>
      ) : null}
    </>
  );
}
