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
  RiArrowRightSLine as ChevronRight,
  RiArrowUpDownLine as SortIcon,
  RiFileTextLine as FileText,
  RiInboxArchiveLine as ArchiveRestore,
  RiPlayLine as Play,
} from "@remixicon/react";
import {
  ObjectActionsButton,
  ObjectContextMenu,
} from "@/components/object-actions-menu";
import { SidePanel } from "@/components/side-panel";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  getBacklogItemActions,
  type BacklogItemActionId,
} from "@/domain/actions/object-actions";
import { getWorkItemEstimateBadgeLabel } from "@/domain/backlog/work-item-estimates";
import {
  getWorkItemLookupKeys,
  getWorkItemParentKey,
  isSubtaskWorkItem,
} from "@/domain/backlog/work-item-hierarchy";
import {
  getLocalProjectDisplayName,
  hasWorkItemEstimateSyncIssue,
  type BacklogSortMode,
  type LocalWorkItem,
} from "@/domain/local-state";
import {
  BacklogItemEditorForm,
  type BacklogItemEditorFormHandle,
} from "@/features/backlog/backlog-item-editor-form";
import { buildBacklogStatusLookup } from "@/features/backlog/backlog-status";
import {
  sumSubitemEstimates,
  type BacklogTaskEditorFields,
  type BacklogTaskEditorTarget,
} from "@/features/backlog/backlog-task-editor";
import {
  WorkItemIcon,
  resolveWorkItemIcon,
  useWorkItemIconData,
} from "@/features/backlog/work-item-icons";
import {
  getWorkItemEntryValues,
  parseWorkItemReference,
} from "@/features/backlog/work-item-timer-comment";
import { offerUndo } from "@/features/feedback/undo-toast";
import type { NewTimeEntryValues } from "@/features/time/time-entry-editor-form";
import { TimeEntryModal } from "@/features/timer/time-entry-modal";
import {
  useLocalProjects,
  useLocalState,
  useLocalWorkItems,
} from "@/lib/local-hooks";
import { useActionRequest } from "@/lib/action-request";
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
import { useIsNarrowView } from "@/lib/use-narrow-view";
import { cn, todayIsoDate } from "@/lib/utils";

const BACKLOG_TABLE_COLUMN_COUNT = 4;

function BacklogTableColumns() {
  return (
    <colgroup>
      <col className="backlog-priority-column" />
      <col className="backlog-task-column" />
      <col className="backlog-status-column" />
      <col className="backlog-estimate-column" />
    </colgroup>
  );
}

type BacklogFilter = "active" | "archived";

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

/** What the item editor shows: a saved item, or a new item, under a parent for a subitem. */
type BacklogEditorRequest =
  | { kind: "edit"; workItemId: string }
  | { kind: "create"; parentWorkItemId?: string };

