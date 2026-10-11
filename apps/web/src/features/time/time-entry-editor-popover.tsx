import type { ReactNode } from "react";
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

/**
 * Popover host for the entry editor, anchored to its trigger: the titlebar "+" and
 * the Running pill. Like every host, it only supplies the container. Clicking
 * outside does nothing; Escape, ×, Cancel or the trigger close it and drop the draft.
 * The form mounts each time the popover opens, so every opening starts fresh.
 */
export function TimeEntryEditorPopover({
  target,
  open,
  onOpenChange,
  triggerLabel,
  triggerClassName,
  children,
}: {
  /** What the form edits. The popover shows nothing while this is null. */
  target: TimeEntryEditorTarget | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Accessible name and tooltip of the trigger button. */
  triggerLabel: string;
  triggerClassName?: string;
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
      <PopoverTrigger
        className={triggerClassName}
        aria-label={triggerLabel}
        title={triggerLabel}
      >
        {children}
      </PopoverTrigger>
      <PopoverContent
        className="w-[min(26rem,calc(100vw-1rem))] p-4"
        align="end"
        sideOffset={8}
      >
        {target ? (
          <TimeEntryEditorForm
            // A switch to another running entry seeds a fresh draft.
            key={target.kind === "running" ? target.timer._id : target.kind}
            target={target}
            titleAs={PopoverTitle}
            onClose={() => onOpenChange(false)}
          />
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
