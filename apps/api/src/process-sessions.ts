/**
 * Process sessions (#743): a declared `session` command the broker keeps
 * running for its plugin to talk to, one line at a time. A session belongs
 * to the plugin, not to the operation that opened it, so a later operation
 * reuses it by id. Ajour owns the process: it ends the whole tree on close,
 * the idle timeout, a gate turning off, or quit. `ProcessBroker` opens a
 * session through the same gates and argument checks as any declared
 * command, then hands the child to `ProcessSessions`.
 */
import type { ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { StringDecoder } from "node:string_decoder";
import { z } from "zod";
import type { BrokerCaller, ProcessSessionRead } from "./broker-port.ts";
import type { ApiEvents } from "./events.ts";
import { endProcessTree } from "./process-tree.ts";

/** What one plugin's sessions may hold and move. */
export const SESSION_LIMITS = {
  /** Sessions a plugin may keep open at once. */
  perPlugin: 2,
  /** One line sent, in UTF-8, before Ajour adds its newline. */
  sendBytes: 1024 * 1024,
  /** Input written but not yet taken by the program. */
  pendingInputBytes: 4 * 1024 * 1024,
  /** One stdout line; a longer one is dropped. */
  lineBytes: 1024 * 1024,
  /** Stdout lines waiting for a read; the oldest go first. */
  bufferBytes: 2 * 1024 * 1024,
  bufferLines: 10_000,
  /** Stderr kept between reads: the newest text. */
  stderrBytes: 64 * 1024,
  /** Lines one read returns at most, and by default. */
  readLines: 1000,
  defaultReadLines: 100,
  /** The longest a read waits for a line. */
  waitMs: 30_000,
} as const;

/** Time a read leaves its operation to return what it read. */
const RETURN_MARGIN_MS = 250;

const sessionIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
export const sessionRequestSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("open"),
      command: z.string().max(80),
      args: z
        .record(z.union([z.string().max(32767), z.number().finite()]))
        .refine((v) => Object.keys(v).length <= 100),
    })
    .strict(),
  z
    .object({
      action: z.literal("send"),
      id: sessionIdSchema,
      line: z.string(),
    })
    .strict(),
  z
    .object({
      action: z.literal("read"),
      id: sessionIdSchema,
      max: z.number().int().min(1).max(SESSION_LIMITS.readLines).optional(),
      waitMs: z.number().int().min(0).max(SESSION_LIMITS.waitMs).optional(),
    })
    .strict(),
  z.object({ action: z.literal("close"), id: sessionIdSchema }).strict(),
]);

/** Why a session ended, as its close event says. */
export type SessionEndedBy = "plugin" | "idle" | "gate" | "quit" | "exit";

export type SessionRefusal =
  | "invalid_request"
  | "session_limit"
  | "session_ended"
  | "input_limit"
  | "operation_ended";

/** Raised by a session call; the broker turns it into its own error. */
export class SessionRefused extends Error {
  readonly reason: SessionRefusal | string;
  constructor(reason: SessionRefusal | string) {
    super(`Process session request refused: ${reason}.`);
    this.reason = reason;
  }
}

interface Session {
  id: string;
  pluginId: string;
  /** The package that opened it: another package of the plugin can't use it. */
  identity: string;
  caller: BrokerCaller;
  commandId: string;
  child: ChildProcess;
  env: Readonly<Record<string, string | undefined>>;
  idleMs: number;
  idleTimer?: ReturnType<typeof setTimeout>;
  openedAt: number;
  lines: string[];
  bytes: number;
  dropped: boolean;
  partial: Buffer[];
  partialBytes: number;
  overlong: boolean;
  stderr: string;
  /** The program ended and its output is all in. */
  exited: boolean;
  exitCode: number | null;
  /** Ajour ended it, or forgot it: no call reaches it. */
  ended: boolean;
  /** Its close event went out. */
  reported: boolean;
  waiters: Set<() => void>;
  gone: Promise<void>;
}

