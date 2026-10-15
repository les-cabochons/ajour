import {
  memo,
  useCallback,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import { useNavigate, useRouter } from "@tanstack/react-router";
import {
  RiArrowDownSLine as ChevronDown,
  RiArrowGoBackLine as UndoIcon,
  RiCheckLine as SettleIcon,
  RiCornerLeftUpLine as ParentIcon,
  RiPlayLine as PlayIcon,
  RiPushpinLine as PinIcon,
  RiStopLine as StopIcon,
  RiTimeLine as SnoozeIcon,
} from "@remixicon/react";
import { ObjectContextMenu } from "@/components/object-actions-menu";
import { TooltipButton } from "@/components/tooltip-button";
import { Value } from "@/components/ui/value";
import {
  getBacklogItemActions,
  type BacklogItemActionId,
} from "@/domain/actions/object-actions";
import {
  isBacklogItemReturned,
  isBacklogItemSnoozed,
  selectSidebarBacklogItems,
} from "@/domain/backlog/backlog-item-lifecycle";
import {
  getDirectChildWorkItems,
  getWorkItemLookupKeys,
  getWorkItemParentKey,
  isSubtaskWorkItem,
} from "@/domain/backlog/work-item-hierarchy";
import type { SidebarMatcher } from "@/domain/backlog/sidebar-filter";
import {
  getLocalProjectDisplayName,
  type LocalAppState,
  type LocalProject,
  type LocalWorkItem,
  type LocalWorkflowState,
} from "@/domain/local-state";
import { formatCompactDuration } from "@/domain/time/duration";
import { findWorkItemTimer } from "@/domain/time/running-entry";
import { settleOpensDialog } from "@/features/backlog/settle-dialog";
import { runBacklogItemAction } from "@/features/backlog/backlog-item-actions";
import { getBacklogItemOriginFor } from "@/features/backlog/backlog-item-search";
import {
  getBacklogDropOrder,
  useBacklogDrag,
  type BacklogDropTarget,
} from "@/features/backlog/use-backlog-drag";
import { offerUndo } from "@/features/feedback/undo-toast";
import { formatSnoozeTime } from "@/features/backlog/snooze-presets";
import {
  WorkItemIcon,
  resolveWorkItemIcon,
  useWorkItemIconData,
} from "@/features/backlog/work-item-icons";
import {
  BACKLOG_ITEM_ACTION_KEYS,
  BACKLOG_ITEM_ROW_KEYS,
  OPEN_BACKLOG_ITEM_ACTION,
  handleItemKeyDown,
} from "@/lib/item-keys";
import { useLocalState } from "@/lib/local-hooks";
import { localStore } from "@/lib/local-store";
import { ProjectIcon } from "@/lib/project-icons";
import {
  formatAriaKeyShortcuts,
  getShortcut,
  getShortcutPlatform,
  type ShortcutActionId,
} from "@/lib/shortcuts";
import { openModifiedSourceClick } from "@/lib/source-navigation";
import { updateSidebarLayout, useSidebarLayout } from "@/lib/sidebar-layout";
import { useHoverOrFocusWithin } from "@/lib/use-hover-or-focus-within";
import { useNow } from "@/lib/use-now";
import { getSharedTableStepOrder } from "@/lib/table-drag";
import { cn } from "@/lib/utils";
import { getOtherSourceStates } from "@/features/backlog/backlog-item-moves";

const SETTLED_PAGE_SIZE = 20;

type IconData = ReturnType<typeof useWorkItemIconData>;

/**
 * Under Custom ordering, pinned items and the rest reorder apart: a drag or
 * Move up and Move down stays in its block. The keys put each block in its
 * own drag lane.
 */
const PINNED_BLOCK = "pinned/items";
const LISTED_BLOCK = "listed/items";

function getBlockKey(workItem: LocalWorkItem) {
  return workItem.pinnedAt !== undefined ? PINNED_BLOCK : LISTED_BLOCK;
}

function getReorderBlocks(
  listed: readonly LocalWorkItem[],
): BacklogDropTarget[] {
  return [PINNED_BLOCK, LISTED_BLOCK].map((key) => ({
    key,
    itemIds: listed
      .filter((workItem) => getBlockKey(workItem) === key)
      .map((workItem) => workItem._id),
  }));
}

/**
 * Where the dragged row would land, for the drop line: before the row that
 * would follow it, or after the block's last row. Undefined when the drop
 * changes nothing.
 */
function getDropMark(
  drag: ReturnType<typeof useBacklogDrag>["drag"],
  blocks: readonly BacklogDropTarget[],
  canReorder: (itemId: string) => boolean,
): { itemId: string; edge: "before" | "after" } | undefined {
  const block = blocks.find((target) => target.key === drag?.targetKey);
  if (!drag || !block) return undefined;
  const order = getBacklogDropOrder(
    block.itemIds,
    drag.itemId,
    drag.index,
    drag.originKey === drag.targetKey,
    canReorder,
  );
  if (!order) return undefined;
  const next = order[order.indexOf(drag.itemId) + 1];
  return next
    ? { itemId: next, edge: "before" }
    : { itemId: block.itemIds.at(-1)!, edge: "after" };
}

function offerReorderUndo(orderedIds: string[]) {
  offerUndo(localStore.reorderWorkItemsWithUndo(orderedIds), {
    title: "Backlog item reordered",
    subject: "backlog item",
  });
}

function countSubitems(
  workItem: LocalWorkItem,
  workItems: readonly LocalWorkItem[],
) {
  return isSubtaskWorkItem(workItem)
    ? 0
    : getDirectChildWorkItems(workItem, workItems).length;
}

/** The list's reorder state that rows read when a key or a press asks. */
interface RowReorder {
  blocks: readonly BacklogDropTarget[];
  canReorder: (itemId: string) => boolean;
  drag: ReturnType<typeof useBacklogDrag>;
}

/**
 * What a row can do: actions, keys, navigation and reordering for one backlog
 * item. The rows are memoized, so this is one object for the life of the list
 * that reads the latest list, time and drag when a row asks.
 */
function useBacklogItemRow(
  state: LocalAppState,
  now: number,
  reorder: RowReorder,
) {
  const navigate = useNavigate();
  const router = useRouter();
  const latest = useRef({ state, now, reorder });
  latest.current = { state, now, reorder };

  return useMemo(() => {
    // The item page remembers the page it was opened from, so Time or
    // Projects stays selected and its back link returns there.
    function from() {
      return getBacklogItemOriginFor(router.state.location);
    }

    function open(workItem: LocalWorkItem) {
      void navigate({
        to: "/backlog/$itemId",
        params: { itemId: workItem._id },
        search: { from: from() },
      });
    }

    /** The list passes `subitemCount` when it has counted, so a row does not count again. */
    function actionsFor(workItem: LocalWorkItem, subitemCount?: number) {
      const { state, now } = latest.current;
      return getBacklogItemActions(workItem, {
        isRunning: Boolean(findWorkItemTimer(state.timers, workItem._id)),
        isSubitem: isSubtaskWorkItem(workItem),
        isSnoozed: isBacklogItemSnoozed(workItem, now),
        subitemCount: subitemCount ?? countSubitems(workItem, state.workItems),
        settleOpensDialog: settleOpensDialog(workItem),
        otherSourceStateCount: getOtherSourceStates(workItem).length,
      });
    }

    function run(
      workItem: LocalWorkItem,
      actionId: BacklogItemActionId,
      options?: { askToSettle?: boolean },
    ) {
      const action = actionsFor(workItem).find((item) => item.id === actionId);
      if (!action || action.disabledReason) return;

      // Edit and Add subitem open the editor on the item's page.
      runBacklogItemAction(
        workItem,
        actionId,
        (hosted) =>
          navigate({
            to: "/backlog/$itemId",
            params: { itemId: workItem._id },
            search: { action: hosted, from: from() },
          }),
        options,
      );
    }

    function canReorder(workItem: LocalWorkItem) {
      return latest.current.reorder.canReorder(workItem._id);
    }

    /** Move up (-1) or Move down (1) within the item's block, with Undo. */
    function step(workItem: LocalWorkItem, direction: -1 | 1) {
      const { blocks, canReorder } = latest.current.reorder;
      const block = blocks.find(
        (target) => target.key === getBlockKey(workItem),
      );
      const next =
        block &&
        getSharedTableStepOrder(
          block.itemIds.filter(canReorder),
          workItem._id,
          direction,
        );
      if (next) offerReorderUndo(next.order);
    }

    function pointerDown(
      workItem: LocalWorkItem,
      event: PointerEvent<HTMLElement>,
    ) {
      const { drag } = latest.current.reorder;
      const key = getBlockKey(workItem);
      if (drag.canDrag(workItem._id, key))
        drag.pointerDown(workItem._id, key, event);
    }

    /** False right after a drag, so its release does not open the row. */
    function clickAllowed() {
      return latest.current.reorder.drag.clickAllowed();
    }

    return {
      open,
      actionsFor,
      run,
      canReorder,
      step,
      pointerDown,
      clickAllowed,
    };
  }, [navigate, router]);
}

type RowApi = ReturnType<typeof useBacklogItemRow>;
type RowActionList = ReturnType<RowApi["actionsFor"]>;

const platform = getShortcutPlatform();

/**
 * A row's hover action: Start entry, Snooze… or Settle. It has no tooltip; the
 * icons are familiar and a tooltip on every hover would cover the list.
 * `label` is the accessible name and `shortcut` its key, as on `TooltipButton`.
 */
function RowActionButton({
  label,
  shortcut,
  ...props
}: ComponentProps<"button"> & { label: string; shortcut?: ShortcutActionId }) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-keyshortcuts={
        shortcut
          ? formatAriaKeyShortcuts(getShortcut(shortcut), platform)
          : undefined
      }
      {...props}
    />
  );
}

