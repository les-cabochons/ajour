import os from "node:os";
import path from "node:path";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentTurnEvent } from "../../../packages/shared/agent-runs.ts";
import type { AjourEvent } from "../../../packages/wide-events/catalog.ts";
import { opencodeAdapter } from "./agent-runner/adapters/opencode.ts";
import { createMcpClient } from "./mcp-clients.ts";
import { AppApiStorage } from "./storage.ts";
import { windowTokenHeader } from "./test-support/window-token.ts";
import {
  fakeCliAdapter,
  fakeCodexAdapter,
  type FakeConversation,
} from "./test-support/fake-cli-adapter.ts";
import {
  apiRequest,
  openEventStream,
  startLocalApi,
  TEST_ORIGIN,
} from "./test-support/local-api.ts";

/**
 * A pull request's conversation through the local API (#778), with the fake
 * CLI playing Claude Code's stream-json. Turn events come on the window's
 * stream that the handoffs bridge opens, which needs no MCP.
 */

const running: (() => Promise<void> | void)[] = [];

/** Each test's fake CLI reports, so the escapees it started are killed after it. */
const reports: string[] = [];

afterEach(async () => {
  try {
    for (const stop of running.splice(0).reverse()) await stop();
  } finally {
    for (const report of reports.splice(0)) await killEscapees(report);
  }
});

/** Kills what a fake CLI's escapee step started, when it still runs. */
async function killEscapees(report: string) {
  const lines = (await readFile(report, "utf8").catch(() => ""))
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { grandchildPid?: number });
  for (const { grandchildPid } of lines) {
    if (grandchildPid === undefined) continue;
    try {
      process.kill(grandchildPid, "SIGKILL");
    } catch {
      // Already gone.
    }
  }
}

const PR = { pullRequest: "pr-482", head: "a41c9e2" };
const OTHER_PR = { pullRequest: "pr-485", head: "b52d0f3" };
const ICON = "<svg viewBox='0 0 16 16'><path d='M0 0h16v16H0z' /></svg>";

/** One turn the fake CLI answers: it reads it, streams `pieces`, and ends it. */
const answer = (...pieces: string[]) => [
  { readTurn: true },
  { stream: pieces },
  { result: true },
];

/** A development plugin with one timesheet task, "Enter in Workday". */
async function createTimesheetPlugin(root: string) {
  const directory = path.join(root, "plugins", "ajp-workday-agent");
  await mkdir(path.join(directory, "prompts"), { recursive: true });
  await writeFile(
    path.join(directory, "plugin.json"),
    JSON.stringify({
      id: "ajp-workday-agent",
      version: "4.0.0",
      apiVersion: 4,
      displayName: "Workday tasks",
      description: "Test agent tasks.",
      iconSvg: ICON,
      capabilities: {
        agentTask: {
          tasks: [
            {
              id: "enter-week",
              label: "Enter in Workday",
              placement: "commit-week",
              prompt: "prompts/enter-week.md",
              estimateMinutes: 5,
              tools: [],
            },
          ],
        },
      },
    }),
    "utf8",
  );
  await writeFile(
    path.join(directory, "prompts", "enter-week.md"),
    "Enter the week of {{weekOf}}.",
    "utf8",
  );
  return directory;
}

interface Launch {
  pid: number;
  argv: string[];
}

/**
 * Starts the API with the fake CLI as Claude Code, which runs
 * `conversation(launch)` for each conversation process and `timesheet` for
 * a timesheet task's run, and opens the window's event stream with MCP off.
 */
async function startConversationApi(
  conversation: FakeConversation,
  options: {
    timesheet?: unknown[];
    idleMs?: number;
    interruptGraceMs?: number;
    stallMs?: number;
    killGraceMs?: number;
    cli?: "claude-code" | "codex" | "opencode";
    statePath?: string;
  } = {},
) {
  const root = await mkdtemp(path.join(os.tmpdir(), "ajour-conversation-"));
  running.push(() => rm(root, { recursive: true, force: true, maxRetries: 5 }));
  const report = path.join(root, "report.jsonl");
  reports.push(report);
  // Where the runner finds `claude` and `codex`. The fake CLI runs in their place.
  const bin = path.join(root, "bin");
  await mkdir(bin);
  for (const name of ["claude", "codex", "opencode"]) {
    await writeFile(path.join(bin, name), "#!/bin/sh\nexit 0\n", {
      mode: 0o755,
    });
  }
  let mcpUrl = "";
  const api = await startLocalApi({
    developmentPluginDirectories: [await createTimesheetPlugin(root)],
    allowDevelopmentPlugins: true,
    agentCliPath: bin,
    agentCliAdapters: [
      fakeCliAdapter(
        options.timesheet ?? [{ exit: 0 }],
        report,
        () => mcpUrl,
        conversation,
      ),
      fakeCodexAdapter(report, () => mcpUrl, conversation),
      opencodeAdapter,
    ],
    ...(options.idleMs ? { agentConversationIdleMs: options.idleMs } : {}),
    agentInterruptGraceMs: options.interruptGraceMs ?? 5000,
    ...(options.stallMs ? { agentTurnStallMs: options.stallMs } : {}),
    ...(options.killGraceMs ? { agentKillGraceMs: options.killGraceMs } : {}),
    ...(options.statePath ? { statePath: options.statePath } : {}),
  });
  running.push(api.stop);
  mcpUrl = `${api.baseUrl}/mcp/ajour`;
  await apiRequest(api.baseUrl, "/api/agents/settings", {
    cli: options.cli ?? "claude-code",
    browserMode: "my-chrome",
  });
  const stream = await openEventStream(api.baseUrl, "/api/handoffs/bridge");
  running.push(stream.close);

  const turnEvents = () =>
    stream.events
      .filter((event) => event.event === "agent-turn")
      .map((event) => event.data as AgentTurnEvent);
  const reportLines = async () =>
    (await readFile(report, "utf8").catch(() => ""))
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, any>);

  return {
    ...api,
    async startTurn(
      body: Record<string, unknown> = {},
    ): Promise<{ status: number; body: any }> {
      return apiRequest(api.baseUrl, "/api/agent-runs", {
        task: "deck.ask",
        ...PR,
        ...body,
      });
    },
    startTimesheetTask() {
      return apiRequest(api.baseUrl, "/api/agent-runs", {
        pluginId: "ajp-workday-agent",
        taskId: "enter-week",
        weekOf: "2026-10-12",
      });
    },
    cancel(turnId: string) {
      return apiRequest(api.baseUrl, `/api/agent-turns/${turnId}/cancel`, {});
    },
    /** The first `agent-turn` event of `type` that matches. */
    waitForTurnEvent<Type extends AgentTurnEvent["type"]>(
      type: Type,
      matches: (
        event: Extract<AgentTurnEvent, { type: Type }>,
      ) => boolean = () => true,
    ) {
      return stream.waitFor<Extract<AgentTurnEvent, { type: Type }>>(
        "agent-turn",
        (event) =>
          event.type === type &&
          matches(event as Extract<AgentTurnEvent, { type: Type }>),
      );
    },
    /** A turn's own events, in order. */
    eventsOf(turnId: string) {
      return turnEvents().filter(
        (event) => "turnId" in event && event.turnId === turnId,
      );
    },
    turnEvents,
    /** Each process the fake CLI started, in order. */
    async launches(): Promise<Launch[]> {
      return (await reportLines()).filter(
        (line): line is Launch => typeof line.pid === "number",
      );
    },
    /** Each turn the fake CLI read on stdin, in order. */
    async turnsRead(): Promise<string[]> {
      return (await reportLines())
        .filter((line) => line.stdin?.type === "user")
        .map((line) => String(line.stdin.message.content));
    },
    /** Each turn a Codex process read on stdin, in order. */
    async codexTurnsRead(): Promise<string[]> {
      return (await reportLines()).flatMap((line) =>
        typeof line.codexTurn === "string" ? [line.codexTurn] : [],
      );
    },
    /** The active MCP clients, as Settings > MCP lists them. */
    async clients(): Promise<{ id: string; name: string }[]> {
      return (await apiRequest(api.baseUrl, "/api/mcp/settings")).body.clients;
    },
    async currentRun() {
      return (await apiRequest(api.baseUrl, "/api/agent-runs/current")).body
        .run;
    },
    async mcpReplies() {
      return (await reportLines()).flatMap((line) =>
        line.mcp ? [line.mcp as { status: number; reply: any }] : [],
      );
    },
  };
}

