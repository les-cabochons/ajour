import type { ReactNode, SyntheticEvent } from "react";
import {
  RiArrowRightSLine as ChevronRight,
  RiStarFill,
  RiStarLine,
} from "@remixicon/react";
import { Chip } from "@/components/ui/chip";
import { CommandItem } from "@/components/ui/command";
import type { LocalProject, LocalProjectTask } from "@/domain/local-state";
import { getLocalProjectDisplayName } from "@/domain/local-state";
import {
  setProjectFavorite,
  setTaskFavorite,
} from "@/features/projects/favorites";
import { PinnedSlotBadge } from "@/features/projects/pinned-slot";
import { isProjectTaskBillable } from "@/features/projects/project-task-options";
import { ProjectIcon } from "@/lib/project-icons";
import { cn } from "@/lib/utils";

/** "[CODE] Name", or the name alone, as the picker names a project. */
export function getProjectLabel(project: LocalProject) {
  const displayName = getLocalProjectDisplayName(project);
  return project.code ? `[${project.code}] ${displayName}` : displayName;
}

const ROW_CLASS = "rounded-[var(--control-radius)]";

function stopRowEvent(event: SyntheticEvent) {
  event.preventDefault();
  event.stopPropagation();
}

/**
 * The star at the start of a task menu row. A starred row always shows it
 * filled; another row shows its outline on hover and highlight. Pressing it
 * toggles the star without choosing the row or moving focus from the search.
 */
function FavoriteStar({
  favorite,
  name,
  onToggle,
}: {
  favorite: boolean;
  name: string;
  onToggle: (favorite: boolean) => void;
}) {
  const Icon = favorite ? RiStarFill : RiStarLine;
  return (
    <button
      type="button"
      // The search keeps focus: the list moves with the arrow keys, and F
      // stars the focused row on the Projects page.
      tabIndex={-1}
      aria-label={
        favorite ? `Remove ${name} from favorites` : `Add ${name} to favorites`
      }
      className={cn(
        "-ml-1 flex size-5 shrink-0 items-center justify-center rounded-[var(--radius-sm)]",
        favorite
          ? "text-[var(--warning)]"
          : "text-[var(--text-tertiary)] opacity-0 group-hover/command-item:opacity-100 group-data-selected/command-item:opacity-100 hover:text-[var(--text)]",
      )}
      onPointerDown={stopRowEvent}
      onClick={(event) => {
        stopRowEvent(event);
        onToggle(!favorite);
      }}
    >
      <Icon className="size-4" aria-hidden="true" />
    </button>
  );
}

interface PickerTaskRowProps {
  project: LocalProject;
  task: LocalProjectTask;
  /** cmdk's value: unique in the list. */
  value: string;
  checked: boolean;
  /**
   * How the row names the project: `icon` in Favorites and Recent tasks,
   * `label` after the name in search results, where names repeat across
   * projects, and nothing in a project's own task list.
   */
  projectDisplay?: "icon" | "label";
  /** Shown before the check, such as how long ago a recent task was used. */
  trailing?: ReactNode;
  onSelect: () => void;
}

/**
 * A task on one line: the star, the name, its pinned key and "Non-billable"
 * when it is not billable. A long name is cut.
 */
export function PickerTaskRow({
  project,
  task,
  value,
  checked,
  projectDisplay,
  trailing,
  onSelect,
}: PickerTaskRowProps) {
  return (
    <CommandItem
      value={value}
      className={ROW_CLASS}
      data-checked={checked ? "true" : undefined}
      onSelect={onSelect}
    >
      <FavoriteStar
        favorite={task.favoritedAt !== undefined}
        name={task.name}
        onToggle={(favorite) =>
          setTaskFavorite(project._id, task._id, favorite)
        }
      />
      {projectDisplay === "icon" ? (
        <ProjectIcon
          icon={project.icon}
          color={project.color}
          className="size-4 shrink-0"
        />
      ) : null}
      {projectDisplay === "label" ? (
        <>
          <span className="min-w-0 truncate">{task.name}</span>
          {/* Takes what the name leaves, so a long name cuts it first. */}
          <span className="min-w-0 flex-1 truncate text-xs text-[var(--text-tertiary)]">
            {getProjectLabel(project)}
          </span>
        </>
      ) : (
        <span className="min-w-0 flex-1 truncate">{task.name}</span>
      )}
      {task.pinnedSlot ? <PinnedSlotBadge slot={task.pinnedSlot} /> : null}
      {isProjectTaskBillable(task) ? null : <Chip>Non-billable</Chip>}
      {trailing}
    </CommandItem>
  );
}

/** A project on one line: the star, its icon and label, its active task count. Choosing it opens its tasks. */
export function PickerProjectRow({
  project,
  value,
  onSelect,
}: {
  project: LocalProject;
  value: string;
  onSelect: () => void;
}) {
  const label = getProjectLabel(project);
  return (
    <CommandItem value={value} className={ROW_CLASS} onSelect={onSelect}>
      <FavoriteStar
        favorite={project.favoritedAt !== undefined}
        name={label}
        onToggle={(favorite) => setProjectFavorite(project._id, favorite)}
      />
      <ProjectIcon
        icon={project.icon}
        color={project.color}
        className="size-4 shrink-0"
      />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className="shrink-0 text-xs text-[var(--text-tertiary)]">
        {project.tasks.filter((task) => task.status === "active").length}
      </span>
      <ChevronRight className="size-4 shrink-0 text-[var(--text-tertiary)]" />
    </CommandItem>
  );
}

/** The quiet last row of a short section, such as "4 more favorites", that opens its page. */
export function PickerMoreRow({
  value,
  children,
  onSelect,
}: {
  value: string;
  children: ReactNode;
  onSelect: () => void;
}) {
  return (
    <CommandItem
      value={value}
      className={cn(ROW_CLASS, "text-xs text-[var(--text-tertiary)]")}
      onSelect={onSelect}
    >
      <span className="flex-1 pl-6">{children}</span>
      <ChevronRight className="size-4 shrink-0" />
    </CommandItem>
  );
}
