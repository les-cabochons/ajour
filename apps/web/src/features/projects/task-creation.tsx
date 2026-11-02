import { useEffect, useState } from "react";
import {
  ConfirmDialog,
  type ConfirmQuestion,
} from "@/components/confirm-dialog";
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
import { OptionSelect } from "@/components/ui/option-select";
import { showToast, showUndoToast } from "@/components/ui/toast";
import {
  getLocalProjectDisplayName,
  isProjectTaskInUse,
  type LocalProject,
  type TaskCommitAs,
} from "@/domain/local-state";
import {
  getCommitsAsChoice,
  getTaskNameField,
  type CommitsAsChoice,
} from "@/domain/projects/plugin-properties";
import { findProjectTaskByImportName } from "@/domain/projects/project-transitions";
import { formatTaskImportName } from "@/domain/projects/task-import";
import {
  COMMITS_AS_OPTIONS,
  useTaskPropertyPlugins,
} from "@/features/projects/commits-as";
import { useLocalState } from "@/lib/local-hooks";
import { localStore } from "@/lib/local-store";
import { listTaskPropertyPlugins } from "@/lib/plugin-project-properties";

/*
 * Creating a task from a task picker (#481). The pickers show a last row,
 * `describeCreateTaskRow`, and call `createTaskFromPicker`, which matches
 * names the way task imports do, so a later import of the same task updates
 * the one created here. A shared project asks first, through the host
 * mounted once in the app shell, which also opens the toast's Change.
 */

/**
 * The create row of a task picker in `project` for the typed text: Create
 * task "07 Run", Restore task "07 Run" for an archived task of that name, or
 * Add task "07 Run" for the team… in a shared project. Null when an active
 * task has that name, which the picker already lists.
 */
export function describeCreateTaskRow(
  project: Pick<LocalProject, "tasks" | "team">,
  text: string,
): string | null {
  const name = formatTaskImportName(text);
  if (!name) return null;
  const found = findProjectTaskByImportName(project, name);
  if (found?.status === "active") return null;
  if (found) return `Restore task "${found.name}"`;
  return project.team
    ? `Add task "${name}" for the team…`
    : `Create task "${name}"`;
}

/**
 * Whether an active plugin commits tasks under a name, from the last read.
 * Undefined until the first one.
 */
let hasCommittingPlugin: boolean | undefined;

async function refreshCommittingPlugin() {
  try {
    const plugins = await listTaskPropertyPlugins();
    hasCommittingPlugin = plugins.some((plugin) => getTaskNameField(plugin));
  } catch {
    // The overview call's own event records the failure.
  }
}

/**
 * Whether another task of the project commits as this task, through a
 * plugin's name field that holds its name, such as a saved Another task….
 */
function isTaskNameMapped(
  projects: readonly LocalProject[],
  projectId: string,
  taskId: string,
) {
  const project = projects.find((item) => item._id === projectId);
  const name = project?.tasks.find((item) => item._id === taskId)?.name;
  return Boolean(
    name &&
    project?.tasks.some(
      (task) =>
        task._id !== taskId &&
        Object.values(task.pluginProperties ?? {}).some((fields) =>
          Object.values(fields).includes(name),
        ),
    ),
  );
}

let questionListener:
  ((question: ConfirmQuestion, resolve: (ok: boolean) => void) => void) | null =
  null;
let commitsAsListener:
  ((request: { projectId: string; taskId: string }) => void) | null = null;

/** Asks the question in the host. Without a mounted host it answers no. */
function confirm(question: ConfirmQuestion): Promise<boolean> {
  return new Promise((resolve) => {
    if (!questionListener) resolve(false);
    else questionListener(question, resolve);
  });
}

/**
 * Gives `projectId` a task named `name` from a picker, then hands its ID to
 * `onCreated`: the active task of that name at once, else an archived one
 * restored or a new task, with an Undo toast. A shared project asks first.
 *
 * With `oneUndo`, what `onCreated` writes to the store shares the toast's
 * Undo, as for a property that saves at once: `oneUndo.workItemId` names
 * the backlog item whose mapping Undo takes back too. Otherwise `onCreated`
 * only fills a draft: Undo removes the task and calls `onUndone`. Either
 * way, Undo refuses once another entry, the running entry or another
 * backlog item uses the task.
 *
 * The toast's Change opens Commits as for the task when a plugin commits
 * tasks and the project is not Local only.
 */
