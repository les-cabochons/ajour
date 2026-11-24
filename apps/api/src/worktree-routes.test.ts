import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, mkdir, rename, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import {
  MAX_PREVIEW_FILES,
  type ListedWorktree,
  type WorktreeDeletePreview,
} from "../../../packages/shared/worktrees.ts";
import {
  cleanUpWorktreeApps,
  cloneBehindOrigin,
  commit,
  eventsNamed,
  git,
  gitSays,
  localRepository,
  samePath,
  setUp,
  useHermeticGit,
} from "./test-support/handoff-worktree-harness.ts";

/*
 * What the user does with a worktree after the hand off (#862), through the
 * worktree routes: its status on a list, the preview of a delete, the
 * delete, Forget, and opening its folder. Also the threads a tool lists in
 * a worktree. An in-process fake tool plugin, a temporary folder and a real
 * git repository running real git: nothing fakes git. The tests read what
 * the user can observe: the files on disk, git's own listing of worktrees
 * and branches, and what the routes answer.
 *
 * Two launches are replaced, so no program starts: a tool's command and the
 * terminal app. Each records the folder it would start in.
 */
const launched = vi.hoisted(
  () => [] as { what: "command" | "terminal"; cwd: string; app?: string }[],
);
/** What starting the terminal app fails with, when a test sets one. */
const terminalFailure = vi.hoisted(() => ({ error: undefined as unknown }));
vi.mock("./process-launch.ts", async (actual) => ({
  ...(await actual<typeof import("./process-launch.ts")>()),
  launchProcess: async (_plan: unknown, cwd: string) => {
    launched.push({ what: "command", cwd });
  },
  launchTerminalIn: async (
    cwd: string,
    _env: unknown,
    terminal: { app: string },
  ) => {
    if (terminalFailure.error) throw terminalFailure.error;
    launched.push({ what: "terminal", cwd, app: terminal.app });
  },
}));

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
  terminalFailure.error = undefined;
  await cleanUpWorktreeApps();
});

type App = Awaited<ReturnType<typeof setUp>>;

const local = (serverOptions?: Parameters<typeof setUp>[1]) =>
  setUp(({ repo }) => localRepository(repo).then(() => {}), serverOptions);

/** Hands the item off, and answers the worktree Ajour made for it. */
async function handOffInWorktree(app: App, key: string, title: string) {
  const started = await app.handOff(key, title);
  expect(started.status, JSON.stringify(started.body)).toBe(200);
  return { handoffId: started.body.id, worktree: started.body.worktree! };
}

const statusOf = async (app: App, key: string) =>
  (
    await app.call("POST", "/api/worktrees/status", {
      projectId: "p",
      workItemId: `item-${key}`,
    })
  ).body as unknown as ListedWorktree[];

const previewOf = async (app: App, worktreeId: string) => {
  const answer = await app.call(
    "GET",
    `/api/worktrees/${worktreeId}/delete-preview`,
  );
  expect(answer.status, JSON.stringify(answer.body)).toBe(200);
  return answer.body as unknown as WorktreeDeletePreview;
};

/**
 * Deletes a worktree as the window does: with the fingerprint of the
 * preview the dialog showed (#857), read just before unless one is given.
 */
const deleteWorktree = async (
  app: App,
  worktreeId: string,
  deleteBranch = false,
  fingerprint?: string,
) => {
  const preview = fingerprint
    ? undefined
    : await app.call("GET", `/api/worktrees/${worktreeId}/delete-preview`);
  return app.call("POST", `/api/worktrees/${worktreeId}/delete`, {
    deleteBranch,
    fingerprint:
      fingerprint ??
      (preview?.status === 200
        ? (preview.body as unknown as WorktreeDeletePreview).fingerprint
        : "none"),
  });
};

const handoffsOf = async (app: App) =>
  (await app.call("GET", "/api/handoffs")).body as unknown as Record<
    string,
    unknown
  >[];

/** The folders git lists as worktrees of the repository. */
const registered = (repo: string) =>
  git(repo, "worktree", "list", "--porcelain")
    .split("\n")
    .filter((line) => line.startsWith("worktree "))
    .map((line) => line.slice("worktree ".length));

const hasBranch = (repo: string, branch: string) =>
  gitSays(repo, "show-ref", "--verify", "--quiet", `refs/heads/${branch}`);

it("lists an item's worktree as clean, then with the number of files git status reports once files change", async () => {
  const app = await local();
  const { worktree } = await handOffInWorktree(app, "4821", "Week grid");
  const folder = app.worktreeFolder("aj-4821");

  const [clean, ...others] = await statusOf(app, "4821");

  expect(others).toEqual([]);
  expect(clean).toMatchObject({
    worktree: { id: worktree.id, name: "aj-4821" },
    status: { state: "clean" },
  });
  expect(samePath(clean!.path!, folder)).toBe(true);

  // One tracked file changed and one new file: two lines in git status.
  await writeFile(path.join(folder, "README.md"), "changed\n");
  await writeFile(path.join(folder, "notes.md"), "new\n");
  expect(git(folder, "status", "--porcelain").split("\n")).toHaveLength(2);

  expect((await statusOf(app, "4821"))[0]!.status).toEqual({
    state: "changed",
    changes: 2,
  });
  // Another item's list holds none of it, and the item alone names its own.
  expect(await statusOf(app, "other")).toEqual([]);
  expect(
    (
      await app.call("POST", "/api/worktrees/status", {
        workItemId: "item-4821",
      })
    ).body,
  ).toEqual(await statusOf(app, "4821"));
  // The events count, and hold no name, branch, path or file.
  const events = eventsNamed(app.sink, "worktree.status");
  expect(events.at(-2)).toMatchObject({
    outcome: "ok",
    worktree: { scope: "item", count: 1, changed: 1, missing: 0, pruned: 0 },
  });
  expect(JSON.stringify(events)).not.toMatch(
    /aj-4821|week-grid|notes\.md|README|handoff-worktree-/,
  );
});

