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
import type {
  ListedWorktree,
  WorktreeDeletePreview,
  WorktreeStatus,
} from "@ajour/shared/worktrees";
import { Toaster } from "@/components/ui/toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import * as api from "@/lib/app-api";
import { cachePluginsOverview } from "@/lib/app-api";
import { copyTextToClipboard } from "@/lib/clipboard";
import { localStore } from "@/lib/local-store";
import { setHandoffs } from "@/lib/handoffs";
import { resetWorktrees } from "@/lib/worktrees";
import {
  resetHandoffToolDetections,
  resetLastHandoffTool,
} from "@/lib/handoff-tools";
import { useLocalState } from "@/lib/local-hooks";
import { installDomShims, renderRoutes } from "@/test-support/dom";
import { HandoffHost } from "./handoff-workflow";
import { HandoffsCard } from "./backlog-item-side-cards";
import { useItemHandoffs } from "./use-item-handoffs";

/*
 * Worktrees on the item page's Handoffs card (#862): the line above each
 * group of threads, a worktree's menu, the dialog that asks before a
 * delete, and Forget for a worktree whose folder is gone. The local API
 * module is mocked, and the tools are an example plugin's, Alpha and Beta.
 * Each test reads what the user sees on the card and what the window then
 * asks the local API.
 */

vi.mock("@/lib/app-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/app-api")>()),
  deleteWorktree: vi.fn(),
  detectHandoffTools: vi.fn(),
  findHandoffThreads: vi.fn(),
  forgetWorktree: vi.fn(),
  getHandoffTemplates: vi.fn(),
  getProjectStartIn: vi.fn(),
  listHandoffs: vi.fn(),
  listItemWorktrees: vi.fn(),
  listRepositoryBranches: vi.fn(),
  listRepositoryFolders: vi.fn(),
  listWorktreeStatuses: vi.fn(),
  listWorktrees: vi.fn(),
  openWorktree: vi.fn(),
  previewWorktreeDelete: vi.fn(),
  refreshHandoffs: vi.fn(),
  startHandoff: vi.fn(),
  useRepositoryFolder: vi.fn(),
}));
vi.mock("@/lib/clipboard", () => ({ copyTextToClipboard: vi.fn() }));

beforeAll(installDomShims);

const ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6"/></svg>';

/**
 * One active example plugin with two tools that follow state, both on
 * unless `enabledTools` says otherwise. The tools named in `ownWorktree`
 * declare that they make their own worktree (#863).
 */
function overview(
  enabledTools = ["alpha", "beta"],
  ownWorktree: readonly string[] = [],
): PluginsOverview {
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
        enabledHandoffTools: enabledTools,
        connections: [],
      },
    ],
    totalPendingImportCount: 0,
    totalSelectedImportCount: 0,
  } as PluginsOverview;
}

let itemId = "";
let projectId = "";
let run = 0;
/** The item's threads as the local API keeps them. */
let kept: Handoff[] = [];

const PATH = "/work/atlas-web/.ajour/worktrees/aj-4821";

/** A worktree of the item as a list shows it, with its status. */
const listed = (
  status: WorktreeStatus,
  overrides: Partial<ListedWorktree["worktree"]> = {},
): ListedWorktree => {
  const name = overrides.name ?? "aj-4821";
  return {
    worktree: {
      id: "worktree-1",
      repositoryFolderId: "folder-1",
      projectId,
      workItemId: itemId,
      itemKey: "4821",
      name,
      branch: "4821-week-grid",
      source: "origin/main",
      createdAt: 1_000,
      ...overrides,
    },
    status,
    path: `/work/atlas-web/.ajour/worktrees/${name}`,
  };
};

const CLEAN: WorktreeStatus = { state: "clean" };

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
    state: "ready",
    checkedAt: 2_000,
    changedAt: 2_000,
    history: [],
    ...overrides,
  };
}

/** What a delete of the worktree would lose, as the local API previews it. */
const preview = (
  overrides: Partial<WorktreeDeletePreview> = {},
): WorktreeDeletePreview => ({
  listed: listed(CLEAN),
  fingerprint: "status-1",
  files: [],
  moreFiles: 0,
  running: [],
  branch: { name: "4821-week-grid", unpushedCommits: 0 },
  ...overrides,
});

