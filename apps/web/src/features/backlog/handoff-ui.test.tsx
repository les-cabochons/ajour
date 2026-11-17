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
import type { Handoff } from "@ajour/shared/handoffs";
import { Toaster } from "@/components/ui/toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import * as api from "@/lib/app-api";
import { cachePluginsOverview } from "@/lib/app-api";
import { localStore } from "@/lib/local-store";
import { setHandoffs, useHandoffs } from "@/lib/handoffs";
import {
  resetHandoffToolDetections,
  resetLastHandoffTool,
  useAllHandoffTools,
  useHandoffTools,
} from "@/lib/handoff-tools";
import { useLocalState } from "@/lib/local-hooks";
import { installDomShims, renderRoutes } from "@/test-support/dom";
import { ShortcutProvider } from "@/lib/shortcut-handlers";
import { CommandPalette } from "@/features/command-palette/command-palette";
import { HandoffButton } from "./handoff-button";
import { HandoffHost } from "./handoff-workflow";
import { isHandoffStarting, requestHandoff } from "./handoff-request";
import { runBacklogItemAction } from "./backlog-item-actions";
import { HandoffsCard } from "./backlog-item-side-cards";
import { getBacklogSurfaceActions } from "./backlog-item-surface";
import {
  handoffOverview,
  handoffRecord,
} from "../../../tests/fixtures/handoffs";

vi.mock("@/lib/app-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/app-api")>()),
  detectHandoffTools: vi.fn(),
  getHandoffTemplates: vi.fn(),
  listHandoffs: vi.fn(),
  listRepositoryFolders: vi.fn(),
  openHandoff: vi.fn(),
  refreshHandoffs: vi.fn(),
  removeHandoff: vi.fn(),
  startHandoff: vi.fn(),
  useRepositoryFolder: vi.fn(),
}));

beforeAll(installDomShims);

const folder = {
  id: "folder-1",
  projectId: "",
  name: "payments",
  path: "C:\\work\\payments",
};

let itemId = "";
let projectId = "";
let projectName = "";
let run = 0;

beforeEach(() => {
  // The store keeps its state in storage too, so only the device choices go.
  for (const key of ["ajour.handoff-last-tool", "ajour.handoff-notices"])
    window.localStorage.removeItem(key);
  resetLastHandoffTool();
  resetHandoffToolDetections();
  window.ajourDesktop = { chooseFolder: vi.fn() };
  cachePluginsOverview(handoffOverview());
  setHandoffs([]);
  vi.mocked(api.listHandoffs).mockResolvedValue([]);
  vi.mocked(api.detectHandoffTools).mockResolvedValue({
    tools: [
      { id: "t3", available: true },
      { id: "claude", available: false, reason: "claude isn't on PATH." },
    ],
  });
  vi.mocked(api.getHandoffTemplates).mockResolvedValue({
    prompt: "{{item.key}} {{item.title}} in {{repo.name}}",
    title: "[{{item.key}}] {{item.title}}",
    branch: "{{item.key|slug}}-{{item.title|slug}}",
  });
  vi.mocked(api.useRepositoryFolder).mockResolvedValue([]);
  // The store outlives each test, so every test names its own project.
  projectName = `Payments ${++run}`;
  act(() => {
    localStore.addProject({ name: projectName, color: "#336699" });
  });
  projectId = localStore
    .snapshot()
    .projects.find((project) => project.name === projectName)!._id;
  act(() => {
    localStore.addWorkItem({
      title: "Fix login redirect",
      projectId,
      description: "Users land on a blank page.",
    });
  });
  itemId = localStore
    .snapshot()
    .workItems.find((item) => item.projectId === projectId)!._id;
  vi.mocked(api.startHandoff).mockImplementation(async (input) =>
    handoffRecord({
      id: `started-${input.toolId}`,
      toolId: input.toolId,
      workItemId: input.workItemId,
      projectId: input.projectId,
      folderId: input.folderId,
    }),
  );
});

afterEach(() => {
  cleanup();
  delete window.ajourDesktop;
  vi.resetAllMocks();
});

function Page() {
  const state = useLocalState();
  const item = state.workItems.find((candidate) => candidate._id === itemId);
  const handoffs = useHandoffs(itemId);
  const tools = useHandoffTools();
  return (
    <TooltipProvider>
      {item ? <HandoffButton item={item} /> : null}
      <HandoffsCard
        itemId={itemId}
        handoffs={handoffs}
        tools={tools}
        now={10 * 60_000}
        open
        onOpenChange={() => {}}
      />
      <HandoffHost />
      <Toaster />
    </TooltipProvider>
  );
}

