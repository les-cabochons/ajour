import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, vi } from "vitest";
import { createRecordingSink } from "../../../../packages/wide-events/sinks.ts";
import {
  createAppApiServer,
  addRepositoryFolderForServer,
  stopAppApiServer,
} from "../server.ts";
import { AppApiStorage } from "../storage.ts";
import { InProcessPluginRuntime } from "./in-process-plugin-runtime.ts";
import { dispatchJsonRequest } from "./dispatch-json-request.ts";
import { turnOnServerHandoffTools } from "./handoff-tool-switches.ts";
import { windowServerOptions } from "./window-token.ts";

/*
 * What the hand-off worktree route tests share (#860, #862): a server with
 * an in-process fake tool plugin, a temporary folder, and a real git
 * repository in it running real git. Nothing here fakes git. A test file
 * calls `useHermeticGit` in `beforeAll`, its answer in `afterAll`, and
 * `cleanUpWorktreeApps` in `afterEach`.
 */

/**
 * Makes git read no configuration of the developer's or the machine's: each
 * repository sets its own author, and every command names its branch.
 * Answers how to undo it.
 */
export async function useHermeticGit(): Promise<() => Promise<void>> {
  const gitHome = await mkdtemp(
    path.join(os.tmpdir(), "handoff-worktree-git-"),
  );
  await writeFile(path.join(gitHome, "gitconfig"), "");
  vi.stubEnv("GIT_CONFIG_GLOBAL", path.join(gitHome, "gitconfig"));
  vi.stubEnv("GIT_CONFIG_NOSYSTEM", "1");
  return async () => {
    vi.unstubAllEnvs();
    await rm(gitHome, { recursive: true, force: true });
  };
}

const cleanups: (() => Promise<void>)[] = [];
/** Stops the servers `setUp` started and removes their temporary folders. */
export async function cleanUpWorktreeApps() {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
}

/** Runs git as a developer would, and answers what it printed. */
export function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

/** Whether git exits 0 for the command. */
export function gitSays(cwd: string, ...args: string[]): boolean {
  try {
    git(cwd, ...args);
    return true;
  } catch {
    return false;
  }
}

export function commit(
  repository: string,
  file: string,
  message: string,
): string {
  execFileSync("git", ["add", "--", file], { cwd: repository });
  git(repository, "commit", "--quiet", "-m", message);
  return git(repository, "rev-parse", "HEAD");
}

export async function newRepository(folder: string) {
  await mkdir(folder, { recursive: true });
  git(folder, "init", "--quiet", "-b", "main");
  git(folder, "config", "user.name", "Test");
  git(folder, "config", "user.email", "test@example.test");
}

/** Whether two paths name the same folder, whatever the separators. */
export const samePath = (a: string, b: string) =>
  path.relative(path.resolve(a), path.resolve(b)) === "";

export const MANIFEST = {
  id: "handoff",
  version: "1.0.0",
  apiVersion: 4,
  displayName: "Tools",
  description: "Test tools",
  iconSvg: "<svg/>",
  entrypoint: "plugin.mjs",
  connectionFields: [],
  processes: {
    undeclaredCommands: true,
    executables: { tool: { names: ["git"] } },
    commands: [
      {
        id: "start",
        executable: "tool",
        args: ["start", "{folder:folder}"],
        mode: "detached",
      },
      {
        id: "resume",
        executable: "tool",
        args: ["resume", "{thread:id}", "{folder:folder}"],
        mode: "terminal",
      },
      {
        id: "trust",
        executable: "tool",
        args: ["trust", "{folder:folder}"],
        mode: "terminal",
      },
    ],
    openSchemes: [],
  },
  capabilities: {
    handoff: {
      tools: [
        {
          id: "tool",
          label: "Tool",
          iconSvg: "<svg/>",
          settings: [],
          closesThreads: "archive",
          listsThreads: true,
        },
        {
          id: "own",
          label: "Own",
          iconSvg: "<svg/>",
          settings: [],
          ownWorktree: true,
        },
      ],
    },
  },
};

