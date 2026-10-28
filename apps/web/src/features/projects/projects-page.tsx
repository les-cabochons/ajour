import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  RiAddLine as Plus,
  RiDownloadLine as Download,
  RiFileTransferLine as FileTransfer,
  RiMoreLine as More,
} from "@remixicon/react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { MessagePanel } from "@/components/app-surface";
import { PageHeader } from "@/components/page-header";
import { SectionHeading } from "@/components/section-heading";
import {
  ObjectActionsButton,
  ObjectContextMenu,
} from "@/components/object-actions-menu";
import { SidePanel } from "@/components/side-panel";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { Figure, FigureRow, Value } from "@/components/ui/value";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatClockDuration } from "@/domain/time/duration";
import {
  getProjectActions,
  getTaskActions,
  type ProjectActionId,
  type TaskActionId,
} from "@/domain/actions/object-actions";
import {
  formatProjectTaskConsumedBadge,
  getProjectTaskConsumedTone,
  getProjectTaskTrackedWithAdjustmentMs,
  normalizeProjectTaskBudgetMs,
  type ProjectTaskConsumedTone,
} from "@/domain/projects/task-budget";
import { getProjectTaskBillableValueLabel } from "@/features/projects/project-task-options";
import {
  getLocalProjectDisplayName,
  type LocalProject,
  type LocalProjectTask,
  type LocalTimesheetEntry,
  type PinnedTaskSlot,
} from "@/domain/local-state";
import {
  PinnedSlotBadge,
  PinnedSlotDialog,
} from "@/features/projects/pinned-slot";
import { ProjectFormDialog } from "@/features/projects/project-form-dialog";
import {
  ProjectPropertiesCard,
  ProjectTitle,
} from "@/features/projects/project-properties";
import { SharedProjectMark } from "@/features/projects/project-team-ui";
import type { ProjectFormValues } from "@/features/projects/project-form";
import {
  commitProjectTaskDraft,
  createProjectTaskEditorFields,
  evaluateProjectTaskEditor,
  type ProjectTaskEditorFields,
  type ProjectTaskEditorState,
  type ProjectTaskValues,
} from "@/features/projects/project-task-editor";
import { ProjectTaskEditorForm } from "@/features/projects/project-task-editor-form";
import {
  TaskMappingHints,
  useTaskPropertyPlugins,
} from "@/features/projects/task-property-fields";
import type { TaskPropertyPlugin } from "@/domain/projects/plugin-properties";
import { offerUndo } from "@/features/feedback/undo-toast";
import { useActionRequest } from "@/lib/action-request";
import { FOCUS_ATTRIBUTES } from "@/lib/focused-object";
import {
  handleItemKeyDown,
  PROJECT_ACTION_KEYS,
  TASK_ACTION_KEYS,
} from "@/lib/item-keys";
import { useCurrentTeam } from "@/lib/session";
import { useLocalState } from "@/lib/local-hooks";
import {
  setProjectFavorite,
  setTaskFavorite,
} from "@/features/projects/favorites";
import { localStore } from "@/lib/local-store";
import { withEventAttribution } from "@/lib/wide-events";
import {
  createSharedTableDragPointerSession,
  getSharedTableDropOrder,
  getSharedTableDragOverlayTransform,
  getSharedTableDragRowShift,
  getSharedTableDragTargetIndex,
  getSharedTableStepOrder,
  setSharedTableDragDocumentState,
  SHARED_TABLE_DRAG_CLICK_SUPPRESSION_MS,
  type SharedTableDragPointerSession,
} from "@/lib/table-drag";
import { ProjectIcon } from "@/lib/project-icons";
import { openNewEntryEditor } from "@/features/time/new-entry-request";
import { useIsNarrowView } from "@/lib/use-narrow-view";
import { addDaysIsoDate, cn, startOfWeekIsoDate } from "@/lib/utils";

type ProjectMetrics = {
  durationMs: number;
  entryCount: number;
};

type TaskMetricsByProject = Map<string, Map<string, ProjectMetrics>>;

type ProjectModalState =
  { mode: "create" } | { mode: "edit"; projectId: string };

/** The task open in the editor and its unsaved draft. */
type TaskEditorSession = {
  projectId: string;
  /** The saved task being edited. Absent for a new task. */
  taskId?: string;
  fields: ProjectTaskEditorFields;
  /**
   * The task's slot when the panel opened. Save writes the slot only if the
   * draft changed it, so a slot moved from a menu meanwhile is not undone.
   */
  openedPinnedSlot: PinnedTaskSlot | undefined;
  /** Set once Save or a switch was blocked, so a missing name shows its error. */
  showErrors: boolean;
};

/** The task whose Assign shortcut… picker is open, from its row menu or the palette. */
type ShortcutRequest = { projectId: string; task: LocalProjectTask };

type ProjectTaskFilter = "active" | "archived";

const projectTaskToneClassName: Record<ProjectTaskConsumedTone, string> = {
  default: "",
  success: "is-success",
  warning: "is-warning",
  danger: "is-danger",
  "danger-strong": "is-danger-strong",
};

function getProjectDisplayName(project: LocalProject) {
  return getLocalProjectDisplayName(project);
}

type TaskDragState = {
  taskId: string;
  pointerId: number;
  originIndex: number;
  targetIndex: number;
  pointerX: number;
  pointerY: number;
  offsetX: number;
  offsetY: number;
  originLeft: number;
  minTop: number;
  width: number;
  height: number;
};

type ProjectDragState = {
  projectId: string;
  pointerId: number;
  originIndex: number;
  targetIndex: number;
  pointerX: number;
  pointerY: number;
  offsetX: number;
  offsetY: number;
  originLeft: number;
  minTop: number;
  width: number;
  height: number;
};

/** A project's budget: the sum of its active tasks' budgets, and what they consumed. */
function getProjectBudget(
  project: LocalProject,
  taskMetrics: Map<string, ProjectMetrics>,
) {
  let budgetMs = 0;
  let consumedMs = 0;
  for (const task of project.tasks) {
    if (task.status !== "active") continue;
    const taskBudget = normalizeProjectTaskBudgetMs(task.budgetMs);
    if (!taskBudget) continue;
    budgetMs += taskBudget;
    consumedMs += Math.max(
      0,
      getProjectTaskTrackedWithAdjustmentMs({
        budgetMs: task.budgetMs,
        trackedMs: taskMetrics.get(task._id)?.durationMs ?? 0,
        adjustmentMs: task.adjustmentMs,
      }),
    );
  }
  return { budgetMs, consumedMs };
}

/** The bar's tone for a consumed share of a budget. */
function budgetTone(ratio: number) {
  if (ratio > 1) return "is-danger";
  if (ratio >= 0.8) return "is-warning";
  return "";
}

function BudgetBar({
  ratio,
  className,
}: {
  ratio: number;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn("project-progress", budgetTone(ratio), className)}
    >
      <i style={{ width: `${Math.min(100, Math.round(ratio * 100))}%` }} />
    </span>
  );
}

/** "-1:30" for a negative adjustment that outweighs the tracked time. */
function formatSignedClock(durationMs: number) {
  return durationMs < 0
    ? `-${formatClockDuration(-durationMs)}`
    : formatClockDuration(durationMs);
}

