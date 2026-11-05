/** The floating composer's resting top edge, below the title bar (composer.css). */
const RESTING_TOP = 64;
const GAP = 8;
/** Room kept at the bottom for the toasts, which share the corner. */
const MARGIN = 88;

/**
 * Moves a floating composer off the row it edits, so the row stays readable
 * with its project, task and hours (forms council rounds 11 and 12). The
 * card keeps its resting place at the top right unless that covers the row,
 * across and down; then it sits just below the row, or just above it. When
 * it fits neither way it stays put: a card squeezed to the bottom would put
 * its footer under the toasts. A new record passes no row and always rests
 * in the same place. Runs after layout, once the card has its height.
 */
export function placeFloatingComposer(
  popup: HTMLElement | null,
  anchor: Element | null | undefined,
) {
  if (!popup || !anchor || !anchor.isConnected) return;
  requestAnimationFrame(() => {
    if (!popup.isConnected || !anchor.isConnected) return;
    popup.style.top = "";
    const row = anchor.getBoundingClientRect();
    const card = popup.getBoundingClientRect();
    const height = popup.offsetHeight;
    const viewport = window.innerHeight;
    const covers =
      row.bottom > RESTING_TOP &&
      row.top < RESTING_TOP + height &&
      row.right > card.left &&
      row.left < card.right;
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
