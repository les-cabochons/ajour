import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { OptionSelect } from "@/components/ui/option-select";
import {
  getLocalProjectDisplayName,
  type LocalProject,
  type TaskCommitAs,
} from "@/domain/local-state";
import {
  getTaskNameField,
  type CommitsAsChoice,
} from "@/domain/projects/plugin-properties";
import { findProjectTaskByImportName } from "@/domain/projects/project-transitions";
import { getRecentTasks } from "@/domain/projects/recent-tasks";
import { formatTaskImportName } from "@/domain/projects/task-import";
import {
  COMMITS_AS_OPTIONS,
  useTaskPropertyPlugins,
} from "@/features/projects/commits-as";
import { useLocalTimeRecords } from "@/lib/local-hooks";

/** What the Create task dialog hands back to the picker that opened it. */
export interface CreateTaskRequest {
  projectId: string;
  name: string;
  commitAs?: TaskCommitAs;
}

/**
 * Create task, from the time entry task menu's start view, where no project
 * is chosen yet (#481): the typed name, a project menu with recent projects
 * first and none preselected, so a task never lands in a project by
 * default, and Commits as when the project commits. A name the project
 * already has uses that task, or restores it when archived. The picker
 * creates the task, so its Undo works like the picker's own create row.
 */
export function CreateTaskDialog({
  name: initialName,
  projects,
  onSubmit,
  onCancel,
}: {
  /** The text typed in the menu. Null keeps the dialog closed. */
  name: string | null;
  projects: LocalProject[];
  onSubmit: (request: CreateTaskRequest) => void;
  onCancel: () => void;
}) {
  return (
    <Dialog
      open={initialName !== null}
      onOpenChange={(open) => !open && onCancel()}
    >
      {initialName !== null ? (
        <CreateTaskForm
          initialName={initialName}
          projects={projects}
          onSubmit={onSubmit}
          onCancel={onCancel}
        />
      ) : null}
    </Dialog>
  );
}

function CreateTaskForm({
  initialName,
  projects,
  onSubmit,
  onCancel,
}: {
  initialName: string;
  projects: LocalProject[];
  onSubmit: (request: CreateTaskRequest) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initialName);
  const [projectId, setProjectId] = useState("");
  const [choice, setChoice] = useState<CommitsAsChoice>("own");
  const { timesheetEntries, timers } = useLocalTimeRecords();
  const committingPlugin = useTaskPropertyPlugins().find((plugin) =>
    getTaskNameField(plugin),
  );

  const activeProjects = useMemo(
    () => projects.filter((project) => project.status === "active"),
    [projects],
  );
  // A menu, not a searchable list: a list focused and open as the dialog
  // opens is outside the modal dialog when it hides the rest of the page, so
  // screen readers would not reach it (see SearchableSelect). Typing a
  // project's first letters still moves to it.
  const projectGroups = useMemo(() => {
    const recentIds = [
      ...new Set(
        getRecentTasks(activeProjects, timesheetEntries, timers).map(
          ({ project }) => project._id,
        ),
      ),
    ];
    const option = (project: LocalProject) => ({
      value: project._id,
      label: getLocalProjectDisplayName(project),
    });
    const recent = recentIds.flatMap((id) => {
      const project = activeProjects.find((item) => item._id === id);
      return project ? [option(project)] : [];
    });
    const others = activeProjects
      .filter((project) => !recentIds.includes(project._id))
      .map(option);
    return [
      ...(recent.length > 0 ? [{ label: "Recent", options: recent }] : []),
      ...(others.length > 0
        ? [{ label: "All projects", options: others }]
        : []),
    ];
  }, [activeProjects, timesheetEntries, timers]);

  const project = activeProjects.find((item) => item._id === projectId);
  const trimmed = formatTaskImportName(name);
  const found =
    project && trimmed
      ? findProjectTaskByImportName(project, trimmed)
      : undefined;
  const action =
    found?.status === "active"
      ? `Use ${found.name}`
      : found
        ? `Restore ${found.name}`
        : "Create task";
  const showsCommitsAs = Boolean(
    committingPlugin && project && !project.localOnly && !found,
  );

  function submit() {
    if (!project || !trimmed) return;
    onSubmit({
      projectId: project._id,
      name: trimmed,
      commitAs:
        showsCommitsAs && (choice === "waiting" || choice === "local")
          ? choice
          : undefined,
    });
  }

  return (
    <DialogContent className="max-w-md gap-4">
      <DialogHeader className="gap-1">
        <DialogTitle>Create task</DialogTitle>
        <DialogDescription className="sr-only">
          Name the task and pick its project.
        </DialogDescription>
      </DialogHeader>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <FieldGroup className="gap-4">
          <Field>
            <FieldLabel htmlFor="create-task-name">Name</FieldLabel>
            <Input
              id="create-task-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="create-task-project">Project</FieldLabel>
            <OptionSelect
              id="create-task-project"
              size="default"
              value={projectId}
              options={[{ value: "", label: "Pick a project", disabled: true }]}
              groups={projectGroups}
              onChange={setProjectId}
            />
          </Field>
          {project?.team && !found ? (
            <p className="text-xs text-muted-foreground">
              {getLocalProjectDisplayName(project)} is shared, so your team gets
              the task too.
            </p>
          ) : null}
          {showsCommitsAs ? (
            <Field>
              <FieldLabel htmlFor="create-task-commits-as">
                Commits as
              </FieldLabel>
              <OptionSelect
                id="create-task-commits-as"
                size="default"
                value={choice}
                options={COMMITS_AS_OPTIONS.filter(
                  (option) => option.value !== "another",
                )}
                onChange={setChoice}
              />
            </Field>
          ) : null}
        </FieldGroup>
        <DialogFooter className="mt-4">
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" disabled={!project || !trimmed}>
            {action}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
