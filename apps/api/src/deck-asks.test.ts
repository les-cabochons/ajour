import os from "node:os";
import path from "node:path";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentTurnEvent } from "../../../packages/shared/agent-runs.ts";
import { deckPullRequestKey } from "../../../packages/shared/deck.ts";
import type { DeckGuideRuntime } from "./deck-guide-builds.ts";
import {
  fakeCliAdapter,
  type FakeConversation,
} from "./test-support/fake-cli-adapter.ts";
import { InProcessPluginRuntime } from "./test-support/in-process-plugin-runtime.ts";
import { MemorySecretVault } from "./test-support/memory-secret-vault.ts";
import {
  apiRequest,
  openEventStream,
  startLocalApi,
} from "./test-support/local-api.ts";

/*
 * Asks in Deck through the local API (#791): "more detail" on a concern runs
 * a `deck.ask` turn of the pull request's conversation, with the fake CLI as
 * Claude Code. Nothing reaches the CLI before the repository's consent, a
 * done answer is cached per anchor, question and head, and the agent reads
 * the pull request through Deck's tools, bound to it and its head.
 */

const ICON = "<svg viewBox='0 0 16 16'><path d='M0 0h16v16H0z' /></svg>";
const HEAD = "a41c9e2f0d";
const BASE = "b52d0f3a11";
const REPOSITORY = "acme/billing-api";
const BASE_TEXT = "one\ntwo\nthree\n";
const HEAD_TEXT = "one\nTWO\nthree\n";

const pluginSource = `
export async function validateConnection({ config }) {
  return { normalizedConfig: config, connectionSummary: {} };
}
export async function getPullRequestContent() {
  return {
    headSha: ${JSON.stringify(HEAD)},
    baseSha: ${JSON.stringify(BASE)},
    files: [{ path: "src/api.ts", status: "modified", additions: 1, deletions: 1, binary: false }],
  };
}
export async function getFileContent(connection, request) {
  if (request.path !== "src/api.ts") return { kind: "missing" };
  return {
    kind: "text",
    content: request.sha === ${JSON.stringify(HEAD)} ? ${JSON.stringify(HEAD_TEXT)} : ${JSON.stringify(BASE_TEXT)},
  };
}
export async function getPullRequestConversation() {
  return {
    description: "",
    timeline: [],
    threads: [{
      id: "t1",
      path: "src/api.ts",
      side: "head",
      line: 2,
      resolved: false,
      outdated: false,
      comments: [{
        id: "c1",
        author: { login: "rivka", isBot: false },
        body: "Why upper case?",
        createdAt: 1795600000000,
      }],
    }],
    viewedPaths: [],
    mergeMethods: ["merge"],
  };
}
`;

/** The guide, as the pipeline would build it: one concern. */
const guideRuntime: DeckGuideRuntime = {
  build: async () => [
    {
      id: "g1",
      title: "Upper-case the second line",
      rationale: "The handler now shouts.",
      hunkIds: ["src/api.ts#0"],
    },
  ],
  close: async () => {},
};

const stops: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const stop of stops.splice(0).reverse()) await stop();
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
    "utf8",
  );
  await writeFile(path.join(directory, "plugin.mjs"), pluginSource, "utf8");
  return directory;
}

/** One turn the fake CLI answers: it reads it, streams `pieces`, and ends it. */
const answer = (...pieces: string[]) => [
  { readTurn: true },
  { stream: pieces },
  { result: true },
];

/**
 * The API with the fake GitHub plugin and the fake CLI as Claude Code,
 * pull request #482 open in Deck, and the window's event stream open with
 * MCP off.
 */
