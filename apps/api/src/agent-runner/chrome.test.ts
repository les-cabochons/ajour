import { describe, expect, it } from "vitest";
import { isChromeInstalled } from "./chrome.ts";

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
    expect(seen[0]).toContain("Google Chrome.app");
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
