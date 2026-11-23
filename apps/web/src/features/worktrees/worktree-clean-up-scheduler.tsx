import { useEffect } from "react";
import { startWorktreeCleanUp } from "@/lib/worktree-clean-up";
import { hasWorktrees } from "@/lib/worktrees";

/**
 * Starts automatic clean up of hand-off worktrees (#864) while the app
 * runs: a round at launch, then one an hour. Only the desktop app has
 * worktrees, so the web build starts nothing. It draws nothing.
 */
export function WorktreeCleanUpScheduler() {
  useEffect(() => (hasWorktrees() ? startWorktreeCleanUp() : undefined), []);
  return null;
}
