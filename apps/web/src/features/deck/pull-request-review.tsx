import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { CodeHostReviewThread } from "@ajour/shared";
import type { AgentTurnAction } from "@ajour/shared/agent-runs";
import { deckLineText, type DeckAskAnchor } from "@ajour/shared/deck";
import { SectionHeading } from "@/components/section-heading";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { showErrorToast } from "@/components/ui/toast";
import { Value } from "@/components/ui/value";
import {
  draftReviewOf,
  lineAnchor,
  nameSubmission,
  placeDrafts,
  type DeckDraftComment,
  type DeckReviewRef,
} from "@/domain/deck/draft-review";
import { authorActions } from "@/domain/deck/author-actions";
import { mergeReadiness } from "@/domain/deck/merge-readiness";
import { reviewNotes, type ComposerTarget } from "@/domain/deck/review-notes";
import { approvalsOf } from "@/domain/deck/review-status";
import { findLine, placeThreads } from "@/domain/deck/review-threads";
import {
  deckViewsTransition,
  panelTab,
  type DeckView,
  type DeckViewsCommand,
  type DeckViewsState,
} from "@/domain/deck/review-views";
import {
  threadListCounts,
  threadListEntries,
  type ThreadListEntry,
} from "@/domain/deck/thread-list";
import { viewedHunks, viewedMarksOf } from "@/domain/deck/viewed-marks";
import {
  changedHunks,
  pushesSince,
  reviewedVersion,
} from "@/domain/deck/versions";
import type { DeckStackPosition } from "@/domain/deck/stacks";
import type { LocalPullRequest } from "@/domain/pull-requests/pull-request-lifecycle";
import {
  AppApiError,
  isAccessOffError,
  postPullRequestComment,
  readDeckGuide,
  replyToPullRequestThread,
  setPullRequestFileViewed,
  setPullRequestThreadResolved,
} from "@/lib/app-api";
import { DECK_ROOMY_QUERY } from "@/lib/breakpoints";
import { setDeckPanel, useDeckPanel } from "@/lib/deck-panel";
import { useLocalState } from "@/lib/local-hooks";
import { localStore } from "@/lib/local-store";
import { useMediaQuery } from "@/lib/use-media-query";
import { useIsNarrowView } from "@/lib/use-narrow-view";
import { useShortcut } from "@/lib/shortcut-handlers";
import { CodeHostLinkContext } from "./code-host-link";
import { ChatView, DeckChatContext, DeckChatSheet } from "./deck-chat";
import { useDeckConsent } from "./deck-consent-dialog";
import { DeckChatSession, type DeckChatTarget } from "./deck-chat-session";
import { MergePullRequest } from "./author-actions";
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
import { DeckAskProvider } from "./deck-ask";
import { PullRequestSummary, type ReachHunk } from "./pull-request-summary";
import { StackStrip } from "./stack-strip";
import { ReviewComposerState } from "./review-composer-state";
import {
  DraftCommentCard,
  ReviewNotesContext,
  type ReviewNoteActions,
} from "./review-notes";
import { ReviewDock, ReviewSidePanel } from "./review-dock";
import type { AddComment } from "./review-sections";
import { StatusView } from "./status-view";
import { ThreadActionsContext, type ThreadActions } from "./thread-actions";
import { ThreadStates } from "./thread-state";
import { ThreadsView } from "./threads-view";
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
 * A pull request's review page: the title with **Finish review** and the
 * "…" menu, the meta line, then two tabs. **Overview** holds the summary
 * once the guide is built, the description drawer, the draft comments a
 * push made outdated and the conversation. **Changes**, where the page
 * opens, holds the guide tree and the changes under their versions bar, in
 * the guide's order or A–Z, with each review thread and draft comment
 * after its line. The dock along the bottom says what stands between the
 * pull request and its merge, and opens Status, Threads and Chat, each a
 * peek or, once pinned, a tab of the side panel. The diff and its guide,
 * the conversation, the checks and the versions are read at once when the
 * page opens, and again on Refresh after a push came in. A "+" beside a
 * line opens the composer there (#784); a thread takes replies and
 * resolves, and the viewed marks last, a file's synced with the code host
 * where it keeps them (#785). A layer of a stack shows the stack strip
 * under the meta line, and its Finish review offers the layer above once
 * sent (#788).
 */
export function PullRequestReview({
  pullRequest,
  now,
  stack,
}: {
  pullRequest: LocalPullRequest;
  now: number;
  /** Its place in its stack, when it's a layer of one. */
  stack?: DeckStackPosition;
}) {
  const diff = usePullRequestDiff(pullRequest);
  const conversation = usePullRequestConversation(pullRequest);
  const checks = usePullRequestChecks(pullRequest);
  const versions = usePullRequestVersions(pullRequest);
  const roomy = useMediaQuery(DECK_ROOMY_QUERY);
  const narrow = useIsNarrowView();
  const [tab, setTab] = useState<"overview" | "changes">("changes");
  // Status, Threads and Chat: a peek each, or the side panel's tabs once
  // pinned. The pins are the device's; the narrow view only peeks.
  const savedPanel = useDeckPanel();
  const [peek, setPeek] = useState<DeckView | undefined>();
  const views: DeckViewsState = narrow
    ? { pins: [], open: false, peek }
    : { ...savedPanel, peek };
  const viewsRef = useRef(views);
  useLayoutEffect(() => {
    viewsRef.current = views;
  });
  const dispatchViews = useCallback(
    (command: DeckViewsCommand) => {
      const next = deckViewsTransition(viewsRef.current, command);
      viewsRef.current = next;
      setPeek(next.peek);
      // The narrow view leaves the device's pins as they are.
      if (!narrow) setDeckPanel(next);
    },
    [narrow],
  );
  const [hovered, setHovered] = useState<string | undefined>();
  // The changes set it once they show, so a summary line reaches its hunk.
  const reachHunk = useRef<ReachHunk | undefined>(undefined);
  // From Overview too: Changes shows first, and the hunk is reached once
  // it draws.
  const onReach = useCallback((hunkId: string) => {
    setTab("changes");
    requestAnimationFrame(() => reachHunk.current?.(hunkId));
  }, []);
  const [composer, setComposer] = useState<ComposerTarget | undefined>();
  // The open composer's words, kept while its hunk scrolls away.
  const [composerState] = useState(() => new ReviewComposerState());
  const closeComposer = useCallback(() => {
    composerState.close();
    setComposer(undefined);
  }, [composerState]);

  const { pluginId, connectionId } = pullRequest;
  const { repository, number, repositoryIdentity, headRef } = pullRequest.facts;
  // Where the repository is cloned from, so an ask can read the user's clone.
  const cloneSource = useMemo(
    () =>
      repositoryIdentity
        ? { repositoryIdentity, ...(headRef ? { headRef } : {}) }
        : undefined,
    [repositoryIdentity, headRef],
  );
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
          deckLineText(shown, {
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

  // What a chat write changed shows on the page: the conversation's new
  // comment or state, the title and draft state the code host now holds.
  const chatActionRef = useRef<(action: AgentTurnAction) => void>(() => {});
  useLayoutEffect(() => {
    chatActionRef.current = (action) => {
      if (action.edited) {
        localStore.changePullRequest(pullRequest._id, {
          type: "edited",
          ...action.edited,
        });
      }
      if (action.kind === "regroup") {
        // The agent's guide is saved: the page shows it.
        if (headSha)
          void readDeckGuide(pluginId, connectionId, {
            repository,
            number,
            head: headSha,
          }).then(
            ({ guide }) => diff.replaceGuide(guide, headSha),
            () => undefined,
          );
        return;
      }
      if (action.kind !== "draft_comment") reloadConversation();
    };
  });
  const chatConsent = useDeckConsent(pluginId, connectionId);
  const [chat] = useState(
    () =>
      new DeckChatSession(chatConsent.requestConsent, (action) =>
        chatActionRef.current(action),
      ),
  );
  // The chat follows its turn while the page shows (React's development
  // remount detaches it and attaches it again).
  useEffect(() => {
    chat.attach();
    return () => chat.detach();
  }, [chat]);
  const author = authorActions(pullRequest.facts);
  const pullRequestUrl = pullRequest.facts.url;
  const codeHostLink = useMemo(
    () => ({ pluginName: pullRequest.pluginName, pullRequestUrl }),
    [pullRequest.pluginName, pullRequestUrl],
  );
  const chatTarget = useMemo(
    (): DeckChatTarget | undefined =>
      headSha
        ? {
            pluginId,
            connectionId,
            repository,
            number,
            head: headSha,
            author,
            pullRequestUrl,
            ...(cloneSource ? { clone: cloneSource } : {}),
          }
        : undefined,
    [
      headSha,
      pluginId,
      connectionId,
      repository,
      number,
      author,
      pullRequestUrl,
      cloneSource,
    ],
  );
  useShortcut("deck.chat", () => {
    if (chatTarget) dispatchViews({ type: "toggle", view: "chat" });
  });
  const chatContext = useMemo(
    () => ({
      continueInChat: (anchor: DeckAskAnchor, label: string) => {
        chat.carry(anchor, label);
        dispatchViews({ type: "show", view: "chat" });
      },
    }),
    [chat, dispatchViews],
  );
  const showGuide = useCallback(() => {
    const first = shown?.guide?.concerns[0]?.hunkIds[0];
    if (first) onReach(first);
  }, [shown, onReach]);
  const showLine = useCallback(
    (at: { path: string; side: "base" | "head"; line: number }) => {
      const found = shown ? findLine(shown, at) : undefined;
      if (found) onReach(found.hunkId);
    },
    [shown, onReach],
  );

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

  const { facts } = pullRequest;
  const checkList =
    checks.state.status === "ready" ? checks.state.value.checks : undefined;
  const approvals = useMemo(() => approvalsOf(facts), [facts]);
  const mergesAfter = stack?.below?.facts.number;
  const readiness = useMemo(
    () =>
      mergeReadiness({
        facts,
        checks: checkList,
        approvals,
        ...(mergesAfter !== undefined ? { mergesAfter } : {}),
      }),
    [facts, checkList, approvals, mergesAfter],
  );
  const threadEntries = useMemo(
    () => threadListEntries(threads ?? [], draft?.comments ?? []),
    [threads, draft],
  );
  const threadCounts = threadListCounts(threadEntries);
  const mergeMethods =
    conversation.state.status === "ready"
      ? conversation.state.value.mergeMethods
      : undefined;
  // A thread or a draft on a line of the diff shows there; any other, in the
  // conversation on Overview.
  const showThread = useCallback(
    (entry: ThreadListEntry) => {
      // A thread goes where the diff placed it; a draft, on its line unless outdated.
      const at = entry.thread
        ? placement?.placed.find((p) => p.thread.id === entry.thread!.id)
        : shown && !entry.outdated && entry.line !== undefined
          ? findLine(shown, {
              path: entry.path,
              side: entry.side,
              line: entry.line,
            })
          : undefined;
      if (at) {
        // Its card lights up, with its line, as a hovered one does.
        setHovered(entry.thread ? entry.thread.id : `draft:${entry.draft!.id}`);
        // A viewed hunk is folded, its threads with it: it unfolds first.
        if (viewed.has(at.hunkId)) viewing.setViewed([at.hunkId], false);
        onReach(at.hunkId);
      } else {
        setTab("overview");
      }
    },
    [shown, placement, onReach, viewed, viewing],
  );
  const renderView = (view: DeckView) =>
    view === "status" ? (
      <StatusView
        pullRequest={pullRequest}
        readiness={readiness}
        approvals={approvals}
        checks={checks.state}
        methods={mergeMethods}
      />
    ) : view === "threads" ? (
      <ThreadsView
        entries={threadEntries}
        now={now}
        loading={conversation.state.status === "loading"}
        onShow={showThread}
      />
    ) : chatTarget ? (
      <ChatView
        session={chat}
        target={chatTarget}
        pluginName={pullRequest.pluginName}
        onShow={showLine}
        onShowGuide={showGuide}
        pullRequestUrl={pullRequest.facts.url}
      />
    ) : (
      <p className="deck-view-note">The chat waits until the changes show.</p>
    );
  const viewsControl = {
    state: views,
    dispatch: dispatchViews,
    renderView,
    narrow,
  };
  const panelOpen = !narrow && panelTab(views) !== undefined;
  const dock = (
    <ReviewDock
      control={viewsControl}
      readiness={readiness}
      threads={threadCounts.open + threadCounts.drafts}
      chatReady={!!chatTarget}
      merge={
        author ? (
          <MergePullRequest
            pullRequest={pullRequest}
            headSha={headSha}
            methods={mergeMethods}
            pushes={versionsView.pushes}
            onFailed={retryVersions}
            primary={readiness.state === "ready"}
            versionName={
              versions.state.status === "ready"
                ? versions.state.value.versionName
                : undefined
            }
          />
        ) : undefined
      }
    />
  );

  return (
    <DeckChatContext.Provider value={chatContext}>
      <div className="deck-review-page">
        <ReviewNotesContext.Provider value={actions}>
          <ThreadActionsContext.Provider value={threadActions}>
            {/* The summary's lines and the concerns ask about the head on screen. */}
            <DeckAskProvider
              pluginId={pluginId}
              connectionId={connectionId}
              repository={repository}
              number={number}
              head={shown?.headSha}
              clone={cloneSource}
            >
              <div className="deck-review-top">
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
                        nextLayer={stack?.above}
                      />
                    ) : null
                  }
                />
                {stack ? (
                  <StackStrip pullRequest={pullRequest} stack={stack} />
                ) : null}
                {!open && draft?.comments.length ? (
                  <ClosedDraftReview
                    pullRequest={pullRequest}
                    draft={draft}
                    onPosted={retryConversation}
                  />
                ) : null}
              </div>
              {narrow ? dock : null}
              <Tabs
                value={tab}
                onValueChange={(value) =>
                  setTab(value === "overview" ? "overview" : "changes")
                }
                className="deck-review-tabs"
              >
                <TabsList
                  variant="line"
                  className="deck-review-tab-list h-auto w-full justify-start gap-4 rounded-none border-b border-border bg-transparent px-(--page-gutter) py-0"
                >
                  <TabsTrigger value="overview" className="flex-none px-0">
                    Overview
                  </TabsTrigger>
                  <TabsTrigger value="changes" className="flex-none px-0">
                    Changes
                    {shown ? (
                      <Value tone="muted">{shown.files.length}</Value>
                    ) : null}
                  </TabsTrigger>
                </TabsList>
                <div className="deck-review-body">
                  <TabsContent value="overview" className="deck-overview">
                    <div className="deck-overview-column">
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
                      {outdated.length ? (
                        <section
                          className="deck-draft-elsewhere"
                          aria-label="Draft comments"
                        >
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
                    </div>
                  </TabsContent>
                  {/* Kept while Overview shows, with its scroll, its asks and its composer. */}
                  <TabsContent
                    value="changes"
                    keepMounted
                    className="deck-changes-panel"
                  >
                    <CodeHostLinkContext.Provider value={codeHostLink}>
                      <PullRequestChanges
                        state={diff.state}
                        retry={diff.retry}
                        onGuide={diff.replaceGuide}
                        notes={{
                          notes,
                          hovered,
                          onAddComment: open ? onAddComment : undefined,
                        }}
                        reachHunkRef={reachHunk}
                        versions={versionsView}
                        viewing={viewing}
                        layout={{
                          active: tab === "changes",
                          onActivate: () => setTab("changes"),
                          foldTree: panelOpen && !roomy,
                        }}
                      />
                    </CodeHostLinkContext.Provider>
                  </TabsContent>
                  {panelOpen ? (
                    <ReviewSidePanel control={viewsControl} />
                  ) : null}
                </div>
              </Tabs>
              {narrow ? null : dock}
            </DeckAskProvider>
          </ThreadActionsContext.Provider>
        </ReviewNotesContext.Provider>
      </div>
      {narrow && chatTarget ? (
        <DeckChatSheet
          open={views.peek === "chat"}
          onOpenChange={(isOpen) =>
            dispatchViews(
              isOpen ? { type: "show", view: "chat" } : { type: "close-peek" },
            )
          }
          session={chat}
          target={chatTarget}
          pluginName={pullRequest.pluginName}
          onShow={showLine}
          onShowGuide={showGuide}
          pullRequestUrl={pullRequest.facts.url}
        />
      ) : null}
      {chatConsent.dialog}
    </DeckChatContext.Provider>
  );
}
