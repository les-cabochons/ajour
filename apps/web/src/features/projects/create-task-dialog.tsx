import { useMemo, useState } from "react";
import { RiFolderLine as EmptyProjectIcon } from "@remixicon/react";
import { ProjectIcon } from "@/lib/project-icons";
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
  // A menu, not a searchable list: the list's popup portals outside the
  // modal dialog, which hides it from screen readers. Typing a project's
  // first letters still moves to it.
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
      icon: (
        <ProjectIcon
          icon={project.icon}
          color={project.color}
          className="size-3.5 shrink-0"
        />
      ),
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
    <DialogContent className="composer-nested max-w-md gap-4">
      <DialogHeader className="gap-1">
        <DialogTitle className="composer-kicker">Create task</DialogTitle>
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
        {/* The task composer: its name to write in, then its project and
            what it commits as as chips (forms council round 7). */}
        <FieldGroup className="composer gap-3">
          <Field>
            <FieldLabel htmlFor="create-task-name" className="sr-only">
              Name
            </FieldLabel>
            <input
              id="create-task-name"
              className="composer-title"
              autoComplete="off"
              placeholder="Task name"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
          <div className="composer-chips" role="group" aria-label="Properties">
            <OptionSelect
              id="create-task-project"
              label="Project"
              size="sm"
              iconLabel
              className="composer-chip"
              value={projectId}
              options={[
                {
                  value: "",
                  label: "Project",
                  disabled: true,
                  icon: (
                    <EmptyProjectIcon
                      aria-hidden
                      className="size-3.5 text-muted-foreground"
                    />
                  ),
                },
              ]}
              groups={projectGroups}
              onChange={setProjectId}
            />
            {showsCommitsAs ? (
              <OptionSelect
                id="create-task-commits-as"
                label="Commits as"
                size="sm"
                className="composer-chip"
                value={choice}
                options={COMMITS_AS_OPTIONS.filter(
                  (option) => option.value !== "another",
                )}
                onChange={setChoice}
              />
            ) : null}
          </div>
          {project?.team && !found ? (
            <p className="text-xs text-muted-foreground">
              {getLocalProjectDisplayName(project)} is shared, so your team gets
              the task too.
            </p>
          ) : null}
        </FieldGroup>
        <DialogFooter className="mt-4">
          <Button type="button" variant="ghost" onClick={onCancel}>
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
