import { describe, expect, it } from "vitest";
import { submitLineId } from "@/domain/agents/submit-line-id";

describe("submitLineId", () => {
  it("is stable for the same entries in any order", () => {
    expect(submitLineId(["b", "a"])).toBe(submitLineId(["a", "b"]));
  });

  it("changes when the line gains an entry", () => {
    expect(submitLineId(["a", "b", "c"])).not.toBe(submitLineId(["a", "b"]));
  });

  it("reads ajour: and 8 hex characters", () => {
    expect(submitLineId(["a"])).toMatch(/^ajour:[0-9a-f]{8}$/);
  });

  it("matches a known FNV-1a value", () => {
    // FNV-1a 32-bit of "a" is 0xe40c292c.
    expect(submitLineId(["a"])).toBe("ajour:e40c292c");
  });
});
