import { spawn, type ChildProcess } from "node:child_process";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline";
import { randomUUID } from "node:crypto";
import type {
  AgentClientRef,
  AgentSession,
  AgentSessionOutcome,
  McpClientCreateResponse,
} from "../../../../packages/shared/agent-tools.ts";
import type {
  AgentCliStatus,
  AgentRun,
  AgentRunnerOverview,
  AgentRunnerSettings,
  AgentRunStartRequest,
  AgentTaskStatus,
} from "../../../../packages/shared/agent-runs.ts";
import type {
  AgentTask,
  ConnectorFieldValues,
} from "../../../../packages/shared/connectors.ts";
import { fillTemplate } from "../../../../packages/shared/agent-task-templates.ts";
import type { AgentSessions } from "../agent-sessions.ts";
import type {
  AgentCliAdapter,
  RunnerEvent,
  StdioServerSpec,
} from "./adapter.ts";
import { buildPrompt } from "./prompts.ts";

/**
 * Runs one plugin agent task at a time: a per-run MCP client, a session the
 * runner begins, the CLI in an empty temp folder, and cleanup on every exit.
 * See docs/superpowers/specs/2026-10-15-ajour-agent-runner-design.md.
 */

const STALL_LIMIT_MS = 10 * 60_000;
/** How long a CLI may keep running after its session ended before tick stops it. */
const ENDED_GRACE_MS = 2 * 60_000;
/** How long a CLI gets to exit after SIGTERM before it is killed. */
const DEFAULT_KILL_GRACE_MS = 5000;
const ERROR_LINES = 20;
const ALL_CLIS: {
  id: AgentCliStatus["id"];
  label: string;
  executableName: string;
}[] = [
  { id: "claude-code", label: "Claude Code", executableName: "claude" },
  { id: "codex", label: "Codex", executableName: "codex" },
  { id: "opencode", label: "OpenCode", executableName: "opencode" },
];

export class AgentRunError extends Error {
  readonly status: 400 | 404 | 409;

  constructor(message: string, status: 400 | 404 | 409) {
    super(message);
    this.name = "AgentRunError";
    this.status = status;
  }
}

interface RunnerStorage {
  getMcpSettings(): Promise<{ enabled: boolean }>;
  getAgentRunnerSettings(): Promise<AgentRunnerSettings>;
  getAgentTaskValues(
    pluginId: string,
    taskId: string,
  ): Promise<ConnectorFieldValues>;
  createMcpClient(name: string): Promise<McpClientCreateResponse>;
  revokeMcpClient(clientId: string): Promise<boolean>;
}

interface RunnerPlugins {
  listPlugins(): Promise<
    {
      id: string;
      displayName: string;
      capabilities: { agentTask?: { tasks: AgentTask[] } };
    }[]
  >;
  isPluginEnabled(pluginId: string): Promise<boolean>;
  readAgentTaskPrompt(pluginId: string, taskId: string): Promise<string>;
}

export interface AgentRunnerOptions {
  storage: RunnerStorage;
  sessions: AgentSessions;
  plugins: RunnerPlugins;
  adapters: AgentCliAdapter[];
  findExecutable: (name: string, pathValue: string) => Promise<string | null>;
  /** Runs `<cli> --version` with the login shell PATH. */
  readVersion?: (
    executable: string,
    pathValue: string,
  ) => Promise<string | undefined>;
  loginShellPath: () => Promise<string>;
  chromeInstalled: () => Promise<boolean>;
  playwright: (input: {
    browserMode: AgentRunnerSettings["browserMode"];
    profileDirectory: string;
  }) => StdioServerSpec;
  profileDirectory: string;
  tempRoot: string;
  ajourMcpUrl: string;
  logEvent: (event: Record<string, unknown>) => void;
  now?: () => number;
  /** Time between SIGTERM and SIGKILL. Tests shorten it. Defaults to 5 seconds. */
  killGraceMs?: number;
}

