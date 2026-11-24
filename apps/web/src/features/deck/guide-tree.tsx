import { memo } from "react";
import type { CSSProperties } from "react";
import {
  RiLayoutRight2Line as ShowTree,
  RiLayoutRightLine as HideTree,
} from "@remixicon/react";
import { TooltipButton } from "@/components/tooltip-button";
import { useIsNarrowView } from "@/lib/use-narrow-view";
import { Value } from "@/components/ui/value";
import {
  tickLength,
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
  // The narrow view has no room for the titles, and no keyboard to close them.
  const showTitles = open && !useIsNarrowView();
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
  return (
    <nav
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
          <ol className="deck-tree-rows">
            {sections.map((section, index) => {
              const seen = viewedCount(section, viewed);
              return (
                <li key={section.key}>
                  <button
                    type="button"
                    className="deck-tree-row"
                    onClick={() => onReach(index)}
                  >
                    <Tick hunks={section.hunks.length} viewed={seen} />
                    {section.number ? (
                      <Value className="deck-tree-number">
                        {section.number}
                      </Value>
                    ) : null}
                    <span className="deck-tree-title">{section.title}</span>
                    <Value className="deck-tree-count">
                      {seen}/{section.hunks.length}
                    </Value>
                  </button>
                </li>
              );
            })}
          </ol>
        </>
      ) : (
        <>
          {toggle}
          <ol className="deck-tree-ticks">
            {sections.map((section, index) => {
              const seen = viewedCount(section, viewed);
              return (
                <li key={section.key}>
                  <button
                    type="button"
                    aria-label={tickLabel(section, seen)}
                    className="deck-tick"
                    onClick={() => onReach(index)}
                  >
                    <Tick hunks={section.hunks.length} viewed={seen} />
                  </button>
                </li>
              );
            })}
          </ol>
          <Value className="deck-tree-progress">
            {viewedTotal}/{total}
          </Value>
        </>
      )}
    </nav>
  );
});
