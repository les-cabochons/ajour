import { existsSync } from "node:fs";
import {
  appendFile,
  chmod,
  mkdir,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  it,
  vi,
} from "vitest";
import type {
  ListedWorktree,
  WorktreeCleanUpResult,
} from "../../../packages/shared/worktrees.ts";
import {
  cleanUpWorktreeApps,
  eventsNamed,
  git,
  gitSays,
  localRepository,
  setUp,
  useHermeticGit,
} from "./test-support/handoff-worktree-harness.ts";

/*
 * Automatic clean up of hand-off worktrees (#864), through the routes: the
 * two rules, each reason to keep a worktree, and what the list of Settings
 * › Worktrees says of each. An in-process fake tool plugin, a temporary
 * folder and a real git repository running real git: nothing fakes git.
 * The clock is the test's, so no test waits. The tests read what the user
 * can observe: the folders on disk, git's own list of worktrees and
 * branches, and what the routes answer.
 */

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** The clock of the server under test. */
let now = 0;

// Each test runs real git a dozen times or more, which takes seconds on a
// Windows runner: past vitest's 5 second default.
vi.setConfig({ testTimeout: 30_000 });

let restoreGit: () => Promise<void>;
beforeAll(async () => {
  restoreGit = await useHermeticGit();
});
afterAll(() => restoreGit());
beforeEach(() => {
  now = Date.parse("2026-11-01T09:00:00Z");
});
afterEach(cleanUpWorktreeApps);

type App = Awaited<ReturnType<typeof setUp>>;

const local = () =>
  setUp(({ repo }) => localRepository(repo).then(() => {}), {
    handoffClock: () => now,
  });

/** The item's finished moment, as the window sends it. */
const finished = (key: string, finishedAt: number) => ({
  workItemId: `item-${key}`,
  finishedAt,
});

/** One round, with the finished items the window knows. */
async function round(
  app: App,
  items: ReturnType<typeof finished>[] = [],
  trigger = "timer",
) {
  const answer = await app.call("POST", "/api/worktrees/clean-up", {
    trigger,
    finished: items,
  });
  expect(answer.status, JSON.stringify(answer.body)).toBe(200);
  return answer.body as unknown as WorktreeCleanUpResult & {
    handoffs: Record<string, unknown>[];
  };
}

/** The list of Settings › Worktrees, with what clean up will do. */
const settingsList = async (
  app: App,
  items: ReturnType<typeof finished>[] = [],
) =>
  (await app.call("POST", "/api/worktrees/status", { finished: items }))
    .body as unknown as ListedWorktree[];

const setRules = async (app: App, cleanUp: Record<string, unknown>) =>
  expect(
    (await app.call("POST", "/api/worktrees/settings", { cleanUp })).status,
  ).toBe(200);

/** The thread's tool now reports that state, and Ajour has read it. */
async function becomes(app: App, handoffId: string, state: string) {
  await writeFile(path.join(app.root, "state.txt"), state);
  expect(
    (await app.call("POST", `/api/handoffs/${handoffId}/refresh`)).status,
  ).toBe(200);
}

/**
 * Hands the item off in a new worktree, then lets its thread finish: the
 * tool reports Ready. Answers the worktree and the thread.
 */
async function finishedWork(app: App, key: string, title = "Week grid") {
  const started = await app.handOff(key, title);
  expect(started.status, JSON.stringify(started.body)).toBe(200);
  await becomes(app, started.body.id, "ready");
  return {
    handoffId: started.body.id,
    worktree: started.body.worktree!,
    folder: app.worktreeFolder(started.body.worktree!.name),
  };
}

/** The folders git lists as worktrees of the repository. */
const registered = (repo: string) =>
  git(repo, "worktree", "list", "--porcelain")
    .split("\n")
    .filter((line) => line.startsWith("worktree "))
    .map((line) => path.basename(line.slice("worktree ".length)));

const hasBranch = (repo: string, branch: string) =>
  gitSays(repo, "show-ref", "--verify", "--quiet", `refs/heads/${branch}`);

/** The worktree is whole: its folder, git's registration and its record. */
async function expectKept(app: App, name: string) {
  expect(existsSync(path.join(app.worktreeFolder(name), "README.md"))).toBe(
    true,
  );
  expect(registered(app.repo)).toContain(name);
  expect(
    (
      (await app.call("GET", "/api/worktrees")).body as unknown as {
        name: string;
      }[]
    ).map((worktree) => worktree.name),
  ).toContain(name);
}

