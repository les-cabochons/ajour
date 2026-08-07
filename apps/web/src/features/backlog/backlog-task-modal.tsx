import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  RiAddLine as Plus,
  RiAlarmWarningLine as AlertTriangle,
  RiCheckLine as Check,
  RiCloseLine as X,
  RiDeleteBinLine as Trash2,
  RiPlayLine as Play,
} from "@remixicon/react";
import { Button } from "@/components/ui/button";
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
  buildManualTimeEntryNote,
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
import {
  buildWorkItemTimerComment,
  parseWorkItemReference,
} from "@/features/backlog/work-item-timer-comment";
import { syncBacklogWorkItemToSource } from "@/features/backlog/work-item-source-sync";
import {
  normalizeHoursInput,
  parseHoursInput,
} from "@/domain/time/duration";
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
import { cn, todayIsoDate } from "@/lib/utils";

interface BacklogTaskModalProps {
  workItemId?: string;
  parentWorkItemId?: string;
  onClose: () => void;
}

export function BacklogTaskModal({
  workItemId,
  parentWorkItemId,
  onClose,
}: BacklogTaskModalProps) {
  const state = useLocalState();
  const projects = useLocalProjects();
  const workItemIconData = useWorkItemIconData(projects);
  const workItems = useLocalWorkItems();
  const overlayRef = useRef<HTMLDivElement>(null);
  const currentTimer = state.timers[0] ?? null;
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
  const [timeEntryNote, setTimeEntryNote] = useState("");
  const [priority, setPriority] = useState("");
  const [originalEstimateHours, setOriginalEstimateHours] = useState("");
  const [remainingEstimateHours, setRemainingEstimateHours] = useState("");
  const [completedEstimateHours, setCompletedEstimateHours] = useState("");
  const [backlogStatusId, setBacklogStatusId] = useState("");
  const [parentTaskId, setParentTaskId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [taskId, setTaskId] = useState("");
  const [durationHours, setDurationHours] = useState("");
  const [isArchivePending, setIsArchivePending] = useState(false);
  const [isDeletePending, setIsDeletePending] = useState(false);

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

  const parsedDurationMs = useMemo(
    () => parseHoursInput(durationHours),
    [durationHours],
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
  const hasDurationDraft = durationHours.trim().length > 0;
  const durationError = !hasDurationDraft
    ? null
    : parsedDurationMs === null
      ? "Enter a valid duration"
      : parsedDurationMs <= 0
        ? "Enter a positive duration"
        : null;
  const isSubtaskDraft = isCreateSubtaskMode ? true : Boolean(parentTaskId);
  const editorValidation = validateBacklogTaskEditor(editorFields, {
    isSubtask: isSubtaskDraft,
    requireParent: isCreateSubtaskMode,
  });
  const { priorityError } = editorValidation;
  const canSubmitDuration = Boolean(parsedDurationMs && parsedDurationMs > 0);
  const canStartTimer = workItem?.status !== "archived";
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
            isSubtaskWorkItem(workItem) ? "Subtask" : undefined,
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
  const sourceUrl =
    workItem && workItem.source !== "manual"
      ? workItem.sourceId
      : undefined;
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

  const applyEditorFields = useCallback(
    (fields: BacklogTaskEditorFields) => {
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
      setTimeEntryNote("");
      setDurationHours("");
      setIsArchivePending(false);
      setIsDeletePending(false);
    },
    [],
  );

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

  useEffect(() => {
    if (!isArchivePending) {
      return;
    }

    const timeoutId = window.setTimeout(() => setIsArchivePending(false), 2500);
    return () => window.clearTimeout(timeoutId);
  }, [isArchivePending]);

  useEffect(() => {
    if (!isDeletePending) {
      return;
    }

    const timeoutId = window.setTimeout(() => setIsDeletePending(false), 2500);
    return () => window.clearTimeout(timeoutId);
  }, [isDeletePending]);

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
          keepWhenMissingFromSync:
            workItem.keepWhenMissingFromSync ?? false,
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

  function cancelDurationDraft() {
    setDurationHours("");
  }

  function submitDuration() {
    if (!workItem || !parsedDurationMs || parsedDurationMs <= 0) {
      return;
    }

    const patch = buildDraftPatch(true);
    const nextTitle = patch?.title ?? workItem.title;

    if (patch) {
      localStore.updateWorkItem(workItem._id, patch);
    }

    localStore.saveManualTimeEntry({
      localDate: todayIsoDate(),
      workItemId: workItem._id,
      projectId: projectId || undefined,
      taskId: taskId || undefined,
      note: buildManualTimeEntryNote(
        timeEntryNote,
        nextTitle,
        workItem.sourceId,
      ),
      durationMs: parsedDurationMs,
    });
    syncBacklogWorkItemToSource(workItem);
    setDurationHours("");
    setTimeEntryNote("");
  }

  function handleStartTimer() {
    if (!workItem || !canStartTimer) {
      return;
    }

    const patch = buildDraftPatch(true);
    const nextTitle = patch?.title ?? workItem.title;

    if (patch) {
      localStore.updateWorkItem(workItem._id, patch);
    }

    localStore.startTimer({
      localDate: todayIsoDate(),
      workItemId: workItem._id,
      projectId: projectId || undefined,
      taskId: taskId || undefined,
      note: buildWorkItemTimerComment(nextTitle, workItem.sourceId),
      accumulatedDurationMs: 0,
    });

    onClose();
  }

  function handleArchive() {
    if (!workItem) {
      return;
    }

    setIsDeletePending(false);

    if (workItem.status === "archived") {
      localStore.restoreWorkItem(workItem._id);
      setIsArchivePending(false);
      return;
    }

    if (isArchivePending) {
      localStore.archiveWorkItem(workItem._id);
      setIsArchivePending(false);
      return;
    }

    setIsArchivePending(true);
  }

  function handleDeleteWorkItem() {
    if (!workItem) {
      return;
    }

    setIsArchivePending(false);

    if (isDeletePending) {
      localStore.deleteWorkItem(workItem._id);
      setIsDeletePending(false);
      onClose();
      return;
    }

    setIsDeletePending(true);
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
            <span className="time-entry-modal-title">New task</span>
            <button
              type="button"
              className="time-entry-modal-close"
              onClick={onClose}
              aria-label="Close task creation"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="time-entry-modal-form">
            <label className="field backlog-field-title-full">
              <span className="field-label">Task</span>
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
                placeholder="Task name"
                aria-label="Task name"
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
              Add task
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
            <span className="time-entry-modal-title">Add subtask</span>
            <button
              type="button"
              className="time-entry-modal-close"
              onClick={onClose}
              aria-label="Close subtask creation"
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
                placeholder="Subtask name"
                aria-label="Subtask name"
                autoFocus
              />
            </label>

            <label className="field backlog-field-parent">
              <span className="field-label">Parent task</span>
              <SearchableSelect
                value={parentTaskId}
                options={parentTaskOptions}
                onChange={setParentTaskId}
                placeholder="Select parent task"
                emptyMessage="No matching parent tasks"
                ariaLabel="Parent task"
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
              Add subtask
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
  const isArchived = editingWorkItem.status === "archived";
  const dynamicSubtaskLabel = isSubtaskDraft ? "subtask" : "task";
  const timerTitle = isArchived
    ? "Archived tasks cannot start timers"
    : currentTimer
      ? `Switch timer to ${title.trim() || editingWorkItem.title}`
      : `Start timer for ${title.trim() || editingWorkItem.title}`;

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
            <button
              type="button"
              className="time-entry-modal-close"
              onClick={saveAndClose}
              aria-label="Close task editor"
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
                Estimate sync needs review in Sync Review.
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

          {!isArchived ? (
            <label className="field entry-field-note">
              <span className="field-label">Note</span>
              <textarea
                className="field-input entry-note-input"
                value={timeEntryNote}
                onChange={(event) => setTimeEntryNote(event.target.value)}
                placeholder="Time entry note (optional)"
                rows={2}
              />
            </label>
          ) : null}

          {priorityError ? (
            <div className="backlog-field-title-full">
              <span className="field-error">{priorityError}</span>
            </div>
          ) : null}

          <div className="field entry-field-hours backlog-field-hours">
            <span className="field-label">Hours</span>
            <div className="inline-hours-input-shell">
              <input
                className="field-input entry-hours-input inline-hours-input"
                type="text"
                placeholder="01:30"
                style={{ fontFamily: "var(--font-mono)" }}
                value={durationHours}
                onChange={(event) => setDurationHours(event.target.value)}
                onBlur={(event) =>
                  setDurationHours(normalizeHoursInput(event.target.value))
                }
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    if (hasDurationDraft) {
                      submitDuration();
                      return;
                    }

                    handleStartTimer();
                  }
                }}
                aria-label="Hours"
              />
              <div className="inline-hours-actions">
                {hasDurationDraft ? (
                  <>
                    <button
                      type="button"
                      className="inline-hours-action"
                      aria-label="Submit time"
                      disabled={!canSubmitDuration}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={submitDuration}
                    >
                      <Check className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      className="inline-hours-action"
                      aria-label="Cancel time"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={cancelDurationDraft}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className={cn(
                      "inline-hours-action",
                      "inline-hours-action-play",
                    )}
                    aria-label={timerTitle}
                    title={timerTitle}
                    disabled={!canStartTimer}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={handleStartTimer}
                  >
                    <Play className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>
            {durationError ? (
              <span className="field-error">{durationError}</span>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
