import { existsSync } from "node:fs";
import {
  chmod,
  mkdir,
  readdir,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeAll, afterAll, expect, it, vi } from "vitest";
import { pluginProcessPackageKey } from "./plugin-package.ts";
import {
  cleanUpWorktreeApps,
  cloneBehindOrigin,
  commit,
  eventsNamed,
  git,
  gitSays,
  localRepository,
  newRepository,
  samePath,
  setUp,
  useHermeticGit,
} from "./test-support/handoff-worktree-harness.ts";

/*
 * Hand-off worktrees (#860), through the hand-off routes: an in-process fake
 * tool plugin, a temporary folder, and a real git repository in it running
 * real git. Nothing fakes git. The tests read what the user and the tool can
 * observe: the worktree on disk, its branch, and the folder the tool was
 * started in.
 *
 * Two things are replaced. The launch of a detached or terminal command
 * records where it would start, so no program starts. And one test makes
 * the lookup of `git` on PATH find nothing, for a computer without git.
 */
const launched = vi.hoisted(() => [] as { args: string[]; cwd: string }[]);
vi.mock("./process-launch.ts", async (actual) => ({
  ...(await actual<typeof import("./process-launch.ts")>()),
  launchProcess: async (plan: { args: string[] }, cwd: string) => {
    launched.push({ args: plan.args, cwd });
  },
}));
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
  launched.length = 0;
  gitOnPath.missing = false;
  await cleanUpWorktreeApps();
});

it("hands off in a new worktree on a new branch from the remote's default branch, fetched first, and starts the tool there", async () => {
  let remote!: Awaited<ReturnType<typeof cloneBehindOrigin>>;
  const app = await setUp(async ({ root, repo }) => {
    remote = await cloneBehindOrigin(root, repo);
  });
  await app.allowProcesses();
  const headBefore = git(app.repo, "rev-parse", "HEAD");

  const started = await app.handOff(
    "4821",
    "Week grid: keyboard editing of cells launch",
  );

  expect(started.status, JSON.stringify(started.body)).toBe(200);
  const branch = "4821-week-grid-keyboard-editing-of-cells-launch";
  expect(started.body).toMatchObject({
    folderId: app.folder.id,
    branch,
    worktree: {
      name: "aj-4821",
      branch,
      source: "origin/main",
      repositoryFolderId: app.folder.id,
      projectId: "p",
      workItemId: "item-4821",
      itemKey: "4821",
    },
  });
  const worktree = started.body.worktree!;
  expect(started.body.worktreeId).toBe(worktree.id);
  expect(started.body).not.toHaveProperty("sourceStale");

  // On disk: the worktree, on its new branch, at the commit only the remote
  // had, with no upstream.
  const folder = app.worktreeFolder("aj-4821");
  expect(existsSync(folder)).toBe(true);
  expect(git(folder, "branch", "--show-current")).toBe(branch);
  expect(git(folder, "rev-parse", "HEAD")).toBe(remote.second);
  expect(gitSays(folder, "rev-parse", "--abbrev-ref", "@{upstream}")).toBe(
    false,
  );
  // Git's lock on it lasted only until the tool answered.
  expect(git(app.repo, "worktree", "list", "--porcelain")).not.toContain(
    "locked",
  );

  // The main folder: nothing new in git status, the same branch and commit,
  // and only the local exclude file names `.ajour`.
  expect(git(app.repo, "status", "--porcelain")).toBe("");
  expect(git(app.repo, "branch", "--show-current")).toBe("main");
  expect(git(app.repo, "rev-parse", "HEAD")).toBe(headBefore);
  expect(headBefore).toBe(remote.first);
  expect(
    await readFile(path.join(app.repo, ".git", "info", "exclude"), "utf8"),
  ).toContain("/.ajour/");
  expect(existsSync(path.join(app.repo, ".gitignore"))).toBe(false);

  // The tool received the worktree's own folder id, and was started there.
  // The start also names the repository folder the worktree is in.
  expect(app.calls()).toEqual([
    {
      op: "start",
      tool: "tool",
      folder: { id: worktree.id, name: "aj-4821" },
      branch,
      repositoryFolder: { id: app.folder.id, name: "repo" },
    },
  ]);
  expect(launched).toHaveLength(1);
  expect(samePath(launched[0]!.cwd, folder)).toBe(true);
  expect(samePath(launched[0]!.args.at(-1)!, folder)).toBe(true);

  expect((await app.call("GET", "/api/worktrees")).body).toEqual([worktree]);
  expect((await app.call("GET", "/api/handoffs")).body).toMatchObject([
    { id: started.body.id, worktreeId: worktree.id, folderId: app.folder.id },
  ]);

  // One event per worktree operation, with its outcome and duration, and
  // no branch name, path or file name.
  const [created] = eventsNamed(app.sink, "worktree.create");
  expect(created).toMatchObject({
    kind: "job",
    outcome: "ok",
    worktree: { source: "remote", fetch: "ok" },
  });
  expect(created!.duration_ms).toEqual(expect.any(Number));
  expect(eventsNamed(app.sink, "worktree.create")).toHaveLength(1);
  expect(eventsNamed(app.sink, "worktree.keep")).toMatchObject([
    { outcome: "ok" },
  ]);
  const logged = JSON.stringify(app.sink.events).toLowerCase();
  for (const content of [
    "4821-week",
    "aj-4821",
    "origin/main",
    "readme",
    path.basename(app.root).toLowerCase(),
  ])
    expect(logged).not.toContain(content);
});

it("starts a second hand off of an item in its worktree and creates nothing, and gives another item its own worktree and branch", async () => {
  const app = await setUp(({ repo }) => localRepository(repo).then(() => {}));
  const first = await app.handOff("4821", "Week grid");
  expect(first.status, JSON.stringify(first.body)).toBe(200);
  const worktree = first.body.worktree!;
  expect(worktree).toMatchObject({
    name: "aj-4821",
    branch: "4821-week-grid",
    // Without a remote, the branch checked out in the main folder.
    source: "main",
  });
  const worktreesBefore = git(app.repo, "worktree", "list", "--porcelain");
  const branchesBefore = git(app.repo, "branch", "--list");

  const again = await app.handOff("4821", "Week grid");
  expect(again.status, JSON.stringify(again.body)).toBe(200);
  expect(again.body).toMatchObject({
    worktreeId: worktree.id,
    worktree,
    branch: "4821-week-grid",
  });
  expect(app.calls().map((call) => call.folder)).toEqual([
    { id: worktree.id, name: "aj-4821" },
    { id: worktree.id, name: "aj-4821" },
  ]);
  // In a worktree the item already had, the start names its repository
  // folder too.
  expect(app.calls().map((call) => call.repositoryFolder)).toEqual([
    { id: app.folder.id, name: "repo" },
    { id: app.folder.id, name: "repo" },
  ]);
  expect(git(app.repo, "worktree", "list", "--porcelain")).toBe(
    worktreesBefore,
  );
  expect(git(app.repo, "branch", "--list")).toBe(branchesBefore);
  expect(eventsNamed(app.sink, "worktree.create")).toHaveLength(1);

  const other = await app.handOff("4830", "Export rounding");
  expect(other.body.worktree).toMatchObject({
    name: "aj-4830",
    branch: "4830-export-rounding",
  });
  expect(other.body.worktree!.id).not.toBe(worktree.id);
  expect(git(app.worktreeFolder("aj-4821"), "branch", "--show-current")).toBe(
    "4821-week-grid",
  );
  expect(git(app.worktreeFolder("aj-4830"), "branch", "--show-current")).toBe(
    "4830-export-rounding",
  );
  expect((await app.call("GET", "/api/worktrees")).body).toHaveLength(2);
  expect(git(app.repo, "status", "--porcelain")).toBe("");
});

