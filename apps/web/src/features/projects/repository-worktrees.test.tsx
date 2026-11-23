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
import type { ListedWorktree } from "@ajour/shared/worktrees";
import { Toaster } from "@/components/ui/toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import * as api from "@/lib/app-api";
import { localStore } from "@/lib/local-store";
import { installDomShims, renderRoutes } from "@/test-support/dom";
import { SettingsWorktreesPage } from "@/features/settings/settings-worktrees-page";
import { RepositoryFoldersSection } from "./repository-folders-section";

/*
 * The project page's Repositories section with worktrees (#864): the
 * project's own Start in on top, and each repository folder's worktrees
 * under it, with Delete and Forget. The local API module is mocked. Each
 * test reads what the user sees and what the window then asks the API.
 */

vi.mock("@/lib/app-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/app-api")>()),
  deleteWorktree: vi.fn(),
  forgetWorktree: vi.fn(),
  getProjectStartIn: vi.fn(),
  getWorktreeSettings: vi.fn(),
  listRepositoryFolders: vi.fn(),
  listWorktreeStatuses: vi.fn(),
  listWorktrees: vi.fn(),
  previewWorktreeDelete: vi.fn(),
  removeRepositoryFolder: vi.fn(),
  saveProjectStartIn: vi.fn(),
  saveWorktreeSettings: vi.fn(),
}));

beforeAll(installDomShims);

const web = { id: "web", projectId: "p", name: "atlas-web", path: "/w/web" };
const apiFolder = {
  id: "api",
  projectId: "p",
  name: "atlas-api",
  path: "/w/a",
};

let itemId = "";
let run = 0;

const listed = (
  name: string,
  overrides: Partial<ListedWorktree> = {},
  worktree: Partial<ListedWorktree["worktree"]> = {},
): ListedWorktree => ({
  worktree: {
    id: `id-${name}`,
    repositoryFolderId: "web",
    projectId: "p",
    workItemId: itemId,
    itemKey: "4821",
    name,
    branch: "4821-week-grid",
    source: "origin/main",
    createdAt: 1_000,
    ...worktree,
  },
  status: { state: "clean" },
  path: `/w/web/.ajour/worktrees/${name}`,
  ...overrides,
});

beforeEach(() => {
  window.ajourDesktop = {
    chooseFolder: vi.fn(),
  } as unknown as typeof window.ajourDesktop;
  vi.mocked(api.getProjectStartIn).mockResolvedValue({ settings: "worktree" });
  vi.mocked(api.listRepositoryFolders).mockResolvedValue([web, apiFolder]);
  vi.mocked(api.listWorktreeStatuses).mockResolvedValue([]);
  // The store outlives each test, so every test names its own item.
  const title = `Week grid ${++run}`;
  act(() => {
    localStore.addWorkItem({ title });
  });
  itemId = localStore
    .snapshot()
    .workItems.find((item) => item.title === title)!._id;
});

afterEach(() => {
  cleanup();
  delete window.ajourDesktop;
  vi.resetAllMocks();
});

const renderSection = () =>
  renderRoutes({
    routes: {
      "/": () => (
        <TooltipProvider>
          <RepositoryFoldersSection projectId="p" />
          <Toaster />
        </TooltipProvider>
      ),
    },
  });

const startInSelect = () =>
  screen.findByRole("combobox", { name: "Hand offs start in" });

async function choose(name: string) {
  fireEvent.click(await startInSelect());
  const option = await screen.findByRole("option", { name });
  fireEvent.keyDown(option, { key: "Enter" });
  fireEvent.click(option);
}

it("reads Settings with the default it follows for a project that was never set, and offers the three places", async () => {
  await renderSection();

  const select = await startInSelect();
  await waitFor(() =>
    expect(select.textContent).toBe("Settings (New worktree)"),
  );
  expect(api.getProjectStartIn).toHaveBeenCalledWith("p");
  fireEvent.click(select);
  expect(
    (await screen.findAllByRole("option")).map((option) => option.textContent),
  ).toEqual([
    "Settings (New worktree)",
    "Main folder",
    "New worktree",
    "Ask each time",
  ]);
});

