import { useBacklogRefreshOnOpen } from "./use-backlog-refresh-on-open";
import { placeFloatingComposerFor } from "@/lib/floating-composer";
import {
  EMPTY_ENTRY_SELECTION,
  selectEntryOnClick,
  type EntrySelection,
} from "@/domain/time/entry-selection";
import {
  useNewBacklogItemPageHost,
  type NewBacklogItemPreset,
} from "@/features/backlog/new-backlog-item-dialog";
import {
  isUnmappedRising,
  readUnmappedSeen,
  writeUnmappedSeen,
} from "@/lib/backlog-unmapped-seen";
import { getWorkflowStateFills } from "@/domain/backlog/workflow-state-fill";
import { stateDotStyle } from "@/features/backlog/state-dot";
import { BacklogRefresh } from "./backlog-refresh";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { setOpenDraftGuard } from "@/lib/open-draft";
import {
  RiAddLine,
  RiErrorWarningLine,
  RiArrowDownSLine,
  RiArrowRightSLine,
} from "@remixicon/react";
import { useNavigate } from "@tanstack/react-router";
import {
  SettingsLink,
  useOpenSettings,
} from "@/features/settings/settings-link";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { SidePanel } from "@/components/side-panel";
import { TooltipButton } from "@/components/tooltip-button";
import {
  getBacklogSurfaceActions,
  BacklogItemSurface,
  patchBacklogItemWithUndo,
} from "@/features/backlog/backlog-item-surface";
import {
  BacklogDisplay,
  BacklogFilters,
  BacklogLayoutToggle,
} from "@/features/backlog/backlog-display";
import { BacklogPeek } from "@/features/backlog/backlog-peek";
import {
  captureReturnNotice,
  type BacklogItemReturnNotice,
} from "@/features/backlog/backlog-item-notice";
import {
  BacklogItemEditorForm,
  type BacklogItemEditorFormHandle,
} from "@/features/backlog/backlog-item-editor-form";
import {
  createBacklogTaskEditorSeed,
  type BacklogTaskEditorFields,
  type BacklogTaskEditorTarget,
} from "@/features/backlog/backlog-task-editor";
import { useWorkItemIconData } from "@/features/backlog/work-item-icons";
import { moveBacklogItemWithUndo } from "@/features/backlog/backlog-item-moves";
import { runBacklogItemAction } from "@/features/backlog/backlog-item-actions";
import {
  getBacklogDropMark,
  useBacklogDrag,
} from "@/features/backlog/use-backlog-drag";
import {
  groupBacklogItems,
  isBacklogReorderPeer,
  orderBacklogItems,
  selectBacklogViewItems,
  type BacklogGroup,
} from "@/domain/backlog/backlog-view";
import { getPriorityLevelName } from "@/domain/backlog/priority";
import { isSubtaskWorkItem } from "@/domain/backlog/work-item-hierarchy";
import { PriorityIcon } from "@/features/backlog/priority-icon";
import type { BacklogItemActionId } from "@/domain/actions/object-actions";
import type { LocalAppState, LocalWorkItem } from "@/domain/local-state";
import { useLocalState } from "@/lib/local-hooks";
import { localStore } from "@/lib/local-store";
import { withEventAttribution } from "@/lib/wide-events";
import { useBacklogView } from "@/lib/backlog-view-settings";
import { useNow } from "@/lib/use-now";
import { useIsNarrowView } from "@/lib/use-narrow-view";
import { useActionRequest } from "@/lib/action-request";
import {
  BACKLOG_ITEM_ROW_KEYS,
  handleItemKeyDown,
  OPEN_BACKLOG_ITEM_ACTION,
} from "@/lib/item-keys";
import { getSharedTableStepOrder } from "@/lib/table-drag";
import {
  ITEM_SHORTCUTS,
  resolveShortcut,
  getShortcutPlatform,
} from "@/lib/shortcuts";
import { offerUndo } from "@/features/feedback/undo-toast";
import { cn } from "@/lib/utils";

function canUseProjectGroup(
  group: BacklogGroup | undefined,
  state: Pick<LocalAppState, "projects">,
) {
  return (
    group?.kind !== "project" ||
    group.projectId === undefined ||
    (!group.archived &&
      state.projects.some(
        (project) =>
          project._id === group.projectId && project.status === "active",
      ))
  );
}

