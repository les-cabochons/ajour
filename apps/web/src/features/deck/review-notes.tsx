import {
  createContext,
  memo,
  useContext,
  useEffect,
  useRef,
  type ReactNode,
} from "react";
import { Markdown } from "@/components/markdown";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { DeckDraftComment } from "@/domain/deck/draft-review";
import { withSuggestion } from "@/domain/deck/suggestion";
import {
  composerIdentity,
  type ComposerTarget,
  type ReviewNote,
} from "@/domain/deck/review-notes";
import { getShortcutPlatform } from "@/lib/shortcuts";
import { useShortcut } from "@/lib/shortcut-handlers";
import {
  useComposerState,
  type ReviewComposerState,
} from "./review-composer-state";
import { ReviewThreadCard, threadLocation } from "./review-thread-card";

/*
 * The cards of what the review page shows at a line (`domain/deck/review-notes.ts`):
 * a review thread, a comment of the draft review, or the composer. Each
 * floats in the gutter beside its line from 1,100px, or sits right after
 * it. The page's actions reach the cards through `ReviewNotesContext`, so
 * a card changing draws only its own section again.
 */

/** The page's actions on its notes. */
export interface ReviewNoteActions {
  onHover: (key: string | undefined) => void;
  /** Adds the composer's comment to the draft review, or saves its edit. */
  addToReview: (target: ComposerTarget, body: string) => void;
  /**
   * Posts the composer's comment at once, keeping in `composer` that it's
   * posting, then why it failed or that the code host couldn't tell.
   */
  commentNow: (target: ComposerTarget, body: string) => Promise<void>;
  /** What the open composer holds, kept while its hunk scrolls away. */
  composer: ReviewComposerState;
  cancelComposer: () => void;
  editDraft: (comment: DeckDraftComment) => void;
  removeDraft: (comment: DeckDraftComment) => void;
  /** False once the pull request closed: its draft can't take new comments. */
  canComment: boolean;
}

export const ReviewNotesContext = createContext<ReviewNoteActions | undefined>(
  undefined,
);

function useNoteActions() {
  const actions = useContext(ReviewNotesContext);
  if (!actions) throw new Error("A review note needs ReviewNotesContext.");
  return actions;
}

/** A note's card: the thread, the draft comment, or the composer. */
export function NoteCard({ note, hot }: { note: ReviewNote; hot: boolean }) {
  const { onHover } = useNoteActions();
  if (note.kind === "thread")
    return (
      <ReviewThreadCard thread={note.thread} hot={hot} onHover={onHover} />
    );
  if (note.kind === "draft")
    return <DraftCommentCard comment={note.comment} hot={hot} />;
  // Other lines, or another comment to edit, start a composer of their own.
  return (
    <ReviewComposer key={composerIdentity(note.target)} target={note.target} />
  );
}

/** Draws each note's card, for the gutter and for the lines. */
export const renderNoteCard = (note: ReviewNote, hot: boolean): ReactNode => (
  <NoteCard note={note} hot={hot} />
);

/** Where a draft comment is, for one listed away from its line. */
export const draftLocation = (comment: DeckDraftComment) =>
  threadLocation(comment);

/**
 * A comment of the draft review: "Draft", its words, and Edit and Remove.
 * One a push made outdated says so, named by its file and lines.
 */
export const DraftCommentCard = memo(function DraftCommentCard({
  comment,
  hot,
  showLocation,
}: {
  comment: DeckDraftComment;
  hot?: boolean;
  showLocation?: boolean;
}) {
  const { onHover, editDraft, removeDraft, canComment } = useNoteActions();
  const key = `draft:${comment.id}`;
  return (
    <article
      className="deck-thread deck-draft"
      data-hot={hot || undefined}
      aria-label={`Draft comment on ${draftLocation(comment)}`}
      onMouseEnter={() => onHover(key)}
      onMouseLeave={() => onHover(undefined)}
      onFocus={() => onHover(key)}
      onBlur={() => onHover(undefined)}
    >
      {showLocation ? (
        <p className="deck-thread-location">{draftLocation(comment)}</p>
      ) : null}
      <div className="deck-comment">
        <p className="deck-comment-meta">
          <span className="deck-comment-author">Draft</span>
          {comment.outdated ? <span>Outdated</span> : null}
        </p>
        <Markdown>{comment.body}</Markdown>
      </div>
      <div className="deck-note-actions">
        {canComment && !comment.outdated ? (
          <Button variant="ghost" size="sm" onClick={() => editDraft(comment)}>
            Edit
          </Button>
        ) : null}
        <Button variant="ghost" size="sm" onClick={() => removeDraft(comment)}>
          Remove
        </Button>
      </div>
    </article>
  );
});