it("hands off into a worktree a tool switched to another branch, and tells the tool the branch it is on now, or none when detached", async () => {
  const app = await setUp(({ repo }) => localRepository(repo).then(() => {}));
  const first = await app.handOff("4821", "Week grid");
  expect(first.status, JSON.stringify(first.body)).toBe(200);
  const worktree = first.body.worktree!;
  const folder = app.worktreeFolder("aj-4821");
  // A tool made a branch of its own in the worktree.
  git(folder, "switch", "--quiet", "-c", "fix/x");

  const switched = await app.handOff("4821", "Week grid");

  expect(switched.status, JSON.stringify(switched.body)).toBe(200);
  expect(switched.body).toMatchObject({
    worktreeId: worktree.id,
    branch: "fix/x",
  });
  expect(app.calls().at(-1)).toMatchObject({
    folder: { id: worktree.id, name: "aj-4821" },
    branch: "fix/x",
  });

  // On no branch: the tool is told none, and the handoff records none.
  git(folder, "checkout", "--quiet", "--detach");
  const detached = await app.handOff("4821", "Week grid");

  expect(detached.status, JSON.stringify(detached.body)).toBe(200);
  expect(detached.body.worktreeId).toBe(worktree.id);
  expect(detached.body).not.toHaveProperty("branch");
  expect(app.calls().at(-1)).toMatchObject({
    folder: { id: worktree.id, name: "aj-4821" },
    branch: null,
  });
  // Ajour made nothing new, and the record keeps the branch it made.
  expect(eventsNamed(app.sink, "worktree.create")).toHaveLength(1);
  expect((await app.call("GET", "/api/worktrees")).body).toMatchObject([
    { id: worktree.id, branch: "4821-week-grid" },
  ]);
});

it("starts a new worktree from the main folder's branch when a tag has the same name", async () => {
  const app = await setUp(async ({ repo }) => {
    await localRepository(repo);
    // Git's short name for the branch is then `heads/main`.
    git(repo, "tag", "main");
  });

  const started = await app.handOff("15", "Tagged");

  expect(started.status, JSON.stringify(started.body)).toBe(200);
  expect(started.body.worktree).toMatchObject({
    name: "aj-15",
    branch: "15-tagged",
    source: "main",
  });
  expect(git(app.worktreeFolder("aj-15"), "rev-parse", "HEAD")).toBe(
    git(app.repo, "rev-parse", "refs/heads/main"),
  );
});

it("gives a folder name or a branch name that is taken -2", async () => {
  const app = await setUp(async ({ repo }) => {
    await localRepository(repo);
    // Both names are taken before Ajour looks: a folder and a branch.
    await mkdir(path.join(repo, ".ajour", "worktrees", "aj-77"), {
      recursive: true,
    });
    git(repo, "branch", "77-fix-login");
  });
  const taken = git(app.repo, "rev-parse", "77-fix-login");

  const started = await app.handOff("77", "Fix login");

  expect(started.status, JSON.stringify(started.body)).toBe(200);
  expect(started.body.worktree).toMatchObject({
    name: "aj-77-2",
    branch: "77-fix-login-2",
  });
  expect(git(app.worktreeFolder("aj-77-2"), "branch", "--show-current")).toBe(
    "77-fix-login-2",
  );
  // What held the names is as it was.
  expect(git(app.repo, "rev-parse", "77-fix-login")).toBe(taken);
  expect(eventsNamed(app.sink, "worktree.create")).toMatchObject([
    { outcome: "ok", worktree: { name_suffix: 2, branch_suffix: 2 } },
  ]);
});

it("names the worktree of an item without a key after the item's id, so two such items never share a name", async () => {
  const app = await setUp(({ repo }) => localRepository(repo).then(() => {}));
  // Items made by hand have no key. Their ids are the window's.
  const one = "work_item_1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed";
  const two = "work_item_7c2a40e1-0d3f-4c58-8f4e-2f6f0a9b1c3d";

  const first = await app.handOff("", "Manual one", { workItemId: one });
  const second = await app.handOff("", "Manual two", { workItemId: two });

  expect(first.status, JSON.stringify(first.body)).toBe(200);
  expect(second.status, JSON.stringify(second.body)).toBe(200);
  expect(first.body.worktree).toMatchObject({ name: "aj-1b9d6bcd" });
  expect(second.body.worktree).toMatchObject({ name: "aj-7c2a40e1" });
  expect(existsSync(app.worktreeFolder("aj-1b9d6bcd"))).toBe(true);
  expect(existsSync(app.worktreeFolder("aj-7c2a40e1"))).toBe(true);

  // A `-2` still means a second worktree of the same item. With an empty
  // branch template its branch gets the folder's name.
  await app.call("POST", "/api/plugins/handoff/handoffs/templates", {
    prompt: "{{item.title}}",
    title: "{{item.title}}",
    branch: "",
  });
  const again = await app.handOff("", "Manual one", {
    workItemId: one,
    startIn: { kind: "new" },
  });
  expect(again.status, JSON.stringify(again.body)).toBe(200);
  expect(again.body.worktree).toMatchObject({
    name: "aj-1b9d6bcd-2",
    branch: "aj-1b9d6bcd-2",
    workItemId: one,
  });
});

it("removes the worktree and the branch when the tool refuses the start, so a retry uses the same names", async () => {
  const app = await setUp(({ repo }) => localRepository(repo).then(() => {}));
  const branchesBefore = git(app.repo, "branch", "--list");

  const refused = await app.handOff("12", "refuse this");

  expect(refused).toMatchObject({
    status: 409,
    body: { error: "Tool says no" },
  });
  // The tool was asked in the worktree, which is gone with its branch.
  expect(app.calls()).toMatchObject([
    { op: "start", folder: { name: "aj-12" }, branch: "12-refuse-this" },
  ]);
  expect(existsSync(app.worktreeFolder("aj-12"))).toBe(false);
  expect(git(app.repo, "branch", "--list")).toBe(branchesBefore);
  expect(git(app.repo, "worktree", "list", "--porcelain")).not.toContain(
    "aj-12",
  );
  expect((await app.call("GET", "/api/worktrees")).body).toEqual([]);
  expect((await app.call("GET", "/api/handoffs")).body).toEqual([]);
  expect(eventsNamed(app.sink, "worktree.discard")).toMatchObject([
    { outcome: "ok", worktree: { branch_deleted: true } },
  ]);
  expect(git(app.repo, "status", "--porcelain")).toBe("");

  // The same item again, with a title the tool takes: the first names.
  const retried = await app.handOff("12", "refuse this", {
    promptOverride: "Try again",
    startIn: { kind: "new", branch: "12-refuse-this" },
    item: { key: "12", title: "Accepted", type: "Bug", url: "" },
  });
  expect(retried.status, JSON.stringify(retried.body)).toBe(200);
  expect(retried.body.worktree).toMatchObject({
    name: "aj-12",
    branch: "12-refuse-this",
  });
});

