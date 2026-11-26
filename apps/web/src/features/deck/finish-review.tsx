import { useId, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import type { CodeHostSubmitReviewRequest } from "@ajour/shared";
import { MessagePanel } from "@/components/app-surface";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { showActionToast, showToast } from "@/components/ui/toast";
import { Textarea } from "@/components/ui/textarea";
import {
  reviewVerdicts,
  type DeckDraftReview,
  type DeckReviewRef,
} from "@/domain/deck/draft-review";
import type { LocalPullRequest } from "@/domain/pull-requests/pull-request-lifecycle";
import {
  isAccessOffError,
  postPullRequestComment,
  submitPullRequestReview,
} from "@/lib/app-api";
import { localStore } from "@/lib/local-store";
import { useShortcut } from "@/lib/shortcut-handlers";

/*
 * Finishing a review (#784, ADR 0002). **Finish review · N** opens the
 * submit dialog with Comment, Request changes ("Wait for author" on Azure
 * DevOps) and Approve; R then C, N or A opens it on that verdict, and R
 * then Y approves with no dialog. The review goes to the code host at
 * once, named by a submission id the draft keeps. A failure keeps the
 * draft review and shows the dialog with the reason and Retry, which sends
 * the same name; nothing is queued. When the code host can't tell whether
 * an earlier try reached it, the dialog says so and the user chooses to
 * post again, as a new submission. On a layer of a stack, sending the
 * review offers **Next in stack**, the layer above (#788): the dialog stays
 * on what was sent, and R then Y's toast carries it. When new commits
 * arrived before the vote, the code host may post the comments and the
 * summary and withhold the vote (Azure DevOps, whose vote isn't bound to a
 * head): what it posted leaves the draft as on success, so nothing posts
 * twice, and the dialog opens on why the vote wasn't sent, after R then Y
 * too, as on a failure.
 */

type Verdict = CodeHostSubmitReviewRequest["verdict"];

/** Why a write failed, in words for the page: the access it needs when that's off. */
export function writeFailure(error: unknown, pullRequest: LocalPullRequest) {
  if (isAccessOffError(error))
    return `This ${pullRequest.pluginName} connection can't review pull requests. Turn on Review pull requests for ${pullRequest.connectionLabel} in Settings › Plugins, then retry.`;
  return error instanceof Error ? error.message : String(error);
}

/**
 * A retry the code host couldn't settle: something the user posted since the
 * first try may be it, but nothing there names it. The user checks, and
 * chooses whether to post again.
 */
export function mayAlreadyBeThere(
  what: "review" | "comment" | "reply",
  pullRequest: LocalPullRequest,
) {
  return `This ${what} may already be on ${pullRequest.pluginName}: something you posted since may be it. Check the pull request, then post again if it's not there.`;
}

/** What a sent review is called, in the toast and the sent dialog. */
const sentTitle = (verdict: Verdict) =>
  verdict === "approve" ? "Approved" : "Review sent";

/**
 * What the dialog says once the code host took the review: that it was
 * sent, offering the layer above, or that new commits held back its vote,
 * with how many comments and whether a summary were posted.
 */
type Outcome =
  | { kind: "sent"; verdict: Verdict }
  | { kind: "withheld"; comments: number; summary: boolean };

/** What a review whose vote new commits held back left on the pull request, and what to do. */
function withheldDescription({
  comments,
  summary,
}: {
  comments: number;
  summary: boolean;
}) {
  const posted =
    comments && summary
      ? `Your ${comments === 1 ? "comment" : "comments"} and summary are`
      : comments
        ? comments === 1
          ? "Your comment is"
          : "Your comments are"
        : summary
          ? "Your summary is"
          : undefined;
  return posted
    ? `New commits arrived while your review was sending. ${posted} on the pull request; review the new commits, then vote again.`
    : "New commits arrived while your review was sending. Review them, then vote again.";
}

/** The line that names the layer above, offered once a review is sent. */
const nextInStack = (layer: LocalPullRequest) =>
  `Next in stack: #${layer.facts.number} ${layer.facts.title}`;

/** The dialog's line on what goes with the review, and what stays in the draft. */
function goesWithIt(draft: DeckDraftReview | undefined) {
  const current = draft?.comments.filter((comment) => !comment.outdated) ?? [];
  const outdated = (draft?.comments.length ?? 0) - current.length;
  const sent =
    current.length === 0
      ? "No comments."
      : current.length === 1
        ? "1 comment goes with it."
        : `${current.length} comments go with it.`;
  return outdated === 0
    ? sent
    : `${sent} ${outdated === 1 ? "1 outdated comment stays" : `${outdated} outdated comments stay`} in your draft.`;
}

/**
 * The header's **Finish review · N**, its dialog, and the R keys, for an
 * open pull request. `headSha` is the head the page shows: a review with
 * no comments approves what the user read.
 */
export function FinishReview({
  pullRequest,
  draft,
  headSha,
  onSubmitted,
  nextLayer,
}: {
  pullRequest: LocalPullRequest;
  draft: DeckDraftReview | undefined;
  /** Undefined until the page read the diff: nothing is sent before. */
  headSha: string | undefined;
  /** After the code host took the review, so the page reads its threads again. */
  onSubmitted: () => void;
  /** The layer above in its stack, offered once the review is sent. */
  nextLayer?: LocalPullRequest;
}) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [verdict, setVerdict] = useState<Verdict>("comment");
  const [summary, setSummary] = useState("");
  const [sending, setSending] = useState(false);
  const [failure, setFailure] = useState<string | undefined>();
  /** The last try couldn't be settled: submitting again posts it anew. */
  const [uncertain, setUncertain] = useState(false);
  /** What the dialog says was done, while it offers the next layer or says why the vote wasn't sent. */
  const [sent, setSent] = useState<Outcome | undefined>();
  const summaryId = useId();
  const verdicts = reviewVerdicts(pullRequest.pluginId);
  const count = draft?.comments.length ?? 0;
  const current = draft?.comments.some((comment) => !comment.outdated) ?? false;
  // A request for changes, or a comment, says something.
  const empty = verdict !== "approve" && !summary.trim() && !current;

  function show(chosen: Verdict) {
    setVerdict(chosen);
    setFailure(undefined);
    setSent(undefined);
    setOpen(true);
  }
  function openNext() {
    if (!nextLayer) return;
    setOpen(false);
    void navigate({ to: "/deck/$itemId", params: { itemId: nextLayer._id } });
  }
  async function submit(chosen: Verdict, body: string, again = false) {
    if (sending || !headSha) return;
    setSending(true);
    setFailure(undefined);
    setUncertain(false);
    const ref: DeckReviewRef = {
      pluginId: pullRequest.pluginId,
      connectionId: pullRequest.connectionId,
      repository: pullRequest.facts.repository,
      number: pullRequest.facts.number,
    };
    // Named and stored before it's sent: Retry, after a restart too, sends
    // the same name, and the plugin completes only what's missing.
    const { request, sent } = localStore.prepareReviewSubmission(ref, {
      headSha: draft?.headSha ?? headSha,
      verdict: chosen,
      body,
      again,
    });
    try {
      const result = await submitPullRequestReview(
        pullRequest.pluginId,
        pullRequest.connectionId,
        request,
      );
      if ("uncertain" in result) {
        setVerdict(chosen);
        setFailure(mayAlreadyBeThere("review", pullRequest));
        setUncertain(true);
        setOpen(true);
        return;
      }
      localStore.completeReviewSubmission(ref, sent);
      setSummary("");
      if (result.voteWithheld) {
        // Posted, all but the vote: the dialog says so, after R then Y too,
        // and the user reviews the new commits before voting again.
        setSent({
          kind: "withheld",
          comments: sent.length,
          summary: request.body !== undefined,
        });
        setOpen(true);
        onSubmitted();
        return;
      }
      const done = sentTitle(chosen);
      if (!nextLayer) {
        setOpen(false);
        showToast(done);
      } else if (open) {
        // The dialog says what was sent, and offers the layer above.
        setSent({ kind: "sent", verdict: chosen });
      } else
        showActionToast({
          title: done,
          description: nextInStack(nextLayer),
          actionLabel: "Next in stack",
          onAction: openNext,
          timeout: 8_000,
        });
      onSubmitted();
    } catch (error) {
      // Nothing left the draft: the dialog shows why, with Retry.
      setVerdict(chosen);
      setFailure(writeFailure(error, pullRequest));
      setOpen(true);
    } finally {
      setSending(false);
    }
  }

  const ready = headSha !== undefined;
  useShortcut("deck.review-comment", () => ready && show("comment"));
  useShortcut(
    "deck.review-request-changes",
    () => ready && show("request_changes"),
  );
  useShortcut("deck.review-approve", () => ready && show("approve"));
  useShortcut("deck.review-quick-approve", () => {
    if (ready && !open) void submit("approve", "");
  });

  return (
    <>
      <Button variant="outline" disabled={!ready} onClick={() => show(verdict)}>
        {count ? `Finish review · ${count}` : "Finish review"}
      </Button>
      <Dialog
        open={open}
        onOpenChange={(shown) => {
          if (!sending) setOpen(shown);
          if (!shown) setSent(undefined);
        }}
      >
        <DialogContent>
          {sent ? (
            // Once sent it stays sent: a sync that drops the layer above
            // takes Next in stack away, never back to the form.
            <>
              <DialogHeader>
                <DialogTitle>
                  {sent.kind === "withheld"
                    ? "Your vote wasn't sent"
                    : sentTitle(sent.verdict)}
                </DialogTitle>
                <DialogDescription>
                  {sent.kind === "withheld"
                    ? withheldDescription(sent)
                    : nextLayer
                      ? nextInStack(nextLayer)
                      : "The layer above left the stack."}
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setOpen(false);
                    setSent(undefined);
                  }}
                >
                  Close
                </Button>
                {nextLayer && sent.kind === "sent" ? (
                  <Button type="button" autoFocus onClick={openNext}>
                    Next in stack
                  </Button>
                ) : null}
              </DialogFooter>
            </>
          ) : (
            <form
              className="contents"
              onSubmit={(event) => {
                event.preventDefault();
                if (!empty) void submit(verdict, summary, uncertain);
              }}
            >
              <DialogHeader>
                <DialogTitle>Finish review</DialogTitle>
                <DialogDescription>{goesWithIt(draft)}</DialogDescription>
              </DialogHeader>
              <label htmlFor={summaryId} className="sr-only">
                Summary
              </label>
              <Textarea
                id={summaryId}
                placeholder="Leave a summary (optional)"
                rows={4}
                value={summary}
                // Read-only, not disabled, while it sends: it stays
                // readable and focusable, and what was sent is what
                // completes, so no word typed meanwhile is cleared.
                readOnly={sending}
                onChange={(event) => setSummary(event.target.value)}
              />
              <fieldset className="deck-verdicts">
                <legend className="sr-only">Verdict</legend>
                {(["comment", "request_changes", "approve"] as const).map(
                  (value) => (
                    <label key={value} className="deck-verdict">
                      <input
                        type="radio"
                        name="verdict"
                        value={value}
                        checked={verdict === value}
                        onChange={() => setVerdict(value)}
                        disabled={sending}
                        className="accent-primary focus-visible:outline-2 focus-visible:outline-ring"
                      />
                      <span>{verdicts[value]}</span>
                    </label>
                  ),
                )}
              </fieldset>
              {failure ? (
                <MessagePanel role="alert">
                  {failure} Your draft review is kept.
                </MessagePanel>
              ) : null}
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  disabled={sending}
                  onClick={() => setOpen(false)}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={empty || sending || !ready}>
                  {sending
                    ? "Sending…"
                    : uncertain
                      ? "Post again"
                      : failure
                        ? "Retry"
                        : "Submit review"}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * A closed pull request's draft review, kept: **Post as comments** posts
 * each current comment on its line, one at a time, taking each out of the
 * draft once posted, and **Discard** deletes the draft after a confirmation.
 * Each post is named and the name kept with its comment before it's sent,
 * so Retry, after a restart too, posts none of them twice.
 */
export function ClosedDraftReview({
  pullRequest,
  draft,
  onPosted,
}: {
  pullRequest: LocalPullRequest;
  draft: DeckDraftReview;
  onPosted: () => void;
}) {
  const [posting, setPosting] = useState(false);
  const [failure, setFailure] = useState<string | undefined>();
  /** The comment whose last try couldn't be settled: Post again posts it anew. */
  const [uncertain, setUncertain] = useState<string | undefined>();
  const [confirming, setConfirming] = useState(false);
  const ref: DeckReviewRef = draft;
  const current = draft.comments.filter((comment) => !comment.outdated);
  const state = pullRequest.facts.state === "merged" ? "merged" : "closed";

  async function post(again?: string) {
    if (posting) return;
    setPosting(true);
    setFailure(undefined);
    setUncertain(undefined);
    try {
      for (const comment of current) {
        // Named and stored before it's sent.
        const request = localStore.prepareCommentPost(ref, comment.id, {
          again: comment.id === again,
        });
        if (!request) continue;
        const result = await postPullRequestComment(
          pullRequest.pluginId,
          pullRequest.connectionId,
          request,
        );
        if ("uncertain" in result) {
          setFailure(mayAlreadyBeThere("comment", pullRequest));
          setUncertain(comment.id);
          return;
        }
        // Posted ones leave at once, so a retry sends only the rest.
        localStore.completeDraftComments(ref, [comment.id]);
      }
      onPosted();
    } catch (error) {
      setFailure(
        `Couldn't post the comments: ${writeFailure(error, pullRequest)}`,
      );
    } finally {
      setPosting(false);
    }
  }

  return (
    <MessagePanel className="deck-closed-draft">
      <p>
        This pull request was {state}. Your draft review is kept: post its
        comments, or discard it.
      </p>
      {failure ? (
        <p role="alert" className="deck-composer-error">
          {failure}
        </p>
      ) : null}
      <div className="deck-note-actions">
        {current.length ? (
          <Button
            size="sm"
            disabled={posting}
            onClick={() => void post(uncertain)}
          >
            {posting
              ? "Posting…"
              : uncertain
                ? "Post again"
                : failure
                  ? "Retry"
                  : `Post as comments · ${current.length}`}
          </Button>
        ) : null}
        <Button
          size="sm"
          variant="outline"
          disabled={posting}
          onClick={() => setConfirming(true)}
        >
          Discard
        </Button>
      </div>
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard the draft review?</AlertDialogTitle>
            <AlertDialogDescription>
              {draft.comments.length === 1
                ? "Its comment is deleted from this computer."
                : `Its ${draft.comments.length} comments are deleted from this computer.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => localStore.discardDraftReview(ref)}
            >
              Discard
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </MessagePanel>
  );
}
