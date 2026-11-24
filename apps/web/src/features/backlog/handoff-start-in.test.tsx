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
import type { PluginsOverview } from "@ajour/shared";
import type { Handoff } from "@ajour/shared/handoffs";
import type { RepositoryBranches, Worktree } from "@ajour/shared/worktrees";
import { Toaster } from "@/components/ui/toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import * as api from "@/lib/app-api";
import { cachePluginsOverview } from "@/lib/app-api";
import { localStore } from "@/lib/local-store";
import { setHandoffs, useHandoffs } from "@/lib/handoffs";
import { resetWorktrees } from "@/lib/worktrees";
import {
  resetHandoffToolDetections,
  resetLastHandoffTool,
  useHandoffTools,
} from "@/lib/handoff-tools";
import { useLocalState } from "@/lib/local-hooks";
import { installDomShims, renderRoutes } from "@/test-support/dom";
import { HandoffButton } from "./handoff-button";
import { HandoffHost } from "./handoff-workflow";
import { HandoffsCard } from "./backlog-item-side-cards";

/*
 * Choosing where a hand off starts (#861): the hand-off sheet's Start in
 * row and its two menus, the Start in dialog of Ask each time, and Review
 * prompt's two buttons. The local API module is mocked, and the tools are
 * an example plugin's, Alpha and Beta. Each test reads what the user sees
 * and what the start request then says.
 */

vi.mock("@/lib/app-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/app-api")>()),
  detectHandoffTools: vi.fn(),
  getHandoffTemplates: vi.fn(),
  getProjectStartIn: vi.fn(),
  listHandoffs: vi.fn(),
  listItemWorktrees: vi.fn(),
  listRepositoryBranches: vi.fn(),
  listRepositoryFolders: vi.fn(),
  listWorktrees: vi.fn(),
  startHandoff: vi.fn(),
  useRepositoryFolder: vi.fn(),
}));

beforeAll(installDomShims);

const ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6"/></svg>';

/**
 * One active example plugin with two tools that follow state, both on.
 * The tools named in `ownWorktree` declare that they make their own
 * worktree (#863).
 */
function overview(ownWorktree: readonly string[] = []): PluginsOverview {
  const tool = (id: string, label: string) => ({
    id,
    label,
    iconSvg: ICON,
    settings: [],
    connection: "none" as const,
    followsState: true,
    hooks: false,
    ...(ownWorktree.includes(id) ? { ownWorktree: true } : {}),
  });
  const plugin = {
    id: "example-handoff",
    version: "1.0.0",
    apiVersion: 4 as const,
    displayName: "Example handoff",
    iconSvg: ICON,
    entrypoint: "plugin.mjs",
    capabilities: {
      handoff: { tools: [tool("alpha", "Alpha"), tool("beta", "Beta")] },
    },
    connectionFields: [],
  };
  return {
    pluginsEnabled: true,
    unsignedPluginsEnabled: true,
    plugins: [plugin],
    connectionGroups: [
      {
        plugin,
        enabled: true,
        enabledHandoffTools: ["alpha", "beta"],
        connections: [],
      },
    ],
    totalPendingImportCount: 0,
    totalSelectedImportCount: 0,
  } as PluginsOverview;
}

const folder = {
  id: "folder-1",
  projectId: "",
  name: "atlas-web",
  path: "/work/atlas-web",
};

/** The folder's branches, as the local API lists them. */
const branches: RepositoryBranches = {
  current: "develop",
  source: "origin/main",
  branches: [
    { name: "origin/main", remote: true, default: true },
    { name: "develop", remote: false, current: true },
    { name: "origin/release/1.4", remote: true },
  ],
};

let itemId = "";
let projectId = "";
let run = 0;

/** A worktree the item already has in the folder. */
const worktreeOf = (overrides: Partial<Worktree> = {}): Worktree => ({
  id: "worktree-1",
  repositoryFolderId: "folder-1",
  projectId,
  workItemId: itemId,
  itemKey: "4821",
  name: "aj-4821",
  branch: "4821-week-grid",
  source: "origin/main",
  createdAt: 1_000,
  ...overrides,
});

function record(overrides: Partial<Handoff>): Handoff {
  return {
    id: "h1",
    pluginId: "example-handoff",
    toolId: "alpha",
    workItemId: itemId,
    projectId,
    folderId: "folder-1",
    threadId: "thread-1",
    title: "Week grid",
    native: {},
    startedAt: 1_000,
    state: "working",
    checkedAt: 2_000,
    changedAt: 2_000,
    history: [],
    ...overrides,
  };
}