const named = (events: AjourEvent[], name: string) =>
  events.filter((event) => event.name === name) as (AjourEvent &
    Record<string, any>)[];

describe("a pull request's conversation", () => {
  it(
    "streams a turn's text, then ends it, with MCP off",
    { timeout: 20_000 },
    async () => {
      const api = await startConversationApi(() => [
        { readTurn: true },
        { session: "s-1" },
        { stream: ["Hel", "lo"] },
        { result: true },
        { readTurn: true },
      ]);

      const started = await api.startTurn({ message: "What does this do?" });

      expect(started.status).toBe(201);
      expect(started.body).toMatchObject({
        task: "deck.ask",
        ...PR,
        state: "running",
      });
      const turnId = started.body.id as string;
      await api.waitForTurnEvent("ended", (event) => event.turnId === turnId);
      expect(api.eventsOf(turnId)).toEqual([
        {
          type: "started",
          turnId,
          conversationId: started.body.conversationId,
        },
        expect.objectContaining({ type: "text", index: 0, text: "Hel" }),
        expect.objectContaining({ type: "text", index: 1, text: "lo" }),
        expect.objectContaining({ type: "ended", outcome: "done" }),
      ]);
      const [read] = await api.turnsRead();
      expect(read).toContain("Answer the user's question");
      expect(read).toContain("What does this do?");
    },
  );

  it(
    "reuses the conversation for a second turn on the same pull request",
    { timeout: 20_000 },
    async () => {
      const api = await startConversationApi(() => [
        ...answer("First"),
        ...answer("Second"),
        { readTurn: true },
      ]);

      const first = (await api.startTurn()).body;
      await api.waitForTurnEvent("ended", (event) => event.turnId === first.id);
      const second = (await api.startTurn({ task: "deck.chat" })).body;
      await api.waitForTurnEvent(
        "ended",
        (event) => event.turnId === second.id,
      );

      expect(second.conversationId).toBe(first.conversationId);
      expect(await api.launches()).toHaveLength(1);
      expect(await api.turnsRead()).toHaveLength(2);
      expect(api.eventsOf(second.id)).toContainEqual(
        expect.objectContaining({ type: "text", text: "Second" }),
      );
    },
  );

  it(
    "runs a second turn after the first, waiting for it",
    { timeout: 20_000 },
    async () => {
      const api = await startConversationApi(() => [
        { readTurn: true },
        { wait: 400 },
        { result: true },
        ...answer("Second"),
        { readTurn: true },
      ]);

      const first = (await api.startTurn()).body;
      const second = (await api.startTurn()).body;

      expect(second.state).toBe("waiting");
      await api.waitForTurnEvent(
        "ended",
        (event) => event.turnId === second.id,
      );
      expect(api.eventsOf(second.id)[0]).toMatchObject({
        type: "waiting",
        waitingFor: "turn",
      });
      const order = api
        .turnEvents()
        .filter((event) => event.type === "started" || event.type === "ended")
        .map((event) => [event.type, "turnId" in event && event.turnId]);
      expect(order).toEqual([
        ["started", first.id],
        ["ended", first.id],
        ["started", second.id],
        ["ended", second.id],
      ]);
    },
  );

  it(
    "closes the conversation when a turn comes for another pull request",
    { timeout: 20_000 },
    async () => {
      const api = await startConversationApi(() => [
        { session: "s-1" },
        ...answer("About 482"),
        { readTurn: true },
      ]);

      const first = (await api.startTurn()).body;
      await api.waitForTurnEvent("ended", (event) => event.turnId === first.id);
      const second = (await api.startTurn(OTHER_PR)).body;

      expect(await api.waitForTurnEvent("conversation-closed")).toEqual({
        type: "conversation-closed",
        conversationId: first.conversationId,
        reason: "replaced",
      });
      await api.waitForTurnEvent(
        "ended",
        (event) => event.turnId === second.id,
      );
      expect(second.conversationId).not.toBe(first.conversationId);
      expect(await api.launches()).toHaveLength(2);
    },
  );

  it(
    "resumes the provider's conversation when the pull request comes back",
    { timeout: 30_000 },
    async () => {
      const api = await startConversationApi(({ index }) => [
        { session: `s-${index}` },
        ...answer(`Answer ${index}`),
        { readTurn: true },
      ]);

      for (const binding of [PR, OTHER_PR, PR]) {
        const turn = (await api.startTurn(binding)).body;
        await api.waitForTurnEvent(
          "ended",
          (event) => event.turnId === turn.id && event.outcome === "done",
        );
      }

      const launches = await api.launches();
      expect(launches).toHaveLength(3);
      expect(launches[0]!.argv).not.toContain("--resume");
      expect(launches[1]!.argv).not.toContain("--resume");
      const resume = launches[2]!.argv.indexOf("--resume");
      expect(launches[2]!.argv[resume + 1]).toBe("s-0");
    },
  );

  it(
    "cancels a running turn by interrupting it, and frees the slot",
    { timeout: 20_000 },
    async () => {
      const api = await startConversationApi(() => [
        { readTurn: true },
        { stream: ["Thinking"] },
        { waitForInterrupt: true },
        { result: true },
        ...answer("After"),
        { readTurn: true },
      ]);
      await apiRequest(api.baseUrl, "/api/mcp/settings", { enabled: true });

      const turn = (await api.startTurn()).body;
      await api.waitForTurnEvent("text", (event) => event.turnId === turn.id);
      expect((await api.cancel(turn.id)).status).toBe(200);
      expect(
        await api.waitForTurnEvent(
          "ended",
          (event) => event.turnId === turn.id,
        ),
      ).toMatchObject({ outcome: "cancelled" });
      expect((await api.cancel(turn.id)).status).toBe(404);

      // The slot is free: a timesheet task starts at once, and the
      // conversation still takes its next turn.
      const run = await api.startTimesheetTask();
      expect(run.status).toBe(201);
      await vi.waitFor(
        async () =>
          expect(
            (await apiRequest(api.baseUrl, "/api/agent-runs/current")).body.run,
          ).toBeNull(),
        { timeout: 10_000 },
      );
      const next = (await api.startTurn()).body;
      expect(
        await api.waitForTurnEvent(
          "ended",
          (event) => event.turnId === next.id,
        ),
      ).toMatchObject({ outcome: "done" });
      expect(await api.launches()).toHaveLength(2);
    },
  );

  it(
    "ends the process of a turn that ignores the interrupt",
    { timeout: 20_000 },
    async () => {
      const api = await startConversationApi(
        () => [{ readTurn: true }, { stream: ["Stuck"] }, { hang: true }],
        { interruptGraceMs: 200 },
      );

      const turn = (await api.startTurn()).body;
      await api.waitForTurnEvent("text", (event) => event.turnId === turn.id);
      await api.cancel(turn.id);

      expect(
        await api.waitForTurnEvent(
          "ended",
          (event) => event.turnId === turn.id,
        ),
      ).toMatchObject({ outcome: "cancelled" });
      const turnEvent = named(api.events, "agent.turn").find(
        (event) => event.agent?.turn_id === turn.id,
      );
      expect(turnEvent).toMatchObject({
        outcome: "cancelled",
        agent: { stop_reason: "interrupt_timeout" },
      });
    },
  );

  it(
    "cancels a waiting turn without sending it",
    { timeout: 20_000 },
    async () => {
      const api = await startConversationApi(() => [
        { readTurn: true },
        { wait: 600 },
        { result: true },
        { readTurn: true },
      ]);

      const first = (await api.startTurn()).body;
      const second = (await api.startTurn()).body;
      expect((await api.cancel(second.id)).status).toBe(200);

      // It ends at once, while the turn ahead of it still runs.
      expect(
        await api.waitForTurnEvent(
          "ended",
          (event) => event.turnId === second.id,
        ),
      ).toMatchObject({ outcome: "cancelled" });
      expect(
        api
          .turnEvents()
          .some((event) => event.type === "ended" && event.turnId === first.id),
      ).toBe(false);
      expect((await api.cancel(second.id)).status).toBe(404);
      await api.waitForTurnEvent("ended", (event) => event.turnId === first.id);
      expect(await api.turnsRead()).toHaveLength(1);
      expect(api.eventsOf(second.id).map((event) => event.type)).toEqual([
        "waiting",
        "ended",
      ]);
    },
  );

  it(
    "closes an idle conversation and resumes it on the next turn",
    { timeout: 20_000 },
    async () => {
      const api = await startConversationApi(
        ({ index }) => [
          { session: `s-${index}` },
          ...answer("Hi"),
          { readTurn: true },
        ],
        { idleMs: 300 },
      );

      const first = (await api.startTurn()).body;
      expect(await api.waitForTurnEvent("conversation-closed")).toMatchObject({
        conversationId: first.conversationId,
        reason: "idle",
      });
      const second = (await api.startTurn()).body;
      await api.waitForTurnEvent(
        "ended",
        (event) => event.turnId === second.id,
      );

      const launches = await api.launches();
      expect(launches[1]!.argv).toEqual(
        expect.arrayContaining(["--resume", "s-0"]),
      );
    },
  );

  it(
    "refuses a core task on OpenCode, which can't hold a conversation yet",
    { timeout: 20_000 },
    async () => {
      const api = await startConversationApi(() => [], { cli: "opencode" });

      const started = await api.startTurn();

      expect(started.status).toBe(400);
      expect(started.body.error).toBe(
        "OpenCode can't hold a conversation about a pull request yet. Pick Claude Code or Codex in Settings > Agents.",
      );
      expect(await api.launches()).toEqual([]);
    },
  );
});