it("lists every worktree of a project, or of this computer, newest first", async () => {
  const app = await local();
  const first = await handOffInWorktree(app, "1", "First");
  const second = await handOffInWorktree(app, "2", "Second");

  const ofProject = (
    await app.call("POST", "/api/worktrees/status", { projectId: "p" })
  ).body as unknown as ListedWorktree[];
  const all = (await app.call("POST", "/api/worktrees/status", {}))
    .body as unknown as ListedWorktree[];

  expect(ofProject.map((one) => one.worktree.id)).toEqual([
    second.worktree.id,
    first.worktree.id,
  ]);
  expect(all).toEqual(ofProject);
  expect(
    (await app.call("POST", "/api/worktrees/status", { projectId: "other" }))
      .body,
  ).toEqual([]);
});

it("lists none of a repository folder's worktrees once the folder is removed from the project, and leaves them on disk", async () => {
  const app = await local();
  const { worktree } = await handOffInWorktree(app, "80", "Keep my files");
  expect(await statusOf(app, "80")).toHaveLength(1);

  expect(
    (
      await app.call(
        "DELETE",
        `/api/projects/p/repository-folders/${app.folder.id}`,
      )
    ).status,
  ).toBe(200);

  expect(await statusOf(app, "80")).toEqual([]);
  expect((await app.call("POST", "/api/worktrees/status", {})).body).toEqual(
    [],
  );
  // Ajour forgot it and removed nothing: the folder, git's worktree and
  // the branch are all there.
  const folder = app.worktreeFolder("aj-80");
  expect(existsSync(path.join(folder, "README.md"))).toBe(true);
  expect(registered(app.repo).some((one) => samePath(one, folder))).toBe(true);
  expect(hasBranch(app.repo, worktree.branch)).toBe(true);
  // It is no longer Ajour's to delete.
  expect((await deleteWorktree(app, worktree.id)).status).toBe(404);
  expect(existsSync(folder)).toBe(true);
});

it("previews a delete with exactly the files git status reports, and none it ignores", async () => {
  const app = await local();
  const { worktree } = await handOffInWorktree(app, "4821", "Week grid");
  const folder = app.worktreeFolder("aj-4821");
  await writeFile(path.join(folder, "old name.txt"), "kept\n");
  commit(folder, "old name.txt", "a file to rename");
  // A change of each kind: modified, renamed, staged, untracked, a new
  // folder, and an ignored file that git status leaves out.
  await writeFile(path.join(folder, "README.md"), "changed\n");
  git(folder, "mv", "old name.txt", "new name.txt");
  await writeFile(path.join(folder, "staged.ts"), "export {};\n");
  git(folder, "add", "--", "staged.ts");
  await writeFile(path.join(folder, ".gitignore"), "*.log\n");
  await writeFile(path.join(folder, "debug.log"), "ignored\n");
  await mkdir(path.join(folder, "scratch"));
  await writeFile(path.join(folder, "scratch", "a.txt"), "a\n");
  await writeFile(path.join(folder, "scratch", "b.txt"), "b\n");

  const preview = await previewOf(app, worktree.id);

  const byPath = <T extends { path: string }>(list: T[]) =>
    [...list].sort((a, b) => a.path.localeCompare(b.path));
  expect(byPath(preview.files)).toEqual(
    byPath([
      { code: " M", path: "README.md" },
      { code: "R ", path: "new name.txt", from: "old name.txt" },
      { code: "A ", path: "staged.ts" },
      { code: "??", path: ".gitignore" },
      { code: "??", path: "scratch/" },
    ]),
  );
  expect(preview.moreFiles).toBe(0);
  // As many as git status prints lines.
  expect(
    execFileSync("git", ["status", "--porcelain"], {
      cwd: folder,
      encoding: "utf8",
    })
      .split("\n")
      .filter(Boolean),
  ).toHaveLength(preview.files.length);
  expect(preview.listed).toMatchObject({
    worktree: { id: worktree.id },
    status: { state: "changed", changes: 5 },
  });
  // The preview changed nothing.
  expect(existsSync(path.join(folder, "debug.log"))).toBe(true);
  expect(registered(app.repo).some((one) => samePath(one, folder))).toBe(true);
  // The file list went to the window only: the event counts it.
  const [event] = eventsNamed(app.sink, "worktree.delete_preview");
  expect(event).toMatchObject({
    outcome: "ok",
    worktree: { state: "changed", files: 5, running: 1 },
  });
  expect(JSON.stringify(app.sink.events)).not.toMatch(
    /new name|staged\.ts|scratch|README\.md|debug\.log/,
  );
});

it("warns in the delete preview only about a thread that is Working or Needs you in the worktree", async () => {
  const app = await local();
  const { handoffId, worktree } = await handOffInWorktree(app, "7", "Busy");
  // A thread of the same item in the main folder never counts.
  const inMain = await app.handOff("7", "Busy", { startIn: { kind: "main" } });
  expect(inMain.body).not.toHaveProperty("worktreeId");
  const running = async () => (await previewOf(app, worktree.id)).running;
  const becomes = async (state: string) => {
    await writeFile(path.join(app.root, "state.txt"), state);
    expect(
      (await app.call("POST", `/api/handoffs/${handoffId}/refresh`)).status,
    ).toBe(200);
  };

  // A thread just started is Working.
  expect(await running()).toEqual([
    { pluginId: "handoff", toolId: "tool", state: "working" },
  ]);

  await becomes("needs-you");
  expect(await running()).toEqual([
    { pluginId: "handoff", toolId: "tool", state: "needs-you" },
  ]);

  for (const state of ["ready", "done", "failed"]) {
    await becomes(state);
    expect(await running(), state).toEqual([]);
  }
});

