import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { showToast } from "@/components/ui/toast";
import type {
  BacklogItemActionId,
  CalendarSuggestionActionId,
  ObjectAction,
  TaskActionId,
  TimeEntryActionId,
} from "@/domain/actions/object-actions";
import {
  ITEM_SHORTCUTS,
  getShortcutPlatform,
  resolveShortcut,
  type ShortcutActionId,
  type ShortcutKeyEvent,
  type ShortcutPlatform,
} from "@/lib/shortcuts";
import { isShortcutSequencePending } from "@/lib/shortcut-handlers";
import { withEventAttribution } from "@/lib/wide-events";

/**
 * Keys on the focused row, card or Grid cell. See "Focused rows and cards" in
 * docs/agents/ux-spec.md.
 *
 * Focusable items carry `data-focus-column` (the day index in the Week view,
 * "0" in lists) inside an element with `data-focus-scope`. The arrows move
 * focus between the items of one scope. The item's own `onKeyDown` calls
 * `handleItemKeyDown`, so the keys only act while the item itself has focus.
 */

/**
 * Which shortcut runs each action of an object's action set. The "…" and
 * right-click menus show these keys, and `handleItemKeyDown` runs the action
 * whose key was pressed. C and S are app shortcuts that act on the focused
 * entry and the running entry.
 */
export type ActionKeys<Id extends string> = Partial<
  Record<Id, ShortcutActionId>
>;

export const TIME_ENTRY_ACTION_KEYS: ActionKeys<TimeEntryActionId> = {
  edit: "item.edit",
  continue: "entry.continue",
  stop: "entry.stop-or-start",
  duplicate: "item.duplicate",
  "move-to": "item.move-to",
  delete: "item.delete",
  discard: "item.delete",
};

/** Enter adds a calendar suggestion, and Delete dismisses it. */
export const CALENDAR_SUGGESTION_ACTION_KEYS: ActionKeys<CalendarSuggestionActionId> =
  {
    add: "item.edit",
    dismiss: "item.delete",
  };

/**
 * Backlog items have Delete, so Archive has no key. Enter opens the backlog
 * item page from a row, so rows pass `BACKLOG_ITEM_ROW_KEYS`, and the page and
 * editor use these keys, where Enter is Edit.
 */
export const BACKLOG_ITEM_ACTION_KEYS: ActionKeys<BacklogItemActionId> = {
  // S is app-wide; on a focused backlog item it starts or stops that item.
  "start-entry": "entry.stop-or-start",
  "stop-entry": "entry.stop-or-start",
  edit: "item.edit",
  snooze: "item.snooze",
  settle: "item.settle",
  delete: "item.delete",
};

/** The id rows add to their action list so Enter opens the backlog item page. */
export const OPEN_BACKLOG_ITEM_ACTION = {
  id: "open",
  label: "Open",
} as const satisfies ObjectAction<"open">;

/** Keys on a backlog item row: Enter opens the item page instead of Edit. */
export const BACKLOG_ITEM_ROW_KEYS: ActionKeys<BacklogItemActionId | "open"> = {
  ...BACKLOG_ITEM_ACTION_KEYS,
  edit: undefined,
  open: "item.edit",
};

/** Tasks have no Delete: the Delete key archives them, with Undo. */
export const TASK_ACTION_KEYS: ActionKeys<TaskActionId> = {
  edit: "item.edit",
  archive: "item.delete",
};

export type FocusDirection = "up" | "down" | "left" | "right";

/** What a key pressed on a focused item asks for. */
export type ItemKeyCommand<Id extends string> =
  | { kind: "focus"; direction: FocusDirection }
  | { kind: "reorder"; step: -1 | 1 }
  | { kind: "open-menu" }
  /**
   * `action` is undefined when the key's action is listed but disabled, and
   * `lockedReason` is then set when a submitted week disables it.
   */
  | {
      kind: "action";
      shortcutId: ShortcutActionId;
      action?: ObjectAction<Id>;
      lockedReason?: string;
    };

/**
 * Keys that run another key's action in a different way: Shift+E settles with
 * the settle dialog. The action set lists only the main key.
 */
const VARIANT_SHORTCUTS: Partial<Record<ShortcutActionId, ShortcutActionId>> = {
  "item.settle-ask": "item.settle",
};

const FOCUS_SHORTCUTS: Partial<Record<ShortcutActionId, FocusDirection>> = {
  "item.focus-up": "up",
  "item.focus-down": "down",
  "item.focus-left": "left",
  "item.focus-right": "right",
};

