import { describe, expect, it } from "vitest";
import type { AgentsSnapshot } from "@ajour/shared/agent-tools";
import { getAgentIndicator } from "@/domain/agents/agent-indicator";

const client = { id: "c1", name: "Claude Code" };
const empty: AgentsSnapshot = {
  sessions: [],
  openQuestions: [],
  activity: [],
  errors: [],
  seenAt: 100,
};
const session = (state: "active" | "stalled" | "failed", endedAt?: number) => ({
  id: `s-${state}`,
  client,
  title: "Fill Workday",
  state,
  startedAt: 50,
  ...(endedAt ? { endedAt } : {}),
  messages: [],
});

const indicator = (
  snapshot: AgentsSnapshot,
  bridgeStatus: "connected" | "disconnected" = "connected",
) => getAgentIndicator({ mcpEnabled: true, bridgeStatus, snapshot }).state;

describe("agent indicator", () => {
  it("is hidden while MCP is off", () => {
    expect(
      getAgentIndicator({
        mcpEnabled: false,
        bridgeStatus: "off",
        snapshot: empty,
      }).state,
    ).toBe("hidden");
  });

  it("is idle when MCP is on and nothing runs", () => {
    expect(indicator(empty)).toBe("idle");
  });

  it("puts a question first, even over an error", () => {
    expect(
      indicator({
        ...empty,
        errors: [{ at: 200, message: "Ajour did not answer in time." }],
        openQuestions: [
          { id: "q", client, text: "Which project?", askedAt: 200 },
        ],
      }),
    ).toBe("needs-input");
  });

  it("shows an error when the bridge lost the API", () => {
    expect(indicator(empty, "disconnected")).toBe("error");
  });

  it("shows only errors newer than the last time the panel opened", () => {
    expect(indicator({ ...empty, errors: [{ at: 50, message: "old" }] })).toBe(
      "idle",
    );
    expect(indicator({ ...empty, errors: [{ at: 150, message: "new" }] })).toBe(
      "error",
    );
  });

  it("a stalled session shows Failed until it recovers", () => {
    expect(indicator({ ...empty, sessions: [session("stalled")] })).toBe(
      "failed",
    );
  });

  it("shows Failed for a session that failed since the panel opened", () => {
    expect(indicator({ ...empty, sessions: [session("failed", 150)] })).toBe(
      "failed",
    );
    expect(indicator({ ...empty, sessions: [session("failed", 90)] })).toBe(
      "idle",
    );
  });

  it("is active while a session runs", () => {
    expect(indicator({ ...empty, sessions: [session("active")] })).toBe(
      "active",
    );
  });
});