it("deletes a worktree with its uncommitted files, keeps its branch, and keeps its handoffs, which still open their threads", async () => {
  const app = await local();
  await app.allowProcesses();
  const { handoffId, worktree } = await handOffInWorktree(app, "4821", "Grid");
  const folder = app.worktreeFolder("aj-4821");
  await writeFile(path.join(folder, "README.md"), "uncommitted\n");
  await writeFile(path.join(folder, "notes.md"), "untracked\n");

  const deleted = await deleteWorktree(app, worktree.id);

  expect(deleted.status, JSON.stringify(deleted.body)).toBe(200);
  expect(deleted.body).toMatchObject({ branchDeleted: false });
  // On disk and in git: the folder and the worktree are gone, the branch stays.
  expect(existsSync(folder)).toBe(false);
  expect(registered(app.repo)).toHaveLength(1);
  expect(hasBranch(app.repo, worktree.branch)).toBe(true);
  // In Ajour: no worktree, and the handoff stays without one.
  expect(await statusOf(app, "4821")).toEqual([]);
  expect((await app.call("GET", "/api/worktrees")).body).toEqual([]);
  const kept = await handoffsOf(app);
  expect(deleted.body.handoffs).toEqual(kept);
  expect(kept).toHaveLength(1);
  expect(kept[0]).toMatchObject({ id: handoffId, folderId: app.folder.id });
  expect(kept[0]).not.toHaveProperty("worktreeId");
  // Open still reaches the thread, from the repository folder now: the
  // resume command's folder argument named the worktree, and follows.
  expect(kept[0]!.resume).toEqual({
    command: "resume",
    args: { thread: "t1", folder: app.folder.id },
  });
  expect(
    await app.call("POST", `/api/handoffs/${handoffId}/open`),
  ).toMatchObject({ status: 200, body: { opened: "terminal" } });
  expect(samePath(launched.at(-1)!.cwd, app.repo)).toBe(true);
  // A later hand off of the item gets a new worktree under the same name.
  expect((await app.handOff("4821", "Grid")).body.worktree).toMatchObject({
    name: "aj-4821",
  });
  expect(eventsNamed(app.sink, "worktree.delete")).toMatchObject([
    {
      outcome: "ok",
      worktree: { delete_branch: false, branch_deleted: false, missing: false },
    },
  ]);
  expect(JSON.stringify(eventsNamed(app.sink, "worktree.delete"))).not.toMatch(
    /aj-4821|grid|notes\.md|handoff-worktree-/,
  );
});

it("refuses a delete when git status changed since the preview, also beyond the files it lists, and removes nothing", async () => {
  const app = await local();
  const { worktree } = await handOffInWorktree(app, "4821", "Grid");
  const folder = app.worktreeFolder("aj-4821");
  const before = await previewOf(app, worktree.id);
  expect(before.files).toEqual([]);

  // A tool writes a file after the dialog opened.
  await writeFile(path.join(folder, "late.md"), "written later\n");
  const refused = await deleteWorktree(
    app,
    worktree.id,
    true,
    before.fingerprint,
  );

  expect(refused.status).toBe(409);
  expect(refused.body).toEqual({
    error:
      "aj-4821 changed since Ajour showed what it holds. Check it again before you delete it.",
    changed: true,
  });
  expect(existsSync(path.join(folder, "late.md"))).toBe(true);
  expect(registered(app.repo).some((one) => samePath(one, folder))).toBe(true);
  expect(hasBranch(app.repo, worktree.branch)).toBe(true);
  expect(await statusOf(app, "4821")).toHaveLength(1);
  expect(eventsNamed(app.sink, "worktree.delete").at(-1)).toMatchObject({
    outcome: "refused",
    outcome_reason: "worktree_changed",
  });

  // More files than the preview lists: a change past the list counts too.
  for (let index = 0; index <= MAX_PREVIEW_FILES; index++)
    await writeFile(
      path.join(folder, `f${String(index).padStart(3, "0")}.txt`),
      "",
    );
  const many = await previewOf(app, worktree.id);
  expect(many.moreFiles).toBeGreaterThan(0);
  await rename(path.join(folder, "late.md"), path.join(folder, "later.md"));
  expect(
    (await deleteWorktree(app, worktree.id, false, many.fingerprint)).status,
  ).toBe(409);
  expect(existsSync(folder)).toBe(true);

  // With the status the user saw last, the delete goes.
  const deleted = await deleteWorktree(
    app,
    worktree.id,
    false,
    (await previewOf(app, worktree.id)).fingerprint,
  );
  expect(deleted.status, JSON.stringify(deleted.body)).toBe(200);
  expect(existsSync(folder)).toBe(false);
});

it("refuses a delete when a file appeared inside an untracked folder since the preview, and removes nothing", async () => {
  const app = await local();
  const { worktree } = await handOffInWorktree(app, "4821", "Grid");
  const folder = app.worktreeFolder("aj-4821");
  await mkdir(path.join(folder, "notes"));
  await writeFile(path.join(folder, "notes", "one.md"), "one\n");
  const before = await previewOf(app, worktree.id);
  // Git status shows the new folder as one line.
  expect(before.files).toHaveLength(1);

  // A tool writes a second file in it after the dialog opened.
  await writeFile(path.join(folder, "notes", "two.md"), "two\n");
  const refused = await deleteWorktree(
    app,
    worktree.id,
    false,
    before.fingerprint,
  );

  expect(refused.status).toBe(409);
  expect(refused.body).toMatchObject({ changed: true });
  expect(existsSync(path.join(folder, "notes", "two.md"))).toBe(true);
  expect(registered(app.repo).some((one) => samePath(one, folder))).toBe(true);
});