it("names the default as it is when the page opens", async () => {
  vi.mocked(api.getProjectStartIn).mockResolvedValue({ settings: "ask" });
  await renderSection();

  await waitFor(async () =>
    expect((await startInSelect()).textContent).toBe(
      "Settings (Ask each time)",
    ),
  );
});

it("follows a change of the default made in Settings while the project page stays open under it", async () => {
  vi.mocked(api.getWorktreeSettings).mockResolvedValue({
    startIn: "worktree",
    cleanUp: {
      finished: { enabled: true, days: 3 },
      unused: { enabled: false, days: 30 },
    },
  });
  vi.mocked(api.saveWorktreeSettings).mockImplementation(async (update) => ({
    startIn: update.startIn ?? "worktree",
    cleanUp: {
      finished: { enabled: true, days: 3 },
      unused: { enabled: false, days: 30 },
    },
  }));
  vi.mocked(api.listWorktrees).mockResolvedValue([]);
  // The Settings window opens over the page, which stays mounted.
  await renderRoutes({
    routes: {
      "/": () => (
        <TooltipProvider>
          <RepositoryFoldersSection projectId="p" />
          <SettingsWorktreesPage />
          <Toaster />
        </TooltipProvider>
      ),
    },
  });
  await waitFor(async () =>
    expect((await startInSelect()).textContent).toBe("Settings (New worktree)"),
  );

  fireEvent.click(await screen.findByRole("button", { name: "Ask each time" }));

  await waitFor(async () =>
    expect((await startInSelect()).textContent).toBe(
      "Settings (Ask each time)",
    ),
  );
  // The row took the new default as saved: the page was not opened again.
  expect(api.getProjectStartIn).toHaveBeenCalledTimes(1);
  // A project with its own choice keeps it, and names the new default.
  fireEvent.click(await startInSelect());
  expect((await screen.findAllByRole("option"))[0]!.textContent).toBe(
    "Settings (Ask each time)",
  );
});

it("saves the project's own choice at once, and gives it up with Settings", async () => {
  vi.mocked(api.saveProjectStartIn).mockImplementation(async (_id, startIn) =>
    startIn
      ? { override: startIn, settings: "worktree" }
      : { settings: "worktree" },
  );
  await renderSection();
  await waitFor(async () =>
    expect((await startInSelect()).textContent).toBe("Settings (New worktree)"),
  );

  await choose("Main folder");

  await waitFor(() =>
    expect(api.saveProjectStartIn).toHaveBeenCalledWith("p", "main"),
  );
  await waitFor(async () =>
    expect((await startInSelect()).textContent).toBe("Main folder"),
  );

  await choose("Settings (New worktree)");

  await waitFor(() =>
    expect(api.saveProjectStartIn).toHaveBeenLastCalledWith("p", null),
  );
  await waitFor(async () =>
    expect((await startInSelect()).textContent).toBe("Settings (New worktree)"),
  );
});

it("keeps the saved choice and says so when the API refuses a save", async () => {
  vi.mocked(api.getProjectStartIn).mockResolvedValue({
    override: "main",
    settings: "worktree",
  });
  vi.mocked(api.saveProjectStartIn).mockRejectedValue(new Error("offline"));
  await renderSection();
  await waitFor(async () =>
    expect((await startInSelect()).textContent).toBe("Main folder"),
  );

  await choose("Ask each time");

  expect((await screen.findByRole("alert")).textContent).toBe(
    "Couldn't save where hand offs start.",
  );
  expect((await startInSelect()).textContent).toBe("Main folder");
});

