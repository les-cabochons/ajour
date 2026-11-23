import { useState } from "react";
import {
  RiErrorWarningLine as WarningIcon,
  RiNodeTree as WorktreeIcon,
} from "@remixicon/react";
import type { ListedWorktree } from "@ajour/shared/worktrees";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import type { WorktreeStatusLine } from "@/domain/handoffs/worktrees";
import { forgetListedWorktree } from "@/features/worktrees/forget-worktree";
import { WorktreeDeleteDialog } from "@/features/worktrees/worktree-delete-dialog";

/**
 * A worktree's status in a list row: a green chip while a tool works in
 * it, an amber one when a thread waits for the user, amber text with a
 * warning icon for uncommitted work, and quiet text for the rest.
 */
function WorktreeStatusMark({ status }: { status: WorktreeStatusLine }) {
  if (status.tone === "running")
    return <Chip tone="success">{status.text}</Chip>;
  if (status.tone === "attention")
    return <Chip tone="warning">{status.text}</Chip>;
  // A long reason is cut before the row grows wider than its list: the
  // whole text is in its tooltip.
  if (status.tone === "warning")
    return (
      <span
        className="flex min-w-0 items-center gap-1 text-xs text-[var(--warning)]"
        title={status.text}
      >
        <WarningIcon aria-hidden="true" className="size-3.5 shrink-0" />
        <span className="truncate">{status.text}</span>
      </span>
    );
  return (
    <span
      className="min-w-0 truncate text-xs text-[var(--text-tertiary)]"
      title={status.text}
    >
      {status.text}
    </span>
  );
}

/**
 * One worktree in a list (#864), on the project page under its repository
 * folder and in Settings › Worktrees: its name, its backlog item's title,
 * its status, and Delete, which asks first (`WorktreeDeleteDialog`). A
 * worktree whose folder is gone offers Forget instead, which drops it from
 * Ajour's list. The row is 32px high in every state. `onChanged` runs once
 * a delete or a forget is done, so the list reads its worktrees again.
 */
export function WorktreeRow({
  listed,
  title,
  status,
  onChanged,
}: {
  listed: ListedWorktree;
  /** The backlog item's title. */
  title: string;
  status: WorktreeStatusLine;
  onChanged: () => void;
}) {
  const { id, name } = listed.worktree;
  // The question before a delete mounts only while it is asked.
  const [confirming, setConfirming] = useState(false);
  const [forgetting, setForgetting] = useState(false);
  const missing = listed.status.state === "missing";
  return (
    <li
      className="flex h-8 min-w-0 items-center gap-2 border-b text-sm"
      aria-label={`${name}, ${title}, ${status.text}`}
    >
      <WorktreeIcon
        aria-hidden="true"
        className="size-3.5 shrink-0 text-muted-foreground"
      />
      <span
        className="max-w-[40%] shrink-0 truncate font-mono text-xs"
        title={listed.path ?? name}
      >
        {name}
      </span>
      <span
        className="min-w-0 flex-1 truncate text-xs text-muted-foreground"
        title={title}
      >
        {title}
      </span>
      <WorktreeStatusMark status={status} />
      {missing ? (
        <Button
          variant="ghost"
          size="sm"
          disabled={forgetting}
          aria-label={`Forget ${name}`}
          onClick={async () => {
            setForgetting(true);
            if (await forgetListedWorktree(id)) onChanged();
            setForgetting(false);
          }}
        >
          Forget
        </Button>
      ) : (
        <Button
          variant="ghost"
          size="sm"
          aria-label={`Delete ${name}`}
          onClick={() => setConfirming(true)}
        >
          Delete
        </Button>
      )}
      {confirming ? (
        <WorktreeDeleteDialog
          listed={listed}
          onOpenChange={setConfirming}
          onDeleted={onChanged}
        />
      ) : null}
    </li>
  );
}