/**
 * Resolves a key event on a focused item against its action set. Returns null
 * when the key means nothing for this item, so the browser keeps it, as for
 * M on a backlog item, which has no Move to….
 */
export function getItemKeyCommand<Id extends string>(
  event: ShortcutKeyEvent,
  platform: ShortcutPlatform,
  actions: readonly ObjectAction<Id>[],
  keys: ActionKeys<Id>,
): ItemKeyCommand<Id> | null {
  const resolution = resolveShortcut(ITEM_SHORTCUTS, [], event, platform);
  if (resolution.kind !== "action") {
    return null;
  }

  const shortcutId = resolution.shortcut.id;
  const direction = FOCUS_SHORTCUTS[shortcutId];
  if (direction) {
    return { kind: "focus", direction };
  }

  if (shortcutId === "item.move-up" || shortcutId === "item.move-down") {
    return { kind: "reorder", step: shortcutId === "item.move-up" ? -1 : 1 };
  }

  if (shortcutId === "item.open-menu") {
    return { kind: "open-menu" };
  }

  const actionShortcutId = VARIANT_SHORTCUTS[shortcutId] ?? shortcutId;
  const listed = actions.filter(
    (action) => keys[action.id] === actionShortcutId,
  );
  if (listed.length === 0) {
    return null;
  }

  const action = listed.find((candidate) => !candidate.disabledReason);
  return {
    kind: "action",
    shortcutId,
    action,
    lockedReason: action
      ? undefined
      : listed.find((candidate) => candidate.locked)?.disabledReason,
  };
}

/**
 * The index of the item that receives focus when an arrow is pressed on the
 * item at `currentIndex`, or null when focus stays. `columns` holds each item's
 * column in document order: the day in the Week view, 0 in a list.
 *
 * Up and Down move within the column. Left and Right move to the nearest column
 * that has items, keeping the row when it exists and taking the column's last
 * item otherwise. Neither wraps around.
 */
export function findNextFocusIndex(
  columns: readonly number[],
  currentIndex: number,
  direction: FocusDirection,
): number | null {
  const column = columns[currentIndex];
  if (column === undefined) {
    return null;
  }

  const indexesIn = (value: number) =>
    columns.flatMap((itemColumn, index) =>
      itemColumn === value ? [index] : [],
    );
  const sameColumn = indexesIn(column);
  const row = sameColumn.indexOf(currentIndex);

  if (direction === "up" || direction === "down") {
    return sameColumn[row + (direction === "up" ? -1 : 1)] ?? null;
  }

  const otherColumns = [...new Set(columns)]
    .filter((value) => (direction === "left" ? value < column : value > column))
    .sort((left, right) =>
      direction === "left" ? right - left : left - right,
    );
  const nextColumn = otherColumns[0];
  if (nextColumn === undefined) {
    return null;
  }

  const target = indexesIn(nextColumn);
  return target[Math.min(row, target.length - 1)] ?? null;
}

/**
 * The index of the item that takes focus once the item at `removedIndex` is
 * gone, or null when its column has nothing left. `isRemoved` tells which items
 * the same action removed, such as a backlog item's subitems. The next surviving
 * item in the column wins, else the nearest one before it.
 */
export function findFocusFallbackIndex(
  columns: readonly number[],
  removedIndex: number,
  isRemoved: (index: number) => boolean,
): number | null {
  const column = columns[removedIndex];
  const survivors = columns.flatMap((itemColumn, index) =>
    itemColumn === column && !isRemoved(index) ? [index] : [],
  );

  const before = survivors.filter((index) => index < removedIndex);
  return (
    survivors.find((index) => index > removedIndex) ?? before.at(-1) ?? null
  );
}

const FOCUS_SCOPE_SELECTOR = "[data-focus-scope]";
/** Matches a focusable row, card or Grid cell. */
export const FOCUS_ITEM_SELECTOR = "[data-focus-column]";

/** The focusable items of `item`'s scope, in document order, with their columns. */
function getScopeItems(item: HTMLElement) {
  const scope = item.closest(FOCUS_SCOPE_SELECTOR);
  const items = scope
    ? [...scope.querySelectorAll<HTMLElement>(FOCUS_ITEM_SELECTOR)]
    : [];
  return {
    items,
    columns: items.map((element) => Number(element.dataset.focusColumn) || 0),
    index: items.indexOf(item),
  };
}

