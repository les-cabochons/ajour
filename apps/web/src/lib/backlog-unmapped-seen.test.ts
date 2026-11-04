import { describe, expect, it } from "vitest";
import { isUnmappedRising } from "@/lib/backlog-unmapped-seen";

describe("isUnmappedRising", () => {
  it("warns when the count is new or higher than at the last visit", () => {
    expect(isUnmappedRising(4, undefined)).toBe(true);
    expect(isUnmappedRising(5, 4)).toBe(true);
  });

  it("stays quiet when the count is the same or lower, or zero", () => {
    expect(isUnmappedRising(4, 4)).toBe(false);
    expect(isUnmappedRising(3, 4)).toBe(false);
    expect(isUnmappedRising(0, undefined)).toBe(false);
  });
});
