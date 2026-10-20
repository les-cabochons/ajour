import { describe, expect, it } from "vitest";
import {
  getBacklogItemActions,
  getTaskActions,
  getTimeEntryActions,
} from "@/domain/actions/object-actions";
import { lockedWeekMessage } from "@/domain/time/locked-weeks";
import {
  BACKLOG_ITEM_ACTION_KEYS,
  TASK_ACTION_KEYS,
  TIME_ENTRY_ACTION_KEYS,
  findFocusFallbackIndex,
  findNextFocusIndex,
  getItemKeyCommand,
} from "@/lib/item-keys";
import type { ShortcutKeyEvent } from "@/lib/shortcuts";

function press(
  key: string,
  modifiers: Partial<ShortcutKeyEvent> = {},
): ShortcutKeyEvent {
  return {
    key,
    code: "",
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    ...modifiers,
  };
}

describe("findNextFocusIndex", () => {
  it("moves up and down a list and stops at its ends", () => {
    const list = [0, 0, 0];

    expect(findNextFocusIndex(list, 1, "up")).toBe(0);
    expect(findNextFocusIndex(list, 1, "down")).toBe(2);
    expect(findNextFocusIndex(list, 0, "up")).toBeNull();
    expect(findNextFocusIndex(list, 2, "down")).toBeNull();
    expect(findNextFocusIndex(list, 1, "left")).toBeNull();
  });

  it("moves between Days columns, keeping the row or taking the last card", () => {
    // Monday has three cards, Tuesday none, Wednesday one.
    const days = [0, 0, 0, 2];

    expect(findNextFocusIndex(days, 2, "right")).toBe(3);
    expect(findNextFocusIndex(days, 3, "left")).toBe(0);
    expect(findNextFocusIndex(days, 3, "right")).toBeNull();
    expect(findNextFocusIndex(days, 1, "down")).toBe(2);
    expect(findNextFocusIndex(days, 3, "up")).toBeNull();
  });

  it("moves through Grid cells, which are in row order", () => {
    // Two rows of three days.
    const grid = [0, 1, 2, 0, 1, 2];

    expect(findNextFocusIndex(grid, 1, "down")).toBe(4);
    expect(findNextFocusIndex(grid, 4, "up")).toBe(1);
    expect(findNextFocusIndex(grid, 4, "right")).toBe(5);
    expect(findNextFocusIndex(grid, 3, "left")).toBeNull();
  });
});

describe("findFocusFallbackIndex", () => {
  it("skips the subitems deleted with their backlog item", () => {
    // Rows: Parent, its two subitems, Next root. Deleting Parent removes 0 to 2.
    const removed = new Set([0, 1, 2]);
    expect(
      findFocusFallbackIndex([0, 0, 0, 0], 0, (index) => removed.has(index)),
    ).toBe(3);
  });

  it("takes the previous surviving row at the end of the list", () => {
    // Rows: First root, Last root, its subitem. Deleting Last removes 1 and 2.
    const removed = new Set([1, 2]);
    expect(
      findFocusFallbackIndex([0, 0, 0], 1, (index) => removed.has(index)),
    ).toBe(0);
    expect(findFocusFallbackIndex([0], 0, () => true)).toBeNull();
  });

  it("stays in the deleted card's day", () => {
    // Monday has one card, Tuesday two. Deleting Tuesday's first card.
    expect(findFocusFallbackIndex([0, 1, 1], 1, (index) => index === 1)).toBe(
      2,
    );
    expect(
      findFocusFallbackIndex([0, 1], 1, (index) => index === 1),
    ).toBeNull();
  });
});