type EditorRequest =
  | { kind: "edit"; itemId: string }
  | {
      kind: "create";
      parentId?: string;
      preset?: Partial<BacklogTaskEditorFields>;
    };
export function BacklogPage() {
  useBacklogRefreshOnOpen();
  const state = useLocalState();
  const view = useBacklogView();
  const now = useNow();
  const narrow = useIsNarrowView();
  const navigate = useNavigate();
  const openSettings = useOpenSettings();
  const icons = useWorkItemIconData(state.projects);
  const [peekId, setPeekId] = useState<string | null>(null);
  // The selected rows, as in a file explorer: a click selects one, Cmd or
  // Ctrl+click adds or removes one, Shift+click selects a range. A double
  // click opens the item (forms council round 8).
  const [selection, setSelection] = useState<EntrySelection>(
    EMPTY_ENTRY_SELECTION,
  );
  const [editor, setEditor] = useState<EditorRequest | null>(null);
  const [editorSerial, setEditorSerial] = useState(0);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const editorRef = useRef<BacklogItemEditorFormHandle>(null);
  const draft = useRef<BacklogTaskEditorFields | null>(null);
  const board = !narrow && view.layout === "board";
  const grouping = board && view.grouping === "none" ? "state" : view.grouping;
  const items = useMemo(
    () =>
      orderBacklogItems(
        selectBacklogViewItems(state, view, view.filters, {
          now,
          runningWorkItemId: state.timers[0]?.workItemId,
        }),
        state.workItems,
        state.backlogSortMode,
      ),
    [state, view, now],
  );
  const lanes = useMemo(
    () =>
      board && view.swimlanes === "project" && grouping !== "project"
        ? groupBacklogItems(state, items, "project", { keepEmpty: false })
        : [{ kind: "all" as const, key: "workspace", label: "", items }],
    [state, items, board, view.swimlanes, grouping],
  );
  const groupsByLane = lanes.map((lane) => ({
    lane,
    groups: groupBacklogItems(state, lane.items, grouping, {
      keepEmpty: board,
    }),
  }));
  const shownItemIds = groupsByLane.flatMap(({ lane, groups }) =>
    collapsed.has(lane.key)
      ? []
      : groups.flatMap((group) =>
          collapsed.has(`${lane.key}/${group.key}`)
            ? []
            : group.items.map((item) => item._id),
        ),
  );
  const targets = groupsByLane.flatMap(({ lane, groups }) =>
    collapsed.has(lane.key) || !canUseProjectGroup(lane, state)
      ? []
      : groups
          .filter((group) => canUseProjectGroup(group, state))
          .map((group) => ({
            key: `${lane.key}/${group.key}`,
            itemIds: group.items.map((i) => i._id),
          })),
  );
  const peek = state.workItems.find((i) => i._id === peekId);
  const target: BacklogTaskEditorTarget | null =
    editor?.kind === "edit"
      ? (() => {
          const item = state.workItems.find((i) => i._id === editor.itemId);
          return item ? { kind: "edit", workItem: item } : null;
        })()
      : editor?.kind === "create"
        ? (() => {
            const parent = state.workItems.find(
              (i) => i._id === editor.parentId,
            );
            return editor.parentId && !parent
              ? null
              : { kind: "create", parent };
          })()
        : null;
  const closeEditor = useCallback(() => {
    setEditor(null);
    draft.current = null;
  }, []);
  const closePeek = useCallback(() => setPeekId(null), []);
  const [peekReturnNotice, setPeekReturnNotice] =
    useState<BacklogItemReturnNotice | null>(null);
  function showPeek(itemId: string) {
    const opened = state.workItems.find((workItem) => workItem._id === itemId);
    setPeekReturnNotice(
      opened ? captureReturnNotice(opened, Date.now()) : null,
    );
    localStore.markWorkItemOpened(itemId);
    setPeekId(itemId);
  }
  useEffect(() => {
    if (
      editor &&
      (!target ||
        (target.kind === "edit" && target.workItem.status === "archived"))
    )
      closeEditor();
    if (peekId && !peek) setPeekId(null);
  }, [editor, target, peekId, peek, closeEditor]);
  async function leaveDraft() {
    return editorRef.current?.commitBeforeSwitch() ?? true;
  }
  // Leaving from elsewhere, as Sync review's toast does, saves the draft too.
  useEffect(
    () =>
      setOpenDraftGuard(
        async () => (await editorRef.current?.commitBeforeSwitch()) ?? true,
      ),
    [],
  );
  function showEditor(request: EditorRequest) {
    draft.current = null;
    setEditor(request);
    setEditorSerial((n) => n + 1);
  }
  async function openEditor(request: EditorRequest) {
    if (await leaveDraft()) showEditor(request);
  }
  async function openPage(item: LocalWorkItem) {
    if (!(await leaveDraft())) return;
    void navigate({ to: "/backlog/$itemId", params: { itemId: item._id } });
  }
  async function select(item: LocalWorkItem, event?: React.MouseEvent) {
    if (!drag.clickAllowed()) return;
    if (narrow) {
      if (!(await leaveDraft())) return;
      closeEditor();
      void navigate({ to: "/backlog/$itemId", params: { itemId: item._id } });
      return;
    }
    setSelection((current) =>
      selectEntryOnClick(current, shownItemIds, item._id, {
        range: Boolean(event?.shiftKey),
        toggle: Boolean(event?.metaKey || event?.ctrlKey),
      }),
    );
  }
  /** The actions every selected item offers, run on each of them. */
  const BULK_ACTION_IDS = new Set<BacklogItemActionId>([
    "settle",
    "unsettle",
    "unsnooze",
    "pin",
    "unpin",
    "restore",
    "archive",
    "delete",
  ]);
  function selectionMenuFor(item: LocalWorkItem) {
    if (selection.ids.length < 2 || !selection.ids.includes(item._id))
      return undefined;
    const selectedItems = selection.ids
      .map((id) => state.workItems.find((candidate) => candidate._id === id))
      .filter((candidate): candidate is LocalWorkItem => Boolean(candidate));
    const shared = getBacklogSurfaceActions(item, state, now).filter(
      (candidate) =>
        BULK_ACTION_IDS.has(candidate.id) &&
        selectedItems.every((selected) =>
          getBacklogSurfaceActions(selected, state, now).some(
            (other) => other.id === candidate.id && !other.disabledReason,
          ),
        ),
    );
    const count = selectedItems.length;
    return {
      actions: shared.map((candidate) => ({
        ...candidate,
        label: `${candidate.label.replace(/…$/, "")} ${count} items`,
      })),
      onAction: async (id: BacklogItemActionId) => {
        for (const selected of selectedItems) await action(selected, id);
        setSelection(EMPTY_ENTRY_SELECTION);
      },
    };
  }
  async function action(
    item: LocalWorkItem,
    id: BacklogItemActionId,
    options?: { askToSettle?: boolean },
  ) {
    if (!(await leaveDraft())) return;
    runCommittedAction(item, id, options);
  }
  function runCommittedAction(
    item: LocalWorkItem,
    id: BacklogItemActionId,
    options?: { askToSettle?: boolean },
  ) {
    const saved =
      localStore.snapshot().workItems.find((i) => i._id === item._id) ?? item;
    if (id === "new-entry") closeEditor();
    runBacklogItemAction(
      saved,
      id,
      (hosted) => {
        if (hosted === "edit") {
          showPeek(item._id);
          showEditor({ kind: "edit", itemId: item._id });
        } else showEditor({ kind: "create", parentId: item._id });
      },
      options,
    );
  }
  const workItemById = useMemo(
    () => new Map(state.workItems.map((workItem) => [workItem._id, workItem])),
    [state.workItems],
  );
  // Asked about the items of one group at a time. Grouped by priority, each
  // group is one level, and a drop in another group gives the item that
  // group's level, so the item moves among the items of the group it is in.
  const canReorderItem = useCallback(
    (itemId: string, draggedId: string) => {
      const item = workItemById.get(itemId);
      const dragged = workItemById.get(draggedId);
      if (!item || !dragged) return false;
      const landed =
        grouping === "priority"
          ? { ...dragged, priority: item.priority }
          : dragged;
      return isBacklogReorderPeer(state.backlogSortMode, landed, item);
    },
    [grouping, state.backlogSortMode, workItemById],
  );
  function reorder(itemId: string, group: BacklogGroup, step: -1 | 1) {
    if (!canReorderItem(itemId, itemId)) return;
    const next = getSharedTableStepOrder(
      group.items
        .filter((item) => canReorderItem(item._id, itemId))
        .map((i) => i._id),
      itemId,
      step,
    );
    if (next)
      offerUndo(localStore.reorderWorkItemsWithUndo(next.order), {
        title: "Backlog item reordered",
        subject: "backlog item",
      });
  }
  async function drop(itemId: string, key: string, order: string[] | null) {
    const item = localStore.snapshot().workItems.find((i) => i._id === itemId);
    const found = groupsByLane
      .flatMap(({ lane, groups }) =>
        groups.map((group) => ({
          lane,
          group,
          key: `${lane.key}/${group.key}`,
        })),
      )
      .find((t) => t.key === key);
    if (!item || !found || !(await leaveDraft())) return;
    const current = localStore.snapshot();
    if (
      !canUseProjectGroup(found.group, current) ||
      !canUseProjectGroup(found.lane, current)
    )
      return;
    closeEditor();
    const committed = current.workItems.find((i) => i._id === itemId);
    if (!committed) return;
    const { group, lane } = found;
    // The drag's order was read before the drop. Keep only the peers the
    // saved items still allow, at the level the item has after the drop.
    const landed =
      group.kind === "priority"
        ? { ...committed, priority: group.priority }
        : committed;
    const currentById = new Map(current.workItems.map((i) => [i._id, i]));
    const isPeer = (id: string) => {
      const peer = id === itemId ? landed : currentById.get(id);
      return Boolean(
        peer && isBacklogReorderPeer(current.backlogSortMode, landed, peer),
      );
    };
    const orderedIds =
      order && isPeer(itemId) ? order.filter(isPeer) : undefined;
    // A swimlane is a display partition. Drops stay in the item's project;
    // project grouping is the explicit path for changing its project.
    if (lane.kind === "project" && lane.projectId !== committed.projectId)
      return;
    const sameGroup =
      group.kind === "state"
        ? committed.workflowStateId === group.workflowStateId
        : group.kind === "priority"
          ? committed.priority === group.priority
          : group.kind === "project"
            ? committed.projectId === group.projectId
            : true;
    if (sameGroup) {
      if (orderedIds)
        withEventAttribution({ surface: "drag" }, () =>
          offerUndo(localStore.reorderWorkItemsWithUndo(orderedIds), {
            title: "Backlog item reordered",
            subject: "backlog item",
          }),
        );
      return;
    }
    // Dragging a selected row moves the whole selection into the group.
    const others =
      selection.ids.length > 1 && selection.ids.includes(itemId)
        ? selection.ids
            .filter((id) => id !== itemId)
            .map((id) => current.workItems.find((i) => i._id === id))
            .filter((other): other is LocalWorkItem => Boolean(other))
        : [];
    if (group.kind === "state") {
      await withEventAttribution({ surface: "drag" }, () =>
        moveBacklogItemWithUndo(committed, group.workflowStateId, {
          orderedIds,
        }),
      );
      for (const other of others)
        await withEventAttribution({ surface: "drag" }, () =>
          moveBacklogItemWithUndo(other, group.workflowStateId),
        );
    }
    if (group.kind === "priority")
      for (const other of others)
        withEventAttribution({ surface: "drag" }, () =>
          patchBacklogItemWithUndo(
            other,
            { priority: group.priority },
            `Priority changed to ${getPriorityLevelName(group.priority)}`,
          ),
        );
    if (group.kind === "project")
      for (const other of others)
        withEventAttribution({ surface: "drag" }, () =>
          patchBacklogItemWithUndo(
            other,
            {
              projectId: group.projectId,
              taskId: undefined,
              ...(isSubtaskWorkItem(other)
                ? { inheritsParentMapping: false }
                : {}),
            },
            "Project changed",
          ),
        );
    if (group.kind === "priority")
      withEventAttribution({ surface: "drag" }, () =>
        patchBacklogItemWithUndo(
          committed,
          { priority: group.priority },
          `Priority changed to ${getPriorityLevelName(group.priority)}`,
          orderedIds,
        ),
      );
    if (group.kind === "project")
      withEventAttribution({ surface: "drag" }, () =>
        patchBacklogItemWithUndo(
          committed,
          {
            projectId: group.projectId,
            taskId: undefined,
            ...(isSubtaskWorkItem(committed)
              ? { inheritsParentMapping: false }
              : {}),
          },
          "Project changed",
          orderedIds,
        ),
      );
  }
  const drag = useBacklogDrag({
    targets,
    canReorder: canReorderItem,
    disabled: narrow,
    onDrop: (itemId, key, order) => void drop(itemId, key, order),
  });
  // Subitems keep their slots on this page while the moved items trade theirs.
  const dropMark = getBacklogDropMark(
    drag.drag,
    targets,
    canReorderItem,
    "keep-slot",
  );
  async function add(group?: BacklogGroup, lane?: BacklogGroup) {
    if (!(await leaveDraft())) return;
    const current = localStore.snapshot();
    if (
      !canUseProjectGroup(group, current) ||
      !canUseProjectGroup(lane, current)
    )
      return;
    const preset: Partial<BacklogTaskEditorFields> = {};
    if (group?.kind === "state")
      preset.workflowStateId = group.workflowStateId ?? "";
    if (group?.kind === "priority")
      preset.priority = group.priority ? String(group.priority) : "";
    if (group?.kind === "project") preset.projectId = group.projectId ?? "";
    if (lane?.kind === "project") preset.projectId = lane.projectId ?? "";
    showEditor({ kind: "create", preset });
  }
  // The sidebar's "+" opens this page's panel while the page is open.
  const showEditorRef = useRef(showEditor);
  showEditorRef.current = showEditor;
  const editorOpenRef = useRef(false);
  editorOpenRef.current = editor !== null;
  useNewBacklogItemPageHost(
    useCallback(({ projectId }: NewBacklogItemPreset) => {
      if (editorOpenRef.current) return false;
      showEditorRef.current({
        kind: "create",
        preset: projectId ? { projectId } : {},
      });
      return true;
    }, []),
  );
  useActionRequest(({ action: requested, target: itemId }) => {
    if (requested === "create") {
      add();
      return;
    }
    const item = state.workItems.find((i) => i._id === itemId);
    if (!item || !itemId) return;
    if (requested === "move-up" || requested === "move-down") {
      const group = groupsByLane
        .flatMap((l) => l.groups)
        .find((g) => g.items.some((i) => i._id === itemId));
      if (group) reorder(itemId, group, requested === "move-up" ? -1 : 1);
      return;
    }
    const enabled = getBacklogSurfaceActions(item, state, now).find(
      (a) => a.id === requested && !a.disabledReason,
    );
    if (enabled) action(item, enabled.id);
  });
  async function itemKeys(
    item: LocalWorkItem,
    group: BacklogGroup,
    e: React.KeyboardEvent<HTMLElement>,
  ) {
    if (
      e.target !== e.currentTarget ||
      e.defaultPrevented ||
      e.nativeEvent.isComposing
    )
      return;
    if (e.key === "Escape" && selection.ids.length > 0) {
      e.preventDefault();
      setSelection(EMPTY_ENTRY_SELECTION);
      return;
    }
    const resolved = resolveShortcut(
      ITEM_SHORTCUTS,
      [],
      e.nativeEvent,
      getShortcutPlatform(),
    );
    if (resolved.kind === "action") {
      const id = resolved.shortcut.id;
      if (id === "item.peek") {
        e.preventDefault();
        if (narrow) openPage(item);
        else if (await leaveDraft()) {
          closeEditor();
          if (peekId === item._id) closePeek();
          else showPeek(item._id);
        }
        return;
      }
      if (id === "item.change-state" || id === "item.change-priority") {
        e.preventDefault();
        e.currentTarget
          .querySelector<HTMLElement>(
            id === "item.change-state"
              ? "[data-state-picker]"
              : "[data-priority-picker]",
          )
          ?.click();
        return;
      }
      if (id === "item.state-previous" || id === "item.state-next") {
        e.preventDefault();
        if (!(await leaveDraft())) return;
        closeEditor();
        const current = localStore.snapshot();
        const committed = current.workItems.find((i) => i._id === item._id);
        if (!committed) return;
        const index = current.workflowStates.findIndex(
          (s) => s._id === committed.workflowStateId,
        );
        const next =
          current.workflowStates[index + (id === "item.state-next" ? 1 : -1)];
        if (next) await moveBacklogItemWithUndo(committed, next._id);
        return;
      }
    }
    handleItemKeyDown(e, {
      actions: [
        ...getBacklogSurfaceActions(item, state, now),
        OPEN_BACKLOG_ITEM_ACTION,
      ],
      keys: BACKLOG_ITEM_ROW_KEYS,
      onAction: (id, { shortcutId }) =>
        id === "open"
          ? openPage(item)
          : action(item, id, { askToSettle: shortcutId === "item.settle-ask" }),
      onReorder: canReorderItem(item._id, item._id)
        ? (step) => reorder(item._id, group, step)
        : undefined,
    });
  }
  function editorForm(titleAs?: typeof DialogTitle) {
    if (!target) return null;
    const initial =
      draft.current ??
      (editor?.kind === "create"
        ? { ...createBacklogTaskEditorSeed(target), ...editor.preset }
        : undefined);
    return (
      <BacklogItemEditorForm
        key={editorSerial}
        ref={editorRef}
        target={target}
        titleAs={titleAs}
        surface={titleAs ? "dialog" : "editor"}
        initialFields={initial}
        onFieldsChange={(fields) => {
          draft.current = fields;
        }}
        onClose={closeEditor}
        onAction={runCommittedAction}
        onOpenPage={
          target?.kind === "edit"
            ? async () => {
                if (!(await leaveDraft())) return;
                closeEditor();
                void navigate({
                  to: "/backlog/$itemId",
                  params: { itemId: target.workItem._id },
                });
              }
            : undefined
        }
      />
    );
  }
  const unmapped = new Set(
    state.workItems
      .filter(
        (i) =>
          i.sourceStatusKey &&
          !state.workflowStateMappings.some(
            (m) =>
              m.source === i.source &&
              m.connectionId === i.sourceConnectionId &&
              m.sourceStatusKey === i.sourceStatusKey &&
              (!m.sourceProjectName ||
                m.sourceProjectName === i.sourceProjectName),
          ),
      )
      .map(
        (i) =>
          `${i.source}:${i.sourceConnectionId}:${i.sourceProjectName}:${i.sourceStatusKey}`,
      ),
  ).size;
  // The count at the last visit, read once: amber only when it rose since.
  const [unmappedSeen] = useState(readUnmappedSeen);
  useEffect(() => {
    writeUnmappedSeen(unmapped);
  }, [unmapped]);
  const stateFills = useMemo(
    () => getWorkflowStateFills(state.workflowStates),
    [state.workflowStates],
  );
  const syncStatus = (
    <BacklogRefresh
      compact={narrow}
      hasSyncedItems={state.workItems.some((item) => item.source !== "manual")}
    />
  );
  const unmappedRising = isUnmappedRising(unmapped, unmappedSeen);
  const unmappedLink =
    unmapped > 0 ? (
      <SettingsLink
        page="workflow"
        className={cn("backlog-unmapped", unmappedRising && "is-rising")}
        aria-label={`${unmapped} unmapped source ${unmapped === 1 ? "state" : "states"}`}
        onClick={async (event) => {
          if (
            event.defaultPrevented ||
            event.button !== 0 ||
            event.ctrlKey ||
            event.metaKey ||
            event.shiftKey ||
            event.altKey
          )
            return;
          event.preventDefault();
          if (await leaveDraft()) void openSettings("workflow");
        }}
      >
        {/* A calm line carries no icon; the warning shows only while the
            count rises (council round 28). */}
        {unmappedRising ? <RiErrorWarningLine aria-hidden /> : null}
        <span>
          {unmapped} unmapped
          <span className="backlog-unmapped-words">
            {" "}
            source {unmapped === 1 ? "state" : "states"}
          </span>
        </span>
      </SettingsLink>
    ) : null;
  const dragged = state.workItems.find((i) => i._id === drag.drag?.itemId);
  return (
    <div
      className={cn(
        "backlog-page-stack backlog-workspace",
        (target || (!narrow && peek)) && !narrow && "has-side-panel",
      )}
    >
      <div className="backlog-page-main backlog-workspace-main">
        {/* Desktop: Filter, the sync status and the unmapped-states link sit
            in the top bar with the page's other actions, and the filter row
            shows only while filters are on (council round 10). The narrow
            view has no top-bar slot: Display joins Filter in one toolbar row
            over a status line. */}
        {narrow ? null : (
          <PageHeader
            title="Backlog"
            actions={
              <>
                {syncStatus}
                {unmappedLink}
                <BacklogFilters state={state} view={view} part="button" />
                <BacklogLayoutToggle view={view} />
                <BacklogDisplay
                  view={view}
                  ordering={state.backlogSortMode}
                  narrow={narrow}
                />
              </>
            }
          />
        )}
        {narrow ? (
          <div className="backlog-workspace-filterbar">
            <BacklogFilters state={state} view={view} />
            <BacklogDisplay
              view={view}
              ordering={state.backlogSortMode}
              narrow={narrow}
              className="backlog-narrow-display"
            />
            <div className="backlog-workspace-status">
              {syncStatus}
              {unmappedLink}
            </div>
          </div>
        ) : view.filters.length > 0 ? (
          <div className="backlog-workspace-filterbar">
            <BacklogFilters state={state} view={view} part="chips" />
          </div>
        ) : null}
        <div
          className={cn("backlog-workspace-scroll", board && "is-board")}
          data-focus-scope
        >
          {items.length === 0 && (
            <Empty align="start">
              <EmptyHeader>
                <EmptyTitle>
                  {view.filters.length
                    ? "No matching items"
                    : "Your backlog is empty"}
                </EmptyTitle>
                <EmptyDescription>
                  {view.filters.length
                    ? "Change the filters to see more items."
                    : "Create a backlog item or import items from a plugin."}
                </EmptyDescription>
              </EmptyHeader>
              {!view.filters.length && (
                <EmptyContent>
                  <Button variant="outline" onClick={() => add()}>
                    New backlog item
                  </Button>
                </EmptyContent>
              )}
            </Empty>
          )}
          {groupsByLane.map(({ lane, groups }) => (
            <section
              key={lane.key}
              className="backlog-swimlane"
              data-focus-scope
              aria-label={lane.label || "Backlog items"}
            >
              {lane.kind === "project" && (
                <button
                  className="backlog-swimlane-header"
                  aria-expanded={!collapsed.has(lane.key)}
                  onClick={() =>
                    setCollapsed((current) => {
                      const next = new Set(current);
                      if (!next.delete(lane.key)) next.add(lane.key);
                      return next;
                    })
                  }
                >
                  {collapsed.has(lane.key) ? (
                    <RiArrowRightSLine className="size-4" />
                  ) : (
                    <RiArrowDownSLine className="size-4" />
                  )}
                  {lane.label}
                  {lane.archived && <span>Archived</span>}
                  <span>{lane.items.length}</span>
                </button>
              )}
              {!collapsed.has(lane.key) && (
                <div
                  className={board ? "backlog-board" : "backlog-grouped-list"}
                >
                  {groups.map((group, column) => {
                    const key = `${lane.key}/${group.key}`;
                    return (
                      <section
                        key={group.key}
                        aria-label={group.label}
                        ref={(el) => {
                          if (el) drag.groupRefs.current.set(key, el);
                          else drag.groupRefs.current.delete(key);
                        }}
                        className={cn(
                          board ? "backlog-board-column" : "backlog-list-group",
                          drag.drag?.targetKey === key && "is-drop-target",
                        )}
                      >
                        {group.kind !== "all" && (
                          <div className="backlog-group-header">
                            {group.kind === "state" && (
                              <span
                                className="backlog-state-dot"
                                style={stateDotStyle(
                                  group.color,
                                  stateFills.get(group.workflowStateId ?? ""),
                                )}
                              />
                            )}
                            {group.kind === "priority" && (
                              <PriorityIcon
                                priority={group.priority}
                                decorative
                              />
                            )}
                            <h2>{group.label}</h2>
                            {group.kind === "project" && group.archived && (
                              <span className="text-muted-foreground">
                                Archived
                              </span>
                            )}
                            <span className="backlog-group-count">
                              {group.items.length}
                            </span>
                            {!(group.kind === "state" && group.done) &&
                              canUseProjectGroup(group, state) &&
                              canUseProjectGroup(lane, state) && (
                                <TooltipButton
                                  label={`New item in ${group.label}`}
                                  render={
                                    <Button variant="ghost" size="icon-sm" />
                                  }
                                  onClick={() => add(group, lane)}
                                >
                                  <RiAddLine />
                                </TooltipButton>
                              )}
                          </div>
                        )}
                        <div
                          role="list"
                          className={board ? "backlog-column-items" : ""}
                        >
                          {group.items.map((item) => (
                            <div
                              key={item._id}
                              ref={(el) => {
                                if (el) drag.rowRefs.current.set(item._id, el);
                                else drag.rowRefs.current.delete(item._id);
                              }}
                              className={cn(
                                drag.drag?.itemId === item._id && "opacity-30",
                                dropMark?.itemId === item._id &&
                                  (dropMark.edge === "before"
                                    ? "backlog-drop-before"
                                    : "backlog-drop-after"),
                              )}
                            >
                              <BacklogItemSurface
                                alwaysLive={narrow}
                                item={item}
                                state={state}
                                view={view}
                                icons={icons}
                                board={board}
                                column={board ? column : 0}
                                now={now}
                                selected={
                                  item._id === peekId ||
                                  selection.ids.includes(item._id)
                                }
                                selectionMenu={selectionMenuFor(item)}
                                beforeChange={async () => {
                                  if (!(await leaveDraft())) return false;
                                  closeEditor();
                                  return true;
                                }}
                                onSelect={(event) => void select(item, event)}
                                onOpen={() => openPage(item)}
                                onAction={(id) => action(item, id)}
                                onKeyDown={(e) => itemKeys(item, group, e)}
                                onPointerDown={
                                  drag.canDrag(item._id, key)
                                    ? (e) => drag.pointerDown(item._id, key, e)
                                    : undefined
                                }
                              />
                            </div>
                          ))}
                          {board && group.items.length === 0 && (
                            <p className="backlog-column-empty">No items</p>
                          )}
                        </div>
                        {/* Grouped views add from each group header. An
                            ungrouped view has no header, so it ends with a
                            row that adds instead. */}
                        {group.kind === "all" &&
                          canUseProjectGroup(lane, state) && (
                            <button
                              type="button"
                              className="backlog-add-row"
                              onClick={() => add(group, lane)}
                            >
                              <RiAddLine aria-hidden />
                              New backlog item
                            </button>
                          )}
                      </section>
                    );
                  })}
                </div>
              )}
            </section>
          ))}
        </div>
      </div>
      {/* The peek reads an item beside the list; editing and creating open
          the composer dialog at every width, as Linear's new issue: no side
          panel for a form (forms council round 8). */}
      {!narrow && !target && peek && (
        <SidePanel
          contentKey={`peek:${peekId}`}
          widthKey="backlog"
          className="backlog-side-panel"
          aria-label="Backlog item peek"
        >
          <BacklogPeek
            item={peek}
            state={state}
            now={now}
            returnNotice={peekReturnNotice}
            onClose={closePeek}
            onOpen={() => openPage(peek)}
            onAction={(id) => action(peek, id)}
            onSelect={select}
          />
        </SidePanel>
      )}
      {target && (
        <Dialog
          open
          // Floating on a wide window: the list stays live behind it.
          modal={narrow}
          disablePointerDismissal
          onOpenChange={(open) => {
            if (!open) closeEditor();
          }}
        >
          <DialogContent
            className={cn(
              "max-w-xl narrow:w-[calc(100%-1rem)] narrow:max-w-[calc(100%-1rem)]",
              !narrow && "composer-floating",
            )}
            overlay={narrow}
            showCloseButton={false}
            // Off the edited row, so it stays readable while it is edited;
            // placed once per item, not on every render of the page.
            ref={(popup: HTMLDivElement | null) => {
              if (narrow) return;
              const itemId =
                target.kind === "edit" ? target.workItem._id : undefined;
              placeFloatingComposerFor(popup, itemId ?? "new", () =>
                itemId
                  ? document.querySelector(
                      `.backlog-workspace [data-work-item-id="${CSS.escape(itemId)}"]`,
                    )
                  : null,
              );
            }}
          >
            {editorForm(DialogTitle)}
          </DialogContent>
        </Dialog>
      )}
      {drag.drag && dragged && (
        <div
          className="backlog-move-preview"
          aria-hidden="true"
          style={{
            width: drag.drag.width,
            minHeight: drag.drag.height,
            transform: `translate3d(${drag.drag.x - drag.drag.offsetX}px,${drag.drag.y - drag.drag.offsetY}px,0)`,
          }}
        >
          {dragged.title}
        </div>
      )}
    </div>
  );
}
