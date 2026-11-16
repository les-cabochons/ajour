import { expect, it } from "vitest";
import {
  editInstructions,
  instructionStatus,
  THREAD_NAMING_BLOCK,
  START_MARKER,
  END_MARKER,
} from "./agent-instructions";

it("adds the exact block to a missing file", () => {
  expect(instructionStatus(null)).toBe("missing file");
  expect(editInstructions(null, "add")).toBe(THREAD_NAMING_BLOCK);
});

it.each(["\n", "\r\n"])(
  "preserves surrounding content and BOM with %j line endings",
  (eol) => {
    const before = `\uFEFF# My rules${eol}Keep spacing.  ${eol}`;
    const after = `${eol}User footer  ${eol}`;
    const old = `${START_MARKER}${eol}old${eol}${END_MARKER}`;
    const updated = editInstructions(before + old + after, "update");
    expect(updated).toBe(
      before + THREAD_NAMING_BLOCK.replace(/\n/g, eol) + after,
    );
    expect(instructionStatus(updated)).toBe("block current");
    expect(instructionStatus(before + old + after)).toBe("block outdated");
    expect(editInstructions(updated, "remove")).toBe(before + after);
    expect(instructionStatus(before)).toBe("no block");
    expect(editInstructions(before, "add")).toBe(
      before + THREAD_NAMING_BLOCK.replace(/\n/g, eol),
    );
  },
);

it.each([
  START_MARKER,
  END_MARKER,
  END_MARKER + START_MARKER,
  THREAD_NAMING_BLOCK + THREAD_NAMING_BLOCK,
  "<!-- ajour:thread-naming",
  `user ${THREAD_NAMING_BLOCK}`,
])("refuses ambiguous markers %j", (text) => {
  expect(() => instructionStatus(text)).toThrow(/marker/i);
  expect(() => editInstructions(text, "remove")).toThrow(/marker/i);
});