it("removes the worktree of an item done 3 days ago, clean and with no running thread, and keeps its branch", async () => {
  const app = await local();
  const { worktree, folder, handoffId } = await finishedWork(app, "4821");
  const doneAt = now;

  // Two days later the rule's delay has not passed.
  now = doneAt + 2 * DAY;
  expect(await round(app, [finished("4821", doneAt)])).toMatchObject({
    removed: [],
    kept: [],
  });
  await expectKept(app, "aj-4821");

  now = doneAt + 3 * DAY;
  const answer = await round(app, [finished("4821", doneAt)], "launch");

  expect(answer.removed).toEqual([
    { worktreeId: worktree.id, name: "aj-4821", rule: "finished" },
  ]);
  expect(answer.kept).toEqual([]);
  expect(existsSync(folder)).toBe(false);
  expect(registered(app.repo)).toEqual(["repo"]);
  expect((await app.call("GET", "/api/worktrees")).body).toEqual([]);
  // The branch stays, with the commits it holds.
  expect(hasBranch(app.repo, worktree.branch)).toBe(true);
  // Its thread stays on the item, and no longer names the worktree.
  expect(answer.handoffs).toMatchObject([{ id: handoffId }]);
  expect(answer.handoffs[0]).not.toHaveProperty("worktreeId");

  // One event per round, with counts and no name, branch, path or title.
  const events = eventsNamed(app.sink, "worktree.clean_up");
  expect(events).toHaveLength(2);
  expect(events[0]).toMatchObject({
    outcome: "ok",
    worktree: { trigger: "timer", count: 1, due: 0, removed: 0, kept: 0 },
  });
  expect(events[1]).toMatchObject({
    outcome: "ok",
    worktree: {
      trigger: "launch",
      count: 1,
      due: 1,
      removed: 1,
      removed_finished: 1,
      kept: 0,
    },
  });
  expect(JSON.stringify(events)).not.toMatch(
    /aj-4821|week-grid|Week grid|README|handoff-worktree-/,
  );
});

it("keeps the same worktree with one untracked file, and the list reads Kept with 1 change", async () => {
  const app = await local();
  const { worktree, folder } = await finishedWork(app, "4821");
  const doneAt = now;
  await writeFile(path.join(folder, "notes.md"), "not committed\n");
  now = doneAt + 4 * DAY;

  const answer = await round(app, [finished("4821", doneAt)]);

  expect(answer.removed).toEqual([]);
  expect(answer.kept).toEqual([
    { worktreeId: worktree.id, name: "aj-4821", reason: "changes" },
  ]);
  await expectKept(app, "aj-4821");
  expect(existsSync(path.join(folder, "notes.md"))).toBe(true);
  expect(await settingsList(app, [finished("4821", doneAt)])).toMatchObject([
    {
      worktree: { id: worktree.id },
      status: { state: "changed", changes: 1 },
      cleanUp: { kind: "kept", reason: "changes" },
    },
  ]);
  expect(eventsNamed(app.sink, "worktree.clean_up").at(-1)).toMatchObject({
    worktree: { due: 1, removed: 0, kept: 1, kept_changes: 1 },
  });

  // A tracked file that changed keeps it as well.
  git(folder, "clean", "--quiet", "-fd");
  await writeFile(path.join(folder, "README.md"), "edited\n");
  expect((await round(app, [finished("4821", doneAt)])).kept).toMatchObject([
    { reason: "changes" },
  ]);
  await expectKept(app, "aj-4821");

  // Once the work is committed, the next round removes it.
  git(folder, "commit", "--quiet", "-am", "keep the edit");
  expect((await round(app, [finished("4821", doneAt)])).removed).toHaveLength(
    1,
  );
  expect(existsSync(folder)).toBe(false);
  expect(hasBranch(app.repo, worktree.branch)).toBe(true);
});

it("removes a clean worktree with the files git ignores in it, which don't count as work", async () => {
  const app = await local();
  const { folder } = await finishedWork(app, "4821");
  const doneAt = now;
  // Ignored through the repository's exclude file, as build output is.
  await appendFile(
    path.join(app.repo, ".git", "info", "exclude"),
    "build-output/\n",
  );
  await mkdir(path.join(folder, "build-output"));
  await writeFile(path.join(folder, "build-output", "app.js"), "built\n");
  expect(git(folder, "status", "--porcelain")).toBe("");
  now = doneAt + 4 * DAY;

  const answer = await round(app, [finished("4821", doneAt)]);

  expect(answer.removed.map((one) => one.name)).toEqual(["aj-4821"]);
  expect(existsSync(folder)).toBe(false);
});

it("keeps the same worktree while a thread is Working or Needs you in it", async () => {
  const app = await local();
  const { worktree, handoffId } = await finishedWork(app, "4821");
  const doneAt = now;

  for (const state of ["working", "needs-you"]) {
    now = doneAt + HOUR;
    await becomes(app, handoffId, state);
    now = doneAt + 5 * DAY;

    const answer = await round(app, [finished("4821", doneAt)]);

    expect(answer.removed, state).toEqual([]);
    expect(answer.kept, state).toEqual([
      { worktreeId: worktree.id, name: "aj-4821", reason: "running" },
    ]);
    await expectKept(app, "aj-4821");
    expect(
      (await settingsList(app, [finished("4821", doneAt)]))[0],
    ).toMatchObject({
      running: state,
      cleanUp: { kind: "kept", reason: "running" },
    });
  }
});

