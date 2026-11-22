import { describe, expect, it } from "vitest";
import { getAppSection, isSectionEntryShown } from "./app-section";

describe("getAppSection", () => {
  it("names the section of a page and of the pages inside it", () => {
    expect(getAppSection("/time/2026-10-14")).toBe("time");
    expect(getAppSection("/time/2026-10-14/commit")).toBe("time");
    expect(getAppSection("/backlog")).toBe("backlog");
    expect(getAppSection("/backlog/w2")).toBe("backlog");
    expect(getAppSection("/deck/pr-1")).toBe("deck");
    expect(getAppSection("/pull-requests")).toBeUndefined();
    expect(getAppSection("/projects/archive")).toBe("projects");
    expect(getAppSection("/settings/backlog")).toBe("settings");
  });

  it("leaves look-alike and unknown paths without a section", () => {
    expect(getAppSection("/backlogs")).toBeUndefined();
    expect(getAppSection("/")).toBeUndefined();
  });
});

describe("isSectionEntryShown", () => {
  it("shows an entry that needs a code host only while one is enabled", () => {
    const deck = { requiresCodeHost: true };
    expect(isSectionEntryShown(deck, true)).toBe(true);
    expect(isSectionEntryShown(deck, false)).toBe(false);
    expect(isSectionEntryShown({}, false)).toBe(true);
  });
});
