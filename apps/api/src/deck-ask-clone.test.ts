import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentTurnEvent } from "../../../packages/shared/agent-runs.ts";
import { createRecordingSink } from "../../../packages/wide-events/sinks.ts";
import type { AjourEvent } from "../../../packages/wide-events/catalog.ts";
import type { DeckGuideRuntime } from "./deck-guide-builds.ts";
import {
  addRepositoryFolderForServer,
  deckClonesSweptForServer,
  startAppApiServer,
  stopAppApiServer,
} from "./server.ts";
import {
  deckCloneFixture,
  type DeckCloneFixture,
} from "./test-support/deck-clone-fixture.ts";
import {
  fakeCliAdapter,
  fakeCodexAdapter,
} from "./test-support/fake-cli-adapter.ts";
import {
  git,
  useHermeticGit,
} from "./test-support/handoff-worktree-harness.ts";
import { InProcessPluginRuntime } from "./test-support/in-process-plugin-runtime.ts";
import {
  apiRequest,
  openEventStream,
  TEST_ORIGIN,
} from "./test-support/local-api.ts";
import { MemorySecretVault } from "./test-support/memory-secret-vault.ts";
import { TEST_WINDOW_TOKEN } from "./test-support/window-token.ts";

/*
 * Asks that read the user's local clone (#795), through the local API with
 * the fake CLI as Claude Code and a real clone of a bare "host" remote. The
 * agent reads the worktree at the pull request's head with its read-only
 * file tools; a clone that can't be prepared leaves the ask on the pull
 * request alone, with the reason.
 */

const ICON = "<svg viewBox='0 0 16 16'><path d='M0 0h16v16H0z' /></svg>";
const REPOSITORY = "acme/api";

const guideRuntime: DeckGuideRuntime = {
  build: async () => [
    {
      id: "g1",
      title: "The answer changes",
      rationale: "It is 42 now.",
      hunkIds: ["app.ts#0"],
    },
  ],
  close: async () => {},
};

const answer = (...pieces: string[]) => [
  { readTurn: true },
  { stream: pieces },
  { result: true },
];

let fixture: DeckCloneFixture;
let restoreGit: () => Promise<void>;
const stops: (() => Promise<void> | void)[] = [];

beforeEach(async () => {
  restoreGit = await useHermeticGit();
  fixture = await deckCloneFixture();
});

afterEach(async () => {
  for (const stop of stops.splice(0).reverse()) await stop();
  await fixture.remove();
  await restoreGit();
});

async function createCodeHostPlugin(parent: string) {
  const directory = path.join(parent, "github");
  await mkdir(directory, { recursive: true });
  await writeFile(
    path.join(directory, "plugin.json"),
    JSON.stringify({
      id: "github",
      version: "1.0.0",
      apiVersion: 4,
      displayName: "GitHub",
      description: "Test code host.",
      iconSvg: ICON,
      entrypoint: "plugin.mjs",
      capabilities: { codeHost: {} },
      connectionFields: [
        {
          id: "label",
          label: "Connection label",
          type: "text",
          required: true,
        },
        { id: "tenantLabel", label: "Account", type: "text", required: true },
        { id: "baseUrl", label: "GitHub URL", type: "url", required: true },
      ],
    }),
  );
  await writeFile(
    path.join(directory, "plugin.mjs"),
    `
export async function validateConnection({ config }) {
  return { normalizedConfig: config, connectionSummary: {} };
}
export async function getPullRequestContent() {
  return {
    headSha: ${JSON.stringify(fixture.head)},
    baseSha: ${JSON.stringify(fixture.base)},
    files: [{ path: "app.ts", status: "modified", additions: 1, deletions: 1, binary: false }],
  };
}
export async function getFileContent(connection, request) {
  return {
    kind: "text",
    content: request.sha === ${JSON.stringify(fixture.head)}
      ? "export const answer = 42;\\n"
      : "export const answer = 1;\\n",
  };
}
`,
  );
  return directory;
}

