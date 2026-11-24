import { useState } from "react";
import { RiMoreLine as MoreIcon } from "@remixicon/react";
import type { ListedWorktree, WorktreeOpenIn } from "@ajour/shared/worktrees";
import { TooltipButton } from "@/components/tooltip-button";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { showErrorToast, showToast } from "@/components/ui/toast";
import { showInFileManagerLabel } from "@/domain/handoffs/worktrees";
import { WorktreeDeleteDialog } from "@/features/worktrees/worktree-delete-dialog";
import { forgetListedWorktree } from "@/features/worktrees/forget-worktree";
import { openWorktree } from "@/lib/app-api";
import { copyTextToClipboard } from "@/lib/clipboard";

const messageOf = (error: unknown) =>
  error instanceof Error && error.message
    ? error.message
    : "The local API didn't answer.";

/** Opens the worktree's folder, and says why when it can't. */
async function open(listed: ListedWorktree, where: WorktreeOpenIn) {
  try {
    await openWorktree(listed.worktree.id, where);
  } catch (error) {
    showErrorToast({
      title:
        where === "terminal"
          ? "Couldn't open the terminal"
          : "Couldn't show the folder",
      description: messageOf(error),
    });
  }
}

/**
 * A worktree's "…" menu (#862), for every list that shows one: Open in
 * terminal, the file manager under its name on this system, Copy path and
 * Delete worktree…, which asks first (`WorktreeDeleteDialog`). A worktree
 * whose folder is gone has nothing to open or delete: its menu offers
 * Forget, which drops it from Ajour's list. `onChanged` runs once a delete
 * or a forget is done, so the list reads its worktrees again.
 */
export function WorktreeMenu({
  listed,
  onChanged,
}: {
  listed: ListedWorktree;
  onChanged: () => void;
}) {
  const { id, name } = listed.worktree;
  // The question before a delete mounts only while it is asked.
  const [confirming, setConfirming] = useState(false);
  const [forgetting, setForgetting] = useState(false);
  const forget = async () => {
    setForgetting(true);
    if (await forgetListedWorktree(id)) onChanged();
    setForgetting(false);
  };
  return (
    <>
      <DropdownMenu>
        <TooltipButton
          label={`Actions for ${name}`}
          render={
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="text-muted-foreground"
                  disabled={forgetting}
                />
              }
            />
          }
        >
          <MoreIcon className="size-4" />
        </TooltipButton>
        <DropdownMenuContent align="end">
          {listed.status.state === "missing" ? (
            <DropdownMenuItem onClick={() => void forget()}>
              Forget
            </DropdownMenuItem>
          ) : (
            <>
              <DropdownMenuItem onClick={() => void open(listed, "terminal")}>
                Open in terminal
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => void open(listed, "files")}>
                {showInFileManagerLabel(window.ajourDesktop?.runtime?.platform)}
              </DropdownMenuItem>
              {listed.path ? (
                <DropdownMenuItem
                  onClick={async () => {
                    if (await copyTextToClipboard(listed.path!))
                      showToast("Path copied");
                  }}
                >
                  Copy path
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuItem
                variant="destructive"
                onClick={() => setConfirming(true)}
              >
                Delete worktree…
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {confirming ? (
        <WorktreeDeleteDialog
          listed={listed}
          onOpenChange={setConfirming}
          onDeleted={onChanged}
        />
      ) : null}
    </>
  );
}
