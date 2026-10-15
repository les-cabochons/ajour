import type { ReactNode } from "react";
import { TooltipButton } from "@/components/tooltip-button";
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  TimeEntryEditorForm,
  type TimeEntryEditorTarget,
} from "@/features/time/time-entry-editor-form";
import type { TimeEntryEditorFields } from "@/features/time/time-entry-editor";
import type { ShortcutActionId } from "@/lib/shortcuts";

/**
 * Popover host for the entry editor, anchored to its trigger, such as the timer
 * dock. Without `children` it renders no trigger and shows at `anchor`: the
 * titlebar's new entry host anchors to the row New entry… came from, the dock's
 * "+" or the titlebar's totals. Like every host, it only supplies the container. Clicking outside does
 * nothing; Escape, ×, Cancel or the trigger close it and drop the draft. The form
 * mounts each time the popover opens, so every opening starts fresh.
 */
export function TimeEntryEditorPopover({
  target,
  open,
  onOpenChange,
  triggerLabel,
  triggerClassName,
  iconTrigger = false,
  triggerShortcut,
  anchor,
  initialFields,
  onFieldsChange,
  children,
}: {
  /** What the form edits. The popover shows nothing while this is null. */
  target: TimeEntryEditorTarget | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Accessible name of the trigger button, and its tooltip when `iconTrigger` is set. */
  triggerLabel: string;
  triggerClassName?: string;
  /** The trigger shows only an icon, so it gets a tooltip like every icon button. */
  iconTrigger?: boolean;
  /** The registered shortcut the trigger's tooltip shows. */
  triggerShortcut?: ShortcutActionId;
  /**
   * Where the popover shows instead of the trigger, such as the task or backlog
   * row that New entry… came from. Closing gives focus back to it when it can
   * take focus.
   */
  anchor?: HTMLElement | null;
  /** An unsaved draft carried over from another host, such as the dialog. */
  initialFields?: TimeEntryEditorFields;
  onFieldsChange?: (fields: TimeEntryEditorFields) => void;
  /** The trigger button's content. Leave it out to show the popover at `anchor` only. */
  children?: ReactNode;
}) {
  return (
    <Popover
      open={open && target !== null}
      onOpenChange={(nextOpen, details) => {
        if (
          !nextOpen &&
          (details.reason === "outside-press" || details.reason === "focus-out")
        ) {
          return;
        }
        onOpenChange(nextOpen);
      }}
    >
      {children === undefined ? null : iconTrigger ? (
        <TooltipButton
          label={triggerLabel}
          shortcut={triggerShortcut}
          render={<PopoverTrigger className={triggerClassName} />}
        >
          {children}
        </TooltipButton>
      ) : (
        <PopoverTrigger className={triggerClassName} aria-label={triggerLabel}>
          {children}
        </PopoverTrigger>
      )}
      <PopoverContent
        className="w-[min(26rem,calc(100vw-1rem))] p-4"
        align="end"
        sideOffset={8}
        anchor={anchor ?? undefined}
        // Otherwise Base UI gives focus back to the trigger, or to where it was.
        finalFocus={anchor && canTakeFocus(anchor) ? () => anchor : undefined}
      >
        {target ? (
          <TimeEntryEditorForm
            // A switch to another running entry, or a new entry for another
            // pinned task or backlog item, seeds a fresh draft.
            key={
              target.kind === "running"
                ? target.timer._id
                : target.kind === "create"
                  ? `create-${target.initialValues?.taskId ?? ""}-${target.initialValues?.workItemId ?? ""}`
                  : target.kind
            }
            target={target}
            titleAs={PopoverTitle}
            initialFields={initialFields}
            onFieldsChange={onFieldsChange}
            onClose={() => onOpenChange(false)}
          />
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

/** Buttons, links and rows with a tabindex, unlike the titlebar's totals area. */
function canTakeFocus(element: HTMLElement) {
  return element.tabIndex >= 0 || element.hasAttribute("tabindex");
}