async function startCloneApi() {
  const root = await mkdtemp(path.join(os.tmpdir(), "ajour-deck-clone-"));
  stops.push(() => rm(root, { recursive: true, force: true, maxRetries: 5 }));
  const report = path.join(root, "report.jsonl");
  const bin = path.join(root, "bin");
  await mkdir(bin);
  for (const name of ["claude", "codex"]) {
    await writeFile(path.join(bin, name), "#!/bin/sh\nexit 0\n", {
      mode: 0o755,
    });
  }
  let mcpUrl = "";
  const sink = createRecordingSink<AjourEvent>();
  /** The folders the API asked the file manager to show. */
  const shown: string[] = [];
  const plugin = await createCodeHostPlugin(root);
  const boot = () =>
    startAppApiServer({
      port: 0,
      statePath: path.join(root, "data", "state.json"),
      installedPluginDirectory: path.join(root, "installed"),
      projectDataShapePluginDirectories: [],
      allowedOrigins: [TEST_ORIGIN],
      windowToken: TEST_WINDOW_TOKEN,
      eventSink: sink,
      pluginRuntime: new InProcessPluginRuntime(),
      vault: new MemorySecretVault(),
      allowDevelopmentPlugins: true,
      developmentPluginDirectories: [plugin],
      deckGuideRuntime: guideRuntime,
      openFolder: async (folder) => {
        shown.push(folder);
      },
      agentCliPath: bin,
      agentCliAdapters: [
        fakeCliAdapter(
          [{ exit: 0 }],
          report,
          () => mcpUrl,
          // Each process names its session, so a later one resumes it.
          () => [
            { readTurn: true },
            { session: "s-1" },
            { stream: ["It reads ", "the clone."] },
            { result: true },
            ...answer("Again."),
          ],
        ),
        fakeCodexAdapter(
          report,
          () => mcpUrl,
          () => [{ codexReadTurn: true }],
        ),
      ],
    });
  let server = await boot();
  stops.push(() => stopAppApiServer(server));
  let baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  mcpUrl = `${baseUrl}/mcp/ajour`;
  await apiRequest(baseUrl, "/api/agents/settings", {
    cli: "claude-code",
    browserMode: "my-chrome",
  });
  const created = await apiRequest(baseUrl, "/api/plugins/github/connections", {
    values: {
      label: "Work",
      tenantLabel: "acme",
      baseUrl: "https://github.com",
    },
  });
  const connectionId = created.body.connection.id as string;
  const deck = `/api/deck/github/connections/${connectionId}`;
  const open = (number: number) =>
    apiRequest(baseUrl, `${deck}/open`, { repository: REPOSITORY, number });
  expect((await open(17)).status).toBe(200);
  expect(
    (
      await apiRequest(baseUrl, `${deck}/consent`, {
        repository: REPOSITORY,
        cli: "claude-code",
      })
    ).status,
  ).toBe(200);
  const stream = await openEventStream(baseUrl, "/api/handoffs/bridge");
  stops.push(stream.close);
  const source = { repositoryIdentity: { cloneUrls: [fixture.host] } };

  return {
    get baseUrl() {
      return baseUrl;
    },
    /** Stops the API and starts it again on the same data folder. */
    async restart() {
      await stopAppApiServer(server);
      server = await boot();
      await deckClonesSweptForServer(server);
      baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      mcpUrl = `${baseUrl}/mcp/ajour`;
    },
    events: sink.events,
    shown,
    root,
    open,
    source,
    ask(body: Record<string, unknown> = {}) {
      return apiRequest(baseUrl, `${deck}/ask`, {
        repository: REPOSITORY,
        number: 17,
        head: fixture.head,
        anchor: { kind: "concern", id: "g1" },
        clone: source,
        ...body,
      });
    },
    suggestions() {
      return apiRequest(baseUrl, `${deck}/clone/suggestions`, {
        repository: REPOSITORY,
        clone: source,
      });
    },
    choose(folderId: string) {
      return apiRequest(baseUrl, `${deck}/clone`, {
        repository: REPOSITORY,
        clone: source,
        folderId,
      });
    },
    /** Adds the user's clone as a project's repository folder, as the desktop's chooser does. */
    addFolder: () => addRepositoryFolderForServer(server, "p1", fixture.clone),
    consent: (cli: string) =>
      apiRequest(baseUrl, `${deck}/consent`, { repository: REPOSITORY, cli }),
    pick: (cli: string) =>
      apiRequest(baseUrl, "/api/agents/settings", {
        cli,
        browserMode: "my-chrome",
      }),
    async launches(): Promise<string[][]> {
      return (await readFile(report, "utf8").catch(() => ""))
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Record<string, any>)
        .filter((line) => typeof line.pid === "number")
        .map((line) => line.argv as string[]);
    },
    async turnsRead(): Promise<string[]> {
      return (await readFile(report, "utf8").catch(() => ""))
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Record<string, any>)
        .filter((line) => line.stdin?.type === "user")
        .map((line) => String(line.stdin.message.content));
    },
    async ended(turnId: string) {
      await stream.waitFor(
        "agent-turn",
        (event) =>
          (event as AgentTurnEvent).type === "ended" &&
          (event as { turnId: string }).turnId === turnId,
      );
    },
  };
}

