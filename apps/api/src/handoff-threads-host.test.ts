import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { PluginManager } from "./plugin-host.ts";
import type { BrokerCaller } from "./broker-port.ts";
import { InProcessPluginRuntime } from "./test-support/in-process-plugin-runtime.ts";

const tool = (id: string, listsThreads?: boolean) => ({
  id,
  label: id.toUpperCase(),
  iconSvg: "<svg/>",
  settings: [],
  ...(listsThreads === undefined ? {} : { listsThreads }),
});

/*
 * The plugin answers by the folder id: each names a shape of answer, so one
 * plugin covers the valid listing and each refusal.
 */
const PLUGIN = `
const thread = (n, extra = {}) => ({ threadId: 'thread-' + n, title: '[PAY-12] Thread ' + n, native: { status: 'idle' }, updatedAt: n, ...extra });
export async function listThreads(request) {
  await ajour.process.run({ command: 'list', args: { folder: request.folder.id } });
  switch (request.folder.id) {
    case 'many': return { threads: Array.from({ length: request.limit + 1 }, (_, n) => thread(n)) };
    case 'duplicate': return { threads: [thread(1), thread(1)] };
    case 'large': return { threads: [thread(1, { native: { payload: 'x'.repeat(4096) } })] };
    case 'untitled': return { threads: [thread(1, { title: '' })] };
    case 'array': return [thread(1)];
    default: return { threads: [
      thread(1, { link: 'https://example.test/thread-1', resume: { command: 'resume', args: { thread: 'thread-1' } } }),
      thread(2, { link: 'javascript:alert(1)', resume: { command: 'missing', args: {} } }),
      thread(3, { link: 'http://example.test/thread-3' }),
      thread(4, { link: 't3:thread-4' }),
      thread(5, { link: 'undeclared:thread-5' }),
    ] };
  }
}
`;

it("lists a tool's threads in a folder through its declared commands, bound to the project, and validates the answer", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "handoff-threads-host-"));
  const directory = path.join(root, "plugin");
  await mkdir(directory);
  await writeFile(
    path.join(directory, "plugin.json"),
    JSON.stringify({
      id: "handoff",
      version: "1.0.0",
      apiVersion: 4,
      displayName: "Tools",
      description: "Test",
      iconSvg: "<svg/>",
      entrypoint: "plugin.mjs",
      connectionFields: [],
      processes: {
        openSchemes: ["t3"],
        executables: { tool: { names: ["tool"] } },
        commands: [
          { id: "list", executable: "tool", args: [], mode: "capture" },
          { id: "resume", executable: "tool", args: [], mode: "terminal" },
        ],
      },
      capabilities: {
        handoff: { tools: [tool("t3", true), tool("claude")] },
      },
    }),
  );
  await writeFile(path.join(directory, "plugin.mjs"), PLUGIN);
  const callers: BrokerCaller[] = [];
  const manager = new PluginManager({
    runtime: new InProcessPluginRuntime(),
    installedPluginDirectory: path.join(root, "installed"),
    allowDevelopmentPlugins: true,
    developmentPluginDirectories: [directory],
    processBroker: {
      forOperation(caller) {
        callers.push(caller);
        return {
          async open() {},
          async run() {
            return { exitCode: 0, stdout: "", stderr: "" };
          },
          close() {},
        };
      },
    },
  });
  const list = (folder: string, toolId = "t3", limit = 50) =>
    manager.listThreads(
      "handoff",
      { tool: toolId, folder: { id: folder }, since: 0, limit },
      "p",
    );
  try {
    const { threads } = await list("f");
    // Links follow a state read's rules: https or a declared scheme, the
    // others dropped. A resume names a declared command or is dropped.
    expect(threads).toEqual([
      {
        threadId: "thread-1",
        title: "[PAY-12] Thread 1",
        native: { status: "idle" },
        updatedAt: 1,
        link: "https://example.test/thread-1",
        resume: { command: "resume", args: { thread: "thread-1" } },
      },
      {
        threadId: "thread-2",
        title: "[PAY-12] Thread 2",
        native: { status: "idle" },
        updatedAt: 2,
      },
      {
        threadId: "thread-3",
        title: "[PAY-12] Thread 3",
        native: { status: "idle" },
        updatedAt: 3,
      },
      {
        threadId: "thread-4",
        title: "[PAY-12] Thread 4",
        native: { status: "idle" },
        updatedAt: 4,
        link: "t3:thread-4",
      },
      {
        threadId: "thread-5",
        title: "[PAY-12] Thread 5",
        native: { status: "idle" },
        updatedAt: 5,
      },
    ]);
    expect(callers.map((c) => [c.method, c.projectId])).toEqual([
      ["listThreads", "p"],
    ]);
    await expect(list("many", "t3", 3)).rejects.toThrow(/at most 3/);
    await expect(list("duplicate")).rejects.toThrow(/once/);
    await expect(list("large")).rejects.toThrow(/4 KB/);
    await expect(list("untitled")).rejects.toThrow();
    await expect(list("array")).rejects.toThrow();
    // A tool that doesn't declare it lists no threads.
    await expect(list("f", "claude")).rejects.toMatchObject({
      reason: "not_supported",
    });
    await expect(list("f", "missing")).rejects.toThrow(/not available/);
  } finally {
    await manager.shutdown();
    await rm(root, { recursive: true, force: true });
  }
});
