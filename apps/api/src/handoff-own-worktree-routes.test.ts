import { existsSync } from "node:fs";
import { readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeAll, afterAll, expect, it, vi } from "vitest";
import {
  cleanUpWorktreeApps,
  cloneBehindOrigin,
  eventsNamed,
  git,
  gitSays,
  localRepository,
  setUp,
  useHermeticGit,
} from "./test-support/handoff-worktree-harness.ts";

/*
 * Start in for a tool that makes its own worktree (#863), through the
 * hand-off routes: the fake plugin's tool "own" declares `ownWorktree`, and
 * "tool" does not. A temporary folder holds a real git repository running
 * real git. Each test reads what the plugin's start request carried, the
 * branch and the source, and that Ajour made nothing on disk: it only
 * fetches the source it names, when that is a remote's branch.
 *
 * One thing is replaced: a test makes the lookup of `git` on PATH find
 * nothing, for a computer without git.
 */
const gitOnPath = vi.hoisted(() => ({ missing: false }));
vi.mock("./agent-runner/cli-path.ts", async (actual) => {
  const real = await actual<typeof import("./agent-runner/cli-path.ts")>();
  return {
    ...real,
    findExecutable: (name: string, pathValue: string) =>
      gitOnPath.missing && name === "git"
        ? Promise.resolve(null)
        : real.findExecutable(name, pathValue),
  };
});

// Each test runs real git a dozen times or more, which takes seconds on a
// Windows runner: past vitest's 5 second default.
vi.setConfig({ testTimeout: 30_000 });

let restoreGit: () => Promise<void>;
beforeAll(async () => {
  restoreGit = await useHermeticGit();
});
afterAll(() => restoreGit());

afterEach(async () => {
  gitOnPath.missing = false;
  await cleanUpWorktreeApps();
});

type App = Awaited<ReturnType<typeof setUp>>;

/** `repo` with one commit on `main` and a second branch, `develop`. */
async function repositoryWithDevelop(repo: string) {
  await localRepository(repo);
  git(repo, "branch", "develop");
}

/** What Ajour would have made for a worktree: none of it is there. */
async function expectNothingMade(app: App) {
  expect(existsSync(path.join(app.repo, ".ajour"))).toBe(false);
  expect(
    await readFile(path.join(app.repo, ".git", "info", "exclude"), "utf8"),
  ).not.toContain(".ajour");
  expect(git(app.repo, "worktree", "list", "--porcelain")).not.toContain(
    ".ajour",
  );
  expect((await app.call("GET", "/api/worktrees")).body).toEqual([]);
  expect(eventsNamed(app.sink, "worktree.create")).toEqual([]);
}

it("tells a tool that makes its own worktree the branch and the source under New worktree, starts it in the repository folder and makes nothing", async () => {
  let remote!: Awaited<ReturnType<typeof cloneBehindOrigin>>;
  const app = await setUp(async ({ root, repo }) => {
    remote = await cloneBehindOrigin(root, repo);
  });

  // Settings say New worktree, as on a fresh install.
  const started = await app.handOff("50", "Own worktree", { toolId: "own" });

  expect(started.status, JSON.stringify(started.body)).toBe(200);
  expect(app.calls()).toEqual([
    {
      op: "start",
      tool: "own",
      folder: { id: app.folder.id, name: "repo" },
      branch: "50-own-worktree",
      source: "origin/main",
    },
  ]);
  // The handoff says the tool made the worktree, and names none of Ajour's.
  expect(started.body).toMatchObject({
    folderId: app.folder.id,
    branch: "50-own-worktree",
    ownWorktree: true,
  });
  expect(started.body).not.toHaveProperty("worktree");
  expect(started.body).not.toHaveProperty("worktreeId");
  expect((await app.call("GET", "/api/handoffs")).body).toMatchObject([
    { id: started.body.id, ownWorktree: true },
  ]);

  // Nothing made on disk: no folder, no branch, no exclude line.
  await expectNothingMade(app);
  expect(git(app.repo, "branch", "--list")).toBe("* main");
  // The source was fetched first, as for a worktree of Ajour's: the tool
  // starts from the commit only the remote had.
  expect(git(app.repo, "rev-parse", "origin/main")).toBe(remote.second);
  expect(started.body).not.toHaveProperty("sourceStale");

  // One event for reading the source, with no branch or source name.
  expect(eventsNamed(app.sink, "worktree.resolve_source")).toMatchObject([
    {
      kind: "job",
      outcome: "ok",
      worktree: { source: "remote", source_choice: "default", fetch: "ok" },
    },
  ]);
  expect(
    eventsNamed(app.sink, "handoff.start").find(
      (event) => event.handoff?.start_in,
    )?.handoff,
  ).toMatchObject({ start_in: "default", own_worktree: true });
  const logged = JSON.stringify(app.sink.events).toLowerCase();
  for (const content of ["50-own", "origin/main"])
    expect(logged).not.toContain(content);
});

