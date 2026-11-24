import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SectionHeading } from "@/components/section-heading";
import {
  draftReviewOf,
  lineAnchor,
  lineTextOf,
  nameSubmission,
  placeDrafts,
  type DeckDraftComment,
  type DeckReviewRef,
  type DeckReviewSubmission,
} from "@/domain/deck/draft-review";
import { reviewNotes, type ComposerTarget } from "@/domain/deck/review-notes";
import { placeThreads } from "@/domain/deck/review-threads";
import type { LocalPullRequest } from "@/domain/pull-requests/pull-request-lifecycle";
import { postPullRequestComment } from "@/lib/app-api";
import { DECK_GUTTER_QUERY } from "@/lib/breakpoints";
import { useLocalState } from "@/lib/local-hooks";
import { localStore } from "@/lib/local-store";
import { useMediaQuery } from "@/lib/use-media-query";
import {
  ClosedDraftReview,
  FinishReview,
  mayAlreadyBeThere,
  writeFailure,
} from "./finish-review";
import { PullRequestChanges } from "./pull-request-changes";
import {
  DescriptionDrawer,
  PullRequestConversation,
} from "./pull-request-conversation";
import { PullRequestHeader } from "./pull-request-header";
import { PullRequestStatusLine } from "./pull-request-status-line";
import { ReviewComposerState } from "./review-composer-state";
import {
  DraftCommentCard,
  ReviewNotesContext,
  type ReviewNoteActions,
} from "./review-notes";
import type { AddComment } from "./review-sections";
import {
  usePullRequestChecks,
  usePullRequestConversation,
  usePullRequestDiff,
} from "./use-pull-request-read";

/**
 * A pull request's review page: its header with **Finish review** and the
 * row's actions, the title, the status line, the description drawer, the
 * changes in the guide's order or A–Z with each review thread and draft
 * comment beside or after its line, the draft comments a push made
 * outdated, then the conversation. The diff and its guide, the
 * conversation and the checks are read at once when the page opens. A
 * "+" beside a line opens the composer there (#784).
 */