interface ActiveRun {
  run: AgentRun;
  client: AgentClientRef;
  child: ChildProcess;
  workDirectory: string;
  cli: AgentCliStatus["id"];
  version: string | undefined;
  browserMode: AgentRunnerSettings["browserMode"];
  stopReason?: "user" | "stalled" | "mcp" | "shutdown" | "ended";
  /** Sends SIGKILL if the CLI ignores SIGTERM. Cleared when it exits. */
  killTimer?: NodeJS.Timeout;
  mcpFailure?: string;
  finalSummary?: string;
  failure?: string;
  errorLines: string[];
  toolCalls: number;
  stalledSince?: number;
  /** When tick first saw the session ended while the CLI still ran. */
  endedSince?: number;
  exited: Promise<void>;
}

function defaultReadVersion(executable: string, pathValue: string) {
  return new Promise<string | undefined>((resolve) => {
    execFile(
      executable,
      ["--version"],
      {
        timeout: 5000,
        encoding: "utf8",
        env: { ...process.env, PATH: pathValue },
      },
      (error, stdout) => resolve(error ? undefined : stdout),
    );
  });
}

export class AgentRunner {
  private readonly options: AgentRunnerOptions;
  private active: ActiveRun | null = null;
  /**
   * Set synchronously when a start begins and cleared when it settles, so two
   * quick starts cannot both pass the one-run check before the first has a
   * process.
   */
  private starting: Promise<AgentRun> | null = null;

  constructor(options: AgentRunnerOptions) {
    this.options = options;
  }

  private now() {
    return this.options.now?.() ?? Date.now();
  }

  /** The run that is going, or null. Cheap: no CLI detection. */
  currentRun(): AgentRun | null {
    return this.active?.run ?? null;
  }

  /** Settings > Agents and the Submit page read this. */
  async overview(): Promise<AgentRunnerOverview> {
    const settings = await this.options.storage.getAgentRunnerSettings();
    const clis = await this.detectClis();
    return {
      settings,
      clis,
      tasks: await this.listTasks(settings, clis),
      currentRun: this.active?.run ?? null,
    };
  }

  private async detectClis(): Promise<AgentCliStatus[]> {
    const pathValue = await this.options.loginShellPath();
    const readVersion = this.options.readVersion ?? defaultReadVersion;
    return await Promise.all(
      ALL_CLIS.map(async (cli) => {
        const adapter = this.options.adapters.find(
          (candidate) => candidate.id === cli.id,
        );
        const executable = await this.options.findExecutable(
          cli.executableName,
          pathValue,
        );
        const output = executable
          ? await readVersion(executable, pathValue)
          : undefined;
        const version = output
          ? (adapter?.parseVersion(output) ?? output.trim())
          : undefined;
        return {
          id: cli.id,
          label: cli.label,
          supported: adapter !== undefined,
          installed: executable !== null,
          ...(version ? { version } : {}),
        };
      }),
    );
  }

  private async listTasks(
    settings: AgentRunnerSettings,
    clis: AgentCliStatus[],
  ): Promise<AgentTaskStatus[]> {
    const tasks: AgentTaskStatus[] = [];
    const mcpEnabled = (await this.options.storage.getMcpSettings()).enabled;
    const cli = clis.find((candidate) => candidate.id === settings.cli);
    for (const plugin of await this.options.plugins.listPlugins()) {
      if (!(await this.options.plugins.isPluginEnabled(plugin.id))) continue;
      for (const task of plugin.capabilities.agentTask?.tasks ?? []) {
        const values = await this.options.storage.getAgentTaskValues(
          plugin.id,
          task.id,
        );
        const blockers = [
          ...(mcpEnabled ? [] : ["Turn on MCP in Settings > MCP"]),
          ...(cli?.supported && cli.installed
            ? []
            : ["Pick an installed agent in Settings > Agents"]),
          ...task.settings
            .filter(
              (field) =>
                field.required &&
                (values[field.id] === undefined || values[field.id] === ""),
            )
            .map((field) => `Fill in ${field.label} in Settings > Agents`),
        ];
        tasks.push({
          pluginId: plugin.id,
          pluginName: plugin.displayName,
          taskId: task.id,
          label: task.label,
          placement: task.placement,
          estimateMinutes: task.estimateMinutes,
          settings: task.settings,
          values,
          ...(task.weekLink ? { weekLink: task.weekLink } : {}),
          blockers,
        });
      }
    }
    return tasks;
  }

