import { createContext, useContext } from "react";
import type {
  DiffLineHighlight,
  DiffLineRange,
  DiffSelectionChange,
} from "@/components/diff-hunk";
import type { DeckPullRequestDiff } from "@ajour/shared/deck";
import type { LineSelection } from "@/domain/deck/line-selection";
import type { ReviewLineSelection } from "./review-line-selection";

/*
 * What the review page gives its hunks and answers about selected lines
 * (#793), apart from the toolbar so the asks' module reads it too.
 */

/**
 * Opens the composer on lines of a hunk of the file at `path`. Given
 * `body`, the composer takes it, after the words it holds when it's
 * already open there. True once it has.
 */
export type AddComment = (
  path: string,
  hunkId: string,
  lines: DiffLineRange,
  body?: string,
) => boolean;

export interface ReviewLines {
  selection: ReviewLineSelection;
  /** The diff on screen, whose lines an answer's citations name. */
  diff: DeckPullRequestDiff;
  /** A hunk's library picked lines, or none. */
  select: (
    hunkId: string,
    range: DiffLineHighlight | null,
    change: DiffSelectionChange,
  ) => void;
  /**
   * Opens the composer on the lines, handing it `body` (see `AddComment`);
   * true once it took it. Undefined when the pull request takes no comments.
   */
  comment: ((selection: LineSelection, body?: string) => boolean) | undefined;
  /** Scrolls to a citation's line and highlights it. */
  cite: (href: string) => void;
}

export const ReviewLinesContext = createContext<ReviewLines | null>(null);

/** The page's selected lines, or null outside the review page's changes. */
export function useReviewLines() {
  return useContext(ReviewLinesContext);
}
