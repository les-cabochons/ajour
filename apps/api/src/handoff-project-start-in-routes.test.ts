import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, afterEach, beforeAll, expect, it } from "vitest";
import {
  cleanUpWorktreeApps,
  eventsNamed,
  localRepository,
  setUp,
  useHermeticGit,
} from "./test-support/handoff-worktree-harness.ts";

/*
 * A project's own Start in (#864), through the routes: it overrides the
 * default of Settings › Worktrees for that project, on this computer. A
 * temporary folder holds a real git repository running real git. Each test
 * reads where the hand off started: the folder the tool was given, and
 * whether a worktree is on disk.
 */

let restoreGit: () => Promise<void>;
beforeAll(async () => {
  restoreGit = await useHermeticGit();
});
afterAll(() => restoreGit());
afterEach(cleanUpWorktreeApps);

type App = Awaited<ReturnType<typeof setUp>>;

const local = () => setUp(({ repo }) => localRepository(repo).then(() => {}));

const setSettings = async (app: App, startIn: string) =>
  expect(
    (await app.call("POST", "/api/worktrees/settings", { startIn })).status,
  ).toBe(200);

const setProject = (app: App, startIn: string | null, projectId = "p") =>
  app.call("POST", `/api/projects/${projectId}/start-in`, { startIn });

const projectStartIn = async (app: App, projectId = "p") =>
  (await app.call("GET", `/api/projects/${projectId}/start-in`)).body;

/** The folder the tool was started in, by its id. */
const startedIn = (app: App) =>
  (app.calls().at(-1)!.folder as { id: string; name: string }).id;

it("hands off in the main folder for a project set to Main folder while Settings say New worktree", async () => {
  const app = await local();
  expect(await projectStartIn(app)).toEqual({ settings: "worktree" });

  expect(await setProject(app, "main")).toMatchObject({
    status: 200,
    body: { override: "main", settings: "worktree" },
  });
  const started = await app.handOff("10", "Stay in the main folder");

  expect(started.status, JSON.stringify(started.body)).toBe(200);
  expect(started.body).not.toHaveProperty("worktree");
  expect(startedIn(app)).toBe(app.folder.id);
  expect(existsSync(path.join(app.repo, ".ajour"))).toBe(false);
  // Settings still say New worktree: only this project left them.
  expect((await app.call("GET", "/api/worktrees/settings")).body).toMatchObject(
    { startIn: "worktree" },
  );
});

it("hands off in a new worktree for a project set to New worktree while Settings say Main folder", async () => {
  const app = await local();
  await setSettings(app, "main");

  expect((await setProject(app, "worktree")).body).toEqual({
    override: "worktree",
    settings: "main",
  });
  const started = await app.handOff("11", "Own folder please");

  expect(started.status, JSON.stringify(started.body)).toBe(200);
  expect(started.body.worktree).toMatchObject({ name: "aj-11" });
  expect(startedIn(app)).toBe(started.body.worktree!.id);
  expect(existsSync(app.worktreeFolder("aj-11"))).toBe(true);
});

it("follows Settings for a project that was never set, also once the default changes, and again after the project goes back to Settings", async () => {
  const app = await local();

  // Never set: the default of a fresh install, a new worktree.
  const first = await app.handOff("20", "First");
  expect(first.body.worktree).toMatchObject({ name: "aj-20" });

  await setSettings(app, "main");
  expect(await projectStartIn(app)).toEqual({ settings: "main" });
  const second = await app.handOff("21", "Second");
  expect(second.body).not.toHaveProperty("worktree");
  expect(startedIn(app)).toBe(app.folder.id);

  // The project takes its own choice, then gives it up.
  await setProject(app, "worktree");
  expect((await setProject(app, null)).body).toEqual({ settings: "main" });
  const third = await app.handOff("22", "Third");
  expect(third.body).not.toHaveProperty("worktree");
  expect(existsSync(app.worktreeFolder("aj-22"))).toBe(false);
});

it("keeps one project's choice out of another project's hand offs", async () => {
  const app = await local();

  await setProject(app, "main", "other");

  expect(await projectStartIn(app, "other")).toEqual({
    override: "main",
    settings: "worktree",
  });
  expect(await projectStartIn(app)).toEqual({ settings: "worktree" });
  const started = await app.handOff("30", "Not the other project");
  expect(started.body.worktree).toMatchObject({ name: "aj-30" });
});

it("tells a tool that makes its own worktree no branch for a project set to Main folder, and a branch and a source for one set to New worktree", async () => {
  const app = await local();

  await setProject(app, "main");
  const inMain = await app.handOff("40", "Own in main", { toolId: "own" });
  expect(inMain.status, JSON.stringify(inMain.body)).toBe(200);
  expect(app.calls().at(-1)).toEqual({
    op: "start",
    tool: "own",
    folder: { id: app.folder.id, name: "repo" },
    branch: null,
  });

  await setSettings(app, "main");
  await setProject(app, "worktree");
  const inOwn = await app.handOff("41", "Own worktree", { toolId: "own" });
  expect(inOwn.status, JSON.stringify(inOwn.body)).toBe(200);
  expect(app.calls().at(-1)).toEqual({
    op: "start",
    tool: "own",
    folder: { id: app.folder.id, name: "repo" },
    branch: "41-own-worktree",
    source: "main",
  });
});

it("gives a project set to Ask each time a new worktree when the start names no place, as Settings do", async () => {
  const app = await local();
  await setSettings(app, "main");

  await setProject(app, "ask");
  const started = await app.handOff("50", "Asked nothing");

  expect(started.body.worktree).toMatchObject({ name: "aj-50" });
});

it("refuses a choice that is none of the three, and keeps the project's choice in the local API's state file only", async () => {
  const app = await local();

  expect((await setProject(app, "nowhere")).status).toBe(400);
  expect((await setProject(app, "main")).status).toBe(200);

  // The state file of this computer holds it, by project.
  const state = JSON.parse(
    await readFile(path.join(app.root, "data", "state.json"), "utf8"),
  ) as { worktreeProjectStartIn: Record<string, string> };
  expect(state.worktreeProjectStartIn).toEqual({ p: "main" });
  // The events say the choice, and name no project.
  const updates = eventsNamed(app.sink, "worktree.project_settings_update");
  expect(updates.at(-1)).toMatchObject({
    outcome: "ok",
    worktree: { start_in: "main" },
  });
  await setProject(app, null);
  expect(
    eventsNamed(app.sink, "worktree.project_settings_update").at(-1),
  ).toMatchObject({ outcome: "ok", worktree: { start_in: "settings" } });
});
