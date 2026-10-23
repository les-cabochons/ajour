import { useSyncExternalStore } from "react";
import { recordsEqual } from "@/domain/records-equal";
import { recordDeviceSettingChange } from "@/lib/preference-events";

/**
 * How the expanded sidebar lays out its backlog items, per device. See "Layout
 * options" and "Width" under "Backlog sidebar" in docs/agents/ux-spec.md. Like the
 * sidebar state, it lives outside the local app state so it is never exported.
 */
export type SidebarDensity = "comfortable" | "compact";

export interface SidebarLayout {
  density: SidebarDensity;
  /** The width the user dragged to. Missing means the density's default. */
  width?: number;
  pullRequestsOpen: boolean;
  snoozedOpen: boolean;
  settledOpen: boolean;
  /** The project the work list is filtered to. Missing means all projects. */
  projectId?: string;
}

export const SIDEBAR_LAYOUT_STORAGE_KEY = "ajour.sidebar-layout";
export const SIDEBAR_MIN_WIDTH = 200;
export const SIDEBAR_MAX_WIDTH = 400;
const DEFAULT_WIDTH: Record<SidebarDensity, number> = {
  comfortable: 272,
  compact: 200,
};

const DEFAULT_LAYOUT: SidebarLayout = {
  density: "comfortable",
  pullRequestsOpen: true,
  snoozedOpen: false,
  settledOpen: false,
};

export function clampSidebarWidth(width: number) {
  return Math.round(
    Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, width)),
  );
}

/** The width the expanded sidebar shows: the dragged width, else the density's default. */
export function resolveSidebarWidth(layout: SidebarLayout) {
  return layout.width ?? DEFAULT_WIDTH[layout.density];
}

/** Unknown or broken values fall back to the defaults, field by field. */
export function parseSidebarLayout(value: string | null): SidebarLayout {
  try {
    const parsed = value ? (JSON.parse(value) as Partial<SidebarLayout>) : {};
    return {
      density: parsed.density === "compact" ? "compact" : "comfortable",
      width:
        typeof parsed.width === "number" && Number.isFinite(parsed.width)
          ? clampSidebarWidth(parsed.width)
          : undefined,
      pullRequestsOpen: parsed.pullRequestsOpen !== false,
      snoozedOpen: parsed.snoozedOpen === true,
      settledOpen: parsed.settledOpen === true,
      projectId:
        typeof parsed.projectId === "string" && parsed.projectId
          ? parsed.projectId
          : undefined,
    };
  } catch {
    return DEFAULT_LAYOUT;
  }
}

function readLayout(): SidebarLayout {
  try {
    return parseSidebarLayout(
      window.localStorage.getItem(SIDEBAR_LAYOUT_STORAGE_KEY),
    );
  } catch {
    // Storage can be unavailable under restrictive privacy settings.
    return DEFAULT_LAYOUT;
  }
}

let layout: SidebarLayout | undefined;
/** The layout last read from or saved to storage, which a save compares with. */
let savedLayout: SidebarLayout | undefined;
const listeners = new Set<() => void>();

function getLayout() {
  if (!layout) {
    layout = readLayout();
    savedLayout = layout;
  }
  return layout;
}

/**
 * Changes the layout and saves it for this device. A drag passes
 * `save: false` on every move and calls `saveSidebarLayout` once it ends,
 * so the change is saved, and recorded, once.
 */
export function updateSidebarLayout(
  patch: Partial<SidebarLayout>,
  { save = true } = {},
) {
  layout = { ...getLayout(), ...patch };
  listeners.forEach((listener) => listener());
  if (save) saveSidebarLayout();
}

/** Writes the current layout to this device's storage, and records what changed. */
export function saveSidebarLayout() {
  const current = getLayout();
  // A drag that ends where it started, or a click on the handle, saves nothing.
  if (savedLayout && recordsEqual(savedLayout, current)) return;
  recordDeviceSettingChange("sidebar_layout", savedLayout ?? current, current, [
    "density",
  ]);
  savedLayout = current;
  try {
    window.localStorage.setItem(
      SIDEBAR_LAYOUT_STORAGE_KEY,
      JSON.stringify(current),
    );
  } catch {
    // The layout then only lasts for this session.
  }
}

export function toggleSidebarDensity() {
  updateSidebarLayout({
    density: getLayout().density === "compact" ? "comfortable" : "compact",
  });
}

export function useSidebarLayout() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getLayout,
    () => DEFAULT_LAYOUT,
  );
}
