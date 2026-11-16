// @vitest-environment jsdom
import { cleanup, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { AgentRunnerOverview } from "@ajour/shared/agent-runs";
import { installDomShims, renderRoutes } from "@/test-support/dom";
import { SettingsAgentsPage } from "./settings-agents-page";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("shows the selected agent's launcher refusal and recovery instructions beside its control", async () => {
  installDomShims();
  const refusalReason =
    "Ajour can't start Claude Code from C:\\tools\\claude.cmd because it doesn't recognise that launcher. Reinstall it with npm, pnpm or Yarn, or use its Windows .exe file.";
  const overview: AgentRunnerOverview = {
    settings: { cli: "claude-code", browserMode: "ajour-chrome", model: "" },
    clis: [
      {
        id: "claude-code",
        label: "Claude Code",
        installed: true,
        supported: true,
        refusalReason,
      },
      {
        id: "codex",
        label: "Codex",
        installed: true,
        supported: true,
        refusalReason: "Other agent's refusal",
      },
    ],
    tasks: [],
    currentRun: null,
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json(overview)),
  );
  await renderRoutes({ routes: { "/": SettingsAgentsPage } });
  const reason = await screen.findByText(refusalReason);
  const control = screen.getByRole("combobox", { name: "Agent" });
  expect(reason.closest(".settings-row")?.contains(control)).toBe(true);
  expect(screen.queryByText("Other agent's refusal")).toBeNull();
});