/** What a kept worktree shows: its folder, git's registration, its branch and its record. */
async function expectKept(
  app: Awaited<ReturnType<typeof setUp>>,
  name: string,
  branch: string,
) {
  expect(existsSync(app.worktreeFolder(name))).toBe(true);
  expect(git(app.repo, "worktree", "list", "--porcelain")).toContain(name);
  expect(
    gitSays(app.repo, "show-ref", "--verify", `refs/heads/${branch}`),
  ).toBe(true);
  expect((await app.call("GET", "/api/worktrees")).body).toMatchObject([
    { name, branch },
  ]);
  expect((await app.call("GET", "/api/handoffs")).body).toEqual([]);
  expect(eventsNamed(app.sink, "worktree.discard")).toEqual([]);
}

it("keeps the worktree, and records no handoff, when the tool says it may have started there", async () => {
  const app = await setUp(({ repo }) => localRepository(repo).then(() => {}));

  const answer = await app.handOff("12", "maybe");

  expect(answer).toMatchObject({
    status: 409,
    body: {
      error:
        "Tool may have started. Ajour kept the worktree aj-12 because the tool may have started there.",
    },
  });
  await expectKept(app, "aj-12", "12-maybe");
  expect(
    eventsNamed(app.sink, "handoff.start").find(
      (event) => (event as { kind?: string }).kind === "request",
    ),
  ).toMatchObject({ outcome: "refused", handoff: { may_have_started: true } });
});

it("keeps the worktree, and records no handoff, when the start timed out", async () => {
  const app = await setUp(({ repo }) => localRepository(repo).then(() => {}), {
    pluginRequestTimeoutMs: 300,
  });

  const answer = await app.handOff("12", "wait");
  // The fake tool goes on until go.txt is there: let it finish.
  await writeFile(path.join(app.root, "go.txt"), "");

  expect(answer.status).toBe(409);
  expect(answer.body.error).toMatch(
    /timed out while handling startHandoff\. Ajour kept the worktree aj-12 because the tool may have started there\.$/,
  );
  await expectKept(app, "aj-12", "12-wait");
});

it("keeps the worktree, and records no handoff, when the user turns the plugin off while the start runs", async () => {
  const app = await setUp(({ repo }) => localRepository(repo).then(() => {}));

  const pending = app.handOff("12", "wait");
  // The tool has the start: it may already have launched its job.
  // The plugin's worker can take seconds to start on a loaded machine.
  await vi.waitFor(
    () => expect(app.calls().some((call) => call.op === "start")).toBe(true),
    { timeout: 10_000 },
  );
  const off = await app.call("POST", "/api/plugins/handoff/activation", {
    enabled: false,
  });
  const answer = await pending;
  await writeFile(path.join(app.root, "go.txt"), "");

  expect(off.status).toBe(200);
  expect(answer.status).toBe(409);
  expect(answer.body.error).toMatch(
    /Ajour kept the worktree aj-12 because the tool may have started there\.$/,
  );
  await expectKept(app, "aj-12", "12-wait");
});

it("keeps the worktree, and records no handoff, when the tool's answer to the start fails validation", async () => {
  const app = await setUp(({ repo }) => localRepository(repo).then(() => {}));

  const answer = await app.handOff("12", "garbled");

  expect(answer.status).toBe(409);
  expect(answer.body.error).toMatch(
    /Ajour kept the worktree aj-12 because the tool may have started there\.$/,
  );
  await expectKept(app, "aj-12", "12-garbled");
});

it("names the repository folder in a worktree's start, so a terminal the tool opens before it refuses still has its folder", async () => {
  const app = await setUp(({ repo }) => localRepository(repo).then(() => {}));
  await app.allowProcesses();

  // The tool won't run in a folder the user never trusted. It opens a
  // terminal for them to answer its prompt, then refuses the start.
  const refused = await app.handOff("13", "untrusted folder");

  expect(refused).toMatchObject({
    status: 409,
    body: { error: "Trust the folder in the terminal, then hand off again" },
  });
  expect(app.calls()).toEqual([
    {
      op: "start",
      tool: "tool",
      folder: { id: expect.any(String), name: "aj-13" },
      branch: "13-untrusted-folder",
      repositoryFolder: { id: app.folder.id, name: "repo" },
    },
  ]);
  // The refusal took the worktree back.
  expect(existsSync(app.worktreeFolder("aj-13"))).toBe(false);
  expect((await app.call("GET", "/api/worktrees")).body).toEqual([]);
  // The terminal opened in the repository folder, which is still there:
  // the user's answer in it covers the retry's worktree.
  expect(launched).toHaveLength(1);
  expect(samePath(launched[0]!.cwd, app.repo)).toBe(true);
  expect(samePath(launched[0]!.args.at(-1)!, app.repo)).toBe(true);
  expect(existsSync(launched[0]!.cwd)).toBe(true);
});

it("never removes a folder or a branch another program made under the worktree's names while it was being made", async () => {
  // The other program is a git hook: once Ajour's new branch exists, it
  // takes the folder Ajour means to use, if nothing holds it, and puts a
  // file there. It stands for anything that writes between two git calls.
  const app = await setUp(async ({ repo }) => {
    await localRepository(repo);
    const theirs = path
      .join(repo, ".ajour", "worktrees", "aj-90")
      .replaceAll("\\", "/");
    const hook = path.join(repo, ".git", "hooks", "reference-transaction");
    await writeFile(
      hook,
      `#!/bin/sh\nif [ "$1" = committed ] && [ ! -e '${theirs}' ]; then\n  mkdir -p '${theirs}' && echo theirs > '${theirs}/theirs.txt'\nfi\n`,
    );
    await chmod(hook, 0o755);
  });

  const started = await app.handOff("90", "Mine first");

  // Ajour made the folder before the branch, so the hook found it held and
  // took nothing: the hand off started there.
  expect(started.status, JSON.stringify(started.body)).toBe(200);
  expect(started.body.worktree).toMatchObject({ name: "aj-90" });
  const folder = app.worktreeFolder("aj-90");
  expect(git(folder, "branch", "--show-current")).toBe("90-mine-first");
  expect(existsSync(path.join(folder, "theirs.txt"))).toBe(false);
  // Had it lost the folder, the start would have been refused with the
  // other program's folder and file left in place. Either way nothing of
  // another program is removed.
  expect(eventsNamed(app.sink, "worktree.create")).toMatchObject([
    { outcome: "ok" },
  ]);
});

it("removes nothing when another folder holds the worktree's name at rollback, and says so in its event", async () => {
  const app = await setUp(({ repo }) => localRepository(repo).then(() => {}));

  // The tool refuses, after something replaced the worktree's folder.
  const refused = await app.handOff("93", "swap then refuse");

  expect(refused).toMatchObject({
    status: 409,
    body: { error: "Tool says no" },
  });
  // The folder that holds the name now is not Ajour's: it stays whole, and
  // so does the one that was moved away.
  const folder = app.worktreeFolder("aj-93");
  expect(await readFile(path.join(folder, "theirs.txt"), "utf8")).toBe(
    "theirs",
  );
  expect(existsSync(`${folder}-moved`)).toBe(true);
  expect(eventsNamed(app.sink, "worktree.discard")).toMatchObject([
    { outcome: "refused", outcome_reason: "folder_changed" },
  ]);
  expect((await app.call("GET", "/api/worktrees")).body).toEqual([]);
});

