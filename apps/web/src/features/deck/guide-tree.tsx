import { memo, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import {
  RiLayoutRight2Line as ShowTree,
  RiLayoutRightLine as HideTree,
} from "@remixicon/react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { TooltipButton } from "@/components/tooltip-button";
import { useIsNarrowView } from "@/lib/use-narrow-view";
import { Value } from "@/components/ui/value";
import {
  tickLength,
  treeVirtualized,
  viewedCount,
  type ReviewSection,
} from "@/domain/deck/guide";

/*
 * The quiet guide tree on the right of Deck's review page (#782). Closed,
 * it is a strip of ticks, one per concern (or file, in Files A–Z), each as
 * long as its hunks and filled as they are marked viewed. Open, with F or
 * its button, it lists their titles. A tick or a title scrolls to its
 * section. In the narrow view the ticks run across, above the changes, and
 * never open. A tick names itself to assistive technology but mounts no
 * tooltip: there is one per concern, and the open tree shows the titles.
 * With more sections than `treeVirtualized` allows, as a huge pull
 * request's Files A–Z has (#790), only the ticks or titles in the tree's
 * view are mounted.
 */

function Tick({ hunks, viewed }: { hunks: number; viewed: number }) {
  const style = {
    "--deck-tick-length": `${tickLength(hunks)}px`,
    "--deck-tick-fill": `${hunks ? (viewed / hunks) * 100 : 0}%`,
  } as CSSProperties;
  return (
    <span
      className="deck-tick-bar"
      data-done={hunks > 0 && viewed === hunks ? "" : undefined}
      style={style}
    />
  );
}

/** "3. Title · 2 of 5 viewed", what a tick says to assistive technology and in its tooltip. */
function tickLabel(section: ReviewSection, viewed: number) {
  const name = section.number
    ? `${section.number}. ${section.title}`
    : section.title;
  return `${name} · ${viewed} of ${section.hunks.length} viewed`;
}

/** One section's tick, or its row of the open tree. */
const TreeItem = memo(function TreeItem({
  section,
  index,
  seen,
  titles,
  onReach,
}: {
  section: ReviewSection;
  index: number;
  seen: number;
  titles: boolean;
  onReach: (index: number) => void;
}) {
  return titles ? (
    <button
      type="button"
      className="deck-tree-row"
      onClick={() => onReach(index)}
    >
      <Tick hunks={section.hunks.length} viewed={seen} />
      {section.number ? (
        <Value className="deck-tree-number">{section.number}</Value>
      ) : null}
      <span className="deck-tree-title">{section.title}</span>
      <Value className="deck-tree-count">
        {seen}/{section.hunks.length}
      </Value>
    </button>
  ) : (
    <button
      type="button"
      aria-label={tickLabel(section, seen)}
      className="deck-tick"
      onClick={() => onReach(index)}
    >
      <Tick hunks={section.hunks.length} viewed={seen} />
    </button>
  );
});

/*
 * Heights before measuring, from styles/deck.css: a tick is its bar with
 * 3px above and below, a row one or two lines of 12px text with 5px above
 * and below; 2px between them.
 */
const TICK_PADDING = 6;
const ROW_HEIGHT = 27;
const ITEM_GAP = 2;

/** The ticks or titles in the tree's view, of a tree with more sections than it mounts. */
function VirtualTreeItems({
  sections,
  viewed,
  titles,
  scroller,
  onReach,
}: {
  sections: readonly ReviewSection[];
  viewed: ReadonlySet<string>;
  titles: boolean;
  /** The tree, which scrolls its ticks or titles. */
  scroller: HTMLElement | null;
  onReach: (index: number) => void;
}) {
  const list = useRef<HTMLOListElement>(null);
  /** How far below the top of the tree's content the list starts, under its toggle or head. */
  const [margin, setMargin] = useState(0);
  useLayoutEffect(() => {
    const element = list.current;
    const box = scroller;
    if (!element || !box) return;
    setMargin(
      element.getBoundingClientRect().top -
        box.getBoundingClientRect().top +
        box.scrollTop,
    );
  }, [scroller, titles]);
  const virtualizer = useVirtualizer({
    count: sections.length,
    getScrollElement: () => scroller,
    estimateSize: (index) =>
      titles
        ? ROW_HEIGHT
        : TICK_PADDING + tickLength(sections[index]!.hunks.length),
    getItemKey: (index) => sections[index]!.key,
    gap: ITEM_GAP,
    overscan: 8,
    scrollMargin: margin,
    // Rows measured a frame later, so their new heights never loop the observer.
    useAnimationFrameWithResizeObserver: true,
  });
  return (
    <ol
      ref={list}
      className={titles ? "deck-tree-rows" : "deck-tree-ticks"}
      data-virtual=""
      style={{ height: virtualizer.getTotalSize() }}
    >
      {virtualizer.getVirtualItems().map((item) => {
        const section = sections[item.index]!;
        return (
          <li
            key={item.key}
            ref={virtualizer.measureElement}
            data-index={item.index}
            aria-setsize={sections.length}
            aria-posinset={item.index + 1}
            style={{ transform: `translateY(${item.start - margin}px)` }}
          >
            <TreeItem
              section={section}
              index={item.index}
              seen={viewedCount(section, viewed)}
              titles={titles}
              onReach={onReach}
            />
          </li>
        );
      })}
    </ol>
  );
}

export const GuideTree = memo(function GuideTree({
  sections,
  viewed,
  open,
  heading,
  onToggle,
  onReach,
}: {
  sections: readonly ReviewSection[];
  viewed: ReadonlySet<string>;
  open: boolean;
  /** "Guide" or "Files", the tree's heading while open. */
  heading: string;
  onToggle: () => void;
  onReach: (index: number) => void;
}) {
  // State, not a ref: the tree's items read it in their first layout
  // effect, before React sets a parent's ref.
  const [nav, setNav] = useState<HTMLElement | null>(null);
  // The narrow view has no room for the titles, and no keyboard to close them.
  const narrow = useIsNarrowView();
  const showTitles = open && !narrow;
  // In the narrow view the ticks wrap across the page, and the tree doesn't scroll.
  const virtual = !narrow && treeVirtualized(sections);
  const total = sections.reduce(
    (count, section) => count + section.hunks.length,
    0,
  );
  const viewedTotal = sections.reduce(
    (count, section) => count + viewedCount(section, viewed),
    0,
  );
  const toggle = (
    <TooltipButton
      label={showTitles ? "Hide the guide tree" : "Show the guide tree"}
      shortcut="deck.guide-tree"
      side="left"
      className="deck-tree-toggle"
      aria-expanded={showTitles}
      onClick={onToggle}
    >
      {showTitles ? <HideTree aria-hidden /> : <ShowTree aria-hidden />}
    </TooltipButton>
  );
  const items = virtual ? (
    <VirtualTreeItems
      sections={sections}
      viewed={viewed}
      titles={showTitles}
      scroller={nav}
      onReach={onReach}
    />
  ) : (
    <ol className={showTitles ? "deck-tree-rows" : "deck-tree-ticks"}>
      {sections.map((section, index) => (
        <li key={section.key}>
          <TreeItem
            section={section}
            index={index}
            seen={viewedCount(section, viewed)}
            titles={showTitles}
            onReach={onReach}
          />
        </li>
      ))}
    </ol>
  );
  return (
    <nav
      ref={setNav}
      className="deck-guide-tree"
      aria-label="Guide tree"
      data-open={showTitles || undefined}
    >
      {showTitles ? (
        <>
          <div className="deck-tree-head">
            <span className="deck-tree-heading">{heading}</span>
            <Value className="deck-tree-count">
              {viewedTotal}/{total}
            </Value>
            {toggle}
          </div>
          {items}
        </>
      ) : (
        <>
          {toggle}
          {items}
          <Value className="deck-tree-progress">
            {viewedTotal}/{total}
          </Value>
        </>
      )}
    </nav>
  );
});