it("reads a thread's state again before it removes a worktree, and keeps one whose thread works again", async () => {
  const app = await local();
  const { worktree } = await finishedWork(app, "4821");
  const doneAt = now;
  now = doneAt + 5 * DAY;
  // The tool went back to work since Ajour last read its state, Ready.
  await writeFile(path.join(app.root, "state.txt"), "working");

  const answer = await round(app, [finished("4821", doneAt)]);

  expect(answer.removed).toEqual([]);
  expect(answer.kept).toEqual([
    { worktreeId: worktree.id, name: "aj-4821", reason: "running" },
  ]);
  await expectKept(app, "aj-4821");
});

it("removes nothing when the rule is switched off while the round reads the threads' state", async () => {
  const app = await local();
  await finishedWork(app, "4821");
  const doneAt = now;
  now = doneAt + 5 * DAY;
  const reads = () => app.calls().filter((call) => call.op === "read").length;
  const before = reads();
  // The tool takes its time to answer the round's question.
  await writeFile(path.join(app.root, "hold-read.txt"), "");
  const running = round(app, [finished("4821", doneAt)]);
  await vi.waitFor(() => expect(reads()).toBe(before + 1));

  // Meanwhile the user switches the rule off.
  await setRules(app, { finished: { enabled: false, days: 3 } });
  await writeFile(path.join(app.root, "go.txt"), "");

  // No rule names the worktree any more: it is neither removed nor kept.
  expect(await running).toMatchObject({ removed: [], kept: [] });
  await expectKept(app, "aj-4821");
});

it("keeps a worktree whose thread the tool answers Unknown for, since nothing says the thread is idle", async () => {
  const app = await local();
  const { worktree, handoffId } = await finishedWork(app, "4821");
  const doneAt = now;
  // The tool has answered Unknown for days: no recent change keeps it.
  now = doneAt + HOUR;
  await becomes(app, handoffId, "unknown");
  now = doneAt + 5 * DAY;

  const answer = await round(app, [finished("4821", doneAt)]);

  expect(answer.removed).toEqual([]);
  expect(answer.kept).toEqual([
    { worktreeId: worktree.id, name: "aj-4821", reason: "unconfirmed" },
  ]);
  await expectKept(app, "aj-4821");
  expect(
    (await settingsList(app, [finished("4821", doneAt)]))[0]!.cleanUp,
  ).toEqual({ kind: "kept", reason: "unconfirmed" });
});

it("keeps a worktree when its thread's state can't be read in the round, and says so in the list", async () => {
  const app = await local();
  const { worktree, folder } = await finishedWork(app, "4821");
  const doneAt = now;
  now = doneAt + 5 * DAY;
  // The tool can't be asked: the thread may be at work for all Ajour knows.
  await writeFile(path.join(app.root, "fail-read.txt"), "");

  const answer = await round(app, [finished("4821", doneAt)]);

  expect(answer.removed).toEqual([]);
  expect(answer.kept).toEqual([
    { worktreeId: worktree.id, name: "aj-4821", reason: "unconfirmed" },
  ]);
  await expectKept(app, "aj-4821");
  expect(
    (await settingsList(app, [finished("4821", doneAt)]))[0]!.cleanUp,
  ).toEqual({ kind: "kept", reason: "unconfirmed" });
  expect(eventsNamed(app.sink, "worktree.clean_up").at(-1)).toMatchObject({
    outcome: "ok",
    worktree: { due: 1, removed: 0, kept: 1, kept_unconfirmed: 1 },
  });

  // The tool answers again, Ready as before: the next round removes it.
  await rm(path.join(app.root, "fail-read.txt"));
  expect((await round(app, [finished("4821", doneAt)])).removed).toHaveLength(
    1,
  );
  expect(existsSync(folder)).toBe(false);
});

/**
 * The item's work is done and its thread is off the item: the user took it
 * off with Remove from item. The tool lists `count` threads in the worktree
 * that no handoff links, as one started by hand there would be, each in
 * `state` as the listing saw it, or with none. A state read of any of them
 * would stop it, as Claude Code's read stops a finished background job.
 */
async function unlinkedThreadIn(
  app: App,
  state: string | undefined,
  count = 1,
) {
  const { worktree, folder, handoffId } = await finishedWork(app, "4821");
  expect((await app.call("DELETE", `/api/handoffs/${handoffId}`)).status).toBe(
    200,
  );
  await writeFile(
    path.join(app.root, "threads.json"),
    JSON.stringify({
      [worktree.id]: Array.from({ length: count }, (_, index) => ({
        threadId: `by-hand-${index}`,
        title: "Started by hand",
        ...(state ? { state } : {}),
        native: { stopsOnRead: true },
      })),
    }),
  );
  return { worktree, folder };
}

/**
 * Whether a thread's state was read in the worktree since the plugin's
 * `from`th call, such as since a round began, or a read stopped one.
 */
const readIn = (app: App, worktreeId: string, from: number) =>
  app
    .calls()
    .slice(from)
    .some((call) => call.op === "read" && call.folders?.includes(worktreeId)) ||
  existsSync(path.join(app.root, "stopped.txt"));

