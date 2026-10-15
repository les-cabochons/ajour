import { mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { AgentSessions } from "../agent-sessions.ts";
import { claudeCodeAdapter } from "./adapters/claude-code.ts";
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

function fakeStorage({
  cli,
  values,
  revoked,
}: {
  cli: "claude-code";
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

function fakePlugins(prompt: string) {
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
            weekLink: "{{settings.url}}?date={{weekOf}}",
            settings: [
              {
                id: "url",
                label: "URL",
                type: "url" as const,
                required: true,
                secret: false,
              },
            ],
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
  options: { chrome?: boolean; sessions?: AgentSessions } = {},
) {
  const work = await mkdtemp(path.join(tmpdir(), "ajour-runner-test-"));
  const report = path.join(work, "report.jsonl");
  const sessions = options.sessions ?? new AgentSessions();
  const revoked: string[] = [];
  const events: Record<string, unknown>[] = [];
  const runner = new AgentRunner({
    storage: fakeStorage({
      cli: "claude-code",
      values: { url: "https://wd.example/t" },
      revoked,
    }),
    sessions,
    plugins: fakePlugins("Enter week {{weekOf}} in {{settings.url}}."),
    adapters: [fakeAdapter(script, report)],
    findExecutable: async () => "/fake/claude",
    readVersion: async () => "1.0.0",
    loginShellPath: async () => process.env.PATH ?? "",
    chromeInstalled: async () => options.chrome ?? true,
    playwright: () => ({ command: "node", args: [], env: {} }),
    profileDirectory: path.join(work, "profile"),
    tempRoot: work,
    ajourMcpUrl: "http://127.0.0.1:8787/mcp/ajour",
    logEvent: (event) => events.push(event),
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

describe("AgentRunner", () => {
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
});
