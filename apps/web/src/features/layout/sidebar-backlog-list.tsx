import { useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  RiArrowDownSLine as ChevronDown,
  RiArrowGoBackLine as UndoIcon,
  RiCheckboxCircleLine as SettleIcon,
  RiPlayLine as PlayIcon,
  RiTimeLine as SnoozeIcon,
} from "@remixicon/react";
import {
  ObjectActionsButton,
  ObjectContextMenu,
} from "@/components/object-actions-menu";
import { TooltipButton } from "@/components/tooltip-button";
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
import type { LocalAppState, LocalWorkItem } from "@/domain/local-state";
import { settleOpensDialog } from "@/features/backlog/settle-dialog";
import { runBacklogItemAction } from "@/features/backlog/backlog-item-actions";
import { formatSnoozeTime } from "@/features/backlog/snooze-presets";
import {
  WorkItemIcon,
  resolveWorkItemIcon,
  useWorkItemIconData,
} from "@/features/backlog/work-item-icons";
import { parseWorkItemReference } from "@/features/backlog/work-item-timer-comment";
import {
  BACKLOG_ITEM_ACTION_KEYS,
  BACKLOG_ITEM_ROW_KEYS,
  OPEN_BACKLOG_ITEM_ACTION,
  handleItemKeyDown,
} from "@/lib/item-keys";
import { useLocalState } from "@/lib/local-hooks";
import { localStore } from "@/lib/local-store";
import {
  updateSidebarLayout,
  useSidebarLayout,
  type SidebarDensity,
} from "@/lib/sidebar-layout";
import { useNow } from "@/lib/use-now";
import { cn } from "@/lib/utils";
import { getOtherSourceStates } from "@/features/backlog/backlog-item-moves";

const SETTLED_PAGE_SIZE = 20;

type IconData = ReturnType<typeof useWorkItemIconData>;

function formatHoursLeft(hours?: number) {
  if (hours === undefined) return undefined;
  return `${Number.isInteger(hours) ? hours : hours.toFixed(1)}h left`;
}

/** "#48213 · Active · 2.5h left", or "Local" for a manual item. */
function getMetaLine(workItem: LocalWorkItem) {
  const reference =
    workItem.source === "azure_devops"
      ? parseWorkItemReference(workItem.sourceId)
      : workItem.sourceId;
  return [
    workItem.source === "manual" ? "Local" : reference && `#${reference}`,
    workItem.sourceStatusLabel,
    formatHoursLeft(workItem.remainingEstimateHours),
  ]
    .filter(Boolean)
    .join(" · ");
}

/** Shared by every row: actions, keys and navigation for one backlog item. */
function useBacklogItemRow(state: LocalAppState, now: number) {
  const navigate = useNavigate();

  function open(workItem: LocalWorkItem) {
    void navigate({ to: "/backlog/$itemId", params: { itemId: workItem._id } });
  }

  function actionsFor(workItem: LocalWorkItem) {
    const isSubitem = isSubtaskWorkItem(workItem);
    return getBacklogItemActions(workItem, {
      isSubitem,
      isSnoozed: isBacklogItemSnoozed(workItem, now),
      subitemCount: isSubitem
        ? 0
        : getDirectChildWorkItems(workItem, state.workItems).length,
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
          search: { action: hosted },
        }),
      options,
    );
  }

  return { open, actionsFor, run };
}

type RowApi = ReturnType<typeof useBacklogItemRow>;

