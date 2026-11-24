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
  deckNeedsConsentSchema,
  type DeckAskAnchor,
  type DeckNeedsConsent,
} from "@ajour/shared/deck";
import { Markdown } from "@/components/markdown";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  answerAsk,
  applyTurnEvent,
  askGoing,
  askText,
  failAsk,
  shortHead,
  startAsk,
  type AskState,
} from "@/domain/deck/ask";
import { watchAgentTurn } from "@/lib/agent-turns";
import {
  AppApiError,
  askDeck,
  cancelAgentTurn,
  grantDeckConsent,
} from "@/lib/app-api";
import { DeckConsentDialog } from "./deck-consent-dialog";

/*
 * Deck's quiet asks (#791): a faint `more ›` ends each concern's rationale.
 * It opens on the concern's default question, which Enter sends as is or as
 * edited; the answer streams in under the rationale, ending with the commit
 * it is about. The first ask in a repository opens the consent dialog.
 * Nothing names the agent. At rest a concern mounts one button and no
 * listener.
 */

/** The pull request the page asks about, at the head it shows. */
export interface DeckAskTarget {
  pluginId: string;
  connectionId: string;
  repository: string;
  number: number;
  head: string;
}

interface DeckAskContextValue {
  target: DeckAskTarget;
  /**
   * Opens the consent dialog. Resolves true once the repository is allowed,
   * false for Not now, or why recording the consent failed.
   */
  requestConsent(request: DeckNeedsConsent): Promise<ConsentAnswer>;
}

type ConsentAnswer = boolean | { error: string };

const DeckAskContext = createContext<DeckAskContextValue | null>(null);

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
    () => ({ target, requestConsent }),
    [target, requestConsent],
  );
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
  const [open, setOpen] = useState(false);
  const answerId = useId();
  const anchor = useMemo<DeckAskAnchor>(
    () => ({ kind: "concern", id: concernId }),
    [concernId],
  );
  const more = useRef<HTMLButtonElement>(null);
  // Focus goes back to `more ›`, as it would from a closed popover.
  const close = useCallback(() => {
    setOpen(false);
    more.current?.focus();
  }, []);
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
              onClick={() => setOpen(true)}
            >
              more ›
            </button>
          </>
        ) : null}
      </p>
      {context && open ? (
        <AskAnswer
          id={answerId}
          anchor={anchor}
          context={context}
          onClose={close}
        />
      ) : null}
    </>
  );
}

/**
 * An open ask: first its question, the default one to send as is or edit,
 * then its answer. Nothing here depends on an unmount, so React's
 * development remount keeps the ask going, and a closed answer's turn ends
 * on its own and is cached.
 */
function AskAnswer({
  id,
  anchor,
  context,
  onClose,
}: {
  id: string;
  anchor: DeckAskAnchor;
  context: DeckAskContextValue;
  onClose: () => void;
}) {
  const { target, requestConsent } = context;
  /** Nothing is asked yet: the question shows, to send or edit. */
  const [composing, setComposing] = useState(true);
  const [state, setState] = useState<AskState>(() => startAsk());
  const [draft, setDraft] = useState("");
  /** The consent dialog is open: nothing is asked yet, so nothing shows. */
  const [awaitingConsent, setAwaitingConsent] = useState(false);
  /** The running turn, which Stop stops and whose events the ask follows. */
  const [turnId, setTurnId] = useState<string>();
  /** Counts the asks, so an answer for an earlier one is dropped. */
  const generation = useRef(0);

  const ask = useCallback(
    async (question?: string) => {
      const mine = ++generation.current;
      setComposing(false);
      setTurnId(undefined);
      setState(startAsk(question));
      const current = () => generation.current === mine;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          const asked = await askDeck(target.pluginId, target.connectionId, {
            repository: target.repository,
            number: target.number,
            head: target.head,
            anchor,
            ...(question === undefined ? {} : { question }),
          });
          if (!current()) return;
          if (asked.kind === "answer") {
            setState((state) => answerAsk(state, asked.text, asked.head));
            return;
          }
          setTurnId(asked.turn.id);
          return;
        } catch (error) {
          if (!current()) return;
          const consent =
            error instanceof AppApiError
              ? deckNeedsConsentSchema.safeParse(error.payload)
              : undefined;
          if (consent?.success && attempt === 0) {
            setAwaitingConsent(true);
            const answer = await requestConsent(consent.data);
            setAwaitingConsent(false);
            if (!current()) return;
            if (answer === true) continue;
            if (answer === false) {
              onClose();
              return;
            }
            setState((state) => failAsk(state, answer.error));
            return;
          }
          setState((state) =>
            failAsk(
              state,
              error instanceof Error
                ? error.message
                : "Ajour couldn't get more detail.",
            ),
          );
          return;
        }
      }
    },
    [anchor, onClose, requestConsent, target],
  );

  // Follows the running turn. Its events so far come first, so a remount
  // applies them again, which leaves the same state.
  const { head } = target;
  useEffect(() => {
    if (!turnId) return;
    return watchAgentTurn(turnId, (event) =>
      setState((state) => applyTurnEvent(state, event, head)),
    );
  }, [turnId, head]);

  if (awaitingConsent) return null;
  if (composing) {
    return (
      <AskQuestion
        id={id}
        onAsk={(question) => void ask(question)}
        onClose={onClose}
      />
    );
  }
  const going = askGoing(state);
  const text = askText(state);
  const stop = () => {
    if (turnId) void cancelAgentTurn(turnId).catch(() => undefined);
  };
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
          <Button variant="ghost" size="sm" onClick={stop} disabled={!turnId}>
            Stop
          </Button>
        ) : (
          <>
            <form
              className="deck-ask-form"
              onSubmit={(event) => {
                event.preventDefault();
                const question = draft.trim();
                if (!question) return;
                setDraft("");
                void ask(question);
              }}
            >
              <Input
                aria-label="Ask something else"
                placeholder="Ask something else…"
                value={draft}
                maxLength={DECK_QUESTION_MAX}
                onChange={(event) => setDraft(event.target.value)}
              />
            </form>
            {state.kind === "failed" ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void ask(state.question)}
              >
                Try again
              </Button>
            ) : null}
            <Button variant="ghost" size="sm" onClick={onClose}>
              Dismiss
            </Button>
          </>
        )}
      </div>
    </section>
  );
}

/**
 * The question an ask opens on: the default one, focused and selected, so
 * Enter sends it as is and typing replaces it. Escape closes the ask.
 */
function AskQuestion({
  id,
  onAsk,
  onClose,
}: {
  id: string;
  /** No question means the default one, so its answer is cached as such. */
  onAsk: (question?: string) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(DECK_CONCERN_DEFAULT_QUESTION);
  const field = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    field.current?.focus();
    field.current?.select();
  }, []);
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
        onChange={(event) => setDraft(event.target.value)}
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
      <div className="deck-ask-actions">
        <Button type="submit" variant="ghost" size="sm">
          Ask
        </Button>
      </div>
    </form>
  );
}