/** Row icon buttons: hover only darkens the icon, with no background. */
const iconButton =
  "flex size-6 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground";

/**
 * Hover and focus swap the type icon for the settle circle, which mounts only
 * while the row is `revealed`. Shift asks first.
 */
function LeadingIcon({
  workItem,
  iconData,
  rows,
  revealed,
}: {
  workItem: LocalWorkItem;
  iconData: IconData;
  rows: RowApi;
  revealed: boolean;
}) {
  return (
    <span
      className="relative flex size-4 shrink-0 items-center justify-center"
      onClick={(event) => event.stopPropagation()}
    >
      <span className="flex group-focus-within:hidden group-hover:hidden">
        <WorkItemIcon icon={resolveWorkItemIcon(workItem, iconData)} />
      </span>
      {revealed ? (
        <RowActionButton
          label="Settle"
          shortcut="item.settle"
          className="hidden size-4 rounded-full border-[1.5px] border-foreground/50 group-focus-within:flex group-hover:flex hover:border-foreground"
          onClick={(event) =>
            rows.run(workItem, "settle", { askToSettle: event.shiftKey })
          }
        />
      ) : null}
    </span>
  );
}

/**
 * Start entry, or Stop on the item whose entry is running. The Compact row
 * shows it among its hover actions; the Comfortable row shows it on its own,
 * centered at the row's end.
 */
