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
import {
  childRunning,
  endProcessGroup,
  endProcessTree,
} from "./process-tree.ts";

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
  /** Stderr kept between reads, in UTF-8: the newest text. */
  stderrBytes: 64 * 1024,
  /** How long an exited session keeps its last output for a read. */
  exitedKeepMs: 60_000,
  /** Lines one read returns at most, and by default. */
  readLines: 1000,
  defaultReadLines: 100,
  /** The longest a read waits for a line. */
  waitMs: 30_000,
} as const;

/** Time a read leaves its operation to return what it read. */
const RETURN_MARGIN_MS = 250;
/** How often a program that outlived a failed kill is looked for. */
const CONFIRM_END_MS = 3000;

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
  /** The idle timeout, or once the program exited, the end of its keep. */
  idleTimer?: ReturnType<typeof setTimeout>;
  /** Reads under way: the idle timeout waits for them. */
  readers: number;
  openedAt: number;
  lines: string[];
  bytes: number;
  dropped: boolean;
  partial: Buffer[];
  partialBytes: number;
  overlong: boolean;
  stderr: string;
  /** Holds a character split across stderr chunks. */
  stderrDecoder: StringDecoder;
  /** The program ended and its output is all in. */
  exited: boolean;
  exitCode: number | null;
  /**
   * Ajour ended it, or forgot it: no call reaches it. Its program keeps its
   * place, and is ended again at quit, until its end is reported or found.
   */
  ended: boolean;
  /** Its close event went out. */
  reported: boolean;
  waiters: Set<() => void>;
  gone: Promise<void>;
  /** Looks for the program's end every few seconds, until it is found. */
  watchEnd: () => void;
  /** Ajour is ending its tree. */
  killing?: Promise<void>;
}

export interface ProcessSessionsOptions {
  events?: ApiEvents;
  /** Why the plugin may no longer keep a session, rechecked on every call and on a timer. */
  check(caller: BrokerCaller): Promise<string | undefined>;
  /** How often open sessions' gates are rechecked. */
  checkMs?: number;
  /** The plugin holds no session now. */
  released?(pluginId: string): void;
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

