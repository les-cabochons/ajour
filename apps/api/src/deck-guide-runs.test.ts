import os from "node:os";
import path from "node:path";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentTurnEvent } from "../../../packages/shared/agent-runs.ts";
import type { DeckSubmitGuideInput } from "../../../packages/shared/deck.ts";
import { deckPullRequestKey } from "../../../packages/shared/deck.ts";
import { createDeckContentCache } from "./deck-content-cache.ts";
import {
  createGuideBuilds,
  type DeckGuideRuntime,
} from "./deck-guide-builds.ts";
import { createDeckGuideRuns } from "./deck-guide-runs.ts";
import { createDeckService } from "./deck-service.ts";
import { addedFileCodeHost, builtFrom } from "./test-support/deck-guides.ts";
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
 * Regroup through the local API (#794): a `deck.guide` turn of the pull
 * request's conversation, with the fake CLI as Claude Code. The agent hands
 * its guide back through `submit_guide`: a submission that breaks a rule
 * goes back to it with the problem, the first one that keeps them is saved
 * as the agent's guide, naming it, and Deck shows it until the user goes
 * back to the guide built from the code.
 */

const ICON = "<svg viewBox='0 0 16 16'><path d='M0 0h16v16H0z' /></svg>";
const HEAD = "a41c9e2f0d";
const BASE = "b52d0f3a11";
const REPOSITORY = "acme/billing-api";
const API = "src/api.ts#0";
const TEST = "src/api.test.ts#0";

/** Counts the ticket reads across the module's loads: the runtime loads it per call. */
const pluginSource = (tickets: unknown[], ticketsFailFirst: boolean) => `
export async function validateConnection({ config }) {
  return { normalizedConfig: config, connectionSummary: {} };
}
export async function getPullRequestContent() {
  return {
    headSha: ${JSON.stringify(HEAD)},
    baseSha: ${JSON.stringify(BASE)},
    files: [
      { path: "src/api.test.ts", status: "added", additions: 1, deletions: 0, binary: false },
      { path: "src/api.ts", status: "modified", additions: 1, deletions: 1, binary: false },
    ],
  };
}
export async function getFileContent(connection, request) {
  const head = request.sha === ${JSON.stringify(HEAD)};
  if (request.path === "src/api.ts") {
    return { kind: "text", content: head ? "one\\nTWO\\nthree\\n" : "one\\ntwo\\nthree\\n" };
  }
  if (request.path === "src/api.test.ts" && head) {
    return { kind: "text", content: "test('api shouts');\\n" };
  }
  return { kind: "missing" };
}
export async function getLinkedTickets() {
  globalThis.__ajourTicketReads = (globalThis.__ajourTicketReads ?? 0) + 1;
  if (${ticketsFailFirst} && globalThis.__ajourTicketReads === 1) {
    throw new Error("The tracker is down.");
  }
  return { tickets: ${JSON.stringify(tickets)} };
}
export async function getPullRequestConversation() {
  return {
    description: "Calm the retry storm.",
    timeline: [],
    threads: [],
    viewedPaths: [],
    mergeMethods: ["merge"],
  };
}
`;

/** The pipeline's guide, two concerns; a regroup's concerns get the rules alone. */
const guideRuntime: DeckGuideRuntime = {
  build: async (input) =>
    builtFrom(
      input,
      input.concerns ?? [
        {
          id: "g1",
          title: "Upper-case the second line",
          rationale: "The handler now shouts.",
          hunkIds: [API],
        },
        { id: "g2", title: "Test it", rationale: "", hunkIds: [TEST] },
      ],
    ),
  close: async () => {},
};

const stops: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const stop of stops.splice(0).reverse()) await stop();
  delete (globalThis as { __ajourTicketReads?: number }).__ajourTicketReads;
});

async function createCodeHostPlugin(
  parent: string,
  tickets: unknown[],
  ticketsFailFirst: boolean,
) {
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
  await writeFile(
    path.join(directory, "plugin.mjs"),
    pluginSource(tickets, ticketsFailFirst),
    "utf8",
  );
  return directory;
}