beforeEach(() => {
  window.localStorage.removeItem("ajour.handoff-last-tool");
  // The provider notice was accepted for both tools on this device.
  window.localStorage.setItem(
    "ajour.handoff-notices",
    JSON.stringify(["example-handoff:alpha", "example-handoff:beta"]),
  );
  resetLastHandoffTool();
  resetHandoffToolDetections();
  window.ajourDesktop = { chooseFolder: vi.fn() };
  cachePluginsOverview(overview());
  setHandoffs([]);
  resetWorktrees();
  vi.mocked(api.listHandoffs).mockResolvedValue([]);
  vi.mocked(api.listWorktrees).mockResolvedValue([]);
  vi.mocked(api.detectHandoffTools).mockResolvedValue({
    tools: [
      { id: "alpha", available: true },
      { id: "beta", available: true },
    ],
  });
  vi.mocked(api.getHandoffTemplates).mockResolvedValue({
    prompt: "{{item.title}} in {{repo.name}}",
    title: "{{item.title}}",
    branch: "{{item.title|slug}}",
  });
  vi.mocked(api.useRepositoryFolder).mockResolvedValue([]);
  vi.mocked(api.getProjectStartIn).mockResolvedValue({ settings: "worktree" });
  vi.mocked(api.listItemWorktrees).mockResolvedValue([]);
  vi.mocked(api.listRepositoryBranches).mockResolvedValue(branches);
  // The store outlives each test, so every test names its own project.
  const projectName = `Atlas ${++run}`;
  act(() => {
    localStore.addProject({ name: projectName, color: "#336699" });
  });
  projectId = localStore
    .snapshot()
    .projects.find((project) => project.name === projectName)!._id;
  act(() => {
    localStore.addWorkItem({ title: "Week grid", projectId });
  });
  itemId = localStore
    .snapshot()
    .workItems.find((item) => item.projectId === projectId)!._id;
  vi.mocked(api.listRepositoryFolders).mockResolvedValue([
    { ...folder, projectId },
  ]);
  vi.mocked(api.startHandoff).mockImplementation(async (input) =>
    record({ id: `started-${input.toolId}`, toolId: input.toolId }),
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
        item={item}
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

/**
 * Renders the item page's hand-off parts and opens the sheet. It resolves
 * once the sheet gave its first tool the focus, a frame after it opened:
 * the sheet is settled from then on, as it is when a person acts on it.
 */
async function openSheet() {
  if (!screen.queryByRole("button", { name: "Hand off" }))
    await renderRoutes({ routes: { "/": Page } });
  fireEvent.click(await screen.findByRole("button", { name: "Hand off" }));
  const sheet = await screen.findByRole("menu");
  await waitFor(() =>
    expect(document.activeElement?.getAttribute("aria-label")).toMatch(
      /^Hand off to /,
    ),
  );
  return sheet;
}

/**
 * Lets a menu follow the focus it was just given, which takes it a frame,
 * before the next key. A person's next key press comes later than that.
 */
const settle = () => act(() => new Promise((done) => setTimeout(done, 50)));

/** The sheet's Start in row lines, which are items of its menu. */
const topLine = (title: string) =>
  screen.findByRole("menuitem", { name: `Start in: ${title}` });
const bottomLine = (detail: string) =>
  screen.findByRole("menuitem", { name: `Source: ${detail}` });

const pickTool = (tool = "Alpha") =>
  fireEvent.click(
    screen.getByRole("menuitem", { name: `Hand off to ${tool}` }),
  );

/** What the last start asked for. */
const lastStart = () => vi.mocked(api.startHandoff).mock.calls.at(-1)![0];

it("shows where the hand off will start before a tool is picked, and one click on a tool still hands off", async () => {
  const sheet = await openSheet();

  // A new worktree and its source, each line its own button.
  await topLine("New worktree");
  expect((await bottomLine("From origin/main")).textContent).toBe(
    "From origin/main",
  );
  // The sheet opens on the first tool, so Enter hands off.
  const alpha = within(sheet).getByRole("menuitem", {
    name: "Hand off to Alpha",
  });
  await waitFor(() => expect(document.activeElement).toBe(alpha));

  pickTool("Alpha");

  await waitFor(() => expect(api.startHandoff).toHaveBeenCalledTimes(1));
  // The user chose nothing, so the local API decides the place.
  expect(lastStart()).not.toHaveProperty("startIn");
  expect(lastStart()).toMatchObject({ toolId: "alpha", folderId: "folder-1" });
});

it("starts in the main folder when the Start in menu says so, for this opening of the sheet only", async () => {
  await openSheet();
  fireEvent.click(await topLine("New worktree"));
  const main = await screen.findByRole("menuitemradio", {
    name: /Main folder/,
  });
  expect(main.textContent).toContain("atlas-web");
  expect(
    screen
      .getByRole("menuitemradio", { name: /New worktree/ })
      .getAttribute("aria-checked"),
  ).toBe("true");

  fireEvent.click(main);

  // The row says it, with the branch checked out there as plain text.
  expect((await topLine("Main folder")).getAttribute("aria-description")).toBe(
    "On develop",
  );
  expect(screen.getByText("On develop")).toBeTruthy();
  expect(screen.queryByRole("menuitem", { name: /^Source:/ })).toBeNull();
  // The sheet stayed open for the tool's pick.
  pickTool("Alpha");
  await waitFor(() => expect(api.startHandoff).toHaveBeenCalledTimes(1));
  expect(lastStart().startIn).toEqual({ kind: "main" });

  // The next opening starts from the default place again.
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Hand off" }).hasAttribute("disabled"),
    ).toBe(false),
  );
  await openSheet();
  await topLine("New worktree");
  pickTool("Alpha");
  await waitFor(() => expect(api.startHandoff).toHaveBeenCalledTimes(2));
  expect(lastStart()).not.toHaveProperty("startIn");
});

it("starts in the item's newest worktree by default, and offers a new one or the earlier one in the Start in menu", async () => {
  vi.mocked(api.listItemWorktrees).mockResolvedValue([
    worktreeOf({ id: "worktree-2", name: "aj-4821-2", branch: "4821-spike" }),
    worktreeOf(),
  ]);
  await openSheet();

  // The newest worktree, with its branch as plain text: nothing to pick.
  await topLine("Start in aj-4821-2");
  expect(screen.getByText("4821-spike")).toBeTruthy();
  expect(screen.queryByRole("menuitem", { name: /^Source:/ })).toBeNull();

  fireEvent.click(await topLine("Start in aj-4821-2"));
  const rows = await screen.findAllByRole("menuitemradio");
  expect(rows.map((row) => row.textContent)).toEqual([
    "Main folderatlas-web",
    "New worktree",
    "Previous worktreeaj-4821-2 · 4821-spike",
    "Previous worktreeaj-4821 · 4821-week-grid",
  ]);
  expect(rows[2]!.getAttribute("aria-checked")).toBe("true");

  // The earlier worktree.
  fireEvent.click(rows[3]!);
  await topLine("Start in aj-4821");
  pickTool("Beta");
  await waitFor(() => expect(api.startHandoff).toHaveBeenCalledTimes(1));
  expect(lastStart().startIn).toEqual({
    kind: "worktree",
    worktreeId: "worktree-1",
  });

  // A new worktree for the item, which the local API names aj-4821-3.
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Hand off" }).hasAttribute("disabled"),
    ).toBe(false),
  );
  await openSheet();
  fireEvent.click(await topLine("Start in aj-4821-2"));
  fireEvent.click(
    await screen.findByRole("menuitemradio", { name: /New worktree/ }),
  );
  await topLine("New worktree");
  await bottomLine("From origin/main");
  pickTool("Beta");
  await waitFor(() => expect(api.startHandoff).toHaveBeenCalledTimes(2));
  expect(lastStart().startIn).toEqual({ kind: "new" });
});