async function startAskApi(conversation: FakeConversation) {
  const root = await mkdtemp(path.join(os.tmpdir(), "ajour-deck-ask-"));
  stops.push(() => rm(root, { recursive: true, force: true, maxRetries: 5 }));
  const report = path.join(root, "report.jsonl");
  const bin = path.join(root, "bin");
  await mkdir(bin);
  await writeFile(path.join(bin, "claude"), "#!/bin/sh\nexit 0\n", {
    mode: 0o755,
  });
  let mcpUrl = "";
  const api = await startLocalApi({
    pluginRuntime: new InProcessPluginRuntime(),
    vault: new MemorySecretVault(),
    allowDevelopmentPlugins: true,
    developmentPluginDirectories: [await createCodeHostPlugin(root)],
    deckGuideRuntime: guideRuntime,
    agentCliPath: bin,
    agentCliAdapters: [
      fakeCliAdapter([{ exit: 0 }], report, () => mcpUrl, conversation),
    ],
  });
  stops.push(api.stop);
  mcpUrl = `${api.baseUrl}/mcp/ajour`;
  await apiRequest(api.baseUrl, "/api/agents/settings", {
    cli: "claude-code",
    browserMode: "my-chrome",
  });
  const created = await apiRequest(
    api.baseUrl,
    "/api/plugins/github/connections",
    {
      values: {
        label: "Work",
        tenantLabel: "acme",
        baseUrl: "https://github.com",
      },
    },
  );
  expect(created.status).toBe(200);
  const connectionId = created.body.connection.id as string;
  const deck = `/api/deck/github/connections/${connectionId}`;
  const opened = await apiRequest(api.baseUrl, `${deck}/open`, {
    repository: REPOSITORY,
    number: 482,
  });
  expect(opened.status).toBe(200);
  const stream = await openEventStream(api.baseUrl, "/api/handoffs/bridge");
  stops.push(stream.close);

  const reportLines = async () =>
    (await readFile(report, "utf8").catch(() => ""))
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, any>);
  const turnEvents = () =>
    stream.events
      .filter((event) => event.event === "agent-turn")
      .map((event) => event.data as AgentTurnEvent);

  return {
    ...api,
    connectionId,
    ask(body: Record<string, unknown> = {}) {
      return apiRequest(api.baseUrl, `${deck}/ask`, {
        repository: REPOSITORY,
        number: 482,
        head: HEAD,
        anchor: { kind: "concern", id: "g1" },
        ...body,
      });
    },
    consent() {
      return apiRequest(api.baseUrl, `${deck}/consent`, {
        repository: REPOSITORY,
      });
    },
    consents() {
      return apiRequest(api.baseUrl, "/api/deck/consents");
    },
    revoke() {
      return apiRequest(api.baseUrl, "/api/deck/consents/revoke", {
        pluginId: "github",
        connectionId,
        repository: REPOSITORY,
      });
    },
    /** The turn's text, once it ended. */
    async answerOf(turnId: string) {
      await stream.waitFor(
        "agent-turn",
        (event) =>
          (event as AgentTurnEvent).type === "ended" &&
          (event as { turnId: string }).turnId === turnId,
      );
      return turnEvents()
        .filter(
          (event): event is Extract<AgentTurnEvent, { type: "text" }> =>
            event.type === "text" && event.turnId === turnId,
        )
        .map((event) => event.text)
        .join("");
    },
    /** The turn's first piece of text. */
    waitForText(turnId: string) {
      return stream.waitFor(
        "agent-turn",
        (event) =>
          (event as AgentTurnEvent).type === "text" &&
          (event as { turnId: string }).turnId === turnId,
      );
    },
    turnEvents,
    /** Each turn the fake CLI read on stdin, in order. */
    async turnsRead(): Promise<string[]> {
      return (await reportLines())
        .filter((line) => line.stdin?.type === "user")
        .map((line) => String(line.stdin.message.content));
    },
    async launches() {
      return (await reportLines()).filter(
        (line) => typeof line.pid === "number",
      );
    },
    async mcpReplies() {
      return (await reportLines()).flatMap((line) =>
        line.mcp ? [line.mcp as { status: number; reply: any }] : [],
      );
    },
  };
}

describe("consent", () => {
  it(
    "sends nothing to the agent before the repository's consent, and names the agent that would read it",
    { timeout: 20_000 },
    async () => {
      const api = await startAskApi(() => [...answer("Fine")]);

      const refused = await api.ask();

      expect(refused.status).toBe(409);
      expect(refused.body).toMatchObject({
        reason: "needs_consent",
        repository: REPOSITORY,
        provider: { cli: "claude-code", label: "Claude Code" },
      });
      expect(await api.launches()).toEqual([]);
      expect(api.turnEvents()).toEqual([]);

      // The runner's own route refuses a turn about it too.
      const direct = await apiRequest(api.baseUrl, "/api/agent-runs", {
        task: "deck.ask",
        pullRequest: deckPullRequestKey({
          pluginId: "github",
          connectionId: api.connectionId,
          repository: REPOSITORY,
          number: 482,
        }),
        head: HEAD,
      });
      expect(direct.status).toBe(409);
      expect(direct.body.reason).toBe("needs_consent");
      expect(await api.launches()).toEqual([]);
    },
  );

  it(
    "asks once: after consent the ask runs, and Settings lists the repository",
    { timeout: 20_000 },
    async () => {
      const api = await startAskApi(() => [...answer("It ", "shouts.")]);

      expect((await api.consent()).status).toBe(200);
      const asked = await api.ask();

      expect(asked.status).toBe(201);
      expect(asked.body.kind).toBe("turn");
      expect(await api.answerOf(asked.body.turn.id)).toBe("It shouts.");
      const consents = (await api.consents()).body.consents;
      expect(consents).toEqual([
        expect.objectContaining({
          pluginId: "github",
          connectionId: api.connectionId,
          repository: REPOSITORY,
          cli: "claude-code",
        }),
      ]);
    },
  );

  it("stops further asks once revoked", { timeout: 20_000 }, async () => {
    const api = await startAskApi(() => [
      ...answer("First."),
      { readTurn: true },
    ]);
    await api.consent();
    const first = await api.ask();
    await api.answerOf(first.body.turn.id);

    expect((await api.revoke()).status).toBe(200);
    const again = await api.ask({ question: "What about errors?" });

    expect(again.status).toBe(409);
    expect(again.body.reason).toBe("needs_consent");
    expect((await api.consents()).body.consents).toEqual([]);
    expect(await api.turnsRead()).toHaveLength(1);
  });
});

