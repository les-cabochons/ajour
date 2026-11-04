import {
  RiPlayFill,
  RiStopFill,
  RiCheckboxCircleLine,
  RiTimeLine,
} from "@remixicon/react";
import { getWorkflowStateFills } from "@/domain/backlog/workflow-state-fill";
import { stateDotStyle } from "@/features/backlog/state-dot";
import { formatHours } from "@/features/backlog/backlog-estimates";
import { PickerChevron } from "@/components/picker-chevron";
import { RunningDot } from "@/components/running-dot";
import { SyncConflictButton } from "@/features/backlog/sync-conflicts";
import { openModifiedSourceClick } from "@/lib/source-navigation";
import type { KeyboardEvent, PointerEvent } from "react";
import {
  ObjectActionsButton,
  ObjectContextMenu,
} from "@/components/object-actions-menu";
import { TooltipButton } from "@/components/tooltip-button";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
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
import {
  getPriorityRefusal,
  isBacklogItemSnoozed,
} from "@/domain/backlog/backlog-item-lifecycle";
import { findWorkItemTimer } from "@/domain/time/running-entry";
import { getDirectChildWorkItems } from "@/domain/backlog/work-item-hierarchy";
import {
  getPriorityLevelName,
  PRIORITY_LEVELS,
} from "@/domain/backlog/priority";
import {
  getLocalProjectDisplayName,
  hasWorkItemSyncIssue,
  type LocalAppState,
  type LocalWorkItem,
} from "@/domain/local-state";
import {
  changeSourceStateWithUndo,
  getOtherSourceStates,
  moveBacklogItemWithUndo,
} from "@/features/backlog/backlog-item-moves";
import {
  canWriteToSource,
  sendPendingSourceWrites,
} from "@/features/backlog/backlog-source-writes";
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
import { ProjectIcon } from "@/lib/project-icons";
import { useHoverOrFocusWithin } from "@/lib/use-hover-or-focus-within";
import { cn } from "@/lib/utils";

/**
 * Changes a backlog item in place with Undo, from a picker, a property or a
 * drop. A synced item's new priority level is written to its source when
 * the Undo toast closes, when its plugin can write (#471).
 */
export function patchBacklogItemWithUndo(
  item: LocalWorkItem,
  patch: Parameters<typeof localStore.updateWorkItemWithUndo>[1],
  title: string,
  orderedIds?: string[],
) {
  const writesToSource = "priority" in patch && canWriteToSource(item);
  offerUndo(
    localStore.updateWorkItemWithUndo(item._id, patch, orderedIds, {
      writesToSource,
    }),
    {
      title,
      subject: "backlog item",
      onWindowClosed: writesToSource
        ? () => void sendPendingSourceWrites([item._id])
        : undefined,
    },
  );
}