/** The item that an arrow in `direction` focuses from `item`, if any. */
function findFocusNeighbor(item: HTMLElement, direction: FocusDirection) {
  const { items, columns, index } = getScopeItems(item);
  const nextIndex = findNextFocusIndex(columns, index, direction);
  return nextIndex === null ? null : (items[nextIndex] ?? null);
}

/**
 * Puts focus back after React has rendered the action's result. When the
 * item is gone, focus goes to the next item that is still there, so deleting
 * a backlog item skips the subitems removed with it.
 */
function refocusAfterRender(item: HTMLElement, { fallback = false } = {}) {
  const before = fallback ? getScopeItems(item) : null;
  window.requestAnimationFrame(() => {
    let target: HTMLElement | null | undefined = item;
    if (!item.isConnected && before && before.index !== -1) {
      const index = findFocusFallbackIndex(
        before.columns,
        before.index,
        (candidate) => !before.items[candidate]?.isConnected,
      );
      target = index === null ? null : before.items[index];
    }

    if (target?.isConnected && document.activeElement !== target) {
      target.focus();
    }
  });
}

/**
 * Opens the item's "…" menu, or its right-click menu when it has no "…"
 * button, as on Grid cells.
 */
function openItemMenu(item: HTMLElement) {
  const button = item.querySelector<HTMLElement>(".object-actions-button");
  if (button) {
    button.click();
    return;
  }

  const rect = item.getBoundingClientRect();
  item.dispatchEvent(
    new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX: rect.left + rect.width / 2,
      clientY: rect.bottom,
    }),
  );
}

const platform = getShortcutPlatform();

/**
 * Runs the item shortcuts for the element that has focus: arrows move focus,
 * Alt+arrows call `onReorder` when the item is sortable, ".", Shift+F10 and the
 * context menu key open its menu, and the other keys run the action that
 * `keys` maps them to. A disabled action swallows its key and does nothing,
 * except a locked one, which shows the submitted week's reason as a toast, as
 * Alt+arrows do with `reorderLockedReason`.
 * After Delete removes the item, focus moves to the next item that is still
 * there, or the previous one at the end.
 */
export function handleItemKeyDown<Id extends string>(
  event: ReactKeyboardEvent<HTMLElement>,
  {
    actions,
    keys,
    onAction,
    onReorder,
    reorderLockedReason,
  }: {
    actions: readonly ObjectAction<Id>[];
    keys: ActionKeys<Id>;
    /** `shortcutId` is the key pressed, such as Shift+E for "item.settle-ask". */
    onAction: (actionId: Id, key: { shortcutId: ShortcutActionId }) => void;
    /** Present only where drag reorder exists. -1 is Move up, 1 is Move down. */
    onReorder?: (step: -1 | 1) => void;
    /** Set instead of `onReorder` when a submitted week keeps the item in place. */
    reorderLockedReason?: string;
  },
) {
  const item = event.currentTarget;
  if (
    event.defaultPrevented ||
    event.target !== item ||
    event.nativeEvent.isComposing ||
    isShortcutSequencePending()
  ) {
    return;
  }

  const command = getItemKeyCommand(event, platform, actions, keys);
  switch (command?.kind) {
    case "focus": {
      const next = findFocusNeighbor(item, command.direction);
      if (next) {
        event.preventDefault();
        next.focus();
      }
      return;
    }
    case "reorder":
      if (onReorder) {
        event.preventDefault();
        withEventAttribution({ surface: "item_key" }, () =>
          onReorder(command.step),
        );
        // Moving a focused node in the DOM can drop its focus.
        refocusAfterRender(item);
      } else if (reorderLockedReason) {
        event.preventDefault();
        showToast(reorderLockedReason);
      }
      return;
    case "open-menu":
      event.preventDefault();
      openItemMenu(item);
      return;
    case "action": {
      // Swallow the key even when disabled, so Cmd+D never bookmarks the page.
      event.preventDefault();
      if (!command.action) {
        if (command.lockedReason) showToast(command.lockedReason);
        return;
      }

      // The scope is read before the action, the fallback picked after it.
      const removesItem = command.shortcutId === "item.delete";
      if (removesItem) {
        refocusAfterRender(item, { fallback: true });
      }
      withEventAttribution({ surface: "item_key" }, () =>
        onAction(command.action!.id, { shortcutId: command.shortcutId }),
      );
      return;
    }
    default:
      return;
  }
}
