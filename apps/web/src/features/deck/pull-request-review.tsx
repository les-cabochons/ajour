import { useCallback, useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/page-header";
import { SectionHeading } from "@/components/section-heading";
import { Button } from "@/components/ui/button";
import {
  draftReviewOf,
  lineTextOf,
  placeDrafts,
  type DeckDraftComment,
  type DeckReviewRef,
} from "@/domain/deck/draft-review";
import { personName } from "@/domain/deck/review-status";
import { findLine, placeThreads } from "@/domain/deck/review-threads";
import {
  isPullRequestSnoozed,
  type LocalPullRequest,
} from "@/domain/pull-requests/pull-request-lifecycle";
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
import {
  pullRequestActions,
  reasonLabels,
  runPullRequestAction,
} from "./pull-request-row";
import { PullRequestStatusLine } from "./pull-request-status-line";
import {
  DraftCommentCard,
  ReviewNotesContext,
  type ComposerTarget,
  type ReviewNote,
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
  const drafts = useMemo(
    () => (shown ? placeDrafts(shown, draft) : undefined),
    [shown, draft],
  );

  const threadNotes = useMemo(
    (): ReviewNote[] =>
      (placement?.placed ?? []).map((entry) => ({
        kind: "thread",
        key: entry.thread.id,
        thread: entry.thread,
        hunkId: entry.hunkId,
        side: entry.side,
        line: entry.line,
        ...(entry.thread.startLine !== undefined
          ? { startLine: entry.thread.startLine }
          : {}),
        row: entry.row,
      })),
    [placement],
  );
  const draftNotes = useMemo(
    (): ReviewNote[] =>
      (drafts?.placed ?? [])
        // The composer takes the place of the comment it edits.
        .filter((entry) => entry.comment.id !== composer?.editing)
        .map((entry) => ({
          kind: "draft",
          key: `draft:${entry.comment.id}`,
          comment: entry.comment,
          hunkId: entry.hunkId,
          side: entry.side,
          line: entry.line,
          ...(entry.comment.startLine !== undefined
            ? { startLine: entry.comment.startLine }
            : {}),
          row: entry.row,
        })),
    [drafts, composer?.editing],
  );
  const composerNote = useMemo((): ReviewNote | undefined => {
    const at = composer && shown ? findLine(shown, composer) : undefined;
    return at && composer
      ? {
          kind: "composer",
          key: "composer",
          target: composer,
          hunkId: at.hunkId,
          side: at.side,
          line: at.line,
          ...(composer.startLine !== undefined
            ? { startLine: composer.startLine }
            : {}),
          row: at.row,
        }
      : undefined;
  }, [composer, shown]);
  const notes = useMemo(() => {
    const all = [...threadNotes, ...draftNotes];
    if (composerNote) all.push(composerNote);
    // In the diff's order, so the gutter's cards and Tab follow the lines.
    const order = new Map<string, number>();
    let index = 0;
    for (const file of shown?.files ?? [])
      for (const hunk of file.hunks) order.set(hunk.id, index++);
    return all.sort(
      (a, b) =>
        order.get(a.hunkId)! - order.get(b.hunkId)! ||
        a.row - b.row ||
        a.key.localeCompare(b.key),
    );
  }, [threadNotes, draftNotes, composerNote, shown]);

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
            anchor: {
              path: target.path,
              side: target.side,
              line: target.line,
              ...(target.startLine !== undefined
                ? { startLine: target.startLine }
                : {}),
            },
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
            anchor: {
              path: target.path,
              side: target.side,
              line: target.line,
              ...(target.startLine !== undefined
                ? { startLine: target.startLine }
                : {}),
              headSha,
            },
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
          path: comment.path,
          side: comment.side,
          line: comment.line,
          ...(comment.startLine !== undefined
            ? { startLine: comment.startLine }
            : {}),
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
      <PageHeader
        backLink={{ label: "Deck", to: "/deck" }}
        actions={
          <>
            {open ? (
              <FinishReview
                pullRequest={pullRequest}
                draft={draft}
                headSha={headSha ?? pullRequest.facts.headSha}
                onSubmitted={retryConversation}
              />
            ) : null}
            {pullRequestActions(pullRequest, now).map((action) => (
              <Button
                key={action.id}
                variant="outline"
                onClick={() =>
                  runPullRequestAction(
                    pullRequest,
                    action.id as Parameters<typeof runPullRequestAction>[1],
                  )
                }
              >
                {action.label}
              </Button>
            ))}
          </>
        }
      />
      <header>
        <h1 className="backlog-item-page-title">{pullRequest.facts.title}</h1>
        <p className="backlog-item-page-meta">
          {repository} #{number} · {pullRequest.connectionLabel} ·{" "}
          {personName(pullRequest.facts.author)} ·{" "}
          {pullRequest.status === "settled"
            ? "Settled"
            : isPullRequestSnoozed(pullRequest, now)
              ? "Snoozed"
              : reasonLabels[pullRequest.reason ?? "manual"]}
        </p>
      </header>
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
