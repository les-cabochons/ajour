import type { CodeHostDiffSide, CodeHostReviewThread } from "@ajour/shared";
import type { DeckPullRequestDiff } from "@ajour/shared/deck";
import type { DeckDraftComment, PlacedDraft } from "./draft-review";
import {
  findLine,
  inDiffOrder,
  type AnnotationSide,
  type PlacedThread,
} from "./review-threads";

/*
 * What the review page shows at a line of the diff (#783, #784): a review
 * thread, a comment of the draft review, or the composer, in the diff's
 * order. The gutter and the hunks place them all the same way, by `key`.
 */

/** Where a note is on the diff. */
export interface NotePlace {
  /** Unique on the page: a thread's id, `draft:` and a draft comment's, or `composer`. */
  key: string;
  hunkId: string;
  side: AnnotationSide;
  line: number;
  /** The first line of a note on several lines. */
  startLine?: number;
  /** The hunk's row the line is on, from 0, for where the card goes before the hunk draws. */
  row: number;
}

/** The lines the composer comments on, and the draft comment it edits. */
export interface ComposerTarget {
  path: string;
  side: CodeHostDiffSide;
  line: number;
  startLine?: number;
  /** The line's text, kept with the draft comment. */
  lineText: string;
  /** The draft comment being edited, or undefined for a new comment. */
  editing?: string;
  body: string;
}

export type ReviewNote = NotePlace &
  (
    | { kind: "thread"; thread: CodeHostReviewThread }
    | { kind: "draft"; comment: DeckDraftComment }
    | { kind: "composer"; target: ComposerTarget }
  );

/** The composer's own identity: another target is another composer, with its own words. */
export function composerIdentity(target: ComposerTarget) {
  return target.editing
    ? `edit:${target.editing}`
    : `new:${target.path}:${target.side}:${target.startLine ?? target.line}-${target.line}`;
}

const startOf = (startLine: number | undefined) =>
  startLine !== undefined ? { startLine } : {};

/**
 * Every note on the diff's lines, in its order: the threads, the draft's
 * comments but the one the composer edits, and the composer, when its
 * lines show.
 */
export function reviewNotes(
  diff: DeckPullRequestDiff,
  threads: readonly PlacedThread[],
  drafts: readonly PlacedDraft[],
  composer: ComposerTarget | undefined,
): ReviewNote[] {
  const notes: ReviewNote[] = [
    ...threads.map((entry): ReviewNote => ({
      kind: "thread",
      key: entry.thread.id,
      thread: entry.thread,
      hunkId: entry.hunkId,
      side: entry.side,
      line: entry.line,
      ...startOf(entry.thread.startLine),
      row: entry.row,
    })),
    ...drafts
      .filter((entry) => entry.comment.id !== composer?.editing)
      .map((entry): ReviewNote => ({
        kind: "draft",
        key: `draft:${entry.comment.id}`,
        comment: entry.comment,
        hunkId: entry.hunkId,
        side: entry.side,
        line: entry.line,
        ...startOf(entry.comment.startLine),
        row: entry.row,
      })),
  ];
  const at = composer ? findLine(diff, composer) : undefined;
  if (composer && at)
    notes.push({
      kind: "composer",
      key: "composer",
      target: composer,
      hunkId: at.hunkId,
      side: at.side,
      line: at.line,
      ...startOf(composer.startLine),
      row: at.row,
    });
  return inDiffOrder(diff, notes);
}
