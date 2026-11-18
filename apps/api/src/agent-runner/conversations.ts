import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline";
import type {
  AgentCliId,
  AgentRunnerSettings,
  AgentTurn,
  AgentTurnBlocker,
  AgentTurnEvent,
  CoreAgentTask,
  CoreTaskRunRequest,
} from "../../../../packages/shared/agent-runs.ts";
import type { McpClientCreateResponse } from "../../../../packages/shared/agent-tools.ts";
import type { AjourCatalog } from "../../../../packages/wide-events/catalog.ts";
import {
  errorIdentity,
  type Unit,
} from "../../../../packages/wide-events/index.ts";
import type { ApiEvents } from "../events.ts";
import { resolveSpawn, spawnRefusalMessage } from "../process-spawn/index.ts";
import type { McpClientPullRequestBinding } from "../storage.ts";
import type {
  AgentCliAdapter,
  ConversationAdapter,
  ConversationCodec,
  ConversationEvent,
  ConversationInput,
} from "./adapter.ts";
import { defaultReadVersion } from "./cli-path.ts";
import { AgentRunError, childEnv, versionOnly } from "./launch.ts";
import { buildConversationPrompt, buildTurnPrompt } from "./prompts.ts";
import {
  TurnSlotAbortedError,
  type TurnLease,
  type TurnSlot,
} from "./turn-slot.ts";

/**
 * The pull request's conversation (#778): one at a time, for one pull request
 * at one head. Its turns run one after another, each holding the app's one
 * agent slot only while it runs, and stream their text to the window. A turn
 * for another pull request replaces the conversation, and so does idleness;
 * coming back continues the provider's conversation. See #643 and
 * docs/research/agent-sessions-for-deck.md.
 */

/** A conversation with no turn for this long closes. Provisional (#643). */
export const DEFAULT_CONVERSATION_IDLE_MS = 5 * 60_000;
/** How long an interrupted turn has to end before its process is ended. */
const INTERRUPT_GRACE_MS = 5000;
const DEFAULT_KILL_GRACE_MS = 5000;
const ERROR_LINES = 20;
/** Pull requests whose provider conversation Ajour remembers, to resume it. */
const REMEMBERED_SESSIONS = 20;

export interface AgentConversationsOptions {
  slot: TurnSlot;
  storage: {
    getAgentRunnerSettings(): Promise<AgentRunnerSettings>;
    createMcpClient(
      name: string,
      scope: { pullRequest: McpClientPullRequestBinding },
    ): Promise<McpClientCreateResponse>;
    revokeMcpClient(clientId: string): Promise<boolean>;
  };
  adapters: AgentCliAdapter[];
  findExecutable: (name: string, pathValue: string) => Promise<string | null>;
  readVersion?: (
    executable: string,
    pathValue: string,
  ) => Promise<string | { refused: string } | undefined>;
  loginShellPath: () => Promise<string>;
  tempRoot: string;
  ajourMcpUrl: string;
  events: ApiEvents;
  /** Sends a turn's events to the window. */
  publish: (event: AgentTurnEvent) => void;
  idleMs?: number;
  killGraceMs?: number;
  interruptGraceMs?: number;
}

type ConversationUnit = Unit<AjourCatalog, "agent.conversation">;
type TurnUnit = Unit<AjourCatalog, "agent.turn">;
type CloseReason = "replaced" | "idle" | "shutdown" | "failed";
type LaunchStep =
  | "find_executable"
  | "create_client"
  | "create_work_folder"
  | "build_invocation"
  | "write_files"
  | "spawn";
type TurnStopReason = "user" | "replaced" | "shutdown" | "interrupt_timeout";

/** How a turn ended, for the window and its event. */
type TurnEnding =
  | { outcome: "done" }
  | { outcome: "cancelled" }
  | {
      outcome: "failed";
      /** For the window. Never logged. */
      message: string;
      reason: "cli_failed" | "cli_exited" | "mcp_failed";
    }
  | { outcome: "failed"; message: string; launchFailure: LaunchFailure };

