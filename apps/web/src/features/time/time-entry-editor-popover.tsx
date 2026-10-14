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
 * Popover host for the entry editor, anchored to its trigger: the titlebar "+" and
 * the Running pill. New entry… on a task or backlog item passes `anchor`, its row,
 * instead. Like every host, it only supplies the container. Clicking outside does
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
   * row that New entry… came from. Closing gives focus back to it.
   */
  anchor?: HTMLElement | null;
  /** An unsaved draft carried over from another host, such as the dialog. */
  initialFields?: TimeEntryEditorFields;
  onFieldsChange?: (fields: TimeEntryEditorFields) => void;
  /** The trigger button's content. */
  children: ReactNode;
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
      {iconTrigger ? (
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
        // Without an anchor, Base UI gives focus back to the trigger.
        finalFocus={anchor ? () => anchor : undefined}
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