  /**
   * Holds one of the plugin's places for an open; call the release once.
   * An exited session holds its place until its output is read or its
   * keep runs out, so a plugin can't pile up unread output.
   */
  reserve(pluginId: string): () => void {
    if (this.stopping) throw new SessionRefused("operation_ended");
    const held = [...this.sessions.values()].filter(
      (s) => s.pluginId === pluginId,
    ).length;
    const pending = this.opening.get(pluginId) ?? 0;
    if (held + pending >= SESSION_LIMITS.perPlugin)
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
      readers: 0,
      openedAt: Date.now(),
      lines: [],
      bytes: 0,
      dropped: false,
      partial: [],
      partialBytes: 0,
      overlong: false,
      stderr: "",
      stderrDecoder: new StringDecoder("utf8"),
      exited: false,
      exitCode: null,
      ended: false,
      reported: false,
      waiters: new Set(),
      gone: new Promise<void>((resolve) => {
        markGone = resolve;
      }),
      watchEnd: () => undefined,
    };
    this.sessions.set(session.id, session);
    child.stdin?.on("error", () => undefined);
    child.stdout?.on("data", (chunk: Buffer) => this.stdout(session, chunk));
    child.stderr?.on("data", (chunk: Buffer) => {
      // An ended session's pipes are still read, so its program never
      // blocks on a full one, but what it writes is dropped.
      if (session.ended) return;
      session.stderr = utf8Tail(
        session.stderr + session.stderrDecoder.write(chunk),
        SESSION_LIMITS.stderrBytes,
      );
    });
    let exitTimer: ReturnType<typeof setTimeout> | undefined;
    const finished = () => {
      clearTimeout(exitTimer);
      if (session.exited) return;
      if (!session.ended && !session.overlong && session.partialBytes > 0)
        this.push(session, Buffer.concat(session.partial));
      session.partial = [];
      session.partialBytes = 0;
      session.exited = true;
      markGone();
      this.wake(session);
      // Ajour ended it: its end frees its place.
      if (session.ended) return this.forget(session);
      this.report(session, "exit");
      // Its last output waits for a read, for a while.
      clearTimeout(session.idleTimer);
      session.idleTimer = setTimeout(
        () => this.forget(session),
        SESSION_LIMITS.exitedKeepMs,
      );
      session.idleTimer.unref?.();
    };
    const waitForPipes = (ms: number) => {
      clearTimeout(exitTimer);
      exitTimer = setTimeout(finished, ms);
      exitTimer.unref?.();
    };
    child.once("exit", (code) => {
      session.exitCode = code;
      // What the program started may outlive it, holding the pipes.
      endProcessGroup(child);
      // Take what came, then stop waiting.
      waitForPipes(500);
    });
    child.once("close", (code) => {
      session.exitCode ??= code;
      finished();
    });
    // Only its end, reported or found, ends the program's session: one
    // that outlives a failed kill keeps its place, and the quit ends it.
    const confirmEnd = () => {
      // A program that reported its exit is having its pipes waited for.
      if (session.exited || !noEndReported(child)) return;
      clearTimeout(exitTimer);
      exitTimer = setTimeout(() => {
        if (session.exited) return;
        if (childRunning(child)) confirmEnd();
        else finished();
      }, CONFIRM_END_MS);
      exitTimer.unref?.();
    };
    session.watchEnd = confirmEnd;
    let erred = false;
    child.on("error", () => {
      // An error once it started, such as a kill that failed, doesn't say
      // the program ended: end it once, and wait for its end.
      if (session.exited || erred) return;
      erred = true;
      if (noEndReported(child)) {
        endProcessTree(child, env, () => session.exited);
        confirmEnd();
      } else waitForPipes(500);
    });
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
    // A read waiting for a line is use: the idle timeout counts from its end.
    session.readers += 1;
    if (!session.exited) clearTimeout(session.idleTimer);
    try {
      return await this.take(session, options, signal, remaining);
    } finally {
      session.readers -= 1;
      this.touch(session);
    }
  }

  private async take(
    session: Session,
    options: { max?: number; waitMs?: number },
    signal: AbortSignal,
    remaining?: () => number | undefined,
  ): Promise<ProcessSessionRead> {
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

  /**
   * Ajour is quitting: no session opens, the gates aren't rechecked, and a
   * session that ends from now on ended with the quit. The host calls it
   * before stopping the plugins, whose gates then turn off.
   */
  quitting(): void {
    this.stopping = true;
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
    if (session.ended) return;
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
    // An exited session keeps its own timer, and a waiting read holds it off.
    if (session.ended || session.exited || session.readers > 0) return;
    clearTimeout(session.idleTimer);
    session.idleTimer = setTimeout(() => {
      if (session.exited) this.forget(session);
      else void this.end(session, "idle");
    }, session.idleMs);
    session.idleTimer.unref?.();
  }

  /** Puts a session, and what it kept, out of any call's reach. */
  private seal(session: Session) {
    session.ended = true;
    clearTimeout(session.idleTimer);
    session.lines = [];
    session.bytes = 0;
    session.partial = [];
    session.partialBytes = 0;
    session.overlong = false;
    session.stderr = "";
    session.stderrDecoder = new StringDecoder("utf8");
    this.wake(session);
  }

  /** Seals a session and frees its place: its program ended. */
  private forget(session: Session) {
    this.seal(session);
    if (this.sessions.get(session.id) !== session) return;
    this.sessions.delete(session.id);
    this.unwatch();
    const pluginId = session.pluginId;
    if (![...this.sessions.values()].some((s) => s.pluginId === pluginId))
      this.options.released?.(pluginId);
  }

  /**
   * Ends the session. Its program keeps its place until its end is
   * reported or found; a later end, the quit or the host's, ends it again.
   */
  private async end(session: Session, why: SessionEndedBy) {
    if (session.ended) {
      if (session.exited) return;
      return this.kill(session);
    }
    // Past the quit, the plugins stopping turns gates off: that is the quit.
    const endedBy = this.stopping ? "quit" : why;
    this.seal(session);
    if (session.exited) this.forget(session);
    else await this.kill(session);
    this.report(session, endedBy);
  }

  /** Ends the session's tree, waiting a while, once at a time. */
  private kill(session: Session): Promise<void> {
    session.killing ??= (async () => {
      endProcessTree(session.child, session.env, () => session.exited);
      // A process the OS won't end leaves its pipes behind, not Ajour waiting.
      await Promise.race([
        session.gone,
        new Promise((resolve) => setTimeout(resolve, 3000).unref?.()),
      ]);
      if (!session.exited) session.watchEnd();
      session.killing = undefined;
    })();
    return session.killing;
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
    if (this.checking || this.stopping) return;
    this.checking = true;
    try {
      for (const session of [...this.sessions.values()]) {
        if (this.stopping) return;
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

/** The child hasn't reported its end. */
function noEndReported(child: ChildProcess): boolean {
  return child.exitCode === null && child.signalCode === null;
}

/**
 * The newest `maxBytes` of `text` in UTF-8, cut between characters: a
 * character, a surrogate pair among them, is kept whole or not at all.
 */
export function utf8Tail(text: string, maxBytes: number): string {
  // A UTF-16 unit is at most three bytes in UTF-8, a pair four.
  if (text.length * 3 <= maxBytes) return text;
  const bytes = Buffer.from(text, "utf8");
  if (bytes.length <= maxBytes) return text;
  let start = bytes.length - maxBytes;
  while (start < bytes.length && (bytes[start]! & 0xc0) === 0x80) start += 1;
  return bytes.subarray(start).toString("utf8");
}