/** The item page's card, which names threads by every tool, on or off. */
function AllToolsPage() {
  const state = useLocalState();
  const item = state.workItems.find((candidate) => candidate._id === itemId);
  const handoffs = useHandoffs(itemId);
  const tools = useAllHandoffTools();
  return (
    <TooltipProvider>
      {item ? <HandoffButton item={item} /> : null}
      <HandoffsCard
        itemId={itemId}
        handoffs={handoffs}
        tools={tools}
        now={10 * 60_000}
        open
        onOpenChange={() => {}}
      />
      <HandoffHost />
    </TooltipProvider>
  );
}

async function renderPage() {
  await renderRoutes({ routes: { "/": Page } });
  return screen.findByRole("button", { name: /Hand off to T3 Code/ });
}

function acceptNotice() {
  const dialog = screen.getByRole("alertdialog");
  expect(dialog.textContent).toContain("model provider");
  fireEvent.click(within(dialog).getByRole("button", { name: "Hand off" }));
}

it("hands off to the first available tool in one click, with the item's fields, and remembers the tool", async () => {
  vi.mocked(api.listRepositoryFolders).mockResolvedValue([
    { ...folder, projectId },
  ]);
  const button = await renderPage();
  await waitFor(() =>
    expect(api.detectHandoffTools).toHaveBeenCalledWith(
      "agent-handoff",
      projectId,
    ),
  );
  fireEvent.click(button);
  acceptNotice();
  await waitFor(() => expect(api.startHandoff).toHaveBeenCalledTimes(1));
  expect(api.startHandoff).toHaveBeenCalledWith({
    pluginId: "agent-handoff",
    toolId: "t3",
    folderId: "folder-1",
    projectId,
    workItemId: itemId,
    projectName,
    item: {
      key: "",
      title: "Fix login redirect",
      description: "Users land on a blank page.",
      url: "",
      type: "",
    },
    settings: {},
  });
  // The toast names the tool and opens the thread.
  const toast = await screen.findByText("Handed off to T3 Code");
  vi.mocked(api.openHandoff).mockResolvedValue({ opened: "link" });
  fireEvent.click(
    within(toast.closest("[data-slot=toast]") ?? document.body).getByRole(
      "button",
      { name: "Open" },
    ),
  );
  await waitFor(() =>
    expect(api.openHandoff).toHaveBeenCalledWith("started-t3"),
  );
  expect(window.localStorage.getItem("ajour.handoff-last-tool")).toBe(
    "agent-handoff:t3",
  );
  // The card lists the new thread at once.
  expect(
    await screen.findByRole("listitem", {
      name: "[PAY-12] Fix login redirect",
    }),
  ).toBeTruthy();
});

it("shows the provider notice once per tool on this device", async () => {
  vi.mocked(api.listRepositoryFolders).mockResolvedValue([
    { ...folder, projectId },
  ]);
  const button = await renderPage();
  fireEvent.click(button);
  acceptNotice();
  await waitFor(() => expect(api.startHandoff).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(button.hasAttribute("disabled")).toBe(false));
  fireEvent.click(button);
  await waitFor(() => expect(api.startHandoff).toHaveBeenCalledTimes(2));
  expect(screen.queryByRole("alertdialog")).toBeNull();
  // Cancel keeps the notice for next time and hands off nothing.
  window.localStorage.removeItem("ajour.handoff-notices");
  fireEvent.click(button);
  fireEvent.click(
    within(screen.getByRole("alertdialog")).getByRole("button", {
      name: "Cancel",
    }),
  );
  await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  expect(api.startHandoff).toHaveBeenCalledTimes(2);
});

it("asks for the folder when the project has several, then starts there", async () => {
  window.localStorage.setItem(
    "ajour.handoff-notices",
    JSON.stringify(["agent-handoff:t3"]),
  );
  vi.mocked(api.listRepositoryFolders).mockResolvedValue([
    { ...folder, projectId },
    { ...folder, id: "folder-2", name: "web", projectId, lastUsedAt: 9 },
  ]);
  fireEvent.click(await renderPage());
  const picker = await screen.findByRole("dialog", {
    name: "Choose repository folder",
  });
  const web = await within(picker).findByRole("radio", { name: /web/ });
  expect((web as HTMLInputElement).checked).toBe(true);
  const use = within(picker).getByRole("button", { name: "Use folder" });
  await waitFor(() => expect(use.hasAttribute("disabled")).toBe(false));
  fireEvent.click(use);
  await waitFor(() => expect(api.useRepositoryFolder).toHaveBeenCalled());
  await waitFor(() =>
    expect(api.startHandoff).toHaveBeenCalledWith(
      expect.objectContaining({ folderId: "folder-2" }),
    ),
  );
  expect(api.useRepositoryFolder).toHaveBeenCalledWith(projectId, "folder-2");
});

