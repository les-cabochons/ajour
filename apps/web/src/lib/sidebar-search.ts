import { useSyncExternalStore } from "react";

/**
 * The sidebar's search box: whether it is expanded and what is typed. It lives
 * outside React because the sidebar unmounts when it hides or when its overlay
 * closes after opening a row, and the query must outlast that. Unlike the
 * project filter in the sidebar layout, it is never saved.
 */
export interface SidebarSearchState {
  open: boolean;
  query: string;
}

const CLOSED: SidebarSearchState = { open: false, query: "" };

let state = CLOSED;
const listeners = new Set<() => void>();

export function updateSidebarSearch(patch: Partial<SidebarSearchState>) {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener());
}

export function useSidebarSearch() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => state,
    () => CLOSED,
  );
}