/** The first event named `name`, as the sink recorded it. */
function eventNamed(events: readonly AjourEvent[], name: string) {
  const found = events.find((one) => one.name === name);
  if (!found) throw new Error(`No ${name} event.`);
  return found as unknown as {
    outcome?: string;
    outcome_reason?: string;
    deck?: Record<string, unknown>;
  };
}

const exists = (file: string) =>
  access(file).then(
    () => true,
    () => false,
  );

async function until(check: () => Promise<boolean>, ms = 10_000) {
  const end = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > end) throw new Error("Timed out.");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

describe("an ask that reads the user's clone", () => {
  it(
    "suggests a known folder, then reads the clone's worktree at the head with read-only file tools",
    { timeout: 60_000 },
    async () => {
      const api = await startCloneApi();
      const folder = await api.addFolder();
      expect((await api.suggestions()).body).toEqual({
        suggestions: [
          { folderId: folder.id, name: folder.name, path: folder.path },
        ],
      });
      const chosen = await api.choose(folder.id);
      expect(chosen.status).toBe(200);
      expect(chosen.body.clone).toMatchObject({
        repository: REPOSITORY,
        remote: "origin",
      });
      const before = await fixture.userState();

      const asked = await api.ask();

      expect(asked.status).toBe(201);
      expect(asked.body.clone).toEqual({ state: "read" });
      await api.ended(asked.body.turn.id);
      const [argv] = await api.launches();
      const root = argv![argv!.indexOf("--add-dir") + 1]!;
      expect(argv![argv!.indexOf("--tools") + 1]).toBe("Read,Grep,Glob");
      expect(await readFile(path.join(root, "head only.ts"), "utf8")).toBe(
        "export const fresh = true;\n",
      );
      expect((await api.turnsRead())[0]).toContain(
        `you can also read the whole repository at the pull request's head, in ${root}`,
      );
      expect(await fixture.userState()).toEqual(before);
      const event = eventNamed(api.events, "deck.ask");
      expect(event.deck?.clone).toBe("read");
      expect(JSON.stringify(event)).not.toContain(fixture.root);

      // The cached answer says it read the clone too.
      const again = await api.ask();
      expect(again.status).toBe(200);
      expect(again.body).toMatchObject({
        kind: "answer",
        clone: { state: "read" },
      });

      // Another pull request on screen keeps it: its entry stays cached.
      expect((await api.open(18)).status).toBe(200);
      expect(await exists(root)).toBe(true);
      // The worktree goes with its entry, the one on screen included.
      expect(
        (await apiRequest(api.baseUrl, "/api/deck/storage/clear", {})).status,
      ).toBe(200);
      // Its ref goes right after the worktree.
      await until(
        async () =>
          !(await exists(root)) &&
          git(fixture.clone, "for-each-ref", "refs/ajour") === "",
      );
      expect(await fixture.userState()).toEqual(before);
    },
  );

  it(
    "Clear cache after a restart removes the worktree the earlier run made",
    { timeout: 60_000 },
    async () => {
      const api = await startCloneApi();
      await api.choose((await api.addFolder()).id);
      const asked = await api.ask();
      expect(asked.body.clone).toEqual({ state: "read" });
      await api.ended(asked.body.turn.id);
      const [argv] = await api.launches();
      const root = argv![argv!.indexOf("--add-dir") + 1]!;

      await api.restart();
      // The start's sweep keeps it: the cache still holds its entry.
      expect(await exists(root)).toBe(true);
      expect(
        (await apiRequest(api.baseUrl, "/api/deck/storage/clear", {})).status,
      ).toBe(200);

      await until(
        async () =>
          !(await exists(root)) &&
          git(fixture.clone, "for-each-ref", "refs/ajour") === "",
      );
    },
  );

  it(
    "says no clone is chosen, and the agent reads the pull request alone",
    { timeout: 30_000 },
    async () => {
      const api = await startCloneApi();
      const asked = await api.ask();
      expect(asked.body.clone).toEqual({ state: "not_chosen" });
      await api.ended(asked.body.turn.id);
      expect((await api.launches())[0]).not.toContain("--add-dir");

      // Once a clone is chosen, the cached answer is asked again, reading it,
      // in a new process whose file tools are rooted at the worktree.
      await api.choose((await api.addFolder()).id);
      const again = await api.ask();
      expect(again.status).toBe(201);
      expect(again.body.clone).toEqual({ state: "read" });
      await api.ended(again.body.turn.id);
      const launches = await api.launches();
      expect(launches).toHaveLength(2);
      expect(launches[1]).toContain("--add-dir");
      expect(launches[1]).toContain("--resume");
    },
  );

  it(
    "falls back on the pull request alone when the clone is gone",
    { timeout: 30_000 },
    async () => {
      const api = await startCloneApi();
      await api.choose((await api.addFolder()).id);
      await rm(fixture.clone, { recursive: true, force: true, maxRetries: 5 });

      const asked = await api.ask();

      expect(asked.status).toBe(201);
      expect(asked.body.clone).toEqual({
        state: "unavailable",
        reason:
          "Ajour can't find your clone of acme/api any more. Choose it again in Settings › Agents.",
      });
      await api.ended(asked.body.turn.id);
      const [argv] = await api.launches();
      expect(argv).not.toContain("--add-dir");
      expect(argv![argv!.indexOf("--tools") + 1]).toBe("");
    },
  );

  it(
    "falls back on the pull request alone when the fetch fails",
    { timeout: 30_000 },
    async () => {
      const api = await startCloneApi();
      await api.choose((await api.addFolder()).id);
      await rm(fixture.host, { recursive: true, force: true, maxRetries: 5 });

      const asked = await api.ask();

      expect(asked.body.clone).toEqual({
        state: "unavailable",
        reason:
          "Ajour couldn't fetch this pull request into your clone. Check that git fetch works there.",
      });
      await api.ended(asked.body.turn.id);
      expect((await api.launches())[0]).not.toContain("--add-dir");
    },
  );

  it(
    "falls back on the pull request alone when the remote doesn't have the head",
    { timeout: 30_000 },
    async () => {
      const api = await startCloneApi();
      await api.choose((await api.addFolder()).id);
      // A force-push left the pull request's ref at another commit.
      git(fixture.host, "update-ref", "refs/pull/17/head", fixture.base);

      const asked = await api.ask();

      expect(asked.body.clone).toEqual({
        state: "unavailable",
        reason: `Your clone's remote doesn't have this pull request's head commit, ${fixture.head.slice(0, 7)}.`,
      });
      await api.ended(asked.body.turn.id);
      expect((await api.launches())[0]).not.toContain("--add-dir");
      const event = eventNamed(api.events, "deck.ask");
      expect(event.deck?.clone).toBe("head_not_found");
    },
  );

  it(
    "keeps an agent that reads files only through its shell on the pull request",
    { timeout: 30_000 },
    async () => {
      const api = await startCloneApi();
      await api.choose((await api.addFolder()).id);
      await api.pick("codex");
      // Another agent asks for consent first, and nothing is fetched before it.
      expect((await api.ask()).status).toBe(409);
      expect((await api.consent("codex")).status).toBe(200);

      const asked = await api.ask();

      expect(asked.status).toBe(201);
      expect(asked.body.clone).toEqual({
        state: "unavailable",
        reason:
          "This agent reads files only through a shell, which Ajour keeps off, so it read the pull request alone.",
      });
      expect(
        git(fixture.clone, "for-each-ref", "--format=%(refname)", "refs/ajour"),
      ).toBe("");
    },
  );

  it(
    "refuses a known folder that isn't a clone of the repository",
    { timeout: 30_000 },
    async () => {
      const api = await startCloneApi();
      git(
        fixture.clone,
        "remote",
        "set-url",
        "origin",
        "https://github.com/acme/other.git",
      );
      const folder = await api.addFolder();
      expect((await api.suggestions()).body.suggestions).toEqual([]);
      const chosen = await api.choose(folder.id);
      expect(chosen.status).toBe(400);
      expect(chosen.body).toEqual({
        reason: "clone_refused",
        error: "None of this folder's remotes is acme/api.",
      });
    },
  );
});

