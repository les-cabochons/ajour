import { describe, expect, it } from "vitest";
import {
  MAX_OPEN_FRONTMATTER_SECTIONS,
  getFrontmatterSectionId,
  parseOpenFrontmatterSections,
  toggleFrontmatterSection,
} from "./frontmatter-sections";

describe("getFrontmatterSectionId", () => {
  it("names a section by its keys from the top, ignoring case", () => {
    expect(getFrontmatterSectionId(["Client", "Contact"])).toBe(
      getFrontmatterSectionId(["client", "CONTACT"]),
    );
    expect(getFrontmatterSectionId(["Client", "Contact"])).not.toBe(
      getFrontmatterSectionId(["Contact"]),
    );
    // A quoted key may hold a line break, so it can't be the separator.
    expect(getFrontmatterSectionId(["Client\nContact"])).not.toBe(
      getFrontmatterSectionId(["Client", "Contact"]),
    );
  });
});

describe("parseOpenFrontmatterSections", () => {
  it("restores the open sections and drops broken values", () => {
    expect(parseOpenFrontmatterSections('["links","links",3,""]')).toEqual([
      "links",
    ]);
    expect(parseOpenFrontmatterSections('{"links":true}')).toEqual([]);
    expect(parseOpenFrontmatterSections("not json")).toEqual([]);
    expect(parseOpenFrontmatterSections(null)).toEqual([]);
  });

  it("keeps only the newest sections", () => {
    const ids = Array.from(
      { length: MAX_OPEN_FRONTMATTER_SECTIONS + 5 },
      (_, index) => `s${index}`,
    );
    const parsed = parseOpenFrontmatterSections(JSON.stringify(ids));
    expect(parsed).toHaveLength(MAX_OPEN_FRONTMATTER_SECTIONS);
    expect(parsed[0]).toBe("s5");
  });
});

describe("toggleFrontmatterSection", () => {
  it("opens a section as the newest and closes it again", () => {
    const opened = toggleFrontmatterSection(["a", "b"], "a", true);
    expect(opened).toEqual(["b", "a"]);
    expect(toggleFrontmatterSection(opened, "a", false)).toEqual(["b"]);
  });

  it("drops the oldest section past the limit", () => {
    const full = Array.from(
      { length: MAX_OPEN_FRONTMATTER_SECTIONS },
      (_, index) => `s${index}`,
    );
    const next = toggleFrontmatterSection(full, "new", true);
    expect(next).toHaveLength(MAX_OPEN_FRONTMATTER_SECTIONS);
    expect(next[0]).toBe("s1");
    expect(next.at(-1)).toBe("new");
  });
});
