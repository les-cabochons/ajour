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
import type { ReviewNote } from "@/domain/deck/review-notes";
import {
  SECTION_MARGIN,
  readingOffset,
  scrollerOf,
  type SectionNavigator,
} from "./review-scroll";
import { fileIsViewed } from "@/domain/deck/viewed-marks";
import {
  ReviewHunkView,
  ReviewSectionHeader,
  useNoteMarks,
  type AddComment,
  type ToggleFileViewed,
} from "./review-sections";

/*
 * The sections of a huge pull request's review page (#790): one row per
 * section header and per hunk, of which only the rows near the screen are
 * mounted, through `@tanstack/react-virtual`. Each row is measured once it
 * mounts, and again as its hunk draws or folds, so the rows above the
 * screen never move what is read. Each row is placed at its own offset,
 * and the row holding the focus stays mounted however far it scrolls away,
 * so Tab goes on from where the reader was; so does the hunk of a gutter
 * card holding it, such as the composer being typed in. The gutter holds
 * only the cards of the notes (threads, draft comments, the composer) on
 * mounted hunks, and places them as they change.
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
  onToggleFileViewed,
  navigator,
  listRef: list,
  notes,
  floating,
  hovered,
  onAnchor,
  onAddComment,
  onNoteRowsChange,
  focusedHunk,
  changed,
}: {
  sections: readonly ReviewSection[];
  viewed: ReadonlySet<string>;
  theme: "light" | "dark";
  onToggleViewed: (hunkId: string) => void;
  onToggleFileViewed: ToggleFileViewed;
  navigator: Ref<SectionNavigator>;
  /** The rows' box, which the gutter beside it follows. */
  listRef: RefObject<HTMLDivElement | null>;
  /** The threads, draft comments and composer on the pull request's lines. */
  notes: readonly ReviewNote[];
  /** Notes float in the gutter, so a line only marks where its note is. */
  floating: boolean;
  /** The hovered note's key. */
  hovered: string | undefined;
  /** Called with each mark after a note's line as it's drawn. */
  onAnchor: (element: HTMLElement | null) => void;
  /** Opens the composer; undefined when the pull request takes no comments. */
  onAddComment: AddComment | undefined;
  /** Called with the mounted hunks holding notes as they change, the first time too: the gutter holds only their cards. */
  onNoteRowsChange: (hunkIds: ReadonlySet<string>) => void;
  /** The hunk of the gutter's card holding the focus, kept mounted off screen like the row holding it. */
  focusedHunk?: string;
  /** The hunks changed since the review, with the version each last changed in. */
  changed: ReadonlyMap<string, number> | undefined;
}) {
  const baseId = useId();
  const [scroller, setScroller] = useState<HTMLElement | null>(null);
  /** How far below the top of the scroller's content the rows start. */
  const [margin, setMargin] = useState(0);
  const [lineHeight, setLineHeight] = useState(20);
  /** How far below the scroller's top the reading line is: under the sticky versions bar, and 16px more. */
  const readingLine = useRef(SECTION_MARGIN);
  const { rows, sectionRows } = useMemo(() => reviewRows(sections), [sections]);
  const { byHunk, renderAnnotation, hoveredEntry } = useNoteMarks({
    notes,
    floating,
    hovered,
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
    // One read: the bar keeps its height.
    readingLine.current = readingOffset(element);
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
  /** The row of the hunk whose card in the gutter holds the focus. */
  const focusedCardRow = useMemo(
    () =>
      focusedHunk === undefined
        ? undefined
        : rows.findIndex(
            (row) => row.kind === "hunk" && row.entry.hunk.id === focusedHunk,
          ),
    [rows, focusedHunk],
  );
  const rangeExtractor = useCallback(
    (range: Range) => {
      const indexes = defaultRangeExtractor(range);
      const kept = [focusedRow, focusedCardRow].filter(
        (index): index is number =>
          index !== undefined && index >= 0 && !indexes.includes(index),
      );
      if (!kept.length) return indexes;
      return [...new Set([...indexes, ...kept])].sort((a, b) => a - b);
    },
    [focusedRow, focusedCardRow],
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
  // The library's own rule, with the fold moved down to the reading line,
  // under the sticky versions bar: a row above it that resizes, ending there
  // or measured for the first time, moves the page by as much, so a section
  // J or a tick reached stays put as the hunks above it draw.
  virtualizer.shouldAdjustScrollPositionOnItemSizeChange = (
    item,
    _delta,
    instance,
  ) => {
    const fold = (instance.scrollOffset ?? 0) + readingLine.current;
    if (!instance.itemSizeCache.has(item.key)) return item.start < fold;
    return item.end <= fold && instance.scrollDirection !== "backward";
  };

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
  const settle = (index: number, offset: number) => {
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
          (scroller.getBoundingClientRect().top + offset);
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
  // The mounted hunks holding notes, compared in a word: a row mounting
  // or unmounting without notes costs the gutter nothing.
  const noteRows = items
    .flatMap((item) => {
      const row = rows[item.index]!;
      return row.kind === "hunk" && byHunk.has(row.entry.hunk.id)
        ? [row.entry.hunk.id]
        : [];
    })
    .join("\n");
  const shownNoteRows = useRef<string>(undefined);
  useLayoutEffect(() => {
    if (shownNoteRows.current === noteRows) return;
    shownNoteRows.current = noteRows;
    onNoteRowsChange(new Set(noteRows ? noteRows.split("\n") : []));
  }, [noteRows, onNoteRowsChange]);

  useImperativeHandle(navigator, () => ({
    tops() {
      if (!scroller) return [];
      const top = scroller.getBoundingClientRect().top - scroller.scrollTop;
      const measured = virtualizer.measurementsCache;
      return sectionRows.map((row) => top + (measured[row]?.start ?? 0));
    },
    reach(index) {
      const row = sectionRows[index];
      if (row === undefined || !scroller || !list.current) return;
      // Below the sticky versions bar, read once per reach.
      const offset = readingOffset(list.current);
      // A jump to where the rows above it say it starts, then the title
      // holds the reading line by its own position as the rows near it
      // mount and draw.
      const start = virtualizer.measurementsCache[row]?.start ?? 0;
      virtualizer.scrollToOffset(start - offset);
      settle(index, offset);
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
                fileViewed={
                  section.file ? fileIsViewed(section.file, viewed) : false
                }
                onToggleFileViewed={onToggleFileViewed}
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
                onAddComment={onAddComment}
                changedIn={changed?.get(row.entry.hunk.id)}
              />
            )}
          </div>
        );
      })}
    </div>
  );
});