it("refuses a delete when the worktree got a commit since the preview, and keeps the worktree and its branch", async () => {
  const app = await local();
  const { worktree } = await handOffInWorktree(app, "4821", "Grid");
  const folder = app.worktreeFolder("aj-4821");
  const before = await previewOf(app, worktree.id);
  // The repository has no remote: its one commit is on none.
  expect(before.branch).toMatchObject({ unpushedCommits: 1 });

  // A tool commits after the dialog opened: git status stays clean.
  await writeFile(path.join(folder, "late.md"), "committed later\n");
  const late = commit(folder, "late.md", "late");
  const refused = await deleteWorktree(
    app,
    worktree.id,
    true,
    before.fingerprint,
  );

  expect(refused.status).toBe(409);
  expect(refused.body).toMatchObject({ changed: true });
  expect(existsSync(folder)).toBe(true);
  expect(git(app.repo, "rev-parse", `refs/heads/${worktree.branch}`)).toBe(
    late,
  );
  expect(eventsNamed(app.sink, "worktree.delete").at(-1)).toMatchObject({
    outcome: "refused",
    outcome_reason: "worktree_changed",
  });
});

it("counts the branch's commits that are on no remote, pushed or not, and deletes the branch with the worktree when asked", async () => {
  const app = await setUp(async ({ root, repo }) => {
    await cloneBehindOrigin(root, repo);
  });
  const { worktree } = await handOffInWorktree(app, "30", "Count commits");
  const folder = app.worktreeFolder("aj-30");
  const unpushed = async () =>
    (await previewOf(app, worktree.id)).branch?.unpushedCommits;
  const commitFile = async (name: string) => {
    await writeFile(path.join(folder, name), `${name}\n`);
    commit(folder, name, `add ${name}`);
  };

  // Fresh from the remote's branch: nothing of its own yet.
  expect((await previewOf(app, worktree.id)).branch).toEqual({
    name: worktree.branch,
    unpushedCommits: 0,
  });

  // Never pushed: both of its commits are on no remote.
  await commitFile("one.txt");
  await commitFile("two.txt");
  expect(await unpushed()).toBe(2);

  // Pushed, then one more commit: only the new one is on no remote.
  git(folder, "push", "--quiet", "origin", worktree.branch);
  expect(await unpushed()).toBe(0);
  await commitFile("three.txt");
  expect(await unpushed()).toBe(1);

  const deleted = await deleteWorktree(app, worktree.id, true);

  expect(deleted.status, JSON.stringify(deleted.body)).toBe(200);
  expect(deleted.body).toMatchObject({ branchDeleted: true });
  expect(existsSync(folder)).toBe(false);
  expect(hasBranch(app.repo, worktree.branch)).toBe(false);
  // The main folder's branch and the remote's copy are untouched.
  expect(git(app.repo, "branch", "--show-current")).toBe("main");
  expect(
    gitSays(
      app.repo,
      "show-ref",
      "--verify",
      "--quiet",
      `refs/remotes/origin/${worktree.branch}`,
    ),
  ).toBe(true);
  expect(eventsNamed(app.sink, "worktree.delete")).toMatchObject([
    { worktree: { delete_branch: true, branch_deleted: true } },
  ]);
});

it("counts every commit of the branch in a repository that has no remote", async () => {
  const app = await local();
  const { worktree } = await handOffInWorktree(app, "31", "No remote");
  const folder = app.worktreeFolder("aj-31");
  await writeFile(path.join(folder, "one.txt"), "one\n");
  commit(folder, "one.txt", "add one");

  // The repository's first commit and the branch's own.
  expect((await previewOf(app, worktree.id)).branch).toEqual({
    name: worktree.branch,
    unpushedCommits: 2,
  });
});

it("shows a worktree whose folder was removed by hand as missing, drops git's registration of it and of no other, and forgets it", async () => {
  const app = await local();
  const { handoffId, worktree } = await handOffInWorktree(app, "90", "Gone");
  const folder = app.worktreeFolder("aj-90");
  // The user's own worktree, whose folder is away too: it is not Ajour's.
  const theirs = path.join(app.root, "theirs");
  git(app.repo, "worktree", "add", "--quiet", "-b", "theirs", theirs);
  await rm(folder, { recursive: true, force: true });
  await rm(theirs, { recursive: true, force: true });

  // Forget is for a worktree that is gone: asked first on one that is not.
  const [listed] = await statusOf(app, "90");

  expect(listed).toMatchObject({
    worktree: { id: worktree.id },
    status: { state: "missing" },
  });
  expect(samePath(listed!.path!, folder)).toBe(true);
  const left = registered(app.repo);
  expect(left.some((one) => samePath(one, folder))).toBe(false);
  expect(left.some((one) => samePath(one, theirs))).toBe(true);
  expect(eventsNamed(app.sink, "worktree.status").at(-1)).toMatchObject({
    worktree: { count: 1, missing: 1, pruned: 1 },
  });
  // A missing worktree is no place to start in.
  expect(
    (
      await app.call("POST", "/api/worktrees/item", {
        projectId: "p",
        workItemId: "item-90",
      })
    ).body,
  ).toEqual([]);

  const forgotten = await app.call(
    "POST",
    `/api/worktrees/${worktree.id}/forget`,
  );

  expect(forgotten.status, JSON.stringify(forgotten.body)).toBe(200);
  expect(await statusOf(app, "90")).toEqual([]);
  const kept = await handoffsOf(app);
  expect(forgotten.body.handoffs).toEqual(kept);
  expect(kept[0]).toMatchObject({ id: handoffId });
  expect(kept[0]).not.toHaveProperty("worktreeId");
  // The branch holds the work that was committed, and stays.
  expect(hasBranch(app.repo, worktree.branch)).toBe(true);
  expect(eventsNamed(app.sink, "worktree.forget")).toMatchObject([
    { outcome: "ok" },
  ]);
});