describe("the one agent slot", () => {
  it(
    "makes a timesheet task wait while a turn runs, and run while the conversation is idle",
    { timeout: 30_000 },
    async () => {
      const api = await startConversationApi(
        () => [
          { readTurn: true },
          { wait: 800 },
          { result: true },
          { readTurn: true },
        ],
        { timesheet: [{ wait: 300 }, { exit: 0 }] },
      );
      await apiRequest(api.baseUrl, "/api/mcp/settings", { enabled: true });

      const turn = (await api.startTurn()).body;
      await api.waitForTurnEvent(
        "started",
        (event) => event.turnId === turn.id,
      );
      let ranAt = 0;
      const run = api.startTimesheetTask().then((answer) => {
        ranAt = Date.now();
        return answer;
      });
      await api.waitForTurnEvent("ended", (event) => event.turnId === turn.id);
      const endedAt = Date.now();

      expect((await run).status).toBe(201);
      expect(ranAt).toBeGreaterThanOrEqual(endedAt);
      // Two timesheet tasks still can't run together.
      expect((await api.startTimesheetTask()).status).toBe(409);
      await vi.waitFor(
        async () =>
          expect(
            (await apiRequest(api.baseUrl, "/api/agent-runs/current")).body.run,
          ).toBeNull(),
        { timeout: 10_000 },
      );

      // The conversation is idle and keeps its process, but holds no slot.
      expect((await api.startTimesheetTask()).status).toBe(201);
      expect(
        api.turnEvents().some((event) => event.type === "conversation-closed"),
      ).toBe(false);
      await vi.waitFor(async () =>
        expect(await api.launches()).toHaveLength(3),
      );
    },
  );

  it(
    "makes a turn wait while a timesheet task runs",
    { timeout: 30_000 },
    async () => {
      const api = await startConversationApi(
        () => [...answer("Done waiting"), { readTurn: true }],
        { timesheet: [{ wait: 800 }, { exit: 0 }] },
      );
      await apiRequest(api.baseUrl, "/api/mcp/settings", { enabled: true });

      expect((await api.startTimesheetTask()).status).toBe(201);
      const turn = (await api.startTurn()).body;

      expect(turn.state).toBe("waiting");
      expect(
        await api.waitForTurnEvent(
          "waiting",
          (event) => event.turnId === turn.id,
        ),
      ).toMatchObject({ waitingFor: "agent-run" });
      await api.waitForTurnEvent("ended", (event) => event.turnId === turn.id);
      expect(
        (await apiRequest(api.baseUrl, "/api/agent-runs/current")).body.run,
      ).toBeNull();
      expect(api.eventsOf(turn.id).map((event) => event.type)).toEqual([
        "waiting",
        "started",
        "text",
        "ended",
      ]);
    },
  );

  it(
    "still refuses a timesheet task while MCP is off",
    { timeout: 20_000 },
    async () => {
      const api = await startConversationApi(() => answer("Fine"));

      const run = await api.startTimesheetTask();

      expect(run.status).toBe(400);
      expect(run.body.error).toBe("Turn on MCP in Settings > MCP.");
    },
  );
});

