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
import {
  agentTaskSettingFields,
  type AgentTask,
  type PluginFieldValues,
} from "../../../../packages/shared/plugins.ts";
import { fillTemplate } from "../../../../packages/shared/agent-task-templates.ts";
import type { AjourCatalog } from "../../../../packages/wide-events/catalog.ts";
import {
  errorIdentity,
  type Unit,
} from "../../../../packages/wide-events/index.ts";
import {
  SESSION_EVENT_OUTCOMES,
  type AgentSessions,
} from "../agent-sessions.ts";
import type { ApiEvents } from "../events.ts";
import type {
  AgentCliAdapter,
  RunnerEvent,
  StdioServerSpec,
} from "./adapter.ts";
import { buildPrompt } from "./prompts.ts";
import { withoutSecretValues } from "../connection-credentials.ts";

/**
 * Runs one plugin agent task at a time: a per-run MCP client, a session the
 * runner begins, the CLI in an empty temp folder, and cleanup on every exit.
 * See docs/specs/2026-10-15-ajour-agent-runner-design.md.
 */

const STALL_LIMIT_MS = 10 * 60_000;
/** How long a CLI may keep running after its session ended before tick stops it. */
const ENDED_GRACE_MS = 2 * 60_000;
/** How long a CLI gets to exit after SIGTERM before it is killed. */
export const DEFAULT_KILL_GRACE_MS = 5000;
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
  getAgentTaskValues(pluginId: string): Promise<PluginFieldValues>;
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
  /** Where each run's one `agent.run` event goes. */
  events: ApiEvents;
  now?: () => number;
  /** Time between SIGTERM and SIGKILL. Tests shorten it. Defaults to 5 seconds. */
  killGraceMs?: number;
}

/** The steps of a launch, in order. agent.run names the one that failed. */
type LaunchStep =
  | "find_executable"
  | "read_prompt"
  | "create_client"
  | "begin_session"
  | "create_work_folder"
  | "build_invocation"
  | "write_files"
  | "spawn";

/** What ends a run. A failure here never stops the others. */
type CleanupStep = "end_session" | "revoke_client" | "remove_work_folder";

interface StepFailure<Step extends string> {
  step: Step;
  error: unknown;
}

type StopReason = "user" | "stalled" | "mcp" | "shutdown" | "ended";

/**
 * A run's one `agent.run` event. A start opens it with its run ID before its
 * first launch step, so a launch that fails before the client and the
 * session exist still emits it, with no client or session ID.
 */
type RunEvent = Unit<AjourCatalog, "agent.run">;

interface ActiveRun {
  run: AgentRun;
  event: RunEvent;
  client: AgentClientRef;
  child: ChildProcess;
  workDirectory: string;
  stopReason?: StopReason;
  /** Sends SIGKILL if the CLI ignores SIGTERM. Cleared when it exits. */
  killTimer?: NodeJS.Timeout;
  mcpFailure?: string;
  finalSummary?: string;
  failure?: string;
  /** Why the CLI never started, such as a missing executable. */
  spawnError?: Error;
  errorLines: string[];
  toolCalls: number;
  stalledSince?: number;
  /** When tick first saw the session ended while the CLI still ran. */
  endedSince?: number;
  /** Set when the CLI's process exits. Its output can stay open longer. */
  exited?: { code: number | null };
  /** Resolves when the CLI closes, which may be never. */
  closed: Promise<void>;
  /** Set by the first finalize() call, which later calls return. */
  finalized?: Promise<void>;
  /**
   * Set by the first ending (the CLI's exit, a kill, Stop or shutdown): ends
   * the run, closed or not.
   */
  finishing?: Promise<void>;
}

/** How the runner ends a session that is still open when its run ends. */
interface SessionEnding {
  outcome: AgentSessionOutcome;
  summary: string;
  /** For the activity's error list. Never logged. */
  error?: string;
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

