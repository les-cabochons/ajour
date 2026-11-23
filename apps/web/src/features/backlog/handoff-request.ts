import { useSyncExternalStore } from "react";
import type { HandoffStartIn } from "@ajour/shared/worktrees";

/**
 * How every surface asks for a hand off, kept apart from the workflow's
 * dialogs so the action runner and row menus import nothing heavy. The one
 * `HandoffHost` in `handoff-workflow.tsx` listens.
 */
/**
 * Where the user chose to start one hand off (#861): a repository folder,
 * and the main folder, a new worktree or one of the item's worktrees in it.
 */
export interface HandoffPlace {
  folderId: string;
  startIn: HandoffStartIn;
}

export interface HandoffRequest {
  itemId: string;
  toolKey: string;
  /** Opens the Review prompt dialog instead of starting at once. */
  review?: boolean;
  /**
   * The place chosen in the hand-off sheet's Start in row. Without one the
   * local API decides, or, under Ask each time, the Start in dialog asks.
   */
  place?: HandoffPlace;
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

let chooseListener: (() => void) | null = null;
let chooseRequests = 0;
const chooseRequestListeners = new Set<() => void>();

/**
 * *Choose your tools*, while no handoff tool is on, and the hand-off sheet's
 * *Choose tools…*: both lead to the tools' switches. The host opens the page.
 */
export function requestChooseHandoffTools() {
  chooseRequests += 1;
  for (const listener of chooseRequestListeners) listener();
  chooseListener?.();
}

/**
 * Counts the requests for Choose your tools, so the tools' section moves
 * focus again when the page already shows it and its search stays the same.
 */
export function useChooseHandoffToolsRequest() {
  return useSyncExternalStore(
    (listener) => {
      chooseRequestListeners.add(listener);
      return () => chooseRequestListeners.delete(listener);
    },
    () => chooseRequests,
  );
}

/** The host's listener for Choose your tools; returns how to stop. */
export function listenForChooseHandoffTools(listener: () => void) {
  chooseListener = listener;
  return () => {
    if (chooseListener === listener) chooseListener = null;
  };
}

/**
 * The items whose hand off is on its way: from the moment the host accepts a
 * request until the thread starts, fails or the user cancels. A start still
 * running when its dialog closes keeps its item here until it settles. The host
 * ignores further requests for them, and every entry point waits.
 */
const starting = new Set<string>();
const startingListeners = new Set<() => void>();
let startingVersion = 0;

export function setHandoffStarting(itemId: string, value: boolean) {
  if (starting.has(itemId) === value) return;
  if (value) starting.add(itemId);
  else starting.delete(itemId);
  startingVersion++;
  startingListeners.forEach((listener) => listener());
}

export function isHandoffStarting(itemId: string) {
  return starting.has(itemId);
}

function subscribeStarting(listener: () => void) {
  startingListeners.add(listener);
  return () => {
    startingListeners.delete(listener);
  };
}
const getStartingVersion = () => startingVersion;

/** Whether a hand off of the item is on its way, so its button waits. */
export function useHandoffStarting(itemId: string) {
  useSyncExternalStore(subscribeStarting, getStartingVersion);
  return starting.has(itemId);
}

/**
 * The items a tool is starting a thread for now, with that tool's key: from
 * the moment Ajour asks the tool until it answers. Shorter than starting,
 * which also covers the dialogs before and after. The Handoffs card names
 * the tool meanwhile, since a start can take seconds.
 */
const launching = new Map<string, string>();

export function setHandoffLaunching(itemId: string, toolKey?: string) {
  if (launching.get(itemId) === toolKey) return;
  if (toolKey) launching.set(itemId, toolKey);
  else launching.delete(itemId);
  startingVersion++;
  startingListeners.forEach((listener) => listener());
}

/** The key of the tool starting a thread for the item now, if one is. */
export function useHandoffLaunching(itemId: string) {
  useSyncExternalStore(subscribeStarting, getStartingVersion);
  return launching.get(itemId);
}
