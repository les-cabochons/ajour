import { useMemo, useState, type KeyboardEvent } from "react";
import {
  RiArrowDownSLine as ChevronDown,
  RiArrowLeftLine as ArrowLeft,
  RiArrowRightSLine as ChevronRight,
  RiCloseCircleLine as NoProject,
  RiSubtractLine as NoTask,
} from "@remixicon/react";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { LocalProject } from "@/domain/local-state";
import { getLocalProjectDisplayName } from "@/domain/local-state";
import {
  getProjectTaskBillableValueLabel,
  isProjectTaskBillable,
} from "@/features/projects/project-task-options";
import {
  findMatchingProjects,
  findMatchingProjectTasks,
  findMatchingTasksInProject,
} from "@/features/projects/project-task-search";
import { ProjectIcon } from "@/lib/project-icons";
import { cn } from "@/lib/utils";

export interface ProjectTaskSelection {
  projectId: string;
  taskId: string;
}

interface ProjectTaskPickerProps {
  projects: LocalProject[];
  projectId: string;
  taskId: string;
  onChange: (selection: ProjectTaskSelection) => void;
  placeholder?: string;
  ariaLabel?: string;
  allowNoProject?: boolean;
  className?: string;
}

type PickerView =
  | { kind: "projects" }
  | { kind: "tasks"; projectId: string };

const projectsView: PickerView = { kind: "projects" };

function getProjectLabel(project: LocalProject) {
  const displayName = getLocalProjectDisplayName(project);
  return project.code ? `[${project.code}] ${displayName}` : displayName;
}

