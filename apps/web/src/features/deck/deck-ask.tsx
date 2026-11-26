import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  DECK_CONCERN_DEFAULT_QUESTION,
  DECK_LINES_DEFAULT_QUESTION,
  DECK_QUESTION_MAX,
  deckLinesLabel,
  type DeckAskAnchor,
  type DeckNeedsConsent,
} from "@ajour/shared/deck";
import { Markdown } from "@/components/markdown";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { askGoing, askText, shortHead } from "@/domain/deck/ask";
import { anchorSelection, linkCitations } from "@/domain/deck/line-selection";
import { watchClosedConversations } from "@/lib/agent-turns";
import { grantDeckConsent } from "@/lib/app-api";
import { watchDeckConsentRevocations } from "@/lib/deck-consent-revocations";
import { DeckConsentDialog } from "./deck-consent-dialog";
import {
  askKey,
  DeckAskSessions,
  useAskSession,
  useHunkAsks,
  type AskSession,
  type ConsentAnswer,
  type DeckAskTarget,
} from "./deck-ask-sessions";
import { useReviewLines } from "./review-lines-context";

/*
 * Deck's quiet asks (#791, #793): a faint `more ›` ends each concern's
 * rationale, and the toolbar above selected lines asks about them. An ask
 * opens on its anchor's default question, which Enter sends as is or as
 * edited; the answer streams in under the rationale, or after the hunk of
 * the lines, ending with the commit it is about, and its `path:line`
 * citations scroll to their lines. The first ask in a repository opens the
 * consent dialog. Nothing names the agent. At rest a concern mounts one
 * button and no listener, and a hunk nothing for its asks. The asks live
 * in the page's `DeckAskSessions`, so a concern or a hunk that unmounts,
 * as a huge pull request's rows do off screen (#790), finds its ask as it
 * left it.
 */

interface DeckAskContextValue {
  target: DeckAskTarget;
  sessions: DeckAskSessions;
}

const DeckAskContext = createContext<DeckAskContextValue | null>(null);

/** The page's asks and the pull request they are about, or null outside the review page's changes. */
export function useDeckAsks() {
  return useContext(DeckAskContext);
}

/** Gives the page's asks their pull request at `head`, and its one consent dialog. */
export function DeckAskProvider({
  pluginId,
  connectionId,
  repository,
  number,
  head,
  children,
}: DeckAskTarget & { children: ReactNode }) {
  const target = useMemo(
    () => ({ pluginId, connectionId, repository, number, head }),
    [pluginId, connectionId, repository, number, head],
  );
  const [asking, setAsking] = useState<{
    request: DeckNeedsConsent;
    resolve: (answer: ConsentAnswer) => void;
  }>();
  const requestConsent = useCallback(
    (request: DeckNeedsConsent) =>
      new Promise<ConsentAnswer>((resolve) =>
        setAsking((current) => {
          // A second ask while the dialog shows waits on the same answer.
          if (current) {
            const first = current.resolve;
            return {
              request,
              resolve: (answer) => {
                first(answer);
                resolve(answer);
              },
            };
          }
          return { request, resolve };
        }),
      ),
    [],
  );
  const [sessions] = useState(() => new DeckAskSessions(requestConsent));
  // The asks follow their turns while the page shows. React's development
  // remount detaches them and attaches them again.
  useEffect(() => {
    sessions.attach();
    return () => sessions.detach();
  }, [sessions]);
  useEffect(() => sessions.keepHead(head), [sessions, head]);
  // A revoked repository's answers show no more, in this window or another.
  useEffect(() => {
    const stopRevocations = watchDeckConsentRevocations((revoked) => {
      if (
        revoked.pluginId === pluginId &&
        revoked.connectionId === connectionId &&
        revoked.repository === repository
      )
        sessions.revoke(revoked.at);
    });
    const stopClosed = watchClosedConversations((event) =>
      sessions.conversationClosed(event.conversationId, event.reason),
    );
    return () => {
      stopRevocations();
      stopClosed();
    };
  }, [sessions, pluginId, connectionId, repository]);
  const answer = async (allowed: boolean) => {
    const current = asking;
    if (!current) return;
    setAsking(undefined);
    if (!allowed) {
      current.resolve(false);
      return;
    }
    try {
      // Only for the agent the dialog named.
      await grantDeckConsent(
        target.pluginId,
        target.connectionId,
        current.request.repository,
        current.request.provider.cli,
      );
      current.resolve(true);
    } catch (error) {
      current.resolve({
        error:
          error instanceof Error
            ? error.message
            : "Ajour couldn't record your answer.",
      });
    }
  };
  const value = useMemo(() => ({ target, sessions }), [target, sessions]);
  return (
    <DeckAskContext.Provider value={value}>
      {children}
      <DeckConsentDialog
        request={asking?.request}
        onAnswer={(allowed) => void answer(allowed)}
      />
    </DeckAskContext.Provider>
  );
}