describe("a conversation's tools", () => {
  it(
    "binds the client to the pull request: no data or session tool, even with MCP off",
    { timeout: 20_000 },
    async () => {
      const api = await startConversationApi(() => [
        { readTurn: true },
        { mcp: { method: "tools/list" } },
        {
          mcp: {
            method: "tools/call",
            params: { name: "list_projects", arguments: {} },
          },
        },
        {
          mcp: {
            method: "tools/call",
            params: {
              name: "begin_session",
              arguments: { title: "Review", estimateMinutes: 5 },
            },
          },
        },
        { result: true },
        { readTurn: true },
      ]);

      const turn = (await api.startTurn()).body;
      await api.waitForTurnEvent("ended", (event) => event.turnId === turn.id);

      const [list, projects, session] = await api.mcpReplies();
      expect(list).toMatchObject({ status: 200 });
      expect(list!.reply.result.tools).toEqual([]);
      for (const [reply, tool] of [
        [projects, "list_projects"],
        [session, "begin_session"],
      ] as const) {
        expect(reply!.reply.result.isError).toBe(true);
        expect(reply!.reply.result.content[0].text).toBe(
          `This conversation is bound to pull request ${PR.pullRequest} at head ${PR.head}. Ajour refuses ${tool}, which is outside it. Use only the tools that tools/list returns.`,
        );
      }
      expect(
        named(api.events, "agent_tool.call").map((event) => [
          event.agent_tool?.name,
          event.outcome,
          event.outcome_reason,
        ]),
      ).toEqual([
        ["list_projects", "refused", "outside_pull_request"],
        ["begin_session", "refused", "outside_pull_request"],
      ]);
    },
  );

  it(
    "revokes the client when the conversation closes",
    { timeout: 20_000 },
    async () => {
      const api = await startConversationApi(({ index }) =>
        index === 0
          ? [...answer("One"), { readTurn: true }]
          : [
              { readTurn: true },
              { mcp: { method: "tools/list" } },
              { result: true },
              { readTurn: true },
            ],
      );
      const first = (await api.startTurn()).body;
      await api.waitForTurnEvent("ended", (event) => event.turnId === first.id);
      // The active clients: a revoked one leaves the list.
      const clients = async () =>
        (
          (await apiRequest(api.baseUrl, "/api/mcp/settings")).body.clients as {
            id: string;
          }[]
        ).map((client) => client.id);
      const [firstClient] = await clients();

      const second = (await api.startTurn(OTHER_PR)).body;
      await api.waitForTurnEvent(
        "ended",
        (event) => event.turnId === second.id,
      );

      const after = await clients();
      expect(after).toHaveLength(1);
      expect(after).not.toContain(firstClient);
      // The second conversation's client works; the first one's is revoked.
      const [list] = await api.mcpReplies();
      expect(list!.status).toBe(200);
    },
  );
});

