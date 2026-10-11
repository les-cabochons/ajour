import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  RiAddLine as Plus,
  RiArchiveLine as Archive,
  RiDownloadLine as Download,
  RiFileTransferLine as FileTransfer,
  RiFolderAddLine as FolderPlus,
} from "@remixicon/react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { MessagePanel } from "@/components/app-surface";
import {
  ObjectActionsButton,
  ObjectContextMenu,
} from "@/components/object-actions-menu";
import { SidePanel } from "@/components/side-panel";
import { Badge } from "@/components/ui/badge";
import { TooltipButton } from "@/components/tooltip-button";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  CustomSidebar,
  CustomSidebarLayout,
  CustomSidebarMenuButton,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuItem,
} from "@/components/custom-sidebar";
import {
  getProjectActions,
  getTaskActions,
  type ObjectAction,
  type ProjectActionId,
  type TaskActionId,
} from "@/domain/actions/object-actions";
import {
  formatProjectTaskConsumedBadge,
  getProjectTaskConsumedTone,
  type ProjectTaskConsumedTone,
} from "@/domain/projects/task-budget";
import { getProjectTaskBillableValueLabel } from "@/features/projects/project-task-options";
import type { ProjectTaskImportResult } from "@/domain/projects/task-import";
import {
  getLocalProjectDisplayName,
  type LocalProject,
  type LocalProjectTask,
  type PinnedTaskSlot,
} from "@/domain/local-state";
import { openCommandPalette } from "@/features/command-palette/command-palette";
import {
  PinnedSlotBadge,
  PinnedSlotDialog,
} from "@/features/projects/pinned-slot";
import { ProjectFormDialog } from "@/features/projects/project-form-dialog";
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
import { offerUndo } from "@/features/feedback/undo-toast";
import { useActionRequest } from "@/lib/action-request";
import { FOCUS_ATTRIBUTES } from "@/lib/focused-object";
import { handleItemKeyDown, TASK_ACTION_KEYS } from "@/lib/item-keys";
import { useCurrentTeam } from "@/lib/session";
import { useLocalState } from "@/lib/local-hooks";
import { localStore } from "@/lib/local-store";
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
import { TimeEntryModal } from "@/features/timer/time-entry-modal";
import { useIsNarrowView } from "@/lib/use-narrow-view";
import {
  formatAriaKeyShortcuts,
  getShortcut,
  getShortcutPlatform,
} from "@/lib/shortcuts";
import { cn, todayIsoDate } from "@/lib/utils";

const commandPaletteAriaKeys = formatAriaKeyShortcuts(
  getShortcut("app.command-palette"),
  getShortcutPlatform(),
);

/** Tooltip classes that show a project sidebar tooltip only in the 48px rail, where names are hidden. */
const RAIL_ONLY_TOOLTIP = "hidden forced-rail:inline-flex";

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

/** The project header's "…" menu adds Import tasks… to the project's action set. */
type ProjectHeaderActionId = ProjectActionId | "import-tasks";

const projectTaskToneClassName: Record<ProjectTaskConsumedTone, string> = {
  default: "",
  success: "project-task-budget-badge is-success",
  warning: "project-task-budget-badge is-warning",
  danger: "project-task-budget-badge is-danger",
  "danger-strong": "project-task-budget-badge is-danger-strong",
};

function getProjectDisplayName(project: LocalProject) {
  return getLocalProjectDisplayName(project);
}

