import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { showToast } from "@/components/ui/toast";
import { formatEntryCount } from "@/domain/actions/object-actions";
import type {
  LocalAppState,
  LocalProject,
  LocalProjectTask,
  LocalTimesheetEntry,
} from "@/domain/local-state";
import { getCommitTarget } from "@/domain/projects/commit-target";
import {
  getProjectSourceLabel,
  sourceNameOf,
} from "@/domain/projects/source-link";
import {
  findTaskMergeSuggestions,
  type TaskMerged,
  type TaskMergeRefusal,
  type TaskMergeSuggestion,
} from "@/domain/projects/task-merge";
import { offerUndo } from "@/features/feedback/undo-toast";
import { localStore } from "@/lib/local-store";
import {
  dismissTaskMergeSuggestion,
  isTaskMergeDismissed,
  useTaskMergeDismissals,
} from "@/lib/task-merge-dismissals";
import { withEventAttribution } from "@/lib/wide-events";

/*
 * Merge into… on a managed project's tasks (#507): the task picker, the
 * suggestion rows under a suggested pair, and the toasts after a merge.
 */

const REFUSALS: Record<TaskMergeRefusal, string> = {
  not_managed: "Only the tasks of a managed project merge.",
  missing: "One of the tasks is gone.",
  other_project: "That task belongs to another project.",
  same_task: "Pick another task.",
  archived_target: "That task is archived.",
  local_only_target:
    "That task is Local only, so these entries would leave your timesheet.",
};

/** The Undo toast's title: what moved, and what a submitted week kept. */
export function describeTaskMerge(result: TaskMerged, intoName: string) {
  const moved =
    result.movedEntryCount === 0
      ? `Merged into ${intoName}`
      : `${formatEntryCount(result.movedEntryCount)} moved to ${intoName}`;
  if (result.keptEntryCount === 0) return moved;
  return `${moved}. ${formatEntryCount(result.keptEntryCount)} in submitted weeks ${
    result.keptEntryCount === 1 ? "stays" : "stay"
  }.`;
}

/** Merges with the Undo toast, or says why it can't. */
export function mergeTaskWithUndo(
  project: LocalProject,
  fromTaskId: string,
  intoTaskId: string,
  suggestion?: TaskMergeSuggestion["kind"],
) {
  const intoName =
    project.tasks.find((task) => task._id === intoTaskId)?.name ?? "the task";
  const { result, undoToken } = localStore.mergeTask(
    project._id,
    fromTaskId,
    intoTaskId,
    suggestion ? { suggestion } : {},
  );
  if (result.kind === "refused") {
    showToast(`Can't merge. ${REFUSALS[result.reason]}`);
    return;
  }
  offerUndo(undoToken, {
    title: describeTaskMerge(result, intoName),
    subject: "project",
  });
}

/**
 * Merge into…'s task picker: the project's other active tasks, Local only
 * ones disabled with why. Picking one merges at once, with Undo.
 */