const submitCall = (input: unknown) => ({
  method: "tools/call",
  params: { name: "submit_guide", arguments: input },
});
const submit = (input: unknown) => ({ mcp: submitCall(input) });

/**
 * The guide runtime with each regroup's build held until `release`:
 * `regrouping` resolves once one is asked for.
 */
function heldRegroupRuntime() {
  let release!: () => void;
  const released = new Promise<void>((resolve) => (release = resolve));
  let started!: () => void;
  const regrouping = new Promise<void>((resolve) => (started = resolve));
  const runtime: DeckGuideRuntime = {
    async build(input, signal) {
      if (input.concerns) {
        started();
        await released;
      }
      return guideRuntime.build(input, signal);
    },
    close: async () => {},
  };
  return { runtime, regrouping, release };
}

/** A guide that keeps every rule: the code, then its test. */
const regrouped = (
  change: (input: DeckSubmitGuideInput) => void = () => {},
): DeckSubmitGuideInput => {
  const input: DeckSubmitGuideInput = {
    concerns: [
      {
        title: "Shout the second line",
        rationale: "The handler upper-cases it.",
        hunkIds: [API],
        kinds: ["feature"],
      },
      {
        title: "Test the shouting",
        rationale: "",
        hunkIds: [TEST],
        kinds: [],
      },
    ],
    summary: {
      problem: { text: "Quiet handlers go unnoticed.", source: "inferred" },
      breaking: [{ text: "The second line's case changed", hunkIds: [API] }],
      risks: [],
    },
  };
  change(input);
  return input;
};

/**
 * The API with the fake GitHub plugin and the fake CLI as Claude Code,
 * pull request #482 open in Deck, its repository allowed unless `consent`
 * is false, and the window's event stream open with MCP off.
 */
async function startGuideApi(
  conversation: FakeConversation,
  {
    tickets = [] as unknown[],
    /** What the repository is allowed for: the context, the code, or nothing. */
    consent = true as boolean | "code",
    /** The guide's build can't read the tickets; the regroup's read can. */
    ticketsFailFirst = false,
    runtime = guideRuntime,
  } = {},
) {
  const root = await mkdtemp(path.join(os.tmpdir(), "ajour-deck-guide-"));
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
    developmentPluginDirectories: [
      await createCodeHostPlugin(root, tickets, ticketsFailFirst),
    ],
    deckGuideRuntime: runtime,
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
  const ref = { repository: REPOSITORY, number: 482 };
  const opened = await apiRequest(api.baseUrl, `${deck}/open`, ref);
  expect(opened.status).toBe(200);
  if (consent) {
    expect(
      (
        await apiRequest(api.baseUrl, `${deck}/consent`, {
          repository: REPOSITORY,
          cli: "claude-code",
          covers: consent === "code" ? "code" : "context",
        })
      ).status,
    ).toBe(200);
  }
  const stream = await openEventStream(api.baseUrl, "/api/handoffs/bridge");
  stops.push(stream.close);

  const reportLines = async () =>
    (await readFile(report, "utf8").catch(() => ""))
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, any>);

  return {
    ...api,
    regroup(instruction?: string) {
      return apiRequest(api.baseUrl, `${deck}/regroup`, {
        ...ref,
        head: HEAD,
        ...(instruction ? { instruction } : {}),
      });
    },
    async guide() {
      return (
        await apiRequest(api.baseUrl, `${deck}/guide`, { ...ref, head: HEAD })
      ).body.guide;
    },
    stop(turnId: string) {
      return apiRequest(api.baseUrl, `/api/agent-turns/${turnId}/cancel`, {});
    },
    chat(message: string) {
      return apiRequest(api.baseUrl, `${deck}/chat`, {
        ...ref,
        head: HEAD,
        message,
      });
    },
    /** The action lines of a turn, as the window gets them. */
    actionsOf(turnId: string) {
      return stream.events.flatMap((event) => {
        const data = event.data as AgentTurnEvent;
        return event.event === "agent-turn" &&
          data.type === "action" &&
          data.turnId === turnId
          ? [data.action]
          : [];
      });
    },
    revoke() {
      return apiRequest(api.baseUrl, "/api/deck/consents/revoke", {
        pluginId: "github",
        connectionId,
        repository: REPOSITORY,
      });
    },
    revert() {
      return apiRequest(api.baseUrl, `${deck}/guide/revert`, {
        ...ref,
        head: HEAD,
      });
    },
    open() {
      return apiRequest(api.baseUrl, `${deck}/open`, {
        ...ref,
        headSha: HEAD,
      });
    },
    ask(anchor: Record<string, unknown>) {
      return apiRequest(api.baseUrl, `${deck}/ask`, {
        ...ref,
        head: HEAD,
        anchor,
      });
    },
    async endingOf(turnId: string) {
      await stream.waitFor(
        "agent-turn",
        (event) =>
          (event as AgentTurnEvent).type === "ended" &&
          (event as { turnId: string }).turnId === turnId,
      );
      return stream.events
        .map((event) => event.data as AgentTurnEvent)
        .find((event) => event.type === "ended" && event.turnId === turnId);
    },
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
    /** Waits for the `submit_guide` call's event: its call answered. */
    async submitAnswered() {
      const called = () =>
        api.events.find(
          (event) =>
            event.name === "agent_tool.call" &&
            (event as { agent_tool?: { name?: string } }).agent_tool?.name ===
              "submit_guide",
        );
      return vi.waitFor(
        () => {
          const event = called();
          if (!event) throw new Error("submit_guide isn't answered yet.");
          return event;
        },
        { timeout: 10_000, interval: 20 },
      );
    },
    async mcpReplies() {
      return (await reportLines()).flatMap((line) =>
        line.mcp ? [line.mcp as { status: number; reply: any }] : [],
      );
    },
  };
}

