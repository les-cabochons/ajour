import { useId, useState } from "react";
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
import { showToast } from "@/components/ui/toast";
import { Textarea } from "@/components/ui/textarea";
import {
  lineAnchor,
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
 * the same name; nothing is queued.
 */

type Verdict = CodeHostSubmitReviewRequest["verdict"];

/** Why a write failed, in words for the page: the access it needs when that's off. */
export function writeFailure(error: unknown, pullRequest: LocalPullRequest) {
  if (isAccessOffError(error))
    return `This ${pullRequest.pluginName} connection can't review pull requests. Turn on Review pull requests for ${pullRequest.connectionLabel} in Settings › Plugins, then retry.`;
  return error instanceof Error ? error.message : String(error);
}

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
}: {
  pullRequest: LocalPullRequest;
  draft: DeckDraftReview | undefined;
  /** Undefined until the page read the diff: nothing is sent before. */
  headSha: string | undefined;
  /** After the code host took the review, so the page reads its threads again. */
  onSubmitted: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [verdict, setVerdict] = useState<Verdict>("comment");
  const [summary, setSummary] = useState("");
  const [sending, setSending] = useState(false);
  const [failure, setFailure] = useState<string | undefined>();
  const summaryId = useId();
  const verdicts = reviewVerdicts(pullRequest.pluginId);
  const count = draft?.comments.length ?? 0;
  const current = draft?.comments.some((comment) => !comment.outdated) ?? false;
  // A request for changes, or a comment, says something.
  const empty = verdict !== "approve" && !summary.trim() && !current;

  function show(next: Verdict) {
    setVerdict(next);
    setFailure(undefined);
    setOpen(true);
  }
  async function submit(next: Verdict, body: string) {
    if (sending || !headSha) return;
    setSending(true);
    setFailure(undefined);
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
      verdict: next,
      body,
    });
    try {
      await submitPullRequestReview(
        pullRequest.pluginId,
        pullRequest.connectionId,
        request,
      );
      localStore.completeReviewSubmission(ref, sent);
      setOpen(false);
      setSummary("");
      showToast(next === "approve" ? "Approved" : "Review sent");
      onSubmitted();
    } catch (error) {
      // Nothing left the draft: the dialog shows why, with Retry.
      setVerdict(next);
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
        onOpenChange={(next) => {
          if (!sending) setOpen(next);
        }}
      >
        <DialogContent>
          <form
            className="contents"
            onSubmit={(event) => {
              event.preventDefault();
              if (!empty) void submit(verdict, summary);
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
                {sending ? "Sending…" : failure ? "Retry" : "Submit review"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * A closed pull request's draft review, kept: **Post as comments** posts
 * each current comment on its line, one at a time, taking each out of the
 * draft once posted, and **Discard** deletes the draft after a confirmation.
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
  const [confirming, setConfirming] = useState(false);
  const ref: DeckReviewRef = draft;
  const current = draft.comments.filter((comment) => !comment.outdated);
  const state = pullRequest.facts.state === "merged" ? "merged" : "closed";

  async function post() {
    if (posting) return;
    setPosting(true);
    setFailure(undefined);
    try {
      for (const comment of current) {
        await postPullRequestComment(
          pullRequest.pluginId,
          pullRequest.connectionId,
          {
            repository: draft.repository,
            number: draft.number,
            body: comment.body,
            anchor: { ...lineAnchor(comment), headSha: draft.headSha },
          },
        );
        // Posted ones leave at once, so a retry sends only the rest.
        localStore.completeDraftComments(ref, [comment.id]);
      }
      onPosted();
    } catch (error) {
      setFailure(writeFailure(error, pullRequest));
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
          Couldn't post the comments: {failure}
        </p>
      ) : null}
      <div className="deck-note-actions">
        {current.length ? (
          <Button size="sm" disabled={posting} onClick={() => void post()}>
            {posting
              ? "Posting…"
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
