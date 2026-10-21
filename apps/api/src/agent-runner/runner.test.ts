import { ChildProcess } from "node:child_process";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AjourEvent } from "../../../../packages/wide-events/catalog.ts";
import {
  createRecordingSink,
  type Sink,
} from "../../../../packages/wide-events/sinks.ts";
import { AgentSessions } from "../agent-sessions.ts";
import { createApiEvents } from "../events.ts";
import { claudeCodeAdapter } from "./adapters/claude-code.ts";
import { codexAdapter } from "./adapters/codex.ts";
import type { AgentCliId } from "../../../../packages/shared/agent-runs.ts";
import type {
  AgentTask,
  PluginField,
} from "../../../../packages/shared/plugins.ts";
import type { AgentCliAdapter } from "./adapter.ts";
import { AgentRunner, DEFAULT_KILL_GRACE_MS } from "./runner.ts";

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

const fakeSettings: PluginField[] = [
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
  revokeError,
  whileRevoking,
}: {
  cli: AgentCliId;
  values: Record<string, string>;
  revoked: string[];
  revokeError?: Error;
  whileRevoking?: () => Promise<void>;
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
      await whileRevoking?.();
      if (revokeError) throw revokeError;
      revoked.push(clientId);
      return true;
    },
  };
}

function fakePlugins(
  prompt: string,
  weekLink: string,
  otherTasks: AgentTask[] = [],
) {
  const manifest = {
    id: "ajp-test",
    displayName: "Workday",
    capabilities: {
      agentTask: {
        tasks: [
          {
            id: "enter-week",
            label: "Enter in Workday",
            placement: "commit-week" as const,
            prompt: "p.md",
            estimateMinutes: 10,
            weekLink,
            settings: fakeSettings,
          },
          ...otherTasks,
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
    otherTasks?: AgentTask[];
    /** Where runs make their folder, under the test's folder. */
    tempRoot?: string;
    findExecutable?: (name: string) => Promise<string | null>;
    readPrompt?: () => Promise<string>;
    revokeError?: Error;
    /** Runs while the client is revoked, before the revoke answers. */
    whileRevoking?: () => Promise<void>;
    /** Replaces the sink that collects `events`. */
    sink?: Sink;
    /** What `<cli> --version` prints. */
    versionOutput?: string;
  } = {},
) {
  const work = await mkdtemp(path.join(tmpdir(), "ajour-runner-test-"));
  tempDirs.push(work);
  const report = path.join(work, "report.jsonl");
  reports.push(report);
  const recording = createRecordingSink<AjourEvent>();
  const { events } = recording;
  // The work folder stands in for the user data path, and a fake home
  // directory for the user's, so the tests can check the scrubber.
  const apiEvents = createApiEvents({
    sink: options.sink ?? recording,
    userDataPath: work,
    homeDirectory: "C:\\Users\\someone",
  });
  // Session ends go to the same sink, as in the server.
  const sessions = options.sessions ?? new AgentSessions({ events: apiEvents });
  const revoked: string[] = [];
  const runner = new AgentRunner({
    storage: fakeStorage({
      cli: options.adapter?.id ?? "claude-code",
      values: options.values ?? { url: "https://wd.example/t" },
      revoked,
      revokeError: options.revokeError,
      whileRevoking: options.whileRevoking,
    }),
    sessions,
    plugins: {
      ...fakePlugins(
        "Enter week {{weekOf}} in {{settings.url}}.",
        options.weekLink ?? "{{settings.url}}?date={{weekOf}}",
        options.otherTasks,
      ),
      ...(options.readPrompt
        ? { readAgentTaskPrompt: options.readPrompt }
        : {}),
    },
    adapters: [options.adapter ?? fakeAdapter(script, report)],
    findExecutable: options.findExecutable ?? (async () => "/fake/claude"),
    readVersion: async () => options.versionOutput ?? "1.0.0",
    loginShellPath: async () => process.env.PATH ?? "",
    chromeInstalled: async () => options.chrome ?? true,
    playwright: () => ({ command: "node", args: [], env: {} }),
    profileDirectory: path.join(work, "profile"),
    tempRoot: options.tempRoot ? path.join(work, options.tempRoot) : work,
    ajourMcpUrl: "http://127.0.0.1:8787/mcp/ajour",
    events: apiEvents,
    ...(options.killGraceMs === undefined
      ? {}
      : { killGraceMs: options.killGraceMs }),
  });
  runners.push({ runner, limitMs: shutdownLimitMs(options.killGraceMs) });
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

/** Each test's reports, so the escapees its fake CLIs started are killed after it. */
const reports: string[] = [];
/**
 * Each test's runners, so a test that fails mid-run still stops its CLI:
 * Windows cannot remove a folder a running process works in.
 */
const runners: { runner: AgentRunner; limitMs: number }[] = [];
/** Each test's folders, removed after it whether it passed or failed. */
const tempDirs: string[] = [];
/**
 * The escapee pids this test already killed or found gone. Windows reuses
 * pids quickly, so a pid is never killed a second time.
 */
const handledPids = new Set<number>();

/**
 * How long the cleanup waits for a runner before it removes the folders
 * anyway: the runner sends SIGKILL after the kill grace period and ends the
 * run without its CLI a second later, plus a margin.
 */
function shutdownLimitMs(killGraceMs = DEFAULT_KILL_GRACE_MS) {
  return killGraceMs + 1000 + 500;
}

/** The longest shutdown plus the removal's retries (200 + 400 + … + 1000 ms). */
const CLEANUP_TIMEOUT_MS = shutdownLimitMs() + 3000 + 1000;

afterEach(async () => {
  vi.restoreAllMocks();
  const testReports = reports.splice(0);
  const testRunners = runners.splice(0);
  try {
    await killEscapees(testReports);
    await shutDownWithinLimit(testRunners);
  } finally {
    // An escapee can report itself while the runners shut down.
    await killEscapees(testReports);
    handledPids.clear();
    // On Windows a process that just exited can hold a handle in its folder
    // for a moment, so the removal retries.
    await Promise.all(
      tempDirs.splice(0).map((directory) =>
        rm(directory, {
          recursive: true,
          force: true,
          maxRetries: 5,
          retryDelay: 200,
        }),
      ),
    );
  }
}, CLEANUP_TIMEOUT_MS);

/** Kills an escapee, unless this test already dealt with its pid. */
function killEscapee(pid: number) {
  if (handledPids.has(pid)) return;
  handledPids.add(pid);
  if (isAlive(pid)) process.kill(pid, "SIGKILL");
}

async function killEscapees(testReports: string[]) {
  for (const report of testReports) {
    for (const pid of await grandchildPids(report)) killEscapee(pid);
  }
}

/**
 * Shuts the runners down, or gives up after the longest of their limits: a
 * test that failed can leave a run whose cleanup never ends.
 */
async function shutDownWithinLimit(
  testRunners: { runner: AgentRunner; limitMs: number }[],
) {
  if (testRunners.length === 0) return;
  const limitMs = Math.max(...testRunners.map(({ limitMs }) => limitMs));
  let timer: NodeJS.Timeout | undefined;
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new Error(
            `A runner did not shut down within ${limitMs} ms of the test's end.`,
          ),
        ),
      limitMs,
    );
  });
  try {
    await Promise.race([
      Promise.all(testRunners.map(({ runner }) => runner.shutdown())),
      limit,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function grandchildPids(report: string): Promise<number[]> {
  return (await readFile(report, "utf8").catch(() => ""))
    .split("\n")
    .filter(Boolean)
    .map(
      (text) => (JSON.parse(text) as { grandchildPid?: number }).grandchildPid,
    )
    .filter((pid): pid is number => pid !== undefined);
}

/** Waits for the fake CLI's first grandchild and returns its pid. */
async function waitForGrandchild(report: string): Promise<number> {
  return await vi.waitFor(
    async () => {
      const [pid] = await grandchildPids(report);
      expect(pid).toBeDefined();
      return pid!;
    },
    { timeout: 5000 },
  );
}

/**
 * Records the pid of each child process that emits "exit" in this test
 * process. The runner listens on the same emitter, so a pid listed here is an
 * exit the runner has already handled.
 */
function recordExits(): number[] {
  const exited: number[] = [];
  const emit = ChildProcess.prototype.emit;
  vi.spyOn(ChildProcess.prototype, "emit").mockImplementation(function (
    this: ChildProcess,
    event: string | symbol,
    ...rest: unknown[]
  ) {
    const handled = Reflect.apply(emit, this, [event, ...rest]) as boolean;
    if (event === "exit" && this.pid !== undefined) exited.push(this.pid);
    return handled;
  });
  return exited;
}

/**
 * Starts and stops one more run, which the runner refuses while a run is
 * going. Its escapee is reported before Stop, so the cleanup finds it.
 */
async function expectNextRunStarts(runner: AgentRunner, report: string) {
  const before = (await grandchildPids(report)).length;
  const next = await runner.start(request);
  await vi.waitFor(
    async () => expect((await grandchildPids(report)).length).toBe(before + 1),
    { timeout: 5000 },
  );
  runner.stop(next.id);
  await settled(runner);
}

/** Waits for the fake CLI's first report line and returns its pid. */
async function waitForCliPid(report: string): Promise<number> {
  return await vi.waitFor(
    async () => {
      const [first] = (await readFile(report, "utf8")).split("\n");
      const pid = (JSON.parse(first!) as { pid?: number }).pid;
      expect(pid).toBeDefined();
      return pid!;
    },
    { timeout: 5000 },
  );
}

function isAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

const runEvents = <Event extends { name: string }>(events: Event[]) =>
  events.filter((event) => event.name === "agent.run");

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
    expect(runEvents(events)).toEqual([
      expect.objectContaining({
        agent: expect.objectContaining({ cli: "codex", tool_call_count: 1 }),
      }),
    ]);
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
    expect(runEvents(events)).toEqual([
      expect.objectContaining({
        kind: "job",
        runtime: "api",
        trigger: "user",
        outcome: "error",
        plugin: { id: "ajp-test" },
        agent: expect.objectContaining({
          task_id: "enter-week",
          cli: "claude-code",
          exit_code: 1,
        }),
      }),
    ]);
    expect(JSON.stringify(events)).not.toContain("secret week data");
    expect(JSON.stringify(events)).not.toContain("Enter week");
  });

  it("names the run, its session and its client in agent.run", async () => {
    const { runner, sessions, events } = await setup([{ exit: 0 }]);
    const run = await runner.start(request);
    await settled(runner);
    const ids = {
      run_id: run.id,
      session_id: run.sessionId,
      client_id: "c-Enter in Workday run",
    };
    expect(sessions.get(run.sessionId)!.client.id).toBe(ids.client_id);
    // The session's end joins the run on the same three IDs.
    expect(events).toEqual([
      expect.objectContaining({
        name: "agent.session",
        outcome: "ok",
        agent: expect.objectContaining(ids),
      }),
      expect.objectContaining({
        name: "agent.run",
        outcome: "ok",
        agent: expect.objectContaining(ids),
        cleanup: { outcome: "ok", failed_steps: [] },
      }),
    ]);
    expect(events[1]).not.toHaveProperty("launch");
    expect(events[1]).not.toHaveProperty("error");
    // The session is a child span of the run, and the user started both.
    expect(events.map((event) => event.trigger)).toEqual(["user", "user"]);
    expect(events[0]).toMatchObject({
      trace_id: events[1]!.trace_id,
      parent_span_id: events[1]!.span_id,
    });
  });

  it("logs a launch that fails after its session began, with the step", async () => {
    const { runner, sessions, events, work } = await setup([], {
      tempRoot: "no-such-folder",
    });
    await expect(runner.start(request)).rejects.toThrow();
    const [session] = sessions.snapshot().sessions;
    expect(session!.state).toBe("failed");
    expect(runEvents(events)).toEqual([
      expect.objectContaining({
        agent: expect.objectContaining({
          run_id: session!.runId,
          session_id: session!.id,
          client_id: "c-Enter in Workday run",
          task_id: "enter-week",
        }),
        plugin: { id: "ajp-test" },
        outcome: "error",
        error: {
          type: "Error",
          code: "ENOENT",
          message: expect.stringContaining(
            `[user data]${path.sep}no-such-folder`,
          ),
        },
        launch: { failed_step: "create_work_folder" },
        cleanup: { outcome: "ok", failed_steps: [] },
      }),
    ]);
    expect(events).toContainEqual(
      expect.objectContaining({
        name: "agent.session",
        agent: expect.objectContaining({ run_id: session!.runId }),
        outcome: "error",
      }),
    );
    // The error message names the folder, but the scrubber takes out the
    // path that leads to it.
    expect(JSON.stringify(events)).not.toContain(
      JSON.stringify(work).slice(1, -1),
    );
  });

  it("logs a CLI that could not be spawned as a launch failure", async () => {
    const adapter: AgentCliAdapter = {
      ...fakeAdapter([], ""),
      // Next to the run's folder, so under the test's stand-in user data path.
      buildInvocation: (input) => ({
        command: path.join(input.workDirectory, "..", "no-such-cli", "claude"),
        args: [],
        env: input.baseEnv,
        files: {},
      }),
    };
    const { runner, sessions, events, work } = await setup([], { adapter });
    const run = await runner.start(request);
    await settled(runner);
    expect(sessions.get(run.sessionId)!.state).toBe("failed");
    expect(runEvents(events)).toEqual([
      expect.objectContaining({
        agent: expect.objectContaining({
          run_id: run.id,
          session_id: run.sessionId,
        }),
        outcome: "error",
        error: {
          type: "Error",
          code: "ENOENT",
          message: expect.stringContaining("[user data]"),
        },
        launch: { failed_step: "spawn" },
      }),
    ]);
    expect(JSON.stringify(events)).not.toContain(
      JSON.stringify(work).slice(1, -1),
    );
  });

  it("reports a CLI that could not be spawned as failed, even while Ajour quits", async () => {
    const adapter: AgentCliAdapter = {
      ...fakeAdapter([], ""),
      buildInvocation: (input) => ({
        command: path.join(tmpdir(), "ajour-no-such-cli", "claude"),
        args: [],
        env: input.baseEnv,
        files: {},
      }),
    };
    const { runner, sessions, events } = await setup([], { adapter });
    const run = await runner.start(request);
    // The spawn error arrives after start returns, so shutdown is waiting.
    await runner.shutdown();
    expect(sessions.get(run.sessionId)!.state).toBe("failed");
    expect(runEvents(events)).toEqual([
      expect.objectContaining({
        outcome: "error",
        agent: expect.objectContaining({ stop_reason: "shutdown" }),
        launch: { failed_step: "spawn" },
      }),
    ]);
  });

  it("logs a spawn that throws as a launch failure", async () => {
    const adapter: AgentCliAdapter = {
      ...fakeAdapter([], ""),
      buildInvocation: (input) => ({
        command: process.execPath,
        args: ["no\0null"],
        env: input.baseEnv,
        files: {},
      }),
    };
    const { runner, events, revoked } = await setup([], { adapter });
    await expect(runner.start(request)).rejects.toThrow();
    expect(revoked).toHaveLength(1);
    expect(runEvents(events)).toEqual([
      expect.objectContaining({
        outcome: "error",
        error: expect.objectContaining({
          type: "TypeError",
          code: "ERR_INVALID_ARG_VALUE",
        }),
        launch: { failed_step: "spawn" },
      }),
    ]);
  });

  it("logs a launch that fails before its session, with the run ID only", async () => {
    const { runner, events, revoked } = await setup([], {
      readPrompt: async () => {
        throw Object.assign(
          new Error("ENOENT: no such file, open 'C:\\Users\\someone\\p.md'"),
          { code: "ENOENT" },
        );
      },
    });
    await expect(runner.start(request)).rejects.toThrow("ENOENT");
    expect(revoked).toEqual([]);
    const [event] = runEvents(events);
    expect(event).toMatchObject({
      plugin: { id: "ajp-test" },
      agent: { task_id: "enter-week" },
      outcome: "error",
      // The scrubber replaces the home directory.
      error: {
        type: "Error",
        code: "ENOENT",
        message: "ENOENT: no such file, open '~\\p.md'",
      },
      launch: { failed_step: "read_prompt" },
      cleanup: { outcome: "ok", failed_steps: [] },
    });
    expect(event!.agent?.run_id).toEqual(expect.any(String));
    expect(event!.agent?.session_id).toBeUndefined();
    expect(event!.agent?.client_id).toBeUndefined();
    expect(events.map((event) => event.name)).toEqual(["agent.run"]);
    expect(JSON.stringify(events)).not.toContain("someone");
  });

  it("logs a CLI that went missing since the overview as a launch failure", async () => {
    // The overview finds `claude`; the fake adapter's launch looks for `node`.
    const { runner, events } = await setup([], {
      findExecutable: async (name) => (name === "node" ? null : "/fake/claude"),
    });
    await expect(runner.start(request)).rejects.toMatchObject({ status: 400 });
    expect(runEvents(events)).toEqual([
      expect.objectContaining({
        outcome: "error",
        error: expect.objectContaining({ type: "AgentRunError" }),
        launch: { failed_step: "find_executable" },
      }),
    ]);
  });

  it("folds a failed revoke into agent.run without its message", async () => {
    const { runner, events, work } = await setup([{ exit: 0 }], {
      revokeError: Object.assign(
        new Error("EPERM: operation not permitted, 'C:\\Users\\someone\\x'"),
        { code: "EPERM" },
      ),
    });
    await runner.start(request);
    await settled(runner);
    expect(events.map((event) => event.name)).toEqual([
      "agent.session",
      "agent.run",
    ]);
    expect(events[1]).toMatchObject({
      outcome: "ok",
      cleanup: {
        outcome: "failed",
        failed_steps: ["revoke_client"],
        error: { type: "Error", code: "EPERM" },
      },
    });
    // The folder still goes away.
    expect(
      (await readdir(work)).filter((name) => name.startsWith("run-")),
    ).toEqual([]);
    expect(JSON.stringify(events)).not.toContain("someone");
  });

  it("folds a session that could not be ended into agent.run", async () => {
    const sessions = new AgentSessions();
    const { runner, events, revoked } = await setup([{ exit: 0 }], {
      sessions,
    });
    const run = await runner.start(request);
    vi.spyOn(sessions, "end").mockImplementation(() => {
      throw new Error("C:\\Users\\someone\\state.json is locked");
    });
    await settled(runner);
    expect(revoked).toHaveLength(1);
    expect(events).toEqual([
      expect.objectContaining({
        name: "agent.run",
        agent: expect.objectContaining({ run_id: run.id }),
        cleanup: {
          outcome: "failed",
          failed_steps: ["end_session"],
          error: { type: "Error" },
        },
      }),
    ]);
    expect(JSON.stringify(events)).not.toContain("someone");
  });

  it("keeps every failed cleanup step, so a revoke that failed always shows", async () => {
    const sessions = new AgentSessions();
    const { runner, events } = await setup([{ exit: 0 }], {
      sessions,
      revokeError: Object.assign(new Error("EBUSY"), { code: "EBUSY" }),
    });
    await runner.start(request);
    vi.spyOn(sessions, "end").mockImplementation(() => {
      throw new TypeError("no session");
    });
    await settled(runner);
    expect(runEvents(events)).toEqual([
      expect.objectContaining({
        cleanup: {
          outcome: "failed",
          failed_steps: ["end_session", "revoke_client"],
          // The first failed step's error.
          error: { type: "TypeError" },
        },
      }),
    ]);
  });

  it("logs the CLI version only when it looks like a version", async () => {
    const versioned = await setup([{ exit: 0 }], {
      versionOutput: "1.4.2 (Claude Code)\n",
    });
    await versioned.runner.start(request);
    await settled(versioned.runner);
    expect(runEvents(versioned.events)[0]!.agent?.cli_version).toBe("1.4.2");

    // Output the adapter cannot read is CLI output, and stays out.
    const unreadable = await setup([{ exit: 0 }], {
      versionOutput: "profile C:\\Users\\someone\\.claude, build 7",
    });
    await unreadable.runner.start(request);
    await settled(unreadable.runner);
    expect(runEvents(unreadable.events)[0]!.agent?.cli_version).toBeUndefined();
    expect(JSON.stringify(unreadable.events)).not.toContain("someone");
  });

  it("keeps working when the log sink throws", async () => {
    const sinkDown = {
      emit() {
        throw new Error("sink down");
      },
    };
    const { runner, sessions } = await setup([{ exit: 0 }], {
      sink: sinkDown,
    });
    const first = await runner.start(request);
    await settled(runner);
    expect(sessions.get(first.sessionId)!.state).toBe("done");
    const second = await runner.start(request);
    await settled(runner);
    expect(sessions.get(second.sessionId)!.state).toBe("done");

    // A failed launch still reports its own error, not the sink's.
    const missing = await setup([], {
      sink: sinkDown,
      findExecutable: async (name) => (name === "node" ? null : "/fake/claude"),
    });
    await expect(missing.runner.start(request)).rejects.toMatchObject({
      status: 400,
    });
  });

  it("logs no agent.run for a start it refuses", async () => {
    const { runner, events } = await setup([], { chrome: false });
    await expect(runner.start(request)).rejects.toMatchObject({ status: 400 });
    expect(events).toEqual([]);
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

  it("ends a run exactly once when shutdown gives up on a CLI that never closes", async () => {
    // The escapee is outside the CLI's tree and keeps its output open, so
    // the CLI's close never comes while it lives.
    const { runner, sessions, events, revoked, report } = await setup(
      [{ escapee: true }, { hang: true }],
      { killGraceMs: 50 },
    );
    const run = await runner.start(request);
    const escapee = await waitForGrandchild(report);
    await runner.shutdown();
    expect(runner.currentRun()).toBeNull();
    expect(revoked).toHaveLength(1);
    expect(sessions.get(run.sessionId)!.state).toBe("cancelled");
    expect(runEvents(events)).toEqual([
      expect.objectContaining({
        outcome: "cancelled",
        agent: expect.objectContaining({
          run_id: run.id,
          stop_reason: "shutdown",
        }),
      }),
    ]);
    // The escapee survives: ending what the CLI started is #341.
    expect(isAlive(escapee)).toBe(true);
    // With the escapee gone the close arrives late. It must not end the run
    // a second time.
    killEscapee(escapee);
    await vi.waitFor(() => expect(isAlive(escapee)).toBe(false));
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(runEvents(events)).toHaveLength(1);
    expect(revoked).toHaveLength(1);
  });

  it("ends a stopped run within the grace period even when its output never closes", async () => {
    const { runner, sessions, events, report } = await setup(
      [{ escapee: true }, { hang: true }],
      { killGraceMs: 50 },
    );
    const run = await runner.start(request);
    await waitForGrandchild(report);
    expect(runner.stop(run.id)).toBe(true);
    // The kill grace period plus a second, as at quit.
    await settled(runner);
    expect(sessions.get(run.sessionId)!.state).toBe("cancelled");
    expect(runEvents(events)).toEqual([
      expect.objectContaining({
        outcome: "cancelled",
        agent: expect.objectContaining({ run_id: run.id, stop_reason: "user" }),
      }),
    ]);
  });

  it("ends a run whose CLI exits on its own while something it started holds its output", async () => {
    const { runner, sessions, events, revoked, report } = await setup(
      [{ escapee: true }, { exit: 0 }],
      { killGraceMs: 50 },
    );
    const run = await runner.start(request);
    await waitForGrandchild(report);
    // No Stop: the kill grace period plus a second after the exit.
    await settled(runner);
    expect(sessions.get(run.sessionId)!.state).toBe("done");
    expect(runEvents(events)).toEqual([
      expect.objectContaining({
        outcome: "ok",
        agent: expect.objectContaining({ run_id: run.id, exit_code: 0 }),
      }),
    ]);
    expect(runEvents(events)[0]!.agent).not.toHaveProperty("stop_reason");
    expect(revoked).toEqual(["c-Enter in Workday run"]);
    const next = await runner.start(request);
    await settled(runner);
    expect(runEvents(events).map((event) => event.agent?.run_id)).toEqual([
      run.id,
      next.id,
    ]);
  });

  it("ends a run Ajour stops after its session ended, even when its output never closes", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const { runner, sessions, events, revoked, report } = await setup(
        [{ escapee: true }, { hang: true }],
        { killGraceMs: 50 },
      );
      const run = await runner.start(request);
      await waitForGrandchild(report);
      sessions.end(sessions.get(run.sessionId)!.client, {
        sessionId: run.sessionId,
        outcome: "done",
        summary: "Entered 9 lines.",
      });
      runner.tick();
      vi.setSystemTime(Date.now() + 2 * 60_000);
      runner.tick();
      await settled(runner);
      expect(runEvents(events)).toEqual([
        expect.objectContaining({
          outcome: "ok",
          agent: expect.objectContaining({
            run_id: run.id,
            stop_reason: "ended",
          }),
        }),
      ]);
      expect(revoked).toHaveLength(1);
      await expectNextRunStarts(runner, report);
    } finally {
      vi.useRealTimers();
    }
  });

  it("ends a run Ajour stops for a failed MCP server, even when its output never closes", async () => {
    const init = JSON.stringify({
      type: "system",
      subtype: "init",
      mcp_servers: [{ name: "playwright", status: "failed" }],
    });
    const { runner, sessions, events, revoked, report } = await setup(
      [{ escapee: true }, { stdout: init }, { hang: true }],
      { killGraceMs: 50 },
    );
    const run = await runner.start(request);
    await waitForGrandchild(report);
    await settled(runner);
    expect(sessions.get(run.sessionId)!.state).toBe("failed");
    expect(runEvents(events)).toEqual([
      expect.objectContaining({
        outcome: "error",
        agent: expect.objectContaining({ run_id: run.id, stop_reason: "mcp" }),
      }),
    ]);
    expect(revoked).toHaveLength(1);
    await expectNextRunStarts(runner, report);
  });

  it("ignores Stop once the CLI has exited, so its own outcome stands", async () => {
    const exits = recordExits();
    const { runner, sessions, events, report } = await setup(
      [{ escapee: true }, { exit: 0 }],
      { killGraceMs: 50 },
    );
    const run = await runner.start(request);
    const cli = await waitForCliPid(report);
    await vi.waitFor(() => expect(exits).toContain(cli), { timeout: 5000 });
    expect(runner.stop(run.id)).toBe(true);
    await settled(runner);
    expect(sessions.get(run.sessionId)!.state).toBe("done");
    expect(runEvents(events)).toEqual([
      expect.objectContaining({
        outcome: "ok",
        agent: expect.objectContaining({ exit_code: 0 }),
      }),
    ]);
    expect(runEvents(events)[0]!.agent).not.toHaveProperty("stop_reason");
  });

  it("ignores Stop and the stall timer while the run is ending", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    let release!: () => void;
    const released = new Promise<void>((resolve) => (release = resolve));
    try {
      let revoking!: () => void;
      const revokeStarted = new Promise<void>(
        (resolve) => (revoking = resolve),
      );
      const { runner, events } = await setup([{ exit: 0 }], {
        whileRevoking: async () => {
          revoking();
          await released;
        },
      });
      const run = await runner.start(request);
      // The outcome is set and the session ended; the cleanup is waiting.
      await revokeStarted;
      runner.tick();
      vi.setSystemTime(Date.now() + 3 * 60_000);
      runner.tick();
      expect(runner.stop(run.id)).toBe(true);
      release();
      await settled(runner);
      expect(runEvents(events)).toEqual([
        expect.objectContaining({ outcome: "ok" }),
      ]);
      expect(runEvents(events)[0]!.agent).not.toHaveProperty("stop_reason");
    } finally {
      // A failed assertion must not leave the revoke, and so the run, waiting.
      release();
      vi.useRealTimers();
    }
  });

  it("cleans up when the invocation cannot be built", async () => {
    const adapter: AgentCliAdapter = {
      ...claudeCodeAdapter,
      executableName: "node",
      buildInvocation: () => {
        throw new Error("no invocation");
      },
    };
    const { runner, sessions, revoked, work, events } = await setup([], {
      adapter,
    });
    await expect(runner.start(request)).rejects.toThrow("no invocation");
    expect(revoked).toHaveLength(1);
    const left = (await readdir(work)).filter((name) =>
      name.startsWith("run-"),
    );
    expect(left).toEqual([]);
    expect(runner.currentRun()).toBeNull();
    const [session] = sessions.snapshot().sessions;
    expect(session!.state).toBe("failed");
    expect(runEvents(events)).toEqual([
      expect.objectContaining({
        agent: expect.objectContaining({ session_id: session!.id }),
        // Ajour's own message, scrubbed and sensitive like every message.
        error: { type: "Error", message: "no invocation" },
        launch: { failed_step: "build_invocation" },
        cleanup: { outcome: "ok", failed_steps: [] },
      }),
    ]);
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

  it("points a missing required setting to the plugin's settings page", async () => {
    const { runner } = await setup([], { values: {} });
    expect((await runner.overview()).tasks[0]!.blockers).toEqual([
      "Fill in URL in Settings > Plugins > Workday",
    ]);
  });

  it("uses a setting's manifest default until the user saves a value", async () => {
    fakeSettings[0]!.defaultValue = "https://wd.example/default";
    try {
      const { runner } = await setup([], { values: {} });
      const [task] = (await runner.overview()).tasks;
      expect(task!.blockers).toEqual([]);
      expect(task!.values.url).toBe("https://wd.example/default");
    } finally {
      delete fakeSettings[0]!.defaultValue;
    }
  });

  it("gives every task the default of the first task that declares a setting", async () => {
    fakeSettings[0]!.defaultValue = "https://wd.example/default";
    try {
      const { runner } = await setup([], {
        values: {},
        otherTasks: [
          {
            id: "submit-week",
            label: "Submit",
            placement: "submit-week",
            prompt: "p.md",
            estimateMinutes: 10,
            settings: [
              {
                id: "url",
                label: "Other label",
                type: "url",
                required: true,
                secret: false,
              },
            ],
          },
        ],
      });
      const submit = (await runner.overview()).tasks.find(
        (task) => task.taskId === "submit-week",
      )!;
      expect(submit.values.url).toBe("https://wd.example/default");
      expect(submit.blockers).toEqual([]);
    } finally {
      delete fakeSettings[0]!.defaultValue;
    }
  });

  it("names a missing shared setting by its first declaration", async () => {
    const { runner } = await setup([], {
      values: {},
      otherTasks: [
        {
          id: "submit-week",
          label: "Submit",
          placement: "submit-week",
          prompt: "p.md",
          estimateMinutes: 10,
          settings: [
            {
              id: "url",
              label: "Other label",
              type: "url",
              required: true,
              secret: false,
            },
          ],
        },
      ],
    });
    const submit = (await runner.overview()).tasks.find(
      (task) => task.taskId === "submit-week",
    )!;
    expect(submit.blockers).toEqual([
      "Fill in URL in Settings > Plugins > Workday",
    ]);
  });

  it("keeps a setting required for the task that requires it", async () => {
    const { runner } = await setup([], {
      otherTasks: [
        {
          id: "submit-week",
          label: "Submit",
          placement: "submit-week",
          prompt: "p.md",
          estimateMinutes: 10,
          settings: [
            {
              id: "note",
              label: "Other note",
              type: "text",
              required: true,
              secret: false,
            },
          ],
        },
      ],
    });
    const [enter, submit] = (await runner.overview()).tasks;
    expect(enter!.blockers).toEqual([]);
    expect(submit!.blockers).toEqual([
      "Fill in Note in Settings > Plugins > Workday",
    ]);
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
