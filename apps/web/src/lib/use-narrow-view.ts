import { useSyncExternalStore } from "react";
import { NARROW_VIEW_QUERY } from "@/lib/breakpoints";

function subscribeToNarrowView(onChange: () => void) {
  const mediaQuery = window.matchMedia(NARROW_VIEW_QUERY);
  mediaQuery.addEventListener("change", onChange);
  return () => mediaQuery.removeEventListener("change", onChange);
}

/** True when the window is in the narrow view, below 768px. Event handlers can call it directly. */
export function isNarrowView() {
  return (
    typeof window !== "undefined" &&
    window.matchMedia(NARROW_VIEW_QUERY).matches
  );
}

/** Re-renders when the window crosses into or out of the narrow view. */
export function useIsNarrowView() {
  return useSyncExternalStore(subscribeToNarrowView, isNarrowView, () => false);
}