it("filters the branches in the finder, and starts the new worktree from the one picked", async () => {
  await openSheet();
  fireEvent.click(await bottomLine("From origin/main"));

  const field = await screen.findByRole("combobox", { name: "Source branch" });
  const list = screen.getByRole("listbox", { name: "Source branch" });
  const names = () =>
    within(list)
      .getAllByRole("option")
      .map((option) => option.textContent);
  // The default source first and marked, then the main folder's branch.
  expect(names()).toEqual([
    "origin/maindefault",
    "developin atlas-web",
    "origin/release/1.4",
  ]);
  expect(
    within(list)
      .getByRole("option", { name: /origin\/main/ })
      .getAttribute("aria-selected"),
  ).toBe("true");

  fireEvent.change(field, { target: { value: "REL" } });
  expect(names()).toEqual(["origin/release/1.4"]);
  fireEvent.change(field, { target: { value: "no such branch" } });
  expect(within(list).queryAllByRole("option")).toEqual([]);
  expect(list.textContent).toContain("No branch found.");

  fireEvent.change(field, { target: { value: "rel" } });
  fireEvent.click(within(list).getByRole("option"));

  await bottomLine("From origin/release/1.4");
  pickTool("Alpha");
  await waitFor(() => expect(api.startHandoff).toHaveBeenCalledTimes(1));
  expect(lastStart().startIn).toEqual({
    kind: "new",
    source: "origin/release/1.4",
  });
});

it("works with the keyboard alone: both lines of the row, both menus and the finder", async () => {
  const sheet = await openSheet();
  const alpha = within(sheet).getByRole("menuitem", {
    name: "Hand off to Alpha",
  });
  expect(document.activeElement).toBe(alpha);
  const press = (key: string) =>
    fireEvent.keyDown(document.activeElement!, { key });
  const focused = (label: string | RegExp) =>
    waitFor(() =>
      expect(
        document.activeElement?.getAttribute("aria-label") ??
          document.activeElement?.textContent,
      ).toMatch(label),
    );

  // Up from the first tool: the bottom line, then the top line.
  press("ArrowUp");
  await focused("Source: From origin/main");
  press("ArrowUp");
  await focused("Start in: New worktree");

  // Enter opens the Start in menu. The arrows and Enter choose in it.
  press("Enter");
  await focused(/^Main folder/);
  press("Enter");
  // The menu closed, the row says the place, and the line has the focus.
  await focused("Start in: Main folder");
  expect(screen.queryByRole("menuitemradio")).toBeNull();
  expect(screen.getByText("On develop")).toBeTruthy();
  await settle();

  // Back to a new worktree.
  press("Enter");
  await focused(/^Main folder/);
  press("ArrowDown");
  await focused(/^New worktree/);
  press("Enter");
  await focused("Start in: New worktree");
  await settle();

  // Down to the bottom line, and Enter opens the finder on its field.
  press("ArrowDown");
  await focused("Source: From origin/main");
  press("Enter");
  const field = await screen.findByRole("combobox", { name: "Source branch" });
  await waitFor(() => expect(document.activeElement).toBe(field));

  // Typing filters, the arrows move the highlight, Enter picks.
  fireEvent.change(field, { target: { value: "e" } });
  const list = screen.getByRole("listbox", { name: "Source branch" });
  const active = () =>
    document.getElementById(field.getAttribute("aria-activedescendant")!)
      ?.textContent;
  expect(within(list).getAllByRole("option")).toHaveLength(2);
  expect(active()).toBe("developin atlas-web");
  fireEvent.keyDown(field, { key: "ArrowDown" });
  expect(active()).toBe("origin/release/1.4");
  fireEvent.keyDown(field, { key: "ArrowDown" });
  expect(active()).toBe("origin/release/1.4");
  fireEvent.keyDown(field, { key: "ArrowUp" });
  expect(active()).toBe("developin atlas-web");
  // The sheet around the finder reads none of these keys.
  expect(screen.getByRole("combobox", { name: "Source branch" })).toBe(field);
  fireEvent.keyDown(field, { key: "Enter" });

  await focused("Source: From develop");
  expect(screen.queryByRole("combobox")).toBeNull();
  await settle();

  // Down to the tool, where Enter hands off.
  press("ArrowDown");
  await focused("Hand off to Alpha");
  fireEvent.click(document.activeElement!);
  await waitFor(() => expect(api.startHandoff).toHaveBeenCalledTimes(1));
  expect(lastStart().startIn).toEqual({ kind: "new", source: "develop" });
});

