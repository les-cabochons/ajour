// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { AgentRunnerOverview } from "@ajour/shared/agent-runs";
import { installDomShims, renderRoutes } from "@/test-support/dom";
import { SettingsAgentsPage } from "./settings-agents-page";

afterEach(() => {
  cleanup();
  delete window.ajourDesktop;
  vi.unstubAllGlobals();
});

it("keeps the instructions tree and dialog mounted when the runner loads without refetching", async () => {
  installDomShims();
  let resolve!: (value: Response) => void;
  vi.stubGlobal(
    "fetch",
    vi.fn(
      () =>
        new Promise<Response>((done) => {
          resolve = done;
        }),
    ),
  );
  const list = vi
    .fn()
    .mockResolvedValue([
      { id: "codex", path: "/fake/AGENTS.md", status: "missing file" },
    ]);
  window.ajourDesktop = {
    listAgentInstructions: list,
    previewAgentInstructions: vi
      .fn()
      .mockResolvedValue({ token: "t", before: "", after: "block" }),
    applyAgentInstructions: vi.fn(),
  };
  await renderRoutes({ routes: { "/": SettingsAgentsPage } });
  const heading = screen.getByRole("heading", { name: "Agent instructions" });
  fireEvent.click(await screen.findByRole("button", { name: "Add to Codex" }));
  const dialog = await screen.findByRole("dialog");
  await act(async () =>
    resolve(
      Response.json({
        settings: { cli: null, browserMode: "ajour-chrome", model: "" },
        clis: [],
        tasks: [],
        currentRun: null,
      }),
    ),
  );
  await waitFor(() =>
    expect(document.getElementById("agent-cli")).toBeTruthy(),
  );
  expect(screen.getByText("Agent instructions")).toBe(heading);
  expect(screen.getByRole("dialog")).toBe(dialog);
  expect(list).toHaveBeenCalledOnce();
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
  expect(screen.getAllByText(/need the Ajour desktop app/)).toHaveLength(1);
});
