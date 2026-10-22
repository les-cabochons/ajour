import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

type ContextMenuItem =
  | { type: "separator" }
  | {
      type: "item";
      id: string;
      label: string;
      enabled: boolean;
      accelerator?: string;
      icon?: "trash" | "archive";
    };

interface TemplateItem {
  type?: string;
  role?: string;
  label?: string;
  toolTip?: string;
  enabled?: boolean;
  accelerator?: string;
  registerAccelerator?: boolean;
  icon?: unknown;
  click?: () => void;
}

interface EditParams {
  isEditable: boolean;
  editFlags: {
    canCut: boolean;
    canCopy: boolean;
    canPaste: boolean;
    canSelectAll: boolean;
  };
  selectionText: string;
  misspelledWord: string;
  dictionarySuggestions: string[];
  linkURL: string;
}

const require = createRequire(import.meta.url);
const {
  buildContextMenuTemplate,
  buildEditContextMenuTemplate,
  getPopupPosition,
  normalizeContextMenuItems,
} = require("./electron/context-menu.cjs") as {
  buildContextMenuTemplate: (
    items: ContextMenuItem[],
    options: {
      platform: NodeJS.Platform;
      onSelect: (id: string) => void;
      getIcon?: (icon: "trash" | "archive") => unknown;
    },
  ) => TemplateItem[];
  buildEditContextMenuTemplate: (
    params: EditParams,
    actions: {
      replaceMisspelling: (word: string) => void;
      addToDictionary: (word: string) => void;
      copyText: (text: string) => void;
      copySelection: () => void;
    },
  ) => TemplateItem[];
  getPopupPosition: (
    position: unknown,
    zoomFactor: number,
  ) => { x: number; y: number } | undefined;
  normalizeContextMenuItems: (input: unknown) => ContextMenuItem[];
};

const editFlags = {
  canCut: true,
  canCopy: true,
  canPaste: true,
  canSelectAll: true,
};

function editParams(overrides: Partial<EditParams> = {}): EditParams {
  return {
    isEditable: false,
    editFlags,
    selectionText: "",
    misspelledWord: "",
    dictionarySuggestions: [],
    linkURL: "",
    ...overrides,
  };
}

const noEditActions = {
  replaceMisspelling: () => undefined,
  addToDictionary: () => undefined,
  copyText: () => undefined,
  copySelection: () => undefined,
};

/** Each template item as its label or role, with "-" for separators. */
function outline(template: TemplateItem[]) {
  return template.map((item) =>
    item.type === "separator" ? "-" : (item.label ?? item.role),
  );
}

