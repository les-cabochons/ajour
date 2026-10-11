/**
 * The keyboard shortcut registry. Key handling, the "?" overlay and the command
 * palette read it; menus and tooltips read it later. See "Keyboard" in
 * agents/ux-spec.md.
 *
 * This module is pure: it only describes shortcuts and matches key events. The
 * handlers that run them live in `lib/shortcut-handlers.tsx`.
 */

export type ShortcutPlatform = "mac" | "other";

/**
 * One key press. `key` is a lowercase letter or the character the key types,
 * such as "[" or "?". `mod` is Cmd on macOS and Ctrl elsewhere.
 */
export interface ShortcutChord {
  key: string;
  mod?: boolean;
}

/** Where a shortcut works: anywhere in the app, or only on the Time page. */
export type ShortcutScope = "global" | "time";

export type ShortcutActionId =
  | "entry.new"
  | "entry.stop-or-start"
  | "entry.continue"
  | "time.today"
  | "time.previous"
  | "time.next"
  | "time.day-view"
  | "time.week-view"
  | "go.time"
  | "go.backlog"
  | "go.projects"
  | "go.settings"
  | "app.settings"
  | "app.toggle-sidebar"
  | "app.command-palette"
  | "app.shortcuts";

export interface ShortcutDefinition {
  id: ShortcutActionId;
  label: string;
  scope: ShortcutScope;
  /** Chords pressed one after the other. Most shortcuts have one; "G then T" has two. */
  keys: readonly ShortcutChord[];
}

// Cmd+Z (Undo toast, #31) joins this list when its feature lands, so the overlay
// never lists a key that does nothing.
export const SHORTCUTS: readonly ShortcutDefinition[] = [
  {
    id: "entry.new",
    label: "New entry",
    scope: "global",
    keys: [{ key: "n" }],
  },
  {
    id: "entry.stop-or-start",
    label: "Stop the running entry, or start one",
    scope: "global",
    keys: [{ key: "s" }],
  },
  {
    id: "entry.continue",
    label: "Continue the focused or most recent entry",
    scope: "global",
    keys: [{ key: "c" }],
  },
  {
    id: "time.today",
    label: "Go to today",
    scope: "global",
    keys: [{ key: "t" }],
  },
  {
    id: "time.previous",
    label: "Previous day or week",
    scope: "time",
    keys: [{ key: "[" }],
  },
  {
    id: "time.next",
    label: "Next day or week",
    scope: "time",
    keys: [{ key: "]" }],
  },
  {
    id: "time.day-view",
    label: "Day view",
    scope: "time",
    keys: [{ key: "d" }],
  },
  {
    id: "time.week-view",
    label: "Week view",
    scope: "time",
    keys: [{ key: "w" }],
  },
  {
    id: "go.time",
    label: "Go to Time",
    scope: "global",
    keys: [{ key: "g" }, { key: "t" }],
  },
  {
    id: "go.backlog",
    label: "Go to Backlog",
    scope: "global",
    keys: [{ key: "g" }, { key: "b" }],
  },
  {
    id: "go.projects",
    label: "Go to Projects",
    scope: "global",
    keys: [{ key: "g" }, { key: "p" }],
  },
  {
    id: "go.settings",
    label: "Go to Settings",
    scope: "global",
    keys: [{ key: "g" }, { key: "s" }],
  },
  {
    id: "app.settings",
    label: "Open Settings",
    scope: "global",
    keys: [{ key: ",", mod: true }],
  },
  {
    id: "app.toggle-sidebar",
    label: "Show or hide the sidebar",
    scope: "global",
    keys: [{ key: "b", mod: true }],
  },
  {
    id: "app.command-palette",
    label: "Command palette",
    scope: "global",
    keys: [{ key: "k", mod: true }],
  },
  {
    id: "app.shortcuts",
    label: "Keyboard shortcuts",
    scope: "global",
    keys: [{ key: "?" }],
  },
];

export type ShortcutKeyEvent = Pick<
  KeyboardEvent,
  "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey"
>;

const LETTER = /^[a-z]$/;

/** True when the platform's command key is down: Cmd on macOS, Ctrl elsewhere. */
export function isModifierPress(
  event: ShortcutKeyEvent,
  platform: ShortcutPlatform,
) {
  return platform === "mac" ? event.metaKey : event.ctrlKey;
}

/**
 * Whether a key event presses `chord`. Alt and the other platform's modifier
 * never match, so Ctrl+B on macOS keeps its text binding. Letters ignore caps
 * lock but not Shift, which pinned tasks use. Symbols such as "?" or "[" ignore
 * Shift, because keyboard layouts need it to type them.
 */
export function matchesChord(
  event: ShortcutKeyEvent,
  chord: ShortcutChord,
  platform: ShortcutPlatform,
) {
  const otherModifier = platform === "mac" ? event.ctrlKey : event.metaKey;
  if (
    event.altKey ||
    otherModifier ||
    isModifierPress(event, platform) !== Boolean(chord.mod)
  ) {
    return false;
  }

  if (LETTER.test(chord.key) || chord.mod) {
    return !event.shiftKey && event.key.toLowerCase() === chord.key;
  }

  return event.key === chord.key;
}