/** The desktop app on that system: the web build shows no worktree. */
const onDesktop = (platform: string) => {
  window.ajourDesktop = {
    chooseFolder: vi.fn(),
    runtime: { platform },
  } as unknown as typeof window.ajourDesktop;
};

beforeEach(() => {
  window.localStorage.setItem(
    "ajour.handoff-notices",
    JSON.stringify(["example-handoff:alpha", "example-handoff:beta"]),
  );
  resetLastHandoffTool();
  resetHandoffToolDetections();
  onDesktop("darwin");
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
    prompt: "{{item.title}}",
    title: "{{item.title}}",
    branch: "{{item.title|slug}}",
  });
  vi.mocked(api.useRepositoryFolder).mockResolvedValue([]);
  vi.mocked(api.getProjectStartIn).mockResolvedValue({ settings: "worktree" });
  vi.mocked(api.listItemWorktrees).mockResolvedValue([]);
  vi.mocked(api.listRepositoryBranches).mockResolvedValue({ branches: [] });
  vi.mocked(api.findHandoffThreads).mockResolvedValue({ offers: [] });
  // Opening the item asks its live threads for their state: none changed.
  vi.mocked(api.refreshHandoffs).mockImplementation(async () => ({
    handoffs: kept,
    failures: [],
  }));
  vi.mocked(api.listWorktreeStatuses).mockResolvedValue([]);
  vi.mocked(copyTextToClipboard).mockResolvedValue(true);
  // The store outlives each test, so every test names its own project.
  const projectName = `Atlas worktrees ${++run}`;
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
    { id: "folder-1", projectId, name: "atlas-web", path: "/work/atlas-web" },
  ]);
});

afterEach(() => {
  cleanup();
  delete window.ajourDesktop;
  vi.resetAllMocks();
});

/** The item page's Handoffs card, shown and fed as the page does. */
function Page() {
  const state = useLocalState();
  const item = state.workItems.find((candidate) => candidate._id === itemId);
  const handoffs = useItemHandoffs(itemId, projectId);
  return (
    <TooltipProvider>
      {handoffs.shown ? null : <p>No Handoffs card</p>}
      <HandoffsCard
        itemId={itemId}
        item={item}
        handoffs={handoffs.records}
        tools={handoffs.tools}
        worktrees={handoffs.worktrees}
        folders={handoffs.folders}
        onWorktreesChanged={handoffs.reloadWorktrees}
        now={10 * 60_000}
        open
        onOpenChange={() => {}}
      />
      <HandoffHost />
      <Toaster />
    </TooltipProvider>
  );
}

/** Opens the item page with these threads, as the local API keeps them. */
async function openItem(records: Handoff[] = []) {
  kept = records;
  act(() => setHandoffs(records));
  await renderRoutes({ routes: { "/": Page } });
}

/** The group of threads under the line that starts with `name`. */
const groupOf = (name: string) =>
  screen.findByRole("group", { name: new RegExp(`^${name}, `) });

/** Opens the "…" menu of the worktree's line. */
async function openMenu(name = "aj-4821") {
  fireEvent.click(
    within(await groupOf(name)).getByRole("button", {
      name: `Actions for ${name}`,
    }),
  );
  return screen.findByRole("menu");
}

const menuItems = (menu: HTMLElement) =>
  within(menu)
    .getAllByRole("menuitem")
    .map((item) => item.textContent);