it("keeps a worktree where the tool lists a working thread that no handoff links, from the listing alone (#857)", async () => {
  const app = await local();
  const { worktree } = await unlinkedThreadIn(app, "working");
  const doneAt = now;
  now = doneAt + 5 * DAY;
  const from = app.calls().length;

  const answer = await round(app, [finished("4821", doneAt)]);

  expect(answer.removed).toEqual([]);
  expect(answer.kept).toEqual([
    { worktreeId: worktree.id, name: "aj-4821", reason: "running" },
  ]);
  await expectKept(app, "aj-4821");
  // The round asked the tool now, in the worktree itself, for its listing.
  expect(app.calls().at(-1)).toEqual({ op: "list", folder: worktree.id });
  expect(readIn(app, worktree.id, from)).toBe(false);
  expect(eventsNamed(app.sink, "worktree.clean_up").at(-1)).toMatchObject({
    outcome: "ok",
    worktree: {
      due: 1,
      kept: 1,
      kept_running: 1,
      kept_unlinked: 1,
      thread_listings: 1,
    },
  });
});

it.each(["ready", "done"])(
  "removes a worktree where the only thread the tool lists, linked to no handoff, is %s, and never reads its state (#857)",
  async (state) => {
    const app = await local();
    const { worktree, folder } = await unlinkedThreadIn(app, state);
    const doneAt = now;
    now = doneAt + 5 * DAY;
    const from = app.calls().length;

    const answer = await round(app, [finished("4821", doneAt)]);

    expect(answer.removed).toEqual([
      { worktreeId: worktree.id, name: "aj-4821", rule: "finished" },
    ]);
    expect(existsSync(folder)).toBe(false);
    // A state read would have stopped the tool's finished job.
    expect(readIn(app, worktree.id, from)).toBe(false);
  },
);

it.each([undefined, "unknown"])(
  "keeps a worktree as unconfirmed when the listing gives a thread no handoff links the state %s (#857)",
  async (state) => {
    const app = await local();
    const { worktree } = await unlinkedThreadIn(app, state);
    const doneAt = now;
    now = doneAt + 5 * DAY;
    const from = app.calls().length;

    const answer = await round(app, [finished("4821", doneAt)]);

    expect(answer.kept).toEqual([
      { worktreeId: worktree.id, name: "aj-4821", reason: "unconfirmed" },
    ]);
    await expectKept(app, "aj-4821");
    expect(readIn(app, worktree.id, from)).toBe(false);
  },
);

it("keeps a worktree as unconfirmed when the tool's listing there is as long as the limit asked, since it may have cut a thread (#857)", async () => {
  const app = await local();
  const { worktree } = await unlinkedThreadIn(app, "done", 50);
  const doneAt = now;
  now = doneAt + 5 * DAY;

  const answer = await round(app, [finished("4821", doneAt)]);

  expect(answer.kept).toEqual([
    { worktreeId: worktree.id, name: "aj-4821", reason: "unconfirmed" },
  ]);
  await expectKept(app, "aj-4821");
  expect(eventsNamed(app.sink, "worktree.clean_up").at(-1)).toMatchObject({
    worktree: { kept_unconfirmed: 1, kept_unlinked: 1, thread_listings: 1 },
  });
});

it("keeps a worktree as unconfirmed when the tool can't list its threads there (#857)", async () => {
  const app = await local();
  const { worktree, folder } = await unlinkedThreadIn(app, "ready");
  const doneAt = now;
  now = doneAt + 5 * DAY;
  await writeFile(path.join(app.root, "fail-list.txt"), "");

  const answer = await round(app, [finished("4821", doneAt)]);

  expect(answer.removed).toEqual([]);
  expect(answer.kept).toEqual([
    { worktreeId: worktree.id, name: "aj-4821", reason: "unconfirmed" },
  ]);
  await expectKept(app, "aj-4821");
  expect(
    (await settingsList(app, [finished("4821", doneAt)]))[0]!.cleanUp,
  ).toEqual({ kind: "kept", reason: "unconfirmed" });
  expect(eventsNamed(app.sink, "worktree.clean_up").at(-1)).toMatchObject({
    worktree: { kept_unconfirmed: 1, kept_unlinked: 1, thread_listings: 1 },
  });

  // The tool lists again: the next round removes it.
  await rm(path.join(app.root, "fail-list.txt"));
  expect((await round(app, [finished("4821", doneAt)])).removed).toHaveLength(
    1,
  );
  expect(existsSync(folder)).toBe(false);
});

