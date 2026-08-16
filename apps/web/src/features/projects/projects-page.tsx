import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  RiAddLine as Plus,
  RiArchiveLine as Archive,
  RiArrowLeftSLine as ChevronLeft,
  RiArrowRightSLine as ChevronRight,
  RiCloseLine as X,
  RiDownloadLine as Download,
  RiFolderAddLine as FolderPlus,
  RiSearchLine as Search,
  RiPencilLine as Pencil,
  RiRefreshLine as RotateCcw,
  RiSaveLine as Save,
} from "@remixicon/react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { MessagePanel } from "@/components/app-surface";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
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
  formatProjectTaskConsumedBadge,
  formatSignedDurationHoursInput,
  getProjectTaskConsumedTone,
  parseSignedHoursInput,
  type ProjectTaskConsumedTone,
} from "@/domain/projects/task-budget";
import {
  getProjectTaskBillableValueLabel,
  isProjectTaskBillable,
} from "@/features/projects/project-task-options";
import type { ProjectTaskImportResult } from "@/domain/projects/task-import";
import {
  DEFAULT_PROJECT_ICON,
  type LocalProjectIcon,
  type ProjectIconName,
} from "@/domain/projects/project-icon";
import {
  formatClockDuration,
  formatDurationHoursInput,
  parseHoursInput,
} from "@/domain/time/duration";
import {
  getLocalProjectDisplayName,
  type LocalProject,
  type LocalProjectTask,
} from "@/domain/local-state";
import { useCurrentTeam } from "@/lib/session";
import { useLocalState } from "@/lib/local-hooks";
import { localStore } from "@/lib/local-store";
import {
  createSharedTableDragPointerSession,
  getSharedTableDragOverlayTransform,
  getSharedTableDragRowShift,
  getSharedTableDragTargetIndex,
  setSharedTableDragDocumentState,
  SHARED_TABLE_DRAG_CLICK_SUPPRESSION_MS,
  type SharedTableDragPointerSession,
} from "@/lib/table-drag";
import {
  PROJECT_ICON_PRESETS,
  prepareUploadedProjectIcon,
  ProjectIcon,
} from "@/lib/project-icons";
import { cn } from "@/lib/utils";

type ProjectMetrics = {
  durationMs: number;
  entryCount: number;
};

type TaskMetricsByProject = Map<string, Map<string, ProjectMetrics>>;

type ProjectDraft = {
  name: string;
  displayName: string;
  code: string;
  color: string;
  icon: LocalProjectIcon;
};

type TaskEditDraft = {
  name: string;
  billable: boolean;
  budget: string;
  adjustment: string;
};

type ProjectModalState =
  | { mode: "create" }
  | { mode: "edit"; projectId: string };

type ProjectCommandView = "main" | "task-projects";
type ProjectTaskFilter = "active" | "archived";

const defaultProjectDraft: ProjectDraft = {
  name: "",
  displayName: "",
  code: "",
  color: "#1f7667",
  icon: DEFAULT_PROJECT_ICON,
};

const defaultTaskEditDraft: TaskEditDraft = {
  name: "",
  billable: true,
  budget: "",
  adjustment: "",
};

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

function moveId(ids: string[], fromIndex: number, toIndex: number) {
  const nextIds = [...ids];
  const [id] = nextIds.splice(fromIndex, 1);
  if (!id) {
    return ids;
  }

  nextIds.splice(toIndex, 0, id);
  return nextIds;
}

/* ── Project detail content ───────────────────────────────────────── */

