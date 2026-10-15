import { describe, expect, it } from "vitest";
import { getAppView } from "./sidebar-view-switcher";

describe("getAppView", () => {
  it("names the view of a page and of the pages inside it", () => {
    expect(getAppView("/time/2026-10-14")).toBe("time");
    expect(getAppView("/time/2026-10-14/submit")).toBe("time");
    expect(getAppView("/backlog")).toBe("backlog");
    expect(getAppView("/backlog/w2")).toBe("backlog");
    expect(getAppView("/pull-requests/pr-1")).toBe("pull-requests");
    expect(getAppView("/projects/archive")).toBe("projects");
  });

  it("leaves Settings and look-alike paths without a view", () => {
    expect(getAppView("/settings/backlog")).toBeUndefined();
    expect(getAppView("/backlogs")).toBeUndefined();
  });
});