it("disables New worktree, and says why, in a folder that is not a git repository", async () => {
  vi.mocked(api.listRepositoryBranches).mockResolvedValue({
    unavailable: "not_repository",
    branches: [],
  });
  await openSheet();

  // The hand off starts in the main folder, whatever Settings say.
  fireEvent.click(await topLine("Main folder"));
  const fresh = await screen.findByRole("menuitemradio", {
    name: /New worktree/,
  });
  expect(fresh.getAttribute("aria-disabled")).toBe("true");
  expect(fresh.textContent).toContain("atlas-web is not a git repository");
  expect(
    screen
      .getByRole("menuitemradio", { name: /Main folder/ })
      .getAttribute("aria-checked"),
  ).toBe("true");
});

it.each([
  {
    folders: ["atlas-web", "atlas-api"],
    says: "Asks which folder to start in",
    then: "Then its last worktree there, or a new one",
  },
  {
    folders: [],
    says: "Asks for a repository folder first",
    then: "Then its last worktree there, or a new one",
  },
])(
  "says in the row that the folder is asked for first: $says",
  async ({ folders, says, then }) => {
    vi.mocked(api.listRepositoryFolders).mockResolvedValue(
      folders.map((name) => ({ ...folder, id: name, name, projectId })),
    );
    const sheet = await openSheet();
    await waitFor(() => expect(sheet.textContent).toContain(says));
    await waitFor(() => expect(sheet.textContent).toContain(then));
    // The sheet's heading group carries it, for a screen reader.
    expect(
      within(sheet).getByRole("group", { name: new RegExp(says) }),
    ).toBeTruthy();
    // Plain text: the place is chosen once the folder is.
    expect(screen.queryByRole("menuitem", { name: /^Start in:/ })).toBeNull();
    expect(api.listRepositoryBranches).not.toHaveBeenCalled();
  },
);

it("stops the hand off and says why when the Start in setting can't be read, since it may be Ask each time", async () => {
  await openSheet();
  // The setting can't be read from here on.
  vi.mocked(api.getProjectStartIn).mockRejectedValue(new Error("offline"));
  pickTool("Alpha");

  expect(
    (await screen.findAllByText("Couldn't hand off to Alpha")).length,
  ).toBeGreaterThan(0);
  expect(
    screen.getAllByText("Ajour couldn't read where hand offs start. Try again.")
      .length,
  ).toBeGreaterThan(0);
  expect(api.startHandoff).not.toHaveBeenCalled();
  // The item can be handed off again.
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Hand off" }).hasAttribute("disabled"),
    ).toBe(false),
  );
});

/** Ask each time is on in Settings › Worktrees. */
function askEachTime() {
  vi.mocked(api.getProjectStartIn).mockResolvedValue({ settings: "ask" });
}

/** The Start in dialog, once it listed the folder's branches. */
async function startInDialog(tool = "Alpha") {
  const dialog = await screen.findByRole("dialog", {
    name: `Hand off to ${tool}`,
  });
  const field = within(dialog).getByRole("combobox", {
    name: "Where to start",
  });
  await within(dialog).findByRole("option", { name: /origin\/main/ });
  const summary = () =>
    document.getElementById(
      within(dialog)
        .getByRole("button", { name: "Hand off" })
        .getAttribute("aria-describedby")!,
    )!.textContent;
  const handOff = () =>
    within(dialog).getByRole("button", { name: "Hand off" });
  return { dialog, field, summary, handOff };
}

it("asks where to start when Start in is Ask each time, and does what its summary line says", async () => {
  askEachTime();
  vi.mocked(api.listItemWorktrees).mockResolvedValue([worktreeOf()]);
  await openSheet();
  await topLine("Ask each time");
  pickTool("Alpha");

  const { dialog, field, summary, handOff } = await startInDialog();
  expect(api.startHandoff).not.toHaveBeenCalled();
  // The item's worktree, the branches, then the main folder.
  expect(
    within(within(dialog).getByRole("listbox"))
      .getAllByRole("group")
      .map((group) => group.getAttribute("aria-label")),
  ).toEqual(["This item's worktree", "New worktree from", "No worktree"]);
  // It opens on a new worktree from the default source, on the template's
  // branch name.
  expect(summary()).toBe("New branch week-grid from origin/main");
  expect(document.activeElement).toBe(field);

  // A branch row: a new worktree from that branch.
  fireEvent.click(within(dialog).getByRole("option", { name: /develop/ }));
  expect(summary()).toBe("New branch week-grid from develop");
  // The item's worktree.
  fireEvent.click(within(dialog).getByRole("option", { name: /aj-4821/ }));
  expect(summary()).toBe("Starts in aj-4821, on 4821-week-grid");
  // The main folder.
  fireEvent.click(within(dialog).getByRole("option", { name: /Main folder/ }));
  expect(summary()).toBe("Starts in atlas-web, on develop");

  fireEvent.click(within(dialog).getByRole("option", { name: /develop/ }));
  fireEvent.click(handOff());

  await waitFor(() => expect(api.startHandoff).toHaveBeenCalledTimes(1));
  expect(lastStart().startIn).toEqual({ kind: "new", source: "develop" });
  await waitFor(() =>
    expect(
      screen.queryByRole("dialog", { name: "Hand off to Alpha" }),
    ).toBeNull(),
  );
});