it("leaves another program's worktree whole when it was registered in the folder Ajour reserved", async () => {
  // The other program is a git hook: once Ajour's new branch exists, it
  // adds its own worktree, on its own branch, in the folder Ajour made for
  // the item, and writes a file there. Ajour's own add then fails.
  const app = await setUp(async ({ root, repo }) => {
    await localRepository(repo);
    git(repo, "branch", "theirs");
    const slashes = (value: string) => value.replaceAll("\\", "/");
    const folder = slashes(path.join(repo, ".ajour", "worktrees", "aj-95"));
    const once = slashes(path.join(root, "taken"));
    const hook = path.join(repo, ".git", "hooks", "reference-transaction");
    await writeFile(
      hook,
      [
        "#!/bin/sh",
        '[ "$1" = committed ] || exit 0',
        `[ -e '${once}' ] && exit 0`,
        `: > '${once}'`,
        "unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE",
        `cd '${slashes(repo)}' || exit 0`,
        `git worktree add --quiet '${folder}' theirs >/dev/null 2>&1 &&`,
        `  echo theirs > '${folder}/theirs.txt'`,
        "exit 0",
        "",
      ].join("\n"),
    );
    await chmod(hook, 0o755);
  });

  const refused = await app.handOff("95", "Folder taken");

  expect(refused.status).toBe(409);
  expect(app.calls()).toEqual([]);
  // The other worktree is as its program left it: registered, on its
  // branch, with its untracked file.
  const folder = app.worktreeFolder("aj-95");
  expect(await readFile(path.join(folder, "theirs.txt"), "utf8")).toBe(
    "theirs\n",
  );
  expect(git(folder, "branch", "--show-current")).toBe("theirs");
  expect(git(folder, "status", "--porcelain")).toBe("?? theirs.txt");
  expect(git(app.repo, "worktree", "list", "--porcelain")).toContain(
    "branch refs/heads/theirs",
  );
  // The branch Ajour made for the item is gone: nothing had it checked out.
  expect(gitSays(app.repo, "rev-parse", "--verify", "95-folder-taken")).toBe(
    false,
  );
  expect((await app.call("GET", "/api/worktrees")).body).toEqual([]);
  expect(eventsNamed(app.sink, "worktree.create")).toMatchObject([
    {
      outcome: "refused",
      outcome_reason: "folder_changed",
      worktree: { rolled_back: false },
    },
  ]);
});

it("leaves no worktree registered when git adds it and then fails, so a retry gets the same name", async () => {
  const app = await setUp(({ repo }) => localRepository(repo).then(() => {}));
  // Git checks the worktree out, registers and locks it, then fails on
  // the repository's own hook.
  const hook = path.join(app.repo, ".git", "hooks", "post-checkout");
  await writeFile(hook, "#!/bin/sh\nexit 1\n");
  await chmod(hook, 0o755);

  const refused = await app.handOff("94", "Hook fails");

  expect(refused.status).toBe(409);
  expect(app.calls()).toEqual([]);
  expect(existsSync(app.worktreeFolder("aj-94"))).toBe(false);
  expect(git(app.repo, "worktree", "list", "--porcelain")).not.toContain(
    "aj-94",
  );
  expect(git(app.repo, "branch", "--list")).toBe("* main");
  expect(eventsNamed(app.sink, "worktree.create")).toMatchObject([
    { outcome: "error", worktree: { rolled_back: true } },
  ]);

  await rm(hook);
  const retried = await app.handOff("94", "Hook fails");
  expect(retried.status, JSON.stringify(retried.body)).toBe(200);
  expect(retried.body.worktree).toMatchObject({
    name: "aj-94",
    branch: "94-hook-fails",
  });
});

// Not on Windows: the hook's shell there gives `$!` a pid of its own
// emulation layer, which the test can't end, and a background child does
// not inherit the hook's output the same way.
it.skipIf(process.platform === "win32")(
  "finishes a hand off when a hook's background child keeps git's output open after git exits",
  async () => {
    const app = await setUp(({ repo }) => localRepository(repo).then(() => {}));
    // The hook starts a child that inherits its output and outlives it, as
    // a file watcher or an indexer a hook launches does. Git exits at once,
    // and its output stays open for as long as the child runs.
    const pidFile = path.join(app.root, "sleep.pid");
    const hook = path.join(app.repo, ".git", "hooks", "post-checkout");
    await writeFile(
      hook,
      `#!/bin/sh\nsleep 30 &\necho $! > "${pidFile}"\nexit 0\n`,
    );
    await chmod(hook, 0o755);

    try {
      const before = Date.now();
      const started = await app.handOff("96", "Hook leaves a child");
      const took = Date.now() - before;

      expect(started.status, JSON.stringify(started.body)).toBe(200);
      expect(started.body.worktree).toMatchObject({ name: "aj-96" });
      expect(existsSync(app.worktreeFolder("aj-96"))).toBe(true);
      // The hook ran, and its child still holds the output.
      expect(existsSync(pidFile)).toBe(true);
      // Far from the child's 30 seconds: git's exit settles the call.
      expect(took).toBeLessThan(10_000);
      // The repository's lock was let go: the next operation runs at once.
      const next = await app.call("POST", "/api/worktrees/status", {
        workItemId: "item-96",
      });
      expect(next.status).toBe(200);
      expect(eventsNamed(app.sink, "worktree.create")).toMatchObject([
        { outcome: "ok" },
      ]);
    } finally {
      // The child is the hook's, so Ajour leaves it. The test ends it.
      const pid = Number(await readFile(pidFile, "utf8").catch(() => ""));
      if (pid > 0)
        try {
          process.kill(pid, "SIGKILL");
        } catch {
          /* It already ended. */
        }
    }
  },
  40_000,
);

it("keeps .ajour out of git status when the repository's .gitignore ignores everything but folders", async () => {
  const app = await setUp(async ({ repo }) => {
    await newRepository(repo);
    // A committed .gitignore outranks info/exclude, and re-includes .ajour.
    await writeFile(path.join(repo, ".gitignore"), "*\n!*/\n");
    await writeFile(path.join(repo, "README.md"), "one\n");
    git(repo, "add", "--force", "--", ".gitignore", "README.md");
    git(repo, "commit", "--quiet", "-m", "first");
  });

  const started = await app.handOff("12", "Ignored");

  expect(started.status, JSON.stringify(started.body)).toBe(200);
  expect(existsSync(app.worktreeFolder("aj-12"))).toBe(true);
  expect(git(app.repo, "status", "--porcelain")).toBe("");
  expect(
    await readFile(path.join(app.repo, ".ajour", ".gitignore"), "utf8"),
  ).toBe("*\n");
});

it("leaves a .gitignore already in .ajour as it is", async () => {
  const app = await setUp(async ({ repo }) => {
    await localRepository(repo);
    await mkdir(path.join(repo, ".ajour"));
    await writeFile(path.join(repo, ".ajour", ".gitignore"), "worktrees/\n");
  });

  const started = await app.handOff("13", "Own ignore");

  expect(started.status, JSON.stringify(started.body)).toBe(200);
  expect(
    await readFile(path.join(app.repo, ".ajour", ".gitignore"), "utf8"),
  ).toBe("worktrees/\n");
});

it("refuses to make a worktree through a link at .ajour, and writes nothing where it leads", async () => {
  let outside = "";
  const app = await setUp(async ({ root, repo }) => {
    await localRepository(repo);
    outside = path.join(root, "outside");
    await mkdir(outside);
    // A junction on Windows, which needs no special right.
    await symlink(outside, path.join(repo, ".ajour"), "junction");
  });

  const refused = await app.handOff("91", "Through a link");

  expect(refused.status).toBe(409);
  expect(refused.body.error).toBe(
    "Ajour can't use .ajour/worktrees in this repository folder: it must be a real folder, not a link or a file. Remove it, then hand off again.",
  );
  expect(await readdir(outside)).toEqual([]);
  expect(app.calls()).toEqual([]);
  expect(git(app.repo, "branch", "--list")).toBe("* main");
  expect((await app.call("GET", "/api/worktrees")).body).toEqual([]);
  expect(eventsNamed(app.sink, "worktree.create")).toMatchObject([
    { outcome: "refused", outcome_reason: "folder_unavailable" },
  ]);
});