// A folder nobody may write to stops git on POSIX only.
it.skipIf(process.platform === "win32")(
  "leaves what git left behind of a worktree it couldn't remove whole, and keeps its record",
  async () => {
    const app = await local();
    const { worktree, folder } = await finishedWork(app, "4821");
    const doneAt = now;
    // Ignored, so git status is clean, and git can't delete the file in it.
    await appendFile(path.join(app.repo, ".git", "info", "exclude"), "held/\n");
    const held = path.join(folder, "held");
    await mkdir(held);
    await writeFile(path.join(held, "marked-file.txt"), "kept\n");
    await chmod(held, 0o555);
    now = doneAt + 5 * DAY;
    try {
      const answer = await round(app, [finished("4821", doneAt)]);

      expect(answer.removed).toEqual([]);
      expect(answer.kept).toEqual([
        { worktreeId: worktree.id, name: "aj-4821", reason: "failed" },
      ]);
      // What git couldn't remove is still there, and so is the record,
      // so the list still shows the folder.
      expect(existsSync(path.join(held, "marked-file.txt"))).toBe(true);
      expect((await app.call("GET", "/api/worktrees")).body).toHaveLength(1);
      expect(hasBranch(app.repo, worktree.branch)).toBe(true);
      const event = eventsNamed(app.sink, "worktree.clean_up").at(-1);
      expect(JSON.stringify([answer.kept, event])).not.toMatch(
        /marked-file|held|Permission|handoff-worktree-/,
      );

      // A hand off of the item finds a record and a folder, but no
      // worktree git knows: it is refused, and no tool starts in what
      // git left behind.
      const starts = () =>
        app.calls().filter((call) => call.op === "start").length;
      const before = starts();
      const again = await app.handOff("4821", "Week grid", {
        startIn: { kind: "worktree", worktreeId: worktree.id },
      });
      expect(again.status).toBe(409);
      expect(again.body.error).toBe(
        "This worktree is no longer available. Choose another place to start.",
      );
      expect(starts()).toBe(before);
    } finally {
      await chmod(held, 0o755);
    }
  },
);

it("keeps the same worktree when a thread changed in the last hour, or the worktree was just made", async () => {
  const app = await local();
  const { worktree, handoffId } = await finishedWork(app, "4821");
  const doneAt = now;
  now = doneAt + 5 * DAY;
  await becomes(app, handoffId, "done");
  now += 59 * 60_000;

  expect((await round(app, [finished("4821", doneAt)])).kept).toEqual([
    { worktreeId: worktree.id, name: "aj-4821", reason: "recent" },
  ]);
  await expectKept(app, "aj-4821");
  expect(
    (await settingsList(app, [finished("4821", doneAt)]))[0]!.cleanUp,
  ).toEqual({ kind: "kept", reason: "recent" });

  // A hand off of an item that was finished long ago: its new worktree has
  // no thread on record until the tool answers.
  const late = await app.handOff("4700", "Old item");
  expect(late.status, JSON.stringify(late.body)).toBe(200);
  // The fake tool reports one state for every thread: Done for both.
  await becomes(app, late.body.id, "done");
  expect(
    (await round(app, [finished("4700", doneAt - 30 * DAY)])).kept,
  ).toContainEqual({
    worktreeId: late.body.worktree!.id,
    name: "aj-4700",
    reason: "recent",
  });
  await expectKept(app, "aj-4700");

  // An hour after the last change, both go.
  now += 2 * HOUR;
  expect(
    (
      await round(app, [
        finished("4821", doneAt),
        finished("4700", doneAt - 30 * DAY),
      ])
    ).removed.map((one) => one.name),
  ).toEqual(["aj-4821", "aj-4700"]);
});

it("keeps a worktree a hand off is starting in, before its tool has answered", async () => {
  const app = await local();
  const { worktree } = await finishedWork(app, "4821");
  const doneAt = now;
  now = doneAt + 5 * DAY;
  // A second hand off of the item joins its worktree. Its tool has the
  // request and hasn't answered, so Ajour holds no thread for it yet.
  const starting = app.handOff("4821", "Please wait");
  await vi.waitFor(() =>
    expect(app.calls().filter((call) => call.op === "start")).toHaveLength(2),
  );

  const answer = await round(app, [finished("4821", doneAt)]);

  expect(answer.removed).toEqual([]);
  expect(answer.kept).toEqual([
    { worktreeId: worktree.id, name: "aj-4821", reason: "recent" },
  ]);
  await expectKept(app, "aj-4821");
  // The tool answers: the hand off started in the worktree that stayed.
  await writeFile(path.join(app.root, "go.txt"), "");
  const started = await starting;
  expect(started.status, JSON.stringify(started.body)).toBe(200);
  expect(started.body.worktree).toMatchObject({ id: worktree.id });
});

it("keeps the same worktree when the branch checked out in it is no longer the one Ajour recorded", async () => {
  const app = await local();
  const { worktree, folder } = await finishedWork(app, "4821");
  const doneAt = now;
  git(folder, "switch", "--quiet", "-c", "something-else");
  now = doneAt + 5 * DAY;

  const answer = await round(app, [finished("4821", doneAt)]);

  expect(answer.removed).toEqual([]);
  expect(answer.kept).toEqual([
    { worktreeId: worktree.id, name: "aj-4821", reason: "branch" },
  ]);
  await expectKept(app, "aj-4821");
  expect(git(folder, "branch", "--show-current")).toBe("something-else");
  expect(
    (await settingsList(app, [finished("4821", doneAt)]))[0]!.cleanUp,
  ).toEqual({ kind: "kept", reason: "branch" });
});

