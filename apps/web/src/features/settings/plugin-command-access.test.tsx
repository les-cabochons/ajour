// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { CommandAccessControls } from "./plugin-command-access";
import { installDomShims } from "@/test-support/dom";
installDomShims();
afterEach(cleanup);
it("Given Accept everything, Access names the G1 loss in red and removes exact approvals", () => {
  const change = vi.fn();
  render(
    <CommandAccessControls
      disabled={false}
      onChange={change}
      access={{
        mode: "accept-everything",
        approvals: [
          {
            id: "a",
            executable: "git",
            argv: ["--version"],
            cwdFolder: "repo",
          },
        ],
      }}
    />,
  );
  expect(screen.getByRole("alert").textContent).toContain(
    "every plugin's credentials",
  );
  expect(screen.getByRole("alert").className).toContain("text-destructive");
  expect(screen.getByLabelText("Command mode").textContent).toContain(
    "Accept everything",
  );
  fireEvent.click(screen.getByRole("button", { name: "Remove" }));
  expect(change).toHaveBeenCalledWith({ remove: "a" });
});

it("Given the mode selector, a user can choose Auto", async () => {
  const change = vi.fn();
  render(
    <CommandAccessControls
      disabled={false}
      onChange={change}
      access={{ mode: "always-ask", approvals: [] }}
    />,
  );
  fireEvent.click(screen.getByRole("combobox", { name: "Command mode" }));
  const option = await screen.findByRole("option", { name: "Auto" });
  fireEvent.keyDown(option, { key: "Enter" });
  fireEvent.click(option);
  expect(change).toHaveBeenCalledWith({ mode: "auto" });
});

it.each(["always-ask", "auto", "accept-everything"] as const)(
  "Given %s, process access warns outside G1",
  (mode) => {
    render(
      <CommandAccessControls
        access={{ mode, approvals: [] }}
        disabled={false}
        onChange={() => {}}
      />,
    );
    expect(screen.getByRole("note").textContent).toContain(
      "every plugin's credentials in every mode",
    );
    expect(screen.getByRole("note").textContent).toContain(
      "their own or another plugin's",
    );
  },
);
it("Given a remembered folder, shows its name and path and visible non-ASCII whitespace", () => {
  render(
    <CommandAccessControls
      access={{
        mode: "auto",
        approvals: [
          {
            id: "a",
            executable: "git",
            argv: ["a\u00a0b"],
            cwdFolder: "opaque-id",
            folderName: "Repo",
            folderPath: "C:\\repo",
          },
          {
            id: "b",
            executable: "C:\\Program Files\\Git\\cmd\\git.exe",
            argv: ["-C", "C:\\repo", "status"],
          },
        ],
      }}
      disabled={false}
      onChange={() => {}}
    />,
  );
  expect(screen.getAllByText(/Folder:/)[0]!.textContent).toBe(
    "Folder: Repo C:\\repo",
  );
  expect(document.body.textContent).not.toContain("opaque-id");
  expect(screen.getByText("git a\\u{A0}b")).toBeTruthy();
  expect(
    screen.getByText(
      '"C:\\Program Files\\Git\\cmd\\git.exe" -C C:\\repo status',
    ),
  ).toBeTruthy();
});
