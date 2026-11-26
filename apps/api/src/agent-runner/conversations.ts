import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
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
import type { McpClientPullRequestBinding } from "../storage.ts";
import type {
  AgentCliAdapter,
  ConversationAdapter,
  ConversationCodec,
  ConversationEvent,
  ConversationInput,
} from "./adapter.ts";
import { defaultReadVersion } from "./cli-path.ts";
import { startCliProcess, type CliProcess } from "./cli-process.ts";
import { AgentRunError, childEnv, versionOnly } from "./launch.ts";
import { buildConversationPrompt, buildTurnPrompt } from "./prompts.ts";
import {
  TurnSlotAbortedError,
  type TurnLease,
  type TurnSlot,
} from "./turn-slot.ts";

/**
 * The pull request's conversation (#778): one at a time, for one pull
 * request. Its turns run one after another, each holding the app's one agent
 * slot only while it runs, and stream their text to the window. A turn for
 * another pull request replaces the conversation, and so does idleness;
 * coming back continues the provider's conversation. A new head keeps it:
 * the next turn rebinds its tools to that head and tells the agent. See
 * #643, ADR 0021 and docs/research/agent-sessions-for-deck.md.
 */

/** A conversation with no turn for this long closes. Provisional (#643). */
export const DEFAULT_CONVERSATION_IDLE_MS = 5 * 60_000;
/** A running turn whose CLI prints nothing for this long fails, as a stalled run does. */
export const DEFAULT_TURN_STALL_MS = 10 * 60_000;
/** How long an interrupted turn has to end before its process is ended. */
const INTERRUPT_GRACE_MS = 5000;
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
    /** Binds a conversation's client to the pull request's new head. */
    rebindMcpClient(
      clientId: string,
      binding: McpClientPullRequestBinding,
    ): Promise<boolean>;
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
  /**
   * Whether the user still allows the pull request's repository with this
   * agent. Asked before each turn is sent, so nothing reaches an agent the
   * user took the repository back from (#791).
   */
  admits: (pullRequest: string, cli: AgentCliId) => Promise<boolean>;
  /**
   * Why a turn the CLI ended as done failed all the same, or undefined:
   * a guide turn that saved no guide (#794).
   */
  doneFailure?: (turn: {
    id: string;
    task: CoreAgentTask;
  }) => string | undefined;
  idleMs?: number;
  killGraceMs?: number;
  interruptGraceMs?: number;
  /** How long a running turn's CLI may print nothing before the turn fails. */
  stallMs?: number;
}

type ConversationUnit = Unit<AjourCatalog, "agent.conversation">;
type TurnUnit = Unit<AjourCatalog, "agent.turn">;
type CloseReason = "replaced" | "idle" | "shutdown" | "failed" | "revoked";
type LaunchStep =
  | "find_executable"
  | "rebind_client"
  | "create_client"
  | "create_work_folder"
  | "build_invocation"
  | "write_files"
  | "spawn";
type TurnStopReason =
  | "user"
  | "replaced"
  | "shutdown"
  | "interrupt_timeout"
  | "stalled"
  | "revoked"
  /** It gave back what its task asks for, so Ajour ended it: it counts as done. */
  | "completed";

/** How a turn ended, for the window and its event. */
type TurnEnding =
  | { outcome: "done" }
  | { outcome: "cancelled" }
  | {
      outcome: "failed";
      /** For the window. Never logged. */
      message: string;
      reason:
        | "cli_failed"
        | "cli_exited"
        | "mcp_failed"
        | "stalled"
        /** Done, but it gave back nothing its task asks for, such as a guide. */
        | "no_result";
    }
  | { outcome: "failed"; message: string; launchFailure: LaunchFailure }
  | {
      outcome: "failed";
      message: string;
      /** The repository isn't allowed with the conversation's agent now. */
      reason: "repository_not_allowed";
    };

interface LaunchFailure {
  step: LaunchStep;
  error: unknown;
}

interface Turn {
  id: string;
  task: CoreAgentTask;
  message?: string;
  /** The head the turn is about. The conversation rebinds to it when it starts. */
  head: string;
  /** The head the conversation was bound to before this turn, when it changed. */
  headChangedFrom?: string;
  unit: TurnUnit;
  /** Aborts the wait for the slot. */
  wait: AbortController;
  waitedFrom: number;
  started: boolean;
  textPieces: number;
  toolCalls: number;
  interrupting: boolean;
  interruptTimer?: NodeJS.Timeout;
  /** Fails the turn when its CLI goes quiet for too long. */
  stallTimer?: NodeJS.Timeout;
  /** The process the turn was last sent to. Only that process's ending ends it. */
  process?: ConversationProcess;
  stopReason?: TurnStopReason;
  /**
   * The CLI's own ending, which counts once its process finished: a
   * per-turn process's, or one that may need the turn sent again.
   */
  reported?: TurnEnding;
  /** Set when a resume failed and the turn started a new provider conversation. */
  historyLost: boolean;
  /** The turn's latest send, which a turn's end waits for. */
  sending?: Promise<void>;
  finish: (ending: TurnEnding) => void;
  ended: Promise<TurnEnding>;
  settled: boolean;
}

