import { describe, expect, it } from "vitest";
import {
  getBacklogItemBackLink,
  getBacklogItemOriginFor,
  getSectionPathname,
  parseBacklogItemSearch,
} from "@/features/backlog/backlog-item-search";

describe("parseBacklogItemSearch", () => {
  it("keeps the actions the item page hosts", () => {
    expect(parseBacklogItemSearch({ action: "edit" })).toEqual({
      action: "edit",
    });
    expect(parseBacklogItemSearch({ action: "add-subitem" })).toEqual({
      action: "add-subitem",
    });
  });

  it("drops a missing, unknown or non-string action", () => {
    expect(parseBacklogItemSearch({})).toEqual({});
    expect(parseBacklogItemSearch({ action: "delete" })).toEqual({});
    expect(parseBacklogItemSearch({ action: 1 })).toEqual({});
  });

  it("keeps a Time, Projects or Pull requests page as the origin", () => {
    for (const from of [
      "/time/2026-10-15?view=week",
      "/projects/p1",
      "/pull-requests",
    ]) {
      expect(parseBacklogItemSearch({ from })).toEqual({ from });
    }
  });

  it("drops an origin outside those sections", () => {
    for (const from of [
      "/backlog",
      "/settings/general",
      "https://example.com/time/x",
      "//example.com",
      1,
    ]) {
      expect(parseBacklogItemSearch({ from })).toEqual({});
    }
  });
});

describe("getBacklogItemOriginFor", () => {
  it("remembers the page outside Backlog the item opens from", () => {
    expect(
      getBacklogItemOriginFor({
        pathname: "/time/2026-10-15",
        href: "/time/2026-10-15?view=week",
        search: { view: "week" },
      }),
    ).toBe("/time/2026-10-15?view=week");
  });

  it("keeps the origin when moving from one item page to another", () => {
    expect(
      getBacklogItemOriginFor({
        pathname: "/backlog/w1",
        href: "/backlog/w1?from=%2Fprojects",
        search: { from: "/projects" },
      }),
    ).toBe("/projects");
  });

  it("has no origin from the Backlog page", () => {
    expect(
      getBacklogItemOriginFor({
        pathname: "/backlog",
        href: "/backlog",
        search: {},
      }),
    ).toBeUndefined();
  });
});

describe("getBacklogItemBackLink", () => {
  it("returns to the origin page with its search", () => {
    expect(getBacklogItemBackLink("/time/2026-10-15?view=week")).toEqual({
      label: "Time",
      to: "/time/2026-10-15",
      search: { view: "week" },
    });
  });

  it("returns to Backlog without an origin", () => {
    expect(getBacklogItemBackLink(undefined)).toEqual({
      label: "Backlog",
      to: "/backlog",
    });
  });
});

describe("getSectionPathname", () => {
  it("reads an item page opened from Projects as Projects", () => {
    expect(getSectionPathname("/backlog/w1", { from: "/projects/p1" })).toBe(
      "/projects/p1",
    );
  });

  it("leaves other pages and item pages without an origin alone", () => {
    expect(getSectionPathname("/backlog/w1", {})).toBe("/backlog/w1");
    expect(getSectionPathname("/time/today", { from: "/projects" })).toBe(
      "/time/today",
    );
  });
});