it("refuses to forget a worktree that is still on disk, and removes nothing", async () => {
  const app = await local();
  const { worktree } = await handOffInWorktree(app, "91", "Still here");

  const refused = await app.call(
    "POST",
    `/api/worktrees/${worktree.id}/forget`,
  );

  expect(refused.status).toBe(409);
  expect(refused.body.error).toBe("aj-91 is still on disk. Delete it instead.");
  expect(existsSync(app.worktreeFolder("aj-91"))).toBe(true);
  expect(await statusOf(app, "91")).toHaveLength(1);
  expect(eventsNamed(app.sink, "worktree.forget")).toMatchObject([
    { outcome: "refused", outcome_reason: "worktree_present" },
  ]);
});

it("deletes a missing worktree's record and registration, and refuses its branch while another worktree has it checked out", async () => {
  const app = await local();
  const { worktree } = await handOffInWorktree(app, "92", "Moved on");
  await rm(app.worktreeFolder("aj-92"), { recursive: true, force: true });
  // The user dropped the registration and took the branch to the main folder.
  git(app.repo, "worktree", "prune");
  git(app.repo, "checkout", "--quiet", worktree.branch);

  const refused = await deleteWorktree(app, worktree.id, true);

  expect(refused.status).toBe(409);
  expect(refused.body.error).toContain(
    `Another worktree has the branch ${worktree.branch} checked out`,
  );
  expect(await statusOf(app, "92")).toHaveLength(1);
  expect(eventsNamed(app.sink, "worktree.delete").at(-1)).toMatchObject({
    outcome: "refused",
    outcome_reason: "branch_in_use",
  });

  const deleted = await deleteWorktree(app, worktree.id);

  expect(deleted.status, JSON.stringify(deleted.body)).toBe(200);
  expect(await statusOf(app, "92")).toEqual([]);
  expect(git(app.repo, "branch", "--show-current")).toBe(worktree.branch);
  expect(eventsNamed(app.sink, "worktree.delete").at(-1)).toMatchObject({
    outcome: "ok",
    worktree: { missing: true, branch_deleted: false },
  });
});

it("refuses a delete that names a path, and one of a worktree Ajour doesn't keep", async () => {
  const app = await local();
  const { worktree } = await handOffInWorktree(app, "40", "Stay");
  const outside = path.join(app.root, "outside");
  await mkdir(outside);
  await writeFile(path.join(outside, "theirs.txt"), "theirs");

  // The route takes a worktree's id and nothing else: no path gets in.
  const withPath = await app.call(
    "POST",
    `/api/worktrees/${worktree.id}/delete`,
    { deleteBranch: false, fingerprint: "none", path: outside },
  );
  const asId = await app.call(
    "POST",
    `/api/worktrees/${encodeURIComponent(outside)}/delete`,
    { deleteBranch: false, fingerprint: "none" },
  );
  const repositoryFolder = await deleteWorktree(app, app.folder.id);

  expect(withPath.status).toBe(400);
  expect(asId.status).toBe(404);
  expect(repositoryFolder.status).toBe(404);
  expect(repositoryFolder.body.error).toBe(
    "This worktree is no longer in Ajour's list.",
  );
  expect(existsSync(path.join(outside, "theirs.txt"))).toBe(true);
  expect(existsSync(app.worktreeFolder("aj-40"))).toBe(true);
  expect(existsSync(path.join(app.repo, "README.md"))).toBe(true);
  expect(await statusOf(app, "40")).toHaveLength(1);
  expect(eventsNamed(app.sink, "worktree.delete").at(-1)).toMatchObject({
    outcome: "refused",
    outcome_reason: "worktree_not_found",
  });
});

it("deletes nothing through a link at .ajour/worktrees, which leads outside the repository folder", async () => {
  const app = await local();
  const { worktree } = await handOffInWorktree(app, "41", "Linked away");
  // The worktrees folder moves outside, and a link takes its place.
  const holder = path.join(app.repo, ".ajour", "worktrees");
  const outside = path.join(app.root, "outside");
  await rename(holder, outside);
  await symlink(outside, holder, "dir");
  await writeFile(path.join(outside, "aj-41", "work.txt"), "work");

  const refused = await deleteWorktree(app, worktree.id, true);

  expect(refused.status).toBe(409);
  expect(refused.body.error).toContain("is a link or a file");
  expect(existsSync(path.join(outside, "aj-41", "work.txt"))).toBe(true);
  expect(hasBranch(app.repo, worktree.branch)).toBe(true);
  expect(eventsNamed(app.sink, "worktree.delete").at(-1)).toMatchObject({
    outcome: "refused",
    outcome_reason: "folder_unavailable",
  });
});