function StartButton({
  workItem,
  actions,
  rows,
  className,
}: {
  workItem: LocalWorkItem;
  actions: RowActionList;
  rows: RowApi;
  className?: string;
}) {
  if (actions.some((action) => action.id === "stop-entry")) {
    return (
      <RowActionButton
        label="Stop"
        shortcut="entry.stop-or-start"
        className={cn(iconButton, className)}
        onClick={() => rows.run(workItem, "stop-entry")}
      >
        <StopIcon className="size-3.5" />
      </RowActionButton>
    );
  }

  const disabledReason = actions.find(
    (action) => action.id === "start-entry",
  )?.disabledReason;
  return (
    <RowActionButton
      label="Start entry"
      shortcut="entry.stop-or-start"
      aria-description={disabledReason}
      aria-disabled={Boolean(disabledReason)}
      className={cn(iconButton, "aria-disabled:opacity-50", className)}
      onClick={() => {
        if (!disabledReason) rows.run(workItem, "start-entry");
      }}
    >
      <PlayIcon className="size-3.5" />
    </RowActionButton>
  );
}

/**
 * Start entry (unless `showStart` is off), Snooze… and, with `showSettle`, a
 * labeled Settle button. They replace the row's end on hover and focus. Right-click
 * opens the full action set, so the rows have no "…" button.
 * `buttonClassName` resizes the icon buttons to fit the line they sit on.
 */