/**
 * The fake tool. It writes each request it receives to `calls.log`, beside
 * its folder, so a test reads the folder ids the tool was given, the
 * branch, and the source and the repository folder when the start carries
 * one (#863, #857). A title
 * with "launch" starts the tool's declared command in the folder, "probe"
 * runs an undeclared git command there, "refuse" refuses the start,
 * "untrusted" refuses it too, after it opened a terminal for the user to
 * trust the folder, in the repository folder when the start names one,
 * "maybe" fails saying the tool may have started (#857), "garbled"
 * answers a start that fails validation (#857),
 * "wait" answers only once `go.txt` is beside its folder (#864), and
 * "swap" first puts another folder where the worktree was. Its tool "own",
 * which makes its own worktree, refuses a branch the repository already
 * has (#863). It lists its
 * threads by exact folder: those `threads.json`, beside its folder, holds
 * under the folder id it is asked for, and with `fail-list.txt` beside its
 * folder it fails the listing (#857). Every thread is Working, or in the
 * state `state.txt`, beside its folder, names. A state read of a thread
 * whose native has `stopsOnRead` writes `stopped.txt` beside its folder, as
 * Claude Code's read stops a finished background job (#857). With `hold-read.txt` beside
 * its folder it answers a state read only once `go.txt` is there, and with
 * `fail-read.txt` it fails the read (#864).
 */
export const PLUGIN = `
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
/** Whether the repository beside the plugin has that local branch. */
const hasBranch = (branch) => {
  try {
    execFileSync(
      "git",
      ["show-ref", "--verify", "--quiet", "refs/heads/" + branch],
      { cwd: fileURLToPath(new URL("../repo", import.meta.url)), stdio: "ignore" },
    );
    return true;
  } catch {
    return false;
  }
};
const log = (entry) =>
  appendFileSync(new URL("../calls.log", import.meta.url), JSON.stringify(entry) + "\\n");
export function detectTools() {
  return { tools: [{ id: "tool", available: true }, { id: "own", available: true }] };
}
export async function startHandoff(request) {
  log({
    op: "start",
    tool: request.tool,
    folder: request.folder,
    branch: request.branch ?? null,
    // Only when the start carries one, so a test reads that another has none.
    ...(request.source === undefined ? {} : { source: request.source }),
    ...(request.repositoryFolder === undefined
      ? {}
      : { repositoryFolder: request.repositoryFolder }),
  });
  if (request.title.includes("swap")) {
    // Another program moves the worktree away and puts its own folder there.
    const folder = fileURLToPath(
      new URL("../repo/.ajour/worktrees/" + request.folder.name, import.meta.url),
    );
    renameSync(folder, folder + "-moved");
    mkdirSync(folder);
    writeFileSync(folder + "/theirs.txt", "theirs");
  }
  if (request.title.includes("wait")) {
    // A tool that takes its time to answer: until the test writes go.txt.
    const go = new URL("../go.txt", import.meta.url);
    for (let tries = 0; tries < 200 && !existsSync(go); tries++)
      await new Promise((done) => setTimeout(done, 25));
  }
  if (request.title.includes("untrusted")) {
    // A tool that won't run in a folder the user never trusted: it opens a
    // terminal for them to answer its prompt, then refuses this start. The
    // terminal opens in the repository folder, which outlives the refusal.
    await ajour.process.run({
      command: "trust",
      args: { folder: (request.repositoryFolder ?? request.folder).id },
    });
    throw new Error("Trust the folder in the terminal, then hand off again");
  }
  if (request.title.includes("refuse")) throw new Error("Tool says no");
  if (request.title.includes("maybe"))
    throw Object.assign(new Error("Tool may have started."), {
      mayHaveStarted: true,
    });
  // The tool answered, so it may well run: its answer has no thread id.
  if (request.title.includes("garbled")) return { native: {} };
  // A tool that makes its own worktree creates the branch, so it refuses
  // one the repository already has, as git would.
  if (request.tool === "own" && request.branch && hasBranch(request.branch))
    throw Object.assign(new Error("Branch " + request.branch + " exists"), {
      branchExists: true,
    });
  const native = {};
  if (request.title.includes("launch"))
    await ajour.process.run({ command: "start", args: { folder: request.folder.id } });
  if (request.title.includes("probe"))
    native.top = (
      await ajour.process.run({
        executable: "git",
        argv: ["rev-parse", "--show-toplevel"],
        cwdFolder: request.folder.id,
      })
    ).stdout.trim();
  return {
    threadId: "thread-" + Math.random().toString(36).slice(2),
    native,
    // As a tool whose resume command takes the folder: by its id.
    resume: { command: "resume", args: { thread: "t1", folder: request.folder.id } },
  };
}
export async function readHandoffStates(request) {
  log({ op: "read", folders: request.handoffs.map((h) => h.folderId) });
  if (existsSync(new URL("../hold-read.txt", import.meta.url))) {
    // A tool that takes its time to say: until the test writes go.txt.
    const go = new URL("../go.txt", import.meta.url);
    for (let tries = 0; tries < 200 && !existsSync(go); tries++)
      await new Promise((done) => setTimeout(done, 25));
  }
  // A tool that can't be asked right now.
  if (existsSync(new URL("../fail-read.txt", import.meta.url)))
    throw new Error("Tool can't say");
  const file = new URL("../state.txt", import.meta.url);
  const state = existsSync(file) ? readFileSync(file, "utf8").trim() : "working";
  // A read that is not free of side effects: it stops what it reads.
  if (request.handoffs.some((h) => h.native.stopsOnRead))
    writeFileSync(new URL("../stopped.txt", import.meta.url), "");
  return request.handoffs.map((h) => ({ id: h.id, state, native: {} }));
}
export function closeThread(request) {
  log({ op: "close", folder: request.handoff.folderId });
  return {};
}
export function listThreads(request) {
  log({ op: "list", folder: request.folder.id });
  // A tool that can't list its threads right now.
  if (existsSync(new URL("../fail-list.txt", import.meta.url)))
    throw new Error("Tool can't list");
  const file = new URL("../threads.json", import.meta.url);
  const byFolder = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
  return { threads: byFolder[request.folder.id] ?? [] };
}
`;