it("leaves in place whatever holds the worktree's name and is not the worktree Ajour made", async () => {
  const app = await local();
  const plain = await handOffInWorktree(app, "42", "Replaced");
  // Another folder took its name.
  const folder = app.worktreeFolder("aj-42");
  await rename(folder, path.join(app.root, "moved"));
  await mkdir(folder);
  await writeFile(path.join(folder, "theirs.txt"), "theirs");

  const replaced = await deleteWorktree(app, plain.worktree.id, true);

  expect(replaced.status).toBe(409);
  expect(replaced.body.error).toBe(
    "Something else than the worktree Ajour made is at aj-42 now, so Ajour left it in place.",
  );
  expect(existsSync(path.join(folder, "theirs.txt"))).toBe(true);
  expect(hasBranch(app.repo, plain.worktree.branch)).toBe(true);
  expect(
    eventsNamed(app.sink, "worktree.delete").map(
      (event) => event.outcome_reason,
    ),
  ).toEqual(["folder_changed"]);
  expect((await app.call("GET", "/api/worktrees")).body).toHaveLength(1);
});

it("deletes a worktree switched to another branch once confirmed, says the branch it is on, and deletes only the recorded branch", async () => {
  const app = await local();
  const { worktree } = await handOffInWorktree(app, "43", "Switched");
  const folder = app.worktreeFolder("aj-43");
  // A tool switched the worktree to a branch of its own.
  git(folder, "switch", "--quiet", "-c", "elsewhere");

  const preview = await previewOf(app, worktree.id);

  expect(preview.switched).toEqual({ branch: "elsewhere" });
  // The box still names the branch Ajour made.
  expect(preview.branch).toMatchObject({ name: worktree.branch });

  const deleted = await deleteWorktree(app, worktree.id, true);

  expect(deleted.status, JSON.stringify(deleted.body)).toBe(200);
  expect(deleted.body).toMatchObject({ branchDeleted: true });
  expect(existsSync(folder)).toBe(false);
  expect(registered(app.repo)).toHaveLength(1);
  expect(hasBranch(app.repo, worktree.branch)).toBe(false);
  // The branch the tool made stays, with its commits.
  expect(hasBranch(app.repo, "elsewhere")).toBe(true);
  expect((await app.call("GET", "/api/worktrees")).body).toEqual([]);

  // Detached, the preview says it is on no branch.
  const other = await handOffInWorktree(app, "44", "Detached");
  git(app.worktreeFolder("aj-44"), "checkout", "--quiet", "--detach");
  expect((await previewOf(app, other.worktree.id)).switched).toEqual({});
});

it("counts the commits only a detached worktree's HEAD holds, which its delete loses", async () => {
  const app = await local();
  const { worktree } = await handOffInWorktree(app, "45", "Detached work");
  const folder = app.worktreeFolder("aj-45");
  git(folder, "checkout", "--quiet", "--detach");
  // A tool commits twice on no branch.
  await writeFile(path.join(folder, "one.md"), "one\n");
  commit(folder, "one.md", "one");
  await writeFile(path.join(folder, "two.md"), "two\n");
  commit(folder, "two.md", "two");

  expect((await previewOf(app, worktree.id)).switched).toEqual({
    commitsOnNoBranch: 2,
  });

  // A branch that holds them now leaves nothing to lose.
  git(folder, "branch", "kept");
  expect((await previewOf(app, worktree.id)).switched).toEqual({});
});

it("refuses a delete when a file the preview listed got more edits since, tracked or untracked", async () => {
  const app = await local();
  const { worktree } = await handOffInWorktree(app, "48", "More edits");
  const folder = app.worktreeFolder("aj-48");
  await writeFile(path.join(folder, "README.md"), "changed\n");
  await writeFile(path.join(folder, "notes.md"), "draft\n");
  const before = await previewOf(app, worktree.id);
  expect(before.files).toHaveLength(2);

  // A tool keeps editing both files: git status prints the same two lines.
  await writeFile(path.join(folder, "README.md"), "changed, and more\n");
  await writeFile(path.join(folder, "notes.md"), "draft, and more\n");
  const refused = await deleteWorktree(
    app,
    worktree.id,
    false,
    before.fingerprint,
  );

  expect(refused.status).toBe(409);
  expect(refused.body).toMatchObject({ changed: true });
  expect(existsSync(path.join(folder, "notes.md"))).toBe(true);
});

it("refuses a delete with its branch when the worktree was already missing at the preview and its branch moved since", async () => {
  const app = await local();
  const { worktree } = await handOffInWorktree(app, "49", "Missing first");
  const folder = app.worktreeFolder("aj-49");
  git(app.repo, "worktree", "remove", folder);
  const before = await previewOf(app, worktree.id);
  expect(before.listed.status).toEqual({ state: "missing" });

  // Another program commits on the branch after the dialog opened.
  git(
    app.repo,
    "worktree",
    "add",
    "--quiet",
    folder + "-other",
    worktree.branch,
  );
  await writeFile(path.join(folder + "-other", "late.md"), "late\n");
  const late = commit(folder + "-other", "late.md", "late");
  git(app.repo, "worktree", "remove", folder + "-other");
  const refused = await deleteWorktree(
    app,
    worktree.id,
    true,
    before.fingerprint,
  );

  expect(refused.status).toBe(409);
  expect(refused.body).toMatchObject({ changed: true });
  expect(git(app.repo, "rev-parse", `refs/heads/${worktree.branch}`)).toBe(
    late,
  );
});

