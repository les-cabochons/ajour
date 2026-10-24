import {
  getObjectActionSections,
  type ObjectAction,
} from "@/domain/actions/object-actions";
import type { DesktopContextMenuItem } from "@/lib/desktop-bridge";
import { isTextEditingTarget } from "@/lib/entry-clipboard";
import type { ActionKeys } from "@/lib/item-keys";
import {
  CLIPBOARD_KEYS,
  getShortcut,
  isDigitChord,
  type KeyChord,
} from "@/lib/shortcuts";
import { traceCarrier } from "@/lib/wide-events";

/**
 * Native right-click menus in the desktop app. The main process draws them
 * with the system's menus (`apps/desktop/electron/context-menu.cjs`); the
 * browser keeps the Base UI menu.
 */

/** Whether right-click menus are native here: true in the desktop app. */
export function hasNativeContextMenu() {
  return (
    typeof window !== "undefined" &&
    typeof window.ajourDesktop?.showContextMenu === "function"
  );
}

/** Whether the point (x, y) lies on the selected text of `selection`. */
export function isPointOnSelection(
  selection: Pick<
    Selection,
    "isCollapsed" | "rangeCount" | "getRangeAt"
  > | null,
  x: number,
  y: number,
) {
  if (!selection || selection.isCollapsed) {
    return false;
  }

  for (let index = 0; index < selection.rangeCount; index += 1) {
    for (const rect of selection.getRangeAt(index).getClientRects()) {
      if (
        x >= rect.left &&
        x <= rect.right &&
        y >= rect.top &&
        y <= rect.bottom
      ) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Whether a press can open a context menu: the right button, Ctrl-click on
 * macOS, or a finger or pen, whose long press does.
 */
export function canPressOpenContextMenu(press: {
  button: number;
  ctrlKey: boolean;
  pointerType: string;
}) {
  return (
    press.button === 2 ||
    (press.button === 0 &&
      (press.ctrlKey ||
        press.pointerType === "touch" ||
        press.pointerType === "pen"))
  );
}

let menuPressOnSelectedText = false;
let trackingMenuPresses = false;

/**
 * Starts noting whether each press that can open a context menu lands on
 * selected text. The press is the moment to look, because macOS selects the
 * word under the pointer before `contextmenu` fires. Every other press and
 * every key press clear the note, so a menu opened another way never reads an
 * old one.
 */
export function trackMenuPresses() {
  if (trackingMenuPresses) return;
  trackingMenuPresses = true;
  document.addEventListener(
    "pointerdown",
    (event) => {
      menuPressOnSelectedText =
        canPressOpenContextMenu(event) &&
        isPointOnSelection(window.getSelection(), event.clientX, event.clientY);
    },
    true,
  );
  document.addEventListener(
    "keydown",
    () => {
      menuPressOnSelectedText = false;
    },
    true,
  );
}

/**
 * Whether a `contextmenu` event belongs to the system's edit menu rather than
 * an object's: it lands in a text field, or its press landed on selected text.
 * Only the desktop app has that menu. Menus opened from code, such as by the
 * "." key or a handler that forwards the event, always list the object, so
 * handlers that forward one ask before forwarding.
 */
export function leavesContextMenuToSystem(event: {
  target: EventTarget | null;
  isTrusted: boolean;
}) {
  return (
    hasNativeContextMenu() &&
    event.isTrusted &&
    (isTextEditingTarget(event.target) || menuPressOnSelectedText)
  );
}

const ELECTRON_KEY_NAMES: Record<string, string> = {
  ArrowUp: "Up",
  ArrowDown: "Down",
  ArrowLeft: "Left",
  ArrowRight: "Right",
  " ": "Space",
  "+": "Plus",
};

/** The Electron accelerator for `chord`, such as "CmdOrCtrl+D" or "Shift+Backspace". */
export function toElectronAccelerator(chord: KeyChord) {
  const key =
    ELECTRON_KEY_NAMES[chord.key] ??
    (chord.key.length === 1 ? chord.key.toUpperCase() : chord.key);
  return [
    chord.mod && "CmdOrCtrl",
    chord.alt && "Alt",
    chord.shift && "Shift",
    key,
  ]
    .filter(Boolean)
    .join("+");
}

/**
 * The key a menu shows for `action`: the system's for Cut, Copy and Paste, else
 * its shortcut when that is one chord. Sequences and digit ranges have no
 * native label.
 */
function getActionChord<Id extends string>(
  action: ObjectAction<Id>,
  keys: ActionKeys<Id> | undefined,
): KeyChord | undefined {
  if (action.clipboard) {
    return CLIPBOARD_KEYS[action.clipboard];
  }

  const shortcutId = keys?.[action.id];
  if (!shortcutId) {
    return undefined;
  }

  const [chord, ...rest] = getShortcut(shortcutId).keys;
  return chord && rest.length === 0 && !isDigitChord(chord) ? chord : undefined;
}

/**
 * An action set as native menu items: a separator between its sections, the
 * action's key, and an icon on destructive actions: a box for Archive and a bin
 * for the others. A disabled action is only greyed out, and hints stay out:
 * native items have one line.
 */
export function toNativeContextMenuItems<Id extends string>(
  actions: readonly ObjectAction<Id>[],
  keys?: ActionKeys<Id>,
): DesktopContextMenuItem[] {
  return getObjectActionSections(actions).flatMap((section, index) => [
    ...(index > 0 ? [{ type: "separator" as const }] : []),
    ...section.map((action): DesktopContextMenuItem => {
      const chord = getActionChord(action, keys);
      return {
        type: "item",
        id: action.id,
        label: action.label,
        enabled: !action.disabledReason,
        ...(chord ? { accelerator: toElectronAccelerator(chord) } : {}),
        ...(action.destructive
          ? { icon: action.id === "archive" ? "archive" : "trash" }
          : {}),
      };
    }),
  ]);
}

/**
 * Pops up the native menu for `actions` at `position`, in CSS pixels, and
 * resolves with the picked action's id, or null when the menu closed without a
 * pick. A disabled action is never returned.
 */
export async function showNativeContextMenu<Id extends string>(
  actions: readonly ObjectAction<Id>[],
  keys: ActionKeys<Id> | undefined,
  position: { x: number; y: number },
): Promise<Id | null> {
  const show = window.ajourDesktop?.showContextMenu;
  if (!show || actions.length === 0) {
    return null;
  }

  try {
    const pickedId = await show(
      toNativeContextMenuItems(actions, keys),
      position,
      traceCarrier(),
    );
    return (
      actions.find((action) => action.id === pickedId && !action.disabledReason)
        ?.id ?? null
    );
  } catch {
    return null;
  }
}