it("runs two starts of one item one after the other, so neither joins a worktree being taken back and they never make two", async () => {
  const app = await setUp(({ repo }) => localRepository(repo).then(() => {}));

  // Both get one branch name, whatever their titles, and name no place.
  await app.call("POST", "/api/plugins/handoff/handoffs/templates", {
    prompt: "{{item.title}}",
    title: "{{item.title}}",
    branch: "92-together",
  });

  // Asked together: the tool refuses one and takes the other.
  const answers = await Promise.all([
    app.handOff("92", "refuse this one"),
    app.handOff("92", "Take this one"),
  ]);

  expect(answers.map((answer) => answer.status).sort()).toEqual([200, 409]);
  const taken = answers.find((answer) => answer.status === 200)!;
  // Whichever ran first, the item has one worktree, under the first names,
  // and the thread that started runs in it.
  expect(taken.body.worktree).toMatchObject({
    name: "aj-92",
    branch: "92-together",
  });
  expect((await app.call("GET", "/api/worktrees")).body).toEqual([
    taken.body.worktree,
  ]);
  expect(git(app.worktreeFolder("aj-92"), "branch", "--show-current")).toBe(
    "92-together",
  );
  expect(existsSync(app.worktreeFolder("aj-92-2"))).toBe(false);
  expect(git(app.repo, "branch", "--list")).not.toContain("92-together-2");
  expect((await app.call("GET", "/api/handoffs")).body).toMatchObject([
    { id: taken.body.id, worktreeId: taken.body.worktree!.id },
  ]);
});

it("starts from the last fetched copy when the fetch fails, and says so", async () => {
  let remote!: Awaited<ReturnType<typeof cloneBehindOrigin>>;
  const app = await setUp(async ({ root, repo }) => {
    remote = await cloneBehindOrigin(root, repo);
    // The remote can't be reached any more.
    git(repo, "remote", "set-url", "origin", path.join(root, "gone.git"));
  });

  const started = await app.handOff("9", "Offline");

  expect(started.status, JSON.stringify(started.body)).toBe(200);
  expect(started.body).toMatchObject({
    sourceStale: true,
    worktree: { name: "aj-9", source: "origin/main" },
  });
  // The commit the clone last fetched, not the one the remote has since.
  expect(git(app.worktreeFolder("aj-9"), "rev-parse", "HEAD")).toBe(
    remote.first,
  );
  expect(eventsNamed(app.sink, "worktree.create")).toMatchObject([
    { outcome: "ok", worktree: { source: "remote", fetch: "failed" } },
  ]);
});

it("refuses the start and names the source when it doesn't resolve", async () => {
  // A repository with no commit: its `main` names nothing yet.
  const app = await setUp(({ repo }) => newRepository(repo));

  const refused = await app.handOff("5", "No commit yet");

  expect(refused.status).toBe(409);
  expect(refused.body.error).toContain("main");
  expect(app.calls()).toEqual([]);
  expect(existsSync(app.worktreeFolder("aj-5"))).toBe(false);
  expect((await app.call("GET", "/api/worktrees")).body).toEqual([]);
  expect(eventsNamed(app.sink, "worktree.create")).toMatchObject([
    { outcome: "refused", outcome_reason: "source_unresolved" },
  ]);
});

it("starts in the main folder, as before worktrees, in a folder that is not a git repository and on a computer without git", async () => {
  const plain = await setUp(async () => {});
  const started = await plain.handOff("31", "Plain folder");
  expect(started.status, JSON.stringify(started.body)).toBe(200);
  // As before worktrees: the tool is told the branch, since a plugin
  // released before `ownWorktree` may need it to start, and the handoff
  // records what the tool was told.
  expect(started.body).toMatchObject({ branch: "31-plain-folder" });
  expect(started.body).not.toHaveProperty("worktree");
  expect(started.body).not.toHaveProperty("worktreeId");
  expect(plain.calls()).toEqual([
    {
      op: "start",
      tool: "tool",
      folder: { id: plain.folder.id, name: "repo" },
      branch: "31-plain-folder",
    },
  ]);
  expect(existsSync(path.join(plain.repo, ".ajour"))).toBe(false);
  expect(eventsNamed(plain.sink, "worktree.create")).toMatchObject([
    { outcome: "refused", outcome_reason: "not_repository" },
  ]);

  const noGit = await setUp(({ repo }) => localRepository(repo).then(() => {}));
  gitOnPath.missing = true;
  const without = await noGit.handOff("32", "No git here");
  expect(without.status, JSON.stringify(without.body)).toBe(200);
  expect(without.body).not.toHaveProperty("worktree");
  expect(noGit.calls()).toMatchObject([
    { folder: { id: noGit.folder.id, name: "repo" }, branch: "32-no-git-here" },
  ]);
  expect(existsSync(path.join(noGit.repo, ".ajour"))).toBe(false);
  expect(eventsNamed(noGit.sink, "worktree.create")).toMatchObject([
    { outcome: "refused", outcome_reason: "git_missing" },
  ]);
});

it("hands off in the main folder, as before worktrees, when Settings say Main folder", async () => {
  const app = await setUp(({ repo }) => localRepository(repo).then(() => {}));
  // A fresh install starts in a new worktree.
  expect(await app.call("GET", "/api/worktrees/settings")).toMatchObject({
    status: 200,
    body: { startIn: "worktree" },
  });
  expect(
    (await app.call("POST", "/api/worktrees/settings", { startIn: "nowhere" }))
      .status,
  ).toBe(400);
  expect(
    await app.call("POST", "/api/worktrees/settings", { startIn: "main" }),
  ).toMatchObject({ status: 200, body: { startIn: "main" } });
  // The clean-up rules are untouched by a change of Start in (#864).
  expect((await app.call("GET", "/api/worktrees/settings")).body).toEqual({
    startIn: "main",
    cleanUp: {
      finished: { enabled: true, days: 3 },
      unused: { enabled: false, days: 30 },
    },
  });

  const started = await app.handOff("40", "Main folder please");

  expect(started.status, JSON.stringify(started.body)).toBe(200);
  expect(started.body).toMatchObject({ branch: "40-main-folder-please" });
  expect(started.body).not.toHaveProperty("worktree");
  expect(app.calls()).toEqual([
    {
      op: "start",
      tool: "tool",
      folder: { id: app.folder.id, name: "repo" },
      branch: "40-main-folder-please",
    },
  ]);
  expect(existsSync(path.join(app.repo, ".ajour"))).toBe(false);
  expect(git(app.repo, "branch", "--list")).toBe("* main");
  expect(eventsNamed(app.sink, "worktree.create")).toEqual([]);

  // Chosen for one hand off, Main folder does the same.
  await app.call("POST", "/api/worktrees/settings", { startIn: "worktree" });
  const chosen = await app.handOff("41", "Main folder once", {
    startIn: { kind: "main" },
  });
  expect(chosen.status, JSON.stringify(chosen.body)).toBe(200);
  expect(chosen.body).toMatchObject({ branch: "41-main-folder-once" });
  expect(app.calls().at(-1)).toEqual({
    op: "start",
    tool: "tool",
    folder: { id: app.folder.id, name: "repo" },
    branch: "41-main-folder-once",
  });
});