function ProjectFormModal({
  draft,
  mode,
  onChange,
  onArchive,
  onClose,
  onSubmit,
}: {
  draft: ProjectDraft;
  mode: ProjectModalState["mode"];
  onChange: React.Dispatch<React.SetStateAction<ProjectDraft>>;
  onArchive?: () => void;
  onClose: () => void;
  onSubmit: () => void;
}) {
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const [isArchivePending, setIsArchivePending] = useState(false);
  const [iconError, setIconError] = useState<string | null>(null);
  const [isProcessingUpload, setIsProcessingUpload] = useState(false);
  const title = mode === "create" ? "Create project" : "Edit project";
  const submitLabel = mode === "create" ? "Create project" : "Save changes";

  useEffect(() => {
    setIsArchivePending(false);
  }, [mode, onArchive]);

  useEffect(() => {
    if (!isArchivePending) return;
    const timeoutId = window.setTimeout(() => {
      setIsArchivePending(false);
    }, 2500);
    return () => window.clearTimeout(timeoutId);
  }, [isArchivePending]);

  useEffect(() => {
    function handleMouseDown(event: MouseEvent) {
      if (overlayRef.current === event.target) {
        onClose();
      }
    }

    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [onClose]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const handlePresetSelect = (name: ProjectIconName) => {
    setIconError(null);
    onChange((current) => ({
      ...current,
      icon: { kind: "preset", name },
    }));
  };

  const handleUploadChange = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) {
      return;
    }

    setIsProcessingUpload(true);
    setIconError(null);

    try {
      const nextIconSrc = await prepareUploadedProjectIcon(file);
      onChange((current) => ({
        ...current,
        icon: {
          kind: "upload",
          src: nextIconSrc.src,
          maskSrc: nextIconSrc.maskSrc,
          colorMode:
            current.icon.kind === "upload" && current.icon.colorMode === "native"
              ? "native"
              : "tinted",
        },
      }));
    } catch (error) {
      setIconError(
        error instanceof Error ? error.message : "The favicon could not be used.",
      );
    } finally {
      setIsProcessingUpload(false);
    }
  };

  const handleUploadPickerOpen = () => {
    const input = uploadInputRef.current;
    if (!input) {
      return;
    }

    input.value = "";

    const pickerInput = input as HTMLInputElement & {
      showPicker?: () => void;
    };

    if (typeof pickerInput.showPicker === "function") {
      try {
        pickerInput.showPicker();
        return;
      } catch {
        // Fall back to click() for environments that expose showPicker
        // but still reject it for this interaction path.
      }
    }

    input.click();
  };

  return (
    <div ref={overlayRef} className="time-entry-modal-overlay">
      <div
        className="time-entry-modal project-form-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="project-form-modal-title"
      >
        <div className="time-entry-modal-header">
          <div className="space-y-1">
            <span
              id="project-form-modal-title"
              className="time-entry-modal-title"
            >
              {title}
            </span>
            <p className="project-form-modal-copy">
              Add the project name, display name, short code, icon, and color.
            </p>
          </div>
          <button
            type="button"
            className="time-entry-modal-close"
            aria-label="Close project form"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="project-form-modal-fields">
          <div className="space-y-2">
            <label htmlFor="project-form-name" className="field-label">
              Full name
            </label>
            <Input
              id="project-form-name"
              autoFocus
              placeholder="Full name"
              value={draft.name}
              onChange={(event) =>
                onChange((current) => {
                  const nextName = event.target.value;
                  const displayNameWasSynced =
                    current.displayName.trim() === "" ||
                    current.displayName.trim() === current.name.trim();

                  return {
                    ...current,
                    name: nextName,
                    displayName: displayNameWasSynced
                      ? nextName
                      : current.displayName,
                  };
                })
              }
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="project-form-display-name" className="field-label">
              Display name
            </label>
            <Input
              id="project-form-display-name"
              placeholder="Display name"
              value={draft.displayName}
              onChange={(event) =>
                onChange((current) => ({
                  ...current,
                  displayName: event.target.value,
                }))
              }
            />
          </div>
          <div className="project-icon-field">
            <div className="project-icon-field-copy">
              <span className="project-icon-field-label">Project icon</span>
              <p className="project-form-modal-copy">
                Pick a preset or upload a favicon-sized icon. Uploaded icons can
                use the project color or keep their native colors.
              </p>
            </div>

            <div className="project-icon-field-toolbar">
              <div className="project-icon-preview">
                <ProjectIcon
                  icon={draft.icon}
                  color={draft.color}
                  className="size-5"
                />
                <span className="project-icon-preview-label">
                  {draft.icon.kind === "upload" ? "Uploaded favicon" : "Preset"}
                </span>
              </div>

              <input
                id="project-form-icon-upload"
                ref={uploadInputRef}
                type="file"
                accept=".png,.svg,.ico,image/png,image/svg+xml,image/x-icon,image/vnd.microsoft.icon"
                className="sr-only"
                onChange={(event) => {
                  void handleUploadChange(event);
                }}
              />
              <Button
                type="button"
                variant={draft.icon.kind === "upload" ? "default" : "outline"}
                size="sm"
                disabled={isProcessingUpload}
                onClick={handleUploadPickerOpen}
              >
                {isProcessingUpload ? "Preparing icon" : "Upload favicon"}
              </Button>
              <Button
                type="button"
                variant={
                  draft.icon.kind === "upload" &&
                  draft.icon.colorMode === "native"
                    ? "default"
                    : "outline"
                }
                size="sm"
                disabled={draft.icon.kind !== "upload"}
                onClick={() =>
                  onChange((current) => {
                    if (current.icon.kind !== "upload") {
                      return current;
                    }

                    return {
                      ...current,
                      icon: {
                        ...current.icon,
                        colorMode:
                          current.icon.colorMode === "native"
                            ? "tinted"
                            : "native",
                      },
                    };
                  })
                }
              >
                Keep native colors
              </Button>
            </div>

            <div className="project-icon-preset-grid" role="list">
              {PROJECT_ICON_PRESETS.map((preset) => {
                const isSelected =
                  draft.icon.kind === "preset" && draft.icon.name === preset.name;

                return (
                  <button
                    key={preset.name}
                    type="button"
                    role="listitem"
                    className={cn(
                      "project-icon-preset-button",
                      isSelected && "is-selected",
                    )}
                    aria-label={`Use ${preset.label} icon`}
                    title={preset.label}
                    onClick={() => handlePresetSelect(preset.name)}
                  >
                    <ProjectIcon
                      icon={{ kind: "preset", name: preset.name }}
                      color={draft.color}
                      className="size-4"
                    />
                  </button>
                );
              })}
            </div>

            {iconError ? <span className="field-error">{iconError}</span> : null}
          </div>
          <div className="grid gap-3 sm:grid-cols-[1fr_110px]">
            <div className="space-y-2">
              <label htmlFor="project-form-code" className="field-label">
                Code
              </label>
              <Input
                id="project-form-code"
                placeholder="Code"
                value={draft.code}
                onChange={(event) =>
                  onChange((current) => ({
                    ...current,
                    code: event.target.value,
                  }))
                }
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="project-form-color" className="field-label">
                Color
              </label>
              <label className="project-color-picker">
                <span
                  className="project-color-picker-swatch"
                  style={{ backgroundColor: draft.color }}
                  aria-hidden="true"
                />
                <input
                  id="project-form-color"
                  className="project-color-picker-input"
                  aria-label="Project color"
                  type="color"
                  value={draft.color}
                  onChange={(event) =>
                    onChange((current) => ({
                      ...current,
                      color: event.target.value,
                    }))
                  }
                />
              </label>
            </div>
          </div>
        </div>

        <div className="time-entry-modal-actions project-form-modal-actions">
          {mode === "edit" && onArchive ? (
            <Button
              variant="outline"
              className={cn(
                "project-form-archive-action gap-2",
                isArchivePending && "is-confirming",
              )}
              aria-label={
                isArchivePending ? "Confirm archive project" : "Archive project"
              }
              title={
                isArchivePending ? "Confirm archive project" : "Archive project"
              }
              onClick={() => {
                if (isArchivePending) {
                  onArchive();
                  return;
                }
                setIsArchivePending(true);
              }}
            >
              <Archive className="h-4 w-4" />
              {isArchivePending ? "Confirm" : "Archive"}
            </Button>
          ) : null}
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            className="gap-2"
            disabled={!draft.name.trim()}
            onClick={onSubmit}
          >
            {mode === "create" ? (
              <FolderPlus className="h-4 w-4" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            {submitLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

function ProjectTaskCreateModal({
  draft,
  onChange,
  onClose,
  onSubmit,
  project,
}: {
  draft: string;
  onChange: React.Dispatch<React.SetStateAction<string>>;
  onClose: () => void;
  onSubmit: () => void;
  project: LocalProject | null;
}) {
  return (
    <Dialog open={Boolean(project)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="project-task-create-dialog max-w-lg gap-4"
        showCloseButton
      >
        <DialogHeader className="gap-1">
          <DialogTitle>Create task</DialogTitle>
          <DialogDescription>
            {project
              ? `Add a task to ${getProjectDisplayName(project)}${project.code ? ` (${project.code})` : ""}.`
              : "Add a task to the selected project."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {project ? (
            <div className="project-task-create-project">
              <span className="project-task-create-project-label">Project</span>
              <div className="flex items-center gap-2">
                <ProjectIcon
                  icon={project.icon}
                  color={project.color}
                  className="harday-sidebar-icon"
                />
                <span className="font-medium text-foreground">
                  {getProjectDisplayName(project)}
                </span>
                {project.code ? <Badge>{project.code}</Badge> : null}
              </div>
            </div>
          ) : null}

          <Input
            autoFocus
            placeholder="Task name"
            value={draft}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && draft.trim()) {
                event.preventDefault();
                onSubmit();
              }

              if (event.key === "Escape") {
                event.preventDefault();
                onClose();
              }
            }}
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!project || !draft.trim()} onClick={onSubmit}>
            <Plus data-icon="inline-start" />
            Create task
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ArchivedProjectsView({ projects }: { projects: LocalProject[] }) {
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
                projects.map((project) => (
                  <tr key={project._id}>
                    <td>
                      <div className="project-task-name-cell">
                        <ProjectIcon
                          icon={project.icon}
                          color={project.color}
                          className="harday-sidebar-icon"
                        />
                        <span className="project-task-name">
                          {getProjectDisplayName(project)}
                        </span>
                        {project.code ? <Badge>{project.code}</Badge> : null}
                      </div>
                    </td>
                    <td className="entry-hours-cell">
                      <div className="entry-hours-content">
                        <Button
                          variant="outline"
                          size="sm"
                          className="gap-2"
                          onClick={() =>
                            localStore.unarchiveProject(project._id)
                          }
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                          Unarchive
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))
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
  onEditProject,
}: {
  project: LocalProject;
  metrics: ProjectMetrics;
  taskMetrics: Map<string, ProjectMetrics>;
  onEditProject: (project: LocalProject) => void;
}) {
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const taskRowRefs = useRef(new Map<string, HTMLTableRowElement>());
  const taskEditDropdownRef = useRef<HTMLDivElement | null>(null);
  const taskPointerSessionRef = useRef<SharedTableDragPointerSession | null>(
    null,
  );
  const taskDragStateRef = useRef<TaskDragState | null>(null);
  const suppressTaskClickUntilRef = useRef(0);
  const [showTaskForm, setShowTaskForm] = useState(false);
  const [taskDraft, setTaskDraft] = useState("");
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [taskEditDraft, setTaskEditDraft] = useState(defaultTaskEditDraft);
  const [pendingArchiveTaskId, setPendingArchiveTaskId] = useState<
    string | null
  >(null);
  const [isImporting, setIsImporting] = useState(false);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [pressedTaskId, setPressedTaskId] = useState<string | null>(null);
  const [taskFilter, setTaskFilter] = useState<ProjectTaskFilter>("active");
  const [taskDragState, setTaskDragState] = useState<TaskDragState | null>(
    null,
  );
  const isArchived = project.status === "archived";

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
  const editingTask =
    editingTaskId
      ? (project.tasks.find((task) => task._id === editingTaskId) ?? null)
      : null;
  const editingTaskTrackedMs = editingTask
    ? (taskMetrics.get(editingTask._id)?.durationMs ?? 0)
    : 0;
  const parsedBudgetMs =
    taskEditDraft.budget.trim().length === 0
      ? undefined
      : parseHoursInput(taskEditDraft.budget);
  const parsedAdjustmentMs =
    taskEditDraft.adjustment.trim().length === 0
      ? undefined
      : parseSignedHoursInput(taskEditDraft.adjustment);
  const budgetError =
    taskEditDraft.budget.trim().length > 0 && parsedBudgetMs === null
      ? "Enter a valid non-negative duration."
      : null;
  const adjustmentError =
    taskEditDraft.adjustment.trim().length > 0 && parsedAdjustmentMs === null
      ? "Enter a valid signed duration."
      : null;
  const taskFilters: {
    value: ProjectTaskFilter;
    label: string;
    count: number;
  }[] = [
    { value: "active", label: "Active", count: summary.active },
    { value: "archived", label: "Archived", count: summary.archived },
  ];
  const visibleTasks = taskFilter === "archived" ? archivedTasks : activeTasks;
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
    !isArchived &&
    taskFilter === "active" &&
    !showTaskForm &&
    !editingTaskId &&
    activeTasks.length > 1;

  useEffect(() => {
    setTaskFilter("active");
    setShowTaskForm(false);
    setTaskDraft("");
    setEditingTaskId(null);
    setTaskEditDraft(defaultTaskEditDraft);
    setPendingArchiveTaskId(null);
    setImportMessage(null);
    setImportError(null);
    if (importInputRef.current) {
      importInputRef.current.value = "";
    }
  }, [project._id, project.status]);

  useEffect(() => {
    if (!pendingArchiveTaskId) return;
    const timeoutId = window.setTimeout(() => {
      setPendingArchiveTaskId((current) =>
        current === pendingArchiveTaskId ? null : current,
      );
    }, 2500);
    return () => window.clearTimeout(timeoutId);
  }, [pendingArchiveTaskId]);

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
      const workbook = await extractTaskNamesFromWorkbook(await file.arrayBuffer());
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

  function handleArchiveTask(taskId: string) {
    if (isArchived) return;
    if (pendingArchiveTaskId === taskId) {
      localStore.archiveProjectTask(project._id, taskId);
      setPendingArchiveTaskId(null);
      return;
    }
    setPendingArchiveTaskId(taskId);
  }

  function handleTaskClick(task: LocalProjectTask) {
    if (isArchived) return;
    if (performance.now() < suppressTaskClickUntilRef.current) return;
    if (editingTaskId === task._id) return;
    setPendingArchiveTaskId(null);
    setEditingTaskId(task._id);
    setTaskEditDraft({
      name: task.name,
      billable: isProjectTaskBillable(task),
      budget:
        typeof task.budgetMs === "number"
          ? formatDurationHoursInput(task.budgetMs)
          : "",
      adjustment:
        typeof task.adjustmentMs === "number"
          ? formatSignedDurationHoursInput(task.adjustmentMs)
          : "",
    });
  }

  function closeTaskEditor() {
    setEditingTaskId(null);
    setTaskEditDraft(defaultTaskEditDraft);
  }

  function commitTaskEdit() {
    if (!editingTaskId) {
      return false;
    }
    const trimmed = taskEditDraft.name.trim();
    if (!trimmed || parsedBudgetMs === null || parsedAdjustmentMs === null) {
      closeTaskEditor();
      return false;
    }

    localStore.updateProjectTask(project._id, editingTaskId, {
      name: trimmed,
      billable: taskEditDraft.billable,
      budgetMs: parsedBudgetMs,
      adjustmentMs: parsedAdjustmentMs,
    });
    closeTaskEditor();
    return true;
  }

  function autosaveTaskEditor() {
    if (!editingTaskId) {
      return;
    }

    commitTaskEdit();
  }

  useEffect(() => {
    if (!editingTaskId) {
      return;
    }

    function handleDocumentMouseDown(event: MouseEvent) {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }

      const footerZone =
        target instanceof Element
          ? target.closest(".project-task-edit-footer")
          : null;
      if (footerZone) {
        autosaveTaskEditor();
        return;
      }

      if (taskEditDropdownRef.current?.contains(target)) {
        return;
      }

      autosaveTaskEditor();
    }

    document.addEventListener("mousedown", handleDocumentMouseDown);
    return () => document.removeEventListener("mousedown", handleDocumentMouseDown);
  }, [autosaveTaskEditor, editingTaskId]);

  function handleTaskPointerDown(
    taskId: string,
    event: React.PointerEvent<HTMLTableRowElement>,
  ) {
    if (
      !canReorderTasks ||
      event.button !== 0 ||
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
      setPendingArchiveTaskId(null);
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

  return (
    <div className="space-y-6">
      {/* Project header */}
      <div className="flex flex-col gap-4">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
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
            {!isArchived ? (
              <Button
                variant="ghost"
                className="project-header-icon-button"
                aria-label="Edit project"
                title="Edit project"
                onClick={() => onEditProject(project)}
              >
                <Pencil />
              </Button>
            ) : null}
            {isArchived ? (
              <Button
                variant="ghost"
                className="project-header-icon-button"
                aria-label="Restore project"
                title="Restore project"
                onClick={() => localStore.unarchiveProject(project._id)}
              >
                <RotateCcw />
              </Button>
            ) : null}
          </div>
        </div>
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
                onClick={() => {
                  setTaskFilter(filter.value);
                  setShowTaskForm(false);
                  setTaskDraft("");
                  setEditingTaskId(null);
                  setPendingArchiveTaskId(null);
                }}
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
      {importMessage ? (
        <MessagePanel className="border border-[var(--success-muted)] bg-[var(--success-muted)] text-foreground">
          {importMessage}
        </MessagePanel>
      ) : null}
      {importError ? (
        <MessagePanel tone="warning" className="border border-[var(--danger-muted)] text-foreground">
          {importError}
        </MessagePanel>
      ) : null}

      {/* Active tasks table */}
      <div className="entries-table-scroll-shell entries-table-scroll-shell-project">
        <table className="entries-table project-tasks-table entries-table-header-table animate-in">
          <thead>
            <tr>
              <th>Task</th>
              <th className="entry-hours-heading entry-hours-heading-actions">
                {!isArchived && !isArchivedTaskFilter ? (
                  <div className="flex items-center justify-end gap-1">
                    <input
                      ref={importInputRef}
                      type="file"
                      accept=".xlsx,.xls,.xlsm"
                      className="hidden"
                      onChange={(event) => {
                        void handleTaskImport(event);
                      }}
                    />
                    <button
                      type="button"
                      className="entries-header-add"
                      aria-label={
                        isImporting
                          ? "Importing tasks"
                          : "Import tasks from Excel"
                      }
                      title={
                        isImporting
                          ? "Importing tasks"
                          : "Import tasks from Excel"
                      }
                      disabled={isImporting}
                      onClick={() => importInputRef.current?.click()}
                    >
                      <Download className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      className={cn(
                        "entries-header-add entries-header-bubble",
                        showTaskForm && "is-open",
                      )}
                      aria-label={showTaskForm ? "Cancel new task" : "Add task"}
                      onClick={() => {
                        setShowTaskForm((c) => !c);
                        setTaskDraft("");
                      }}
                    >
                      <span className="entries-header-add-label">New task</span>
                      <Plus className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ) : null}
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
            <tbody>
              {showTaskForm && !isArchivedTaskFilter ? (
                <tr
                  className="entry-edit-row"
                  onClick={(e) => e.stopPropagation()}
                >
                  <td colSpan={2}>
                    <div className="entry-edit-dropdown entry-create-dropdown">
                      <div className="entry-edit-dropdown-grid">
                        <label className="field entry-field-span-2">
                          <span className="field-label">Task name</span>
                          <input
                            autoFocus
                            className="field-input"
                            value={taskDraft}
                            onChange={(e) => setTaskDraft(e.target.value)}
                            placeholder="New task name"
                            onKeyDown={(e) => {
                              if (e.key === "Enter" && taskDraft.trim()) {
                                e.preventDefault();
                                localStore.addProjectTask(
                                  project._id,
                                  taskDraft.trim(),
                                );
                                setTaskDraft("");
                                setShowTaskForm(false);
                              }
                              if (e.key === "Escape") {
                                setShowTaskForm(false);
                                setTaskDraft("");
                              }
                            }}
                          />
                        </label>
                      </div>
                    </div>
                  </td>
                </tr>
              ) : null}

              {visibleTasks.length === 0 && !showTaskForm ? (
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
                          <Button
                            type="button"
                            size="sm"
                            onClick={() => {
                              setShowTaskForm(true);
                              setTaskDraft("");
                            }}
                          >
                            <Plus data-icon="inline-start" />
                            Create a task
                          </Button>
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            disabled={isImporting}
                            onClick={() => importInputRef.current?.click()}
                          >
                            <Download data-icon="inline-start" />
                            {isImporting ? "Importing" : "Import tasks"}
                          </Button>
                        </EmptyContent>
                      ) : null}
                    </Empty>
                  </td>
                </tr>
              ) : null}

              {isArchivedTaskFilter
                ? archivedTasks.map((task) => {
                    const trackedMetrics = taskMetrics.get(task._id) ?? {
                      durationMs: 0,
                      entryCount: 0,
                    };

                    return (
                      <tr key={task._id} className="project-task-row">
                        <td>
                          <div className="project-task-name-cell">
                            <span className="project-task-name">
                              {task.name}
                            </span>
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
                            {!isArchived ? (
                              <div className="entry-row-actions">
                                <span className="entry-row-action-slot">
                                  <button
                                    type="button"
                                    className="entry-row-action"
                                    aria-label="Unarchive task"
                                    onClick={() => {
                                      localStore.unarchiveProjectTask(
                                        project._id,
                                        task._id,
                                      );
                                    }}
                                  >
                                    <RotateCcw className="h-3.5 w-3.5" />
                                  </button>
                                </span>
                              </div>
                            ) : null}
                            <span
                              className={cn(
                                "hours-badge",
                                projectTaskToneClassName[
                                  getProjectTaskConsumedTone({
                                    budgetMs: task.budgetMs,
                                    trackedMs: trackedMetrics.durationMs,
                                    adjustmentMs: task.adjustmentMs,
                                  })
                                ],
                              )}
                            >
                              {formatProjectTaskConsumedBadge({
                                budgetMs: task.budgetMs,
                                trackedMs: trackedMetrics.durationMs,
                                adjustmentMs: task.adjustmentMs,
                              })}
                            </span>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                : activeTasks.map((task, index) => {
                    const isEditing = editingTaskId === task._id;
                    const isArchivePending = pendingArchiveTaskId === task._id;
                    const trackedMetrics = taskMetrics.get(task._id) ?? {
                      durationMs: 0,
                      entryCount: 0,
                    };
                    const isDraggedTask = taskDragState?.taskId === task._id;
                    const rowShift = taskDragState
                      ? getSharedTableDragRowShift({
                          itemIndex: index,
                          originIndex: taskDragState.originIndex,
                          targetIndex: taskDragState.targetIndex,
                          rowHeight: taskDragState.height,
                        })
                      : 0;

                    return isEditing ? (
                      <tr
                        key={task._id}
                        className="entry-edit-row"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <td colSpan={2}>
                          <div
                            ref={taskEditDropdownRef}
                            className="entry-edit-dropdown"
                            onBlur={(event) => {
                              const nextTarget = event.relatedTarget;
                              if (
                                nextTarget instanceof Node &&
                                event.currentTarget.contains(nextTarget)
                              ) {
                                return;
                              }

                              autosaveTaskEditor();
                            }}
                          >
                            <div className="project-task-edit-layout">
                              <div className="project-task-edit-primary">
                                <label className="field">
                                  <span className="field-label">Task name</span>
                                  <input
                                    autoFocus
                                    className="field-input"
                                    value={taskEditDraft.name}
                                    onChange={(e) =>
                                      setTaskEditDraft((current) => ({
                                        ...current,
                                        name: e.target.value,
                                      }))
                                    }
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter") {
                                        e.preventDefault();
                                        commitTaskEdit();
                                      }
                                      if (e.key === "Escape") {
                                        autosaveTaskEditor();
                                      }
                                    }}
                                  />
                                </label>
                                <div className="project-task-edit-billable">
                                  <span className="field-label">Billable</span>
                                  <label className="project-task-billable-toggle">
                                    <Checkbox
                                      checked={taskEditDraft.billable}
                                      onCheckedChange={(checked) =>
                                        setTaskEditDraft((current) => ({
                                          ...current,
                                          billable: checked,
                                        }))
                                      }
                                    />
                                    <span>
                                      {taskEditDraft.billable
                                        ? "Billable"
                                        : "Non-billable"}
                                    </span>
                                  </label>
                                </div>
                              </div>
                              <div className="project-task-edit-metrics">
                                <label className="field">
                                  <span className="field-label">Tracked time</span>
                                  <input
                                    className="field-input"
                                    value={formatDurationHoursInput(
                                      editingTaskTrackedMs,
                                    )}
                                    readOnly
                                  />
                                </label>
                                <label className="field">
                                  <span className="field-label">Budget</span>
                                  <input
                                    className="field-input"
                                    value={taskEditDraft.budget}
                                    placeholder="Optional"
                                    onChange={(e) =>
                                      setTaskEditDraft((current) => ({
                                        ...current,
                                        budget: e.target.value,
                                      }))
                                    }
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter") {
                                        e.preventDefault();
                                        commitTaskEdit();
                                      }
                                      if (e.key === "Escape") {
                                        autosaveTaskEditor();
                                      }
                                    }}
                                  />
                                  {budgetError ? (
                                    <span className="field-error">
                                      {budgetError}
                                    </span>
                                  ) : null}
                                </label>
                                <label className="field">
                                  <span className="field-label">Adjustment</span>
                                  <input
                                    className="field-input"
                                    value={taskEditDraft.adjustment}
                                    placeholder="Optional"
                                    onChange={(e) =>
                                      setTaskEditDraft((current) => ({
                                        ...current,
                                        adjustment: e.target.value,
                                      }))
                                    }
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter") {
                                        e.preventDefault();
                                        commitTaskEdit();
                                      }
                                      if (e.key === "Escape") {
                                        autosaveTaskEditor();
                                      }
                                    }}
                                  />
                                  {adjustmentError ? (
                                    <span className="field-error">
                                      {adjustmentError}
                                    </span>
                                  ) : null}
                                </label>
                              </div>
                            </div>
                            <div className="project-task-edit-footer" aria-hidden="true" />
                          </div>
                        </td>
                      </tr>
                    ) : (
                      <tr
                        key={task._id}
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
                        )}
                        style={
                          rowShift !== 0
                            ? { transform: `translate3d(0, ${rowShift}px, 0)` }
                            : undefined
                        }
                        aria-grabbed={isDraggedTask}
                        onClick={() => handleTaskClick(task)}
                        onPointerDown={(event) =>
                          handleTaskPointerDown(task._id, event)
                        }
                      >
                        <td>
                          <div className="project-task-name-cell">
                            <span className="project-task-name">
                              {task.name}
                            </span>
                            <Badge className="project-task-billable-badge bg-muted">
                              {getProjectTaskBillableValueLabel(task)}
                            </Badge>
                          </div>
                        </td>
                        <td className="entry-hours-cell">
                          <div className="entry-hours-content">
                            {!isArchived ? (
                              <div
                                className={cn(
                                  "entry-row-actions",
                                  isArchivePending && "is-confirming",
                                )}
                              >
                                <span className="entry-row-action-slot">
                                  <button
                                    type="button"
                                    className={cn(
                                      "entry-row-action",
                                      "entry-row-action-delete",
                                      isArchivePending && "is-confirming",
                                    )}
                                    aria-label={
                                      isArchivePending
                                        ? "Confirm archive"
                                        : "Archive task"
                                    }
                                    data-no-task-drag="true"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleArchiveTask(task._id);
                                    }}
                                  >
                                    <Archive className="h-3.5 w-3.5" />
                                    {isArchivePending ? (
                                      <span>Confirm</span>
                                    ) : null}
                                  </button>
                                </span>
                              </div>
                            ) : null}
                            <span
                              className={cn(
                                "hours-badge",
                                projectTaskToneClassName[
                                  getProjectTaskConsumedTone({
                                    budgetMs: task.budgetMs,
                                    trackedMs: trackedMetrics.durationMs,
                                    adjustmentMs: task.adjustmentMs,
                                  })
                                ],
                              )}
                            >
                              {formatProjectTaskConsumedBadge({
                                budgetMs: task.budgetMs,
                                trackedMs: trackedMetrics.durationMs,
                                adjustmentMs: task.adjustmentMs,
                              })}
                            </span>
                          </div>
                        </td>
                      </tr>
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
            <Badge className="project-task-billable-badge bg-muted">
              {getProjectTaskBillableValueLabel(draggedTask)}
            </Badge>
          </div>
          <span
            className={cn(
              "hours-badge",
              projectTaskToneClassName[
                getProjectTaskConsumedTone({
                  budgetMs: draggedTask.budgetMs,
                  trackedMs:
                    (taskMetrics.get(draggedTask._id) ?? { durationMs: 0 })
                      .durationMs,
                  adjustmentMs: draggedTask.adjustmentMs,
                })
              ],
            )}
          >
            {formatProjectTaskConsumedBadge({
              budgetMs: draggedTask.budgetMs,
              trackedMs:
                (taskMetrics.get(draggedTask._id) ?? { durationMs: 0 })
                  .durationMs,
              adjustmentMs: draggedTask.adjustmentMs,
            })}
          </span>
        </div>
      ) : null}
    </div>
  );
}