/** The text of a tool call's reply. */
const replyText = (reply: { reply: any }) =>
  (reply.reply.result.content as { text: string }[])
    .map((part) => part.text)
    .join("");

describe("a regroup", () => {
  it(
    "gives a rejected submission back with its problem, saves the first valid one as the agent's guide and ends the turn, and goes back to the built one",
    { timeout: 30_000 },
    async () => {
      const api = await startGuideApi(() => [
        { readTurn: true },
        submit(
          regrouped((input) => {
            input.concerns[1]!.hunkIds = [API];
          }),
        ),
        submit(regrouped()),
        submit(regrouped()),
        // The first valid guide ends the turn: Ajour interrupts the CLI.
        { waitForInterrupt: true },
        { result: true },
        { readTurn: true },
      ]);

      const started = await api.regroup("Put tests with what they test");

      expect(started.status).toBe(201);
      expect(started.body.turn.task).toBe("deck.guide");
      expect(await api.endingOf(started.body.turn.id)).toMatchObject({
        outcome: "done",
      });
      const [rejected, saved, again] = await api.mcpReplies();
      expect(rejected!.reply.result.isError).toBe(true);
      expect(replyText(rejected!)).toBe(
        `Ajour didn't save this guide: Hunks ${API} are in more than one concern. Put each hunk in exactly one. Fix it and call submit_guide again.`,
      );
      expect(saved!.reply.result.structuredContent).toEqual({
        saved: true,
        concernCount: 2,
      });
      expect(again!.reply.result.isError).toBe(true);
      expect(replyText(again!)).toContain("already saved");

      const guide = await api.guide();
      expect(guide).toMatchObject({
        madeWith: "agent",
        provider: { cli: "claude-code", label: "Claude Code" },
        concerns: [
          {
            title: "Shout the second line",
            hunkIds: [API],
            kinds: ["breaking", "feature"],
          },
          { title: "Test the shouting", hunkIds: [TEST], kinds: ["tests"] },
        ],
        summary: {
          problem: { text: "Quiet handlers go unnoticed.", source: "inferred" },
          tickets: [],
          // The agent's kinds with the rules'.
          kinds: ["breaking", "feature", "tests"],
          breaking: [
            { text: "The second line's case changed", hunkIds: [API] },
          ],
        },
      });
      // The rules ran again on the agent's concerns.
      expect(guide.summary.tests).toEqual([
        expect.objectContaining({ concernId: guide.concerns[1].id }),
      ]);
      // Opening it again shows the agent's guide.
      expect((await api.open()).body.guide.madeWith).toBe("agent");

      const reverted = await api.revert();

      expect(reverted.status).toBe(200);
      expect(reverted.body.guide).toMatchObject({
        madeWith: "code",
        concerns: [{ id: "g1" }, { id: "g2" }],
      });
      expect((await api.guide()).madeWith).toBe("code");
      expect((await api.open()).body.guide.madeWith).toBe("code");
    },
  );

  it(
    "writes the turn from the guide, its hunks and the pull request's description and ticket, with the user's instruction",
    { timeout: 30_000 },
    async () => {
      const ticket = {
        number: 12,
        title: "Handlers are too quiet",
        body: "Nobody hears the second line.",
        url: "https://github.com/acme/billing-api/issues/12",
        state: "Open",
      };
      const api = await startGuideApi(
        () => [
          { readTurn: true },
          submit(regrouped()),
          submit(
            regrouped((input) => {
              input.summary.problem = {
                text: "The second line goes unheard.",
                source: "ticket",
                ticket: { number: 12 },
              };
            }),
          ),
          { result: true },
          { readTurn: true },
        ],
        { tickets: [ticket] },
      );

      const started = await api.regroup("Put tests with what they test");
      await api.endingOf(started.body.turn.id);

      const [turn] = await api.turnsRead();
      expect(turn).toContain(
        "The user's instruction for the new guide: Put tests with what they test",
      );
      expect(turn).toContain("Calm the retry storm.");
      expect(turn).toContain("#12 (Open): Handlers are too quiet");
      expect(turn).toContain("Nobody hears the second line.");
      expect(turn).toContain(`1. Upper-case the second line — ${API}`);
      expect(turn).toContain("+TWO");
      // An inferred problem with a ticket linked goes back to the agent.
      const [inferred] = await api.mcpReplies();
      expect(replyText(inferred!)).toContain(
        'write the problem from the ticket, with source "ticket"',
      );
      expect((await api.guide()).summary.problem).toEqual({
        text: "The second line goes unheard.",
        source: "ticket",
        ticket: {
          number: 12,
          title: "Handlers are too quiet",
          url: ticket.url,
          state: "Open",
        },
      });
    },
  );

  it(
    "checks the problem against the tickets the turn quoted, read again for the regroup",
    { timeout: 30_000 },
    async () => {
      const ticket = {
        number: 12,
        title: "Handlers are too quiet",
        body: "",
        url: "https://github.com/acme/billing-api/issues/12",
        state: "Open",
      };
      const api = await startGuideApi(
        () => [
          { readTurn: true },
          submit(
            regrouped((input) => {
              input.summary.problem = {
                text: "The second line goes unheard.",
                source: "ticket",
                ticket: { number: 12 },
              };
            }),
          ),
          { waitForInterrupt: true },
          { result: true },
          { readTurn: true },
        ],
        { tickets: [ticket], ticketsFailFirst: true },
      );
      // The build couldn't read the tickets.
      expect((await api.guide()).summary.tickets).toBeNull();

      const started = await api.regroup();

      expect(await api.endingOf(started.body.turn.id)).toMatchObject({
        outcome: "done",
      });
      expect((await api.guide()).summary).toMatchObject({
        problem: { source: "ticket", ticket: { number: 12 } },
        tickets: [{ number: 12, title: "Handlers are too quiet" }],
      });
    },
  );

  it(
    "fails a guide turn that ends with no guide saved, and keeps the built one",
    { timeout: 30_000 },
    async () => {
      const api = await startGuideApi(() => [
        { readTurn: true },
        submit(regrouped((input) => (input.concerns = []))),
        { stream: ["I couldn't."] },
        { result: true },
        { readTurn: true },
      ]);

      const started = await api.regroup();

      expect(await api.endingOf(started.body.turn.id)).toMatchObject({
        outcome: "failed",
        error: "The agent didn't return a guide Ajour could use.",
      });
      expect((await api.guide()).madeWith).toBe("code");
    },
  );

  it(
    "refuses submit_guide outside a guide turn, though a conversation's client lists it",
    { timeout: 30_000 },
    async () => {
      const api = await startGuideApi(() => [
        { readTurn: true },
        { mcp: { method: "tools/list" } },
        submit(regrouped()),
        { stream: ["Detail."] },
        { result: true },
        { readTurn: true },
      ]);

      const asked = await api.ask({ kind: "concern", id: "g1" });
      await api.endingOf(asked.body.turn.id);

      const [list, refused] = await api.mcpReplies();
      expect(
        list!.reply.result.tools.map((tool: { name: string }) => tool.name),
      ).toContain("submit_guide");
      expect(refused!.reply.result.isError).toBe(true);
      expect(replyText(refused!)).toContain(
        "submit_guide answers only while Ajour regroups",
      );
      expect((await api.guide()).madeWith).toBe("code");
    },
  );

  it(
    "saves one guide of two submitted at once",
    { timeout: 30_000 },
    async () => {
      const api = await startGuideApi(() => [
        { readTurn: true },
        {
          mcp: [
            submitCall(regrouped()),
            submitCall(
              regrouped((input) => {
                input.concerns[0]!.title = "Shout it";
              }),
            ),
          ],
        },
        { waitForInterrupt: true },
        { result: true },
        { readTurn: true },
      ]);

      const started = await api.regroup();

      expect(await api.endingOf(started.body.turn.id)).toMatchObject({
        outcome: "done",
      });
      const [batch] = await api.mcpReplies();
      const replies = batch!.reply as { result: any }[];
      const saved = replies.filter(
        (reply) => reply.result.structuredContent?.saved === true,
      );
      expect(saved).toHaveLength(1);
      // Checked in the order sent: the first is saved, the second refused.
      expect(replies[0]!.result.structuredContent?.saved).toBe(true);
      expect(replyText({ reply: replies[1] })).toContain("already saved");
      expect((await api.guide()).concerns[0].title).toBe(
        "Shout the second line",
      );
    },
  );

  it(
    "saves nothing once the turn is stopped while the guide is built, though the user went back to the built one meanwhile",
    { timeout: 30_000 },
    async () => {
      const held = heldRegroupRuntime();
      const api = await startGuideApi(
        () => [
          { readTurn: true },
          submit(regrouped()),
          { result: true },
          { readTurn: true },
        ],
        { runtime: held.runtime },
      );
      const started = await api.regroup();
      await held.regrouping;

      expect((await api.stop(started.body.turn.id)).status).toBe(200);
      expect((await api.revert()).status).toBe(200);
      held.release();

      await api.submitAnswered();
      await api.endingOf(started.body.turn.id);
      expect((await api.guide()).madeWith).toBe("code");
      const [refused] = await api.mcpReplies();
      if (refused) {
        expect(replyText(refused)).toContain(
          "This regroup ended before Ajour saved its guide",
        );
      }
    },
  );

  it(
    "saves nothing once the repository's consent is revoked while the guide is built",
    { timeout: 30_000 },
    async () => {
      const held = heldRegroupRuntime();
      const api = await startGuideApi(
        () => [
          { readTurn: true },
          submit(regrouped()),
          { result: true },
          { readTurn: true },
        ],
        { runtime: held.runtime },
      );
      const started = await api.regroup();
      await held.regrouping;

      expect((await api.revoke()).status).toBe(200);
      held.release();

      // The revoke ended the CLI, so the call's answer reaches no one, but
      // Ajour still settles the submission: its event says so.
      await api.endingOf(started.body.turn.id);
      expect(await api.submitAnswered()).toMatchObject({
        outcome: "refused",
        outcome_reason: "tool_refused",
      });
      expect((await api.guide()).madeWith).toBe("code");
    },
  );

  it(
    "asks for the repository's consent before anything reaches the agent",
    { timeout: 30_000 },
    async () => {
      const api = await startGuideApi(() => [{ readTurn: true }], {
        consent: false,
      });

      const refused = await api.regroup();

      expect(refused.status).toBe(409);
      expect(refused.body).toMatchObject({
        reason: "needs_consent",
        provider: { cli: "claude-code", label: "Claude Code" },
      });
      expect(await api.launches()).toEqual([]);
    },
  );
});

