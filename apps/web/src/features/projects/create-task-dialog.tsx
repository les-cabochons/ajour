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
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  getLocalProjectDisplayName,
  type LocalProject,
} from "@/domain/local-state";
import {
  getTaskNameField,
  type CommitsAsChoice,
} from "@/domain/projects/plugin-properties";
import { findProjectTaskByImportName } from "@/domain/projects/project-transitions";
import { getRecentTasks } from "@/domain/projects/recent-tasks";
import { formatTaskImportName } from "@/domain/projects/task-import";
import { createTaskFromPicker } from "@/features/projects/task-creation";
import {
  COMMITS_AS_OPTIONS,
  useTaskPropertyPlugins,
} from "@/features/projects/task-property-fields";
import { useLocalTimeRecords } from "@/lib/local-hooks";

/**
 * Create task, from the time entry task menu's start view, where no project
 * is chosen yet (#481): the typed name, a project picker with recent
 * projects first and none preselected, so a task never lands in a project by
 * default, and Commits as when the project commits. A name the project
 * already has uses that task, or restores it when archived.
 */
export function CreateTaskDialog({
  name: initialName,
  projects,
  onCreated,
  onCancel,
}: {
  /** The text typed in the menu. Null keeps the dialog closed. */
  name: string | null;
  projects: LocalProject[];
  onCreated: (projectId: string, taskId: string) => void;
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
          onCreated={onCreated}
          onCancel={onCancel}
        />
      ) : null}
    </Dialog>
  );
}

function CreateTaskForm({
  initialName,
  projects,
  onCreated,
  onCancel,
}: {
  initialName: string;
  projects: LocalProject[];
  onCreated: (projectId: string, taskId: string) => void;
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
  const projectOptions = useMemo(() => {
    const recentIds = [
      ...new Set(
        getRecentTasks(activeProjects, timesheetEntries, timers).map(
          ({ project }) => project._id,
        ),
      ),
    ];
    const option = (project: LocalProject, group: string) => ({
      value: project._id,
      label: getLocalProjectDisplayName(project),
      group,
      keywords: [project.name, project.code ?? ""],
    });
    return [
      ...recentIds.flatMap((id) => {
        const project = activeProjects.find((item) => item._id === id);
        return project ? [option(project, "Recent")] : [];
      }),
      ...activeProjects
        .filter((project) => !recentIds.includes(project._id))
        .map((project) => option(project, "All projects")),
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
    void createTaskFromPicker({
      projectId: project._id,
      name: trimmed,
      commitAs:
        showsCommitsAs && (choice === "waiting" || choice === "local")
          ? choice
          : undefined,
      confirmed: true,
      onCreated: (taskId) => onCreated(project._id, taskId),
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
            <FieldLabel>Project</FieldLabel>
            <SearchableSelect
              value={projectId}
              options={projectOptions}
              onChange={setProjectId}
              placeholder="Pick a project"
              emptyMessage="No matching projects"
              ariaLabel="Project"
              autoFocus
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
