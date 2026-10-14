import { describe, expect, it } from "vitest";
import type { AgentQuestion, AgentSession } from "@ajour/shared/agent-tools";
import {
  describeSessionTimeLeft,
  pickDefaultSession,
} from "@/domain/agents/agent-sessions";

const client = { id: "c1", name: "Claude Code" };
const MINUTE = 60_000;
const session = (
  id: string,
  startedAt: number,
  patch: Partial<AgentSession> = {},
): AgentSession => ({
  id,
  client,
  title: id,
  state: "active",
  startedAt,
  messages: [],
  ...patch,
});
const question = (sessionId?: string): AgentQuestion => ({
  id: "q",
  client,
  text: "Which?",
  askedAt: 1,
  ...(sessionId ? { sessionId } : {}),
});

describe("session time left", () => {
  const now = 1_000_000;
  const left = (patch: Partial<AgentSession>) =>
    describeSessionTimeLeft(session("s", 0, patch), now);

  it("counts down to the deadline", () => {
    expect(left({ deadlineAt: now + 90 * MINUTE })).toBe("1 h 30 min left");
    expect(left({ deadlineAt: now + 2 * 60 * MINUTE })).toBe("2 h left");
    expect(left({ deadlineAt: now + 12 * MINUTE + 5000 })).toBe("13 min left");
    expect(left({ deadlineAt: now + 20_000 })).toBe("Under 1 min left");
  });

  it("says overdue once the deadline passed or the session stalled", () => {
    expect(left({ deadlineAt: now - 1 })).toBe("Overdue");
    expect(left({ state: "stalled" })).toBe("Overdue");
  });

  it("says paused while a question holds the clock", () => {
    expect(left({ pausedRemainingMs: 5 * MINUTE })).toBe("Paused");
  });

  it("shows nothing for an ended session", () => {
    expect(left({ state: "done", endedAt: now })).toBe("");
  });
});

describe("default session", () => {
  it("is the one with an open question", () => {
    const sessions = [session("new", 200), session("asking", 100)];
    expect(pickDefaultSession(sessions, [question("asking")])).toBe("asking");
  });

  it("is the most recent one otherwise", () => {
    const sessions = [session("old", 100), session("new", 200)];
    expect(pickDefaultSession(sessions, [question()])).toBe("new");
  });

  it("is nothing without sessions", () => {
    expect(pickDefaultSession([], [])).toBeUndefined();
  });
});
