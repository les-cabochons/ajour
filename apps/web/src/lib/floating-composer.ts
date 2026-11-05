/** The floating composer's resting top edge, below the title bar (composer.css). */
const RESTING_TOP = 64;
const GAP = 8;
/** Room kept at the bottom for the toasts, which share the corner. */
const MARGIN = 88;
/** The card's room below it, as composer.css keeps it at its resting top. */
const BOTTOM_GAP = 16;

/**
 * Places a floating composer before it paints. It rests at the top right,
 * below `restBelow` when given, such as the Time page's day strip, so it
 * never covers the page's own header. When it edits a row and that resting
 * place covers the row, across and down, it sits just below the row, or
 * just above it (forms council rounds 11 and 12). When it fits neither way
 * it stays put: a card squeezed to the bottom would put its footer under the
 * toasts. Its height stops short of the window's bottom from wherever it
 * sits, so a long note scrolls inside it and Save stays in reach.
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
  popup.style.maxHeight = "";
  const resting =
    restBelow?.isConnected === true
      ? Math.max(RESTING_TOP, restBelow.getBoundingClientRect().bottom + GAP)
      : RESTING_TOP;
  let top = resting;
  if (anchor?.isConnected) {
    const row = anchor.getBoundingClientRect();
    // The open animation scales the card about its center: its laid-out
    // width, not its drawn one, says which rows it will cover.
    const drawn = popup.getBoundingClientRect();
    const center = (drawn.left + drawn.right) / 2;
    const left = center - popup.offsetWidth / 2;
    const right = center + popup.offsetWidth / 2;
    const height = popup.offsetHeight;
    const covers =
      row.bottom > resting &&
      row.top < resting + height &&
      row.right > left &&
      row.left < right;
    if (covers) {
      const below = row.bottom + GAP;
      const above = row.top - GAP - height;
      if (below + height <= window.innerHeight - MARGIN) top = below;
      else if (above >= resting) top = above;
    }
  }
  if (top === RESTING_TOP) return;
  popup.style.top = `${top}px`;
  popup.style.maxHeight = `calc(100dvh - ${top + BOTTOM_GAP}px)`;
}

/** The target each card was last placed for. */
const placedFor = new WeakMap<HTMLElement, string>();

/**
 * Places a card once for each target it edits, however often its ref runs:
 * an inline ref runs on every render of its page, and placing on each one
 * read the layout on every keystroke (Sol's review of #628). `findAnchor`
 * and `findRestBelow` run only when the card is placed.
 */
export function placeFloatingComposerFor(
  popup: HTMLElement | null,
  target: string,
  findAnchor: () => Element | null | undefined,
  findRestBelow?: () => Element | null,
) {
  if (!popup || placedFor.get(popup) === target) return;
  placedFor.set(popup, target);
  placeFloatingComposer(popup, findAnchor(), { restBelow: findRestBelow?.() });
}
