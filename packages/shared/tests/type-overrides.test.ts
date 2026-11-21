import { describe, expect, it } from "vitest";
import {
  formatTypeOverrides,
  parseTypeOverrides,
  typeOverrideFor,
} from "../type-overrides";

describe("type overrides value", () => {
  it("keeps only the filled inputs, and no text means none", () => {
    const text = formatTypeOverrides({
      Task: {
        originalEstimateFieldName: " Original Estimate ",
        remainingEstimateFieldName: "",
      },
      Bug: { originalEstimateFieldName: "  " },
    });

    expect(text).toBe(
      '{"Task":{"originalEstimateFieldName":"Original Estimate"}}',
    );
    expect(parseTypeOverrides(text)).toEqual({
      Task: { originalEstimateFieldName: "Original Estimate" },
    });
    expect(formatTypeOverrides({ Bug: { remaining: "" } })).toBe("");
    expect(parseTypeOverrides("")).toEqual({});
    expect(parseTypeOverrides(undefined)).toEqual({});
  });

  it("refuses text that isn't an object of texts by type and field", () => {
    expect(() => parseTypeOverrides("Task: Effort")).toThrow(
      "The overrides by type are not valid JSON.",
    );
    expect(() => parseTypeOverrides('{"Task":"Effort"}')).toThrow(
      'The overrides of "Task" must be an object of field texts.',
    );
    expect(() => parseTypeOverrides('{"Task":{"estimate":3}}')).toThrow(
      'The override of "estimate" for "Task" must be text.',
    );
  });

  it("finds a type's override in any case, and nothing for the others", () => {
    const overrides = parseTypeOverrides(
      '{"Task":{"originalEstimateFieldName":"Original Estimate"}}',
    );

    expect(
      typeOverrideFor(overrides, " task ", "originalEstimateFieldName"),
    ).toBe("Original Estimate");
    expect(
      typeOverrideFor(overrides, "Task", "remainingEstimateFieldName"),
    ).toBeUndefined();
    expect(
      typeOverrideFor(overrides, "Bug", "originalEstimateFieldName"),
    ).toBeUndefined();
  });
});