describe("a conversation's wide events", () => {
  it(
    "log each turn and the conversation, never the message or the answer",
    { timeout: 20_000 },
    async () => {
      const message = "message-canary-5b1e";
      const text = "answer-canary-9c3d";
      const api = await startConversationApi(() => [
        { session: "s-1" },
        ...answer(text, " more"),
        { readTurn: true },
      ]);

      const turn = (await api.startTurn({ message })).body;
      await api.waitForTurnEvent("ended", (event) => event.turnId === turn.id);
      await api.startTurn(OTHER_PR);
      await api.waitForTurnEvent("conversation-closed");

      const [turnEvent] = named(api.events, "agent.turn");
      expect(turnEvent).toMatchObject({
        kind: "job",
        outcome: "ok",
        agent: {
          turn_id: turn.id,
          conversation_id: turn.conversationId,
          task: "deck.ask",
          cli: "claude-code",
          resumed: false,
          text_piece_count: 2,
          tool_call_count: 0,
        },
      });
      const [conversationEvent] = named(api.events, "agent.conversation");
      expect(conversationEvent).toMatchObject({
        kind: "job",
        outcome: "ok",
        agent: {
          conversation_id: turn.conversationId,
          client_id: expect.any(String),
          conversation_mode: "warm",
          turn_count: 1,
          launch_count: 1,
          resume_count: 0,
          close_reason: "replaced",
        },
        cleanup: { outcome: "ok", failed_steps: [] },
      });
      expect(
        named(api.events, "agent_run.start").map((event) => [
          event.agent?.task_id,
          event.agent?.turn_id !== undefined,
        ]),
      ).toEqual([
        ["deck.ask", true],
        ["deck.ask", true],
      ]);
      const logged = JSON.stringify(api.events);
      expect(logged).not.toContain(message);
      expect(logged).not.toContain(text);
    },
  );

  it(
    "logs a cancel request and the cancelled turn",
    { timeout: 20_000 },
    async () => {
      const api = await startConversationApi(() => [
        { readTurn: true },
        { waitForInterrupt: true },
        { result: true },
        { readTurn: true },
      ]);
      const turn = (await api.startTurn()).body;
      await api.waitForTurnEvent(
        "started",
        (event) => event.turnId === turn.id,
      );

      await api.cancel(turn.id);
      await api.waitForTurnEvent("ended", (event) => event.turnId === turn.id);
      await api.cancel("not-a-turn");

      expect(
        named(api.events, "agent_turn.cancel").map((event) => [
          event.outcome,
          event.outcome_reason,
          event.agent?.turn_id,
        ]),
      ).toEqual([
        ["ok", undefined, turn.id],
        ["refused", "not_running", "not-a-turn"],
      ]);
      expect(
        named(api.events, "agent.turn").find(
          (event) => event.agent?.turn_id === turn.id,
        ),
      ).toMatchObject({ outcome: "cancelled", agent: { stop_reason: "user" } });
    },
  );
});

/** The init event Claude Code prints, with the given MCP server status. */
const initLine = (status: string) =>
  JSON.stringify({
    type: "system",
    subtype: "init",
    session_id: "s-0",
    mcp_servers: [{ name: "ajour", status }],
  });