describe("object context menu items", () => {
  it("keeps the renderer's valid items and drops malformed ones", () => {
    expect(
      normalizeContextMenuItems([
        { type: "separator" },
        { type: "item", id: "edit", label: "Edit", enabled: true },
        { type: "separator" },
        { type: "separator" },
        { type: "item", id: "", label: "No id", enabled: true },
        { type: "item", id: "x", label: 42, enabled: true },
        "copy",
        null,
        {
          type: "item",
          id: "delete",
          label: "Delete",
          enabled: "yes",
          hint: "Ctrl-click or Cmd-click",
          accelerator: "Backspace",
          icon: "skull",
        },
        { type: "separator" },
      ]),
    ).toEqual([
      { type: "item", id: "edit", label: "Edit", enabled: true },
      { type: "separator" },
      {
        type: "item",
        id: "delete",
        label: "Delete",
        enabled: false,
        accelerator: "Backspace",
      },
    ]);
    expect(normalizeContextMenuItems("menu")).toEqual([]);
  });

  it("accepts the accelerators the renderer builds and rejects others", () => {
    const accelerators = [
      "CmdOrCtrl+X",
      "Shift+Backspace",
      "Alt+Up",
      "Enter",
      "M",
      ".",
      "Ctrl+Q",
      "CmdOrCtrl+Alt+Shift+Delete+X",
      "Return",
    ];
    const items = normalizeContextMenuItems(
      accelerators.map((accelerator, index) => ({
        type: "item",
        id: `item-${index}`,
        label: "Item",
        enabled: true,
        accelerator,
      })),
    );

    expect(
      items.map((item) => "accelerator" in item && item.accelerator),
    ).toEqual([
      "CmdOrCtrl+X",
      "Shift+Backspace",
      "Alt+Up",
      "Enter",
      "M",
      ".",
      false,
      false,
      false,
    ]);
  });

  it("keeps a whole running entry menu as the web app sends it", () => {
    // From toNativeContextMenuItems in apps/web/src/lib/native-context-menu.ts.
    const sent: ContextMenuItem[] = [
      {
        type: "item",
        id: "edit",
        label: "Edit",
        enabled: true,
        accelerator: "Enter",
      },
      {
        type: "item",
        id: "stop",
        label: "Stop",
        enabled: true,
        accelerator: "S",
      },
      { type: "separator" },
      {
        type: "item",
        id: "cut",
        label: "Cut",
        enabled: false,
        accelerator: "CmdOrCtrl+X",
      },
      {
        type: "item",
        id: "copy",
        label: "Copy",
        enabled: false,
        accelerator: "CmdOrCtrl+C",
      },
      {
        type: "item",
        id: "paste",
        label: "Paste",
        enabled: false,
        accelerator: "CmdOrCtrl+V",
      },
      { type: "separator" },
      {
        type: "item",
        id: "duplicate",
        label: "Duplicate",
        enabled: false,
        accelerator: "CmdOrCtrl+D",
      },
      {
        type: "item",
        id: "move-to",
        label: "Move to…",
        enabled: false,
        accelerator: "M",
      },
      { type: "separator" },
      {
        type: "item",
        id: "discard",
        label: "Discard",
        enabled: true,
        accelerator: "Backspace",
        icon: "trash",
      },
    ];

    expect(normalizeContextMenuItems(sent)).toEqual(sent);
  });

  it("greys out disabled items and shows icons on macOS only", () => {
    const items: ContextMenuItem[] = [
      {
        type: "item",
        id: "duplicate",
        label: "Duplicate",
        enabled: false,
        accelerator: "CmdOrCtrl+D",
      },
      {
        type: "item",
        id: "open-in-source",
        label: "Open in Jira",
        enabled: true,
      },
      { type: "separator" },
      {
        type: "item",
        id: "delete",
        label: "Delete",
        enabled: true,
        icon: "trash",
      },
    ];
    const icon = { name: "trash" };
    const mac = buildContextMenuTemplate(items, {
      platform: "darwin",
      onSelect: () => undefined,
      getIcon: () => icon,
    });
    const windows = buildContextMenuTemplate(items, {
      platform: "win32",
      onSelect: () => undefined,
      getIcon: () => icon,
    });

    expect(mac[0]).toMatchObject({
      label: "Duplicate",
      enabled: false,
      accelerator: "CmdOrCtrl+D",
      registerAccelerator: false,
    });
    expect(mac[1]).toMatchObject({ label: "Open in Jira", enabled: true });
    expect(mac[3]).toMatchObject({ label: "Delete", icon });
    expect(windows[0]).toMatchObject({ label: "Duplicate", enabled: false });
    expect(windows[1]).toMatchObject({ label: "Open in Jira" });
    expect(windows[3]).not.toHaveProperty("icon");
    expect(outline(windows)).toEqual([
      "Duplicate",
      "Open in Jira",
      "-",
      "Delete",
    ]);
  });

  it("reports the clicked item's id", () => {
    const onSelect = vi.fn();
    const template = buildContextMenuTemplate(
      [{ type: "item", id: "settle", label: "Settle", enabled: true }],
      { platform: "linux", onSelect },
    );

    template[0]?.click?.();

    expect(onSelect).toHaveBeenCalledWith("settle");
  });

  it("scales the position with page zoom and ignores bad positions", () => {
    expect(getPopupPosition({ x: 100, y: 40.6 }, 1.25)).toEqual({
      x: 125,
      y: 51,
    });
    expect(getPopupPosition({ x: -1, y: 4 }, 1)).toBeUndefined();
    expect(getPopupPosition({ x: Number.NaN, y: 4 }, 1)).toBeUndefined();
    expect(getPopupPosition(undefined, 1)).toBeUndefined();
  });
});