function RowActions({
  workItem,
  actions,
  rows,
  showStart = true,
  showSettle = false,
  buttonClassName,
  className,
}: {
  workItem: LocalWorkItem;
  actions: RowActionList;
  rows: RowApi;
  showStart?: boolean;
  showSettle?: boolean;
  buttonClassName?: string;
  className?: string;
}) {
  return (
    <div
      className={cn("items-center gap-0.5", className)}
      onClick={(event) => event.stopPropagation()}
    >
      {showStart ? (
        <StartButton
          workItem={workItem}
          actions={actions}
          rows={rows}
          className={buttonClassName}
        />
      ) : null}
      <RowActionButton
        label="Snooze…"
        shortcut="item.snooze"
        className={cn(iconButton, buttonClassName)}
        onClick={() => rows.run(workItem, "snooze")}
      >
        <SnoozeIcon className="size-3.5" />
      </RowActionButton>
      {showSettle ? (
        <RowActionButton
          label="Settle"
          shortcut="item.settle"
          className="flex h-5 shrink-0 items-center gap-1 rounded-sm px-1 text-xs text-muted-foreground hover:text-foreground"
          onClick={(event) =>
            rows.run(workItem, "settle", { askToSettle: event.shiftKey })
          }
        >
          <SettleIcon className="size-3.5" />
          Settle
        </RowActionButton>
      ) : null}
    </div>
  );
}

function Markers({
  workItem,
  isRunning,
  isReturned,
}: {
  workItem: LocalWorkItem;
  isRunning: boolean;
  isReturned: boolean;
}) {
  return (
    <>
      {workItem.pinnedAt !== undefined ? (
        <PinIcon
          className="size-3.5 shrink-0 text-muted-foreground"
          role="img"
          aria-label="Pinned"
        />
      ) : null}
      {isRunning ? (
        <span
          className="relative flex size-2 shrink-0"
          role="img"
          aria-label="Running entry"
        >
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-[var(--success)] opacity-60 motion-reduce:hidden" />
          <span className="relative inline-flex size-2 rounded-full bg-[var(--success)]" />
        </span>
      ) : null}
      {isReturned ? (
        <TooltipButton
          label="Returned. Click to clear"
          aria-label={`Clear the returned mark on ${workItem.title}`}
          className="flex size-4 shrink-0 items-center justify-center"
          onClick={(event) => {
            event.stopPropagation();
            localStore.markWorkItemOpened(workItem._id);
          }}
        >
          <span className="size-2 rounded-full bg-foreground" />
        </TooltipButton>
      ) : null}
    </>
  );
}

interface ItemRowProps {
  workItem: LocalWorkItem;
  /** The subitem's parent, when it is in the workspace. */
  parent?: LocalWorkItem;
  subitemCount: number;
  project?: LocalProject;
  workflowState?: LocalWorkflowState;
  isActive: boolean;
  isRunning: boolean;
  isReturned: boolean;
  iconData: IconData;
  rows: RowApi;
}

/**
 * Click, modified click, keys, drag and the context menu, shared by the item
 * rows. Under Custom ordering, dragging a row or Alt+Up and Alt+Down move it.
 */
function useItemRowHandlers({ workItem, subitemCount, rows }: ItemRowProps) {
  const actions = rows.actionsFor(workItem, subitemCount);
  return {
    actions,
    onClick: (event: MouseEvent<HTMLElement>) => {
      if (!rows.clickAllowed()) return;
      if (!openModifiedSourceClick(event, workItem.sourceUrl))
        rows.open(workItem);
    },
    onPointerDown: (event: PointerEvent<HTMLElement>) =>
      rows.pointerDown(workItem, event),
    onKeyDown: (event: KeyboardEvent<HTMLElement>) =>
      handleItemKeyDown(event, {
        actions: [...actions, OPEN_BACKLOG_ITEM_ACTION],
        keys: BACKLOG_ITEM_ROW_KEYS,
        onAction: (actionId, { shortcutId }) =>
          actionId === "open"
            ? rows.open(workItem)
            : rows.run(workItem, actionId, {
                askToSettle: shortcutId === "item.settle-ask",
              }),
        onReorder: rows.canReorder(workItem)
          ? (direction) => rows.step(workItem, direction)
          : undefined,
      }),
  };
}

/**
 * The arrow at the end of a subitem's state line. It opens the parent and its
 * tooltip names it. Like the other hover controls, the button and its tooltip
 * mount only while the row is `revealed`; until then it is a plain icon.
 */
function ParentLink({
  parent,
  rows,
  revealed,
}: {
  parent: LocalWorkItem;
  rows: RowApi;
  revealed: boolean;
}) {
  const className =
    "ml-auto flex size-4 shrink-0 items-center justify-center rounded-sm";
  const icon = <ParentIcon className="size-3" />;
  if (!revealed) {
    return (
      <span aria-hidden className={className}>
        {icon}
      </span>
    );
  }
  return (
    <TooltipButton
      label={parent.title}
      aria-label={`Open parent: ${parent.title}`}
      className={cn(className, "hover:text-foreground")}
      onClick={(event) => {
        event.stopPropagation();
        rows.open(parent);
      }}
    >
      {icon}
    </TooltipButton>
  );
}

