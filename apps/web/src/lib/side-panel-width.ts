import { useSyncExternalStore } from "react";

/**
 * The width the user dragged a resizable side panel to, per device. Like the
 * sidebar layout, it lives outside the local app state so it is never exported.
 * The panel's CSS still caps it at half the page.
 */
export const SIDE_PANEL_WIDTH_STORAGE_KEY = "ajour.side-panel-width";
export const SIDE_PANEL_DEFAULT_WIDTH = 340;
export const SIDE_PANEL_MIN_WIDTH = 300;
export const SIDE_PANEL_MAX_WIDTH = 720;

export function clampSidePanelWidth(width: number) {
  return Math.round(
    Math.min(SIDE_PANEL_MAX_WIDTH, Math.max(SIDE_PANEL_MIN_WIDTH, width)),
  );
}

/** Unknown or broken values fall back to the default width. */
export function parseSidePanelWidth(value: string | null) {
  const width = Number(value);
  return value && Number.isFinite(width)
    ? clampSidePanelWidth(width)
    : SIDE_PANEL_DEFAULT_WIDTH;
}

let width: number | undefined;
const listeners = new Set<() => void>();

function getWidth() {
  if (width === undefined) {
    try {
      width = parseSidePanelWidth(
        window.localStorage.getItem(SIDE_PANEL_WIDTH_STORAGE_KEY),
      );
    } catch {
      // Storage can be unavailable under restrictive privacy settings.
      width = SIDE_PANEL_DEFAULT_WIDTH;
    }
  }
  return width;
}

/** Sets the width and saves it for this device. Undefined resets it. */
export function setSidePanelWidth(next: number | undefined) {
  width =
    next === undefined ? SIDE_PANEL_DEFAULT_WIDTH : clampSidePanelWidth(next);
  try {
    if (next === undefined) {
      window.localStorage.removeItem(SIDE_PANEL_WIDTH_STORAGE_KEY);
    } else {
      window.localStorage.setItem(SIDE_PANEL_WIDTH_STORAGE_KEY, String(width));
    }
  } catch {
    // The width then only lasts for this session.
  }
  listeners.forEach((listener) => listener());
}

export function useSidePanelWidth() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getWidth,
    () => SIDE_PANEL_DEFAULT_WIDTH,
  );
}