it("sends the source and the branch the user chose, and starts the folder's next one from that source", async () => {
  const app = await setUp(({ repo }) => repositoryWithDevelop(repo));

  const picked = await app.handOff("51", "Own worktree", {
    toolId: "own",
    startIn: { kind: "new", branch: "51-mine", source: "develop" },
  });
  // The next hand off names no source: the folder remembers the pick.
  const next = await app.handOff("52", "The next one", { toolId: "own" });
  // A typed name the repository has gets the next free one too.
  const taken = await app.handOff("53", "A taken name", {
    toolId: "own",
    startIn: { kind: "new", branch: "develop" },
  });

  expect(picked.status, JSON.stringify(picked.body)).toBe(200);
  expect(next.status, JSON.stringify(next.body)).toBe(200);
  expect(taken.status, JSON.stringify(taken.body)).toBe(200);
  expect(taken.body).toMatchObject({ branch: "develop-2" });
  expect(app.calls().at(-1)).toMatchObject({
    branch: "develop-2",
    source: "develop",
  });
  expect(app.calls().slice(0, 2)).toEqual([
    {
      op: "start",
      tool: "own",
      folder: { id: app.folder.id, name: "repo" },
      branch: "51-mine",
      source: "develop",
    },
    {
      op: "start",
      tool: "own",
      folder: { id: app.folder.id, name: "repo" },
      branch: "52-the-next-one",
      source: "develop",
    },
  ]);
  expect(
    eventsNamed(app.sink, "worktree.resolve_source").map(
      (event) => event.worktree?.source_choice,
    ),
  ).toEqual(["picked", "remembered", "remembered"]);
  await expectNothingMade(app);
  expect(git(app.repo, "branch", "--list", "5*")).toBe("");
});

it("fetches a remote source the clone never had, so the tool can start from it", async () => {
  // A single-branch clone of `develop`: git recorded no default branch for
  // the remote and never fetched its `main`. Ajour learns the default
  // branch by asking the remote.
  let main = "";
  const app = await setUp(async ({ root, repo }) => {
    const origin = path.join(root, "origin.git");
    const seed = path.join(root, "seed");
    git(root, "init", "--quiet", "--bare", "-b", "main", origin);
    await localRepository(seed);
    main = git(seed, "rev-parse", "HEAD");
    git(seed, "branch", "develop");
    git(seed, "remote", "add", "origin", origin);
    git(seed, "push", "--quiet", "origin", "main", "develop");
    await rm(repo, { recursive: true, force: true });
    git(
      root,
      "clone",
      "--quiet",
      "--single-branch",
      "--branch",
      "develop",
      origin,
      repo,
    );
  });
  const hasMain = () =>
    gitSays(app.repo, "rev-parse", "--verify", "refs/remotes/origin/main");
  expect(hasMain()).toBe(false);

  const started = await app.handOff("56", "Single branch", { toolId: "own" });

  expect(started.status, JSON.stringify(started.body)).toBe(200);
  expect(app.calls()).toMatchObject([
    { tool: "own", branch: "56-single-branch", source: "origin/main" },
  ]);
  // The name the tool was given now resolves in the repository.
  expect(hasMain()).toBe(true);
  expect(git(app.repo, "rev-parse", "refs/remotes/origin/main")).toBe(main);
  expect(started.body).not.toHaveProperty("sourceStale");
  expect(eventsNamed(app.sink, "worktree.resolve_source")).toMatchObject([
    { outcome: "ok", worktree: { source: "remote", fetch: "ok" } },
  ]);
});