describe("the clone routes' events", () => {
  it(
    "record counts and the clone's environment, never a path or a remote",
    { timeout: 60_000 },
    async () => {
      const api = await startCloneApi();
      const folder = await api.addFolder();
      await api.suggestions();
      await api.choose(folder.id);
      await apiRequest(api.baseUrl, "/api/deck/clones");
      await apiRequest(api.baseUrl, "/api/deck/clones/forget", {
        pluginId: "github",
        connectionId:
          (await apiRequest(api.baseUrl, "/api/deck/clones")).body.clones[0]
            ?.connectionId ?? "none",
        repository: REPOSITORY,
      });

      expect(eventNamed(api.events, "deck.clone_suggestions")).toMatchObject({
        outcome: "ok",
        deck: { folder_count: 1, suggestion_count: 1, clone_chosen: false },
      });
      expect(eventNamed(api.events, "deck.clone_choose")).toMatchObject({
        outcome: "ok",
        deck: { clone_environment: "native" },
      });
      expect(eventNamed(api.events, "deck.clones")).toMatchObject({
        outcome: "ok",
        deck: { clone_count: 1 },
      });
      expect(eventNamed(api.events, "deck.clone_forget")).toMatchObject({
        outcome: "ok",
      });
      const recorded = JSON.stringify(
        api.events.filter((one) => one.name.startsWith("deck.clone")),
      );
      expect(recorded).not.toContain(fixture.root);
      expect(recorded).not.toContain(fixture.root.replaceAll("\\", "/"));
    },
  );

  it(
    "record a worktree cleanup leaves, with why, never a path",
    { timeout: 60_000 },
    async () => {
      const api = await startCloneApi();
      await api.choose((await api.addFolder()).id);
      const asked = await api.ask();
      expect(asked.body.clone).toEqual({ state: "read" });
      await api.ended(asked.body.turn.id);
      const [argv] = await api.launches();
      const root = argv![argv!.indexOf("--add-dir") + 1]!;
      // A file of the user's in Deck's worktree: it stays.
      const mine = path.join(root, "my notes.txt");
      await writeFile(mine, "mine\n");

      expect(
        (await apiRequest(api.baseUrl, "/api/deck/storage/clear", {})).status,
      ).toBe(200);
      await until(async () =>
        api.events.some((one) => one.name === "deck.clone_kept"),
      );

      expect(await readFile(mine, "utf8")).toBe("mine\n");
      expect(eventNamed(api.events, "deck.clone_kept")).toMatchObject({
        outcome: "ok",
        deck: { clone_kept: "not_clean", clone_environment: "native" },
      });
      const recorded = JSON.stringify(
        eventNamed(api.events, "deck.clone_kept"),
      );
      expect(recorded).not.toContain(fixture.root);
      expect(recorded).not.toContain(fixture.root.replaceAll("\\", "/"));

      // Settings › Storage counts it, and shows its folder on request.
      expect(
        (await apiRequest(api.baseUrl, "/api/deck/storage")).body,
      ).toMatchObject({ keptCloneFolderCount: 1 });
      expect(
        (await apiRequest(api.baseUrl, "/api/deck/storage/kept/open", {}))
          .status,
      ).toBe(200);
      expect(api.shown).toEqual([
        path.join(api.root, "data", "deck-cache", "worktrees"),
      ]);
      expect(
        JSON.stringify(eventNamed(api.events, "deck.storage_open_kept")),
      ).not.toContain("deck-cache");
    },
  );

  it(
    "records a refused choice with its reason",
    { timeout: 30_000 },
    async () => {
      const api = await startCloneApi();
      git(
        fixture.clone,
        "remote",
        "set-url",
        "origin",
        "https://github.com/acme/other.git",
      );
      await api.choose((await api.addFolder()).id);
      expect(eventNamed(api.events, "deck.clone_choose")).toMatchObject({
        outcome: "refused",
        outcome_reason: "clone_refused",
      });
    },
  );
});