it("lists each repository folder's worktrees under it, with the item's title and the status", async () => {
  vi.mocked(api.listWorktreeStatuses).mockResolvedValue([
    listed("aj-4821", { running: "working" }),
    listed("aj-4790", { status: { state: "changed", changes: 3 } }),
    listed(
      "aj-12",
      {},
      { repositoryFolderId: "api", workItemId: "gone", itemKey: "HM-12" },
    ),
  ]);
  await renderSection();

  const inWeb = await screen.findByRole("list", {
    name: "Worktrees in atlas-web",
  });
  expect(api.listWorktreeStatuses).toHaveBeenCalledWith({ projectId: "p" });
  const title = `Week grid ${run}`;
  expect(
    within(inWeb)
      .getAllByRole("listitem")
      .map((row) => row.getAttribute("aria-label")),
  ).toEqual([`aj-4821, ${title}, Working`, `aj-4790, ${title}, 3 changes`]);
  // An item Ajour no longer has leaves the key the worktree was made for.
  expect(
    within(screen.getByRole("list", { name: "Worktrees in atlas-api" }))
      .getByRole("listitem")
      .getAttribute("aria-label"),
  ).toBe("aj-12, HM-12, Clean");
});

it("opens the delete dialog from a worktree's Delete, and reads the list again once it is deleted", async () => {
  const one = listed("aj-4821");
  vi.mocked(api.listWorktreeStatuses).mockResolvedValue([one]);
  vi.mocked(api.previewWorktreeDelete).mockResolvedValue({
    listed: one,
    fingerprint: "status-1",
    files: [],
    moreFiles: 0,
    running: [],
    branch: { name: "4821-week-grid", unpushedCommits: 0 },
  });
  vi.mocked(api.deleteWorktree).mockResolvedValue({
    branchDeleted: false,
    handoffs: [],
  });
  await renderSection();

  fireEvent.click(
    await screen.findByRole("button", { name: "Delete aj-4821" }),
  );

  const dialog = await screen.findByRole("alertdialog");
  expect(within(dialog).getByText("Delete aj-4821?")).toBeTruthy();
  expect(api.previewWorktreeDelete).toHaveBeenCalledWith("id-aj-4821");
  vi.mocked(api.listWorktreeStatuses).mockResolvedValue([]);
  const confirm = within(dialog).getByRole("button", {
    name: "Delete worktree",
  });
  await waitFor(() => expect(confirm.hasAttribute("disabled")).toBe(false));
  fireEvent.click(confirm);

  await waitFor(() =>
    expect(api.deleteWorktree).toHaveBeenCalledWith(
      "id-aj-4821",
      false,
      "status-1",
    ),
  );
  await waitFor(() =>
    expect(screen.queryByRole("button", { name: "Delete aj-4821" })).toBeNull(),
  );
  expect(api.listWorktreeStatuses).toHaveBeenCalledTimes(2);
  // The dialog is the one every list shares, so its toast shows here too.
  expect(await screen.findByText("Deleted aj-4821")).toBeTruthy();
});

it("offers Forget, and no Delete, for a worktree whose folder is gone", async () => {
  vi.mocked(api.listWorktreeStatuses).mockResolvedValue([
    listed("aj-4821", { status: { state: "missing" } }),
  ]);
  vi.mocked(api.forgetWorktree).mockResolvedValue({ handoffs: [] });
  await renderSection();

  const forget = await screen.findByRole("button", { name: "Forget aj-4821" });
  expect(screen.queryByRole("button", { name: "Delete aj-4821" })).toBeNull();
  expect(
    screen
      .getByRole("listitem")
      .getAttribute("aria-label")
      ?.endsWith(", Missing"),
  ).toBe(true);
  vi.mocked(api.listWorktreeStatuses).mockResolvedValue([]);
  fireEvent.click(forget);

  await waitFor(() =>
    expect(api.forgetWorktree).toHaveBeenCalledWith("id-aj-4821"),
  );
  await waitFor(() =>
    expect(screen.queryByRole("button", { name: "Forget aj-4821" })).toBeNull(),
  );
});

it("shows no Start in row and reads no worktree in the web build", async () => {
  delete window.ajourDesktop;
  await renderSection();

  expect(screen.getByText(/Folders need the desktop app/)).toBeTruthy();
  expect(screen.queryByRole("combobox")).toBeNull();
  expect(api.getProjectStartIn).not.toHaveBeenCalled();
  expect(api.listWorktreeStatuses).not.toHaveBeenCalled();
});
