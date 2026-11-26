import { lineElement, type HunkLine } from "@/components/diff-hunk";

/*
 * How Deck's review page moves between its sections (#782, #790): J, K and
 * the guide tree's ticks read the sections' tops once per press and scroll
 * one of them to the reading line. Nothing listens to the scroll. The page
 * mounts every section, or, for a huge pull request, only the rows near the
 * screen, and each way answers the same two questions.
 */

/** Where a section scrolled to lands below the sticky versions bar, as `scroll-margin-top` in styles/deck.css. */
export const SECTION_MARGIN = 16;

/** The versions bar the sections land below (#787), sticky within the changes. */
const VERSIONS_BAR = ".deck-versions";

/** The height of the sticky versions bar above `element`, which hides what scrolls under it; 0 without one. */
function stickyHeight(element: HTMLElement) {
  return (
    element.closest(".deck-changes")?.querySelector<HTMLElement>(VERSIONS_BAR)
      ?.offsetHeight ?? 0
  );
}

/**
 * How far below the top of the page's scroller a section scrolled to lands:
 * below the sticky versions bar above `element`, when there is one.
 */
export function readingOffset(element: HTMLElement) {
  return stickyHeight(element) + SECTION_MARGIN;
}

/** The sections J, K and the ticks move between. */
export interface SectionNavigator {
  /** Each section's top relative to the window, in reading order. */
  tops(): number[];
  /** Scrolls section `index` to the reading line and focuses its title. */
  reach(index: number): void;
  /**
   * Scrolls the line `point` of hunk `hunkId`, on its row `row`, a few
   * rows below the reading line, as a citation goes to it (#793).
   */
  reveal(hunkId: string, row: number, point: HunkLine): void;
  /**
   * Scrolls the hunk to the reading line and focuses it, for a summary
   * line (#789). False when the list doesn't show it.
   */
  reachHunk(hunkId: string): boolean;
}

/** The rows a cited line lands below the reading line, so what leads to it shows. */
export const CITATION_ROWS = 3;

/** The height of a hunk's line, `--diff-line-height` in styles/deck.css. */
export function lineHeightOf(element: HTMLElement) {
  const height = Number.parseFloat(
    getComputedStyle(element).getPropertyValue("--diff-line-height"),
  );
  return height > 0 ? height : 20;
}

/** The drawn box of hunk `hunkId` under `list`, or undefined while it isn't mounted. */
export function hunkBoxOf(list: HTMLElement | null, hunkId: string) {
  return [...(list?.querySelectorAll<HTMLElement>("[data-hunk]") ?? [])].find(
    (box) => box.dataset.hunk === hunkId,
  );
}

/**
 * How far to scroll so the line `point`, row `row` of `box`, lands a few
 * rows below the reading line: from its drawn line, or from its row before
 * the hunk draws.
 */
export function revealDistance(box: HTMLElement, row: number, point: HunkLine) {
  const scroller = scrollerOf(box);
  const height = lineHeightOf(box);
  const top =
    lineElement(box, point)?.getBoundingClientRect().top ??
    box.getBoundingClientRect().top + row * height;
  return (
    top -
    (scroller?.getBoundingClientRect().top ?? 0) -
    readingOffset(box) -
    CITATION_ROWS * height
  );
}

/** Scrolls `scroller`, or the window, by `distance` at once. */
export function scrollByDistance(
  scroller: HTMLElement | undefined,
  distance: number,
) {
  if (scroller)
    scroller.scrollTo({
      top: scroller.scrollTop + distance,
      behavior: "instant",
    });
  else window.scrollTo({ top: window.scrollY + distance, behavior: "instant" });
}

/** Scrolls `element` to `offset` below the top of its scroller, or of the window. */
export function scrollToReadingLine(element: HTMLElement, offset: number) {
  const scroller = scrollerOf(element);
  const top = element.getBoundingClientRect().top;
  if (scroller) {
    scroller.scrollTo({
      top:
        scroller.scrollTop +
        top -
        scroller.getBoundingClientRect().top -
        offset,
      behavior: "instant",
    });
  } else {
    window.scrollTo({
      top: window.scrollY + top - offset,
      behavior: "instant",
    });
  }
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
