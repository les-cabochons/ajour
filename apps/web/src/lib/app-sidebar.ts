import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { APP_SIDEBAR_EXPANDED_MIN_WIDTH } from "@/lib/breakpoints";
import { useShortcut } from "@/lib/shortcut-handlers";

/**
 * The desktop app sidebar is either expanded (logo, timer dock, navigation and
 * the work list, resizable, see `lib/sidebar-layout.ts`) or hidden. There is no
 * icon rail. See "App shell" and "Backlog sidebar" in agents/ux-spec.md.
 */
export type AppSidebarState = "expanded" | "hidden";

/**
 * Where the sidebar shows: beside the page, over the page (narrow desktop
 * windows), or nowhere. When it is nowhere, the timer dock floats instead.
 */
export type AppSidebarDisplay = "inline" | "overlay" | "none";

/** Per-device preference. It lives outside the local app state so it is never exported or bootstrapped. */
export const APP_SIDEBAR_STORAGE_KEY = "ajour.app-sidebar";

/**
 * Below APP_SIDEBAR_EXPANDED_MIN_WIDTH the sidebar hides on its own, without
 * touching the saved preference, and the toggle opens it over the page. The
 * narrow view, below 768px, does not render the sidebar at all.
 */
const HIDDEN_FORCED_QUERY = `(width < ${APP_SIDEBAR_EXPANDED_MIN_WIDTH}px)`;

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

/**
 * Where the sidebar shows: the saved preference at wide widths. When the window
 * is too narrow it only shows over the page, while the user has opened it.
 */
export function resolveAppSidebarDisplay(
  preference: AppSidebarState,
  isHiddenForced: boolean,
  isOverlayOpen: boolean,
): AppSidebarDisplay {
  if (isHiddenForced) return isOverlayOpen ? "overlay" : "none";
  return preference === "expanded" ? "inline" : "none";
}

function getLocalStorage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

function subscribeToHiddenForced(onChange: () => void) {
  const mediaQuery = window.matchMedia(HIDDEN_FORCED_QUERY);
  mediaQuery.addEventListener("change", onChange);
  return () => mediaQuery.removeEventListener("change", onChange);
}

function getIsHiddenForced() {
  return window.matchMedia(HIDDEN_FORCED_QUERY).matches;
}

/**
 * Owns the app sidebar state: the saved preference, the narrow-window overlay,
 * and the handler for the Cmd/Ctrl+B shortcut registered in `lib/shortcuts.ts`.
 * While the window is too narrow, toggling opens or closes the overlay and
 * leaves the saved preference alone.
 */
export function useAppSidebar() {
  const [preference, setPreference] = useState(() =>
    readAppSidebarPreference(getLocalStorage()),
  );
  const [isOverlayOpen, setIsOverlayOpen] = useState(false);
  const isHiddenForced = useSyncExternalStore(
    subscribeToHiddenForced,
    getIsHiddenForced,
    () => false,
  );
  // Crossing the breakpoint closes the overlay, so narrowing the window again
  // starts with the sidebar hidden.
  useEffect(() => setIsOverlayOpen(false), [isHiddenForced]);
  const display = resolveAppSidebarDisplay(
    preference,
    isHiddenForced,
    isOverlayOpen,
  );

  /** Shows or hides the inline sidebar, as dragging its edge past the minimum does. */
  const setState = useCallback(
    (next: AppSidebarState) => {
      if (isHiddenForced) {
        setIsOverlayOpen(next === "expanded");
        return;
      }

      setPreference(next);
      writeAppSidebarPreference(getLocalStorage(), next);
    },
    [isHiddenForced],
  );

  const toggle = useCallback(() => {
    if (isHiddenForced) {
      setIsOverlayOpen((open) => !open);
    } else {
      setState(preference === "expanded" ? "hidden" : "expanded");
    }
  }, [isHiddenForced, preference, setState]);

  const closeOverlay = useCallback(() => setIsOverlayOpen(false), []);

  useShortcut("app.toggle-sidebar", toggle, "app");

  return { display, isHiddenForced, toggle, setState, closeOverlay };
}