describe("edit context menu", () => {
  it("offers Cut, Copy, Paste and Select all in a text field", () => {
    const template = buildEditContextMenuTemplate(
      editParams({
        isEditable: true,
        editFlags: { ...editFlags, canCut: false, canCopy: false },
      }),
      noEditActions,
    );

    expect(outline(template)).toEqual([
      "Cut",
      "Copy",
      "Paste",
      "-",
      "Select all",
    ]);
    expect(template.map((item) => item.role)).toEqual([
      "cut",
      "copy",
      "paste",
      undefined,
      "selectAll",
    ]);
    expect(template.map((item) => item.enabled)).toEqual([
      false,
      false,
      true,
      undefined,
      true,
    ]);
  });

  it("offers Copy for selected text outside a field, and nothing without it", () => {
    const copySelection = vi.fn();
    const template = buildEditContextMenuTemplate(
      editParams({ selectionText: "Admin" }),
      { ...noEditActions, copySelection },
    );

    expect(outline(template)).toEqual(["Copy"]);
    // Not the copy role, whose copy event the page takes for the focused entries.
    expect(template[0]).not.toHaveProperty("role");
    template[0]?.click?.();
    expect(copySelection).toHaveBeenCalledOnce();
    expect(
      buildEditContextMenuTemplate(
        editParams({ selectionText: "  " }),
        noEditActions,
      ),
    ).toEqual([]);
  });

  it("puts spelling suggestions first and replaces the word with the one picked", () => {
    const replaceMisspelling = vi.fn();
    const addToDictionary = vi.fn();
    const template = buildEditContextMenuTemplate(
      editParams({
        isEditable: true,
        misspelledWord: "meetng",
        dictionarySuggestions: ["meeting", "meeting's"],
      }),
      { ...noEditActions, replaceMisspelling, addToDictionary },
    );

    expect(outline(template)).toEqual([
      "meeting",
      "meeting's",
      "Add to dictionary",
      "-",
      "Cut",
      "Copy",
      "Paste",
      "-",
      "Select all",
    ]);
    template[0]?.click?.();
    template[2]?.click?.();
    expect(replaceMisspelling).toHaveBeenCalledWith("meeting");
    expect(addToDictionary).toHaveBeenCalledWith("meetng");
  });

  it("adds Copy link on web links only", () => {
    const copyText = vi.fn();
    const template = buildEditContextMenuTemplate(
      editParams({ linkURL: "https://example.com/item/1" }),
      { ...noEditActions, copyText },
    );

    expect(outline(template)).toEqual(["Copy link"]);
    template[0]?.click?.();
    expect(copyText).toHaveBeenCalledWith("https://example.com/item/1");
    expect(
      buildEditContextMenuTemplate(
        editParams({ linkURL: "file:///etc/passwd" }),
        noEditActions,
      ),
    ).toEqual([]);
  });
});

describe("the picked action as an event records it", () => {
  const { OBJECT_ACTION_IDS, objectActionIdOf } =
    require("./electron/context-menu.cjs") as {
      OBJECT_ACTION_IDS: ReadonlySet<string>;
      objectActionIdOf: (id: unknown) => string;
    };

  it("keeps a known object action and names anything else other", () => {
    expect(
      [
        "settle",
        "move-to",
        "https://private.example/secret",
        "",
        undefined,
      ].map(objectActionIdOf),
    ).toEqual(["settle", "move-to", "other", "other", "other"]);
  });

  // The set follows the renderer's object actions, so a new action is named
  // in events as soon as it ships.
  it("knows every object action the renderer declares", async () => {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(
      new URL("../web/src/domain/actions/object-actions.ts", import.meta.url),
      "utf8",
    );
    const declared = new Set<string>();
    for (const [, union] of source.matchAll(
      /export type \w+ActionId =([^;]+);/g,
    )) {
      for (const [, id] of union!.matchAll(/"([^"]+)"/g)) declared.add(id!);
    }

    expect(declared.size).toBeGreaterThan(20);
    expect([...declared].sort()).toEqual([...OBJECT_ACTION_IDS].sort());
  });
});