it("names each worktree above its threads with its status and thread count, and the main folder's threads under the folder's name", async () => {
  vi.mocked(api.listWorktreeStatuses).mockResolvedValue([
    listed(
      { state: "changed", changes: 3 },
      { id: "worktree-2", name: "aj-4821-2", createdAt: 2_000 },
    ),
    listed(CLEAN),
  ]);

  await openItem([
    record({ id: "h1", title: "First try", worktreeId: "worktree-1" }),
    record({
      id: "h2",
      title: "Second tool",
      toolId: "beta",
      threadId: "thread-2",
      worktreeId: "worktree-1",
    }),
    record({ id: "h3", title: "In the main folder", threadId: "thread-3" }),
  ]);

  const first = await groupOf("aj-4821");
  // By item alone: a worktree made in a project the item left still shows.
  expect(api.listWorktreeStatuses).toHaveBeenCalledWith({
    workItemId: itemId,
  });
  expect(first.getAttribute("aria-label")).toBe("aj-4821, Clean, 2 threads");
  expect(within(first).getByText("· Clean · 2 threads")).toBeTruthy();
  expect(
    within(first)
      .getAllByRole("listitem")
      .map((row) => row.getAttribute("aria-label"))
      .sort(),
  ).toEqual(["First try", "Second tool"]);
  // The newest worktree comes first. It has no thread yet, and keeps its menu.
  const groups = screen.getAllByRole("group");
  expect(groups.map((group) => group.getAttribute("aria-label"))).toEqual([
    "aj-4821-2, 3 changes, No thread",
    "aj-4821, Clean, 2 threads",
    "atlas-web, 1 thread",
  ]);
  expect(within(groups[0]!).queryByRole("listitem")).toBeNull();
  expect(
    within(groups[0]!).getByRole("button", { name: "Actions for aj-4821-2" }),
  ).toBeTruthy();
  // The main folder's threads sit under the repository folder's name,
  // which has no menu.
  expect(
    within(groups[2]!).getByRole("listitem", { name: "In the main folder" }),
  ).toBeTruthy();
  expect(
    within(groups[2]!).queryByRole("button", { name: /^Actions for/ }),
  ).toBeNull();
  // A thread row stays as it is: its Open and its own menu.
  const row = within(first).getByRole("listitem", { name: "First try" });
  expect(within(row).getByRole("button", { name: /^Open / })).toBeTruthy();
  expect(
    within(row).getByRole("button", { name: "Handoff actions" }),
  ).toBeTruthy();
});

it("shows the card as before for an item without a worktree, and asks for none in the web build", async () => {
  await openItem([record({ id: "h1", title: "In the main folder" })]);

  const rows = await screen.findByRole("list", { name: "Handoffs" });
  expect(
    within(rows).getByRole("listitem", { name: "In the main folder" }),
  ).toBeTruthy();
  await waitFor(() => expect(api.listWorktreeStatuses).toHaveBeenCalled());
  expect(screen.queryByRole("group")).toBeNull();
  expect(screen.queryByText(/atlas-web/)).toBeNull();
  // Only an item with a worktree needs its folders' names.
  expect(api.listRepositoryFolders).not.toHaveBeenCalled();

  // The web build has no hand off and no worktree: it asks for nothing.
  cleanup();
  vi.mocked(api.listWorktreeStatuses).mockClear();
  delete window.ajourDesktop;
  await openItem([record({ id: "h1", title: "In the main folder" })]);
  await screen.findByRole("list", { name: "Handoffs" });
  expect(api.listWorktreeStatuses).not.toHaveBeenCalled();
});

it("keeps the card for an item whose worktree is all it has left: no thread, and every tool off", async () => {
  cachePluginsOverview(overview([]));
  vi.mocked(api.listWorktreeStatuses).mockResolvedValue([listed(CLEAN)]);

  await openItem([]);

  // The worktree's line and its menu stay within reach of the item.
  expect((await groupOf("aj-4821")).getAttribute("aria-label")).toBe(
    "aj-4821, Clean, No thread",
  );
  expect(screen.queryByText("No Handoffs card")).toBeNull();
  expect(menuItems(await openMenu())).toContain("Delete worktree…");
});

