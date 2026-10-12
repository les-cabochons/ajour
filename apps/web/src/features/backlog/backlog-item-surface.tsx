import { RiPlayLine, RiTimeLine, RiAlarmWarningLine } from "@remixicon/react";
import type { KeyboardEvent, PointerEvent } from "react";
import {
  ObjectActionsButton,
  ObjectContextMenu,
} from "@/components/object-actions-menu";
import { TooltipButton } from "@/components/tooltip-button";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  getBacklogItemActions,
  type BacklogItemActionId,
} from "@/domain/actions/object-actions";
import {
  getSubitemProgress,
  type BacklogViewSettings,
} from "@/domain/backlog/backlog-view";
import { isBacklogItemSnoozed } from "@/domain/backlog/backlog-item-lifecycle";
import { getDirectChildWorkItems } from "@/domain/backlog/work-item-hierarchy";
import {
  getPriorityLevelName,
  PRIORITY_LEVELS,
} from "@/domain/backlog/priority";
import {
  getLocalProjectDisplayName,
  hasWorkItemEstimateSyncIssue,
  type LocalAppState,
  type LocalWorkItem,
} from "@/domain/local-state";
import {
  changeSourceStateWithUndo,
  getOtherSourceStates,
  moveBacklogItemWithUndo,
} from "@/features/backlog/backlog-item-moves";
import { PriorityIcon } from "@/features/backlog/priority-icon";
import {
  WorkItemIcon,
  resolveWorkItemIcon,
  useWorkItemIconData,
} from "@/features/backlog/work-item-icons";
import { parseWorkItemReference } from "@/features/backlog/work-item-timer-comment";
import { offerUndo } from "@/features/feedback/undo-toast";
import { settleOpensDialog } from "@/features/backlog/settle-dialog";
import { BACKLOG_ITEM_ACTION_KEYS } from "@/lib/item-keys";
import { localStore } from "@/lib/local-store";
import { cn } from "@/lib/utils";