/* ── Projects page ────────────────────────────────────────────────── */

export function ProjectsPage() {
  const teamState = useCurrentTeam();
  const state = useLocalState();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const projectRowRefs = useRef(new Map<string, HTMLLIElement>());
  const projectPointerSessionRef = useRef<SharedTableDragPointerSession | null>(
    null,
  );
  const projectDragStateRef = useRef<ProjectDragState | null>(null);
  const suppressProjectClickUntilRef = useRef(0);
  const [projectModalState, setProjectModalState] =
    useState<ProjectModalState | null>(null);
  const [projectDraft, setProjectDraft] = useState(defaultProjectDraft);
  const [isProjectCommandOpen, setIsProjectCommandOpen] = useState(false);
  const [projectCommandView, setProjectCommandView] =
    useState<ProjectCommandView>("main");
  const [projectCommandQuery, setProjectCommandQuery] = useState("");
  const [taskCreationProjectId, setTaskCreationProjectId] = useState<
    string | null
  >(null);
  const [taskCreationDraft, setTaskCreationDraft] = useState("");
  const [pressedProjectId, setPressedProjectId] = useState<string | null>(null);
  const [projectDragState, setProjectDragState] =
    useState<ProjectDragState | null>(null);
  const allProjects = state.projects;
  const hasProjectCommandQuery = projectCommandQuery.trim() !== "";

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

  const projectMatchesQuery = (
    project: LocalProject,
    normalizedQuery: string,
  ) =>
    [project.name, getProjectDisplayName(project), project.code ?? ""].some(
      (value) => value.toLowerCase().includes(normalizedQuery),
    );

  const filteredCommandProjects = useMemo(() => {
    const normalizedQuery = projectCommandQuery.trim().toLowerCase();
    if (!normalizedQuery) return activeProjects;
    return activeProjects.filter((project) =>
      projectMatchesQuery(project, normalizedQuery),
    );
  }, [activeProjects, projectCommandQuery]);

  const filteredCommandArchivedProjects = useMemo(() => {
    const normalizedQuery = projectCommandQuery.trim().toLowerCase();
    if (!normalizedQuery) return archivedProjects;
    return archivedProjects.filter((project) =>
      projectMatchesQuery(project, normalizedQuery),
    );
  }, [archivedProjects, projectCommandQuery]);

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
  const selectedTaskCreationProject = taskCreationProjectId
    ? (allProjects.find((project) => project._id === taskCreationProjectId) ??
      null)
    : null;
  const primaryTaskProject =
    selectedProject?.status === "active"
      ? selectedProject
      : (activeProjects[0] ?? null);
  const draggedProject = projectDragState
    ? (activeProjects.find(
        (project) => project._id === projectDragState.projectId,
      ) ?? null)
    : null;
  const canReorderProjects = activeProjects.length > 1;

  useEffect(() => {
    projectDragStateRef.current = projectDragState;
  }, [projectDragState]);

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

      if (shouldCommit && currentDrag.originIndex !== currentDrag.targetIndex) {
        localStore.reorderProjects(
          moveId(
            activeProjectIds,
            currentDrag.originIndex,
            currentDrag.targetIndex,
          ),
        );
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

  // Auto-select the first available project if the current URL does not resolve.
  useEffect(() => {
    if (pathname === "/projects/archive") return;
    if (pathname !== "/projects" && !pathname.startsWith("/projects/")) return;
    const firstProject = activeProjects[0] ?? archivedProjects[0];
    if (!firstProject || selectedProject) return;
    void navigate({
      to: "/projects/$projectId",
      params: { projectId: firstProject._id },
      replace: true,
    });
  }, [activeProjects, archivedProjects, navigate, pathname, selectedProject]);

  if (!teamState?.team) return null;

  const closeProjectModal = () => {
    setProjectDraft({ ...defaultProjectDraft, icon: DEFAULT_PROJECT_ICON });
    setProjectModalState(null);
  };

  const openCreateProjectModal = () => {
    setProjectDraft({ ...defaultProjectDraft, icon: DEFAULT_PROJECT_ICON });
    setProjectModalState({ mode: "create" });
  };

  const closeProjectCommand = () => {
    setIsProjectCommandOpen(false);
    setProjectCommandView("main");
    setProjectCommandQuery("");
  };

  const openTaskCreateModal = (projectId: string) => {
    closeProjectCommand();
    setTaskCreationProjectId(projectId);
    setTaskCreationDraft("");
  };

  const closeTaskCreateModal = () => {
    setTaskCreationProjectId(null);
    setTaskCreationDraft("");
  };

  const openEditProjectModal = (project: LocalProject) => {
    setProjectDraft({
      name: project.name,
      displayName: getProjectDisplayName(project),
      code: project.code ?? "",
      color: project.color,
      icon: project.icon,
    });
    setProjectModalState({ mode: "edit", projectId: project._id });
  };

  const handleProjectSubmit = () => {
    if (!projectModalState || !projectDraft.name.trim()) {
      return;
    }

    if (projectModalState.mode === "create") {
      const nextId = localStore.addProject({
        name: projectDraft.name.trim(),
        displayName:
          projectDraft.displayName.trim() || projectDraft.name.trim(),
        code: projectDraft.code.trim() || undefined,
        color: projectDraft.color,
        icon: projectDraft.icon,
      });
      closeProjectModal();
      void navigate({
        to: "/projects/$projectId",
        params: { projectId: nextId },
      });
      return;
    }

    localStore.updateProject(projectModalState.projectId, {
      name: projectDraft.name.trim(),
      displayName: projectDraft.displayName.trim() || projectDraft.name.trim(),
      code: projectDraft.code.trim() || undefined,
      color: projectDraft.color,
      icon: projectDraft.icon,
    });
    closeProjectModal();
  };

  const handleTaskCreationSubmit = () => {
    if (!taskCreationProjectId || !taskCreationDraft.trim()) {
      return;
    }

    localStore.addProjectTask(taskCreationProjectId, taskCreationDraft.trim());
    const nextProjectId = taskCreationProjectId;
    closeTaskCreateModal();
    void navigate({
      to: "/projects/$projectId",
      params: { projectId: nextProjectId },
    });
  };

  return (
    <CustomSidebarLayout
      className="harday-project-layout"
      keyboardShortcut={false}
    >
      <CustomSidebar
        className="harday-project-navigation-sidebar"
        role="navigation"
        aria-label="Projects"
        collapsible="none"
      >
        <SidebarHeader className="harday-project-sidebar-header">
          <div className="harday-project-sidebar-search-row">
            <button
              type="button"
              className="harday-project-sidebar-command-trigger"
              aria-label="Search projects"
              title="Search projects"
              onClick={() => setIsProjectCommandOpen(true)}
            >
              <span>Search</span>
            </button>
            <button
              type="button"
              className={cn(
                "entries-header-add",
                projectModalState?.mode === "create" && "is-open",
              )}
              aria-label="Project actions"
              title="Project actions"
              onClick={() => setIsProjectCommandOpen(true)}
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
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
                  return (
                    <SidebarMenuItem
                      key={project._id}
                      ref={(node) => {
                        if (node) {
                          projectRowRefs.current.set(project._id, node);
                          return;
                        }

                        projectRowRefs.current.delete(project._id);
                      }}
                      className={cn(
                        "harday-project-sidebar-item",
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
                      onPointerDown={(event) =>
                        handleProjectPointerDown(project._id, event)
                      }
                    >
                      <CustomSidebarMenuButton
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
                          }
                        }}
                        render={
                          <Link
                            to="/projects/$projectId"
                            params={{ projectId: project._id }}
                            aria-label={getProjectDisplayName(project)}
                            title={project.name}
                            draggable={false}
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
                          className="harday-sidebar-icon"
                        />
                        <span data-sidebar-collapsed="hide">
                          {getProjectDisplayName(project)}
                        </span>
                        {project.code ? (
                          <span className="harday-sidebar-code">
                            {project.code}
                          </span>
                        ) : null}
                      </CustomSidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>

        <SidebarFooter className="harday-project-sidebar-footer">
          <Link
            to="/projects/archive"
            className={`harday-project-sidebar-archive-trigger ${
              isArchivePage ? "is-active" : ""
            }`}
            title="Archived projects"
            aria-label="Archived projects"
          >
            <Archive />
            <span data-sidebar-collapsed="hide">Archive</span>
          </Link>
        </SidebarFooter>

      </CustomSidebar>

      {draggedProject && projectDragState ? (
        <div
          className="harday-project-sidebar-drag-preview"
          style={{
            width: projectDragState.width,
            minHeight: projectDragState.height,
            transform: getSharedTableDragOverlayTransform(projectDragState),
          }}
        >
          <ProjectIcon
            icon={draggedProject.icon}
            color={draggedProject.color}
            className="harday-sidebar-icon"
          />
          <span className="min-w-0 flex-1 truncate">{draggedProject.name}</span>
          {draggedProject.code ? (
            <span className="harday-sidebar-code">{draggedProject.code}</span>
          ) : null}
        </div>
      ) : null}

      <div className="settings-content">
        {isArchivePage ? (
          <ArchivedProjectsView projects={archivedProjects} />
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
            onEditProject={openEditProjectModal}
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
                  : "Create your first project with the + button in the sidebar."}
              </p>
            </div>
          </div>
        )}
      </div>

      {projectModalState ? (
        <ProjectFormModal
          draft={projectDraft}
          mode={projectModalState.mode}
          onChange={setProjectDraft}
          onArchive={
            projectModalState.mode === "edit"
              ? () => {
                  localStore.archiveProject(projectModalState.projectId);
                  closeProjectModal();
                }
              : undefined
          }
          onClose={closeProjectModal}
          onSubmit={handleProjectSubmit}
        />
      ) : null}

      <ProjectTaskCreateModal
        draft={taskCreationDraft}
        onChange={setTaskCreationDraft}
        onClose={closeTaskCreateModal}
        onSubmit={handleTaskCreationSubmit}
        project={selectedTaskCreationProject}
      />

      <CommandDialog
        open={isProjectCommandOpen}
        onOpenChange={(open) => {
          if (open) {
            setIsProjectCommandOpen(true);
            return;
          }
          closeProjectCommand();
        }}
        title="Projects"
        description="Search projects and run project actions."
        className="harday-project-command-dialog"
      >
        <Command shouldFilter={false} className="harday-project-command">
          <CommandInput
            placeholder="Search projects and actions..."
            value={projectCommandQuery}
            onValueChange={setProjectCommandQuery}
          />
          <CommandList className="harday-project-command-list">
            <CommandEmpty>No matching projects.</CommandEmpty>

            {projectCommandView === "main" ? (
              <>
                {!hasProjectCommandQuery ? (
                  <>
                    <CommandGroup heading="Actions">
                      {primaryTaskProject ? (
                        <CommandItem
                          value={`create-task-current-${primaryTaskProject._id}`}
                          onSelect={() =>
                            openTaskCreateModal(primaryTaskProject._id)
                          }
                        >
                          <Plus className="h-4 w-4" />
                          <span className="flex-1">
                            Create a task in project{" "}
                            <span className="font-semibold">
                              {getProjectDisplayName(primaryTaskProject)}
                            </span>
                          </span>
                        </CommandItem>
                      ) : null}
                      <CommandItem
                        value="create-task-other-project"
                        onSelect={() => setProjectCommandView("task-projects")}
                      >
                        <Plus className="h-4 w-4" />
                        <span className="flex-1">
                          Create a task in project...
                        </span>
                        <ChevronRight className="h-4 w-4 text-foreground/55" />
                      </CommandItem>
                      <CommandItem
                        value="create-project"
                        onSelect={() => {
                          closeProjectCommand();
                          openCreateProjectModal();
                        }}
                      >
                        <FolderPlus className="h-4 w-4" />
                        <span className="flex-1">Create project</span>
                      </CommandItem>
                      <CommandItem
                        value="see-archived-projects"
                        onSelect={() => {
                          closeProjectCommand();
                          void navigate({ to: "/projects/archive" });
                        }}
                      >
                        <Archive className="h-4 w-4" />
                        <span className="flex-1">See archived projects</span>
                      </CommandItem>
                    </CommandGroup>

                    <CommandSeparator />
                  </>
                ) : null}

                <CommandGroup heading="Projects">
                  <div className="harday-project-command-group-scroll">
                    {filteredCommandProjects.map((project) => (
                      <CommandItem
                        key={project._id}
                        value={`project-${getProjectDisplayName(project)}`}
                        onSelect={() => {
                          closeProjectCommand();
                          void navigate({
                            to: "/projects/$projectId",
                            params: { projectId: project._id },
                          });
                        }}
                      >
                        <ProjectIcon
                          icon={project.icon}
                          color={project.color}
                          className="harday-sidebar-icon"
                        />
                        <span className="flex-1 truncate">
                          {getProjectDisplayName(project)}
                        </span>
                      </CommandItem>
                    ))}
                    {filteredCommandArchivedProjects.map((project) => (
                      <CommandItem
                        key={project._id}
                        value={`archived-project-${getProjectDisplayName(project)}`}
                        onSelect={() => {
                          closeProjectCommand();
                          void navigate({
                            to: "/projects/$projectId",
                            params: { projectId: project._id },
                          });
                        }}
                      >
                        <ProjectIcon
                          icon={project.icon}
                          color={project.color}
                          className="harday-sidebar-icon opacity-50"
                        />
                        <span className="flex-1 truncate text-foreground/70">
                          {getProjectDisplayName(project)}
                        </span>
                      </CommandItem>
                    ))}
                  </div>
                </CommandGroup>
              </>
            ) : (
              <CommandGroup heading="Select project">
                <CommandItem
                  value="back-to-actions"
                  onSelect={() => setProjectCommandView("main")}
                >
                  <ChevronLeft className="h-4 w-4" />
                  <span className="flex-1">Back to actions</span>
                </CommandItem>
                <CommandSeparator />
                <div className="harday-project-command-group-scroll">
                  {filteredCommandProjects.map((project) => (
                    <CommandItem
                      key={project._id}
                      value={`task-project-${getProjectDisplayName(project)}`}
                      onSelect={() => openTaskCreateModal(project._id)}
                    >
                      <ProjectIcon
                        icon={project.icon}
                        color={project.color}
                        className="harday-sidebar-icon"
                      />
                      <span className="flex-1 truncate">
                        {getProjectDisplayName(project)}
                      </span>
                    </CommandItem>
                  ))}
                </div>
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </CommandDialog>
    </CustomSidebarLayout>
  );
}
