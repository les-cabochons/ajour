/**
 * A double-click on a button that closes an editor or starts an entry landed
 * its second click on whatever the first one uncovered, such as the row under
 * the side panel's Create entry, and opened that row's editor (usability
 * testing, 2026-11-06). Such a button calls `ignoreSecondClick` from its
 * click handler, and the rest of that double-click goes nowhere.
 */

/** Longer than the system's double-click time, which defaults to 500ms. */
const WINDOW_MS = 700;

let armedUntil = 0;
let listening = false;

/** Swallows the second press of a double-click while the guard is armed. */
function swallow(event: MouseEvent) {
  if (performance.now() > armedUntil) return;
  // A press that starts a new click sequence ends the guard.
  if (event.type === "mousedown" && event.detail <= 1) {
    armedUntil = 0;
    return;
  }
  if (event.detail >= 2 || event.type === "dblclick") {
    event.preventDefault();
    event.stopPropagation();
    if (event.type === "dblclick") armedUntil = 0;
  }
}

/**
 * Ignores the second click of the double-click whose first click is `event`.
 * A keyboard press (detail 0) or a later click of a sequence does nothing.
 */
export function ignoreSecondClick(event: { detail: number }) {
  if (event.detail !== 1) return;
  armedUntil = performance.now() + WINDOW_MS;
  if (listening) return;
  listening = true;
  for (const type of ["mousedown", "mouseup", "click", "dblclick"] as const) {
    window.addEventListener(type, swallow, true);
  }
}
