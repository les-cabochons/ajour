/**
 * Native right-click menus. See "Right-click menus" under "Action model" in
 * agents/ux-spec.md.
 *
 * Two menus pop up here, both drawn by the system so they look like the
 * platform's own: an NSMenu on macOS, the system menu style on Windows and the
 * GTK theme's on Linux.
 *
 * - Object menus. The renderer sends an object's action set as plain items
 *   through `ajour:show-context-menu` and gets back the id the user picked.
 * - The edit menu. A right-click on a text field or on selected text that no
 *   object menu claimed shows Cut, Copy, Paste and Select all, after spelling
 *   suggestions and Copy link when they apply.
 *
 * The functions are pure; main.cjs pops the menus up.
 */

/**
 * @typedef {{ type: "separator" }} ContextMenuSeparator
 * @typedef {{
 *   type: "item",
 *   id: string,
 *   label: string,
 *   enabled: boolean,
 *   accelerator?: string,
 *   icon?: "trash" | "archive",
 * }} ContextMenuActionItem
 * @typedef {ContextMenuSeparator | ContextMenuActionItem} ContextMenuItem
 */

const MAX_ITEMS = 64;
const MAX_TEXT_LENGTH = 200;
const MAX_SPELLING_SUGGESTIONS = 5;

// The accelerators the renderer can send: CmdOrCtrl, Alt and Shift on a letter,
// a digit, a named key or one punctuation character.
const ACCELERATOR_PATTERN =
  /^(?:(?:CmdOrCtrl|Alt|Shift)\+){0,3}(?:[A-Z0-9]|F[1-9]|F1[0-9]|F2[0-4]|Up|Down|Left|Right|Space|Enter|Backspace|Delete|Escape|Tab|Home|End|PageUp|PageDown|Plus|[!-/:-@[-`{-~])$/;

const ICONS = new Set(["trash", "archive"]);

// SF Symbols for the icons, macOS only.
const MAC_ICON_SYMBOLS = { trash: "trash", archive: "archivebox" };

function isText(value) {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= MAX_TEXT_LENGTH
  );
}

/**
 * The items of `input` that are safe to show, from the renderer's untrusted
 * list. Separators never lead, trail or repeat. Returns an empty list when
 * `input` is not a list or holds no item.
 *
 * @param {unknown} input
 * @returns {ContextMenuItem[]}
 */
function normalizeContextMenuItems(input) {
  if (!Array.isArray(input)) {
    return [];
  }

  /** @type {ContextMenuItem[]} */
  const items = [];
  for (const candidate of input.slice(0, MAX_ITEMS)) {
    if (!candidate || typeof candidate !== "object") {
      continue;
    }

    if (candidate.type === "separator") {
      if (items.length > 0 && items.at(-1).type !== "separator") {
        items.push({ type: "separator" });
      }
      continue;
    }

    if (
      candidate.type !== "item" ||
      !isText(candidate.id) ||
      !isText(candidate.label)
    ) {
      continue;
    }

    items.push({
      type: "item",
      id: candidate.id,
      label: candidate.label,
      enabled: candidate.enabled === true,
      ...(typeof candidate.accelerator === "string" &&
      ACCELERATOR_PATTERN.test(candidate.accelerator)
        ? { accelerator: candidate.accelerator }
        : {}),
      ...(ICONS.has(candidate.icon) ? { icon: candidate.icon } : {}),
    });
  }

  while (items.at(-1)?.type === "separator") {
    items.pop();
  }
  return items;
}

/**
 * The Electron menu template for normalized `items`. Clicking an item calls
 * `onSelect` with its id.
 *
 * macOS shows `icon` before the label; Windows and Linux leave it out. A
 * disabled item is only greyed out. Accelerators only label the items: a
 * context menu never binds a key.
 *
 * @param {ContextMenuItem[]} items
 * @param {{
 *   platform: NodeJS.Platform,
 *   onSelect: (id: string) => void,
 *   getIcon?: (icon: "trash" | "archive") => Electron.NativeImage | undefined,
 * }} options
 * @returns {Electron.MenuItemConstructorOptions[]}
 */
function buildContextMenuTemplate(items, { platform, onSelect, getIcon }) {
  const isMac = platform === "darwin";
  return items.map((item) => {
    if (item.type === "separator") {
      return { type: "separator" };
    }

    const icon = isMac && item.icon ? getIcon?.(item.icon) : undefined;
    return {
      label: item.label,
      enabled: item.enabled,
      ...(item.accelerator
        ? { accelerator: item.accelerator, registerAccelerator: false }
        : {}),
      ...(icon ? { icon } : {}),
      click: () => onSelect(item.id),
    };
  });
}

/**
 * Where to pop up the menu in window coordinates, from a position in CSS
 * pixels, or undefined to use the cursor. Page zoom scales CSS pixels.
 *
 * @param {unknown} position
 * @param {number} zoomFactor
 * @returns {{ x: number, y: number } | undefined}
 */
function getPopupPosition(position, zoomFactor) {
  if (!position || typeof position !== "object") {
    return undefined;
  }

  const { x, y } = /** @type {{ x?: unknown, y?: unknown }} */ (position);
  if (
    typeof x !== "number" ||
    typeof y !== "number" ||
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    x < 0 ||
    y < 0 ||
    !Number.isFinite(zoomFactor) ||
    zoomFactor <= 0
  ) {
    return undefined;
  }

  return { x: Math.round(x * zoomFactor), y: Math.round(y * zoomFactor) };
}

function isWebLink(url) {
  try {
    const { protocol } = new URL(url);
    return protocol === "https:" || protocol === "http:";
  } catch {
    return false;
  }
}

/**
 * The edit menu for a right-click the page left alone, or an empty list when
 * there is nothing to edit or copy. `params` are the `context-menu` event's.
 * Text fields get Cut, Copy, Paste and Select all; selected text elsewhere
 * gets Copy. A misspelled word puts its suggestions first, and a link adds
 * Copy link.
 *
 * Copy on selected text outside a field calls `copySelection`, not the copy
 * role: the page treats a copy while an entry has focus as a copy of the
 * entries, so that copy must skip the page's listeners (see preload.cjs).
 *
 * @param {Pick<Electron.ContextMenuParams,
 *   "isEditable" | "editFlags" | "selectionText" | "misspelledWord" |
 *   "dictionarySuggestions" | "linkURL">} params
 * @param {{
 *   replaceMisspelling: (word: string) => void,
 *   addToDictionary: (word: string) => void,
 *   copyText: (text: string) => void,
 *   copySelection: () => void,
 * }} actions
 * @returns {Electron.MenuItemConstructorOptions[]}
 */
function buildEditContextMenuTemplate(params, actions) {
  /** @type {Electron.MenuItemConstructorOptions[]} */
  const template = [];

  if (params.isEditable && params.misspelledWord) {
    const suggestions = params.dictionarySuggestions.slice(
      0,
      MAX_SPELLING_SUGGESTIONS,
    );
    for (const suggestion of suggestions) {
      template.push({
        label: suggestion,
        click: () => actions.replaceMisspelling(suggestion),
      });
    }
    if (suggestions.length === 0) {
      template.push({ label: "No suggestions", enabled: false });
    }
    template.push(
      {
        label: "Add to dictionary",
        click: () => actions.addToDictionary(params.misspelledWord),
      },
      { type: "separator" },
    );
  }

  if (params.linkURL && isWebLink(params.linkURL)) {
    template.push(
      { label: "Copy link", click: () => actions.copyText(params.linkURL) },
      { type: "separator" },
    );
  }

  if (params.isEditable) {
    template.push(
      { role: "cut", label: "Cut", enabled: params.editFlags.canCut },
      { role: "copy", label: "Copy", enabled: params.editFlags.canCopy },
      { role: "paste", label: "Paste", enabled: params.editFlags.canPaste },
      { type: "separator" },
      {
        role: "selectAll",
        label: "Select all",
        enabled: params.editFlags.canSelectAll,
      },
    );
  } else if (params.selectionText.trim()) {
    template.push({
      label: "Copy",
      accelerator: "CmdOrCtrl+C",
      registerAccelerator: false,
      click: () => actions.copySelection(),
    });
  }

  while (template.at(-1)?.type === "separator") {
    template.pop();
  }
  return template;
}

/**
 * The renderer's object action ids (apps/web/src/domain/actions/object-actions.ts),
 * the only picked ids an event may name. context-menu.test.ts keeps it in step.
 */
const OBJECT_ACTION_IDS = new Set([
  "add",
  "add-subitem",
  "archive",
  "assign-shortcut",
  "change-source-state",
  "choose-project",
  "continue",
  "copy",
  "cut",
  "delete",
  "discard",
  "dismiss",
  "duplicate",
  "duplicate-to",
  "edit",
  "favorite",
  "forget-meeting",
  "hide-meeting",
  "mark-not-committed",
  "move-to",
  "new-entry",
  "new-task",
  "open-in-source",
  "paste",
  "pin",
  "restore",
  "settle",
  "snooze",
  "start-entry",
  "stop",
  "stop-entry",
  "unfavorite",
  "unpin",
  "unsettle",
  "unsnooze",
]);

/** A picked item's id as an event records it: a known object action, or `other`. */
function objectActionIdOf(id) {
  return OBJECT_ACTION_IDS.has(id) ? id : "other";
}

module.exports = {
  MAC_ICON_SYMBOLS,
  OBJECT_ACTION_IDS,
  objectActionIdOf,
  buildContextMenuTemplate,
  buildEditContextMenuTemplate,
  getPopupPosition,
  normalizeContextMenuItems,
};
