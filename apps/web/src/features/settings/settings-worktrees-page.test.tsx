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
import type { ListedWorktree, WorktreeSettings } from "@ajour/shared/worktrees";
import { Toaster } from "@/components/ui/toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import * as api from "@/lib/app-api";
import { localStore } from "@/lib/local-store";
import { runWorktreeCleanUp } from "@/lib/worktree-clean-up";
import { installDomShims, renderRoutes } from "@/test-support/dom";
import { SettingsWorktreesPage } from "./settings-worktrees-page";

/*
 * Settings › Worktrees (#860, #864): the default Start in, the two
 * clean-up rules, the list of every worktree on this computer and Clean up
 * now. The local API module is mocked. Each test reads what the user sees
 * and what the window then asks the local API.
 */

vi.mock("@/lib/app-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/app-api")>()),
  cleanUpWorktrees: vi.fn(),
  deleteWorktree: vi.fn(),
  forgetWorktree: vi.fn(),
  getWorktreeSettings: vi.fn(),
  listWorktreeStatuses: vi.fn(),
  listWorktrees: vi.fn(),
  previewWorktreeDelete: vi.fn(),
  saveWorktreeSettings: vi.fn(),
}));

beforeAll(installDomShims);

const SAVED: WorktreeSettings = {
  startIn: "worktree",
  cleanUp: {
    finished: { enabled: true, days: 3 },
    unused: { enabled: false, days: 30 },
  },
};

let run = 0;
let atlas = "";
let harbor = "";
let doneItem = "";
let activeItem = "";
let doneAt = 0;

const listed = (
  name: string,
  projectId: string,
  workItemId: string,
  overrides: Partial<ListedWorktree> = {},
): ListedWorktree => ({
  worktree: {
    id: `id-${name}`,
    repositoryFolderId: "folder-1",
    projectId,
    workItemId,
    itemKey: "4821",
    name,
    branch: "4821-week-grid",
    source: "origin/main",
    createdAt: 1_000,
  },
  status: { state: "clean" },
  path: `/w/.ajour/worktrees/${name}`,
  ...overrides,
});

/** What the local API keeps of every worktree, without its status. */
const records = (worktrees: ListedWorktree[]) =>
  worktrees.map((one) => one.worktree);

/** The list the local API answers, also to the rounds' first question. */
function onThisComputer(worktrees: ListedWorktree[]) {
  vi.mocked(api.listWorktrees).mockResolvedValue(records(worktrees));
  vi.mocked(api.listWorktreeStatuses).mockResolvedValue(worktrees);
}