export async function createTaskFromPicker({
  projectId,
  name: typed,
  commitAs,
  onCreated,
  onUndone,
  oneUndo,
  confirmed = false,
}: {
  projectId: string;
  name: string;
  /** What a new task commits as. A restored task keeps its own. */
  commitAs?: TaskCommitAs;
  onCreated: (taskId: string) => void;
  onUndone?: () => void;
  oneUndo?: { workItemId: string };
  /** The user already agreed that a shared project's team gets the task. */
  confirmed?: boolean;
}): Promise<void> {
  const project = localStore
    .snapshot()
    .projects.find((candidate) => candidate._id === projectId);
  const name = formatTaskImportName(typed);
  if (!project || !name) return;
  const found = findProjectTaskByImportName(project, name);
  if (found?.status === "active") {
    onCreated(found._id);
    return;
  }

  const projectName = getLocalProjectDisplayName(project);
  const taskName = found?.name ?? name;
  if (project.team && !confirmed) {
    const ok = await confirm({
      title: found
        ? `Restore task ${taskName} in ${projectName}?`
        : `Add task ${taskName} to ${projectName}?`,
      body: `${projectName} is shared, so your team gets the task too.`,
      action: found ? "Restore task" : "Add task",
    });
    if (!ok) return;
  }

  const draft = { name, ...(commitAs ? { commitAs } : {}) };
  const create = () =>
    localStore.createOrRestoreProjectTaskWithUndo(projectId, draft).result;
  let taskId: string;
  let undoToken: string | null;
  if (oneUndo) {
    const grouped = localStore.runWithUndo(() => {
      const result = create();
      onCreated(result.taskId);
      return result;
    });
    taskId = grouped.result.taskId;
    undoToken = grouped.undoToken;
  } else {
    const created = localStore.createOrRestoreProjectTaskWithUndo(
      projectId,
      draft,
    );
    taskId = created.result.taskId;
    undoToken = created.undoToken;
    onCreated(taskId);
  }
  if (!undoToken) return;
  const token = undoToken;

  // The toast shows at once: waiting on the plugins could let a later
  // action's toast show first and then lose its Undo to this one. Change
  // shows unless the last read found no plugin that commits tasks.
  void refreshCommittingPlugin();
  const canChange = !project.localOnly && hasCommittingPlugin !== false;
  showUndoToast({
    title: found ? `Task ${taskName} restored` : `Task ${taskName} created`,
    onUndo: () => {
      const now = localStore.snapshot();
      if (
        isProjectTaskInUse(now, taskId, oneUndo?.workItemId) ||
        isTaskNameMapped(now.projects, projectId, taskId)
      ) {
        showToast(`Can't undo. ${taskName} is in use now. Archive it instead.`);
        return;
      }
      if (localStore.undo(token) !== "restored") {
        showToast("Can't undo. The project changed after that action.");
        return;
      }
      if (!oneUndo) onUndone?.();
    },
    onClose: () => localStore.forgetUndo(token),
    action: canChange
      ? {
          label: "Change",
          run: () => commitsAsListener?.({ projectId, taskId }),
        }
      : undefined,
  });
}

/**
 * Asks what the task commits as and saves it, for the Change of a created
 * task's toast. Its menu is the task editor's Commits as, without Another
 * task…, which needs the task editor's picker.
 */
function TaskCommitsAsDialog({
  request,
  onClose,
}: {
  request: { projectId: string; taskId: string };
  onClose: () => void;
}) {
  const state = useLocalState();
  const plugin = useTaskPropertyPlugins().find((candidate) =>
    getTaskNameField(candidate),
  );
  const task = state.projects
    .find((project) => project._id === request.projectId)
    ?.tasks.find((candidate) => candidate._id === request.taskId);
  const saved = task && plugin ? getCommitsAsChoice(task, plugin) : "own";
  const [choice, setChoice] = useState<CommitsAsChoice | null>(null);
  const shown = choice ?? (saved === "another" ? "own" : saved);

  function save() {
    if (task && shown !== saved) {
      localStore.updateProjectTask(request.projectId, request.taskId, {
        commitAs: shown === "own" || shown === "another" ? undefined : shown,
      });
    }
    onClose();
  }

  return (
    <DialogContent className="max-w-sm gap-4">
      <DialogHeader className="gap-1">
        <DialogTitle>
          What does {task?.name ?? "this task"} commit as?
        </DialogTitle>
        <DialogDescription>
          {plugin?.capability.section ?? "Your timesheet tool"} gets its time
          under the answer.
        </DialogDescription>
      </DialogHeader>
      <Field>
        <FieldLabel htmlFor="task-commits-as">Commits as</FieldLabel>
        <OptionSelect
          id="task-commits-as"
          size="default"
          value={shown}
          options={COMMITS_AS_OPTIONS.filter(
            (option) => option.value !== "another",
          )}
          onChange={setChoice}
        />
      </Field>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="button" onClick={save} disabled={!task}>
          Save
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

/**
 * The shared-project question and the Commits as dialog of
 * `createTaskFromPicker`. Mounted once in the app shell.
 */
export function TaskCreationDialogHost() {
  const [question, setQuestion] = useState<{
    question: ConfirmQuestion;
    resolve: (ok: boolean) => void;
  } | null>(null);
  const [questionOpen, setQuestionOpen] = useState(false);
  const [commitsAs, setCommitsAs] = useState<{
    projectId: string;
    taskId: string;
  } | null>(null);

  useEffect(() => {
    const onQuestion = (
      next: ConfirmQuestion,
      resolve: (ok: boolean) => void,
    ) => {
      setQuestion((current) => {
        current?.resolve(false);
        return { question: next, resolve };
      });
      setQuestionOpen(true);
    };
    const onCommitsAs = (next: { projectId: string; taskId: string }) =>
      setCommitsAs(next);
    questionListener = onQuestion;
    commitsAsListener = onCommitsAs;
    return () => {
      if (questionListener === onQuestion) questionListener = null;
      if (commitsAsListener === onCommitsAs) commitsAsListener = null;
    };
  }, []);

  function answer(ok: boolean) {
    question?.resolve(ok);
    // The question stays set while the dialog closes, so its text holds.
    setQuestion((current) =>
      current ? { ...current, resolve: () => {} } : null,
    );
    setQuestionOpen(false);
  }

  return (
    <>
      <ConfirmDialog
        question={question?.question ?? null}
        open={questionOpen}
        onOpenChange={(open) => !open && answer(false)}
        onConfirm={() => answer(true)}
      />
      <Dialog
        open={Boolean(commitsAs)}
        onOpenChange={(open) => !open && setCommitsAs(null)}
      >
        {commitsAs ? (
          <TaskCommitsAsDialog
            key={`${commitsAs.projectId}:${commitsAs.taskId}`}
            request={commitsAs}
            onClose={() => setCommitsAs(null)}
          />
        ) : null}
      </Dialog>
    </>
  );
}
