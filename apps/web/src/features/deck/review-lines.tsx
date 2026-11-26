import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import {
  DECK_LINES_DEFAULT_QUESTION,
  deckLinesLabel,
  type DeckPullRequestDiff,
} from "@ajour/shared/deck";
import {
  lineElement,
  type DiffLineHighlight,
  type DiffSelectionChange,
} from "@/components/diff-hunk";
import {
  citationAt,
  commentLines,
  extendByTap,
  linesAnchor,
  selectLines,
  type LineSelection,
} from "@/domain/deck/line-selection";
import { useShortcut } from "@/lib/shortcut-handlers";
import type { ShortcutActionId } from "@/lib/shortcuts";
import { useDeckAsks } from "./deck-ask";
import { ReviewLineSelection } from "./review-line-selection";
import { useReviewLines, type ReviewLines } from "./review-lines-context";
import type { SectionNavigator } from "./review-scroll";
import type { AddComment } from "./review-sections";

/*
 * Selected lines on Deck's review page (#793). The hunks report what the
 * diff library picks on their line numbers to the page's one selection;
 * the hunk holding it shows the toolbar above it, `Explain E · Comment C ·
 * Ask… A`, which exists only while lines are selected, and whose keys
 * work only then. An answer's citations scroll to their line and
 * highlight it. Nothing is mounted per line.
 */

/** The page's selected lines, for the diff on screen. */
export function useReviewLinesValue({
  diff,
  onAddComment,
  navigator,
  viewed,
  onToggleViewed,
}: {
  diff: DeckPullRequestDiff;
  onAddComment: AddComment | undefined;
  navigator: RefObject<SectionNavigator | null>;
  viewed: ReadonlySet<string>;
  onToggleViewed: (hunkId: string) => void;
}): ReviewLines {
  const [selection] = useState(() => new ReviewLineSelection());
  // Read when a citation goes to a folded hunk, which unfolds it.
  const viewedNow = useRef(viewed);
  useEffect(() => {
    viewedNow.current = viewed;
  }, [viewed]);
  return useMemo((): ReviewLines => {
    return {
      selection,
      diff,
      select(hunkId, range, { settled, tap }) {
        const picked = range ? selectLines(diff, hunkId, range) : undefined;
        if (!settled) {
          selection.change(picked);
          return;
        }
        selection.settle(
          picked && tap ? extendByTap(diff, selection.picked, picked) : picked,
        );
      },
      comment: onAddComment
        ? (lines, body) =>
            onAddComment(
              lines.path,
              lines.hunkId,
              commentLines(diff, lines),
              body,
            )
        : undefined,
      cite(href) {
        const at = citationAt(diff, href);
        if (!at) return;
        const point = { side: at.side, line: at.line };
        selection.cite(at.hunkId, point);
        const reveal = () =>
          navigator.current?.reveal(at.hunkId, at.row, point);
        if (viewedNow.current.has(at.hunkId)) {
          // A folded hunk draws its lines again first.
          onToggleViewed(at.hunkId);
          requestAnimationFrame(reveal);
        } else {
          reveal();
        }
      },
    };
  }, [diff, onAddComment, navigator, onToggleViewed, selection]);
}

/** The selection as the hunk highlights it. */
export function highlightOfSelection(
  selection: LineSelection,
): DiffLineHighlight {
  return {
    side: selection.start.side,
    start: selection.start.line,
    end: selection.end.line,
    endSide: selection.end.side,
  };
}

const capitalized = (text: string) =>
  text.charAt(0).toUpperCase() + text.slice(1);

/** Runs `run` on the key of `id` while it is mounted. */
function ShortcutKey({ id, run }: { id: ShortcutActionId; run: () => void }) {
  useShortcut(id, run);
  return null;
}

/**
 * The toolbar above the selected lines of a hunk: Explain asks the default
 * question at once, Comment opens the composer on them, and Ask… opens
 * the question to send as is or edit. Each answer goes under the hunk.
 * Escape leaves the lines. It is placed on the first selected line as it
 * mounts, and again as its hunk resizes: `hunk` is the hunk's box, which
 * the library draws in.
 */
export function LinesToolbar({
  selection,
  hunk,
}: {
  selection: LineSelection;
  hunk: RefObject<HTMLElement | null>;
}) {
  const lines = useReviewLines();
  const asks = useDeckAsks();
  const bar = useRef<HTMLDivElement>(null);
  const [top, setTop] = useState<number>();
  const { start } = selection;
  useLayoutEffect(() => {
    const box = hunk.current;
    const parent = bar.current?.offsetParent;
    if (!box || !parent) return;
    // One read as it is placed, and again only as its hunk resizes, such
    // as a thread opening or lines wrapping above the selection.
    const place = () => {
      const line = lineElement(box, start) ?? box;
      setTop(
        line.getBoundingClientRect().top - parent.getBoundingClientRect().top,
      );
    };
    place();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(place);
    observer.observe(box);
    return () => observer.disconnect();
  }, [hunk, start]);
  if (!lines) return null;
  const anchor = linesAnchor(selection);
  const label = deckLinesLabel(anchor);
  const open = () => {
    lines.selection.clear();
    return asks?.sessions.open(asks.target.head, anchor, {
      question: DECK_LINES_DEFAULT_QUESTION,
      hunkId: selection.hunkId,
    });
  };
  const explain = () => {
    if (!asks) return;
    open();
    void asks.sessions.ask(asks.target, anchor, undefined, () => {});
  };
  const ask = () => void open();
  const { comment } = lines;
  const commentOn = comment
    ? () => {
        lines.selection.clear();
        comment(selection);
      }
    : undefined;
  return (
    <div
      ref={bar}
      role="toolbar"
      aria-label={`${capitalized(label)} selected`}
      className="deck-lines-toolbar"
      style={top === undefined ? undefined : { top }}
      data-placed={top === undefined ? undefined : ""}
    >
      {/* Read out as the lines are picked, from the keyboard too. */}
      <span className="sr-only" role="status">
        {`${capitalized(label)} selected.`}
      </span>
      <ShortcutKey id="deck.lines-leave" run={() => lines.selection.clear()} />
      {asks ? (
        <>
          <ToolbarButton label="Explain" shortcut="E" onClick={explain} />
          <ShortcutKey id="deck.lines-explain" run={explain} />
        </>
      ) : null}
      {commentOn ? (
        <>
          <ToolbarButton label="Comment" shortcut="C" onClick={commentOn} />
          <ShortcutKey id="deck.lines-comment" run={commentOn} />
        </>
      ) : null}
      {asks ? (
        <>
          <ToolbarButton label="Ask…" shortcut="A" onClick={ask} />
          <ShortcutKey id="deck.lines-ask" run={ask} />
        </>
      ) : null}
    </div>
  );
}

function ToolbarButton({
  label,
  shortcut,
  onClick,
}: {
  label: string;
  shortcut: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="deck-lines-action"
      aria-keyshortcuts={shortcut}
      // The selection stays as the pointer presses the toolbar.
      onPointerDown={(event) => event.preventDefault()}
      onClick={onClick}
    >
      {label}
      <kbd aria-hidden="true" className="touch-or-narrow:hidden">
        {shortcut}
      </kbd>
    </button>
  );
}
