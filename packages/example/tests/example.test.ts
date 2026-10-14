import { describe, expect, it } from "vitest";
import { toSlug } from "../index";

describe("toSlug", () => {
  it("lowercases words and joins them with dashes", () => {
    expect(toSlug("Hello, World!")).toBe("hello-world");
  });

  it("drops accents", () => {
    expect(toSlug("Café crème")).toBe("cafe-creme");
  });

  it("returns an empty slug for punctuation-only titles", () => {
    expect(toSlug("  --  ")).toBe("");
  });
});
