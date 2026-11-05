import { describe, expect, it } from "vitest";
import {
  buildSettleChange,
  findSettleState,
  groupSettleStates,
  settleToastTitle,
} from "@/features/backlog/settle-draft";

const states = [
  { name: "New", category: "Proposed", done: false },
  { name: "Active", category: "In Progress", done: false },
  { name: "Waiting", category: "In Progress", done: false },
  { name: "Closed", category: "Completed", done: true },
];

describe("settle dialog fields", () => {
  it("groups states by category in the plugin's order", () => {
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

  it.each([
    [false, false, undefined, "Backlog item settled"],
    [true, false, undefined, "Backlog item archived"],
    [false, true, undefined, "Commented and settled"],
    [true, true, undefined, "Commented and archived"],
    [false, false, "Ana Silva", "Assigned to Ana Silva and settled"],
    [true, false, "Ana Silva", "Assigned to Ana Silva and archived"],
    [false, true, "Ana Silva", "Commented, assigned to Ana Silva and settled"],
    [false, false, null, "Unassigned and settled"],
    [false, true, null, "Commented, unassigned and settled"],
  ] as const)(
    "names what the settle did: archived %s, commented %s, assigned to %s",
    (archived, commented, assignee, title) => {
      expect(
        settleToastTitle({
          archived,
          commented,
          assignee:
            typeof assignee === "string"
              ? { id: "ana", displayName: assignee }
              : assignee,
        }),
      ).toBe(title);
    },
  );

  it("adds a picked assignee only when it isn't the item's", () => {
    const alex = { id: "alex@contoso.com", displayName: "Alex Trépanier" };
    const ana = { id: "ana@contoso.com", displayName: "Ana Silva" };
    const assigneeOf = (
      current: { assignee?: typeof alex | null },
      picked: typeof alex | null | undefined,
    ) => buildSettleChange(states, "Active", "", current, picked)?.assignee;

    expect(assigneeOf({ assignee: alex }, ana)).toEqual(ana);
    expect(assigneeOf({ assignee: alex }, null)).toBeNull();
    expect(assigneeOf({ assignee: alex }, { ...alex })).toBeUndefined();
    expect(assigneeOf({ assignee: null }, null)).toBeUndefined();
    // Kept as it is, whoever has it.
    expect(assigneeOf({ assignee: alex }, undefined)).toBeUndefined();
    // Not known yet: whoever the user picks is written.
    expect(assigneeOf({}, ana)).toEqual(ana);
    expect(assigneeOf({}, null)).toBeNull();
  });
});
