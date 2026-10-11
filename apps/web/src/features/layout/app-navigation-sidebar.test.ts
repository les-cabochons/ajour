import { describe, expect, it } from "vitest";
import {
  isAppNavigationItemActive,
  isSettingsReturnPath,
} from "./app-navigation-sidebar";

describe("isAppNavigationItemActive", () => {
  it("matches Time routes", () => {
    expect(isAppNavigationItemActive("/time/2026-08-15", "/time/$date")).toBe(
      true,
    );
  });

  it("matches nested Projects and Settings routes", () => {
    expect(isAppNavigationItemActive("/projects/project-1", "/projects")).toBe(
      true,
    );
    expect(isAppNavigationItemActive("/settings/plugins", "/settings")).toBe(
      true,
    );
  });

  it("keeps Backlog matching exact", () => {
    expect(isAppNavigationItemActive("/backlog", "/backlog")).toBe(true);
    expect(isAppNavigationItemActive("/settings/backlog", "/backlog")).toBe(
      false,
    );
  });
});

describe("isSettingsReturnPath", () => {
  it.each([
    "/time/today",
    "/time/2026-08-15",
    "/backlog",
    "/projects",
    "/projects/project-1",
  ])("accepts workspace route %s", (pathname) => {
    expect(isSettingsReturnPath(pathname)).toBe(true);
  });

  it.each(["/settings", "/settings/general"])(
    "rejects non-workspace route %s",
    (pathname) => {
      expect(isSettingsReturnPath(pathname)).toBe(false);
    },
  );
});