it("reads a worktree's status again the next time the card loads", async () => {
  vi.mocked(api.listWorktreeStatuses).mockResolvedValue([listed(CLEAN)]);
  const thread = record({ id: "h1", worktreeId: "worktree-1" });
  await openItem([thread]);
  expect((await groupOf("aj-4821")).getAttribute("aria-label")).toBe(
    "aj-4821, Clean, 1 thread",
  );

  // A file changed in the worktree while the page was closed.
  cleanup();
  vi.mocked(api.listWorktreeStatuses).mockResolvedValue([
    listed({ state: "changed", changes: 1 }),
  ]);
  await openItem([thread]);

  expect((await groupOf("aj-4821")).getAttribute("aria-label")).toBe(
    "aj-4821, 1 change, 1 thread",
  );
});

it.each([
  ["darwin", "Show in Finder"],
  ["win32", "Show in File Explorer"],
])(
  "opens a worktree in the terminal and in the file manager, named as on %s, and copies its path",
  async (platform, showInFiles) => {
    onDesktop(platform);
    vi.mocked(api.listWorktreeStatuses).mockResolvedValue([listed(CLEAN)]);
    vi.mocked(api.openWorktree).mockResolvedValue({ ok: true });
    await openItem([record({ worktreeId: "worktree-1" })]);

    expect(menuItems(await openMenu())).toEqual([
      "Open in terminal",
      showInFiles,
      "Copy path",
      "Delete worktree…",
    ]);
    fireEvent.click(screen.getByRole("menuitem", { name: "Open in terminal" }));
    await waitFor(() =>
      expect(api.openWorktree).toHaveBeenCalledWith("worktree-1", "terminal"),
    );

    await openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: showInFiles }));
    await waitFor(() =>
      expect(api.openWorktree).toHaveBeenCalledWith("worktree-1", "files"),
    );

    await openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Copy path" }));
    await waitFor(() => expect(copyTextToClipboard).toHaveBeenCalledWith(PATH));
    expect(await screen.findByText("Path copied")).toBeTruthy();
  },
);

it("says why a worktree's folder didn't open, in the local API's words", async () => {
  vi.mocked(api.listWorktreeStatuses).mockResolvedValue([listed(CLEAN)]);
  vi.mocked(api.openWorktree).mockRejectedValue(
    new Error("The folder of aj-4821 is no longer on disk."),
  );
  await openItem([record({ worktreeId: "worktree-1" })]);

  await openMenu();
  fireEvent.click(screen.getByRole("menuitem", { name: "Open in terminal" }));

  // The toast holds its text twice: once to see, once for a screen reader.
  expect(
    (await screen.findAllByText("Couldn't open the terminal")).length,
  ).toBeGreaterThan(0);
  expect(
    screen.getAllByText("The folder of aj-4821 is no longer on disk.").length,
  ).toBeGreaterThan(0);
});