export function MergeTaskDialog({
  project,
  task,
  entryCount,
  onClose,
}: {
  project: LocalProject;
  task: LocalProjectTask;
  /** The task's entries, for the line under its name. */
  entryCount: number;
  onClose: () => void;
}) {
  const targets = project.tasks.filter(
    (candidate) => candidate._id !== task._id && candidate.status === "active",
  );

  function pick(target: LocalProjectTask) {
    onClose();
    withEventAttribution({ surface: "button" }, () =>
      mergeTaskWithUndo(project, task._id, target._id),
    );
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="max-w-md gap-3"
        // The dialog renders in a portal, but React still bubbles its keys
        // to the task list, whose keys would act on the focused row.
        onKeyDown={(event) => event.stopPropagation()}
      >
        <DialogHeader className="gap-1">
          <DialogTitle className="composer-kicker">Merge into</DialogTitle>
          <p className="truncate text-[15px] font-semibold text-foreground">
            {task.name}
          </p>
          <DialogDescription className="text-xs">
            {entryCount === 0
              ? "It has no entries. Ajour archives it after the merge."
              : `Its ${formatEntryCount(entryCount)} ${
                  entryCount === 1 ? "moves" : "move"
                } to the task you pick, and Ajour archives it.`}
          </DialogDescription>
        </DialogHeader>
        <Command className="rounded-none bg-transparent p-0">
          <CommandInput autoFocus placeholder="Search tasks…" />
          <CommandList
            className="max-h-[min(18rem,45vh)] p-1"
            aria-label="Tasks to merge into"
          >
            <CommandEmpty>No tasks</CommandEmpty>
            {targets.map((target) => {
              const isLocal = getCommitTarget(project, target) === "local";
              return (
                <CommandItem
                  key={target._id}
                  value={target._id}
                  keywords={[target.name]}
                  disabled={isLocal}
                  onSelect={() => pick(target)}
                >
                  <span className="min-w-0 truncate">{target.name}</span>
                  {isLocal ? (
                    <span className="ml-auto text-xs text-muted-foreground">
                      Local only
                    </span>
                  ) : null}
                </CommandItem>
              );
            })}
          </CommandList>
        </Command>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** One suggestion, with the task row it sits under. */
export interface TaskMergeSuggestionRowModel extends TaskMergeSuggestion {
  /** The row it sits under: the gone task's new twin, or the local task. */
  anchorTaskId: string;
  text: string;
}

/**
 * The project's merge suggestions, by the task row each sits under, without
 * the pairs dismissed on this device. Only the active tasks list carries them.
 */
export function useTaskMergeSuggestionRows(
  project: LocalProject,
  entries: readonly LocalTimesheetEntry[],
  projectSources: LocalAppState["projectSources"],
): Map<string, TaskMergeSuggestionRowModel[]> {
  const dismissed = useTaskMergeDismissals();
  const sourceLabel = sourceNameOf(
    getProjectSourceLabel(project, projectSources),
  );

  return useMemo(() => {
    const rows = new Map<string, TaskMergeSuggestionRowModel[]>();
    const nameOf = (taskId: string) =>
      project.tasks.find((task) => task._id === taskId)?.name ?? "";
    const entryCounts = new Map<string, number>();
    for (const entry of entries) {
      if (entry.taskId) {
        entryCounts.set(entry.taskId, (entryCounts.get(entry.taskId) ?? 0) + 1);
      }
    }
    for (const suggestion of findTaskMergeSuggestions(
      project,
      entries,
      (pair) => isTaskMergeDismissed(dismissed, project._id, pair),
    )) {
      // A renamed task is archived, so its row is not in the active list:
      // the suggestion sits under its new twin instead.
      const anchorTaskId =
        suggestion.kind === "renamed"
          ? suggestion.intoTaskId
          : suggestion.fromTaskId;
      const count = entryCounts.get(suggestion.fromTaskId) ?? 0;
      const text =
        suggestion.kind === "renamed"
          ? `Renamed from “${nameOf(suggestion.fromTaskId)}”? Its ${formatEntryCount(count)} can move here.`
          : `Looks like “${nameOf(suggestion.intoTaskId)}” from ${sourceLabel}.`;
      rows.set(anchorTaskId, [
        ...(rows.get(anchorTaskId) ?? []),
        { ...suggestion, anchorTaskId, text },
      ]);
    }
    return rows;
  }, [project, entries, dismissed, sourceLabel]);
}

/** The quiet row under a suggested pair: the question, Merge and Not the same. */
export function TaskMergeSuggestionRow({
  project,
  suggestion,
}: {
  project: LocalProject;
  suggestion: TaskMergeSuggestionRowModel;
}) {
  return (
    <tr className="project-task-suggestion" data-task-merge-suggestion="">
      <td colSpan={2}>
        <div className="project-task-suggestion-content">
          <span className="project-task-suggestion-text">
            {suggestion.text}
          </span>
          <Button
            type="button"
            variant="outline"
            size="xs"
            onClick={() =>
              withEventAttribution({ surface: "button" }, () =>
                mergeTaskWithUndo(
                  project,
                  suggestion.fromTaskId,
                  suggestion.intoTaskId,
                  suggestion.kind,
                ),
              )
            }
          >
            Merge
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={() => dismissTaskMergeSuggestion(project._id, suggestion)}
          >
            Not the same
          </Button>
        </div>
      </td>
    </tr>
  );
}
