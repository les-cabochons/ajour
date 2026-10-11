import { describe, expect, it } from "vitest";
import {
  getBacklogItemActions,
  getTaskActions,
  getTimeEntryActions,
} from "@/domain/actions/object-actions";
import {
  BACKLOG_ITEM_ACTION_KEYS,
  TASK_ACTION_KEYS,
  TIME_ENTRY_ACTION_KEYS,
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
    expect(actionId(press("e"))).toBe("edit");
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

    const backlogActions = getBacklogItemActions(active, {
      subitemCount: 0,
      isSubitem: false,
    });
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
});