it("runs a command the user approved for the repository folder in its worktree without asking again", async () => {
  // The approval names the repository folder's id, saved before the server
  // starts, as an Always answer in the main folder would have saved it.
  const app = await setUp(async ({ repo, plugin, storage }) => {
    await localRepository(repo);
    const folder = await storage.addRepositoryFolder("p", repo, "repo");
    await storage.saveCommandPolicy("handoff", {
      identity: JSON.stringify([
        "1.0.0",
        await pluginProcessPackageKey(plugin),
        true,
      ]),
      signed: false,
      mode: "always-ask",
      approvals: [
        {
          id: "approval",
          executable: "git",
          argv: ["rev-parse", "--show-toplevel"],
          cwdFolder: folder.id,
        },
      ],
    });
  });
  await app.allowProcesses();

  // No window answers asks in this test: an ask would refuse the start.
  const started = await app.handOff("60", "probe the folder");

  expect(started.status, JSON.stringify(started.body)).toBe(200);
  expect(started.body.worktree).toMatchObject({ name: "aj-60" });
  const top = (started.body.native as { top: string }).top;
  expect(samePath(await realpath(top), app.worktreeFolder("aj-60"))).toBe(true);
  expect(
    app.sink.events.filter(
      (event) =>
        event.name === "plugin.process" &&
        (event as { process?: { decided_by?: string } }).process?.decided_by ===
          "remembered",
    ),
  ).toHaveLength(1);
});

it("reaches the tool with the worktree's folder for state reads, Open and Close", async () => {
  const app = await setUp(({ repo }) => localRepository(repo).then(() => {}));
  await app.allowProcesses();
  const started = await app.handOff("70", "Follow me");
  expect(started.status, JSON.stringify(started.body)).toBe(200);
  const worktree = started.body.worktree!;
  const id = started.body.id;

  expect((await app.call("POST", `/api/handoffs/${id}/refresh`)).status).toBe(
    200,
  );
  expect(app.calls().at(-1)).toEqual({ op: "read", folders: [worktree.id] });

  // Open runs the tool's resume command in a terminal, in the worktree.
  expect(await app.call("POST", `/api/handoffs/${id}/open`)).toMatchObject({
    status: 200,
    body: { opened: "terminal" },
  });
  expect(launched).toHaveLength(1);
  expect(samePath(launched[0]!.cwd, app.worktreeFolder("aj-70"))).toBe(true);

  expect((await app.call("POST", `/api/handoffs/${id}/close`)).status).toBe(
    200,
  );
  expect(app.calls().at(-1)).toEqual({ op: "close", folder: worktree.id });
});

it("forgets a removed repository folder's worktrees and leaves their files and handoffs", async () => {
  const app = await setUp(({ repo }) => localRepository(repo).then(() => {}));
  const started = await app.handOff("80", "Keep my files");
  expect(started.body.worktree).toMatchObject({ name: "aj-80" });

  expect(
    (
      await app.call(
        "DELETE",
        `/api/projects/p/repository-folders/${app.folder.id}`,
      )
    ).status,
  ).toBe(200);

  expect((await app.call("GET", "/api/worktrees")).body).toEqual([]);
  expect(existsSync(app.worktreeFolder("aj-80"))).toBe(true);
  expect(git(app.repo, "branch", "--list")).toContain("80-keep-my-files");
  const [handoff] = (await app.call("GET", "/api/handoffs"))
    .body as unknown as Record<string, unknown>[];
  expect(handoff).toMatchObject({ id: started.body.id });
  expect(handoff).not.toHaveProperty("worktreeId");
});

/*
 * Where one hand off starts (#861): the start request's Start in choice,
 * the branches a new worktree can start from, and the source Ajour
 * remembers for a repository folder.
 */

/** `repo` with one commit on `main` and a second one on `develop`. */
async function repositoryWithDevelop(repo: string) {
  const main = await localRepository(repo);
  git(repo, "checkout", "--quiet", "-b", "develop");
  await writeFile(path.join(repo, "README.md"), "develop\n");
  const develop = commit(repo, "README.md", "on develop");
  git(repo, "checkout", "--quiet", "main");
  return { main, develop };
}

const branchesRoute = (app: { folder: { id: string } }) =>
  `/api/projects/p/repository-folders/${app.folder.id}/branches`;

it("starts where the request says: a new worktree beside the item's first, the main folder, or the earlier worktree it names", async () => {
  const app = await setUp(({ repo }) => localRepository(repo).then(() => {}));
  const first = await app.handOff("4821", "Week grid");
  expect(first.body.worktree, JSON.stringify(first.body)).toMatchObject({
    name: "aj-4821",
    branch: "4821-week-grid",
  });

  // New worktree, for an item that has aj-4821, makes aj-4821-2.
  const second = await app.handOff("4821", "Week grid", {
    startIn: { kind: "new" },
  });
  expect(second.status, JSON.stringify(second.body)).toBe(200);
  expect(second.body.worktree).toMatchObject({
    name: "aj-4821-2",
    branch: "4821-week-grid-2",
  });
  expect(git(app.worktreeFolder("aj-4821-2"), "branch", "--show-current")).toBe(
    "4821-week-grid-2",
  );

  // Main folder, though the item has worktrees and Settings say New worktree.
  const main = await app.handOff("4821", "Week grid", {
    startIn: { kind: "main" },
  });
  expect(main.status, JSON.stringify(main.body)).toBe(200);
  expect(main.body).not.toHaveProperty("worktree");
  expect(main.body).not.toHaveProperty("worktreeId");
  expect(app.calls().at(-1)).toMatchObject({
    folder: { id: app.folder.id, name: "repo" },
  });

  // The first worktree, though the second is newer.
  const firstId = first.body.worktree!.id;
  const again = await app.handOff("4821", "Week grid", {
    startIn: { kind: "worktree", worktreeId: firstId },
  });
  expect(again.status, JSON.stringify(again.body)).toBe(200);
  expect(again.body.worktree).toMatchObject({ id: firstId, name: "aj-4821" });
  expect(app.calls().at(-1)).toMatchObject({
    folder: { id: firstId, name: "aj-4821" },
    branch: "4821-week-grid",
  });
  expect((await app.call("GET", "/api/worktrees")).body).toHaveLength(2);

  // The request event says which place was asked for, and nothing else.
  expect(
    eventsNamed(app.sink, "handoff.start")
      .map((event) => event.handoff?.start_in)
      .filter(Boolean),
  ).toEqual(["default", "new", "main", "worktree"]);

  // A worktree whose folder is gone, or another item's, starts nothing.
  await rm(app.worktreeFolder("aj-4821-2"), { recursive: true, force: true });
  const calls = app.calls().length;
  const gone = await app.handOff("4821", "Week grid", {
    startIn: { kind: "worktree", worktreeId: second.body.worktree!.id },
  });
  expect(gone.status).toBe(409);
  expect(gone.body.error).toContain("no longer available");
  const others = await app.handOff("4830", "Another item", {
    startIn: { kind: "worktree", worktreeId: firstId },
  });
  expect(others.status).toBe(409);
  expect(app.calls()).toHaveLength(calls);
});

