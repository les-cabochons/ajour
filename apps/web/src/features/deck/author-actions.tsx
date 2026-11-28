import { useEffect, useId, useRef, useState } from "react";
import { RiPencilLine } from "@remixicon/react";
import type {
  CodeHostMergeMethod,
  CodeHostVersionsResult,
} from "@ajour/shared";
import { MessagePanel } from "@/components/app-surface";
import { TooltipButton } from "@/components/tooltip-button";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  showActionToast,
  showErrorToast,
  showToast,
} from "@/components/ui/toast";
import {
  authorActions,
  defaultCommitTitle,
  draftActionFailure,
  draftActionLabel,
  mergeBlocker,
  mergeMethodLabels,
  pendingMerge,
} from "@/domain/deck/author-actions";
import type { LocalPullRequest } from "@/domain/pull-requests/pull-request-lifecycle";
import {
  mergePullRequest,
  syncCodeHostConnection,
  updatePullRequest,
} from "@/lib/app-api";
import { localStore } from "@/lib/local-store";
import { writeFailure } from "./finish-review";

/*
 * The author's actions on their own open pull request (#786, ADR 0002): the
 * title, edited in place; draft and ready; and merge. Each goes to the code
 * host at once, with nothing queued, and the page takes what the code host
 * answered. A failure keeps the edit and offers Retry. Merge alone asks
 * first, naming the method and the commit title, and offers only the
 * methods the repository allows. The chat never merges (ADR 0023): merge is
 * reachable from this page only.
 */

const refOf = (pullRequest: LocalPullRequest) => ({
  repository: pullRequest.facts.repository,
  number: pullRequest.facts.number,
});

/**
 * The page's title. The author edits it in place: Enter saves it to the code
 * host, Escape leaves it. A failed save keeps the words with Retry.
 */
export function PullRequestTitle({
  pullRequest,
}: {
  pullRequest: LocalPullRequest;
}) {
  const { title } = pullRequest.facts;
  const [editing, setEditing] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | undefined>();
  const editable = authorActions(pullRequest.facts);

  function close() {
    setEditing(undefined);
    setFailure(undefined);
  }
  async function save() {
    if (editing === undefined || saving) return;
    const next = editing.trim();
    // An empty or unchanged title sends nothing.
    if (!next || next === title) {
      close();
      return;
    }
    setSaving(true);
    setFailure(undefined);
    try {
      const result = await updatePullRequest(
        pullRequest.pluginId,
        pullRequest.connectionId,
        { ...refOf(pullRequest), title: next },
      );
      localStore.changePullRequest(pullRequest._id, {
        type: "edited",
        ...result,
      });
      close();
    } catch (error) {
      setFailure(writeFailure(error, pullRequest));
    } finally {
      setSaving(false);
    }
  }

  if (editing === undefined || !editable) {
    return (
      <div className="deck-title-row">
        <h1 className="backlog-item-page-title">{title}</h1>
        {editable ? (
          <TooltipButton
            label="Edit the title"
            render={<Button variant="ghost" size="icon-sm" />}
            onClick={() => setEditing(title)}
          >
            <RiPencilLine aria-hidden />
          </TooltipButton>
        ) : null}
      </div>
    );
  }
  return (
    <form
      aria-label="Edit the title"
      className="deck-title-edit"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <Input
        autoFocus
        aria-label="Title"
        value={editing}
        readOnly={saving}
        maxLength={1_000}
        className="backlog-item-page-title h-auto px-1.5 py-0.5"
        onFocus={(event) => event.currentTarget.select()}
        onChange={(event) => setEditing(event.target.value)}
        onBlur={() => {
          // Leaving an unchanged or empty title closes it; changed words stay to save.
          const words = editing.trim();
          if (!saving && !failure && (!words || words === title)) close();
        }}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === "Enter") {
            event.preventDefault();
            void save();
          } else if (event.key === "Escape" && !saving) {
            event.preventDefault();
            close();
          }
        }}
      />
      {saving ? (
        <p className="deck-title-note" role="status">
          Saving…
        </p>
      ) : null}
      {failure ? (
        <>
          <p role="alert" className="deck-composer-error">
            {`Couldn't save the title: ${failure}`}
          </p>
          <div className="deck-note-actions">
            <Button size="sm" type="submit" disabled={saving}>
              Retry
            </Button>
            <Button
              size="sm"
              type="button"
              variant="outline"
              disabled={saving}
              onClick={close}
            >
              Cancel
            </Button>
          </div>
        </>
      ) : null}
    </form>
  );
}

