import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  RiAddLine as Plus,
  RiAlarmWarningLine as AlertTriangle,
  RiCloseLine as X,
} from "@remixicon/react";
import { ObjectActionsButton } from "@/components/object-actions-menu";
import { Button } from "@/components/ui/button";
import {
  getBacklogItemActions,
  type BacklogItemActionId,
} from "@/domain/actions/object-actions";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { buildProjectTaskOptions } from "@/features/projects/project-task-options";
import {
  buildBacklogStatusNameLookup,
  buildBacklogStatusOptions,
} from "@/features/backlog/backlog-status";
import {
  getDirectChildWorkItems,
  isSubtaskWorkItem,
} from "@/domain/backlog/work-item-hierarchy";
import {
  buildBacklogTaskDraft,
  buildBacklogTaskPatch,
  collectBlockedParentIds,
  createBacklogTaskEditorFields,
  validateBacklogTaskEditor,
  type BacklogTaskEditorFields,
} from "@/features/backlog/backlog-task-editor";
import {
  WorkItemIcon,
  resolveWorkItemIcon,
  useWorkItemIconData,
} from "@/features/backlog/work-item-icons";
import { parseWorkItemReference } from "@/features/backlog/work-item-timer-comment";
import {
  useLocalProjects,
  useLocalState,
  useLocalWorkItems,
} from "@/lib/local-hooks";
import {
  type LocalWorkItem,
  getLocalProjectDisplayName,
} from "@/domain/local-state";
import { localStore } from "@/lib/local-store";

interface BacklogTaskModalProps {
  workItemId?: string;
  parentWorkItemId?: string;
  onClose: () => void;
  /**
   * Runs an action from the item's "…" menu. The dialog saves its draft and closes
   * first, then passes the item with the draft applied.
   */
  onAction?: (workItem: LocalWorkItem, actionId: BacklogItemActionId) => void;
}