describe("a turn that goes wrong", () => {
  it(
    "fails a turn whose CLI dies, frees the slot, and resumes on the next turn",
    { timeout: 20_000 },
    async () => {
      const api = await startConversationApi(({ index }) =>
        index === 0
          ? [
              { session: "s-0" },
              { readTurn: true },
              { stream: ["Par"] },
              { stderr: "boom" },
              { exit: 3 },
            ]
          : [{ session: "s-1" }, ...answer("Back"), { readTurn: true }],
      );

      const first = (await api.startTurn()).body;
      expect(
        await api.waitForTurnEvent(
          "ended",
          (event) => event.turnId === first.id,
        ),
      ).toMatchObject({
        outcome: "failed",
        error: "Claude Code stopped: boom",
      });
      const second = await api.startTurn();

      expect(second.body).toMatchObject({
        state: "running",
        conversationId: first.conversationId,
      });
      expect(
        await api.waitForTurnEvent(
          "ended",
          (event) => event.turnId === second.body.id,
        ),
      ).toMatchObject({ outcome: "done" });
      const launches = await api.launches();
      expect(launches).toHaveLength(2);
      expect(launches[1]!.argv).toEqual(
        expect.arrayContaining(["--resume", "s-0"]),
      );
      expect(
        named(api.events, "agent.turn").find(
          (event) => event.agent?.turn_id === first.id,
        ),
      ).toMatchObject({
        outcome: "error",
        outcome_reason: "cli_exited",
        agent: { exit_code: 3, text_piece_count: 1 },
      });
    },
  );

  it(
    "ends a cancelled turn whose CLI exits but never closes, as a Windows shim's child keeps the pipes",
    { timeout: 20_000 },
    async () => {
      const api = await startConversationApi(
        ({ index }) =>
          index === 0
            ? [
                { session: "s-0" },
                { readTurn: true },
                { stream: ["Working"] },
                // Holds the output open after the CLI is ended.
                { escapee: 15_000 },
                { hang: true },
              ]
            : [{ session: "s-1" }, ...answer("Next"), { readTurn: true }],
        { interruptGraceMs: 100, killGraceMs: 300 },
      );

      const turn = (await api.startTurn()).body;
      await api.waitForTurnEvent("text", (event) => event.turnId === turn.id);
      await vi.waitFor(async () =>
        expect(
          (await readFile(reports.at(-1)!, "utf8")).includes("grandchildPid"),
        ).toBe(true),
      );
      const cancelledAt = Date.now();
      await api.cancel(turn.id);

      expect(
        await api.waitForTurnEvent(
          "ended",
          (event) => event.turnId === turn.id,
        ),
      ).toMatchObject({ outcome: "cancelled" });
      // The interrupt grace, the kill grace and a second, not the escapee's 15.
      expect(Date.now() - cancelledAt).toBeLessThan(5000);
      const next = await api.startTurn();
      expect(next.body.state).toBe("running");
      expect(
        await api.waitForTurnEvent(
          "ended",
          (event) => event.turnId === next.body.id,
        ),
      ).toMatchObject({ outcome: "done" });
    },
  );

  it(
    "fails a turn whose CLI goes quiet past the stall limit, and frees the slot",
    { timeout: 20_000 },
    async () => {
      const api = await startConversationApi(
        ({ index }) =>
          index === 0
            ? [
                { session: "s-0" },
                { readTurn: true },
                { stream: ["Hm"] },
                { hang: true },
              ]
            : [{ session: "s-1" }, ...answer("Awake"), { readTurn: true }],
        // The stall clock starts with the turn, so the limit also covers the
        // process starting. A turn that stalls before it's sent never reaches
        // the process, and the next turn would go to that process and hang.
        { stallMs: 1_500, killGraceMs: 300 },
      );

      const turn = (await api.startTurn()).body;

      // The CLI answered, then went quiet.
      await api.waitForTurnEvent(
        "text",
        (event) => event.turnId === turn.id && event.text === "Hm",
      );
      expect(
        await api.waitForTurnEvent(
          "ended",
          (event) => event.turnId === turn.id,
        ),
      ).toMatchObject({
        outcome: "failed",
        error: "The agent stopped answering.",
      });
      expect(
        named(api.events, "agent.turn").find(
          (event) => event.agent?.turn_id === turn.id,
        ),
      ).toMatchObject({
        outcome: "error",
        outcome_reason: "stalled",
        agent: { stop_reason: "stalled" },
      });
      const next = await api.startTurn();
      expect(next.body.state).toBe("running");
      expect(
        await api.waitForTurnEvent(
          "ended",
          (event) => event.turnId === next.body.id,
        ),
      ).toMatchObject({ outcome: "done" });
      // Ajour ended the quiet process, so the next turn ran on a new one.
      expect(await api.launches()).toHaveLength(2);
    },
  );

  it(
    "fails a turn whose process can't start, and closes the conversation",
    { timeout: 20_000 },
    async () => {
      const api = await startConversationApi(() => ({
        steps: [],
        // A file in a folder that doesn't exist can't be written.
        files: { [path.join("missing", "prompt.md")]: "x" },
      }));

      const turn = (await api.startTurn()).body;

      expect(
        await api.waitForTurnEvent(
          "ended",
          (event) => event.turnId === turn.id,
        ),
      ).toMatchObject({
        outcome: "failed",
        error: "Ajour could not start the agent.",
      });
      expect(await api.waitForTurnEvent("conversation-closed")).toMatchObject({
        conversationId: turn.conversationId,
        reason: "failed",
      });
      expect(
        named(api.events, "agent.turn").find(
          (event) => event.agent?.turn_id === turn.id,
        ),
      ).toMatchObject({
        outcome: "error",
        launch: { failed_step: "write_files" },
      });
      expect(await api.launches()).toEqual([]);
      expect(await api.clients()).toEqual([]);
    },
  );

  it(
    "fails a turn whose Ajour MCP server didn't start",
    { timeout: 20_000 },
    async () => {
      const api = await startConversationApi(() => [
        { stdout: initLine("failed") },
        { hang: true },
      ]);

      const turn = (await api.startTurn()).body;

      expect(
        await api.waitForTurnEvent(
          "ended",
          (event) => event.turnId === turn.id,
        ),
      ).toMatchObject({
        outcome: "failed",
        error: "The ajour MCP server did not start.",
      });
      expect(
        named(api.events, "agent.turn").find(
          (event) => event.agent?.turn_id === turn.id,
        ),
      ).toMatchObject({ outcome: "error", outcome_reason: "mcp_failed" });
    },
  );

  // Each ending ends the first turn's process. The queued turn waits for it
  // to finish, then runs on a new one, here about a new head.
  it.each([
    {
      ending: "the MCP server failing",
      first: [
        { readTurn: true },
        { stdout: initLine("failed") },
        { hang: true },
      ],
      outcome: {
        outcome: "failed",
        error: "The ajour MCP server did not start.",
      },
      cancel: false,
    },
    {
      ending: "the CLI exiting",
      first: [{ readTurn: true }, { stderr: "boom" }, { exit: 3 }],
      outcome: { outcome: "failed", error: "Claude Code stopped: boom" },
      cancel: false,
    },
    {
      ending: "the stall limit",
      first: [{ readTurn: true }, { hang: true }],
      outcome: { outcome: "failed", error: "The agent stopped answering." },
      cancel: false,
    },
    {
      // The CLI never answers the interrupt, so Ajour ends it.
      ending: "a cancel the CLI ignores",
      first: [{ readTurn: true }, { stream: ["Working"] }, { hang: true }],
      outcome: { outcome: "cancelled" },
      cancel: true,
    },
  ])(
    "runs a queued turn on a new process after $ending",
    { timeout: 20_000 },
    async ({ first: script, outcome, cancel }) => {
      const api = await startConversationApi(
        ({ index }) =>
          index === 0
            ? [{ session: "s-0" }, ...script]
            : [{ session: "s-0" }, ...answer("Next"), { readTurn: true }],
        { stallMs: 1500, killGraceMs: 300, interruptGraceMs: 100 },
      );

      const first = (await api.startTurn()).body;
      const queued = (await api.startTurn({ head: "c63e1f4" })).body;
      expect(queued.state).toBe("waiting");
      if (cancel) {
        await api.waitForTurnEvent(
          "text",
          (event) => event.turnId === first.id,
        );
        await api.cancel(first.id);
      }

      expect(
        await api.waitForTurnEvent(
          "ended",
          (event) => event.turnId === first.id,
        ),
      ).toMatchObject(outcome);
      expect(
        await api.waitForTurnEvent(
          "ended",
          (event) => event.turnId === queued.id,
        ),
      ).toMatchObject({ outcome: "done" });
      expect(api.eventsOf(queued.id)).toContainEqual(
        expect.objectContaining({ type: "text", text: "Next" }),
      );
      const launches = await api.launches();
      expect(launches).toHaveLength(2);
      expect(launches[1]!.argv).toEqual(
        expect.arrayContaining(["--resume", "s-0"]),
      );
      const read = await api.turnsRead();
      expect(read).toHaveLength(2);
      expect(read[1]).toContain("head changed from a41c9e2 to c63e1f4");
    },
  );

  it(
    "runs a queued turn after a turn whose resume found no conversation",
    { timeout: 30_000 },
    async () => {
      const api = await startConversationApi(
        ({ index }) =>
          index === 1
            ? [{ resumeFails: true }]
            : index === 0
              ? [{ session: "s-0" }, ...answer("First"), { readTurn: true }]
              : [
                  { session: "s-2" },
                  ...answer("Fresh"),
                  ...answer("Queued"),
                  { readTurn: true },
                ],
        { idleMs: 300 },
      );
      const first = (await api.startTurn()).body;
      await api.waitForTurnEvent("ended", (event) => event.turnId === first.id);
      await api.waitForTurnEvent("conversation-closed");

      const retried = (await api.startTurn()).body;
      const queued = (await api.startTurn()).body;

      expect(
        await api.waitForTurnEvent(
          "ended",
          (event) => event.turnId === retried.id,
        ),
      ).toMatchObject({ outcome: "done", historyLost: true });
      expect(
        await api.waitForTurnEvent(
          "ended",
          (event) => event.turnId === queued.id,
        ),
      ).toMatchObject({ outcome: "done" });
      expect(api.eventsOf(queued.id)).toContainEqual(
        expect.objectContaining({ type: "text", text: "Queued" }),
      );
      expect(await api.launches()).toHaveLength(3);
    },
  );

  it(
    "keeps a turn whose CLI reports progress only on stderr",
    { timeout: 20_000 },
    async () => {
      const api = await startConversationApi(
        () => [
          { session: "s-0" },
          { readTurn: true },
          // Quiet on stdout for 2.4 s, past the 1.5 s limit, which leaves room
          // for process startup before the first stderr line.
          ...Array.from({ length: 8 }, () => [
            { stderr: "Retrying the request" },
            { wait: 300 },
          ]).flat(),
          { stream: ["Done"] },
          { result: true },
          { readTurn: true },
        ],
        { stallMs: 1_500, killGraceMs: 300 },
      );

      const turn = (await api.startTurn()).body;

      expect(
        await api.waitForTurnEvent(
          "ended",
          (event) => event.turnId === turn.id,
        ),
      ).toMatchObject({ outcome: "done" });
    },
  );

  it(
    "starts the turn over without the history when the resume finds no conversation",
    { timeout: 30_000 },
    async () => {
      const api = await startConversationApi(
        ({ index }) =>
          index === 1
            ? [{ resumeFails: true }]
            : [
                { session: `s-${index}` },
                ...answer(index === 0 ? "First" : "Fresh"),
                { readTurn: true },
              ],
        { idleMs: 300 },
      );
      const first = (await api.startTurn()).body;
      await api.waitForTurnEvent("ended", (event) => event.turnId === first.id);
      await api.waitForTurnEvent("conversation-closed");

      const second = (await api.startTurn({ message: "Still there?" })).body;

      expect(
        await api.waitForTurnEvent(
          "ended",
          (event) => event.turnId === second.id,
        ),
      ).toEqual({
        type: "ended",
        turnId: second.id,
        conversationId: second.conversationId,
        outcome: "done",
        historyLost: true,
      });
      expect(api.eventsOf(second.id)).toContainEqual(
        expect.objectContaining({ type: "text", text: "Fresh" }),
      );
      const launches = await api.launches();
      expect(
        launches.map((launch) => launch.argv.includes("--resume")),
      ).toEqual([false, true, false]);
      const read = await api.turnsRead();
      expect(read).toHaveLength(2);
      expect(read[1]).toContain("could not be restored");
      expect(read[1]).toContain("Still there?");
      expect(
        named(api.events, "agent.turn").find(
          (event) => event.agent?.turn_id === second.id,
        ),
      ).toMatchObject({
        outcome: "ok",
        agent: { resumed: false, history_lost: true },
      });
    },
  );
});

