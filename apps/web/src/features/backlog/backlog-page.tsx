import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  RiAddLine as Plus,
  RiAlarmWarningLine as AlertTriangle,
  RiArchiveLine as Archive,
  RiArrowRightSLine as ChevronRight,
  RiCheckLine as Check,
  RiCloseLine as X,
  RiDeleteBinLine as Trash2,
  RiExpandDiagonalLine as Maximize2,
  RiFileTextLine as FileText,
  RiFilter3Line as Filter,
  RiInboxArchiveLine as ArchiveRestore,
  RiPencilLine as Pencil,
  RiPlayLine as Play,
  RiRefreshLine as RotateCcw,
} from "@remixicon/react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  buildBacklogStatusLookup,
  buildBacklogStatusNameLookup,
  buildBacklogStatusOptions,
} from "@/features/backlog/backlog-status";
import {
  getWorkItemLookupKeys,
  getWorkItemParentKey,
  isSubtaskWorkItem,
} from "@/domain/backlog/work-item-hierarchy";
import {
  WorkItemIcon,
  resolveWorkItemIcon,
  useWorkItemIconData,
} from "@/features/backlog/work-item-icons";
import {
  buildBacklogTaskDraft,
  buildBacklogTaskPatch,
  buildManualTimeEntryNote,
  createBacklogTaskEditorFields,
  formatEstimateInput,
  formatPriorityInput,
  isSamePriorityValue,
  parseEstimateInput,
  parsePriorityInput,
} from "@/features/backlog/backlog-task-editor";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { buildProjectTaskOptions } from "@/features/projects/project-task-options";
import { ScrollArea } from "@/components/ui/scroll-area";
import { BacklogTaskModal } from "@/features/backlog/backlog-task-modal";
import {
  applyLoggedTimeToEstimateValues,
  getWorkItemEstimateBadgeLabel,
} from "@/domain/backlog/work-item-estimates";
import { syncBacklogWorkItemToSource } from "@/features/backlog/work-item-source-sync";
import {
  buildWorkItemTimerComment,
  parseWorkItemReference,
} from "@/features/backlog/work-item-timer-comment";
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
  getLocalProjectDisplayName,
  hasWorkItemEstimateSyncIssue,
  type BacklogSortMode,
  type LocalWorkItem,
} from "@/domain/local-state";
import { localStore } from "@/lib/local-store";
import { isInlineEditorOutsideClick } from "@/lib/inline-editor-close";
import {
  createSharedTableDragPointerSession,
  getSharedTableDragOverlayTransform,
  getSharedTableDragRowShift,
  getSharedTableDragTargetIndex,
  setSharedTableDragDocumentState,
  SHARED_TABLE_DRAG_CLICK_SUPPRESSION_MS,
  type SharedTableDragPointerSession,
} from "@/lib/table-drag";
import { cn, todayIsoDate } from "@/lib/utils";

const DESKTOP_ENTRY_MEDIA_QUERY = "(min-width: 641px)";
const BACKLOG_TABLE_COLUMN_COUNT = 4;

type BacklogFilter = "active" | "archived";
type ExpandedViewMode = "edit" | "subtasks";
type ExpandedNoteModalTarget = "root" | "child";
type StandaloneNoteModalState = {
  workItemId: string;
  note: string;
};