function getEditorKey(request: BacklogEditorRequest) {
  return request.kind === "edit"
    ? `edit-${request.workItemId}`
    : `new-${request.parentWorkItemId ?? "root"}`;
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

/**
 * The Backlog page: backlog items with their subitems listed under them, and the
 * item editor in the side panel, or in a full-width dialog in the narrow layout.
 */
export function BacklogPage() {
  const state = useLocalState();
  const projects = useLocalProjects();
  const workItemIconData = useWorkItemIconData(projects);
  const workItems = useLocalWorkItems();
  const backlogRowRefs = useRef(new Map<string, HTMLTableRowElement>());
  const backlogPointerSessionRef = useRef<SharedTableDragPointerSession | null>(
    null,
  );
  const backlogDragStateRef = useRef<BacklogDragState | null>(null);
  const suppressWorkItemClickUntilRef = useRef(0);
  const editorFormRef = useRef<BacklogItemEditorFormHandle>(null);
  // The unsaved draft of the open editor, kept above the side panel and the dialog so
  // crossing the narrow breakpoint mid-edit hands the draft to the other host.
  const editorDraftRef = useRef<{
    key: string;
    fields: BacklogTaskEditorFields;
  } | null>(null);
  const currentTimer = state.timers[0] ?? null;
  const backlogSortMode = state.backlogSortMode ?? "custom";
  const isNarrowLayout = useIsNarrowView();
  const [editorRequest, setEditorRequest] =
    useState<BacklogEditorRequest | null>(null);
  /** Top-level items whose subitems are listed under them. */
  const [expandedParentIds, setExpandedParentIds] = useState<
    ReadonlySet<string>
  >(() => new Set());
  /** Prefill of the New entry… dialog, or null while it is closed. */
  const [newEntryValues, setNewEntryValues] =
    useState<NewTimeEntryValues | null>(null);
  const [activeFilter, setActiveFilter] = useState<BacklogFilter>("active");
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
  const backlogStatusById = useMemo(
    () => buildBacklogStatusLookup(state.backlogStatuses),
    [state.backlogStatuses],
  );

  // Resolved against live state, so the editor closes when its item disappears.
  const editorTarget = useMemo((): BacklogTaskEditorTarget | null => {
    if (!editorRequest) {
      return null;
    }

    if (editorRequest.kind === "edit") {
      const workItem = workItemsById.get(editorRequest.workItemId);
      return workItem ? { kind: "edit", workItem } : null;
    }

    if (!editorRequest.parentWorkItemId) {
      return { kind: "create" };
    }

    const parent = workItemsById.get(editorRequest.parentWorkItemId);
    return parent ? { kind: "create", parent } : null;
  }, [editorRequest, workItemsById]);
  const editorKey = editorRequest ? getEditorKey(editorRequest) : "";
  const editingWorkItemId =
    editorRequest?.kind === "edit" ? editorRequest.workItemId : null;
  const canReorderVisibleRootItems =
    backlogSortMode === "custom" && visibleRootItems.length > 1;

  useEffect(() => {
    if (editorRequest && !editorTarget) {
      closeEditor();
    }
  }, [editorRequest, editorTarget]);

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
  }, [activeFilter, clearBacklogPointerSession, resetBacklogDragVisuals]);

  function getChildItems(workItem: LocalWorkItem) {
    return getWorkItemLookupKeys(workItem)
      .flatMap((lookupKey) => allChildrenByParent.get(lookupKey) ?? [])
      .sort((left, right) => right.createdAt - left.createdAt);
  }

  /**
   * Saves a valid draft in the editor before it shows something else.
   * Returns false when the draft is invalid; the form then shows why.
   */
  function leaveEditorDraft() {
    return editorFormRef.current?.commitBeforeSwitch() ?? true;
  }

  /**
   * Opens a saved or new item in the editor. The item already in the editor is saved
   * first when valid; an invalid draft keeps it open.
   */
  function openEditor(request: BacklogEditorRequest) {
    if (
      editorRequest &&
      getEditorKey(editorRequest) === getEditorKey(request)
    ) {
      return;
    }

    if (!leaveEditorDraft()) {
      return;
    }

    editorDraftRef.current = null;
    setEditorRequest(request);
  }

  function closeEditor() {
    editorDraftRef.current = null;
    setEditorRequest(null);
  }

  /** Closes the editor when it shows the item, or a new subitem under it. */
  function closeEditorOf(workItemId: string) {
    if (
      editingWorkItemId === workItemId ||
      (editorRequest?.kind === "create" &&
        editorRequest.parentWorkItemId === workItemId)
    ) {
      closeEditor();
    }
  }

  function toggleSubitems(workItemId: string) {
    setExpandedParentIds((current) => {
      const next = new Set(current);
      if (!next.delete(workItemId)) {
        next.add(workItemId);
      }
      return next;
    });
  }

  function expandSubitems(workItemId: string) {
    setExpandedParentIds((current) =>
      current.has(workItemId) ? current : new Set(current).add(workItemId),
    );
  }

  function handleWorkItemPointerDown(
    workItem: LocalWorkItem,
    event: React.PointerEvent<HTMLTableRowElement>,
  ) {
    if (
      !canReorderVisibleRootItems ||
      event.button !== 0 ||
      isSubtaskWorkItem(workItem) ||
      isBacklogDragBlockedTarget(event.target) ||
      // React bubbles events from portals, such as the row's open "…" menu.
      !(event.target instanceof Node) ||
      !event.currentTarget.contains(event.target)
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
      isDragging: () => backlogDragStateRef.current?.pointerId === pointerId,
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
        openWorkItemFromRow(workItem, { ignoreClickSuppression: true });
      },
    });
  }

  function openWorkItemFromRow(
    workItem: LocalWorkItem,
    options?: { ignoreClickSuppression?: boolean },
  ) {
    if (
      !options?.ignoreClickSuppression &&
      performance.now() < suppressWorkItemClickUntilRef.current
    ) {
      return;
    }

    // Edit is unavailable on archived items until they are restored.
    if (workItem.status === "archived") {
      return;
    }

    openEditor({ kind: "edit", workItemId: workItem._id });
  }

  /** Deletes an item and its subitems at once, with Undo in a toast. */
  function deleteWorkItem(workItem: LocalWorkItem) {
    const subitemCount = isSubtaskWorkItem(workItem)
      ? 0
      : getChildItems(workItem).length;
    // The editor closes itself once its item, or its new subitem's parent, is gone.
    offerUndo(localStore.deleteWorkItem(workItem._id), {
      title:
        subitemCount > 0
          ? `Backlog item and ${subitemCount} ${subitemCount === 1 ? "subitem" : "subitems"} deleted`
          : "Backlog item deleted",
      subject: "backlog item",
    });
  }

  /** Runs an action from a row. On the item in the editor, the draft is saved first. */
  function runRowWorkItemAction(
    workItem: LocalWorkItem,
    actionId: BacklogItemActionId,
  ) {
    if (editingWorkItemId !== workItem._id) {
      runWorkItemAction(workItem, actionId);
      return;
    }

    if (!leaveEditorDraft()) {
      return;
    }

    // The row rendered before the draft was saved; act on the saved item.
    const savedWorkItem = localStore
      .snapshot()
      .workItems.find((item) => item._id === workItem._id);
    runWorkItemAction(savedWorkItem ?? workItem, actionId);
  }

  /**
   * Runs the backlog item action set from a row or the editor. Callers that show a
   * draft save it first and pass the item with the draft applied.
   */
  function runWorkItemAction(
    workItem: LocalWorkItem,
    actionId: BacklogItemActionId,
  ) {
    switch (actionId) {
      case "start-entry":
        handleStartWorkItemTimer(workItem);
        return;
      case "new-entry":
        if (workItem.status === "archived") {
          return;
        }
        // Saving the entry updates the item's estimates, which the editor's older
        // values must not overwrite.
        if (editingWorkItemId === workItem._id) {
          closeEditor();
        }
        setNewEntryValues(getWorkItemEntryValues(workItem));
        return;
      case "edit":
        openWorkItemFromRow(workItem, { ignoreClickSuppression: true });
        return;
      case "add-subitem":
        expandSubitems(workItem._id);
        openEditor({ kind: "create", parentWorkItemId: workItem._id });
        return;
      case "open-in-source":
        if (workItem.sourceUrl) {
          window.open(workItem.sourceUrl, "_blank", "noopener,noreferrer");
        }
        return;
      case "archive":
        closeEditorOf(workItem._id);
        offerUndo(localStore.archiveWorkItem(workItem._id), {
          title: "Backlog item archived",
          subject: "backlog item",
        });
        return;
      case "restore":
        localStore.restoreWorkItem(workItem._id);
        return;
      case "delete":
        deleteWorkItem(workItem);
        return;
    }
  }

  function getWorkItemActions(workItem: LocalWorkItem) {
    const isSubitem = isSubtaskWorkItem(workItem);
    return getBacklogItemActions(workItem, {
      isSubitem,
      subitemCount: isSubitem ? 0 : getChildItems(workItem).length,
    });
  }

  // The command palette asks for actions that need this page, such as Edit, with
  // `?action=<id>&target=<item id>`. Only enabled actions of the item run.
  useActionRequest(({ action, target }) => {
    const workItem = workItems.find((item) => item._id === target);
    const requested = workItem
      ? getWorkItemActions(workItem).find(
          (item) => item.id === action && !item.disabledReason,
        )
      : undefined;
    if (workItem && requested) {
      runRowWorkItemAction(workItem, requested.id);
    }
  });

  function handleStartWorkItemTimer(workItem: LocalWorkItem) {
    if (workItem.status === "archived") {
      return;
    }

    localStore.startTimer({
      ...getWorkItemEntryValues(workItem),
      accumulatedDurationMs: 0,
    });
  }

  function renderWorkItemRow(workItem: LocalWorkItem, forceChild = false) {
    const project = projects.find((item) => item._id === workItem.projectId);
    const task = project?.tasks.find((item) => item._id === workItem.taskId);
    const isLogicalChild = forceChild || isSubtaskWorkItem(workItem);
    const childItems = isLogicalChild ? [] : getChildItems(workItem);
    const childEstimateTotals =
      childItems.length > 0 ? sumSubitemEstimates(childItems) : null;
    const isRootExpanded =
      !isLogicalChild && expandedParentIds.has(workItem._id);
    const isEditingItem = editingWorkItemId === workItem._id;
    const rootSectionId =
      isLogicalChild && workItem.parentWorkItemId
        ? workItem.parentWorkItemId
        : workItem._id;
    const isMobileLayout = isNarrowLayout;
    const isArchived = workItem.status === "archived";
    const resolvedWorkItemIcon = resolveWorkItemIcon(
      workItem,
      workItemIconData,
    );
    const showWorkItemIcon = true;
    const showSubtasksPill = !isLogicalChild && childItems.length > 0;
    const canStartTimer = !isArchived;
    const sourceMetaParts = [
      isLogicalChild ? "Subitem" : undefined,
      workItem.source !== "manual" ? workItem.sourceConnectionLabel : undefined,
      workItem.source !== "manual" ? workItem.sourceProjectName : undefined,
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
    const sourceUrl = workItem.sourceUrl;
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
    const startEntryTitle = currentTimer
      ? `Switch to ${workItem.title}`
      : `Start entry for ${workItem.title}`;
    const hasEstimateSyncIssue = hasWorkItemEstimateSyncIssue(workItem);
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

    const rowActions = getWorkItemActions(workItem);
    const runRowAction = (actionId: BacklogItemActionId) =>
      runRowWorkItemAction(workItem, actionId);
    const rowActionsButton = (
      <ObjectActionsButton
        actions={rowActions}
        onAction={runRowAction}
        label={`Actions for ${workItem.title}`}
        className="entry-row-action"
      />
    );

    return (
      <ObjectContextMenu
        key={workItem._id}
        actions={rowActions}
        onAction={runRowAction}
        render={
          <tr
            data-backlog-root-id={rootSectionId}
            data-backlog-item-id={workItem._id}
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
              isEditingItem && "is-editing",
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
            onClick={() => openWorkItemFromRow(workItem)}
            onPointerDown={(event) =>
              handleWorkItemPointerDown(workItem, event)
            }
          />
        }
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
                        aria-label={`${isRootExpanded ? "Hide" : "Show"} subitems for ${workItem.title}`}
                        data-no-backlog-drag="true"
                        onPointerDown={(event) => {
                          event.stopPropagation();
                        }}
                        onClick={(event) => {
                          event.stopPropagation();
                          toggleSubitems(workItem._id);
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
              <div className="entry-row-actions backlog-entry-row-actions">
                {!isArchived ? (
                  <button
                    type="button"
                    className="entry-row-action entry-row-action-play"
                    aria-label={startEntryTitle}
                    title={startEntryTitle}
                    disabled={!canStartTimer}
                    data-no-backlog-drag="true"
                    onClick={(event) => {
                      event.stopPropagation();
                      runRowAction("start-entry");
                    }}
                    onPointerDown={(event) => event.stopPropagation()}
                  >
                    <Play className="h-3.5 w-3.5" />
                  </button>
                ) : null}
                {rowActionsButton}
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
                aria-label={startEntryTitle}
                title={startEntryTitle}
                disabled={!canStartTimer}
                data-no-backlog-drag="true"
                onPointerDown={(event) => {
                  event.stopPropagation();
                }}
                onClick={(event) => {
                  event.stopPropagation();
                  runRowAction("start-entry");
                }}
              >
                <Play className="h-3.5 w-3.5" />
                <span>{currentTimer ? "Switch" : "Start entry"}</span>
              </button>
            ) : null}
            {isMobileLayout ? rowActionsButton : null}
          </div>
        </td>
      </ObjectContextMenu>
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
        ? sumSubitemEstimates(draggedChildItems)
        : draggedWorkItem,
    );
  }, [draggedWorkItem, getChildItems]);

  const sortChoice = isPrioritySortMode(backlogSortMode)
    ? "priority"
    : "custom";
  const carriedDraft =
    editorDraftRef.current?.key === editorKey
      ? editorDraftRef.current.fields
      : undefined;

  function keepEditorDraft(fields: BacklogTaskEditorFields) {
    editorDraftRef.current = { key: editorKey, fields };
  }

  function renderEditorForm(titleAs?: typeof DialogTitle) {
    if (!editorTarget) {
      return null;
    }

    return (
      <BacklogItemEditorForm
        key={editorKey}
        ref={editorFormRef}
        target={editorTarget}
        titleAs={titleAs}
        initialFields={carriedDraft}
        onFieldsChange={keepEditorDraft}
        onClose={closeEditor}
        onAction={runWorkItemAction}
      />
    );
  }

  return (
    <div
      className={cn(
        "backlog-page-stack",
        editorTarget && !isNarrowLayout && "has-side-panel",
      )}
    >
      <div className="backlog-page-main">
        <div className="entries-table-scroll-shell entries-table-scroll-shell-backlog">
          <table className="entries-table backlog-table entries-table-header-table animate-in">
            <BacklogTableColumns />
            <thead>
              <tr>
                <th
                  className="backlog-task-heading"
                  colSpan={BACKLOG_TABLE_COLUMN_COUNT}
                >
                  <div className="backlog-task-heading-content">
                    <span>Backlog items</span>
                    <div className="backlog-header-actions">
                      <ToggleGroup
                        aria-label="Show backlog items"
                        variant="outline"
                        size="sm"
                        className="tracking-normal normal-case"
                        value={[activeFilter]}
                        onValueChange={(nextValue) => {
                          const nextFilter = nextValue[0] as
                            BacklogFilter | undefined;
                          if (nextFilter) {
                            setActiveFilter(nextFilter);
                          }
                        }}
                      >
                        {BACKLOG_FILTERS.map((filter) => (
                          <ToggleGroupItem
                            key={filter.value}
                            value={filter.value}
                            className="backlog-filter-tab text-muted-foreground aria-pressed:text-foreground"
                          >
                            {filter.label}
                            <span className="backlog-filter-count">
                              {filterCounts[filter.value]}
                            </span>
                          </ToggleGroupItem>
                        ))}
                      </ToggleGroup>
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          render={
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              aria-label={`Sort backlog items, now ${getBacklogSortModeLabel(backlogSortMode)}`}
                            />
                          }
                        >
                          <SortIcon />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-auto">
                          <DropdownMenuGroup>
                            <DropdownMenuLabel>Sort by</DropdownMenuLabel>
                            <DropdownMenuRadioGroup
                              value={sortChoice}
                              onValueChange={(value) => {
                                if (value !== sortChoice) {
                                  localStore.setBacklogSortMode(
                                    value === "priority"
                                      ? "priority_asc"
                                      : "custom",
                                  );
                                }
                              }}
                            >
                              {BACKLOG_SORT_MODES.map((sortMode) => (
                                <DropdownMenuRadioItem
                                  key={sortMode.value}
                                  value={sortMode.value}
                                >
                                  {sortMode.label}
                                </DropdownMenuRadioItem>
                              ))}
                            </DropdownMenuRadioGroup>
                          </DropdownMenuGroup>
                        </DropdownMenuContent>
                      </DropdownMenu>
                      <Button
                        type="button"
                        size="sm"
                        aria-label="New backlog item"
                        onClick={() => openEditor({ kind: "create" })}
                      >
                        <Plus data-icon="inline-start" />
                        <span className="backlog-new-item-label">
                          New backlog item
                        </span>
                      </Button>
                    </div>
                  </div>
                </th>
              </tr>
            </thead>
          </table>
          <ScrollArea className="entries-table-scroll-area">
            <table
              className={cn(
                "entries-table backlog-table entries-table-body-table animate-in",
                backlogDragState && "is-backlog-dragging",
              )}
            >
              <BacklogTableColumns />
              <tbody className="entries-table-scroll-region">
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
                              ? "No active backlog items"
                              : "No archived backlog items"}
                          </EmptyTitle>
                          <EmptyDescription>
                            {activeFilter === "active"
                              ? "Create one with New backlog item."
                              : "Archived backlog items will appear here."}
                          </EmptyDescription>
                        </EmptyHeader>
                      </Empty>
                    </td>
                  </tr>
                ) : null}

                {visibleRootItems.map((workItem) => (
                  <Fragment key={workItem._id}>
                    {renderWorkItemRow(workItem)}
                    {expandedParentIds.has(workItem._id)
                      ? getChildItems(workItem).map((childItem) =>
                          renderWorkItemRow(childItem, true),
                        )
                      : null}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </ScrollArea>
        </div>
      </div>

      {editorTarget && !isNarrowLayout ? (
        <SidePanel
          contentKey={editorKey}
          className="backlog-side-panel"
          aria-label="Backlog item editor"
        >
          {renderEditorForm()}
        </SidePanel>
      ) : null}
      {editorTarget && isNarrowLayout ? (
        <Dialog
          open
          disablePointerDismissal
          onOpenChange={(open) => !open && closeEditor()}
        >
          <DialogContent className="max-w-xl" showCloseButton={false}>
            {renderEditorForm(DialogTitle)}
          </DialogContent>
        </Dialog>
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

      {newEntryValues ? (
        <TimeEntryModal
          date={todayIsoDate()}
          initialValues={newEntryValues}
          onClose={() => setNewEntryValues(null)}
        />
      ) : null}
    </div>
  );
}
