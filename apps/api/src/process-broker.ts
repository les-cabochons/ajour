import { isValidHandoffBranch } from "../../../packages/shared/handoff-templates.ts";
import {
  undeclaredCommandSchema,
  type CommandPolicy,
  type CommandMode,
  type CommandAsk,
  type UndeclaredCommand,
} from "../../../packages/shared/command-modes.ts";
import {
  commandDecision,
  noCommandReview,
  sameCommand,
  type CommandReview,
} from "./command-review.ts";
import {
  launchProcess,
  startUnowned,
  ProcessLaunchRefused,
  type TerminalApp,
} from "./process-launch.ts";
import { pluginProcessesSchema } from "../../../packages/shared/plugin-api-4.ts";

import { spawn, execFile } from "node:child_process";
import path from "node:path";
import { z } from "zod";
import type { DeclaredArgument } from "../../../packages/shared/plugin-api-4.ts";
import type {
  BrokerCaller,
  FolderResolver,
  ProcessBrokerPort,
  ProcessRunRequest,
  ProcessRunResult,
} from "./broker-port.ts";
import type {
  AjourCatalog,
  ReasonOf,
} from "../../../packages/wide-events/catalog.ts";
import type { ApiEvents } from "./events.ts";
import {
  findExecutable,
  resolveLoginShellPath,
} from "./agent-runner/cli-path.ts";
import { resolveSpawn } from "./process-spawn/index.ts";

const requestSchema = z
  .object({
    command: z.string().max(80),
    args: z
      .record(z.union([z.string().max(32767), z.number().finite()]))
      .refine((v) => Object.keys(v).length <= 100),
    stdin: z
      .string()
      .max(1024 * 1024)
      .optional(),
  })
  .strict();
export type ProcessReason =
  | "rate_limit"
  | "invalid_request"
  | "plugin_off"
  | "needs_consent"
  | "unsigned_processes_off"
  | "process_acceptance_required"
  | "package_unverified"
  | "ask_queue_full"
  | "user_denied"
  | "no_window"
  | "ask_timeout"
  | "undeclared"
  | "folder_refused"
  | "connection_refused"
  | "executable_missing"
  | "spawn_refused"
  | "concurrency"
  | "capture_incomplete"
  | "output_limit"
  | "timeout"
  | "operation_ended"
  | "spawn_failed";
export class ProcessBrokerError extends Error {
  override readonly name = "AjourProcessError";
  readonly reason: ProcessReason;
  constructor(reason: ProcessReason, message?: string) {
    super(message ?? `Process request refused: ${reason}.`);
    this.reason = reason;
  }
}
export interface ProcessBrokerOptions {
  folders: FolderResolver;
  review?: CommandReview;
  policy?(caller: BrokerCaller): Promise<CommandPolicy>;
  remember?(
    caller: BrokerCaller,
    command: UndeclaredCommand & { folderName?: string; folderPath?: string },
    policy: CommandPolicy,
  ): Promise<void>;
  ask?(
    ask: Omit<CommandAsk, "id" | "expiresAt">,
    signal: AbortSignal,
  ): Promise<{
    answer: "once" | "always" | "deny";
    reason?:
      | "no_window"
      | "ask_timeout"
      | "user_denied"
      | "operation_ended"
      | "ask_queue_full";
  }>;
  folderName?(id: string): Promise<string | undefined>;
  /**
   * The base address of the caller's connection (`caller.connectionId`),
   * as the credential broker would reach it, for a `connection-url`
   * argument. Undefined, or a throw, refuses the argument.
   */
  connectionAddress?(caller: BrokerCaller): Promise<string | undefined>;
  terminal?: () => Promise<TerminalApp>;
  openExternal?: (url: string, declaredSchemes: string[]) => Promise<void>;
  enabledGate?: ProcessBrokerOptions["gate"];

