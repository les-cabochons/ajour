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
