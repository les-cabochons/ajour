import { describe, expect, it } from "vitest";
import { normalizeHexColor } from "@/domain/hex-color";

describe("reading a typed hex color", () => {
  it("takes six digits, with or without #", () => {
    expect(normalizeHexColor("#4F46E5")).toBe("#4f46e5");
    expect(normalizeHexColor(" ff8800 ")).toBe("#ff8800");
  });

  it("reads three digits as six", () => {
    expect(normalizeHexColor("#fff")).toBe("#ffffff");
    expect(normalizeHexColor("0a8")).toBe("#00aa88");
  });

  it("refuses other lengths and names instead of cutting them", () => {
    expect(normalizeHexColor("#1234567")).toBeNull();
    expect(normalizeHexColor("#12345")).toBeNull();
    expect(normalizeHexColor("red")).toBeNull();
    expect(normalizeHexColor("")).toBeNull();
  });
});
