import { mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { AgentSessions } from "../agent-sessions.ts";
import { claudeCodeAdapter } from "./adapters/claude-code.ts";
import { codexAdapter } from "./adapters/codex.ts";
import type { AgentCliId } from "../../../../packages/shared/agent-runs.ts";
import type { AgentCliAdapter } from "./adapter.ts";
import { AgentRunner } from "./runner.ts";

const FAKE_CLI = fileURLToPath(new URL("./fake-cli.mjs", import.meta.url));
const result = (text: string) =>
  JSON.stringify({
    type: "result",
    subtype: "success",
    is_error: false,
    result: text,
  });

const fakeAdapter = (script: unknown[], report: string): AgentCliAdapter => ({
  ...claudeCodeAdapter,
  executableName: "node",
  buildInvocation: (input) => ({
    command: process.execPath,
    args: [FAKE_CLI],
    env: {
      ...input.baseEnv,
      AJOUR_MCP_TOKEN: input.token,
      FAKE_CLI_SCRIPT: JSON.stringify(script),
      FAKE_CLI_REPORT: report,
    },
    files: { "prompt.md": input.prompt },
  }),
});

const fakeSettings = [
  {
    id: "url",
    label: "URL",
    type: "url" as const,
    required: true,
    secret: false,
  },
  {
    id: "note",
    label: "Note",
    type: "text" as const,
    required: false,
    secret: false,
  },
];

function fakeStorage({
  cli,
  values,
  revoked,
}: {
  cli: AgentCliId;
  values: Record<string, string>;
  revoked: string[];
}) {
  return {
    getMcpSettings: async () => ({ enabled: true, clients: [] }),
    getAgentRunnerSettings: async () => ({
      cli,
      browserMode: "ajour-chrome" as const,
      model: "",
    }),
    getAgentTaskValues: async () => values,
    createMcpClient: async (name: string) => ({
      client: { id: `c-${name}`, name, createdAt: 1 },
      token: "ajour_test-token",
    }),
    revokeMcpClient: async (clientId: string) => {
      revoked.push(clientId);
      return true;
    },
  };
}

function fakePlugins(prompt: string, weekLink: string) {
  const manifest = {
    id: "ajp-test",
    displayName: "Workday",
    capabilities: {
      agentTask: {
        tasks: [
          {
            id: "enter-week",
            label: "Enter in Workday",
            placement: "submit-week" as const,
            prompt: "p.md",
            estimateMinutes: 10,
            weekLink,
            settings: fakeSettings,
          },
        ],
      },
    },
  };
  return {
    listPlugins: async () => [manifest],
    isPluginEnabled: async () => true,
    readAgentTaskPrompt: async () => prompt,
  };
}

async function setup(
  script: unknown[],
  options: {
    chrome?: boolean;
    sessions?: AgentSessions;
    adapter?: AgentCliAdapter;
    killGraceMs?: number;
    values?: Record<string, string>;
    weekLink?: string;
  } = {},
) {
  const work = await mkdtemp(path.join(tmpdir(), "ajour-runner-test-"));
  const report = path.join(work, "report.jsonl");
  const sessions = options.sessions ?? new AgentSessions();
  const revoked: string[] = [];
  const events: Record<string, unknown>[] = [];
  const runner = new AgentRunner({
    storage: fakeStorage({
      cli: options.adapter?.id ?? "claude-code",
      values: options.values ?? { url: "https://wd.example/t" },
      revoked,
    }),
    sessions,
    plugins: fakePlugins(
      "Enter week {{weekOf}} in {{settings.url}}.",
      options.weekLink ?? "{{settings.url}}?date={{weekOf}}",
    ),
    adapters: [options.adapter ?? fakeAdapter(script, report)],
    findExecutable: async () => "/fake/claude",
    readVersion: async () => "1.0.0",
    loginShellPath: async () => process.env.PATH ?? "",
    chromeInstalled: async () => options.chrome ?? true,
    playwright: () => ({ command: "node", args: [], env: {} }),
    profileDirectory: path.join(work, "profile"),
    tempRoot: work,
    ajourMcpUrl: "http://127.0.0.1:8787/mcp/ajour",
    logEvent: (event) => events.push(event),
    ...(options.killGraceMs === undefined
      ? {}
      : { killGraceMs: options.killGraceMs }),
  });
  return { runner, sessions, revoked, events, work, report };
}

const request = {
  pluginId: "ajp-test",
  taskId: "enter-week",
  weekOf: "2026-10-12",
};

/** Waits until the run is gone from the runner. */
async function settled(runner: AgentRunner) {
  await vi.waitFor(
    async () => expect((await runner.overview()).currentRun).toBeNull(),
    { timeout: 5000 },
  );
}

/** Waits until the fake CLI has started and written its report line. */
async function waitForCli(report: string) {
  await vi.waitFor(
    async () =>
      expect((await readFile(report, "utf8")).length).toBeGreaterThan(0),
    { timeout: 5000 },
  );
}

describe("AgentRunner", () => {
  it("runs a selected Codex adapter and retains its final summary", async () => {
    const fake = fakeAdapter(
      [
        {
          stdout: JSON.stringify({
            type: "item.started",
            item: { type: "mcp_tool_call" },
          }),
        },
        {
          stdout: JSON.stringify({
            type: "item.completed",
            item: { type: "agent_message", text: "Dry run complete." },
          }),
        },
        { stdout: JSON.stringify({ type: "turn.completed" }) },
      ],
      "",
    );
    const { runner, sessions, events } = await setup([], {
      adapter: { ...codexAdapter, buildInvocation: fake.buildInvocation },
    });
    const overview = await runner.overview();
    expect(overview.clis.find((cli) => cli.id === "codex")?.supported).toBe(
      true,
    );
    expect(overview.tasks[0]!.blockers).toEqual([]);
    const run = await runner.start(request);
    await settled(runner);
    expect(sessions.get(run.sessionId)!.messages.at(-1)).toMatchObject({
      kind: "end",
      summary: "Dry run complete.",
      outcome: "done",
    });
    expect(events.find((event) => event.event === "agent.run")).toMatchObject({
      cli: "codex",
      tool_call_count: 1,
    });
  });
  it("keeps the agent's own outcome when it ended the session", async () => {
    const { runner, sessions } = await setup([
      { stdout: result("Entered 9 lines.") },
    ]);
    const run = await runner.start(request);
    sessions.end(sessions.get(run.sessionId)!.client, {
      sessionId: run.sessionId,
      outcome: "failed",
      summary: "Task not found.",
    });
    await settled(runner);
    expect(sessions.get(run.sessionId)!.state).toBe("failed");
  });

  it("ends the session as done when the agent exits 0 without ending it", async () => {
    const { runner, sessions } = await setup([
      { stdout: result("Entered 9 lines.") },
    ]);
    const run = await runner.start(request);
    await settled(runner);
    const session = sessions.get(run.sessionId)!;
    expect(session.state).toBe("done");
    expect(session.messages.at(-1)).toMatchObject({
      kind: "end",
      summary: "Entered 9 lines.",
    });
  });

  it("fails with the error output on a non-zero exit", async () => {
    const { runner, sessions } = await setup([{ stderr: "boom" }, { exit: 3 }]);
    const run = await runner.start(request);
    await settled(runner);
    expect(sessions.get(run.sessionId)!.state).toBe("failed");
    expect(sessions.snapshot().errors[0]!.message).toContain("boom");
  });

  it("reports a provider session limit in the failed session and activity", async () => {
    const message =
      "You've hit your session limit · resets 7am (America/Toronto)";
    const { runner, sessions, revoked } = await setup([
      {
        stdout: JSON.stringify({
          type: "result",
          subtype: "success",
          is_error: true,
          result: message,
        }),
      },
      { exit: 1 },
    ]);
    const run = await runner.start(request);
    await settled(runner);
    const session = sessions.get(run.sessionId)!;
    expect(session.state).toBe("failed");
    expect(session.messages.at(-1)).toMatchObject({
      kind: "end",
      summary: message,
    });
    expect(sessions.snapshot().errors[0]!.message).toBe(message);
    expect(revoked).toContain(session.client.id);
  });

  it("stops a run as cancelled", async () => {
    const { runner, sessions } = await setup([{ hang: true }]);
    const run = await runner.start(request);
    expect(runner.stop(run.id)).toBe(true);
    await settled(runner);
    expect(sessions.get(run.sessionId)!.state).toBe("cancelled");
  });

  it("kills a run stalled for 10 minutes", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const { runner, sessions } = await setup([{ hang: true }], {
        sessions: new AgentSessions({ now: () => Date.now() }),
      });
      const run = await runner.start(request);
      vi.setSystemTime(Date.now() + 60 * 60_000);
      sessions.tick();
      runner.tick();
      vi.setSystemTime(Date.now() + 10 * 60_000 + 1);
      runner.tick();
      await settled(runner);
      expect(sessions.get(run.sessionId)!.state).toBe("failed");
    } finally {
      vi.useRealTimers();
    }
  });

  it("refuses a second run while one is going", async () => {
    const { runner } = await setup([{ hang: true }]);
    const run = await runner.start(request);
    await expect(runner.start(request)).rejects.toMatchObject({ status: 409 });
    runner.stop(run.id);
    await settled(runner);
  });

  it("refuses to start without Chrome in the default browser mode", async () => {
    const { runner } = await setup([], { chrome: false });
    await expect(runner.start(request)).rejects.toThrow(
      "Install Google Chrome to run agent tasks.",
    );
  });

  it("revokes the client and removes the folder on every exit", async () => {
    const { runner, revoked, work, report } = await setup([{ exit: 1 }]);
    await runner.start(request);
    await settled(runner);
    expect(revoked).toHaveLength(1);
    const left = (await readdir(work)).filter((name) =>
      name.startsWith("run-"),
    );
    expect(left).toEqual([]);
    const line = JSON.parse((await readFile(report, "utf8")).trim());
    expect(line.hasToken).toBe(true);
    expect(JSON.stringify(line.argv)).not.toContain("ajour_");
  });

  it("does not pass other AJOUR_ variables to the CLI", async () => {
    vi.stubEnv("AJOUR_SOMETHING", "leak");
    try {
      const { runner, report } = await setup([{ exit: 0 }]);
      await runner.start(request);
      await settled(runner);
      const line = JSON.parse((await readFile(report, "utf8")).trim());
      expect(line.hasToken).toBe(true);
      expect(line.ajourKeys).toEqual([]);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("logs one agent.run event without prompt or output", async () => {
    const { runner, events } = await setup([
      { stderr: "secret week data" },
      { exit: 1 },
    ]);
    await runner.start(request);
    await settled(runner);
    const event = events.find((candidate) => candidate.event === "agent.run")!;
    expect(event).toMatchObject({
      plugin_id: "ajp-test",
      task_id: "enter-week",
      cli: "claude-code",
      outcome: "failed",
      exit_code: 1,
    });
    expect(JSON.stringify(events)).not.toContain("secret week data");
    expect(JSON.stringify(events)).not.toContain("Enter week");
  });

  it("shutdown kills the process and revokes the client", async () => {
    const { runner, revoked } = await setup([{ hang: true }]);
    await runner.start(request);
    await runner.shutdown();
    expect(revoked).toHaveLength(1);
    expect((await runner.overview()).currentRun).toBeNull();
  });

  it("starts once when two starts arrive together", async () => {
    const { runner, revoked } = await setup([{ hang: true }]);
    const results = await Promise.allSettled([
      runner.start(request),
      runner.start(request),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([
      "fulfilled",
      "rejected",
    ]);
    const rejected = results.find((r) => r.status === "rejected")!;
    expect((rejected as PromiseRejectedResult).reason).toMatchObject({
      status: 409,
    });
    const fulfilled = results.find(
      (
        r,
      ): r is PromiseFulfilledResult<
        Awaited<ReturnType<typeof runner.start>>
      > => r.status === "fulfilled",
    )!;
    expect(runner.stop(fulfilled.value.id)).toBe(true);
    await settled(runner);
    expect(revoked).toHaveLength(1);
  });

  it("shutdown waits for a start in progress and stops its run", async () => {
    const { runner, sessions, revoked } = await setup([{ hang: true }]);
    const started = runner.start(request);
    await runner.shutdown();
    const run = await started;
    expect(revoked).toHaveLength(1);
    expect(runner.currentRun()).toBeNull();
    const session = sessions.get(run.sessionId)!;
    expect(session.state).toBe("cancelled");
    expect(session.messages.at(-1)).toMatchObject({
      kind: "end",
      summary: "Ajour quit during the run.",
    });
  });

  it("kills a CLI that ignores SIGTERM after the grace period", async () => {
    const { runner, sessions, report } = await setup(
      [{ ignoreTerm: true }, { hang: true }],
      { killGraceMs: 50 },
    );
    const run = await runner.start(request);
    await waitForCli(report);
    expect(runner.stop(run.id)).toBe(true);
    await settled(runner);
    expect(sessions.get(run.sessionId)!.state).toBe("cancelled");
  });

  it("shutdown resolves when the CLI ignores SIGTERM", async () => {
    const { runner, revoked, report } = await setup(
      [{ ignoreTerm: true }, { hang: true }],
      { killGraceMs: 50 },
    );
    await runner.start(request);
    await waitForCli(report);
    await runner.shutdown();
    expect(revoked).toHaveLength(1);
    expect(runner.currentRun()).toBeNull();
  });

  it("cleans up when the invocation cannot be built", async () => {
    const adapter: AgentCliAdapter = {
      ...claudeCodeAdapter,
      executableName: "node",
      buildInvocation: () => {
        throw new Error("no invocation");
      },
    };
    const { runner, sessions, revoked, work } = await setup([], { adapter });
    await expect(runner.start(request)).rejects.toThrow("no invocation");
    expect(revoked).toHaveLength(1);
    const left = (await readdir(work)).filter((name) =>
      name.startsWith("run-"),
    );
    expect(left).toEqual([]);
    expect(runner.currentRun()).toBeNull();
    const [session] = sessions.snapshot().sessions;
    expect(session!.state).toBe("failed");
  });

  it("fails the session when an MCP server did not start", async () => {
    const init = JSON.stringify({
      type: "system",
      subtype: "init",
      mcp_servers: [{ name: "playwright", status: "failed" }],
    });
    const { runner, sessions } = await setup([
      { stdout: init },
      { hang: true },
    ]);
    const run = await runner.start(request);
    await settled(runner);
    const session = sessions.get(run.sessionId)!;
    expect(session.state).toBe("failed");
    expect(session.messages.at(-1)).toMatchObject({
      kind: "end",
      summary: "The playwright MCP server did not start.",
    });
    expect(sessions.snapshot().errors[0]!.message).toContain(
      "The playwright MCP server did not start.",
    );
  });

  it("gives the session its run ID and an https week link", async () => {
    const { runner, sessions } = await setup([{ hang: true }]);
    const run = await runner.start(request);
    const session = sessions.get(run.sessionId)!;
    expect(session.runId).toBe(run.id);
    expect(session.link).toEqual({
      label: "Open the week in Workday",
      url: "https://wd.example/t?date=2026-10-12",
    });
    runner.stop(run.id);
    await settled(runner);
  });

  it("gives no link when the week link fills to a non-https URL", async () => {
    const { runner, sessions } = await setup([{ hang: true }], {
      values: { url: "http://wd.example/t" },
    });
    const run = await runner.start(request);
    expect(sessions.get(run.sessionId)!.link).toBeUndefined();
    runner.stop(run.id);
    await settled(runner);
  });

  it("fills an unset optional setting as an empty string", async () => {
    const { runner, sessions } = await setup([{ hang: true }], {
      weekLink: "{{settings.url}}?note={{settings.note}}",
    });
    const run = await runner.start(request);
    expect(sessions.get(run.sessionId)!.link?.url).toBe(
      "https://wd.example/t?note=",
    );
    runner.stop(run.id);
    await settled(runner);
  });

  it("stops a CLI that keeps running 2 minutes after its session ended", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const { runner, sessions } = await setup([{ hang: true }]);
      const run = await runner.start(request);
      sessions.end(sessions.get(run.sessionId)!.client, {
        sessionId: run.sessionId,
        outcome: "done",
        summary: "Entered 9 lines.",
      });
      runner.tick();
      vi.setSystemTime(Date.now() + 60_000);
      runner.tick();
      expect(runner.currentRun()).not.toBeNull();
      vi.setSystemTime(Date.now() + 60_000);
      runner.tick();
      await settled(runner);
      const session = sessions.get(run.sessionId)!;
      expect(session.state).toBe("done");
      expect(session.messages.at(-1)).toMatchObject({
        kind: "end",
        summary: "Entered 9 lines.",
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
