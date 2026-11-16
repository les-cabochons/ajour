import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, expect, it, vi } from "vitest";
import { spawn, execFile } from "node:child_process";
import { pluginApi4ManifestSchema } from "../../../packages/shared/plugin-api-4.ts";
import { resolveSpawn } from "./process-spawn/index.ts";
import type { ProcessBrokerOptions } from "./process-broker.ts";
import { ProcessBroker } from "./process-broker.ts";
vi.mock("node:child_process", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:child_process")>()),
  spawn: vi.fn(),
  execFile: vi.fn(),
}));
vi.mock("./agent-runner/cli-path.ts", () => ({
  resolveLoginShellPath: async () => "",
  findExecutable: async () => undefined,
}));
vi.mock("./process-spawn/index.ts", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("./process-spawn/index.ts")>();
  return { ...actual, resolveSpawn: vi.fn(actual.resolveSpawn) };
});
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  vi.mocked(resolveSpawn).mockReset();
});
function setup(options: Partial<ProcessBrokerOptions> = {}) {
  vi.mocked(resolveSpawn).mockImplementation((command, args, env) => ({
    command,
    args: [...args],
    env,
  }));
  const child = Object.assign(new EventEmitter(), {
    pid: 123456,
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn(),
  });
  vi.mocked(spawn).mockReturnValue(
    child as unknown as ReturnType<typeof spawn>,
  );
  const manifest = pluginApi4ManifestSchema.parse({
    id: "lifecycle",
    version: "1.0.0",
    apiVersion: 4,
    displayName: "Lifecycle",
    iconSvg: "<svg/>",
    entrypoint: "index.js",
    capabilities: { connector: {} },
    connectionFields: [{ id: "label", label: "Label", type: "text" }],
    processes: {
      executables: { node: { names: ["node"] } },
      commands: [
        {
          id: "run",
          executable: "node",
          args: [],
          mode: "capture",
          timeoutSeconds: 1,
        },
      ],
    },
  });
  const broker = new ProcessBroker({
    folders: { resolve: async () => undefined },
    gate: async () => undefined,
    executableOverride: async () => process.execPath,
    ...options,
  });
  return {
    child,
    broker,
    op: broker.forOperation({
      pluginId: manifest.id,
      manifest,
      method: "syncConnection",
    }),
  };
}
it("Given timeout after parent exit, never kills the exited PID and releases the slot", async () => {
  const { child, op } = setup();
  vi.useFakeTimers();
  const pending = op.run({ command: "run", args: {} }).catch((e) => e);
  await vi.waitFor(() => expect(spawn).toHaveBeenCalled());
  child.emit("spawn");
  await vi.advanceTimersByTimeAsync(900);
  child.emit("exit", 0);
  await vi.advanceTimersByTimeAsync(1100);
  expect(await pending).toMatchObject({ reason: "timeout" });
  expect(child.kill).not.toHaveBeenCalled();
  expect(vi.mocked(execFile).mock.calls.length).toBe(0);
  expect(child.stdout.destroyed).toBe(true);
});
it.skipIf(process.platform !== "win32")(
  "Given taskkill failure, falls back to child.kill and settles even without close",
  async () => {
    const { child, op } = setup();
    vi.mocked(execFile).mockImplementation((...args: unknown[]) => {
      const callback = args.at(-1) as (error: Error) => void;
      callback(new Error("taskkill failed"));
      return child as unknown as ReturnType<typeof execFile>;
    });
    const pending = op.run({ command: "run", args: {} }).catch((e) => e);
    await vi.waitFor(() => expect(spawn).toHaveBeenCalled());
    vi.useFakeTimers();
    child.emit("spawn");
    op.close();
    expect(execFile).toHaveBeenCalled();
    expect(child.kill).toHaveBeenCalledWith("SIGKILL");
    await vi.advanceTimersByTimeAsync(1100);
    expect(await pending).toMatchObject({ reason: "operation_ended" });
  },
);

