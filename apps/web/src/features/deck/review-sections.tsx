import { memo, useCallback, useId, useMemo, type ReactNode } from "react";
import { RiCheckLine as Check } from "@remixicon/react";
import type { DeckHunk } from "@ajour/shared/deck";
import { DiffHunk, type DiffHunkAnnotation } from "@/components/diff-hunk";
import { ConcernRationale } from "./deck-ask";
import { Value } from "@/components/ui/value";
import {
  fileNote,
  fileWithoutLines,
  hunkLabel,
  hunkRowCount,
} from "@/domain/deck/review-diff";
import {
  viewedCount,
  type ReviewHunk,
  type ReviewSection,
} from "@/domain/deck/guide";
import type { PlacedThread } from "@/domain/deck/review-threads";
import { ChangeKinds } from "./pull-request-summary";
import { ReviewThreadCard } from "./review-thread-card";

/*
 * The sections of Deck's review page (#782): the guide's concerns, numbered
 * in reading order with a title and a one-line rationale, or the files A–Z.
 * Each hunk has a Viewed mark, local to the page for now, which folds it
 * and fills its concern's tick in the guide tree. A hunk's review threads
 * (#783) sit after their lines, or only mark them when the gutter beside
 * the sections holds the cards.
 */

/** Marks the section element J and K move between. */
export const SECTION_ATTRIBUTE = "data-review-section";
/** Holds a hunk's id on its element, which a summary line scrolls to. */
export const HUNK_ATTRIBUTE = "data-hunk-id";

/** The lines a hovered thread highlights, kept inside its hunk. */
function highlightOf(hunk: DeckHunk, entry: PlacedThread | undefined) {
  if (!entry) return null;
  const first = entry.side === "additions" ? hunk.newStart : hunk.oldStart;
  const start = Math.max(entry.thread.startLine ?? entry.line, first);
  return { side: entry.side, start, end: entry.line };
}

/** One hunk: in a concern, its file's path first; then its Viewed mark and its lines. */
const ReviewHunkView = memo(function ReviewHunkView({
  entry,
  inConcern,
  viewed,
  theme,
  onToggleViewed,
  annotations,
  renderAnnotation,
  hovered,
}: {
  entry: ReviewHunk;
  inConcern: boolean;
  viewed: boolean;
  theme: "light" | "dark";
  onToggleViewed: (hunkId: string) => void;
  /** The marks after the lines the hunk's threads are on. */
  annotations: readonly DiffHunkAnnotation[] | undefined;
  renderAnnotation: ((key: string) => ReactNode) | undefined;
  /** The hovered thread, when it's on this hunk. */
  hovered: PlacedThread | undefined;
}) {
  const { file, hunk } = entry;
  const withoutLines = hunk.header ? undefined : fileWithoutLines(file);
  const label = hunk.header ? hunkLabel(file, hunk) : file.path;
  const note = inConcern ? fileNote(file) : undefined;
  const attribute = { [HUNK_ATTRIBUTE]: hunk.id };
  return (
    <div
      className="deck-hunk"
      data-viewed={viewed || undefined}
      tabIndex={-1}
      {...attribute}
    >
      <div className="deck-hunk-header">
        {inConcern ? <span className="deck-hunk-path">{file.path}</span> : null}
        {note ? <span className="deck-file-note">{note}</span> : null}
        <button
          type="button"
          className="deck-hunk-viewed"
          aria-pressed={viewed}
          aria-label={`Viewed: ${label}`}
          onClick={() => onToggleViewed(hunk.id)}
        >
          <span className="deck-hunk-viewed-box" aria-hidden>
            {viewed ? <Check /> : null}
          </span>
          Viewed
        </button>
      </div>
      {viewed ? null : withoutLines ? (
        <p className="deck-file-empty">{withoutLines}</p>
      ) : (
        <DiffHunk
          hunkId={hunk.id}
          patch={hunk.patch}
          rows={hunkRowCount(hunk)}
          label={label}
          theme={theme}
          annotations={annotations}
          renderAnnotation={annotations ? renderAnnotation : undefined}
          highlight={annotations ? highlightOf(hunk, hovered) : undefined}
        />
      )}
    </div>
  );
});