it("starts a new worktree's branch from the source picked, and offers it first for the folder's next hand off", async () => {
  let commits!: Awaited<ReturnType<typeof repositoryWithDevelop>>;
  const app = await setUp(async ({ repo }) => {
    commits = await repositoryWithDevelop(repo);
  });
  expect((await app.call("GET", branchesRoute(app))).body).toMatchObject({
    source: "main",
  });

  const started = await app.handOff("7", "From develop", {
    startIn: { kind: "new", source: "develop" },
  });

  expect(started.status, JSON.stringify(started.body)).toBe(200);
  expect(started.body.worktree).toMatchObject({
    name: "aj-7",
    source: "develop",
  });
  expect(git(app.worktreeFolder("aj-7"), "rev-parse", "HEAD")).toBe(
    commits.develop,
  );

  // The folder's next hand off names no source, and starts from develop.
  const next = await app.handOff("8", "The next one");
  expect(next.body.worktree, JSON.stringify(next.body)).toMatchObject({
    source: "develop",
  });
  expect(git(app.worktreeFolder("aj-8"), "rev-parse", "HEAD")).toBe(
    commits.develop,
  );
  const listed = (await app.call("GET", branchesRoute(app)))
    .body as unknown as { source: string; branches: { name: string }[] };
  expect(listed.source).toBe("develop");
  expect(listed.branches[0]!.name).toBe("develop");
  expect(
    eventsNamed(app.sink, "worktree.create").map(
      (event) => event.worktree?.source_choice,
    ),
  ).toEqual(["picked", "remembered"]);
});

it("remembers no source from a start that failed, and refuses a source the repository doesn't have", async () => {
  const app = await setUp(async ({ repo }) => {
    await repositoryWithDevelop(repo);
  });

  const refused = await app.handOff("12", "refuse this", {
    startIn: { kind: "new", source: "develop" },
  });
  expect(refused.status).toBe(409);
  expect((await app.call("GET", branchesRoute(app))).body).toMatchObject({
    source: "main",
  });

  const unknown = await app.handOff("13", "No such source", {
    startIn: { kind: "new", source: "release/9" },
  });
  expect(unknown.status).toBe(409);
  expect(unknown.body.error).toContain("release/9");
  expect(app.calls()).toHaveLength(1);
  expect(existsSync(app.worktreeFolder("aj-13"))).toBe(false);
  expect(eventsNamed(app.sink, "worktree.create").at(-1)).toMatchObject({
    outcome: "refused",
    outcome_reason: "source_unresolved",
  });

  // A name git could read as an option never reaches git.
  const unsafe = await app.handOff("14", "Unsafe source", {
    startIn: { kind: "new", source: "--upload-pack=x" },
  });
  expect(unsafe.status).toBe(400);
});

it("names a new worktree's branch as asked, and after its folder when the branch template fills empty", async () => {
  const app = await setUp(({ repo }) => localRepository(repo).then(() => {}));

  const named = await app.handOff("9", "Spike", {
    startIn: { kind: "new", branch: "9-spike" },
  });
  expect(named.status, JSON.stringify(named.body)).toBe(200);
  expect(named.body.worktree).toMatchObject({
    name: "aj-9",
    branch: "9-spike",
  });
  expect(git(app.worktreeFolder("aj-9"), "branch", "--show-current")).toBe(
    "9-spike",
  );
  expect(app.calls().at(-1)).toMatchObject({ branch: "9-spike" });

  // An empty branch no longer means the main folder.
  const saved = await app.call(
    "POST",
    "/api/plugins/handoff/handoffs/templates",
    { prompt: "{{item.title}}", title: "{{item.title}}", branch: "" },
  );
  expect(saved.status, JSON.stringify(saved.body)).toBe(200);
  const unnamed = await app.handOff("10", "No template branch");
  expect(unnamed.status, JSON.stringify(unnamed.body)).toBe(200);
  expect(unnamed.body.worktree).toMatchObject({
    name: "aj-10",
    branch: "aj-10",
  });
  expect(git(app.worktreeFolder("aj-10"), "branch", "--show-current")).toBe(
    "aj-10",
  );

  const invalid = await app.handOff("11", "Bad name", {
    startIn: { kind: "new", branch: "bad branch" },
  });
  expect(invalid.status).toBe(400);
  expect(existsSync(app.worktreeFolder("aj-11"))).toBe(false);
  // Git takes no branch named HEAD, so the route refuses it before git does.
  const head = await app.handOff("11", "Named HEAD", {
    startIn: { kind: "new", branch: "HEAD" },
  });
  expect(head.status).toBe(400);
  expect(app.calls()).toHaveLength(2);
});

it("joins an item's worktree when the branch template fills to an invalid name, which only a new worktree would use", async () => {
  const app = await setUp(({ repo }) => localRepository(repo).then(() => {}));
  const first = await app.handOff("70", "Good template");
  expect(first.status, JSON.stringify(first.body)).toBe(200);
  await app.call("POST", "/api/plugins/handoff/handoffs/templates", {
    prompt: "{{item.title}}",
    title: "{{item.title}}",
    branch: "bad name",
  });

  // The worktree's own branch is the one the tool works on.
  const named = await app.handOff("70", "Good template", {
    startIn: { kind: "worktree", worktreeId: first.body.worktree!.id },
  });
  const byDefault = await app.handOff("70", "Good template");
  expect(named.status, JSON.stringify(named.body)).toBe(200);
  expect(byDefault.status, JSON.stringify(byDefault.body)).toBe(200);
  expect(app.calls().at(-1)).toMatchObject({
    folder: { name: "aj-70" },
    branch: "70-good-template",
  });

  // A start that would create the template's branch is still refused,
  // whatever makes the name one git won't take.
  for (const branch of [
    "bad name",
    "@",
    "a..b",
    "-option",
    "a.lock",
    "a/.hidden",
    "a/",
    "a\\b",
  ]) {
    await app.call("POST", "/api/plugins/handoff/handoffs/templates", {
      prompt: "{{item.title}}",
      title: "{{item.title}}",
      branch,
    });
    const refused = await app.handOff("70", "Good template", {
      startIn: { kind: "new" },
    });
    expect(refused.status, branch).toBe(400);
    expect(refused.body.error).toContain("branch template");
  }
  expect(app.calls()).toHaveLength(3);
  expect(await readdir(path.join(app.repo, ".ajour", "worktrees"))).toEqual([
    "aj-70",
  ]);

  // The main folder creates no branch, so the template doesn't stop it. A
  // name git wouldn't take is left out of the start, never sent.
  const inMain = await app.handOff("70", "Good template", {
    startIn: { kind: "main" },
  });
  expect(inMain.status, JSON.stringify(inMain.body)).toBe(200);
  expect(app.calls().at(-1)).toMatchObject({
    folder: { name: "repo" },
    branch: null,
  });
  // Nothing was sent, so nothing is recorded.
  expect(inMain.body).not.toHaveProperty("branch");
});

it("starts in the main folder when the branch template fills to an invalid name and the folder gets no worktree", async () => {
  const templates = {
    prompt: "{{item.title}}",
    title: "{{item.title}}",
    branch: "two words",
  };
  // A folder that is not a git checkout. Settings say New worktree, so the
  // start only falls back to the main folder once git has been asked.
  const plain = await setUp(async () => {});
  await plain.call(
    "POST",
    "/api/plugins/handoff/handoffs/templates",
    templates,
  );
  const started = await plain.handOff("33", "Plain folder");
  expect(started.status, JSON.stringify(started.body)).toBe(200);
  expect(started.body).not.toHaveProperty("worktree");
  // No branch is created there, and the invalid name is neither sent nor
  // recorded.
  expect(started.body).not.toHaveProperty("branch");
  expect(plain.calls()).toEqual([
    {
      op: "start",
      tool: "tool",
      folder: { id: plain.folder.id, name: "repo" },
      branch: null,
    },
  ]);

  // A computer without git.
  const noGit = await setUp(({ repo }) => localRepository(repo).then(() => {}));
  await noGit.call(
    "POST",
    "/api/plugins/handoff/handoffs/templates",
    templates,
  );
  gitOnPath.missing = true;
  const without = await noGit.handOff("34", "No git here");
  expect(without.status, JSON.stringify(without.body)).toBe(200);
  expect(noGit.calls()).toMatchObject([{ op: "start", branch: null }]);
});

