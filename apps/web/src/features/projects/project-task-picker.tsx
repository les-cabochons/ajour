import { useMemo, useState, type KeyboardEvent } from "react";
import {
  RiArrowDownSLine as ChevronDown,
  RiArrowLeftLine as ArrowLeft,
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
  getFavorites,
  type Favorite,
} from "@/domain/projects/project-transitions";
import {
  formatLastUsed,
  getRecentTasks,
  type RecentTask,
} from "@/domain/projects/recent-tasks";
import {
  getProjectLabel,
  PickerMoreRow,
  PickerProjectRow,
  PickerTaskRow,
} from "@/features/projects/project-task-picker-rows";
import {
  filterProjectTaskRows,
  findMatchingProjects,
  findMatchingProjectTasks,
  findMatchingTasksInProject,
} from "@/features/projects/project-task-search";
import { useLocalTimeRecords } from "@/lib/local-hooks";
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
  /** Opens the list from outside, such as a menu's "Choose project…". */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

/**
 * What the list shows: the start view (Favorites, Recent tasks and All
 * projects, or the search results), a project's tasks, the page of every
 * favorite, or the page of the tasks used last.
 */
type PickerView =
  | { kind: "projects" }
  | { kind: "tasks"; projectId: string }
  | { kind: "favorites" }
  | { kind: "recent" };

const projectsView: PickerView = { kind: "projects" };

/** How many favorites the start view shows before "N more favorites". */
const START_VIEW_FAVORITES = 3;

/** How many recent tasks the start view shows before "More recent tasks". */
const START_VIEW_RECENT = 3;