/**
 * The Comfortable row, laid out like a T3 Code thread: the project's icon and
 * name over the title, with the markers and the remaining estimate at the end
 * of the project line, then the workflow state on a faint third line, which ends with
 * an arrow to the parent on a subitem. Hover and focus replace the end of the
 * project line with Snooze… and Settle, and show Start entry centered at the
 * row's end. Like the compact row, it re-renders for its own
 * props only and mounts its hover controls while hovered or focused.
 */
const ComfortableItemRow = memo(function ComfortableItemRow(
  props: ItemRowProps,
) {
  const { workItem, parent, project, workflowState, isActive, rows } = props;
  const remainingHours = workItem.remainingEstimateHours;
  const { actions, onClick, onPointerDown, onKeyDown } =
    useItemRowHandlers(props);
  const reveal = useHoverOrFocusWithin();

  return (
    <ObjectContextMenu
      actions={actions}
      keys={BACKLOG_ITEM_ACTION_KEYS}
      onAction={(actionId) => rows.run(workItem, actionId)}
      render={
        <div
          role="link"
          tabIndex={0}
          data-focus-column="0"
          data-backlog-item-id={workItem._id}
          aria-current={isActive ? "page" : undefined}
          {...reveal.props}
          className={cn(
            "group relative flex h-20 shrink-0 cursor-pointer items-center rounded-md px-2.5 outline-none hover:bg-foreground/5 focus-visible:bg-foreground/5 focus-visible:ring-1 focus-visible:ring-ring",
            isActive && "bg-foreground/[0.07]",
          )}
          onClick={onClick}
          onPointerDown={onPointerDown}
          onKeyDown={onKeyDown}
        />
      }
    >
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex h-5 items-center gap-1.5 text-sm text-muted-foreground">
          {project ? (
            <ProjectIcon
              icon={project.icon}
              color={project.color}
              className="ajour-sidebar-icon shrink-0"
            />
          ) : null}
          <span className="min-w-0 flex-1 truncate">
            {project ? getLocalProjectDisplayName(project) : "No project"}
          </span>
          <span className="flex shrink-0 items-center gap-1.5 group-focus-within:hidden group-hover:hidden">
            <Markers
              workItem={workItem}
              isRunning={props.isRunning}
              isReturned={props.isReturned}
            />
            {remainingHours !== undefined ? (
              <Value tone="muted">
                {formatCompactDuration(remainingHours * 3_600_000)}
              </Value>
            ) : null}
          </span>
          {reveal.active ? (
            <RowActions
              workItem={workItem}
              actions={actions}
              rows={rows}
              showStart={false}
              showSettle
              buttonClassName="size-5"
              className="hidden group-focus-within:flex group-hover:flex"
            />
          ) : null}
        </span>
        {/*
          The padding clears Start entry, which sits over the end of this line
          on hover. It stays when the row is at rest, so hovering never
          re-truncates the title.
        */}
        <span
          data-row-title
          className={cn(
            "truncate pr-7 text-base leading-5",
            props.isReturned && "font-semibold",
          )}
        >
          {workItem.title}
        </span>
        {/* Kept empty without a state, so every row is the same height. */}
        <span className="flex h-4 items-center gap-1.5 text-xs text-[var(--text-tertiary)]">
          {workflowState ? (
            <>
              <span
                className="backlog-state-dot size-2.5"
                style={{ color: workflowState.color }}
              />
              <span className="min-w-0 truncate">{workflowState.name}</span>
            </>
          ) : null}
          {parent ? (
            <ParentLink parent={parent} rows={rows} revealed={reveal.active} />
          ) : null}
        </span>
      </span>
      {/*
        Logging time is the main job, so Start gets its own place: centered at
        the row's end, level with the title, so the project line's Snooze and
        Settle still reach the edge.
      */}
      {reveal.active ? (
        <span
          className="absolute top-1/2 right-2.5 hidden -translate-y-1/2 group-focus-within:flex group-hover:flex"
          onClick={(event) => event.stopPropagation()}
        >
          <StartButton workItem={workItem} actions={actions} rows={rows} />
        </span>
      ) : null}
    </ObjectContextMenu>
  );
});