  /** Settings > Agents and the Commit page read this. */
  async overview(): Promise<AgentRunnerOverview> {
    const settings = await this.options.storage.getAgentRunnerSettings();
    const clis = await this.detectClis();
    return {
      settings,
      clis,
      tasks: await this.listTasks(settings, clis, "hidden"),
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

  /**
   * The tasks of every enabled plugin with their values. `secrets` says
   * whether the values hold the settings marked secret: a run needs them, an
   * answer to the client never holds them.
   */
  private async listTasks(
    settings: AgentRunnerSettings,
    clis: AgentCliStatus[],
    secrets: "hidden" | "included",
  ): Promise<AgentTaskStatus[]> {
    const tasks: AgentTaskStatus[] = [];
    const mcpEnabled = (await this.options.storage.getMcpSettings()).enabled;
    const cli = clis.find((candidate) => candidate.id === settings.cli);
    for (const plugin of await this.options.plugins.listPlugins()) {
      if (!(await this.options.plugins.isPluginEnabled(plugin.id))) continue;
      // The plugin's tasks share their settings by ID, and the first task
      // that declares a setting gives its label and default, as on the form.
      const pluginTasks = plugin.capabilities.agentTask?.tasks ?? [];
      const sharedFields = new Map(
        agentTaskSettingFields(pluginTasks).map((field) => [field.id, field]),
      );
      const saved = await this.options.storage.getAgentTaskValues(plugin.id);
      for (const task of pluginTasks) {
        // Each task still decides which settings it requires.
        const fields = task.settings.map((field) => ({
          ...(sharedFields.get(field.id) ?? field),
          required: field.required,
        }));
        // A setting the user never saved falls back to its manifest default.
        const values = {
          ...Object.fromEntries(
            fields.flatMap((field) =>
              field.defaultValue === undefined
                ? []
                : [[field.id, field.defaultValue]],
            ),
          ),
          ...saved,
        };
        const blockers = [
          ...(mcpEnabled ? [] : ["Turn on MCP in Settings > MCP"]),
          ...(cli?.supported && cli.installed
            ? []
            : ["Pick an installed agent in Settings > Agents"]),
          ...fields
            .filter(
              (field) =>
                field.required &&
                (values[field.id] === undefined || values[field.id] === ""),
            )
            .map(
              (field) =>
                `Fill in ${field.label} in Settings > Plugins > ${plugin.displayName}`,
            ),
        ];
        tasks.push({
          pluginId: plugin.id,
          pluginName: plugin.displayName,
          taskId: task.id,
          label: task.label,
          placement: task.placement,
          estimateMinutes: task.estimateMinutes,
          settings: task.settings,
          values:
            secrets === "included"
              ? values
              : withoutSecretValues([...sharedFields.values()], values),
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
    const task = (await this.listTasks(settings, clis, "included")).find(
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

    // From here on the start has a run ID, so a launch that fails still logs
    // its agent.run, with the step that failed. The run outlives the request
    // that starts it, so its event is its own.
    const runId = randomUUID();
    const event: RunEvent = this.options.events.start("agent.run", {
      kind: "job",
      trigger: "user",
      detached: true,
    });
    event.set({
      agent: {
        run_id: runId,
        task_id: request.taskId,
        cli: adapter.id,
        cli_version: versionOnly(cliStatus.version),
        browser_mode: settings.browserMode,
      },
      plugin: { id: request.pluginId },
    });
    let step: LaunchStep = "find_executable";
    let client: AgentClientRef | undefined;
    let session: AgentSession | undefined;
    let workDirectory: string | undefined;
    let child: ChildProcess | undefined;
    try {
      const pathValue = await this.options.loginShellPath();
      const executable = await this.options.findExecutable(
        adapter.executableName,
        pathValue,
      );
      if (!executable)
        throw new AgentRunError(`${adapter.label} is not installed.`, 400);

      step = "read_prompt";
      const taskPrompt = await this.options.plugins.readAgentTaskPrompt(
        request.pluginId,
        request.taskId,
      );

      step = "create_client";
      const created = await this.options.storage.createMcpClient(
        `${task.label} run`,
      );
      client = { id: created.client.id, name: created.client.name };
      event.set({ agent: { client_id: client.id } });

      step = "begin_session";
      const runClient = client;
      // Inside the run's event, so the session's event is its child span.
      session = event.enter(() =>
        this.options.sessions.begin(
          runClient,
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
        ),
      );
      event.set({ agent: { session_id: session.id } });

      step = "create_work_folder";
      workDirectory = await mkdtemp(path.join(this.options.tempRoot, "run-"));

      step = "build_invocation";
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

      step = "write_files";
      for (const [name, content] of Object.entries(invocation.files)) {
        await writeFile(path.join(workDirectory, name), content, {
          mode: 0o600,
        });
      }

      // A spawn that fails later, such as a missing executable, reaches
      // finalize() through the child's error and close events.
      step = "spawn";
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
        event,
        client,
        child,
        workDirectory,
        errorLines: [],
        toolCalls: 0,
        closed: Promise.resolve(),
      };
      active.closed = this.watch(active, adapter);
      this.active = active;
      return run;
    } catch (error) {
      child?.kill("SIGKILL");
      const cleanupFailures = client
        ? await this.cleanUp(
            client,
            workDirectory,
            session && {
              sessionId: session.id,
              outcome: "failed",
              summary: "Ajour could not start the agent.",
            },
          )
        : [];
      endRunEvent(event, {
        outcome: "failed",
        toolCalls: 0,
        launchFailure: { step, error },
        cleanupFailures,
      });
      throw error;
    }
  }

  /** Reads the CLI's output. Resolves when the CLI closes. */
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
        // Node gives no pid to a process that never started.
        if (child.pid === undefined) active.spawnError = error;
      });
      child.on("exit", (code) => {
        active.exited = { code };
        // Something the CLI started can hold its output open, and then
        // close never comes (#341).
        void this.finishWithinGrace(active);
      });
      child.on("close", (code) => {
        void this.finalize(active, code);
        resolve();
      });
    });
  }

  private onEvent(active: ActiveRun, event: RunnerEvent) {
    // A run that is ending already has its outcome.
    if (active.finalized) return;
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

  /**
   * Ends the run exactly once, whichever comes first: the CLI's close, or
   * the give-up that any ending starts. A later call gets the same promise.
   */
  private finalize(active: ActiveRun, code: number | null): Promise<void> {
    active.finalized ??= this.endRun(active, code).catch(() => {
      // endRun() handles its own failures. This keeps a bug in it from
      // becoming an unhandled rejection, which would crash the API.
    });
    return active.finalized;
  }

  /** Ends the session, cleans up and emits the run's one agent.run event. */
  private async endRun(active: ActiveRun, code: number | null) {
    clearTimeout(active.killTimer);
    // The outcome is decided here, so the stop reason that led to it is too.
    const { stopReason } = active;
    const session = this.options.sessions.get(active.run.sessionId);
    const open = session?.state === "active" || session?.state === "stalled";
    // A session the agent ended itself keeps its outcome.
    const ending = open ? describeEnding(active, code) : undefined;
    const outcome =
      ending?.outcome ?? (session?.state as AgentSessionOutcome | undefined);
    // Whatever fails here, the runner accepts a new run.
    const cleanupFailures = await this.cleanUp(
      active.client,
      active.workDirectory,
      ending && { sessionId: active.run.sessionId, ...ending },
    );
    if (this.active === active) this.active = null;
    endRunEvent(active.event, {
      outcome,
      exitCode: code,
      stopReason,
      toolCalls: active.toolCalls,
      ...(active.spawnError
        ? { launchFailure: { step: "spawn", error: active.spawnError } }
        : {}),
      cleanupFailures,
    });
  }

  /**
   * Ends the session when given its ending, revokes the client and removes
   * the folder, each whatever the others did. Returns every step that failed.
   */
  private async cleanUp(
    client: AgentClientRef,
    workDirectory: string | undefined,
    ending?: SessionEnding & { sessionId: string },
  ): Promise<StepFailure<CleanupStep>[]> {
    const failures: StepFailure<CleanupStep>[] = [];
    if (ending) {
      try {
        if (ending.error) {
          this.options.sessions.recordError(ending.error, client);
        }
        this.options.sessions.end(client, {
          sessionId: ending.sessionId,
          outcome: ending.outcome,
          summary: ending.summary,
        });
      } catch (error) {
        failures.push({ step: "end_session", error });
      }
    }
    try {
      await this.options.storage.revokeMcpClient(client.id);
    } catch (error) {
      failures.push({ step: "revoke_client", error });
    }
    if (workDirectory) {
      try {
        await rm(workDirectory, { recursive: true, force: true });
      } catch (error) {
        failures.push({ step: "remove_work_folder", error });
      }
    }
    return failures;
  }

  /**
   * SIGTERM now, SIGKILL after the grace period if the CLI is still running.
   * Only the CLI itself: ending what it started is #341.
   */
  private terminate(active: ActiveRun) {
    // The run ends on time even if the CLI's exit never comes.
    void this.finishWithinGrace(active);
    // No pid: the CLI never started, and its error and close are on the way.
    // Killing it would throw.
    if (active.child.pid === undefined) return;
    active.child.kill("SIGTERM");
    if (active.killTimer) return;
    active.killTimer = setTimeout(
      () => active.child.kill("SIGKILL"),
      this.options.killGraceMs ?? DEFAULT_KILL_GRACE_MS,
    );
    active.killTimer.unref();
  }

  /**
   * The user pressed Stop. False when that run is not going. A run that is
   * already ending, or whose CLI already exited, keeps its own outcome: Stop
   * then only makes sure it ends.
   */
  stop(runId: string): boolean {
    const active = this.active;
    if (!active || active.run.id !== runId) return false;
    if (active.finalized) return true;
    if (!active.exited) {
      active.stopReason ??= "user";
      this.terminate(active);
    }
    void this.finishWithinGrace(active);
    return true;
  }

  /**
   * Ends the run when the CLI closes, or after the kill grace period plus a
   * second if it never does: something the CLI started can hold its output
   * open (#341). Every ending starts it: the CLI's exit, each kill, Stop and
   * shutdown. The first call sets the deadline.
   */
  private finishWithinGrace(active: ActiveRun): Promise<void> {
    active.finishing ??= new Promise<void>((resolve) => {
      const giveUp = setTimeout(
        resolve,
        (this.options.killGraceMs ?? DEFAULT_KILL_GRACE_MS) + 1000,
      );
      void active.closed.then(() => {
        clearTimeout(giveUp);
        resolve();
      });
    }).then(() => this.finalize(active, active.exited?.code ?? null));
    return active.finishing;
  }

  /**
   * Kills a run whose session stayed stalled for 10 minutes, or whose CLI kept
   * running 2 minutes after its session ended. Runs with the stall timer.
   */
  tick() {
    const active = this.active;
    if (!active || active.stopReason || active.finalized || active.exited) {
      return;
    }
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
   * Ajour is quitting: wait for a start in progress, stop its run and wait
   * for the CLI to close. If it still has not closed after the kill grace
   * period plus a second, end the run without it, so Ajour can quit. A close
   * that arrives later changes nothing.
   */
  async shutdown() {
    if (this.starting) await this.starting.catch(() => undefined);
    const active = this.active;
    if (!active) return;
    if (!active.finalized && !active.exited) {
      active.stopReason ??= "shutdown";
      this.terminate(active);
    }
    await this.finishWithinGrace(active);
  }
}

function describeEnding(active: ActiveRun, code: number | null): SessionEnding {
  const errorOutput = active.errorLines.join("\n");
  // A CLI that never started failed, whatever stop came meanwhile.
  if (active.spawnError) {
    const summary = active.spawnError.message;
    return { outcome: "failed", summary, error: summary };
  }
  switch (active.stopReason) {
    case "user":
      return { outcome: "cancelled", summary: "Stopped by the user." };
    case "shutdown":
      return { outcome: "cancelled", summary: "Ajour quit during the run." };
    case "stalled":
      return { outcome: "failed", summary: "The agent stopped answering." };
    case "ended":
      // The session is already ended, so endRun() never asks for this.
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

/** How a run ended, for its agent.run event. */
interface RunEnding {
  outcome: AgentSessionOutcome | undefined;
  exitCode?: number | null;
  stopReason?: StopReason;
  toolCalls: number;
  launchFailure?: StepFailure<LaunchStep>;
  cleanupFailures: StepFailure<CleanupStep>[];
}

/**
 * Ends the run's one wide event, however it ended. A launch failure is the
 * event's error, its message scrubbed. A cleanup step's error gives its type
 * and code only.
 */
function endRunEvent(event: RunEvent, ending: RunEnding) {
  const [firstCleanupFailure] = ending.cleanupFailures;
  event.set({
    agent: {
      exit_code: ending.exitCode,
      stop_reason: ending.stopReason,
      tool_call_count: ending.toolCalls,
    },
    cleanup: {
      outcome: firstCleanupFailure ? "failed" : "ok",
      failed_steps: ending.cleanupFailures.map((failure) => failure.step),
      ...(firstCleanupFailure
        ? { error: errorIdentity(firstCleanupFailure.error) }
        : {}),
    },
  });
  if (ending.launchFailure) {
    event.set({ launch: { failed_step: ending.launchFailure.step } });
    event.fail(ending.launchFailure.error);
    event.end();
    return;
  }
  // A session that is gone tells nothing, so the run counts as failed.
  event.end(ending.outcome ? SESSION_EVENT_OUTCOMES[ending.outcome] : "error");
}

/**
 * The version when it looks like one, such as 1.4.2 or 0.30.0-beta.1. When
 * an adapter cannot read `--version`, Settings shows the raw output, which is
 * CLI output and stays out of the log.
 */
function versionOnly(value: string | undefined): string | undefined {
  return value !== undefined &&
    /^v?\d+(?:\.\d+){1,3}(?:-[0-9A-Za-z.]+)?$/.test(value)
    ? value
    : undefined;
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