// A link stands for a folder on POSIX. Windows needs a privilege to make one.
it.skipIf(process.platform === "win32")(
  "keeps a worktree whose path is not inside .ajour/worktrees any more, because that folder became a link",
  async () => {
    const app = await local();
    const { worktree } = await finishedWork(app, "4821");
    const doneAt = now;
    // The worktrees moved out of the repository folder, behind a link.
    const inside = path.join(app.repo, ".ajour", "worktrees");
    const outside = path.join(app.root, "elsewhere");
    await rename(inside, outside);
    await symlink(outside, inside);
    now = doneAt + 5 * DAY;

    const answer = await round(app, [finished("4821", doneAt)]);

    expect(answer.removed).toEqual([]);
    expect(answer.kept).toEqual([
      { worktreeId: worktree.id, name: "aj-4821", reason: "not_ours" },
    ]);
    // Nothing behind the link was removed, and the record stays.
    expect(existsSync(path.join(outside, "aj-4821", "README.md"))).toBe(true);
    expect((await app.call("GET", "/api/worktrees")).body).toHaveLength(1);
    expect(hasBranch(app.repo, worktree.branch)).toBe(true);
  },
);

it("keeps a folder that took the worktree's place, since it is not the worktree Ajour made", async () => {
  const app = await local();
  const { worktree, folder } = await finishedWork(app, "4821");
  const doneAt = now;
  await rename(folder, `${folder}-moved`);
  await mkdir(folder);
  await writeFile(path.join(folder, "theirs.txt"), "someone else's\n");
  now = doneAt + 5 * DAY;

  const answer = await round(app, [finished("4821", doneAt)]);

  expect(answer.removed).toEqual([]);
  expect(answer.kept).toEqual([
    { worktreeId: worktree.id, name: "aj-4821", reason: "not_ours" },
  ]);
  expect(existsSync(path.join(folder, "theirs.txt"))).toBe(true);
  expect(existsSync(path.join(`${folder}-moved`, "README.md"))).toBe(true);
});

it("leaves a worktree whose folder is gone in the list as Missing, for Forget", async () => {
  const app = await local();
  const { worktree, folder } = await finishedWork(app, "4821");
  const doneAt = now;
  await rename(folder, path.join(app.root, "taken-away"));
  now = doneAt + 5 * DAY;

  const answer = await round(app, [finished("4821", doneAt)]);

  expect(answer.removed).toEqual([]);
  expect(answer.kept).toEqual([
    { worktreeId: worktree.id, name: "aj-4821", reason: "missing" },
  ]);
  expect(
    (await settingsList(app, [finished("4821", doneAt)]))[0],
  ).toMatchObject({ status: { state: "missing" } });
  expect(hasBranch(app.repo, worktree.branch)).toBe(true);
});

it("keeps a worktree git refuses to remove, says so in the list, and passes on nothing git wrote", async () => {
  const app = await local();
  const { worktree } = await finishedWork(app, "4821");
  const doneAt = now;
  // The user locked it in git, which then refuses a plain remove.
  git(app.repo, "worktree", "lock", app.worktreeFolder("aj-4821"));
  now = doneAt + 5 * DAY;

  const answer = await round(app, [finished("4821", doneAt)]);

  expect(answer.removed).toEqual([]);
  expect(answer.kept).toEqual([
    { worktreeId: worktree.id, name: "aj-4821", reason: "failed" },
  ]);
  await expectKept(app, "aj-4821");
  expect(
    (await settingsList(app, [finished("4821", doneAt)]))[0]!.cleanUp,
  ).toEqual({ kind: "kept", reason: "failed" });
  const event = eventsNamed(app.sink, "worktree.clean_up").at(-1);
  expect(event).toMatchObject({
    outcome: "ok",
    worktree: { due: 1, removed: 0, kept: 1, kept_failed: 1 },
  });
  expect(JSON.stringify([answer.kept, event])).not.toMatch(
    /locked|fatal|handoff-worktree-|week-grid/,
  );

  // Unlocked, the next round removes it.
  git(app.repo, "worktree", "unlock", app.worktreeFolder("aj-4821"));
  expect((await round(app, [finished("4821", doneAt)])).removed).toHaveLength(
    1,
  );
});

it("stops the removal when the item is reopened before the delay", async () => {
  const app = await local();
  await finishedWork(app, "4821");
  const doneAt = now;
  now = doneAt + 2 * DAY;
  // Done two days ago: it goes in a day.
  expect(
    (await settingsList(app, [finished("4821", doneAt)]))[0]!.cleanUp,
  ).toEqual({ kind: "goes", at: doneAt + 3 * DAY });

  // The item is active again, so the window no longer sends it.
  now = doneAt + 10 * DAY;
  const answer = await round(app, []);

  expect(answer).toMatchObject({ removed: [], kept: [] });
  await expectKept(app, "aj-4821");
  expect((await settingsList(app, []))[0]).not.toHaveProperty("cleanUp");
});

