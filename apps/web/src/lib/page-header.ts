import { useSyncExternalStore } from "react";

/**
 * The top bar's page header slot. The shell mounts an element and registers it
 * here; a page's `PageHeader` renders its title and actions into it through a
 * portal, so the page keeps its own state and handlers. While no page has a
 * header mounted, the shell shows a default title for the route.
 */
let slotElement: HTMLElement | null = null;
let mountedHeaders = 0;
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function setPageHeaderSlot(element: HTMLElement | null) {
  if (slotElement === element) return;
  slotElement = element;
  notify();
}

/** Counts a mounted `PageHeader`. Returns the matching unmount. */
export function registerPageHeader() {
  mountedHeaders += 1;
  notify();
  return () => {
    mountedHeaders -= 1;
    notify();
  };
}

const getSlot = () => slotElement;
const getHasPageHeader = () => mountedHeaders > 0;
const getServerSlot = () => null;
const getServerHasPageHeader = () => false;

export function usePageHeaderSlot() {
  return useSyncExternalStore(subscribe, getSlot, getServerSlot);
}

/** Whether a page has its own header mounted, so the shell's default title hides. */
export function useHasPageHeader() {
  return useSyncExternalStore(
    subscribe,
    getHasPageHeader,
    getServerHasPageHeader,
  );
}