export interface Call {
  op: "start" | "read" | "close" | "list";
  tool?: string;
  folder?: { id: string; name: string } | string;
  folders?: string[];
  branch?: string | null;
  /** The source of a start, logged only when the request has one. */
  source?: string;
  /** The repository folder of a start, logged only when the request has one. */
  repositoryFolder?: { id: string; name: string };
}

export interface Answer {
  status: number;
  body: Record<string, unknown> & {
    id: string;
    error?: string;
    worktree?: {
      id: string;
      name: string;
      branch: string;
      source: string;
    };
  };
}

/**
 * A server with the fake tool on, and `repo` as project `p`'s repository
 * folder. `prepare` fills the temporary folder first, such as with a git
 * repository at `repo`, and may write the state file through `storage`.
 * `serverOptions` adds what the desktop app gives the server, such as how
 * it opens a folder.
 */
export async function setUp(
  prepare: (context: {
    root: string;
    repo: string;
    plugin: string;
    storage: AppApiStorage;
  }) => Promise<void>,
  serverOptions: Parameters<typeof createAppApiServer>[0] = {},
) {
  // The resolver returns real paths, and git prints them.
  const root = await realpath(
    await mkdtemp(path.join(os.tmpdir(), "handoff-worktree-")),
  );
  const repo = path.join(root, "repo");
  const plugin = path.join(root, "plugin");
  await mkdir(plugin);
  await writeFile(path.join(plugin, "plugin.json"), JSON.stringify(MANIFEST));
  await writeFile(path.join(plugin, "plugin.mjs"), PLUGIN);
  const statePath = path.join(root, "data", "state.json");
  await mkdir(repo, { recursive: true });
  await prepare({ root, repo, plugin, storage: new AppApiStorage(statePath) });
  const sink = createRecordingSink();
  const server = createAppApiServer({
    ...windowServerOptions,
    statePath,
    protectedRepositoryFolders: {
      userData: path.join(root, "data"),
      install: path.join(root, "install"),
    },
    developmentPluginDirectories: [plugin],
    allowDevelopmentPlugins: true,
    pluginRuntime: new InProcessPluginRuntime(),
    eventSink: sink,
    ...serverOptions,
  });
  cleanups.push(async () => {
    await stopAppApiServer(server);
    await rm(root, { recursive: true, force: true });
  });
  const call = (method: string, route: string, body?: unknown) =>
    dispatchJsonRequest(server, {
      method,
      path: route,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }) as Promise<Answer>;
  const folder = await addRepositoryFolderForServer(server, "p", repo);
  await turnOnServerHandoffTools(server, { handoff: ["tool", "own"] });
  /** Hands an item off: `key` and `title` name it, and its branch. */
  const handOff = (
    key: string,
    title: string,
    overrides: Record<string, unknown> = {},
  ) =>
    call("POST", "/api/handoffs", {
      pluginId: "handoff",
      toolId: "tool",
      workItemId: `item-${key}`,
      projectId: "p",
      folderId: folder.id,
      projectName: "Project",
      item: { key, title, type: "Bug", url: "" },
      settings: {},
      ...overrides,
    });
  /** The user allows the plugin's access, and its processes. */
  const allowProcesses = async () => {
    await call("POST", "/api/plugins/handoff/activation", {
      enabled: true,
      version: "1.0.0",
    });
    await call("POST", "/api/plugins/unsigned-processes", { enabled: true });
    const overview = (await call("GET", "/api/plugins")).body as unknown as {
      connectionGroups: {
        plugin: { id: string };
        processGate: { packageKey: string };
      }[];
    };
    const accepted = await call(
      "POST",
      "/api/plugins/handoff/process-acceptance",
      {
        packageKey: overview.connectionGroups.find(
          (group) => group.plugin.id === "handoff",
        )!.processGate.packageKey,
        accepted: true,
      },
    );
    expect(accepted.status, JSON.stringify(accepted.body)).toBe(200);
  };
  const calls = (): Call[] => {
    const file = path.join(root, "calls.log");
    return existsSync(file)
      ? readFileSync(file, "utf8")
          .split("\n")
          .filter(Boolean)
          .map((line) => JSON.parse(line) as Call)
      : [];
  };
  const worktreeFolder = (name: string) =>
    path.join(repo, ".ajour", "worktrees", name);
  return {
    root,
    repo,
    folder,
    sink,
    call,
    handOff,
    allowProcesses,
    calls,
    worktreeFolder,
  };
}

