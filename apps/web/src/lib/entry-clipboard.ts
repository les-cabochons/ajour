import { useSyncExternalStore } from "react";

/**
 * The time entries copied or cut on the Time page. Ajour keeps them in memory and
 * puts a text summary on the system clipboard, so pasting into a chat gives lines
 * of text. `text` is that summary: a paste from the keyboard or the Edit menu only
 * pastes entries while the system clipboard still holds it, so copying something
 * else in another app wins.
 *
 * `entries` keeps each entry's day at copy time, which "Paste on same weekdays"
 * reads. A cut moves the entries on paste and then empties the clipboard.
 */
export interface EntryClipboard {
  mode: "copy" | "cut";
  entries: readonly { entryId: string; localDate: string }[];
  text: string;
}

let clipboard: EntryClipboard | null = null;
const listeners = new Set<() => void>();

export function getEntryClipboard() {
  return clipboard;
}

export function setEntryClipboard(next: EntryClipboard | null) {
  clipboard = next;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The current entry clipboard, re-rendering on change, so cut entries can dim. */
export function useEntryClipboard() {
  return useSyncExternalStore(subscribe, getEntryClipboard, getEntryClipboard);
}

/**
 * The entry clipboard when the system clipboard still holds its text, or null
 * when the user has copied something else since.
 */
export function matchEntryClipboard(systemText: string | undefined) {
  return clipboard && systemText === clipboard.text ? clipboard : null;
}

/** Whether a clipboard event's target is a field that copies and pastes text itself. */
export function isTextEditingTarget(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      target.closest("input, textarea, select, [contenteditable='true']") !==
        null)
  );
}
