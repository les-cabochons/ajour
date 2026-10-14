import type { AgentQuestion, AgentSession } from "@ajour/shared/agent-tools";

const MINUTE_MS = 60_000;

/**
 * The time a session has left, for its row in the agent panel. Empty once the
 * session ended. A session whose clock a question holds shows "Paused".
 */
export function describeSessionTimeLeft(
  session: Pick<AgentSession, "state" | "deadlineAt" | "pausedRemainingMs">,
  now: number,
): string {
  if (session.state === "stalled") return "Overdue";
  if (session.state !== "active") return "";
  if (session.deadlineAt === undefined) {
    return session.pausedRemainingMs === undefined ? "" : "Paused";
  }

  const remaining = session.deadlineAt - now;
  if (remaining <= 0) return "Overdue";
  if (remaining < MINUTE_MS) return "Under 1 min left";

  const minutes = Math.ceil(remaining / MINUTE_MS);
  const hours = Math.floor(minutes / 60);
  if (hours === 0) return `${minutes} min left`;
  return minutes % 60 === 0
    ? `${hours} h left`
    : `${hours} h ${minutes % 60} min left`;
}

/**
 * The session the panel shows first: one with an open question, else the most
 * recent one.
 */
export function pickDefaultSession(
  sessions: readonly AgentSession[],
  openQuestions: readonly AgentQuestion[],
): string | undefined {
  const asking = sessions.find((session) =>
    openQuestions.some((question) => question.sessionId === session.id),
  );
  if (asking) return asking.id;
  return sessions.reduce<AgentSession | undefined>(
    (latest, session) =>
      !latest || session.startedAt > latest.startedAt ? session : latest,
    undefined,
  )?.id;
}