  async start(request: AgentRunStartRequest): Promise<AgentRun> {
    if (this.active || this.starting) {
      throw new AgentRunError(
        "An agent task is already running. Stop it first.",
        409,
      );
    }
    // No await before this line: the slot is taken in the same tick as the check.
    const attempt = this.launch(request);
    this.starting = attempt;
    try {
      return await attempt;
    } finally {
      if (this.starting === attempt) this.starting = null;
    }
  }

  private async launch(request: AgentRunStartRequest): Promise<AgentRun> {
    const settings = await this.options.storage.getAgentRunnerSettings();
    const clis = await this.detectClis();
    const task = (await this.listTasks(settings, clis)).find(
      (candidate) =>
        candidate.pluginId === request.pluginId &&
        candidate.taskId === request.taskId,
    );
    if (!task)
      throw new AgentRunError("This agent task is not available.", 404);
    if (task.blockers.length > 0)
      throw new AgentRunError(`${task.blockers[0]}.`, 400);
    if (
      settings.browserMode === "ajour-chrome" &&
      !(await this.options.chromeInstalled())
    ) {
      throw new AgentRunError("Install Google Chrome to run agent tasks.", 400);
    }
    const adapter = this.options.adapters.find(
      (candidate) => candidate.id === settings.cli,
    )!;
    const cliStatus = clis.find((candidate) => candidate.id === settings.cli)!;
    const pathValue = await this.options.loginShellPath();
    const executable = await this.options.findExecutable(
      adapter.executableName,
      pathValue,
    );
    if (!executable)
      throw new AgentRunError(`${adapter.label} is not installed.`, 400);

    const taskPrompt = await this.options.plugins.readAgentTaskPrompt(
      request.pluginId,
      request.taskId,
    );
    // Every declared field has a slot: an unset optional one fills as "".
    const settingValues = Object.fromEntries(
      task.settings.map((field) => [
        `settings.${field.id}`,
        String(task.values[field.id] ?? ""),
      ]),
    );
    const weekLink = task.weekLink
      ? safeHttpsUrl(
          fillTemplate(task.weekLink, {
            ...settingValues,
            weekOf: request.weekOf,
            sessionId: "",
          }),
        )
      : undefined;

    const created = await this.options.storage.createMcpClient(
      `${task.label} run`,
    );
    const client = { id: created.client.id, name: created.client.name };
    const runId = randomUUID();
    let session: AgentSession | undefined;
    let workDirectory: string | undefined;
    let child: ChildProcess | undefined;
    try {
      session = this.options.sessions.begin(
        client,
        {
          title: `${task.label}, week of ${request.weekOf}`,
          estimateMinutes: task.estimateMinutes,
        },
        {
          runId,
          ...(weekLink
            ? {
                link: {
                  label: `Open the week in ${task.pluginName}`,
                  url: weekLink,
                },
              }
            : {}),
        },
      );
      workDirectory = await mkdtemp(path.join(this.options.tempRoot, "run-"));
      const invocation = adapter.buildInvocation({
        executable,
        workDirectory,
        prompt: buildPrompt({
          taskPrompt,
          values: {
            ...settingValues,
            weekOf: request.weekOf,
            sessionId: session.id,
          },
        }),
        ajourMcpUrl: this.options.ajourMcpUrl,
        playwright: this.options.playwright({
          browserMode: settings.browserMode,
          profileDirectory: this.options.profileDirectory,
        }),
        model: settings.model,
        baseEnv: { ...childEnv(process.env), PATH: pathValue },
        token: created.token,
      });
      for (const [name, content] of Object.entries(invocation.files)) {
        await writeFile(path.join(workDirectory, name), content, {
          mode: 0o600,
        });
      }
      child = spawn(invocation.command, invocation.args, {
        cwd: workDirectory,
        env: invocation.env,
        stdio: ["ignore", "pipe", "pipe"],
      });
      const run: AgentRun = {
        id: runId,
        pluginId: request.pluginId,
        taskId: request.taskId,
        weekOf: request.weekOf,
        sessionId: session.id,
        startedAt: this.now(),
      };
      const active: ActiveRun = {
        run,
        client,
        child,
        workDirectory,
        cli: adapter.id,
        version: cliStatus.version,
        browserMode: settings.browserMode,
        errorLines: [],
        toolCalls: 0,
        exited: Promise.resolve(),
      };
      active.exited = this.watch(active, adapter);
      this.active = active;
      return run;
    } catch (error) {
      child?.kill("SIGKILL");
      await this.cleanUp(client, workDirectory);
      if (session) {
        this.options.sessions.end(client, {
          sessionId: session.id,
          outcome: "failed",
          summary: "Ajour could not start the agent.",
        });
      }
      throw error;
    }
  }

