import { describe, expect, it } from "vitest";
import { getSettingsPages } from "./settings-navigation";

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
