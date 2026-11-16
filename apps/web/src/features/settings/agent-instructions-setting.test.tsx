// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { installDomShims, renderRoutes } from "@/test-support/dom";
import { AgentInstructionsSetting } from "./agent-instructions-setting";
installDomShims();
afterEach(() => {
  cleanup();
  delete window.ajourDesktop;
});
it("explains the desktop requirement in the web app", async () => {
  await renderRoutes({ routes: { "/": AgentInstructionsSetting } });
  expect(
    screen.getByText("Agent instructions need the Ajour desktop app."),
  ).toBeTruthy();
});
it("shows a diff before writing and keeps a write error visible", async () => {
  const apply = vi
    .fn()
    .mockRejectedValue(new Error("The instruction file is read-only."));
  window.ajourDesktop = {
    listAgentInstructions: vi.fn().mockResolvedValue([
      {
        id: "codex",
        path: "C:/fake/.codex/AGENTS.md",
        status: "missing file",
      },
    ]),
    previewAgentInstructions: vi.fn().mockResolvedValue({
      token: "preview",
      before: "",
      after: "## Thread naming\nexample",
    }),
    applyAgentInstructions: apply,
  };
  await renderRoutes({ routes: { "/": AgentInstructionsSetting } });
  fireEvent.click(await screen.findByRole("button", { name: "Add to Codex" }));
  await screen.findByRole("dialog");
  expect(screen.getByText(/\+## Thread naming/)).toBeTruthy();
  expect(apply).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Confirm Add" }));
  await waitFor(() => expect(apply).toHaveBeenCalledWith("codex", "preview"));
  expect(await screen.findByRole("alert")).toHaveProperty(
    "textContent",
    "The instruction file is read-only.",
  );
});

it("updates and removes after confirmation, cancels without writing and copies for Copilot", async () => {
  let status = "block outdated";
  const apply = vi.fn(async () => {
    status = status === "block outdated" ? "block current" : "no block";
  });
  const preview = vi
    .fn()
    .mockResolvedValue({ token: "reviewed", before: "old", after: "new" });
  const copy = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: copy },
  });
  window.ajourDesktop = {
    listAgentInstructions: vi.fn(async () => [
      {
        id: "claude" as const,
        path: "/fake/.claude/CLAUDE.md",
        status: status as "block outdated" | "block current" | "no block",
      },
    ]),
    previewAgentInstructions: preview,
    applyAgentInstructions: apply,
  };
  await renderRoutes({ routes: { "/": AgentInstructionsSetting } });
  fireEvent.click(
    await screen.findByRole("button", { name: "Update Claude Code" }),
  );
  fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
  expect(apply).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Update Claude Code" }));
  fireEvent.click(
    await screen.findByRole("button", { name: "Confirm Update" }),
  );
  await screen.findByText("block current");
  expect(preview).toHaveBeenLastCalledWith("claude", "update");
  fireEvent.click(
    screen.getByRole("button", { name: "Remove from Claude Code" }),
  );
  fireEvent.click(
    await screen.findByRole("button", { name: "Confirm Remove" }),
  );
  await screen.findByText("no block");
  expect(apply).toHaveBeenCalledTimes(2);
  fireEvent.click(screen.getByRole("button", { name: "Copy" }));
  await waitFor(() => expect(copy).toHaveBeenCalledOnce());
  expect(copy.mock.calls[0]?.[0]).toContain("<!-- ajour:thread-naming -->");
});