export function BacklogStatePicker({
  item,
  state,
  full = false,
  beforeChange,
  live = true,
}: {
  item: LocalWorkItem;
  state: LocalAppState;
  full?: boolean;
  beforeChange?: () => boolean | Promise<boolean>;
  /** False renders the button alone; see `ObjectActionsButton`. */
  live?: boolean;
}) {
  const workflow = state.workflowStates.find(
    (s) => s._id === item.workflowStateId,
  );
  const fills = getWorkflowStateFills(state.workflowStates);
  const dot = (
    <span
      className="backlog-state-dot"
      style={stateDotStyle(workflow?.color, fills.get(workflow?._id ?? ""))}
    />
  );
  if (!live) {
    return (
      <Button
        variant="ghost"

        data-leading="state"
        className={full ? "property-picker justify-start" : "size-6 p-0"}
        aria-label={`Change state of ${item.title}`}
        aria-haspopup="menu"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        {dot}
        {full && (workflow?.name ?? "No state")}
        {full && <PickerChevron />}
      </Button>
    );
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        data-state-picker
        render={
          <Button
            variant="ghost"
            data-leading="state"
            className={full ? "property-picker justify-start" : "size-6 p-0"}
            aria-label={`Change state of ${item.title}`}
          />
        }
        onClick={(e) => e.stopPropagation()}
      >
        {dot}
        {full && (workflow?.name ?? "No state")}
        {full && <PickerChevron />}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuItem
          onClick={async () => {
            if ((await beforeChange?.()) !== false)
              void moveBacklogItemWithUndo(item, undefined);
          }}
        >
          No state
        </DropdownMenuItem>
        {state.workflowStates.map((s) => (
          <DropdownMenuItem
            key={s._id}
            onClick={async () => {
              if ((await beforeChange?.()) !== false)
                void moveBacklogItemWithUndo(item, s._id);
            }}
          >
            <span
              className="backlog-state-dot"
              style={stateDotStyle(s.color, fills.get(s._id))}
            />
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
  live = true,
}: {
  item: LocalWorkItem;
  full?: boolean;
  beforeChange?: () => boolean | Promise<boolean>;
  hidden?: boolean;
  /** False renders the button alone; see `ObjectActionsButton`. */
  live?: boolean;
}) {
  if (!live) {
    // The hidden picker only serves the focused row's keys, so it waits too.
    return hidden ? null : (
      <Button
        variant="ghost"

        data-leading="priority"
        className={full ? "property-picker justify-start" : "size-6 p-0"}
        aria-label={`Change priority of ${item.title}`}
        aria-haspopup="menu"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <PriorityIcon priority={item.priority} decorative />
        {full && getPriorityLevelName(item.priority)}
        {full && <PickerChevron />}
      </Button>
    );
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        data-priority-picker
        render={
          <Button
            variant="ghost"
            data-leading={hidden ? undefined : "priority"}
            className={
              hidden
                ? "backlog-hidden-picker"
                : full
                  ? "property-picker justify-start"
                  : "size-6 p-0"
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
        {full && <PickerChevron />}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {[{ level: undefined, name: "No priority" }, ...PRIORITY_LEVELS].map(
          (p) => (
            <DropdownMenuItem
              key={p.name}
              // A synced item's source can't take No priority (rule 2 of
              // the action model: greyed out, the reason for screen readers).
              disabled={getPriorityRefusal(item, p.level) !== undefined}
              aria-description={getPriorityRefusal(item, p.level)}
              onClick={async () => {
                if ((await beforeChange?.()) !== false)
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
    isRunning: Boolean(findWorkItemTimer(state.timers, item._id)),
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
  alwaysLive = false,
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
  beforeChange: () => boolean | Promise<boolean>;
  board: boolean;
  column: number;
  now: number;
  selected: boolean;
  /**
   * Mounts the row's menus and tooltips at once instead of while the row is
   * hovered or focused. The narrow view passes it: its actions always show.
   */
  alwaysLive?: boolean;
  onSelect: () => void;
  onOpen: () => void;
  onAction: (action: BacklogItemActionId) => void;
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
  onPointerDown?: (event: PointerEvent<HTMLElement>) => void;
}) {
  const reveal = useHoverOrFocusWithin();
  const live = alwaysLive || reveal.active;
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
  const running = Boolean(findWorkItemTimer(state.timers, item._id));
  // The running item's button is Stop, like its action set.
  const startAction = running ? "stop-entry" : "start-entry";
  // Stop is the filled square everywhere, as in the dock and the top bar.
  // A filled play, as present as Stop (council round 9).
  const StartIcon = running ? RiStopFill : RiPlayFill;
  const startDisabledReason = actions.find(
    (action) => action.id === startAction,
  )?.disabledReason;
  const startLabel = running
    ? `Stop ${item.title}`
    : !startDisabledReason && state.timers.length
      ? `Switch to ${item.title}`
      : `Start ${item.title}`;
  const reference = parseWorkItemReference(item.sourceId) ?? item.sourceId;
  const click = (e: React.MouseEvent) => {
    if (
      !(e.target instanceof Node) ||
      !e.currentTarget.contains(e.target) ||
      (e.target instanceof Element && e.target.closest("button,a,input"))
    )
      return;
    if (openModifiedSourceClick(e, item.sourceUrl)) return;
    e.currentTarget instanceof HTMLElement && e.currentTarget.focus();
    onSelect();
  };
  const markers = (
    <>
      {running && (
        // The one running mark, as on Day rows and in the sidebar.
        <span className="backlog-item-marker is-running">
          <RunningDot />
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
          {/* Icon plus word, like Running and Snoozed (council round 21). */}
          <RiCheckboxCircleLine className="size-3" aria-hidden />
          Settled
          {board && item.settledAt
            ? ` · ${new Date(item.settledAt).toLocaleDateString()}`
            : ""}
        </span>
      )}
      {/* Named, like Running and Settled, so no mark needs decoding
          (council round 11). */}
      {isBacklogItemSnoozed(item, now) && (
        <span className="backlog-item-marker">
          <RiTimeLine className="size-3" aria-hidden />
          Snoozed
        </span>
      )}
      {hasWorkItemSyncIssue(item) && <SyncConflictButton item={item} />}
    </>
  );
  const progressLabel = progress && (
    <span
      className="backlog-subitem-progress"
      title={`${progress.closed} of ${progress.total} subitems closed`}
    >
      {/* Words, not a mark to learn: "1/2 done", like Snoozed and Settled
          (council rounds 19 and 25). */}
      <span>
        {progress.closed}/{progress.total} done
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
          // Names the focused object for S and the command palette.
          data-backlog-item-id={item._id}
          data-focus-column={column}
          // A subitem row in the narrow view drops the project's name for
          // its parent's when both cannot fit (council round 18).
          data-subitem={parent ? "" : undefined}
          // An archived row's marks dim with its title (council round 21).
          data-archived={item.status === "archived" ? "" : undefined}
          className={cn(
            board ? "backlog-board-card" : "backlog-list-row",
            onPointerDown && "touch-none",
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
          {...reveal.props}
        />
      }
    >
      {!view.properties.priority && (
        <BacklogPriorityPicker
          item={item}
          beforeChange={beforeChange}
          hidden
          live={live}
        />
      )}
      <div
        className="backlog-item-leading"
        data-no-priority={view.properties.priority && !board ? undefined : ""}
        // A list row's id follows its title, so the leading icons stay fixed
        // whether or not an item has one (council round 5).
        data-no-id={board && view.properties.id ? undefined : ""}
      >
        {view.properties.priority && !board && (
          <BacklogPriorityPicker
            item={item}
            beforeChange={beforeChange}
            live={live}
          />
        )}
        {board ? (
          <span
            className="backlog-board-project"
            title={
              view.properties.project && project
                ? getLocalProjectDisplayName(project)
                : undefined
            }
          >
            {view.properties.project && (
              <>
                {project && (
                  <ProjectIcon
                    icon={project.icon}
                    color={project.color}
                    className="size-3.5"
                  />
                )}
                <span className="backlog-item-id">
                  {project ? getLocalProjectDisplayName(project) : "No project"}
                </span>
              </>
            )}
          </span>
        ) : null}
        <BacklogStatePicker
          item={item}
          state={state}
          beforeChange={beforeChange}
          live={live}
        />
        {/* The project's own icon, or a source's task icon: with many
            projects it tells them apart at a glance. */}
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
        {!board && view.properties.id && reference ? (
          <span className="backlog-item-id">{reference}</span>
        ) : null}
        {parent && (
          <span className="backlog-item-parent" title={parent.title}>
            ↳ {parent.title}
          </span>
        )}
        {!board && progressLabel}
        {!board && markers}
      </div>
      <div
        className="backlog-item-properties"
        data-no-project={view.properties.project ? undefined : ""}
      >
        {board && view.properties.priority && (
          <BacklogPriorityPicker
            item={item}
            beforeChange={beforeChange}
            live={live}
          />
        )}
        {board && <WorkItemIcon icon={resolveWorkItemIcon(item, icons)} />}
        {board && markers}
        {board && progressLabel}
        {!board && view.properties.project && project && (
          <Chip
            className="backlog-item-project max-w-40"
            color={project.color}
            title={getLocalProjectDisplayName(project)}
          >
            {getLocalProjectDisplayName(project)}
          </Chip>
        )}
        {/* Nothing left reads as nothing, as an empty cell does. */}
        {view.properties.estimate &&
          item.remainingEstimateHours !== undefined &&
          item.remainingEstimateHours > 0 && (
            <span className="backlog-item-estimate">
              {formatHours(item.remainingEstimateHours)}
            </span>
          )}
        <div className="backlog-item-actions">
          {item.status !== "archived" &&
            (live ? (
              <TooltipButton
                label={
                  startDisabledReason
                    ? `${startLabel}. ${startDisabledReason}`
                    : startLabel
                }
                aria-label={startLabel}
                aria-description={startDisabledReason}
                aria-disabled={Boolean(startDisabledReason)}
                render={
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className={cn(
                      "backlog-item-start aria-disabled:opacity-50",
                      // The running item's Stop is the one strong action in the list.
                      running ? "text-foreground" : "text-muted-foreground",
                    )}
                  />
                }
                onClick={(e) => {
                  e.stopPropagation();
                  if (!startDisabledReason) onAction(startAction);
                }}
              >
                <StartIcon className="size-4" />
              </TooltipButton>
            ) : (
              <Button
                variant="ghost"
                size="icon-sm"
                className={cn(
                  "backlog-item-start aria-disabled:opacity-50",
                  // The running item's Stop is the one strong action in the list.
                  running ? "text-foreground" : "text-muted-foreground",
                )}
                aria-label={startLabel}
                aria-description={startDisabledReason}
                aria-disabled={Boolean(startDisabledReason)}
                tabIndex={-1}
                onClick={(e) => {
                  e.stopPropagation();
                  if (!startDisabledReason) onAction(startAction);
                }}
              >
                <StartIcon className="size-4" />
              </Button>
            ))}
          <ObjectActionsButton
            label={`Actions for ${item.title}`}
            actions={actions}
            onAction={onAction}
            keys={BACKLOG_ITEM_ACTION_KEYS}
            live={live}
            className="size-6 text-muted-foreground"
          />
        </div>
      </div>
      {view.properties.sourceState && item.sourceStatusLabel && (
        <button
          className="backlog-item-source-state"
          disabled={getOtherSourceStates(item).length === 0}
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
