import { describe, expect, it } from "vitest";
import { DECK_REGROUP_DEFAULT_INSTRUCTION } from "@ajour/shared/deck";
import {
  applyRegroupEvent,
  failRegroup,
  openRegroup,
  regroupInstruction,
  startRegroup,
} from "./regroup";

const turn = { turnId: "t1", conversationId: "c1" };

describe("Regroup", () => {
  it("opens on the default instruction, which it sends as none", () => {
    expect(openRegroup()).toEqual({
      kind: "composing",
      instruction: DECK_REGROUP_DEFAULT_INSTRUCTION,
    });
    expect(
      regroupInstruction(DECK_REGROUP_DEFAULT_INSTRUCTION),
    ).toBeUndefined();
    expect(regroupInstruction("  ")).toBeUndefined();
    expect(regroupInstruction(" Put tests with what they test ")).toBe(
      "Put tests with what they test",
    );
  });

  it("waits while a timesheet task holds the agent, and closes once its turn ends", () => {
    let state = startRegroup("Put tests with what they test");
    state = applyRegroupEvent(state, {
      type: "waiting",
      waitingFor: "agent-run",
      ...turn,
    });
    expect(state).toMatchObject({ kind: "running", waiting: true });
    state = applyRegroupEvent(state, { type: "started", ...turn });
    expect(state).toMatchObject({ kind: "running", waiting: false });

    expect(
      applyRegroupEvent(state, { type: "ended", outcome: "done", ...turn }),
    ).toEqual({ kind: "closed" });
    expect(
      applyRegroupEvent(state, {
        type: "ended",
        outcome: "cancelled",
        ...turn,
      }),
    ).toEqual({ kind: "closed" });
  });

  it("keeps what it sent when it fails, so it can be sent again", () => {
    const state = startRegroup("Put tests with what they test");

    expect(
      applyRegroupEvent(state, {
        type: "ended",
        outcome: "failed",
        error: "The agent didn't return a guide Ajour could use.",
        ...turn,
      }),
    ).toEqual({
      kind: "failed",
      instruction: "Put tests with what they test",
      message: "The agent didn't return a guide Ajour could use.",
    });
    expect(failRegroup(startRegroup(), "No agent.")).toEqual({
      kind: "failed",
      message: "No agent.",
    });
  });
});
