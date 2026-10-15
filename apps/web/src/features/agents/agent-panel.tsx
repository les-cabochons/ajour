import { useEffect, useState, type ReactNode } from "react";
import { RiCloseLine } from "@remixicon/react";
import type {
  AgentQuestion,
  AgentSession,
  AgentsSnapshot,
} from "@ajour/shared/agent-tools";
import { SidePanel } from "@/components/side-panel";
import { TooltipButton } from "@/components/tooltip-button";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Value } from "@/components/ui/value";
import {
  describeSessionTimeLeft,
  pickDefaultSession,
} from "@/domain/agents/agent-sessions";
import { useIsNarrowView } from "@/lib/use-narrow-view";
import { useNow } from "@/lib/use-now";
import { cn } from "@/lib/utils";

/**
 * The agent panel: sessions with their chats, open questions, and an activity
 * and errors tab. It knows nothing about MCP. The caller gives it the data and
 * the actions, so later LLM plugins can reuse it. In a wide window it is
 * a docked side panel and the page stays usable; in a narrow window it is an
 * overlay that opens from the bottom.
 */

export interface AgentPanelProps {
  snapshot: AgentsSnapshot | null;
  open: boolean;
  onOpenChange(open: boolean): void;
  /** Sends the answer. A rejection shows its message under the question. */
  onAnswer(questionId: string, text: string): Promise<void>;
  /** Ends a session the agent left behind. A rejection shows its message. */
  onDismiss(sessionId: string): Promise<void>;
  /** Stops a run Ajour started. A rejection shows its message. */
  onStop(runId: string): Promise<void>;
  /**
   * The run the API still reports as going. A runner session keeps its Stop
   * button while its run is current, even after the session ended, because
   * the agent CLI can outlive its session.
   */
  currentRunId?: string | null;
  /** Runs each time the panel opens, to mark past errors and failures seen. */
  onSeen(): void;
}

function Time({ at }: { at: number }) {
  return (
    <Value tone="muted">
      {new Date(at).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      })}
    </Value>
  );
}

function QuestionForm({
  question,
  onAnswer,
}: {
  question: AgentQuestion;
  onAnswer: AgentPanelProps["onAnswer"];
}) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const send = async (answer: string) => {
    setError(null);
    try {
      await onAnswer(question.id, answer);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unknown error");
    }
  };

  return (
    <div className="flex flex-col gap-2 rounded-[var(--radius-md)] border border-warning p-3">
      <p className="text-sm">
        <span className="font-medium">{question.client.name}</span> asks:{" "}
        {question.text}
      </p>
      {question.choices ? (
        <div className="flex flex-wrap gap-2">
          {question.choices.map((choice) => (
            <Button
              key={choice}
              variant="outline"
              size="sm"
              onClick={() => void send(choice)}
            >
              {choice}
            </Button>
          ))}
        </div>
      ) : null}
      <form
        className="flex flex-col gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (text.trim()) void send(text.trim());
        }}
      >
        <Textarea
          aria-label="Your answer"
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
        <Button type="submit" size="sm" disabled={!text.trim()}>
          Send
        </Button>
      </form>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}

