import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { CodeHostReviewThread } from "@ajour/shared";
import { SectionHeading } from "@/components/section-heading";
import { showErrorToast } from "@/components/ui/toast";
import {
  draftReviewOf,
  lineAnchor,
  lineTextOf,
  nameSubmission,
  placeDrafts,
  type DeckDraftComment,
  type DeckReviewRef,
} from "@/domain/deck/draft-review";
import { authorActions } from "@/domain/deck/author-actions";
import { reviewNotes, type ComposerTarget } from "@/domain/deck/review-notes";
import { placeThreads } from "@/domain/deck/review-threads";
import { viewedHunks, viewedMarksOf } from "@/domain/deck/viewed-marks";
import {
  changedHunks,
  pushesSince,
  reviewedVersion,
} from "@/domain/deck/versions";
import type { LocalPullRequest } from "@/domain/pull-requests/pull-request-lifecycle";
import {
  AppApiError,
  isAccessOffError,
  postPullRequestComment,
  replyToPullRequestThread,
  setPullRequestFileViewed,
  setPullRequestThreadResolved,
} from "@/lib/app-api";
import { DECK_GUTTER_QUERY } from "@/lib/breakpoints";
import { useLocalState } from "@/lib/local-hooks";
import { localStore } from "@/lib/local-store";
import { useMediaQuery } from "@/lib/use-media-query";
import { DraftToggle, MergePullRequest } from "./author-actions";
import {
  ClosedDraftReview,
  FinishReview,
  mayAlreadyBeThere,
  writeFailure,
} from "./finish-review";
import { FileViewedSync } from "./file-viewed-sync";
import {
  PullRequestChanges,
  type ReviewVersionsView,
  type ReviewViewedView,
} from "./pull-request-changes";
import {
  DescriptionDrawer,
  PullRequestConversation,
} from "./pull-request-conversation";
import { PullRequestHeader } from "./pull-request-header";
import { PullRequestStatusLine } from "./pull-request-status-line";
import { PullRequestSummary, type ReachHunk } from "./pull-request-summary";
import { ReviewComposerState } from "./review-composer-state";
import {
  DraftCommentCard,
  ReviewNotesContext,
  type ReviewNoteActions,
} from "./review-notes";
import type { AddComment } from "./review-sections";
import { ThreadActionsContext, type ThreadActions } from "./thread-actions";
import { ThreadStates } from "./thread-state";
import {
  usePullRequestChecks,
  usePullRequestConversation,
  usePullRequestDiff,
  usePullRequestVersions,
  useSinceReview,
} from "./use-pull-request-read";

const NOTHING_VIEWED: ReadonlySet<string> = new Set();

/** The code host refused the operation as one its plugin doesn't offer. */
const notSupported = (error: unknown) =>
  error instanceof AppApiError && error.payload?.reason === "not_supported";

