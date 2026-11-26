import { createContext, useContext } from "react";
import type {
  DiffLineHighlight,
  DiffSelectionChange,
} from "@/components/diff-hunk";
import type { LineSelection } from "@/domain/deck/line-selection";
import type { ReviewLineSelection } from "./review-line-selection";

/*
 * What the review page gives its hunks and answers about selected lines
 * (#793), apart from the toolbar so the asks' module reads it too.
 */

export interface ReviewLines {
  selection: ReviewLineSelection;
  /** The changed files' paths, which an answer's citations name. */
  paths: readonly string[];
  /** A hunk's library picked lines, or none. */
  select: (
    hunkId: string,
    range: DiffLineHighlight | null,
    change: DiffSelectionChange,
  ) => void;
  /** Opens the composer on the lines, with `body`; undefined when the pull request takes no comments. */
  comment: ((selection: LineSelection, body?: string) => void) | undefined;
  /** Scrolls to a citation's line and highlights it. */
  cite: (href: string) => void;
}

export const ReviewLinesContext = createContext<ReviewLines | null>(null);

/** The page's selected lines, or null outside the review page's changes. */
export function useReviewLines() {
  return useContext(ReviewLinesContext);
}