describe("a regroup asked for in the chat (#796)", () => {
  const ticket = {
    number: 12,
    title: "Handlers are too quiet",
    body: "Nobody hears the second line.",
    url: "https://github.com/acme/billing-api/issues/12",
    state: "Open",
  };
  const fromTicket = regrouped((input) => {
    input.summary.problem = {
      text: "The second line goes unheard.",
      source: "ticket",
      ticket: { number: 12 },
    };
  });

  it(
    "first hands the agent the description and linked tickets a regroup reads, then saves a guide written from them",
    { timeout: 30_000 },
    async () => {
      const api = await startGuideApi(
        () => [
          { readTurn: true },
          submit(regrouped()),
          submit(fromTicket),
          { stream: ["Regrouped."] },
          { result: true },
          { readTurn: true },
        ],
        { tickets: [ticket] },
      );

      const chatted = await api.chat("Regroup the guide.");
      expect(chatted.status).toBe(201);
      expect(await api.endingOf(chatted.body.turn.id)).toMatchObject({
        outcome: "done",
      });

      const [context, saved] = await api.mcpReplies();
      expect(context!.reply.result.isError).toBe(true);
      const text = replyText(context!);
      expect(text).toContain("saved nothing");
      expect(text).toContain("Calm the retry storm.");
      expect(text).toContain("#12 (Open): Handlers are too quiet");
      expect(text).toContain("Nobody hears the second line.");
      expect(saved!.reply.result.structuredContent).toEqual({
        saved: true,
        concernCount: 2,
      });
      expect((await api.guide()).summary.problem).toMatchObject({
        source: "ticket",
        ticket: { number: 12, title: "Handlers are too quiet" },
      });
      expect(
        api.actionsOf(chatted.body.turn.id).map(({ kind }) => kind),
      ).toEqual(["regroup"]);
    },
  );

  it(
    "saves nothing while the repository is allowed for the code alone, and has the agent send the user to Regroup…",
    { timeout: 30_000 },
    async () => {
      const api = await startGuideApi(
        () => [
          { readTurn: true },
          submit(fromTicket),
          { stream: ["Allow it first."] },
          { result: true },
          { readTurn: true },
        ],
        { tickets: [ticket], consent: "code" },
      );

      const chatted = await api.chat("Regroup the guide.");
      await api.endingOf(chatted.body.turn.id);

      const [refused] = await api.mcpReplies();
      expect(refused!.reply.result.isError).toBe(true);
      expect(replyText(refused!)).toContain("description and linked tickets");
      expect(replyText(refused!)).toContain("Regroup…");
      expect(replyText(refused!)).not.toContain("Calm the retry storm.");
      expect((await api.guide()).madeWith).toBe("code");
      expect(api.actionsOf(chatted.body.turn.id)).toEqual([]);
    },
  );
});

