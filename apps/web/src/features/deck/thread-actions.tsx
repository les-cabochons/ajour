import { createContext, useEffect, useRef } from "react";
import type { CodeHostReviewThread } from "@ajour/shared";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { getShortcutPlatform } from "@/lib/shortcuts";
import type { ThreadState, ThreadStates } from "./thread-state";

/*
 * A review thread's own actions (#785, ADR 0002): **Reply**, which posts at
 * once, and **Resolve** or **Unresolve**. Both go to the code host as soon
 * as the user acts, with nothing queued. A failed reply keeps its words with
 * the reason and Retry, which sends the same name, so it posts once; one the
 * code host can't settle offers Post again. The page provides the actions;
 * a thread shown without them, such as on a closed pull request, has none.
 */

export interface ThreadActions {
  states: ThreadStates;
  /** The conversation read on screen: what was sent before it, it shows itself. */
  conversation: object | undefined;
  /** Posts the thread's reply, keeping in `states` that it's posting, then why it failed. */
  reply: (thread: CodeHostReviewThread, body: string) => Promise<void>;
  setResolved: (
    thread: CodeHostReviewThread,
    resolved: boolean,
  ) => Promise<void>;
}

export const ThreadActionsContext = createContext<ThreadActions | undefined>(
  undefined,
);

/** Reply, and Resolve or Unresolve, under a thread's comments; or its reply field. */
export function ThreadFooter({
  thread,
  state,
  resolved,
  actions,
}: {
  thread: CodeHostReviewThread;
  state: ThreadState;
  /** What the thread is now: the code host's word, or the last resolve sent. */
  resolved: boolean;
  actions: ThreadActions;
}) {
  if (state.replying)
    return <ReplyField thread={thread} state={state} actions={actions} />;
  return (
    <>
      {state.resolveFailure ? (
        <p role="alert" className="deck-composer-error">
          {`Couldn't ${resolved ? "unresolve" : "resolve"} the thread: ${state.resolveFailure}`}
        </p>
      ) : null}
      <div className="deck-note-actions">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => actions.states.openReply(thread.id)}
        >
          Reply
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={state.resolving}
          onClick={() => void actions.setResolved(thread, !resolved)}
        >
          {state.resolving
            ? resolved
              ? "Unresolving…"
              : "Resolving…"
            : resolved
              ? "Unresolve"
              : "Resolve"}
        </Button>
      </div>
    </>
  );
}

/** The reply being written: Ctrl+Enter (Cmd+Enter) or **Reply** posts it at once. */
function ReplyField({
  thread,
  state,
  actions,
}: {
  thread: CodeHostReviewThread;
  state: ThreadState;
  actions: ThreadActions;
}) {
  const { states } = actions;
  const { body, posting, failure, uncertain, focus } = state;
  const field = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (!focus) return;
    field.current?.focus({ preventScroll: true });
    states.update(thread.id, { focus: false });
  }, [focus, states, thread.id]);
  const empty = !body.trim();
  const send = () => {
    if (!empty && !posting) void actions.reply(thread, body);
  };
  const mac = getShortcutPlatform() === "mac";
  return (
    <form
      className="deck-reply"
      aria-label="Reply to the thread"
      onSubmit={(event) => {
        event.preventDefault();
        send();
      }}
    >
      <Textarea
        ref={field}
        aria-label="Reply"
        placeholder="Reply"
        value={body}
        rows={2}
        onChange={(event) =>
          states.update(thread.id, { body: event.target.value })
        }
        onKeyDown={(event) => {
          if (event.key === "Enter" && (mac ? event.metaKey : event.ctrlKey)) {
            // The page's own Ctrl+Enter, Add to review, isn't this field's.
            event.preventDefault();
            send();
          } else if (event.key === "Escape" && !posting) {
            event.preventDefault();
            states.closeReply(thread.id);
          }
        }}
      />
      {failure ? (
        <p role="alert" className="deck-composer-error">
          {uncertain ? failure : `Couldn't post the reply: ${failure}`}
        </p>
      ) : null}
      <div className="deck-note-actions">
        <Button
          type="submit"
          size="sm"
          disabled={empty || posting}
          aria-keyshortcuts={mac ? "Meta+Enter" : "Control+Enter"}
        >
          {posting
            ? "Posting…"
            : uncertain
              ? "Post again"
              : failure
                ? "Retry"
                : "Reply"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={posting}
          onClick={() => states.closeReply(thread.id)}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
