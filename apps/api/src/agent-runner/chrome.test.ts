import path from "node:path";
import { describe, expect, it } from "vitest";
import { isChromeInstalled } from "./chrome.ts";

// The host's path module joins the macOS locations, so expected paths are
// joined the same way and the macOS cases also run on Windows.
const MAC_BINARY = "Google Chrome.app/Contents/MacOS/Google Chrome";

describe("isChromeInstalled", () => {
  it("looks in /Applications on macOS", async () => {
    const seen: string[] = [];
    const installed = await isChromeInstalled({
      platform: "darwin",
      exists: async (candidate) => {
        seen.push(candidate);
        return true;
      },
    });
    expect(installed).toBe(true);
    expect(seen[0]).toBe(path.join("/Applications", MAC_BINARY));
  });

  it("also looks in the user's Applications folder on macOS", async () => {
    const userCopy = path.join("/Users/a", "Applications", MAC_BINARY);
    const seen: string[] = [];
    const installed = await isChromeInstalled({
      platform: "darwin",
      env: { HOME: "/Users/a" },
      exists: async (candidate) => {
        seen.push(candidate);
        return candidate === userCopy;
      },
    });
    expect(installed).toBe(true);
    expect(seen).toEqual([path.join("/Applications", MAC_BINARY), userCopy]);
  });

  it("is false when Chrome is nowhere", async () => {
    expect(
      await isChromeInstalled({
        platform: "win32",
        env: { PROGRAMFILES: "C:\\Program Files" },
        exists: async () => false,
      }),
    ).toBe(false);
  });
});