interface LaunchFailure {
  step: LaunchStep;
  error: unknown;
}

interface Turn {
  id: string;
  task: CoreAgentTask;
  prompt: string;
  unit: TurnUnit;
  /** Aborts the wait for the slot. */
  wait: AbortController;
  waitedFrom: number;
  started: boolean;
  textPieces: number;
  toolCalls: number;
  interrupting: boolean;
  interruptTimer?: NodeJS.Timeout;
  stopReason?: TurnStopReason;
  /** A per-turn process's own ending, which counts once the process closes. */
  reported?: TurnEnding;
  finish: (ending: TurnEnding) => void;
  ended: Promise<TurnEnding>;
  settled: boolean;
}

interface CliProcess {
  child: ChildProcess;
  codec: ConversationCodec;
  resumed: boolean;
  /** Whether it named its provider session, so a resume worked. */
  namedSession: boolean;
  exited?: { code: number | null };
  killTimer?: NodeJS.Timeout;
  errorLines: string[];
  closed: Promise<void>;
}

interface Conversation {
  id: string;
  key: string;
  binding: McpClientPullRequestBinding;
  adapter: AgentCliAdapter;
  protocol: ConversationAdapter;
  model: string;
  unit: ConversationUnit;
  /** Its turns, first the running one or the one that waits for the slot. */
  turns: Turn[];
  client?: { id: string; token: string };
  workDirectory?: string;
  process?: CliProcess;
  providerSession?: string;
  idleTimer?: NodeJS.Timeout;
  /** Runs its turns while it has any. */
  draining?: Promise<void>;
  closing?: Promise<void>;
  turnCount: number;
  launchCount: number;
  resumeCount: number;
}

const bindingKey = (binding: McpClientPullRequestBinding) =>
  `${binding.pullRequest}\n${binding.head}`;

export class AgentConversations {
  private readonly options: AgentConversationsOptions;
  private conversation: Conversation | null = null;
  /** Conversations being closed, so shutdown waits for them. */
  private readonly closing = new Set<Promise<void>>();
  /** The turns still going, by ID. */
  private readonly turns = new Map<
    string,
    { conversation: Conversation; turn: Turn }
  >();
  /** The provider's conversation per pull request and head, newest last. */
  private readonly sessions = new Map<
    string,
    { cli: AgentCliId; id: string }
  >();
  private stopping = false;

  constructor(options: AgentConversationsOptions) {
    this.options = options;
  }

  /**
   * Starts a turn in the pull request's conversation, opening it, or
   * replacing another pull request's, as needed. Answers at once: the turn
   * runs, or waits for the slot, and its events stream to the window.
   */
  async startTurn(request: CoreTaskRunRequest): Promise<AgentTurn> {
    if (this.stopping) {
      throw new AgentRunError("Ajour is quitting.", 409);
    }
    const settings = await this.options.storage.getAgentRunnerSettings();
    const adapter = this.options.adapters.find(
      (candidate) => candidate.id === settings.cli,
    );
    if (!adapter) {
      throw new AgentRunError(
        "Pick an installed agent in Settings > Agents.",
        400,
      );
    }
    if (!adapter.conversation) {
      throw new AgentRunError(
        `${adapter.label} can't hold a conversation about a pull request yet. Pick Claude Code or Codex in Settings > Agents.`,
        400,
      );
    }
    const pathValue = await this.options.loginShellPath();
    if (
      !(await this.options.findExecutable(adapter.executableName, pathValue))
    ) {
      throw new AgentRunError(`${adapter.label} is not installed.`, 400);
    }
    if (this.stopping) {
      throw new AgentRunError("Ajour is quitting.", 409);
    }

    // No await from here on: the conversation and its turn queue change in
    // one go, so two starts can't both open a conversation.
    const binding = { pullRequest: request.pullRequest, head: request.head };
    const key = bindingKey(binding);
    let conversation = this.conversation;
    if (
      conversation &&
      (conversation.key !== key ||
        conversation.adapter.id !== adapter.id ||
        conversation.model !== settings.model)
    ) {
      this.close(conversation, "replaced");
      conversation = null;
    }
    conversation ??= this.open(
      binding,
      adapter,
      adapter.conversation,
      settings,
    );

    const free = conversation.turns.length === 0 && this.options.slot.isFree();
    const turn = this.addTurn(conversation, request);
    if (conversation.turns[0] === turn) {
      // Takes the slot in this tick when it is free.
      conversation.draining = this.runTurns(conversation);
    } else {
      this.publishWaiting(conversation, turn, "turn");
    }
    return {
      id: turn.id,
      conversationId: conversation.id,
      task: request.task,
      pullRequest: request.pullRequest,
      head: request.head,
      state: free ? "running" : "waiting",
    };
  }

