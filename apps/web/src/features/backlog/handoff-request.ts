import { useSyncExternalStore } from "react";

/**
 * How every surface asks for a hand off, kept apart from the workflow's
 * dialogs so the action runner and row menus import nothing heavy. The one
 * `HandoffHost` in `handoff-workflow.tsx` listens.
 */
export interface HandoffRequest {
  itemId: string;
  toolKey: string;
  /** Opens the Review prompt dialog instead of starting at once. */
  review?: boolean;
}

let requestListener: ((request: HandoffRequest) => void) | null = null;

export function requestHandoff(request: HandoffRequest) {
  requestListener?.(request);
}

/** The host's listener; returns how to stop listening. */
export function listenForHandoffRequests(
  listener: (request: HandoffRequest) => void,
) {
  requestListener = listener;
  return () => {
    if (requestListener === listener) requestListener = null;
  };
}

const starting = new Set<string>();
const startingListeners = new Set<() => void>();
let startingVersion = 0;

export function setHandoffStarting(itemId: string, value: boolean) {
  if (value) starting.add(itemId);
  else starting.delete(itemId);
  startingVersion++;
  startingListeners.forEach((listener) => listener());
}

/** Whether a hand off of the item is on its way, so its button waits. */
export function useHandoffStarting(itemId: string) {
  useSyncExternalStore(
    (listener) => {
      startingListeners.add(listener);
      return () => {
        startingListeners.delete(listener);
      };
    },
    () => startingVersion,
  );
  return starting.has(itemId);
}
