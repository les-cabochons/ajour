import { useEffect, useState } from "react";
import type { AgentQuestion, AgentSession } from "@ajour/shared/agent-tools";
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
import { answerAgentQuestion, markAgentsSeen } from "@/lib/app-api";
import { useIsNarrowView } from "@/lib/use-narrow-view";
import { cn } from "@/lib/utils";
import {
  closeAgentPanel,
  setAgentsSnapshot,
  useAgentBridgeState,
} from "@/features/agents/agent-bridge-state";

/**
 * The agent panel: sessions as chats, open questions, the activity list and
 * errors. It takes sessions as generic data, so later LLM plugins can reuse it.
 * It opens from the right in a wide window and from the bottom in a narrow one.
 */

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

function QuestionForm({ question }: { question: AgentQuestion }) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const send = async (answer: string) => {
    setError(null);
    try {
      setAgentsSnapshot(await answerAgentQuestion(question.id, answer));
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

function SessionChat({ session }: { session: AgentSession }) {
  return (
    <ol className="flex flex-col gap-1 text-sm">
      {session.messages.map((message, index) => (
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
  );
}

export function AgentPanel() {
  const { snapshot, panelOpen } = useAgentBridgeState();
  const narrow = useIsNarrowView();

  // Opening the panel marks earlier errors and failures as seen.
  useEffect(() => {
    if (!panelOpen) return;
    void markAgentsSeen()
      .then(setAgentsSnapshot)
      .catch(() => undefined);
  }, [panelOpen]);

  const sessions = snapshot?.sessions ?? [];
  const questions = snapshot?.openQuestions ?? [];
  const sessionIds = new Set(sessions.map((session) => session.id));
  // A question shows under its session, or on its own when it has none.
  const loneQuestions = questions.filter(
    (question) => !question.sessionId || !sessionIds.has(question.sessionId),
  );

  return (
    <Sheet
      open={panelOpen}
      onOpenChange={(open) => (open ? undefined : closeAgentPanel())}
    >
      <SheetContent
        side={narrow ? "bottom" : "right"}
        className={cn(
          "flex flex-col gap-3 p-4",
          narrow &&
            "max-h-[85dvh] pb-[calc(1rem+env(safe-area-inset-bottom,0px))]",
        )}
      >
        <SheetHeader className="p-0">
          <SheetTitle>Agents</SheetTitle>
        </SheetHeader>
        <Tabs defaultValue="sessions" className="flex min-h-0 flex-1 flex-col">
          <TabsList>
            <TabsTrigger value="sessions">Sessions</TabsTrigger>
            <TabsTrigger value="activity">Activity</TabsTrigger>
          </TabsList>
          <TabsContent
            value="sessions"
            className="flex flex-col gap-3 overflow-y-auto"
          >
            {loneQuestions.map((question) => (
              <QuestionForm key={question.id} question={question} />
            ))}
            {sessions.length === 0 && questions.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No agent sessions yet.
              </p>
            ) : null}
            {sessions.map((session) => (
              <section key={session.id} className="flex flex-col gap-2">
                <header className="flex items-baseline justify-between gap-2">
                  <h3 className="text-sm font-medium">{session.title}</h3>
                  <span className="text-xs text-muted-foreground">
                    {session.client.name} · {session.state}
                  </span>
                </header>
                <SessionChat session={session} />
                {questions
                  .filter((question) => question.sessionId === session.id)
                  .map((question) => (
                    <QuestionForm key={question.id} question={question} />
                  ))}
              </section>
            ))}
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
            {(snapshot?.activity ?? []).map((entry, index) => (
              <p key={index}>
                <Time at={entry.at} /> {entry.client.name}: {entry.action} ·{" "}
                {entry.objectTitle}
              </p>
            ))}
            {!snapshot?.errors.length && !snapshot?.activity.length ? (
              <p className="text-muted-foreground">Nothing yet.</p>
            ) : null}
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}
