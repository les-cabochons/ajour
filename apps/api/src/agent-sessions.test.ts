import { describe, expect, it } from "vitest";
import { createRecordingSink } from "../../../packages/wide-events/sinks.ts";
import {
  AgentSessions,
  AgentSessionError,
  sessionWindowMs,
} from "./agent-sessions.ts";
import { createApiEvents } from "./events.ts";

const MINUTE = 60_000;
const claude = { id: "c1", name: "Claude Code" };
const codex = { id: "c2", name: "Codex" };

function createSessions() {
  let now = 0;
  let next = 0;
  const sink = createRecordingSink();
  const sessions = new AgentSessions({
    now: () => now,
    createId: () => `id-${(next += 1)}`,
    events: createApiEvents({ sink, userDataPath: "ajour", now: () => now }),
  });
  return {
    sessions,
    recorded: sink.events,
    advance: (ms: number) => (now += ms),
    now: () => now,
  };
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

  it("dismisses a session, withdraws its question and wakes the waiter", async () => {
    const { sessions, recorded } = createSessions();
    const session = sessions.begin(claude, {
      title: "Work",
      estimateMinutes: 5,
    });
    const question = sessions.ask(claude, {
      question: "Ok?",
      sessionId: session.id,
    });
    const waiting = sessions.waitForAnswer(claude, question.id, 60_000);

    const dismissed = sessions.dismiss(session.id);

    expect(dismissed.state).toBe("cancelled");
    expect(sessions.snapshot().openQuestions).toEqual([]);
    await expect(waiting).resolves.toEqual({ status: "withdrawn" });
    expect(recorded).toEqual([
      expect.objectContaining({
        name: "agent.session",
        outcome: "cancelled",
        outcome_reason: "dismissed",
      }),
    ]);
  });

  it("refuses to dismiss an unknown or an ended session", () => {
    const { sessions } = createSessions();
    const session = sessions.begin(claude, {
      title: "Work",
      estimateMinutes: 5,
    });
    sessions.dismiss(session.id);

    expect(() => sessions.dismiss(session.id)).toThrow(AgentSessionError);
    expect(() => sessions.dismiss("nope")).toThrow(AgentSessionError);
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
        outcome: "ok",
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

describe("runner sessions", () => {
  it("keeps a run ID and a link on a session the runner begins", () => {
    const { sessions } = createSessions();
    const session = sessions.begin(
      claude,
      { title: "Enter in Workday, week of Oct 12", estimateMinutes: 10 },
      {
        runId: "run-1",
        link: {
          label: "Open the week in Workday",
          url: "https://wd.example/t",
        },
      },
    );
    expect(sessions.get(session.id)).toMatchObject({
      runId: "run-1",
      link: { url: "https://wd.example/t" },
    });
  });

  it("names the run in agent.session for a session the runner began", () => {
    const { sessions, advance, recorded } = createSessions();
    const runSession = sessions.begin(
      claude,
      { title: "Enter in Workday, week of Oct 12", estimateMinutes: 10 },
      { runId: "run-1" },
    );
    const ownSession = sessions.begin(codex, {
      title: "Fill Workday",
      estimateMinutes: 10,
    });
    advance(3 * MINUTE);
    sessions.end(claude, {
      sessionId: runSession.id,
      outcome: "done",
      summary: "Entered 9 lines.",
    });
    sessions.end(codex, {
      sessionId: ownSession.id,
      outcome: "done",
      summary: "Done.",
    });
    expect(recorded).toEqual([
      expect.objectContaining({
        name: "agent.session",
        kind: "job",
        trigger: "agent",
        outcome: "ok",
        duration_ms: 3 * MINUTE,
        agent: {
          client_id: "c1",
          session_id: runSession.id,
          run_id: "run-1",
          update_count: 0,
          question_count: 0,
          stall_count: 0,
        },
      }),
      expect.objectContaining({
        name: "agent.session",
        outcome: "ok",
        duration_ms: 3 * MINUTE,
        agent: {
          client_id: "c2",
          session_id: ownSession.id,
          update_count: 0,
          question_count: 0,
          stall_count: 0,
        },
      }),
    ]);
  });

  it("counts a session's updates, questions and stalls, never what they say", () => {
    const { sessions, advance, recorded } = createSessions();
    const session = sessions.begin(claude, {
      title: "Fill Workday",
      estimateMinutes: 2,
    });
    advance(3 * MINUTE);
    sessions.tick();
    sessions.update(claude, { sessionId: session.id, message: "Line 3 of 9" });
    // The update revived it for 5 minutes plus 25%.
    advance(7 * MINUTE);
    sessions.tick();
    sessions.ask(claude, {
      question: "Which project for Globex?",
      sessionId: session.id,
    });
    sessions.end(claude, {
      sessionId: session.id,
      outcome: "failed",
      summary: "Globex is not in Ajour.",
    });

    expect(recorded).toEqual([
      expect.objectContaining({
        outcome: "error",
        agent: expect.objectContaining({
          update_count: 1,
          question_count: 1,
          stall_count: 2,
        }),
      }),
    ]);
    expect(JSON.stringify(recorded)).not.toMatch(/Workday|Line 3|Globex/);
  });
});