export interface ProcessSessionsOptions {
  events?: ApiEvents;
  /** Why the plugin may no longer keep a session, rechecked on every call and on a timer. */
  check(caller: BrokerCaller): Promise<string | undefined>;
  /** How often open sessions' gates are rechecked. */
  checkMs?: number;
}

export function packageIdentity(caller: BrokerCaller): string {
  return JSON.stringify([
    caller.manifest.version,
    caller.packageKey ?? null,
    caller.development === true,
  ]);
}

export class ProcessSessions {
  private readonly sessions = new Map<string, Session>();
  /** Opens under way, by plugin: they hold a place until registered. */
  private readonly opening = new Map<string, number>();
  private watchdog?: ReturnType<typeof setInterval>;
  private checking = false;
  private stopping = false;
  private readonly options: ProcessSessionsOptions;

  constructor(options: ProcessSessionsOptions) {
    this.options = options;
  }

  /** Holds one of the plugin's places for an open; call the release once. */
  reserve(pluginId: string): () => void {
    if (this.stopping) throw new SessionRefused("operation_ended");
    const live = [...this.sessions.values()].filter(
      (s) => s.pluginId === pluginId && !s.exited,
    ).length;
    const pending = this.opening.get(pluginId) ?? 0;
    if (live + pending >= SESSION_LIMITS.perPlugin)
      throw new SessionRefused("session_limit");
    this.opening.set(pluginId, pending + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const left = (this.opening.get(pluginId) ?? 1) - 1;
      if (left > 0) this.opening.set(pluginId, left);
      else this.opening.delete(pluginId);
    };
  }

  /** Takes over a child the broker started, and returns its new id. */
  register(
    caller: BrokerCaller,
    commandId: string,
    idleTimeoutSeconds: number,
    child: ChildProcess,
    env: Readonly<Record<string, string | undefined>>,
  ): string {
    let markGone!: () => void;
    const session: Session = {
      id: randomBytes(24).toString("base64url"),
      pluginId: caller.pluginId,
      identity: packageIdentity(caller),
      caller,
      commandId,
      child,
      env,
      idleMs: idleTimeoutSeconds * 1000,
      openedAt: Date.now(),
      lines: [],
      bytes: 0,
      dropped: false,
      partial: [],
      partialBytes: 0,
      overlong: false,
      stderr: "",
      exited: false,
      exitCode: null,
      ended: false,
      reported: false,
      waiters: new Set(),
      gone: new Promise<void>((resolve) => {
        markGone = resolve;
      }),
    };
    this.sessions.set(session.id, session);
    child.stdin?.on("error", () => undefined);
    child.stdout?.on("data", (chunk: Buffer) => this.stdout(session, chunk));
    const decoder = new StringDecoder("utf8");
    child.stderr?.on("data", (chunk: Buffer) => {
      session.stderr += decoder.write(chunk);
      if (session.stderr.length > SESSION_LIMITS.stderrBytes)
        session.stderr = session.stderr.slice(-SESSION_LIMITS.stderrBytes);
    });
    let exitTimer: ReturnType<typeof setTimeout> | undefined;
    const finished = () => {
      clearTimeout(exitTimer);
      if (session.exited) return;
      if (!session.overlong && session.partialBytes > 0)
        this.push(session, Buffer.concat(session.partial));
      session.partial = [];
      session.partialBytes = 0;
      session.exited = true;
      markGone();
      this.wake(session);
      if (!session.ended) this.report(session, "exit");
    };
    child.once("exit", (code) => {
      session.exitCode = code;
      // A descendant may still hold the pipes: take what came, then stop waiting.
      exitTimer = setTimeout(finished, 500);
    });
    child.once("close", (code) => {
      session.exitCode ??= code;
      finished();
    });
    child.once("error", () => finished());
    this.touch(session);
    this.watch();
    if (this.stopping) void this.end(session, "quit");
    return session.id;
  }

