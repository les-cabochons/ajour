import { useLayoutEffect, type ReactNode, type RefObject } from "react";
import { HoverCard, HoverCardContent } from "@/components/ui/hover-card";
import type { LocalProject } from "@/domain/local-state";
import { formatLastUsed, taskUseKey } from "@/domain/projects/recent-tasks";
import { PinnedSlotBadge } from "@/features/projects/pinned-slot";
import { getProjectLabel } from "@/features/projects/project-task-picker-rows";
import { isProjectTaskBillable } from "@/features/projects/project-task-options";
import { ProjectIcon } from "@/lib/project-icons";
import { useRowHoverCard } from "@/lib/row-hover-card";
import { cn } from "@/lib/utils";

/** The rows that have a card: every task and project row of the task menu. */
const ROW_SELECTOR = "[data-picker-row]";
const readRowId = (row: HTMLElement) => row.dataset.pickerRow;

/**
 * The task menu's hover card: one card for the whole list, beside the row the
 * pointer rests on or the arrow keys highlight. `highlightRow` takes the
 * highlighted row after an arrow key.
 */
export function useTaskMenuHoverCard(list: RefObject<HTMLElement | null>) {
  // The keyboard scrolls the list to its highlight, so only the wheel closes it.
  return useRowHoverCard(list, ROW_SELECTOR, readRowId, {
    closeOnScroll: "wheel",
  });
}

/** "5m ago", or "Now". */
function describeLastUsed(usedAt: number) {
  const ago = formatLastUsed(usedAt, Date.now());
  return ago === "Now" ? ago : `${ago} ago`;
}

function CardProperty({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="flex min-w-0 items-center">{children}</dd>
    </>
  );
}

/**
 * The card's contents for the row `shown`: the full name, the project, and on
 * a task its billing, when it was last used and its pinned key. Null when the
 * row's project or task is gone.
 */
export function TaskMenuHoverCard({
  shown,
  projects,
  lastUsed,
  dismiss,
  rowGone,
}: {
  shown: { id: string; element: HTMLElement } | null;
  projects: readonly LocalProject[];
  /** From `getTaskLastUsedTimes`. */
  lastUsed: ReadonlyMap<string, number>;
  dismiss: () => void;
  rowGone: (id: string) => void;
}) {
  const projectId = shown?.element.dataset.projectId;
  const taskId = shown?.element.dataset.taskId;
  const project = projects.find((candidate) => candidate._id === projectId);
  const task = taskId
    ? project?.tasks.find((candidate) => candidate._id === taskId)
    : undefined;
  const isGone = !shown?.element.isConnected || !project || (taskId && !task);
  // Search and the star change the rows under the card. React removes the old
  // row in the commit, after this renders, so look again after it.
  useLayoutEffect(() => {
    if (shown && isGone) rowGone(shown.id);
  });
  if (!shown || isGone || !project) return null;

  const usedAt = task
    ? lastUsed.get(taskUseKey(project._id, task._id))
    : undefined;
  const isBillable = task ? isProjectTaskBillable(task) : true;

  return (
    <HoverCard
      open
      onOpenChange={(open) => {
        if (!open) dismiss();
      }}
    >
      <HoverCardContent
        anchor={shown.element}
        side="right"
        align="start"
        sideOffset={12}
        // A look, not a visit: the search keeps focus, and nothing in the
        // card takes a press, so the pointer goes through it.
        initialFocus={false}
        finalFocus={false}
        aria-label={task ? task.name : getProjectLabel(project)}
        className="pointer-events-none w-72 gap-0 p-0"
      >
        <div className="flex flex-col gap-1.5 p-3">
          <div className="flex h-5 min-w-0 items-center gap-2 text-xs text-muted-foreground">
            <ProjectIcon
              icon={project.icon}
              color={project.color}
              className="size-4 shrink-0"
            />
            <span className="min-w-0 truncate">
              {task ? getProjectLabel(project) : "Project"}
            </span>
          </div>
          <p className="text-sm leading-5 font-medium [overflow-wrap:anywhere] text-foreground">
            {task ? task.name : getProjectLabel(project)}
          </p>
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 border-t border-border px-3 py-2 text-xs">
          {task ? (
            <>
              <CardProperty label="Billing">
                <span className={cn(!isBillable && "text-[var(--warning)]")}>
                  {isBillable ? "Billable" : "Non-billable"}
                </span>
              </CardProperty>
              {usedAt !== undefined ? (
                <CardProperty label="Last used">
                  {describeLastUsed(usedAt)}
                </CardProperty>
              ) : null}
              {task.pinnedSlot ? (
                <CardProperty label="Pinned key">
                  <PinnedSlotBadge slot={task.pinnedSlot} />
                </CardProperty>
              ) : null}
            </>
          ) : (
            <CardProperty label="Active tasks">
              {project.tasks.filter((item) => item.status === "active").length}
            </CardProperty>
          )}
        </dl>
      </HoverCardContent>
    </HoverCard>
  );
}
