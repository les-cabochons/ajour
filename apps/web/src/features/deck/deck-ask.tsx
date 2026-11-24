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
  type DeckCloneSource,
  type DeckNeedsConsent,
} from "@ajour/shared/deck";
import { Markdown } from "@/components/markdown";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  answerAsk,
  answerFooter,
  applyTurnEvent,
  askGoing,
  askText,
  failAsk,
  startAsk,
  stopAsk,
  withClone,
  type AskState,
} from "@/domain/deck/ask";
import { watchAgentTurn } from "@/lib/agent-turns";
import {
  AppApiError,
  askDeck,
  cancelAgentTurn,
  grantDeckConsent,
} from "@/lib/app-api";
import { DeckClonePicker, type DeckCloneTarget } from "./deck-clone-picker";
import { DeckConsentDialog } from "./deck-consent-dialog";

/*
 * Deck's quiet asks (#791): a faint `more ›` ends each concern's rationale.
 * It opens on the concern's default question, which Enter sends as is or as
 * edited; the answer streams in under the rationale, ending with the commit
 * it is about. The first ask in a repository opens the consent dialog.
 * Nothing names the agent. At rest a concern mounts one button and no
 * listener.
 *
 * When the code host says where the repository is cloned from, an ask can
 * read the user's local clone too (#795): its footer says so, says why it
 * couldn't, or offers to choose the clone.
 */

/** The pull request the page asks about, at the head it shows. */
export interface DeckAskTarget {
  pluginId: string;
  connectionId: string;
  repository: string;
  number: number;
  head: string;
  /** Where the repository is cloned from, from the pull request's facts. */
  clone?: DeckCloneSource;
}

interface DeckAskContextValue {
  target: DeckAskTarget;
  /** Opens the clone picker. Resolves true once a clone is chosen. */
  pickClone(): Promise<boolean>;
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
    () => ({ target, requestConsent, pickClone }),
    [target, requestConsent, pickClone],
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
  const { target, requestConsent, pickClone } = context;
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
  /**
   * Stops the ask before its turn starts, as while Ajour fetches the pull
   * request into the clone. Set while the ask's request runs.
   */
  const [starting, setStarting] = useState<AbortController>();

  const ask = useCallback(
    async (question?: string) => {
      const mine = ++generation.current;
      setComposing(false);
      setTurnId(undefined);
      setState(startAsk(question));
      const current = () => generation.current === mine;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const controller = new AbortController();
        setStarting(controller);
        try {
          const asked = await askDeck(
            target.pluginId,
            target.connectionId,
            {
              repository: target.repository,
              number: target.number,
              head: target.head,
              anchor,
              ...(question === undefined ? {} : { question }),
              ...(target.clone ? { clone: target.clone } : {}),
            },
            controller.signal,
          );
          setStarting((now) => (now === controller ? undefined : now));
          if (!current()) return;
          if (asked.kind === "answer") {
            setState((state) =>
              answerAsk(withClone(state, asked.clone), asked.text, asked.head),
            );
            return;
          }
          setState((state) => withClone(state, asked.clone));
          setTurnId(asked.turn.id);
          return;
        } catch (error) {
          setStarting((now) => (now === controller ? undefined : now));
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
    if (turnId) {
      void cancelAgentTurn(turnId).catch(() => undefined);
      return;
    }
    if (!starting) return;
    // Before its turn: the request stops, and git with it.
    generation.current += 1;
    starting.abort();
    setStarting(undefined);
    setState((state) => stopAsk(state));
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
        <AnswerFooter
          state={state}
          onChooseClone={() =>
            void pickClone().then((chosen) => {
              // Asked again, the answer reads the clone.
              if (chosen) void ask(state.question);
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
            onClick={stop}
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
 * The head the answer read, with `, and your clone` when it read the
 * user's clone too; why it couldn't, quietly; or the offer to choose one.
 */
function AnswerFooter({
  state,
  onChooseClone,
}: {
  state: Extract<AskState, { kind: "answered" }>;
  onChooseClone: () => void;
}) {
  const footer = answerFooter(state);
  return (
    <>
      <p className="deck-ask-footer">
        {footer.source}
        {footer.offersClone ? (
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
        <p className="deck-ask-footer">
          Your clone wasn't read: {footer.cloneReason}
        </p>
      ) : null}
    </>
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
      <Button type="submit" variant="ghost" size="sm">
        Ask
      </Button>
    </form>
  );
}