/**
 * `repo` as a clone of a bare `origin.git`, one commit behind it: the
 * second commit is on the remote only until something fetches it.
 */
export async function cloneBehindOrigin(root: string, repo: string) {
  const origin = path.join(root, "origin.git");
  const seed = path.join(root, "seed");
  git(root, "init", "--quiet", "--bare", "-b", "main", origin);
  await newRepository(seed);
  await writeFile(path.join(seed, "README.md"), "one\n");
  const first = commit(seed, "README.md", "first");
  git(seed, "remote", "add", "origin", origin);
  git(seed, "push", "--quiet", "origin", "main");
  await rm(repo, { recursive: true, force: true });
  git(root, "clone", "--quiet", origin, repo);
  git(repo, "config", "user.name", "Test");
  git(repo, "config", "user.email", "test@example.test");
  await writeFile(path.join(seed, "README.md"), "two\n");
  const second = commit(seed, "README.md", "second");
  git(seed, "push", "--quiet", "origin", "main");
  return { origin, first, second };
}

/** `repo` as a repository with one commit on `main` and no remote. */
export async function localRepository(repo: string) {
  await newRepository(repo);
  await writeFile(path.join(repo, "README.md"), "one\n");
  return commit(repo, "README.md", "first");
}

export const eventsNamed = (
  sink: { events: { name: string }[] },
  name: string,
) =>
  sink.events.filter((event) => event.name === name) as unknown as {
    name: string;
    outcome: string;
    outcome_reason?: string;
    duration_ms: number;
    worktree?: Record<string, unknown>;
    handoff?: Record<string, unknown>;
  }[];