it("asks where to start for a project set to Ask each time while Settings say New worktree", async () => {
  vi.mocked(api.getProjectStartIn).mockResolvedValue({
    override: "ask",
    settings: "worktree",
  });
  await openSheet();
  await topLine("Ask each time");
  pickTool("Alpha");

  await startInDialog();
  expect(api.startHandoff).not.toHaveBeenCalled();
  expect(api.getProjectStartIn).toHaveBeenLastCalledWith(projectId);
});

it("hands off at once for a project set to Main folder while Settings say Ask each time, and its row says Main folder", async () => {
  vi.mocked(api.getProjectStartIn).mockResolvedValue({
    override: "main",
    settings: "ask",
  });
  await openSheet();
  await topLine("Main folder");
  pickTool("Alpha");

  await waitFor(() => expect(api.startHandoff).toHaveBeenCalledTimes(1));
  expect(
    screen.queryByRole("dialog", { name: "Hand off to Alpha" }),
  ).toBeNull();
  // The user chose nothing in the sheet, so the local API decides the
  // place, from the same project choice.
  expect(lastStart()).not.toHaveProperty("startIn");
});

it("names no source where the folder's list can't say which one the start will use, and sends the branch the user picks", async () => {
  // A clone that never recorded its remote's default branch: the start
  // asks the remote, which may answer another branch than the main folder's.
  const { source: _source, ...unsourced } = branches;
  vi.mocked(api.listRepositoryBranches).mockResolvedValue(unsourced);
  askEachTime();
  await openSheet();
  pickTool("Alpha");
  const dialog = await screen.findByRole("dialog", {
    name: "Hand off to Alpha",
  });
  const unnamed = await within(dialog).findByRole("option", {
    name: "Default branch",
  });
  const summary = () =>
    document.getElementById(
      within(dialog)
        .getByRole("button", { name: "Hand off" })
        .getAttribute("aria-describedby")!,
    )!.textContent;

  // It opens on the default branch, which it doesn't name.
  expect(unnamed.getAttribute("aria-selected")).toBe("true");
  expect(summary()).toBe("New branch week-grid from the default branch");

  // A branch the user picks is named, and sent.
  fireEvent.click(within(dialog).getByRole("option", { name: /origin\/main/ }));
  expect(summary()).toBe("New branch week-grid from origin/main");
  fireEvent.click(within(dialog).getByRole("button", { name: "Hand off" }));
  await waitFor(() => expect(api.startHandoff).toHaveBeenCalledTimes(1));
  expect(lastStart().startIn).toEqual({ kind: "new", source: "origin/main" });
});

it("opens the Start in dialog on Main folder in a repository with nothing a new worktree could start from", async () => {
  // A repository without a commit: no branch exists yet.
  vi.mocked(api.listRepositoryBranches).mockResolvedValue({
    current: "main",
    source: "main",
    branches: [],
  });
  askEachTime();
  await openSheet();
  pickTool("Alpha");
  const dialog = await screen.findByRole("dialog", {
    name: "Hand off to Alpha",
  });

  const main = await within(dialog).findByRole("option", {
    name: /Main folder/,
  });
  expect(main.getAttribute("aria-selected")).toBe("true");
  expect(within(dialog).queryByRole("option", { name: "Default branch" })).toBe(
    null,
  );
  const handOff = within(dialog).getByRole("button", { name: "Hand off" });
  await waitFor(() => expect(handOff.hasAttribute("disabled")).toBe(false));
  fireEvent.click(handOff);
  await waitFor(() => expect(api.startHandoff).toHaveBeenCalledTimes(1));
  expect(lastStart().startIn).toEqual({ kind: "main" });
});

it("leaves the source to the start in the sheet when the list names none, until the user picks one", async () => {
  const { source: _source, ...unsourced } = branches;
  vi.mocked(api.listRepositoryBranches).mockResolvedValue(unsourced);
  vi.mocked(api.getProjectStartIn).mockResolvedValue({ settings: "worktree" });
  await openSheet();

  fireEvent.click(await bottomLine("From the default branch"));
  const list = await screen.findByRole("listbox", { name: "Source branch" });
  // No branch is marked as the one in force.
  expect(
    within(list)
      .getAllByRole("option")
      .filter((option) => option.getAttribute("aria-selected") === "true"),
  ).toEqual([]);
  fireEvent.click(within(list).getByRole("option", { name: /develop/ }));

  await bottomLine("From develop");
  pickTool("Alpha");
  await waitFor(() => expect(api.startHandoff).toHaveBeenCalledTimes(1));
  expect(lastStart().startIn).toEqual({ kind: "new", source: "develop" });
});

it("offers Create <name> for text that is no branch, with its source, and starts a worktree on that branch", async () => {
  askEachTime();
  await openSheet();
  pickTool("Alpha");
  const { dialog, field, summary, handOff } = await startInDialog();

  // Typing filters the branches.
  fireEvent.change(field, { target: { value: "release" } });
  expect(
    within(dialog)
      .getAllByRole("option")
      .map((option) => option.textContent),
    // The picked row shows the key that hands off.
  ).toEqual(["Create release↵", "origin/release/1.4"]);

  fireEvent.change(field, { target: { value: "4821-spike" } });
  const create = within(dialog).getByRole("option", {
    name: "Create 4821-spike",
  });
  // The first row, picked as the text is typed.
  expect(create.getAttribute("aria-selected")).toBe("true");
  expect(summary()).toBe("New branch 4821-spike from origin/main");

  // Its source, on its second line, opens the finder with branches only.
  fireEvent.click(
    within(dialog).getByRole("button", {
      name: "Source of the new branch: origin/main",
    }),
  );
  const sources = await screen.findByRole("listbox", {
    name: "Source of the new branch",
  });
  expect(
    within(sources)
      .getAllByRole("option")
      .map((option) => option.textContent),
  ).toEqual([
    "origin/maindefault",
    "developin atlas-web",
    "origin/release/1.4",
  ]);
  fireEvent.click(within(sources).getByRole("option", { name: /develop/ }));
  await waitFor(() =>
    expect(summary()).toBe("New branch 4821-spike from develop"),
  );

  fireEvent.click(handOff());
  await waitFor(() => expect(api.startHandoff).toHaveBeenCalledTimes(1));
  expect(lastStart().startIn).toEqual({
    kind: "new",
    branch: "4821-spike",
    source: "develop",
  });
});

