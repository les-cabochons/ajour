/** The floating composer's resting top edge, below the title bar (composer.css). */
const RESTING_TOP = 64;
const GAP = 8;
/** Room kept at the bottom for the toasts, which share the corner. */
const MARGIN = 88;

/**
 * Places a floating composer before it paints. It rests at the top right,
 * below `restBelow` when given, such as the Time page's day strip, so it
 * never covers the page's own header. When it edits a row and that resting
 * place covers the row, across and down, it sits just below the row, or
 * just above it (forms council rounds 11 and 12). When it fits neither way
 * it stays put: a card squeezed to the bottom would put its footer under the
 * toasts.
 *
 * It runs from the card's ref, synchronously, so the card's first frame is
 * already in place; a frame later it showed at the resting place first and
 * then jumped to the row, which read as a slide from the top.
 */
export function placeFloatingComposer(
  popup: HTMLElement | null,
  anchor: Element | null | undefined,
  { restBelow }: { restBelow?: Element | null } = {},
) {
  if (!popup) return;
  popup.style.top = "";
  const resting =
    restBelow?.isConnected === true
      ? Math.max(RESTING_TOP, restBelow.getBoundingClientRect().bottom + GAP)
      : RESTING_TOP;
  if (resting !== RESTING_TOP) popup.style.top = `${resting}px`;
  if (!anchor?.isConnected) return;
  const row = anchor.getBoundingClientRect();
  const card = popup.getBoundingClientRect();
  const height = popup.offsetHeight;
  const viewport = window.innerHeight;
  const covers =
    row.bottom > resting &&
    row.top < resting + height &&
    row.right > card.left &&
    row.left < card.right;
  if (!covers) return;
  const below = row.bottom + GAP;
  const above = row.top - GAP - height;
  if (below + height <= viewport - MARGIN) {
    popup.style.top = `${below}px`;
  } else if (above >= resting) {
    popup.style.top = `${above}px`;
  }
}