/** A concern's rationale, ended by its `more ›`, and the answer under it. */
export function ConcernRationale({
  concernId,
  rationale,
}: {
  concernId: string;
  rationale: string;
}) {
  const context = useContext(DeckAskContext);
  const anchor = useMemo(
    (): DeckAskAnchor => ({ kind: "concern", id: concernId }),
    [concernId],
  );
  const key = context ? askKey(context.target.head, anchor) : "";
  const session = useAskSession(context?.sessions, key);
  const open = session !== undefined;
  const answerId = useId();
  const more = useRef<HTMLButtonElement>(null);
  // Focus goes back to `more ›`, as it would from a closed popover.
  const focusMore = useCallback(() => more.current?.focus(), []);
  return (
    <>
      <p className="deck-concern-rationale">
        {rationale}
        {context ? (
          <>
            {rationale ? " " : null}
            <button
              ref={more}
              type="button"
              className="deck-more"
              aria-label="More detail"
              aria-expanded={open}
              aria-controls={open ? answerId : undefined}
              onClick={() => {
                if (!open) context.sessions.open(context.target.head, anchor);
              }}
            >
              more ›
            </button>
          </>
        ) : null}
      </p>
      {context && session ? (
        <AskAnswer
          id={answerId}
          askKey={key}
          session={session}
          context={context}
          onClosed={focusMore}
          label="More detail"
          placeholder="Getting more detail…"
          defaultQuestion={DECK_CONCERN_DEFAULT_QUESTION}
        />
      ) : null}
    </>
  );
}

/**
 * An open ask: first its question, the default one to send as is or edit,
 * then its answer. It only shows its session, so it can unmount and mount
 * again, scrolled away or by React's development remount, and the ask goes
 * on. A closed answer's turn ends on its own and is cached.
 */
function AskAnswer({
  id,
  askKey: key,
  session,
  context,
  onClosed,
  label,
  placeholder,
  defaultQuestion,
  actions,
}: {
  id: string;
  askKey: string;
  session: AskSession;
  context: DeckAskContextValue;
  /** After the ask closes. */
  onClosed: () => void;
  /** Names the block, "More detail" on a concern. */
  label: string;
  /** What shows while nothing came yet. */
  placeholder: string;
  /** The anchor's default question, which sent as is asks with none. */
  defaultQuestion: string;
  /** More actions on an answer, before Dismiss, given its text. */
  actions?: (text: string) => ReactNode;
}) {
  const { target, sessions } = context;
  const { state, turnId } = session;
  const lines = useReviewLines();
  const ask = (question?: string) =>
    void sessions.ask(target, session.anchor, question, onClosed);
  const close = () => {
    sessions.close(key);
    onClosed();
  };
  const focused = useCallback(
    () => sessions.edit(key, { focusQuestion: false }),
    [sessions, key],
  );

  if (session.awaitingConsent) return null;
  if (session.composing) {
    return (
      <AskQuestion
        id={id}
        label={label}
        defaultQuestion={defaultQuestion}
        draft={session.question}
        focus={session.focusQuestion}
        onFocused={focused}
        onDraft={(question) => sessions.edit(key, { question })}
        onAsk={ask}
        onClose={close}
      />
    );
  }
  const going = askGoing(state);
  const text = askText(state);
  return (
    <section id={id} className="deck-ask" aria-label={label}>
      {state.question !== undefined ? (
        <p className="deck-ask-question">{state.question}</p>
      ) : null}
      {state.kind === "asking" ? (
        <p role="status" className="deck-ask-placeholder">
          {placeholder}
        </p>
      ) : state.kind === "waiting" ? (
        <p role="status" className="deck-ask-placeholder">
          Waiting for the timesheet task to finish
        </p>
      ) : null}
      {text ? (
        <Markdown className="deck-ask-text" onCitation={lines?.cite}>
          {lines ? linkCitations(text, lines.paths) : text}
        </Markdown>
      ) : null}
      {state.kind === "answered" ? (
        <p className="deck-ask-footer">
          From the code at {shortHead(state.head)}
        </p>
      ) : state.kind === "stopped" ? (
        <p className="deck-ask-footer">Stopped.</p>
      ) : state.kind === "failed" ? (
        <p role="alert" className="deck-ask-footer deck-ask-error">
          {state.message}
        </p>
      ) : null}
      <div className="deck-ask-actions">
        {going ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => sessions.stop(key)}
            disabled={!turnId}
          >
            Stop
          </Button>
        ) : (
          <>
            <form
              className="deck-ask-form"
              onSubmit={(event) => {
                event.preventDefault();
                const question = session.followUp.trim();
                if (!question) return;
                sessions.edit(key, { followUp: "" });
                ask(question);
              }}
            >
              <Input
                aria-label="Ask something else"
                placeholder="Ask something else…"
                value={session.followUp}
                maxLength={DECK_QUESTION_MAX}
                onChange={(event) =>
                  sessions.edit(key, { followUp: event.target.value })
                }
              />
            </form>
            {state.kind === "failed" ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => ask(state.question)}
              >
                Try again
              </Button>
            ) : null}
            {state.kind === "answered" && actions ? actions(text) : null}
            <Button variant="ghost" size="sm" onClick={close}>
              Dismiss
            </Button>
          </>
        )}
      </div>
    </section>
  );
}