it("lists branches from local refs only, and leaves asking the remote for its default branch to the start", async () => {
  const app = await setUp(async ({ root, repo }) => {
    await cloneBehindOrigin(root, repo);
    // A clone that doesn't know the remote's default branch, as one made
    // with `git init` and `git remote add` is.
    git(repo, "remote", "set-head", "origin", "--delete");
  });

  const listed = (await app.call("GET", branchesRoute(app)))
    .body as unknown as {
    source?: string;
    current: string;
    branches: { name: string; default?: true }[];
  };
  // Nothing local says which branch is the remote's default, so the list
  // names no source: the start will ask the remote, and may get another
  // branch than the main folder's.
  expect(listed).not.toHaveProperty("source");
  expect(listed.current).toBe("main");
  expect(listed.branches.some((branch) => branch.default)).toBe(false);
  expect(listed.branches.map((branch) => branch.name).sort()).toEqual([
    "main",
    "origin/main",
  ]);

  // The start still asks the remote, and starts from its default branch.
  const started = await app.handOff("80", "Asks the remote");
  expect(started.body.worktree, JSON.stringify(started.body)).toMatchObject({
    source: "origin/main",
  });
});

it("answers a branch listing that failed without git's words, in the response and in the event", async () => {
  const app = await setUp(({ repo }) => localRepository(repo).then(() => {}));
  // Git stops on this line and quotes it, with the file's path.
  await writeFile(
    path.join(app.repo, ".git", "packed-refs"),
    "MARKED-LINE refs/heads/marked-branch\n",
  );

  const failed = await app.call("GET", branchesRoute(app));

  expect(failed.status).toBe(409);
  expect(failed.body.error).toBe("Ajour couldn't list this folder's branches.");
  const [event] = eventsNamed(app.sink, "worktree.list_branches");
  expect(event).toMatchObject({
    outcome: "error",
    outcome_reason: "git_failed",
  });
  expect(JSON.stringify(event)).not.toMatch(/MARKED|marked-branch|packed-refs/);
});

it("lists a repository folder's local and remote branches, with the remote's default branch, the main folder's branch and the default source", async () => {
  const app = await setUp(async ({ root, repo }) => {
    await cloneBehindOrigin(root, repo);
    // A release branch on the remote, and develop checked out in the folder.
    git(
      path.join(root, "seed"),
      "push",
      "--quiet",
      "origin",
      "main:release/1.4",
    );
    git(repo, "fetch", "--quiet", "origin");
    git(repo, "checkout", "--quiet", "-b", "develop");
  });

  const listed = await app.call("GET", branchesRoute(app));

  expect(listed.status, JSON.stringify(listed.body)).toBe(200);
  const body = listed.body as unknown as {
    current: string;
    source: string;
    branches: { name: string }[];
  };
  expect(body).not.toHaveProperty("unavailable");
  expect(body.current).toBe("develop");
  expect(body.source).toBe("origin/main");
  // The default source first, then the main folder's branch.
  expect(body.branches.slice(0, 2)).toEqual([
    { name: "origin/main", remote: true, default: true },
    { name: "develop", remote: false, current: true },
  ]);
  expect(
    body.branches
      .slice(2)
      .map((branch) => branch.name)
      .sort(),
  ).toEqual(["main", "origin/release/1.4"]);
  // The list reads refs only: nothing was fetched, made or checked out.
  expect(existsSync(path.join(app.repo, ".ajour"))).toBe(false);
  expect(eventsNamed(app.sink, "worktree.list_branches")).toMatchObject([
    { outcome: "ok", worktree: { count: 4 } },
  ]);
});

it("says why a folder gets no worktree: it is not a git repository, or this computer has no git", async () => {
  const plain = await setUp(async () => {});
  expect((await plain.call("GET", branchesRoute(plain))).body).toEqual({
    unavailable: "not_repository",
    branches: [],
  });

  const noGit = await setUp(({ repo }) => localRepository(repo).then(() => {}));
  gitOnPath.missing = true;
  expect((await noGit.call("GET", branchesRoute(noGit))).body).toEqual({
    unavailable: "git_missing",
    branches: [],
  });

  const missing = await noGit.call(
    "GET",
    "/api/projects/p/repository-folders/no-such-folder/branches",
  );
  expect(missing.status).toBe(409);
});

it("lists an item's worktrees whose folder is still on disk, newest first", async () => {
  const app = await setUp(({ repo }) => localRepository(repo).then(() => {}));
  const first = await app.handOff("4821", "Week grid");
  const second = await app.handOff("4821", "Week grid", {
    startIn: { kind: "new" },
  });
  await app.handOff("4830", "Another item");
  const ofItem = () =>
    app.call("POST", "/api/worktrees/item", {
      projectId: "p",
      workItemId: "item-4821",
    });

  expect((await ofItem()).body).toEqual([
    second.body.worktree,
    first.body.worktree,
  ]);

  await rm(app.worktreeFolder("aj-4821-2"), { recursive: true, force: true });
  expect((await ofItem()).body).toEqual([first.body.worktree]);
});

it("keeps Ask each time in Settings, and makes a new worktree for a start that names no place", async () => {
  const app = await setUp(({ repo }) => localRepository(repo).then(() => {}));
  expect(
    await app.call("POST", "/api/worktrees/settings", { startIn: "ask" }),
  ).toMatchObject({ status: 200, body: { startIn: "ask" } });
  expect((await app.call("GET", "/api/worktrees/settings")).body).toMatchObject(
    { startIn: "ask" },
  );

  // The window always names the place under Ask each time. Another caller
  // that doesn't gets what a fresh install does.
  const started = await app.handOff("60", "Asked nowhere");
  expect(started.status, JSON.stringify(started.body)).toBe(200);
  expect(started.body.worktree).toMatchObject({ name: "aj-60" });
});

it("starts in the main folder with a branch template that fills to HEAD where no branch is created, and refuses it where one would be", async () => {
  const templates = {
    prompt: "{{item.title}}",
    title: "{{item.title}}",
    branch: "HEAD",
  };
  // A folder that is not a git repository: nothing is created there.
  const plain = await setUp(async () => {});
  await plain.call(
    "POST",
    "/api/plugins/handoff/handoffs/templates",
    templates,
  );
  const started = await plain.handOff("90", "Plain folder");
  expect(started.status, JSON.stringify(started.body)).toBe(200);
  expect(started.body).not.toHaveProperty("worktree");
  expect(plain.calls()).toMatchObject([
    { folder: { id: plain.folder.id, name: "repo" }, branch: "HEAD" },
  ]);

  // A git repository: git would refuse to create a branch named HEAD.
  const app = await setUp(({ repo }) => localRepository(repo).then(() => {}));
  await app.call("POST", "/api/plugins/handoff/handoffs/templates", templates);
  const refused = await app.handOff("91", "In a repository");
  expect(refused.status).toBe(409);
  expect(refused.body.error).toContain("not a valid git branch");
  expect(app.calls()).toEqual([]);
  expect(existsSync(app.worktreeFolder("aj-91"))).toBe(false);
});