describe("a conversation on Codex", () => {
  it(
    "runs one process per turn and resumes the thread for the next",
    { timeout: 30_000 },
    async () => {
      const api = await startConversationApi(
        ({ index }) => [
          { codexThread: "t-1" },
          { codexReadTurn: true },
          { codexMessage: index === 0 ? "First answer" : "Second answer" },
          { codexDone: true },
        ],
        { cli: "codex" },
      );

      const first = (await api.startTurn({ message: "Why?" })).body;
      await api.waitForTurnEvent("ended", (event) => event.turnId === first.id);
      const second = (await api.startTurn({ task: "deck.chat" })).body;
      await api.waitForTurnEvent(
        "ended",
        (event) => event.turnId === second.id,
      );

      expect(second.conversationId).toBe(first.conversationId);
      for (const [turn, text] of [
        [first, "First answer"],
        [second, "Second answer"],
      ] as const) {
        expect(api.eventsOf(turn.id).map((event) => event.type)).toEqual([
          "started",
          "text",
          "ended",
        ]);
        expect(api.eventsOf(turn.id)[1]).toMatchObject({ text });
        expect(api.eventsOf(turn.id)[2]).toMatchObject({ outcome: "done" });
      }
      const launches = await api.launches();
      expect(launches).toHaveLength(2);
      expect(launches[0]!.argv).not.toContain("resume");
      expect(launches[1]!.argv).toContain("resume");
      expect(launches[1]!.argv.slice(-2)).toEqual(["t-1", "-"]);
      const read = await api.codexTurnsRead();
      expect(read).toHaveLength(2);
      expect(read[0]).toContain("Why?");
      expect(
        named(api.events, "agent.turn").map((event) => event.agent?.resumed),
      ).toEqual([false, true]);
    },
  );

  it("fails a Codex turn its CLI fails", { timeout: 20_000 }, async () => {
    const api = await startConversationApi(
      () => [
        { codexThread: "t-1" },
        { codexReadTurn: true },
        { codexDone: "Rate limited." },
        { exit: 1 },
      ],
      { cli: "codex" },
    );

    const turn = (await api.startTurn()).body;

    expect(
      await api.waitForTurnEvent("ended", (event) => event.turnId === turn.id),
    ).toMatchObject({ outcome: "failed", error: "Rate limited." });
  });
});

describe("a conversation across heads", () => {
  const NEW_HEAD = "c63e1f4";

  it(
    "keeps the conversation for a new head, rebinds its tools and tells the agent",
    { timeout: 20_000 },
    async () => {
      const api = await startConversationApi(() => [
        { session: "s-0" },
        ...answer("At the old head"),
        { readTurn: true },
        {
          mcp: {
            method: "tools/call",
            params: { name: "list_projects", arguments: {} },
          },
        },
        { result: true },
        { readTurn: true },
      ]);

      const first = (await api.startTurn()).body;
      await api.waitForTurnEvent("ended", (event) => event.turnId === first.id);
      const second = (await api.startTurn({ head: NEW_HEAD })).body;
      await api.waitForTurnEvent(
        "ended",
        (event) => event.turnId === second.id,
      );

      expect(second).toMatchObject({
        conversationId: first.conversationId,
        head: NEW_HEAD,
      });
      expect(
        api.turnEvents().some((event) => event.type === "conversation-closed"),
      ).toBe(false);
      expect(await api.launches()).toHaveLength(1);
      const read = await api.turnsRead();
      expect(read[1]).toContain(
        `The pull request's head changed from ${PR.head} to ${NEW_HEAD}.`,
      );
      expect(read[0]).not.toContain("head changed");
      // The same client, bound to the new head.
      const [refused] = await api.mcpReplies();
      expect(refused!.reply.result.content[0].text).toContain(
        `bound to pull request ${PR.pullRequest} at head ${NEW_HEAD}.`,
      );
      expect(await api.clients()).toHaveLength(1);
      expect(
        named(api.events, "agent.turn").map(
          (event) => event.agent?.head_changed,
        ),
      ).toEqual([undefined, true]);
    },
  );

  it(
    "tells a resumed conversation when its pull request's head moved meanwhile",
    { timeout: 30_000 },
    async () => {
      const api = await startConversationApi(({ index }) => [
        { session: `s-${index}` },
        ...answer(`Answer ${index}`),
        { readTurn: true },
      ]);

      for (const binding of [PR, OTHER_PR, { ...PR, head: NEW_HEAD }]) {
        const turn = (await api.startTurn(binding)).body;
        await api.waitForTurnEvent(
          "ended",
          (event) => event.turnId === turn.id && event.outcome === "done",
        );
      }

      const launches = await api.launches();
      expect(launches[2]!.argv).toEqual(
        expect.arrayContaining(["--resume", "s-0"]),
      );
      const read = await api.turnsRead();
      expect(read[2]).toContain(
        `The pull request's head changed from ${PR.head} to ${NEW_HEAD}.`,
      );
    },
  );
});