/**
 * The composer on the lines a "+" picked: **Add to review** (Ctrl+Enter)
 * keeps the comment in the draft review, **Comment now** posts it at once,
 * and a failed post keeps the words with the reason and Retry, or Post
 * again when the code host couldn't tell whether it has it. Editing a
 * draft comment offers Save instead. On lines of the head, **Suggest
 * change** adds a suggestion block holding the lines' text (#785). Its
 * words live with the page, so a huge pull request's hunk scrolling away
 * and back keeps them.
 */
function ReviewComposer({ target }: { target: ComposerTarget }) {
  const { addToReview, commentNow, cancelComposer, composer } =
    useNoteActions();
  const { body, posting, failure, uncertain, focus } = useComposerState(
    composer,
    target,
  );
  const field = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (!focus) return;
    const element = field.current;
    if (!element) return;
    const take = () => {
      element.focus({ preventScroll: true });
      if (document.activeElement !== element) return false;
      composer.update(target, { focus: false });
      return true;
    };
    if (take()) return;
    // The diff library shows its line's annotation once it has placed it:
    // the field takes focus as it gets a size.
    const sized = new ResizeObserver(() => {
      if (take()) sized.disconnect();
    });
    sized.observe(element);
    return () => sized.disconnect();
  }, [focus, composer, target]);
  const empty = !body.trim();
  const add = () => {
    if (!empty && !posting) addToReview(target, body);
  };
  useShortcut("deck.add-to-review", add);
  const postNow = () => {
    if (!empty && !posting) void commentNow(target, body);
  };
  const keys = getShortcutPlatform() === "mac" ? "Meta+Enter" : "Control+Enter";
  return (
    <form
      className="deck-thread deck-composer"
      aria-label={target.editing ? "Edit the draft comment" : "New comment"}
      onSubmit={(event) => {
        event.preventDefault();
        add();
      }}
    >
      <Textarea
        ref={field}
        aria-label="Comment"
        placeholder="Leave a comment"
        value={body}
        rows={3}
        onChange={(event) =>
          composer.update(target, { body: event.target.value })
        }
        onKeyDown={(event) => {
          if (event.key === "Escape" && !posting) {
            event.preventDefault();
            cancelComposer();
          }
        }}
      />
      {target.side === "head" ? (
        // The field's own tool, under it at its end, as code hosts place it.
        <div className="deck-composer-tools">
          <Button
            type="button"
            variant="ghost"
            size="xs"
            disabled={posting}
            onClick={() => {
              composer.update(target, {
                body: withSuggestion(body, target.lineText),
              });
              field.current?.focus({ preventScroll: true });
            }}
          >
            Suggest change
          </Button>
        </div>
      ) : null}
      {failure ? (
        <p role="alert" className="deck-composer-error">
          {uncertain ? failure : `Couldn't post the comment: ${failure}`}
        </p>
      ) : null}
      <div className="deck-note-actions">
        <Button
          type="submit"
          size="sm"
          disabled={empty || posting}
          aria-keyshortcuts={keys}
        >
          {target.editing ? "Save" : "Add to review"}
        </Button>
        {target.editing ? null : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={empty || posting}
            onClick={postNow}
          >
            {posting
              ? "Posting…"
              : uncertain
                ? "Post again"
                : failure
                  ? "Retry"
                  : "Comment now"}
          </Button>
        )}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={posting}
          onClick={cancelComposer}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
