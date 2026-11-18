import os from "node:os";
import path from "node:path";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentTurnEvent } from "../../../packages/shared/agent-runs.ts";
import type { AjourEvent } from "../../../packages/wide-events/catalog.ts";
import { opencodeAdapter } from "./agent-runner/adapters/opencode.ts";
import { fakeCliAdapter } from "./test-support/fake-cli-adapter.ts";
import {
  apiRequest,
  openEventStream,
  startLocalApi,
} from "./test-support/local-api.ts";

/**
 * A pull request's conversation through the local API (#778), with the fake
 * CLI playing Claude Code's stream-json. Turn events come on the window's
 * stream that the handoffs bridge opens, which needs no MCP.
 */

const running: (() => Promise<void> | void)[] = [];

afterEach(async () => {
  for (const stop of running.splice(0).reverse()) await stop();
});

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
  conversation: (launch: { index: number; resume?: string }) => unknown[],
  options: {
    timesheet?: unknown[];
    idleMs?: number;
    interruptGraceMs?: number;
    cli?: "claude-code" | "opencode";
  } = {},
) {
  const root = await mkdtemp(path.join(os.tmpdir(), "ajour-conversation-"));
  running.push(() => rm(root, { recursive: true, force: true, maxRetries: 5 }));
  const report = path.join(root, "report.jsonl");
  // Where the runner finds `claude`. The fake CLI runs in its place.
  const bin = path.join(root, "bin");
  await mkdir(bin);
  for (const name of ["claude", "opencode"]) {
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
      opencodeAdapter,
    ],
    ...(options.idleMs ? { agentConversationIdleMs: options.idleMs } : {}),
    agentInterruptGraceMs: options.interruptGraceMs ?? 5000,
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
      await api.cancel(second.id);

      expect(
        await api.waitForTurnEvent(
          "ended",
          (event) => event.turnId === second.id,
        ),
      ).toMatchObject({ outcome: "cancelled" });
      await api.waitForTurnEvent("ended", (event) => event.turnId === first.id);
      expect(await api.turnsRead()).toHaveLength(1);
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
      ).toMatchObject({ waitingFor: "timesheet-task" });
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
