import { randomUUID } from "node:crypto";
import type {
  AgentActivity,
  AgentClientRef,
  AgentError,
  AgentQuestion,
  AgentSession,
  AgentSessionOutcome,
  AgentsSnapshot,
  OpenAgentQuestion,
} from "../../../packages/shared/agent-tools.ts";

/**
 * Agent sessions, questions, the activity list and recent errors. All of it
 * lives in memory: restarting Ajour clears it. See the spec's "Sessions and
 * questions" section for the deadline rules.
 */

const MINUTE = 60_000;
const DEADLINE_MARGIN = 1.25;
const MIN_WINDOW_MS = 2 * MINUTE;
const MAX_WINDOW_MS = 4 * 60 * MINUTE;
/** The window a stalled session gets back when it reports again. */
const REVIVAL_MINUTES = 5;
const MAX_ENDED_SESSIONS = 50;
const MAX_ACTIVITY = 200;
const MAX_ERRORS = 50;

/** An estimate plus 25%, at least 2 minutes and at most 4 hours. */
export function sessionWindowMs(minutes: number) {
  return Math.min(
    MAX_WINDOW_MS,
    Math.max(MIN_WINDOW_MS, Math.round(minutes * MINUTE * DEADLINE_MARGIN)),
  );
}

/** A session or question call Ajour refuses. The message goes to the agent. */

/** An activity entry as a tool call reports it, before Ajour files it. */
export type AgentActivityEntry = AgentActivity extends infer Entry
  ? Entry extends AgentActivity
    ? Omit<Entry, "at" | "client" | "sessionId">
    : never
  : never;

export class AgentSessionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentSessionError";
  }
}

export type WaitForAnswerResult =
  | { status: "answered"; answer: string }
  | { status: "waiting" }
  | { status: "withdrawn" };

interface AgentSessionsOptions {
  now?: () => number;
  createId?: () => string;
  /** Runs after every change, to publish the snapshot. */
  onChange?: () => void;
  /** Runs once when a session ends, for the `mcp.session_ended` event. */
  onEnded?: (session: AgentSession) => void;
}

const isOpen = (session: AgentSession) =>
  session.state === "active" || session.state === "stalled";
const isOpenQuestion = (
  question: AgentQuestion,
): question is OpenAgentQuestion => question.status === "open";

export class AgentSessions {
  private readonly options: AgentSessionsOptions;
  private readonly sessions = new Map<string, AgentSession>();
  private readonly questions = new Map<string, AgentQuestion>();
  private readonly waiters = new Map<string, Set<() => void>>();
  private activity: AgentActivity[] = [];
  private errors: AgentError[] = [];
  private seenAt = 0;

  constructor(options: AgentSessionsOptions = {}) {
    this.options = options;
  }

  begin(
    client: AgentClientRef,
    input: { title: string; estimateMinutes: number },
    extra: Pick<AgentSession, "runId" | "link"> = {},
  ): AgentSession {
    const now = this.now();
    const session: AgentSession = {
      id: this.createId(),
      client,
      title: input.title,
      state: "active",
      startedAt: now,
      deadlineAt: now + sessionWindowMs(input.estimateMinutes),
      messages: [],
      ...(extra.runId ? { runId: extra.runId } : {}),
      ...(extra.link ? { link: extra.link } : {}),
    };
    this.sessions.set(session.id, session);
    this.pruneSessions();
    this.changed();
    return session;
  }

  /** A session by ID, open or ended, while Ajour still keeps it. */
  get(sessionId: string): AgentSession | undefined {
    return this.sessions.get(sessionId);
  }

  update(
    client: AgentClientRef,
    input: { sessionId: string; message: string; extraMinutes?: number },
  ): AgentSession {
    const session = this.openSession(client, input.sessionId);
    const now = this.now();
    session.messages.push({ kind: "update", at: now, text: input.message });
    if (session.state === "stalled") {
      this.revive(session, input.extraMinutes ?? REVIVAL_MINUTES);
    } else if (input.extraMinutes !== undefined) {
      const extra = sessionWindowMs(input.extraMinutes);
      if (session.pausedRemainingMs !== undefined) {
        session.pausedRemainingMs += extra;
      } else {
        session.deadlineAt = Math.max(session.deadlineAt ?? now, now) + extra;
      }
    }
    this.changed();
    return session;
  }

