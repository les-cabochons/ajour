// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import {
  cleanup,
  render,
  screen,
  fireEvent,
  act,
} from "@testing-library/react";
import { CommandAskDialog } from "./command-ask-dialog";
import { installDomShims } from "@/test-support/dom";
installDomShims();
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
it.each([
  ["Allow once", "once"],
  ["Always", "always"],
  ["Deny", "deny"],
] as const)("Given exact arguments, %s answers %s", async (label, answer) => {
  vi.useFakeTimers();
  const onAnswer = vi.fn();
  render(
    <CommandAskDialog
      ask={{
        id: "ask",
        pluginId: "p",
        pluginName: "Tool",
        executable: "git",
        argv: ["--message", "a  b & c"],
        folderName: "My repo",
        signed: true,
        folderPath: "C:/repo",
        resolvedExecutable: "C:/tools/git.exe",
        risky: true,
        reason: "Sends data out",
        expiresAt: Date.now() + 120000,
      }}
      disabled={false}
      onAnswer={onAnswer}
    />,
  );
  expect(
    JSON.parse(screen.getByLabelText("Exact command arguments").textContent!),
  ).toEqual(["git", "--message", "a  b & c"]);
  expect(screen.getByText('Folder: "My repo"')).toBeTruthy();
  expect(screen.getByText("Sends data out").className).toContain(
    "text-destructive",
  );
  if (answer !== "deny") {
    expect(
      (screen.getByRole("button", { name: label }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    await act(() => vi.advanceTimersByTimeAsync(600));
  }
  fireEvent.click(screen.getByRole("button", { name: label }));
  expect(onAnswer).toHaveBeenCalledWith(answer);
});