/**
 * The question an ask opens on: the default one, focused and selected right
 * after `more ›`, so Enter sends it as is and typing replaces it. Escape
 * closes the ask.
 */
function AskQuestion({
  id,
  label,
  defaultQuestion,
  draft,
  focus,
  onFocused,
  onDraft,
  onAsk,
  onClose,
}: {
  id: string;
  label: string;
  defaultQuestion: string;
  draft: string;
  /** Takes the focus as it mounts. Coming back on screen, it doesn't. */
  focus: boolean;
  onFocused: () => void;
  onDraft: (question: string) => void;
  /** No question means the default one, so its answer is cached as such. */
  onAsk: (question?: string) => void;
  onClose: () => void;
}) {
  const field = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (!focus) return;
    field.current?.focus();
    field.current?.select();
    onFocused();
  }, [focus, onFocused]);
  const send = () => {
    const question = draft.trim();
    if (!question) return;
    onAsk(question === defaultQuestion ? undefined : question);
  };
  return (
    <form
      id={id}
      className="deck-ask deck-ask-compose"
      aria-label={label}
      onSubmit={(event) => {
        event.preventDefault();
        send();
      }}
    >
      <Textarea
        ref={field}
        aria-label="Question"
        rows={1}
        className="min-h-0"
        value={draft}
        maxLength={DECK_QUESTION_MAX}
        onChange={(event) => onDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            onClose();
          } else if (
            event.key === "Enter" &&
            !event.shiftKey &&
            !event.nativeEvent.isComposing
          ) {
            event.preventDefault();
            send();
          }
        }}
      />
      <Button type="submit" variant="ghost" size="sm">
        Ask
      </Button>
    </form>
  );
}

/**
 * The asks about a hunk's selected lines, after its lines and the threads
 * among them: never between code lines, so the hunk stays whole. Nothing
 * shows while none is open.
 */
export function HunkAsks({ hunkId }: { hunkId: string }) {
  const context = useContext(DeckAskContext);
  const keys = useHunkAsks(context?.sessions, hunkId);
  if (!context || !keys.length) return null;
  return keys.map((key) => (
    <LinesAnswer key={key} askKey={key} context={context} />
  ));
}

/** One ask about selected lines, with Turn into a comment once answered. */
function LinesAnswer({
  askKey: key,
  context,
}: {
  askKey: string;
  context: DeckAskContextValue;
}) {
  const session = useAskSession(context.sessions, key);
  const lines = useReviewLines();
  const id = useId();
  if (!session || session.anchor.kind !== "lines" || !session.hunkId)
    return null;
  const { anchor, hunkId } = session;
  const comment = lines?.comment;
  return (
    <AskAnswer
      id={id}
      askKey={key}
      session={session}
      context={context}
      onClosed={() => {}}
      label={`Explanation of ${deckLinesLabel(anchor)}`}
      placeholder="Explaining…"
      defaultQuestion={DECK_LINES_DEFAULT_QUESTION}
      actions={
        comment
          ? (text) => (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  // The composer holds the answer now; asking again shows it at once.
                  context.sessions.close(key);
                  comment(anchorSelection(hunkId, anchor), text);
                }}
              >
                Turn into a comment
              </Button>
            )
          : undefined
      }
    />
  );
}
