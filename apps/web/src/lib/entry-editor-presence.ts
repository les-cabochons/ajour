import { useEffect } from "react";

/**
 * Counts the entry editor forms on screen, in any host: the Time page side
 * panel, the titlebar popover or a dialog. Pinned task digits read it, so a
 * digit never replaces a draft, even after focus left the editor. The
 * titlebar popover stays open on focus-out, so focus alone is not enough.
 */
let openEditorCount = 0;

/** Marks one editor as open. Call the returned function when it closes. */
export function registerOpenEntryEditor() {
  openEditorCount += 1;
  let isOpen = true;

  return () => {
    if (isOpen) {
      isOpen = false;
      openEditorCount -= 1;
    }
  };
}

/** True while at least one entry editor is on screen. */
export function isEntryEditorOpen() {
  return openEditorCount > 0;
}

/** Counts the calling editor form as open while it is mounted. */
export function useOpenEntryEditor() {
  useEffect(() => registerOpenEntryEditor(), []);
}
