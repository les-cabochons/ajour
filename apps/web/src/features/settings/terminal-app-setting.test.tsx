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
    const label = platform === "win32" ? "PowerShell" : "iTerm";
    const option = await screen.findByRole("option", { name: label });
    fireEvent.pointerEnter(option, { pointerType: "touch" });
    fireEvent.pointerDown(option, { pointerType: "touch" });
    fireEvent.click(option);
    await vi.waitFor(() =>
      expect(setTerminalApp).toHaveBeenCalledWith(
        platform === "win32" ? "powershell" : "iTerm",
      ),
    );
  },
);
