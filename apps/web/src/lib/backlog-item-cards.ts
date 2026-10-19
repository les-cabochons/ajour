import { useSyncExternalStore } from "react";

/**
 * Which of the item page's folding cards are open, per device. Like the
 * sidebar layout, it lives outside the local app state so it is never
 * exported. Both cards start closed, on their summary line.
 */
export interface BacklogItemCards {
  subitemsOpen: boolean;
  timeEntriesOpen: boolean;
}

export const BACKLOG_ITEM_CARDS_STORAGE_KEY = "ajour.backlog-item-cards";

const DEFAULT_CARDS: BacklogItemCards = {
  subitemsOpen: false,
  timeEntriesOpen: false,
};

/** Unknown or broken values fall back to closed, card by card. */
export function parseBacklogItemCards(value: string | null): BacklogItemCards {
  try {
    const parsed: unknown = value ? JSON.parse(value) : null;
    if (!parsed || typeof parsed !== "object") return DEFAULT_CARDS;
    return {
      subitemsOpen: "subitemsOpen" in parsed && parsed.subitemsOpen === true,
      timeEntriesOpen:
        "timeEntriesOpen" in parsed && parsed.timeEntriesOpen === true,
    };
  } catch {
    return DEFAULT_CARDS;
  }
}

function readCards(): BacklogItemCards {
  try {
    return parseBacklogItemCards(
      window.localStorage.getItem(BACKLOG_ITEM_CARDS_STORAGE_KEY),
    );
  } catch {
    // Storage can be unavailable under restrictive privacy settings.
    return DEFAULT_CARDS;
  }
}

let cards: BacklogItemCards | undefined;
const listeners = new Set<() => void>();

function getCards() {
  cards ??= readCards();
  return cards;
}

/** Opens or closes cards and saves the choice for this device. */
export function updateBacklogItemCards(patch: Partial<BacklogItemCards>) {
  cards = { ...getCards(), ...patch };
  try {
    window.localStorage.setItem(
      BACKLOG_ITEM_CARDS_STORAGE_KEY,
      JSON.stringify(cards),
    );
  } catch {
    // The choice then only lasts for this session.
  }
  listeners.forEach((listener) => listener());
}

export function useBacklogItemCards() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getCards,
    () => DEFAULT_CARDS,
  );
}
