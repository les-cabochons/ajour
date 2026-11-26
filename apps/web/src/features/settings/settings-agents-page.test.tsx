// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
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
  /** Each request's answer, by URL, held until the test gives it. */
  const pending = new Map<string, (value: Response) => void>();
  vi.stubGlobal(
    "fetch",
    vi.fn(
      (input: RequestInfo | URL) =>
        new Promise<Response>((done) => {
          pending.set(new URL(String(input), "http://x").pathname, done);
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
    pending.get("/api/agents")!(
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

it("lists the repositories Deck may ask about, and revokes one", async () => {
  installDomShims();
  const overview: AgentRunnerOverview = {
    settings: { cli: "claude-code", browserMode: "ajour-chrome", model: "" },
    clis: [
      {
        id: "claude-code",
        label: "Claude Code",
        installed: true,
        supported: true,
      },
    ],
    tasks: [],
    currentRun: null,
  };
  const consent = {
    pluginId: "github",
    connectionId: "work",
    repository: "acme/billing-api",
    cli: "claude-code",
    cliVersion: "2.1.318",
    consentedAt: Date.UTC(2026, 10, 24, 12),
  };
  const fetch = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/api/deck/consents/revoke"))
      return Response.json({ consents: [] });
    if (url.endsWith("/api/deck/consents"))
      return Response.json({ consents: [consent] });
    return Response.json(overview);
  });
  vi.stubGlobal("fetch", fetch);
  await renderRoutes({ routes: { "/": SettingsAgentsPage } });

  const section = (
    await screen.findByRole("heading", {
      name: "Questions about pull requests",
    })
  ).closest("section")!;
  const row = await within(section).findByText("acme/billing-api");
  expect(row.closest(".settings-row")?.textContent).toContain("Claude Code");

  fireEvent.click(
    within(section).getByRole("button", { name: "Revoke acme/billing-api" }),
  );

  await waitFor(() =>
    expect(within(section).queryByText("acme/billing-api")).toBeNull(),
  );
  const revoke = fetch.mock.calls.find(([url]) =>
    String(url).endsWith("/api/deck/consents/revoke"),
  )!;
  expect(JSON.parse(String(revoke[1]?.body))).toEqual({
    pluginId: "github",
    connectionId: "work",
    repository: "acme/billing-api",
  });
  expect(
    within(section).getByText(
      "None yet. Deck asks the first time you ask about a repository's pull request.",
    ),
  ).toBeTruthy();
});

it("lists the local clones Deck's answers read, and forgets one", async () => {
  installDomShims();
  const overview: AgentRunnerOverview = {
    settings: { cli: "claude-code", browserMode: "ajour-chrome", model: "" },
    clis: [],
    tasks: [],
    currentRun: null,
  };
  const clone = {
    pluginId: "github",
    connectionId: "work",
    repository: "acme/billing-api",
    environment: { kind: "wsl", distro: "Ubuntu" },
    path: "/home/alex/src/billing-api",
    remote: "origin",
    chosenAt: 1,
  };
  const fetch = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/api/deck/clones/forget"))
      return Response.json({ clones: [] });
    if (url.endsWith("/api/deck/clones"))
      return Response.json({ clones: [clone] });
    if (url.endsWith("/api/deck/consents"))
      return Response.json({ consents: [] });
    return Response.json(overview);
  });
  vi.stubGlobal("fetch", fetch);
  await renderRoutes({ routes: { "/": SettingsAgentsPage } });

  const section = (
    await screen.findByRole("heading", { name: "Local clones" })
  ).closest("section")!;
  const row = await within(section).findByText("acme/billing-api");
  expect(row.closest(".settings-row")?.textContent).toContain(
    "/home/alex/src/billing-api · WSL Ubuntu",
  );

  fireEvent.click(
    within(section).getByRole("button", {
      name: "Forget the clone of acme/billing-api",
    }),
  );

  await waitFor(() =>
    expect(within(section).queryByText("acme/billing-api")).toBeNull(),
  );
  const forget = fetch.mock.calls.find(([url]) =>
    String(url).endsWith("/api/deck/clones/forget"),
  )!;
  expect(JSON.parse(String(forget[1]?.body))).toEqual({
    pluginId: "github",
    connectionId: "work",
    repository: "acme/billing-api",
  });
});