  private watch(active: ActiveRun, adapter: AgentCliAdapter): Promise<void> {
    const { child } = active;
    createInterface({ input: child.stdout! }).on("line", (line) => {
      const event = adapter.parseEvent(line);
      if (event) this.onEvent(active, event);
    });
    createInterface({ input: child.stderr! }).on("line", (line) => {
      active.errorLines.push(line);
      if (active.errorLines.length > ERROR_LINES) active.errorLines.shift();
    });
    return new Promise((resolve) => {
      child.on("error", (error) => {
        active.failure = error.message;
      });
      child.on("close", (code) => {
        void this.finish(active, code)
          .catch((error: unknown) =>
            this.options.logEvent({
              event: "agent.run_cleanup_failed",
              run_id: active.run.id,
              error: error instanceof Error ? error.message : String(error),
            }),
          )
          .finally(resolve);
      });
    });
  }

  private onEvent(active: ActiveRun, event: RunnerEvent) {
    switch (event.kind) {
      case "tool-call":
        active.toolCalls += 1;
        return;
      case "finished":
        active.finalSummary = event.summary;
        return;
      case "failed":
        active.failure = event.message;
        return;
      case "mcp-failed":
        active.mcpFailure = event.server;
        active.stopReason = "mcp";
        this.terminate(active);
        return;
    }
  }

  private async finish(active: ActiveRun, code: number | null) {
    const { sessions } = this.options;
    clearTimeout(active.killTimer);
    let outcome: AgentSessionOutcome | undefined;
    try {
      const session = sessions.get(active.run.sessionId);
      const open =
        session && (session.state === "active" || session.state === "stalled");
      outcome =
        session && !open ? (session.state as AgentSessionOutcome) : undefined;
      if (open) {
        const ending = describeEnding(active, code);
        outcome = ending.outcome;
        if (ending.error) sessions.recordError(ending.error, active.client);
        sessions.end(active.client, {
          sessionId: active.run.sessionId,
          outcome: ending.outcome,
          summary: ending.summary,
        });
      }
    } finally {
      // Whatever went wrong above, the client and the folder go away and the
      // runner accepts a new run.
      await this.cleanUp(active.client, active.workDirectory);
      if (this.active === active) this.active = null;
      this.options.logEvent({
        event: "agent.run",
        plugin_id: active.run.pluginId,
        task_id: active.run.taskId,
        cli: active.cli,
        cli_version: active.version,
        browser_mode: active.browserMode,
        duration_ms: this.now() - active.run.startedAt,
        outcome,
        exit_code: code,
        stop_reason: active.stopReason,
        tool_call_count: active.toolCalls,
      });
    }
  }

  private async cleanUp(client: AgentClientRef, workDirectory?: string) {
    await this.options.storage.revokeMcpClient(client.id).catch(() => false);
    if (workDirectory) {
      await rm(workDirectory, { recursive: true, force: true }).catch(
        () => undefined,
      );
    }
  }

  /** SIGTERM now, SIGKILL after the grace period if the CLI is still running. */
  private terminate(active: ActiveRun) {
    active.child.kill("SIGTERM");
    if (active.killTimer) return;
    active.killTimer = setTimeout(
      () => active.child.kill("SIGKILL"),
      this.options.killGraceMs ?? DEFAULT_KILL_GRACE_MS,
    );
    active.killTimer.unref();
  }