  async send(caller: BrokerCaller, id: string, line: string): Promise<void> {
    if (
      line.length > SESSION_LIMITS.sendBytes ||
      /[\0\r\n]/.test(line) ||
      Buffer.byteLength(line, "utf8") > SESSION_LIMITS.sendBytes
    )
      throw new SessionRefused("invalid_request");
    const session = await this.use(caller, id);
    const stdin = session.child.stdin;
    if (session.exited || !stdin || stdin.destroyed || !stdin.writable)
      throw new SessionRefused("session_ended");
    if (stdin.writableLength > SESSION_LIMITS.pendingInputBytes)
      throw new SessionRefused("input_limit");
    stdin.write(`${line}\n`);
    this.touch(session);
  }

  async read(
    caller: BrokerCaller,
    id: string,
    options: { max?: number; waitMs?: number },
    signal: AbortSignal,
    remaining?: () => number | undefined,
  ): Promise<ProcessSessionRead> {
    const session = await this.use(caller, id);
    let waitMs = options.waitMs ?? 0;
    const left = remaining?.();
    if (left !== undefined)
      waitMs = Math.min(waitMs, Math.max(0, left - RETURN_MARGIN_MS));
    if (session.lines.length === 0 && !session.exited && waitMs > 0) {
      await new Promise<void>((resolve) => {
        const done = () => {
          clearTimeout(timer);
          session.waiters.delete(done);
          signal.removeEventListener("abort", done);
          resolve();
        };
        const timer = setTimeout(done, waitMs);
        session.waiters.add(done);
        signal.addEventListener("abort", done, { once: true });
      });
      if (signal.aborted) throw new SessionRefused("operation_ended");
      if (session.ended) throw new SessionRefused("session_ended");
    }
    const lines = session.lines.splice(
      0,
      options.max ?? SESSION_LIMITS.defaultReadLines,
    );
    for (const line of lines) session.bytes -= Buffer.byteLength(line, "utf8");
    const result: ProcessSessionRead = {
      lines,
      dropped: session.dropped,
      stderr: session.stderr,
      exited: session.exited && session.lines.length === 0,
      exitCode: session.exitCode,
    };
    session.dropped = false;
    session.stderr = "";
    if (result.exited) this.forget(session);
    else this.touch(session);
    return result;
  }

  async close(caller: BrokerCaller, id: string): Promise<void> {
    const session = this.find(caller, id);
    await this.end(session, "plugin");
  }

  /** Ends every session of the plugin, as when it is turned off or removed. */
  async endPlugin(pluginId: string): Promise<void> {
    await Promise.all(
      [...this.sessions.values()]
        .filter((s) => s.pluginId === pluginId)
        .map((s) => this.end(s, "gate")),
    );
  }

  /** Ends every session and refuses new ones: Ajour is quitting. */
  async shutdown(): Promise<void> {
    this.stopping = true;
    await Promise.all(
      [...this.sessions.values()].map((s) => this.end(s, "quit")),
    );
  }

  /** The caller's own session, with its gates rechecked. */
  private async use(caller: BrokerCaller, id: string): Promise<Session> {
    const session = this.find(caller, id);
    const refusal = await this.options.check(caller);
    if (refusal) {
      await this.end(session, "gate");
      throw new SessionRefused(refusal);
    }
    if (session.ended) throw new SessionRefused("session_ended");
    return session;
  }

  private find(caller: BrokerCaller, id: string): Session {
    const session = this.sessions.get(id);
    // Another plugin's session reads as unknown.
    if (!session || session.ended || session.pluginId !== caller.pluginId)
      throw new SessionRefused("session_ended");
    if (session.identity !== packageIdentity(caller)) {
      void this.end(session, "gate");
      throw new SessionRefused("session_ended");
    }
    return session;
  }

