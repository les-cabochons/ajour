import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const {
  getPlatformWindowChromeOptions,
  getWindowsTitleBarOverlay,
} = require("./electron/window-chrome.cjs") as {
  getPlatformWindowChromeOptions: (
    platform: NodeJS.Platform,
    theme: "dark" | "light",
  ) => Record<string, unknown>;
  getWindowsTitleBarOverlay: (theme: "dark" | "light") => {
    color: string;
    symbolColor: string;
    height: number;
  };
};

describe("desktop window chrome", () => {
  it("keeps the existing inset macOS traffic lights", () => {
    expect(getPlatformWindowChromeOptions("darwin", "dark")).toEqual({
      titleBarStyle: "hidden",
      trafficLightPosition: { x: 16, y: 18 },
    });
  });

  it("overlays native Windows controls without the standard title bar", () => {
    expect(getPlatformWindowChromeOptions("win32", "dark")).toEqual({
      titleBarStyle: "hidden",
      titleBarOverlay: {
        color: "#00000000",
        symbolColor: "#fafafa",
        height: 48,
      },
    });
  });

  it("leaves other platforms on their native window frame", () => {
    expect(getPlatformWindowChromeOptions("linux", "dark")).toEqual({});
  });

  it("provides accessible overlay colors for both app themes", () => {
    expect(getWindowsTitleBarOverlay("light")).toMatchObject({
      color: "#00000000",
      symbolColor: "#252525",
    });
    expect(getWindowsTitleBarOverlay("dark")).toMatchObject({
      color: "#00000000",
      symbolColor: "#fafafa",
    });
  });
});
