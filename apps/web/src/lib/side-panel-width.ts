import { useSyncExternalStore } from "react";

/**
 * The widths the user dragged the side panels to, one per page, per device.
 * Like the sidebar layout, they live outside the local app state so they are
 * never exported. A page without a saved width uses the default.
 */
const SIDE_PANEL_WIDTH_KEYS = [
  "agents",
  "backlog",
  "backlog-item",
  "projects",
  "time",
] as const;

/** The page a side panel belongs to. Each page keeps its own width. */
export type SidePanelWidthKey = (typeof SIDE_PANEL_WIDTH_KEYS)[number];

export type SidePanelWidths = Partial<Record<SidePanelWidthKey, number>>;

function isSidePanelWidthKey(key: string): key is SidePanelWidthKey {
  return (SIDE_PANEL_WIDTH_KEYS as readonly string[]).includes(key);
}

export const SIDE_PANEL_WIDTHS_STORAGE_KEY = "ajour.side-panel-widths";
export const SIDE_PANEL_DEFAULT_WIDTH = 340;
export const SIDE_PANEL_MIN_WIDTH = 300;
export const SIDE_PANEL_MAX_WIDTH = 720;

/**
 * Keeps a width between the minimum and the maximum. `available` is the width
 * of the page the panel sits in: the panel never takes more than half of it,
 * which is also the CSS cap, so a drag never saves a width that cannot show.
 */
export function clampSidePanelWidth(width: number, available = Infinity) {
  const max = Math.max(
    SIDE_PANEL_MIN_WIDTH,
    Math.min(SIDE_PANEL_MAX_WIDTH, available / 2),
  );
  return Math.round(Math.min(max, Math.max(SIDE_PANEL_MIN_WIDTH, width)));
}

/** Unknown keys and broken values are dropped, page by page. */
export function parseSidePanelWidths(value: string | null): SidePanelWidths {
  try {
    const parsed: unknown = value ? JSON.parse(value) : {};
    if (!parsed || typeof parsed !== "object") return {};
    const widths: SidePanelWidths = {};
    for (const [key, width] of Object.entries(parsed)) {
      if (
        isSidePanelWidthKey(key) &&
        typeof width === "number" &&
        Number.isFinite(width)
      ) {
        widths[key] = clampSidePanelWidth(width);
      }
    }
    return widths;
  } catch {
    return {};
  }
}

let widths: SidePanelWidths | undefined;
const listeners = new Set<() => void>();

function getWidths() {
  if (widths === undefined) {
    try {
      widths = parseSidePanelWidths(
        window.localStorage.getItem(SIDE_PANEL_WIDTHS_STORAGE_KEY),
      );
    } catch {
      // Storage can be unavailable under restrictive privacy settings.
      widths = {};
    }
  }
  return widths;
}

/**
 * Sets a page's panel width, or resets it with undefined. A drag passes
 * `save: false` on every move and calls `saveSidePanelWidths` once it ends.
 */
export function setSidePanelWidth(
  key: SidePanelWidthKey,
  width: number | undefined,
  { save = true } = {},
) {
  const next = { ...getWidths() };
  if (width === undefined) delete next[key];
  else next[key] = width;
  widths = next;
  listeners.forEach((listener) => listener());
  if (save) saveSidePanelWidths();
}

/** Writes the current widths to this device's storage. */
export function saveSidePanelWidths() {
  try {
    window.localStorage.setItem(
      SIDE_PANEL_WIDTHS_STORAGE_KEY,
      JSON.stringify(getWidths()),
    );
  } catch {
    // The widths then only last for this session.
  }
}

/** The width of a page's side panel: the saved width, else the default. */
export function useSidePanelWidth(key: SidePanelWidthKey) {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => getWidths()[key] ?? SIDE_PANEL_DEFAULT_WIDTH,
    () => SIDE_PANEL_DEFAULT_WIDTH,
  );
}
