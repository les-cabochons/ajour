import { useSyncExternalStore } from "react";
import {
  NO_DECK_PANEL,
  parseDeckPanelState,
  type DeckPanelState,
} from "@/domain/deck/review-views";
import { recordDeviceSettingChange } from "@/lib/preference-events";

/**
 * The views pinned to Deck's side panel, whether the panel is open, and its
 * tab, saved per device for every pull request (see "Status, Threads and
 * Chat" under Deck in docs/agents/ux-spec.md). Like the side panel widths,
 * it lives outside the local app state, so it is never exported.
 */
export const DECK_PANEL_STORAGE_KEY = "ajour.deck-panel";

function getLocalStorage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

function read(): DeckPanelState {
  try {
    const value = getLocalStorage()?.getItem(DECK_PANEL_STORAGE_KEY);
    return value ? parseDeckPanelState(JSON.parse(value)) : NO_DECK_PANEL;
  } catch {
    // Storage can be unavailable, or hold something it can't read.
    return NO_DECK_PANEL;
  }
}

let current: DeckPanelState | undefined;
const listeners = new Set<() => void>();

function getState() {
  current ??= read();
  return current;
}

/** Saves the panel's state for this device; every review page follows it. */
export function setDeckPanel(next: DeckPanelState) {
  const before = getState();
  const saved: DeckPanelState = {
    pins: next.pins,
    open: next.pins.length > 0 && next.open,
    ...(next.tab && next.pins.includes(next.tab) ? { tab: next.tab } : {}),
  };
  if (
    before.open === saved.open &&
    before.tab === saved.tab &&
    before.pins.join() === saved.pins.join()
  )
    return;
  recordDeviceSettingChange(
    "deck_panel",
    { pins: before.pins.join(","), open: before.open },
    { pins: saved.pins.join(","), open: saved.open },
  );
  try {
    getLocalStorage()?.setItem(DECK_PANEL_STORAGE_KEY, JSON.stringify(saved));
  } catch {
    // The panel then only lasts for this session.
  }
  current = saved;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The saved panel state, shared by every review page on this device. */
export function useDeckPanel() {
  return useSyncExternalStore(subscribe, getState, () => NO_DECK_PANEL);
}

/** Forgets the state read from storage, so a test starts from it again. */
export function resetDeckPanelForTests() {
  current = undefined;
}
