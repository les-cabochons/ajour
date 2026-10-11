import { describe, expect, it } from "vitest";
import {
  SHORTCUTS,
  blocksDigitShortcuts,
  blocksSingleKeyShortcuts,
  filterShortcuts,
  formatAriaKeyShortcuts,
  formatShortcutKeys,
  getShortcut,
  isDigitChord,
  matchesChord,
  resolveShortcut,
  type ShortcutChord,
  type ShortcutKeyEvent,
} from "./shortcuts";

/** A number key on the top row. `key` is what the layout types, such as "!" with Shift. */
function pressDigit(
  code: string,
  key: string,
  modifiers: Partial<ShortcutKeyEvent> = {},
) {
  return press(key, { code, ...modifiers });
}

function press(key: string, modifiers: Partial<ShortcutKeyEvent> = {}) {
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

function resolvedId(
  event: ShortcutKeyEvent,
  prefix = [] as { key: string; mod?: boolean }[],
  platform: "mac" | "other" = "mac",
) {
  const resolution = resolveShortcut(SHORTCUTS, prefix, event, platform);
  return resolution.kind === "action" ? resolution.shortcut.id : resolution;
}

/** A stand-in for a focused DOM element; `inside` lists the selectors it sits within. */
function element(
  tagName: string,
  { inside = [] as string[], isContentEditable = false } = {},
) {
  return {
    tagName,
    isContentEditable,
    closest: (selector: string) =>
      inside.some((role) => selector.includes(role)) ? {} : null,
  };
}

describe("shortcut registry", () => {
  it("lists every global key from the UX spec once", () => {
    const keys = SHORTCUTS.map((shortcut) =>
      formatShortcutKeys(shortcut, "mac").join(" then "),
    );
    expect(keys).toEqual([
      "N",
      "S",
      "C",
      "T",
      "[",
      "]",
      "D",
      "W",
      "G then T",
      "G then B",
      "G then P",
      "G then S",
      "⌘,",
      "⌘B",
      "⌘K",
      "?",
      "1 to 0",
      "⇧1 to ⇧0",
    ]);
    expect(new Set(SHORTCUTS.map((shortcut) => shortcut.id)).size).toBe(
      SHORTCUTS.length,
    );
  });

  it("never uses the first key of a sequence as a shortcut on its own", () => {
    const keyOf = (chord: ShortcutChord) =>
      isDigitChord(chord) ? undefined : chord;
    const sequenceStarts = SHORTCUTS.filter(
      (shortcut) => shortcut.keys.length > 1,
    ).map((shortcut) => keyOf(shortcut.keys[0]!)?.key);
    const singleKeys = SHORTCUTS.filter(
      (shortcut) =>
        shortcut.keys.length === 1 && !keyOf(shortcut.keys[0]!)?.mod,
    ).map((shortcut) => keyOf(shortcut.keys[0]!)?.key);

    expect(sequenceStarts.filter((key) => singleKeys.includes(key))).toEqual(
      [],
    );
  });

  it("formats the sidebar toggle for tooltips and aria-keyshortcuts", () => {
    const toggle = getShortcut("app.toggle-sidebar");
    expect(formatShortcutKeys(toggle, "mac")).toEqual(["⌘B"]);
    expect(formatShortcutKeys(toggle, "other")).toEqual(["Ctrl+B"]);
    expect(formatAriaKeyShortcuts(toggle, "mac")).toBe("Meta+B");
    expect(formatAriaKeyShortcuts(toggle, "other")).toBe("Control+B");
    expect(
      formatAriaKeyShortcuts(getShortcut("go.time"), "mac"),
    ).toBeUndefined();
  });

  it("filters by label or key, ignoring case", () => {
    const ids = (query: string) =>
      filterShortcuts(SHORTCUTS, query, "mac").map((shortcut) => shortcut.id);

    expect(ids("")).toHaveLength(SHORTCUTS.length);
    expect(ids("sidebar")).toEqual(["app.toggle-sidebar"]);
    expect(ids("⌘")).toEqual([
      "app.settings",
      "app.toggle-sidebar",
      "app.command-palette",
    ]);
    expect(ids("BACKLOG")).toEqual(["go.backlog"]);
    expect(ids("nothing like this")).toEqual([]);
  });
});

describe("matchesChord", () => {
  it("uses Cmd on macOS and Ctrl elsewhere", () => {
    const chord = { key: "b", mod: true };
    expect(matchesChord(press("b", { metaKey: true }), chord, "mac")).toBe(
      true,
    );
    expect(matchesChord(press("b", { ctrlKey: true }), chord, "mac")).toBe(
      false,
    );
    expect(matchesChord(press("b", { ctrlKey: true }), chord, "other")).toBe(
      true,
    );
    expect(matchesChord(press("b", { metaKey: true }), chord, "other")).toBe(
      false,
    );
  });

  it("ignores caps lock on letters but not Shift, Alt or a missing modifier", () => {
    const chord = { key: "n" };
    expect(matchesChord(press("N"), chord, "mac")).toBe(true);
    expect(matchesChord(press("N", { shiftKey: true }), chord, "mac")).toBe(
      false,
    );
    expect(matchesChord(press("n", { altKey: true }), chord, "mac")).toBe(
      false,
    );
    expect(matchesChord(press("n", { metaKey: true }), chord, "mac")).toBe(
      false,
    );
    expect(
      matchesChord(
        press("b", { metaKey: true, shiftKey: true }),
        {
          key: "b",
          mod: true,
        },
        "mac",
      ),
    ).toBe(false);
  });

  it("accepts Shift on symbols that need it, such as ?", () => {
    expect(
      matchesChord(press("?", { shiftKey: true }), { key: "?" }, "mac"),
    ).toBe(true);
    expect(matchesChord(press("/"), { key: "?" }, "mac")).toBe(false);
  });
});

describe("resolveShortcut", () => {
  it("resolves single keys and modifier shortcuts", () => {
    expect(resolvedId(press("n"))).toBe("entry.new");
    expect(resolvedId(press("]"))).toBe("time.next");
    expect(resolvedId(press(",", { metaKey: true }))).toBe("app.settings");
    expect(resolvedId(press("b", { ctrlKey: true }), [], "other")).toBe(
      "app.toggle-sidebar",
    );
    expect(resolvedId(press("x"))).toEqual({ kind: "none" });
  });

  it("waits for the second key of G sequences", () => {
    expect(resolvedId(press("g"))).toEqual({
      kind: "pending",
      prefix: [{ key: "g" }],
    });
    expect(resolvedId(press("t"), [{ key: "g" }])).toBe("go.time");
    expect(resolvedId(press("s"), [{ key: "g" }])).toBe("go.settings");
    expect(resolvedId(press("t"))).toBe("time.today");
  });

  it("starts over when the next key does not continue the sequence", () => {
    expect(resolvedId(press("n"), [{ key: "g" }])).toBe("entry.new");
    expect(resolvedId(press("x"), [{ key: "g" }])).toEqual({ kind: "none" });
  });
});

describe("blocksSingleKeyShortcuts", () => {
  it("blocks text fields", () => {
    expect(blocksSingleKeyShortcuts(element("INPUT"))).toBe(true);
    expect(blocksSingleKeyShortcuts(element("TEXTAREA"))).toBe(true);
    expect(blocksSingleKeyShortcuts(element("SELECT"))).toBe(true);
    expect(
      blocksSingleKeyShortcuts(element("DIV", { isContentEditable: true })),
    ).toBe(true);
  });

  it("blocks menus, listboxes and dialogs, which own their keys", () => {
    expect(
      blocksSingleKeyShortcuts(element("DIV", { inside: ['"menu"'] })),
    ).toBe(true);
    expect(
      blocksSingleKeyShortcuts(element("BUTTON", { inside: ['"dialog"'] })),
    ).toBe(true);
    expect(
      blocksSingleKeyShortcuts(element("DIV", { inside: ['"listbox"'] })),
    ).toBe(true);
  });

  it("lets buttons, rows and the page body through", () => {
    expect(blocksSingleKeyShortcuts(element("BUTTON"))).toBe(false);
    expect(blocksSingleKeyShortcuts(element("TR"))).toBe(false);
    expect(blocksSingleKeyShortcuts(element("BODY"))).toBe(false);
    expect(blocksSingleKeyShortcuts(null)).toBe(false);
  });
});

describe("pinned task digits", () => {
  function resolveDigit(event: ShortcutKeyEvent) {
    const resolution = resolveShortcut(SHORTCUTS, [], event, "mac");
    return resolution.kind === "action"
      ? { id: resolution.shortcut.id, digit: resolution.digit }
      : resolution;
  }

  it("opens a new entry on a digit and starts on Shift+digit", () => {
    expect(resolveDigit(pressDigit("Digit3", "3"))).toEqual({
      id: "pinned.new-entry",
      digit: "3",
    });
    expect(resolveDigit(pressDigit("Digit0", ")", { shiftKey: true }))).toEqual(
      { id: "pinned.start", digit: "0" },
    );
  });

  it("matches the physical key, whatever the layout types", () => {
    // French AZERTY types "&" on the 1 key and needs Shift for the digit.
    expect(resolveDigit(pressDigit("Digit1", "&"))).toEqual({
      id: "pinned.new-entry",
      digit: "1",
    });
    expect(resolveDigit(pressDigit("Digit1", "1", { shiftKey: true }))).toEqual(
      { id: "pinned.start", digit: "1" },
    );
  });

  it("ignores the numeric keypad and modified digits", () => {
    expect(resolveDigit(pressDigit("Numpad1", "1"))).toEqual({
      kind: "none",
    });
    expect(resolveDigit(pressDigit("Digit1", "1", { metaKey: true }))).toEqual({
      kind: "none",
    });
    expect(resolveDigit(pressDigit("Digit1", "¡", { altKey: true }))).toEqual({
      kind: "none",
    });
  });

  it("starts the pinned task on Shift+6 even where it types ?", () => {
    // Canadian French layouts type "?" with Shift+6.
    expect(resolveDigit(pressDigit("Digit6", "?", { shiftKey: true }))).toEqual(
      { id: "pinned.start", digit: "6" },
    );
    // US layouts type "?" with Shift+Slash, which still opens the list.
    expect(resolveDigit(pressDigit("Slash", "?", { shiftKey: true }))).toEqual({
      id: "app.shortcuts",
      digit: undefined,
    });
  });

  it("stays quiet while focus is on a Week Grid cell", () => {
    expect(
      blocksDigitShortcuts(element("BUTTON", { inside: ["data-grid-cell"] })),
    ).toBe(true);
    expect(blocksDigitShortcuts(element("BUTTON"))).toBe(false);
    expect(blocksDigitShortcuts(null)).toBe(false);
  });
});