type BacklogDragState = {
  workItemId: string;
  groupIds: string[];
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

type BacklogInlineEditorState = {
  title: string;
  titleDraft: string;
  isTitleEditing: boolean;
  note: string;
  timeEntryNote: string;
  backlogStatusId: string;
  projectId: string;
  taskId: string;
  originalEstimateHours: string;
  remainingEstimateHours: string;
  completedEstimateHours: string;
  durationHours: string;
  keepWhenMissingFromSync: boolean;
};

const EMPTY_BACKLOG_INLINE_EDITOR_STATE: BacklogInlineEditorState = {
  title: "",
  titleDraft: "",
  isTitleEditing: false,
  note: "",
  timeEntryNote: "",
  backlogStatusId: "",
  projectId: "",
  taskId: "",
  originalEstimateHours: "",
  remainingEstimateHours: "",
  completedEstimateHours: "",
  durationHours: "",
  keepWhenMissingFromSync: false,
};

function buildBacklogInlineEditorState(
  workItem: LocalWorkItem,
): BacklogInlineEditorState {
  const fields = createBacklogTaskEditorFields(workItem);

  return {
    title: fields.title,
    titleDraft: fields.title,
    isTitleEditing: false,
    note: fields.note,
    timeEntryNote: "",
    backlogStatusId: fields.backlogStatusId,
    projectId: fields.projectId,
    taskId: fields.taskId,
    originalEstimateHours: fields.originalEstimateHours,
    remainingEstimateHours: fields.remainingEstimateHours,
    completedEstimateHours: fields.completedEstimateHours,
    durationHours: "",
    keepWhenMissingFromSync: fields.keepWhenMissingFromSync,
  };
}

const BACKLOG_FILTERS: { value: BacklogFilter; label: string }[] = [
  { value: "active", label: "Active" },
  { value: "archived", label: "Archived" },
];

const BACKLOG_SORT_MODES: { value: "custom" | "priority"; label: string }[] = [
  { value: "priority", label: "Priority" },
  { value: "custom", label: "Custom" },
];

function isPrioritySortMode(mode: BacklogSortMode) {
  return mode === "priority_asc" || mode === "priority_desc";
}

function getBacklogSortModeLabel(mode: BacklogSortMode) {
  switch (mode) {
    case "priority_asc":
      return "priority ascending";
    case "priority_desc":
      return "priority descending";
    default:
      return "custom";
  }
}

function sumChildEstimateTotals(childItems: LocalWorkItem[]) {
  return childItems.reduce(
    (totals, childItem) => ({
      originalEstimateHours:
        totals.originalEstimateHours + (childItem.originalEstimateHours ?? 0),
      remainingEstimateHours:
        totals.remainingEstimateHours + (childItem.remainingEstimateHours ?? 0),
      completedEstimateHours:
        totals.completedEstimateHours + (childItem.completedEstimateHours ?? 0),
    }),
    {
      originalEstimateHours: 0,
      remainingEstimateHours: 0,
      completedEstimateHours: 0,
    },
  );
}

function normalizeEstimateComparisonValue(value?: number) {
  return value ?? 0;
}

function moveItem<T>(items: T[], fromIndex: number, toIndex: number) {
  if (fromIndex === toIndex) {
    return [...items];
  }

  const nextItems = [...items];
  const [item] = nextItems.splice(fromIndex, 1);

  if (!item) {
    return [...items];
  }

  nextItems.splice(toIndex, 0, item);
  return nextItems;
}

function isBacklogDragBlockedTarget(target: EventTarget | null) {
  return target instanceof HTMLElement
    ? Boolean(
        target.closest(
          "button, input, textarea, select, option, a, [data-no-backlog-drag='true']",
        ),
      )
    : false;
}

export function BacklogPage() {
  const state = useLocalState();
  const projects = useLocalProjects();
  const workItemIconData = useWorkItemIconData(projects);
  const workItems = useLocalWorkItems();
  const backlogRowRefs = useRef(new Map<string, HTMLTableRowElement>());
  const backlogSortMenuRef = useRef<HTMLDivElement>(null);
  const expandedNoteModalOverlayRef = useRef<HTMLDivElement>(null);
  const expandedNoteTextareaRef = useRef<HTMLTextAreaElement>(null);
  const inlineDescriptionTextareaRef = useRef<HTMLTextAreaElement>(null);
  const activeInlineEditorRef = useRef<HTMLDivElement>(null);
  const backlogPointerSessionRef = useRef<SharedTableDragPointerSession | null>(
    null,
  );
  const backlogDragStateRef = useRef<BacklogDragState | null>(null);
  const suppressWorkItemClickUntilRef = useRef(0);
  const currentTimer = state.timers[0] ?? null;
  const backlogSortMode = state.backlogSortMode ?? "custom";
  const [isDesktopLayout, setIsDesktopLayout] = useState(() =>
    typeof window === "undefined"
      ? true
      : window.matchMedia(DESKTOP_ENTRY_MEDIA_QUERY).matches,
  );
  const [isCreatingItem, setIsCreatingItem] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newNote, setNewNote] = useState("");
  const [newBacklogStatusId, setNewBacklogStatusId] = useState("");
  const [newProjectId, setNewProjectId] = useState("");
  const [newTaskId, setNewTaskId] = useState("");
  const [expandedWorkItemId, setExpandedWorkItemId] = useState<string | null>(
    null,
  );
  const [expandedViewMode, setExpandedViewMode] =
    useState<ExpandedViewMode | null>(null);
  const [expandedTitle, setExpandedTitle] = useState("");
  const [expandedTitleDraft, setExpandedTitleDraft] = useState("");
  const [expandedPriority, setExpandedPriority] = useState("");
  const [expandedPriorityDraft, setExpandedPriorityDraft] = useState("");
  const [isExpandedTitleEditing, setIsExpandedTitleEditing] = useState(false);
  const [expandedNote, setExpandedNote] = useState("");
  const [expandedTimeEntryNote, setExpandedTimeEntryNote] = useState("");
  const [expandedBacklogStatusId, setExpandedBacklogStatusId] = useState("");
  const [expandedProjectId, setExpandedProjectId] = useState("");
  const [expandedTaskId, setExpandedTaskId] = useState("");
  const [expandedOriginalEstimateHours, setExpandedOriginalEstimateHours] =
    useState("");
  const [expandedRemainingEstimateHours, setExpandedRemainingEstimateHours] =
    useState("");
  const [expandedCompletedEstimateHours, setExpandedCompletedEstimateHours] =
    useState("");
  const [expandedDurationHours, setExpandedDurationHours] = useState("");
  const [expandedKeepWhenMissingFromSync, setExpandedKeepWhenMissingFromSync] =
    useState(false);
  const [expandedNoteModalTarget, setExpandedNoteModalTarget] =
    useState<ExpandedNoteModalTarget | null>(null);
  const [standaloneNoteModalState, setStandaloneNoteModalState] =
    useState<StandaloneNoteModalState | null>(null);
  const [expandedChildWorkItemId, setExpandedChildWorkItemId] = useState<
    string | null
  >(null);
  const [expandedChildEditor, setExpandedChildEditor] =
    useState<BacklogInlineEditorState>(EMPTY_BACKLOG_INLINE_EDITOR_STATE);
  const [subtaskDraftParentId, setSubtaskDraftParentId] = useState<
    string | null
  >(null);
  const [subtaskTitle, setSubtaskTitle] = useState("");
  const [subtaskNote, setSubtaskNote] = useState("");
  const [subtaskProjectId, setSubtaskProjectId] = useState("");
  const [subtaskTaskId, setSubtaskTaskId] = useState("");
  const [pendingArchiveWorkItemId, setPendingArchiveWorkItemId] = useState<
    string | null
  >(null);
  const [pendingDeleteWorkItemId, setPendingDeleteWorkItemId] = useState<
    string | null
  >(null);
  const [isCreateTaskModalOpen, setIsCreateTaskModalOpen] = useState(false);
  const [modalWorkItemId, setModalWorkItemId] = useState<string | null>(null);
  const [subtaskModalParentId, setSubtaskModalParentId] = useState<
    string | null
  >(null);
  const [activeFilter, setActiveFilter] = useState<BacklogFilter>("active");
  const [isSortMenuOpen, setIsSortMenuOpen] = useState(false);
  const [pressedWorkItemId, setPressedWorkItemId] = useState<string | null>(
    null,
  );
  const [backlogDragState, setBacklogDragState] =
    useState<BacklogDragState | null>(null);

  const { activeItems, archivedItems, visibleItems } = useMemo(() => {
    const active = workItems.filter((workItem) => workItem.status === "active");
    const archived = workItems.filter(
      (workItem) => workItem.status === "archived",
    );

    const visibleByFilter: Record<BacklogFilter, LocalWorkItem[]> = {
      active,
      archived,
    };

    return {
      activeItems: active,
      archivedItems: archived,
      visibleItems: visibleByFilter[activeFilter],
    };
  }, [workItems, activeFilter]);

  const filterCounts: Record<BacklogFilter, number> = {
    active: activeItems.length,
    archived: archivedItems.length,
  };

  const { visibleRootItems, allChildrenByParent } = useMemo(() => {
    const allLookupKeys = new Set(
      workItems.flatMap((workItem) => getWorkItemLookupKeys(workItem)),
    );
    const nextChildrenByParent = new Map<string, LocalWorkItem[]>();

    for (const workItem of workItems) {
      const parentKey = getWorkItemParentKey(workItem);
      if (!parentKey || !allLookupKeys.has(parentKey)) {
        continue;
      }

      const siblings = nextChildrenByParent.get(parentKey) ?? [];
      siblings.push(workItem);
      nextChildrenByParent.set(parentKey, siblings);
    }

    const visibleLookupKeys = new Set(
      visibleItems.flatMap((workItem) => getWorkItemLookupKeys(workItem)),
    );
    const nextRoots: LocalWorkItem[] = [];

    for (const workItem of visibleItems) {
      const parentKey = getWorkItemParentKey(workItem);
      if (parentKey && visibleLookupKeys.has(parentKey)) {
        continue;
      }

      nextRoots.push(workItem);
    }

    const visibleIndexById = new Map(
      visibleItems.map((workItem, index) => [workItem._id, index]),
    );

    if (isPrioritySortMode(backlogSortMode)) {
      nextRoots.sort((left, right) => {
        const leftPriority = left.priority ?? Number.MAX_SAFE_INTEGER;
        const rightPriority = right.priority ?? Number.MAX_SAFE_INTEGER;

        if (leftPriority !== rightPriority) {
          return backlogSortMode === "priority_desc"
            ? rightPriority - leftPriority
            : leftPriority - rightPriority;
        }

        return (
          (visibleIndexById.get(left._id) ?? 0) -
          (visibleIndexById.get(right._id) ?? 0)
        );
      });
    }

    return {
      visibleRootItems: nextRoots,
      allChildrenByParent: nextChildrenByParent,
    };
  }, [backlogSortMode, visibleItems, workItems]);

  const expandedWorkItem = useMemo(
    () =>
      workItems.find((workItem) => workItem._id === expandedWorkItemId) ?? null,
    [expandedWorkItemId, workItems],
  );
  const expandedChildWorkItem = useMemo(
    () =>
      workItems.find((workItem) => workItem._id === expandedChildWorkItemId) ??
      null,
    [expandedChildWorkItemId, workItems],
  );
  const draggedWorkItem = useMemo(
    () =>
      backlogDragState
        ? (workItems.find(
            (workItem) => workItem._id === backlogDragState.workItemId,
          ) ?? null)
        : null,
    [backlogDragState, workItems],
  );
  const workItemsById = useMemo(
    () => new Map(workItems.map((workItem) => [workItem._id, workItem])),
    [workItems],
  );
  const workItemsByLookupKey = useMemo(
    () =>
      new Map(
        workItems.flatMap((workItem) =>
          getWorkItemLookupKeys(workItem).map(
            (key) => [key, workItem] as const,
          ),
        ),
      ),
    [workItems],
  );
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
  const backlogStatusById = useMemo(
    () => buildBacklogStatusLookup(state.backlogStatuses),
    [state.backlogStatuses],
  );
  const backlogStatusNameById = useMemo(
    () => buildBacklogStatusNameLookup(state.backlogStatuses),
    [state.backlogStatuses],
  );

  const newAvailableTasks = useMemo(
    () =>
      projects
        .find((project) => project._id === newProjectId)
        ?.tasks.filter((task) => task.status === "active") ?? [],
    [newProjectId, projects],
  );
  const newTaskOptions = useMemo(
    () => buildProjectTaskOptions(newAvailableTasks),
    [newAvailableTasks],
  );

  const expandedAvailableTasks = useMemo(
    () =>
      projects
        .find((project) => project._id === expandedProjectId)
        ?.tasks.filter((task) => task.status === "active") ?? [],
    [expandedProjectId, projects],
  );
  const expandedTaskOptions = useMemo(
    () => buildProjectTaskOptions(expandedAvailableTasks),
    [expandedAvailableTasks],
  );
  const expandedParsedDurationMs = useMemo(
    () => parseHoursInput(expandedDurationHours),
    [expandedDurationHours],
  );
  const expandedChildAvailableTasks = useMemo(
    () =>
      projects
        .find((project) => project._id === expandedChildEditor.projectId)
        ?.tasks.filter((task) => task.status === "active") ?? [],
    [expandedChildEditor.projectId, projects],
  );
  const expandedChildTaskOptions = useMemo(
    () => buildProjectTaskOptions(expandedChildAvailableTasks),
    [expandedChildAvailableTasks],
  );
  const expandedChildParsedDurationMs = useMemo(
    () => parseHoursInput(expandedChildEditor.durationHours),
    [expandedChildEditor.durationHours],
  );

  const subtaskAvailableTasks = useMemo(
    () =>
      projects
        .find((project) => project._id === subtaskProjectId)
        ?.tasks.filter((task) => task.status === "active") ?? [],
    [projects, subtaskProjectId],
  );
  const subtaskTaskOptions = useMemo(
    () => buildProjectTaskOptions(subtaskAvailableTasks),
    [subtaskAvailableTasks],
  );
  const expandedNoteModalTitle = useMemo(() => {
    if (standaloneNoteModalState) {
      return (
        workItemsById.get(standaloneNoteModalState.workItemId)?.title ||
        "Untitled task"
      );
    }

    if (expandedNoteModalTarget === "child") {
      return (
        expandedChildEditor.titleDraft.trim() ||
        expandedChildEditor.title.trim() ||
        expandedChildWorkItem?.title ||
        "Untitled subtask"
      );
    }

    return (
      expandedTitleDraft.trim() ||
      expandedTitle.trim() ||
      expandedWorkItem?.title ||
      "Untitled task"
    );
  }, [
    expandedChildEditor.title,
    expandedChildEditor.titleDraft,
    expandedChildWorkItem?.title,
    expandedNoteModalTarget,
    expandedTitle,
    expandedTitleDraft,
    standaloneNoteModalState,
    workItemsById,
    expandedWorkItem?.title,
  ]);
  const expandedNoteModalWorkItem = standaloneNoteModalState
    ? (workItemsById.get(standaloneNoteModalState.workItemId) ?? null)
    : expandedNoteModalTarget === "child"
      ? expandedChildWorkItem
      : expandedWorkItem;
  const expandedNoteModalIcon = expandedNoteModalWorkItem
    ? resolveWorkItemIcon(expandedNoteModalWorkItem, workItemIconData)
    : null;
  const expandedNoteModalValue = standaloneNoteModalState
    ? standaloneNoteModalState.note
    : expandedNoteModalTarget === "child"
      ? expandedChildEditor.note
      : expandedNote;
  const isAnyModalOpen = Boolean(
    isCreateTaskModalOpen || modalWorkItemId || subtaskModalParentId,
  );
  const canReorderVisibleRootItems =
    backlogSortMode === "custom" &&
    !isCreatingItem &&
    !expandedWorkItemId &&
    !isAnyModalOpen &&
    visibleRootItems.length > 1;

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const mediaQuery = window.matchMedia(DESKTOP_ENTRY_MEDIA_QUERY);
    const syncLayout = (event?: MediaQueryListEvent) => {
      setIsDesktopLayout(event?.matches ?? mediaQuery.matches);
    };

    syncLayout();
    mediaQuery.addEventListener("change", syncLayout);
    return () => mediaQuery.removeEventListener("change", syncLayout);
  }, []);

  useEffect(() => {
    if (isDesktopLayout || !isCreatingItem) {
      return;
    }

    resetNewItem();
  }, [isCreatingItem, isDesktopLayout]);

  useEffect(() => {
    if (!isSortMenuOpen) {
      return;
    }

    function handleDocumentMouseDown(event: MouseEvent) {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }

      if (backlogSortMenuRef.current?.contains(target)) {
        return;
      }

      setIsSortMenuOpen(false);
    }

    function handleDocumentKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsSortMenuOpen(false);
      }
    }

    document.addEventListener("mousedown", handleDocumentMouseDown);
    document.addEventListener("keydown", handleDocumentKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleDocumentMouseDown);
      document.removeEventListener("keydown", handleDocumentKeyDown);
    };
  }, [isSortMenuOpen]);

  useEffect(() => {
    if (!expandedNoteModalTarget && !standaloneNoteModalState) {
      return;
    }

    expandedNoteTextareaRef.current?.focus();
    expandedNoteTextareaRef.current?.setSelectionRange(
      expandedNoteTextareaRef.current.value.length,
      expandedNoteTextareaRef.current.value.length,
    );

    function handleDocumentKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        closeExpandedNoteModal();
      }
    }

    document.addEventListener("keydown", handleDocumentKeyDown);
    return () => {
      document.removeEventListener("keydown", handleDocumentKeyDown);
    };
  }, [expandedNoteModalTarget, standaloneNoteModalState]);

  useEffect(() => {
    if (!isDesktopLayout) {
      return;
    }

    if (expandedViewMode !== "edit" && !expandedChildWorkItemId) {
      return;
    }

    function handleDocumentMouseDown(event: MouseEvent) {
      if (
        !isInlineEditorOutsideClick(event.target, activeInlineEditorRef.current, [
          `[data-backlog-root-id="${expandedRootWorkItemId}"]`,
        ])
      ) {
        return;
      }

      if (expandedChildWorkItemId) {
        closeExpandedChildItem();
        return;
      }

      closeExpandedItem();
    }

    document.addEventListener("mousedown", handleDocumentMouseDown);
    return () => {
      document.removeEventListener("mousedown", handleDocumentMouseDown);
    };
  }, [
    closeExpandedChildItem,
    closeExpandedItem,
    expandedChildWorkItemId,
    expandedViewMode,
    isDesktopLayout,
  ]);

  useEffect(() => {
    backlogDragStateRef.current = backlogDragState;
  }, [backlogDragState]);

  const clearBacklogPointerSession = useCallback(() => {
    const session = backlogPointerSessionRef.current;
    if (!session) {
      return;
    }

    session.dispose();
    backlogPointerSessionRef.current = null;
  }, []);

  const resetBacklogDragVisuals = useCallback(() => {
    setSharedTableDragDocumentState(false, "backlog-drag-active");
  }, []);

  const finishBacklogDrag = useCallback(
    (shouldCommit: boolean) => {
      const currentDrag = backlogDragStateRef.current;
      if (!currentDrag) {
        setPressedWorkItemId(null);
        resetBacklogDragVisuals();
        return;
      }

      if (shouldCommit && currentDrag.originIndex !== currentDrag.targetIndex) {
        localStore.reorderWorkItems(
          moveItem(
            currentDrag.groupIds,
            currentDrag.originIndex,
            currentDrag.targetIndex,
          ),
        );
      }

      suppressWorkItemClickUntilRef.current =
        performance.now() + SHARED_TABLE_DRAG_CLICK_SUPPRESSION_MS;
      backlogDragStateRef.current = null;
      setBacklogDragState(null);
      setPressedWorkItemId(null);
      resetBacklogDragVisuals();
    },
    [resetBacklogDragVisuals],
  );

  useEffect(() => {
    return () => {
      clearBacklogPointerSession();
      backlogDragStateRef.current = null;
      resetBacklogDragVisuals();
    };
  }, [clearBacklogPointerSession, resetBacklogDragVisuals]);

  useEffect(() => {
    clearBacklogPointerSession();
    backlogDragStateRef.current = null;
    setPressedWorkItemId(null);
    setBacklogDragState(null);
    resetBacklogDragVisuals();
  }, [
    activeFilter,
    expandedChildWorkItemId,
    expandedWorkItemId,
    isCreatingItem,
    modalWorkItemId,
    clearBacklogPointerSession,
    resetBacklogDragVisuals,
  ]);

  function getChildItems(workItem: LocalWorkItem) {
    return getWorkItemLookupKeys(workItem)
      .flatMap((lookupKey) => allChildrenByParent.get(lookupKey) ?? [])
      .sort((left, right) => right.createdAt - left.createdAt);
  }

  function getRootWorkItemId(workItem: LocalWorkItem | null) {
    if (!workItem) {
      return null;
    }

    const parentKey = getWorkItemParentKey(workItem);
    if (!parentKey) {
      return workItem._id;
    }

    return workItemsByLookupKey.get(parentKey)?._id ?? workItem._id;
  }

  const expandedRootWorkItemId = useMemo(() => {
    if (!expandedWorkItemId) {
      return null;
    }

    if (expandedViewMode === "subtasks") {
      return expandedWorkItemId;
    }

    return getRootWorkItemId(expandedWorkItem);
  }, [
    expandedViewMode,
    expandedWorkItem,
    expandedWorkItemId,
    workItemsByLookupKey,
  ]);

  function resetNewItem() {
    setIsCreatingItem(false);
    setNewTitle("");
    setNewNote("");
    setNewBacklogStatusId("");
    setNewProjectId("");
    setNewTaskId("");
  }

  function resetSubtaskDraft() {
    setSubtaskDraftParentId(null);
    setSubtaskTitle("");
    setSubtaskNote("");
    setSubtaskProjectId("");
    setSubtaskTaskId("");
  }

  function resetExpandedChildItem() {
    setExpandedNoteModalTarget((current) =>
      current === "child" ? null : current,
    );
    setExpandedChildWorkItemId(null);
    setExpandedChildEditor(EMPTY_BACKLOG_INLINE_EDITOR_STATE);
  }

  function seedSubtaskDraft(parent: LocalWorkItem) {
    setSubtaskDraftParentId(parent._id);
    setSubtaskTitle("");
    setSubtaskNote("");
    setSubtaskProjectId(parent.projectId ?? "");
    setSubtaskTaskId(parent.taskId ?? "");
  }

  function clearExpandedEditorState() {
    setExpandedNoteModalTarget((current) =>
      current === "root" ? null : current,
    );
    setExpandedTitle("");
    setExpandedTitleDraft("");
    setExpandedPriority("");
    setExpandedPriorityDraft("");
    setIsExpandedTitleEditing(false);
    setExpandedNote("");
    setExpandedTimeEntryNote("");
    setExpandedBacklogStatusId("");
    setExpandedProjectId("");
    setExpandedTaskId("");
    setExpandedOriginalEstimateHours("");
    setExpandedRemainingEstimateHours("");
    setExpandedCompletedEstimateHours("");
    setExpandedDurationHours("");
    setExpandedKeepWhenMissingFromSync(false);
    setPendingArchiveWorkItemId(null);
    setPendingDeleteWorkItemId(null);
    resetSubtaskDraft();
  }

  function resetExpandedItem() {
    closeExpandedChildItem();
    setExpandedWorkItemId(null);
    setExpandedViewMode(null);
    clearExpandedEditorState();
  }

  function openSubtasksPanel(workItem: LocalWorkItem) {
    closeExpandedChildItem();
    setExpandedWorkItemId(workItem._id);
    setExpandedViewMode("subtasks");
    clearExpandedEditorState();
  }

  function closeNewItem() {
    const draft = buildBacklogTaskDraft(
      createBacklogTaskEditorFields(undefined, {
        title: newTitle,
        note: newNote,
        backlogStatusId: newBacklogStatusId,
        projectId: newProjectId,
        taskId: newTaskId,
      }),
      { isSubtask: false },
    );
    if (draft) {
      localStore.addWorkItem(draft);
    }

    resetNewItem();
  }

  function buildExpandedWorkItemPatch(
    workItem: LocalWorkItem,
    preserveTitle = false,
  ) {
    return buildBacklogTaskPatch(
      workItem,
      createBacklogTaskEditorFields(workItem, {
        title: expandedTitle,
        note: expandedNote,
        priority: expandedPriority,
        backlogStatusId: expandedBacklogStatusId,
        projectId: expandedProjectId,
        taskId: expandedTaskId,
        originalEstimateHours: expandedOriginalEstimateHours,
        remainingEstimateHours: expandedRemainingEstimateHours,
        completedEstimateHours: expandedCompletedEstimateHours,
        keepWhenMissingFromSync: expandedKeepWhenMissingFromSync,
      }),
      {
        isSubtask: isSubtaskWorkItem(workItem),
        preserveTitle,
        includeRetention: true,
      },
    );
  }

  function commitExpandedEdits(workItem: LocalWorkItem) {
    const patch = buildExpandedWorkItemPatch(workItem);
    if (!patch) {
      return;
    }

    localStore.updateWorkItem(workItem._id, patch);
  }

  function buildExpandedChildWorkItemPatch(
    workItem: LocalWorkItem,
    preserveTitle = false,
  ) {
    return buildBacklogTaskPatch(
      workItem,
      createBacklogTaskEditorFields(workItem, {
        title: expandedChildEditor.title,
        note: expandedChildEditor.note,
        backlogStatusId: expandedChildEditor.backlogStatusId,
        projectId: expandedChildEditor.projectId,
        taskId: expandedChildEditor.taskId,
        originalEstimateHours: expandedChildEditor.originalEstimateHours,
        remainingEstimateHours: expandedChildEditor.remainingEstimateHours,
        completedEstimateHours: expandedChildEditor.completedEstimateHours,
        keepWhenMissingFromSync:
          expandedChildEditor.keepWhenMissingFromSync,
      }),
      {
        isSubtask: true,
        preserveTitle,
        includeRetention: true,
      },
    );
  }

  function commitExpandedChildEdits(workItem: LocalWorkItem) {
    const patch = buildExpandedChildWorkItemPatch(workItem);
    if (!patch) {
      return;
    }

    localStore.updateWorkItem(workItem._id, patch);
  }

  function closeExpandedItem(options?: { preserveSubtasks?: boolean }) {
    if (!expandedWorkItem || expandedViewMode !== "edit") {
      resetExpandedItem();
      return;
    }

    const rootWorkItemId = getRootWorkItemId(expandedWorkItem);
    const rootWorkItem = rootWorkItemId
      ? (workItemsById.get(rootWorkItemId) ?? null)
      : null;

    commitExpandedEdits(expandedWorkItem);

    if (options?.preserveSubtasks && rootWorkItem) {
      openSubtasksPanel(rootWorkItem);
      return;
    }

    resetExpandedItem();
  }

  function openEditPanel(workItem: LocalWorkItem) {
    const childItems = isSubtaskWorkItem(workItem) ? [] : getChildItems(workItem);
    const childEstimateTotals =
      childItems.length > 0 ? sumChildEstimateTotals(childItems) : null;
    closeExpandedChildItem();
    setExpandedWorkItemId(workItem._id);
    setExpandedViewMode("edit");
    setExpandedTitle(workItem.title);
    setExpandedTitleDraft(workItem.title);
    setExpandedPriority(formatPriorityInput(workItem.priority));
    setExpandedPriorityDraft(formatPriorityInput(workItem.priority));
    setIsExpandedTitleEditing(false);
    setExpandedNote(workItem.note ?? "");
    setExpandedTimeEntryNote("");
    setExpandedBacklogStatusId(workItem.backlogStatusId ?? "");
    setExpandedProjectId(workItem.projectId ?? "");
    setExpandedTaskId(workItem.taskId ?? "");
    setExpandedOriginalEstimateHours(
      childEstimateTotals
        ? formatEstimateInput(childEstimateTotals.originalEstimateHours)
        : typeof workItem.originalEstimateHours === "number"
          ? String(workItem.originalEstimateHours)
          : "",
    );
    setExpandedRemainingEstimateHours(
      childEstimateTotals
        ? formatEstimateInput(childEstimateTotals.remainingEstimateHours)
        : typeof workItem.remainingEstimateHours === "number"
          ? String(workItem.remainingEstimateHours)
          : "",
    );
    setExpandedCompletedEstimateHours(
      childEstimateTotals
        ? formatEstimateInput(childEstimateTotals.completedEstimateHours)
        : typeof workItem.completedEstimateHours === "number"
          ? String(workItem.completedEstimateHours)
          : "",
    );
    setExpandedKeepWhenMissingFromSync(
      workItem.keepWhenMissingFromSync ?? false,
    );
    setExpandedDurationHours("");
    setPendingArchiveWorkItemId(null);
    resetSubtaskDraft();
  }

  function closeExpandedChildItem() {
    if (!expandedChildWorkItem) {
      resetExpandedChildItem();
      return;
    }

    commitExpandedChildEdits(expandedChildWorkItem);
    resetExpandedChildItem();
  }

  function openExpandedChildEdit(workItem: LocalWorkItem) {
    if (expandedViewMode === "edit" && expandedWorkItemId) {
      closeExpandedItem({ preserveSubtasks: true });
    }

    setExpandedViewMode("subtasks");
    setExpandedChildWorkItemId(workItem._id);
    setExpandedChildEditor(buildBacklogInlineEditorState(workItem));
    setPendingArchiveWorkItemId(null);
    setPendingDeleteWorkItemId(null);
  }

  function beginSubtaskCreation(parent: LocalWorkItem) {
    if (isCreatingItem) {
      closeNewItem();
    }

    if (expandedWorkItemId && expandedWorkItemId !== parent._id) {
      closeExpandedItem();
    }

    if (expandedWorkItemId !== parent._id) {
      openEditPanel(parent);
    }

    closeExpandedChildItem();
    setPendingArchiveWorkItemId(null);
    seedSubtaskDraft(parent);
  }

  function cancelSubtaskCreation() {
    resetSubtaskDraft();
  }

  function submitSubtask(parent: LocalWorkItem) {
    const draft = buildBacklogTaskDraft(
      createBacklogTaskEditorFields(undefined, {
        title: subtaskTitle,
        note: subtaskNote,
        parentWorkItemId: parent._id,
        projectId: subtaskProjectId,
        taskId: subtaskTaskId,
      }),
      {
        isSubtask: true,
        requireParent: true,
      },
    );
    if (!draft) {
      return;
    }

    localStore.addSubtask(parent._id, draft);
    resetSubtaskDraft();
  }

  useEffect(() => {
    if (expandedWorkItemId && !expandedWorkItem) {
      resetExpandedItem();
    }
  }, [expandedWorkItem, expandedWorkItemId]);

  useEffect(() => {
    if (expandedChildWorkItemId && !expandedChildWorkItem) {
      resetExpandedChildItem();
    }
  }, [expandedChildWorkItem, expandedChildWorkItemId]);

  useEffect(() => {
    if (!standaloneNoteModalState) {
      return;
    }

    if (workItemsById.has(standaloneNoteModalState.workItemId)) {
      return;
    }

    setStandaloneNoteModalState(null);
  }, [standaloneNoteModalState, workItemsById]);

  useEffect(() => {
    if (!pendingArchiveWorkItemId) {
      return;
    }

    if (
      workItems.some((workItem) => workItem._id === pendingArchiveWorkItemId)
    ) {
      return;
    }

    setPendingArchiveWorkItemId(null);
  }, [pendingArchiveWorkItemId, workItems]);

  useEffect(() => {
    if (!pendingArchiveWorkItemId) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setPendingArchiveWorkItemId((current) =>
        current === pendingArchiveWorkItemId ? null : current,
      );
    }, 2500);

    return () => window.clearTimeout(timeoutId);
  }, [pendingArchiveWorkItemId]);

  useEffect(() => {
    if (!pendingDeleteWorkItemId) {
      return;
    }

    if (
      workItems.some((workItem) => workItem._id === pendingDeleteWorkItemId)
    ) {
      return;
    }

    setPendingDeleteWorkItemId(null);
  }, [pendingDeleteWorkItemId, workItems]);

  useEffect(() => {
    if (!pendingDeleteWorkItemId) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setPendingDeleteWorkItemId((current) =>
        current === pendingDeleteWorkItemId ? null : current,
      );
    }, 2500);

    return () => window.clearTimeout(timeoutId);
  }, [pendingDeleteWorkItemId]);

  useEffect(() => {
    if (newBacklogStatusId && !backlogStatusNameById.has(newBacklogStatusId)) {
      setNewBacklogStatusId("");
    }
  }, [backlogStatusNameById, newBacklogStatusId]);

  useEffect(() => {
    if (!newProjectId) {
      setNewTaskId("");
      return;
    }

    if (!newAvailableTasks.some((task) => task._id === newTaskId)) {
      setNewTaskId(newAvailableTasks[0]?._id ?? "");
    }
  }, [newAvailableTasks, newProjectId, newTaskId]);

  useEffect(() => {
    if (
      expandedBacklogStatusId &&
      !backlogStatusNameById.has(expandedBacklogStatusId)
    ) {
      setExpandedBacklogStatusId("");
    }
  }, [backlogStatusNameById, expandedBacklogStatusId]);

  useEffect(() => {
    if (!expandedProjectId) {
      setExpandedTaskId("");
      return;
    }

    if (!expandedAvailableTasks.some((task) => task._id === expandedTaskId)) {
      setExpandedTaskId(expandedAvailableTasks[0]?._id ?? "");
    }
  }, [expandedAvailableTasks, expandedProjectId, expandedTaskId]);

  useEffect(() => {
    if (
      expandedChildEditor.backlogStatusId &&
      !backlogStatusNameById.has(expandedChildEditor.backlogStatusId)
    ) {
      setExpandedChildEditor((current) => ({
        ...current,
        backlogStatusId: "",
      }));
    }
  }, [backlogStatusNameById, expandedChildEditor.backlogStatusId]);

  useEffect(() => {
    if (!expandedChildEditor.projectId) {
      if (expandedChildEditor.taskId) {
        setExpandedChildEditor((current) => ({ ...current, taskId: "" }));
      }
      return;
    }

    if (
      !expandedChildAvailableTasks.some(
        (task) => task._id === expandedChildEditor.taskId,
      )
    ) {
      setExpandedChildEditor((current) => ({
        ...current,
        taskId: expandedChildAvailableTasks[0]?._id ?? "",
      }));
    }
  }, [
    expandedChildAvailableTasks,
    expandedChildEditor.projectId,
    expandedChildEditor.taskId,
  ]);

  useEffect(() => {
    if (!subtaskProjectId) {
      setSubtaskTaskId("");
      return;
    }

    if (!subtaskAvailableTasks.some((task) => task._id === subtaskTaskId)) {
      setSubtaskTaskId(subtaskAvailableTasks[0]?._id ?? "");
    }
  }, [subtaskAvailableTasks, subtaskProjectId, subtaskTaskId]);

  function handleCreateToggle() {
    if (!isDesktopLayout) {
      if (isCreateTaskModalOpen) {
        setIsCreateTaskModalOpen(false);
        return;
      }

      setIsSortMenuOpen(false);
      closeExpandedItem();
      setPendingArchiveWorkItemId(null);
      setPendingDeleteWorkItemId(null);
      setModalWorkItemId(null);
      setSubtaskModalParentId(null);
      setIsCreatingItem(false);
      setIsCreateTaskModalOpen(true);
      return;
    }

    if (isCreatingItem) {
      closeNewItem();
      return;
    }

    setIsSortMenuOpen(false);
    closeExpandedItem();
    setPendingArchiveWorkItemId(null);
    setPendingDeleteWorkItemId(null);
    setIsCreatingItem(true);
  }

  function handleWorkItemPointerDown(
    workItem: LocalWorkItem,
    event: React.PointerEvent<HTMLTableRowElement>,
  ) {
    if (
      !canReorderVisibleRootItems ||
      event.button !== 0 ||
      isSubtaskWorkItem(workItem) ||
      isBacklogDragBlockedTarget(event.target)
    ) {
      return;
    }

    const groupIds = visibleRootItems.map((item) => item._id);
    const sourceIndex = groupIds.indexOf(workItem._id);
    if (sourceIndex === -1) {
      return;
    }

    event.currentTarget.setPointerCapture(event.pointerId);
    clearBacklogPointerSession();
    setPressedWorkItemId(workItem._id);

    const { clientX, clientY, pointerId, pointerType } = event;
    const startDrag = (pointerX: number, pointerY: number) => {
      const row = backlogRowRefs.current.get(workItem._id);
      if (!row) {
        setPressedWorkItemId(null);
        return;
      }

      const rect = row.getBoundingClientRect();
      const firstRowRect = backlogRowRefs.current
        .get(groupIds[0] ?? workItem._id)
        ?.getBoundingClientRect();
      setSharedTableDragDocumentState(true, "backlog-drag-active");
      suppressWorkItemClickUntilRef.current =
        performance.now() + SHARED_TABLE_DRAG_CLICK_SUPPRESSION_MS;
      setPressedWorkItemId(null);
      setPendingArchiveWorkItemId(null);
      const nextDragState: BacklogDragState = {
        workItemId: workItem._id,
        groupIds,
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
      backlogDragStateRef.current = nextDragState;
      setBacklogDragState(nextDragState);
    };

    backlogPointerSessionRef.current = createSharedTableDragPointerSession({
      pointerId,
      pointerType,
      originX: clientX,
      originY: clientY,
      isDragging: () =>
        backlogDragStateRef.current?.pointerId === pointerId,
      onStart: (pointer) => {
        startDrag(pointer.clientX, pointer.clientY);
      },
      onMove: (pointer) => {
        const current = backlogDragStateRef.current;
        if (!current) {
          return;
        }

        const nextDragState: BacklogDragState = {
          ...current,
          pointerX: pointer.clientX,
          pointerY: pointer.clientY,
          targetIndex: getSharedTableDragTargetIndex(
            current.groupIds,
            current.workItemId,
            pointer.clientY,
            backlogRowRefs.current,
          ),
        };
        backlogDragStateRef.current = nextDragState;
        setBacklogDragState(nextDragState);
      },
      onEnd: (shouldCommit) => {
        backlogPointerSessionRef.current = null;
        finishBacklogDrag(shouldCommit);
      },
      onPressEnd: (cancelled) => {
        backlogPointerSessionRef.current = null;
        setPressedWorkItemId(null);
        if (cancelled) {
          return;
        }

        suppressWorkItemClickUntilRef.current =
          performance.now() + SHARED_TABLE_DRAG_CLICK_SUPPRESSION_MS;
        handleToggleWorkItem(workItem, { ignoreClickSuppression: true });
      },
    });
  }

  function handleToggleWorkItem(
    workItem: LocalWorkItem,
    options?: { ignoreClickSuppression?: boolean },
  ) {
    if (
      !options?.ignoreClickSuppression &&
      performance.now() < suppressWorkItemClickUntilRef.current
    ) {
      return;
    }

    if (isCreatingItem) {
      closeNewItem();
    }

    if (!isDesktopLayout) {
      setPendingArchiveWorkItemId(null);
      setPendingDeleteWorkItemId(null);
      handleOpenWorkItemModal(workItem._id);
      return;
    }

    if (isSubtaskWorkItem(workItem)) {
      if (expandedChildWorkItemId && expandedChildWorkItemId !== workItem._id) {
        closeExpandedChildItem();
      }

      if (expandedChildWorkItemId === workItem._id) {
        closeExpandedChildItem();
        return;
      }

      openExpandedChildEdit(workItem);
      return;
    }

    if (expandedChildWorkItemId) {
      closeExpandedChildItem();
    }

    if (
      expandedViewMode === "edit" &&
      expandedWorkItemId &&
      expandedWorkItemId !== workItem._id
    ) {
      const isClosingChild = expandedWorkItem
        ? isSubtaskWorkItem(expandedWorkItem)
        : false;
      closeExpandedItem({ preserveSubtasks: isClosingChild });
    }

    if (expandedViewMode === "edit" && expandedWorkItemId === workItem._id) {
      closeExpandedItem({ preserveSubtasks: isSubtaskWorkItem(workItem) });
      return;
    }

    openEditPanel(workItem);
  }

  function handleToggleSubtasks(workItem: LocalWorkItem) {
    if (isSubtaskWorkItem(workItem)) {
      return;
    }

    if (expandedRootWorkItemId === workItem._id) {
      if (expandedViewMode === "edit") {
        closeExpandedItem({ preserveSubtasks: true });
        return;
      }

      resetExpandedItem();
      return;
    }

    if (expandedViewMode === "edit" && expandedWorkItemId) {
      closeExpandedItem();
    }

    openSubtasksPanel(workItem);
  }

  function handleOpenWorkItemModal(workItemId: string) {
    if (isCreatingItem) {
      closeNewItem();
    }

    setIsCreateTaskModalOpen(false);
    setPendingArchiveWorkItemId(null);
    setPendingDeleteWorkItemId(null);
    setModalWorkItemId(workItemId);
  }

  function handleOpenSubtaskModal(parentWorkItemId: string) {
    if (isCreatingItem) {
      closeNewItem();
    }

    setIsCreateTaskModalOpen(false);
    setPendingArchiveWorkItemId(null);
    setPendingDeleteWorkItemId(null);
    setSubtaskModalParentId(parentWorkItemId);
  }

  function openExpandedNoteModal(target: ExpandedNoteModalTarget) {
    setExpandedNoteModalTarget(target);
  }

  function handleOpenWorkItemNote(workItem: LocalWorkItem) {
    if (isCreatingItem) {
      closeNewItem();
    }

    setPendingArchiveWorkItemId(null);
    setPendingDeleteWorkItemId(null);
    if (!isDesktopLayout) {
      handleOpenWorkItemModal(workItem._id);
      return;
    }

    setStandaloneNoteModalState({
      workItemId: workItem._id,
      note: workItem.note ?? "",
    });
  }

  function closeExpandedNoteModal() {
    if (standaloneNoteModalState) {
      localStore.updateWorkItem(standaloneNoteModalState.workItemId, {
        note: standaloneNoteModalState.note.trim() || undefined,
      });
      setStandaloneNoteModalState(null);
      return;
    }

    setExpandedNoteModalTarget(null);
  }

  function handleExpandedNoteModalChange(value: string) {
    if (standaloneNoteModalState) {
      setStandaloneNoteModalState((current) =>
        current ? { ...current, note: value } : current,
      );
      return;
    }

    if (expandedNoteModalTarget === "child") {
      setExpandedChildEditor((current) => ({ ...current, note: value }));
      return;
    }

    setExpandedNote(value);
  }

  function handleArchiveWorkItem(workItemId: string) {
    setPendingDeleteWorkItemId(null);

    if (pendingArchiveWorkItemId === workItemId) {
      localStore.archiveWorkItem(workItemId);
      setPendingArchiveWorkItemId(null);
      if (expandedWorkItemId === workItemId) {
        resetExpandedItem();
      } else if (expandedChildWorkItemId === workItemId) {
        resetExpandedChildItem();
      }
      return;
    }

    setPendingArchiveWorkItemId(workItemId);
  }

  function handleUnarchiveWorkItem(workItemId: string) {
    localStore.restoreWorkItem(workItemId);
    setPendingArchiveWorkItemId(null);
    setPendingDeleteWorkItemId(null);
  }

  function handleDeleteWorkItem(workItemId: string) {
    setPendingArchiveWorkItemId(null);

    if (pendingDeleteWorkItemId === workItemId) {
      localStore.deleteWorkItem(workItemId);
      setPendingDeleteWorkItemId(null);
      if (expandedWorkItemId === workItemId) {
        resetExpandedItem();
      } else if (expandedChildWorkItemId === workItemId) {
        resetExpandedChildItem();
      }
      return;
    }

    setPendingDeleteWorkItemId(workItemId);
  }

  function handleStartWorkItemTimer(
    workItem: LocalWorkItem,
    overrides?: {
      title?: string;
      note?: string;
      projectId?: string;
      taskId?: string;
    },
  ) {
    const nextTitle = overrides?.title?.trim() || workItem.title;
    const nextNote = overrides?.note?.trim() || undefined;
    const nextProjectId = overrides?.projectId || workItem.projectId;
    const nextTaskId = overrides?.taskId || workItem.taskId;

    if (workItem.status === "archived") {
      return;
    }

    if (overrides) {
      localStore.updateWorkItem(workItem._id, {
        title: nextTitle,
        note: nextNote,
        projectId: nextProjectId,
        taskId: nextTaskId,
      });
    }

    localStore.startTimer({
      localDate: todayIsoDate(),
      workItemId: workItem._id,
      projectId: nextProjectId,
      taskId: nextTaskId,
      note: buildWorkItemTimerComment(nextTitle, workItem.sourceId),
      accumulatedDurationMs: 0,
    });
  }

  function beginExpandedTitleEdit() {
    setExpandedTitleDraft(expandedTitle);
    setExpandedPriorityDraft(expandedPriority);
    setIsExpandedTitleEditing(true);
  }

  function cancelExpandedTitleEdit() {
    setExpandedTitleDraft(expandedTitle);
    setExpandedPriorityDraft(expandedPriority);
    setIsExpandedTitleEditing(false);
  }

  function saveExpandedTitleEdit() {
    const title = expandedTitleDraft.trim();
    if (!title) {
      return;
    }

    if (expandedWorkItem && !isSubtaskWorkItem(expandedWorkItem)) {
      const parsedPriority = parsePriorityInput(expandedPriorityDraft);
      if (parsedPriority === null) {
        return;
      }

      const nextPriority =
        typeof parsedPriority === "number" ? String(parsedPriority) : "";
      setExpandedPriority(nextPriority);
      setExpandedPriorityDraft(nextPriority);
    }

    setExpandedTitle(title);
    setExpandedTitleDraft(title);
    setIsExpandedTitleEditing(false);
  }

  function cancelExpandedTime() {
    setExpandedDurationHours("");
  }

  function submitExpandedTime() {
    if (
      !expandedWorkItem ||
      !expandedParsedDurationMs ||
      expandedParsedDurationMs <= 0
    ) {
      return;
    }

    const hasSubtasks =
      !isSubtaskWorkItem(expandedWorkItem) &&
      getChildItems(expandedWorkItem).length > 0;
    const timeEntryTitle = expandedTitle.trim() || expandedWorkItem.title;
    const patch = buildExpandedWorkItemPatch(expandedWorkItem, true);
    const nextEstimates = applyLoggedTimeToEstimateValues(
      {
        remainingEstimateHours:
          patch?.remainingEstimateHours ??
          expandedWorkItem.remainingEstimateHours,
        completedEstimateHours:
          patch?.completedEstimateHours ??
          expandedWorkItem.completedEstimateHours,
      },
      {
        projectId: patch?.projectId ?? (expandedProjectId || undefined),
        taskId: patch?.taskId ?? (expandedTaskId || undefined),
        durationMsDelta: expandedParsedDurationMs,
      },
    );
    if (patch) {
      localStore.updateWorkItem(expandedWorkItem._id, patch);
    }

    localStore.saveManualTimeEntry({
      localDate: todayIsoDate(),
      workItemId: expandedWorkItem._id,
      projectId: (patch?.projectId ?? expandedProjectId) || undefined,
      taskId: (patch?.taskId ?? expandedTaskId) || undefined,
      note: buildManualTimeEntryNote(
        expandedTimeEntryNote,
        timeEntryTitle,
        expandedWorkItem.sourceId,
      ),
      durationMs: expandedParsedDurationMs,
    });
    syncBacklogWorkItemToSource(expandedWorkItem);
    if (!hasSubtasks) {
      setExpandedRemainingEstimateHours(
        formatEstimateInput(nextEstimates.remainingEstimateHours),
      );
      setExpandedCompletedEstimateHours(
        formatEstimateInput(nextEstimates.completedEstimateHours),
      );
    }
    setExpandedDurationHours("");
    setExpandedTimeEntryNote("");
  }

  function submitExpandedChildTime() {
    if (
      !expandedChildWorkItem ||
      !expandedChildParsedDurationMs ||
      expandedChildParsedDurationMs <= 0
    ) {
      return;
    }

    const timeEntryTitle =
      expandedChildEditor.title.trim() || expandedChildWorkItem.title;
    const patch = buildExpandedChildWorkItemPatch(expandedChildWorkItem, true);
    const nextEstimates = applyLoggedTimeToEstimateValues(
      {
        remainingEstimateHours:
          patch?.remainingEstimateHours ??
          expandedChildWorkItem.remainingEstimateHours,
        completedEstimateHours:
          patch?.completedEstimateHours ??
          expandedChildWorkItem.completedEstimateHours,
      },
      {
        projectId:
          patch?.projectId ?? (expandedChildEditor.projectId || undefined),
        taskId: patch?.taskId ?? (expandedChildEditor.taskId || undefined),
        durationMsDelta: expandedChildParsedDurationMs,
      },
    );
    if (patch) {
      localStore.updateWorkItem(expandedChildWorkItem._id, patch);
    }

    localStore.saveManualTimeEntry({
      localDate: todayIsoDate(),
      workItemId: expandedChildWorkItem._id,
      projectId:
        (patch?.projectId ?? expandedChildEditor.projectId) || undefined,
      taskId: (patch?.taskId ?? expandedChildEditor.taskId) || undefined,
      note: buildManualTimeEntryNote(
        expandedChildEditor.timeEntryNote,
        timeEntryTitle,
        expandedChildWorkItem.sourceId,
      ),
      durationMs: expandedChildParsedDurationMs,
    });
    syncBacklogWorkItemToSource(expandedChildWorkItem);
    setExpandedChildEditor((current) => ({
      ...current,
      remainingEstimateHours: formatEstimateInput(
        nextEstimates.remainingEstimateHours,
      ),
      completedEstimateHours: formatEstimateInput(
        nextEstimates.completedEstimateHours,
      ),
      durationHours: "",
      timeEntryNote: "",
    }));
  }

  function renderSubtasksSectionHeader(workItem: LocalWorkItem) {
    const showComposer = subtaskDraftParentId === workItem._id;

    return (
      <div className="backlog-subtasks-header">
        <div className="backlog-subtasks-heading">
          <span className="backlog-subtasks-title">Tasks</span>
        </div>
        {!showComposer ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="gap-1.5 backlog-subtasks-add-btn"
            onClick={(event) => {
              event.stopPropagation();
              if (isDesktopLayout) {
                beginSubtaskCreation(workItem);
                return;
              }

              handleOpenSubtaskModal(workItem._id);
            }}
          >
            <Plus className="h-3.5 w-3.5" />
            Add task
          </Button>
        ) : null}
      </div>
    );
  }

  function renderSubtaskComposer(
    workItem: LocalWorkItem,
    childItems: LocalWorkItem[],
  ) {
    return (
      <div className="backlog-subtasks-composer">
        <div className="entry-edit-dropdown-grid">
          <label className="field backlog-field-title">
            <span className="field-label">Subtask</span>
            <input
              className="field-input"
              value={subtaskTitle}
              onChange={(event) => setSubtaskTitle(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  submitSubtask(workItem);
                }
              }}
              placeholder="Subtask name"
            />
          </label>

          <label className="field backlog-field-project">
            <span className="field-label">Project</span>
            <SearchableSelect
              value={subtaskProjectId}
              options={projectOptions}
              onChange={setSubtaskProjectId}
              placeholder="No project"
              clearLabel="No project"
              emptyMessage="No matching projects"
              ariaLabel="Subtask project"
            />
          </label>

          <label className="field backlog-field-task">
            <span className="field-label">Task mapping</span>
            <SearchableSelect
              value={subtaskTaskId}
              options={subtaskTaskOptions}
              onChange={setSubtaskTaskId}
              placeholder={
                subtaskProjectId ? "Select task" : "Pick a project first"
              }
              clearLabel={subtaskProjectId ? "No task" : undefined}
              emptyMessage={
                subtaskProjectId ? "No matching tasks" : "Pick a project first"
              }
              ariaLabel="Subtask task mapping"
              disabled={!subtaskProjectId || subtaskAvailableTasks.length === 0}
            />
          </label>

          <label className="field backlog-field-note">
            <span className="field-label">Description</span>
            <textarea
              className="field-input entry-note-input"
              value={subtaskNote}
              onChange={(event) => setSubtaskNote(event.target.value)}
              placeholder="Description (optional)"
              rows={2}
            />
          </label>
        </div>

        <div className="backlog-subtasks-actions">
          <Button
            type="button"
            size="sm"
            className="gap-1.5"
            onClick={() => submitSubtask(workItem)}
            disabled={!subtaskTitle.trim()}
          >
            <Plus className="h-3.5 w-3.5" />
            Add subtask
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={cancelSubtaskCreation}
          >
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  function renderSubtasksSectionRow(
    workItem: LocalWorkItem,
    childItems: LocalWorkItem[],
  ) {
    const showComposer = subtaskDraftParentId === workItem._id;

    return (
      <tr
        className="entry-edit-row"
        data-backlog-root-id={workItem._id}
        onClick={(event) => event.stopPropagation()}
      >
        <td colSpan={BACKLOG_TABLE_COLUMN_COUNT}>
          <div className="entry-edit-dropdown backlog-subtasks-panel">
            {renderSubtasksSectionHeader(workItem)}
            {showComposer ? renderSubtaskComposer(workItem, childItems) : null}
          </div>
        </td>
      </tr>
    );
  }

  function renderWorkItemRow(workItem: LocalWorkItem, forceChild = false) {
    const project = projects.find((item) => item._id === workItem.projectId);
    const task = project?.tasks.find((item) => item._id === workItem.taskId);
    const isLogicalChild = forceChild || isSubtaskWorkItem(workItem);
    const childItems = isLogicalChild ? [] : getChildItems(workItem);
    const childEstimateTotals =
      !isLogicalChild && childItems.length > 0
        ? sumChildEstimateTotals(childItems)
        : null;
    const hasSubtasks = childItems.length > 0;
    const isEditingRootItem =
      expandedViewMode === "edit" && expandedWorkItem?._id === workItem._id;
    const isEditingChildItem = expandedChildWorkItem?._id === workItem._id;
    const isRootExpanded =
      !isLogicalChild && expandedRootWorkItemId === workItem._id;
    const rootSectionId =
      isLogicalChild && workItem.parentWorkItemId
        ? workItem.parentWorkItemId
        : workItem._id;
    const showInlineEditor =
      (isEditingRootItem || isEditingChildItem) && isDesktopLayout;
    const isMobileLayout = !isDesktopLayout;
    const isArchivePending = pendingArchiveWorkItemId === workItem._id;
    const isDeletePending = pendingDeleteWorkItemId === workItem._id;
    const isArchived = workItem.status === "archived";
    const resolvedWorkItemIcon = resolveWorkItemIcon(workItem, workItemIconData);
    const showWorkItemIcon = true;
    const showSubtasksPill = !isLogicalChild && hasSubtasks;
    const canStartTimer = !isArchived;
    const editorTitle = isEditingChildItem
      ? expandedChildEditor.title
      : expandedTitle;
    const editorTitleDraft = isEditingChildItem
      ? expandedChildEditor.titleDraft
      : expandedTitleDraft;
    const isEditorTitleEditing = isEditingChildItem
      ? expandedChildEditor.isTitleEditing
      : isExpandedTitleEditing;
    const editorNote = isEditingChildItem
      ? expandedChildEditor.note
      : expandedNote;
    const editorTimeEntryNote = isEditingChildItem
      ? expandedChildEditor.timeEntryNote
      : expandedTimeEntryNote;
    const editorBacklogStatusId = isEditingChildItem
      ? expandedChildEditor.backlogStatusId
      : expandedBacklogStatusId;
    const editorProjectId = isEditingChildItem
      ? expandedChildEditor.projectId
      : expandedProjectId;
    const editorTaskId = isEditingChildItem
      ? expandedChildEditor.taskId
      : expandedTaskId;
    const editorOriginalEstimateHours = isEditingChildItem
      ? expandedChildEditor.originalEstimateHours
      : expandedOriginalEstimateHours;
    const editorRemainingEstimateHours = isEditingChildItem
      ? expandedChildEditor.remainingEstimateHours
      : expandedRemainingEstimateHours;
    const editorCompletedEstimateHours = isEditingChildItem
      ? expandedChildEditor.completedEstimateHours
      : expandedCompletedEstimateHours;
    const editorKeepWhenMissingFromSync = isEditingChildItem
      ? expandedChildEditor.keepWhenMissingFromSync
      : expandedKeepWhenMissingFromSync;
    const editorDurationHours = isEditingChildItem
      ? expandedChildEditor.durationHours
      : expandedDurationHours;
    const editorPriority = isEditingChildItem ? "" : expandedPriority;
    const editorPriorityDraft = isEditingChildItem ? "" : expandedPriorityDraft;
    const importedPriorityValue = isLogicalChild
      ? undefined
      : workItem.importedPriority;
    const canResetInlinePriority =
      !isLogicalChild &&
      !isSamePriorityValue(
        parsePriorityInput(editorPriorityDraft),
        importedPriorityValue,
      );
    const canResetInlineBacklogStatus =
      editorBacklogStatusId !== (workItem.importedBacklogStatusId ?? "");
    const editorTaskOptions = isEditingChildItem
      ? expandedChildTaskOptions
      : expandedTaskOptions;
    const editorAvailableTasks = isEditingChildItem
      ? expandedChildAvailableTasks
      : expandedAvailableTasks;
    const editorParsedDurationMs = isEditingChildItem
      ? expandedChildParsedDurationMs
      : expandedParsedDurationMs;
    const hasEditorTimeDraft =
      showInlineEditor && editorDurationHours.trim().length > 0;
    const canSubmitEditorTime = Boolean(
      editorParsedDurationMs && editorParsedDurationMs > 0,
    );
    const canSaveEditorTitle =
      editorTitleDraft.trim().length > 0 &&
      (isLogicalChild || parsePriorityInput(editorPriorityDraft) !== null) &&
      parseEstimateInput(editorOriginalEstimateHours) !== null &&
      parseEstimateInput(editorRemainingEstimateHours) !== null &&
      parseEstimateInput(editorCompletedEstimateHours) !== null;
    const canStartEditorTimer = !isArchived;
    const editorTimeFeedback = !hasEditorTimeDraft
      ? null
      : editorParsedDurationMs === null
        ? "Enter a valid duration"
        : editorParsedDurationMs <= 0
          ? "Enter a positive duration"
          : null;
    const sourceMetaParts = [
      isLogicalChild ? "Task" : undefined,
      workItem.source !== "manual"
        ? workItem.sourceConnectionLabel
        : undefined,
      workItem.source !== "manual"
        ? workItem.sourceProjectName
        : undefined,
      workItem.sourceWorkItemType,
    ].filter(Boolean);
    const timeEntryMetaParts = [
      project ? getLocalProjectDisplayName(project) : undefined,
      task?.name,
    ].filter(Boolean);
    const sourceReference =
      workItem.source === "azure_devops"
        ? parseWorkItemReference(workItem.sourceId)
        : undefined;
    const sourceUrl =
      workItem.source !== "manual"
        ? workItem.sourceId
        : undefined;
    const sourceMetaLabel = [
      sourceReference ? `#${sourceReference}` : undefined,
      ...sourceMetaParts,
    ]
      .filter(Boolean)
      .join(" · ");
    const backlogStatus = workItem.backlogStatusId
      ? backlogStatusById.get(workItem.backlogStatusId)
      : undefined;
    const backlogStatusLabel = backlogStatus?.name;
    const backlogEstimateBadgeLabel = getWorkItemEstimateBadgeLabel(
      childEstimateTotals ?? workItem,
    );
    const startTimerTitle = currentTimer
      ? `Switch timer to ${workItem.title}`
      : `Start timer for ${workItem.title}`;
    const canResetOriginalEstimate =
      childEstimateTotals !== null &&
      normalizeEstimateComparisonValue(
        parseEstimateInput(editorOriginalEstimateHours) ?? undefined,
      ) !== childEstimateTotals.originalEstimateHours;
    const canResetRemainingEstimate =
      childEstimateTotals !== null &&
      normalizeEstimateComparisonValue(
        parseEstimateInput(editorRemainingEstimateHours) ?? undefined,
      ) !== childEstimateTotals.remainingEstimateHours;
    const canResetCompletedEstimate =
      childEstimateTotals !== null &&
      normalizeEstimateComparisonValue(
        parseEstimateInput(editorCompletedEstimateHours) ?? undefined,
      ) !== childEstimateTotals.completedEstimateHours;
    const hasEstimateSyncIssue = hasWorkItemEstimateSyncIssue(workItem);
    const editorStartTimerTitle = isArchived
      ? "Archived tasks cannot start timers"
      : currentTimer
        ? `Switch timer to ${editorTitle.trim() || workItem.title}`
        : `Start timer for ${editorTitle.trim() || workItem.title}`;
    const isDraggedWorkItem = backlogDragState?.workItemId === workItem._id;
    const rootIndex = visibleRootItems.findIndex(
      (item) => item._id === workItem._id,
    );
    const rowShift =
      backlogDragState && backlogDragState.groupIds.includes(workItem._id)
        ? getSharedTableDragRowShift({
            itemIndex: rootIndex,
            originIndex: backlogDragState.originIndex,
            targetIndex: backlogDragState.targetIndex,
            rowHeight: backlogDragState.height,
          })
        : 0;
    const isReorderableRoot = canReorderVisibleRootItems && !isLogicalChild;

    if (showInlineEditor) {
      const closeInlineEditor = isEditingChildItem
        ? closeExpandedChildItem
        : () => closeExpandedItem();
      const beginInlineTitleEdit = () => {
        if (isEditingChildItem) {
          setExpandedChildEditor((current) => ({
            ...current,
            titleDraft: current.title,
            isTitleEditing: true,
          }));
          return;
        }

        beginExpandedTitleEdit();
      };
      const cancelInlineTitleEdit = () => {
        if (isEditingChildItem) {
          setExpandedChildEditor((current) => ({
            ...current,
            titleDraft: current.title,
            isTitleEditing: false,
          }));
          return;
        }

        cancelExpandedTitleEdit();
      };
      const saveInlineTitleEdit = () => {
        if (isEditingChildItem) {
          const title = expandedChildEditor.titleDraft.trim();
          if (!title) {
            return;
          }

          setExpandedChildEditor((current) => ({
            ...current,
            title,
            titleDraft: title,
            isTitleEditing: false,
          }));
          return;
        }

        saveExpandedTitleEdit();
      };
      const setInlineTitleDraft = (value: string) => {
        if (isEditingChildItem) {
          setExpandedChildEditor((current) => ({
            ...current,
            titleDraft: value,
          }));
          return;
        }

        setExpandedTitleDraft(value);
      };
      const setInlineNote = (value: string) => {
        if (isEditingChildItem) {
          setExpandedChildEditor((current) => ({ ...current, note: value }));
          return;
        }

        setExpandedNote(value);
      };
      const setInlineTimeEntryNote = (value: string) => {
        if (isEditingChildItem) {
          setExpandedChildEditor((current) => ({
            ...current,
            timeEntryNote: value,
          }));
          return;
        }

        setExpandedTimeEntryNote(value);
      };
      const setInlineBacklogStatusId = (value: string) => {
        if (isEditingChildItem) {
          setExpandedChildEditor((current) => ({
            ...current,
            backlogStatusId: value,
          }));
          return;
        }

        setExpandedBacklogStatusId(value);
      };
      const setInlineProjectId = (value: string) => {
        if (isEditingChildItem) {
          setExpandedChildEditor((current) => ({
            ...current,
            projectId: value,
          }));
          return;
        }

        setExpandedProjectId(value);
      };
      const setInlineTaskId = (value: string) => {
        if (isEditingChildItem) {
          setExpandedChildEditor((current) => ({ ...current, taskId: value }));
          return;
        }

        setExpandedTaskId(value);
      };
      const setInlineOriginalEstimateHours = (value: string) => {
        if (isEditingChildItem) {
          setExpandedChildEditor((current) => ({
            ...current,
            originalEstimateHours: value,
          }));
          return;
        }

        setExpandedOriginalEstimateHours(value);
      };
      const setInlineRemainingEstimateHours = (value: string) => {
        if (isEditingChildItem) {
          setExpandedChildEditor((current) => ({
            ...current,
            remainingEstimateHours: value,
          }));
          return;
        }

        setExpandedRemainingEstimateHours(value);
      };
      const setInlineCompletedEstimateHours = (value: string) => {
        if (isEditingChildItem) {
          setExpandedChildEditor((current) => ({
            ...current,
            completedEstimateHours: value,
          }));
          return;
        }

        setExpandedCompletedEstimateHours(value);
      };
      const setInlineKeepWhenMissingFromSync = (value: boolean) => {
        if (isEditingChildItem) {
          setExpandedChildEditor((current) => ({
            ...current,
            keepWhenMissingFromSync: value,
          }));
          return;
        }

        setExpandedKeepWhenMissingFromSync(value);
      };
      const resetInlineOriginalEstimate = () => {
        if (!childEstimateTotals) {
          return;
        }

        if (isEditingChildItem) {
          setExpandedChildEditor((current) => ({
            ...current,
            originalEstimateHours: formatEstimateInput(
              childEstimateTotals.originalEstimateHours,
            ),
          }));
          return;
        }

        setExpandedOriginalEstimateHours(
          formatEstimateInput(childEstimateTotals.originalEstimateHours),
        );
      };
      const resetInlineRemainingEstimate = () => {
        if (!childEstimateTotals) {
          return;
        }

        if (isEditingChildItem) {
          setExpandedChildEditor((current) => ({
            ...current,
            remainingEstimateHours: formatEstimateInput(
              childEstimateTotals.remainingEstimateHours,
            ),
          }));
          return;
        }

        setExpandedRemainingEstimateHours(
          formatEstimateInput(childEstimateTotals.remainingEstimateHours),
        );
      };
      const resetInlineCompletedEstimate = () => {
        if (!childEstimateTotals) {
          return;
        }

        if (isEditingChildItem) {
          setExpandedChildEditor((current) => ({
            ...current,
            completedEstimateHours: formatEstimateInput(
              childEstimateTotals.completedEstimateHours,
            ),
          }));
          return;
        }

        setExpandedCompletedEstimateHours(
          formatEstimateInput(childEstimateTotals.completedEstimateHours),
        );
      };
      const setInlineDurationHours = (value: string) => {
        if (isEditingChildItem) {
          setExpandedChildEditor((current) => ({
            ...current,
            durationHours: value,
          }));
          return;
        }

        setExpandedDurationHours(value);
      };
      const cancelInlineTime = () => {
        if (isEditingChildItem) {
          setExpandedChildEditor((current) => ({
            ...current,
            durationHours: "",
          }));
          return;
        }

        cancelExpandedTime();
      };
      const submitInlineTime = () => {
        if (isEditingChildItem) {
          submitExpandedChildTime();
          return;
        }

        submitExpandedTime();
      };
      const startInlineTimer = () =>
        handleStartWorkItemTimer(workItem, {
          title: editorTitle,
          note: editorNote,
          projectId: editorProjectId,
          taskId: editorTaskId,
        });

      return (
        <tr
          key={workItem._id}
          data-backlog-root-id={rootSectionId}
          className={cn(
            "entry-edit-row backlog-inline-editor-row",
            isLogicalChild && "backlog-row-child",
          )}
          onClick={(event) => event.stopPropagation()}
        >
          <td colSpan={BACKLOG_TABLE_COLUMN_COUNT}>
            <div
              ref={showInlineEditor ? activeInlineEditorRef : null}
              className={cn(
                "entry-edit-dropdown backlog-inline-editor",
                isLogicalChild && "entry-edit-dropdown-child",
              )}
            >
              <div
                className="backlog-editor-header"
                onClick={(event) => {
                  const target = event.target as HTMLElement;
                  if (target.closest("button, input")) {
                    return;
                  }

                  closeInlineEditor();
                }}
              >
                <div className="backlog-editor-heading">
                  <div
                    className={cn(
                      "backlog-inline-title",
                      isLogicalChild && "is-child",
                    )}
                  >
                    {isEditorTitleEditing ? (
                      <div
                        className={cn(
                          "backlog-inline-edit-shell",
                          isLogicalChild && "is-child",
                        )}
                      >
                        {!isLogicalChild ? (
                          <input
                            className="field-input backlog-inline-priority-input"
                            type="text"
                            inputMode="numeric"
                            pattern="[0-9]*"
                            value={editorPriorityDraft}
                            onChange={(event) =>
                              setExpandedPriorityDraft(event.target.value)
                            }
                            aria-label="Task priority"
                          />
                        ) : null}
                        <input
                          className="field-input backlog-inline-title-input"
                          value={editorTitleDraft}
                          onChange={(event) =>
                            setInlineTitleDraft(event.target.value)
                          }
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              event.preventDefault();
                              saveInlineTitleEdit();
                            }

                            if (event.key === "Escape") {
                              event.preventDefault();
                              cancelInlineTitleEdit();
                            }
                          }}
                          placeholder={
                            isLogicalChild ? "Subtask name" : "Task name"
                          }
                          aria-label={
                            isLogicalChild ? "Subtask name" : "Task name"
                          }
                          autoFocus
                        />
                        {!isLogicalChild && canResetInlinePriority ? (
                          <div className="backlog-inline-edit-actions">
                            <button
                              type="button"
                              className="backlog-inline-reset-button"
                              onClick={() =>
                                setExpandedPriorityDraft(
                                  formatPriorityInput(importedPriorityValue),
                                )
                              }
                            >
                              Reset to imported
                            </button>
                          </div>
                        ) : null}
                      </div>
                    ) : (
                      <div
                        className={cn(
                          "backlog-inline-title-display",
                          isLogicalChild && "is-child",
                        )}
                      >
                        {!isLogicalChild ? (
                          <span className="backlog-priority-pill">
                            {editorPriority}
                          </span>
                        ) : null}
                        <div className="backlog-inline-title-main">
                          {showWorkItemIcon ? (
                            <WorkItemIcon icon={resolvedWorkItemIcon} />
                          ) : null}
                          <span className="backlog-inline-title-text">
                            {editorTitle}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                  {sourceMetaParts.length > 0 || sourceReference ? (
                    <div
                      className={cn(
                        "backlog-inline-meta",
                        isLogicalChild && "is-child",
                        !isLogicalChild && "has-priority",
                        showWorkItemIcon && "has-source-icon",
                      )}
                    >
                      {sourceUrl ? (
                        <a
                          href={sourceUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="backlog-task-meta backlog-task-meta-link"
                          data-no-backlog-drag="true"
                          onClick={(event) => event.stopPropagation()}
                        >
                          {sourceMetaLabel}
                        </a>
                      ) : (
                        <span className="backlog-task-meta">
                          {sourceMetaLabel}
                        </span>
                      )}
                    </div>
                  ) : null}
                </div>
                <div className="backlog-editor-trailing">
                  <div className="backlog-editor-actions">
                    <span className="backlog-editor-action-slot">
                      {isEditorTitleEditing ? (
                        <button
                          type="button"
                          className="backlog-task-inline-action"
                          aria-label={`Save ${isLogicalChild ? "subtask" : "task"} name`}
                          disabled={!canSaveEditorTitle}
                          onClick={saveInlineTitleEdit}
                        >
                          <Check className="h-3.5 w-3.5" />
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="backlog-task-inline-action"
                          aria-label={`Edit ${isLogicalChild ? "subtask" : "task"} name`}
                          onClick={beginInlineTitleEdit}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </span>
                    <span className="backlog-editor-action-slot">
                      {isEditorTitleEditing ? (
                        <button
                          type="button"
                          className="backlog-task-inline-action"
                          aria-label={`Cancel ${isLogicalChild ? "subtask" : "task"} name changes`}
                          onClick={cancelInlineTitleEdit}
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      ) : !isArchived ? (
                        <button
                          type="button"
                          className={cn(
                            "backlog-task-inline-action",
                            "backlog-task-archive",
                            isDeletePending && "is-confirming",
                          )}
                          aria-label={
                            isDeletePending
                              ? `Confirm delete ${workItem.title}`
                              : `Delete ${workItem.title}`
                          }
                          onClick={() => handleDeleteWorkItem(workItem._id)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          {isDeletePending ? <span>Delete</span> : null}
                        </button>
                      ) : (
                        <button
                          type="button"
                          className={cn(
                            "backlog-task-inline-action",
                            "backlog-task-archive",
                            "is-restore",
                          )}
                          aria-label={`Unarchive ${workItem.title}`}
                          onClick={() => handleUnarchiveWorkItem(workItem._id)}
                        >
                          <ArchiveRestore className="h-3.5 w-3.5" />
                          <span>Restore</span>
                        </button>
                      )}
                    </span>
                    <span className="backlog-editor-action-slot">
                      {!isEditorTitleEditing && !isArchived ? (
                        <button
                          type="button"
                          className={cn(
                            "backlog-task-inline-action",
                            "backlog-task-archive",
                            isArchivePending && "is-confirming",
                          )}
                          aria-label={
                            isArchivePending
                              ? "Confirm archive task"
                              : "Archive task"
                          }
                          onClick={() => handleArchiveWorkItem(workItem._id)}
                        >
                          <Archive className="h-3.5 w-3.5" />
                          {isArchivePending ? <span>Confirm</span> : null}
                        </button>
                      ) : (
                        <span
                          className="backlog-editor-action-placeholder"
                          aria-hidden="true"
                        />
                      )}
                    </span>
                  </div>
                  {backlogEstimateBadgeLabel ? (
                    <span className="hours-badge backlog-estimate-badge backlog-editor-estimate-badge">
                      {backlogEstimateBadgeLabel}
                    </span>
                  ) : null}
                </div>
              </div>

              <div className="entry-edit-dropdown-grid">
                <label className="field backlog-field-project">
                  <span className="field-label">Project</span>
                  <SearchableSelect
                    value={editorProjectId}
                    options={projectOptions}
                    onChange={setInlineProjectId}
                    placeholder="No project"
                    clearLabel="No project"
                    emptyMessage="No matching projects"
                    ariaLabel="Project"
                  />
                </label>

                <label className="field backlog-field-task">
                  <span className="field-label">Task mapping</span>
                  <SearchableSelect
                    value={editorTaskId}
                    options={editorTaskOptions}
                    onChange={setInlineTaskId}
                    placeholder={
                      editorProjectId ? "Select task" : "Pick a project first"
                    }
                    clearLabel={editorProjectId ? "No task" : undefined}
                    emptyMessage={
                      editorProjectId
                        ? "No matching tasks"
                        : "Pick a project first"
                    }
                    ariaLabel="Task mapping"
                    disabled={
                      !editorProjectId || editorAvailableTasks.length === 0
                    }
                  />
                </label>

                {isEditorTitleEditing ? (
                  <>
                    <label className="field backlog-field-status">
                      <span className="field-label">Status</span>
                      <SearchableSelect
                        value={editorBacklogStatusId}
                        options={backlogStatusOptions}
                        onChange={setInlineBacklogStatusId}
                        placeholder="No status"
                        clearLabel="No status"
                        emptyMessage="No matching statuses"
                        ariaLabel="Backlog status"
                      />
                      {workItem.source !== "manual" &&
                      canResetInlineBacklogStatus ? (
                        <div className="backlog-field-meta">
                          <button
                            type="button"
                            className="backlog-inline-reset-button"
                            onClick={() =>
                              setInlineBacklogStatusId(
                                workItem.importedBacklogStatusId ?? "",
                              )
                            }
                          >
                            Reset to synced
                          </button>
                        </div>
                      ) : null}
                    </label>

                    {workItem.source !== "manual" ? (
                      <label className="connector-form-toggle backlog-sync-keep-toggle">
                        <Checkbox
                          checked={editorKeepWhenMissingFromSync}
                          onCheckedChange={setInlineKeepWhenMissingFromSync}
                        />
                        <span>
                          <span className="connector-form-toggle-title">
                            Keep when missing from sync
                          </span>
                          <span className="connector-form-toggle-description">
                            Do not archive this item when it disappears from the
                            synced source list.
                          </span>
                        </span>
                      </label>
                    ) : null}

                    <div className="backlog-field-estimates">
                      <label className="field backlog-field-estimate">
                        <span className="field-label">Original</span>
                        <div className="backlog-estimate-field-shell">
                          <input
                            className="field-input backlog-estimate-field-input"
                            type="text"
                            inputMode="decimal"
                            value={editorOriginalEstimateHours}
                            onChange={(event) =>
                              setInlineOriginalEstimateHours(event.target.value)
                            }
                            placeholder="0"
                            aria-label="Original estimate"
                          />
                          {canResetOriginalEstimate ? (
                            <button
                              type="button"
                              className="backlog-estimate-reset-field"
                              aria-label="Reset original estimate to subtask total"
                              title="Reset original estimate to subtask total"
                              onClick={resetInlineOriginalEstimate}
                            >
                              <RotateCcw className="h-3.5 w-3.5" />
                            </button>
                          ) : null}
                        </div>
                      </label>

                      <label className="field backlog-field-estimate">
                        <span className="field-label">Remaining</span>
                        <div className="backlog-estimate-field-shell">
                          <input
                            className="field-input backlog-estimate-field-input"
                            type="text"
                            inputMode="decimal"
                            value={editorRemainingEstimateHours}
                            onChange={(event) =>
                              setInlineRemainingEstimateHours(
                                event.target.value,
                              )
                            }
                            placeholder="0"
                            aria-label="Remaining estimate"
                          />
                          {canResetRemainingEstimate ? (
                            <button
                              type="button"
                              className="backlog-estimate-reset-field"
                              aria-label="Reset remaining estimate to subtask total"
                              title="Reset remaining estimate to subtask total"
                              onClick={resetInlineRemainingEstimate}
                            >
                              <RotateCcw className="h-3.5 w-3.5" />
                            </button>
                          ) : null}
                        </div>
                      </label>

                      <label className="field backlog-field-estimate">
                        <span className="field-label">Completed</span>
                        <div className="backlog-estimate-field-shell">
                          <input
                            className="field-input backlog-estimate-field-input"
                            type="text"
                            inputMode="decimal"
                            value={editorCompletedEstimateHours}
                            onChange={(event) =>
                              setInlineCompletedEstimateHours(
                                event.target.value,
                              )
                            }
                            placeholder="0"
                            aria-label="Completed estimate"
                          />
                          {canResetCompletedEstimate ? (
                            <button
                              type="button"
                              className="backlog-estimate-reset-field"
                              aria-label="Reset completed estimate to subtask total"
                              title="Reset completed estimate to subtask total"
                              onClick={resetInlineCompletedEstimate}
                            >
                              <RotateCcw className="h-3.5 w-3.5" />
                            </button>
                          ) : null}
                        </div>
                      </label>
                    </div>
                  </>
                ) : null}

                {!isArchived && isEditorTitleEditing ? (
                  <label className="field entry-field-description">
                    <span className="backlog-note-label">
                      <span className="field-label">Description</span>
                      <button
                        type="button"
                        className="backlog-note-expand"
                        aria-label={`Expand description editor for ${editorTitle.trim() || workItem.title}`}
                        title="Expand description editor"
                        onClick={() =>
                          openExpandedNoteModal(
                            isEditingChildItem ? "child" : "root",
                          )
                        }
                      >
                        <Maximize2 className="h-3.5 w-3.5" />
                      </button>
                    </span>
                    <textarea
                      ref={inlineDescriptionTextareaRef}
                      className="field-input entry-note-input"
                      value={editorNote}
                      onChange={(event) => setInlineNote(event.target.value)}
                      placeholder="Description (optional)"
                      rows={2}
                    />
                  </label>
                ) : null}

                {!isArchived ? (
                  <label className="field entry-field-note">
                    <span className="field-label">Note</span>
                    <textarea
                      className="field-input entry-note-input"
                      value={editorTimeEntryNote}
                      onChange={(event) =>
                        setInlineTimeEntryNote(event.target.value)
                      }
                      placeholder="Time entry note (optional)"
                      rows={2}
                    />
                  </label>
                ) : null}

                <div className="field entry-field-hours backlog-field-hours">
                  <span className="field-label">Hours</span>
                  <div className="inline-hours-input-shell">
                    <input
                      className="field-input entry-hours-input inline-hours-input"
                      type="text"
                      placeholder="01:30"
                      style={{ fontFamily: "var(--font-mono)" }}
                      value={editorDurationHours}
                      onChange={(event) =>
                        setInlineDurationHours(event.target.value)
                      }
                      onBlur={(event) =>
                        setInlineDurationHours(
                          normalizeHoursInput(event.target.value),
                        )
                      }
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          if (hasEditorTimeDraft) {
                            submitInlineTime();
                            return;
                          }

                          startInlineTimer();
                        }
                      }}
                      aria-label="Hours"
                    />
                    <div className="inline-hours-actions">
                      {hasEditorTimeDraft ? (
                        <>
                          <button
                            type="button"
                            className="inline-hours-action"
                            aria-label="Submit time"
                            disabled={!canSubmitEditorTime}
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={submitInlineTime}
                          >
                            <Check className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            className="inline-hours-action"
                            aria-label="Cancel time"
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={cancelInlineTime}
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
                          aria-label={editorStartTimerTitle}
                          title={editorStartTimerTitle}
                          disabled={!canStartEditorTimer}
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={startInlineTimer}
                        >
                          <Play className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                  {editorTimeFeedback ? (
                    <span className="field-error">{editorTimeFeedback}</span>
                  ) : null}
                </div>
              </div>
            </div>
          </td>
        </tr>
      );
    }

    return (
      <tr
        key={workItem._id}
        data-backlog-root-id={rootSectionId}
        ref={(node) => {
          if (!isReorderableRoot) {
            backlogRowRefs.current.delete(workItem._id);
            return;
          }

          if (node) {
            backlogRowRefs.current.set(workItem._id, node);
            return;
          }

          backlogRowRefs.current.delete(workItem._id);
        }}
        className={cn(
          isRootExpanded && "entry-row-expanded",
          isEditingRootItem && "backlog-row-edit-expanded",
          isLogicalChild && "backlog-row-child",
          isReorderableRoot && "backlog-row-draggable",
          pressedWorkItemId === workItem._id && "is-pressing",
          isDraggedWorkItem && "is-drag-source",
        )}
        style={
          rowShift !== 0
            ? { transform: `translate3d(0, ${rowShift}px, 0)` }
            : undefined
        }
        aria-grabbed={isDraggedWorkItem}
        onClick={() => handleToggleWorkItem(workItem)}
        onPointerDown={(event) => handleWorkItemPointerDown(workItem, event)}
      >
        <td className="backlog-priority-cell">
          {!isLogicalChild ? (
            <span className="backlog-priority-value">
              {workItem.priority ?? ""}
            </span>
          ) : null}
        </td>
        <td className="backlog-task-cell" colSpan={isLogicalChild ? 2 : 1}>
          <div className={cn("backlog-task-row", isLogicalChild && "is-child")}>
            <div className="backlog-task-main">
              <div className="backlog-task-title-row">
                <div className="backlog-task-title-content">
                  {!isLogicalChild ? (
                    showSubtasksPill ? (
                      <button
                        type="button"
                        className={cn(
                          "backlog-task-subtasks-pill",
                          isRootExpanded && "is-active",
                        )}
                        aria-label={`${isRootExpanded ? "Hide" : "Show"} subtasks for ${workItem.title}`}
                        data-no-backlog-drag="true"
                        onPointerDown={(event) => {
                          event.stopPropagation();
                        }}
                        onClick={(event) => {
                          event.stopPropagation();
                          handleToggleSubtasks(workItem);
                          event.currentTarget.blur();
                        }}
                      >
                        <ChevronRight className="h-4 w-4" />
                      </button>
                    ) : (
                      <span
                        className="backlog-task-subtasks-indicator backlog-task-subtasks-placeholder"
                        aria-hidden="true"
                      />
                    )
                  ) : null}
                  {showWorkItemIcon ? (
                    <WorkItemIcon icon={resolvedWorkItemIcon} />
                  ) : null}
                  <span
                    className={cn(
                      "backlog-task-title",
                      isArchived && "is-archived",
                    )}
                  >
                    {workItem.title}
                  </span>
                  {hasEstimateSyncIssue ? (
                    <span
                      className="backlog-task-meta flex items-center gap-1 text-amber-300"
                      title="Estimate sync needs review"
                    >
                      <AlertTriangle className="h-3.5 w-3.5" />
                    </span>
                  ) : null}
                </div>
              </div>
              {sourceMetaParts.length > 0 || sourceReference ? (
                sourceUrl ? (
                  <a
                    href={sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className={cn(
                      "backlog-task-meta",
                      "backlog-task-meta-link",
                      !isLogicalChild && "backlog-task-meta-indented",
                      showWorkItemIcon && "has-source-icon",
                    )}
                    data-no-backlog-drag="true"
                    onClick={(event) => event.stopPropagation()}
                  >
                    {sourceMetaLabel}
                  </a>
                ) : (
                  <span
                    className={cn(
                      "backlog-task-meta",
                      !isLogicalChild && "backlog-task-meta-indented",
                      showWorkItemIcon && "has-source-icon",
                    )}
                  >
                    {sourceMetaLabel}
                  </span>
                )
              ) : null}
              {timeEntryMetaParts.length > 0 ? (
                <span
                  className={cn(
                    "backlog-task-meta",
                    "backlog-task-meta-secondary",
                    !isLogicalChild && "backlog-task-meta-indented",
                    showWorkItemIcon && "has-source-icon",
                  )}
                >
                  {timeEntryMetaParts.join(" · ")}
                </span>
              ) : null}
              {!isArchived &&
              isRootExpanded &&
              expandedViewMode === "edit" &&
              workItem.note ? (
                <span className="backlog-task-note">{workItem.note}</span>
              ) : null}
            </div>
          </div>
        </td>
        {!isLogicalChild ? (
          <td className="backlog-status-cell">
            {backlogStatusLabel ? (
              <div className="backlog-status-cell-content">
                <span
                  className="status-dot backlog-status-dot"
                  style={{ background: backlogStatus?.color }}
                />
                <span className="backlog-status-cell-label">
                  {backlogStatusLabel}
                </span>
              </div>
            ) : null}
          </td>
        ) : null}
        <td className="entry-hours-cell backlog-estimate-cell">
          <div className="entry-hours-content backlog-estimate-content">
            {!isMobileLayout ? (
              <div
                className={cn(
                  "entry-row-actions backlog-entry-row-actions",
                  isArchivePending && "is-confirming",
                )}
              >
                {!isArchived ? (
                  <button
                    type="button"
                    className="entry-row-action entry-row-action-play"
                    aria-label={startTimerTitle}
                    title={startTimerTitle}
                    disabled={!canStartTimer}
                    data-no-backlog-drag="true"
                    onClick={(event) => {
                      event.stopPropagation();
                      handleStartWorkItemTimer(workItem);
                    }}
                    onPointerDown={(event) => event.stopPropagation()}
                  >
                    <Play className="h-3.5 w-3.5" />
                  </button>
                ) : null}
                {!isArchived ? (
                  <button
                    type="button"
                    className="entry-row-action"
                    aria-label={`Edit description for ${workItem.title}`}
                    title={`Edit description for ${workItem.title}`}
                    data-no-backlog-drag="true"
                    onClick={(event) => {
                      event.stopPropagation();
                      handleOpenWorkItemNote(workItem);
                    }}
                    onPointerDown={(event) => event.stopPropagation()}
                  >
                    <FileText className="h-3.5 w-3.5" />
                  </button>
                ) : null}
                {isArchived ? (
                  <button
                    type="button"
                    className="entry-row-action backlog-entry-row-action-restore"
                    aria-label={`Unarchive ${workItem.title}`}
                    title={`Unarchive ${workItem.title}`}
                    data-no-backlog-drag="true"
                    onClick={(event) => {
                      event.stopPropagation();
                      handleUnarchiveWorkItem(workItem._id);
                    }}
                    onPointerDown={(event) => event.stopPropagation()}
                  >
                    <ArchiveRestore className="h-3.5 w-3.5" />
                  </button>
                ) : (
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
                          ? "Confirm archive task"
                          : "Archive task"
                      }
                      title={
                        isArchivePending
                          ? "Confirm archive task"
                          : "Archive task"
                      }
                      data-no-backlog-drag="true"
                      onClick={(event) => {
                        event.stopPropagation();
                        handleArchiveWorkItem(workItem._id);
                      }}
                      onPointerDown={(event) => event.stopPropagation()}
                    >
                      <Archive className="h-3.5 w-3.5" />
                      {isArchivePending ? <span>Confirm</span> : null}
                    </button>
                  </span>
                )}
              </div>
            ) : null}
            {backlogEstimateBadgeLabel ? (
              <span className="hours-badge backlog-estimate-badge">
                {backlogEstimateBadgeLabel}
              </span>
            ) : null}
            {isMobileLayout && !isArchived ? (
              <button
                type="button"
                className="backlog-task-start backlog-task-action-pill backlog-estimate-mobile-action"
                aria-label={startTimerTitle}
                title={startTimerTitle}
                disabled={!canStartTimer}
                data-no-backlog-drag="true"
                onPointerDown={(event) => {
                  event.stopPropagation();
                }}
                onClick={(event) => {
                  event.stopPropagation();
                  handleStartWorkItemTimer(workItem);
                }}
              >
                <Play className="h-3.5 w-3.5" />
                <span>{currentTimer ? "Switch Timer" : "Start Timer"}</span>
              </button>
            ) : null}
          </div>
        </td>
      </tr>
    );
  }

  const draggedWorkItemProject = draggedWorkItem
    ? projects.find((item) => item._id === draggedWorkItem.projectId)
    : undefined;
  const draggedWorkItemTask = draggedWorkItemProject?.tasks.find(
    (item) => item._id === draggedWorkItem?.taskId,
  );
  const draggedWorkItemChildCount = draggedWorkItem
    ? getChildItems(draggedWorkItem).length
    : 0;
  const draggedWorkItemSourceReference =
    draggedWorkItem?.source === "azure_devops"
      ? parseWorkItemReference(draggedWorkItem.sourceId)
      : undefined;
  const draggedWorkItemSourceMetaParts = draggedWorkItem
    ? [
        draggedWorkItem.source !== "manual"
          ? draggedWorkItem.sourceConnectionLabel
          : undefined,
        draggedWorkItem.source !== "manual"
          ? draggedWorkItem.sourceProjectName
          : undefined,
        draggedWorkItem.sourceWorkItemType,
      ].filter(Boolean)
    : [];
  const draggedWorkItemSourceMetaLabel = [
    draggedWorkItemSourceReference
      ? `#${draggedWorkItemSourceReference}`
      : undefined,
    ...draggedWorkItemSourceMetaParts,
  ]
    .filter(Boolean)
    .join(" · ");
  const draggedWorkItemTimeEntryMetaParts = [
    draggedWorkItemProject
      ? getLocalProjectDisplayName(draggedWorkItemProject)
      : undefined,
    draggedWorkItemTask?.name,
  ].filter(Boolean);
  const draggedWorkItemStatus = draggedWorkItem?.backlogStatusId
    ? backlogStatusById.get(draggedWorkItem.backlogStatusId)
    : undefined;
  const draggedWorkItemEstimateBadgeLabel = useMemo(() => {
    if (!draggedWorkItem) {
      return null;
    }

    const draggedChildItems = isSubtaskWorkItem(draggedWorkItem)
      ? []
      : getChildItems(draggedWorkItem);
    return getWorkItemEstimateBadgeLabel(
      draggedChildItems.length > 0
        ? sumChildEstimateTotals(draggedChildItems)
        : draggedWorkItem,
    );
  }, [draggedWorkItem, getChildItems]);

  function renderBacklogSortControl(
    controlClassName?: string,
    triggerClassName?: string,
  ) {
    return (
      <div
        ref={backlogSortMenuRef}
        className={cn("backlog-sort-control", controlClassName)}
      >
        <button
          type="button"
          className={cn(
            "entries-header-add backlog-sort-trigger",
            triggerClassName,
            isSortMenuOpen && "is-open",
          )}
          aria-label={`Filter backlog. Showing ${activeFilter} items ordered by ${getBacklogSortModeLabel(backlogSortMode)}`}
          aria-expanded={isSortMenuOpen}
          title="Filter backlog"
          onClick={() => setIsSortMenuOpen((current) => !current)}
        >
          <Filter className="backlog-sort-trigger-icon" />
        </button>
        {isSortMenuOpen ? (
          <div
            className="backlog-sort-menu"
            role="menu"
            aria-label="Backlog filters"
          >
            <div
              className="backlog-filter-menu-group"
              role="group"
              aria-label="Status"
            >
              <span className="backlog-filter-menu-label">Status</span>
              {BACKLOG_FILTERS.map((filter) => {
                const isActive = activeFilter === filter.value;
                return (
                  <button
                    key={filter.value}
                    type="button"
                    role="menuitemradio"
                    aria-checked={isActive}
                    className={cn(
                      "backlog-sort-option",
                      isActive && "is-active",
                    )}
                    onClick={() => {
                      setActiveFilter(filter.value);
                      setPendingArchiveWorkItemId(null);
                      resetExpandedItem();
                    }}
                  >
                    <span className="backlog-filter-option-copy">
                      <span>{filter.label}</span>
                      <span className="backlog-filter-count">
                        {filterCounts[filter.value]}
                      </span>
                    </span>
                    {isActive ? <Check className="h-3.5 w-3.5" /> : null}
                  </button>
                );
              })}
            </div>
            <div className="backlog-filter-menu-divider" />
            <div
              className="backlog-filter-menu-group"
              role="group"
              aria-label="Order"
            >
              <span className="backlog-filter-menu-label">Order</span>
              {BACKLOG_SORT_MODES.map((sortMode) => {
                const isActive =
                  sortMode.value === "priority"
                    ? isPrioritySortMode(backlogSortMode)
                    : backlogSortMode === sortMode.value;

                return (
                  <button
                    key={sortMode.value}
                    type="button"
                    role="menuitemradio"
                    aria-checked={isActive}
                    className={cn(
                      "backlog-sort-option",
                      isActive && "is-active",
                    )}
                    onClick={() => {
                      localStore.setBacklogSortMode(
                        sortMode.value === "priority"
                          ? "priority_asc"
                          : sortMode.value,
                      );
                    }}
                  >
                    <span>{sortMode.label}</span>
                    {isActive ? <Check className="h-3.5 w-3.5" /> : null}
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="backlog-page-stack">
      <div className="entries-table-scroll-shell entries-table-scroll-shell-backlog">
        {isDesktopLayout ? (
          <table className="entries-table backlog-table entries-table-header-table animate-in">
            <thead>
              <tr>
                <th
                  className="backlog-task-heading"
                  colSpan={BACKLOG_TABLE_COLUMN_COUNT}
                >
                  <div className="backlog-task-heading-content">
                    <span>Backlog Items</span>
                    <div className="backlog-header-actions">
                      {renderBacklogSortControl()}
                      <button
                        type="button"
                        className={cn(
                          "entries-header-add entries-header-bubble",
                          (isCreatingItem || isCreateTaskModalOpen) && "is-open",
                        )}
                        aria-label={
                          isCreatingItem || isCreateTaskModalOpen
                            ? "Close new task"
                            : "Add new task"
                        }
                        onClick={handleCreateToggle}
                      >
                        <span className="entries-header-add-label">New task</span>
                        <Plus className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                </th>
              </tr>
            </thead>
          </table>
        ) : null}
        <ScrollArea className="entries-table-scroll-area">
          <table
            className={cn(
              "entries-table backlog-table entries-table-body-table animate-in",
              backlogDragState && "is-backlog-dragging",
            )}
          >
            <tbody className="entries-table-scroll-region">
              {isCreatingItem && isDesktopLayout ? (
                <tr
                  className="entry-edit-row"
                  onClick={(event) => event.stopPropagation()}
                >
                  <td colSpan={BACKLOG_TABLE_COLUMN_COUNT}>
                    <div className="entry-edit-dropdown entry-create-dropdown">
                      <div className="entry-create-label">New task</div>
                      <div className="entry-edit-dropdown-grid">
                        <label className="field backlog-field-title">
                          <span className="field-label">Task</span>
                          <input
                            className="field-input"
                            value={newTitle}
                            onChange={(event) =>
                              setNewTitle(event.target.value)
                            }
                            onKeyDown={(event) => {
                              if (event.key === "Enter") {
                                event.preventDefault();
                                closeNewItem();
                              }
                            }}
                            placeholder="Task name"
                          />
                        </label>

                        <label className="field backlog-field-project">
                          <span className="field-label">Status</span>
                          <SearchableSelect
                            value={newBacklogStatusId}
                            options={backlogStatusOptions}
                            onChange={setNewBacklogStatusId}
                            placeholder="No status"
                            clearLabel="No status"
                            emptyMessage="No matching statuses"
                            ariaLabel="Backlog status"
                          />
                        </label>

                        <label className="field backlog-field-project">
                          <span className="field-label">Project</span>
                          <SearchableSelect
                            value={newProjectId}
                            options={projectOptions}
                            onChange={setNewProjectId}
                            placeholder="No project"
                            clearLabel="No project"
                            emptyMessage="No matching projects"
                            ariaLabel="Project"
                          />
                        </label>

                        <label className="field backlog-field-task">
                          <span className="field-label">Task mapping</span>
                          <SearchableSelect
                            value={newTaskId}
                            options={newTaskOptions}
                            onChange={setNewTaskId}
                            placeholder={
                              newProjectId
                                ? "Select task"
                                : "Pick a project first"
                            }
                            clearLabel={newProjectId ? "No task" : undefined}
                            emptyMessage={
                              newProjectId
                                ? "No matching tasks"
                                : "Pick a project first"
                            }
                            ariaLabel="Task mapping"
                            disabled={
                              !newProjectId || newAvailableTasks.length === 0
                            }
                          />
                        </label>

                        <label className="field backlog-field-note">
                          <span className="field-label">Description</span>
                          <textarea
                            className="field-input entry-note-input"
                            value={newNote}
                            onChange={(event) => setNewNote(event.target.value)}
                            placeholder="Description (optional)"
                            rows={2}
                          />
                        </label>
                      </div>
                    </div>
                  </td>
                </tr>
              ) : null}

              {visibleRootItems.length === 0 ? (
                <tr className="entry-empty-row">
                  <td colSpan={BACKLOG_TABLE_COLUMN_COUNT}>
                    <Empty className="entry-table-empty">
                      <EmptyHeader>
                        <EmptyMedia variant="icon">
                          {activeFilter === "active" ? (
                            <FileText className="h-5 w-5" />
                          ) : (
                            <ArchiveRestore className="h-5 w-5" />
                          )}
                        </EmptyMedia>
                        <EmptyTitle>
                          {activeFilter === "active"
                            ? "No active tasks"
                            : "No archived tasks"}
                        </EmptyTitle>
                        <EmptyDescription>
                          {activeFilter === "active"
                            ? "Create one with the + button."
                            : "Archived tasks will appear here."}
                        </EmptyDescription>
                      </EmptyHeader>
                    </Empty>
                  </td>
                </tr>
              ) : null}

              {visibleRootItems.map((workItem) => {
                const childItems = getChildItems(workItem);
                const isExpanded = expandedRootWorkItemId === workItem._id;

                return (
                  <Fragment key={workItem._id}>
                    {renderWorkItemRow(workItem)}
                    {isExpanded && !isSubtaskWorkItem(workItem)
                      ? renderSubtasksSectionRow(workItem, childItems)
                      : null}
                    {isExpanded
                      ? childItems.map((childItem) =>
                          renderWorkItemRow(childItem, true),
                        )
                      : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </ScrollArea>
      </div>

      {!isDesktopLayout ? (
        <div
          className="backlog-mobile-actions"
          role="group"
          aria-label="Backlog actions"
        >
          {renderBacklogSortControl(
            "backlog-mobile-filter-control",
            "backlog-mobile-action",
          )}
          <button
            type="button"
            className={cn(
              "entries-header-add backlog-mobile-action",
              isCreateTaskModalOpen && "is-open",
            )}
            aria-label={
              isCreateTaskModalOpen ? "Close new task" : "Add new task"
            }
            title={isCreateTaskModalOpen ? "Close new task" : "Add new task"}
            onClick={handleCreateToggle}
          >
            <Plus />
          </button>
        </div>
      ) : null}

      {draggedWorkItem && backlogDragState ? (
        <div
          className="backlog-task-drag-preview"
          style={{
            width: backlogDragState.width,
            minHeight: backlogDragState.height,
            transform: getSharedTableDragOverlayTransform(backlogDragState),
          }}
        >
          <div className="backlog-task-drag-preview-grid">
            <div className="backlog-priority-cell backlog-task-drag-preview-priority">
              <span className="backlog-priority-value">
                {draggedWorkItem.priority ?? ""}
              </span>
            </div>
            <div className="backlog-task-cell backlog-task-drag-preview-cell">
              <div className="backlog-task-row">
                <div className="backlog-task-main">
                  <div className="backlog-task-title-row">
                    <div className="backlog-task-title-content">
                      {draggedWorkItemChildCount > 0 ? (
                        <span
                          className="backlog-task-subtasks-indicator"
                          aria-hidden="true"
                        >
                          <ChevronRight className="h-4 w-4" />
                        </span>
                      ) : (
                        <span
                          className="backlog-task-subtasks-indicator backlog-task-subtasks-placeholder"
                          aria-hidden="true"
                        />
                      )}
                      <WorkItemIcon
                        icon={resolveWorkItemIcon(
                          draggedWorkItem,
                          workItemIconData,
                        )}
                      />
                      <span
                        className={cn(
                          "backlog-task-title",
                          draggedWorkItem.status === "archived" &&
                            "is-archived",
                        )}
                      >
                        {draggedWorkItem.title}
                      </span>
                    </div>
                  </div>
                  {draggedWorkItemSourceMetaLabel ? (
                    <span className="backlog-task-meta">
                      {draggedWorkItemSourceMetaLabel}
                    </span>
                  ) : null}
                  {draggedWorkItemTimeEntryMetaParts.length > 0 ? (
                    <span className="backlog-task-meta backlog-task-meta-secondary">
                      {draggedWorkItemTimeEntryMetaParts.join(" · ")}
                    </span>
                  ) : null}
                </div>
              </div>
            </div>
            <div className="backlog-status-cell backlog-task-drag-preview-status">
              {draggedWorkItemStatus ? (
                <div className="backlog-status-cell-content">
                  <span
                    className="status-dot backlog-status-dot"
                    style={{ background: draggedWorkItemStatus.color }}
                  />
                  <span className="backlog-status-cell-label">
                    {draggedWorkItemStatus.name}
                  </span>
                </div>
              ) : null}
            </div>
            <div className="entry-hours-cell backlog-estimate-cell backlog-task-drag-preview-estimate">
              {draggedWorkItemEstimateBadgeLabel ? (
                <div className="entry-hours-content">
                  <span className="hours-badge backlog-estimate-badge">
                    {draggedWorkItemEstimateBadgeLabel}
                  </span>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {modalWorkItemId ? (
        <BacklogTaskModal
          workItemId={modalWorkItemId}
          onClose={() => setModalWorkItemId(null)}
        />
      ) : null}
      {isCreateTaskModalOpen ? (
        <BacklogTaskModal onClose={() => setIsCreateTaskModalOpen(false)} />
      ) : null}
      {subtaskModalParentId ? (
        <BacklogTaskModal
          parentWorkItemId={subtaskModalParentId}
          onClose={() => setSubtaskModalParentId(null)}
        />
      ) : null}
      {expandedNoteModalTarget || standaloneNoteModalState ? (
        <div
          ref={expandedNoteModalOverlayRef}
          className="time-entry-modal-overlay backlog-note-modal-overlay"
          onMouseDown={(event) => {
            if (expandedNoteModalOverlayRef.current === event.target) {
              closeExpandedNoteModal();
            }
          }}
        >
          <div
            className="time-entry-modal backlog-note-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="backlog-note-modal-title"
          >
            <div className="time-entry-modal-header backlog-note-modal-header">
                <div className="backlog-note-modal-heading">
                  <div className="backlog-note-modal-title-row">
                    {expandedNoteModalIcon ? (
                      <WorkItemIcon icon={expandedNoteModalIcon} />
                    ) : null}
                  <span
                    id="backlog-note-modal-title"
                    className="backlog-note-modal-task-title"
                  >
                    {expandedNoteModalTitle}
                  </span>
                </div>
              </div>
              <button
                type="button"
                className="time-entry-modal-close"
                aria-label="Close expanded description editor"
                onClick={closeExpandedNoteModal}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="backlog-note-modal-body">
              <textarea
                ref={expandedNoteTextareaRef}
                className="field-input entry-note-input backlog-note-modal-input"
                value={expandedNoteModalValue}
                onChange={(event) =>
                  handleExpandedNoteModalChange(event.target.value)
                }
                placeholder="Description (optional)"
                rows={18}
              />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
