import { describe, expect, it } from "vitest";
import { getSettingsGroups, getSettingsPages } from "./settings-navigation";

describe("getSettingsPages", () => {
  it("keeps the project import and export page in wide windows", () => {
    const routes = getSettingsPages("wide").map((page) => page.to);
    expect(routes).toContain("/settings/projects");
    expect(routes).not.toContain("/projects");
  });

  it("opens the full Projects section from the narrow Settings list", () => {
    const routes = getSettingsPages("narrow").map((page) => page.to);
    expect(routes).toContain("/projects");
    expect(routes).not.toContain("/settings/projects");
  });

  it("shows the same labels in the same order in both views", () => {
    expect(getSettingsPages("narrow").map((page) => page.label)).toEqual(
      getSettingsPages("wide").map((page) => page.label),
    );
  });
});

describe("getSettingsGroups", () => {
  it("groups every page under the same headings in both views", () => {
    const labels = (view: "wide" | "narrow") =>
      getSettingsGroups(view).map((group) => group.label);
    expect(labels("narrow")).toEqual(labels("wide"));
    for (const group of getSettingsGroups("narrow")) {
      expect(group.pages.length).toBeGreaterThan(0);
    }
  });

  it("lists Pull requests under Work only in the narrow view with a code host", () => {
    const work = (view: "wide" | "narrow") =>
      getSettingsGroups(view, true)
        .find((group) => group.label === "Work")!
        .pages.map((page) => page.label);
    expect(work("narrow")).toContain("Pull requests");
    expect(work("wide")).not.toContain("Pull requests");
  });

  it("lists Calendar under Work only while a calendar plugin is on", () => {
    const work = (hasCalendar: boolean) =>
      getSettingsGroups("wide", false, hasCalendar)
        .find((group) => group.label === "Work")!
        .pages.map((page) => page.to);
    expect(work(true)).toContain("/settings/calendar");
    expect(work(false)).not.toContain("/settings/calendar");
  });

  it("lists Vault between Plugins and MCP in the App group", () => {
    const labels = getSettingsGroups("wide")[0]!.pages.map(
      (page) => page.label,
    );
    expect(labels.slice(labels.indexOf("Plugins"))[1]).toBe("Vault");
    expect(labels.indexOf("MCP")).toBe(labels.indexOf("Vault") + 1);
  });

  it("lists Agents after MCP in the App group", () => {
    const app = getSettingsGroups("wide")[0]!;
    const labels = app.pages.map((page) => page.label);
    expect(labels.indexOf("Agents")).toBe(labels.indexOf("MCP") + 1);
  });
});

describe("Diagnostics", () => {
  const app = (hasDiagnostics: boolean, view: "wide" | "narrow" = "wide") =>
    getSettingsGroups(view, false, false, hasDiagnostics)[0]!.pages.map(
      (page) => page.to,
    );

  it("is listed under App after Agents when the desktop bridge exists", () => {
    for (const view of ["wide", "narrow"] as const) {
      const routes = app(true, view);
      expect(routes.indexOf("/settings/diagnostics")).toBe(
        routes.indexOf("/settings/agents") + 1,
      );
    }
  });

  it("is left out of the web build", () => {
    expect(app(false)).not.toContain("/settings/diagnostics");
    expect(getSettingsPages("wide").map((page) => page.to)).not.toContain(
      "/settings/diagnostics",
    );
  });
});