function shouldShowProjectFullName(project: LocalProject) {
  return getProjectDisplayName(project) !== project.name;
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

function hoursLabel(durationMs: number) {
  return `${new Intl.NumberFormat("en-CA", {
    minimumFractionDigits: durationMs % 3600000 === 0 ? 0 : 1,
    maximumFractionDigits: 1,
  }).format(durationMs / 3600000)} h`;
}

function taskSummary(project: LocalProject) {
  const active = project.tasks.filter(
    (task) => task.status === "active",
  ).length;
  const archived = project.tasks.length - active;

  return { active, archived };
}

function formatImportSummary(result: ProjectTaskImportResult) {
  const skipped: string[] = [];

  if (result.duplicateCount > 0) {
    skipped.push(
      `${result.duplicateCount} ${result.duplicateCount === 1 ? "duplicate" : "duplicates"}`,
    );
  }

  if (result.blankCount > 0) {
    skipped.push(
      `${result.blankCount} ${result.blankCount === 1 ? "blank cell" : "blank cells"}`,
    );
  }

  if (result.headerCount > 0) {
    skipped.push(
      `${result.headerCount} ${result.headerCount === 1 ? "header row" : "header rows"}`,
    );
  }

  const importedLabel = `${result.importedCount} ${result.importedCount === 1 ? "task" : "tasks"}`;
  return skipped.length > 0
    ? `Imported ${importedLabel}. Skipped ${skipped.join(", ")}.`
    : `Imported ${importedLabel}.`;
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
 * The project header's "…" menu: the project's action set with Import tasks… before
 * Archive, because destructive actions come last. Right-click menus keep the plain set.
 */
function getProjectHeaderActions(
  project: LocalProject,
  isImporting: boolean,
): ObjectAction<ProjectHeaderActionId>[] {
  const actions: ObjectAction<ProjectHeaderActionId>[] =
    getProjectActions(project);
  const importAction: ObjectAction<ProjectHeaderActionId> = {
    id: "import-tasks",
    label: "Import tasks…",
    disabledReason:
      project.status === "archived"
        ? "Restore the project first"
        : isImporting
          ? "Importing tasks"
          : undefined,
    hint: "Task names from column C of an Excel file",
  };
  const destructiveIndex = actions.findIndex((action) => action.destructive);
  const insertAt = destructiveIndex === -1 ? actions.length : destructiveIndex;

  return [
    ...actions.slice(0, insertAt),
    importAction,
    ...actions.slice(insertAt),
  ];
}

function ArchivedProjectsView({
  projects,
  onProjectAction,
}: {
  projects: LocalProject[];
  onProjectAction: (project: LocalProject, actionId: ProjectActionId) => void;
}) {
  return (
    <div>
      <div className="entries-table-scroll-shell entries-table-scroll-shell-project">
        <table className="entries-table entries-table-header-table animate-in">
          <thead>
            <tr>
              <th>Project</th>
              <th className="entry-hours-heading entry-hours-heading-actions">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
        </table>
        <ScrollArea className="entries-table-scroll-area">
          <table className="entries-table entries-table-body-table animate-in">
            <tbody className="entries-table-scroll-region">
              {projects.length > 0 ? (
                projects.map((project) => {
                  const actions = getProjectActions(project);
                  const onAction = (actionId: ProjectActionId) =>
                    onProjectAction(project, actionId);

                  return (
                    <ObjectContextMenu
                      key={project._id}
                      actions={actions}
                      onAction={onAction}
                      render={<tr className="project-archived-row" />}
                    >
                      <td>
                        <div className="project-task-name-cell">
                          <ProjectIcon
                            icon={project.icon}
                            color={project.color}
                            className="ajour-sidebar-icon"
                          />
                          <span className="project-task-name">
                            {getProjectDisplayName(project)}
                          </span>
                          {project.code ? <Badge>{project.code}</Badge> : null}
                        </div>
                      </td>
                      <td className="entry-hours-cell">
                        <div className="entry-hours-content">
                          <ObjectActionsButton
                            actions={actions}
                            onAction={onAction}
                            label={`Actions for ${getProjectDisplayName(project)}`}
                          />
                        </div>
                      </td>
                    </ObjectContextMenu>
                  );
                })
              ) : (
                <tr className="entry-empty-row">
                  <td colSpan={2}>
                    <Empty className="entry-table-empty">
                      <EmptyHeader>
                        <EmptyMedia variant="icon">
                          <Archive className="h-5 w-5" />
                        </EmptyMedia>
                        <EmptyTitle className="font-sans text-[14px] font-semibold tracking-normal">
                          No archived projects
                        </EmptyTitle>
                        <EmptyDescription>
                          Archived projects will appear here.
                        </EmptyDescription>
                      </EmptyHeader>
                    </Empty>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </ScrollArea>
      </div>
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
  onAssignShortcut,
}: {
  project: LocalProject;
  metrics: ProjectMetrics;
  taskMetrics: Map<string, ProjectMetrics>;
  /** The task open in the side panel, highlighted in the list. */
  editingTaskId?: string;
  onProjectAction: (project: LocalProject, actionId: ProjectActionId) => void;
  /** Opens a saved task in the task editor. */
  onOpenTask: (task: LocalProjectTask) => void;
  /** Opens a blank task in the task editor. */
  onNewTask: () => void;
  /** Opens the slot picker for a task, like the palette's Assign shortcut…. */
  onAssignShortcut: (task: LocalProjectTask) => void;
}) {
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const taskRowRefs = useRef(new Map<string, HTMLTableRowElement>());
  const taskPointerSessionRef = useRef<SharedTableDragPointerSession | null>(
    null,
  );
  const taskDragStateRef = useRef<TaskDragState | null>(null);
  const suppressTaskClickUntilRef = useRef(0);
  /** Task whose New entry… dialog is open. */
  const [newEntryTask, setNewEntryTask] = useState<LocalProjectTask | null>(
    null,
  );
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
  const headerActions = getProjectHeaderActions(project, isImporting);

  const summary = taskSummary(project);
  const activeTasks = project.tasks.filter((task) => task.status === "active");
  const activeTaskIds = useMemo(
    () => activeTasks.map((task) => task._id),
    [activeTasks],
  );
  const archivedTasks = project.tasks.filter(
    (task) => task.status === "archived",
  );
  const summaryStats = [
    { label: "Tracked", value: hoursLabel(metrics.durationMs) },
    { label: "Entries", value: `${metrics.entryCount}` },
  ];
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
      const { extractTaskNamesFromWorkbook } =
        await import("@/features/projects/project-task-import");
      const workbook = await extractTaskNamesFromWorkbook(
        await file.arrayBuffer(),
      );
      if (workbook.taskNames.length === 0) {
        throw new Error(
          "No usable task names were found in column C of the first worksheet.",
        );
      }
      const importResult = localStore.importProjectTasks(
        project._id,
        workbook.taskNames,
      );
      setImportMessage(
        formatImportSummary({
          ...importResult,
          blankCount: workbook.blankCount,
          headerCount: workbook.headerCount,
        }),
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

  function runHeaderAction(actionId: ProjectHeaderActionId) {
    if (actionId === "import-tasks") {
      openImportPicker();
      return;
    }

    onProjectAction(project, actionId);
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
    switch (actionId) {
      case "start-entry":
        localStore.startTimer({
          projectId: project._id,
          taskId: task._id,
          accumulatedDurationMs: 0,
        });
        return;
      case "new-entry":
        setNewEntryTask(task);
        return;
      case "edit":
        onOpenTask(task);
        return;
      case "assign-shortcut":
        onAssignShortcut(task);
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

    event.currentTarget.setPointerCapture(event.pointerId);
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
        finishTaskDrag(shouldCommit);
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

    return (
      <span
        className={cn(
          "hours-badge",
          projectTaskToneClassName[getProjectTaskConsumedTone(options)],
        )}
      >
        {formatProjectTaskConsumedBadge(options)}
      </span>
    );
  }

  return (
    <div className="space-y-6" {...{ [FOCUS_ATTRIBUTES.project]: project._id }}>
      <input
        ref={importInputRef}
        type="file"
        accept=".xlsx,.xls,.xlsm"
        className="hidden"
        onChange={(event) => {
          void handleTaskImport(event);
        }}
      />

      {/* Project header */}
      <div className="project-detail-header">
        <ObjectContextMenu
          actions={projectActions}
          onAction={(actionId) => onProjectAction(project, actionId)}
          render={<div className="flex min-w-0 flex-wrap items-center gap-2" />}
        >
          <ProjectIcon
            icon={project.icon}
            color={project.color}
            className="project-header-icon"
          />
          <div className="project-title-stack">
            <h2 className="text-[15px] font-semibold">
              {getProjectDisplayName(project)}
            </h2>
            {shouldShowProjectFullName(project) ? (
              <span className="project-full-name">{project.name}</span>
            ) : null}
          </div>
          {project.code ? <Badge>{project.code}</Badge> : null}
          <ObjectActionsButton
            actions={headerActions}
            onAction={runHeaderAction}
            label={`Actions for ${getProjectDisplayName(project)}`}
          />
        </ObjectContextMenu>
        {!isArchived ? (
          <Button type="button" variant="outline" size="sm" onClick={onNewTask}>
            <Plus data-icon="inline-start" />
            New task
          </Button>
        ) : null}
      </div>

      {/* Stat pills */}
      <div className="project-summary-controls">
        <div className="flex flex-wrap gap-2">
          {summaryStats.map((stat) => (
            <Badge
              key={stat.label}
              className="rounded-md px-3 py-1.5 text-xs text-foreground"
            >
              <span className="font-mono text-[13px] font-semibold text-foreground">
                {stat.value}
              </span>
              <span className="text-foreground/55">{stat.label}</span>
            </Badge>
          ))}
        </div>
        <div
          className="toggle-group backlog-filter-tabs project-task-filter-tabs"
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
                  "toggle-item backlog-filter-tab",
                  isActive && "toggle-item-active",
                )}
                onClick={() => setTaskFilter(filter.value)}
              >
                <span className="backlog-filter-label">{filter.label}</span>
                <span className="backlog-filter-count">{filter.count}</span>
              </button>
            );
          })}
        </div>
      </div>

      {isArchived ? (
        <MessagePanel className="border border-[var(--border)] bg-muted/60 text-foreground">
          This project is archived. You can consult it here, but project and
          task changes are disabled until you restore it.
        </MessagePanel>
      ) : null}

      {/* Import messages */}
      {isImporting ? (
        <MessagePanel className="border border-[var(--border)] text-foreground">
          Importing tasks…
        </MessagePanel>
      ) : null}
      {importMessage ? (
        <MessagePanel className="border border-[var(--success-muted)] bg-[var(--success-muted)] text-foreground">
          {importMessage}
        </MessagePanel>
      ) : null}
      {importError ? (
        <MessagePanel
          tone="warning"
          className="border border-[var(--danger-muted)] text-foreground"
        >
          {importError}
        </MessagePanel>
      ) : null}

      {/* Tasks table */}
      <div className="entries-table-scroll-shell entries-table-scroll-shell-project">
        <table className="entries-table project-tasks-table entries-table-header-table animate-in">
          <thead>
            <tr>
              <th>Task</th>
              <th className="entry-hours-heading entry-hours-heading-actions">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
        </table>
        <ScrollArea className="entries-table-scroll-area">
          <table
            className={cn(
              "entries-table project-tasks-table entries-table-body-table animate-in",
              taskDragState && "is-task-dragging",
            )}
          >
            <tbody data-focus-scope>
              {(isArchivedTaskFilter ? archivedTasks : activeTasks).length ===
              0 ? (
                <tr className="entry-empty-row">
                  <td colSpan={2}>
                    <Empty className="entry-table-empty">
                      <EmptyHeader>
                        <EmptyMedia variant="icon">
                          <FolderPlus className="h-5 w-5" />
                        </EmptyMedia>
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
                              : "Create a task or import tasks from Excel."}
                        </EmptyDescription>
                      </EmptyHeader>
                      {!isArchived && !isArchivedTaskFilter ? (
                        <EmptyContent className="max-w-none flex-row justify-center gap-2">
                          <Button type="button" size="sm" onClick={onNewTask}>
                            <Plus data-icon="inline-start" />
                            New task
                          </Button>
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            disabled={isImporting}
                            onClick={openImportPicker}
                          >
                            <Download data-icon="inline-start" />
                            Import tasks…
                          </Button>
                        </EmptyContent>
                      ) : null}
                    </Empty>
                  </td>
                </tr>
              ) : null}

              {isArchivedTaskFilter
                ? archivedTasks.map((task) => {
                    const taskActions = getTaskActions(project, task);

                    return (
                      <ObjectContextMenu
                        key={task._id}
                        actions={taskActions}
                        keys={TASK_ACTION_KEYS}
                        onAction={(actionId) => runTaskAction(task, actionId)}
                        render={
                          <tr
                            className="project-task-row"
                            {...{ [FOCUS_ATTRIBUTES.task]: task._id }}
                            data-focus-column="0"
                            tabIndex={0}
                            onKeyDown={(event) =>
                              handleItemKeyDown(event, {
                                actions: taskActions,
                                keys: TASK_ACTION_KEYS,
                                onAction: (actionId) =>
                                  runTaskAction(task, actionId),
                              })
                            }
                          />
                        }
                      >
                        <td>
                          <div className="project-task-name-cell">
                            <span className="project-task-name">
                              {task.name}
                            </span>
                            {task.pinnedSlot ? (
                              <PinnedSlotBadge slot={task.pinnedSlot} />
                            ) : null}
                            <Badge className="project-task-billable-badge bg-muted">
                              {getProjectTaskBillableValueLabel(task)}
                            </Badge>
                            <Badge className="project-task-status-badge">
                              Archived
                            </Badge>
                          </div>
                        </td>
                        <td className="entry-hours-cell">
                          <div className="entry-hours-content">
                            <div className="entry-row-actions">
                              <ObjectActionsButton
                                actions={taskActions}
                                keys={TASK_ACTION_KEYS}
                                onAction={(actionId) =>
                                  runTaskAction(task, actionId)
                                }
                                label={`Actions for ${task.name}`}
                                className="entry-row-action"
                              />
                            </div>
                            {renderConsumedBadge(task)}
                          </div>
                        </td>
                      </ObjectContextMenu>
                    );
                  })
                : activeTasks.map((task, index) => {
                    const taskActions = getTaskActions(project, task);
                    const isDraggedTask = taskDragState?.taskId === task._id;
                    const rowShift = taskDragState
                      ? getSharedTableDragRowShift({
                          itemIndex: index,
                          originIndex: taskDragState.originIndex,
                          targetIndex: taskDragState.targetIndex,
                          rowHeight: taskDragState.height,
                        })
                      : 0;

                    return (
                      <ObjectContextMenu
                        key={task._id}
                        actions={taskActions}
                        keys={TASK_ACTION_KEYS}
                        onAction={(actionId) => runTaskAction(task, actionId)}
                        render={
                          <tr
                            ref={(node) => {
                              if (node) {
                                taskRowRefs.current.set(task._id, node);
                                return;
                              }

                              taskRowRefs.current.delete(task._id);
                            }}
                            className={cn(
                              "project-task-row",
                              canReorderTasks && "is-reorderable",
                              pressedTaskId === task._id && "is-pressing",
                              rowShift !== 0 && "is-shifting",
                              isDraggedTask && "is-drag-source",
                              editingTaskId === task._id && "is-editing",
                            )}
                            style={
                              rowShift !== 0
                                ? {
                                    transform: `translate3d(0, ${rowShift}px, 0)`,
                                  }
                                : undefined
                            }
                            aria-grabbed={isDraggedTask}
                            {...{ [FOCUS_ATTRIBUTES.task]: task._id }}
                            data-focus-column="0"
                            tabIndex={0}
                            onKeyDown={(event) =>
                              handleItemKeyDown(event, {
                                actions: taskActions,
                                keys: TASK_ACTION_KEYS,
                                onAction: (actionId) =>
                                  runTaskAction(task, actionId),
                                onReorder: canReorderTasks
                                  ? (step) => reorderTask(task._id, step)
                                  : undefined,
                              })
                            }
                            onClick={() => handleTaskClick(task)}
                            onPointerDown={(event) =>
                              handleTaskPointerDown(task._id, event)
                            }
                          />
                        }
                      >
                        <td>
                          <div className="project-task-name-cell">
                            <span className="project-task-name">
                              {task.name}
                            </span>
                            {task.pinnedSlot ? (
                              <PinnedSlotBadge slot={task.pinnedSlot} />
                            ) : null}
                            <Badge className="project-task-billable-badge bg-muted">
                              {getProjectTaskBillableValueLabel(task)}
                            </Badge>
                          </div>
                        </td>
                        <td className="entry-hours-cell">
                          <div className="entry-hours-content">
                            <div className="entry-row-actions">
                              <ObjectActionsButton
                                actions={taskActions}
                                keys={TASK_ACTION_KEYS}
                                onAction={(actionId) =>
                                  runTaskAction(task, actionId)
                                }
                                label={`Actions for ${task.name}`}
                                className="entry-row-action"
                              />
                            </div>
                            {renderConsumedBadge(task)}
                          </div>
                        </td>
                      </ObjectContextMenu>
                    );
                  })}
            </tbody>
          </table>
        </ScrollArea>
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
            <Badge className="project-task-billable-badge bg-muted">
              {getProjectTaskBillableValueLabel(draggedTask)}
            </Badge>
          </div>
          {renderConsumedBadge(draggedTask)}
        </div>
      ) : null}

      {newEntryTask ? (
        <TimeEntryModal
          date={todayIsoDate()}
          initialValues={{ projectId: project._id, taskId: newEntryTask._id }}
          onClose={() => setNewEntryTask(null)}
        />
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
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  // The narrow view has no sidebars, so the project list is a page of its own
  // at /projects, and project pages open without it. Tasks edit in a full-width
  // dialog there instead of the side panel.
  const isNarrowView = useIsNarrowView();
  const isNarrowProjectList = isNarrowView && pathname === "/projects";
  const projectRowRefs = useRef(new Map<string, HTMLLIElement>());
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
    event: React.PointerEvent<HTMLLIElement>,
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
        finishProjectDrag(shouldCommit);
      },
      onPressEnd: () => {
        projectPointerSessionRef.current = null;
        setPressedProjectId(null);
      },
    });
  }

  // Auto-select the first available project if the current URL does not
  // resolve. The narrow view keeps /projects as the project list.
  useEffect(() => {
    if (pathname === "/projects/archive") return;
    if (isNarrowProjectList) return;
    if (pathname !== "/projects" && !pathname.startsWith("/projects/")) return;
    const firstProject = activeProjects[0] ?? archivedProjects[0];
    if (!firstProject || selectedProject) return;
    void navigate({
      to: "/projects/$projectId",
      params: { projectId: firstProject._id },
      replace: true,
    });
  }, [
    activeProjects,
    archivedProjects,
    isNarrowProjectList,
    navigate,
    pathname,
    selectedProject,
  ]);

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
    // Start entry and New entry… run in the palette, so only these reach the page.
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

  /** Runs `leaveProject` before a sidebar link changes project, or cancels the link. */
  /** Goes to a project, or to the archive with `null`, after `leaveProject`. */
  const goToProject = (projectId: string | null) => {
    if (projectId === selectedProjectId || !leaveProject()) {
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
   * Move up and Move down among the active projects of the sidebar, persisted
   * like a drag. Archived projects have no order to change.
   */
  const reorderProject = (projectId: string, step: -1 | 1) => {
    const next = getSharedTableStepOrder(activeProjectIds, projectId, step);
    if (next) {
      localStore.reorderProjects(next.order);
    }
  };

  /** Runs the project action set from the sidebar, the archive list and the detail header. */
  const runProjectAction = (
    project: LocalProject,
    actionId: ProjectActionId,
  ) => {
    switch (actionId) {
      case "edit":
        openEditProjectModal(project);
        return;
      case "new-task":
        openTaskEditor(project._id);
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
        onFieldsChange={updateTaskEditorFields}
        onSave={saveTaskEditor}
        onClose={() => setTaskEditor(null)}
        titleAs={isNarrowView ? DialogTitle : undefined}
      />
    ) : null;

  return (
    <CustomSidebarLayout
      className="ajour-project-layout"
      keyboardShortcut={false}
    >
      {isNarrowView && !isNarrowProjectList ? null : (
        <CustomSidebar
          className="ajour-project-navigation-sidebar"
          role="navigation"
          aria-label="Projects"
          collapsible="none"
        >
          <SidebarHeader className="ajour-project-sidebar-header">
            <div className="ajour-project-sidebar-search-row">
              {/* Search opens the command palette, which also finds tasks
                  and backlog items. */}
              <button
                type="button"
                className="ajour-project-sidebar-command-trigger"
                aria-label="Search"
                aria-keyshortcuts={commandPaletteAriaKeys}
                onClick={openCommandPalette}
              >
                <span>Search</span>
              </button>
              <TooltipButton
                className={cn(
                  "entries-header-add",
                  projectModalState?.mode === "create" && "is-open",
                )}
                label="New project"
                onClick={openCreateProjectModal}
              >
                <Plus className="h-3.5 w-3.5" />
              </TooltipButton>
            </div>
          </SidebarHeader>

          <SidebarContent>
            <SidebarGroup>
              <SidebarGroupContent>
                <SidebarMenu>
                  {activeProjects.map((project) => {
                    const isActive = project._id === selectedProjectId;
                    const projectIndex = activeProjectIds.indexOf(project._id);
                    const isDraggedProject =
                      projectDragState?.projectId === project._id;
                    const rowShift = projectDragState
                      ? getSharedTableDragRowShift({
                          itemIndex: projectIndex,
                          originIndex: projectDragState.originIndex,
                          targetIndex: projectDragState.targetIndex,
                          rowHeight: projectDragState.height,
                        })
                      : 0;
                    const projectActions = getProjectActions(project);
                    return (
                      <ObjectContextMenu
                        key={project._id}
                        actions={projectActions}
                        onAction={(actionId) =>
                          runProjectAction(project, actionId)
                        }
                        render={
                          <SidebarMenuItem
                            ref={(node) => {
                              if (node) {
                                projectRowRefs.current.set(project._id, node);
                                return;
                              }

                              projectRowRefs.current.delete(project._id);
                            }}
                            className={cn(
                              "ajour-project-sidebar-item",
                              canReorderProjects && "is-reorderable",
                              pressedProjectId === project._id && "is-pressing",
                              rowShift !== 0 && "is-shifting",
                              isDraggedProject && "is-drag-source",
                            )}
                            style={
                              rowShift !== 0
                                ? {
                                    transform: `translate3d(0, ${rowShift}px, 0)`,
                                  }
                                : undefined
                            }
                            aria-grabbed={isDraggedProject}
                            {...{ [FOCUS_ATTRIBUTES.project]: project._id }}
                            onPointerDown={(event) =>
                              handleProjectPointerDown(project._id, event)
                            }
                          />
                        }
                      >
                        <CustomSidebarMenuButton
                          tooltip={{
                            children: getProjectDisplayName(project),
                            side: "right",
                            // The sidebar never collapses; only the 48px rail hides the name.
                            hidden: false,
                            className: RAIL_ONLY_TOOLTIP,
                          }}
                          onDragStart={(event) => {
                            event.preventDefault();
                          }}
                          onClick={(event) => {
                            if (
                              performance.now() <
                              suppressProjectClickUntilRef.current
                            ) {
                              event.preventDefault();
                              event.stopPropagation();
                              return;
                            }
                            handleLeaveProjectClick(event, project._id);
                          }}
                          render={
                            <Link
                              to="/projects/$projectId"
                              params={{ projectId: project._id }}
                              aria-label={getProjectDisplayName(project)}
                              draggable={false}
                              // Alt+Up and Alt+Down reorder, like a drag. No other item key acts on projects.
                              onKeyDown={(event) =>
                                handleItemKeyDown(event, {
                                  actions: projectActions,
                                  keys: {},
                                  onAction: (actionId) =>
                                    runProjectAction(project, actionId),
                                  onReorder: (step) =>
                                    reorderProject(project._id, step),
                                })
                              }
                              onDragStart={(event) => {
                                event.preventDefault();
                              }}
                            />
                          }
                          isActive={isActive}
                        >
                          <ProjectIcon
                            icon={project.icon}
                            color={project.color}
                            className="ajour-sidebar-icon"
                          />
                          <span data-sidebar-collapsed="hide">
                            {getProjectDisplayName(project)}
                          </span>
                          {project.code ? (
                            <span className="ajour-sidebar-code">
                              {project.code}
                            </span>
                          ) : null}
                        </CustomSidebarMenuButton>
                        <ObjectActionsButton
                          actions={projectActions}
                          onAction={(actionId) =>
                            runProjectAction(project, actionId)
                          }
                          label={`Actions for ${getProjectDisplayName(project)}`}
                        />
                      </ObjectContextMenu>
                    );
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>

          <SidebarFooter className="ajour-project-sidebar-footer">
            <TooltipButton
              label="Archived projects"
              side="right"
              tooltipClassName={RAIL_ONLY_TOOLTIP}
              render={
                <Link
                  to="/projects/archive"
                  className={`ajour-project-sidebar-archive-trigger ${
                    isArchivePage ? "is-active" : ""
                  }`}
                  onClick={(event) => handleLeaveProjectClick(event, null)}
                />
              }
            >
              <Archive />
              <span data-sidebar-collapsed="hide">Archive</span>
            </TooltipButton>
            {/* Wide windows keep project import and export as a settings page. */}
            {isNarrowView ? (
              <Link
                to="/settings/projects"
                className="ajour-project-sidebar-archive-trigger"
              >
                <FileTransfer />
                <span>Import and export</span>
              </Link>
            ) : null}
          </SidebarFooter>
        </CustomSidebar>
      )}

      {draggedProject && projectDragState ? (
        <div
          className="ajour-project-sidebar-drag-preview"
          style={{
            width: projectDragState.width,
            minHeight: projectDragState.height,
            transform: getSharedTableDragOverlayTransform(projectDragState),
          }}
        >
          <ProjectIcon
            icon={draggedProject.icon}
            color={draggedProject.color}
            className="ajour-sidebar-icon"
          />
          <span className="min-w-0 flex-1 truncate">{draggedProject.name}</span>
          {draggedProject.code ? (
            <span className="ajour-sidebar-code">{draggedProject.code}</span>
          ) : null}
        </div>
      ) : null}

      {isNarrowProjectList ? null : (
        <div className="settings-content">
          {isArchivePage ? (
            <ArchivedProjectsView
              projects={archivedProjects}
              onProjectAction={runProjectAction}
            />
          ) : selectedProject ? (
            <ProjectDetail
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
              editingTaskId={visibleTaskEditor?.taskId}
              onProjectAction={runProjectAction}
              onOpenTask={(task) => openTaskEditor(selectedProject._id, task)}
              onNewTask={() => openTaskEditor(selectedProject._id)}
              onAssignShortcut={(task) =>
                setShortcutRequest({ projectId: selectedProject._id, task })
              }
            />
          ) : (
            <div className="flex min-h-[400px] items-center justify-center">
              <div className="max-w-md text-center">
                <h2 className="text-[15px] font-semibold">
                  {allProjects.length > 0
                    ? "No project selected"
                    : "No projects yet"}
                </h2>
                <p className="mt-2 text-sm text-foreground/65">
                  {allProjects.length > 0
                    ? "Select a project from the sidebar to consult it."
                    : "Create your first project with the + button in the project list."}
                </p>
              </div>
            </div>
          )}
        </div>
      )}

      {taskEditorForm && !isNarrowView ? (
        <SidePanel
          contentKey={visibleTaskEditor?.taskId ?? "new"}
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
    </CustomSidebarLayout>
  );
}
