import {
  memo,
  useCallback,
  useId,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import { RiCheckLine as Check } from "@remixicon/react";
import type { DeckFile, DeckHunk } from "@ajour/shared/deck";
import {
  DiffHunk,
  type DiffHunkAnnotation,
  type DiffLineRange,
} from "@/components/diff-hunk";
import { ConcernRationale, HunkAsks } from "./deck-ask";
import { Chip } from "@/components/ui/chip";
import { Value } from "@/components/ui/value";
import {
  fileNote,
  fileOnCodeHost,
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
import { fileIsViewed } from "@/domain/deck/viewed-marks";
import { useCodeHostLink } from "./code-host-link";
import { useHunkLines } from "./review-line-selection";
import { highlightOfSelection, LinesToolbar } from "./review-lines";
import { useReviewLines, type AddComment } from "./review-lines-context";
import { ChangeKinds } from "./pull-request-summary";
import { renderNoteCard } from "./review-notes";

/*
 * The sections of Deck's review page (#782): the guide's concerns, numbered
 * in reading order with a title and a one-line rationale, or the files A–Z.
 * Each hunk has a Viewed mark, kept on this computer (#785), which folds it
 * and fills its concern's tick in the guide tree; in Files A–Z each file
 * has one too, which marks all its hunks. A hunk's review threads
 * (#783), draft comments and the composer (#784) sit after their lines, or
 * only mark them when the gutter beside the sections holds the cards. A
 * "+" beside a line opens the composer on it. Lines selected in a hunk
 * (#793) show the toolbar above them, and the answers about them follow
 * the hunk's lines.
 */

export type { AddComment };

/** Marks every hunk of a file viewed, or none. */
export type ToggleFileViewed = (file: DeckFile) => void;

/** Marks the section element J and K move between. */
export const SECTION_ATTRIBUTE = "data-review-section";
/** Holds a hunk's id on its element, which a summary line scrolls to. */
export const HUNK_ATTRIBUTE = "data-hunk-id";

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
  changedIn,
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
  /** The version the hunk last changed in, when it changed since the review (#787). */
  changedIn: number | undefined;
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
  // The page's selected lines and cited line, when they are in this hunk.
  const lines = useReviewLines();
  const codeHost = useCodeHostLink();
  const shown = useHunkLines(lines?.selection, hunk.id);
  const onSelectLines = useMemo(
    () =>
      lines
        ? (
            range: Parameters<typeof lines.select>[1],
            change: Parameters<typeof lines.select>[2],
          ) => lines.select(hunk.id, range, change)
        : undefined,
    [lines, hunk.id],
  );
  // The selection wins over the keyboard's line and the hover; a cited
  // line shows only while no note is hovered and no composer is open.
  const selected = useMemo(
    () =>
      shown?.selection ? highlightOfSelection(shown.selection) : undefined,
    [shown],
  );
  const cited = useMemo(
    () =>
      shown?.cited
        ? {
            side: shown.cited.side,
            start: shown.cited.line,
            end: shown.cited.line,
          }
        : undefined,
    [shown],
  );
  const noted = annotations ? highlightOf(hunk, hovered) : undefined;
  const box = useRef<HTMLDivElement>(null);
  const drawn = !viewed && !withoutLines;
  const attribute = { [HUNK_ATTRIBUTE]: hunk.id };
  return (
    <div
      ref={box}
      className="deck-hunk"
      data-viewed={viewed || undefined}
      tabIndex={-1}
      {...attribute}
    >
      <div className="deck-hunk-header">
        {inConcern ? <span className="deck-hunk-path">{file.path}</span> : null}
        {note ? <span className="deck-file-note">{note}</span> : null}
        {changedIn ? (
          <Chip className="deck-hunk-changed">{`Changed in v${changedIn}`}</Chip>
        ) : null}
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
      {drawn && shown?.selection && shown.settled ? (
        <LinesToolbar selection={shown.selection} hunk={box} />
      ) : null}
      {viewed ? null : withoutLines ? (
        <p className="deck-file-empty">
          {withoutLines}
          {file.tooLarge && codeHost && lines ? (
            <>
              {" "}
              <a
                href={fileOnCodeHost(codeHost.pullRequestUrl, file, lines.diff)}
                target="_blank"
                rel="noreferrer"
              >
                {`Open in ${codeHost.pluginName}`}
              </a>
            </>
          ) : null}
        </p>
      ) : (
        <DiffHunk
          hunkId={hunk.id}
          patch={hunk.patch}
          rows={hunkRowCount(hunk)}
          label={label}
          theme={theme}
          annotations={annotations}
          renderAnnotation={annotations ? renderAnnotation : undefined}
          highlight={noted ?? cited}
          selected={selected}
          onSelectLines={onSelectLines}
          onAddComment={addComment}
        />
      )}
      {drawn ? <HunkAsks hunkId={hunk.id} /> : null}
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
  fileViewed,
  onToggleFileViewed,
}: {
  section: ReviewSection;
  /** Its hunks marked viewed. */
  seen: number;
  headingId: string;
  /** A file's section: all its hunks are viewed, the shown ones and any the filter hides. */
  fileViewed?: boolean;
  onToggleFileViewed?: ToggleFileViewed;
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
      {section.of ? (
        <Chip className="deck-concern-changed">{`${total} of ${section.of} changed`}</Chip>
      ) : null}
      {onToggleFileViewed ? (
        <button
          type="button"
          className="deck-hunk-viewed deck-file-viewed"
          aria-pressed={!!fileViewed}
          aria-label={`Viewed file: ${file.path}`}
          onClick={() => onToggleFileViewed(file)}
        >
          <span className="deck-hunk-viewed-box" aria-hidden>
            {fileViewed ? <Check /> : null}
          </span>
          File viewed
        </button>
      ) : null}
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
            title={section.title}
            rationale={section.rationale ?? ""}
          />
        ) : section.rationale ? (
          <p className="deck-concern-rationale">{section.rationale}</p>
        ) : null}
      </div>
      {section.of ? (
        <Chip className="deck-concern-changed">{`${total} of ${section.of} changed`}</Chip>
      ) : null}
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
  onToggleFileViewed,
  notes,
  floating,
  hovered,
  onAnchor,
  onAddComment,
  changed,
}: {
  section: ReviewSection;
  viewed: ReadonlySet<string>;
  theme: "light" | "dark";
  onToggleViewed: (hunkId: string) => void;
  onToggleFileViewed: ToggleFileViewed;
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
  /** The hunks changed since the review, with the version each last changed in. */
  changed: ReadonlyMap<string, number> | undefined;
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
        fileViewed={section.file ? fileIsViewed(section.file, viewed) : false}
        onToggleFileViewed={onToggleFileViewed}
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
          changedIn={changed?.get(entry.hunk.id)}
        />
      ))}
    </section>
  );
});
