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

  it.each([
    { draft: "Unlisted", sourceStatusLabel: "Unlisted", valid: true },
    { draft: "Unlisted", sourceStatusLabel: "Active", valid: false },
    { draft: "", sourceStatusLabel: "Active", valid: false },
    { draft: "Unlisted", sourceStatusLabel: undefined, valid: false },
    { draft: "", sourceStatusLabel: undefined, valid: true },
    { draft: " unlisted ", sourceStatusLabel: "UNLISTED", valid: true },
  ])(
    "validates unlisted draft $draft against $sourceStatusLabel",
    ({ draft, sourceStatusLabel, valid }) => {
      const change = buildSettleChange(states, draft, "", {
        sourceStatusLabel,
      });
      if (valid)
        expect(change).toEqual({ state: undefined, priority: undefined });
      else expect(change).toBeNull();
    },
  );

  it("builds a change from the chosen state and priority", () => {
    const current = { importedPriority: 3 as const };
    expect(buildSettleChange(states, "Closed", "2", current)).toEqual({
      state: { name: "Closed", done: true },
      priority: 2,
    });
    expect(buildSettleChange(states, "Active", "3", current)).toEqual({
      state: { name: "Active", done: false },
      priority: undefined,
    });
    expect(buildSettleChange(states, "Unknown", "", current)).toBeNull();
  });

  it("refuses a priority that is not a level", () => {
    const current = {};
    expect(buildSettleChange(states, "Active", "1.5", current)).toBeNull();
    expect(buildSettleChange(states, "Active", "0", current)).toBeNull();
    expect(buildSettleChange(states, "Active", "5", current)).toBeNull();
  });

  it("rejects clearing a source priority while retaining an unchanged level", () => {
    const current = { importedPriority: 2 as const };
    expect(buildSettleChange(states, "Active", "", current)).toBeNull();
    expect(buildSettleChange(states, "Active", "2", current)).toEqual({
      state: { name: "Active", done: false },
      priority: undefined,
    });
  });

  it("keeps No priority when the source has none", () => {
    expect(buildSettleChange(states, "Active", "", {})).toEqual({
      state: { name: "Active", done: false },
      priority: undefined,
    });
  });
});