describe("answers", () => {
  it(
    "sends the concern with its default question, and answers it again at once from the cache",
    { timeout: 20_000 },
    async () => {
      const api = await startAskApi(() => [
        ...answer("It ", "shouts."),
        { readTurn: true },
      ]);
      await api.consent();

      const first = await api.ask();
      await api.answerOf(first.body.turn.id);
      const second = await api.ask();

      expect(second.status).toBe(200);
      expect(second.body).toEqual({
        kind: "answer",
        text: "It shouts.",
        head: HEAD,
      });
      const [turn] = await api.turnsRead();
      expect(turn).toContain("Upper-case the second line");
      expect(turn).toContain("The handler now shouts.");
      expect(turn).toContain("src/api.ts#0");
      expect(await api.turnsRead()).toHaveLength(1);
    },
  );

  it(
    "asks a typed question in place of the default, cached on its own",
    { timeout: 20_000 },
    async () => {
      const api = await startAskApi(() => [
        ...answer("Default."),
        ...answer("Typed."),
        { readTurn: true },
      ]);
      await api.consent();

      const first = await api.ask();
      await api.answerOf(first.body.turn.id);
      const typed = await api.ask({ question: "Is this tested?" });

      expect(typed.status).toBe(201);
      expect(await api.answerOf(typed.body.turn.id)).toBe("Typed.");
      expect((await api.turnsRead())[1]).toContain("Is this tested?");
      expect((await api.ask({ question: "Is this tested?" })).body).toEqual({
        kind: "answer",
        text: "Typed.",
        head: HEAD,
      });
      expect((await api.ask()).body.text).toBe("Default.");
    },
  );

  it("doesn't cache a stopped answer", { timeout: 20_000 }, async () => {
    const api = await startAskApi(() => [
      { readTurn: true },
      { stream: ["Half"] },
      { waitForInterrupt: true },
      { result: true },
      ...answer("Whole."),
      { readTurn: true },
    ]);
    await api.consent();

    const first = await api.ask();
    await api.waitForText(first.body.turn.id);
    await apiRequest(
      api.baseUrl,
      `/api/agent-turns/${first.body.turn.id}/cancel`,
      {},
    );
    await api.answerOf(first.body.turn.id);
    const again = await api.ask();

    expect(again.status).toBe(201);
    expect(await api.answerOf(again.body.turn.id)).toBe("Whole.");
  });

  it(
    "refuses an ask about a concern the guide doesn't have",
    { timeout: 20_000 },
    async () => {
      const api = await startAskApi(() => [{ readTurn: true }]);
      await api.consent();

      const asked = await api.ask({ anchor: { kind: "concern", id: "g9" } });

      expect(asked.status).toBe(404);
      expect(await api.launches()).toEqual([]);
    },
  );
});

describe("the agent's reads", () => {
  it(
    "lists Deck's four reads, and answers them for this pull request at this head",
    { timeout: 20_000 },
    async () => {
      const call = (name: string, args: Record<string, unknown> = {}) => ({
        mcp: { method: "tools/call", params: { name, arguments: args } },
      });
      const api = await startAskApi(() => [
        { readTurn: true },
        { mcp: { method: "tools/list" } },
        call("read_hunks", { ids: ["src/api.ts#0", "src/gone.ts#3"] }),
        call("read_file", { path: "src/api.ts", side: "base" }),
        call("read_threads"),
        call("read_guide"),
        call("list_projects"),
        { stream: ["Read."] },
        { result: true },
        { readTurn: true },
      ]);
      await api.consent();

      const asked = await api.ask();
      await api.answerOf(asked.body.turn.id);

      const [list, hunks, file, threads, guide, projects] =
        await api.mcpReplies();
      expect(
        list!.reply.result.tools.map((tool: { name: string }) => tool.name),
      ).toEqual(["read_hunks", "read_file", "read_threads", "read_guide"]);
      expect(hunks!.reply.result.structuredContent).toEqual({
        hunks: [
          {
            id: "src/api.ts#0",
            path: "src/api.ts",
            patch: expect.stringContaining("+TWO"),
          },
        ],
        unknownIds: ["src/gone.ts#3"],
      });
      expect(file!.reply.result.structuredContent).toEqual({
        path: "src/api.ts",
        side: "base",
        content: BASE_TEXT,
      });
      expect(threads!.reply.result.structuredContent).toEqual({
        threads: [
          {
            path: "src/api.ts",
            side: "head",
            line: 2,
            resolved: false,
            outdated: false,
            comments: [{ author: "rivka", body: "Why upper case?" }],
          },
        ],
      });
      expect(guide!.reply.result.structuredContent.concerns).toEqual([
        {
          id: "g1",
          title: "Upper-case the second line",
          rationale: "The handler now shouts.",
          hunkIds: ["src/api.ts#0"],
        },
      ]);
      expect(projects!.reply.result.isError).toBe(true);
    },
  );
});
