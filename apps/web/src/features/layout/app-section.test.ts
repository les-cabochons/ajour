import { describe, expect, it } from "vitest";
import { getAppSection } from "./app-section";

describe("getAppSection", () => {
  it("names the section of a page and of the pages inside it", () => {
    expect(getAppSection("/time/2026-10-14")).toBe("time");
    expect(getAppSection("/time/2026-10-14/submit")).toBe("time");
    expect(getAppSection("/backlog")).toBe("backlog");
    expect(getAppSection("/backlog/w2")).toBe("backlog");
    expect(getAppSection("/pull-requests/pr-1")).toBe("pull-requests");
    expect(getAppSection("/projects/archive")).toBe("projects");
    expect(getAppSection("/settings/backlog")).toBe("settings");
  });

  it("leaves look-alike and unknown paths without a section", () => {
    expect(getAppSection("/backlogs")).toBeUndefined();
    expect(getAppSection("/")).toBeUndefined();
  });
});