it("removes nothing with the rule switched off, and moves the day a worktree goes with the rule's delay", async () => {
  const app = await local();
  await finishedWork(app, "4821");
  const doneAt = now;
  const goes = async () =>
    (await settingsList(app, [finished("4821", doneAt)]))[0]!.cleanUp;
  now = doneAt + DAY;
  expect(await goes()).toEqual({ kind: "goes", at: doneAt + 3 * DAY });

  await setRules(app, { finished: { enabled: true, days: 7 } });
  expect(await goes()).toEqual({ kind: "goes", at: doneAt + 7 * DAY });
  now = doneAt + 5 * DAY;
  expect((await round(app, [finished("4821", doneAt)])).removed).toEqual([]);

  await setRules(app, { finished: { enabled: false, days: 1 } });
  now = doneAt + 100 * DAY;
  expect(await goes()).toBeUndefined();
  expect(await round(app, [finished("4821", doneAt)])).toMatchObject({
    removed: [],
    kept: [],
  });
  await expectKept(app, "aj-4821");
  expect(eventsNamed(app.sink, "worktree.clean_up").at(-1)).toMatchObject({
    worktree: { count: 1, due: 0, finished_rule: false, unused_rule: false },
  });
});

it("removes with the unused rule a clean worktree with no hand off and no thread change for its delay, whatever the item's state", async () => {
  const app = await local();
  const { worktree, folder } = await finishedWork(app, "4821");
  const madeAt = now;

  // Off on a fresh install: an active item's worktree stays for good.
  now = madeAt + 400 * DAY;
  expect(await round(app, [])).toMatchObject({ removed: [], kept: [] });
  await expectKept(app, "aj-4821");

  await setRules(app, { unused: { enabled: true, days: 30 } });
  // A new hand off of the item, in its worktree, starts the delay again.
  const again = await app.handOff("4821", "Week grid");
  expect(again.body.worktree).toMatchObject({ id: worktree.id });
  await becomes(app, again.body.id, "ready");
  const usedAt = now;

  now = usedAt + 29 * DAY;
  expect(await round(app, [])).toMatchObject({ removed: [], kept: [] });
  // The list says the day the rule's delay ends, counted from the last use.
  expect((await settingsList(app, []))[0]!.cleanUp).toEqual({
    kind: "goes",
    at: usedAt + 30 * DAY,
  });

  now = usedAt + 30 * DAY;
  // The item is still active: the window sends no finished moment for it.
  const answer = await round(app, []);

  expect(answer.removed).toEqual([
    { worktreeId: worktree.id, name: "aj-4821", rule: "unused" },
  ]);
  expect(existsSync(folder)).toBe(false);
  expect(hasBranch(app.repo, worktree.branch)).toBe(true);
  expect(eventsNamed(app.sink, "worktree.clean_up").at(-1)).toMatchObject({
    worktree: { removed: 1, removed_unused: 1, unused_rule: true },
  });
});

it("says the earliest day a worktree goes when both rules name it", async () => {
  const app = await local();
  await finishedWork(app, "4821");
  const doneAt = now;
  const goes = async () =>
    (await settingsList(app, [finished("4821", doneAt)]))[0]!.cleanUp;
  now = doneAt + 2 * HOUR;

  // The unused rule ends first: a day after the last use.
  await setRules(app, { unused: { enabled: true, days: 1 } });
  expect(await goes()).toEqual({ kind: "goes", at: doneAt + DAY });

  // The finished items rule ends first: three days after the item was done.
  await setRules(app, { unused: { enabled: true, days: 30 } });
  expect(await goes()).toEqual({ kind: "goes", at: doneAt + 3 * DAY });
});

it("ignores a finished moment before zero or after now, and still applies the unused rule", async () => {
  const app = await local();
  const { worktree, folder } = await finishedWork(app, "4821");
  const madeAt = now;
  now = madeAt + 2 * HOUR;
  // 9e15 is past the last day a date can hold.
  for (const moment of [-1, -5 * DAY, now + 1, 9e15]) {
    expect(
      await round(app, [finished("4821", moment)]),
      String(moment),
    ).toMatchObject({ removed: [], kept: [] });
    expect(
      (await settingsList(app, [finished("4821", moment)]))[0],
      String(moment),
    ).not.toHaveProperty("cleanUp");
  }
  await expectKept(app, "aj-4821");

  // The unused rule counts from the worktree's own use, whatever was sent.
  await setRules(app, { unused: { enabled: true, days: 30 } });
  now = madeAt + 30 * DAY;
  expect((await round(app, [finished("4821", -1)])).removed).toEqual([
    { worktreeId: worktree.id, name: "aj-4821", rule: "unused" },
  ]);
  expect(existsSync(folder)).toBe(false);
});