/**
 * The Compact row, one line: the type icon, the title, then the markers. A
 * subitem shows its parent after its title. A row re-renders for its own
 * props only, and its hover controls mount while it is hovered or focused: a
 * set of action buttons for every row is most of the cost of a long list.
 */
const BacklogItemRow = memo(function BacklogItemRow(props: ItemRowProps) {
  const { workItem, parent, isActive, iconData, rows } = props;
  const parentTitle = parent?.title;
  const { actions, onClick, onPointerDown, onKeyDown } =
    useItemRowHandlers(props);
  const reveal = useHoverOrFocusWithin();

  return (
    <ObjectContextMenu
      actions={actions}
      keys={BACKLOG_ITEM_ACTION_KEYS}
      onAction={(actionId) => rows.run(workItem, actionId)}
      render={
        <div
          role="link"
          tabIndex={0}
          data-focus-column="0"
          data-backlog-item-id={workItem._id}
          aria-current={isActive ? "page" : undefined}
          title={parentTitle ? `${workItem.title} · ${parentTitle}` : undefined}
          {...reveal.props}
          className={cn(
            "group flex h-[26px] shrink-0 cursor-pointer items-center gap-2 rounded-md px-2 text-sm outline-none hover:bg-foreground/5 focus-visible:bg-foreground/5 focus-visible:ring-1 focus-visible:ring-ring",
            isActive && "bg-foreground/[0.07]",
          )}
          onClick={onClick}
          onPointerDown={onPointerDown}
          onKeyDown={onKeyDown}
        />
      }
    >
      <LeadingIcon
        workItem={workItem}
        iconData={iconData}
        rows={rows}
        revealed={reveal.active}
      />
      <span
        className={cn(
          "min-w-0 flex-1 truncate",
          props.isReturned && "font-semibold",
        )}
      >
        <span data-row-title>{workItem.title}</span>
        {parentTitle ? (
          <span className="font-normal text-muted-foreground">
            {" "}
            · {parentTitle}
          </span>
        ) : null}
      </span>
      <span className="flex shrink-0 items-center gap-1.5 group-focus-within:hidden group-hover:hidden">
        <Markers
          workItem={workItem}
          isRunning={props.isRunning}
          isReturned={props.isReturned}
        />
      </span>
      {reveal.active ? (
        <RowActions
          workItem={workItem}
          actions={actions}
          rows={rows}
          className="hidden group-focus-within:flex group-hover:flex"
        />
      ) : null}
    </ObjectContextMenu>
  );
});

/** A collapsible section label: "Backlog 11", "Snoozed 3", "Settled". */
export function SidebarSectionHeader({
  label,
  count,
  open,
  onToggle,
}: {
  label: string;
  count?: number;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      aria-expanded={open}
      onClick={onToggle}
      className="flex w-full shrink-0 items-center gap-1 rounded-md px-2 pt-3 pb-1 text-left text-xs font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
    >
      <ChevronDown
        className={cn(
          "size-3.5 transition-transform motion-reduce:transition-none",
          !open && "-rotate-90",
        )}
      />
      {label}
      {count !== undefined ? (
        <span className="font-normal tabular-nums">{count}</span>
      ) : null}
    </button>
  );
}

const OffListRow = memo(function OffListRow({
  workItem,
  detail,
  restoreLabel,
  restoreAction,
  iconData,
  rows,
}: {
  workItem: LocalWorkItem;
  detail?: string;
  restoreLabel: string;
  restoreAction: BacklogItemActionId;
  iconData: IconData;
  rows: RowApi;
}) {
  const reveal = useHoverOrFocusWithin();

  return (
    <div
      role="link"
      tabIndex={0}
      data-focus-column="0"
      data-backlog-item-id={workItem._id}
      className="group flex h-7 shrink-0 cursor-pointer items-center gap-2 rounded-md px-2 text-sm text-muted-foreground outline-none hover:bg-foreground/5 focus-visible:ring-1 focus-visible:ring-ring"
      {...reveal.props}
      onClick={(event) => {
        if (!openModifiedSourceClick(event, workItem.sourceUrl))
          rows.open(workItem);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" && event.target === event.currentTarget) {
          rows.open(workItem);
        }
      }}
    >
      <WorkItemIcon
        icon={resolveWorkItemIcon(workItem, iconData)}
        className="opacity-70"
      />
      <span data-row-title className="min-w-0 flex-1 truncate">
        {workItem.title}
      </span>
      {detail ? (
        <span className="shrink-0 text-xs group-focus-within:hidden group-hover:hidden">
          {detail}
        </span>
      ) : null}
      {reveal.active ? (
        <span
          className="hidden group-focus-within:flex group-hover:flex"
          onClick={(event) => event.stopPropagation()}
        >
          <TooltipButton
            label={restoreLabel}
            className={iconButton}
            onClick={() => rows.run(workItem, restoreAction)}
          >
            <UndoIcon className="size-3.5" />
          </TooltipButton>
        </span>
      ) : null}
    </div>
  );
});

