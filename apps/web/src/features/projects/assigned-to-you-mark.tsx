import { RiUserFill } from "@remixicon/react";
import { cn } from "@/lib/utils";

/** The icon's name for a screen reader, and its hover text. */
export const ASSIGNED_TO_YOU_LABEL = "Assigned to you";

/**
 * The mark on a managed project's task its source assigns to the user: an
 * accent person icon, in the task menu, the task pickers and the project
 * page's task list. Its hover text is the native `title`, so a row mounts no
 * tooltip.
 */
export function AssignedToYouMark({ className }: { className?: string }) {
  return (
    <span
      role="img"
      aria-label={ASSIGNED_TO_YOU_LABEL}
      title={ASSIGNED_TO_YOU_LABEL}
      className={cn("inline-flex shrink-0 text-primary", className)}
    >
      <RiUserFill className="size-4" aria-hidden="true" />
    </span>
  );
}