it("counts a worktree as used when its newest thread was, also once that thread is removed from the item", async () => {
  const app = await local();
  const { worktree, handoffId, folder } = await finishedWork(app, "4821");
  const madeAt = now;
  await setRules(app, { unused: { enabled: true, days: 30 } });
  // Forty days on, a new hand off works in it, then both threads are
  // removed from the item.
  now = madeAt + 40 * DAY;
  const again = await app.handOff("4821", "Week grid");
  expect(again.body.worktree).toMatchObject({ id: worktree.id });
  await becomes(app, again.body.id, "ready");
  const usedAt = now;
  now = usedAt + 2 * HOUR;
  for (const id of [handoffId, again.body.id])
    expect((await app.call("DELETE", `/api/handoffs/${id}`)).status).toBe(200);
  expect((await app.call("GET", "/api/handoffs")).body).toEqual([]);

  // The worktree was used two hours ago, not forty days ago.
  expect(await round(app, [])).toMatchObject({ removed: [], kept: [] });
  await expectKept(app, "aj-4821");
  expect((await settingsList(app, []))[0]!.cleanUp).toEqual({
    kind: "goes",
    at: usedAt + 30 * DAY,
  });

  now = usedAt + 30 * DAY;
  expect((await round(app, [])).removed.map((one) => one.name)).toEqual([
    "aj-4821",
  ]);
  expect(existsSync(folder)).toBe(false);
});

it("keeps an unused worktree with uncommitted files, as it keeps a finished item's", async () => {
  const app = await local();
  const { worktree, folder } = await finishedWork(app, "4821");
  await setRules(app, { unused: { enabled: true, days: 30 } });
  await writeFile(path.join(folder, "draft.md"), "work in progress\n");
  now += 60 * DAY;

  expect((await round(app, [])).kept).toEqual([
    { worktreeId: worktree.id, name: "aj-4821", reason: "changes" },
  ]);
  await expectKept(app, "aj-4821");
});

it("looks at no worktree for a tool that made its own, and removes only what each rule names among several", async () => {
  const app = await local();
  const done = await finishedWork(app, "1", "Done item");
  const active = await finishedWork(app, "2", "Active item");
  const own = await app.handOff("3", "Own worktree", { toolId: "own" });
  expect(own.status, JSON.stringify(own.body)).toBe(200);
  const doneAt = now;
  now = doneAt + 4 * DAY;

  const answer = await round(app, [finished("1", doneAt)], "manual");

  expect(answer.removed.map((one) => one.name)).toEqual(["aj-1"]);
  expect(answer.kept).toEqual([]);
  expect(existsSync(done.folder)).toBe(false);
  await expectKept(app, "aj-2");
  expect(active.worktree.name).toBe("aj-2");
  // The tool's own worktree is no worktree of Ajour's: two were looked at.
  expect(eventsNamed(app.sink, "worktree.clean_up").at(-1)).toMatchObject({
    worktree: { trigger: "manual", count: 2, due: 1, removed: 1 },
  });
  // Every branch is still there.
  for (const branch of [done.worktree.branch, active.worktree.branch])
    expect(hasBranch(app.repo, branch)).toBe(true);
});

it("keeps each rule's switch and delay as Settings save them, one at a time, and refuses a delay that is no whole day", async () => {
  const app = await local();
  const settings = async () =>
    (await app.call("GET", "/api/worktrees/settings")).body;
  // A fresh install: finished items after 3 days, unused ones never.
  expect(await settings()).toEqual({
    startIn: "worktree",
    cleanUp: {
      finished: { enabled: true, days: 3 },
      unused: { enabled: false, days: 30 },
    },
  });

  await setRules(app, { unused: { enabled: true, days: 14 } });
  expect(
    (await app.call("POST", "/api/worktrees/settings", { startIn: "ask" }))
      .body,
  ).toEqual({
    startIn: "ask",
    cleanUp: {
      finished: { enabled: true, days: 3 },
      unused: { enabled: true, days: 14 },
    },
  });
  for (const days of [0, 1.5, 400])
    expect(
      (
        await app.call("POST", "/api/worktrees/settings", {
          cleanUp: { finished: { enabled: true, days } },
        })
      ).status,
      String(days),
    ).toBe(400);
  expect(await settings()).toMatchObject({
    cleanUp: { finished: { enabled: true, days: 3 } },
  });
  // The event of a save records what it changed, and no more.
  expect(
    eventsNamed(app.sink, "worktree.settings_update")
      .filter((event) => event.outcome === "ok")
      .map((event) => event.worktree),
  ).toEqual([{ unused_rule: true, unused_days: 14 }, { start_in: "ask" }]);
});

it("refuses a round that names no trigger or a finished moment that is no number", async () => {
  const app = await local();

  expect(
    (await app.call("POST", "/api/worktrees/clean-up", { finished: [] }))
      .status,
  ).toBe(400);
  expect(
    (
      await app.call("POST", "/api/worktrees/clean-up", {
        trigger: "manual",
        finished: [{ workItemId: "item-1", finishedAt: "yesterday" }],
      })
    ).status,
  ).toBe(400);
});