function formatEntryDay(localDate: string) {
  return new Date(`${localDate}T12:00:00`).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function taskSummary(project: LocalProject) {
  const active = project.tasks.filter(
    (task) => task.status === "active",
  ).length;
  const archived = project.tasks.length - active;

  return { active, archived };
}

function isTaskDragBlockedTarget(target: EventTarget | null) {
  return target instanceof HTMLElement
    ? Boolean(
        target.closest(
          "button, input, textarea, select, option, a, [data-no-task-drag='true']",
        ),
      )
    : false;
}

function isProjectDragBlockedTarget(target: EventTarget | null) {
  return target instanceof HTMLElement
    ? Boolean(
        target.closest(
          "button, input, textarea, select, option, [data-no-project-drag='true']",
        ),
      )
    : false;
}

/* ── Project detail content ───────────────────────────────────────── */

/**
 * The Projects page: a row per project with its code, task count, this week's
 * hours and budget. Active projects reorder by dragging; the archive is the
 * same list under the Archived filter.
 */
function ProjectsList({
  projects,
  archived,
  weekMsByProject,
  taskMetricsByProject,
  dragState,
  pressedProjectId,
  canReorder,
  rowRefs,
  onPointerDown,
  onOpen,
  onProjectAction,
  onReorder,
  onNewProject,
}: {
  projects: LocalProject[];
  archived: boolean;
  weekMsByProject: Map<string, number>;
  taskMetricsByProject: TaskMetricsByProject;
  dragState: ProjectDragState | null;
  pressedProjectId: string | null;
  canReorder: boolean;
  rowRefs: React.MutableRefObject<Map<string, HTMLTableRowElement>>;
  onPointerDown: (
    projectId: string,
    event: React.PointerEvent<HTMLTableRowElement>,
  ) => void;
  onOpen: (projectId: string) => void;
  onProjectAction: (project: LocalProject, actionId: ProjectActionId) => void;
  onReorder: (projectId: string, step: -1 | 1) => void;
  onNewProject: () => void;
}) {
  return (
    <div className="project-list">
      <div className="project-list-filterbar">
        <div
          className="toggle-group project-task-filter-tabs"
          role="tablist"
          aria-label="Filter projects"
        >
          <Link
            to="/projects"
            role="tab"
            aria-selected={!archived}
            className={cn("toggle-item", !archived && "toggle-item-active")}
          >
            Active
          </Link>
          <Link
            to="/projects/archive"
            role="tab"
            aria-selected={archived}
            className={cn("toggle-item", archived && "toggle-item-active")}
          >
            Archived
          </Link>
        </div>
        {/* Wide windows keep import and export as a settings page. */}
        <Link
          to="/settings/projects"
          className="project-list-link desktop:hidden"
        >
          <FileTransfer data-icon="inline-start" />
          Import and export
        </Link>
      </div>
      {projects.length === 0 ? (
        <Empty align="start" className="project-list-empty">
          <EmptyHeader>
            <EmptyTitle>
              {archived ? "No archived projects" : "No projects yet"}
            </EmptyTitle>
            <EmptyDescription>
              {archived
                ? "Archived projects will appear here."
                : "Create your first project."}
            </EmptyDescription>
          </EmptyHeader>
          {archived ? null : (
            <EmptyContent>
              <Button type="button" variant="outline" onClick={onNewProject}>
                <Plus data-icon="inline-start" />
                New project
              </Button>
            </EmptyContent>
          )}
        </Empty>
      ) : (
        <table
          className={cn(
            "project-list-table",
            dragState && "is-project-dragging",
          )}
        >
          <thead>
            <tr className="project-list-head">
              <th scope="col">Project</th>
              <th scope="col" className="project-list-col-tasks">
                Tasks
              </th>
              <th scope="col" className="project-list-col-week">
                This week
              </th>
              <th scope="col" className="project-list-col-budget">
                Budget
              </th>
              <th scope="col" className="project-list-col-actions">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {projects.map((project, index) => {
              const actions = getProjectActions(project);
              const onAction = (actionId: ProjectActionId) =>
                onProjectAction(project, actionId);
              const name = getProjectDisplayName(project);
              const taskMetrics =
                taskMetricsByProject.get(project._id) ?? new Map();
              const budget = getProjectBudget(project, taskMetrics);
              const activeTasks = project.tasks.filter(
                (task) => task.status === "active",
              ).length;
              const isDragged = dragState?.projectId === project._id;
              const rowShift =
                !archived && dragState
                  ? getSharedTableDragRowShift({
                      itemIndex: index,
                      originIndex: dragState.originIndex,
                      targetIndex: dragState.targetIndex,
                      rowHeight: dragState.height,
                    })
                  : 0;

              return (
                <ObjectContextMenu
                  key={project._id}
                  actions={actions}
                  keys={PROJECT_ACTION_KEYS}
                  onAction={onAction}
                  render={
                    <tr
                      ref={(node) => {
                        if (node) {
                          rowRefs.current.set(project._id, node);
                          return;
                        }
                        rowRefs.current.delete(project._id);
                      }}
                      className={cn(
                        "project-task-row project-list-row",
                        !archived && canReorder && "is-reorderable",
                        pressedProjectId === project._id && "is-pressing",
                        rowShift !== 0 && "is-shifting",
                        isDragged && "is-drag-source",
                      )}
                      style={
                        rowShift !== 0
                          ? { transform: `translate3d(0, ${rowShift}px, 0)` }
                          : undefined
                      }
                      aria-grabbed={!archived ? isDragged : undefined}
                      {...{ [FOCUS_ATTRIBUTES.project]: project._id }}
                      onClick={(event) => {
                        if (
                          event.target instanceof Element &&
                          event.target.closest("a,button,[role=menu]")
                        )
                          return;
                        onOpen(project._id);
                      }}
                      onPointerDown={
                        !archived
                          ? (event) => onPointerDown(project._id, event)
                          : undefined
                      }
                    />
                  }
                >
                  <td className="project-task-name-cell">
                    <ProjectIcon
                      icon={project.icon}
                      color={project.color}
                      className="ajour-sidebar-icon"
                    />
                    <Link
                      to="/projects/$projectId"
                      params={{ projectId: project._id }}
                      className="project-task-name project-list-name"
                      draggable={false}
                      // Alt+Up and Alt+Down reorder, like a drag, and F
                      // stars the project. No other item key acts on projects.
                      onKeyDown={(event) =>
                        handleItemKeyDown(event, {
                          actions,
                          keys: PROJECT_ACTION_KEYS,
                          onAction,
                          onReorder:
                            !archived && canReorder
                              ? (step) => onReorder(project._id, step)
                              : undefined,
                        })
                      }
                    >
                      {name}
                    </Link>
                    {project.code ? <Chip>{project.code}</Chip> : null}
                    {project.team ? <SharedProjectMark /> : null}
                  </td>
                  <td className="project-list-col-tasks">
                    <Value tone="muted">{activeTasks}</Value>
                  </td>
                  <td className="project-list-col-week">
                    <Value>
                      {formatClockDuration(
                        weekMsByProject.get(project._id) ?? 0,
                      )}
                    </Value>
                  </td>
                  <td className="project-list-col-budget">
                    {budget.budgetMs > 0 ? (
                      <span className="project-budget">
                        <BudgetBar
                          ratio={budget.consumedMs / budget.budgetMs}
                        />
                        <Value tone="muted">
                          {Math.round(
                            (budget.consumedMs / budget.budgetMs) * 100,
                          )}
                          %
                        </Value>
                      </span>
                    ) : (
                      <span className="text-muted-foreground">No budget</span>
                    )}
                  </td>
                  <td className="project-list-col-actions">
                    <span className="project-task-actions">
                      <ObjectActionsButton
                        actions={actions}
                        keys={PROJECT_ACTION_KEYS}
                        onAction={onAction}
                        label={`Actions for ${name}`}
                      />
                    </span>
                  </td>
                </ObjectContextMenu>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

function ProjectDetail({
  project,
  metrics,
  taskMetrics,
  editingTaskId,
  onProjectAction,
  onOpenTask,
  onNewTask,
  onLeave,
  onAssignShortcut,
  entries,
  weekMs,
  taskPropertyPlugins,
}: {
  project: LocalProject;
  metrics: ProjectMetrics;
  taskMetrics: Map<string, ProjectMetrics>;
  /** The project's time entries, newest first. */
  entries: LocalTimesheetEntry[];
  /** Time logged on the project this week. */
  weekMs: number;
  /** The task open in the side panel, highlighted in the list. */
  editingTaskId?: string;
  onProjectAction: (project: LocalProject, actionId: ProjectActionId) => void;
  /** Opens a saved task in the task editor. */
  onOpenTask: (task: LocalProjectTask) => void;
  /** Opens a blank task in the task editor. */
  onNewTask: () => void;
  /** Guards the back link and the entry links out of the project. */
  onLeave: (event: React.MouseEvent<HTMLAnchorElement>) => void;
  /** Opens the slot picker for a task, like the palette's Assign shortcut…. */
  onAssignShortcut: (task: LocalProjectTask) => void;
  /** Active plugins that add task properties, for the "→ 07 Run" hints. */
  taskPropertyPlugins: TaskPropertyPlugin[];
}) {
  const isNarrowView = useIsNarrowView();
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const taskRowRefs = useRef(new Map<string, HTMLTableRowElement>());
  const taskPointerSessionRef = useRef<SharedTableDragPointerSession | null>(
    null,
  );
  const taskDragStateRef = useRef<TaskDragState | null>(null);
  const suppressTaskClickUntilRef = useRef(0);
  const [isImporting, setIsImporting] = useState(false);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [pressedTaskId, setPressedTaskId] = useState<string | null>(null);
  const [taskFilter, setTaskFilter] = useState<ProjectTaskFilter>("active");
  const [taskDragState, setTaskDragState] = useState<TaskDragState | null>(
    null,
  );
  const isArchived = project.status === "archived";
  const projectActions = getProjectActions(project);

  const summary = taskSummary(project);
  const activeTasks = project.tasks.filter((task) => task.status === "active");
  const activeTaskIds = useMemo(
    () => activeTasks.map((task) => task._id),
    [activeTasks],
  );
  const archivedTasks = project.tasks.filter(
    (task) => task.status === "archived",
  );
  const taskFilters: {
    value: ProjectTaskFilter;
    label: string;
    count: number;
  }[] = [
    { value: "active", label: "Active", count: summary.active },
    { value: "archived", label: "Archived", count: summary.archived },
  ];
  const isArchivedTaskFilter = taskFilter === "archived";
  const draggedTask = useMemo(
    () =>
      taskDragState
        ? (activeTasks.find((task) => task._id === taskDragState.taskId) ??
          null)
        : null,
    [activeTasks, taskDragState],
  );
  const canReorderTasks =
    !isArchived && taskFilter === "active" && activeTasks.length > 1;

  useEffect(() => {
    setTaskFilter("active");
    setImportMessage(null);
    setImportError(null);
    if (importInputRef.current) {
      importInputRef.current.value = "";
    }
  }, [project._id, project.status]);

  useEffect(() => {
    taskDragStateRef.current = taskDragState;
  }, [taskDragState]);

  const clearTaskPointerSession = useCallback(() => {
    const session = taskPointerSessionRef.current;
    if (!session) {
      return;
    }

    session.dispose();
    taskPointerSessionRef.current = null;
  }, []);

  const resetTaskDragVisuals = useCallback(() => {
    setSharedTableDragDocumentState(false, "project-task-drag-active");
  }, []);

  const finishTaskDrag = useCallback(
    (shouldCommit: boolean) => {
      const currentDrag = taskDragStateRef.current;
      if (!currentDrag) {
        setPressedTaskId(null);
        resetTaskDragVisuals();
        return;
      }

      if (shouldCommit && currentDrag.originIndex !== currentDrag.targetIndex) {
        localStore.reorderProjectTask(
          project._id,
          currentDrag.taskId,
          currentDrag.targetIndex,
        );
      }

      suppressTaskClickUntilRef.current =
        performance.now() + SHARED_TABLE_DRAG_CLICK_SUPPRESSION_MS;
      taskDragStateRef.current = null;
      setTaskDragState(null);
      setPressedTaskId(null);
      resetTaskDragVisuals();
    },
    [project._id, resetTaskDragVisuals],
  );

  useEffect(() => {
    return () => {
      clearTaskPointerSession();
      taskDragStateRef.current = null;
      resetTaskDragVisuals();
    };
  }, [clearTaskPointerSession, resetTaskDragVisuals]);

  useEffect(() => {
    clearTaskPointerSession();
    taskDragStateRef.current = null;
    setPressedTaskId(null);
    setTaskDragState(null);
    resetTaskDragVisuals();
  }, [
    project._id,
    project.status,
    clearTaskPointerSession,
    resetTaskDragVisuals,
  ]);

  const handleTaskImport = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    if (isArchived) {
      event.target.value = "";
      return;
    }

    const file = event.target.files?.[0];
    setImportMessage(null);
    setImportError(null);

    if (!file) return;

    setIsImporting(true);
    try {
      const { importTasksFromWorkbook } =
        await import("@/features/projects/project-task-import");
      setImportMessage(
        await importTasksFromWorkbook(project._id, await file.arrayBuffer()),
      );
    } catch (error) {
      setImportError(
        error instanceof Error
          ? error.message
          : "Unable to import tasks from this Excel file.",
      );
    } finally {
      setIsImporting(false);
      event.target.value = "";
    }
  };

  function openImportPicker() {
    importInputRef.current?.click();
  }

  function handleTaskClick(task: LocalProjectTask) {
    if (performance.now() < suppressTaskClickUntilRef.current) return;
    onOpenTask(task);
  }

  /** Move up and Move down among the active tasks, persisted like a drag. */
  function reorderTask(taskId: string, step: -1 | 1) {
    if (!canReorderTasks) return;
    const next = getSharedTableStepOrder(
      activeTasks.map((task) => task._id),
      taskId,
      step,
    );
    if (next) {
      localStore.reorderProjectTask(project._id, taskId, next.toIndex);
    }
  }

  /** Runs the task action set from the row's right-click menu and "…" button. */
  function runTaskAction(task: LocalProjectTask, actionId: TaskActionId) {
    return withEventAttribution({ surface: "button" }, () => {
      switch (actionId) {
        case "start-entry":
          localStore.startTimer({
            projectId: project._id,
            taskId: task._id,
            accumulatedDurationMs: 0,
          });
          return;
        case "new-entry":
          openNewEntryEditor(
            { kind: "task", projectId: project._id, taskId: task._id },
            { projectId: project._id, taskId: task._id },
          );
          return;
        case "edit":
          onOpenTask(task);
          return;
        case "assign-shortcut":
          onAssignShortcut(task);
          return;
        case "favorite":
        case "unfavorite":
          setTaskFavorite(project._id, task._id, actionId === "favorite");
          return;
        case "archive":
          offerUndo(localStore.archiveProjectTask(project._id, task._id), {
            title: "Task archived",
            subject: "project",
          });
          return;
        case "restore":
          localStore.unarchiveProjectTask(project._id, task._id);
          return;
      }
    });
  }

  function handleTaskPointerDown(
    taskId: string,
    event: React.PointerEvent<HTMLTableRowElement>,
  ) {
    // Row menus render in portals, but their React events still bubble to the row.
    // Capturing the pointer for them would send the menu item's click to the row.
    if (
      !canReorderTasks ||
      event.button !== 0 ||
      !(event.target instanceof Node) ||
      !event.currentTarget.contains(event.target) ||
      isTaskDragBlockedTarget(event.target)
    ) {
      return;
    }

    const sourceIndex = activeTaskIds.indexOf(taskId);
    if (sourceIndex === -1) {
      return;
    }

    const captureTarget = event.currentTarget;
    captureTarget.setPointerCapture(event.pointerId);
    clearTaskPointerSession();
    setPressedTaskId(taskId);

    const { clientX, clientY, pointerId, pointerType } = event;
    const startDrag = (pointerX: number, pointerY: number) => {
      const row = taskRowRefs.current.get(taskId);
      if (!row) {
        setPressedTaskId(null);
        return;
      }

      const rect = row.getBoundingClientRect();
      const firstRowRect = taskRowRefs.current
        .get(activeTaskIds[0] ?? taskId)
        ?.getBoundingClientRect();
      setSharedTableDragDocumentState(true, "project-task-drag-active");
      suppressTaskClickUntilRef.current =
        performance.now() + SHARED_TABLE_DRAG_CLICK_SUPPRESSION_MS;
      setPressedTaskId(null);
      const nextDragState: TaskDragState = {
        taskId,
        pointerId,
        originIndex: sourceIndex,
        targetIndex: sourceIndex,
        pointerX,
        pointerY,
        offsetX: pointerX - rect.left,
        offsetY: pointerY - rect.top,
        originLeft: rect.left,
        minTop: firstRowRect?.top ?? rect.top,
        width: rect.width,
        height: rect.height,
      };
      taskDragStateRef.current = nextDragState;
      setTaskDragState(nextDragState);
    };

    taskPointerSessionRef.current = createSharedTableDragPointerSession({
      captureTarget,
      pointerId,
      pointerType,
      originX: clientX,
      originY: clientY,
      isDragging: () => taskDragStateRef.current?.pointerId === pointerId,
      onStart: (pointer) => {
        startDrag(pointer.clientX, pointer.clientY);
      },
      onMove: (pointer) => {
        const current = taskDragStateRef.current;
        if (!current) {
          return;
        }

        const nextDragState: TaskDragState = {
          ...current,
          pointerX: pointer.clientX,
          pointerY: pointer.clientY,
          targetIndex: getSharedTableDragTargetIndex(
            activeTaskIds,
            current.taskId,
            pointer.clientY,
            taskRowRefs.current,
          ),
        };
        taskDragStateRef.current = nextDragState;
        setTaskDragState(nextDragState);
      },
      onEnd: (shouldCommit) => {
        taskPointerSessionRef.current = null;
        withEventAttribution({ surface: "drag" }, () =>
          finishTaskDrag(shouldCommit),
        );
      },
      onPressEnd: () => {
        taskPointerSessionRef.current = null;
        setPressedTaskId(null);
      },
    });
  }

  function renderConsumedBadge(task: LocalProjectTask) {
    const options = {
      budgetMs: task.budgetMs,
      trackedMs: taskMetrics.get(task._id)?.durationMs ?? 0,
      adjustmentMs: task.adjustmentMs,
    };
    const budgetMs = normalizeProjectTaskBudgetMs(task.budgetMs);
    const consumedMs = getProjectTaskTrackedWithAdjustmentMs(options);
    const tone = projectTaskToneClassName[getProjectTaskConsumedTone(options)];

    if (!budgetMs) {
      return (
        <Value className={cn("project-task-consumed", tone)}>
          {formatSignedClock(consumedMs)}
        </Value>
      );
    }
    return (
      <span className="project-budget">
        <BudgetBar ratio={Math.max(0, consumedMs) / budgetMs} />
        <Value className={cn("project-task-consumed", tone)}>
          {formatSignedClock(consumedMs)} / {formatClockDuration(budgetMs)}
        </Value>
      </span>
    );
  }

  const visibleTasks = isArchivedTaskFilter ? archivedTasks : activeTasks;

  function renderTaskRow(task: LocalProjectTask, index: number) {
    const taskActions = getTaskActions(project, task);
    // Archived tasks list only: no editor, no drag, no reorder.
    const isActiveRow = !isArchivedTaskFilter;
    const isDraggedTask = isActiveRow && taskDragState?.taskId === task._id;
    const rowShift =
      isActiveRow && taskDragState
        ? getSharedTableDragRowShift({
            itemIndex: index,
            originIndex: taskDragState.originIndex,
            targetIndex: taskDragState.targetIndex,
            rowHeight: taskDragState.height,
          })
        : 0;
    const runAction = (actionId: TaskActionId) => runTaskAction(task, actionId);

    return (
      <ObjectContextMenu
        key={task._id}
        actions={taskActions}
        keys={TASK_ACTION_KEYS}
        onAction={runAction}
        render={
          <tr
            ref={
              isActiveRow
                ? (node) => {
                    if (node) {
                      taskRowRefs.current.set(task._id, node);
                      return;
                    }
                    taskRowRefs.current.delete(task._id);
                  }
                : undefined
            }
            className={cn(
              "project-task-row",
              isActiveRow && canReorderTasks && "is-reorderable",
              pressedTaskId === task._id && "is-pressing",
              rowShift !== 0 && "is-shifting",
              isDraggedTask && "is-drag-source",
              editingTaskId === task._id && "is-editing",
            )}
            style={
              rowShift !== 0
                ? { transform: `translate3d(0, ${rowShift}px, 0)` }
                : undefined
            }
            aria-grabbed={isActiveRow ? isDraggedTask : undefined}
            {...{ [FOCUS_ATTRIBUTES.task]: task._id }}
            data-focus-column="0"
            tabIndex={0}
            onKeyDown={(event) =>
              handleItemKeyDown(event, {
                actions: taskActions,
                keys: TASK_ACTION_KEYS,
                onAction: runAction,
                onReorder:
                  isActiveRow && canReorderTasks
                    ? (step) => reorderTask(task._id, step)
                    : undefined,
              })
            }
            onClick={isActiveRow ? () => handleTaskClick(task) : undefined}
            onPointerDown={
              isActiveRow
                ? (event) => handleTaskPointerDown(task._id, event)
                : undefined
            }
          />
        }
      >
        <td className="project-task-name-cell">
          <span className="project-task-name">{task.name}</span>
          <TaskMappingHints task={task} plugins={taskPropertyPlugins} />
          {task.pinnedSlot ? <PinnedSlotBadge slot={task.pinnedSlot} /> : null}
          <Chip>{getProjectTaskBillableValueLabel(task)}</Chip>
          {task.status === "archived" ? <Chip>Archived</Chip> : null}
        </td>
        <td className="project-task-trailing">
          <span className="project-task-trailing-content">
            <span className="project-task-actions">
              <ObjectActionsButton
                actions={taskActions}
                keys={TASK_ACTION_KEYS}
                onAction={runAction}
                label={`Actions for ${task.name}`}
              />
            </span>
            {renderConsumedBadge(task)}
          </span>
        </td>
      </ObjectContextMenu>
    );
  }

  const budget = getProjectBudget(project, taskMetrics);
  const [tab, setTab] = useState<"tasks" | "entries">("tasks");
  const entryDays = useMemo(() => {
    const days: { localDate: string; entries: LocalTimesheetEntry[] }[] = [];
    for (const entry of entries) {
      const last = days.at(-1);
      if (last && last.localDate === entry.localDate) last.entries.push(entry);
      else days.push({ localDate: entry.localDate, entries: [entry] });
    }
    return days;
  }, [entries]);

  return (
    <div
      className="project-detail"
      {...{ [FOCUS_ATTRIBUTES.project]: project._id }}
    >
      <input
        ref={importInputRef}
        type="file"
        accept=".xlsx,.xls,.xlsm"
        className="hidden"
        onChange={(event) => {
          void handleTaskImport(event);
        }}
      />

      <PageHeader
        backLink={
          isNarrowView
            ? undefined
            : { label: "Projects", to: "/projects", onClick: onLeave }
        }
      />

      <ObjectContextMenu
        actions={projectActions}
        keys={PROJECT_ACTION_KEYS}
        onAction={(actionId) => onProjectAction(project, actionId)}
        render={<header className="project-detail-header" />}
      >
        <ProjectIcon
          icon={project.icon}
          color={project.color}
          className="project-header-icon"
        />
        <ProjectTitle project={project} readOnly={isArchived} />
        {project.code ? <Chip>{project.code}</Chip> : null}
        {isArchived ? <Chip>Archived</Chip> : null}
      </ObjectContextMenu>

      <FigureRow>
        <Figure label="This week">{formatClockDuration(weekMs)}</Figure>
        <Figure label="All time">
          {formatClockDuration(metrics.durationMs)}
        </Figure>
        {budget.budgetMs > 0 ? (
          <>
            <Figure label="Budget">
              {formatClockDuration(budget.budgetMs)}
            </Figure>
            <Figure label="Used">
              <span
                className={cn(
                  "project-task-consumed",
                  budgetTone(budget.consumedMs / budget.budgetMs),
                )}
              >
                {formatClockDuration(budget.consumedMs)}
              </span>
            </Figure>
            <Figure label="Remaining">
              {formatClockDuration(
                Math.max(0, budget.budgetMs - budget.consumedMs),
              )}
            </Figure>
          </>
        ) : (
          <Figure label="Active tasks">{summary.active}</Figure>
        )}
      </FigureRow>
      {budget.budgetMs > 0 ? (
        <BudgetBar
          ratio={budget.consumedMs / budget.budgetMs}
          className="project-progress-wide"
        />
      ) : null}

      {isArchived ? (
        <MessagePanel>
          This project is archived. You can consult it here, but project and
          task changes are disabled until you restore it.
        </MessagePanel>
      ) : null}
      {isImporting ? <MessagePanel>Importing tasks…</MessagePanel> : null}
      {importMessage ? <MessagePanel>{importMessage}</MessagePanel> : null}
      {importError ? (
        <MessagePanel tone="warning">{importError}</MessagePanel>
      ) : null}

      <div className="project-detail-columns">
        <Tabs
          value={tab}
          onValueChange={(value) => setTab(value as "tasks" | "entries")}
          className="project-tabs"
        >
          <TabsList
            variant="line"
            className="h-auto w-full justify-start gap-4 rounded-none border-b border-border bg-transparent p-0"
          >
            <TabsTrigger value="tasks" className="flex-none px-0">
              Tasks <Value tone="muted">{project.tasks.length}</Value>
            </TabsTrigger>
            <TabsTrigger value="entries" className="flex-none px-0">
              Time entries <Value tone="muted">{entries.length}</Value>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="tasks" className="project-tab-panel">
            <div className="project-task-toolbar">
              <SectionHeading>Tasks</SectionHeading>
              <div
                className="toggle-group project-task-filter-tabs"
                role="tablist"
                aria-label="Filter project tasks"
              >
                {taskFilters.map((filter) => {
                  const isActive = taskFilter === filter.value;
                  return (
                    <button
                      key={filter.value}
                      type="button"
                      role="tab"
                      aria-selected={isActive}
                      className={cn(
                        "toggle-item",
                        isActive && "toggle-item-active",
                      )}
                      onClick={() => setTaskFilter(filter.value)}
                    >
                      <span>{filter.label}</span>
                      <span className="project-task-filter-count">
                        {filter.count}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {visibleTasks.length === 0 ? (
              <Empty align="start" className="project-task-empty">
                <EmptyHeader>
                  <EmptyTitle>
                    {isArchivedTaskFilter
                      ? "No archived tasks"
                      : "No active tasks"}
                  </EmptyTitle>
                  <EmptyDescription>
                    {isArchivedTaskFilter
                      ? "Archived tasks will appear here."
                      : isArchived
                        ? "This archived project has no active tasks."
                        : "Create a task, or import tasks from Excel."}
                  </EmptyDescription>
                </EmptyHeader>
                {!isArchived && !isArchivedTaskFilter ? (
                  <EmptyContent>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={isImporting}
                      onClick={openImportPicker}
                    >
                      <Download data-icon="inline-start" />
                      Import tasks…
                    </Button>
                  </EmptyContent>
                ) : null}
              </Empty>
            ) : (
              <table
                className={cn(
                  "project-task-table",
                  taskDragState && "is-task-dragging",
                )}
              >
                <tbody data-focus-scope>
                  {visibleTasks.map(renderTaskRow)}
                </tbody>
              </table>
            )}
            {!isArchived && !isArchivedTaskFilter ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="mt-1 w-fit text-muted-foreground"
                onClick={onNewTask}
              >
                <Plus data-icon="inline-start" />
                New task
              </Button>
            ) : null}
          </TabsContent>

          <TabsContent value="entries" className="project-tab-panel">
            {entryDays.length === 0 ? (
              <Empty align="start" className="project-task-empty">
                <EmptyHeader>
                  <EmptyTitle>No time logged yet</EmptyTitle>
                  <EmptyDescription>
                    Entries on this project's tasks show here by day.
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              entryDays.map((day) => (
                <div key={day.localDate}>
                  <SectionHeading
                    trailing={
                      <Value>
                        {formatClockDuration(
                          day.entries.reduce(
                            (sum, entry) => sum + entry.durationMs,
                            0,
                          ),
                        )}
                      </Value>
                    }
                  >
                    {formatEntryDay(day.localDate)}
                  </SectionHeading>
                  <div className="project-entry-rows">
                    {day.entries.map((entry) => {
                      const task = project.tasks.find(
                        (candidate) => candidate._id === entry.taskId,
                      );
                      return (
                        <Link
                          key={entry._id}
                          to="/time/$date"
                          params={{ date: entry.localDate }}
                          className="project-entry-row"
                          onClick={onLeave}
                        >
                          <span className="project-entry-task">
                            {task?.name ?? "No task"}
                          </span>
                          <span className="project-entry-note">
                            {entry.note ?? ""}
                          </span>
                          <Value>{formatClockDuration(entry.durationMs)}</Value>
                        </Link>
                      );
                    })}
                  </div>
                </div>
              ))
            )}
          </TabsContent>
        </Tabs>
        <ProjectPropertiesCard
          project={project}
          isImporting={isImporting}
          onImport={openImportPicker}
          onArchive={() => onProjectAction(project, "archive")}
          onRestore={() => onProjectAction(project, "restore")}
        />
      </div>

      {draggedTask && taskDragState ? (
        <div
          className="project-task-drag-preview"
          style={{
            width: taskDragState.width,
            minHeight: taskDragState.height,
            transform: getSharedTableDragOverlayTransform(taskDragState),
          }}
        >
          <div className="project-task-name-cell">
            <span className="project-task-name">{draggedTask.name}</span>
            {draggedTask.pinnedSlot ? (
              <PinnedSlotBadge slot={draggedTask.pinnedSlot} />
            ) : null}
            <Chip>{getProjectTaskBillableValueLabel(draggedTask)}</Chip>
          </div>
          {renderConsumedBadge(draggedTask)}
        </div>
      ) : null}
    </div>
  );
}

/** Writes a task draft: updates the saved task, or adds the new one to its project. */
function writeProjectTask(
  session: TaskEditorSession,
  values: ProjectTaskValues,
) {
  if (session.taskId) {
    const { pinnedSlot, ...otherValues } = values;
    localStore.updateProjectTask(
      session.projectId,
      session.taskId,
      pinnedSlot === session.openedPinnedSlot ? otherValues : values,
    );
    return;
  }

  localStore.addProjectTask(session.projectId, values);
}

/* ── Projects page ────────────────────────────────────────────────── */

export function ProjectsPage() {
  const teamState = useCurrentTeam();
  const state = useLocalState();
  const taskPropertyPlugins = useTaskPropertyPlugins();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  // The narrow view has no sidebars, so the project list is a page of its own
  // at /projects, and project pages open without it. Tasks edit in a full-width
  // dialog there instead of the side panel.
  const isNarrowView = useIsNarrowView();
  const projectRowRefs = useRef(new Map<string, HTMLTableRowElement>());
  const projectPointerSessionRef = useRef<SharedTableDragPointerSession | null>(
    null,
  );
  const projectDragStateRef = useRef<ProjectDragState | null>(null);
  const suppressProjectClickUntilRef = useRef(0);
  const [projectModalState, setProjectModalState] =
    useState<ProjectModalState | null>(null);
  const [taskEditor, setTaskEditor] = useState<TaskEditorSession | null>(null);
  const [shortcutRequest, setShortcutRequest] =
    useState<ShortcutRequest | null>(null);
  const [pressedProjectId, setPressedProjectId] = useState<string | null>(null);
  const [projectDragState, setProjectDragState] =
    useState<ProjectDragState | null>(null);
  const allProjects = state.projects;

  const activeProjects = useMemo(
    () => state.projects.filter((project) => project.status === "active"),
    [state.projects],
  );
  const activeProjectIds = useMemo(
    () => activeProjects.map((project) => project._id),
    [activeProjects],
  );
  const archivedProjects = useMemo(
    () => state.projects.filter((project) => project.status === "archived"),
    [state.projects],
  );

  const metricsByProject = useMemo(() => {
    const metrics = new Map<string, ProjectMetrics>();
    for (const project of state.projects) {
      metrics.set(project._id, { durationMs: 0, entryCount: 0 });
    }
    for (const entry of state.timesheetEntries) {
      if (!entry.projectId) continue;
      const existing = metrics.get(entry.projectId);
      if (!existing) continue;
      existing.durationMs += entry.durationMs;
      existing.entryCount += 1;
    }
    return metrics;
  }, [state.projects, state.timesheetEntries]);

  const taskMetricsByProject = useMemo(() => {
    const metrics: TaskMetricsByProject = new Map();

    for (const project of state.projects) {
      metrics.set(
        project._id,
        new Map(
          project.tasks.map((task) => [
            task._id,
            { durationMs: 0, entryCount: 0 },
          ]),
        ),
      );
    }

    for (const entry of state.timesheetEntries) {
      if (!entry.projectId || !entry.taskId) continue;
      const projectMetrics = metrics.get(entry.projectId);
      const taskMetrics = projectMetrics?.get(entry.taskId);
      if (!taskMetrics) continue;
      taskMetrics.durationMs += entry.durationMs;
      taskMetrics.entryCount += 1;
    }

    return metrics;
  }, [state.projects, state.timesheetEntries]);

  const weekMsByProject = useMemo(() => {
    const weekStart = startOfWeekIsoDate();
    const weekEnd = addDaysIsoDate(weekStart, 6);
    const totals = new Map<string, number>();
    for (const entry of state.timesheetEntries) {
      if (
        !entry.projectId ||
        entry.localDate < weekStart ||
        entry.localDate > weekEnd
      )
        continue;
      totals.set(
        entry.projectId,
        (totals.get(entry.projectId) ?? 0) + entry.durationMs,
      );
    }
    return totals;
  }, [state.timesheetEntries]);

  const isArchivePage = pathname === "/projects/archive";

  // Derive selected project from URL
  const selectedProjectId =
    pathname.startsWith("/projects/") && !isArchivePage
      ? decodeURIComponent(pathname.slice("/projects/".length))
      : null;

  const selectedProject = selectedProjectId
    ? (allProjects.find((project) => project._id === selectedProjectId) ?? null)
    : null;
  const taskEditorProject = taskEditor
    ? allProjects.find((project) => project._id === taskEditor.projectId)
    : undefined;
  const taskEditorTask = taskEditor?.taskId
    ? taskEditorProject?.tasks.find((task) => task._id === taskEditor.taskId)
    : undefined;
  // Archiving the project or the task, from any menu, closes its editor.
  const isTaskEditorTargetEditable =
    taskEditorProject?.status === "active" &&
    (!taskEditor?.taskId || taskEditorTask?.status === "active");
  const taskEditorState = taskEditor
    ? evaluateProjectTaskEditor(taskEditor.fields, taskEditorTask)
    : null;
  const draggedProject = projectDragState
    ? (activeProjects.find(
        (project) => project._id === projectDragState.projectId,
      ) ?? null)
    : null;
  const canReorderProjects = activeProjects.length > 1;

  useEffect(() => {
    projectDragStateRef.current = projectDragState;
  }, [projectDragState]);

  useEffect(() => {
    if (taskEditor && !isTaskEditorTargetEditable) {
      setTaskEditor(null);
    }
  }, [isTaskEditorTargetEditable, taskEditor]);

  // Every in-page path out of a project goes through `leaveProject`. Route changes
  // the page cannot guard, such as the browser's back button, land here after the
  // fact: a valid draft is saved, and an invalid one can only be dropped.
  const taskEditorDraftRef = useRef<{
    session: TaskEditorSession;
    editor: ProjectTaskEditorState;
  } | null>(null);
  taskEditorDraftRef.current =
    taskEditor && taskEditorState
      ? { session: taskEditor, editor: taskEditorState }
      : null;
  useEffect(() => {
    const draft = taskEditorDraftRef.current;
    if (!draft || draft.session.projectId === selectedProjectId) {
      return;
    }

    const result = commitProjectTaskDraft(draft.editor, "switch");
    if (result.kind === "save") {
      writeProjectTask(draft.session, result.values);
    }
    setTaskEditor(null);
  }, [selectedProjectId]);

  const clearProjectPointerSession = useCallback(() => {
    const session = projectPointerSessionRef.current;
    if (!session) {
      return;
    }

    session.dispose();
    projectPointerSessionRef.current = null;
  }, []);

  const resetProjectDragVisuals = useCallback(() => {
    setSharedTableDragDocumentState(false, "project-sidebar-drag-active");
  }, []);

  const finishProjectDrag = useCallback(
    (shouldCommit: boolean) => {
      const currentDrag = projectDragStateRef.current;
      if (!currentDrag) {
        setPressedProjectId(null);
        resetProjectDragVisuals();
        return;
      }

      const order = getSharedTableDropOrder(
        activeProjectIds,
        currentDrag.originIndex,
        currentDrag.targetIndex,
      );
      if (shouldCommit && order) {
        localStore.reorderProjects(order);
      }

      suppressProjectClickUntilRef.current =
        performance.now() + SHARED_TABLE_DRAG_CLICK_SUPPRESSION_MS;
      projectDragStateRef.current = null;
      setProjectDragState(null);
      setPressedProjectId(null);
      resetProjectDragVisuals();
    },
    [activeProjectIds, resetProjectDragVisuals],
  );

  useEffect(() => {
    return () => {
      clearProjectPointerSession();
      projectDragStateRef.current = null;
      resetProjectDragVisuals();
    };
  }, [clearProjectPointerSession, resetProjectDragVisuals]);

  useEffect(() => {
    clearProjectPointerSession();
    projectDragStateRef.current = null;
    setPressedProjectId(null);
    setProjectDragState(null);
    resetProjectDragVisuals();
  }, [activeProjectIds, clearProjectPointerSession, resetProjectDragVisuals]);

  function handleProjectPointerDown(
    projectId: string,
    event: React.PointerEvent<HTMLTableRowElement>,
  ) {
    if (
      !canReorderProjects ||
      event.button !== 0 ||
      isProjectDragBlockedTarget(event.target)
    ) {
      return;
    }

    const sourceIndex = activeProjectIds.indexOf(projectId);
    if (sourceIndex === -1) {
      return;
    }

    clearProjectPointerSession();
    setPressedProjectId(projectId);

    const { clientX, clientY, pointerId, pointerType } = event;
    const startDrag = (pointerX: number, pointerY: number) => {
      const row = projectRowRefs.current.get(projectId);
      if (!row) {
        setPressedProjectId(null);
        return;
      }

      row.setPointerCapture(pointerId);
      const rect = row.getBoundingClientRect();
      const firstRowRect = projectRowRefs.current
        .get(activeProjectIds[0] ?? projectId)
        ?.getBoundingClientRect();
      setSharedTableDragDocumentState(true, "project-sidebar-drag-active");
      suppressProjectClickUntilRef.current =
        performance.now() + SHARED_TABLE_DRAG_CLICK_SUPPRESSION_MS;
      setPressedProjectId(null);
      const nextDragState = {
        projectId,
        pointerId,
        originIndex: sourceIndex,
        targetIndex: sourceIndex,
        pointerX,
        pointerY,
        offsetX: pointerX - rect.left,
        offsetY: pointerY - rect.top,
        originLeft: rect.left,
        minTop: firstRowRect?.top ?? rect.top,
        width: rect.width,
        height: rect.height,
      };
      projectDragStateRef.current = nextDragState;
      setProjectDragState(nextDragState);
    };

    projectPointerSessionRef.current = createSharedTableDragPointerSession({
      // startDrag gives the row pointer capture.
      captureTarget: projectRowRefs.current.get(projectId),
      pointerId,
      pointerType,
      originX: clientX,
      originY: clientY,
      isDragging: () => projectDragStateRef.current?.pointerId === pointerId,
      onStart: (pointer) => {
        startDrag(pointer.clientX, pointer.clientY);
      },
      onMove: (pointer) => {
        const current = projectDragStateRef.current;
        if (!current) {
          return;
        }

        const nextDragState: ProjectDragState = {
          ...current,
          pointerX: pointer.clientX,
          pointerY: pointer.clientY,
          targetIndex: getSharedTableDragTargetIndex(
            activeProjectIds,
            current.projectId,
            pointer.clientY,
            projectRowRefs.current,
          ),
        };
        projectDragStateRef.current = nextDragState;
        setProjectDragState(nextDragState);
      },
      onEnd: (shouldCommit) => {
        projectPointerSessionRef.current = null;
        withEventAttribution({ surface: "drag" }, () =>
          finishProjectDrag(shouldCommit),
        );
      },
      onPressEnd: () => {
        projectPointerSessionRef.current = null;
        setPressedProjectId(null);
      },
    });
  }

  // A project id that no longer resolves goes back to the list.
  useEffect(() => {
    if (selectedProjectId && !selectedProject) {
      void navigate({ to: "/projects", replace: true });
    }
  }, [navigate, selectedProject, selectedProjectId]);

  // The command palette sends its project and task commands here while this page
  // is open, so they pass the same guards as the page's own controls: a valid
  // task draft is saved first, and an invalid one blocks and shows its error.
  // Object actions use `?action=<id>&target=<project id>`, or `&target=<task
  // id>&parent=<project id>` for a task. Only enabled actions run.
  useActionRequest(({ action, target, parent }) => {
    switch (action) {
      case "create-project":
        openCreateProjectModal();
        return;
      case "open-archive":
        goToProject(null);
        return;
      case "open-project":
        if (allProjects.some((project) => project._id === target)) {
          goToProject(target ?? null);
        }
        return;
    }

    const project = allProjects.find((item) => item._id === (parent ?? target));
    if (!project) return;

    if (!parent) {
      // Move up and Move down from the palette.
      if (action === "move-up" || action === "move-down") {
        reorderProject(project._id, action === "move-up" ? -1 : 1);
        return;
      }

      const requested = getProjectActions(project).find(
        (item) => item.id === action && !item.disabledReason,
      );
      if (requested) runProjectAction(project, requested.id);
      return;
    }

    const task = project.tasks.find((item) => item._id === target);
    // Move up and Move down from the palette, among the project's active tasks.
    if (action === "move-up" || action === "move-down") {
      const next =
        task && project.status === "active" && task.status === "active"
          ? getSharedTableStepOrder(
              project.tasks
                .filter((item) => item.status === "active")
                .map((item) => item._id),
              task._id,
              action === "move-up" ? -1 : 1,
            )
          : null;
      if (task && next) {
        localStore.reorderProjectTask(project._id, task._id, next.toIndex);
      }
      return;
    }

    const requested = task
      ? getTaskActions(project, task).find(
          (item) => item.id === action && !item.disabledReason,
        )
      : undefined;
    // Start entry, New entry… and the favorite actions run in the palette,
    // so only these reach the page.
    if (!task || !requested) return;
    if (requested.id === "edit") openTaskEditor(project._id, task);
    if (requested.id === "assign-shortcut") {
      setShortcutRequest({ projectId: project._id, task });
    }
    if (requested.id === "archive") {
      offerUndo(localStore.archiveProjectTask(project._id, task._id), {
        title: "Task archived",
        subject: "project",
      });
    }
    if (requested.id === "restore") {
      localStore.unarchiveProjectTask(project._id, task._id);
    }
    // The handlers are declared after the early return below, so a request
    // waits until the page renders them.
  }, Boolean(teamState?.team));

  if (!teamState?.team) return null;

  const closeProjectModal = () => {
    setProjectModalState(null);
  };

  /** Creating a project leaves the current one, so the task draft is settled first. */
  const openCreateProjectModal = () => {
    if (!leaveProject()) {
      return;
    }
    setProjectModalState({ mode: "create" });
  };

  /**
   * Saves a valid draft in the task editor before it shows something else.
   * Returns false when the draft is invalid; the editor stays open and shows why.
   */
  const leaveTaskDraft = () => {
    if (!taskEditor || !taskEditorState) {
      return true;
    }

    const result = commitProjectTaskDraft(taskEditorState, "switch");
    if (result.kind === "invalid") {
      setTaskEditor({ ...taskEditor, showErrors: true });
      return false;
    }

    if (result.kind === "save") {
      writeProjectTask(taskEditor, result.values);
    }
    return true;
  };

  /** Opens a saved task, or a blank one, in the task editor, going to its project if needed. */
  const openTaskEditor = (projectId: string, task?: LocalProjectTask) => {
    if (task && taskEditor?.taskId === task._id) {
      return;
    }
    if (!leaveTaskDraft()) {
      return;
    }

    setTaskEditor({
      projectId,
      taskId: task?._id,
      fields: createProjectTaskEditorFields(task),
      openedPinnedSlot: task?.pinnedSlot,
      showErrors: false,
    });
    if (projectId !== selectedProjectId) {
      void navigate({ to: "/projects/$projectId", params: { projectId } });
    }
  };

  const saveTaskEditor = () => {
    if (!taskEditor || !taskEditorState) {
      return;
    }

    const result = commitProjectTaskDraft(taskEditorState, "save");
    if (result.kind === "invalid") {
      setTaskEditor({ ...taskEditor, showErrors: true });
      return;
    }

    if (result.kind === "save") {
      writeProjectTask(taskEditor, result.values);
    }
    setTaskEditor(null);
  };

  const updateTaskEditorFields = (patch: Partial<ProjectTaskEditorFields>) => {
    setTaskEditor((current) =>
      current ? { ...current, fields: { ...current.fields, ...patch } } : null,
    );
  };

  /**
   * Writes the slot chosen in the Assign shortcut… picker. When the task is
   * open in the panel, its Shortcut field follows, so the panel's Save keeps it.
   */
  const assignShortcut = (
    request: ShortcutRequest,
    slot: PinnedTaskSlot | undefined,
  ) => {
    localStore.setProjectTaskPinnedSlot(
      request.projectId,
      request.task._id,
      slot,
    );
    setTaskEditor((current) =>
      current?.taskId === request.task._id
        ? {
            ...current,
            fields: { ...current.fields, pinnedSlot: slot },
            openedPinnedSlot: slot,
          }
        : current,
    );
  };

  /**
   * The guard for every path that leaves the selected project: saves a valid task
   * draft and closes the editor. Returns false when an invalid draft blocks it.
   */
  const leaveProject = () => {
    if (!leaveTaskDraft()) {
      return false;
    }
    setTaskEditor(null);
    return true;
  };

  /** Goes to a project, or to the archive with `null`, after `leaveProject`. */
  const goToProject = (projectId: string | null) => {
    // Where we are: a project id, null on the archive, undefined on the list.
    const here = isArchivePage ? null : (selectedProjectId ?? undefined);
    if (projectId === here || !leaveProject()) {
      return;
    }

    void navigate(
      projectId
        ? { to: "/projects/$projectId", params: { projectId } }
        : { to: "/projects/archive" },
    );
  };

  const handleLeaveProjectClick = (
    event: React.MouseEvent,
    nextProjectId: string | null,
  ) => {
    if (nextProjectId === selectedProjectId) {
      return;
    }

    if (!leaveProject()) {
      event.preventDefault();
      event.stopPropagation();
    }
  };

  const openEditProjectModal = (project: LocalProject) => {
    setProjectModalState({ mode: "edit", projectId: project._id });
  };

  /**
   * Move up and Move down among the active projects of the list, persisted
   * like a drag. Archived projects have no order to change.
   */
  const reorderProject = (projectId: string, step: -1 | 1) => {
    const next = getSharedTableStepOrder(activeProjectIds, projectId, step);
    if (next) {
      localStore.reorderProjects(next.order);
    }
  };

  /** Runs the project action set from the list rows, right-click menus and the Properties card. */
  const runProjectAction = (
    project: LocalProject,
    actionId: ProjectActionId,
  ) => {
    return withEventAttribution({ surface: "button" }, () => {
      switch (actionId) {
        case "edit":
          openEditProjectModal(project);
          return;
        case "new-task":
          openTaskEditor(project._id);
          return;
        case "favorite":
        case "unfavorite":
          setProjectFavorite(project._id, actionId === "favorite");
          return;
        case "archive":
          offerUndo(localStore.archiveProject(project._id), {
            title: "Project archived",
            subject: "project",
          });
          return;
        case "restore":
          localStore.unarchiveProject(project._id);
          return;
      }
    });
  };

  const handleProjectSubmit = (values: ProjectFormValues) => {
    if (!projectModalState) {
      return;
    }

    if (projectModalState.mode === "create") {
      const nextId = localStore.addProject(values);
      closeProjectModal();
      void navigate({
        to: "/projects/$projectId",
        params: { projectId: nextId },
      });
      return;
    }

    localStore.updateProject(projectModalState.projectId, values);
    closeProjectModal();
  };

  const editedProject =
    projectModalState?.mode === "edit"
      ? allProjects.find(
          (project) => project._id === projectModalState.projectId,
        )
      : undefined;
  const visibleTaskEditor =
    taskEditor &&
    taskEditorState &&
    taskEditorProject &&
    isTaskEditorTargetEditable &&
    taskEditor.projectId === selectedProjectId
      ? taskEditor
      : null;
  const taskEditorForm =
    visibleTaskEditor && taskEditorState && taskEditorProject ? (
      <ProjectTaskEditorForm
        fields={visibleTaskEditor.fields}
        editor={taskEditorState}
        showNameError={visibleTaskEditor.showErrors}
        projectName={getProjectDisplayName(taskEditorProject)}
        taskId={visibleTaskEditor.taskId}
        trackedMs={
          visibleTaskEditor.taskId
            ? (taskMetricsByProject
                .get(visibleTaskEditor.projectId)
                ?.get(visibleTaskEditor.taskId)?.durationMs ?? 0)
            : undefined
        }
        taskPropertyPlugins={taskPropertyPlugins}
        otherTaskNames={taskEditorProject.tasks
          .filter(
            (task) =>
              task.status === "active" && task._id !== visibleTaskEditor.taskId,
          )
          .map((task) => task.name)}
        onFieldsChange={updateTaskEditorFields}
        onSave={saveTaskEditor}
        onClose={() => setTaskEditor(null)}
        titleAs={isNarrowView ? DialogTitle : undefined}
      />
    ) : null;

  const selectedEntries = selectedProject
    ? state.timesheetEntries
        .filter((entry) => entry.projectId === selectedProject._id)
        .sort((a, b) => b.localDate.localeCompare(a.localDate))
    : [];
  const listProjects = isArchivePage ? archivedProjects : activeProjects;

  return (
    <div className="project-page">
      <div className="project-page-main">
        {selectedProject ? (
          <ProjectDetail
            key={selectedProject._id}
            project={selectedProject}
            metrics={
              metricsByProject.get(selectedProject._id) ?? {
                durationMs: 0,
                entryCount: 0,
              }
            }
            taskMetrics={
              taskMetricsByProject.get(selectedProject._id) ?? new Map()
            }
            entries={selectedEntries}
            weekMs={weekMsByProject.get(selectedProject._id) ?? 0}
            editingTaskId={visibleTaskEditor?.taskId}
            onProjectAction={runProjectAction}
            onOpenTask={(task) => openTaskEditor(selectedProject._id, task)}
            onNewTask={() => openTaskEditor(selectedProject._id)}
            onLeave={(event) => handleLeaveProjectClick(event, null)}
            onAssignShortcut={(task) =>
              setShortcutRequest({ projectId: selectedProject._id, task })
            }
            taskPropertyPlugins={taskPropertyPlugins}
          />
        ) : (
          <>
            <h1 className="sr-only">
              {isArchivePage ? "Archived projects" : "Projects"}
            </h1>
            <PageHeader
              actions={
                <>
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="Projects options"
                        />
                      }
                    >
                      <More className="size-4" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        render={<Link to="/settings/projects" />}
                      >
                        Import and export…
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <Button
                    type="button"
                    size="lg"
                    onClick={openCreateProjectModal}
                  >
                    <Plus data-icon="inline-start" />
                    New project
                  </Button>
                </>
              }
            />
            <ProjectsList
              projects={listProjects}
              archived={isArchivePage}
              weekMsByProject={weekMsByProject}
              taskMetricsByProject={taskMetricsByProject}
              dragState={projectDragState}
              pressedProjectId={pressedProjectId}
              canReorder={canReorderProjects}
              rowRefs={projectRowRefs}
              onPointerDown={handleProjectPointerDown}
              onOpen={(projectId) => {
                if (performance.now() < suppressProjectClickUntilRef.current) {
                  return;
                }
                goToProject(projectId);
              }}
              onProjectAction={runProjectAction}
              onReorder={reorderProject}
              onNewProject={openCreateProjectModal}
            />
          </>
        )}
      </div>

      {draggedProject && projectDragState ? (
        <div
          className="project-task-drag-preview"
          style={{
            width: projectDragState.width,
            minHeight: projectDragState.height,
            transform: getSharedTableDragOverlayTransform(projectDragState),
          }}
        >
          <div className="project-task-name-cell">
            <ProjectIcon
              icon={draggedProject.icon}
              color={draggedProject.color}
              className="ajour-sidebar-icon"
            />
            <span className="project-task-name">
              {getProjectDisplayName(draggedProject)}
            </span>
            {draggedProject.code ? <Chip>{draggedProject.code}</Chip> : null}
          </div>
        </div>
      ) : null}

      {taskEditorForm && !isNarrowView ? (
        <SidePanel
          contentKey={visibleTaskEditor?.taskId ?? "new"}
          widthKey="projects"
          className="project-task-side-panel"
          aria-label="Task editor"
        >
          {taskEditorForm}
        </SidePanel>
      ) : null}
      {taskEditorForm && isNarrowView ? (
        <Dialog
          open
          disablePointerDismissal
          onOpenChange={(open) => !open && setTaskEditor(null)}
        >
          <DialogContent className="max-w-xl" showCloseButton={false}>
            {taskEditorForm}
          </DialogContent>
        </Dialog>
      ) : null}

      {shortcutRequest ? (
        <PinnedSlotDialog
          taskName={shortcutRequest.task.name}
          taskId={shortcutRequest.task._id}
          slot={shortcutRequest.task.pinnedSlot}
          onChoose={(slot) => assignShortcut(shortcutRequest, slot)}
          onClose={() => setShortcutRequest(null)}
        />
      ) : null}

      {projectModalState &&
      (projectModalState.mode === "create" || editedProject) ? (
        <ProjectFormDialog
          project={editedProject}
          onClose={closeProjectModal}
          onSubmit={handleProjectSubmit}
        />
      ) : null}
    </div>
  );
}