export function PullRequestReview({
  pullRequest,
  now,
}: {
  pullRequest: LocalPullRequest;
  now: number;
}) {
  const diff = usePullRequestDiff(pullRequest);
  const conversation = usePullRequestConversation(pullRequest);
  const checks = usePullRequestChecks(pullRequest);
  const floating = useMediaQuery(DECK_GUTTER_QUERY);
  const [hovered, setHovered] = useState<string | undefined>();
  const [composer, setComposer] = useState<ComposerTarget | undefined>();
  // The open composer's words, kept while its hunk scrolls away.
  const [composerState] = useState(() => new ReviewComposerState());
  const closeComposer = useCallback(() => {
    composerState.close();
    setComposer(undefined);
  }, [composerState]);

  const { pluginId, connectionId } = pullRequest;
  const { repository, number } = pullRequest.facts;
  const ref = useMemo(
    (): DeckReviewRef => ({ pluginId, connectionId, repository, number }),
    [pluginId, connectionId, repository, number],
  );
  const reviews = useLocalState().deckDraftReviews;
  const draft = useMemo(
    () => draftReviewOf(reviews ?? [], ref),
    [reviews, ref],
  );
  const open = pullRequest.facts.state === "open";

  const diffState = diff.state;
  const shown = diffState.status === "ready" ? diffState.value : undefined;
  // A new head marks the draft's comments on lines it changed outdated.
  useEffect(() => {
    if (shown) localStore.refreshDraftReview(ref, shown);
  }, [shown, ref]);

  const threads =
    conversation.state.status === "ready"
      ? conversation.state.value.threads
      : undefined;
  const placement = useMemo(
    () => (threads && shown ? placeThreads(shown, threads) : undefined),
    [threads, shown],
  );
  // Without a diff to show them on, every thread joins the conversation.
  const elsewhere = useMemo(
    () =>
      placement
        ? placement.elsewhere
        : diffState.status === "loading"
          ? []
          : (threads ?? []),
    [placement, diffState.status, threads],
  );
  // Until the refresh moved the draft to the head shown, its comments wait.
  const drafts = useMemo(
    () =>
      shown && (!draft || draft.headSha === shown.headSha)
        ? placeDrafts(shown, draft)
        : undefined,
    [shown, draft],
  );
  const notes = useMemo(
    () =>
      shown
        ? reviewNotes(
            shown,
            placement?.placed ?? [],
            drafts?.placed ?? [],
            composer,
          )
        : [],
    [shown, placement, drafts, composer],
  );

  const retryConversation = conversation.retry;
  const onAddComment = useCallback<AddComment>(
    (path, _hunkId, lines) => {
      if (!shown) return;
      const side = lines.side === "deletions" ? "base" : "head";
      setComposer({
        path,
        side,
        line: lines.end,
        ...(lines.start < lines.end ? { startLine: lines.start } : {}),
        // Every line of the range, so a push to any of them outdates it.
        lineText:
          lineTextOf(shown, {
            path,
            side,
            line: lines.end,
            startLine: lines.start,
          }) ?? "",
        body: "",
      });
    },
    [shown],
  );
  const headSha = shown?.headSha;
  /**
   * Comment now's last try, named: Retry with the same words and lines sends
   * the same name. Like the composer's words, it lives only while the page
   * is open. Undefined after an uncertain answer, so Post again posts anew.
   */
  const commentNowTry = useRef<DeckReviewSubmission | undefined>(undefined);
  const actions = useMemo(
    (): ReviewNoteActions => ({
      onHover: setHovered,
      canComment: open,
      addToReview: (target, body) => {
        if (target.editing)
          localStore.editDraftComment(ref, target.editing, body);
        else if (headSha)
          localStore.addDraftComment(ref, {
            headSha,
            anchor: lineAnchor(target),
            body,
            lineText: target.lineText,
          });
        closeComposer();
      },
      commentNow: async (target, body) => {
        if (!headSha) return;
        composerState.update(target, { posting: true, failure: undefined });
        const anchor = { ...lineAnchor(target), headSha };
        const { submission, fields } = nameSubmission(
          commentNowTry.current,
          JSON.stringify([anchor, body]),
          false,
          {
            now: Date.now(),
            createId: () => `comment_submission_${crypto.randomUUID()}`,
          },
        );
        commentNowTry.current = submission;
        let result;
        try {
          result = await postPullRequestComment(pluginId, connectionId, {
            repository,
            number,
            body,
            anchor,
            ...fields,
          });
        } catch (error) {
          composerState.update(target, {
            posting: false,
            failure: writeFailure(error, pullRequest),
          });
          return;
        }
        // Taken, or unsettled: the next try is a new post.
        commentNowTry.current = undefined;
        if ("uncertain" in result) {
          composerState.update(target, {
            posting: false,
            failure: mayAlreadyBeThere("comment", pullRequest),
            uncertain: true,
          });
          return;
        }
        // Another composer opened meanwhile keeps its words.
        if (composerState.holds(target)) closeComposer();
        retryConversation();
      },
      composer: composerState,
      cancelComposer: closeComposer,
      editDraft: (comment: DeckDraftComment) =>
        setComposer({
          ...lineAnchor(comment),
          lineText: comment.lineText,
          editing: comment.id,
          body: comment.body,
        }),
      removeDraft: (comment: DeckDraftComment) => {
        localStore.removeDraftComment(ref, comment.id);
        // The composer on it closes; nothing opens it again.
        setComposer((target) =>
          target?.editing === comment.id ? undefined : target,
        );
      },
    }),
    [
      open,
      ref,
      headSha,
      pluginId,
      connectionId,
      repository,
      number,
      pullRequest,
      retryConversation,
      composerState,
      closeComposer,
    ],
  );
  const outdated = drafts?.elsewhere ?? [];

  return (
    <ReviewNotesContext.Provider value={actions}>
      <PullRequestHeader
        pullRequest={pullRequest}
        now={now}
        review={
          open ? (
            <FinishReview
              pullRequest={pullRequest}
              draft={draft}
              headSha={headSha}
              onSubmitted={retryConversation}
            />
          ) : null
        }
      />
      <PullRequestStatusLine pullRequest={pullRequest} checks={checks.state} />
      {!open && draft?.comments.length ? (
        <ClosedDraftReview
          pullRequest={pullRequest}
          draft={draft}
          onPosted={retryConversation}
        />
      ) : null}
      <DescriptionDrawer
        state={conversation.state}
        retry={conversation.retry}
      />
      <PullRequestChanges
        pullRequest={pullRequest}
        state={diff.state}
        retry={diff.retry}
        notes={{
          notes,
          floating,
          hovered,
          onAddComment: open ? onAddComment : undefined,
        }}
      />
      {outdated.length ? (
        <section className="deck-draft-elsewhere" aria-label="Draft comments">
          <SectionHeading trailing={outdated.length}>
            Draft comments on lines that changed
          </SectionHeading>
          {outdated.map((comment) => (
            <DraftCommentCard key={comment.id} comment={comment} showLocation />
          ))}
        </section>
      ) : null}
      <PullRequestConversation
        state={conversation.state}
        retry={conversation.retry}
        elsewhere={elsewhere}
      />
    </ReviewNotesContext.Provider>
  );
}
