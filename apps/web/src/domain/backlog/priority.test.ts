import { describe, expect, it } from "vitest";
import type { LocalAppState, LocalWorkItem } from "@/domain/local-state";
import {
  DEFAULT_PRIORITY_RANGES,
  getPriorityLevel,
  getSourcePriority,
  normalizePriorityLevel,
  normalizePriorityScales,
  setPriorityScale,
  validatePriorityRanges,
} from "@/domain/backlog/priority";

const wideRanges = {
  1: { min: 1, max: 100 },
  2: { min: 101, max: 400 },
  3: { min: 401, max: 700 },
  4: { min: 701, max: 999 },
};

describe("priority levels", () => {
  it("maps a source value to the level whose range holds it", () => {
    expect(getPriorityLevel(2, DEFAULT_PRIORITY_RANGES)).toBe(2);
    expect(getPriorityLevel(450, wideRanges)).toBe(3);
    expect(getPriorityLevel(0, wideRanges)).toBeUndefined();
    expect(getPriorityLevel(undefined, wideRanges)).toBeUndefined();
  });

  it("writes the lowest value of a level's range", () => {
    expect(getSourcePriority(2, wideRanges)).toBe(101);
    expect(getSourcePriority(undefined, wideRanges)).toBeUndefined();
    expect(getSourcePriority(4, { 1: { min: 1, max: 1 } })).toBeUndefined();
  });

  it("turns stored numbers into levels, with anything above 4 as Low", () => {
    expect(normalizePriorityLevel(1)).toBe(1);
    expect(normalizePriorityLevel(17)).toBe(4);
    expect(normalizePriorityLevel(0)).toBeUndefined();
    expect(normalizePriorityLevel("2")).toBeUndefined();
  });

  it("refuses ranges that overlap, run backwards or leave 0 to 999", () => {
    expect(validatePriorityRanges(wideRanges)).toBeNull();
    expect(
      validatePriorityRanges({ 1: { min: 1, max: 5 }, 2: { min: 5, max: 9 } }),
    ).toBe("Urgent and High overlap.");
    expect(validatePriorityRanges({ 3: { min: 9, max: 2 } })).toBe(
      "Medium starts after it ends.",
    );
    expect(validatePriorityRanges({ 4: { min: 1, max: 1000 } })).toBe(
      "Low needs whole numbers from 0 to 999.",
    );
  });

  it("drops invalid stored scales", () => {
    expect(
      normalizePriorityScales([
        { source: "jira", connectionId: "c1", ranges: wideRanges },
        { source: "jira", connectionId: "c2", ranges: { 1: { min: 5, max: 1 } } },
        "junk",
      ]),
    ).toEqual([{ source: "jira", connectionId: "c1", ranges: wideRanges }]);
  });

  it("moves items that follow their source priority to the new ranges' level", () => {
    const item = (id: string, overrides: Partial<LocalWorkItem>) =>
      ({
        _id: id,
        title: id,
        status: "active",
        source: "jira",
        sourceConnectionId: "c1",
        createdAt: 1,
        ...overrides,
      }) as LocalWorkItem;
    const state = {
      workItems: [
        item("follows", { importedPriority: 3, priority: 3 }),
        item("own", { importedPriority: 3, priority: 1 }),
      ],
      priorityScales: [],
    } as unknown as LocalAppState;

    const next = setPriorityScale(state, {
      source: "jira",
      connectionId: "c1",
      ranges: { 1: { min: 1, max: 2 }, 2: { min: 3, max: 5 } },
    });

    expect(next.workItems.map((workItem) => workItem.priority)).toEqual([2, 1]);
    expect(() =>
      setPriorityScale(state, {
        source: "jira",
        connectionId: "c1",
        ranges: { 1: { min: 3, max: 1 } },
      }),
    ).toThrow();
  });
});
