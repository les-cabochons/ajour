import {
  RiArchiveLine as ArchiveIcon,
  RiArrowGoBackLine as ReturnIcon,
  RiCheckboxCircleLine as SettleIcon,
  RiTimeLine as SnoozeIcon,
  type RemixiconComponentType,
} from "@remixicon/react";

import { PropertyAction } from "@/components/property-list";
import { TooltipButton } from "@/components/tooltip-button";
import type {
  BacklogItemActionId,
  ObjectAction,
} from "@/domain/actions/object-actions";
import type { ShortcutActionId } from "@/lib/shortcuts";

type LifecycleState = "Active" | "Snoozed" | "Settled" | "Archived";

interface Move {
  id: BacklogItemActionId;
  label: string;
  icon: RemixiconComponentType;
  /** The page's key for the same move, shown in the tooltip. */
  shortcut?: ShortcutActionId;
  /** Drawn as its icon alone: the card has no room for a third word. */
  iconOnly?: boolean;
}

/**
 * The moves each state offers, in order. An item off the list offers only
 * the way back, as the header did before the line took its buttons.
 */
const MOVES: Record<LifecycleState, readonly Move[]> = {
  Active: [
    {
      id: "snooze",
      label: "Snooze",
      icon: SnoozeIcon,
      shortcut: "item.snooze",
    },
    {
      id: "settle",
      label: "Settle",
      icon: SettleIcon,
      shortcut: "item.settle",
    },
    { id: "archive", label: "Archive", icon: ArchiveIcon, iconOnly: true },
  ],
  Snoozed: [{ id: "unsnooze", label: "Unsnooze", icon: ReturnIcon }],
  Settled: [{ id: "unsettle", label: "Unsettle", icon: ReturnIcon }],
  Archived: [{ id: "restore", label: "Restore", icon: ReturnIcon }],
};

/**
 * The first line of the item page's properties card: the item's lifecycle on
 * the left, Active, Snoozed, Settled or Archived, and on the right the moves
 * that change it, one click each. A move the item's actions don't list, such
 * as Archive on a manual item, is left out; one they disable waits with its
 * reason. Shift on Settle asks first, as Shift+E does.
 */
export function BacklogItemLifecycleLine({
  item,
  isSnoozed,
  actions,
  onAction,
}: {
  item: { status: "active" | "settled" | "archived" };
  isSnoozed: boolean;
  /** The item's actions, from `getBacklogItemActions`. */
  actions: readonly ObjectAction<BacklogItemActionId>[];
  onAction: (
    actionId: BacklogItemActionId,
    options: { askToSettle: boolean },
  ) => void;
}) {
  const state: LifecycleState = isSnoozed
    ? "Snoozed"
    : item.status === "settled"
      ? "Settled"
      : item.status === "archived"
        ? "Archived"
        : "Active";
  return (
    <div
      role="group"
      aria-label={`Lifecycle: ${state}`}
      className="backlog-item-lifecycle"
    >
      <span className="min-w-0 truncate text-sm font-medium">{state}</span>
      <span className="backlog-item-lifecycle-moves">
        {MOVES[state].map((move) => {
          const action = actions.find((candidate) => candidate.id === move.id);
          if (!action) return null;
          const Icon = move.icon;
          return (
            <TooltipButton
              key={move.id}
              label={move.label}
              shortcut={move.shortcut}
              aria-description={action.disabledReason}
              disabled={Boolean(action.disabledReason)}
              render={<PropertyAction />}
              onClick={(event) =>
                onAction(move.id, {
                  askToSettle: move.id === "settle" && event.shiftKey,
                })
              }
            >
              <Icon aria-hidden />
              {move.iconOnly ? null : move.label}
            </TooltipButton>
          );
        })}
      </span>
    </div>
  );
}
