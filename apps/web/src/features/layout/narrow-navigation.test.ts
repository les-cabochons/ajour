import { describe, expect, it } from "vitest";
import {
  getNarrowBackLink,
  isNarrowSettingsSection,
} from "./narrow-navigation";

describe("getNarrowBackLink", () => {
  it("gives the Settings list no back arrow", () => {
    expect(getNarrowBackLink("/settings")).toBeNull();
    expect(getNarrowBackLink("/settings/")).toBeNull();
  });

  it("leads every settings page back to the Settings list", () => {
    for (const pathname of [
      "/settings/general",
      "/settings/plugins",
      "/settings/plugins/outlook",
      "/settings/backlog",
      "/settings/time-entries",
      "/settings/sync-review",
      "/settings/debug",
    ]) {
      expect(getNarrowBackLink(pathname)).toEqual({
        to: "/settings",
        label: "Settings",
      });
    }
  });

  it("puts the Projects list inside Settings", () => {
    expect(getNarrowBackLink("/projects")).toEqual({
      to: "/settings",
      label: "Settings",
    });
  });

  it("leads project pages and project import and export back to the Projects list", () => {
    for (const pathname of [
      "/projects/project-1",
      "/projects/archive",
      "/settings/projects",
    ]) {
      expect(getNarrowBackLink(pathname)).toEqual({
        to: "/projects",
        label: "Projects",
      });
    }
  });

  it("gives Time and Backlog no back arrow", () => {
    expect(getNarrowBackLink("/time/2026-10-11")).toBeNull();
    expect(getNarrowBackLink("/backlog")).toBeNull();
  });
});

describe("isNarrowSettingsSection", () => {
  it("covers Settings and Projects pages only", () => {
    expect(isNarrowSettingsSection("/settings")).toBe(true);
    expect(isNarrowSettingsSection("/settings/general")).toBe(true);
    expect(isNarrowSettingsSection("/projects")).toBe(true);
    expect(isNarrowSettingsSection("/projects/archive")).toBe(true);
    expect(isNarrowSettingsSection("/time/today")).toBe(false);
    expect(isNarrowSettingsSection("/backlog")).toBe(false);
    expect(isNarrowSettingsSection("/projectsx")).toBe(false);
  });
});