/**
 * A pull request's review page: its header with **Finish review** and the
 * row's actions, the title, the status line, the summary once the guide is
 * built, the description drawer, the changes under their versions bar in
 * the guide's order or A–Z with each review thread and draft comment beside
 * or after its line, the draft comments a push made outdated, then the
 * conversation. The diff and its guide, the conversation, the checks and
 * the versions are read at once when the page opens, and again on Refresh
 * after a push came in. A "+" beside a line opens the composer there (#784);
 * a thread takes replies and resolves, and the viewed marks last, a file's
 * synced with the code host where it keeps them (#785).
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
  const versions = usePullRequestVersions(pullRequest);
  const floating = useMediaQuery(DECK_GUTTER_QUERY);
  const [hovered, setHovered] = useState<string | undefined>();
  // The changes set it once they show, so a summary line reaches its hunk.
  const reachHunk = useRef<ReachHunk | undefined>(undefined);
  const onReach = useCallback((hunkId: string) => {
    reachHunk.current?.(hunkId);
  }, []);
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
  // A new head marks the draft's comments on lines it changed outdated,
  // and clears the viewed marks of the hunks it changed.
  useEffect(() => {
    if (!shown) return;
    localStore.refreshDraftReview(ref, shown);
    localStore.refreshViewedMarks(ref, shown);
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
  const reloadConversation = conversation.reload;

  const allMarks = useLocalState().deckViewedMarks;
  const marks = useMemo(
    () => viewedMarksOf(allMarks ?? [], ref),
    [allMarks, ref],
  );
  const viewed = useMemo(
    () => (shown ? viewedHunks(marks, shown) : NOTHING_VIEWED),
    [marks, shown],
  );
  const { pluginName, connectionLabel } = pullRequest;
  // Per-file marks on the code host, for this page; one without them stops it.
  const [fileSync] = useState(
    () =>
      new FileViewedSync(
        (path, { viewed: isViewed, headSha: at }) =>
          setPullRequestFileViewed(pluginId, connectionId, {
            repository,
            number,
            path,
            viewed: isViewed,
            headSha: at,
          }),
        (path, isViewed, error) => {
          if (notSupported(error)) return "stop";
          if (isAccessOffError(error)) {
            showErrorToast({
              id: "deck-file-viewed",
              title: `Viewed files stay on this computer`,
              description: `Turn on Review pull requests for ${connectionLabel} in Settings › Plugins to mark them viewed on ${pluginName} too.`,
            });
            return "stop";
          }
          showErrorToast({
            id: "deck-file-viewed",
            title: `Couldn't mark ${path} ${isViewed ? "viewed" : "not viewed"} on ${pluginName}`,
            description: error instanceof Error ? error.message : String(error),
          });
          return "continue";
        },
      ),
  );
  const shownRef = useRef(shown);
  useEffect(() => {
    shownRef.current = shown;
  }, [shown]);
  const viewing = useMemo(
    (): ReviewViewedView => ({
      viewed,
      setViewed: (hunkIds, isViewed) => {
        const diffShown = shownRef.current;
        if (!diffShown) return;
        const files = localStore.setHunksViewed(
          ref,
          diffShown,
          hunkIds,
          isViewed,
        );
        // A closed pull request's marks stay on this computer.
        if (!open) return;
        for (const file of files)
          fileSync.set(file.path, file.viewed, diffShown.headSha);
      },
    }),
    [viewed, ref, open, fileSync],
  );
  // The files the code host says the user viewed, each taken in once per
  // head: a file the user marked or unmarked since stays as they left it.
  const hostViewed =
    conversation.state.status === "ready"
      ? conversation.state.value.viewedPaths
      : undefined;
  useEffect(() => {
    if (shown && hostViewed?.length)
      localStore.adoptViewedFiles(ref, shown, hostViewed);
  }, [shown, hostViewed, ref]);

  // Replies and resolves, kept per thread while its card scrolls away.
  const [threadStates] = useState(() => new ThreadStates());
  const conversationValue =
    conversation.state.status === "ready"
      ? conversation.state.value
      : undefined;
  // Before the page draws it, so a write's answer is stamped with this read.
  useLayoutEffect(() => {
    threadStates.conversation = conversationValue;
  }, [conversationValue, threadStates]);
  const threadActions = useMemo(
    (): ThreadActions | undefined =>
      open
        ? {
            states: threadStates,
            conversation: conversationValue,
            reply: async (thread: CodeHostReviewThread, body: string) => {
              const { submission, fields } = nameSubmission(
                threadStates.of(thread.id).submission,
                JSON.stringify([thread.id, body]),
                false,
                {
                  now: Date.now(),
                  createId: () => `reply_submission_${crypto.randomUUID()}`,
                },
              );
              threadStates.replyStarted(thread.id, submission);
              let result;
              try {
                result = await replyToPullRequestThread(
                  pluginId,
                  connectionId,
                  { repository, number, threadId: thread.id, body, ...fields },
                );
              } catch (error) {
                threadStates.replyFailed(
                  thread.id,
                  submission.id,
                  writeFailure(error, pullRequest),
                );
                return;
              }
              if ("uncertain" in result) {
                threadStates.replyUnsettled(
                  thread.id,
                  submission.id,
                  mayAlreadyBeThere("reply", pullRequest),
                );
                return;
              }
              threadStates.replySent(thread.id, submission.id, body);
              reloadConversation();
            },
            setResolved: async (thread: CodeHostReviewThread, resolved) => {
              threadStates.update(thread.id, {
                resolving: true,
                resolveFailure: undefined,
              });
              try {
                const result = await setPullRequestThreadResolved(
                  pluginId,
                  connectionId,
                  { repository, number, threadId: thread.id, resolved },
                );
                threadStates.resolvedAs(thread.id, result.resolved);
              } catch (error) {
                threadStates.update(thread.id, {
                  resolving: false,
                  resolveFailure: writeFailure(error, pullRequest),
                });
                return;
              }
              reloadConversation();
            },
          }
        : undefined,
    [
      open,
      threadStates,
      pluginId,
      connectionId,
      repository,
      number,
      pullRequest,
      reloadConversation,
      conversationValue,
    ],
  );
  const onAddComment = useCallback<AddComment>(
    (path, _hunkId, lines, body) => {
      if (!shown) return false;
      const side = lines.side === "deletions" ? "base" : "head";
      const target: ComposerTarget = {
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
        body: body ?? "",
      };
      // The composer open there keeps its words and adds these after them;
      // another composer holding words keeps them, and the answer stays.
      if (body !== undefined && !composerState.transfer(target, body)) {
        return false;
      }
      setComposer(target);
      return true;
    },
    [shown, composerState],
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
        closeComposer();
      },
      commentNow: async (target, body) => {
        if (!headSha) return;
        const anchor = { ...lineAnchor(target), headSha };
        // Like the words, the name lives with this composer while the page is open.
        const { submission, fields } = nameSubmission(
          composerState.of(target).submission,
          JSON.stringify([anchor, body]),
          false,
          {
            now: Date.now(),
            createId: () => `comment_submission_${crypto.randomUUID()}`,
          },
        );
        composerState.update(target, {
          posting: true,
          failure: undefined,
          uncertain: false,
          submission,
        });
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
          composerState.answer(target, submission.id, {
            posting: false,
            failure: writeFailure(error, pullRequest),
          });
          return;
        }
        // Taken, or unsettled: the next try is a new post.
        if ("uncertain" in result) {
          composerState.answer(target, submission.id, {
            posting: false,
            failure: mayAlreadyBeThere("comment", pullRequest),
            uncertain: true,
            submission: undefined,
          });
          return;
        }
        // Words typed while it posted stay, as a new comment; a composer
        // opened since, here or on other lines, is left be.
        const sender = composerState.sender(target, submission.id);
        if (sender?.body === body) closeComposer();
        else
          composerState.answer(target, submission.id, {
            posting: false,
            submission: undefined,
          });
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

  const shownHead =
    diffState.status === "ready" ? diffState.value.headSha : undefined;
  const list =
    versions.state.status === "ready"
      ? versions.state.value.versions
      : undefined;
  const { _id: id, viewerLogin, reviewed: remembered } = pullRequest;
  const { reviews: hostReviews } = pullRequest.facts;
  const reviewed = useMemo(
    () =>
      list &&
      reviewedVersion(list, {
        viewerLogin,
        reviews: hostReviews,
        remembered,
      }),
    [list, viewerLogin, hostReviews, remembered],
  );
  // The version reviewed is remembered with the pull request, so it outlives
  // a review the code host stops listing.
  useEffect(() => {
    if (reviewed && (!remembered || reviewed.at > remembered.at))
      localStore.changePullRequest(id, {
        type: "reviewed",
        headSha: reviewed.version.headSha,
        at: reviewed.at,
      });
  }, [id, reviewed, remembered]);
  const shownVersion = list?.find((version) => version.headSha === shownHead);
  const since = useSinceReview(
    pullRequest,
    shownHead,
    reviewed && shownVersion && reviewed.version.number < shownVersion.number
      ? reviewed.version.headSha
      : undefined,
  );
  // Reviewed at the version on screen, or a later one: nothing changed since.
  const reviewedOnScreen =
    !!reviewed &&
    !!shownVersion &&
    reviewed.version.number >= shownVersion.number;
  const changed = useMemo(
    () =>
      since.state.status === "ready"
        ? changedHunks(since.state.value.changed)
        : reviewedOnScreen
          ? changedHunks([])
          : undefined,
    [since.state, reviewedOnScreen],
  );
  const { refresh: refreshDiff } = diff;
  const { retry: retryChecks } = checks;
  const { retry: retryVersions } = versions;
  // The head the last sync had seen when the diff was read: a later sync
  // that sees another one means a push came in during the review.
  const syncedHead = pullRequest.facts.headSha;
  const [syncedAtOpen, setSyncedAtOpen] = useState(syncedHead);
  const refresh = useCallback(() => {
    setSyncedAtOpen(syncedHead);
    // The newest head, wherever it is: the last sync may not know it yet.
    refreshDiff();
    retryConversation();
    retryChecks();
    retryVersions();
  }, [syncedHead, refreshDiff, retryConversation, retryChecks, retryVersions]);

  const versionsView: ReviewVersionsView = {
    state: versions.state,
    retry: retryVersions,
    reviewed: reviewed?.version,
    since: since.state,
    retrySince: since.retry,
    changed,
    pushes: shownHead
      ? pushesSince(list, shownHead, {
          synced: syncedHead,
          syncedAtOpen,
        })
      : 0,
    refresh,
    baseRef: pullRequest.facts.baseRef,
  };

  return (
    <ReviewNotesContext.Provider value={actions}>
      <ThreadActionsContext.Provider value={threadActions}>
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
          author={
            authorActions(pullRequest.facts) ? (
              <>
                <DraftToggle pullRequest={pullRequest} />
                <MergePullRequest
                  pullRequest={pullRequest}
                  headSha={headSha}
                  methods={
                    conversation.state.status === "ready"
                      ? conversation.state.value.mergeMethods
                      : undefined
                  }
                  pushes={versionsView.pushes}
                  onFailed={retryVersions}
                  versionName={
                    versions.state.status === "ready"
                      ? versions.state.value.versionName
                      : undefined
                  }
                />
              </>
            ) : null
          }
        />
        <PullRequestStatusLine
          pullRequest={pullRequest}
          checks={checks.state}
        />
        {!open && draft?.comments.length ? (
          <ClosedDraftReview
            pullRequest={pullRequest}
            draft={draft}
            onPosted={retryConversation}
          />
        ) : null}
        {shown ? (
          <PullRequestSummary
            pullRequest={shown}
            repository={pullRequest.facts.repository}
            onReach={onReach}
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
          reachHunkRef={reachHunk}
          versions={versionsView}
          viewing={viewing}
        />
        {outdated.length ? (
          <section className="deck-draft-elsewhere" aria-label="Draft comments">
            <SectionHeading trailing={outdated.length}>
              Draft comments on lines that changed
            </SectionHeading>
            {outdated.map((comment) => (
              <DraftCommentCard
                key={comment.id}
                comment={comment}
                showLocation
              />
            ))}
          </section>
        ) : null}
        <PullRequestConversation
          state={conversation.state}
          retry={conversation.retry}
          elsewhere={elsewhere}
        />
      </ThreadActionsContext.Provider>
    </ReviewNotesContext.Provider>
  );
}