it("starts from the last fetched copy when the fetch fails, and says so, and refuses when the repository has no copy", async () => {
  let remote!: Awaited<ReturnType<typeof cloneBehindOrigin>>;
  const app = await setUp(async ({ root, repo }) => {
    remote = await cloneBehindOrigin(root, repo);
    // The remote can't be reached any more.
    git(repo, "remote", "set-url", "origin", path.join(root, "gone.git"));
  });

  const started = await app.handOff("57", "Offline", { toolId: "own" });

  expect(started.status, JSON.stringify(started.body)).toBe(200);
  // The answer names the stale source, for the toast.
  expect(started.body).toMatchObject({
    ownWorktree: true,
    sourceStale: true,
    source: "origin/main",
  });
  expect(app.calls()).toMatchObject([
    { tool: "own", branch: "57-offline", source: "origin/main" },
  ]);
  expect(git(app.repo, "rev-parse", "origin/main")).toBe(remote.first);
  expect(eventsNamed(app.sink, "worktree.resolve_source")).toMatchObject([
    { outcome: "ok", worktree: { source: "remote", fetch: "failed" } },
  ]);

  // No copy of the source at all: the tool would have nothing to start from.
  git(app.repo, "update-ref", "-d", "refs/remotes/origin/main");
  const refused = await app.handOff("58", "No copy", { toolId: "own" });
  expect(refused.status).toBe(409);
  expect(refused.body.error).toContain("origin/main");
  expect(app.calls()).toHaveLength(1);
  expect(eventsNamed(app.sink, "worktree.resolve_source").at(-1)).toMatchObject(
    { outcome: "refused", outcome_reason: "source_unresolved" },
  );
});

it("refuses a source the repository doesn't have, and starts nothing", async () => {
  const app = await setUp(({ repo }) => repositoryWithDevelop(repo));

  const refused = await app.handOff("53", "No such source", {
    toolId: "own",
    startIn: { kind: "new", source: "release/9" },
  });

  expect(refused.status).toBe(409);
  expect(refused.body.error).toContain("release/9");
  expect(app.calls()).toEqual([]);
  expect((await app.call("GET", "/api/handoffs")).body).toEqual([]);
  expect(eventsNamed(app.sink, "worktree.resolve_source")).toMatchObject([
    { outcome: "refused", outcome_reason: "source_unresolved" },
  ]);
});

it("sends no branch and no source under Main folder, chosen for one hand off or in Settings", async () => {
  const app = await setUp(({ repo }) => localRepository(repo).then(() => {}));

  const chosen = await app.handOff("54", "Own in main", {
    toolId: "own",
    startIn: { kind: "main" },
  });
  await app.call("POST", "/api/worktrees/settings", { startIn: "main" });
  const bySettings = await app.handOff("55", "Own by settings", {
    toolId: "own",
  });

  expect(chosen.status, JSON.stringify(chosen.body)).toBe(200);
  expect(bySettings.status, JSON.stringify(bySettings.body)).toBe(200);
  // The fake tool logs a source only when its request has one.
  expect(app.calls()).toEqual([
    {
      op: "start",
      tool: "own",
      folder: { id: app.folder.id, name: "repo" },
      branch: null,
    },
    {
      op: "start",
      tool: "own",
      folder: { id: app.folder.id, name: "repo" },
      branch: null,
    },
  ]);
  for (const answer of [chosen, bySettings]) {
    expect(answer.body).not.toHaveProperty("ownWorktree");
    expect(answer.body).not.toHaveProperty("branch");
  }
  // No source was read for a start that needs none.
  expect(eventsNamed(app.sink, "worktree.resolve_source")).toEqual([]);
  await expectNothingMade(app);
});

