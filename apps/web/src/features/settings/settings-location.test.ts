import { afterEach, describe, expect, it } from "vitest";
import {
  encodeSettingsLocation,
  getLastAppLocation,
  parseSettingsLocation,
  rememberAppLocation,
  resetLastAppLocation,
  settingsLocationOf,
  settingsPathname,
  settingsWindowNavigation,
  settingsWindowRedirect,
  withoutSettings,
} from "./settings-location";

afterEach(() => resetLastAppLocation());

describe("settingsLocationOf", () => {
  it("strips the /settings prefix and opens General for the bare route", () => {
    expect(settingsLocationOf("/settings/plugins/jira").page).toBe(
      "plugins/jira",
    );
    expect(settingsLocationOf("/settings").page).toBe("general");
    expect(settingsLocationOf("").page).toBe("general");
  });

  it("keeps string, number and boolean search values and drops the window's own key", () => {
    expect(
      settingsLocationOf("sync-review", {
        item: "abc",
        page: 2,
        settings: "general",
        empty: "",
        list: ["x"],
      }).search,
    ).toEqual({ item: "abc", page: "2" });
  });
});

describe("encodeSettingsLocation and parseSettingsLocation", () => {
  it("round-trips a page with its search", () => {
    const location = settingsLocationOf("sync-review", {
      item: "a b",
      held: "contoso",
    });
    const encoded = encodeSettingsLocation(location);
    expect(encoded).toBe("sync-review?item=a+b&held=contoso");
    expect(parseSettingsLocation(encoded)).toEqual(location);
  });

  it("encodes a page without search as its path alone", () => {
    expect(encodeSettingsLocation(settingsLocationOf("general"))).toBe(
      "general",
    );
    expect(parseSettingsLocation("plugins/jira")).toEqual({
      page: "plugins/jira",
      search: {},
    });
  });

  it("refuses values that are not a settings page", () => {
    expect(parseSettingsLocation(undefined)).toBeNull();
    expect(parseSettingsLocation("")).toBeNull();
    expect(parseSettingsLocation(42)).toBeNull();
    expect(parseSettingsLocation("../time")).toBeNull();
    expect(parseSettingsLocation("https://example.com")).toBeNull();
  });
});

describe("settingsWindowNavigation", () => {
  it("stays on the page, keeps its search, and masks it as the settings route", () => {
    const navigation = settingsWindowNavigation(
      settingsLocationOf("sync-review", { item: "abc" }),
    );
    expect(navigation.to).toBe(".");
    expect(navigation.search({ view: "week", settings: "general" })).toEqual({
      view: "week",
      settings: "sync-review?item=abc",
    });
    expect(navigation.mask).toEqual({
      to: "/settings/sync-review",
      search: { item: "abc" },
    });
    expect(settingsPathname(settingsLocationOf("general"))).toBe(
      "/settings/general",
    );
  });

  it("a settings route replaces itself with the window over the last page", () => {
    expect(
      settingsWindowRedirect(
        { pathname: "/time/2026-11-04", search: { view: "week" } },
        settingsLocationOf("plugins/jira"),
      ),
    ).toEqual({
      to: "/time/2026-11-04",
      search: { view: "week", settings: "plugins/jira" },
      mask: { to: "/settings/plugins/jira", search: {} },
      replace: true,
    });
  });

  it("closing keeps the page's other search", () => {
    expect(withoutSettings({ view: "week", settings: "general" })).toEqual({
      view: "week",
    });
  });
});

describe("rememberAppLocation", () => {
  it("starts on today's Time page", () => {
    expect(getLastAppLocation()).toEqual({
      pathname: "/time/today",
      search: {},
    });
  });

  it("remembers a page without the window, and never a settings route", () => {
    rememberAppLocation({
      pathname: "/backlog",
      search: { q: "x", settings: "general" },
    });
    expect(getLastAppLocation()).toEqual({
      pathname: "/backlog",
      search: { q: "x" },
    });
    rememberAppLocation({ pathname: "/settings/plugins", search: {} });
    rememberAppLocation({ pathname: "/settings", search: {} });
    expect(getLastAppLocation().pathname).toBe("/backlog");
  });
});
