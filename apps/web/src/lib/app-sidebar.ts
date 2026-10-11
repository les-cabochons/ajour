import { useCallback, useState, useSyncExternalStore } from "react";
import { APP_SIDEBAR_EXPANDED_MIN_WIDTH } from "@/lib/breakpoints";
import { useShortcut } from "@/lib/shortcut-handlers";

/**
 * The desktop app sidebar is either expanded (200px, logo and labels) or a
 * 52px icon rail. See "App shell" in agents/ux-spec.md.
 */
export type AppSidebarState = "expanded" | "rail";

/** Per-device preference. It lives outside the local app state so it is never exported or bootstrapped. */
export const APP_SIDEBAR_STORAGE_KEY = "ajour.app-sidebar";

/**
 * Below APP_SIDEBAR_EXPANDED_MIN_WIDTH the sidebar shows as the rail on its
 * own, without touching the saved preference. The narrow view, below 768px,
 * does not render the sidebar at all.
 */
const RAIL_FORCED_QUERY = `(width < ${APP_SIDEBAR_EXPANDED_MIN_WIDTH}px)`;

type PreferenceStorage = Pick<Storage, "getItem" | "setItem">;

/** Unknown or missing values fall back to the expanded sidebar. */
export function parseAppSidebarPreference(
  value: string | null,
): AppSidebarState {
  return value === "rail" ? "rail" : "expanded";
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

/** The state the sidebar shows: the saved preference, unless the window is too narrow. */
export function resolveAppSidebarState(
  preference: AppSidebarState,
  isRailForced: boolean,
): AppSidebarState {
  return isRailForced ? "rail" : preference;
}

function getLocalStorage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

function subscribeToRailForced(onChange: () => void) {
  const mediaQuery = window.matchMedia(RAIL_FORCED_QUERY);
  mediaQuery.addEventListener("change", onChange);
  return () => mediaQuery.removeEventListener("change", onChange);
}

function getIsRailForced() {
  return window.matchMedia(RAIL_FORCED_QUERY).matches;
}

/**
 * Owns the app sidebar state: the saved preference, the narrow-window rail,
 * and the handler for the Cmd/Ctrl+B shortcut registered in `lib/shortcuts.ts`.
 * Toggling does nothing while the rail is forced, because the saved preference
 * would change without any visible effect.
 */
export function useAppSidebar() {
  const [preference, setPreference] = useState(() =>
    readAppSidebarPreference(getLocalStorage()),
  );
  const isRailForced = useSyncExternalStore(
    subscribeToRailForced,
    getIsRailForced,
    () => false,
  );
  const state = resolveAppSidebarState(preference, isRailForced);

  const toggle = useCallback(() => {
    if (isRailForced) {
      return;
    }

    const next = preference === "expanded" ? "rail" : "expanded";
    setPreference(next);
    writeAppSidebarPreference(getLocalStorage(), next);
  }, [isRailForced, preference]);

  useShortcut("app.toggle-sidebar", toggle, "app");

  return { state, isRailForced, toggle };
}
