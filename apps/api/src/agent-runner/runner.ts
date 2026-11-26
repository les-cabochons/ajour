import { mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type {
  AgentClientRef,
  AgentSession,
  AgentSessionOutcome,
  McpClientCreateResponse,
} from "../../../../packages/shared/agent-tools.ts";
import type {
  AgentCliId,
  AgentCliStatus,
  AgentRun,
  AgentRunnerOverview,
  AgentRunnerSettings,
  AgentTaskStatus,
  AgentTurn,
  AgentTurnEvent,
  CoreAgentTask,
  CoreTaskRunRequest,
  PluginTaskRunRequest,
} from "../../../../packages/shared/agent-runs.ts";
import {
  agentTaskSettingFields,
  type AgentTask,
  type PluginFieldValues,
  type SecretFieldSummary,
} from "../../../../packages/shared/plugins.ts";
import {
  fillTemplate,
  listTemplateSlots,
} from "../../../../packages/shared/agent-task-templates.ts";
import type { AgentTaskMcpTool } from "../../../../packages/shared/plugin-api-4.ts";
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
import { spawnRefusalMessage } from "../process-spawn/index.ts";
import { defaultReadVersion } from "./cli-path.ts";
import {
  DEFAULT_KILL_GRACE_MS,
  startCliProcess,
  type CliProcess,
} from "./cli-process.ts";
import { buildPrompt } from "./prompts.ts";
import { editableValues } from "../connection-credentials.ts";
import { AgentRunError, childEnv, versionOnly } from "./launch.ts";
import { AgentConversations } from "./conversations.ts";
import type { McpClientPullRequestBinding } from "../storage.ts";
import { TurnSlot, TurnSlotAbortedError, type TurnLease } from "./turn-slot.ts";

export { AgentRunError, DEFAULT_KILL_GRACE_MS };

/**
 * Runs one plugin agent task at a time: a per-run MCP client, a session the
 * runner begins, the CLI in an empty temp folder, and cleanup on every exit.
 * See docs/specs/2026-10-15-ajour-agent-runner-design.md. Core tasks run as
 * turns of a pull request's conversation (conversations.ts). A run and a
 * turn share one slot, so one of them runs at a time across the app.
 */

const STALL_LIMIT_MS = 10 * 60_000;
/** How long a CLI may keep running after its session ended before tick stops it. */
const ENDED_GRACE_MS = 2 * 60_000;
const ALL_CLIS: {
  id: AgentCliStatus["id"];
  label: string;
  executableName: string;
}[] = [
  { id: "claude-code", label: "Claude Code", executableName: "claude" },
  { id: "codex", label: "Codex", executableName: "codex" },
  { id: "opencode", label: "OpenCode", executableName: "opencode" },
];

interface RunnerStorage {
  getMcpSettings(): Promise<{ enabled: boolean }>;
  getAgentRunnerSettings(): Promise<AgentRunnerSettings>;
  getAgentTaskValues(pluginId: string): Promise<PluginFieldValues>;
  /** The plugin's secret settings the vault holds, with their states. Never a value. */
  getAgentTaskSecretFields?(pluginId: string): Promise<SecretFieldSummary[]>;
  /**
   * `tools`, when given, limits the client to those data tools.
   * `pullRequest` binds a conversation's client to one pull request.
   */
  createMcpClient(
    name: string,
    scope?:
      | { tools: readonly AgentTaskMcpTool[] }
      | { pullRequest: McpClientPullRequestBinding },
  ): Promise<McpClientCreateResponse>;
  /** Binds a conversation's client to its pull request's new head. */
  rebindMcpClient(
    clientId: string,
    binding: McpClientPullRequestBinding,
  ): Promise<boolean>;
  revokeMcpClient(clientId: string): Promise<boolean>;
}

interface RunnerPlugins {
  listPlugins(): Promise<
    {
      id: string;
      apiVersion: number;
      displayName: string;
      capabilities: {
        // A task declares its MCP tools.
        agentTask?: {
          tasks: (AgentTask & { tools?: readonly AgentTaskMcpTool[] })[];
        };
      };
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
  ) => Promise<string | { refused: string } | undefined>;
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
  /** Where each conversation turn's events go: the window's event stream. */
  publishTurnEvent?: (event: AgentTurnEvent) => void;
  /**
   * Whether the user allows a pull request's repository with an agent,
   * asked before each turn is sent to it. Without it, no turn is sent.
   */
  admitsTurn?: (pullRequest: string, cli: AgentCliId) => Promise<boolean>;
  /**
   * Why a turn its CLI ended as done failed all the same, such as a guide
   * turn that saved no guide (#794). Undefined lets it end done.
   */
  turnDoneFailure?: (turn: {
    id: string;
    task: CoreAgentTask;
  }) => string | undefined;
  /** How long a conversation with no turn stays open. Defaults to 5 minutes. */
  conversationIdleMs?: number;
  /** How long an interrupted turn has before its process is ended. Defaults to 5 seconds. */
  interruptGraceMs?: number;
  /** How long a running turn's CLI may print nothing before the turn fails. Defaults to 10 minutes. */
  turnStallMs?: number;
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
  /** Its ending comes when it closes, or after a grace period once it exited or was stopped. */
  cli: CliProcess;
  workDirectory: string;
  stopReason?: StopReason;
  mcpFailure?: string;
  finalSummary?: string;
  failure?: string;
  toolCalls: number;
  stalledSince?: number;
  /** When tick first saw the session ended while the CLI still ran. */
  endedSince?: number;
  /** The app's one agent slot, held for the whole run. */
  lease: TurnLease;
  /** Set by the first finalize() call, which later calls return. */
  finalized?: Promise<void>;
}

/** How the runner ends a session that is still open when its run ends. */
interface SessionEnding {
  outcome: AgentSessionOutcome;
  summary: string;
  /** For the activity's error list. Never logged. */
  error?: string;
}

/** A task as the runner sees it: what Settings shows, and what a run needs. */
interface RunnerTask {
  status: AgentTaskStatus;
  /** The data tools its run's MCP client is limited to. */
  tools?: readonly AgentTaskMcpTool[];
  /** Its settings marked secret, which never reach the agent. */
  secretSettings: readonly { id: string; label: string }[];
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
  private readonly slot = new TurnSlot();
  private readonly conversations: AgentConversations;
  /** Aborted when Ajour quits, so a run waiting for the slot gives up. */
  private readonly stopping = new AbortController();

  constructor(options: AgentRunnerOptions) {
    this.options = options;
    this.conversations = new AgentConversations({
      slot: this.slot,
      storage: options.storage,
      adapters: options.adapters,
      findExecutable: options.findExecutable,
      ...(options.readVersion ? { readVersion: options.readVersion } : {}),
      loginShellPath: options.loginShellPath,
      tempRoot: options.tempRoot,
      ajourMcpUrl: options.ajourMcpUrl,
      events: options.events,
      publish: options.publishTurnEvent ?? (() => undefined),
      admits: options.admitsTurn ?? (async () => false),
      ...(options.turnDoneFailure
        ? { doneFailure: options.turnDoneFailure }
        : {}),
      ...(options.conversationIdleMs === undefined
        ? {}
        : { idleMs: options.conversationIdleMs }),
      ...(options.killGraceMs === undefined
        ? {}
        : { killGraceMs: options.killGraceMs }),
      ...(options.interruptGraceMs === undefined
        ? {}
        : { interruptGraceMs: options.interruptGraceMs }),
      ...(options.turnStallMs === undefined
        ? {}
        : { stallMs: options.turnStallMs }),
    });
  }

  /**
   * Starts a turn of a core task in its pull request's conversation. It
   * runs, or waits for the slot; its events go to `publishTurnEvent`.
   */
  startTurn(request: CoreTaskRunRequest): Promise<AgentTurn> {
    return this.conversations.startTurn(request);
  }

  /**
   * The turn running in the conversation whose client is `clientId`, as a
   * call of its tools reads it (#794), or undefined between turns.
   */
  runningTurnOf(clientId: string) {
    return this.conversations.runningTurnOf(clientId);
  }

  /** Stops a turn that waits or runs. False when it isn't going. */
  cancelTurn(turnId: string): boolean {
    return this.conversations.cancelTurn(turnId);
  }

  /**
   * Closes the conversation about a pull request `pullRequest` matches,
   * stopping its turns, as revoking its repository does. False when none.
   */
  closeConversationWhere(pullRequest: (key: string) => boolean): boolean {
    return this.conversations.closeWhere(pullRequest);
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
      tasks: (await this.listTasks(settings, clis, "hidden")).map(
        (task) => task.status,
      ),
      currentRun: this.active?.run ?? null,
    };
  }

  /** The agent Settings > Agents picks, as Settings shows it, or null for none. */
  async selectedCli(): Promise<AgentCliStatus | null> {
    const { cli } = await this.options.storage.getAgentRunnerSettings();
    if (!cli) return null;
    return (await this.detectClis([cli])).find(({ id }) => id === cli) ?? null;
  }

  private async detectClis(
    only?: AgentCliStatus["id"][],
  ): Promise<AgentCliStatus[]> {
    const pathValue = await this.options.loginShellPath();
    const readVersion = this.options.readVersion ?? defaultReadVersion;
    return await Promise.all(
      ALL_CLIS.filter((cli) => !only || only.includes(cli.id)).map(
        async (cli) => {
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
          const refusalReason =
            output && executable && typeof output !== "string"
              ? spawnRefusalMessage(output.refused, cli.label, executable)
              : undefined;
          const version =
            typeof output === "string" && output
              ? (adapter?.parseVersion(output) ?? output.trim())
              : undefined;
          return {
            id: cli.id,
            label: cli.label,
            supported: adapter !== undefined,
            installed: executable !== null,
            ...(version ? { version } : {}),
            ...(refusalReason ? { refusalReason } : {}),
          };
        },
      ),
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
  ): Promise<RunnerTask[]> {
    const tasks: RunnerTask[] = [];
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
      const secretFields =
        await this.options.storage.getAgentTaskSecretFields?.(plugin.id);
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
        const secretSettings = fields.filter(
          (field, index) => field.secret || task.settings[index]!.secret,
        );
        // The user opens the week link with a click, and its host is the
        // plugin's to choose, so a secret setting never fills it.
        const linkSlots = new Set(
          task.weekLink ? listTemplateSlots(task.weekLink) : [],
        );
        const secretInLink = secretSettings.find((field) =>
          linkSlots.has(`settings.${field.id}`),
        );
        tasks.push({
          status: {
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
                : editableValues([...sharedFields.values()], values),
            ...(secretFields?.length ? { secretFields } : {}),
            ...(task.weekLink && !secretInLink
              ? { weekLink: task.weekLink }
              : {}),
            ...(secretInLink
              ? {
                  weekLinkRefusal: `The week link uses the secret setting ${secretInLink.label}. Ajour never puts a secret in a link.`,
                }
              : {}),
            blockers,
          },
          // A task's run gets only the tools it declares, and none if it
          // somehow declares no list.
          tools: task.tools ?? [],
          secretSettings,
        });
      }
    }
    return tasks;
  }

  /**
   * Starts a plugin task's run. A second one is refused, and one that finds
   * a conversation's turn running waits for it to end. `signal` aborts that
   * wait, as when the request that asked for the run closes.
   */
  async start(
    request: PluginTaskRunRequest,
    { signal }: { signal?: AbortSignal } = {},
  ): Promise<AgentRun> {
    if (this.active || this.starting) {
      throw new AgentRunError(
        "An agent task is already running. Stop it first.",
        409,
      );
    }
    // No await between the check and this line: `starting` is set in the
    // same tick, so a second start is refused while this one waits for the
    // slot or launches.
    const attempt = this.launch(request, signal);
    this.starting = attempt;
    try {
      return await attempt;
    } finally {
      if (this.starting === attempt) this.starting = null;
    }
  }

  /** What a run needs, or the reason it can't start now. */
  private async prepareRun(request: PluginTaskRunRequest) {
    const settings = await this.options.storage.getAgentRunnerSettings();
    const clis = await this.detectClis();
    const found = (await this.listTasks(settings, clis, "included")).find(
      (candidate) =>
        candidate.status.pluginId === request.pluginId &&
        candidate.status.taskId === request.taskId,
    );
    if (!found)
      throw new AgentRunError("This agent task is not available.", 404);
    const status = found.status;
    if (status.blockers.length > 0)
      throw new AgentRunError(`${status.blockers[0]}.`, 400);
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
    return { settings, found, status, adapter, cliStatus };
  }

  /**
   * Waits for the slot: a conversation's turn may hold it. Aborted by Ajour
   * quitting or by `signal`. Says whether it had to wait.
   */
  private async acquireSlot(
    signal: AbortSignal | undefined,
  ): Promise<{ lease: TurnLease; waited: boolean }> {
    let waited = false;
    try {
      const lease = await this.slot.acquire("agent-run", {
        signal: signal
          ? AbortSignal.any([this.stopping.signal, signal])
          : this.stopping.signal,
        onWait: () => {
          waited = true;
        },
      });
      return { lease, waited };
    } catch (error) {
      if (!(error instanceof TurnSlotAbortedError)) throw error;
      throw this.stopping.signal.aborted
        ? new AgentRunError("Ajour is quitting.", 409)
        : new AgentRunError("The agent task's start was cancelled.", 409);
    }
  }

  private async launch(
    request: PluginTaskRunRequest,
    signal: AbortSignal | undefined,
  ): Promise<AgentRun> {
    // Checked before any wait, so a run that can't start says so at once.
    let prepared = await this.prepareRun(request);
    // The run holds the slot until it ends.
    const { lease, waited } = await this.acquireSlot(signal);
    try {
      // A turn can hold the slot for minutes, and the settings, MCP, the CLI
      // or the browser can change meanwhile: check again with what holds now.
      if (waited) prepared = await this.prepareRun(request);
      if (signal?.aborted) {
        throw new AgentRunError("The agent task's start was cancelled.", 409);
      }
    } catch (error) {
      lease.release();
      throw error;
    }
    const { settings, found, status, adapter, cliStatus } = prepared;
    // Every declared field has a slot: an unset optional one fills as "".
    const settingValues = Object.fromEntries(
      status.settings.map((field) => [
        `settings.${field.id}`,
        String(status.values[field.id] ?? ""),
      ]),
    );
    const weekLink = status.weekLink
      ? safeHttpsUrl(
          fillTemplate(status.weekLink, {
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
      // The prompt goes to the CLI, and the agent's model at its provider,
      // so a secret setting never fills it.
      const promptSlots = new Set(listTemplateSlots(taskPrompt));
      const secretInPrompt = found.secretSettings.find((field) =>
        promptSlots.has(`settings.${field.id}`),
      );
      if (secretInPrompt) {
        throw new AgentRunError(
          `The task's prompt uses the secret setting ${secretInPrompt.label}. Ajour never gives a secret to an agent.`,
          400,
        );
      }

      step = "create_client";
      // The MCP server enforces the task's tools, whatever the CLI is told.
      const created = await this.options.storage.createMcpClient(
        `${status.label} run`,
        ...(found.tools ? [{ tools: found.tools }] : []),
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
            title: `${status.label}, week of ${request.weekOf}`,
            estimateMinutes: status.estimateMinutes,
          },
          {
            runId,
            ...(weekLink
              ? {
                  link: {
                    label: `Open the week in ${status.pluginName}`,
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
            // Without the secret ones, so none can fill the prompt.
            ...Object.fromEntries(
              Object.entries(settingValues).filter(
                ([slot]) =>
                  !found.secretSettings.some(
                    (field) => slot === `settings.${field.id}`,
                  ),
              ),
            ),
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
      // finalize() through the process's ending.
      step = "spawn";
      let active: ActiveRun | undefined;
      const cli = startCliProcess({
        invocation,
        label: adapter.label,
        cwd: workDirectory,
        stdin: "ignore",
        ...(this.options.killGraceMs === undefined
          ? {}
          : { killGraceMs: this.options.killGraceMs }),
        onLine: (line) => {
          const parsed = adapter.parseEvent(line);
          if (parsed && active) this.onEvent(active, parsed);
        },
      });
      const run: AgentRun = {
        id: runId,
        pluginId: request.pluginId,
        taskId: request.taskId,
        weekOf: request.weekOf,
        sessionId: session.id,
        startedAt: this.now(),
      };
      active = {
        run,
        event,
        client,
        cli,
        workDirectory,
        toolCalls: 0,
        lease,
      };
      const started = active;
      // The ending comes when the CLI closes, or a grace period after it
      // exited or was stopped: something it started can hold its output
      // open, and then the close never comes (#341).
      void cli.finished.then(({ code }) => this.finalize(started, code));
      this.active = active;
      return run;
    } catch (error) {
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
      lease.release();
      endRunEvent(event, {
        outcome: "failed",
        toolCalls: 0,
        launchFailure: { step, error },
        cleanupFailures,
      });
      throw error;
    }
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
    active.lease.release();
    endRunEvent(active.event, {
      outcome,
      exitCode: code,
      stopReason,
      toolCalls: active.toolCalls,
      ...(active.cli.neverStarted && active.cli.error
        ? { launchFailure: { step: "spawn", error: active.cli.error } }
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

  /** Stops the CLI; the run ends within the grace period whatever it does. */
  private terminate(active: ActiveRun) {
    active.cli.terminate();
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
    if (!active.cli.exited) active.stopReason ??= "user";
    this.terminate(active);
    return true;
  }

  /**
   * Kills a run whose session stayed stalled for 10 minutes, or whose CLI kept
   * running 2 minutes after its session ended. Runs with the stall timer.
   */
  tick() {
    const active = this.active;
    if (!active || active.stopReason || active.finalized || active.cli.exited) {
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
    this.stopping.abort();
    const conversations = this.conversations.shutdown();
    if (this.starting) await this.starting.catch(() => undefined);
    await conversations;
    const active = this.active;
    if (!active) return;
    if (!active.finalized && !active.cli.exited) {
      active.stopReason ??= "shutdown";
    }
    this.terminate(active);
    await active.cli.finished;
    await this.finalize(active, active.cli.exited?.code ?? null);
  }
}

function describeEnding(active: ActiveRun, code: number | null): SessionEnding {
  const errorOutput = active.cli.errorLines.join("\n");
  const failure = active.failure ?? active.cli.error?.message;
  // A CLI that never started failed, whatever stop came meanwhile.
  if (active.cli.neverStarted && active.cli.error) {
    const summary = active.cli.error.message;
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
  if (code === 0 && !failure) {
    return {
      outcome: "done",
      summary: active.finalSummary || "The agent finished.",
    };
  }
  const summary = failure ?? `The agent exited with code ${code ?? "unknown"}.`;
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

function safeHttpsUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}
