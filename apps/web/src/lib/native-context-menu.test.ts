import { describe, expect, it } from "vitest";
import {
  addTimeEntryClipboardActions,
  getBacklogItemActions,
  getTimeEntryActions,
} from "@/domain/actions/object-actions";
import { BACKLOG_ITEM_ROW_KEYS, TIME_ENTRY_ACTION_KEYS } from "@/lib/item-keys";
import {
  canPressOpenContextMenu,
  isPointOnSelection,
  toElectronAccelerator,
  toNativeContextMenuItems,
} from "@/lib/native-context-menu";

describe("native context menu items", () => {
  it("separates the sections and shows each action's key", () => {
    const actions = addTimeEntryClipboardActions(getTimeEntryActions("saved"), {
      saved: 1,
      selected: 1,
      canPaste: true,
    });

    expect(toNativeContextMenuItems(actions, TIME_ENTRY_ACTION_KEYS)).toEqual([
      {
        type: "item",
        id: "edit",
        label: "Edit",
        enabled: true,
        accelerator: "Enter",
      },
      {
        type: "item",
        id: "continue",
        label: "Continue",
        enabled: true,
        accelerator: "C",
      },
      { type: "separator" },
      {
        type: "item",
        id: "cut",
        label: "Cut",
        enabled: true,
        accelerator: "CmdOrCtrl+X",
      },
      {
        type: "item",
        id: "copy",
        label: "Copy",
        enabled: true,
        accelerator: "CmdOrCtrl+C",
      },
      {
        type: "item",
        id: "paste",
        label: "Paste",
        enabled: true,
        accelerator: "CmdOrCtrl+V",
      },
      { type: "separator" },
      {
        type: "item",
        id: "duplicate",
        label: "Duplicate",
        enabled: true,
        accelerator: "CmdOrCtrl+D",
      },
      {
        type: "item",
        id: "duplicate-to",
        label: "Duplicate to…",
        enabled: true,
      },
      {
        type: "item",
        id: "move-to",
        label: "Move to…",
        enabled: true,
        accelerator: "M",
      },
      { type: "separator" },
      {
        type: "item",
        id: "delete",
        label: "Delete",
        enabled: true,
        accelerator: "Backspace",
        icon: "trash",
      },
    ]);
  });

  it("greys out a disabled action, leaves out reasons and hints, and gives Archive its box", () => {
    const items = toNativeContextMenuItems(
      getBacklogItemActions(
        {
          status: "archived",
          source: "jira",
          sourceUrl: "https://example.atlassian.net/browse/ENG-42",
        },
        { subitemCount: 0, isSubitem: false, isRunning: false },
      ),
      BACKLOG_ITEM_ROW_KEYS,
    );

    expect(items.find((item) => "id" in item && item.id === "edit")).toEqual({
      type: "item",
      id: "edit",
      label: "Edit",
      enabled: false,
    });
    expect(
      items.find((item) => "id" in item && item.id === "open-in-source"),
    ).toEqual({
      type: "item",
      id: "open-in-source",
      label: "Open in Jira",
      enabled: true,
    });
    expect(
      items.find((item) => "id" in item && item.id === "archive"),
    ).toMatchObject({ enabled: false, icon: "archive" });
  });
});

describe("Electron accelerators", () => {
  it("names the keys the way Electron reads them", () => {
    expect(toElectronAccelerator({ key: "d", mod: true })).toBe("CmdOrCtrl+D");
    expect(toElectronAccelerator({ key: "Backspace", shift: true })).toBe(
      "Shift+Backspace",
    );
    expect(toElectronAccelerator({ key: "ArrowUp", alt: true })).toBe("Alt+Up");
    expect(toElectronAccelerator({ key: "." })).toBe(".");
    expect(toElectronAccelerator({ key: " " })).toBe("Space");
  });
});

describe("presses that open a context menu", () => {
  const press = (button: number, pointerType: string, ctrlKey = false) => ({
    button,
    pointerType,
    ctrlKey,
  });

  it("counts the right button, Ctrl-click and a finger or pen", () => {
    expect(canPressOpenContextMenu(press(2, "mouse"))).toBe(true);
    expect(canPressOpenContextMenu(press(0, "mouse", true))).toBe(true);
    expect(canPressOpenContextMenu(press(0, "touch"))).toBe(true);
    expect(canPressOpenContextMenu(press(0, "pen"))).toBe(true);
  });

  it("leaves out a plain left click and the middle button", () => {
    expect(canPressOpenContextMenu(press(0, "mouse"))).toBe(false);
    expect(canPressOpenContextMenu(press(1, "mouse"))).toBe(false);
  });
});

describe("selected text under the pointer", () => {
  const rect = { left: 10, right: 60, top: 20, bottom: 36 };
  const selection = (isCollapsed: boolean) => ({
    isCollapsed,
    rangeCount: 1,
    getRangeAt: () => ({ getClientRects: () => [rect] }) as unknown as Range,
  });

  it("is true only on the selected text", () => {
    expect(isPointOnSelection(selection(false), 30, 28)).toBe(true);
    expect(isPointOnSelection(selection(false), 80, 28)).toBe(false);
  });

  it("is false without a selection or with only a caret", () => {
    expect(isPointOnSelection(null, 30, 28)).toBe(false);
    expect(isPointOnSelection(selection(true), 30, 28)).toBe(false);
  });
});