/**
 * Converts the pull request to a draft, or marks it ready, at once. A
 * failure shows the reason in a toast with Retry. The review page offers
 * it in its "…" menu, as the action this returns.
 */
export function useDraftToggle(pullRequest: LocalPullRequest) {
  const [sending, setSending] = useState(false);
  // Read when a toast's Retry runs, which may be long after it showed.
  const sendingRef = useRef(false);
  const { draft } = pullRequest.facts;

  async function toggle(next: boolean) {
    if (sendingRef.current) return;
    sendingRef.current = true;
    setSending(true);
    try {
      const result = await updatePullRequest(
        pullRequest.pluginId,
        pullRequest.connectionId,
        { ...refOf(pullRequest), draft: next },
      );
      localStore.changePullRequest(pullRequest._id, {
        type: "edited",
        ...result,
      });
    } catch (error) {
      showActionToast({
        title: draftActionFailure(pullRequest.pluginId, next),
        description: writeFailure(error, pullRequest),
        actionLabel: "Retry",
        onAction: () => {
          // Only while the pull request still isn't what it asked for.
          const now = localStore
            .snapshot()
            .pullRequests?.find((item) => item._id === pullRequest._id);
          if (now?.facts.state === "open" && now.facts.draft !== next)
            void toggle(next);
        },
      });
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }

  return {
    label: draftActionLabel(pullRequest.pluginId, draft),
    sending,
    run: () => void toggle(!draft),
  };
}

/**
 * **Merge…** and its confirmation: the methods the repository allows, the
 * commit title, and what it merges into what. It merges the head on screen,
 * never a newer one: a push since the page read the changes, or a draft,
 * holds it back. A failure keeps the dialog, the method and the title, with
 * Retry; the plugin finds a merge an earlier try made, so Retry after a lost
 * answer merges nothing twice.
 */
export function MergePullRequest({
  pullRequest,
  headSha,
  methods,
  pushes,
  versionName,
  onFailed,
  primary = false,
}: {
  pullRequest: LocalPullRequest;
  /** The head the page shows. Undefined until the page read the diff. */
  headSha: string | undefined;
  /** The methods the repository allows. Undefined until they're read. */
  methods: readonly CodeHostMergeMethod[] | undefined;
  /** Pushes after the head on screen. */
  pushes: number;
  versionName?: CodeHostVersionsResult["versionName"];
  /** A merge failed: the page reads the versions again, so a push since shows. */
  onFailed?: () => void;
  /** Nothing is left before the merge: the button is the primary one. */
  primary?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [method, setMethod] = useState<CodeHostMergeMethod | undefined>();
  const [commitTitle, setCommitTitle] = useState<string | undefined>();
  const [sending, setSending] = useState(false);
  const [failure, setFailure] = useState<string | undefined>();
  /**
   * A merge the code host took and is still completing, and whether the
   * sync it started has finished. Merge waits while `pendingMerge` says so.
   */
  const [pending, setPending] = useState<{ synced: boolean } | undefined>();
  const titleId = useId();
  const { pluginId, connectionId, facts } = pullRequest;
  const labels = mergeMethodLabels(pluginId);
  const outcome = pending ? pendingMerge(facts, pending) : undefined;
  const completing = outcome === "completing";
  useEffect(() => {
    if (!outcome || outcome === "completing") return;
    setPending(undefined);
    if (outcome === "conflicting") {
      showErrorToast({
        id: `deck-merge-${pullRequest._id}`,
        title: `${pullRequest.pluginName} couldn't complete the merge`,
        description:
          "The source and target branches conflict. Resolve the conflicts, then merge again.",
      });
    }
  }, [outcome, pullRequest._id, pullRequest.pluginName]);
  const ready = headSha !== undefined && methods !== undefined && !completing;
  const chosen =
    method && methods?.includes(method) ? method : (methods?.[0] ?? undefined);
  const blocker = methods
    ? mergeBlocker(pullRequest, {
        draft: facts.draft,
        pushes,
        methods,
        versionName,
      })
    : undefined;
  // The title the code host would write, until the user edits it. A merge
  // commit and a squash start the same; a rebase has none.
  const title = commitTitle ?? defaultCommitTitle(pluginId, "squash", facts)!;
  const base = facts.baseRef;

  async function merge() {
    if (sending || blocker || !headSha || !chosen) return;
    setSending(true);
    setFailure(undefined);
    const words = title.trim();
    try {
      const result = await mergePullRequest(pluginId, connectionId, {
        ...refOf(pullRequest),
        method: chosen,
        headSha,
        ...(chosen !== "rebase" && words ? { commitTitle: words } : {}),
      });
      setOpen(false);
      const completed = !!result.mergeCommitSha;
      if (completed) {
        localStore.changePullRequest(pullRequest._id, { type: "merged" });
        showToast("Merged");
      } else {
        setPending({ synced: false });
        showToast(`${pullRequest.pluginName} is completing the merge`);
      }
      // The next sync says how it closed. One that fails ends the wait with
      // no verdict: the facts it leaves are from before the merge.
      void syncCodeHostConnection(pluginId, connectionId).then(
        () => {
          if (!completed) setPending((current) => current && { synced: true });
        },
        () => {
          if (!completed) setPending(undefined);
        },
      );
    } catch (error) {
      setFailure(writeFailure(error, pullRequest));
      onFailed?.();
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <Button
        variant={primary ? "default" : "outline"}
        disabled={!ready}
        onClick={() => {
          setFailure(undefined);
          setOpen(true);
        }}
      >
        {completing ? "Merging…" : "Merge…"}
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
              void merge();
            }}
          >
            <DialogHeader>
              <DialogTitle>
                {base
                  ? `Merge #${facts.number} into ${base}?`
                  : `Merge #${facts.number}?`}
              </DialogTitle>
              <DialogDescription>
                {`It merges the head you read, ${(headSha ?? "").slice(0, 7)}, into ${base ?? "its base branch"}. A merge can't be undone.`}
              </DialogDescription>
            </DialogHeader>
            {methods?.length ? (
              <fieldset className="deck-verdicts">
                <legend className="sr-only">Merge method</legend>
                {methods.map((value) => (
                  <label key={value} className="deck-verdict">
                    <input
                      type="radio"
                      name="merge-method"
                      value={value}
                      checked={chosen === value}
                      onChange={() => setMethod(value)}
                      disabled={sending}
                      className="accent-primary focus-visible:outline-2 focus-visible:outline-ring"
                    />
                    <span>{labels[value]}</span>
                  </label>
                ))}
              </fieldset>
            ) : null}
            {chosen === "rebase" ? (
              <p className="deck-title-note">
                {`Rebasing adds its commits onto ${base ?? "the base branch"} one by one, with no merge commit.`}
              </p>
            ) : chosen ? (
              <div className="deck-merge-title">
                <label htmlFor={titleId}>Commit title</label>
                <Input
                  id={titleId}
                  value={title}
                  maxLength={1_000}
                  readOnly={sending}
                  onChange={(event) => setCommitTitle(event.target.value)}
                />
              </div>
            ) : null}
            {blocker ? <MessagePanel>{blocker}</MessagePanel> : null}
            {failure ? (
              <MessagePanel role="alert">{`Couldn't merge: ${failure}`}</MessagePanel>
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
              <Button
                type="submit"
                disabled={!!blocker || sending || !chosen || !headSha}
              >
                {sending ? "Merging…" : failure ? "Retry" : "Merge"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
