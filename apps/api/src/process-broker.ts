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
  | "invalid_request"
  | "plugin_off"
  | "needs_consent"
  | "undeclared"
  | "not_yet"
  | "folder_refused"
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
  constructor(reason: ProcessReason) {
    super(
      reason === "not_yet"
        ? "Detached and terminal commands are not yet supported."
        : `Process request refused: ${reason}.`,
    );
    this.reason = reason;
  }
}
export interface ProcessBrokerOptions {
  folders: FolderResolver;
  gate(
    caller: BrokerCaller,
  ): Promise<"plugin_off" | "needs_consent" | undefined>;
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
const refuse = (reason: ProcessReason): never => {
  throw new ProcessBrokerError(reason);
};
export class ProcessBroker implements ProcessBrokerPort {
  private stopping = false;
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
    return {
      run: (request: ProcessRunRequest) => {
        const controller = new AbortController();
        const abort = () => controller.abort();
        ended.signal.addEventListener("abort", abort, { once: true });
        if (ended.signal.aborted || this.stopping) controller.abort();
        const task = this.run(caller, request, controller.signal);
        this.runs.set(task, controller);
        const cleanup = () => {
          this.runs.delete(task);
          ended.signal.removeEventListener("abort", abort);
        };
        void task.then(cleanup, cleanup);
        return task;
      },
      close: () => ended.abort(),
    };
  }
  private async argument(
    arg: DeclaredArgument,
    values: ProcessRunRequest["args"],
    projectId?: string,
  ) {
    if (arg.kind === "literal") return arg.value;
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
        if (
          value === "@" ||
          value.endsWith(".") ||
          /[\x00-\x20\x7f~^:?*\[\\]|\.\.|@\{|\/\/|^\/|\/$/.test(value) ||
          value.split("/").some((p) => p.startsWith(".") || p.endsWith(".lock"))
        )
          return refuse("invalid_request");
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
  private async run(
    caller: BrokerCaller,
    given: ProcessRunRequest,
    signal: AbortSignal,
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
    try {
      if (signal.aborted) refuse("operation_ended");
      const gate = await this.options.gate(caller);
      if (gate) refuse(gate);
      const parsed = requestSchema.safeParse(given);
      if (!parsed.success) return refuse("invalid_request");
      const request = parsed.data;
      const command = caller.manifest.processes?.commands.find(
        (c) => c.id === request.command,
      );
      if (!command) return refuse("undeclared");
      commandId = command.id;
      if (command.mode !== "capture") return refuse("not_yet");
      if (request.stdin !== undefined && command.stdin !== "text")
        return refuse("invalid_request");
      const slots = command.args
        .flatMap((a) => ("if" in a ? a.args : [a]))
        .filter((a) => a.kind !== "literal")
        .map((a) => a.name);
      if (Object.keys(request.args).some((k) => !slots.includes(k)))
        return refuse("invalid_request");
      const argv: string[] = [];
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
          for (const arg of group.args)
            argv.push(await this.argument(arg, request.args, caller.projectId));
        } else
          argv.push(await this.argument(group, request.args, caller.projectId));
      }
      if ((this.active.get(caller.pluginId) ?? 0) >= 4)
        return refuse("concurrency");
      this.active.set(
        caller.pluginId,
        (this.active.get(caller.pluginId) ?? 0) + 1,
      );
      reserved = true;
      const userPath = await resolveLoginShellPath();
      const override = await this.options.executableOverride?.(
        caller.pluginId,
        command.executable,
      );
      let executable = override;
      if (override && !path.isAbsolute(override))
        return refuse("spawn_refused");
      for (const name of caller.manifest.processes!.executables[
        command.executable
      ]!.names) {
        if (executable) break;
        executable = (await findExecutable(name, userPath)) ?? undefined;
      }
      if (!executable) return refuse("executable_missing");
      const env = Object.fromEntries(
        Object.entries({ ...process.env, PATH: userPath }).filter(
          ([key]) => !/^AJOUR_/i.test(key),
        ),
      );
      const plan = resolveSpawn(executable, argv, env);
      if ("refused" in plan) return refuse("spawn_refused");
      if (signal.aborted) return refuse("operation_ended");
      const finalGate = await this.options.gate(caller);
      if (finalGate) return refuse(finalGate);
      if (signal.aborted) return refuse("operation_ended");
      const result = await new Promise<ProcessRunResult>((resolve, reject) => {
        const child = spawn(plan.command, plan.args, {
          env: plan.env,
          shell: false,
          windowsHide: true,
          detached: process.platform !== "win32",
          cwd: osCwd(),
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
        child.stdin.end(request.stdin ?? "");
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
      unit?.set({ process: { exit_code: result.exitCode ?? undefined } });
      return result;
    } catch (error) {
      reason =
        error instanceof ProcessBrokerError ? error.reason : "spawn_failed";
      throw new ProcessBrokerError(reason);
    } finally {
      if (reserved)
        this.active.set(
          caller.pluginId,
          (this.active.get(caller.pluginId) ?? 1) - 1,
        );
      unit?.set({
        plugin: { id: caller.pluginId },
        process: {
          command_id: commandId,
          decided_by:
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
                        : "ok",
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
          this.options.record?.(
            caller.pluginId,
            Date.now(),
            reason !== undefined &&
              !["timeout", "operation_ended", "spawn_failed"].includes(reason),
            started,
          ),
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
