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
  expect(screen.getByLabelText("Exact command arguments").textContent).toBe(
    'git --message "a  b & c"',
  );
  expect(screen.getByText("Folder: My repo")).toBeTruthy();
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

it("Given Windows paths, shows them as-is and puts plain Deny first with focus", () => {
  render(
    <CommandAskDialog
      ask={{
        id: "ask",
        pluginId: "p",
        pluginName: "Tool",
        executable: "git",
        argv: ["status"],
        folderName: "repo",
        signed: false,
        folderPath: "C:\\repo",
        resolvedExecutable: "C:\\Program Files\\Git\\cmd\\git.exe",
        risky: false,
        expiresAt: Date.now() + 120000,
      }}
      disabled={false}
      onAnswer={() => {}}
    />,
  );
  expect(
    screen.getByText("Executable: C:\\Program Files\\Git\\cmd\\git.exe"),
  ).toBeTruthy();
  expect(screen.getByText("C:\\repo")).toBeTruthy();
  const buttons = screen
    .getAllByRole("button")
    .filter((button) => button.textContent);
  expect(buttons.map((b) => b.textContent)).toEqual([
    "Deny",
    "Deny all from this plugin",
    "Always",
    "Allow once",
  ]);
  expect(document.activeElement).toBe(buttons[0]);
});

it("Given a folder name with a joiner and soft hyphen, escapes them", () => {
  render(
    <CommandAskDialog
      ask={{
        id: "ask",
        pluginId: "p",
        pluginName: "Tool",
        executable: "git",
        argv: [],
        folderName: "👨‍👩 re­port",
        signed: false,
        risky: false,
        expiresAt: Date.now() + 120000,
      }}
      disabled={false}
      onAnswer={() => {}}
    />,
  );
  expect(screen.getByText("Folder: 👨\\u{200D}👩 re\\u{AD}port")).toBeTruthy();
});
