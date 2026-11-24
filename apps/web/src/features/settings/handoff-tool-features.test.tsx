// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  screen,
  waitFor,
} from "@testing-library/react";

const api = vi.hoisted(() => ({
  getHandoffToolSwitches: vi.fn(),
  setHandoffToolEnabled: vi.fn(),
  getPluginsOverview: vi.fn(),
}));
vi.mock("@/lib/app-api", () => api);
const tools_ = vi.hoisted(() => ({ forgetHandoffToolDetection: vi.fn() }));
vi.mock("@/lib/handoff-tools", () => tools_);

import { PluginHandoffTools } from "./handoff-tool-features";
import { installDomShims, renderRoutes } from "@/test-support/dom";
import { requestChooseHandoffTools } from "@/features/backlog/handoff-request";

installDomShims();
afterEach(cleanup);
beforeEach(() => {
  api.getHandoffToolSwitches.mockReset().mockResolvedValue({ enabled: [] });
  api.setHandoffToolEnabled.mockReset();
  api.getPluginsOverview.mockReset().mockResolvedValue({});
  tools_.forgetHandoffToolDetection.mockReset();
});

const tools = [
  {
    id: "claude",
    label: "Claude Code",
    followsState: true,
    hooks: true,
    closesThreads: "archive" as const,
  },
  { id: "t3", label: "T3 Code", followsState: true, listsThreads: true },
  { id: "copilot", label: "Copilot CLI", followsState: false },
  {
    id: "opencode",
    label: "OpenCode",
    followsState: true,
    closesThreads: "delete" as const,
  },
];

function render(
  path = "/",
  listed: Parameters<typeof PluginHandoffTools>[0]["tools"] = tools,
) {
  return renderRoutes({
    path,
    routes: {
      "/": () => (
        <>
          <button type="button">Elsewhere</button>
          <PluginHandoffTools pluginId="agent-handoff" tools={listed} />
        </>
      ),
    },
  });
}

it("lists each handoff tool with the features it supports", async () => {
  await render();
  expect(
    await screen.findByRole("heading", { name: "Handoff tools" }),
  ).toBeTruthy();
  const row = (label: string) =>
    screen.getByText(label).closest(".settings-row")!.textContent;
  expect(row("Claude Code")).toContain(
    "Starts threads · Follows state · Updates within seconds · Closes threads",
  );
  // A tool that closes a thread by deleting it says so (#850).
  expect(row("OpenCode")).toContain(
    "Starts threads · Follows state · Deletes threads",
  );
  expect(row("T3 Code")).not.toContain("Closes threads");
  // Only a tool that says it posts hooks updates within seconds.
  expect(row("T3 Code")).toContain(
    "Starts threads · Follows state · Finds threads",
  );
  expect(row("T3 Code")).not.toContain("Updates within seconds");
  expect(row("Copilot CLI")).toContain("Starts threads");
  expect(row("Copilot CLI")).not.toContain("Follows state");
  expect(row("Copilot CLI")).not.toContain("Updates within seconds");
  // Tools that run each other show the same work under each one that is on.
  expect(
    screen.getByText(/T3 Code, which runs Codex and Claude Code threads/),
  ).toBeTruthy();
});

it("says which tool makes its own worktree (#859)", async () => {
  await render("/", [
    {
      id: "own",
      label: "Own worktree tool",
      listsThreads: true,
      ownWorktree: true,
    },
    { id: "plain", label: "Plain tool" },
  ]);
  await screen.findByRole("switch", { name: "Use Own worktree tool" });
  const row = (label: string) =>
    screen.getByText(label).closest(".settings-row")!.textContent;
  expect(row("Own worktree tool")).toContain(
    "Starts threads · Follows state · Finds threads · Makes its own worktree",
  );
  // A tool without the value reads as before.
  expect(row("Plain tool")).toContain("Starts threads · Follows state");
  expect(row("Plain tool")).not.toContain("Makes its own worktree");
});