function sameChord(left: ShortcutChord, right: ShortcutChord) {
  return left.key === right.key && Boolean(left.mod) === Boolean(right.mod);
}

export type ShortcutResolution =
  | { kind: "action"; shortcut: ShortcutDefinition }
  | { kind: "pending"; prefix: readonly ShortcutChord[] }
  | { kind: "none" };

/**
 * Resolves a key event against the shortcuts, given the chords already pressed
 * in a sequence (`prefix`). A key that does not continue the sequence starts
 * over on its own, so "G then N" still opens a new entry.
 */
export function resolveShortcut(
  shortcuts: readonly ShortcutDefinition[],
  prefix: readonly ShortcutChord[],
  event: ShortcutKeyEvent,
  platform: ShortcutPlatform,
): ShortcutResolution {
  const candidates = shortcuts.filter(
    (shortcut) =>
      shortcut.keys.length > prefix.length &&
      prefix.every((chord, index) => sameChord(chord, shortcut.keys[index]!)) &&
      matchesChord(event, shortcut.keys[prefix.length]!, platform),
  );

  const complete = candidates.find(
    (shortcut) => shortcut.keys.length === prefix.length + 1,
  );
  if (complete) {
    return { kind: "action", shortcut: complete };
  }

  const longer = candidates[0];
  if (longer) {
    return { kind: "pending", prefix: longer.keys.slice(0, prefix.length + 1) };
  }

  return prefix.length > 0
    ? resolveShortcut(shortcuts, [], event, platform)
    : { kind: "none" };
}

/** Only what the guard reads from a DOM element, so it runs in unit tests without a DOM. */
interface GuardedElement {
  tagName: string;
  isContentEditable?: boolean;
  closest(selector: string): unknown;
}

function isGuardedElement(target: unknown): target is GuardedElement {
  return (
    typeof target === "object" &&
    target !== null &&
    typeof (target as GuardedElement).tagName === "string" &&
    typeof (target as GuardedElement).closest === "function"
  );
}

const TEXT_FIELD_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);

// Menus and listboxes use letters for type-ahead, and dialogs own their keys.
const KEY_OWNER_SELECTOR =
  '[role="menu"], [role="menubar"], [role="listbox"], [role="dialog"], [role="alertdialog"]';

/**
 * True when single-key shortcuts must stay quiet for this focus target: a text
 * field (input, textarea, select or contenteditable), or an open menu, listbox
 * or dialog. Modifier shortcuts such as Cmd+B ignore this guard.
 */
export function blocksSingleKeyShortcuts(target: unknown) {
  if (!isGuardedElement(target)) {
    return false;
  }

  return (
    TEXT_FIELD_TAGS.has(target.tagName.toUpperCase()) ||
    target.isContentEditable === true ||
    target.closest(KEY_OWNER_SELECTOR) !== null
  );
}

/** The labels to show for each chord, such as ["G", "T"], ["⌘B"] or ["Ctrl+B"]. */
export function formatShortcutKeys(
  shortcut: ShortcutDefinition,
  platform: ShortcutPlatform,
) {
  return shortcut.keys.map((chord) => {
    const key = chord.key.toUpperCase();
    if (!chord.mod) {
      return key;
    }

    return platform === "mac" ? `⌘${key}` : `Ctrl+${key}`;
  });
}

/**
 * The shortcuts whose label or keys contain `query`, ignoring case, in
 * registry order. An empty query keeps them all.
 */
export function filterShortcuts(
  shortcuts: readonly ShortcutDefinition[],
  query: string,
  platform: ShortcutPlatform,
) {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return [...shortcuts];
  }

  return shortcuts.filter((shortcut) =>
    [shortcut.label, ...formatShortcutKeys(shortcut, platform)].some((text) =>
      text.toLowerCase().includes(needle),
    ),
  );
}

/**
 * The `aria-keyshortcuts` value for a one-chord shortcut, such as "Meta+B".
 * The attribute cannot describe sequences, so they return undefined.
 */
export function formatAriaKeyShortcuts(
  shortcut: ShortcutDefinition,
  platform: ShortcutPlatform,
) {
  const [chord, ...rest] = shortcut.keys;
  if (!chord || rest.length > 0) {
    return undefined;
  }

  const key = chord.key.toUpperCase();
  if (!chord.mod) {
    return key;
  }

  return platform === "mac" ? `Meta+${key}` : `Control+${key}`;
}

export function getShortcut(id: ShortcutActionId): ShortcutDefinition {
  const shortcut = SHORTCUTS.find((item) => item.id === id);
  if (!shortcut) {
    throw new Error(`No shortcut is registered for "${id}".`);
  }

  return shortcut;
}

export function getShortcutPlatform(): ShortcutPlatform {
  return typeof navigator !== "undefined" &&
    /Mac|iPhone|iPad/.test(navigator.userAgent)
    ? "mac"
    : "other";
}