export function patchBacklogItemWithUndo(
  item: LocalWorkItem,
  patch: Parameters<typeof localStore.updateWorkItemWithUndo>[1],
  title: string,
  orderedIds?: string[],
) {
  offerUndo(localStore.updateWorkItemWithUndo(item._id, patch, orderedIds), {
    title,
    subject: "backlog item",
  });
}
export function BacklogStatePicker({
  item,
  state,
  full = false,
  beforeChange,
}: {
  item: LocalWorkItem;
  state: LocalAppState;
  full?: boolean;
  beforeChange?: () => boolean;
}) {
  const workflow = state.workflowStates.find(
    (s) => s._id === item.workflowStateId,
  );
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        data-state-picker
        render={
          <Button
            variant="ghost"
            size="sm"
            className={full ? "justify-start" : "size-7 p-0"}
            aria-label={`Change state of ${item.title}`}
          />
        }
        onClick={(e) => e.stopPropagation()}
      >
        <span
          className="backlog-state-dot"
          style={{ color: workflow?.color }}
        />
        {full && (workflow?.name ?? "No state")}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuItem
          onClick={() => {
            if (beforeChange?.() !== false)
              void moveBacklogItemWithUndo(item, undefined);
          }}
        >
          No state
        </DropdownMenuItem>
        {state.workflowStates.map((s) => (
          <DropdownMenuItem
            key={s._id}
            onClick={() => {
              if (beforeChange?.() !== false)
                void moveBacklogItemWithUndo(item, s._id);
            }}
          >
            <span className="backlog-state-dot" style={{ color: s.color }} />
            {s.name}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
export function BacklogPriorityPicker({
  item,
  full = false,
  beforeChange,
  hidden = false,
}: {
  item: LocalWorkItem;
  full?: boolean;
  beforeChange?: () => boolean;
  hidden?: boolean;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        data-priority-picker
        render={
          <Button
            variant="ghost"
            size="sm"
            className={
              hidden
                ? "backlog-hidden-picker"
                : full
                  ? "justify-start"
                  : "size-7 p-0"
            }
            tabIndex={hidden ? -1 : undefined}
            aria-hidden={hidden || undefined}
            aria-label={`Change priority of ${item.title}`}
          />
        }
        onClick={(e) => e.stopPropagation()}
      >
        <PriorityIcon priority={item.priority} decorative />
        {full && getPriorityLevelName(item.priority)}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {[{ level: undefined, name: "No priority" }, ...PRIORITY_LEVELS].map(
          (p) => (
            <DropdownMenuItem
              key={p.name}
              onClick={() => {
                if (beforeChange?.() !== false)
                  patchBacklogItemWithUndo(
                    item,
                    { priority: p.level },
                    `Priority changed to ${p.name}`,
                  );
              }}
            >
              <PriorityIcon priority={p.level} decorative />
              {p.name}
            </DropdownMenuItem>
          ),
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
export function getBacklogSurfaceActions(
  item: LocalWorkItem,
  state: LocalAppState,
  now: number,
) {
  return getBacklogItemActions(item, {
    isSubitem: Boolean(
      item.parentWorkItemId || item.parentSourceId || item.hierarchyLevel,
    ),
    isSnoozed: isBacklogItemSnoozed(item, now),
    subitemCount: getDirectChildWorkItems(item, state.workItems).length,
    otherSourceStateCount: getOtherSourceStates(item).length,
    settleOpensDialog: settleOpensDialog(item),
  });
}
export function BacklogItemSurface({
  item,
  state,
  view,
  icons,
  board,
  column,
  now,
  selected,
  onSelect,
  onOpen,
  onAction,
  onKeyDown,
  onPointerDown,
  beforeChange,
}: {
  item: LocalWorkItem;
  state: LocalAppState;
  view: BacklogViewSettings;
  icons: ReturnType<typeof useWorkItemIconData>;
  beforeChange: () => boolean;
  board: boolean;
  column: number;
  now: number;
  selected: boolean;
  onSelect: () => void;
  onOpen: () => void;
  onAction: (action: BacklogItemActionId) => void;
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
  onPointerDown: (event: PointerEvent<HTMLElement>) => void;
}) {
  const project = state.projects.find((p) => p._id === item.projectId);
  const parent = item.parentWorkItemId
    ? state.workItems.find((i) => i._id === item.parentWorkItemId)
    : item.parentSourceId
      ? state.workItems.find(
          (i) =>
            i.sourceId === item.parentSourceId &&
            i.source === item.source &&
            i.sourceConnectionId === item.sourceConnectionId,
        )
      : undefined;
  const progress = getSubitemProgress(
    getDirectChildWorkItems(item, state.workItems),
  );
  const actions = getBacklogSurfaceActions(item, state, now);
  const running = state.timers.some((t) => t.workItemId === item._id);
  const reference = parseWorkItemReference(item.sourceId) ?? item.sourceId;
  const click = (e: React.MouseEvent) => {
    if (
      !(e.target instanceof Node) ||
      !e.currentTarget.contains(e.target) ||
      (e.target instanceof Element && e.target.closest("button,a,input"))
    )
      return;
    e.currentTarget instanceof HTMLElement && e.currentTarget.focus();
    onSelect();
  };
  const markers = (
    <>
      {running && (
        <span className="backlog-item-marker text-primary">
          <RiPlayLine className="size-3" />
          Running
        </span>
      )}
      {item.status === "settled" && (
        <span
          className="backlog-item-marker"
          title={
            item.settledAt
              ? new Date(item.settledAt).toLocaleDateString()
              : undefined
          }
        >
          Settled
          {board && item.settledAt
            ? ` · ${new Date(item.settledAt).toLocaleDateString()}`
            : ""}
        </span>
      )}
      {isBacklogItemSnoozed(item, now) && (
        <RiTimeLine
          className="size-3.5 text-muted-foreground"
          aria-label="Snoozed"
        />
      )}
      {hasWorkItemEstimateSyncIssue(item) && (
        <RiAlarmWarningLine
          className="size-3.5 text-destructive"
          aria-label="Estimate sync issue"
        />
      )}
    </>
  );
  const progressLabel = progress && (
    <span
      className="backlog-subitem-progress"
      title={`${progress.closed} of ${progress.total} subitems closed`}
    >
      <span>
        {progress.closed}/{progress.total}
      </span>
      {board && (
        <span className="backlog-progress-track">
          <span
            style={{ width: `${(progress.closed / progress.total) * 100}%` }}
          />
        </span>
      )}
    </span>
  );
  return (
    <ObjectContextMenu
      actions={actions}
      onAction={onAction}
      keys={BACKLOG_ITEM_ACTION_KEYS}
      render={
        <div
          role="listitem"
          tabIndex={0}
          data-work-item-id={item._id}
          data-focus-column={column}
          className={cn(
            board ? "backlog-board-card" : "backlog-list-row",
            selected && "is-selected",
          )}
          onClick={click}
          onDoubleClick={(e) => {
            if (
              e.target instanceof Element &&
              e.target.closest("button,a,input")
            )
              return;
            onOpen();
          }}
          onKeyDown={onKeyDown}
          onPointerDown={onPointerDown}
        />
      }
    >
      {!view.properties.priority && (
        <BacklogPriorityPicker item={item} beforeChange={beforeChange} hidden />
      )}
      <div className="backlog-item-leading">
        {view.properties.priority && !board && (
          <BacklogPriorityPicker item={item} beforeChange={beforeChange} />
        )}
        {view.properties.id && reference && (
          <span className="backlog-item-id">{reference}</span>
        )}
        <BacklogStatePicker
          item={item}
          state={state}
          beforeChange={beforeChange}
        />
        {!board && <WorkItemIcon icon={resolveWorkItemIcon(item, icons)} />}
      </div>
      <div className="backlog-item-content">
        <span
          className={cn(
            "backlog-item-title",
            item.status === "archived" && "text-muted-foreground",
          )}
        >
          {item.title}
        </span>
        {parent && (
          <span className="backlog-item-parent" title={parent.title}>
            ↳ {parent.title}
          </span>
        )}
        {!board && progressLabel}
        {!board && markers}
      </div>
      <div className="backlog-item-properties">
        {board && view.properties.priority && (
          <BacklogPriorityPicker item={item} beforeChange={beforeChange} />
        )}
        {board && <WorkItemIcon icon={resolveWorkItemIcon(item, icons)} />}
        {board && markers}
        {board && progressLabel}
        {view.properties.project && project && (
          <span
            className="backlog-item-project"
            title={getLocalProjectDisplayName(project)}
          >
            <span
              className="size-1.5 shrink-0 rounded-full"
              style={{ background: project.color }}
            />
            {getLocalProjectDisplayName(project)}
          </span>
        )}
        {view.properties.estimate &&
          item.remainingEstimateHours !== undefined && (
            <span className="backlog-item-estimate">
              {item.remainingEstimateHours}h
            </span>
          )}
        <div className="backlog-item-actions">
          {item.status !== "archived" && (
            <TooltipButton
              label={
                state.timers.length
                  ? `Switch to ${item.title}`
                  : `Start ${item.title}`
              }
              render={<Button variant="ghost" size="icon-sm" />}
              disabled={running}
              onClick={(e) => {
                e.stopPropagation();
                onAction("start-entry");
              }}
            >
              <RiPlayLine className="size-3.5" />
            </TooltipButton>
          )}
          <ObjectActionsButton
            label={`Actions for ${item.title}`}
            actions={actions}
            onAction={onAction}
            keys={BACKLOG_ITEM_ACTION_KEYS}
          />
        </div>
      </div>
      {view.properties.sourceState && item.sourceStatusLabel && (
        <button
          className="backlog-item-source-state"
          disabled={getOtherSourceStates(item).length < 2}
          onClick={(e) => {
            e.stopPropagation();
            void changeSourceStateWithUndo(item);
          }}
          aria-label={`Change source state of ${item.title}`}
        >
          {item.sourceStatusLabel}
        </button>
      )}
    </ObjectContextMenu>
  );
}