it("asks before a delete with the files it would lose and a warning for each thread still running, then deletes and keeps the threads on the card", async () => {
  const thread = record({ id: "h1", worktreeId: "worktree-1" });
  vi.mocked(api.listWorktreeStatuses).mockResolvedValue([
    listed({ state: "changed", changes: 3 }),
  ]);
  vi.mocked(api.previewWorktreeDelete).mockResolvedValue(
    preview({
      listed: listed({ state: "changed", changes: 3 }),
      files: [
        { code: " M", path: "src/week-grid.tsx" },
        { code: "R ", path: "src/keys.ts", from: "src/keyboard.ts" },
        { code: "??", path: "notes.md" },
      ],
      running: [
        { pluginId: "example-handoff", toolId: "alpha", state: "working" },
        { pluginId: "example-handoff", toolId: "beta", state: "needs-you" },
      ],
      branch: { name: "4821-week-grid", unpushedCommits: 2 },
    }),
  );
  const { worktreeId: _gone, ...unlinked } = thread;
  vi.mocked(api.deleteWorktree).mockResolvedValue({
    branchDeleted: false,
    handoffs: [unlinked],
  });
  await openItem([thread]);

  await openMenu();
  fireEvent.click(screen.getByRole("menuitem", { name: "Delete worktree…" }));
  const dialog = await screen.findByRole("alertdialog");

  expect(within(dialog).getByText("Delete aj-4821?")).toBeTruthy();
  expect(
    await within(dialog).findByText(
      "Deleting the worktree loses its 3 uncommitted changes.",
    ),
  ).toBeTruthy();
  expect(api.previewWorktreeDelete).toHaveBeenCalledWith("worktree-1");
  expect(
    within(within(dialog).getByRole("list", { name: "Uncommitted changes" }))
      .getAllByRole("listitem")
      .map((line) => line.textContent),
  ).toEqual([
    " M src/week-grid.tsx",
    "R  src/keyboard.ts -> src/keys.ts",
    "?? notes.md",
  ]);
  expect(
    within(dialog).getByText("Alpha is still working in it."),
  ).toBeTruthy();
  expect(
    within(dialog).getByText("Beta is waiting for you in it."),
  ).toBeTruthy();
  const box = within(dialog).getByRole("checkbox", {
    name: "Also delete the branch 4821-week-grid",
  });
  expect(box.getAttribute("aria-checked")).toBe("false");
  expect(
    within(dialog).getByText(
      "2 of its commits aren't on any remote. Unticked, the branch stays with its commits.",
    ),
  ).toBeTruthy();
  // Nothing was deleted by asking.
  expect(api.deleteWorktree).not.toHaveBeenCalled();

  // Deleted: the next list holds no worktree, so the card is as before.
  vi.mocked(api.listWorktreeStatuses).mockResolvedValue([]);
  fireEvent.click(
    within(dialog).getByRole("button", { name: "Delete worktree" }),
  );

  await waitFor(() =>
    expect(api.deleteWorktree).toHaveBeenCalledWith(
      "worktree-1",
      false,
      "status-1",
    ),
  );
  await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  await waitFor(() => expect(screen.queryByRole("group")).toBeNull());
  // A toast says what went. It has no Undo: the dialog was the confirmation.
  expect(await screen.findByText("Deleted aj-4821")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
  // Its thread is still on the card, and still opens.
  const row = within(
    await screen.findByRole("list", { name: "Handoffs" }),
  ).getByRole("listitem", { name: "Week grid" });
  expect(within(row).getByRole("button", { name: /^Open / })).toBeTruthy();
});

/** Deletes the one worktree from its menu, with the branch box ticked. */
async function deleteWithBranch() {
  await openMenu();
  fireEvent.click(screen.getByRole("menuitem", { name: "Delete worktree…" }));
  const dialog = await screen.findByRole("alertdialog");
  fireEvent.click(
    await within(dialog).findByRole("checkbox", {
      name: "Also delete the branch 4821-week-grid",
    }),
  );
  fireEvent.click(
    within(dialog).getByRole("button", { name: "Delete worktree" }),
  );
  await waitFor(() =>
    expect(api.deleteWorktree).toHaveBeenCalledWith(
      "worktree-1",
      true,
      "status-1",
    ),
  );
}

it("says the branch went too in the toast after a delete that removed it", async () => {
  vi.mocked(api.listWorktreeStatuses).mockResolvedValue([listed(CLEAN)]);
  vi.mocked(api.previewWorktreeDelete).mockResolvedValue(preview());
  vi.mocked(api.deleteWorktree).mockResolvedValue({
    branchDeleted: true,
    handoffs: [],
  });
  await openItem([record({ worktreeId: "worktree-1" })]);

  await deleteWithBranch();

  expect(
    await screen.findByText("Deleted aj-4821 and its branch"),
  ).toBeTruthy();
});

it("shows one toast when git kept the branch: the worktree is deleted and its branch stayed", async () => {
  vi.mocked(api.listWorktreeStatuses).mockResolvedValue([listed(CLEAN)]);
  vi.mocked(api.previewWorktreeDelete).mockResolvedValue(preview());
  vi.mocked(api.deleteWorktree).mockResolvedValue({
    branchDeleted: false,
    handoffs: [],
  });
  await openItem([record({ worktreeId: "worktree-1" })]);

  await deleteWithBranch();

  // An error toast holds its text twice: once to see, once for a screen reader.
  expect(
    (await screen.findAllByText("Couldn't delete the branch")).length,
  ).toBeGreaterThan(0);
  expect(
    screen.getAllByText("aj-4821 is deleted. Its branch 4821-week-grid stayed.")
      .length,
  ).toBeGreaterThan(0);
  // No second toast claims more.
  expect(screen.queryByText(/^Deleted aj-4821/)).toBeNull();
});

it("asks about a clean worktree without a file list or a warning, deletes its branch when ticked, and keeps the dialog on a refusal", async () => {
  vi.mocked(api.listWorktreeStatuses).mockResolvedValue([listed(CLEAN)]);
  vi.mocked(api.previewWorktreeDelete).mockResolvedValue(preview());
  vi.mocked(api.deleteWorktree).mockRejectedValueOnce(
    new Error(
      "Another worktree has the branch 4821-week-grid checked out, so Ajour can't delete it. Delete the worktree without its branch.",
    ),
  );
  await openItem([record({ worktreeId: "worktree-1" })]);

  await openMenu();
  fireEvent.click(screen.getByRole("menuitem", { name: "Delete worktree…" }));
  const dialog = await screen.findByRole("alertdialog");

  expect(
    await within(dialog).findByText(
      "It has no uncommitted changes. Deleting it removes its folder, with the files git ignores.",
    ),
  ).toBeTruthy();
  expect(
    within(dialog).queryByRole("list", { name: "Uncommitted changes" }),
  ).toBeNull();
  expect(within(dialog).queryByText(/ in it\.$/)).toBeNull();
  expect(
    within(dialog).getByText(
      "All its commits are on a remote. Unticked, the branch stays with its commits.",
    ),
  ).toBeTruthy();

  fireEvent.click(
    within(dialog).getByRole("checkbox", {
      name: "Also delete the branch 4821-week-grid",
    }),
  );
  fireEvent.click(
    within(dialog).getByRole("button", { name: "Delete worktree" }),
  );

  // Refused: the reason shows in the dialog, which stays, and so does the line.
  expect((await within(dialog).findByRole("alert")).textContent).toContain(
    "Another worktree has the branch 4821-week-grid checked out",
  );
  expect(api.deleteWorktree).toHaveBeenCalledWith(
    "worktree-1",
    true,
    "status-1",
  );

  fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
  await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  expect(api.deleteWorktree).toHaveBeenCalledTimes(1);
  expect((await groupOf("aj-4821")).getAttribute("aria-label")).toBe(
    "aj-4821, Clean, 1 thread",
  );
});

it("reads the preview again when the worktree changed since the dialog opened, shows the new files and says so", async () => {
  vi.mocked(api.listWorktreeStatuses).mockResolvedValue([listed(CLEAN)]);
  vi.mocked(api.previewWorktreeDelete)
    .mockResolvedValueOnce(preview())
    .mockResolvedValueOnce(
      preview({
        listed: listed({ state: "changed", changes: 1 }),
        fingerprint: "status-2",
        files: [{ code: "??", path: "late.md" }],
      }),
    );
  const refusal =
    "aj-4821 changed since Ajour showed what it holds. Check it again before you delete it.";
  vi.mocked(api.deleteWorktree)
    .mockRejectedValueOnce(
      new api.AppApiError(refusal, 409, undefined, {
        error: refusal,
        changed: true,
      }),
    )
    .mockResolvedValueOnce({ branchDeleted: false, handoffs: [] });
  await openItem([record({ worktreeId: "worktree-1" })]);

  await openMenu();
  fireEvent.click(screen.getByRole("menuitem", { name: "Delete worktree…" }));
  const dialog = await screen.findByRole("alertdialog");
  await within(dialog).findByText(/^It has no uncommitted changes\./);
  fireEvent.click(
    within(dialog).getByRole("button", { name: "Delete worktree" }),
  );

  // A tool wrote a file meanwhile: the dialog stays, with what it holds now.
  expect((await within(dialog).findByRole("alert")).textContent).toBe(
    "aj-4821 changed since this dialog opened. Check what it holds now, then delete it again.",
  );
  expect(
    within(
      await within(dialog).findByRole("list", { name: "Uncommitted changes" }),
    )
      .getAllByRole("listitem")
      .map((line) => line.textContent),
  ).toEqual(["?? late.md"]);
  expect(api.previewWorktreeDelete).toHaveBeenCalledTimes(2);
  expect(api.deleteWorktree).toHaveBeenCalledWith(
    "worktree-1",
    false,
    "status-1",
  );

  // Deleted with the status the user now saw.
  fireEvent.click(
    within(dialog).getByRole("button", { name: "Delete worktree" }),
  );
  await waitFor(() =>
    expect(api.deleteWorktree).toHaveBeenLastCalledWith(
      "worktree-1",
      false,
      "status-2",
    ),
  );
  await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
});

it("says which branch a switched worktree is on now, and the box still deletes only the branch Ajour made", async () => {
  vi.mocked(api.listWorktreeStatuses).mockResolvedValue([listed(CLEAN)]);
  vi.mocked(api.previewWorktreeDelete).mockResolvedValue(
    preview({ switched: { branch: "fix/x" } }),
  );
  await openItem([record({ worktreeId: "worktree-1" })]);

  await openMenu();
  fireEvent.click(screen.getByRole("menuitem", { name: "Delete worktree…" }));
  const dialog = await screen.findByRole("alertdialog");

  expect(
    await within(dialog).findByText(
      "It has no uncommitted changes. Deleting it removes its folder, with the files git ignores. It is on the branch fix/x now, which stays.",
    ),
  ).toBeTruthy();
  expect(
    within(dialog).getByRole("checkbox", {
      name: "Also delete the branch 4821-week-grid",
    }),
  ).toBeTruthy();
  expect(
    within(dialog)
      .getByRole("button", { name: "Delete worktree" })
      .hasAttribute("disabled"),
  ).toBe(false);
});

it("says how many commits a detached worktree's delete loses, beside its other losses", async () => {
  vi.mocked(api.listWorktreeStatuses).mockResolvedValue([listed(CLEAN)]);
  vi.mocked(api.previewWorktreeDelete).mockResolvedValue(
    preview({ switched: { commitsOnNoBranch: 2 } }),
  );
  await openItem([record({ worktreeId: "worktree-1" })]);

  await openMenu();
  fireEvent.click(screen.getByRole("menuitem", { name: "Delete worktree…" }));
  const dialog = await screen.findByRole("alertdialog");

  expect(
    await within(dialog).findByText(
      "It has no uncommitted changes. Deleting it removes its folder, with the files git ignores. It is on no branch now. Deleting the worktree loses 2 commits that are on no branch.",
    ),
  ).toBeTruthy();
  // The user still confirms.
  expect(
    within(dialog)
      .getByRole("button", { name: "Delete worktree" })
      .hasAttribute("disabled"),
  ).toBe(false);
});

it("shows a worktree whose folder is gone as Missing, and Forget removes its line and keeps its thread", async () => {
  const thread = record({ id: "h1", worktreeId: "worktree-1" });
  vi.mocked(api.listWorktreeStatuses).mockResolvedValue([
    listed({ state: "missing" }),
  ]);
  const { worktreeId: _gone, ...unlinked } = thread;
  vi.mocked(api.forgetWorktree).mockResolvedValue({ handoffs: [unlinked] });
  await openItem([thread]);

  expect((await groupOf("aj-4821")).getAttribute("aria-label")).toBe(
    "aj-4821, Missing, 1 thread",
  );
  // Nothing there to open or delete.
  expect(menuItems(await openMenu())).toEqual(["Forget"]);

  vi.mocked(api.listWorktreeStatuses).mockResolvedValue([]);
  fireEvent.click(screen.getByRole("menuitem", { name: "Forget" }));

  await waitFor(() =>
    expect(api.forgetWorktree).toHaveBeenCalledWith("worktree-1"),
  );
  await waitFor(() => expect(screen.queryByRole("group")).toBeNull());
  expect(
    within(await screen.findByRole("list", { name: "Handoffs" })).getByRole(
      "listitem",
      { name: "Week grid" },
    ),
  ).toBeTruthy();
  expect(api.deleteWorktree).not.toHaveBeenCalled();
});

it("hands off again from the card without naming a place, so the local API starts in the item's newest worktree", async () => {
  vi.mocked(api.listWorktreeStatuses).mockResolvedValue([listed(CLEAN)]);
  vi.mocked(api.startHandoff).mockImplementation(async (input) =>
    record({
      id: "h2",
      toolId: input.toolId,
      threadId: "thread-2",
      title: "Second tool",
      worktreeId: "worktree-1",
    }),
  );
  await openItem([record({ id: "h1", worktreeId: "worktree-1" })]);
  await groupOf("aj-4821");

  fireEvent.click(
    await screen.findByRole("button", { name: "Hand off to Beta" }),
  );

  await waitFor(() => expect(api.startHandoff).toHaveBeenCalledTimes(1));
  expect(vi.mocked(api.startHandoff).mock.calls[0]![0]).not.toHaveProperty(
    "startIn",
  );
  // The new thread joins the worktree's group.
  await waitFor(async () =>
    expect((await groupOf("aj-4821")).getAttribute("aria-label")).toBe(
      "aj-4821, Clean, 2 threads",
    ),
  );
});

/*
 * A tool that makes its own worktree (#863): Beta declares it. The local
 * API marks the threads Beta started in a worktree of its own.
 */

it("groups the threads a tool runs in its own worktree under a line that names the tool, with no status and no menu", async () => {
  cachePluginsOverview(overview(["alpha", "beta"], ["beta"]));
  vi.mocked(api.listWorktreeStatuses).mockResolvedValue([listed(CLEAN)]);

  await openItem([
    record({ id: "h1", title: "In aj-4821", worktreeId: "worktree-1" }),
    record({
      id: "h2",
      title: "In its own",
      toolId: "beta",
      threadId: "thread-2",
      branch: "4821-week-grid-2",
      ownWorktree: true,
    }),
    // Started under Main folder: Beta made no worktree for it.
    record({
      id: "h3",
      title: "In the main folder",
      toolId: "beta",
      threadId: "thread-3",
    }),
  ]);

  const own = await screen.findByRole("group", { name: "Beta's own worktree" });
  expect(
    within(own)
      .getAllByRole("listitem")
      .map((row) => row.getAttribute("aria-label")),
  ).toEqual(["In its own"]);
  // The line is the name alone: Ajour reads no status of that worktree
  // and offers nothing to do with it.
  const line = within(own).getByText("Beta's own worktree").parentElement!;
  expect(line.textContent).toBe("Beta's own worktree");
  expect(
    within(own).queryByRole("button", { name: /^Actions for / }),
  ).toBeNull();

  // Ajour's worktree keeps its line, and the main folder holds the thread
  // the same tool started there.
  expect((await groupOf("aj-4821")).getAttribute("aria-label")).toBe(
    "aj-4821, Clean, 1 thread",
  );
  expect(
    within(await groupOf("atlas-web"))
      .getAllByRole("listitem")
      .map((row) => row.getAttribute("aria-label")),
  ).toEqual(["In the main folder"]);
  // In the order of the card: Ajour's worktrees, the tool's own, the main folder.
  expect(
    screen
      .getAllByRole("group")
      .map((group) => group.getAttribute("aria-label")),
  ).toEqual([
    "aj-4821, Clean, 1 thread",
    "Beta's own worktree",
    "atlas-web, 1 thread",
  ]);
});

it("shows the tool's own worktree line for an item that has no worktree of Ajour's", async () => {
  cachePluginsOverview(overview(["alpha", "beta"], ["beta"]));

  await openItem([
    record({
      id: "h2",
      title: "In its own",
      toolId: "beta",
      threadId: "thread-2",
      ownWorktree: true,
    }),
    record({ id: "h3", title: "In the main folder", threadId: "thread-3" }),
  ]);

  const own = await screen.findByRole("group", { name: "Beta's own worktree" });
  expect(within(own).getAllByRole("listitem")).toHaveLength(1);
  // The other thread sits under its repository folder's name.
  expect((await groupOf("atlas-web")).getAttribute("aria-label")).toBe(
    "atlas-web, 1 thread",
  );
});