  /** The user pressed Stop. False when that run is not going. */
  stop(runId: string): boolean {
    if (!this.active || this.active.run.id !== runId) return false;
    this.active.stopReason ??= "user";
    this.terminate(this.active);
    return true;
  }

  /**
   * Kills a run whose session stayed stalled for 10 minutes, or whose CLI kept
   * running 2 minutes after its session ended. Runs with the stall timer.
   */
  tick() {
    const active = this.active;
    if (!active || active.stopReason) return;
    const session = this.options.sessions.get(active.run.sessionId);
    const open = session?.state === "active" || session?.state === "stalled";
    if (session && !open) {
      // The agent ended the session but the CLI keeps running. Stop shows only
      // for open sessions in older panels, so Ajour ends it after a grace period.
      active.stalledSince = undefined;
      active.endedSince ??= this.now();
      if (this.now() - active.endedSince >= ENDED_GRACE_MS) {
        active.stopReason = "ended";
        this.terminate(active);
      }
      return;
    }
    active.endedSince = undefined;
    if (session?.state !== "stalled") {
      active.stalledSince = undefined;
      return;
    }
    active.stalledSince ??= this.now();
    if (this.now() - active.stalledSince >= STALL_LIMIT_MS) {
      active.stopReason = "stalled";
      this.terminate(active);
    }
  }

  /**
   * Ajour is quitting: wait for a start in progress, stop its run and wait for
   * the cleanup. If the CLI still has not closed after the kill grace period
   * plus a second, revoke the client and remove the folder directly so Ajour
   * can quit.
   */
  async shutdown() {
    if (this.starting) await this.starting.catch(() => undefined);
    const active = this.active;
    if (!active) return;
    active.stopReason ??= "shutdown";
    this.terminate(active);
    let giveUp: NodeJS.Timeout | undefined;
    const gaveUp = new Promise<"timeout">((resolve) => {
      giveUp = setTimeout(
        () => resolve("timeout"),
        (this.options.killGraceMs ?? DEFAULT_KILL_GRACE_MS) + 1000,
      );
    });
    const outcome = await Promise.race([active.exited, gaveUp]);
    clearTimeout(giveUp);
    if (outcome === "timeout") {
      await this.cleanUp(active.client, active.workDirectory);
      if (this.active === active) this.active = null;
    }
  }
}

function describeEnding(
  active: ActiveRun,
  code: number | null,
): { outcome: AgentSessionOutcome; summary: string; error?: string } {
  const errorOutput = active.errorLines.join("\n");
  switch (active.stopReason) {
    case "user":
      return { outcome: "cancelled", summary: "Stopped by the user." };
    case "shutdown":
      return { outcome: "cancelled", summary: "Ajour quit during the run." };
    case "stalled":
      return { outcome: "failed", summary: "The agent stopped answering." };
    case "ended":
      // The session is already ended, so finish() never asks for this.
      return { outcome: "failed", summary: "The agent kept running." };
    case "mcp":
      return {
        outcome: "failed",
        summary: `The ${active.mcpFailure} MCP server did not start.`,
        error: `The ${active.mcpFailure} MCP server did not start.${errorOutput ? `\n${errorOutput}` : ""}`,
      };
  }
  if (code === 0 && !active.failure) {
    return {
      outcome: "done",
      summary: active.finalSummary || "The agent finished.",
    };
  }
  const summary =
    active.failure ?? `The agent exited with code ${code ?? "unknown"}.`;
  return {
    outcome: "failed",
    summary,
    error: errorOutput ? `${summary}\n${errorOutput}` : summary,
  };
}

function safeHttpsUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The environment the CLI starts from: the API's own, minus every AJOUR_
 * variable so no Ajour setting or secret reaches the agent. The adapter adds
 * AJOUR_MCP_TOKEN back, and only that one.
 */
function childEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env).filter(
      (entry): entry is [string, string] =>
        entry[1] !== undefined && !entry[0].startsWith("AJOUR_"),
    ),
  );
}