/** A concern of the guide, or a file of Files A–Z, with its hunks in order. */
export const ReviewSectionView = memo(function ReviewSectionView({
  section,
  viewed,
  theme,
  onToggleViewed,
  placed,
  floating,
  hovered,
  onHover,
  onAnchor,
}: {
  section: ReviewSection;
  viewed: ReadonlySet<string>;
  theme: "light" | "dark";
  onToggleViewed: (hunkId: string) => void;
  /** The section's review threads on its lines, or none. */
  placed: readonly PlacedThread[] | undefined;
  /** Threads float in the gutter, so a line only marks where its thread is. */
  floating: boolean;
  /** The hovered thread, when it's in this section. */
  hovered: string | undefined;
  onHover: (threadId: string | undefined) => void;
  /** Called with each mark after a thread's line as it's drawn, so the gutter can place its card. */
  onAnchor: (element: HTMLElement | null) => void;
}) {
  const headingId = useId();
  const byHunk = useMemo(() => {
    const map = new Map<string, DiffHunkAnnotation[]>();
    for (const entry of placed ?? []) {
      const list = map.get(entry.hunkId) ?? [];
      list.push({ key: entry.thread.id, side: entry.side, line: entry.line });
      map.set(entry.hunkId, list);
    }
    return map;
  }, [placed]);
  const byId = useMemo(
    () => new Map((placed ?? []).map((entry) => [entry.thread.id, entry])),
    [placed],
  );
  // In the gutter a line's mark doesn't change with the hover, so the
  // section's hunks don't draw again as it moves.
  const hot = floating ? undefined : hovered;
  const renderAnnotation = useCallback(
    (key: string) => {
      if (floating)
        return (
          <span
            ref={onAnchor}
            className="deck-thread-anchor"
            data-thread-anchor={key}
          />
        );
      const entry = byId.get(key);
      return entry ? (
        <div className="deck-inline-thread">
          <ReviewThreadCard
            thread={entry.thread}
            hot={hot === key}
            onHover={onHover}
          />
        </div>
      ) : null;
    },
    [byId, floating, hot, onAnchor, onHover],
  );
  const hoveredEntry = hovered ? byId.get(hovered) : undefined;
  const { file } = section;
  const note = file ? fileNote(file) : undefined;
  const seen = viewedCount(section, viewed);
  const total = section.hunks.length;
  const attribute = { [SECTION_ATTRIBUTE]: "" };
  return (
    <section
      className={file ? "deck-file" : "deck-concern"}
      aria-labelledby={headingId}
      {...attribute}
    >
      {file ? (
        <header className="deck-file-header">
          <h3 id={headingId} tabIndex={-1} className="deck-file-path">
            {file.path}
          </h3>
          {note ? <span className="deck-file-note">{note}</span> : null}
        </header>
      ) : (
        <header className="deck-concern-header">
          <span
            className="deck-concern-number"
            data-done={seen === total || undefined}
            aria-hidden
          >
            {section.number}
          </span>
          <div className="deck-concern-text">
            <h3 id={headingId} tabIndex={-1} className="deck-concern-title">
              <span className="sr-only">{`Concern ${section.number}:`}</span>{" "}
              {section.title}
            </h3>
            <ChangeKinds kinds={section.kinds ?? []} />
            {section.concernId ? (
              <ConcernRationale
                concernId={section.concernId}
                rationale={section.rationale ?? ""}
              />
            ) : section.rationale ? (
              <p className="deck-concern-rationale">{section.rationale}</p>
            ) : null}
          </div>
          <Value tone="muted" className="deck-concern-progress">
            {seen}/{total}
          </Value>
        </header>
      )}
      {section.hunks.map((entry) => (
        <ReviewHunkView
          key={entry.hunk.id}
          entry={entry}
          inConcern={!file}
          viewed={viewed.has(entry.hunk.id)}
          theme={theme}
          onToggleViewed={onToggleViewed}
          annotations={byHunk.get(entry.hunk.id)}
          renderAnnotation={renderAnnotation}
          hovered={
            hoveredEntry?.hunkId === entry.hunk.id ? hoveredEntry : undefined
          }
        />
      ))}
    </section>
  );
});