  private stdout(session: Session, chunk: Buffer) {
    let start = 0;
    for (;;) {
      const newline = chunk.indexOf(0x0a, start);
      const piece = chunk.subarray(start, newline < 0 ? chunk.length : newline);
      if (!session.overlong) {
        if (session.partialBytes + piece.length > SESSION_LIMITS.lineBytes) {
          session.overlong = true;
          session.partial = [];
          session.partialBytes = 0;
        } else if (piece.length > 0) {
          session.partial.push(Buffer.from(piece));
          session.partialBytes += piece.length;
        }
      }
      if (newline < 0) break;
      if (session.overlong) session.dropped = true;
      else this.push(session, Buffer.concat(session.partial));
      session.partial = [];
      session.partialBytes = 0;
      session.overlong = false;
      start = newline + 1;
    }
    this.wake(session);
  }

  private push(session: Session, bytes: Buffer) {
    const line = bytes.toString("utf8").replace(/\r$/, "");
    session.lines.push(line);
    session.bytes += Buffer.byteLength(line, "utf8");
    while (
      session.lines.length > SESSION_LIMITS.bufferLines ||
      session.bytes > SESSION_LIMITS.bufferBytes
    ) {
      session.bytes -= Buffer.byteLength(session.lines.shift()!, "utf8");
      session.dropped = true;
    }
  }

  private wake(session: Session) {
    for (const waiter of [...session.waiters]) waiter();
  }

  private touch(session: Session) {
    clearTimeout(session.idleTimer);
    session.idleTimer = setTimeout(() => {
      if (session.exited) this.forget(session);
      else void this.end(session, "idle");
    }, session.idleMs);
    session.idleTimer.unref?.();
  }

  /** Drops a session whose program already ended. */
  private forget(session: Session) {
    session.ended = true;
    clearTimeout(session.idleTimer);
    this.sessions.delete(session.id);
    this.wake(session);
    this.unwatch();
  }

  private async end(session: Session, endedBy: SessionEndedBy) {
    if (session.ended) return session.gone;
    this.forget(session);
    if (!session.exited) {
      endProcessTree(session.child, session.env, () => session.exited);
      // A process the OS won't end leaves its pipes behind, not Ajour waiting.
      await Promise.race([
        session.gone,
        new Promise((resolve) => setTimeout(resolve, 3000).unref?.()),
      ]);
    }
    this.report(session, endedBy);
  }

  private report(session: Session, endedBy: SessionEndedBy) {
    if (session.reported) return;
    session.reported = true;
    const unit = this.options.events?.start("plugin.process", {
      kind: "job",
      trigger: "system",
      detached: true,
      ...(session.caller.traceparent
        ? { traceparent: session.caller.traceparent }
        : {}),
    });
    unit?.set({
      plugin: { id: session.pluginId },
      process: {
        mode: "session",
        session: "close",
        command_id: session.commandId,
        ended_by: endedBy,
        session_ms: Date.now() - session.openedAt,
        ...(session.exitCode === null ? {} : { exit_code: session.exitCode }),
      },
    });
    unit?.end("ok");
  }

  private watch() {
    if (this.watchdog) return;
    this.watchdog = setInterval(
      () => void this.recheck(),
      this.options.checkMs ?? 2000,
    );
    this.watchdog.unref?.();
  }

  private unwatch() {
    if (this.sessions.size > 0 || !this.watchdog) return;
    clearInterval(this.watchdog);
    this.watchdog = undefined;
  }

  private async recheck() {
    if (this.checking) return;
    this.checking = true;
    try {
      for (const session of [...this.sessions.values()]) {
        if (session.ended || session.exited) continue;
        let refusal: string | undefined;
        try {
          refusal = await this.options.check(session.caller);
        } catch {
          refusal = "plugin_off";
        }
        if (refusal) await this.end(session, "gate");
      }
    } finally {
      this.checking = false;
    }
  }
}