describe("a plugin task waiting behind a turn", () => {
  it(
    "gives up when its request closes, and never runs",
    { timeout: 30_000 },
    async () => {
      const api = await startConversationApi(() => [
        { readTurn: true },
        { wait: 1000 },
        { result: true },
        { readTurn: true },
      ]);
      await apiRequest(api.baseUrl, "/api/mcp/settings", { enabled: true });
      const turn = (await api.startTurn()).body;
      await api.waitForTurnEvent(
        "started",
        (event) => event.turnId === turn.id,
      );

      const request = new AbortController();
      const waiting = fetch(`${api.baseUrl}/api/agent-runs`, {
        method: "POST",
        headers: {
          ...windowTokenHeader,
          Origin: TEST_ORIGIN,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          pluginId: "ajp-workday-agent",
          taskId: "enter-week",
          weekOf: "2026-10-12",
        }),
        signal: request.signal,
      }).catch(() => undefined);
      await new Promise((resolve) => setTimeout(resolve, 200));
      request.abort();
      await waiting;
      await api.waitForTurnEvent("ended", (event) => event.turnId === turn.id);
      await new Promise((resolve) => setTimeout(resolve, 300));

      expect(await api.currentRun()).toBeNull();
      expect(await api.launches()).toHaveLength(1);
      // Nothing is left starting, so the next one starts.
      expect((await api.startTimesheetTask()).status).toBe(201);
    },
  );

  it(
    "checks again once the turn ends, and doesn't start once MCP turned off meanwhile",
    { timeout: 30_000 },
    async () => {
      const api = await startConversationApi(() => [
        { readTurn: true },
        { wait: 800 },
        { result: true },
        { readTurn: true },
      ]);
      await apiRequest(api.baseUrl, "/api/mcp/settings", { enabled: true });
      const turn = (await api.startTurn()).body;
      await api.waitForTurnEvent(
        "started",
        (event) => event.turnId === turn.id,
      );

      const run = api.startTimesheetTask();
      await new Promise((resolve) => setTimeout(resolve, 200));
      await apiRequest(api.baseUrl, "/api/mcp/settings", { enabled: false });

      expect(await run).toMatchObject({
        status: 400,
        body: { error: "Turn on MCP in Settings > MCP." },
      });
      expect(await api.launches()).toHaveLength(1);
    },
  );
});

describe("the MCP endpoint with MCP off", () => {
  it(
    "refuses a conversation's own token sent with an Origin, as a page would",
    { timeout: 20_000 },
    async () => {
      const api = await startConversationApi(() => [
        { readTurn: true },
        { mcp: { method: "tools/list" }, origin: TEST_ORIGIN },
        { mcp: { method: "tools/list" } },
        { result: true },
        { readTurn: true },
      ]);

      const turn = (await api.startTurn()).body;
      await api.waitForTurnEvent("ended", (event) => event.turnId === turn.id);

      const [fromPage, fromAgent] = await api.mcpReplies();
      expect(fromPage!.status).toBe(404);
      expect(fromAgent!.status).toBe(200);
      expect(
        named(api.events, "mcp.request").map((event) => event.outcome_reason),
      ).toEqual(["mcp_off", undefined]);
    },
  );

  it(
    "revokes a conversation client a crash left, which then gets no answer and no agent panel error",
    { timeout: 20_000 },
    async () => {
      const root = await mkdtemp(path.join(os.tmpdir(), "ajour-leftover-"));
      running.push(() =>
        rm(root, { recursive: true, force: true, maxRetries: 5 }),
      );
      const statePath = path.join(root, "state.json");
      const leftover = await createMcpClient(
        new AppApiStorage(statePath),
        "Claude Code, pull request conversation",
        { pullRequest: PR },
      );

      const api = await startConversationApi(() => [], { statePath });

      await vi.waitFor(async () => expect(await api.clients()).toEqual([]));
      const response = await fetch(`${api.baseUrl}/mcp/ajour`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${leftover.token}`,
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      });
      expect(response.status).toBe(401);
      expect(
        named(api.events, "mcp.request").map((event) => event.outcome_reason),
      ).toEqual(["token_revoked"]);
      // A new window stream starts with the agent panel's snapshot.
      const stream = await openEventStream(api.baseUrl, "/api/handoffs/bridge");
      running.push(stream.close);
      expect(
        (await stream.waitFor<{ errors: unknown[] }>("agents")).errors,
      ).toEqual([]);
    },
  );

  it(
    "keeps a turn's events flowing on the window's stream when MCP turns off",
    { timeout: 20_000 },
    async () => {
      const api = await startConversationApi(() => [
        { readTurn: true },
        { stream: ["Before"] },
        { wait: 600 },
        { stream: ["After"] },
        { result: true },
        { readTurn: true },
      ]);
      await apiRequest(api.baseUrl, "/api/mcp/settings", { enabled: true });
      // The window's stream while MCP is on.
      const stream = await openEventStream(api.baseUrl, "/api/mcp/bridge");
      running.push(stream.close);
      const turn = (await api.startTurn()).body;
      await stream.waitFor<AgentTurnEvent>(
        "agent-turn",
        (event) => event.type === "text" && event.text === "Before",
      );

      await apiRequest(api.baseUrl, "/api/mcp/settings", { enabled: false });

      expect(
        await stream.waitFor<AgentTurnEvent>(
          "agent-turn",
          (event) => event.type === "ended" && event.turnId === turn.id,
        ),
      ).toMatchObject({ outcome: "done" });
      expect(
        stream.events.some(
          (event) =>
            event.event === "agent-turn" &&
            (event.data as AgentTurnEvent).type === "text" &&
            (event.data as { text: string }).text === "After",
        ),
      ).toBe(true);
    },
  );
});
