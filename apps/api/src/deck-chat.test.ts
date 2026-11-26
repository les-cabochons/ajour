import os from "node:os";
import path from "node:path";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import type {
  AgentTurnAction,
  AgentTurnEvent,
} from "../../../packages/shared/agent-runs.ts";
import { DECK_DRAFT_COMMENT_TOOL } from "../../../packages/shared/deck.ts";
import type { DeckGuideRuntime } from "./deck-guide-builds.ts";
import {
  fakeCliAdapter,
  type FakeConversation,
} from "./test-support/fake-cli-adapter.ts";
import { InProcessPluginRuntime } from "./test-support/in-process-plugin-runtime.ts";
import { MemorySecretVault } from "./test-support/memory-secret-vault.ts";
import { builtFrom } from "./test-support/deck-guides.ts";
import {
  apiRequest,
  openEventStream,
  startLocalApi,
} from "./test-support/local-api.ts";

/*
 * Deck's chat through the local API (#796, ADR 0024): a message runs a
 * `deck.chat` turn of the pull request's conversation, with the fake CLI as
 * Claude Code. Its agent can make the review writes the user can, each
 * through the fake code host at once and back to the window as an action
 * line, and a draft comment through the window's bridge. Ajour offers no
 * merge, refuses one asked for by name, and takes no write in an ask's turn.
 */

const ICON = "<svg viewBox='0 0 16 16'><path d='M0 0h16v16H0z' /></svg>";
const HEAD = "a41c9e2f0d";
const BASE = "b52d0f3a11";
const REPOSITORY = "acme/billing-api";

/** A code host that records each write in `globalThis.chatWrites`. */
const pluginSource = `
const writes = () => (globalThis.chatWrites ??= []);
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
    content: request.sha === ${JSON.stringify(HEAD)} ? "one\\nTWO\\nthree\\n" : "one\\ntwo\\nthree\\n",
  };
}
export async function postComment(connection, request) {
  writes().push({ operation: "postComment", request });
  return { commentId: "c-" + writes().length, url: "https://github.com/acme/billing-api/pull/482#c" + writes().length };
}
export async function replyToThread(connection, request) {
  writes().push({ operation: "replyToThread", request });
  return { commentId: "c-" + writes().length };
}
export async function setThreadResolved(connection, request) {
  writes().push({ operation: "setThreadResolved", request });
  return { resolved: request.resolved };
}
export async function submitReview(connection, request) {
  writes().push({ operation: "submitReview", request });
  return { reviewId: "r-1", url: "https://github.com/acme/billing-api/pull/482#r1" };
}
export async function updatePullRequest(connection, request) {
  writes().push({ operation: "updatePullRequest", request });
  return { title: request.title ?? "Shout the second line", draft: request.draft ?? false };
}
export async function mergePullRequest(connection, request) {
  writes().push({ operation: "mergePullRequest", request });
  return { mergeCommitSha: "m-1" };
}
`;

const guideRuntime: DeckGuideRuntime = {
  build: async (input) =>
    builtFrom(
      input,
      // A regroup's concerns get the rules alone.
      input.concerns ?? [
        {
          id: "g1",
          title: "Upper-case the second line",
          rationale: "The handler now shouts.",
          hunkIds: ["src/api.ts#0"],
        },
      ],
    ),
  close: async () => {},
};

const stops: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const stop of stops.splice(0).reverse()) await stop();
  delete (globalThis as { chatWrites?: unknown }).chatWrites;
});

const hostWrites = () =>
  (
    globalThis as {
      chatWrites?: { operation: string; request: Record<string, unknown> }[];
    }
  ).chatWrites ?? [];

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

const call = (name: string, args: Record<string, unknown> = {}) => ({
  mcp: { method: "tools/call", params: { name, arguments: args } },
});

