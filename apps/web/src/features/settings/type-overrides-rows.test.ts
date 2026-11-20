import { describe, expect, it } from "vitest";
import {
  draftsOfValue,
  typeOverrideRows,
  valueOfDrafts,
  withDraftAdded,
  withDraftText,
  withoutDraft,
} from "./type-overrides-rows";

const found = [
  { name: "Task", count: 14 },
  { name: "Product Backlog Item", count: 6 },
];

describe("the rows of a typeOverrides field", () => {
  it("lists the types found, then the saved and added ones, with their texts", () => {
    const saved = draftsOfValue(
      '{"task":{"original":"Original Estimate"},"Defect":{"original":"Original Estimate"}}',
    );

    const rows = typeOverrideRows(found, withDraftAdded(saved, "Feature"));

    expect(rows).toEqual([
      {
        name: "Task",
        count: 14,
        values: { original: "Original Estimate" },
        removable: false,
      },
      { name: "Product Backlog Item", count: 6, values: {}, removable: false },
      {
        name: "Defect",
        values: { original: "Original Estimate" },
        removable: true,
      },
      { name: "Feature", values: {}, removable: true },
    ]);
  });

  it("keeps what the user types, and stores it trimmed, without the empty ones", () => {
    let drafts = draftsOfValue("");
    drafts = withDraftText(drafts, "Task", "original", "Original ");

    expect(typeOverrideRows(found, drafts)[0]?.values).toEqual({
      original: "Original ",
    });
    expect(valueOfDrafts(drafts)).toBe('{"Task":{"original":"Original"}}');

    drafts = withDraftText(drafts, "task", "original", "");
    expect(valueOfDrafts(drafts)).toBe("");
  });

  it("drops a removed type, and ignores a value it can't read", () => {
    const drafts = draftsOfValue('{"Defect":{"original":"Original Estimate"}}');

    expect(valueOfDrafts(withoutDraft(drafts, "defect"))).toBe("");
    expect(draftsOfValue("Task: Effort")).toEqual([]);
  });
});