function RowActions({
  workItem,
  rows,
  className,
}: {
  workItem: LocalWorkItem;
  rows: RowApi;
  className?: string;
}) {
  const actions = rows.actionsFor(workItem);
  const iconButton =
    "flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-foreground/10 hover:text-foreground";

  return (
    <div
      className={cn("items-center gap-0.5", className)}
      onClick={(event) => event.stopPropagation()}
    >
      <TooltipButton
        label="Start entry"
        className={iconButton}
        onClick={() => rows.run(workItem, "start-entry")}
      >
        <PlayIcon className="size-3.5" />
      </TooltipButton>
      <TooltipButton
        label="Snooze…"
        shortcut="item.snooze"
        className={iconButton}
        onClick={() => rows.run(workItem, "snooze")}
      >
        <SnoozeIcon className="size-3.5" />
      </TooltipButton>
      <TooltipButton
        label="Settle"
        shortcut="item.settle"
        className={iconButton}
        onClick={(event) =>
          rows.run(workItem, "settle", { askToSettle: event.shiftKey })
        }
      >
        <SettleIcon className="size-3.5" />
      </TooltipButton>
      <ObjectActionsButton
        actions={actions}
        keys={BACKLOG_ITEM_ACTION_KEYS}
        onAction={(actionId) => rows.run(workItem, actionId)}
        label={`Actions for ${workItem.title}`}
        className="size-6"
      />
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

function BacklogItemRow({
  workItem,
  parentTitle,
  density,
  isActive,
  isRunning,
  isReturned,
  iconData,
  rows,
}: {
  workItem: LocalWorkItem;
  parentTitle?: string;
  density: SidebarDensity;
  isActive: boolean;
  isRunning: boolean;
  isReturned: boolean;
  iconData: IconData;
  rows: RowApi;
}) {
  const actions = rows.actionsFor(workItem);
  const icon = <WorkItemIcon icon={resolveWorkItemIcon(workItem, iconData)} />;
  const isCompact = density === "compact";

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
          className={cn(
            "group relative flex cursor-pointer rounded-md px-2 text-[13px] outline-none hover:bg-foreground/5 focus-visible:bg-foreground/5 focus-visible:ring-1 focus-visible:ring-ring",
            isCompact ? "h-7 items-center gap-2" : "items-start gap-2 py-1.5",
            isActive && "bg-foreground/[0.07]",
          )}
          onClick={() => rows.open(workItem)}
          onKeyDown={(event) =>
            handleItemKeyDown(event, {
              actions: [...actions, OPEN_BACKLOG_ITEM_ACTION],
              keys: BACKLOG_ITEM_ROW_KEYS,
              onAction: (actionId, { shortcutId }) =>
                actionId === "open"
                  ? rows.open(workItem)
                  : rows.run(workItem, actionId, {
                      askToSettle: shortcutId === "item.settle-ask",
                    }),
            })
          }
        />
      }
    >
      <span className={cn("shrink-0", !isCompact && "mt-0.5")}>{icon}</span>
      {isCompact ? (
        <span className="min-w-0 flex-1 truncate">
          {workItem.title}
          {parentTitle ? (
            <span className="text-muted-foreground"> · {parentTitle}</span>
          ) : null}
        </span>
      ) : (
        <span className="min-w-0 flex-1">
          <span
            className={cn(
              "line-clamp-2 leading-snug",
              isReturned && "font-semibold",
            )}
          >
            {workItem.title}
          </span>
          <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
            {parentTitle ? `↳ ${parentTitle}` : getMetaLine(workItem)}
          </span>
        </span>
      )}
      <span
        className={cn(
          "flex shrink-0 items-center gap-1 group-focus-within:hidden group-hover:hidden",
          !isCompact && "pt-1",
        )}
      >
        <Markers
          workItem={workItem}
          isRunning={isRunning}
          isReturned={isReturned}
        />
      </span>
      <RowActions
        workItem={workItem}
        rows={rows}
        className={cn(
          "hidden group-focus-within:flex group-hover:flex",
          !isCompact &&
            "absolute top-1 right-1 rounded-md bg-background/95 shadow-sm ring-1 ring-border",
        )}
      />
    </ObjectContextMenu>
  );
}