describe("getItemKeyCommand", () => {
  const savedEntry = getTimeEntryActions("saved");
  const command = (
    event: ShortcutKeyEvent,
    platform: "mac" | "other" = "mac",
  ) => getItemKeyCommand(event, platform, savedEntry, TIME_ENTRY_ACTION_KEYS);

  it("runs the entry action for each key of the spec", () => {
    const actionId = (event: ShortcutKeyEvent) => {
      const result = command(event);
      return result?.kind === "action" ? result.action?.id : result;
    };

    expect(actionId(press("Enter"))).toBe("edit");
    // E settles backlog items. It no longer edits anything.
    expect(actionId(press("e"))).toBeNull();
    expect(actionId(press("Backspace"))).toBe("delete");
    expect(actionId(press("Delete"))).toBe("delete");
    expect(actionId(press("m"))).toBe("move-to");
    expect(actionId(press("d", { metaKey: true }))).toBe("duplicate");
    expect(
      getItemKeyCommand(
        press("d", { ctrlKey: true }),
        "other",
        savedEntry,
        TIME_ENTRY_ACTION_KEYS,
      ),
    ).toMatchObject({ action: { id: "duplicate" } });
  });

  it("moves focus on arrows and reorders on Alt+arrows", () => {
    expect(command(press("ArrowDown"))).toEqual({
      kind: "focus",
      direction: "down",
    });
    expect(command(press("ArrowLeft"))).toEqual({
      kind: "focus",
      direction: "left",
    });
    expect(command(press("ArrowUp", { altKey: true }))).toEqual({
      kind: "reorder",
      step: -1,
    });
  });

  it("opens the menu on '.', Shift+F10 and the context menu key", () => {
    expect(command(press("."))).toEqual({ kind: "open-menu" });
    expect(command(press("F10", { shiftKey: true }))).toEqual({
      kind: "open-menu",
    });
    expect(command(press("ContextMenu"))).toEqual({ kind: "open-menu" });
    expect(command(press("F10"))).toBeNull();
  });

  it("swallows the key of a disabled action and discards the running entry", () => {
    const running = getTimeEntryActions("running");

    expect(
      getItemKeyCommand(
        press("d", { metaKey: true }),
        "mac",
        running,
        TIME_ENTRY_ACTION_KEYS,
      ),
    ).toEqual({ kind: "action", shortcutId: "item.duplicate" });
    expect(
      getItemKeyCommand(
        press("Backspace"),
        "mac",
        running,
        TIME_ENTRY_ACTION_KEYS,
      ),
    ).toMatchObject({ action: { id: "discard" } });
  });

  it("gives the key of an action locked by a submitted week its reason", () => {
    const reason = lockedWeekMessage("2026-10-05");
    const locked = getTimeEntryActions("committed", { lockedReason: reason });

    expect(
      getItemKeyCommand(
        press("Backspace"),
        "mac",
        locked,
        TIME_ENTRY_ACTION_KEYS,
      ),
    ).toEqual({
      kind: "action",
      shortcutId: "item.delete",
      lockedReason: reason,
    });
    // Edit still opens the entry, read-only.
    expect(
      getItemKeyCommand(press("Enter"), "mac", locked, TIME_ENTRY_ACTION_KEYS),
    ).toMatchObject({ action: { id: "edit" }, lockedReason: undefined });
  });

  it("archives tasks, deletes backlog items, and leaves unknown keys alone", () => {
    const active = { status: "active" as const };
    expect(
      getItemKeyCommand(
        press("Delete"),
        "mac",
        getTaskActions(active, active),
        TASK_ACTION_KEYS,
      ),
    ).toMatchObject({ action: { id: "archive" } });

    const backlogActions = getBacklogItemActions(
      { ...active, source: "manual" },
      {
        subitemCount: 0,
        isSubitem: false,
        isRunning: false,
      },
    );
    expect(
      getItemKeyCommand(
        press("Delete"),
        "mac",
        backlogActions,
        BACKLOG_ITEM_ACTION_KEYS,
      ),
    ).toMatchObject({ action: { id: "delete" } });
    // Backlog items have no Move to…, so M stays with the browser.
    expect(
      getItemKeyCommand(
        press("m"),
        "mac",
        backlogActions,
        BACKLOG_ITEM_ACTION_KEYS,
      ),
    ).toBeNull();
    expect(command(press("1", { code: "Digit1" }))).toBeNull();
  });

  it("settles on E and settles with the dialog on Shift+E", () => {
    const actions = getBacklogItemActions(
      { status: "active", source: "azure_devops" },
      { subitemCount: 0, isSubitem: false, isRunning: false },
    );

    expect(
      getItemKeyCommand(press("e"), "mac", actions, BACKLOG_ITEM_ACTION_KEYS),
    ).toMatchObject({ shortcutId: "item.settle", action: { id: "settle" } });
    expect(
      getItemKeyCommand(
        press("E", { shiftKey: true }),
        "mac",
        actions,
        BACKLOG_ITEM_ACTION_KEYS,
      ),
    ).toMatchObject({
      shortcutId: "item.settle-ask",
      action: { id: "settle" },
    });
  });
});
