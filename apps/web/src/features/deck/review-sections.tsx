import { memo, useId } from "react";
import { RiCheckLine as Check } from "@remixicon/react";
import { DiffHunk } from "@/components/diff-hunk";
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

/*
 * The sections of Deck's review page (#782): the guide's concerns, numbered
 * in reading order with a title and a one-line rationale, or the files A–Z.
 * Each hunk has a Viewed mark, local to the page for now, which folds it
 * and fills its concern's tick in the guide tree.
 */

/** Marks the section element J and K move between. */
export const SECTION_ATTRIBUTE = "data-review-section";

/** One hunk: in a concern, its file's path first; then its Viewed mark and its lines. */
export const ReviewHunkView = memo(function ReviewHunkView({
  entry,
  inConcern,
  viewed,
  theme,
  onToggleViewed,
}: {
  entry: ReviewHunk;
  inConcern: boolean;
  viewed: boolean;
  theme: "light" | "dark";
  onToggleViewed: (hunkId: string) => void;
}) {
  const { file, hunk } = entry;
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
          patch={hunk.patch}
          rows={hunkRowCount(hunk)}
          label={label}
          theme={theme}
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

/** A concern of the guide, or a file of Files A–Z, with its hunks in order. */
export const ReviewSectionView = memo(function ReviewSectionView({
  section,
  viewed,
  theme,
  onToggleViewed,
}: {
  section: ReviewSection;
  viewed: ReadonlySet<string>;
  theme: "light" | "dark";
  onToggleViewed: (hunkId: string) => void;
}) {
  const headingId = useId();
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
        />
      ))}
    </section>
  );
});