function UpNextCard({
  workItem,
  parentTitle,
  density,
  isActive,
  isRunning,
  isReturned,
  iconData,
  rows,
}: {
  workItem: LocalWorkItem;
  parentTitle?: string;
  density: SidebarDensity;
  isActive: boolean;
  isRunning: boolean;
  isReturned: boolean;
  iconData: IconData;
  rows: RowApi;
}) {
  const actions = rows.actionsFor(workItem);
  const isCompact = density === "compact";
  const button =
    "inline-flex h-6 items-center gap-1 rounded px-1.5 text-[12px] hover:bg-foreground/10";

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
          aria-label={`Up next: ${workItem.title}`}
          className={cn(
            "mb-1 cursor-pointer rounded-lg border bg-background p-2.5 shadow-xs outline-none focus-visible:ring-1 focus-visible:ring-ring",
            isActive && "border-foreground/30",
          )}
          onClick={() => rows.open(workItem)}
          onKeyDown={(event) =>
            handleItemKeyDown(event, {
              actions: [...actions, OPEN_BACKLOG_ITEM_ACTION],
              keys: BACKLOG_ITEM_ROW_KEYS,
              onAction: (actionId, { shortcutId }) =>
                actionId === "open"
                  ? rows.open(workItem)
                  : rows.run(workItem, actionId, {
                      askToSettle: shortcutId === "item.settle-ask",
                    }),
            })
          }
        />
      }
    >
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <WorkItemIcon icon={resolveWorkItemIcon(workItem, iconData)} />
        <span className="truncate">
          {parentTitle ? `↳ ${parentTitle}` : getMetaLine(workItem)}
        </span>
        <span className="ml-auto flex items-center gap-1">
          <Markers
            workItem={workItem}
            isRunning={isRunning}
            isReturned={isReturned}
          />
        </span>
      </div>
      <div className="mt-1 text-[13px] leading-snug font-medium">
        {workItem.title}
      </div>
      <div
        className="mt-2 flex items-center gap-0.5"
        onClick={(event) => event.stopPropagation()}
      >
        {isCompact ? (
          <RowActions workItem={workItem} rows={rows} className="flex" />
        ) : (
          <>
            <button
              type="button"
              className={cn(button, "border")}
              onClick={() => rows.run(workItem, "start-entry")}
            >
              <PlayIcon className="size-3.5" /> Start
            </button>
            <button
              type="button"
              className={button}
              onClick={() => rows.run(workItem, "snooze")}
            >
              <SnoozeIcon className="size-3.5" /> Snooze
            </button>
            <button
              type="button"
              className={button}
              onClick={(event) =>
                rows.run(workItem, "settle", { askToSettle: event.shiftKey })
              }
            >
              <SettleIcon className="size-3.5" /> Settle
            </button>
          </>
        )}
      </div>
    </ObjectContextMenu>
  );
}

function SectionHeader({
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
      className="flex w-full items-center gap-1 px-2 pt-3 pb-1 text-[11px] font-medium text-muted-foreground uppercase hover:text-foreground"
    >
      <ChevronDown
        className={cn("size-3.5 transition-transform", !open && "-rotate-90")}
      />
      {count !== undefined ? `${label} (${count})` : label}
    </button>
  );
}

function OffListRow({
  workItem,
  detail,
  restoreLabel,
  onRestore,
  iconData,
  rows,
}: {
  workItem: LocalWorkItem;
  detail?: string;
  restoreLabel: string;
  onRestore: () => void;
  iconData: IconData;
  rows: RowApi;
}) {
  return (
    <div
      role="link"
      tabIndex={0}
      data-focus-column="0"
      data-backlog-item-id={workItem._id}
      className="group flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-[13px] text-muted-foreground outline-none hover:bg-foreground/5 focus-visible:ring-1 focus-visible:ring-ring"
      onClick={() => rows.open(workItem)}
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
      <span className="min-w-0 flex-1 truncate">{workItem.title}</span>
      {detail ? (
        <span className="shrink-0 text-[11px] group-focus-within:hidden group-hover:hidden">
          {detail}
        </span>
      ) : null}
      <span
        className="hidden group-focus-within:flex group-hover:flex"
        onClick={(event) => event.stopPropagation()}
      >
        <TooltipButton
          label={restoreLabel}
          className="flex size-6 items-center justify-center rounded hover:bg-foreground/10 hover:text-foreground"
          onClick={onRestore}
        >
          <UndoIcon className="size-3.5" />
        </TooltipButton>
      </span>
    </div>
  );
}