export function ProjectTaskPicker({
  projects,
  projectId,
  taskId,
  onChange,
  placeholder = "Select project or task",
  ariaLabel = "Project or task",
  allowNoProject = true,
  className,
}: ProjectTaskPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [view, setView] = useState<PickerView>(projectsView);
  const [query, setQuery] = useState("");
  const activeProjects = useMemo(
    () => projects.filter((project) => project.status === "active"),
    [projects],
  );
  const selectedProject = projects.find(
    (project) => project._id === projectId,
  );
  const selectedTask = selectedProject?.tasks.find(
    (task) => task._id === taskId,
  );
  const selectedLabel = selectedProject
    ? selectedTask
      ? `${getProjectLabel(selectedProject)} · ${selectedTask.name}`
      : `${getProjectLabel(selectedProject)} · No task`
    : placeholder;
  const browsingProject =
    view.kind === "tasks"
      ? activeProjects.find((project) => project._id === view.projectId)
      : undefined;
  const matchingProjects = useMemo(
    () => findMatchingProjects(activeProjects, query),
    [activeProjects, query],
  );
  const taskResults = useMemo(
    () => findMatchingProjectTasks(activeProjects, query),
    [activeProjects, query],
  );
  const matchingProjectTasks = useMemo(
    () =>
      browsingProject
        ? findMatchingTasksInProject(browsingProject, query)
        : [],
    [browsingProject, query],
  );
  const hasQuery = query.trim().length > 0;
  const hasGlobalResults =
    matchingProjects.length > 0 || taskResults.matches.length > 0;

  function resetNavigation() {
    setView(projectsView);
    setQuery("");
  }

  function handleOpenChange(open: boolean) {
    setIsOpen(open);
    if (!open) {
      resetNavigation();
    }
  }

  function openProject(project: LocalProject) {
    setView({ kind: "tasks", projectId: project._id });
    setQuery("");
  }

  function commitSelection(nextProjectId: string, nextTaskId = "") {
    onChange({ projectId: nextProjectId, taskId: nextTaskId });
    setIsOpen(false);
    resetNavigation();
  }

  function handleSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (
      event.key === "Backspace" &&
      view.kind === "tasks" &&
      query.length === 0
    ) {
      event.preventDefault();
      setView(projectsView);
    }
  }

  return (
    <Popover open={isOpen} onOpenChange={handleOpenChange}>
      <PopoverTrigger
        className={cn(
          "flex h-9 w-full min-w-0 items-center gap-2 rounded-[var(--control-radius)] border border-[var(--field-border)] bg-[var(--field-bg)] px-3 text-left text-[length:var(--control-font-size)] text-[var(--text)] outline-none transition-[border-color,box-shadow,background-color] hover:bg-[var(--surface-high)] focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30",
          className,
        )}
        aria-label={ariaLabel}
      >
        {selectedProject ? (
          <ProjectIcon
            icon={selectedProject.icon}
            color={selectedProject.color}
            className="size-4 shrink-0"
          />
        ) : null}
        <span
          className={cn(
            "min-w-0 flex-1 truncate",
            !selectedProject && "text-[var(--text-tertiary)]",
          )}
        >
          {selectedLabel}
        </span>
        <ChevronDown
          className={cn(
            "size-4 shrink-0 text-[var(--text-tertiary)] transition-transform",
            isOpen && "rotate-180",
          )}
          aria-hidden="true"
        />
      </PopoverTrigger>

      <PopoverContent
        align="start"
        sideOffset={6}
        className="project-task-picker-popover w-[min(26rem,calc(100vw-1rem))] gap-0 overflow-hidden rounded-[var(--radius-md)] border border-[var(--border-hover)] bg-[var(--surface-low)] p-0 shadow-[var(--shadow-lg)]"
      >
        <Command shouldFilter={false} className="rounded-none bg-transparent p-0">
          <CommandInput
            autoFocus
            placeholder={
              browsingProject
                ? `Search tasks in ${getLocalProjectDisplayName(browsingProject)}...`
                : "Search projects and tasks..."
            }
            value={query}
            onValueChange={setQuery}
            onKeyDown={handleSearchKeyDown}
          />
          <CommandList className="max-h-[min(22rem,55vh)] pb-1">
            {view.kind === "projects" ? (
              <>
                {!hasQuery && allowNoProject ? (
                  <>
                    <CommandGroup heading="Selection">
                      <CommandItem
                        value="no-project"
                        className="rounded-[var(--control-radius)]"
                        data-checked={!projectId ? "true" : undefined}
                        onSelect={() => commitSelection("")}
                      >
                        <NoProject className="size-4 text-[var(--text-tertiary)]" />
                        <span className="flex-1">No project</span>
                      </CommandItem>
                    </CommandGroup>
                    <CommandSeparator />
                  </>
                ) : null}

                {matchingProjects.length > 0 ? (
                  <CommandGroup heading="Projects">
                    {matchingProjects.map((project) => (
                      <CommandItem
                        key={project._id}
                        value={`project-${project._id}-${getProjectLabel(project)}`}
                        className="rounded-[var(--control-radius)]"
                        onSelect={() => openProject(project)}
                      >
                        <ProjectIcon
                          icon={project.icon}
                          color={project.color}
                          className="size-4 shrink-0"
                        />
                        <span className="min-w-0 flex-1 truncate">
                          {getProjectLabel(project)}
                        </span>
                        <span className="shrink-0 text-xs font-normal text-[var(--text-tertiary)]">
                          {project.tasks.filter((task) => task.status === "active").length}
                        </span>
                        <ChevronRight className="size-4 shrink-0 text-[var(--text-tertiary)]" />
                      </CommandItem>
                    ))}
                  </CommandGroup>
                ) : null}

                {taskResults.matches.length > 0 ? (
                  <>
                    {matchingProjects.length > 0 ? <CommandSeparator /> : null}
                    <CommandGroup heading="Tasks">
                      {taskResults.matches.map(({ project, task }) => (
                        <CommandItem
                          key={`${project._id}-${task._id}`}
                          value={`task-${project._id}-${task._id}-${getProjectLabel(project)}-${task.name}`}
                          className="rounded-[var(--control-radius)]"
                          data-checked={
                            project._id === projectId && task._id === taskId
                              ? "true"
                              : undefined
                          }
                          onSelect={() =>
                            commitSelection(project._id, task._id)
                          }
                        >
                          <ProjectIcon
                            icon={project.icon}
                            color={project.color}
                            className="size-4 shrink-0"
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate">{task.name}</span>
                            <span className="block truncate text-xs font-normal text-[var(--text-tertiary)]">
                              {getProjectLabel(project)}
                            </span>
                          </span>
                          <span
                            className={cn(
                              "shrink-0 text-[11px] font-normal",
                              isProjectTaskBillable(task)
                                ? "text-[var(--text-secondary)]"
                                : "text-[var(--text-tertiary)]",
                            )}
                          >
                            {getProjectTaskBillableValueLabel(task)}
                          </span>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                    {taskResults.total > taskResults.matches.length ? (
                      <p className="px-4 py-2 text-xs text-[var(--text-tertiary)]">
                        {taskResults.total - taskResults.matches.length} more matches. Refine your search.
                      </p>
                    ) : null}
                  </>
                ) : null}

                {hasQuery && !hasGlobalResults ? (
                  <CommandEmpty>No matching projects or tasks.</CommandEmpty>
                ) : null}
              </>
            ) : browsingProject ? (
              <>
                <CommandGroup heading={getProjectLabel(browsingProject)}>
                  <CommandItem
                    value="back-to-projects"
                    className="rounded-[var(--control-radius)]"
                    onSelect={() => {
                      setView(projectsView);
                      setQuery("");
                    }}
                  >
                    <ArrowLeft className="size-4" />
                    <span className="flex-1">Back to projects</span>
                  </CommandItem>
                  {!hasQuery ? (
                    <>
                      <CommandSeparator />
                      <CommandItem
                        value={`project-only-${browsingProject._id}`}
                        className="rounded-[var(--control-radius)]"
                        data-checked={
                          browsingProject._id === projectId && !taskId
                            ? "true"
                            : undefined
                        }
                        onSelect={() => commitSelection(browsingProject._id)}
                      >
                        <NoTask className="size-4 text-[var(--text-tertiary)]" />
                        <span className="flex-1">Use project without a task</span>
                      </CommandItem>
                    </>
                  ) : null}
                </CommandGroup>

                {matchingProjectTasks.length > 0 ? (
                  <>
                    <CommandSeparator />
                    <CommandGroup heading="Tasks">
                      {matchingProjectTasks.map((task) => (
                        <CommandItem
                          key={task._id}
                          value={`project-task-${task._id}-${task.name}`}
                          className="rounded-[var(--control-radius)]"
                          data-checked={
                            browsingProject._id === projectId &&
                            task._id === taskId
                              ? "true"
                              : undefined
                          }
                          onSelect={() =>
                            commitSelection(browsingProject._id, task._id)
                          }
                        >
                          <span className="min-w-0 flex-1 truncate">
                            {task.name}
                          </span>
                          <span
                            className={cn(
                              "shrink-0 text-[11px] font-normal",
                              isProjectTaskBillable(task)
                                ? "text-[var(--text-secondary)]"
                                : "text-[var(--text-tertiary)]",
                            )}
                          >
                            {getProjectTaskBillableValueLabel(task)}
                          </span>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </>
                ) : hasQuery ? (
                  <CommandEmpty>No matching tasks in this project.</CommandEmpty>
                ) : null}
              </>
            ) : (
              <CommandEmpty>This project is no longer available.</CommandEmpty>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
