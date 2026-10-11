import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

/**
 * The desktop app sidebar is either expanded (200px, logo and labels) or a
 * 52px icon rail. See "App shell" in agents/ux-spec.md.
 */
export type AppSidebarState = "expanded" | "rail";

/** Per-device preference. It lives outside the local app state so it is never exported or bootstrapped. */
export const APP_SIDEBAR_STORAGE_KEY = "ajour.app-sidebar";

/** Below this width the sidebar shows as the rail on its own, without touching the saved preference. */
export const APP_SIDEBAR_EXPANDED_MIN_WIDTH = 1100;

const RAIL_FORCED_QUERY = `(max-width: ${APP_SIDEBAR_EXPANDED_MIN_WIDTH - 1}px)`;

type PreferenceStorage = Pick<Storage, "getItem" | "setItem">;

export type ShortcutPlatform = "mac" | "other";

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

/** Cmd+B on macOS, Ctrl+B elsewhere. Ctrl+B on macOS stays the text "back one character" binding. */
export function isAppSidebarShortcut(
  event: Pick<
    KeyboardEvent,
    "key" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey" | "repeat"
  >,
  platform: ShortcutPlatform,
) {
  const commandKey = platform === "mac" ? event.metaKey : event.ctrlKey;
  const otherCommandKey = platform === "mac" ? event.ctrlKey : event.metaKey;
  return (
    commandKey &&
    !otherCommandKey &&
    !event.shiftKey &&
    !event.altKey &&
    !event.repeat &&
    event.key.toLowerCase() === "b"
  );
}

export function getShortcutPlatform(): ShortcutPlatform {
  return typeof navigator !== "undefined" &&
    /Mac|iPhone|iPad/.test(navigator.userAgent)
    ? "mac"
    : "other";
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
 * and the Cmd/Ctrl+B shortcut. Toggling does nothing while the rail is forced,
 * because the saved preference would change without any visible effect.
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

  useEffect(() => {
    const platform = getShortcutPlatform();
    function handleKeyDown(event: KeyboardEvent) {
      if (isAppSidebarShortcut(event, platform)) {
        event.preventDefault();
        toggle();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [toggle]);

  return { state, isRailForced, toggle };
}
