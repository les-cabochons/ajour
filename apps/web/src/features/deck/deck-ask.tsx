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
  deckNeedsConsentSchema,
  type DeckAskAnchor,
  type DeckNeedsConsent,
} from "@ajour/shared/deck";
import { Markdown } from "@/components/markdown";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
 * It asks the concern's default question at once; the answer streams in
 * under the rationale, ending with the commit it is about, and accepts a
 * typed question in its place. The first ask in a repository opens the
 * consent dialog. Nothing names the agent. At rest a concern mounts one
 * button and no listener.
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
  /** Opens the consent dialog. Resolves true once the repository is allowed. */
  requestConsent(request: DeckNeedsConsent): Promise<boolean>;
}

const DeckAskContext = createContext<DeckAskContextValue | null>(null);

/** Gives the page's asks their pull request, and its one consent dialog. */
export function DeckAskProvider({
  target,
  children,
}: {
  target: DeckAskTarget;
  children: ReactNode;
}) {
  const [asking, setAsking] = useState<{
    request: DeckNeedsConsent;
    resolve: (allowed: boolean) => void;
  }>();
  const requestConsent = useCallback(
    (request: DeckNeedsConsent) =>
      new Promise<boolean>((resolve) =>
        setAsking((current) => {
          // A second ask while the dialog shows waits on the same answer.
          if (current) {
            const first = current.resolve;
            return {
              request,
              resolve: (allowed) => {
                first(allowed);
                resolve(allowed);
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
      await grantDeckConsent(
        target.pluginId,
        target.connectionId,
        current.request.repository,
      );
      current.resolve(true);
    } catch {
      current.resolve(false);
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
  const close = useCallback(() => setOpen(false), []);
  return (
    <>
      <p className="deck-concern-rationale">
        {rationale}
        {context ? (
          <>
            {rationale ? " " : null}
            <button
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

/** The answer of an open ask: it asks the default question once mounted. */
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
  const [state, setState] = useState<AskState>(() => startAsk());
  const [draft, setDraft] = useState("");
  /** The running turn, which Stop stops. */
  const [turnId, setTurnId] = useState<string>();
  /** Stops listening to the running turn's events. */
  const unwatch = useRef<(() => void) | undefined>(undefined);
  /** Counts the asks, so an answer for an earlier one is dropped. */
  const generation = useRef(0);

  const ask = useCallback(
    async (question?: string) => {
      const mine = ++generation.current;
      unwatch.current?.();
      unwatch.current = undefined;
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
          unwatch.current = watchAgentTurn(asked.turn.id, (event) => {
            if (!current()) return;
            setState((state) => applyTurnEvent(state, event, target.head));
          });
          return;
        } catch (error) {
          if (!current()) return;
          const consent =
            error instanceof AppApiError
              ? deckNeedsConsentSchema.safeParse(error.payload)
              : undefined;
          if (consent?.success && attempt === 0) {
            if (await requestConsent(consent.data)) {
              if (!current()) return;
              continue;
            }
            if (current()) onClose();
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

  // Opening asks the default question, once.
  const asked = useRef(false);
  useEffect(() => {
    if (asked.current) return;
    asked.current = true;
    void ask();
  }, [ask]);
  // A closed answer stops listening; its turn ends on its own and is cached.
  useEffect(
    () => () => {
      generation.current += 1;
      unwatch.current?.();
    },
    [],
  );

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
                maxLength={2000}
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