  end(
    client: AgentClientRef,
    input: {
      sessionId: string;
      outcome: AgentSessionOutcome;
      summary: string;
    },
  ): AgentSession {
    const session = this.openSession(client, input.sessionId);
    this.finish(session, input.outcome, input.summary);
    return session;
  }

  /**
   * The user clears a session from the panel, for an agent that died without
   * ending it. It ends as cancelled and its open questions are withdrawn.
   */
  dismiss(sessionId: string): AgentSession {
    const session = this.sessions.get(sessionId);
    if (!session || !isOpen(session)) {
      throw new AgentSessionError("This session is no longer open.");
    }
    this.finish(session, "cancelled", "Dismissed by the user.");
    return session;
  }

  ask(
    client: AgentClientRef,
    input: { question: string; choices?: string[]; sessionId?: string },
  ): AgentQuestion {
    const now = this.now();
    const session = input.sessionId
      ? this.openSession(client, input.sessionId)
      : undefined;
    const question: AgentQuestion = {
      status: "open",
      id: this.createId(),
      client,
      ...(session ? { sessionId: session.id } : {}),
      text: input.question,
      ...(input.choices ? { choices: input.choices } : {}),
      askedAt: now,
    };
    if (session) {
      if (session.state === "stalled") this.revive(session, REVIVAL_MINUTES);
      if (session.pausedRemainingMs === undefined) {
        session.pausedRemainingMs = Math.max(
          0,
          (session.deadlineAt ?? now) - now,
        );
        session.deadlineAt = undefined;
      }
      session.messages.push({
        kind: "question",
        at: now,
        questionId: question.id,
        text: question.text,
        ...(question.choices ? { choices: question.choices } : {}),
      });
    }
    this.questions.set(question.id, question);
    this.changed();
    return question;
  }

  /** The user's answer, from the agent panel. */
  answer(questionId: string, text: string): AgentQuestion {
    const question = this.questions.get(questionId);
    if (!question || !isOpenQuestion(question)) {
      throw new AgentSessionError("This question is no longer open.");
    }
    const now = this.now();
    const answered: AgentQuestion = {
      ...question,
      status: "answered",
      answer: text,
      answeredAt: now,
    };
    this.questions.set(questionId, answered);
    const session = question.sessionId
      ? this.sessions.get(question.sessionId)
      : undefined;
    if (session) {
      session.messages.push({ kind: "answer", at: now, questionId, text });
      const stillWaiting = [...this.questions.values()].some(
        (other) => other.sessionId === session.id && isOpenQuestion(other),
      );
      if (!stillWaiting && session.pausedRemainingMs !== undefined) {
        session.deadlineAt = now + session.pausedRemainingMs;
        session.pausedRemainingMs = undefined;
      }
    }
    this.wake(questionId);
    this.changed();
    return answered;
  }

  /** Holds until the question is answered or withdrawn, or `timeoutMs` passes. */
  async waitForAnswer(
    client: AgentClientRef,
    questionId: string,
    timeoutMs: number,
  ): Promise<WaitForAnswerResult> {
    const question = this.questions.get(questionId);
    if (!question || question.client.id !== client.id) {
      throw new AgentSessionError(`No question has the id ${questionId}.`);
    }
    if (isOpenQuestion(question)) {
      await new Promise<void>((resolve) => {
        const waiters = this.waiters.get(questionId) ?? new Set();
        const done = () => {
          clearTimeout(timer);
          waiters.delete(done);
          resolve();
        };
        const timer = setTimeout(done, timeoutMs);
        waiters.add(done);
        this.waiters.set(questionId, waiters);
      });
    }
    // An answer or a withdrawal replaces the question in the map.
    const current = this.questions.get(questionId) ?? question;
    switch (current.status) {
      case "answered":
        return { status: "answered", answer: current.answer };
      case "withdrawn":
        return { status: "withdrawn" };
      case "open":
        return { status: "waiting" };
    }
  }

