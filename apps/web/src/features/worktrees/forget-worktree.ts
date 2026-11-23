import { showErrorToast } from "@/components/ui/toast";
import { forgetWorktree } from "@/lib/app-api";
import { setHandoffs } from "@/lib/handoffs";

/**
 * Forgets a worktree whose folder is gone (#862), for every list that
 * offers Forget: the local API drops it from Ajour's list, and its threads
 * stay on their item without it. A refusal shows as a toast. Answers
 * whether the worktree was forgotten.
 */
export async function forgetListedWorktree(id: string): Promise<boolean> {
  try {
    setHandoffs((await forgetWorktree(id)).handoffs);
    return true;
  } catch (error) {
    showErrorToast({
      title: "Couldn't forget the worktree",
      description:
        error instanceof Error && error.message
          ? error.message
          : "The local API didn't answer.",
    });
    return false;
  }
}
