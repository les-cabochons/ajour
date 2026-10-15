import { SHORTCUTS, type ShortcutActionId } from "@/lib/shortcuts";

/**
 * What an app menu action does in the renderer. Most actions run their
 * shortcut handler. Check for updates has no key: it opens Settings General,
 * which checks on open, or asks that page to check again when it is open.
 * The sidebar density toggle has no key either.
 */
export type AppMenuCommand =
  | { kind: "shortcut"; id: ShortcutActionId }
  | { kind: "check-for-updates" }
  | { kind: "toggle-sidebar-density" };

/**
 * Validates an action id that came from the main process over IPC. Unknown ids
 * return null and do nothing.
 */
export function resolveAppMenuAction(action: unknown): AppMenuCommand | null {
  if (action === "app.check-for-updates") {
    return { kind: "check-for-updates" };
  }
  if (action === "app.toggle-sidebar-density") {
    return { kind: "toggle-sidebar-density" };
  }

  const shortcut = SHORTCUTS.find((item) => item.id === action);
  return shortcut ? { kind: "shortcut", id: shortcut.id } : null;
}

/**
 * The Windows label for an Electron accelerator, such as "Ctrl+B" for
 * "CmdOrCtrl+B". Only the Windows title bar draws these; macOS draws its own.
 */
export function formatMenuAccelerator(accelerator: string) {
  return accelerator.replace(
    /\b(CmdOrCtrl|CommandOrControl|Control)\b/g,
    "Ctrl",
  );
}