interface ConversationProcess {
  proc: CliProcess;
  codec: ConversationCodec;
  resumed: boolean;
  /** Whether it named its provider session, so a resume worked. */
  namedSession: boolean;
  /**
   * Set once Ajour ends it. Its turn ends when it finished, and the next
   * turn waits for that, then starts a new process.
   */
  ending: boolean;
  /**
   * Set when Ajour ended it for another reason than a failed resume, such
   * as a cancel or a failed MCP server: one that named no session yet may
   * still have found it, so the conversation keeps it.
   */
  stoppedByAjour: boolean;
}

interface Conversation {
  id: string;
  /** Its pull request. A new head keeps the conversation. */
  key: string;
  /** The pull request, the head its tools are bound to now, and its agent. */
  binding: McpClientPullRequestBinding;
  adapter: AgentCliAdapter;
  protocol: ConversationAdapter;
  model: string;
  unit: ConversationUnit;
  /** Its turns, first the running one or the one that waits for the slot. */
  turns: Turn[];
  client?: { id: string; token: string };
  workDirectory?: string;
  process?: ConversationProcess;
  providerSession?: string;
  idleTimer?: NodeJS.Timeout;
  /** Runs its turns while it has any. */
  draining?: Promise<void>;
  closing?: Promise<void>;
  turnCount: number;
  launchCount: number;
  resumeCount: number;
  headChangeCount: number;
}

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
  /**
   * The provider's conversation per pull request, newest last, with the
   * head it was last about.
   */
  private readonly sessions = new Map<
    string,
    { cli: AgentCliId; id: string; head: string }
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
    const key = request.pullRequest;
    let conversation = this.conversation;
    // Another pull request, CLI or model replaces it; a new head doesn't.
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
      { pullRequest: request.pullRequest, head: request.head, cli: adapter.id },
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

  /**
   * The turn running now in the conversation whose client is `clientId`,
   * once it is sent to its CLI: what a call of that client's tools is part
   * of. Undefined between turns, once the turn is being stopped, and for
   * any other client.
   */
  runningTurnOf(
    clientId: string,
  ):
    | { id: string; task: CoreAgentTask; pullRequest: string; head: string }
    | undefined {
    const { conversation } = this;
    if (!conversation || conversation.closing) return undefined;
    if (conversation.client?.id !== clientId) return undefined;
    const turn = conversation.turns[0];
    if (!turn?.started || turn.settled || !turn.process) return undefined;
    // A turn the user stopped, or that stalled, runs only until its CLI
    // ends; one completed is done already.
    if (turn.stopReason && turn.stopReason !== "completed") return undefined;
    return {
      id: turn.id,
      task: turn.task,
      pullRequest: conversation.key,
      head: conversation.binding.head,
    };
  }

  /**
   * Ends a running turn that gave back what its task asks for, such as a
   * guide turn whose guide is saved (#794): the CLI is interrupted, as Stop
   * does, and the turn ends done. False when it isn't running.
   */
  completeTurn(turnId: string): boolean {
    const found = this.turns.get(turnId);
    if (!found?.turn.started || found.turn.settled) return false;
    this.stopTurn(found.conversation, found.turn, "completed");
    return true;
  }

  /**
   * Closes the conversation when its pull request is one of `pullRequest`'s:
   * its running turn and those queued behind it stop, and its client is
   * revoked. Revoking a repository does this (#791).
   */
  closeWhere(pullRequest: (key: string) => boolean): boolean {
    const { conversation } = this;
    if (!conversation || !pullRequest(conversation.key)) return false;
    this.close(conversation, "revoked");
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
    const key = binding.pullRequest;
    const remembered = this.sessions.get(key);
    const resumes = remembered?.cli === adapter.id;
    const conversation: Conversation = {
      id,
      key,
      // A resumed conversation starts at the head it was about, so its
      // first turn rebinds it and tells the agent when the head moved.
      binding: resumes ? { ...binding, head: remembered.head } : binding,
      adapter,
      protocol,
      model: settings.model,
      unit,
      turns: [],
      ...(resumes ? { providerSession: remembered.id } : {}),
      turnCount: 0,
      launchCount: 0,
      resumeCount: 0,
      headChangeCount: 0,
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
      ...(request.message === undefined ? {} : { message: request.message }),
      head: request.head,
      unit,
      wait: new AbortController(),
      waitedFrom: Date.now(),
      started: false,
      textPieces: 0,
      toolCalls: 0,
      interrupting: false,
      historyLost: false,
      ended,
      settled: false,
      finish: (ending) => {
        if (turn.settled) return;
        turn.settled = true;
        clearTimeout(turn.interruptTimer);
        clearTimeout(turn.stallTimer);
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
      if (conversation.turns[0] === turn) conversation.turns.shift();
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
    if (lease && !turn.settled) {
      turn.started = true;
      this.options.publish({
        type: "started",
        turnId: turn.id,
        conversationId: conversation.id,
      });
      this.watchStall(conversation, turn);
      turn.sending = this.send(conversation, turn);
    }
    const ending = await turn.ended;
    // A turn stopped while its process started ends once it has, so a close
    // never misses that process.
    await turn.sending;
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

  /** (Re)starts the running turn's stall timer: its CLI said something. */
  private watchStall(conversation: Conversation, turn: Turn) {
    clearTimeout(turn.stallTimer);
    if (turn.settled) return;
    turn.stallTimer = setTimeout(() => {
      if (turn.settled) return;
      turn.stopReason = "stalled";
      const cli = conversation.process;
      // Its process's ending ends it. Not yet sent, it ends now.
      if (cli && turn.process === cli) {
        this.terminate(cli);
      } else {
        turn.finish(STALLED);
      }
    }, this.options.stallMs ?? DEFAULT_TURN_STALL_MS);
    turn.stallTimer.unref();
  }

  /**
   * Whether the user still allows the pull request's repository with the
   * conversation's agent. Not allowed, the turn fails and the conversation
   * closes, so no turn queued behind it is sent either.
   */
  private async admitted(conversation: Conversation, turn: Turn) {
    if (await this.options.admits(conversation.key, conversation.adapter.id)) {
      return true;
    }
    turn.finish({
      outcome: "failed",
      // The page shows it, and nothing there names the agent.
      message:
        "Ajour may no longer send this repository's code. Ask again to allow it.",
      reason: "repository_not_allowed",
    });
    return false;
  }

  /**
   * Sends the turn to the conversation's process, starting one if needed,
   * once the repository is still allowed with its agent. A turn about a new
   * head first rebinds the conversation's tools to it.
   */
  private async send(conversation: Conversation, turn: Turn) {
    let step: LaunchStep = "find_executable";
    try {
      if (!(await this.admitted(conversation, turn)) || turn.settled) return;
      if (turn.head !== conversation.binding.head) {
        step = "rebind_client";
        await this.rebind(conversation, turn);
      }
      const dying = conversation.process;
      if (dying?.ending) {
        // An earlier turn's process that Ajour ended. The turn goes to a new
        // one, which starts once that one finished.
        await dying.proc.finished;
        if (conversation.process === dying) conversation.process = undefined;
        if (turn.settled) return;
      }
      if (!conversation.process) {
        step = "find_executable";
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
      // Asked again right before the turn goes: the process may have taken
      // a while to start.
      if (!(await this.admitted(conversation, turn))) return;
      const { process: cli } = conversation;
      if (!cli || turn.settled || conversation.closing) return;
      turn.process = cli;
      cli.proc.write(
        cli.codec.sendTurn(
          buildTurnPrompt(turn.task, turn.message, {
            ...(turn.headChangedFrom
              ? {
                  headChange: {
                    from: turn.headChangedFrom,
                    to: conversation.binding.head,
                  },
                }
              : {}),
            ...(turn.historyLost ? { historyLost: true } : {}),
          }),
        ),
      );
      if (conversation.protocol.mode === "per-turn") cli.proc.endInput();
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

  /** Binds the conversation, and its client, to the turn's head. */
  private async rebind(conversation: Conversation, turn: Turn) {
    const binding = { ...conversation.binding, head: turn.head };
    turn.headChangedFrom = conversation.binding.head;
    // The binding changes first: a client created later gets the new head.
    conversation.binding = binding;
    conversation.headChangeCount += 1;
    const remembered = this.sessions.get(conversation.key);
    if (remembered) remembered.head = binding.head;
    turn.unit.set({ agent: { head_changed: true } });
    if (conversation.client) {
      await this.options.storage.rebindMcpClient(
        conversation.client.id,
        binding,
      );
    }
  }

  /** Starts the conversation's process, and its client and folder the first time. */
  private async launch(
    conversation: Conversation,
    reached: (step: LaunchStep) => void,
  ): Promise<ConversationProcess> {
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
    let cli: ConversationProcess | undefined;
    const proc = startCliProcess({
      invocation,
      label: adapter.label,
      cwd: conversation.workDirectory,
      stdin: "pipe",
      ...(this.options.killGraceMs === undefined
        ? {}
        : { killGraceMs: this.options.killGraceMs }),
      onLine: (line) => {
        if (cli) this.onLine(conversation, cli, line);
      },
      // Progress and retries on stderr show the CLI is still at work. Some
      // CLIs report a failure only there.
      onErrorLine: (line) => {
        if (cli) this.onErrorLine(conversation, cli, line);
      },
    });
    cli = {
      proc,
      codec: protocol.createCodec(input),
      resumed: resume !== undefined,
      namedSession: false,
      ending: false,
      stoppedByAjour: false,
    };
    const started = cli;
    conversation.launchCount += 1;
    if (cli.resumed) conversation.resumeCount += 1;
    conversation.process = cli;
    // It ends when it closes, or a grace period after it exited or was
    // ended: what it started can hold its output open (#341).
    void proc.finished.then(({ code }) =>
      this.onClose(conversation, started, code),
    );
    proc.write(cli.codec.open());
    return cli;
  }

  private onLine(
    conversation: Conversation,
    cli: ConversationProcess,
    line: string,
  ) {
    const { events, reply } = cli.codec.read(line);
    cli.proc.write(reply);
    this.onActivity(conversation, cli);
    for (const event of events) this.onEvent(conversation, cli, event);
  }

  private onErrorLine(
    conversation: Conversation,
    cli: ConversationProcess,
    line: string,
  ) {
    this.onActivity(conversation, cli);
    if (!cli.codec.readError) return;
    const { events, reply } = cli.codec.readError(line);
    cli.proc.write(reply);
    for (const event of events) this.onEvent(conversation, cli, event);
  }

  /** The CLI printed something, on either stream: its turn isn't stalled. */
  private onActivity(conversation: Conversation, cli: ConversationProcess) {
    const turn = this.runningOn(conversation, cli);
    if (turn) this.watchStall(conversation, turn);
  }

  /** The conversation's running turn, when it was sent to `cli`. */
  private runningOn(conversation: Conversation, cli: ConversationProcess) {
    const turn = conversation.turns[0];
    return turn?.started && !turn.settled && turn.process === cli
      ? turn
      : undefined;
  }

  private onEvent(
    conversation: Conversation,
    cli: ConversationProcess,
    event: ConversationEvent,
  ) {
    const running = this.runningOn(conversation, cli);
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
      case "cli-failed":
        // Ended first, so the turn ends once the process finished.
        this.terminate(cli);
        if (running) {
          this.reportEnding(
            conversation,
            cli,
            running,
            event.kind === "mcp-failed"
              ? {
                  outcome: "failed",
                  message: `The ${event.server} MCP server did not start.`,
                  reason: "mcp_failed",
                }
              : {
                  outcome: "failed",
                  message: event.message,
                  reason: "cli_failed",
                },
          );
        }
        return;
      case "turn-done":
      case "turn-interrupted":
      case "turn-failed":
        if (!running) return;
        this.reportEnding(
          conversation,
          cli,
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
   * A resumed process that never named its session found no conversation to
   * resume, unless Ajour ended it before it could.
   */
  private resumeFailed(cli: ConversationProcess) {
    return cli.resumed && !cli.namedSession && !cli.stoppedByAjour;
  }

  /**
   * A warm process's turn ends with its own ending. A per-turn process's
   * ending counts once it finished, so the next turn never starts a second
   * process on the same conversation. So does a failed resume's, whose turn
   * is sent again to a new conversation, and an ended process's, so the next
   * turn never goes to a process on its way out.
   */
  private reportEnding(
    conversation: Conversation,
    cli: ConversationProcess,
    turn: Turn,
    ending: TurnEnding,
  ) {
    if (
      conversation.protocol.mode === "warm" &&
      !this.resumeFailed(cli) &&
      !cli.ending
    ) {
      turn.finish(ending);
      return;
    }
    turn.reported ??= ending;
    if (this.resumeFailed(cli)) this.terminate(cli, { resumeFailed: true });
  }

  private onClose(
    conversation: Conversation,
    cli: ConversationProcess,
    code: number | null,
  ) {
    if (conversation.process === cli) conversation.process = undefined;
    const resumeFailed = this.resumeFailed(cli);
    // A resume that never named a session didn't work: start fresh.
    if (resumeFailed) {
      conversation.providerSession = undefined;
      this.sessions.delete(conversation.key);
    }
    // Only the turn this process ran: a later turn waits for a new one.
    const turn = this.runningOn(conversation, cli);
    if (!turn) return;
    turn.unit.set({ agent: { exit_code: code } });
    if (
      resumeFailed &&
      turn.reported?.outcome !== "done" &&
      turn.textPieces === 0 &&
      !turn.historyLost &&
      !turn.interrupting &&
      !turn.stopReason &&
      !conversation.closing
    ) {
      // The provider has no conversation to resume, such as after its own
      // sessions were cleared. The turn starts a new one, once, and says the
      // earlier turns are gone.
      turn.historyLost = true;
      turn.reported = undefined;
      turn.unit.set({ agent: { history_lost: true } });
      turn.sending = this.send(conversation, turn);
      return;
    }
    if (turn.stopReason === "stalled") {
      turn.finish(STALLED);
    } else if (turn.reported) {
      turn.finish(turn.reported);
    } else if (turn.interrupting || turn.stopReason) {
      turn.finish({ outcome: "cancelled" });
    } else if (code === 0 && conversation.protocol.mode === "per-turn") {
      turn.finish({ outcome: "done" });
    } else {
      const output = cli.proc.errorLines.at(-1);
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
    this.sessions.set(conversation.key, {
      cli: conversation.adapter.id,
      id,
      head: conversation.binding.head,
    });
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
      // It waits: for the slot, or behind another turn. It ends now, so a
      // second cancel finds nothing.
      turn.wait.abort();
      turn.finish({ outcome: "cancelled" });
      this.turns.delete(turn.id);
      const index = conversation.turns.indexOf(turn);
      if (index > 0) {
        // Behind another turn, so nothing runs it: it ends here.
        conversation.turns.splice(index, 1);
        this.endTurn(conversation, turn, { outcome: "cancelled" });
      }
      // The first one waits for the slot, and its run ends it at once.
      return;
    }
    const cli = conversation.process;
    if (!cli || turn.process !== cli) {
      // It isn't sent yet, and send() checks before it writes.
      turn.finish({ outcome: "cancelled" });
      return;
    }
    if (turn.interrupting) return;
    turn.interrupting = true;
    const lines = cli.codec.interrupt();
    // Only the user's Stop, and a turn that is done, keep a warm process.
    if (lines.length === 0 || (reason !== "user" && reason !== "completed")) {
      this.terminate(cli);
      return;
    }
    cli.proc.write(lines);
    turn.interruptTimer = setTimeout(() => {
      // A completed turn stays completed: it is done whatever ends it.
      if (turn.stopReason !== "completed")
        turn.stopReason = "interrupt_timeout";
      this.terminate(cli);
    }, this.options.interruptGraceMs ?? INTERRUPT_GRACE_MS);
    turn.interruptTimer.unref();
  }

  private endTurn(
    conversation: Conversation,
    turn: Turn,
    reported: TurnEnding,
  ) {
    this.turns.delete(turn.id);
    // Ended by Ajour once its task's result was in: done, however it stopped.
    const done: TurnEnding =
      turn.stopReason === "completed" && reported.outcome === "cancelled"
        ? { outcome: "done" }
        : reported;
    const failure =
      done.outcome === "done"
        ? this.options.doneFailure?.({ id: turn.id, task: turn.task })
        : undefined;
    const ending: TurnEnding = failure
      ? { outcome: "failed", message: failure, reason: "no_result" }
      : done;
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
      ...(turn.historyLost ? { historyLost: true } : {}),
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
    } else if (ending.reason === "repository_not_allowed") {
      unit.end("refused", ending.reason);
      // Nor can one whose repository its agent may no longer read.
      if (!conversation.closing) this.close(conversation, "revoked");
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
      reason === "shutdown"
        ? "shutdown"
        : reason === "revoked"
          ? "revoked"
          : "replaced";
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
      // Comes a second after the kill grace period at the latest.
      await cli.proc.finished;
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
        await rm(conversation.workDirectory, {
          recursive: true,
          force: true,
          maxRetries: 3,
        });
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
        head_change_count: conversation.headChangeCount,
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

  private terminate(
    cli: ConversationProcess,
    { resumeFailed = false }: { resumeFailed?: boolean } = {},
  ) {
    cli.ending = true;
    if (!resumeFailed) cli.stoppedByAjour = true;
    cli.proc.terminate();
  }
}

const STALLED: TurnEnding = {
  outcome: "failed",
  message: "The agent stopped answering.",
  reason: "stalled",
};