  gate(
    caller: BrokerCaller,
  ): Promise<
    | "plugin_off"
    | "needs_consent"
    | "unsigned_processes_off"
    | "process_acceptance_required"
    | "package_unverified"
    | undefined
  >;
  executableOverride?(
    pluginId: string,
    executable: string,
  ): Promise<string | undefined>;
  record?(
    pluginId: string,
    at: number,
    refused: boolean,
    started: boolean,
  ): void | Promise<void>;
  events?: ApiEvents;
}
/**
 * The operations whose commands may receive their connection's address:
 * a handoff's, and opening one of its threads.
 */
const CONNECTION_URL_METHODS = new Set([
  "detectTools",
  "startHandoff",
  "readHandoffStates",
  "openHandoff",
]);
const refuse = (reason: ProcessReason): never => {
  throw new ProcessBrokerError(reason);
};
export class ProcessBroker implements ProcessBrokerPort {
  private stopping = false;
  private readonly opens = new Map<string, number[]>();
  private readonly runs = new Map<Promise<ProcessRunResult>, AbortController>();
  private readonly records = new Set<Promise<void>>();
  async shutdown(): Promise<void> {
    this.stopping = true;
    for (const controller of this.runs.values()) controller.abort();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        (async () => {
          await Promise.allSettled([...this.runs.keys()]);
          await Promise.allSettled([...this.records]);
        })(),
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, 3000);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
  private readonly active = new Map<string, number>();
  private readonly options: ProcessBrokerOptions;
  constructor(options: ProcessBrokerOptions) {
    this.options = options;
  }
  forOperation(caller: BrokerCaller) {
    const ended = new AbortController();
    let waiting = 0;
    let listener: ((waiting: boolean) => void) | undefined;
    const wait = (value: boolean) => {
      waiting += value ? 1 : -1;
      listener?.(waiting > 0);
    };
    return {
      onWaiting: (next: (waiting: boolean) => void) => {
        listener = next;
        listener(waiting > 0);
      },
      run: (request: ProcessRunRequest) => {
        const controller = new AbortController();
        const abort = () => controller.abort();
        ended.signal.addEventListener("abort", abort, { once: true });
        if (ended.signal.aborted || this.stopping) controller.abort();
        const task = this.run(caller, request, controller.signal, wait);
        this.runs.set(task, controller);
        const cleanup = () => {
          this.runs.delete(task);
          ended.signal.removeEventListener("abort", abort);
        };
        void task.then(cleanup, cleanup);
        return task;
      },
      open: (url: string) => this.open(caller, url, ended.signal),
      close: () => ended.abort(),
    };
  }
  private async open(
    caller: BrokerCaller,
    given: string,
    signal: AbortSignal,
  ): Promise<void> {
    const unit = this.options.events?.start("plugin.open", {
      kind: "job",
      trigger: "system",
      detached: true,
      ...(caller.traceparent ? { traceparent: caller.traceparent } : {}),
    });
    unit?.set({ plugin: { id: caller.pluginId } });
    let reason: ReasonOf<AjourCatalog, "plugin.open"> | undefined;
    try {
      if (signal.aborted || this.stopping) return refuse("operation_ended");
      const enabled = await (this.options.enabledGate ?? this.options.gate)(
        caller,
      );
      if (enabled) return refuse(enabled);
      if (
        typeof given !== "string" ||
        given.length > 32767 ||
        /[\x00-\x20\x7f]/.test(given)
      )
        return refuse("invalid_request");
      let url: URL;
      try {
        url = new URL(given);
      } catch {
        return refuse("invalid_request");
      }
      const scheme = url.protocol.slice(0, -1);
      if (scheme !== "https") {
        const declared = caller.manifest.processes?.openSchemes ?? [];
        if (
          !declared.includes(scheme) ||
          !pluginProcessesSchema.safeParse({ openSchemes: [scheme] }).success
        )
          return refuse("undeclared");
        const gate = await this.options.gate(caller);
        if (gate) return refuse(gate);
      }
      unit?.set({ open: { scheme }, plugin: { id: caller.pluginId } });
      if (!this.options.openExternal) return refuse("spawn_refused");
      if (url.username || url.password) return refuse("invalid_request");
      if (signal.aborted || this.stopping) return refuse("operation_ended");
      const now = Date.now();
      const recent = (this.opens.get(caller.pluginId) ?? []).filter(
        (at) => now - at < 60_000,
      );
      if (recent.length >= 5)
        throw new ProcessBrokerError(
          "rate_limit",
          "A plugin can open at most 5 links per minute.",
        );
      this.opens.set(caller.pluginId, [...recent, now]);
      await this.options.openExternal(
        url.href,
        caller.manifest.processes?.openSchemes ?? [],
      );
    } catch (error) {
      reason =
        error instanceof ProcessBrokerError &&
        [
          "rate_limit",
          "invalid_request",
          "plugin_off",
          "needs_consent",
          "unsigned_processes_off",
          "process_acceptance_required",
          "package_unverified",
          "undeclared",
          "spawn_refused",
          "operation_ended",
        ].includes(error.reason)
          ? (error.reason as ReasonOf<AjourCatalog, "plugin.open">)
          : "spawn_failed";
      throw new ProcessBrokerError(
        reason as ProcessReason,
        error instanceof ProcessBrokerError ? error.message : undefined,
      );
    } finally {
      unit?.end(reason ? "refused" : "ok", reason);
    }
  }
  private async argument(
    arg: DeclaredArgument,
    values: Readonly<Record<string, string | number>>,
    caller: BrokerCaller,
  ) {
    if (arg.kind === "literal") return arg.value;
    if (arg.kind === "connection-url") return this.connectionUrl(caller);
    const projectId = caller.projectId;
    const raw = values[arg.name];
    if (typeof raw !== "string" && typeof raw !== "number")
      return refuse("invalid_request");
    if (arg.kind !== "number" && typeof raw !== "string")
      return refuse("invalid_request");
    const value = String(raw);
    if (
      (!value && arg.kind !== "text") ||
      value.startsWith("-") ||
      /[\0\r\n]/.test(value)
    )
      return refuse("invalid_request");
    switch (arg.kind) {
      case "text":
        return value;
      case "id":
        if (!/^[A-Za-z0-9:._-]+$/.test(value)) return refuse("invalid_request");
        break;
      case "ref":
        if (!isValidHandoffBranch(value)) return refuse("invalid_request");
        break;
      case "number":
        if (
          !/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(value) ||
          !Number.isFinite(Number(value))
        )
          return refuse("invalid_request");
        break;
      case "enum":
        if (!arg.values.includes(value)) return refuse("invalid_request");
        break;
      case "https-url": {
        let url: URL;
        try {
          url = new URL(value);
        } catch {
          return refuse("invalid_request");
        }
        if (url.protocol !== "https:" || url.username || url.password)
          return refuse("invalid_request");
        return url.href;
      }
      case "folder": {
        try {
          const folder = await this.options.folders.resolve(value, projectId);
          if (!folder) return refuse("folder_refused");
          return folder;
        } catch {
          return refuse("folder_refused");
        }
      }
    }
    return value;
  }
  /**
   * The address a `connection-url` argument gets: the base address of the
   * connection the handoff operation runs through. The plugin never passes
   * it, and an operation without a connection has none.
   */
  private async connectionUrl(caller: BrokerCaller): Promise<string> {
    if (
      !caller.connectionId ||
      !CONNECTION_URL_METHODS.has(caller.method) ||
      !this.options.connectionAddress
    )
      return refuse("connection_refused");
    let address: string | undefined;
    try {
      address = await this.options.connectionAddress(caller);
    } catch {
      return refuse("connection_refused");
    }
    if (!address || address.startsWith("-") || /[\0\r\n]/.test(address))
      return refuse("connection_refused");
    return address;
  }
  private async run(
    caller: BrokerCaller,
    given: ProcessRunRequest,
    signal: AbortSignal,
    waiting: (value: boolean) => void,
  ): Promise<ProcessRunResult> {
    const unit = this.options.events?.start("plugin.process", {
      kind: "job",
      trigger: "system",
      detached: true,
      ...(caller.traceparent ? { traceparent: caller.traceparent } : {}),
    });
    let reserved = false;
    let started = false;
    let reason: ProcessReason | undefined;
    let commandId = "undeclared";
    let mode: CommandMode | undefined;
    let decidedBy:
      | "gate"
      | "rule"
      | "user"
      | "mode"
      | "remembered"
      | "ok"
      | "timeout"
      | "missing_executable"
      | "cancelled"
      | "spawn"
      | "policy" = "gate";
    let undeclared = false;
    let ruleId: string | undefined;
    try {
      if (signal.aborted) refuse("operation_ended");
      const gate = await this.options.gate(caller);
      if (gate) refuse(gate);
      let resolvedExecutable: string | undefined;
      let remember: (() => Promise<void>) | undefined;
      let command: import("../../../packages/shared/plugin-api-4.ts").DeclaredCommand;
      let argv: string[] = [];
      const literals: number[] = [];
      const addArgument = async (
        arg: DeclaredArgument,
        values: Readonly<Record<string, string | number>>,
      ) => {
        const value = await this.argument(arg, values, caller);
        if (arg.kind === "literal") literals.push(argv.length);
        argv.push(value);
        // Every mode works in its first repository folder: tools such as
        // Claude Code refuse to start in an untrusted folder like the root.
        if (arg.kind === "folder") cwd ??= value;
      };
      let cwd: string | undefined;
      let cwdFolder: string | undefined;
      let stdin = "";
      let names: readonly string[];
      if (
        typeof given === "object" &&
        given !== null &&
        "executable" in given
      ) {
        const parsed = undeclaredCommandSchema.safeParse(given);
        if (!parsed.success) refuse("invalid_request");
        const request = parsed.data!;
        undeclared = true;
        if (!caller.manifest.processes?.undeclaredCommands)
          refuse("undeclared");
        if ((this.active.get(caller.pluginId) ?? 0) >= 4) refuse("concurrency");
        cwd = osCwd();
        cwdFolder = request.cwdFolder;
        if (request.cwdFolder) {
          try {
            cwd =
              (await this.options.folders.resolve(
                request.cwdFolder,
                caller.projectId,
              )) ?? refuse("folder_refused");
          } catch {
            refuse("folder_refused");
          }
        }
        const folderName = request.cwdFolder
          ? ((await this.options.folderName?.(request.cwdFolder)) ??
            "Repository folder")
          : "System root";
        const userPath = await resolveLoginShellPath();
        resolvedExecutable =
          (await findExecutable(request.executable, userPath)) ?? undefined;
        if (!resolvedExecutable) refuse("executable_missing");
        const policy = (await this.options.policy?.(caller)) ?? {
          identity: "",
          signed: false,
          mode: "always-ask",
          approvals: [],
        };
        mode = policy.mode;
        const review = await (this.options.review ?? noCommandReview).review(
          request,
          { cwd: cwd!, projectId: caller.projectId },
        );
        ruleId = review.ruleId;
        if (policy.approvals.some((a) => sameCommand(a, request)))
          decidedBy = "remembered";
        else if (commandDecision(mode, review.verdict) === "ask") {
          decidedBy = review.verdict === "risky" ? "rule" : "mode";
          if ((this.active.get(caller.pluginId) ?? 0) >= 4)
            refuse("concurrency");
          waiting(true);
          let answer;
          try {
            answer = (await this.options.ask?.(
              {
                ...request,
                pluginId: caller.pluginId,
                pluginName: caller.manifest.displayName,
                folderName,
                folderPath: cwd,
                resolvedExecutable,
                signed: policy.signed,
                risky: review.verdict === "risky",
                reason: review.reason,
              },
              signal,
            )) ?? { answer: "deny" as const, reason: "no_window" as const };
          } finally {
            waiting(false);
          }
          decidedBy =
            answer.reason === "no_window" ||
            answer.reason === "operation_ended" ||
            answer.reason === "ask_queue_full"
              ? "gate"
              : answer.reason === "ask_timeout"
                ? "mode"
                : "user";
          if (answer.answer === "deny") refuse(answer.reason ?? "user_denied");
          const gate = await this.options.gate(caller);
          if (gate) {
            decidedBy = "gate";
            refuse(gate);
          }
          if (answer.answer === "always")
            remember = async () => {
              await this.options.remember?.(
                caller,
                { ...request, folderName, folderPath: cwd },
                policy,
              );
            };
        } else decidedBy = "mode";
        command = {
          id: "undeclared",
          executable: request.executable,
          args: [],
          mode: "capture",
          timeoutSeconds: 60,
        };
        argv = request.argv;
        names = [request.executable];
      } else {
        const parsed = requestSchema.safeParse(given);
        if (!parsed.success) return refuse("invalid_request");
        const request = parsed.data;
        const declared = caller.manifest.processes?.commands.find(
          (c) => c.id === request.command,
        );
        if (!declared) return refuse("undeclared");
        command = declared;
        commandId = command.id;
        unit?.set({ process: { mode: command.mode } });
        if (command.mode !== "capture" && request.stdin !== undefined)
          refuse("invalid_request");

        if (request.stdin !== undefined && command.stdin !== "text")
          return refuse("invalid_request");
        // The host fills a connection-url slot; the plugin never names it.
        const slots = command.args
          .flatMap((a) => ("if" in a ? a.args : [a]))
          .filter((a) => a.kind !== "literal" && a.kind !== "connection-url")
          .map((a) => (a as { name: string }).name);
        if (Object.keys(request.args).some((k) => !slots.includes(k)))
          return refuse("invalid_request");

        for (const group of command.args) {
          if ("if" in group) {
            if (!Object.hasOwn(request.args, group.if)) {
              if (
                group.args.some(
                  (a) =>
                    a.kind !== "literal" && Object.hasOwn(request.args, a.name),
                )
              )
                refuse("invalid_request");
              continue;
            }
            for (const arg of group.args) await addArgument(arg, request.args);
          } else await addArgument(group, request.args);
        }
        stdin = request.stdin ?? "";
        names =
          caller.manifest.processes!.executables[command.executable]!.names;
      }
      if (command.mode !== "capture" && !cwd) refuse("folder_refused");
      if ((this.active.get(caller.pluginId) ?? 0) >= 4)
        return refuse("concurrency");
      this.active.set(
        caller.pluginId,
        (this.active.get(caller.pluginId) ?? 0) + 1,
      );
      reserved = true;
      const userPath = await resolveLoginShellPath();
      const override = undeclared
        ? undefined
        : await this.options.executableOverride?.(
            caller.pluginId,
            command.executable,
          );
      let executable = resolvedExecutable ?? override;
      if (override && !path.isAbsolute(override))
        return refuse("spawn_refused");
      for (const name of names) {
        if (executable) break;
        executable = (await findExecutable(name, userPath)) ?? undefined;
      }
      if (!executable) return refuse("executable_missing");
      const env = Object.fromEntries(
        Object.entries({ ...process.env, PATH: userPath }).filter(
          ([key]) => !/^AJOUR_/i.test(key),
        ),
      );
      let plan = resolveSpawn(
        executable,
        argv,
        isGit(executable) ? gitEnvironment(env) : env,
      );
      // A shim such as scoop's `git.cmd` may lead to git.
      if (!("refused" in plan) && !isGit(executable) && isGit(plan.command))
        plan = resolveSpawn(executable, argv, gitEnvironment(env));
      if ("refused" in plan) return refuse("spawn_refused");
      if (signal.aborted) return refuse("operation_ended");
      if (cwdFolder) {
        try {
          cwd =
            (await this.options.folders.resolve(cwdFolder, caller.projectId)) ??
            refuse("folder_refused");
        } catch {
          refuse("folder_refused");
        }
      }
      cwd ??= osCwd();
      const finalGate = await this.options.gate(caller);
      if (finalGate) {
        decidedBy = "gate";
        return refuse(finalGate);
      }
      if (signal.aborted) return refuse("operation_ended");
      await remember?.();
      if (remember) {
        const gate = await this.options.gate(caller);
        if (gate) {
          decidedBy = "gate";
          refuse(gate);
        }
        if (signal.aborted) refuse("operation_ended");
      }
      if (command.mode !== "capture") {
        if (!cwd) return refuse("folder_refused");
        const terminal =
          command.mode === "terminal"
            ? ((await this.options.terminal?.()) ??
              (process.platform === "win32" ? "wt" : "Terminal"))
            : undefined;
        const lastGate = await this.options.gate(caller);
        if (lastGate) return refuse(lastGate);
        if (signal.aborted) return refuse("operation_ended");
        await launchProcess(plan, cwd, terminal, {
          literalArgIndices: literals.map(
            (index) => index + plan.args.length - argv.length,
          ),
          start: async (launch, folder, hidden) => {
            const gate = await this.options.gate(caller);
            if (gate) return refuse(gate);
            if (signal.aborted) return refuse("operation_ended");
            await startUnowned(launch, folder, hidden);
          },
        });
        started = true;
        return { started: true };
      }
      const result = await new Promise<ProcessRunResult>((resolve, reject) => {
        const child = spawn(plan.command, plan.args, {
          env: plan.env,
          shell: false,
          windowsHide: true,
          detached: process.platform !== "win32",
          cwd,
        });
        const buffers: { stdout: Buffer[]; stderr: Buffer[] } = {
          stdout: [],
          stderr: [],
        };
        const sizes = { stdout: 0, stderr: 0 };
        let exited = false;
        let exitCode: number | null = null;
        let settled = false;
        let grace: ReturnType<typeof setTimeout> | undefined;
        child.once("spawn", () => {
          started = true;
        });
        const finish = () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          clearTimeout(grace);
          signal.removeEventListener("abort", abort);
          if (failure) reject(failure);
          else
            resolve({
              exitCode,
              stdout: Buffer.concat(buffers.stdout).toString("utf8"),
              stderr: Buffer.concat(buffers.stderr).toString("utf8"),
            });
        };
        const drain = (ms = 2000) => {
          clearTimeout(grace);
          grace = setTimeout(() => {
            failure ??= new ProcessBrokerError("capture_incomplete");
            child.stdin.destroy();
            child.stdout.destroy();
            child.stderr.destroy();
            finish();
          }, ms);
        };
        let failure: ProcessBrokerError | undefined;
        const killChild = () => {
          if (exited) return;
          try {
            child.kill("SIGKILL");
          } catch {
            /* Settlement still drains the streams. */
          }
        };
        const stop = (why: ProcessReason) => {
          if (failure) return;
          failure = new ProcessBrokerError(why);
          try {
            if (!exited && child.pid !== undefined) {
              if (process.platform === "win32") {
                const killer = resolveSpawn(
                  path.join(
                    process.env.SystemRoot ?? "C:\\Windows",
                    "System32",
                    "taskkill.exe",
                  ),
                  ["/pid", String(child.pid), "/T", "/F"],
                  env,
                );
                if (!("refused" in killer))
                  execFile(
                    killer.command,
                    killer.args,
                    { env: killer.env, shell: false, windowsHide: true },
                    (error) => {
                      if (error && !exited) killChild();
                    },
                  );
                else if (!exited) killChild();
              } else {
                try {
                  process.kill(-child.pid, "SIGKILL");
                } catch {
                  killChild();
                }
              }
            }
          } catch {
            killChild();
          } finally {
            drain(1000);
          }
        };
        const abort = () => stop("operation_ended");
        signal.addEventListener("abort", abort, { once: true });
        const timer = setTimeout(
          () => stop("timeout"),
          (command.timeoutSeconds ?? 60) * 1000,
        );
        for (const stream of ["stdout", "stderr"] as const)
          child[stream].on("data", (chunk: Buffer) => {
            sizes[stream] += chunk.length;
            if (sizes[stream] > 1024 * 1024) stop("output_limit");
            else buffers[stream].push(chunk);
          });
        child.stdin.on("error", () => undefined);
        child.stdin.end(stdin);
        child.once("error", () => {
          failure ??= new ProcessBrokerError("spawn_failed");
          drain();
        });
        child.once("exit", (code) => {
          exited = true;
          exitCode = code;
          drain();
        });
        child.once("close", (code) => {
          exitCode = code;
          if (!child.stdout.readableEnded || !child.stderr.readableEnded)
            failure ??= new ProcessBrokerError("capture_incomplete");
          finish();
        });
        if (signal.aborted) abort();
      });
      unit?.set({
        process: {
          exit_code:
            ("exitCode" in result ? result.exitCode : undefined) ?? undefined,
        },
      });
      return result;
    } catch (error) {
      reason =
        error instanceof ProcessBrokerError
          ? error.reason
          : error instanceof ProcessLaunchRefused
            ? error.reason
            : "spawn_failed";
      throw new ProcessBrokerError(
        reason,
        error instanceof ProcessLaunchRefused ? error.message : undefined,
      );
    } finally {
      if (!undeclared) {
        decidedBy =
          reason === "plugin_off" || reason === "needs_consent"
            ? "gate"
            : reason === "timeout"
              ? "timeout"
              : reason === "executable_missing"
                ? "missing_executable"
                : reason === "operation_ended"
                  ? "cancelled"
                  : reason === "spawn_failed"
                    ? "spawn"
                    : reason
                      ? "policy"
                      : "ok";
      }
      if (reserved)
        this.active.set(
          caller.pluginId,
          (this.active.get(caller.pluginId) ?? 1) - 1,
        );
      unit?.set({
        plugin: { id: caller.pluginId },
        process: {
          command_id: commandId,
          ...(undeclared ? { mode } : {}),
          rule_id: ruleId,
          decided_by: decidedBy,
        },
      });
      unit?.end(
        reason === "timeout"
          ? "timeout"
          : reason === "operation_ended"
            ? "cancelled"
            : reason === "spawn_failed"
              ? "error"
              : reason
                ? "refused"
                : "ok",
        reason,
      );
      try {
        const recording = Promise.resolve(
          caller.manifest.processes
            ? this.options.record?.(
                caller.pluginId,
                Date.now(),
                reason !== undefined &&
                  !["timeout", "operation_ended", "spawn_failed"].includes(
                    reason,
                  ),
                started,
              )
            : undefined,
        ).catch(() => undefined);
        this.records.add(recording);
        void recording.then(() => this.records.delete(recording));
      } catch {
        /* Activity never changes the process result. */
      }
    }
  }
}
// Never inherit Ajour's installation or data directory as the child's working directory.
function osCwd() {
  return path.parse(process.execPath).root;
}

