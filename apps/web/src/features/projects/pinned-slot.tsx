import { useMemo, useState, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { PINNED_TASK_SLOTS, type PinnedTaskSlot } from "@/domain/local-state";
import { getPinnedTasksBySlot } from "@/domain/projects/project-transitions";
import { useLocalProjects } from "@/lib/local-hooks";
import { getPressedDigit } from "@/lib/shortcuts";
import { cn } from "@/lib/utils";

/** The key badge for a pinned task's slot, such as "3", shown next to the task's name. */
export function PinnedSlotBadge({
  slot,
  className,
}: {
  slot: PinnedTaskSlot;
  className?: string;
}) {
  return (
    <kbd
      className={cn(
        "inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-md border border-border bg-muted px-1 font-mono text-[11px] leading-none font-medium text-foreground",
        className,
      )}
      title={`Press ${slot} for a new entry, Shift+${slot} to start`}
      aria-label={`Pinned to ${slot}`}
    >
      {slot}
    </kbd>
  );
}

/**
 * The slot picker behind "Assign shortcut…" and the task panel's Shortcut
 * field: ten number keys, each naming the task that holds it, and Clear. A
 * number key picks its slot too. Picking a slot another task holds moves it
 * once the caller writes the choice. Mount it only while open.
 */
export function PinnedSlotDialog({
  taskName,
  taskId,
  slot,
  onChoose,
  onClose,
}: {
  taskName: string;
  /** The saved task, so its own slot does not read as held by another task. */
  taskId?: string;
  /** The slot shown as current. */
  slot: PinnedTaskSlot | undefined;
  /** Receives the chosen slot, or undefined to clear it. The dialog closes after. */
  onChoose: (slot: PinnedTaskSlot | undefined) => void;
  onClose: () => void;
}) {
  const projects = useLocalProjects();
  const pinnedTasks = useMemo(() => getPinnedTasksBySlot(projects), [projects]);

  function choose(nextSlot: PinnedTaskSlot | undefined) {
    onChoose(nextSlot);
    onClose();
  }

  function handleKeyDown(event: KeyboardEvent) {
    const digit = getPressedDigit(event);
    if (
      digit &&
      !event.shiftKey &&
      !event.altKey &&
      !event.metaKey &&
      !event.ctrlKey
    ) {
      event.preventDefault();
      choose(digit);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="max-w-md gap-4"
        onKeyDown={(event) => {
          handleKeyDown(event);
          // The dialog renders in a portal, but React still bubbles its keys to
          // the task panel, whose Escape would close the panel too.
          event.stopPropagation();
        }}
      >
        <DialogHeader className="gap-1">
          <DialogTitle>Assign shortcut</DialogTitle>
          <DialogDescription>
            Pick a number key for "{taskName}". The key opens a new entry for
            it, and Shift with the key starts it.
          </DialogDescription>
        </DialogHeader>
        <div
          className="grid grid-cols-5 gap-2"
          role="group"
          aria-label="Number keys"
        >
          {PINNED_TASK_SLOTS.map((option) => {
            const holder = pinnedTasks.get(option)?.task;
            const isCurrent = slot === option;
            const holderName =
              holder && !isCurrent && holder._id !== taskId
                ? holder.name
                : undefined;

            return (
              <Button
                key={option}
                type="button"
                variant={isCurrent ? "default" : "outline"}
                aria-pressed={isCurrent}
                aria-label={
                  holderName ? `${option}, moves from ${holderName}` : option
                }
                title={holderName ? `Moves from ${holderName}` : undefined}
                className="h-auto min-w-0 flex-col gap-0.5 py-2"
                onClick={() => choose(option)}
              >
                <span className="font-mono text-base">{option}</span>
                <span
                  className={cn(
                    "w-full truncate text-[11px] font-normal",
                    !isCurrent && "text-muted-foreground",
                  )}
                >
                  {isCurrent ? "Current" : (holderName ?? "Free")}
                </span>
              </Button>
            );
          })}
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={!slot}
            onClick={() => choose(undefined)}
          >
            Clear shortcut
          </Button>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The task panel's Shortcut field. It opens the slot picker and only changes
 * the draft; the panel's Save writes it.
 */
export function PinnedSlotField({
  taskName,
  taskId,
  slot,
  onChange,
}: {
  taskName: string;
  taskId?: string;
  slot: PinnedTaskSlot | undefined;
  onChange: (slot: PinnedTaskSlot | undefined) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <Field>
      <FieldLabel htmlFor="project-task-editor-shortcut">Shortcut</FieldLabel>
      <Button
        id="project-task-editor-shortcut"
        type="button"
        variant="outline"

        className="justify-start gap-2 self-start"
        aria-label={slot ? `Shortcut ${slot}, change` : "Shortcut none, assign"}
        onClick={() => setIsOpen(true)}
      >
        {slot ? <PinnedSlotBadge slot={slot} /> : null}
        {slot ? "Change…" : "Assign shortcut…"}
      </Button>
      {isOpen ? (
        <PinnedSlotDialog
          taskName={taskName.trim() || "this task"}
          taskId={taskId}
          slot={slot}
          onChoose={onChange}
          onClose={() => setIsOpen(false)}
        />
      ) : null}
    </Field>
  );
}