it("refuses a delete with its branch when the worktree got a commit and its folder went since the preview, and keeps the branch", async () => {
  const app = await local();
  const { worktree } = await handOffInWorktree(app, "47", "Gone since");
  const folder = app.worktreeFolder("aj-47");
  const before = await previewOf(app, worktree.id);

  // A tool commits, then removes its own clean worktree through git.
  await writeFile(path.join(folder, "late.md"), "committed later\n");
  const late = commit(folder, "late.md", "late");
  git(app.repo, "worktree", "remove", folder);
  const refused = await deleteWorktree(
    app,
    worktree.id,
    true,
    before.fingerprint,
  );

  expect(refused.status).toBe(409);
  expect(refused.body).toMatchObject({ changed: true });
  expect(git(app.repo, "rev-parse", `refs/heads/${worktree.branch}`)).toBe(
    late,
  );

  // Read again, the preview says the folder is missing, and a delete with
  // its fingerprint goes through.
  const again = await previewOf(app, worktree.id);
  expect(again.listed.status).toEqual({ state: "missing" });
  const deleted = await deleteWorktree(
    app,
    worktree.id,
    false,
    again.fingerprint,
  );
  expect(deleted.status, JSON.stringify(deleted.body)).toBe(200);
  expect(hasBranch(app.repo, worktree.branch)).toBe(true);
});

it("refuses a delete when a detached worktree's commits lost the branch that held them since the preview", async () => {
  const app = await local();
  const { worktree } = await handOffInWorktree(app, "46", "Detached work");
  const folder = app.worktreeFolder("aj-46");
  git(folder, "checkout", "--quiet", "--detach");
  await writeFile(path.join(folder, "one.md"), "one\n");
  commit(folder, "one.md", "one");
  git(folder, "branch", "kept");
  const before = await previewOf(app, worktree.id);
  // The dialog warns of nothing: the branch holds the commit.
  expect(before.switched).toEqual({});

  // Someone deletes that branch in a terminal after the dialog opened.
  // Status, HEAD and Ajour's branch stay the same.
  git(app.repo, "branch", "--quiet", "-D", "kept");
  const refused = await deleteWorktree(
    app,
    worktree.id,
    false,
    before.fingerprint,
  );

  expect(refused.status).toBe(409);
  expect(refused.body).toMatchObject({ changed: true });
  expect(existsSync(folder)).toBe(true);
});

// A folder that can't be written to stops a delete on POSIX only.
it.skipIf(process.platform === "win32")(
  "answers a delete that failed without git's words or a path, in the response and in the event",
  async () => {
    const app = await local();
    const { worktree } = await handOffInWorktree(app, "44", "Held files");
    // Git can't remove a file from a folder nobody may write to. It says
    // so with the file's path.
    const held = path.join(app.worktreeFolder("aj-44"), "held");
    await mkdir(held);
    await writeFile(path.join(held, "marked-file.txt"), "kept");
    await chmod(held, 0o555);
    try {
      const failed = await deleteWorktree(app, worktree.id);

      expect(failed.status).toBe(409);
      expect(failed.body.error).toBe(
        "Ajour couldn't delete this worktree: git failed.",
      );
      expect(existsSync(path.join(held, "marked-file.txt"))).toBe(true);
      // The record stays, so the list still shows what is left on disk.
      expect(await statusOf(app, "44")).toHaveLength(1);
      const event = eventsNamed(app.sink, "worktree.delete").at(-1);
      expect(event).toMatchObject({
        outcome: "error",
        outcome_reason: "git_failed",
      });
      expect(JSON.stringify(event)).not.toMatch(
        /marked-file|held|aj-44|handoff-worktree-/,
      );
    } finally {
      await chmod(held, 0o755);
    }
  },
);

it("asks the tool for threads once per repository folder and once per live worktree of the item, and links one found in a worktree to it", async () => {
  const app = await local();
  const { worktree } = await handOffInWorktree(app, "4821", "Week grid");
  const other = await handOffInWorktree(app, "4900", "Another item");
  // The tool lists by exact folder: this thread exists in the worktree only.
  await writeFile(
    path.join(app.root, "threads.json"),
    JSON.stringify({
      [worktree.id]: [
        {
          threadId: "by-hand",
          native: {},
          title: "[4821] Started by hand",
          updatedAt: 5,
        },
      ],
    }),
  );

  const found = await app.call("POST", "/api/handoffs/threads", {
    projectId: "p",
    workItemId: "item-4821",
    keys: ["4821"],
  });

  expect(found.status, JSON.stringify(found.body)).toBe(200);
  expect(found.body).toEqual({
    offers: [
      {
        pluginId: "handoff",
        toolId: "tool",
        folderId: worktree.id,
        threadId: "by-hand",
        title: "[4821] Started by hand",
        updatedAt: 5,
      },
    ],
  });
  // The item's worktree and the repository folder, and no other item's.
  const listedFolders = app
    .calls()
    .filter((call) => call.op === "list")
    .map((call) => call.folder);
  expect(listedFolders).toEqual([worktree.id, app.folder.id]);
  expect(listedFolders).not.toContain(other.worktree.id);

  const linked = await app.call("POST", "/api/handoffs/adopt", {
    pluginId: "handoff",
    toolId: "tool",
    folderId: worktree.id,
    threadId: "by-hand",
    projectId: "p",
    workItemId: "item-4821",
  });

  // It links like any other: on the repository folder, in the worktree.
  expect(linked.status, JSON.stringify(linked.body)).toBe(200);
  expect(linked.body).toMatchObject({
    threadId: "by-hand",
    workItemId: "item-4821",
    folderId: app.folder.id,
    worktreeId: worktree.id,
  });
  // The tool is asked for its state in the worktree, as for a started one.
  expect(app.calls().at(-1)).toMatchObject({
    op: "read",
    folders: [worktree.id],
  });
});

