import type { WorktreeCleanUpAnswer } from "@ajour/shared/handoffs";
import type {
  ListedWorktree,
  WorktreeCleanUpRequest,
} from "@ajour/shared/worktrees";
import { finishedItemsOf } from "@/domain/handoffs/worktrees";
import {
  cleanUpWorktrees,
  listWorktrees,
  listWorktreeStatuses,
} from "./app-api";
import { setHandoffs } from "./handoffs";
import { localStore } from "./local-store";

/*
 * Automatic clean up of hand-off worktrees, as the window starts it
 * (#864). Backlog items live in the window, and the local API doesn't know
 * when one is finished. So the window starts each round, at launch, once
 * an hour and from Clean up now, and sends when each item that has a
 * worktree became done, settled or archived. The local API applies the
 * rules and every safety check, and removes what it removes.
 */

/** How long the window waits between two rounds it starts by itself. */
export const CLEAN_UP_EVERY_MS = 60 * 60 * 1000;

const roundListeners = new Set<() => void>();

/**
 * Runs `listener` each time a round completes, whoever started it, so an
 * open list of worktrees reads again what is left: the hourly round may
 * have removed a worktree the list still offers to delete. Answers how to
 * stop.
 */
export function onWorktreeCleanUp(listener: () => void): () => void {
  roundListeners.add(listener);
  return () => {
    roundListeners.delete(listener);
  };
}

/**
 * Runs one round. It reads the worktrees of this computer first, and asks
 * for no round when there is none. Answers what the local API removed and
 * kept, or undefined when there was nothing to look at. A removed
 * worktree's handoffs stay and no longer name it, so the window takes the
 * handoffs as the answer gives them. A round that completes tells the
 * lists that asked (`onWorktreeCleanUp`).
 */
export async function runWorktreeCleanUp(
  trigger: WorktreeCleanUpRequest["trigger"],
): Promise<WorktreeCleanUpAnswer | undefined> {
  const worktrees = await listWorktrees();
  const answer = worktrees.length
    ? await cleanUpWorktrees({
        trigger,
        finished: finishedItemsOf(worktrees, localStore.snapshot().workItems),
      })
    : undefined;
  if (answer?.removed.length) setHandoffs(answer.handoffs);
  roundListeners.forEach((listener) => listener());
  return answer;
}

/**
 * Every worktree on this computer, newest first, with its status and what
 * clean up will do with it, for the list of Settings › Worktrees. The
 * local API works that out with the rules a round applies, from the same
 * finished moments.
 */
export async function listWorktreesWithCleanUp(): Promise<ListedWorktree[]> {
  const worktrees = await listWorktrees();
  if (!worktrees.length) return [];
  return listWorktreeStatuses({
    finished: finishedItemsOf(worktrees, localStore.snapshot().workItems),
  });
}

/**
 * Starts the rounds the window runs by itself: one now, at launch, then
 * one an hour. A round that fails, as when the local API is not up yet, is
 * left: the next one runs in its turn, and each call records its own
 * failure. Answers how to stop.
 */
export function startWorktreeCleanUp(): () => void {
  const round = (trigger: "launch" | "timer") =>
    void runWorktreeCleanUp(trigger).catch(() => undefined);
  round("launch");
  const timer = window.setInterval(() => round("timer"), CLEAN_UP_EVERY_MS);
  return () => window.clearInterval(timer);
}