it("hands off from the field with Enter, on the row the arrows picked", async () => {
  askEachTime();
  await openSheet();
  pickTool("Beta");
  const { field, summary } = await startInDialog("Beta");

  fireEvent.keyDown(field, { key: "ArrowDown" });
  expect(summary()).toBe("New branch week-grid from develop");
  fireEvent.keyDown(field, { key: "ArrowUp" });
  expect(summary()).toBe("New branch week-grid from origin/main");
  fireEvent.keyDown(field, { key: "Enter" });

  await waitFor(() => expect(api.startHandoff).toHaveBeenCalledTimes(1));
  // The default source is no pick of the user's, so the request names none.
  expect(lastStart()).toMatchObject({
    toolId: "beta",
    startIn: { kind: "new" },
  });
});

it("says why a typed name can't be a branch and disables Hand off, and keeps a refusal in the dialog", async () => {
  askEachTime();
  await openSheet();
  pickTool("Alpha");
  const { dialog, field, summary, handOff } = await startInDialog();

  fireEvent.change(field, { target: { value: "bad branch" } });
  expect(summary()).toBe("Not a valid git branch name.");
  expect(handOff().hasAttribute("disabled")).toBe(true);
  fireEvent.keyDown(field, { key: "Enter" });
  expect(api.startHandoff).not.toHaveBeenCalled();

  vi.mocked(api.startHandoff).mockRejectedValue(
    new Error("Alpha is not signed in."),
  );
  fireEvent.change(field, { target: { value: "4821-spike" } });
  expect(handOff().hasAttribute("disabled")).toBe(false);
  fireEvent.click(handOff());
  expect(
    (await within(dialog).findByText("Alpha is not signed in.")).getAttribute(
      "role",
    ),
  ).toBe("alert");
  expect(
    screen.getByRole("dialog", { name: "Hand off to Alpha" }),
  ).toBeTruthy();
});

it("asks from the Handoffs card too, and skips the dialog when the sheet's row already chose", async () => {
  askEachTime();
  await renderRoutes({ routes: { "/": Page } });
  fireEvent.click(
    await screen.findByRole("button", { name: "Hand off to Beta" }),
  );
  const { dialog } = await startInDialog("Beta");
  fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
  await waitFor(() =>
    expect(
      screen.queryByRole("dialog", { name: "Hand off to Beta" }),
    ).toBeNull(),
  );
  expect(api.startHandoff).not.toHaveBeenCalled();

  // A place chosen in the row is the answer.
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Hand off" }).hasAttribute("disabled"),
    ).toBe(false),
  );
  await openSheet();
  fireEvent.click(await topLine("Ask each time"));
  fireEvent.click(
    await screen.findByRole("menuitemradio", { name: /Main folder/ }),
  );
  await topLine("Main folder");
  pickTool("Beta");
  await waitFor(() => expect(api.startHandoff).toHaveBeenCalledTimes(1));
  expect(lastStart().startIn).toEqual({ kind: "main" });
  expect(screen.queryByRole("dialog", { name: "Hand off to Beta" })).toBeNull();
});

/**
 * Opens Review prompt… from the sheet, once the prompt names its folder:
 * it fills first, and follows the folder once that is known.
 */
async function reviewPrompt(tool = "Alpha") {
  await openSheet();
  fireEvent.click(
    await screen.findByRole("menuitem", { name: /Review prompt…/ }),
  );
  const dialog = await screen.findByRole("dialog", {
    name: `Hand off to ${tool}`,
  });
  const prompt = within(dialog).getByLabelText("Prompt") as HTMLTextAreaElement;
  await waitFor(() => expect(prompt.value).toMatch(/ in \S/));
  return { dialog, prompt };
}