export function BacklogTaskModal({
  workItemId,
  parentWorkItemId,
  onClose,
  onAction,
}: BacklogTaskModalProps) {
  const state = useLocalState();
  const projects = useLocalProjects();
  const workItemIconData = useWorkItemIconData(projects);
  const workItems = useLocalWorkItems();
  const overlayRef = useRef<HTMLDivElement>(null);
  const isCreateSubtaskMode = Boolean(parentWorkItemId && !workItemId);
  const isCreateRootMode = Boolean(!parentWorkItemId && !workItemId);

  const workItem = useMemo(
    () =>
      workItemId
        ? (workItems.find((item) => item._id === workItemId) ?? null)
        : null,
    [workItemId, workItems],
  );
  const parentWorkItem = useMemo(
    () =>
      parentWorkItemId
        ? (workItems.find((item) => item._id === parentWorkItemId) ?? null)
        : null,
    [parentWorkItemId, workItems],
  );

  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [priority, setPriority] = useState("");
  const [originalEstimateHours, setOriginalEstimateHours] = useState("");
  const [remainingEstimateHours, setRemainingEstimateHours] = useState("");
  const [completedEstimateHours, setCompletedEstimateHours] = useState("");
  const [backlogStatusId, setBacklogStatusId] = useState("");
  const [parentTaskId, setParentTaskId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [taskId, setTaskId] = useState("");

  const projectOptions = useMemo(
    () =>
      projects.map((project) => ({
        value: project._id,
        label: project.code
          ? `[${project.code}] ${getLocalProjectDisplayName(project)}`
          : getLocalProjectDisplayName(project),
        keywords: [
          project.name,
          getLocalProjectDisplayName(project),
          project.code ?? "",
        ],
      })),
    [projects],
  );
  const backlogStatusOptions = useMemo(
    () => buildBacklogStatusOptions(state.backlogStatuses),
    [state.backlogStatuses],
  );
  const backlogStatusNameById = useMemo(
    () => buildBacklogStatusNameLookup(state.backlogStatuses),
    [state.backlogStatuses],
  );

  const resolvedParentTaskId = useMemo(() => {
    if (parentWorkItemId) {
      return parentWorkItemId;
    }

    if (!workItem) {
      return "";
    }

    if (workItem.parentWorkItemId) {
      return workItem.parentWorkItemId;
    }

    if (!workItem.parentSourceId) {
      return "";
    }

    return (
      workItems.find((item) => item.sourceId === workItem.parentSourceId)
        ?._id ?? ""
    );
  }, [parentWorkItemId, workItem, workItems]);

  const blockedParentIds = useMemo(
    () =>
      workItem
        ? collectBlockedParentIds(workItem, workItems)
        : new Set<string>(),
    [workItem, workItems],
  );
  const canChangeParentTask = useMemo(
    () =>
      workItem
        ? getDirectChildWorkItems(workItem, workItems).length === 0
        : true,
    [workItem, workItems],
  );
  const parentTaskOptions = useMemo(
    () =>
      workItems
        .filter(
          (item) => !isSubtaskWorkItem(item) && !blockedParentIds.has(item._id),
        )
        .map((item) => ({
          value: item._id,
          label: item.title,
        })),
    [blockedParentIds, workItems],
  );

  const availableTasks = useMemo(
    () =>
      projects
        .find((project) => project._id === projectId)
        ?.tasks.filter((task) => task.status === "active") ?? [],
    [projectId, projects],
  );
  const taskOptions = useMemo(
    () => buildProjectTaskOptions(availableTasks),
    [availableTasks],
  );

  const editorFields: BacklogTaskEditorFields = {
    title,
    note,
    priority,
    backlogStatusId,
    parentWorkItemId: parentTaskId,
    projectId,
    taskId,
    originalEstimateHours,
    remainingEstimateHours,
    completedEstimateHours,
    keepWhenMissingFromSync: workItem?.keepWhenMissingFromSync ?? false,
  };
  const isSubtaskDraft = isCreateSubtaskMode ? true : Boolean(parentTaskId);
  const editorValidation = validateBacklogTaskEditor(editorFields, {
    isSubtask: isSubtaskDraft,
    requireParent: isCreateSubtaskMode,
  });
  const { priorityError } = editorValidation;
  const canCreateSubtask = editorValidation.canSave;
  const canCreateRootTask = validateBacklogTaskEditor(editorFields, {
    isSubtask: false,
  }).canSave;

  const selectedProject = useMemo(
    () => projects.find((project) => project._id === projectId),
    [projectId, projects],
  );
  const selectedTask = useMemo(
    () => selectedProject?.tasks.find((task) => task._id === taskId),
    [selectedProject, taskId],
  );
  const sourceMetaParts = useMemo(
    () =>
      workItem
        ? [
            isSubtaskWorkItem(workItem) ? "Subitem" : undefined,
            workItem.source !== "manual"
              ? workItem.sourceConnectionLabel
              : undefined,
            workItem.source !== "manual"
              ? workItem.sourceProjectName
              : undefined,
            workItem.sourceWorkItemType,
          ].filter(Boolean)
        : [],
    [workItem],
  );
  const timeEntryMetaParts = useMemo(
    () =>
      [
        selectedProject
          ? getLocalProjectDisplayName(selectedProject)
          : undefined,
        selectedTask?.name,
      ].filter(Boolean),
    [selectedProject, selectedTask?.name],
  );
  const sourceReference =
    workItem?.source === "azure_devops"
      ? parseWorkItemReference(workItem.sourceId)
      : undefined;
  const sourceUrl = workItem?.sourceUrl;
  const sourceMetaLabel = [
    sourceReference ? `#${sourceReference}` : undefined,
    ...sourceMetaParts,
  ]
    .filter(Boolean)
    .join(" · ");
  const hasEstimateSyncIssue = Boolean(
    workItem?.estimateSync?.originalEstimateHours?.conflict ||
    workItem?.estimateSync?.remainingEstimateHours?.conflict ||
    workItem?.estimateSync?.completedEstimateHours?.conflict ||
    workItem?.estimateSync?.originalEstimateHours?.error ||
    workItem?.estimateSync?.remainingEstimateHours?.error ||
    workItem?.estimateSync?.completedEstimateHours?.error,
  );
  const resolvedWorkItemIcon = workItem
    ? resolveWorkItemIcon(workItem, workItemIconData)
    : null;

  const applyEditorFields = useCallback((fields: BacklogTaskEditorFields) => {
    setTitle(fields.title);
    setNote(fields.note);
    setPriority(fields.priority);
    setOriginalEstimateHours(fields.originalEstimateHours);
    setRemainingEstimateHours(fields.remainingEstimateHours);
    setCompletedEstimateHours(fields.completedEstimateHours);
    setBacklogStatusId(fields.backlogStatusId);
    setParentTaskId(fields.parentWorkItemId);
    setProjectId(fields.projectId);
    setTaskId(fields.taskId);
  }, []);

  useEffect(() => {
    if (isCreateRootMode) {
      applyEditorFields(createBacklogTaskEditorFields());
      return;
    }

    if (isCreateSubtaskMode) {
      if (!parentWorkItem) {
        onClose();
        return;
      }

      applyEditorFields(
        createBacklogTaskEditorFields(undefined, {
          backlogStatusId: parentWorkItem.backlogStatusId ?? "",
          parentWorkItemId: parentWorkItem._id,
          projectId: parentWorkItem.projectId ?? "",
          taskId: parentWorkItem.taskId ?? "",
        }),
      );
      return;
    }

    if (!workItem) {
      onClose();
      return;
    }

    applyEditorFields(
      createBacklogTaskEditorFields(workItem, {
        parentWorkItemId: resolvedParentTaskId,
      }),
    );
  }, [
    applyEditorFields,
    isCreateRootMode,
    isCreateSubtaskMode,
    onClose,
    parentWorkItem,
    resolvedParentTaskId,
    workItem,
  ]);

  useEffect(() => {
    if (backlogStatusId && !backlogStatusNameById.has(backlogStatusId)) {
      setBacklogStatusId("");
    }
  }, [backlogStatusId, backlogStatusNameById]);

  useEffect(() => {
    if (!projectId) {
      setTaskId("");
      return;
    }

    if (!availableTasks.some((task) => task._id === taskId)) {
      setTaskId(availableTasks[0]?._id ?? "");
    }
  }, [availableTasks, projectId, taskId]);

  const buildDraftPatch = useCallback(
    (preserveTitle = false) => {
      if (!workItem) {
        return null;
      }

      const trimmedTitle = title.trim();
      if (!trimmedTitle && !preserveTitle) {
        return null;
      }

      return buildBacklogTaskPatch(
        workItem,
        {
          title,
          note,
          priority,
          backlogStatusId,
          parentWorkItemId: parentTaskId,
          projectId,
          taskId,
          originalEstimateHours,
          remainingEstimateHours,
          completedEstimateHours,
          keepWhenMissingFromSync: workItem.keepWhenMissingFromSync ?? false,
        },
        {
          isSubtask: Boolean(parentTaskId),
          preserveTitle,
          includeHierarchy: true,
        },
      );
    },
    [
      backlogStatusId,
      completedEstimateHours,
      note,
      originalEstimateHours,
      parentTaskId,
      priority,
      projectId,
      remainingEstimateHours,
      taskId,
      title,
      workItem,
    ],
  );

  const saveAndClose = useCallback(() => {
    if (!workItem) {
      onClose();
      return;
    }

    const patch = buildDraftPatch();
    if (patch) {
      localStore.updateWorkItem(workItem._id, patch);
    }

    onClose();
  }, [buildDraftPatch, onClose, workItem]);
  const closeModal = isCreateSubtaskMode ? onClose : saveAndClose;

  useEffect(() => {
    function handleMouseDown(event: MouseEvent) {
      if (overlayRef.current === event.target) {
        closeModal();
      }
    }

    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [closeModal]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        closeModal();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [closeModal]);

  /** Saves the draft, closes the dialog, then runs the action on the saved item. */
  function handleItemAction(actionId: BacklogItemActionId) {
    if (!workItem) {
      return;
    }

    const patch = buildDraftPatch(true);
    if (patch) {
      localStore.updateWorkItem(workItem._id, patch);
    }

    onClose();
    onAction?.({ ...workItem, ...patch }, actionId);
  }

  function submitCreatedSubtask() {
    const draft = buildBacklogTaskDraft(editorFields, {
      isSubtask: true,
      requireParent: true,
    });
    if (!draft?.parentWorkItemId) {
      return;
    }

    const { parentWorkItemId: draftParentId, ...subtaskDraft } = draft;
    localStore.addSubtask(draftParentId, subtaskDraft);
    onClose();
  }

  function submitCreatedTask() {
    const draft = buildBacklogTaskDraft(editorFields, {
      isSubtask: false,
    });
    if (!draft) {
      return;
    }

    localStore.addWorkItem(draft);
    onClose();
  }

  if (isCreateRootMode) {
    return (
      <div ref={overlayRef} className="time-entry-modal-overlay">
        <div className="time-entry-modal">
          <div className="time-entry-modal-header">
            <span className="time-entry-modal-title">New backlog item</span>
            <button
              type="button"
              className="time-entry-modal-close"
              onClick={onClose}
              aria-label="Close item creation"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="time-entry-modal-form">
            <label className="field backlog-field-title-full">
              <span className="field-label">Item</span>
              <input
                className="field-input"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    submitCreatedTask();
                  }
                }}
                placeholder="Item name"
                aria-label="Item name"
                autoFocus
              />
            </label>

            <label className="field backlog-field-project">
              <span className="field-label">Status</span>
              <SearchableSelect
                value={backlogStatusId}
                options={backlogStatusOptions}
                onChange={setBacklogStatusId}
                placeholder="No status"
                clearLabel="No status"
                emptyMessage="No matching statuses"
                ariaLabel="Backlog status"
              />
            </label>

            <label className="field backlog-field-project">
              <span className="field-label">Project</span>
              <SearchableSelect
                value={projectId}
                options={projectOptions}
                onChange={setProjectId}
                placeholder="No project"
                clearLabel="No project"
                emptyMessage="No matching projects"
                ariaLabel="Project"
              />
            </label>

            <label className="field backlog-field-task">
              <span className="field-label">Task mapping</span>
              <SearchableSelect
                value={taskId}
                options={taskOptions}
                onChange={setTaskId}
                placeholder={projectId ? "Select task" : "Pick a project first"}
                clearLabel={projectId ? "No task" : undefined}
                emptyMessage={
                  projectId ? "No matching tasks" : "Pick a project first"
                }
                ariaLabel="Task mapping"
                disabled={!projectId || availableTasks.length === 0}
              />
            </label>

            <label className="field entry-field-note">
              <span className="field-label">Description</span>
              <textarea
                className="field-input entry-note-input"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="Description (optional)"
                rows={2}
              />
            </label>
          </div>

          <div className="time-entry-modal-actions">
            <Button
              type="button"
              className="gap-1.5"
              onClick={submitCreatedTask}
              disabled={!canCreateRootTask}
            >
              <Plus className="h-3.5 w-3.5" />
              Add item
            </Button>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (isCreateSubtaskMode && !parentWorkItem) {
    return null;
  }

  if (!isCreateSubtaskMode && !workItem) {
    return null;
  }

  if (isCreateSubtaskMode) {
    return (
      <div ref={overlayRef} className="time-entry-modal-overlay">
        <div className="time-entry-modal">
          <div className="time-entry-modal-header">
            <span className="time-entry-modal-title">Add subitem</span>
            <button
              type="button"
              className="time-entry-modal-close"
              onClick={onClose}
              aria-label="Close subitem creation"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="time-entry-modal-form">
            <label className="field backlog-field-title-full">
              <span className="field-label">Subtask</span>
              <input
                className="field-input"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    submitCreatedSubtask();
                  }
                }}
                placeholder="Subitem name"
                aria-label="Subitem name"
                autoFocus
              />
            </label>

            <label className="field backlog-field-parent">
              <span className="field-label">Parent item</span>
              <SearchableSelect
                value={parentTaskId}
                options={parentTaskOptions}
                onChange={setParentTaskId}
                placeholder="Select parent item"
                emptyMessage="No matching parent items"
                ariaLabel="Parent item"
              />
            </label>

            <label className="field backlog-field-project">
              <span className="field-label">Status</span>
              <SearchableSelect
                value={backlogStatusId}
                options={backlogStatusOptions}
                onChange={setBacklogStatusId}
                placeholder="No status"
                clearLabel="No status"
                emptyMessage="No matching statuses"
                ariaLabel="Backlog status"
              />
            </label>

            <label className="field backlog-field-project">
              <span className="field-label">Project</span>
              <SearchableSelect
                value={projectId}
                options={projectOptions}
                onChange={setProjectId}
                placeholder="No project"
                clearLabel="No project"
                emptyMessage="No matching projects"
                ariaLabel="Project"
              />
            </label>

            <label className="field backlog-field-task">
              <span className="field-label">Task mapping</span>
              <SearchableSelect
                value={taskId}
                options={taskOptions}
                onChange={setTaskId}
                placeholder={projectId ? "Select task" : "Pick a project first"}
                clearLabel={projectId ? "No task" : undefined}
                emptyMessage={
                  projectId ? "No matching tasks" : "Pick a project first"
                }
                ariaLabel="Task mapping"
                disabled={!projectId || availableTasks.length === 0}
              />
            </label>

            <label className="field entry-field-note">
              <span className="field-label">Description</span>
              <textarea
                className="field-input entry-note-input"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="Description (optional)"
                rows={2}
              />
            </label>
          </div>

          <div className="time-entry-modal-actions">
            <Button
              type="button"
              className="gap-1.5"
              onClick={submitCreatedSubtask}
              disabled={!canCreateSubtask}
            >
              <Plus className="h-3.5 w-3.5" />
              Add subitem
            </Button>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const editingWorkItem = workItem as LocalWorkItem;
  const isSubitem = isSubtaskWorkItem(editingWorkItem);
  const itemActions = getBacklogItemActions(editingWorkItem, {
    isSubitem,
    subitemCount: isSubitem
      ? 0
      : getDirectChildWorkItems(editingWorkItem, workItems).length,
    isEditing: true,
  });

  return (
    <div ref={overlayRef} className="time-entry-modal-overlay">
      <div className="time-entry-modal">
        <div className="time-entry-modal-header">
          <div className="backlog-modal-header-content">
            <div className="backlog-modal-readonly-title-row">
              {resolvedWorkItemIcon ? (
                <WorkItemIcon icon={resolvedWorkItemIcon} />
              ) : null}
              <span className="backlog-modal-readonly-title">{title}</span>
            </div>
            {sourceMetaParts.length > 0 || sourceReference ? (
              sourceUrl ? (
                <a
                  href={sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="backlog-task-meta backlog-task-meta-link"
                  onClick={(event) => event.stopPropagation()}
                >
                  {sourceMetaLabel}
                </a>
              ) : (
                <span className="backlog-task-meta">{sourceMetaLabel}</span>
              )
            ) : null}
          </div>
          <div className="time-entry-modal-header-actions">
            {onAction ? (
              <ObjectActionsButton
                actions={itemActions}
                onAction={handleItemAction}
                label={`Actions for ${editingWorkItem.title}`}
              />
            ) : null}
            <button
              type="button"
              className="time-entry-modal-close"
              onClick={saveAndClose}
              aria-label="Close item editor"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="time-entry-modal-form">
          {hasEstimateSyncIssue ? (
            <div className="backlog-field-title-full">
              <span className="backlog-task-meta flex items-center gap-2 text-amber-300">
                <AlertTriangle className="h-3.5 w-3.5" />
                Estimate sync needs review in Sync review.
              </span>
            </div>
          ) : null}

          <label className="field backlog-field-project">
            <span className="field-label">Project</span>
            <SearchableSelect
              value={projectId}
              options={projectOptions}
              onChange={setProjectId}
              placeholder="No project"
              clearLabel="No project"
              emptyMessage="No matching projects"
              ariaLabel="Project"
            />
          </label>

          <label className="field backlog-field-task">
            <span className="field-label">Task mapping</span>
            <SearchableSelect
              value={taskId}
              options={taskOptions}
              onChange={setTaskId}
              placeholder={projectId ? "Select task" : "Pick a project first"}
              clearLabel={projectId ? "No task" : undefined}
              emptyMessage={
                projectId ? "No matching tasks" : "Pick a project first"
              }
              ariaLabel="Task mapping"
              disabled={!projectId || availableTasks.length === 0}
            />
          </label>

          {priorityError ? (
            <div className="backlog-field-title-full">
              <span className="field-error">{priorityError}</span>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
