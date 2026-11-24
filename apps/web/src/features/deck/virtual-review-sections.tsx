import {
  memo,
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Ref,
  type RefObject,
} from "react";
import {
  defaultRangeExtractor,
  useVirtualizer,
  type Range,
} from "@tanstack/react-virtual";
import {
  reviewRows,
  viewedCount,
  type ReviewRow,
  type ReviewSection,
} from "@/domain/deck/guide";
import { hunkRowCount } from "@/domain/deck/review-diff";
import type { PlacedThread } from "@/domain/deck/review-threads";
import {
  SECTION_MARGIN,
  scrollerOf,
  type SectionNavigator,
} from "./review-scroll";
import {
  ReviewHunkView,
  ReviewSectionHeader,
  useThreadMarks,
} from "./review-sections";

/*
 * The sections of a huge pull request's review page (#790): one row per
 * section header and per hunk, of which only the rows near the screen are
 * mounted, through `@tanstack/react-virtual`. Each row is measured once it
 * mounts, and again as its hunk draws or folds, so the rows above the
 * screen never move what is read. Each row is placed at its own offset,
 * and the row holding the focus stays mounted however far it scrolls away,
 * so Tab goes on from where the reader was. The gutter holds only the
 * cards of the threads on mounted hunks, and places them as they change.
 */

/** Rows mounted beyond each edge of the screen. */
const OVERSCAN = 4;

/*
 * A row's height before it is measured, from styles/deck.css: a hunk row's
 * 8px top padding, its 24px header, a 4px gap, then its lines in a hairline
 * frame, or a folded or line-less hunk's header alone; 28px more for the
 * hunk that ends a section. A concern's header holds two lines, a file's
 * one.
 */
const HUNK_PADDING = 8;
const HUNK_HEADER = 24;
const HUNK_GAP = 4;
const HUNK_FRAME = 2;
const SECTION_SPACE = 28;
const CONCERN_HEADER = 44;
const FILE_HEADER = 18;
const NOTE_HEIGHT = 18;

/** A row's height, folded (a viewed hunk's header alone) and open. */
function estimateRow(
  row: ReviewRow,
  sections: readonly ReviewSection[],
  lineHeight: number,
): { folded: number; open: number } {
  if (row.kind === "section") {
    const height = sections[row.section]?.file ? FILE_HEADER : CONCERN_HEADER;
    return { folded: height, open: height };
  }
  const { hunk } = row.entry;
  const folded =
    HUNK_PADDING + HUNK_HEADER + (row.beforeSection ? SECTION_SPACE : 0);
  const body = hunk.header
    ? HUNK_GAP + HUNK_FRAME + hunkRowCount(hunk) * lineHeight
    : HUNK_GAP + NOTE_HEIGHT;
  return { folded, open: folded + body };
}