it("opens the folder picker with Add folder… when the project has none", async () => {
  window.localStorage.setItem(
    "ajour.handoff-notices",
    JSON.stringify(["agent-handoff:t3"]),
  );
  vi.mocked(api.listRepositoryFolders).mockResolvedValue([]);
  fireEvent.click(await renderPage());
  const picker = await screen.findByRole("dialog", {
    name: "Choose repository folder",
  });
  expect(
    await within(picker).findByRole("button", { name: "Add folder…" }),
  ).toBeTruthy();
  expect(api.startHandoff).not.toHaveBeenCalled();
});

it("lists the other tools in the menu, a missing one disabled with why, then Review prompt…", async () => {
  await renderPage();
  await waitFor(() => expect(api.detectHandoffTools).toHaveBeenCalled());
  fireEvent.click(
    screen.getByRole("button", { name: "Other ways to hand off" }),
  );
  const claude = await screen.findByRole("menuitem", {
    name: /Hand off to Claude Code/,
  });
  expect(claude.getAttribute("aria-disabled")).toBe("true");
  expect(claude.textContent).toContain("claude isn't on PATH.");
  expect(screen.getByRole("menuitem", { name: /Review prompt…/ })).toBeTruthy();
});

it("says why the main half is disabled in a focusable tooltip", async () => {
  act(() => {
    localStore.updateWorkItem(itemId, { projectId: undefined });
  });
  await renderPage();
  const wrapper = await screen.findByLabelText(
    "Hand off to T3 Code: Add the item to a project first",
  );
  expect(wrapper.getAttribute("tabindex")).toBe("0");
  expect(within(wrapper).getByRole("button").hasAttribute("disabled")).toBe(
    true,
  );
  expect(within(wrapper).getByRole("button").getAttribute("title")).toBeNull();
});

it("reviews the filled prompt, folder and branch, and sends the edits as overrides", async () => {
  window.localStorage.setItem(
    "ajour.handoff-notices",
    JSON.stringify(["agent-handoff:t3"]),
  );
  vi.mocked(api.listRepositoryFolders).mockResolvedValue([
    { ...folder, projectId },
  ]);
  await renderPage();
  fireEvent.click(
    screen.getByRole("button", { name: "Other ways to hand off" }),
  );
  fireEvent.click(
    await screen.findByRole("menuitem", { name: /Review prompt…/ }),
  );
  const dialog = await screen.findByRole("dialog", {
    name: "Hand off to T3 Code",
  });
  const prompt = within(dialog).getByLabelText("Prompt") as HTMLTextAreaElement;
  await waitFor(() =>
    expect(prompt.value).toBe(" Fix login redirect in payments"),
  );
  const branch = within(dialog).getByLabelText("Branch") as HTMLInputElement;
  expect(branch.value).toBe("item-fix-login-redirect");
  // An invalid branch blocks Start and says why.
  fireEvent.change(branch, { target: { value: "bad branch" } });
  const start = within(dialog).getByRole("button", { name: "Start" });
  expect(start.hasAttribute("disabled")).toBe(true);
  expect(within(dialog).getByRole("alert").textContent).toContain(
    "valid git branch",
  );
  fireEvent.change(branch, { target: { value: "" } });
  fireEvent.change(prompt, { target: { value: "Fix it, carefully." } });
  fireEvent.click(start);
  await waitFor(() =>
    expect(api.startHandoff).toHaveBeenCalledWith(
      expect.objectContaining({
        folderId: "folder-1",
        promptOverride: "Fix it, carefully.",
        branchOverride: "",
      }),
    ),
  );
  await waitFor(() =>
    expect(
      screen.queryByRole("dialog", { name: "Hand off to T3 Code" }),
    ).toBeNull(),
  );
});

