import { useCallback, useState } from "react";
import { useShortcut } from "@/lib/shortcut-handlers";
import { useIsNarrowView } from "@/lib/use-narrow-view";

/**
 * The desktop app sidebar is either expanded (logo, timer dock, navigation and
 * the work list, resizable, see `lib/sidebar-layout.ts`) or hidden. There is no
 * icon rail. It shows beside the page at every desktop width; when it is
 * hidden, the timer dock floats instead. See "App shell" and "Backlog sidebar"
 * in agents/ux-spec.md.
 */
export type AppSidebarState = "expanded" | "hidden";

/** Per-device preference. It lives outside the local app state so it is never exported or bootstrapped. */
export const APP_SIDEBAR_STORAGE_KEY = "ajour.app-sidebar";

type PreferenceStorage = Pick<Storage, "getItem" | "setItem">;

/**
 * Unknown or missing values fall back to the expanded sidebar. "rail" is the
 * collapsed state saved before the rail was removed, so it reads as hidden.
 */
export function parseAppSidebarPreference(
  value: string | null,
): AppSidebarState {
  return value === "hidden" || value === "rail" ? "hidden" : "expanded";
}

export function readAppSidebarPreference(
  storage: PreferenceStorage | undefined,
): AppSidebarState {
  try {
    return parseAppSidebarPreference(
      storage?.getItem(APP_SIDEBAR_STORAGE_KEY) ?? null,
    );
  } catch {
    // Storage can be unavailable under restrictive privacy settings.
    return "expanded";
  }
}

export function writeAppSidebarPreference(
  storage: PreferenceStorage | undefined,
  state: AppSidebarState,
) {
  try {
    storage?.setItem(APP_SIDEBAR_STORAGE_KEY, state);
  } catch {
    // The preference then only lasts for this session.
  }
}

function getLocalStorage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

/**
 * Owns the app sidebar state: the saved preference and the handler for the
 * Cmd/Ctrl+B shortcut registered in `lib/shortcuts.ts`. Toggling does nothing
 * in the narrow view, which has no sidebar, or while `suspended`, as when
 * Settings fills the left column, so the saved choice never changes out of
 * sight.
 */
export function useAppSidebar({ suspended = false } = {}) {
  const [state, setPreference] = useState(() =>
    readAppSidebarPreference(getLocalStorage()),
  );
  const isNarrow = useIsNarrowView();

  /** Shows or hides the sidebar, as dragging its edge past the minimum does. */
  const setState = useCallback((next: AppSidebarState) => {
    setPreference(next);
    writeAppSidebarPreference(getLocalStorage(), next);
  }, []);

  const toggle = useCallback(() => {
    if (suspended || isNarrow) return;
    setState(state === "expanded" ? "hidden" : "expanded");
  }, [suspended, isNarrow, state, setState]);

  useShortcut("app.toggle-sidebar", toggle, "app");

  return { state, toggle, setState };
}