  /**
   * Stops a turn: a waiting one at once, a running one by asking the CLI to
   * interrupt it, then by ending its process. False when it isn't going.
   */
  cancelTurn(turnId: string): boolean {
    const found = this.turns.get(turnId);
    if (!found) return false;
    this.stopTurn(found.conversation, found.turn, "user");
    return true;
  }

  /** Ajour is quitting: every turn stops and the conversation closes. */
  async shutdown() {
    this.stopping = true;
    if (this.conversation) this.close(this.conversation, "shutdown");
    await Promise.all([...this.closing]);
  }

  private open(
    binding: McpClientPullRequestBinding,
    adapter: AgentCliAdapter,
    protocol: ConversationAdapter,
    settings: AgentRunnerSettings,
  ): Conversation {
    const id = randomUUID();
    const unit = this.options.events.start("agent.conversation", {
      kind: "job",
      trigger: "user",
      detached: true,
    });
    unit.set({
      agent: {
        conversation_id: id,
        cli: adapter.id,
        conversation_mode: protocol.mode,
      },
    });
    const key = bindingKey(binding);
    const remembered = this.sessions.get(key);
    const conversation: Conversation = {
      id,
      key,
      binding,
      adapter,
      protocol,
      model: settings.model,
      unit,
      turns: [],
      ...(remembered?.cli === adapter.id
        ? { providerSession: remembered.id }
        : {}),
      turnCount: 0,
      launchCount: 0,
      resumeCount: 0,
    };
    this.conversation = conversation;
    return conversation;
  }

  private addTurn(conversation: Conversation, request: CoreTaskRunRequest) {
    clearTimeout(conversation.idleTimer);
    const id = randomUUID();
    const unit = conversation.unit.enter(() =>
      this.options.events.start("agent.turn", {
        kind: "job",
        trigger: "user",
        detached: true,
      }),
    );
    unit.set({
      agent: {
        turn_id: id,
        conversation_id: conversation.id,
        task: request.task,
        cli: conversation.adapter.id,
      },
    });
    let finish!: (ending: TurnEnding) => void;
    const ended = new Promise<TurnEnding>((resolve) => {
      finish = resolve;
    });
    const turn: Turn = {
      id,
      task: request.task,
      prompt: buildTurnPrompt(request.task, request.message),
      unit,
      wait: new AbortController(),
      waitedFrom: Date.now(),
      started: false,
      textPieces: 0,
      toolCalls: 0,
      interrupting: false,
      ended,
      settled: false,
      finish: (ending) => {
        if (turn.settled) return;
        turn.settled = true;
        clearTimeout(turn.interruptTimer);
        finish(ending);
      },
    };
    conversation.turns.push(turn);
    conversation.turnCount += 1;
    this.turns.set(id, { conversation, turn });
    return turn;
  }

  /** Runs the conversation's turns one at a time, while it has any. */
  private async runTurns(conversation: Conversation) {
    while (conversation.turns.length > 0) {
      const turn = conversation.turns[0]!;
      await this.runTurn(conversation, turn);
      conversation.turns.shift();
      this.turns.delete(turn.id);
    }
    if (!conversation.closing && this.conversation === conversation) {
      this.scheduleIdleClose(conversation);
    }
  }