/** Ends a session from the panel: Dismiss for a lost agent, Stop for a run. */
function EndSessionButton({
  label,
  onEnd,
}: {
  label: "Dismiss" | "Stop";
  onEnd: () => Promise<void>;
}) {
  const [error, setError] = useState<string | null>(null);
  const end = async () => {
    setError(null);
    try {
      await onEnd();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unknown error");
    }
  };
  return (
    <div className="flex flex-col gap-1">
      <Button
        variant="outline"
        size="sm"
        className="self-start"
        onClick={() => void end()}
      >
        {label}
      </Button>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}

/**
 * A session's updates and answers. An open question shows as a form instead.
 * A runner session shows Stop while open or while its run is still current,
 * and its link once ended. Other
 * stalled sessions, or ones with an open question, can be dismissed.
 */
function SessionChat({
  session,
  questions,
  onAnswer,
  onDismiss,
  onStop,
  currentRunId,
}: {
  session: AgentSession;
  questions: AgentQuestion[];
  onAnswer: AgentPanelProps["onAnswer"];
  onDismiss: AgentPanelProps["onDismiss"];
  onStop: AgentPanelProps["onStop"];
  currentRunId: string | null | undefined;
}) {
  const openIds = new Set(questions.map((question) => question.id));
  const open = session.state === "active" || session.state === "stalled";
  const runId = session.runId;
  const dismissable =
    !runId && (session.state === "stalled" || questions.length > 0);
  return (
    <div className="flex flex-col gap-2" aria-label={`${session.title} chat`}>
      <ol className="flex flex-col gap-1 text-sm">
        {session.messages
          .filter(
            (message) =>
              message.kind !== "question" || !openIds.has(message.questionId),
          )
          .map((message, index) => (
            <li key={index} className="flex gap-2">
              <Time at={message.at} />
              <span>
                {message.kind === "update" && message.text}
                {message.kind === "question" && `Asked: ${message.text}`}
                {message.kind === "answer" && `You answered: ${message.text}`}
                {message.kind === "end" &&
                  `Ended ${message.outcome}: ${message.summary}`}
              </span>
            </li>
          ))}
      </ol>
      {questions.map((question) => (
        <QuestionForm
          key={question.id}
          question={question}
          onAnswer={onAnswer}
        />
      ))}
      {runId && (open || runId === currentRunId) ? (
        <EndSessionButton label="Stop" onEnd={() => onStop(runId)} />
      ) : dismissable ? (
        <EndSessionButton label="Dismiss" onEnd={() => onDismiss(session.id)} />
      ) : null}
      {!open && session.link ? (
        <a
          href={session.link.url}
          target="_blank"
          rel="noreferrer"
          className="self-start text-sm underline"
        >
          {session.link.label}
        </a>
      ) : null}
    </div>
  );
}

function SessionRow({
  session,
  selected,
  now,
  onSelect,
}: {
  session: AgentSession;
  selected: boolean;
  now: number;
  onSelect: () => void;
}) {
  const timeLeft = describeSessionTimeLeft(session, now);
  return (
    <button
      type="button"
      aria-current={selected ? "true" : undefined}
      onClick={onSelect}
      className={cn(
        "flex w-full flex-col gap-0.5 border-b border-border px-2 py-1.5 text-left text-sm hover:bg-accent",
        selected && "bg-accent",
      )}
    >
      <span className="truncate font-medium">{session.title}</span>
      <span className="truncate text-xs text-muted-foreground">
        {[session.client.name, session.state, timeLeft]
          .filter(Boolean)
          .join(" · ")}
      </span>
    </button>
  );
}

function AgentPanelTabs({
  snapshot,
  onAnswer,
  onDismiss,
  onStop,
  currentRunId,
}: Pick<
  AgentPanelProps,
  "snapshot" | "onAnswer" | "onDismiss" | "onStop" | "currentRunId"
>) {
  const now = useNow();
  const [chosenId, setChosenId] = useState<string>();
  const sessions = snapshot?.sessions ?? [];
  const questions = snapshot?.openQuestions ?? [];

  // Until the user picks one, show the session that waits for an answer.
  const selectedId = sessions.some((session) => session.id === chosenId)
    ? chosenId
    : pickDefaultSession(sessions, questions);
  const selected = sessions.find((session) => session.id === selectedId);
  const sessionIds = new Set(sessions.map((session) => session.id));
  const lone = questions.filter(
    (question) => !question.sessionId || !sessionIds.has(question.sessionId),
  );

  return (
    <Tabs defaultValue="sessions" className="flex min-h-0 flex-1 flex-col">
      <TabsList>
        <TabsTrigger value="sessions">Sessions</TabsTrigger>
        <TabsTrigger value="activity">Activity</TabsTrigger>
      </TabsList>
      <TabsContent
        value="sessions"
        className="flex flex-col gap-3 overflow-y-auto"
      >
        {lone.map((question) => (
          <QuestionForm
            key={question.id}
            question={question}
            onAnswer={onAnswer}
          />
        ))}
        {sessions.length === 0 && lone.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No agent sessions yet.
          </p>
        ) : null}
        {sessions.length > 0 ? (
          <div className="flex flex-col border-t border-border">
            {sessions.map((session) => (
              <SessionRow
                key={session.id}
                session={session}
                selected={session.id === selectedId}
                now={now}
                onSelect={() => setChosenId(session.id)}
              />
            ))}
          </div>
        ) : null}
        {selected ? (
          <SessionChat
            session={selected}
            questions={questions.filter(
              (question) => question.sessionId === selected.id,
            )}
            onAnswer={onAnswer}
            onDismiss={onDismiss}
            onStop={onStop}
            currentRunId={currentRunId}
          />
        ) : null}
      </TabsContent>
      <TabsContent
        value="activity"
        className="flex flex-col gap-1 overflow-y-auto text-sm"
      >
        {(snapshot?.errors ?? []).map((error, index) => (
          <p key={index} className="text-destructive">
            <Time at={error.at} />{" "}
            {error.client ? `${error.client.name}: ` : ""}
            {error.message}
          </p>
        ))}
        {(snapshot?.activity ?? []).map((entry, index) =>
          entry.outcome === "ok" ? (
            <p key={index}>
              <Time at={entry.at} /> {entry.client.name}: {entry.action} ·{" "}
              {entry.objectTitle}
            </p>
          ) : (
            <p key={index} className="text-muted-foreground">
              <Time at={entry.at} /> {entry.client.name}: Ajour refused{" "}
              {entry.tool} · {entry.reason}
            </p>
          ),
        )}
        {!snapshot?.errors.length && !snapshot?.activity.length ? (
          <p className="text-muted-foreground">Nothing yet.</p>
        ) : null}
      </TabsContent>
    </Tabs>
  );
}

export function AgentPanel({
  snapshot,
  open,
  onOpenChange,
  onAnswer,
  onDismiss,
  onStop,
  currentRunId,
  onSeen,
}: AgentPanelProps) {
  const narrow = useIsNarrowView();

  useEffect(() => {
    if (open) onSeen();
  }, [open, onSeen]);

  const tabs: ReactNode = (
    <AgentPanelTabs
      snapshot={snapshot}
      onAnswer={onAnswer}
      onDismiss={onDismiss}
      onStop={onStop}
      currentRunId={currentRunId}
    />
  );

  if (narrow) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="bottom"
          className="flex max-h-[85dvh] flex-col gap-3 p-4 pb-[calc(1rem+env(safe-area-inset-bottom,0px))]"
        >
          <SheetHeader className="p-0">
            <SheetTitle>Agents</SheetTitle>
          </SheetHeader>
          {tabs}
        </SheetContent>
      </Sheet>
    );
  }

  if (!open) return null;
  return (
    // The bottom padding keeps the last row clear of the corner indicator.
    <SidePanel
      contentKey="agents"
      widthKey="agents"
      aria-label="Agents"
      contentClassName="flex flex-col gap-3 pb-14"
      onKeyDown={(event) => {
        if (event.key === "Escape") onOpenChange(false);
      }}
    >
      <header className="flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold">Agents</h2>
        <TooltipButton
          label="Close agents"
          render={
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onOpenChange(false)}
            />
          }
        >
          <RiCloseLine />
        </TooltipButton>
      </header>
      {tabs}
    </SidePanel>
  );
}