/** The API, pull request #482 open in Deck and allowed, and the window's stream open with MCP off. */
async function startChatApi(conversation: FakeConversation) {
  const root = await mkdtemp(path.join(os.tmpdir(), "ajour-deck-chat-"));
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
  expect(
    (
      await apiRequest(api.baseUrl, `${deck}/open`, {
        repository: REPOSITORY,
        number: 482,
      })
    ).status,
  ).toBe(200);
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
    stream,
    guide() {
      return apiRequest(api.baseUrl, `${deck}/guide`, {
        repository: REPOSITORY,
        number: 482,
        head: HEAD,
      });
    },
    consent() {
      return apiRequest(api.baseUrl, `${deck}/consent`, {
        repository: REPOSITORY,
        cli: "claude-code",
      });
    },
    chat(body: Record<string, unknown> = {}) {
      return apiRequest(api.baseUrl, `${deck}/chat`, {
        repository: REPOSITORY,
        number: 482,
        head: HEAD,
        message: "Post what you found.",
        ...body,
      });
    },
    ask() {
      return apiRequest(api.baseUrl, `${deck}/ask`, {
        repository: REPOSITORY,
        number: 482,
        head: HEAD,
        anchor: { kind: "concern", id: "g1" },
      });
    },
    async ended(turnId: string) {
      await stream.waitFor(
        "agent-turn",
        (event) =>
          (event as AgentTurnEvent).type === "ended" &&
          (event as { turnId: string }).turnId === turnId,
      );
    },
    actions(turnId: string): AgentTurnAction[] {
      return turnEvents().flatMap((event) =>
        event.type === "action" && event.turnId === turnId
          ? [event.action]
          : [],
      );
    },
    /** Answers the window's side of each draft comment the bridge hands it. */
    answerDraftComments(draftId = "draft-1") {
      const seen = new Set<string>();
      const answer = async () => {
        for (const event of stream.events) {
          if (event.event !== "tool-call") continue;
          const data = event.data as {
            requestId: string;
            tool: string;
            input: unknown;
          };
          if (seen.has(data.requestId)) continue;
          seen.add(data.requestId);
          drafts.push(data.input);
          await apiRequest(api.baseUrl, "/api/mcp/bridge/results", {
            requestId: data.requestId,
            ok: true,
            output: { draftId },
          });
        }
      };
      const drafts: unknown[] = [];
      const timer = setInterval(() => void answer(), 10);
      stops.push(() => clearInterval(timer));
      return drafts;
    },
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

describe("Deck's chat writes", () => {
  it(
    "makes each review write the user can through the code host, each coming back as an action line, and offers no merge",
    { timeout: 30_000 },
    async () => {
      const api = await startChatApi(() => [
        { readTurn: true },
        { mcp: { method: "tools/list" } },
        call("post_comment", {
          body: "Why upper case?",
          lines: { path: "src/api.ts", side: "head", line: 2 },
        }),
        call("post_comment", { body: "Looks good overall." }),
        call("reply_to_thread", { threadId: "t1", body: "Fixed." }),
        call("resolve_thread", { threadId: "t1", resolved: true }),
        call("submit_review", { verdict: "approve", body: "Ship it." }),
        call("edit_title", { title: "Shout the second line" }),
        call("set_draft", { draft: true }),
        call("add_draft_comment", {
          path: "src/api.ts",
          side: "base",
          line: 2,
          body: "This was lower case.",
        }),
        call("merge_pull_request", { method: "squash" }),
        { stream: ["Done."] },
        { result: true },
        { readTurn: true },
      ]);
      await api.consent();
      const drafts = api.answerDraftComments();

      const chatted = await api.chat({ author: true });
      expect(chatted.status).toBe(201);
      expect(chatted.body.turn).toMatchObject({ task: "deck.chat" });
      await api.ended(chatted.body.turn.id);

      const [list, ...replies] = await api.mcpReplies();
      const tools = list!.reply.result.tools.map(
        (tool: { name: string }) => tool.name,
      );
      expect(tools).toEqual([
        "read_hunks",
        "read_file",
        "read_threads",
        "read_guide",
        // A regroup asked for in the chat (#794).
        "submit_guide",
        "add_draft_comment",
        "post_comment",
        "reply_to_thread",
        "resolve_thread",
        "submit_review",
        "edit_title",
        "set_draft",
      ]);
      expect(tools.some((name: string) => /merge/i.test(name))).toBe(false);

      expect(
        hostWrites().map(({ operation, request }) => ({
          operation,
          ...request,
        })),
      ).toEqual([
        {
          operation: "postComment",
          repository: REPOSITORY,
          number: 482,
          body: "Why upper case?",
          anchor: { path: "src/api.ts", side: "head", line: 2, headSha: HEAD },
          submissionId: expect.stringMatching(/^chat_/),
        },
        {
          operation: "postComment",
          repository: REPOSITORY,
          number: 482,
          body: "Looks good overall.",
          submissionId: expect.stringMatching(/^chat_/),
        },
        {
          operation: "replyToThread",
          repository: REPOSITORY,
          number: 482,
          threadId: "t1",
          body: "Fixed.",
          submissionId: expect.stringMatching(/^chat_/),
        },
        {
          operation: "setThreadResolved",
          repository: REPOSITORY,
          number: 482,
          threadId: "t1",
          resolved: true,
        },
        {
          operation: "submitReview",
          repository: REPOSITORY,
          number: 482,
          headSha: HEAD,
          verdict: "approve",
          body: "Ship it.",
          comments: [],
          submissionId: expect.stringMatching(/^chat_/),
        },
        {
          operation: "updatePullRequest",
          repository: REPOSITORY,
          number: 482,
          title: "Shout the second line",
        },
        {
          operation: "updatePullRequest",
          repository: REPOSITORY,
          number: 482,
          draft: true,
        },
      ]);
      // The draft comment went to the window's draft review, not the code host.
      expect(drafts).toEqual([
        {
          pluginId: "github",
          connectionId: expect.any(String),
          repository: REPOSITORY,
          number: 482,
          headSha: HEAD,
          anchor: { path: "src/api.ts", side: "base", line: 2 },
          body: "This was lower case.",
          lineText: "two",
        },
      ]);

      const actions = api.actions(chatted.body.turn.id);
      expect(
        actions.map(({ kind, text, url, posted }) => ({
          kind,
          text,
          ...(url ? { url } : {}),
          ...(posted ? { posted } : {}),
        })),
      ).toEqual([
        {
          kind: "comment",
          text: "Commented on src/api.ts:2",
          url: "https://github.com/acme/billing-api/pull/482#c1",
          posted: { kind: "comment", commentId: "c-1" },
        },
        {
          kind: "comment",
          text: "Commented on the pull request",
          url: "https://github.com/acme/billing-api/pull/482#c2",
          posted: { kind: "comment", commentId: "c-2" },
        },
        {
          kind: "reply",
          text: "Replied in a thread",
          posted: { kind: "comment", commentId: "c-3" },
        },
        { kind: "resolve", text: "Resolved a thread" },
        {
          kind: "review",
          text: "Approved the pull request",
          url: "https://github.com/acme/billing-api/pull/482#r1",
        },
        {
          kind: "title",
          text: "Renamed the pull request “Shout the second line”",
        },
        { kind: "draft", text: "Turned the pull request into a draft" },
        {
          kind: "draft_comment",
          text: "Added a draft comment on src/api.ts:2",
          posted: { kind: "draft_comment", draftId: "draft-1" },
        },
      ]);
      expect(actions[0]!.at).toEqual({
        path: "src/api.ts",
        side: "head",
        line: 2,
      });
      expect(actions[6]!.edited).toEqual({
        title: "Shout the second line",
        draft: true,
      });

      // Asked to merge by name, the agent hears why not, and nothing merged.
      const merge = replies.at(-1)!;
      expect(merge.reply.result.isError).toBe(true);
      expect(merge.reply.result.content[0].text).toContain(
        "Ajour never merges a pull request for an agent",
      );
      expect(
        hostWrites().some(({ operation }) => operation === "mergePullRequest"),
      ).toBe(false);
      expect(
        api.events.find(
          (event) =>
            event.name === "agent_tool.call" &&
            event.outcome_reason === "merge_refused",
        ),
      ).toBeDefined();
      expect(
        api.events.find(
          (event) => event.name === "deck.chat" && event.kind === "request",
        ),
      ).toMatchObject({ outcome: "ok" });
    },
  );

  it(
    "refuses every write in an ask's turn: only a chat turn writes",
    { timeout: 20_000 },
    async () => {
      const api = await startChatApi(() => [
        { readTurn: true },
        call("post_comment", { body: "Sneaky." }),
        { stream: ["An answer."] },
        { result: true },
        { readTurn: true },
      ]);
      await api.consent();

      const asked = await api.ask();
      await api.ended(asked.body.turn.id);

      const [refused] = await api.mcpReplies();
      expect(refused!.reply.result.isError).toBe(true);
      expect(refused!.reply.result.content[0].text).toContain(
        "only in a chat turn",
      );
      expect(hostWrites()).toEqual([]);
      expect(api.actions(asked.body.turn.id)).toEqual([]);
    },
  );

  it(
    "refuses the title and the draft state when the user isn't the pull request's author",
    { timeout: 20_000 },
    async () => {
      const api = await startChatApi(() => [
        { readTurn: true },
        call("edit_title", { title: "Mine now" }),
        call("set_draft", { draft: true }),
        { stream: ["No."] },
        { result: true },
        { readTurn: true },
      ]);
      await api.consent();

      const chatted = await api.chat();
      await api.ended(chatted.body.turn.id);

      const replies = await api.mcpReplies();
      expect(replies.map((reply) => reply.reply.result.isError)).toEqual([
        true,
        true,
      ]);
      expect(replies[0]!.reply.result.content[0].text).toContain(
        "Only the pull request's author",
      );
      expect(hostWrites()).toEqual([]);
    },
  );

  it(
    "refuses a comment on lines the diff doesn't show",
    { timeout: 20_000 },
    async () => {
      const api = await startChatApi(() => [
        { readTurn: true },
        call("post_comment", {
          body: "Here?",
          lines: { path: "src/api.ts", side: "head", line: 40 },
        }),
        { stream: ["No."] },
        { result: true },
        { readTurn: true },
      ]);
      await api.consent();

      const chatted = await api.chat();
      await api.ended(chatted.body.turn.id);

      const [refused] = await api.mcpReplies();
      expect(refused!.reply.result.content[0].text).toContain(
        "doesn't show src/api.ts:40",
      );
      expect(hostWrites()).toEqual([]);
    },
  );
});

describe("regroup from the chat (#794)", () => {
  it(
    "saves the guide the chat's agent submits, shows it as an action line, and goes on with the chat",
    { timeout: 20_000 },
    async () => {
      const api = await startChatApi(() => [
        { readTurn: true },
        call("submit_guide", {
          concerns: [
            {
              title: "Shout the second line",
              rationale: "The handler upper-cases it.",
              hunkIds: ["src/api.ts#0"],
              kinds: ["feature"],
            },
          ],
          summary: {
            problem: {
              text: "Quiet handlers go unnoticed.",
              source: "inferred",
            },
            breaking: [],
            risks: [],
          },
        }),
        { stream: ["Regrouped."] },
        { result: true },
        { readTurn: true },
      ]);
      await api.consent();

      const chatted = await api.chat({ message: "Regroup the guide." });
      await api.ended(chatted.body.turn.id);

      const [saved] = await api.mcpReplies();
      expect(saved!.reply.result.structuredContent).toEqual({
        saved: true,
        concernCount: 1,
      });
      expect(
        api.actions(chatted.body.turn.id).map(({ kind, text }) => ({
          kind,
          text,
        })),
      ).toEqual([{ kind: "regroup", text: "Regrouped the guide" }]);
      expect(
        api.stream.events.find(
          (event) =>
            event.event === "agent-turn" &&
            (event.data as AgentTurnEvent).type === "ended",
        )?.data,
      ).toMatchObject({ outcome: "done" });
      const guide = await api.guide();
      expect(guide.body.guide).toMatchObject({
        madeWith: "agent",
        concerns: [expect.objectContaining({ title: "Shout the second line" })],
      });
    },
  );
});

describe("a chat message", () => {
  it(
    "sends nothing to the agent before the repository's consent",
    { timeout: 20_000 },
    async () => {
      const api = await startChatApi(() => [{ readTurn: true }]);

      const chatted = await api.chat();

      expect(chatted.status).toBe(409);
      expect(chatted.body).toMatchObject({
        reason: "needs_consent",
        repository: REPOSITORY,
      });
      expect(await api.launches()).toEqual([]);
    },
  );

  it(
    "carries its chip's anchor in, written from what Ajour holds, then the message",
    { timeout: 20_000 },
    async () => {
      const api = await startChatApi(() => [
        { readTurn: true },
        { stream: ["Because."] },
        { result: true },
        { readTurn: true },
      ]);
      await api.consent();

      const chatted = await api.chat({
        message: "Why does it shout?",
        anchor: { kind: "concern", id: "g1" },
      });
      await api.ended(chatted.body.turn.id);

      const [turn] = await api.turnsRead();
      expect(turn).toContain(
        'The user continues from the guide\'s concern "Upper-case the second line", whose hunks are src/api.ts#0.',
      );
      expect(turn).toContain("The user's message:");
      expect(turn).toContain("Why does it shout?");
      expect(DECK_DRAFT_COMMENT_TOOL).toBe("deck_add_draft_comment");
    },
  );
});
