import { describe, expect, it } from "vitest";
import {
  describedType,
  draftsOfValue,
  itemTypesRequest,
  missingField,
  otherItemTypes,
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

describe("what the plugin says about the types", () => {
  const task = {
    name: "Task",
    fields: [
      { name: "Original Estimate", id: "Scheduling.OriginalEstimate" },
      { name: "Remaining Work" },
    ],
    suggestions: { original: ["Original Estimate", "Effort"] },
  };

  it("asks about the types found, each with one of its items, then the saved ones by name", () => {
    const drafts = draftsOfValue(
      '{"task":{"original":"Original Estimate"},"Defect":{"original":"Size"}}',
    );

    expect(
      itemTypesRequest(
        [
          { name: "Task", count: 14, sourceId: "contoso:4821" },
          { name: "Bug", count: 2 },
        ],
        drafts,
      ),
    ).toEqual({
      types: [
        { name: "Task", sourceId: "contoso:4821" },
        { name: "Bug" },
        { name: "Defect" },
      ],
    });
  });

  it("names the connection's field a type lacks while its chip is empty, with the plugin's first proposal", () => {
    const described = describedType({ types: [task] }, " task ");

    expect(described).toBe(task);
    expect(missingField(described, "original", "Effort", "")).toEqual({
      field: "Effort",
      proposal: "Original Estimate",
    });
    // The type has it, by name or by id, in any case.
    expect(missingField(described, "remaining", "remaining work", "")).toBe(
      undefined,
    );
    expect(
      missingField(described, "original", "scheduling.originalestimate", ""),
    ).toBe(undefined);
    // A text in the chip, or no field on the connection, says nothing.
    expect(missingField(described, "original", "Effort", "Size")).toBe(
      undefined,
    );
    expect(missingField(described, "original", " ", "")).toBe(undefined);
  });

  it("says nothing of a type the plugin didn't describe or gave no fields, and proposes nothing it didn't suggest", () => {
    expect(missingField(undefined, "original", "Effort", "")).toBe(undefined);
    expect(missingField({ name: "Bug" }, "original", "Effort", "")).toBe(
      undefined,
    );
    expect(
      missingField(
        { name: "Spike", fields: [{ name: "Remaining Work" }] },
        "original",
        "Effort",
        "",
      ),
    ).toEqual({ field: "Effort" });
  });

  it("offers the plugin's types that have no row yet, in its order", () => {
    const rows = typeOverrideRows([{ name: "Task", count: 1 }], []);

    expect(
      otherItemTypes(
        { types: [{ name: "Epic" }, { name: "task" }, { name: "Spike" }] },
        rows,
      ).map((type) => type.name),
    ).toEqual(["Epic", "Spike"]);
    expect(otherItemTypes(undefined, rows)).toEqual([]);
  });
});