it("reviews the prompt with the place and the source under it, and starts with the edited prompt, source and branch name", async () => {
  const { dialog, prompt } = await reviewPrompt();
  expect(prompt.value).toBe("Week grid in atlas-web");
  // The Folder and Branch fields are gone.
  expect(within(dialog).queryByLabelText("Branch")).toBeNull();
  expect(within(dialog).queryByText("Folder")).toBeNull();
  const where = await within(dialog).findByRole("button", {
    name: "New worktree",
  });
  const source = within(dialog).getByRole("button", {
    name: "From origin/main",
  });

  // Each tooltip gives the worktree's path or the whole branch name.
  fireEvent.focus(where);
  expect(
    (
      await screen.findByText(
        "A new worktree in /work/atlas-web/.ajour/worktrees",
      )
    ).textContent,
  ).toBeTruthy();
  fireEvent.blur(where);
  fireEvent.focus(source);
  expect(
    await screen.findByText("New branch week-grid from origin/main"),
  ).toBeTruthy();
  fireEvent.blur(source);

  // The finder picks another source.
  fireEvent.click(source);
  let field = await screen.findByRole("combobox", {
    name: "Source branch, or a name for the new branch",
  });
  fireEvent.change(field, { target: { value: "rel" } });
  fireEvent.click(screen.getByRole("option", { name: /origin\/release\/1.4/ }));
  const sourced = await within(dialog).findByRole("button", {
    name: "From origin/release/1.4",
  });

  // A typed name that is no branch names the new branch.
  fireEvent.click(sourced);
  field = await screen.findByRole("combobox", {
    name: "Source branch, or a name for the new branch",
  });
  fireEvent.change(field, { target: { value: "bad branch" } });
  const refused = screen.getByRole("option", {
    name: /Name the new branch bad branch/,
  });
  expect(refused.getAttribute("aria-disabled")).toBe("true");
  expect(refused.textContent).toContain("Not a valid git branch name.");
  fireEvent.change(field, { target: { value: "4821-spike" } });
  fireEvent.click(
    screen.getByRole("option", { name: "Name the new branch 4821-spike" }),
  );
  await within(dialog).findByRole("button", {
    name: "4821-spike from origin/release/1.4",
  });

  fireEvent.change(prompt, { target: { value: "Fix it, carefully." } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Start" }));

  await waitFor(() => expect(api.startHandoff).toHaveBeenCalledTimes(1));
  expect(lastStart()).toMatchObject({
    folderId: "folder-1",
    promptOverride: "Fix it, carefully.",
    startIn: {
      kind: "new",
      source: "origin/release/1.4",
      branch: "4821-spike",
    },
  });
  await waitFor(() =>
    expect(
      screen.queryByRole("dialog", { name: "Hand off to Alpha" }),
    ).toBeNull(),
  );
});

it("starts Review prompt in the place the sheet's row chose, and keeps a refusal in the dialog", async () => {
  vi.mocked(api.listItemWorktrees).mockResolvedValue([worktreeOf()]);
  vi.mocked(api.startHandoff).mockRejectedValue(
    new Error("Alpha is not signed in."),
  );
  await openSheet();
  fireEvent.click(await topLine("Start in aj-4821"));
  fireEvent.click(
    await screen.findByRole("menuitemradio", { name: /Main folder/ }),
  );
  await topLine("Main folder");
  fireEvent.click(screen.getByRole("menuitem", { name: /Review prompt…/ }));

  const dialog = await screen.findByRole("dialog", {
    name: "Hand off to Alpha",
  });
  await within(dialog).findByRole("button", { name: "Main folder" });
  // The branch checked out there, as plain text.
  expect(within(dialog).getByText("On develop")).toBeTruthy();
  expect(within(dialog).queryByRole("button", { name: /^From/ })).toBeNull();
  const start = within(dialog).getByRole("button", { name: "Start" });
  await waitFor(() => expect(start.hasAttribute("disabled")).toBe(false));
  fireEvent.click(start);

  expect((await within(dialog).findByRole("alert")).textContent).toBe(
    "Alpha is not signed in.",
  );
  expect(lastStart().startIn).toEqual({ kind: "main" });
});

it("lists the Start in choices once per repository folder in Review prompt, and names the folder on the button", async () => {
  vi.mocked(api.listRepositoryFolders).mockResolvedValue([
    { ...folder, projectId },
    {
      ...folder,
      id: "folder-2",
      name: "atlas-api",
      path: "/work/atlas-api",
      projectId,
      lastUsedAt: 9,
    },
  ]);
  vi.mocked(api.listItemWorktrees).mockResolvedValue([worktreeOf()]);
  const { dialog, prompt } = await reviewPrompt();

  // The last used folder, which has no worktree of the item.
  const where = await within(dialog).findByRole("button", {
    name: "New worktree in atlas-api",
  });
  expect(prompt.value).toBe("Week grid in atlas-api");

  fireEvent.click(where);
  const menu = await screen.findByRole("menu");
  const web = within(menu).getByRole("group", { name: "Start in atlas-web" });
  const apiFolder = within(menu).getByRole("group", {
    name: "Start in atlas-api",
  });
  const rowsOf = (group: HTMLElement) =>
    within(group)
      .getAllByRole("menuitemradio")
      .map((row) => row.textContent);
  expect(rowsOf(web)).toEqual([
    "Main folderatlas-web",
    "New worktree",
    "Previous worktreeaj-4821 · 4821-week-grid",
  ]);
  expect(rowsOf(apiFolder)).toEqual(["Main folderatlas-api", "New worktree"]);
  fireEvent.click(
    within(web).getByRole("menuitemradio", { name: /Previous worktree/ }),
  );

  // The other folder's worktree: the button names both, and the prompt
  // follows the folder.
  await within(dialog).findByRole("button", {
    name: "Start in aj-4821 in atlas-web",
  });
  expect(within(dialog).getByText("4821-week-grid")).toBeTruthy();
  await waitFor(() => expect(prompt.value).toBe("Week grid in atlas-web"));
  fireEvent.click(within(dialog).getByRole("button", { name: "Start" }));

  await waitFor(() => expect(api.startHandoff).toHaveBeenCalledTimes(1));
  expect(lastStart()).toMatchObject({
    folderId: "folder-1",
    startIn: { kind: "worktree", worktreeId: "worktree-1" },
  });
});

/*
 * A tool that makes its own worktree (#863): Beta declares it, Alpha does
 * not. Its row in the sheet says what it does where the hand off starts.
 */

/** What a tool's row says under its name, which a screen reader hears too. */
const toolNote = (tool: string) =>
  screen
    .getByRole("menuitem", { name: `Hand off to ${tool}` })
    .getAttribute("aria-description");

it("says on the row of a tool that makes its own worktree that it does under New worktree, and nothing of it under Main folder", async () => {
  cachePluginsOverview(overview(["beta"]));
  await openSheet();
  await topLine("New worktree");

  await waitFor(() => expect(toolNote("Beta")).toBe("Makes its own worktree"));
  expect(screen.getByText("Makes its own worktree")).toBeTruthy();
  // A tool without it reads as before.
  expect(toolNote("Alpha")).toBe("Follows progress");

  fireEvent.click(await topLine("New worktree"));
  fireEvent.click(
    await screen.findByRole("menuitemradio", { name: /Main folder/ }),
  );
  await topLine("Main folder");
  expect(toolNote("Beta")).toBe("Follows progress");
  expect(screen.queryByText("Makes its own worktree")).toBeNull();

  // The start carries the place, as for any tool.
  pickTool("Beta");
  await waitFor(() => expect(api.startHandoff).toHaveBeenCalledTimes(1));
  expect(lastStart()).toMatchObject({
    toolId: "beta",
    startIn: { kind: "main" },
  });
});

it("says such a tool can't join the item's worktree and makes its own, and still hands off to it", async () => {
  cachePluginsOverview(overview(["beta"]));
  vi.mocked(api.listItemWorktrees).mockResolvedValue([worktreeOf()]);
  // Alpha was used last: its row says so, on its one line.
  window.localStorage.setItem(
    "ajour.handoff-last-tool",
    "example-handoff:alpha",
  );
  resetLastHandoffTool();
  await openSheet();
  await topLine("Start in aj-4821");

  await waitFor(() =>
    expect(toolNote("Beta")).toBe("Can't join aj-4821; makes its own"),
  );
  expect(toolNote("Alpha")).toBe("Follows progress · last used");
  // The row stays enabled.
  const beta = screen.getByRole("menuitem", { name: "Hand off to Beta" });
  expect(beta.getAttribute("aria-disabled")).not.toBe("true");

  pickTool("Beta");
  await waitFor(() => expect(api.startHandoff).toHaveBeenCalledTimes(1));
  // The user chose nothing: the local API decides, and makes it New worktree.
  expect(lastStart()).toMatchObject({ toolId: "beta", folderId: "folder-1" });
  expect(lastStart()).not.toHaveProperty("startIn");
});

it("says in the Start in dialog what such a tool will do with the row picked, and leaves its row plain under Ask each time", async () => {
  cachePluginsOverview(overview(["beta"]));
  askEachTime();
  vi.mocked(api.listItemWorktrees).mockResolvedValue([worktreeOf()]);
  await openSheet();
  await topLine("Ask each time");
  // The place is not known yet, so the row promises nothing.
  expect(toolNote("Beta")).toBe("Follows progress");
  pickTool("Beta");

  const { dialog, summary, handOff } = await startInDialog("Beta");
  expect(summary()).toBe(
    "Beta makes its own worktree, on week-grid from origin/main",
  );
  fireEvent.click(within(dialog).getByRole("option", { name: /aj-4821/ }));
  expect(summary()).toBe(
    "Can't join aj-4821; Beta makes its own, on week-grid from origin/main",
  );
  fireEvent.click(within(dialog).getByRole("option", { name: /Main folder/ }));
  expect(summary()).toBe("Starts in atlas-web, on develop");

  fireEvent.click(within(dialog).getByRole("option", { name: /aj-4821/ }));
  fireEvent.click(handOff());
  await waitFor(() => expect(api.startHandoff).toHaveBeenCalledTimes(1));
  expect(lastStart()).toMatchObject({
    toolId: "beta",
    startIn: { kind: "worktree", worktreeId: "worktree-1" },
  });
});

it("says in Review prompt's tooltips that such a tool makes its own worktree, with the branch and the source it is told", async () => {
  cachePluginsOverview(overview(["beta"]));
  // Review prompt is for the tool last used.
  window.localStorage.setItem(
    "ajour.handoff-last-tool",
    "example-handoff:beta",
  );
  resetLastHandoffTool();
  const sheet = await openSheet();
  // The note has the row's second line to itself: no "last used" after it.
  await waitFor(() => expect(toolNote("Beta")).toBe("Makes its own worktree"));
  expect(sheet.textContent).not.toContain("last used");
  fireEvent.keyDown(document.activeElement!, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
  const { dialog } = await reviewPrompt("Beta");
  const where = await within(dialog).findByRole("button", {
    name: "New worktree",
  });
  const source = within(dialog).getByRole("button", {
    name: "From origin/main",
  });

  fireEvent.focus(where);
  expect(await screen.findByText("Beta makes its own worktree")).toBeTruthy();
  fireEvent.blur(where);
  fireEvent.focus(source);
  expect(
    await screen.findByText(
      "Beta makes its own worktree, on week-grid from origin/main",
    ),
  ).toBeTruthy();
});

it("says in the toast that such a tool's worktree starts from the last fetched copy when the fetch failed", async () => {
  cachePluginsOverview(overview(["beta"]));
  vi.mocked(api.startHandoff).mockImplementation(async (input) => ({
    ...record({ id: "started-beta", toolId: input.toolId, ownWorktree: true }),
    source: "origin/main",
    sourceStale: true,
  }));
  await openSheet();
  pickTool("Beta");

  // No worktree of Ajour's to name: the toast names the tool alone.
  await screen.findByText("Handed off to Beta");
  expect(
    screen.getByText(
      "Couldn't fetch origin/main. The worktree starts from the last fetched copy.",
    ),
  ).toBeTruthy();
});
