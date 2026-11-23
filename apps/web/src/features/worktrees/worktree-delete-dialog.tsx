import { useEffect, useId, useState } from "react";
import {
  worktreeDeleteRefusalSchema,
  type ListedWorktree,
  type WorktreeDeletePreview,
} from "@ajour/shared/worktrees";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldLabel,
  FieldWarning,
} from "@/components/ui/field";
import { showErrorToast, showToast } from "@/components/ui/toast";
import {
  describeDeleted,
  describeDeleteLoss,
  describeRunningThreads,
  describeSwitched,
  describeUnpushedCommits,
  describeWorktreeChange,
} from "@/domain/handoffs/worktrees";
import {
  AppApiError,
  deleteWorktree,
  previewWorktreeDelete,
} from "@/lib/app-api";
import { setHandoffs } from "@/lib/handoffs";
import { useAllHandoffTools } from "@/lib/handoff-tools";

const messageOf = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback;

/** Whether the local API refused a delete because the worktree changed (#857). */
const changedSinceShown = (error: unknown) =>
  error instanceof AppApiError &&
  worktreeDeleteRefusalSchema.safeParse(error.payload).data?.changed === true;

/**
 * Asks before a worktree is deleted (#862): "Delete aj-4821?". It reads
 * from the local API what the delete would lose and shows it: the
 * uncommitted and untracked files, a warning for each tool whose thread
 * still works or waits in the worktree, and a checkbox to delete the branch
 * too, unticked, with how many of its commits are on no remote.
 *
 * It is a confirmation on purpose. An Undo could not bring back the
 * uncommitted or ignored files, so the user decides with the list in front
 * of them. Mount it only while it asks. `onDeleted` runs once the worktree
 * is gone, after the handoffs it held were updated.
 *
 * The delete sends the preview's fingerprint, and the local API refuses it
 * when the worktree changed since (#857), as when a tool wrote a file or
 * made a commit after the dialog opened. The dialog then reads the preview again, shows what
 * the worktree holds now, and says it changed: the next Delete confirms
 * that.
 *
 * Once deleted, the dialog closes and a toast says what went: "Deleted
 * aj-4821", or "Deleted aj-4821 and its branch". It has no Undo, for the
 * same reason. When git kept a branch the user asked to delete, one error
 * toast says that the worktree is deleted and the branch stayed.
 */
export function WorktreeDeleteDialog({
  listed,
  onOpenChange,
  onDeleted,
}: {
  listed: ListedWorktree;
  onOpenChange: (open: boolean) => void;
  onDeleted: () => void;
}) {
  const { id, name } = listed.worktree;
  const tools = useAllHandoffTools();
  const checkboxId = useId();
  const [preview, setPreview] = useState<WorktreeDeletePreview>();
  const [failure, setFailure] = useState("");
  const [deleteBranch, setDeleteBranch] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // Bumped to read the preview again, after a delete found it out of date.
  // Until the new one comes, the old one shows and Delete stays off.
  const [reads, setReads] = useState(0);
  const [stale, setStale] = useState(false);
  useEffect(() => {
    let current = true;
    void previewWorktreeDelete(id).then(
      (answer) => {
        if (!current) return;
        setPreview(answer);
        setStale(false);
      },
      (error: unknown) => {
        if (current)
          setFailure(
            messageOf(error, "Ajour couldn't read what this worktree holds."),
          );
      },
    );
    return () => {
      current = false;
    };
  }, [id, reads]);

  const run = async (confirmed: WorktreeDeletePreview) => {
    setDeleting(true);
    setFailure("");
    try {
      const answer = await deleteWorktree(
        id,
        deleteBranch,
        confirmed.fingerprint,
      );
      setHandoffs(answer.handoffs);
      if (deleteBranch && !answer.branchDeleted)
        showErrorToast({
          title: "Couldn't delete the branch",
          description: `${name} is deleted. Its branch ${listed.worktree.branch} stayed.`,
        });
      else showToast(describeDeleted(name, answer.branchDeleted));
      onDeleted();
      onOpenChange(false);
    } catch (error) {
      if (changedSinceShown(error)) {
        setStale(true);
        setReads((count) => count + 1);
        setFailure(
          `${name} changed since this dialog opened. Check what it holds now, then delete it again.`,
        );
      } else {
        // The dialog stays, with the reason where the user pressed Delete.
        setFailure(messageOf(error, "The local API didn't answer."));
      }
      setDeleting(false);
    }
  };

  const warnings = preview
    ? describeRunningThreads(
        preview.running,
        (pluginId, toolId) =>
          tools.find(
            (tool) => tool.pluginId === pluginId && tool.toolId === toolId,
          )?.label ?? toolId,
      )
    : [];
  return (
    <AlertDialog
      open
      onOpenChange={(open) => {
        // A delete under way finishes before the dialog closes.
        if (!deleting) onOpenChange(open);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {name}?</AlertDialogTitle>
          <AlertDialogDescription>
            {preview
              ? [describeDeleteLoss(preview), describeSwitched(preview)]
                  .filter(Boolean)
                  .join(" ")
              : failure
                ? "Ajour couldn't check this worktree."
                : "Checking what it holds…"}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {preview || failure ? (
          <div className="flex min-w-0 flex-col gap-3">
            {preview?.files.length ? (
              <ul
                className="worktree-delete-files"
                aria-label="Uncommitted changes"
              >
                {preview.files.map((change) => (
                  <li key={`${change.code} ${change.path}`}>
                    {describeWorktreeChange(change)}
                  </li>
                ))}
                {preview.moreFiles ? (
                  <li className="font-sans">and {preview.moreFiles} more</li>
                ) : null}
              </ul>
            ) : null}
            {warnings.map((warning) => (
              <FieldWarning key={warning}>{warning}</FieldWarning>
            ))}
            {preview?.branch ? (
              <Field orientation="horizontal">
                <Checkbox
                  id={checkboxId}
                  checked={deleteBranch}
                  disabled={deleting}
                  onCheckedChange={(checked) =>
                    setDeleteBranch(checked === true)
                  }
                  className="mt-0.5"
                />
                <FieldContent className="min-w-0">
                  <FieldLabel htmlFor={checkboxId} className="block max-w-full">
                    Also delete the branch{" "}
                    <span className="font-mono break-all">
                      {preview.branch.name}
                    </span>
                  </FieldLabel>
                  <FieldDescription>
                    {describeUnpushedCommits(preview.branch.unpushedCommits)}
                  </FieldDescription>
                </FieldContent>
              </Field>
            ) : null}
            <FieldError>{failure}</FieldError>
          </div>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={!preview || stale || deleting}
            onClick={() => {
              if (preview) void run(preview);
            }}
          >
            Delete worktree
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