/**
 * The work list in the expanded app sidebar, from "Backlog sidebar" in
 * agents/ux-spec.md: the active items in the Backlog page's order with no
 * header, pinned items first, `children` (the Pull requests section), then
 * the collapsible Snoozed and Settled sections. Every section keeps only the
 * rows `matcher` accepts, and its count follows. Empty sections are not shown.
 */
export function SidebarBacklogList({
  pathname,
  matcher,
  children,
}: {
  pathname: string;
  matcher: SidebarMatcher;
  children?: ReactNode;
}) {
  const state = useLocalState();
  const now = useNow();
  const layout = useSidebarLayout();
  const iconData = useWorkItemIconData(state.projects);
  const [settledShown, setSettledShown] = useState(SETTLED_PAGE_SIZE);
  const activeItemId = pathname.startsWith("/backlog/")
    ? decodeURIComponent(pathname.slice("/backlog/".length))
    : undefined;
  const runningWorkItemId = state.timers[0]?.workItemId;

  const { listed, snoozed, settled, workItemByLookupKey } = useMemo(() => {
    const byLookupKey = new Map(
      state.workItems.flatMap((workItem) =>
        getWorkItemLookupKeys(workItem).map((key) => [key, workItem] as const),
      ),
    );
    return {
      listed: selectSidebarBacklogItems(state, now).filter(matcher.workItem),
      snoozed: state.workItems
        .filter(
          (workItem) =>
            isBacklogItemSnoozed(workItem, now) && matcher.workItem(workItem),
        )
        .sort((left, right) => left.snoozedUntil! - right.snoozedUntil!),
      // Subitems settled along with their parent show on the parent's page.
      settled: state.workItems
        .filter(
          (workItem) =>
            workItem.status === "settled" &&
            !workItem.settledWithParentId &&
            matcher.workItem(workItem),
        )
        .sort((left, right) => (right.settledAt ?? 0) - (left.settledAt ?? 0)),
      workItemByLookupKey: byLookupKey,
    };
  }, [state, now, matcher]);

  const custom = state.backlogSortMode === "custom";
  const blocks = useMemo(() => getReorderBlocks(listed), [listed]);
  // Subitems sit under their parent, so only top-level items move.
  const canReorder = useCallback(
    (itemId: string) => {
      const workItem = state.workItems.find((item) => item._id === itemId);
      return custom && Boolean(workItem && !isSubtaskWorkItem(workItem));
    },
    [custom, state.workItems],
  );
  const drag = useBacklogDrag({
    targets: blocks,
    canReorder,
    disabled: !custom,
    onDrop: (_itemId, _key, order) => {
      if (order) offerReorderUndo(order);
    },
  });
  const dropMark = getDropMark(drag.drag, blocks, canReorder);
  const rows = useBacklogItemRow(state, now, { blocks, canReorder, drag });

  // Apart from the list above so the clock does not rebuild them every minute.
  const projectById = useMemo(
    () => new Map(state.projects.map((project) => [project._id, project])),
    [state.projects],
  );
  const workflowStateById = useMemo(
    () => new Map(state.workflowStates.map((status) => [status._id, status])),
    [state.workflowStates],
  );

  const parentOf = (workItem: LocalWorkItem) => {
    const key = getWorkItemParentKey(workItem);
    return key ? workItemByLookupKey.get(key) : undefined;
  };
  const rowProps = (workItem: LocalWorkItem): ItemRowProps => ({
    workItem,
    parent: parentOf(workItem),
    subitemCount: countSubitems(workItem, state.workItems),
    project: workItem.projectId
      ? projectById.get(workItem.projectId)
      : undefined,
    workflowState: workItem.workflowStateId
      ? workflowStateById.get(workItem.workflowStateId)
      : undefined,
    isActive: activeItemId === workItem._id,
    isRunning: runningWorkItemId === workItem._id,
    isReturned: isBacklogItemReturned(workItem, now),
    iconData,
    rows,
  });
  const ItemRow =
    layout.density === "comfortable" ? ComfortableItemRow : BacklogItemRow;
  const listedById = new Map(
    listed.map((workItem) => [workItem._id, workItem]),
  );
  const draggedItem = drag.drag ? listedById.get(drag.drag.itemId) : undefined;

  let settledRows: ReactNode = null;
  if (layout.settledOpen) {
    settledRows = (
      <>
        {settled.slice(0, settledShown).map((workItem) => (
          <OffListRow
            key={workItem._id}
            workItem={workItem}
            detail={
              layout.density === "comfortable"
                ? workItem.sourceStatusLabel
                : undefined
            }
            restoreLabel="Unsettle"
            restoreAction="unsettle"
            iconData={iconData}
            rows={rows}
          />
        ))}
        {settled.length > settledShown ? (
          <button
            type="button"
            className="px-2 py-1 text-left text-xs text-muted-foreground hover:text-foreground"
            onClick={() => setSettledShown(settledShown + SETTLED_PAGE_SIZE)}
          >
            Show more
          </button>
        ) : null}
      </>
    );
  }

  return (
    <div
      className="flex min-h-0 flex-1 flex-col overflow-y-auto px-2 pb-2 scrollbar-on-hover"
      aria-label="Backlog items"
      data-focus-scope
    >
      {/*
        The backlog items have no header, like T3 Code's thread list. Pinned
        items and the rest are separate blocks, so a drag stays in its own.
      */}
      <div className="flex shrink-0 flex-col pt-2">
        {blocks.map((block) => (
          <div
            key={block.key}
            ref={(element) => {
              if (element) drag.groupRefs.current.set(block.key, element);
              else drag.groupRefs.current.delete(block.key);
            }}
            className="flex flex-col"
          >
            {block.itemIds.map((itemId) => {
              const workItem = listedById.get(itemId)!;
              return (
                <div
                  key={itemId}
                  ref={(element) => {
                    if (element) drag.rowRefs.current.set(itemId, element);
                    else drag.rowRefs.current.delete(itemId);
                  }}
                  className={cn(
                    "flex flex-col",
                    drag.drag?.itemId === itemId && "opacity-30",
                    dropMark?.itemId === itemId &&
                      (dropMark.edge === "before"
                        ? "shadow-[inset_0_2px_0_var(--primary)]"
                        : "shadow-[inset_0_-2px_0_var(--primary)]"),
                  )}
                >
                  <ItemRow {...rowProps(workItem)} />
                </div>
              );
            })}
          </div>
        ))}
        {listed.length === 0 ? (
          <p className="px-2 pt-1 pb-1 text-xs text-muted-foreground">
            {matcher.active ? "No matching items." : "Nothing on your plate."}
          </p>
        ) : null}
      </div>

      {children}

      {/* A section with nothing in it is not shown. */}
      {snoozed.length > 0 ? (
        <>
          <SidebarSectionHeader
            label="Snoozed"
            count={snoozed.length}
            open={layout.snoozedOpen}
            onToggle={() =>
              updateSidebarLayout({ snoozedOpen: !layout.snoozedOpen })
            }
          />
          {layout.snoozedOpen
            ? snoozed.map((workItem) => (
                <OffListRow
                  key={workItem._id}
                  workItem={workItem}
                  detail={formatSnoozeTime(workItem.snoozedUntil!, now)}
                  restoreLabel="Unsnooze"
                  restoreAction="unsnooze"
                  iconData={iconData}
                  rows={rows}
                />
              ))
            : null}
        </>
      ) : null}

      {settled.length > 0 ? (
        <>
          <SidebarSectionHeader
            label="Settled"
            // Unfiltered, the count would be every settled item ever.
            count={matcher.active ? settled.length : undefined}
            open={layout.settledOpen}
            onToggle={() =>
              updateSidebarLayout({ settledOpen: !layout.settledOpen })
            }
          />
          {settledRows}
        </>
      ) : null}

      {draggedItem ? (
        <div
          className="backlog-move-preview"
          aria-hidden="true"
          style={{
            width: drag.drag!.width,
            transform: `translate3d(${drag.drag!.x - drag.drag!.offsetX}px,${drag.drag!.y - drag.drag!.offsetY}px,0)`,
          }}
        >
          {draggedItem.title}
        </div>
      ) : null}
    </div>
  );
}