  private async runTurn(conversation: Conversation, turn: Turn) {
    let lease: TurnLease | undefined;
    if (!turn.settled) {
      try {
        lease = await this.options.slot.acquire("turn", {
          signal: turn.wait.signal,
          onWait: (blockedBy) =>
            this.publishWaiting(conversation, turn, blockedBy),
        });
      } catch (error) {
        if (!(error instanceof TurnSlotAbortedError)) throw error;
      }
    }
    turn.unit.set({ agent: { wait_ms: Date.now() - turn.waitedFrom } });
    let sending: Promise<void> | undefined;
    if (lease && !turn.settled) {
      turn.started = true;
      this.options.publish({
        type: "started",
        turnId: turn.id,
        conversationId: conversation.id,
      });
      sending = this.send(conversation, turn);
    }
    const ending = await turn.ended;
    // A turn stopped while its process started ends once it has, so a close
    // never misses that process.
    await sending;
    lease?.release();
    this.endTurn(conversation, turn, ending);
  }

  private publishWaiting(
    conversation: Conversation,
    turn: Turn,
    waitingFor: AgentTurnBlocker,
  ) {
    turn.unit.set({ agent: { waited_for: waitingFor } });
    this.options.publish({
      type: "waiting",
      turnId: turn.id,
      conversationId: conversation.id,
      waitingFor,
    });
  }

  /** Sends the turn to the conversation's process, starting one if needed. */
  private async send(conversation: Conversation, turn: Turn) {
    let step: LaunchStep = "find_executable";
    try {
      if (!conversation.process) {
        const launched = await this.launch(conversation, (next) => {
          step = next;
        });
        // The turn was stopped while the process started. A closing
        // conversation ends it, and so does a per-turn process, which would
        // wait for its turn forever.
        if (turn.settled || conversation.closing) {
          if (
            conversation.closing ||
            conversation.protocol.mode === "per-turn"
          ) {
            this.terminate(launched);
          }
          return;
        }
        turn.unit.set({ agent: { resumed: launched.resumed } });
      }
      const { process: cli } = conversation;
      if (!cli || turn.settled) return;
      this.write(cli, cli.codec.sendTurn(turn.prompt));
      if (conversation.protocol.mode === "per-turn") cli.child.stdin?.end();
    } catch (error) {
      turn.finish({
        outcome: "failed",
        message:
          error instanceof AgentRunError
            ? error.message
            : "Ajour could not start the agent.",
        launchFailure: { step, error },
      });
    }
  }