describe("more detail on a summary line", () => {
  it(
    "asks about the line as Ajour holds it, and refuses a line the summary doesn't have",
    { timeout: 30_000 },
    async () => {
      const api = await startGuideApi(() => [
        { readTurn: true },
        { stream: ["It tests the shouting."] },
        { result: true },
        { readTurn: true },
      ]);

      const unknown = await api.ask({ kind: "summary", id: "tests:g9" });
      const asked = await api.ask({ kind: "summary", id: "tests:g2" });
      await api.endingOf(asked.body.turn.id);

      expect(unknown.status).toBe(404);
      expect(unknown.body.reason).toBe("unknown_anchor");
      expect(asked.status).toBe(201);
      const [turn] = await api.turnsRead();
      expect(turn).toContain(
        'The user reads this line of the summary, under "Tests": Tested in src/api.test.ts',
      );
      expect(turn).toContain(`Its hunks: ${TEST}.`);
      expect(turn).toContain("Give more detail on this line of the summary");
    },
  );
});

/*
 * The save's last moment (#794): Deck reads the pull request again, and its
 * built guide, before it writes the agent's. A stop or a revoke while it
 * reads, here from the content cache, must still save nothing.
 */
describe("a guide saved while Deck reads the pull request again", () => {
  const SOURCE = { pluginId: "github", connectionId: "c1" };
  const ref = { repository: "acme/api", number: 20 };
  const pullRequest = deckPullRequestKey({ ...SOURCE, ...ref });
  const binding = { pullRequest, head: "a41c9e2", cli: "claude-code" as const };
  const turn = {
    id: "t1",
    task: "deck.guide" as const,
    pullRequest,
    head: binding.head,
  };
  const codeHost = addedFileCodeHost(binding.head, "b52d0f3");
  const submission: DeckSubmitGuideInput = {
    concerns: [
      {
        title: "Add a",
        rationale: "The module starts.",
        hunkIds: ["a.ts#0"],
        kinds: ["feature"],
      },
    ],
    summary: {
      problem: { text: "There is no module.", source: "inferred" },
      breaking: [],
      risks: [],
    },
  };

  /**
   * Pull request #20 cached, not on screen, and its guide's runs with the
   * turn running and the repository allowed until the test says otherwise.
   * Once a submission's rules are built, the content cache's reads hold
   * until `release`: `holding` resolves when the save's own read waits.
   */
  async function startHeldSave() {
    const root = await mkdtemp(path.join(os.tmpdir(), "ajour-deck-save-"));
    stops.push(() => rm(root, { recursive: true, force: true, maxRetries: 5 }));
    const cache = createDeckContentCache({
      directory: path.join(root, "deck-cache"),
      capBytes: async () => 1_000_000_000,
    });
    let hold: Promise<void> | undefined;
    let release!: () => void;
    let held!: () => void;
    const holding = new Promise<void>((resolve) => (held = resolve));
    const service = createDeckService({
      guides: createGuideBuilds({
        runtime: {
          build: async (input) =>
            builtFrom(
              input,
              input.concerns ?? [
                { id: "g1", title: "A", rationale: "", hunkIds: ["a.ts#0"] },
              ],
            ),
          close: async () => {},
        },
      }),
      cache: {
        ...cache,
        async find(at) {
          if (hold) {
            held();
            await hold;
          }
          return cache.find(at);
        },
      },
    });
    await service.preloadPullRequests(SOURCE, [ref], codeHost);
    await cache.flush();
    const state = { running: true, allowed: true };
    const runs = createDeckGuideRuns({
      deck: {
        held: service.held,
        setAgentGuide: service.setAgentGuide,
        async rulesFor(...args) {
          const built = await service.rulesFor(...args);
          hold = new Promise<void>((resolve) => (release = resolve));
          return built;
        },
      },
      requireConsent: async () => {},
      allowed: async () => state.allowed,
      runningTurnOf: () => (state.running ? turn : undefined),
      startTurn: () => Promise.reject(new Error("No turn starts here.")),
      completeTurn: () => {},
      labelOf: () => "Claude Code",
      readContext: async () => ({}),
    });
    return {
      state,
      holding,
      submit: () => runs.submit("client", binding, submission),
      release: () => release(),
      async agentGuide() {
        hold = undefined;
        return (await cache.find({ ...SOURCE, ...ref, headSha: binding.head }))
          ?.agentGuide;
      },
    };
  }

  it("saves nothing when the turn is stopped while Deck reads it", async () => {
    const save = await startHeldSave();
    const submitted = save.submit();
    await save.holding;

    save.state.running = false;
    save.release();

    await expect(submitted).rejects.toThrow(
      "This regroup ended before Ajour saved its guide",
    );
    expect(await save.agentGuide()).toBeNull();
  });

  it("saves nothing when the repository is revoked while Deck reads it", async () => {
    const save = await startHeldSave();
    const submitted = save.submit();
    await save.holding;

    // The turn still runs: the consent alone refuses the save.
    save.state.allowed = false;
    save.release();

    await expect(submitted).rejects.toThrow(
      "The user no longer allows Ajour to send this repository's code",
    );
    expect(await save.agentGuide()).toBeNull();
  });

  it("saves the guide when nothing changed while Deck read it", async () => {
    const save = await startHeldSave();
    const submitted = save.submit();
    await save.holding;

    save.release();

    await expect(submitted).resolves.toEqual({ saved: true, concernCount: 1 });
    expect((await save.agentGuide())?.madeWith).toBe("agent");
  });
});