it("starts every tool off, and turns one on and off by its switch", async () => {
  api.getHandoffToolSwitches.mockResolvedValue({ enabled: ["claude"] });
  api.setHandoffToolEnabled.mockImplementation(
    async (_plugin: string, toolId: string, enabled: boolean) => ({
      enabled: enabled ? ["claude", toolId] : ["claude"],
    }),
  );
  await render();
  const t3 = await screen.findByRole("switch", { name: "Use T3 Code" });
  await waitFor(() => expect(t3.hasAttribute("data-disabled")).toBe(false));
  const claude = screen.getByRole("switch", { name: "Use Claude Code" });
  expect(claude.getAttribute("aria-checked")).toBe("true");
  expect(t3.getAttribute("aria-checked")).toBe("false");
  expect(api.getHandoffToolSwitches).toHaveBeenCalledWith("agent-handoff");

  fireEvent.click(t3);
  await waitFor(() =>
    expect(api.setHandoffToolEnabled).toHaveBeenCalledWith(
      "agent-handoff",
      "t3",
      true,
    ),
  );
  await waitFor(() => expect(t3.getAttribute("aria-checked")).toBe("true"));
  // The menus and detection follow the new switches.
  expect(api.getPluginsOverview).toHaveBeenCalled();
  expect(tools_.forgetHandoffToolDetection).toHaveBeenCalledWith(
    "agent-handoff",
  );

  fireEvent.click(t3);
  await waitFor(() => expect(t3.getAttribute("aria-checked")).toBe("false"));
  expect(api.setHandoffToolEnabled).toHaveBeenLastCalledWith(
    "agent-handoff",
    "t3",
    false,
  );
});

it("keeps the switch as it was and says why when the save fails", async () => {
  api.setHandoffToolEnabled.mockRejectedValue(
    new Error('The plugin has no handoff tool "t3".'),
  );
  await render();
  const t3 = await screen.findByRole("switch", { name: "Use T3 Code" });
  await waitFor(() => expect(t3.hasAttribute("data-disabled")).toBe(false));
  fireEvent.click(t3);
  expect((await screen.findByRole("alert")).textContent).toBe(
    'The plugin has no handoff tool "t3".',
  );
  expect(t3.getAttribute("aria-checked")).toBe("false");
});

it("takes focus to its heading once the switches load when Choose your tools opens it, and again on the next request", async () => {
  let load!: (value: { enabled: string[] }) => void;
  api.getHandoffToolSwitches.mockReturnValue(
    new Promise((resolve) => (load = resolve)),
  );
  const scrolled = vi.spyOn(Element.prototype, "scrollIntoView");
  await render("/?section=handoff-tools");
  const heading = screen.getByRole("heading", { name: "Handoff tools" });
  // Content above can still grow while the switches load: no scroll yet.
  expect(document.activeElement).not.toBe(heading);
  await act(async () => load({ enabled: [] }));
  await waitFor(() => expect(document.activeElement).toBe(heading));
  expect(scrolled.mock.contexts).toContain(
    heading.closest("section") as Element,
  );

  // The page is already open at the section: a second request still moves
  // the reader there.
  screen.getByRole("button", { name: "Elsewhere" }).focus();
  act(() => requestChooseHandoffTools());
  await waitFor(() => expect(document.activeElement).toBe(heading));
  scrolled.mockRestore();
});

it("leaves focus alone when the page opens without the section", async () => {
  await render();
  const elsewhere = screen.getByRole("button", { name: "Elsewhere" });
  elsewhere.focus();
  await screen.findByRole("switch", { name: "Use T3 Code" });
  await waitFor(() =>
    expect(api.getHandoffToolSwitches).toHaveBeenCalledTimes(1),
  );
  act(() => requestChooseHandoffTools());
  expect(document.activeElement).toBe(elsewhere);
});