/**
 * The backlog items in the expanded app sidebar, from "Backlog sidebar" in
 * agents/ux-spec.md: the Up next card, the active items in the Backlog page's
 * order, then the collapsible Snoozed and Settled sections.
 */
export function SidebarBacklogList({ pathname }: { pathname: string }) {
  const state = useLocalState();
  const now = useNow();
  const layout = useSidebarLayout();
  const iconData = useWorkItemIconData(state.projects);
  const rows = useBacklogItemRow(state, now);
  const [settledShown, setSettledShown] = useState(SETTLED_PAGE_SIZE);
  const activeItemId = pathname.startsWith("/backlog/")
    ? decodeURIComponent(pathname.slice("/backlog/".length))
    : undefined;
  const runningWorkItemId = state.timers[0]?.workItemId;

  const { listed, snoozed, settled, titleByLookupKey } = useMemo(() => {
    const titles = new Map(
      state.workItems.flatMap((workItem) =>
        getWorkItemLookupKeys(workItem).map(
          (key) => [key, workItem.title] as const,
        ),
      ),
    );
    return {
      listed: selectSidebarBacklogItems(state, now),
      snoozed: state.workItems
        .filter((workItem) => isBacklogItemSnoozed(workItem, now))
        .sort((left, right) => left.snoozedUntil! - right.snoozedUntil!),
      // Subitems settled along with their parent show on the parent's page.
      settled: state.workItems
        .filter(
          (workItem) =>
            workItem.status === "settled" && !workItem.settledWithParentId,
        )
        .sort((left, right) => (right.settledAt ?? 0) - (left.settledAt ?? 0)),
      titleByLookupKey: titles,
    };
  }, [state, now]);

  const parentTitleOf = (workItem: LocalWorkItem) => {
    const key = getWorkItemParentKey(workItem);
    return key ? titleByLookupKey.get(key) : undefined;
  };
  const rowProps = (workItem: LocalWorkItem) => ({
    workItem,
    parentTitle: parentTitleOf(workItem),
    density: layout.density,
    isActive: activeItemId === workItem._id,
    isRunning: runningWorkItemId === workItem._id,
    isReturned: isBacklogItemReturned(workItem, now),
    iconData,
    rows,
  });
  const [upNext, ...rest] = layout.showUpNext ? listed : [undefined, ...listed];

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
            onRestore={() => rows.run(workItem, "unsettle")}
            iconData={iconData}
            rows={rows}
          />
        ))}
        {settled.length > settledShown ? (
          <button
            type="button"
            className="px-2 py-1 text-left text-[12px] text-muted-foreground hover:text-foreground"
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
      className="flex min-h-0 flex-1 flex-col overflow-y-auto px-2 pb-2"
      aria-label="Backlog items"
      data-focus-scope
    >
      {upNext ? (
        <>
          <div className="px-2 pt-3 pb-1 text-[11px] font-medium text-muted-foreground uppercase">
            Up next
          </div>
          <UpNextCard {...rowProps(upNext)} />
        </>
      ) : (
        <div className="pt-2" />
      )}
      <div
        className={cn(
          "flex flex-col",
          layout.density === "comfortable" && "gap-px",
        )}
      >
        {rest.map((workItem) =>
          workItem ? (
            <BacklogItemRow key={workItem._id} {...rowProps(workItem)} />
          ) : null,
        )}
      </div>
      {listed.length === 0 ? (
        <p className="px-2 py-1 text-[12px] text-muted-foreground">
          Nothing on your plate.
        </p>
      ) : null}

      <SectionHeader
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
              onRestore={() => rows.run(workItem, "unsnooze")}
              iconData={iconData}
              rows={rows}
            />
          ))
        : null}

      <SectionHeader
        label="Settled"
        open={layout.settledOpen}
        onToggle={() =>
          updateSidebarLayout({ settledOpen: !layout.settledOpen })
        }
      />
      {settledRows}
    </div>
  );
}