beforeEach(() => {
  vi.mocked(api.getWorktreeSettings).mockResolvedValue(SAVED);
  // A save changes what it names, as the local API does.
  let kept = SAVED;
  vi.mocked(api.saveWorktreeSettings).mockImplementation(async (update) => {
    kept = {
      startIn: update.startIn ?? kept.startIn,
      cleanUp: { ...kept.cleanUp, ...update.cleanUp },
    };
    return kept;
  });
  onThisComputer([]);
  // The store outlives each test, so every test names its own records.
  run++;
  act(() => {
    localStore.addProject({ name: `Atlas platform ${run}`, color: "#336699" });
    localStore.addProject({ name: `Harbor mobile ${run}`, color: "#996633" });
  });
  const project = (name: string) =>
    localStore.snapshot().projects.find((one) => one.name === name)!._id;
  atlas = project(`Atlas platform ${run}`);
  harbor = project(`Harbor mobile ${run}`);
  act(() => {
    localStore.addWorkItem({ title: `Week grid ${run}`, projectId: atlas });
    localStore.addWorkItem({ title: `Offline sync ${run}`, projectId: harbor });
  });
  const item = (title: string) =>
    localStore.snapshot().workItems.find((one) => one.title === title)!._id;
  activeItem = item(`Week grid ${run}`);
  doneItem = item(`Offline sync ${run}`);
  act(() => {
    localStore.archiveWorkItem(doneItem);
  });
  doneAt = localStore
    .snapshot()
    .workItems.find((one) => one._id === doneItem)!.archivedAt!;
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

const renderPage = () =>
  renderRoutes({
    routes: {
      "/": () => (
        <TooltipProvider>
          <SettingsWorktreesPage />
          <Toaster />
        </TooltipProvider>
      ),
    },
  });

const choice = (name: string) => screen.getByRole("button", { name });
const pressed = (name: string) => choice(name).getAttribute("aria-pressed");

const FINISHED = "Remove worktrees of finished items";
const UNUSED = "Remove unused worktrees";
const ruleSwitch = (label: string) =>
  screen.getByRole("switch", { name: label });
const ruleDelay = (label: string) =>
  screen.getByRole("combobox", { name: `${label}: delay` });

async function chooseDelay(label: string, delay: string) {
  fireEvent.click(ruleDelay(label));
  const option = await screen.findByRole("option", { name: delay });
  fireEvent.keyDown(option, { key: "Enter" });
  fireEvent.click(option);
}

it("shows where hand offs start as the API keeps it, and saves a pick at once", async () => {
  await renderPage();

  // Three choices in this order, and none claimed before the API answers.
  const group = screen.getByRole("group", { name: "Start in" });
  expect(
    [...group.querySelectorAll("button")].map((button) => button.textContent),
  ).toEqual(["Main folder", "New worktree", "Ask each time"]);
  await waitFor(() => expect(pressed("New worktree")).toBe("true"));
  expect(pressed("Main folder")).toBe("false");

  fireEvent.click(choice("Main folder"));

  await waitFor(() => expect(pressed("Main folder")).toBe("true"));
  // Only Start in is sent: the rules stay as the API keeps them.
  expect(api.saveWorktreeSettings).toHaveBeenCalledWith({ startIn: "main" });
  expect(pressed("New worktree")).toBe("false");
  expect(screen.getByRole("alert").textContent?.trim()).toBe("");

  // Ask each time (#861) is saved the same way.
  fireEvent.click(choice("Ask each time"));
  await waitFor(() => expect(pressed("Ask each time")).toBe("true"));
  expect(api.saveWorktreeSettings).toHaveBeenLastCalledWith({ startIn: "ask" });
  expect(pressed("Main folder")).toBe("false");
});

it("keeps the saved choice and says so when the API refuses a save", async () => {
  vi.mocked(api.saveWorktreeSettings).mockRejectedValue(new Error("offline"));
  await renderPage();
  await waitFor(() => expect(pressed("New worktree")).toBe("true"));

  fireEvent.click(choice("Main folder"));

  await waitFor(() =>
    expect(screen.getByRole("alert").textContent).toBe(
      "Couldn't save where hand offs start.",
    ),
  );
  expect(pressed("New worktree")).toBe("true");
  expect(pressed("Main folder")).toBe("false");
});

it("claims no choice and no rule when the API can't be read", async () => {
  vi.mocked(api.getWorktreeSettings).mockRejectedValue(new Error("offline"));
  await renderPage();

  await waitFor(() =>
    expect(screen.getByRole("alert").textContent).toBe(
      "Couldn't read where hand offs start.",
    ),
  );
  expect(pressed("Main folder")).toBe("false");
  expect(pressed("New worktree")).toBe("false");
  expect(choice("Main folder").hasAttribute("disabled")).toBe(true);
  expect(ruleSwitch(FINISHED).getAttribute("aria-checked")).toBe("false");
  expect(ruleSwitch(FINISHED).getAttribute("aria-disabled")).toBe("true");
});

it("shows the two clean-up rules as the API keeps them: finished items on after 3 days, unused off after 30 days", async () => {
  await renderPage();

  await waitFor(() =>
    expect(ruleSwitch(FINISHED).getAttribute("aria-checked")).toBe("true"),
  );
  expect(ruleDelay(FINISHED).textContent).toBe("After 3 days");
  expect(ruleSwitch(UNUSED).getAttribute("aria-checked")).toBe("false");
  expect(ruleDelay(UNUSED).textContent).toBe("After 30 days");
  expect(screen.getByText("Done, settled or archived.")).toBeTruthy();
  expect(screen.getByText("No hand off and no thread change.")).toBeTruthy();
});

it("saves a rule's switch and its delay at once, each alone, and reads the list again", async () => {
  await renderPage();
  await waitFor(() =>
    expect(ruleSwitch(FINISHED).getAttribute("aria-checked")).toBe("true"),
  );
  const listReads = () => vi.mocked(api.listWorktrees).mock.calls.length;
  const before = listReads();

  fireEvent.click(ruleSwitch(UNUSED));

  await waitFor(() =>
    expect(ruleSwitch(UNUSED).getAttribute("aria-checked")).toBe("true"),
  );
  expect(api.saveWorktreeSettings).toHaveBeenLastCalledWith({
    cleanUp: { unused: { enabled: true, days: 30 } },
  });

  await chooseDelay(FINISHED, "After 7 days");

  await waitFor(() =>
    expect(ruleDelay(FINISHED).textContent).toBe("After 7 days"),
  );
  expect(api.saveWorktreeSettings).toHaveBeenLastCalledWith({
    cleanUp: { finished: { enabled: true, days: 7 } },
  });
  // A rule decides what each row says, so the list is read after each save.
  await waitFor(() => expect(listReads()).toBe(before + 2));
});

it("keeps a rule as saved and says so when the API refuses its save", async () => {
  vi.mocked(api.saveWorktreeSettings).mockRejectedValue(new Error("offline"));
  await renderPage();
  await waitFor(() =>
    expect(ruleSwitch(FINISHED).getAttribute("aria-checked")).toBe("true"),
  );

  fireEvent.click(ruleSwitch(FINISHED));

  expect(
    (await screen.findAllByText("Couldn't save the clean-up rule")).length,
  ).toBeGreaterThan(0);
  expect(ruleSwitch(FINISHED).getAttribute("aria-checked")).toBe("true");
});

it("lists every worktree on this computer under its project, with a status that says what clean up will do", async () => {
  const goesAt = new Date(2026, 10, 22, 15).getTime();
  vi.useFakeTimers({ now: new Date(2026, 10, 20, 9), toFake: ["Date"] });
  onThisComputer([
    listed("aj-hm-12", harbor, doneItem, {
      cleanUp: { kind: "goes", at: goesAt },
    }),
    listed("aj-4821", atlas, activeItem, { running: "working" }),
    listed("aj-4790", atlas, activeItem, {
      status: { state: "changed", changes: 3 },
      cleanUp: { kind: "kept", reason: "changes" },
    }),
    listed("aj-4700", atlas, "an-item-ajour-no-longer-has", {
      status: { state: "missing" },
    }),
  ]);
  await renderPage();
  vi.useRealTimers();

  const rows = async (project: string) =>
    within(await screen.findByRole("list", { name: `Worktrees of ${project}` }))
      .getAllByRole("listitem")
      .map((row) => row.getAttribute("aria-label"));
  const month = new Date(goesAt).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
  expect(await rows(`Atlas platform ${run}`)).toEqual([
    `aj-4821, Week grid ${run}, Working`,
    `aj-4790, Week grid ${run}, Kept: 3 changes`,
    "aj-4700, 4821, Missing",
  ]);
  expect(await rows(`Harbor mobile ${run}`)).toEqual([
    `aj-hm-12, Offline sync ${run}, Goes ${month}`,
  ]);
  // Atlas comes before Harbor: the projects are in the order of their names.
  expect(
    screen
      .getAllByRole("list")
      .map((list) => list.getAttribute("aria-label"))
      .filter(Boolean),
  ).toEqual([
    `Worktrees of Atlas platform ${run}`,
    `Worktrees of Harbor mobile ${run}`,
  ]);
  // The list asked what clean up will do, with the finished item's moment.
  expect(api.listWorktreeStatuses).toHaveBeenCalledWith({
    finished: [{ workItemId: doneItem, finishedAt: doneAt }],
  });
  // Delete for a worktree on disk, Forget for one whose folder is gone.
  expect(screen.getByRole("button", { name: "Delete aj-4790" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Forget aj-4700" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Delete aj-4700" })).toBeNull();
});

it("says so when this computer has no worktree", async () => {
  await renderPage();

  expect(
    await screen.findByText(/No worktree on this computer\./),
  ).toBeTruthy();
  // No status is asked for when there is nothing to list.
  expect(api.listWorktreeStatuses).not.toHaveBeenCalled();
});

it("runs a round at once from Clean up now, says what it removed, and reads the list again", async () => {
  const going = listed("aj-hm-12", harbor, doneItem, {
    cleanUp: { kind: "goes", at: doneAt },
  });
  const staying = listed("aj-4821", atlas, activeItem);
  onThisComputer([going, staying]);
  vi.mocked(api.cleanUpWorktrees).mockImplementation(async () => {
    // The round removed one: the list no longer holds it.
    onThisComputer([staying]);
    return {
      removed: [
        { worktreeId: "id-aj-hm-12", name: "aj-hm-12", rule: "finished" },
      ],
      kept: [],
      handoffs: [],
    };
  });
  await renderPage();
  await screen.findByRole("button", { name: "Delete aj-hm-12" });

  fireEvent.click(screen.getByRole("button", { name: "Clean up now" }));

  await waitFor(() =>
    expect(api.cleanUpWorktrees).toHaveBeenCalledWith({
      trigger: "manual",
      finished: [{ workItemId: doneItem, finishedAt: doneAt }],
    }),
  );
  expect((await screen.findAllByText("Removed aj-hm-12")).length).toBe(1);
  await waitFor(() =>
    expect(
      screen.queryByRole("button", { name: "Delete aj-hm-12" }),
    ).toBeNull(),
  );
  expect(screen.getByRole("button", { name: "Delete aj-4821" })).toBeTruthy();
});

it("reads the list again when a round the app started by itself completes, so a removed worktree offers no Delete", async () => {
  const going = listed("aj-hm-12", harbor, doneItem, {
    cleanUp: { kind: "goes", at: doneAt },
  });
  const staying = listed("aj-4821", atlas, activeItem);
  onThisComputer([going, staying]);
  vi.mocked(api.cleanUpWorktrees).mockImplementation(async () => {
    onThisComputer([staying]);
    return {
      removed: [
        { worktreeId: "id-aj-hm-12", name: "aj-hm-12", rule: "finished" },
      ],
      kept: [],
      handoffs: [],
    };
  });
  await renderPage();
  await screen.findByRole("button", { name: "Delete aj-hm-12" });

  // The hourly round, while the page stays open.
  await act(async () => {
    await runWorktreeCleanUp("timer");
  });

  await waitFor(() =>
    expect(
      screen.queryByRole("button", { name: "Delete aj-hm-12" }),
    ).toBeNull(),
  );
  expect(screen.getByRole("button", { name: "Delete aj-4821" })).toBeTruthy();
});

it("shows only the latest list it asked for, so an older answer that comes late puts no removed row back", async () => {
  const going = listed("aj-hm-12", harbor, doneItem);
  const staying = listed("aj-4821", atlas, activeItem);
  vi.mocked(api.listWorktrees).mockResolvedValue(records([going, staying]));
  // The first list request, made as the page opens, answers late.
  let answerFirst!: (worktrees: ListedWorktree[]) => void;
  vi.mocked(api.listWorktreeStatuses)
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          answerFirst = resolve;
        }),
    )
    .mockResolvedValue([staying]);
  vi.mocked(api.cleanUpWorktrees).mockResolvedValue({
    removed: [
      { worktreeId: "id-aj-hm-12", name: "aj-hm-12", rule: "finished" },
    ],
    kept: [],
    handoffs: [],
  });
  await renderPage();
  await waitFor(() => expect(answerFirst).toBeTypeOf("function"));

  // A round removes one worktree: the list asked for then shows the other.
  await act(async () => {
    await runWorktreeCleanUp("timer");
  });
  await screen.findByRole("button", { name: "Delete aj-4821" });
  expect(screen.queryByRole("button", { name: "Delete aj-hm-12" })).toBeNull();

  // The older request answers now, with the worktree that is gone.
  await act(async () => {
    answerFirst([going, staying]);
    await Promise.resolve();
  });

  expect(screen.queryByRole("button", { name: "Delete aj-hm-12" })).toBeNull();
  expect(screen.getByRole("button", { name: "Delete aj-4821" })).toBeTruthy();
});

it("says there was nothing to remove when a round removed nothing", async () => {
  onThisComputer([listed("aj-4821", atlas, activeItem)]);
  vi.mocked(api.cleanUpWorktrees).mockResolvedValue({
    removed: [],
    kept: [],
    handoffs: [],
  });
  await renderPage();
  await screen.findByRole("button", { name: "Delete aj-4821" });

  fireEvent.click(screen.getByRole("button", { name: "Clean up now" }));

  expect((await screen.findAllByText("Nothing to remove")).length).toBe(1);
});

it("opens the delete dialog from a row's Delete, and reads the list again once the worktree is deleted", async () => {
  const one = listed("aj-4821", atlas, activeItem);
  onThisComputer([one]);
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
  await renderPage();

  fireEvent.click(
    await screen.findByRole("button", { name: "Delete aj-4821" }),
  );

  const dialog = await screen.findByRole("alertdialog");
  expect(within(dialog).getByText("Delete aj-4821?")).toBeTruthy();
  onThisComputer([]);
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
  expect(
    await screen.findByText(/No worktree on this computer\./),
  ).toBeTruthy();
});
