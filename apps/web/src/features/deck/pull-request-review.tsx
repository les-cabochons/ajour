import { useCallback, useEffect, useMemo, useState } from "react";
import { SectionHeading } from "@/components/section-heading";
import {
  draftReviewOf,
  lineAnchor,
  lineTextOf,
  placeDrafts,
  type DeckDraftComment,
  type DeckReviewRef,
} from "@/domain/deck/draft-review";
import { reviewNotes, type ComposerTarget } from "@/domain/deck/review-notes";
import { placeThreads } from "@/domain/deck/review-threads";
import type { LocalPullRequest } from "@/domain/pull-requests/pull-request-lifecycle";
import { postPullRequestComment } from "@/lib/app-api";
import { DECK_GUTTER_QUERY } from "@/lib/breakpoints";
import { useLocalState } from "@/lib/local-hooks";
import { localStore } from "@/lib/local-store";
import { useMediaQuery } from "@/lib/use-media-query";
import { ClosedDraftReview, FinishReview, writeFailure } from "./finish-review";
import { PullRequestChanges } from "./pull-request-changes";
import {
  DescriptionDrawer,
  PullRequestConversation,
} from "./pull-request-conversation";
import { PullRequestHeader } from "./pull-request-header";
import { PullRequestStatusLine } from "./pull-request-status-line";
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
        lineText: lineTextOf(shown, { path, side, line: lines.end }) ?? "",
        body: "",
      });
    },
    [shown],
  );
  const headSha = shown?.headSha;
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
        setComposer(undefined);
      },
      commentNow: async (target, body) => {
        if (!headSha) return;
        try {
          await postPullRequestComment(pluginId, connectionId, {
            repository,
            number,
            body,
            anchor: { ...lineAnchor(target), headSha },
          });
        } catch (error) {
          throw new Error(writeFailure(error, pullRequest));
        }
        setComposer(undefined);
        retryConversation();
      },
      cancelComposer: () => setComposer(undefined),
      editDraft: (comment: DeckDraftComment) =>
        setComposer({
          ...lineAnchor(comment),
          lineText: comment.lineText,
          editing: comment.id,
          body: comment.body,
        }),
      removeDraft: (comment: DeckDraftComment) => {
        localStore.removeDraftComment(ref, comment.id);
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
      {!open && draft ? (
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
