import { useMemo, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  PINNED_TASK_SLOTS,
  type LocalProjectTask,
  type PinnedTaskSlot,
} from "@/domain/local-state";
import { getPinnedTasksBySlot } from "@/domain/projects/project-transitions";
import { useLocalProjects } from "@/lib/local-hooks";
import { localStore } from "@/lib/local-store";
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
 * The picker behind "Assign shortcut…": sets, changes or clears a task's pinned
 * slot. Picking a slot another task holds moves it to this task. A number key
 * picks its slot too. Mount it only while open.
 */
export function PinnedSlotDialog({
  projectId,
  task,
  onClose,
}: {
  projectId: string;
  task: LocalProjectTask;
  onClose: () => void;
}) {
  const projects = useLocalProjects();
  const pinnedTasks = useMemo(() => getPinnedTasksBySlot(projects), [projects]);

  /** Sets the slot, or clears it with undefined, then closes. */
  function assign(slot: PinnedTaskSlot | undefined) {
    localStore.setProjectTaskPinnedSlot(projectId, task._id, slot);
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
      assign(digit);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md gap-4" onKeyDown={handleKeyDown}>
        <DialogHeader className="gap-1">
          <DialogTitle>Assign shortcut</DialogTitle>
          <DialogDescription>
            Pick a number key for "{task.name}". The key opens a new entry for
            it, and Shift with the key starts it.
          </DialogDescription>
        </DialogHeader>
        <div
          className="grid grid-cols-5 gap-2"
          role="group"
          aria-label="Number keys"
        >
          {PINNED_TASK_SLOTS.map((slot) => {
            const holder = pinnedTasks.get(slot)?.task;
            const isCurrent = task.pinnedSlot === slot;
            const holderName = holder && !isCurrent ? holder.name : undefined;

            return (
              <Button
                key={slot}
                type="button"
                variant={isCurrent ? "default" : "outline"}
                aria-pressed={isCurrent}
                aria-label={
                  holderName ? `${slot}, moves from ${holderName}` : slot
                }
                title={holderName ? `Moves from ${holderName}` : undefined}
                className="h-auto min-w-0 flex-col gap-0.5 py-2"
                onClick={() => assign(slot)}
              >
                <span className="font-mono text-base">{slot}</span>
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
            disabled={!task.pinnedSlot}
            onClick={() => assign(undefined)}
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
