import { describe, expect, it } from "vitest";
import {
  AgentSessions,
  AgentSessionError,
  sessionWindowMs,
} from "./agent-sessions.ts";

const MINUTE = 60_000;
const claude = { id: "c1", name: "Claude Code" };
const codex = { id: "c2", name: "Codex" };

function createSessions() {
  let now = 0;
  let next = 0;
  const sessions = new AgentSessions({
    now: () => now,
    createId: () => `id-${(next += 1)}`,
  });
  return { sessions, advance: (ms: number) => (now += ms), now: () => now };
}

describe("session deadlines", () => {
  it("adds 25% to the estimate, at least 2 minutes and at most 4 hours", () => {
    expect(sessionWindowMs(10)).toBe(12.5 * MINUTE);
    expect(sessionWindowMs(1)).toBe(2 * MINUTE);
    expect(sessionWindowMs(600)).toBe(240 * MINUTE);
  });

  it("stalls past the deadline and comes back on the next update", () => {
    const { sessions, advance, now } = createSessions();
    const session = sessions.begin(claude, {
      title: "Fill Workday",
      estimateMinutes: 10,
    });

    advance(13 * MINUTE);
    sessions.tick();
    expect(sessions.snapshot().sessions[0]?.state).toBe("stalled");

    sessions.update(claude, { sessionId: session.id, message: "Still going" });
    const revived = sessions.snapshot().sessions[0]!;
    expect(revived.state).toBe("active");
    expect(revived.deadlineAt).toBe(now() + sessionWindowMs(5));
  });

  it("pauses the deadline while a question is open", () => {
    const { sessions, advance, now } = createSessions();
    const session = sessions.begin(claude, {
      title: "Fill Workday",
      estimateMinutes: 10,
    });
    advance(5 * MINUTE);
    const question = sessions.ask(claude, {
      question: "Which project?",
      sessionId: session.id,
    });

    advance(60 * MINUTE);
    sessions.tick();
    expect(sessions.snapshot().sessions[0]?.state).toBe("active");

    sessions.answer(question.id, "Acme");
    expect(sessions.snapshot().sessions[0]?.deadlineAt).toBe(
      now() + 7.5 * MINUTE,
    );
  });
});

describe("questions", () => {
  it("returns the answer to a waiting agent", async () => {
    const { sessions } = createSessions();
    const question = sessions.ask(claude, { question: "Which project?" });
    const waiting = sessions.waitForAnswer(claude, question.id, 1000);
    sessions.answer(question.id, "Acme");
    await expect(waiting).resolves.toEqual({
      status: "answered",
      answer: "Acme",
    });
  });

  it("says still waiting when nobody answers in time", async () => {
    const { sessions } = createSessions();
    const question = sessions.ask(claude, { question: "Which project?" });
    await expect(
      sessions.waitForAnswer(claude, question.id, 10),
    ).resolves.toEqual({
      status: "waiting",
    });
  });

  it("withdraws a question when its session ends", async () => {
    const { sessions } = createSessions();
    const session = sessions.begin(claude, {
      title: "Work",
      estimateMinutes: 5,
    });
    const question = sessions.ask(claude, {
      question: "Ok?",
      sessionId: session.id,
    });

    sessions.end(claude, {
      sessionId: session.id,
      outcome: "cancelled",
      summary: "Stopped",
    });

    expect(sessions.snapshot().openQuestions).toEqual([]);
    await expect(
      sessions.waitForAnswer(claude, question.id, 10),
    ).resolves.toEqual({
      status: "withdrawn",
    });
  });
});

describe("ownership and activity", () => {
  it("keeps one client out of another client's session", () => {
    const { sessions } = createSessions();
    const session = sessions.begin(claude, {
      title: "Work",
      estimateMinutes: 5,
    });
    expect(() =>
      sessions.update(codex, { sessionId: session.id, message: "Hi" }),
    ).toThrow(AgentSessionError);
  });

  it("files a write under the client's open session and keeps 200 events", () => {
    const { sessions } = createSessions();
    const session = sessions.begin(claude, {
      title: "Work",
      estimateMinutes: 5,
    });
    for (let index = 0; index < 205; index += 1) {
      sessions.recordActivity(claude, {
        tool: "start_timer",
        action: "Started an entry",
        objectId: `t${index}`,
        objectTitle: "Acme · Build",
      });
    }
    const { activity } = sessions.snapshot();
    expect(activity).toHaveLength(200);
    expect(activity[0]).toMatchObject({
      objectId: "t204",
      sessionId: session.id,
    });
  });
});
