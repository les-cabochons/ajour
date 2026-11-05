/** The floating composer's resting top edge, below the title bar (composer.css). */
const RESTING_TOP = 64;
const GAP = 8;
const MARGIN = 16;

/**
 * Moves a floating composer off the row it edits, so the row stays readable
 * with its project, task and hours (forms council round 11). The card keeps
 * its resting place at the top right unless that covers the row; then it
 * sits just below the row, or just above it when there is no room below.
 * Runs after layout, once the card has its height.
 */
export function placeFloatingComposer(
  popup: HTMLElement | null,
  anchor: Element | null | undefined,
) {
  if (!popup || !anchor || !anchor.isConnected) return;
  requestAnimationFrame(() => {
    if (!popup.isConnected || !anchor.isConnected) return;
    const row = anchor.getBoundingClientRect();
    const height = popup.offsetHeight;
    const viewport = window.innerHeight;
    const covers = row.bottom > RESTING_TOP && row.top < RESTING_TOP + height;
    if (!covers) return;
    const below = row.bottom + GAP;
    const above = row.top - GAP - height;
    if (below + height <= viewport - MARGIN) {
      popup.style.top = `${below}px`;
    } else if (above >= RESTING_TOP) {
      popup.style.top = `${above}px`;
    }
  });
}
