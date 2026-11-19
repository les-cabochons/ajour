// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import type { HandoffThreadOffer } from "@ajour/shared/handoff-threads";
import { Toaster } from "@/components/ui/toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import * as api from "@/lib/app-api";
import { AppApiError, cachePluginsOverview } from "@/lib/app-api";
import { localStore } from "@/lib/local-store";
import { setHandoffs } from "@/lib/handoffs";
import {
  resetHandoffToolDetections,
  resetLastHandoffTool,
} from "@/lib/handoff-tools";
import { useLocalState } from "@/lib/local-hooks";
import { installDomShims, renderRoutes } from "@/test-support/dom";
import { HandoffButton } from "./handoff-button";
import { HandoffHost } from "./handoff-workflow";
import { isHandoffStarting } from "./handoff-request";
import {
  handoffOverview,
  handoffRecord,
} from "../../../tests/fixtures/handoffs";

// A refused start the window can act on (#819): the tool's setting it
// refused is asked for, and a branch that exists offers the item's thread.

vi.mock("@/lib/app-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/app-api")>()),
  adoptHandoffThread: vi.fn(),
  detectHandoffTools: vi.fn(),
  findHandoffThreads: vi.fn(),
  getHandoffTemplates: vi.fn(),
  listHandoffs: vi.fn(),
  listRepositoryFolders: vi.fn(),
  startHandoff: vi.fn(),
  useRepositoryFolder: vi.fn(),
}));
// A local item has no key a thread could name, so this one answers to PAY-12.
vi.mock("@/domain/handoffs/handoffs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/domain/handoffs/handoffs")>()),
  getHandoffItemKeys: () => ["PAY-12"],
}));

beforeAll(installDomShims);

let itemId = "";
let projectId = "";
let run = 0;

const refused = (body: Record<string, unknown>) =>
  new AppApiError(String(body.error), 409, undefined, body);

const offer = (toolId: string, title: string): HandoffThreadOffer => ({
  pluginId: "agent-handoff",
  toolId,
  folderId: "folder-1",
  threadId: `${toolId}-thread`,
  title,
});

beforeEach(() => {
  window.localStorage.removeItem("ajour.handoff-last-tool");
  // The provider notice was seen, so Hand off starts in one click.
  window.localStorage.setItem(
    "ajour.handoff-notices",
    JSON.stringify(["agent-handoff:t3"]),
  );
  resetLastHandoffTool();
  resetHandoffToolDetections();
  window.ajourDesktop = { chooseFolder: vi.fn() };
  cachePluginsOverview(handoffOverview());
  setHandoffs([]);
  vi.mocked(api.listHandoffs).mockResolvedValue([]);
  vi.mocked(api.detectHandoffTools).mockResolvedValue({
    tools: [{ id: "t3", available: true }],
  });
  vi.mocked(api.getHandoffTemplates).mockResolvedValue({
    prompt: "{{item.title}}",
    title: "[{{item.key}}] {{item.title}}",
    branch: "{{item.key|slug}}",
  });
  vi.mocked(api.useRepositoryFolder).mockResolvedValue([]);
  const projectName = `Refusals ${++run}`;
  act(() => {
    localStore.addProject({ name: projectName, color: "#336699" });
  });
  projectId = localStore
    .snapshot()
    .projects.find((project) => project.name === projectName)!._id;
  act(() => {
    localStore.addWorkItem({ title: "Fix login redirect", projectId });
  });
  itemId = localStore
    .snapshot()
    .workItems.find((item) => item.projectId === projectId)!._id;
  vi.mocked(api.listRepositoryFolders).mockResolvedValue([
    { id: "folder-1", projectId, name: "payments", path: "/work/payments" },
  ]);
});

afterEach(() => {
  cleanup();
  delete window.ajourDesktop;
  vi.resetAllMocks();
});

function Page() {
  const state = useLocalState();
  const item = state.workItems.find((candidate) => candidate._id === itemId);
  return (
    <TooltipProvider>
      {item ? <HandoffButton item={item} /> : null}
      <HandoffHost />
      <Toaster />
    </TooltipProvider>
  );
}

/** The dialog that asks for a refused setting; toasts are dialogs too. */
const settingDialog = () =>
  screen.queryByRole("dialog", { name: "Hand off to T3 Code" });

async function handOff() {
  await renderRoutes({ routes: { "/": Page } });
  fireEvent.click(
    await screen.findByRole("button", { name: /Hand off to T3 Code/ }),
  );
}

