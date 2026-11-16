// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { installDomShims } from "@/test-support/dom";
import { TerminalAppSetting } from "./terminal-app-setting";
beforeEach(installDomShims);
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it.each(["win32", "darwin"])(
  "Given %s, offers its terminal apps and saves the selection",
  async (platform) => {
    const setTerminalApp = vi.fn(async (value: string) => value);
    Object.defineProperty(window, "ajourDesktop", {
      configurable: true,
      value: {
        runtime: { platform },
        getTerminalApp: async () => (platform === "win32" ? "wt" : "Terminal"),
        setTerminalApp,
      },
    });
    render(<TerminalAppSetting />);
    const trigger = await screen.findByRole("combobox", {
      name: "Terminal app",
    });
    await vi.waitFor(() =>
      expect(trigger.hasAttribute("disabled")).toBe(false),
    );
    fireEvent.click(trigger);
    expect(
      await screen.findByRole("option", {
        name: platform === "win32" ? "Windows Terminal" : "Terminal",
      }),
    ).toBeTruthy();
    expect(screen.queryByRole("option", { name: "PowerShell" })).toBeNull();
    expect(screen.queryByRole("option", { name: "Command Prompt" })).toBeNull();
    expect(screen.queryByRole("option", { name: "iTerm" })).toBeNull();
  },
);
it("Given Linux, hides the terminal preference", () => {
  Object.defineProperty(window, "ajourDesktop", {
    configurable: true,
    value: {
      runtime: { platform: "linux" },
      getTerminalApp: async () => "Terminal",
      setTerminalApp: vi.fn(),
    },
  });
  render(<TerminalAppSetting />);
  expect(screen.queryByRole("combobox")).toBeNull();
});
it("Given a read failure, keeps the error in the fixed-height row description", async () => {
  Object.defineProperty(window, "ajourDesktop", {
    configurable: true,
    value: {
      runtime: { platform: "win32" },
      getTerminalApp: async () => {
        throw new Error("failed");
      },
      setTerminalApp: vi.fn(),
    },
  });
  render(<TerminalAppSetting />);
  const error = await screen.findByText("Couldn't read the terminal app.");
  expect(error.className).toContain("text-destructive");
  expect(error.parentElement?.className).toContain("h-8");
});
