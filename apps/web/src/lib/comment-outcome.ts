import {
  isCommentOutcome,
  type CommentOutcome,
} from "@/domain/backlog/comment-outcomes";

/**
 * The comment editor's last outcome used, which its button runs next, per
 * device and for every item. Like the sidebar layout, it lives outside the
 * local app state so it is never exported. Until one is used, the button
 * reads Comment.
 */
export const COMMENT_OUTCOME_STORAGE_KEY = "ajour.comment-outcome";

let unsaved: CommentOutcome | undefined;

export function getSavedCommentOutcome(): CommentOutcome {
  if (unsaved) return unsaved;
  try {
    const value = window.localStorage.getItem(COMMENT_OUTCOME_STORAGE_KEY);
    return isCommentOutcome(value) ? value : "comment";
  } catch {
    // Storage can be unavailable under restrictive privacy settings.
    return "comment";
  }
}

export function saveCommentOutcome(outcome: CommentOutcome) {
  try {
    window.localStorage.setItem(COMMENT_OUTCOME_STORAGE_KEY, outcome);
    unsaved = undefined;
  } catch {
    // The choice then lasts until Ajour quits.
    unsaved = outcome;
  }
}