it("treats a previous worktree as New worktree for such a tool: it gets the branch and the source, and never the worktree's folder", async () => {
  const app = await setUp(({ repo }) => localRepository(repo).then(() => {}));
  // Another tool's hand off gave the item the worktree aj-60.
  const first = await app.handOff("60", "Week grid");
  const worktree = first.body.worktree!;
  expect(worktree, JSON.stringify(first.body)).toMatchObject({
    name: "aj-60",
  });
  // The template's name is the branch of aj-60, so the tool is told the
  // next free one, as a second worktree of Ajour's would get. The fake tool
  // refuses a branch the repository has, and creates none.
  expect(git(app.repo, "branch", "--list", "60-*")).toContain("60-week-grid");
  const expected = {
    op: "start",
    tool: "own",
    folder: { id: app.folder.id, name: "repo" },
    branch: "60-week-grid-2",
    source: "main",
  };

  // The user chose the previous worktree.
  const chosen = await app.handOff("60", "Week grid", {
    toolId: "own",
    startIn: { kind: "worktree", worktreeId: worktree.id },
  });
  // No choice: the item's newest worktree is the default place.
  const byDefault = await app.handOff("60", "Week grid", { toolId: "own" });
  // And so it is when Settings say Main folder.
  await app.call("POST", "/api/worktrees/settings", { startIn: "main" });
  const underMain = await app.handOff("60", "Week grid", { toolId: "own" });
  // New worktree asked for outright gives the same request.
  const asked = await app.handOff("60", "Week grid", {
    toolId: "own",
    startIn: { kind: "new" },
  });

  for (const answer of [chosen, byDefault, underMain, asked]) {
    expect(answer.status, JSON.stringify(answer.body)).toBe(200);
    expect(answer.body).toMatchObject({ ownWorktree: true });
    expect(answer.body).not.toHaveProperty("worktreeId");
  }
  const [toTool, ...toOwn] = app.calls();
  expect(toOwn).toEqual([expected, expected, expected, expected]);
  // The tool without `ownWorktree` is started as before: in the worktree,
  // on its branch, with no source. Only its start names the repository
  // folder, since only its folder is a worktree.
  expect(toTool).toEqual({
    op: "start",
    tool: "tool",
    folder: { id: worktree.id, name: "aj-60" },
    branch: "60-week-grid",
    repositoryFolder: { id: app.folder.id, name: "repo" },
  });
  // Ajour made the first worktree and nothing since.
  expect(await readdir(path.join(app.repo, ".ajour", "worktrees"))).toEqual([
    "aj-60",
  ]);
  expect((await app.call("GET", "/api/worktrees")).body).toHaveLength(1);
  expect(eventsNamed(app.sink, "worktree.create")).toHaveLength(1);
});

