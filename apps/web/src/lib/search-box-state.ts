import { useSyncExternalStore } from "react";

/**
 * A search box's state: whether it is expanded and what is typed. It lives
 * outside React because its host can unmount while the query must outlast
 * it, as the sidebar does when it hides, and it is never saved. The sidebar
 * and the Backlog page each hold one.
 */
export interface SearchBoxState {
  open: boolean;
  query: string;
}

const CLOSED: SearchBoxState = { open: false, query: "" };

export function createSearchBoxState() {
  let state = CLOSED;
  const listeners = new Set<() => void>();
  return {
    /** The search as it is now, for code outside React. */
    get: () => state,
    update(patch: Partial<SearchBoxState>) {
      state = { ...state, ...patch };
      listeners.forEach((listener) => listener());
    },
    use: () =>
      useSyncExternalStore(
        (listener) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        () => state,
        () => CLOSED,
      ),
  };
}