it("asks for the setting the tool refused, filled with the value it refused, and hands off again with the answer", async () => {
  vi.mocked(api.startHandoff)
    .mockRejectedValueOnce(
      refused({
        error: 'Neither "main" nor "master" exists in payments.',
        setting: {
          id: "base",
          label: "Worktree base",
          helpText: "The branch the worktree starts from.",
          value: "main",
        },
      }),
    )
    .mockImplementationOnce(async (input) =>
      handoffRecord({
        id: "started",
        workItemId: input.workItemId,
        projectId: input.projectId,
        folderId: input.folderId,
      }),
    );
  await handOff();

  const dialog = await screen.findByRole("dialog");
  expect(dialog.textContent).toContain(
    'Neither "main" nor "master" exists in payments.',
  );
  expect(dialog.textContent).toContain(
    "Ajour uses it for the next hand offs from payments.",
  );
  const input = within(dialog).getByLabelText("Worktree base");
  expect(input).toHaveProperty("value", "main");
  expect(isHandoffStarting(itemId)).toBe(true);

  fireEvent.change(input, { target: { value: " develop " } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Hand off" }));

  await waitFor(() => expect(settingDialog()).toBeNull());
  expect(api.startHandoff).toHaveBeenLastCalledWith(
    expect.objectContaining({ settings: { base: "develop" } }),
  );
  expect(
    (await screen.findAllByText("Handed off to T3 Code")).length,
  ).toBeGreaterThan(0);
  expect(isHandoffStarting(itemId)).toBe(false);
});

it("asks again with the tool's new reason when it refuses the answer, and Cancel ends the hand off", async () => {
  vi.mocked(api.startHandoff)
    .mockRejectedValueOnce(
      refused({
        error: 'Base ref "main" does not resolve.',
        setting: { id: "base", label: "Worktree base" },
      }),
    )
    .mockRejectedValueOnce(
      refused({
        error: 'Base ref "dev" does not resolve.',
        setting: { id: "base", label: "Worktree base", value: "dev" },
      }),
    );
  await handOff();

  let dialog = await screen.findByRole("dialog");
  fireEvent.change(within(dialog).getByLabelText("Worktree base"), {
    target: { value: "dev" },
  });
  fireEvent.click(within(dialog).getByRole("button", { name: "Hand off" }));

  await waitFor(() =>
    expect(screen.getByRole("dialog").textContent).toContain(
      'Base ref "dev" does not resolve.',
    ),
  );
  dialog = screen.getByRole("dialog");
  expect(within(dialog).getByLabelText("Worktree base")).toHaveProperty(
    "value",
    "dev",
  );
  fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
  await waitFor(() => expect(settingDialog()).toBeNull());
  expect(isHandoffStarting(itemId)).toBe(false);
});

it("keeps a dialog the user closed while its start ran closed when the tool refuses again, and says why in a toast", async () => {
  let refuseAgain: (error: unknown) => void = () => {};
  vi.mocked(api.startHandoff)
    .mockRejectedValueOnce(
      refused({
        error: 'Base ref "main" does not resolve.',
        setting: { id: "base", label: "Worktree base" },
      }),
    )
    .mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          refuseAgain = reject;
        }),
    );
  await handOff();

  const dialog = await screen.findByRole("dialog");
  fireEvent.change(within(dialog).getByLabelText("Worktree base"), {
    target: { value: "dev" },
  });
  fireEvent.click(within(dialog).getByRole("button", { name: "Hand off" }));
  await waitFor(() => expect(api.startHandoff).toHaveBeenCalledTimes(2));
  fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
  await waitFor(() => expect(settingDialog()).toBeNull());

  await act(async () => {
    refuseAgain(
      refused({
        error: 'Base ref "dev" does not resolve.',
        setting: { id: "base", label: "Worktree base", value: "dev" },
      }),
    );
  });
  expect(
    (await screen.findAllByText("Couldn't hand off to T3 Code")).length,
  ).toBeGreaterThan(0);
  expect(settingDialog()).toBeNull();
  expect(isHandoffStarting(itemId)).toBe(false);
});

it("offers the item's thread in the same tool when the branch exists, and links it", async () => {
  vi.mocked(api.startHandoff).mockRejectedValue(
    refused({
      error: 'Branch "pay-12" already exists in project "payments".',
      branchExists: true,
    }),
  );
  vi.mocked(api.findHandoffThreads).mockResolvedValue({
    offers: [
      offer("claude", "[PAY-12] Another tool's session"),
      offer("t3", "[PAY-12] Fix login redirect"),
    ],
  });
  vi.mocked(api.adoptHandoffThread).mockResolvedValue(
    handoffRecord({ id: "linked", workItemId: itemId, projectId }),
  );
  await handOff();

  const dialog = await screen.findByRole("alertdialog");
  expect(dialog.textContent).toContain("Link the existing thread?");
  expect(dialog.textContent).toContain(
    'T3 Code already has this item\'s branch, in the thread "[PAY-12] Fix login redirect".',
  );
  expect(api.findHandoffThreads).toHaveBeenCalledWith(projectId, itemId, [
    "PAY-12",
  ]);
  fireEvent.click(within(dialog).getByRole("button", { name: "Link thread" }));

  await waitFor(() =>
    expect(api.adoptHandoffThread).toHaveBeenCalledWith({
      pluginId: "agent-handoff",
      toolId: "t3",
      folderId: "folder-1",
      threadId: "t3-thread",
      projectId,
      workItemId: itemId,
    }),
  );
  expect(
    (await screen.findAllByText("Linked the thread in T3 Code.")).length,
  ).toBeGreaterThan(0);
});

it("shows the tool's refusal when no thread of that tool names the item", async () => {
  vi.mocked(api.startHandoff).mockRejectedValue(
    refused({
      error: 'Branch "pay-12" already exists in project "payments".',
      branchExists: true,
    }),
  );
  vi.mocked(api.findHandoffThreads).mockResolvedValue({
    offers: [offer("claude", "[PAY-12] Another tool's session")],
  });
  await handOff();

  expect(
    (await screen.findAllByText("Couldn't hand off to T3 Code")).length,
  ).toBeGreaterThan(0);
  expect(
    screen.getAllByText('Branch "pay-12" already exists in project "payments".')
      .length,
  ).toBeGreaterThan(0);
  expect(screen.queryByText("Link the existing thread?")).toBeNull();
});
