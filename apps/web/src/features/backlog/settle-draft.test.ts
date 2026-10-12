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
    const current = {
      importedPriority: 30,
      ranges: {
        1: { min: 1, max: 10 },
        2: { min: 11, max: 20 },
        3: { min: 21, max: 40 },
      },
    };
    expect(buildSettleChange(states, "Closed", "2", current)).toEqual({
      state: { name: "Closed", done: true },
      priority: 11,
    });
    expect(buildSettleChange(states, "Active", "3", current)).toEqual({
      state: { name: "Active", done: false },
      priority: undefined,
    });
    expect(buildSettleChange(states, "Unknown", "", current)).toEqual({
      state: undefined,
      priority: undefined,
    });
  });

  it("refuses a priority that is not a level", () => {
    const current = { ranges: {} };
    expect(buildSettleChange(states, "Active", "1.5", current)).toBeNull();
    expect(buildSettleChange(states, "Active", "0", current)).toBeNull();
    expect(buildSettleChange(states, "Active", "5", current)).toBeNull();
  });

  it("rejects a changed level with no source range instead of dropping it", () => {
    const current = {
      importedPriority: 20,
      ranges: { 1: { min: 1, max: 10 }, 2: { min: 11, max: 20 } },
    };
    expect(buildSettleChange(states, "Closed", "4", current)).toBeNull();
    expect(buildSettleChange(states, "Closed", "3", current)).toBeNull();
    expect(buildSettleChange(states, "Closed", "1", current)?.priority).toBe(1);
    expect(
      buildSettleChange(states, "Closed", "2", current)?.priority,
    ).toBeUndefined();
    expect(buildSettleChange(states, "Closed", "", current)).toEqual({
      state: { name: "Closed", done: true },
      priority: undefined,
    });
  });
});
