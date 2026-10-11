/**
 * Asks the open Settings General page to check for updates again. The app
 * menu's "Check for updates…" uses it after opening that page, because opening
 * a page that is already open does not remount it.
 */
const listeners = new Set<() => void>();

export function requestUpdateCheck() {
  for (const listener of listeners) {
    listener();
  }
}

/** Runs `listener` on each request. Returns the unsubscribe function. */
export function onUpdateCheckRequest(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