it("starts such a tool with no branch where a worktree can't be made: a folder that is not a git repository, or a computer without git", async () => {
  const plain = await setUp(async () => {});
  const started = await plain.handOff("70", "Plain folder", { toolId: "own" });
  expect(started.status, JSON.stringify(started.body)).toBe(200);
  expect(started.body).not.toHaveProperty("ownWorktree");
  expect(plain.calls()).toEqual([
    {
      op: "start",
      tool: "own",
      folder: { id: plain.folder.id, name: "repo" },
      branch: null,
    },
  ]);
  expect(eventsNamed(plain.sink, "worktree.resolve_source")).toMatchObject([
    { outcome: "refused", outcome_reason: "not_repository" },
  ]);

  const noGit = await setUp(({ repo }) => localRepository(repo).then(() => {}));
  gitOnPath.missing = true;
  const without = await noGit.handOff("71", "No git here", { toolId: "own" });
  expect(without.status, JSON.stringify(without.body)).toBe(200);
  expect(noGit.calls()).toMatchObject([{ tool: "own", branch: null }]);
  expect(noGit.calls()[0]).not.toHaveProperty("source");
  expect(eventsNamed(noGit.sink, "worktree.resolve_source")).toMatchObject([
    { outcome: "refused", outcome_reason: "git_missing" },
  ]);
});

it("starts in the main folder when the branch template fills to an invalid name and the folder gets no worktree, and refuses it where the tool would create it", async () => {
  const templates = {
    prompt: "{{item.title}}",
    title: "{{item.title}}",
    branch: "two words",
  };
  const save = (app: Awaited<ReturnType<typeof setUp>>) =>
    app.call("POST", "/api/plugins/handoff/handoffs/templates", templates);
  const started = {
    op: "start",
    tool: "own",
    folder: { id: expect.any(String), name: "repo" },
    branch: null,
  };

  // A folder that is not a git checkout: the tool makes no worktree there,
  // so the branch is not used and the start goes through.
  const plain = await setUp(async () => {});
  await save(plain);
  const inPlain = await plain.handOff("35", "Plain folder", { toolId: "own" });
  expect(inPlain.status, JSON.stringify(inPlain.body)).toBe(200);
  expect(plain.calls()).toEqual([started]);

  // A computer without git.
  const noGit = await setUp(({ repo }) => localRepository(repo).then(() => {}));
  await save(noGit);
  gitOnPath.missing = true;
  const without = await noGit.handOff("36", "No git here", { toolId: "own" });
  expect(without.status, JSON.stringify(without.body)).toBe(200);
  expect(noGit.calls()).toEqual([started]);
  gitOnPath.missing = false;

  // A git repository: the tool would create the branch, so the start is
  // refused, and the template is named.
  const app = await setUp(({ repo }) => localRepository(repo).then(() => {}));
  await save(app);
  const refused = await app.handOff("37", "In a repository", {
    toolId: "own",
  });
  expect(refused.status).toBe(400);
  expect(refused.body.error).toContain("branch template");
  expect(app.calls()).toEqual([]);
});

it("names the branch after the item when the branch template fills empty, and refuses a name git can't create", async () => {
  const app = await setUp(({ repo }) => localRepository(repo).then(() => {}));
  const templates = (branch: string) =>
    app.call("POST", "/api/plugins/handoff/handoffs/templates", {
      prompt: "{{item.title}}",
      title: "{{item.title}}",
      branch,
    });

  // As a worktree Ajour makes: an empty branch never means the main folder.
  await templates("");
  const unnamed = await app.handOff("4821", "No branch name", {
    toolId: "own",
  });
  expect(unnamed.status, JSON.stringify(unnamed.body)).toBe(200);
  expect(app.calls()).toMatchObject([{ branch: "aj-4821", source: "main" }]);
  // An item without a key gets the name its worktree's folder would get:
  // from the item's id.
  const keyless = await app.handOff("", "Made by hand", {
    toolId: "own",
    workItemId: "work_item_1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed",
  });
  expect(keyless.status, JSON.stringify(keyless.body)).toBe(200);
  expect(app.calls().at(-1)).toMatchObject({
    branch: "aj-1b9d6bcd",
    source: "main",
  });

  await templates("HEAD");
  const refused = await app.handOff("4822", "Named HEAD", { toolId: "own" });
  expect(refused.status).toBe(409);
  expect(refused.body.error).toContain("not a valid git branch");
  expect(app.calls()).toHaveLength(2);
});
