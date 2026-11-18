import { useCallback } from "react";
import type { DesktopLogActionView } from "@/lib/desktop-bridge";
import { useOpenSettings, useSettingsSearch } from "./settings-link";
import { settingsLocationOf } from "./settings-location";

/**
 * Diagnostics' own search keys, in the settings location (#438): the open
 * tab, the Actions tab's filter and the trace it shows. The Events tab's
 * Show trace opens `tab=actions&trace=<trace_id>`.
 */
export type DiagnosticsTabId = "overview" | "events" | "actions" | "settings";

export interface DiagnosticsSearch {
  tab?: DiagnosticsTabId;
  /** The Actions tab's filter; All when absent. */
  show?: DesktopLogActionView;
  /** The trace the Actions tab shows: 32 hex characters. */
  trace?: string;
}

const TABS = new Set<string>(["overview", "events", "actions", "settings"]);
const VIEWS = new Set<string>(["all", "failed", "slow"]);
const TRACE_ID = /^[0-9a-f]{32}$/;

/** The keys Diagnostics knows, from a settings page's search; others are ignored. */
export function parseDiagnosticsSearch(
  search: Record<string, unknown>,
): DiagnosticsSearch {
  const { tab, show, trace } = search;
  return {
    ...(typeof tab === "string" && TABS.has(tab)
      ? { tab: tab as DiagnosticsTabId }
      : {}),
    ...(typeof show === "string" && VIEWS.has(show)
      ? { show: show as DesktopLogActionView }
      : {}),
    ...(typeof trace === "string" && TRACE_ID.test(trace) ? { trace } : {}),
  };
}

/** A change to the keys: a value sets one, `undefined` removes it. */
export type DiagnosticsSearchPatch = {
  [Key in keyof DiagnosticsSearch]?: DiagnosticsSearch[Key] | undefined;
};

/**
 * Diagnostics' search and how to change it. A change replaces the history
 * entry, in the settings window and on the narrow view's page alike, and
 * keeps the page's other keys.
 */
export function useDiagnosticsSearch(): [
  DiagnosticsSearch,
  (patch: DiagnosticsSearchPatch) => void,
] {
  const raw = useSettingsSearch();
  const openSettings = useOpenSettings();
  const update = useCallback(
    (patch: DiagnosticsSearchPatch) => {
      void openSettings(
        settingsLocationOf("diagnostics", { ...raw, ...patch }),
        { replace: true },
      );
    },
    [openSettings, raw],
  );
  return [parseDiagnosticsSearch(raw), update];
}