  /** Marks active sessions past their deadline as stalled. */
  tick() {
    const now = this.now();
    let changed = false;
    for (const session of this.sessions.values()) {
      if (
        session.state === "active" &&
        session.deadlineAt !== undefined &&
        now > session.deadlineAt
      ) {
        session.state = "stalled";
        changed = true;
      }
    }
    if (changed) this.changed();
  }

  /** The client's newest open session, which its writes are filed under. */
  currentSessionId(client: AgentClientRef): string | undefined {
    return [...this.sessions.values()]
      .reverse()
      .find(
        (candidate) => candidate.client.id === client.id && isOpen(candidate),
      )?.id;
  }

  /** Files an agent write under the client's newest open session, if any. */
  recordActivity(client: AgentClientRef, entry: AgentActivityEntry) {
    const sessionId = this.currentSessionId(client);
    this.activity = [
      {
        at: this.now(),
        client,
        ...(sessionId ? { sessionId } : {}),
        ...entry,
      },
      ...this.activity,
    ].slice(0, MAX_ACTIVITY);
    this.changed();
  }

  recordError(message: string, client?: AgentClientRef) {
    this.errors = [
      { at: this.now(), ...(client ? { client } : {}), message },
      ...this.errors,
    ].slice(0, MAX_ERRORS);
    this.changed();
  }

  /** The user opened the panel: earlier errors and failures are seen. */
  markSeen() {
    this.seenAt = this.now();
    this.changed();
  }

  snapshot(): AgentsSnapshot {
    return {
      sessions: [...this.sessions.values()].reverse(),
      openQuestions: [...this.questions.values()]
        .filter(isOpenQuestion)
        .reverse(),
      activity: this.activity,
      errors: this.errors,
      seenAt: this.seenAt,
    };
  }

  /** Releases waiting agents when the API stops. */
  close() {
    for (const questionId of this.waiters.keys()) this.wake(questionId);
  }

  private openSession(client: AgentClientRef, sessionId: string) {
    const session = this.sessions.get(sessionId);
    if (!session || session.client.id !== client.id || !isOpen(session)) {
      throw new AgentSessionError(
        `No open session has the id ${sessionId}. Call begin_session.`,
      );
    }
    return session;
  }

  /** Ends an open session and releases the agents waiting on its questions. */
  private finish(
    session: AgentSession,
    outcome: AgentSessionOutcome,
    summary: string,
  ) {
    const now = this.now();
    session.state = outcome;
    session.endedAt = now;
    session.deadlineAt = undefined;
    session.pausedRemainingMs = undefined;
    session.messages.push({ kind: "end", at: now, outcome, summary });
    for (const question of this.questions.values()) {
      if (question.sessionId === session.id && isOpenQuestion(question)) {
        this.questions.set(question.id, { ...question, status: "withdrawn" });
        this.wake(question.id);
      }
    }
    this.options.onEnded?.(session);
    this.changed();
  }

  private revive(session: AgentSession, minutes: number) {
    session.state = "active";
    session.deadlineAt = this.now() + sessionWindowMs(minutes);
  }

  private wake(questionId: string) {
    for (const done of this.waiters.get(questionId) ?? []) done();
    this.waiters.delete(questionId);
  }

  private pruneSessions() {
    const ended = [...this.sessions.values()].filter(
      (session) => !isOpen(session),
    );
    for (const session of ended.slice(
      0,
      Math.max(0, ended.length - MAX_ENDED_SESSIONS),
    )) {
      this.sessions.delete(session.id);
      for (const [questionId, question] of this.questions) {
        if (question.sessionId === session.id)
          this.questions.delete(questionId);
      }
    }
  }

  private now() {
    return (this.options.now ?? Date.now)();
  }

  private createId() {
    return (this.options.createId ?? randomUUID)();
  }

  private changed() {
    this.options.onChange?.();
  }
}
