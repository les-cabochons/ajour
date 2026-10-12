import { useSyncExternalStore } from "react";
import {
  DEFAULT_BACKLOG_VIEW_SETTINGS,
  type BacklogFilter,
  type BacklogFilterField,
  type BacklogProperty,
  type BacklogViewSettings,
} from "@/domain/backlog/backlog-view";

/**
 * The Backlog page's display options and filters, per device. Like the
 * sidebar layout, they live outside the local app state, so they are never
 * exported. The ordering is not here: it is in local state, shared with the
 * sidebar.
 */
export interface BacklogViewPreferences extends BacklogViewSettings {
  filters: BacklogFilter[];
}

export const BACKLOG_VIEW_STORAGE_KEY = "ajour.backlog-view";

const DEFAULT_PREFERENCES: BacklogViewPreferences = {
  ...DEFAULT_BACKLOG_VIEW_SETTINGS,
  filters: [],
};

const FILTER_FIELDS: readonly BacklogFilterField[] = [
  "state",
  "priority",
  "project",
  "task",
  "sourceProject",
  "connection",
  "type",
  "hasEstimate",
  "running",
];

function oneOf<T extends string>(
  value: unknown,
  options: readonly T[],
  fallback: T,
): T {
  return options.includes(value as T) ? (value as T) : fallback;
}

/** Unknown or broken values fall back to the defaults, field by field. */
export function parseBacklogViewPreferences(
  value: string | null,
): BacklogViewPreferences {
  try {
    const parsed = value
      ? (JSON.parse(value) as Partial<BacklogViewPreferences>)
      : {};
    const defaults = DEFAULT_PREFERENCES;
    const properties = { ...defaults.properties };
    for (const key of Object.keys(properties) as BacklogProperty[]) {
      if (typeof parsed.properties?.[key] === "boolean") {
        properties[key] = parsed.properties[key];
      }
    }
    return {
      layout: oneOf(parsed.layout, ["list", "board"], defaults.layout),
      grouping: oneOf(
        parsed.grouping,
        ["state", "priority", "project", "none"],
        defaults.grouping,
      ),
      swimlanes: oneOf(
        parsed.swimlanes,
        ["none", "project"],
        defaults.swimlanes,
      ),
      doneWindow: oneOf(
        parsed.doneWindow,
        ["week", "all", "none"],
        defaults.doneWindow,
      ),
      showSettled: parsed.showSettled !== false,
      showSubitems: parsed.showSubitems !== false,
      properties,
      filters: Array.isArray(parsed.filters)
        ? parsed.filters.filter(
            (filter): filter is BacklogFilter =>
              typeof filter?.value === "string" &&
              FILTER_FIELDS.includes(filter.field),
          )
        : [],
    };
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

function read(): BacklogViewPreferences {
  try {
    return parseBacklogViewPreferences(
      window.localStorage.getItem(BACKLOG_VIEW_STORAGE_KEY),
    );
  } catch {
    // Storage can be unavailable under restrictive privacy settings.
    return DEFAULT_PREFERENCES;
  }
}

let preferences: BacklogViewPreferences | undefined;
const listeners = new Set<() => void>();

function get() {
  preferences ??= read();
  return preferences;
}

/** Changes the display options or filters and saves them for this device. */
export function updateBacklogView(patch: Partial<BacklogViewPreferences>) {
  preferences = { ...get(), ...patch };
  try {
    window.localStorage.setItem(
      BACKLOG_VIEW_STORAGE_KEY,
      JSON.stringify(preferences),
    );
  } catch {
    // The options then only last for this session.
  }
  listeners.forEach((listener) => listener());
}

export function useBacklogView() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    get,
    () => DEFAULT_PREFERENCES,
  );
}