it("opens a worktree's folder in the terminal app and in the file manager, named by its id", async () => {
  const shown: string[] = [];
  const app = await local({
    terminal: async () => ({ app: "iTerm" }),
    openFolder: async (folder) => {
      shown.push(folder);
    },
  });
  const { worktree } = await handOffInWorktree(app, "50", "Look inside");
  const folder = app.worktreeFolder("aj-50");
  const open = (where: string, id = worktree.id) =>
    app.call("POST", `/api/worktrees/${id}/open`, { in: where });

  expect(await open("terminal")).toMatchObject({ status: 200 });
  expect(await open("files")).toMatchObject({ status: 200 });

  expect(launched).toHaveLength(1);
  expect(launched[0]).toMatchObject({ what: "terminal", app: "iTerm" });
  expect(samePath(launched[0]!.cwd, folder)).toBe(true);
  expect(shown).toHaveLength(1);
  expect(samePath(shown[0]!, folder)).toBe(true);
  // A path is never taken from the request.
  expect(
    (
      await app.call("POST", `/api/worktrees/${worktree.id}/open`, {
        in: "files",
        path: app.root,
      })
    ).status,
  ).toBe(400);
  expect((await open("files", "unknown")).status).toBe(404);

  // Once its folder is gone there is nothing to open.
  await rm(folder, { recursive: true, force: true });
  const gone = await open("terminal");
  expect(gone.status).toBe(409);
  expect(gone.body.error).toBe("The folder of aj-50 is no longer on disk.");
  expect(launched).toHaveLength(1);
  const events = eventsNamed(app.sink, "worktree.open");
  expect(events[0]).toMatchObject({
    outcome: "ok",
    worktree: { in: "terminal", terminal: "iTerm" },
  });
  expect(events.at(-1)).toMatchObject({
    outcome: "refused",
    outcome_reason: "folder_unavailable",
  });
  expect(JSON.stringify(events)).not.toMatch(/aj-50|handoff-worktree-/);
});

it("answers a terminal that failed to start with fixed words and a fixed reason, never the failure's path", async () => {
  const app = await local();
  const { worktree } = await handOffInWorktree(app, "52", "No script");
  // As when the launch script can't be written: the error names its path.
  terminalFailure.error = Object.assign(
    new Error(
      "EACCES: permission denied, open '/private/marked-temp/ajour-terminal-x/launch.command'",
    ),
    { code: "EACCES", path: "/private/marked-temp/ajour-terminal-x" },
  );

  const failed = await app.call("POST", `/api/worktrees/${worktree.id}/open`, {
    in: "terminal",
  });

  expect(failed.status).toBe(500);
  expect(failed.body).toEqual({
    error: "Ajour couldn't open the terminal app.",
  });
  expect(eventsNamed(app.sink, "worktree.open")).toMatchObject([
    { outcome: "error", outcome_reason: "spawn_failed" },
  ]);
  expect(JSON.stringify(app.sink.events)).not.toMatch(
    /marked-temp|launch\.command|EACCES/,
  );
});

it("answers a terminal setting that can't be read as a terminal that failed to start, never with the failure's path", async () => {
  const app = await local({
    // As when the file that keeps the chosen terminal app can't be read.
    terminal: async () => {
      throw Object.assign(
        new Error(
          "EACCES: permission denied, open '/private/marked-settings/terminal.json'",
        ),
        { code: "EACCES", path: "/private/marked-settings/terminal.json" },
      );
    },
  });
  const { worktree } = await handOffInWorktree(app, "53", "No setting");

  const failed = await app.call("POST", `/api/worktrees/${worktree.id}/open`, {
    in: "terminal",
  });

  expect(failed.status).toBe(500);
  expect(failed.body).toEqual({
    error: "Ajour couldn't open the terminal app.",
  });
  expect(launched).toEqual([]);
  expect(eventsNamed(app.sink, "worktree.open")).toMatchObject([
    { outcome: "error", outcome_reason: "spawn_failed" },
  ]);
  expect(JSON.stringify(app.sink.events)).not.toMatch(
    /marked-settings|terminal\.json|EACCES/,
  );
});

it("ends two deletes of one worktree asked at once with one delete and one not found", async () => {
  const app = await local();
  const { worktree } = await handOffInWorktree(app, "45", "Double click");
  await writeFile(
    path.join(app.worktreeFolder("aj-45"), "notes.md"),
    "untracked\n",
  );

  const answers = await Promise.all([
    deleteWorktree(app, worktree.id, true),
    deleteWorktree(app, worktree.id, true),
  ]);

  // The second waited for the first, then found no worktree to delete.
  expect(answers.map((answer) => answer.status).sort()).toEqual([200, 404]);
  expect(answers.find((answer) => answer.status === 404)!.body.error).toBe(
    "This worktree is no longer in Ajour's list.",
  );
  expect(answers.find((answer) => answer.status === 200)!.body).toMatchObject({
    branchDeleted: true,
  });
  expect(existsSync(app.worktreeFolder("aj-45"))).toBe(false);
  expect(hasBranch(app.repo, worktree.branch)).toBe(false);
  expect(
    eventsNamed(app.sink, "worktree.delete")
      .map((event) => event.outcome_reason ?? event.outcome)
      .sort(),
  ).toEqual(["ok", "worktree_not_found"]);
});

it("refuses to show a folder in the file manager without the desktop app, or when it fails", async () => {
  const standalone = await local();
  const failing = await local({
    openFolder: async () => {
      throw new Error("The file manager said /secret/path");
    },
  });
  for (const app of [standalone, failing]) {
    const { worktree } = await handOffInWorktree(app, "51", "No opener");

    const refused = await app.call(
      "POST",
      `/api/worktrees/${worktree.id}/open`,
      { in: "files" },
    );

    expect(refused.status).toBe(409);
    expect(refused.body.error).toBe(
      "Ajour couldn't show this folder in the file manager.",
    );
    expect(eventsNamed(app.sink, "worktree.open")).toMatchObject([
      { outcome: "refused", outcome_reason: "open_failed" },
    ]);
  }
});
