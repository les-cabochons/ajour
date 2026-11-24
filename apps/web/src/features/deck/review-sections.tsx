import { memo, useCallback, useId, useMemo, type ReactNode } from "react";
import { RiCheckLine as Check } from "@remixicon/react";
import type { DeckHunk } from "@ajour/shared/deck";
import {
  DiffHunk,
  type DiffHunkAnnotation,
  type DiffLineRange,
} from "@/components/diff-hunk";
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
import type { ReviewNote } from "@/domain/deck/review-notes";
import { renderNoteCard } from "./review-notes";

/*
 * The sections of Deck's review page (#782): the guide's concerns, numbered
 * in reading order with a title and a one-line rationale, or the files A–Z.
 * Each hunk has a Viewed mark, local to the page for now, which folds it
 * and fills its concern's tick in the guide tree. A hunk's review threads
 * (#783), draft comments and the composer (#784) sit after their lines, or
 * only mark them when the gutter beside the sections holds the cards. A
 * "+" beside a line opens the composer on it.
 */

/** Opens the composer on lines of a hunk of the file at `path`. */
export type AddComment = (
  path: string,
  hunkId: string,
  lines: DiffLineRange,
) => void;

/** Marks the section element J and K move between. */
export const SECTION_ATTRIBUTE = "data-review-section";

/** The lines a hovered note highlights, kept inside its hunk. */
function highlightOf(hunk: DeckHunk, entry: ReviewNote | undefined) {
  if (!entry) return null;
  const first = entry.side === "additions" ? hunk.newStart : hunk.oldStart;
  const start = Math.max(entry.startLine ?? entry.line, first);
  return { side: entry.side, start, end: entry.line };
}

/** One hunk: in a concern, its file's path first; then its Viewed mark and its lines. */
export const ReviewHunkView = memo(function ReviewHunkView({
  entry,
  inConcern,
  viewed,
  theme,
  onToggleViewed,
  annotations,
  renderAnnotation,
  hovered,
  onAddComment,
}: {
  entry: ReviewHunk;
  inConcern: boolean;
  viewed: boolean;
  theme: "light" | "dark";
  onToggleViewed: (hunkId: string) => void;
  /** The marks after the lines the hunk's threads are on. */
  annotations: readonly DiffHunkAnnotation[] | undefined;
  renderAnnotation: ((key: string) => ReactNode) | undefined;
  /** The hovered note, or else the composer, when it's on this hunk. */
  hovered: ReviewNote | undefined;
  onAddComment: AddComment | undefined;
}) {
  const { file, hunk } = entry;
  const addComment = useMemo(
    () =>
      onAddComment
        ? (lines: DiffLineRange) => onAddComment(file.path, hunk.id, lines)
        : undefined,
    [file.path, hunk.id, onAddComment],
  );
  const withoutLines = hunk.header ? undefined : fileWithoutLines(file);
  const label = hunk.header ? hunkLabel(file, hunk) : file.path;
  const note = inConcern ? fileNote(file) : undefined;
  return (
    <div className="deck-hunk" data-viewed={viewed || undefined}>
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
          onAddComment={addComment}
        />
      )}
    </div>
  );
});

/**
 * A section's header: a file's path and note, or a concern's number, title,
 * rationale and viewed count. Its `h3` has `headingId`, and J and K focus it.
 */
export function ReviewSectionHeader({
  section,
  seen,
  headingId,
}: {
  section: ReviewSection;
  /** Its hunks marked viewed. */
  seen: number;
  headingId: string;
}) {
  const { file } = section;
  const note = file ? fileNote(file) : undefined;
  const total = section.hunks.length;
  return file ? (
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
  );
}

/** Where the notes on some hunks show, as `useNoteMarks` takes them. */
export interface NoteMarksInput {
  /** The threads, draft comments and composer on these hunks' lines, or none. */
  notes: readonly ReviewNote[] | undefined;
  /** Notes float in the gutter, so a line only marks where its note is. */
  floating: boolean;
  /** The hovered note's key, when it's on these hunks. */
  hovered: string | undefined;
  /** Called with each mark after a note's line as it's drawn, so the gutter can place its card. */
  onAnchor: (element: HTMLElement | null) => void;
}

/**
 * What the hunks draw after their notes' lines: each hunk's annotations,
 * the mark or card for each, and the hovered note's entry, or else the
 * composer's.
 */
export function useNoteMarks({
  notes,
  floating,
  hovered,
  onAnchor,
}: NoteMarksInput) {
  const byHunk = useMemo(() => {
    const map = new Map<string, DiffHunkAnnotation[]>();
    for (const entry of notes ?? []) {
      const list = map.get(entry.hunkId) ?? [];
      list.push({ key: entry.key, side: entry.side, line: entry.line });
      map.set(entry.hunkId, list);
    }
    return map;
  }, [notes]);
  const byId = useMemo(
    () => new Map((notes ?? []).map((entry) => [entry.key, entry])),
    [notes],
  );
  const composer = notes?.find((entry) => entry.kind === "composer");
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
          {renderNoteCard(entry, hot === key)}
        </div>
      ) : null;
    },
    [byId, floating, hot, onAnchor],
  );
  // The composer's lines stay highlighted while nothing else is hovered.
  const hoveredEntry = (hovered ? byId.get(hovered) : undefined) ?? composer;
  return { byHunk, renderAnnotation, hoveredEntry };
}

/** A concern of the guide, or a file of Files A–Z, with its hunks in order. */
export const ReviewSectionView = memo(function ReviewSectionView({
  section,
  viewed,
  theme,
  onToggleViewed,
  notes,
  floating,
  hovered,
  onAnchor,
  onAddComment,
}: {
  section: ReviewSection;
  viewed: ReadonlySet<string>;
  theme: "light" | "dark";
  onToggleViewed: (hunkId: string) => void;
  /** The section's threads, draft comments and composer on its lines, or none. */
  notes: readonly ReviewNote[] | undefined;
  /** Notes float in the gutter, so a line only marks where its note is. */
  floating: boolean;
  /** The hovered note's key, when it's in this section. */
  hovered: string | undefined;
  /** Called with each mark after a note's line as it's drawn, so the gutter can place its card. */
  onAnchor: (element: HTMLElement | null) => void;
  /** Opens the composer; undefined when the pull request takes no comments. */
  onAddComment: AddComment | undefined;
}) {
  const headingId = useId();
  const { byHunk, renderAnnotation, hoveredEntry } = useNoteMarks({
    notes,
    floating,
    hovered,
    onAnchor,
  });
  const attribute = { [SECTION_ATTRIBUTE]: "" };
  return (
    <section
      className={section.file ? "deck-file" : "deck-concern"}
      aria-labelledby={headingId}
      {...attribute}
    >
      <ReviewSectionHeader
        section={section}
        seen={viewedCount(section, viewed)}
        headingId={headingId}
      />
      {section.hunks.map((entry) => (
        <ReviewHunkView
          key={entry.hunk.id}
          entry={entry}
          inConcern={!section.file}
          viewed={viewed.has(entry.hunk.id)}
          theme={theme}
          onToggleViewed={onToggleViewed}
          annotations={byHunk.get(entry.hunk.id)}
          renderAnnotation={renderAnnotation}
          hovered={
            hoveredEntry?.hunkId === entry.hunk.id ? hoveredEntry : undefined
          }
          onAddComment={onAddComment}
        />
      ))}
    </section>
  );
});
