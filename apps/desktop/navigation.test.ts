import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { classifyNavigation } = require("./electron/navigation.cjs") as {
  classifyNavigation: (
    url: unknown,
    appUrl: string,
  ) => "app" | "external" | "blocked";
};

describe("window navigation", () => {
  it.each([
    ["app://local/backlog", "app://local/"],
    ["http://127.0.0.1:5173/time/2026-10-20", "http://127.0.0.1:5173"],
  ])("keeps %s inside the app", (url, appUrl) => {
    expect(classifyNavigation(url, appUrl)).toBe("app");
  });

  it.each([
    "https://github.com/les-cabochons/ajour",
    "http://example.com/",
    "mailto:someone@example.com",
  ])("sends %s to the system browser", (url) => {
    expect(classifyNavigation(url, "app://local/")).toBe("external");
  });

  // Node gives app:// and file:// the same opaque origin, "null", so an
  // origin check alone would let these replace the app in the window.
  it.each([
    "file:///C:/Users/someone/evil.html",
    "app://elsewhere/",
    "ms-settings:privacy",
  ])("blocks %s, which is neither the app nor a web link", (url) => {
    expect(classifyNavigation(url, "app://local/")).toBe("blocked");
  });

  it.each(["http://[::1", "not a url", "", undefined])(
    "blocks the malformed URL %j instead of throwing",
    (url) => {
      expect(classifyNavigation(url, "app://local/")).toBe("blocked");
    },
  );
});