  /** Starts the conversation's process, and its client and folder the first time. */
  private async launch(
    conversation: Conversation,
    reached: (step: LaunchStep) => void,
  ): Promise<CliProcess> {
    const { adapter, protocol } = conversation;
    const pathValue = await this.options.loginShellPath();
    const executable = await this.options.findExecutable(
      adapter.executableName,
      pathValue,
    );
    if (!executable) {
      throw new AgentRunError(`${adapter.label} is not installed.`, 400);
    }
    if (conversation.launchCount === 0) {
      // For the conversation's event only, so the first turn doesn't wait.
      void (this.options.readVersion ?? defaultReadVersion)(
        executable,
        pathValue,
      )
        .then((version) =>
          conversation.unit.set({
            agent: {
              cli_version: versionOnly(
                typeof version === "string"
                  ? (adapter.parseVersion(version) ?? version.trim())
                  : undefined,
              ),
            },
          }),
        )
        .catch(() => undefined);
    }
    if (!conversation.client) {
      reached("create_client");
      const created = await this.options.storage.createMcpClient(
        `${adapter.label}, pull request conversation`,
        { pullRequest: conversation.binding },
      );
      conversation.client = { id: created.client.id, token: created.token };
      conversation.unit.set({ agent: { client_id: created.client.id } });
    }
    if (!conversation.workDirectory) {
      reached("create_work_folder");
      conversation.workDirectory = await mkdtemp(
        path.join(this.options.tempRoot, "conversation-"),
      );
    }

    reached("build_invocation");
    const resume = conversation.providerSession;
    const input: ConversationInput = {
      executable,
      workDirectory: conversation.workDirectory,
      prompt: buildConversationPrompt(conversation.binding),
      ajourMcpUrl: this.options.ajourMcpUrl,
      model: conversation.model,
      baseEnv: { ...childEnv(process.env), PATH: pathValue },
      token: conversation.client.token,
      ...(resume ? { resume } : {}),
    };
    const invocation = protocol.buildInvocation(input);

    reached("write_files");
    for (const [name, content] of Object.entries(invocation.files)) {
      await writeFile(path.join(conversation.workDirectory, name), content, {
        mode: 0o600,
      });
    }

    reached("spawn");
    const plan = resolveSpawn(
      invocation.command,
      invocation.args,
      invocation.env,
    );
    if ("refused" in plan) {
      throw new AgentRunError(
        spawnRefusalMessage(plan.refused, adapter.label, invocation.command),
        400,
      );
    }
    const child = spawn(plan.command, plan.args, {
      cwd: conversation.workDirectory,
      env: plan.env,
      shell: false,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const cli: CliProcess = {
      child,
      codec: protocol.createCodec(input),
      resumed: resume !== undefined,
      namedSession: false,
      errorLines: [],
      closed: Promise.resolve(),
    };
    conversation.launchCount += 1;
    if (cli.resumed) conversation.resumeCount += 1;
    conversation.process = cli;
    cli.closed = this.watch(conversation, cli);
    this.write(cli, cli.codec.open());
    return cli;
  }

  private write(cli: CliProcess, lines: string[]) {
    const stdin = cli.child.stdin;
    if (!stdin || stdin.writableEnded || stdin.destroyed) return;
    for (const line of lines) stdin.write(`${line}\n`);
  }

  /** Reads the process's output. Resolves when it closes. */
  private watch(conversation: Conversation, cli: CliProcess): Promise<void> {
    const { child } = cli;
    // A process that is gone can't take a write.
    child.stdin?.on("error", () => undefined);
    createInterface({ input: child.stdout! }).on("line", (line) => {
      const { events, reply } = cli.codec.read(line);
      this.write(cli, reply);
      for (const event of events) this.onEvent(conversation, cli, event);
    });
    createInterface({ input: child.stderr! }).on("line", (line) => {
      cli.errorLines.push(line);
      if (cli.errorLines.length > ERROR_LINES) cli.errorLines.shift();
    });
    return new Promise((resolve) => {
      child.on("error", (error) => {
        cli.errorLines.push(error.message);
      });
      child.on("exit", (code) => {
        cli.exited = { code };
      });
      child.on("close", (code) => {
        clearTimeout(cli.killTimer);
        this.onClose(conversation, cli, code);
        resolve();
      });
    });
  }

  private onEvent(
    conversation: Conversation,
    cli: CliProcess,
    event: ConversationEvent,
  ) {
    const turn = conversation.turns[0];
    const running = turn?.started && !turn.settled ? turn : undefined;
    switch (event.kind) {
      case "session":
        cli.namedSession = true;
        conversation.providerSession = event.id;
        this.rememberSession(conversation, event.id);
        return;
      case "text":
        if (!running) return;
        this.options.publish({
          type: "text",
          turnId: running.id,
          conversationId: conversation.id,
          index: running.textPieces,
          text: event.text,
        });
        running.textPieces += 1;
        return;
      case "tool-call":
        if (running) running.toolCalls += 1;
        return;
      case "mcp-failed":
        if (running) {
          this.reportEnding(conversation, running, {
            outcome: "failed",
            message: `The ${event.server} MCP server did not start.`,
            reason: "mcp_failed",
          });
        }
        this.terminate(cli);
        return;
      case "turn-done":
      case "turn-interrupted":
      case "turn-failed":
        if (!running) return;
        this.reportEnding(
          conversation,
          running,
          event.kind === "turn-done"
            ? { outcome: "done" }
            : event.kind === "turn-interrupted"
              ? { outcome: "cancelled" }
              : {
                  outcome: "failed",
                  message: event.message,
                  reason: "cli_failed",
                },
        );
        return;
    }
  }

  /**
   * A warm process's turn ends with its own ending. A per-turn process's
   * ending counts once it closes, so the next turn never starts a second
   * process on the same conversation.
   */
  private reportEnding(
    conversation: Conversation,
    turn: Turn,
    ending: TurnEnding,
  ) {
    if (conversation.protocol.mode === "warm") turn.finish(ending);
    else turn.reported ??= ending;
  }

  private onClose(
    conversation: Conversation,
    cli: CliProcess,
    code: number | null,
  ) {
    if (conversation.process === cli) conversation.process = undefined;
    // A resume that never named a session didn't work: start fresh next time.
    if (cli.resumed && !cli.namedSession) {
      conversation.providerSession = undefined;
      this.sessions.delete(conversation.key);
    }
    const turn = conversation.turns[0];
    if (!turn?.started || turn.settled) return;
    turn.unit.set({ agent: { exit_code: code } });
    if (turn.reported) {
      turn.finish(turn.reported);
    } else if (turn.interrupting || turn.stopReason) {
      turn.finish({ outcome: "cancelled" });
    } else if (code === 0 && conversation.protocol.mode === "per-turn") {
      turn.finish({ outcome: "done" });
    } else {
      const output = cli.errorLines.at(-1);
      turn.finish({
        outcome: "failed",
        message: output
          ? `${conversation.adapter.label} stopped: ${output}`
          : `${conversation.adapter.label} exited with code ${code ?? "unknown"}.`,
        reason: "cli_exited",
      });
    }
  }

  private rememberSession(conversation: Conversation, id: string) {
    this.sessions.delete(conversation.key);
    this.sessions.set(conversation.key, { cli: conversation.adapter.id, id });
    if (this.sessions.size > REMEMBERED_SESSIONS) {
      this.sessions.delete(this.sessions.keys().next().value!);
    }
  }

  private stopTurn(
    conversation: Conversation,
    turn: Turn,
    reason: TurnStopReason,
  ) {
    if (turn.settled) return;
    turn.stopReason ??= reason;
    if (!turn.started) {
      // It waits: for the slot, or behind another turn.
      turn.wait.abort();
      turn.finish({ outcome: "cancelled" });
      return;
    }
    const cli = conversation.process;
    if (!cli) {
      // Its process is still starting, and send() checks before it writes.
      turn.finish({ outcome: "cancelled" });
      return;
    }
    if (turn.interrupting) return;
    turn.interrupting = true;
    const lines = cli.codec.interrupt();
    if (lines.length === 0 || reason !== "user") {
      this.terminate(cli);
      return;
    }
    this.write(cli, lines);
    turn.interruptTimer = setTimeout(() => {
      turn.stopReason = "interrupt_timeout";
      this.terminate(cli);
    }, this.options.interruptGraceMs ?? INTERRUPT_GRACE_MS);
    turn.interruptTimer.unref();
  }

  private endTurn(conversation: Conversation, turn: Turn, ending: TurnEnding) {
    this.turns.delete(turn.id);
    const { unit } = turn;
    unit.set({
      agent: {
        text_piece_count: turn.textPieces,
        tool_call_count: turn.toolCalls,
        ...(turn.stopReason ? { stop_reason: turn.stopReason } : {}),
      },
    });
    this.options.publish({
      type: "ended",
      turnId: turn.id,
      conversationId: conversation.id,
      outcome: ending.outcome,
      ...(ending.outcome === "failed" ? { error: ending.message } : {}),
    });
    if (ending.outcome === "done") {
      unit.end("ok");
    } else if (ending.outcome === "cancelled") {
      unit.end("cancelled");
    } else if ("launchFailure" in ending) {
      unit.set({ launch: { failed_step: ending.launchFailure.step } });
      unit.fail(ending.launchFailure.error);
      unit.end();
      // A conversation that can't start its process can't go on.
      if (!conversation.closing) this.close(conversation, "failed");
    } else {
      unit.end("error", ending.reason);
    }
  }

  private scheduleIdleClose(conversation: Conversation) {
    clearTimeout(conversation.idleTimer);
    conversation.idleTimer = setTimeout(() => {
      if (conversation.turns.length === 0) this.close(conversation, "idle");
    }, this.options.idleMs ?? DEFAULT_CONVERSATION_IDLE_MS);
    conversation.idleTimer.unref();
  }

  /**
   * Closes the conversation once: its turns stop, its process ends, its
   * client is revoked and its folder removed. Its provider conversation is
   * remembered, so coming back resumes it.
   */
  private close(conversation: Conversation, reason: CloseReason) {
    if (conversation.closing) return;
    clearTimeout(conversation.idleTimer);
    if (this.conversation === conversation) this.conversation = null;
    const stopReason: TurnStopReason =
      reason === "shutdown" ? "shutdown" : "replaced";
    for (const turn of [...conversation.turns]) {
      this.stopTurn(conversation, turn, stopReason);
    }
    const closing = this.finishClose(conversation, reason);
    conversation.closing = closing;
    this.closing.add(closing);
    void closing.finally(() => this.closing.delete(closing));
  }

  private async finishClose(conversation: Conversation, reason: CloseReason) {
    const endProcess = async () => {
      const cli = conversation.process;
      if (!cli) return;
      this.terminate(cli);
      await this.closedWithinGrace(cli);
    };
    await endProcess();
    // A process that never closed ends its turn here.
    for (const turn of conversation.turns) {
      turn.finish({ outcome: "cancelled" });
    }
    await conversation.draining;
    // A process that a stopped turn was still starting.
    await endProcess();
    const failures: {
      step: "revoke_client" | "remove_work_folder";
      error: unknown;
    }[] = [];
    if (conversation.client) {
      try {
        await this.options.storage.revokeMcpClient(conversation.client.id);
      } catch (error) {
        failures.push({ step: "revoke_client", error });
      }
    }
    if (conversation.workDirectory) {
      try {
        await rm(conversation.workDirectory, { recursive: true, force: true });
      } catch (error) {
        failures.push({ step: "remove_work_folder", error });
      }
    }
    this.options.publish({
      type: "conversation-closed",
      conversationId: conversation.id,
      reason,
    });
    const [first] = failures;
    conversation.unit.set({
      agent: {
        turn_count: conversation.turnCount,
        launch_count: conversation.launchCount,
        resume_count: conversation.resumeCount,
        close_reason: reason,
      },
      cleanup: {
        outcome: first ? "failed" : "ok",
        failed_steps: failures.map((failure) => failure.step),
        ...(first ? { error: errorIdentity(first.error) } : {}),
      },
    });
    conversation.unit.end(reason === "failed" ? "error" : "ok");
  }

  /** Ends stdin, then SIGTERM, then SIGKILL after the grace period. */
  private terminate(cli: CliProcess) {
    cli.child.stdin?.end();
    if (cli.child.pid === undefined || cli.exited) return;
    cli.child.kill("SIGTERM");
    if (cli.killTimer) return;
    cli.killTimer = setTimeout(
      () => cli.child.kill("SIGKILL"),
      this.options.killGraceMs ?? DEFAULT_KILL_GRACE_MS,
    );
    cli.killTimer.unref();
  }

  /**
   * Waits for the process to close, or gives up a second after the kill
   * grace period: something it started can hold its output open (#341).
   */
  private closedWithinGrace(cli: CliProcess): Promise<void> {
    return new Promise((resolve) => {
      const giveUp = setTimeout(
        resolve,
        (this.options.killGraceMs ?? DEFAULT_KILL_GRACE_MS) + 1000,
      );
      void cli.closed.then(() => {
        clearTimeout(giveUp);
        resolve();
      });
    });
  }
}
