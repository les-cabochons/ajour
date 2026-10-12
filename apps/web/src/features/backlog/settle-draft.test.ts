import { describe, expect, it } from "vitest";
import {
  buildSettleChange,
  findSettleState,
  groupSettleStates,
} from "@/features/backlog/settle-draft";

const states = [
  { name: "New", category: "Proposed", done: false },
  { name: "Active", category: "In Progress", done: false },
  { name: "Waiting", category: "In Progress", done: false },
  { name: "Closed", category: "Completed", done: true },
];

describe("settle dialog fields", () => {
  it("groups states by category in the connector's order", () => {
    expect(
      groupSettleStates(states).map((group) => [
        group.category,
        group.states.map((state) => state.name),
      ]),
    ).toEqual([
      ["Proposed", ["New"]],
      ["In Progress", ["Active", "Waiting"]],
      ["Completed", ["Closed"]],
    ]);
  });

  it("finds a state whatever its case", () => {
    expect(findSettleState(states, "waiting")?.name).toBe("Waiting");
    expect(findSettleState(states, undefined)).toBeUndefined();
  });

  it("builds a change from the chosen state and priority", () => {
    expect(buildSettleChange(states, "Closed", "25")).toEqual({
      state: { name: "Closed", done: true },
      priority: 25,
    });
    expect(buildSettleChange(states, "Unknown", "")).toEqual({
      state: undefined,
      priority: undefined,
    });
  });

  it("refuses a priority that is not a whole number from 0 to 999", () => {
    expect(buildSettleChange(states, "Active", "1.5")).toBeNull();
    expect(buildSettleChange(states, "Active", "-1")).toBeNull();
    expect(buildSettleChange(states, "Active", "1000")).toBeNull();
  });
});