function formatMoreFavorites(count: number) {
  return count === 1 ? "1 more favorite" : `${count} more favorites`;
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
  open,
  onOpenChange,
}: ProjectTaskPickerProps) {
  const [isOpenState, setIsOpenState] = useState(false);
  const isOpen = open ?? isOpenState;
  const setIsOpen = (next: boolean) => {
    setIsOpenState(next);
    onOpenChange?.(next);
  };
  const [view, setView] = useState<PickerView>(projectsView);
  const [query, setQuery] = useState("");
  const activeProjects = useMemo(
    () => projects.filter((project) => project.status === "active"),
    [projects],
  );
  const selectedProject = projects.find((project) => project._id === projectId);
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
      browsingProject ? findMatchingTasksInProject(browsingProject, query) : [],
    [browsingProject, query],
  );
  const favorites = useMemo(() => getFavorites(projects), [projects]);
  const matchingFavorites = useMemo(
    () => filterProjectTaskRows(favorites, query),
    [favorites, query],
  );
  const { timesheetEntries, timers } = useLocalTimeRecords();
  // Only an open menu reads the entries, so closed pickers cost nothing.
  const recentTasks = useMemo(
    () => (isOpen ? getRecentTasks(projects, timesheetEntries, timers) : []),
    [isOpen, projects, timesheetEntries, timers],
  );
  // The start view never repeats a row: favorite tasks stay in Favorites.
  const startRecentTasks = useMemo(
    () =>
      recentTasks
        .filter(({ task }) => task.favoritedAt === undefined)
        .slice(0, START_VIEW_RECENT),
    [recentTasks],
  );
  const matchingRecentTasks = useMemo(
    () => filterProjectTaskRows(recentTasks, query),
    [recentTasks, query],
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

  function openView(next: PickerView) {
    setView(next);
    setQuery("");
  }

  function openProject(project: LocalProject) {
    openView({ kind: "tasks", projectId: project._id });
  }

  function isChecked(nextProjectId: string, nextTaskId: string) {
    return nextProjectId === projectId && nextTaskId === taskId;
  }

  function renderRecentTask({ project, task, usedAt }: RecentTask) {
    return (
      <PickerTaskRow
        key={`${project._id}-${task._id}`}
        project={project}
        task={task}
        value={`recent-task-${project._id}-${task._id}`}
        checked={isChecked(project._id, task._id)}
        projectDisplay="icon"
        trailing={
          <span className="shrink-0 text-xs text-[var(--text-tertiary)] tabular-nums">
            {formatLastUsed(usedAt, Date.now())}
          </span>
        }
        onSelect={() => commitSelection(project._id, task._id)}
      />
    );
  }

  function renderFavorite(favorite: Favorite) {
    const { project } = favorite;
    return favorite.kind === "project" ? (
      <PickerProjectRow
        key={project._id}
        project={project}
        value={`favorite-project-${project._id}`}
        onSelect={() => openProject(project)}
      />
    ) : (
      <PickerTaskRow
        key={`${project._id}-${favorite.task._id}`}
        project={project}
        task={favorite.task}
        value={`favorite-task-${project._id}-${favorite.task._id}`}
        checked={isChecked(project._id, favorite.task._id)}
        projectDisplay="icon"
        onSelect={() => commitSelection(project._id, favorite.task._id)}
      />
    );
  }

  function commitSelection(nextProjectId: string, nextTaskId = "") {
    onChange({ projectId: nextProjectId, taskId: nextTaskId });
    setIsOpen(false);
    resetNavigation();
  }

  function handleSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (
      event.key === "Backspace" &&
      view.kind !== "projects" &&
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
          "flex h-9 w-full min-w-0 items-center gap-2 rounded-[var(--control-radius)] border border-[var(--field-border)] bg-[var(--field-bg)] px-3 text-left text-[length:var(--control-font-size)] text-[var(--text)] transition-[border-color,box-shadow,background-color] outline-none hover:bg-[var(--surface-high)] focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30",
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
        <Command
          shouldFilter={false}
          className="rounded-none bg-transparent p-0"
        >
          <CommandInput
            autoFocus
            placeholder={
              browsingProject
                ? `Search tasks in ${getLocalProjectDisplayName(browsingProject)}...`
                : view.kind === "favorites"
                  ? "Search favorites..."
                  : view.kind === "recent"
                    ? "Search recent tasks..."
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

                {!hasQuery && favorites.length > 0 ? (
                  <>
                    <CommandGroup heading="Favorites">
                      {favorites
                        .slice(0, START_VIEW_FAVORITES)
                        .map(renderFavorite)}
                      {favorites.length > START_VIEW_FAVORITES ? (
                        <PickerMoreRow
                          value="more-favorites"
                          onSelect={() => openView({ kind: "favorites" })}
                        >
                          {formatMoreFavorites(
                            favorites.length - START_VIEW_FAVORITES,
                          )}
                        </PickerMoreRow>
                      ) : null}
                    </CommandGroup>
                    <CommandSeparator />
                  </>
                ) : null}

                {!hasQuery && startRecentTasks.length > 0 ? (
                  <>
                    <CommandGroup heading="Recent tasks">
                      {startRecentTasks.map(renderRecentTask)}
                      {recentTasks.length > startRecentTasks.length ? (
                        <PickerMoreRow
                          value="more-recent-tasks"
                          onSelect={() => openView({ kind: "recent" })}
                        >
                          More recent tasks
                        </PickerMoreRow>
                      ) : null}
                    </CommandGroup>
                    <CommandSeparator />
                  </>
                ) : null}

                {matchingProjects.length > 0 ? (
                  <CommandGroup
                    heading={hasQuery ? "Projects" : "All projects"}
                  >
                    {matchingProjects.map((project) => (
                      <PickerProjectRow
                        key={project._id}
                        project={project}
                        value={`project-${project._id}-${getProjectLabel(project)}`}
                        onSelect={() => openProject(project)}
                      />
                    ))}
                  </CommandGroup>
                ) : null}

                {taskResults.matches.length > 0 ? (
                  <>
                    {matchingProjects.length > 0 ? <CommandSeparator /> : null}
                    <CommandGroup heading="Tasks">
                      {taskResults.matches.map(({ project, task }) => (
                        <PickerTaskRow
                          key={`${project._id}-${task._id}`}
                          project={project}
                          task={task}
                          value={`task-${project._id}-${task._id}-${getProjectLabel(project)}-${task.name}`}
                          checked={isChecked(project._id, task._id)}
                          projectDisplay="label"
                          onSelect={() =>
                            commitSelection(project._id, task._id)
                          }
                        />
                      ))}
                    </CommandGroup>
                    {taskResults.total > taskResults.matches.length ? (
                      <p className="px-4 py-2 text-xs text-[var(--text-tertiary)]">
                        {taskResults.total - taskResults.matches.length} more
                        matches. Refine your search.
                      </p>
                    ) : null}
                  </>
                ) : null}

                {hasQuery && !hasGlobalResults ? (
                  <CommandEmpty>No matching projects or tasks.</CommandEmpty>
                ) : null}
              </>
            ) : view.kind === "recent" ? (
              <>
                <CommandGroup heading="Recent tasks">
                  <CommandItem
                    value="back-to-projects"
                    className="rounded-[var(--control-radius)]"
                    onSelect={() => openView(projectsView)}
                  >
                    <ArrowLeft className="size-4" />
                    <span className="flex-1">Back to projects</span>
                  </CommandItem>
                </CommandGroup>
                {matchingRecentTasks.length > 0 ? (
                  <>
                    <CommandSeparator />
                    <CommandGroup>
                      {matchingRecentTasks.map(renderRecentTask)}
                    </CommandGroup>
                  </>
                ) : (
                  <CommandEmpty>No matching recent tasks.</CommandEmpty>
                )}
              </>
            ) : view.kind === "favorites" ? (
              <>
                <CommandGroup heading="Favorites">
                  <CommandItem
                    value="back-to-projects"
                    className="rounded-[var(--control-radius)]"
                    onSelect={() => openView(projectsView)}
                  >
                    <ArrowLeft className="size-4" />
                    <span className="flex-1">Back to projects</span>
                  </CommandItem>
                </CommandGroup>
                {matchingFavorites.length > 0 ? (
                  <>
                    <CommandSeparator />
                    <CommandGroup>
                      {matchingFavorites.map(renderFavorite)}
                    </CommandGroup>
                  </>
                ) : (
                  <CommandEmpty>No matching favorites.</CommandEmpty>
                )}
              </>
            ) : browsingProject ? (
              <>
                <CommandGroup heading={getProjectLabel(browsingProject)}>
                  <CommandItem
                    value="back-to-projects"
                    className="rounded-[var(--control-radius)]"
                    onSelect={() => openView(projectsView)}
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
                        <span className="flex-1">
                          Use project without a task
                        </span>
                      </CommandItem>
                    </>
                  ) : null}
                </CommandGroup>

                {matchingProjectTasks.length > 0 ? (
                  <>
                    <CommandSeparator />
                    <CommandGroup heading="Tasks">
                      {matchingProjectTasks.map((task) => (
                        <PickerTaskRow
                          key={task._id}
                          project={browsingProject}
                          task={task}
                          value={`project-task-${task._id}-${task.name}`}
                          checked={isChecked(browsingProject._id, task._id)}
                          onSelect={() =>
                            commitSelection(browsingProject._id, task._id)
                          }
                        />
                      ))}
                    </CommandGroup>
                  </>
                ) : hasQuery ? (
                  <CommandEmpty>
                    No matching tasks in this project.
                  </CommandEmpty>
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
