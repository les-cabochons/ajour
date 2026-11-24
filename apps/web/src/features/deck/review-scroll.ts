/*
 * How Deck's review page moves between its sections (#782, #790): J, K and
 * the guide tree's ticks read the sections' tops once per press and scroll
 * one of them to the reading line. Nothing listens to the scroll. The page
 * mounts every section, or, for a huge pull request, only the rows near the
 * screen, and each way answers the same two questions.
 */

/** Where a section scrolled to lands below the top of the page's scroller, as `scroll-margin-top` in styles/deck.css. */
export const SECTION_MARGIN = 16;

/** The sections J, K and the ticks move between. */
export interface SectionNavigator {
  /** Each section's top relative to the window, in reading order. */
  tops(): number[];
  /** Scrolls section `index` to the reading line and focuses its title. */
  reach(index: number): void;
}

/** The element that scrolls `element`, or undefined for the window. */
export function scrollerOf(element: HTMLElement) {
  for (
    let parent = element.parentElement;
    parent;
    parent = parent.parentElement
  ) {
    const { overflowY } = getComputedStyle(parent);
    if (overflowY === "auto" || overflowY === "scroll") return parent;
  }
  return undefined;
}

/** Whether `scroller`, or the window, is scrolled to its end. */
export function atEnd(scroller: HTMLElement | undefined) {
  const box = scroller ?? document.scrollingElement;
  return !box || box.scrollTop + box.clientHeight >= box.scrollHeight - 1;
}