it("keeps the review dialog open with the tool's refusal", async () => {
  window.localStorage.setItem(
    "ajour.handoff-notices",
    JSON.stringify(["agent-handoff:t3"]),
  );
  vi.mocked(api.listRepositoryFolders).mockResolvedValue([
    { ...folder, projectId },
  ]);
  vi.mocked(api.startHandoff).mockRejectedValue(
    new Error("t3 is not signed in."),
  );
  await renderPage();
  fireEvent.click(
    screen.getByRole("button", { name: "Other ways to hand off" }),
  );
  fireEvent.click(
    await screen.findByRole("menuitem", { name: /Review prompt…/ }),
  );
  const dialog = await screen.findByRole("dialog", {
    name: "Hand off to T3 Code",
  });
  const branch = within(dialog).getByLabelText("Branch");
  await waitFor(() => expect((branch as HTMLInputElement).value).not.toBe(""));
  fireEvent.change(branch, { target: { value: "fix-login" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Start" }));
  expect((await within(dialog).findByRole("alert")).textContent).toBe(
    "t3 is not signed in.",
  );
});

it("shows a one-click refusal as an error toast in the tool's words", async () => {
  window.localStorage.setItem(
    "ajour.handoff-notices",
    JSON.stringify(["agent-handoff:t3"]),
  );
  vi.mocked(api.listRepositoryFolders).mockResolvedValue([
    { ...folder, projectId },
  ]);
  vi.mocked(api.startHandoff).mockRejectedValue(
    new Error("t3 is not signed in."),
  );
  fireEvent.click(await renderPage());
  expect(
    (await screen.findAllByText("Couldn't hand off to T3 Code")).length,
  ).toBeGreaterThan(0);
  expect(screen.getAllByText("t3 is not signed in.").length).toBeGreaterThan(0);
});

it("runs a row menu's Hand off to <tool> through the same flow", async () => {
  window.localStorage.setItem(
    "ajour.handoff-notices",
    JSON.stringify(["agent-handoff:claude"]),
  );
  vi.mocked(api.listRepositoryFolders).mockResolvedValue([
    { ...folder, projectId },
  ]);
  vi.mocked(api.detectHandoffTools).mockResolvedValue({
    tools: [
      { id: "t3", available: true },
      { id: "claude", available: true },
    ],
  });
  await renderPage();
  const item = localStore
    .snapshot()
    .workItems.find((candidate) => candidate._id === itemId)!;
  act(() => {
    runBacklogItemAction(item, "hand-off:agent-handoff:claude", () => {});
  });
  await waitFor(() =>
    expect(api.startHandoff).toHaveBeenCalledWith(
      expect.objectContaining({ toolId: "claude", workItemId: itemId }),
    ),
  );
  // The split button now names the tool last handed off to.
  expect(
    await screen.findByRole("button", { name: /Hand off to Claude Code/ }),
  ).toBeTruthy();
});

it("starts one hand off when the item is asked twice before the first answers", async () => {
  window.localStorage.setItem(
    "ajour.handoff-notices",
    JSON.stringify(["agent-handoff:t3"]),
  );
  let answerFolders: (folders: (typeof folder)[]) => void = () => {};
  vi.mocked(api.listRepositoryFolders).mockImplementation(
    () =>
      new Promise((resolve) => {
        answerFolders = resolve;
      }),
  );
  const button = await renderPage();
  const item = localStore
    .snapshot()
    .workItems.find((candidate) => candidate._id === itemId)!;
  act(() => {
    runBacklogItemAction(item, "hand-off:agent-handoff:t3", () => {});
  });
  // The button waits, and the row menu's entry says why it can't run.
  await waitFor(() => expect(button.hasAttribute("disabled")).toBe(true));
  expect(
    getBacklogSurfaceActions(item, localStore.snapshot(), 0).find(
      (action) => action.id === "hand-off:agent-handoff:t3",
    )?.disabledReason,
  ).toBe("A hand off of this item is starting");
  act(() => {
    runBacklogItemAction(item, "hand-off:agent-handoff:t3", () => {});
    runBacklogItemAction(item, "hand-off:agent-handoff:claude", () => {});
  });
  await act(async () => answerFolders([{ ...folder, projectId }]));
  await waitFor(() => expect(api.startHandoff).toHaveBeenCalledTimes(1));
  await screen.findByText("Handed off to T3 Code");
  expect(api.listRepositoryFolders).toHaveBeenCalledTimes(1);
  // Once it has started, the item can be handed off again.
  await waitFor(() => expect(button.hasAttribute("disabled")).toBe(false));
});

it("lets the item be handed off again after the notice is cancelled", async () => {
  vi.mocked(api.listRepositoryFolders).mockResolvedValue([
    { ...folder, projectId },
  ]);
  const button = await renderPage();
  fireEvent.click(button);
  fireEvent.click(
    within(await screen.findByRole("alertdialog")).getByRole("button", {
      name: "Cancel",
    }),
  );
  await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  expect(button.hasAttribute("disabled")).toBe(false);
  fireEvent.click(button);
  acceptNotice();
  await waitFor(() => expect(api.startHandoff).toHaveBeenCalledTimes(1));
});

function seeNoticeFor(tool: string) {
  window.localStorage.setItem(
    "ajour.handoff-notices",
    JSON.stringify([`agent-handoff:${tool}`]),
  );
}

function addItem(title: string) {
  act(() => {
    localStore.addWorkItem({ title, projectId });
  });
  return localStore
    .snapshot()
    .workItems.find(
      (item) => item.title === title && item.projectId === projectId,
    )!._id;
}

/** Answers each folder lookup only when the test says so, in call order. */
function holdFolderLookups() {
  const answers: ((folders: (typeof folder)[]) => void)[] = [];
  vi.mocked(api.listRepositoryFolders).mockImplementation(
    () =>
      new Promise((resolve) => {
        answers.push(resolve);
      }),
  );
  return answers;
}

/** Holds every start until the test answers it, in call order. */
function holdStarts() {
  const answers: (() => void)[] = [];
  vi.mocked(api.startHandoff).mockImplementation(
    (input) =>
      new Promise((resolve) => {
        answers.push(() =>
          resolve(
            handoffRecord({
              id: `started-${input.workItemId}`,
              workItemId: input.workItemId,
              projectId: input.projectId,
            }),
          ),
        );
      }),
  );
  return answers;
}

async function openReview(id: string) {
  act(() =>
    requestHandoff({ itemId: id, toolKey: "agent-handoff:t3", review: true }),
  );
  const dialog = await screen.findByRole("dialog", {
    name: "Hand off to T3 Code",
  });
  const prompt = within(dialog).getByLabelText("Prompt") as HTMLTextAreaElement;
  await waitFor(() => expect(prompt.value).toContain("payments"));
  return dialog;
}

it("releases an item whose picker another item's replaced in the same batch", async () => {
  seeNoticeFor("t3");
  const answers = holdFolderLookups();
  const other = addItem("Fix logout redirect");
  await renderPage();
  act(() => {
    requestHandoff({ itemId, toolKey: "agent-handoff:t3" });
    requestHandoff({ itemId: other, toolKey: "agent-handoff:t3" });
  });
  const several = [
    { ...folder, projectId },
    { ...folder, id: "folder-2", name: "web", projectId },
  ];
  // Both lookups answer before React renders either picker.
  await act(async () => {
    answers[0]!(several);
    answers[1]!(several);
  });
  const picker = await screen.findByRole("dialog", {
    name: "Choose repository folder",
  });
  expect(picker).toBeTruthy();
  expect(isHandoffStarting(itemId)).toBe(false);
  expect(isHandoffStarting(other)).toBe(true);
  fireEvent.keyDown(picker, { key: "Escape" });
  await waitFor(() => expect(isHandoffStarting(other)).toBe(false));
});

it("releases the items of an unmounted host, open dialog or lookup still running", async () => {
  seeNoticeFor("t3");
  const answers = holdFolderLookups();
  const other = addItem("Fix logout redirect");
  await renderPage();
  act(() => requestHandoff({ itemId, toolKey: "agent-handoff:t3" }));
  const several = [
    { ...folder, projectId },
    { ...folder, id: "folder-2", name: "web", projectId },
  ];
  await act(async () => answers[0]!(several));
  await screen.findByRole("dialog", { name: "Choose repository folder" });
  act(() => requestHandoff({ itemId: other, toolKey: "agent-handoff:t3" }));
  expect(isHandoffStarting(other)).toBe(true);
  cleanup();
  expect(isHandoffStarting(itemId)).toBe(false);
  // The lookup that answers after the host left has no picker to show.
  // The picker asked for the folders too, so every held lookup answers.
  await act(async () => answers.forEach((answer) => answer(several)));
  expect(isHandoffStarting(other)).toBe(false);
});

it("keeps the item starting when Review prompt closes while its start runs", async () => {
  seeNoticeFor("t3");
  vi.mocked(api.listRepositoryFolders).mockResolvedValue([
    { ...folder, projectId },
  ]);
  const starts = holdStarts();
  const button = await renderPage();
  const dialog = await openReview(itemId);
  fireEvent.click(within(dialog).getByRole("button", { name: "Start" }));
  await waitFor(() => expect(api.startHandoff).toHaveBeenCalledTimes(1));
  fireEvent.keyDown(dialog, { key: "Escape" });
  await waitFor(() =>
    expect(
      screen.queryByRole("dialog", { name: "Hand off to T3 Code" }),
    ).toBeNull(),
  );
  // The first start still runs, so the item can't start a second.
  expect(isHandoffStarting(itemId)).toBe(true);
  expect(button.hasAttribute("disabled")).toBe(true);
  act(() => requestHandoff({ itemId, toolKey: "agent-handoff:t3" }));
  expect(api.listRepositoryFolders).toHaveBeenCalledTimes(1);
  await act(async () => starts[0]!());
  await screen.findByText("Handed off to T3 Code");
  expect(isHandoffStarting(itemId)).toBe(false);
  expect(api.startHandoff).toHaveBeenCalledTimes(1);
});

it("leaves another item's dialog open when an earlier Review prompt start completes", async () => {
  seeNoticeFor("t3");
  vi.mocked(api.listRepositoryFolders).mockResolvedValue([
    { ...folder, projectId },
  ]);
  const starts = holdStarts();
  const other = addItem("Fix logout redirect");
  await renderPage();
  const first = await openReview(itemId);
  fireEvent.click(within(first).getByRole("button", { name: "Start" }));
  await waitFor(() => expect(api.startHandoff).toHaveBeenCalledTimes(1));
  fireEvent.click(within(first).getByRole("button", { name: "Cancel" }));
  await waitFor(() =>
    expect(
      screen.queryByRole("dialog", { name: "Hand off to T3 Code" }),
    ).toBeNull(),
  );
  const second = await openReview(other);
  expect(within(second).getByText("Fix logout redirect")).toBeTruthy();
  await act(async () => starts[0]!());
  await screen.findByText("Handed off to T3 Code");
  expect(isHandoffStarting(itemId)).toBe(false);
  expect(
    screen.getByRole("dialog", { name: "Hand off to T3 Code" }),
  ).toBeTruthy();
  expect(isHandoffStarting(other)).toBe(true);
});

it("reads Choose your tools while no tool is on, and leads to the plugin's tool list from the button and the row menu", async () => {
  cachePluginsOverview(handoffOverview({ enabled: [] }));
  const { router } = await renderRoutes({ routes: { "/": Page } });
  const settings = () =>
    (router.state.location.search as Record<string, unknown>).settings;
  const choose = await screen.findByRole("button", {
    name: "Choose your tools",
  });
  expect(screen.queryByRole("button", { name: /Hand off to/ })).toBeNull();
  // A tool that is off is never detected.
  expect(api.detectHandoffTools).not.toHaveBeenCalled();

  fireEvent.click(choose);
  await waitFor(() =>
    expect(settings()).toBe("plugins/agent-handoff?section=handoff-tools"),
  );

  await act(() => router.navigate({ to: "/" }));
  expect(settings()).toBeUndefined();
  const item = localStore
    .snapshot()
    .workItems.find((candidate) => candidate._id === itemId)!;
  act(() => {
    runBacklogItemAction(item, "choose-handoff-tools", () => {});
  });
  await waitFor(() =>
    expect(settings()).toBe("plugins/agent-handoff?section=handoff-tools"),
  );
});

it("opens the plugin's tool list from the palette's Choose your tools", async () => {
  cachePluginsOverview(handoffOverview({ enabled: [] }));
  const { router } = await renderRoutes({
    shell: ({ children }) => (
      <ShortcutProvider>
        <CommandPalette />
        {children}
      </ShortcutProvider>
    ),
    routes: { "/": Page },
  });
  await screen.findByRole("button", { name: "Choose your tools" });
  const row = document.createElement("button");
  row.setAttribute("data-backlog-item-id", itemId);
  document.body.append(row);
  row.focus();
  fireEvent.keyDown(window, { key: "k", ctrlKey: true });
  fireEvent.click(
    await screen.findByRole("option", { name: /^Choose your tools/ }),
  );
  await waitFor(() =>
    expect(
      (router.state.location.search as Record<string, unknown>).settings,
    ).toBe("plugins/agent-handoff?section=handoff-tools"),
  );
  row.remove();
});

it("keeps naming the threads of a tool turned off on the card, and offers only the tools that are on", async () => {
  cachePluginsOverview(handoffOverview({ enabled: ["claude"] }));
  vi.mocked(api.detectHandoffTools).mockResolvedValue({
    tools: [{ id: "claude", available: true }],
  });
  await renderRoutes({ routes: { "/": AllToolsPage } });
  expect(
    await screen.findByRole("button", { name: /Hand off to Claude Code/ }),
  ).toBeTruthy();
  expect(
    screen.queryByRole("button", { name: /Hand off to T3 Code/ }),
  ).toBeNull();
  act(() => setHandoffs([handoffRecord({ workItemId: itemId })]));
  const row = await cardRow("[PAY-12] Fix login redirect");
  // The tool's name and icon still come from its plugin while it is off.
  expect(row.textContent).toContain("T3 Code");
  expect(within(row).getByRole("button", { name: /Open/ })).toBeTruthy();
});

it("renders nothing in the web build, where no tool can run", async () => {
  delete window.ajourDesktop;
  await renderRoutes({ routes: { "/": Page } });
  expect(screen.queryByRole("button", { name: /Hand off/ })).toBeNull();
  expect(api.detectHandoffTools).not.toHaveBeenCalled();
});

function cardRow(title: string) {
  return screen.findByRole("listitem", { name: title });
}

it.each([
  ["working", "Working"],
  ["needs-you", "Needs you"],
  ["ready", "Ready"],
  ["done", "Done"],
  ["failed", "Failed"],
  ["gone", "Gone"],
  ["unknown", "Unknown"],
] as const)(
  "shows a %s thread with its chip, branch, pull requests and last change",
  async (state, label) => {
    await renderPage();
    act(() =>
      setHandoffs([
        handoffRecord({
          workItemId: itemId,
          state,
          changedAt: 7 * 60_000,
          pullRequests: [
            { url: "https://github.com/acme/pay/pull/41" },
            { url: "https://github.com/acme/pay/pull/42", title: "Fix" },
          ],
        }),
      ]),
    );
    const row = await cardRow("[PAY-12] Fix login redirect");
    const chip = within(row).getByText(label);
    // The tool's own words, for the tooltip.
    expect(chip.closest("[aria-label]")?.getAttribute("aria-label")).toBe(
      `${label}: Running in T3`,
    );
    expect(within(row).getByText("pay-12-fix-login-redirect")).toBeTruthy();
    expect(
      within(row).getByRole("link", { name: "#41" }).getAttribute("href"),
    ).toBe("https://github.com/acme/pay/pull/41");
    expect(within(row).getByRole("link", { name: "Fix" })).toBeTruthy();
    expect(row.textContent).toContain("3 min ago");
  },
);

it.each([
  "http://github.com/acme/pay/pull/41",
  "javascript:alert(1)",
  "file:///C:/Users/me/secrets.txt",
])("shows a pull request at %s as text, not a link", async (url) => {
  await renderPage();
  act(() =>
    setHandoffs([
      handoffRecord({
        workItemId: itemId,
        pullRequests: [{ url, title: "Unsafe" }],
      }),
    ]),
  );
  const row = await cardRow("[PAY-12] Fix login redirect");
  expect(within(row).getByText("Unsafe").closest("a")).toBeNull();
  expect(within(row).queryByRole("link")).toBeNull();
});

it("shows a paused thread muted with the reason", async () => {
  await renderPage();
  act(() =>
    setHandoffs([
      handoffRecord({
        workItemId: itemId,
        paused: { reason: "Turn the plugin on to refresh it.", since: 1 },
      }),
    ]),
  );
  const row = await cardRow("[PAY-12] Fix login redirect");
  expect(
    within(row).getByLabelText("Paused: Turn the plugin on to refresh it."),
  ).toBeTruthy();
});

it("opens, refreshes and removes a thread from the card", async () => {
  const record: Handoff = handoffRecord({ workItemId: itemId });
  vi.mocked(api.openHandoff).mockResolvedValue({ opened: "terminal" });
  vi.mocked(api.refreshHandoffs).mockResolvedValue({
    handoffs: [{ ...record, state: "needs-you", changedAt: 9 * 60_000 }],
    failures: [],
  });
  vi.mocked(api.removeHandoff).mockResolvedValue([]);
  await renderPage();
  act(() => setHandoffs([record]));
  const row = await cardRow(record.title);
  fireEvent.click(
    within(row).getByRole("button", {
      name: "Open [PAY-12] Fix login redirect in T3 Code",
    }),
  );
  await waitFor(() => expect(api.openHandoff).toHaveBeenCalledWith("h1"));

  fireEvent.click(within(row).getByRole("button", { name: "Handoff actions" }));
  fireEvent.click(await screen.findByRole("menuitem", { name: "Refresh" }));
  await waitFor(() => expect(api.refreshHandoffs).toHaveBeenCalledWith("h1"));
  expect(await within(row).findByText("Needs you")).toBeTruthy();

  fireEvent.click(within(row).getByRole("button", { name: "Handoff actions" }));
  fireEvent.click(
    await screen.findByRole("menuitem", { name: "Remove from item" }),
  );
  await waitFor(() => expect(api.removeHandoff).toHaveBeenCalledWith("h1"));
  await waitFor(() =>
    expect(screen.queryByRole("listitem", { name: record.title })).toBeNull(),
  );
  expect(
    await screen.findByText(
      "Removed from the item. The thread stays in T3 Code.",
    ),
  ).toBeTruthy();
});

it("says why a thread didn't open, in the setting's words", async () => {
  vi.mocked(api.openHandoff).mockRejectedValue(
    new Error("The tool isn't installed on this computer."),
  );
  await renderPage();
  act(() => setHandoffs([handoffRecord({ workItemId: itemId })]));
  const row = await cardRow("[PAY-12] Fix login redirect");
  fireEvent.click(within(row).getByRole("button", { name: /^Open / }));
  expect(
    (await screen.findAllByText("Couldn't open the thread")).length,
  ).toBeGreaterThan(0);
  expect(
    screen.getAllByText("The tool isn't installed on this computer.").length,
  ).toBeGreaterThan(0);
});

it("hands an item off again while it has a live and a finished thread", async () => {
  seeNoticeFor("t3");
  vi.mocked(api.listRepositoryFolders).mockResolvedValue([
    { ...folder, projectId },
  ]);
  const button = await renderPage();
  act(() =>
    setHandoffs([
      handoffRecord({ id: "live", workItemId: itemId, state: "working" }),
      handoffRecord({
        id: "finished",
        workItemId: itemId,
        state: "done",
        title: "[PAY-12] Earlier attempt",
      }),
    ]),
  );
  await cardRow("[PAY-12] Earlier attempt");
  // Nothing about the existing threads holds the button back.
  expect(button.hasAttribute("disabled")).toBe(false);
  fireEvent.click(button);
  await waitFor(() =>
    expect(api.startHandoff).toHaveBeenCalledWith(
      expect.objectContaining({ toolId: "t3", workItemId: itemId }),
    ),
  );
});

it("says in both hand-off menus that a tool doesn't report progress", async () => {
  cachePluginsOverview(handoffOverview({ copilot: true }));
  vi.mocked(api.detectHandoffTools).mockResolvedValue({
    tools: [
      { id: "t3", available: true },
      { id: "claude", available: true },
      { id: "copilot", available: true },
    ],
  });
  await renderPage();
  await waitFor(() => expect(api.detectHandoffTools).toHaveBeenCalled());
  fireEvent.click(
    screen.getByRole("button", { name: "Other ways to hand off" }),
  );
  const copilot = await screen.findByRole("menuitem", {
    name: /Hand off to Copilot CLI/,
  });
  expect(copilot.textContent).toContain(
    "Starts a thread; doesn't report progress",
  );
  expect(
    screen.getByRole("menuitem", { name: /Hand off to Claude Code/ })
      .textContent,
  ).not.toContain("report progress");
  const item = localStore
    .snapshot()
    .workItems.find((candidate) => candidate._id === itemId)!;
  const actions = getBacklogSurfaceActions(item, localStore.snapshot(), 0);
  expect(
    actions.find((action) => action.id === "hand-off:agent-handoff:copilot")
      ?.hint,
  ).toBe("Starts a thread; doesn't report progress");
  expect(
    actions.find((action) => action.id === "hand-off:agent-handoff:claude")
      ?.hint,
  ).toBeUndefined();
});

it("shows a started thread muted, with its tool and start time, and offers no Refresh", async () => {
  cachePluginsOverview(handoffOverview({ copilot: true }));
  await renderPage();
  act(() =>
    setHandoffs([
      handoffRecord({
        workItemId: itemId,
        toolId: "copilot",
        state: "started",
        native: {},
        startedAt: 4 * 60_000,
        changedAt: 4 * 60_000,
      }),
    ]),
  );
  const row = await cardRow("[PAY-12] Fix login redirect");
  expect(within(row).getByText("Started")).toBeTruthy();
  expect(
    within(row).getByLabelText(
      "Started: Started in Copilot CLI 6 min ago. Copilot CLI doesn't report progress here; open it there to follow it.",
    ),
  ).toBeTruthy();
  expect(row.textContent).toContain("Copilot CLI");
  // The chip and its tooltip already say Started.
  expect(row.textContent).toContain("6 min ago");
  expect(row.textContent).not.toContain("started 6 min ago");
  fireEvent.click(within(row).getByRole("button", { name: "Handoff actions" }));
  expect(
    await screen.findByRole("menuitem", { name: "Remove from item" }),
  ).toBeTruthy();
  expect(screen.queryByRole("menuitem", { name: "Refresh" })).toBeNull();
  // Opening the item asks nothing of a tool that doesn't report state.
  expect(api.refreshHandoffs).not.toHaveBeenCalled();
});

it("reads a started thread again once its tool follows state", async () => {
  const record = handoffRecord({
    workItemId: itemId,
    toolId: "t3",
    state: "started",
    native: {},
  });
  vi.mocked(api.refreshHandoffs).mockResolvedValue({
    handoffs: [{ ...record, state: "needs-you", changedAt: 9 * 60_000 }],
    failures: [],
  });
  await renderPage();
  act(() => setHandoffs([record]));
  const row = await cardRow(record.title);
  // T3 Code follows state now, so the card offers Refresh again.
  fireEvent.click(within(row).getByRole("button", { name: "Handoff actions" }));
  fireEvent.click(await screen.findByRole("menuitem", { name: "Refresh" }));
  await waitFor(() => expect(api.refreshHandoffs).toHaveBeenCalledWith("h1"));
  expect(await within(row).findByText("Needs you")).toBeTruthy();
});

it("shows a started thread unknown while its tool follows state but hasn't answered", async () => {
  const record = handoffRecord({
    workItemId: itemId,
    toolId: "t3",
    state: "started",
    native: {},
  });
  await renderPage();
  act(() => setHandoffs([record]));
  const row = await cardRow(record.title);
  expect(within(row).getByText("Unknown")).toBeTruthy();
  expect(within(row).queryByText("Started")).toBeNull();
});
