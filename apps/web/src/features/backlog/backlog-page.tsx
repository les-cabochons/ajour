import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  RiAddLine,
  RiArrowLeftLine,
  RiMoreLine,
  RiArrowDownSLine,
  RiArrowRightSLine,
} from "@remixicon/react";
import { useNavigate, Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { useBacklogDrag } from "@/features/backlog/use-backlog-drag";
import {
  groupBacklogItems,
  orderBacklogItems,
  selectBacklogViewItems,
  type BacklogGroup,
} from "@/domain/backlog/backlog-view";
import { getPriorityLevelName } from "@/domain/backlog/priority";
import { PriorityIcon } from "@/features/backlog/priority-icon";
import type { BacklogItemActionId } from "@/domain/actions/object-actions";
import type { LocalAppState, LocalWorkItem } from "@/domain/local-state";
import { useLocalState } from "@/lib/local-hooks";
import { localStore } from "@/lib/local-store";
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
  const state = useLocalState();
  const view = useBacklogView();
  const now = useNow();
  const narrow = useIsNarrowView();
  const navigate = useNavigate();
  const icons = useWorkItemIconData(state.projects);
  const [archive, setArchive] = useState(false);
  const [peekId, setPeekId] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorRequest | null>(null);
  const [editorSerial, setEditorSerial] = useState(0);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const editorRef = useRef<BacklogItemEditorFormHandle>(null);
  const draft = useRef<BacklogTaskEditorFields | null>(null);
  const board = !narrow && !archive && view.layout === "board";
  const grouping = board && view.grouping === "none" ? "state" : view.grouping;
  const items = useMemo(
    () =>
      orderBacklogItems(
        archive
          ? state.workItems.filter((i) => i.status === "archived")
          : selectBacklogViewItems(state, view, view.filters, {
              now,
              runningWorkItemId: state.timers[0]?.workItemId,
            }),
        state.workItems,
        state.backlogSortMode,
      ),
    [state, view, archive, now],
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
    groups: groupBacklogItems(state, lane.items, archive ? "none" : grouping, {
      keepEmpty: board,
    }),
  }));
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
  function showPeek(itemId: string) {
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
  async function select(item: LocalWorkItem) {
    if (!drag.clickAllowed() || !(await leaveDraft())) return;
    closeEditor();
    if (narrow)
      void navigate({ to: "/backlog/$itemId", params: { itemId: item._id } });
    else showPeek(item._id);
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
  function reorder(itemId: string, group: BacklogGroup, step: -1 | 1) {
    if (state.backlogSortMode !== "custom" || archive) return;
    const next = getSharedTableStepOrder(
      group.items.map((i) => i._id),
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
      if (order)
        offerUndo(localStore.reorderWorkItemsWithUndo(order), {
          title: "Backlog item reordered",
          subject: "backlog item",
        });
      return;
    }
    if (group.kind === "state")
      await moveBacklogItemWithUndo(committed, group.workflowStateId, {
        orderedIds: order ?? undefined,
      });
    if (group.kind === "priority")
      patchBacklogItemWithUndo(
        committed,
        { priority: group.priority },
        `Priority changed to ${getPriorityLevelName(group.priority)}`,
        order ?? undefined,
      );
    if (group.kind === "project")
      patchBacklogItemWithUndo(
        committed,
        { projectId: group.projectId, taskId: undefined },
        "Project changed",
        order ?? undefined,
      );
  }
  const drag = useBacklogDrag({
    targets,
    canReorder: state.backlogSortMode === "custom",
    disabled: archive || narrow,
    onDrop: (...args) => void drop(...args),
  });
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
        if (archive) return;
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
      onReorder: (step) => reorder(item._id, group, step),
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
        initialFields={initial}
        onFieldsChange={(fields) => {
          draft.current = fields;
        }}
        onClose={closeEditor}
        onAction={runCommittedAction}
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
  const dragged = state.workItems.find((i) => i._id === drag.drag?.itemId);
  return (
    <div
      className={cn(
        "backlog-page-stack backlog-workspace",
        (target || (!narrow && peek)) && !narrow && "has-side-panel",
      )}
    >
      <div className="backlog-page-main backlog-workspace-main">
        <header className="backlog-workspace-header">
          <div className="flex min-w-0 items-center gap-2">
            {archive && (
              <TooltipButton
                label="Back to backlog"
                render={<Button variant="ghost" size="icon-sm" />}
                onClick={() => setArchive(false)}
              >
                <RiArrowLeftLine className="size-4" />
              </TooltipButton>
            )}
            <h1>{archive ? "Archive" : "Backlog"}</h1>
            <span className="text-xs text-muted-foreground">
              {items.length}
            </span>
          </div>
          <div className="flex items-center gap-1">
            {!archive && !narrow && <BacklogLayoutToggle view={view} />}
            {!archive && (
              <BacklogDisplay
                view={view}
                ordering={state.backlogSortMode}
                narrow={narrow}
              />
            )}
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Backlog options"
                  />
                }
              >
                <RiMoreLine className="size-4" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onClick={async () => {
                    if (!(await leaveDraft())) return;
                    closeEditor();
                    closePeek();
                    setArchive(true);
                  }}
                >
                  Archive
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            {!archive && (
              <Button size="sm" onClick={() => add()} className="narrow:hidden">
                <RiAddLine className="size-4" />
                New backlog item
              </Button>
            )}
          </div>
        </header>
        {!archive && (
          <div className="backlog-workspace-filterbar">
            <BacklogFilters state={state} view={view} />
            {unmapped > 0 && (
              <Link
                to="/settings/workflow"
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                {unmapped} unmapped source {unmapped === 1 ? "state" : "states"}
              </Link>
            )}
          </div>
        )}
        <div
          className={cn("backlog-workspace-scroll", board && "is-board")}
          data-focus-scope
        >
          {items.length === 0 && (
            <div className="backlog-view-empty">
              <h2>
                {archive
                  ? "No archived items"
                  : view.filters.length
                    ? "No matching items"
                    : "Your backlog is empty"}
              </h2>
              <p>
                {archive
                  ? "Archived items will appear here."
                  : view.filters.length
                    ? "Change the filters to see more items."
                    : "Create a backlog item or import items from a connector."}
              </p>
              {!archive && !view.filters.length && (
                <Button variant="outline" size="sm" onClick={() => add()}>
                  New backlog item
                </Button>
              )}
            </div>
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
                                style={{ color: group.color }}
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
                              canUseProjectGroup(lane, state) &&
                              !archive && (
                                <TooltipButton
                                  label={`New item in ${group.label}`}
                                  render={
                                    <Button variant="ghost" size="icon-sm" />
                                  }
                                  onClick={() => add(group, lane)}
                                >
                                  <RiAddLine className="size-3.5" />
                                </TooltipButton>
                              )}
                          </div>
                        )}
                        <div
                          role="list"
                          className={board ? "backlog-column-items" : ""}
                        >
                          {group.items.map((item, index) => (
                            <div
                              key={item._id}
                              ref={(el) => {
                                if (el) drag.rowRefs.current.set(item._id, el);
                                else drag.rowRefs.current.delete(item._id);
                              }}
                              className={cn(
                                drag.drag?.itemId === item._id && "opacity-30",
                                drag.drag?.targetKey === key &&
                                  drag.drag.index === index &&
                                  drag.drag.itemId !== item._id &&
                                  "backlog-drop-before",
                              )}
                            >
                              <BacklogItemSurface
                                item={item}
                                state={state}
                                view={view}
                                icons={icons}
                                board={board}
                                column={board ? column : 0}
                                now={now}
                                selected={item._id === peekId}
                                beforeChange={async () => {
                                  if (!(await leaveDraft())) return false;
                                  closeEditor();
                                  return true;
                                }}
                                onSelect={() => select(item)}
                                onOpen={() => openPage(item)}
                                onAction={(id) => action(item, id)}
                                onKeyDown={(e) => itemKeys(item, group, e)}
                                onPointerDown={
                                  archive || narrow
                                    ? undefined
                                    : (e) => drag.pointerDown(item._id, key, e)
                                }
                              />
                            </div>
                          ))}
                          {board && group.items.length === 0 && (
                            <p className="backlog-column-empty">No items</p>
                          )}
                        </div>
                      </section>
                    );
                  })}
                </div>
              )}
            </section>
          ))}
        </div>
        {narrow && !archive && (
          <TooltipButton
            label="New backlog item"
            render={<Button className="backlog-narrow-add" size="icon" />}
            onClick={() => add()}
          >
            <RiAddLine className="size-5" />
          </TooltipButton>
        )}
      </div>
      {!narrow && (target || peek) && (
        <SidePanel
          contentKey={target ? `editor:${editorSerial}` : `peek:${peekId}`}
          className="backlog-side-panel"
          aria-label={target ? "Backlog item editor" : "Backlog item peek"}
        >
          {target
            ? editorForm()
            : peek && (
                <BacklogPeek
                  item={peek}
                  state={state}
                  now={now}
                  onClose={closePeek}
                  onOpen={() => openPage(peek)}
                  onAction={(id) => action(peek, id)}
                  onSelect={select}
                />
              )}
        </SidePanel>
      )}
      {narrow && target && (
        <Dialog
          open
          disablePointerDismissal
          onOpenChange={(open) => {
            if (!open) closeEditor();
          }}
        >
          <DialogContent className="max-w-xl" showCloseButton={false}>
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
