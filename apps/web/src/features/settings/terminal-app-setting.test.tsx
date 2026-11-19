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
it("Given the terminals main found, offers them and saves the pick", async () => {
  const setTerminalApp = vi.fn(async (value: string) => value);
  Object.defineProperty(window, "ajourDesktop", {
    configurable: true,
    value: {
      runtime: { platform: "darwin" },
      getTerminalApp: async () => ({
        value: "Terminal",
        choices: [
          { value: "Terminal", label: "Terminal" },
          { value: "iTerm", label: "iTerm2" },
          { value: "Ghostty", label: "Ghostty" },
        ],
      }),
      setTerminalApp,
    },
  });
  render(<TerminalAppSetting />);
  const trigger = await screen.findByRole("combobox", {
    name: "Terminal app",
  });
  await vi.waitFor(() => expect(trigger.hasAttribute("disabled")).toBe(false));
  fireEvent.click(trigger);
  expect(
    (await screen.findAllByRole("option")).map((option) => option.textContent),
  ).toEqual(["Terminal", "iTerm2", "Ghostty"]);
  // Base UI's select picks on Enter then click, as a pointer does.
  const ghostty = screen.getByRole("option", { name: "Ghostty" });
  fireEvent.keyDown(ghostty, { key: "Enter" });
  fireEvent.click(ghostty);
  await vi.waitFor(() => expect(setTerminalApp).toHaveBeenCalledWith("Ghostty"));
});
it("Given Linux, hides the terminal preference", () => {
  Object.defineProperty(window, "ajourDesktop", {
    configurable: true,
    value: {
      runtime: { platform: "linux" },
      getTerminalApp: async () => ({ value: undefined, choices: [] }),
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
