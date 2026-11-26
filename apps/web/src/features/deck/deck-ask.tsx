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
  DECK_QUESTION_MAX,
  type DeckNeedsConsent,
} from "@ajour/shared/deck";
import { Markdown } from "@/components/markdown";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  answerFooter,
  askGoing,
  askText,
  type AskState,
} from "@/domain/deck/ask";
import { watchClosedConversations } from "@/lib/agent-turns";
import { grantDeckConsent } from "@/lib/app-api";
import { watchDeckConsentRevocations } from "@/lib/deck-consent-revocations";
import { DeckClonePicker, type DeckCloneTarget } from "./deck-clone-picker";
import { DeckConsentDialog } from "./deck-consent-dialog";
import {
  askKey,
  DeckAskSessions,
  useAskSession,
  type AskSession,
  type ConsentAnswer,
  type DeckAskTarget,
} from "./deck-ask-sessions";

/*
 * Deck's quiet asks (#791): a faint `more ›` ends each concern's rationale.
 * It opens on the concern's default question, which Enter sends as is or as
 * edited; the answer streams in under the rationale, ending with the commit
 * it is about. The first ask in a repository opens the consent dialog.
 * Nothing names the agent. At rest a concern mounts one button and no
 * listener. The asks live in the page's `DeckAskSessions`, so a concern
 * that unmounts, as a huge pull request's rows do off screen (#790), finds
 * its ask as it left it.
 *
 * When the code host says where the repository is cloned from, an ask can
 * read the user's local clone too (#795): its footer says so, says why it
 * couldn't, or offers to choose the clone.
 */

interface DeckAskContextValue {
  target: DeckAskTarget;
  sessions: DeckAskSessions;
  /** Opens the clone picker. Resolves true once a clone is chosen. */
  pickClone(): Promise<boolean>;
}

const DeckAskContext = createContext<DeckAskContextValue | null>(null);

/** Gives the page's asks their pull request at `head`, and its one consent dialog. */
export function DeckAskProvider({
  pluginId,
  connectionId,
  repository,
  number,
  head,
  clone,
  children,
}: DeckAskTarget & { children: ReactNode }) {
  const target = useMemo(
    () => ({
      pluginId,
      connectionId,
      repository,
      number,
      head,
      ...(clone ? { clone } : {}),
    }),
    [pluginId, connectionId, repository, number, head, clone],
  );
  const [picking, setPicking] = useState<{
    target: DeckCloneTarget;
    resolve: (chosen: boolean) => void;
  }>();
  const pickClone = useCallback(
    () =>
      new Promise<boolean>((resolve) => {
        if (!target.clone) {
          resolve(false);
          return;
        }
        const cloneTarget = {
          pluginId: target.pluginId,
          connectionId: target.connectionId,
          repository: target.repository,
          clone: target.clone,
        };
        setPicking((current) => {
          current?.resolve(false);
          return { target: cloneTarget, resolve };
        });
      }),
    [target],
  );
  const closePicker = (chosen: boolean) => {
    picking?.resolve(chosen);
    setPicking(undefined);
  };
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
  const value = useMemo(
    () => ({ target, sessions, pickClone }),
    [target, sessions, pickClone],
  );
  return (
    <DeckAskContext.Provider value={value}>
      {children}
      <DeckConsentDialog
        request={asking?.request}
        onAnswer={(allowed) => void answer(allowed)}
      />
      <DeckClonePicker
        target={picking?.target}
        onOpenChange={(open) => {
          if (!open) closePicker(false);
        }}
        onChosen={() => closePicker(true)}
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
  const key = context ? askKey(context.target.head, concernId) : "";
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
                if (!open) context.sessions.open(key);
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
          concernId={concernId}
          session={session}
          context={context}
          onClosed={focusMore}
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
  concernId,
  session,
  context,
  onClosed,
}: {
  id: string;
  askKey: string;
  concernId: string;
  session: AskSession;
  context: DeckAskContextValue;
  /** After the ask closes. */
  onClosed: () => void;
}) {
  const { target, sessions, pickClone } = context;
  const { state, turnId, starting } = session;
  const ask = (question?: string) =>
    void sessions.ask(target, concernId, question, onClosed);
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
    <section id={id} className="deck-ask" aria-label="More detail">
      {state.question !== undefined ? (
        <p className="deck-ask-question">{state.question}</p>
      ) : null}
      {state.kind === "asking" ? (
        <p role="status" className="deck-ask-placeholder">
          Getting more detail…
        </p>
      ) : state.kind === "waiting" ? (
        <p role="status" className="deck-ask-placeholder">
          Waiting for the timesheet task to finish
        </p>
      ) : null}
      {text ? <Markdown className="deck-ask-text">{text}</Markdown> : null}
      {state.kind === "answered" ? (
        <AnswerFooter
          state={state}
          // Without where the repository is cloned from, there's nothing to choose.
          canChooseClone={target.clone !== undefined}
          onChooseClone={() =>
            void pickClone().then((chosen) => {
              // Asked again, the answer reads the clone.
              if (chosen) ask(state.question);
            })
          }
        />
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
            disabled={!turnId && !starting}
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
 * The head the answer read, with `, and your clone` when it read the
 * user's clone too; why it couldn't, quietly; or the offer to choose one.
 */
function AnswerFooter({
  state,
  canChooseClone,
  onChooseClone,
}: {
  state: Extract<AskState, { kind: "answered" }>;
  canChooseClone: boolean;
  onChooseClone: () => void;
}) {
  const footer = answerFooter(state);
  return (
    <>
      <p className="deck-ask-footer">
        {footer.source}
        {footer.offersClone && canChooseClone ? (
          <>
            {" · "}
            <button
              type="button"
              className="deck-ask-clone"
              onClick={onChooseClone}
            >
              Read your clone too
            </button>
          </>
        ) : null}
      </p>
      {footer.cloneReason ? (
        <p className="deck-ask-footer">{footer.cloneReason}</p>
      ) : null}
    </>
  );
}

/**
 * The question an ask opens on: the default one, focused and selected right
 * after `more ›`, so Enter sends it as is and typing replaces it. Escape
 * closes the ask.
 */
function AskQuestion({
  id,
  draft,
  focus,
  onFocused,
  onDraft,
  onAsk,
  onClose,
}: {
  id: string;
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
    onAsk(question === DECK_CONCERN_DEFAULT_QUESTION ? undefined : question);
  };
  return (
    <form
      id={id}
      className="deck-ask deck-ask-compose"
      aria-label="More detail"
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