export const VirtualReviewSections = memo(function VirtualReviewSections({
  sections,
  viewed,
  theme,
  onToggleViewed,
  navigator,
  listRef: list,
  placed,
  floating,
  hovered,
  onHover,
  onAnchor,
  onThreadRowsChange,
}: {
  sections: readonly ReviewSection[];
  viewed: ReadonlySet<string>;
  theme: "light" | "dark";
  onToggleViewed: (hunkId: string) => void;
  navigator: Ref<SectionNavigator>;
  /** The rows' box, which the gutter beside it follows. */
  listRef: RefObject<HTMLDivElement | null>;
  /** The review threads on the pull request's lines. */
  placed: readonly PlacedThread[];
  /** Threads float in the gutter, so a line only marks where its thread is. */
  floating: boolean;
  hovered: string | undefined;
  onHover: (threadId: string | undefined) => void;
  /** Called with each mark after a thread's line as it's drawn. */
  onAnchor: (element: HTMLElement | null) => void;
  /** Called with the mounted hunks holding threads as they change, the first time too: the gutter holds only their cards. */
  onThreadRowsChange: (hunkIds: ReadonlySet<string>) => void;
}) {
  const baseId = useId();
  const [scroller, setScroller] = useState<HTMLElement | null>(null);
  /** How far below the top of the scroller's content the rows start. */
  const [margin, setMargin] = useState(0);
  const [lineHeight, setLineHeight] = useState(20);
  const { rows, sectionRows } = useMemo(() => reviewRows(sections), [sections]);
  const { byHunk, renderAnnotation, hoveredEntry } = useThreadMarks({
    placed,
    floating,
    hovered,
    onHover,
    onAnchor,
  });
  // Counted once: the virtualizer asks again for every row not measured yet
  // each time a row's height changes.
  const estimates = useMemo(
    () => rows.map((row) => estimateRow(row, sections, lineHeight)),
    [rows, sections, lineHeight],
  );
  // Read by the estimate, which runs only for rows not measured yet.
  const viewedNow = useRef(viewed);
  useLayoutEffect(() => {
    viewedNow.current = viewed;
  }, [viewed]);

  useLayoutEffect(() => {
    const element = list.current;
    if (!element) return;
    const box = scrollerOf(element);
    if (!box) return;
    setScroller(box);
    const height = Number.parseFloat(
      getComputedStyle(element).getPropertyValue("--diff-line-height"),
    );
    if (height > 0) setLineHeight(height);
    // The summary and the heading above the rows can change height.
    const measure = () => {
      const offset =
        element.getBoundingClientRect().top -
        box.getBoundingClientRect().top +
        box.scrollTop;
      setMargin((current) =>
        Math.abs(current - offset) < 0.5 ? current : offset,
      );
    };
    measure();
    // A frame later: the new margin resizes the rows' box, which this
    // observer would otherwise report again within the same frame.
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    });
    observer.observe(box.firstElementChild ?? box);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [list]);

  /** The row holding the focus, kept mounted off screen. */
  const [focusedRow, setFocusedRow] = useState<number>();
  const rangeExtractor = useCallback(
    (range: Range) => {
      const indexes = defaultRangeExtractor(range);
      if (focusedRow === undefined || indexes.includes(focusedRow)) {
        return indexes;
      }
      return [...indexes, focusedRow].sort((a, b) => a - b);
    },
    [focusedRow],
  );
  const getItemKey = useCallback((index: number) => rows[index]!.key, [rows]);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroller,
    estimateSize: (index) => {
      const row = rows[index]!;
      const estimate = estimates[index]!;
      return row.kind === "hunk" && viewedNow.current.has(row.entry.hunk.id)
        ? estimate.folded
        : estimate.open;
    },
    getItemKey,
    rangeExtractor,
    overscan: OVERSCAN,
    scrollMargin: margin,
    // Rows measured a frame later, so their new heights never loop the observer.
    useAnimationFrameWithResizeObserver: true,
  });

  /**
   * Focuses section `index`'s title once its row has mounted, and holds it
   * on the reading line while the rows around it draw: a hunk's drawn
   * height can differ from the height it held, after the virtualizer's
   * jump. It stops once the title stays put for three frames, after 60
   * frames, or when another reach starts.
   */
  const reaching = useRef(0);
  // An unmounted page stops a reach still holding its title.
  useEffect(
    () => () => {
      reaching.current += 1;
    },
    [],
  );
  const settle = (index: number) => {
    const run = (reaching.current += 1);
    let frames = 0;
    let still = 0;
    const attempt = () => {
      if (run !== reaching.current || !scroller) return;
      frames += 1;
      const heading = list.current?.querySelector<HTMLElement>(
        `[data-section-index="${index}"] h3`,
      );
      if (heading) {
        if (document.activeElement !== heading) {
          heading.focus({ preventScroll: true });
        }
        const off =
          heading
            .closest<HTMLElement>(".deck-review-row")!
            .getBoundingClientRect().top -
          (scroller.getBoundingClientRect().top + SECTION_MARGIN);
        if (Math.abs(off) > 1) {
          // Through the virtualizer, which otherwise keeps the offset it
          // last saw and moves the page back from there as rows resize.
          virtualizer.scrollToOffset(scroller.scrollTop + off);
          still = 0;
        } else {
          still += 1;
        }
      }
      if (still < 3 && frames < 60) requestAnimationFrame(attempt);
    };
    requestAnimationFrame(attempt);
  };

  const items = virtualizer.getVirtualItems();
  // The mounted hunks holding threads, compared in a word: a row mounting
  // or unmounting without threads costs the gutter nothing.
  const threadRows = items
    .flatMap((item) => {
      const row = rows[item.index]!;
      return row.kind === "hunk" && byHunk.has(row.entry.hunk.id)
        ? [row.entry.hunk.id]
        : [];
    })
    .join("\n");
  const shownThreadRows = useRef<string>(undefined);
  useLayoutEffect(() => {
    if (shownThreadRows.current === threadRows) return;
    shownThreadRows.current = threadRows;
    onThreadRowsChange(new Set(threadRows ? threadRows.split("\n") : []));
  }, [threadRows, onThreadRowsChange]);

  useImperativeHandle(navigator, () => ({
    tops() {
      if (!scroller) return [];
      const top = scroller.getBoundingClientRect().top - scroller.scrollTop;
      const measured = virtualizer.measurementsCache;
      return sectionRows.map((row) => top + (measured[row]?.start ?? 0));
    },
    reach(index) {
      const row = sectionRows[index];
      if (row === undefined || !scroller) return;
      // A jump to where the rows above it say it starts, then the title
      // holds the reading line by its own position as the rows near it
      // mount and draw.
      const start = virtualizer.measurementsCache[row]?.start ?? 0;
      virtualizer.scrollToOffset(start - SECTION_MARGIN);
      settle(index);
    },
  }));

  return (
    <div
      ref={list}
      className="deck-review-sections"
      data-virtual=""
      style={{ height: virtualizer.getTotalSize() }}
      onFocus={(event) => {
        const row = (event.target as Element).closest<HTMLElement>(
          "[data-index]",
        );
        if (row) setFocusedRow(Number(row.dataset.index));
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setFocusedRow(undefined);
        }
      }}
    >
      {items.map((item) => {
        const row = rows[item.index]!;
        const section = sections[row.section]!;
        return (
          <div
            key={item.key}
            ref={virtualizer.measureElement}
            data-index={item.index}
            data-row={row.kind}
            data-before-section={
              row.kind === "hunk" && row.beforeSection ? "" : undefined
            }
            data-section-index={
              row.kind === "section" ? row.section : undefined
            }
            className="deck-review-row"
            style={{ transform: `translateY(${item.start - margin}px)` }}
          >
            {row.kind === "section" ? (
              <ReviewSectionHeader
                section={section}
                seen={viewedCount(section, viewed)}
                headingId={`${baseId}-${row.section}`}
              />
            ) : (
              <ReviewHunkView
                entry={row.entry}
                inConcern={!section.file}
                viewed={viewed.has(row.entry.hunk.id)}
                theme={theme}
                onToggleViewed={onToggleViewed}
                annotations={byHunk.get(row.entry.hunk.id)}
                renderAnnotation={
                  byHunk.has(row.entry.hunk.id) ? renderAnnotation : undefined
                }
                hovered={
                  hoveredEntry?.hunkId === row.entry.hunk.id
                    ? hoveredEntry
                    : undefined
                }
              />
            )}
          </div>
        );
      })}
    </div>
  );
});