it.skipIf(process.platform !== "win32")(
  "Given taskkill resolution refusal, falls back and settles without close",
  async () => {
    const { child, op } = setup();
    vi.mocked(resolveSpawn).mockImplementation((command, args, env) =>
      command.endsWith("taskkill.exe")
        ? { refused: "native_exe_required" }
        : { command, args: [...args], env },
    );
    const pending = op.run({ command: "run", args: {} }).catch((e) => e);
    await vi.waitFor(() => expect(spawn).toHaveBeenCalled());
    vi.useFakeTimers();
    child.emit("spawn");
    op.close();
    expect(child.kill).toHaveBeenCalledWith("SIGKILL");
    await vi.advanceTimersByTimeAsync(1100);
    expect(await pending).toMatchObject({ reason: "operation_ended" });
  },
);

it.each(["stdout", "stderr"] as const)(
  "Given %s data after exit, waits for both EOFs",
  async (stream) => {
    const { child, op } = setup();
    const pending = op.run({ command: "run", args: {} });
    await vi.waitFor(() => expect(spawn).toHaveBeenCalled());
    vi.useFakeTimers();
    child[stream].write("HEAD");
    child.emit("exit", 0);
    await vi.advanceTimersByTimeAsync(400);
    child[stream].write("TAIL");
    child.stdout.end();
    child.stderr.end();
    await vi.advanceTimersByTimeAsync(0);
    child.emit("close", 0);
    expect((await pending)[stream]).toBe("HEADTAIL");
  },
);
it("Given no EOF after exit, refuses incomplete capture within two seconds", async () => {
  const { child, op } = setup();
  const pending = op.run({ command: "run", args: {} }).catch((e) => e);
  await vi.waitFor(() => expect(spawn).toHaveBeenCalled());
  vi.useFakeTimers();
  child.emit("exit", 0);
  await vi.advanceTimersByTimeAsync(2000);
  expect(await pending).toMatchObject({ reason: "capture_incomplete" });
});

it("Given a running capture, shutdown waits for settlement and refuses later runs", async () => {
  const { child, op, broker } = setup();
  const pending = op.run({ command: "run", args: {} }).catch((e) => e);
  await vi.waitFor(() => expect(spawn).toHaveBeenCalled());
  vi.useFakeTimers();
  let stopped = false;
  const stopping = broker.shutdown().then(() => {
    stopped = true;
  });
  await vi.advanceTimersByTimeAsync(500);
  expect(stopped).toBe(false);
  await vi.advanceTimersByTimeAsync(600);
  await stopping;
  expect(await pending).toMatchObject({ reason: "operation_ended" });
  await expect(op.run({ command: "run", args: {} })).rejects.toMatchObject({
    reason: "operation_ended",
  });
  expect(child.stdout.destroyed).toBe(true);
});

it.each([false, true])(
  "Given an activity recorder still pending, shutdown waits within its bound, stuck=%s",
  async (stuck) => {
    let release!: () => void;
    const recording = new Promise<void>((r) => (release = r));
    const { child, op, broker } = setup({ record: () => recording });
    const running = op.run({ command: "run", args: {} });
    await vi.waitFor(() => expect(spawn).toHaveBeenCalled());
    child.stdout.end();
    child.stderr.end();
    await new Promise<void>((r) => setImmediate(r));
    child.emit("close", 0);
    await running;
    vi.useFakeTimers();
    let stopped = false;
    const stopping = broker.shutdown().then(() => {
      stopped = true;
    });
    await vi.advanceTimersByTimeAsync(200);
    expect(stopped).toBe(false);
    if (stuck) await vi.advanceTimersByTimeAsync(2800);
    else release();
    await stopping;
    expect(stopped).toBe(true);
    release();
  },
);
it("Given close without both EOFs, refuses incomplete capture", async () => {
  const { child, op } = setup();
  const running = op.run({ command: "run", args: {} }).catch((e) => e);
  await vi.waitFor(() => expect(spawn).toHaveBeenCalled());
  child.emit("close", 0);
  expect(await running).toMatchObject({ reason: "capture_incomplete" });
});