/** `git`, `git.exe`, or a path to either. */
function isGit(executable: string): boolean {
  return /^git(\.exe)?$/i.test(executable.split(/[\\/]/).pop() ?? "");
}

/**
 * The environment for a git child (ADR 0019). `safe.bareRepository=explicit`
 * keeps git from using a bare repository it finds by itself, such as one
 * committed inside the repository folder, whose configuration could run a
 * program (`core.fsmonitor`). It is appended after any `GIT_CONFIG_COUNT`
 * entries Ajour's own environment has, so it wins over them. A
 * `GIT_CONFIG_PARAMETERS` the user set in their own environment still
 * applies and can change it; plugins can't set the environment, so only the
 * user can. `GIT_OPTIONAL_LOCKS=0`
 * keeps read-only commands such as `git status` from writing the index.
 */
export function gitEnvironment(
  env: Readonly<Record<string, string | undefined>>,
): Record<string, string | undefined> {
  const result = { ...env };
  const key = (name: string) =>
    Object.keys(result).find((k) => k.toUpperCase() === name) ?? name;
  const countKey = key("GIT_CONFIG_COUNT");
  const given = result[countKey]?.trim() ?? "";
  const count = /^\d+$/.test(given) ? Number(given) : 0;
  result[countKey] = String(count + 1);
  result[key(`GIT_CONFIG_KEY_${count}`)] = "safe.bareRepository";
  result[key(`GIT_CONFIG_VALUE_${count}`)] = "explicit";
  result[key("GIT_OPTIONAL_LOCKS")] = "0";
  return result;
}
