import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The real offerUndo and runner, with the app's toast wrapper watched: each
 * Undo toast shown and each close of the open one is recorded, then passed
 * on to the real wrapper.
 */
const { toastCalls } = vi.hoisted(() => ({
  toastCalls: [] as ("shown" | "closed")[],
}));
vi.mock("@/components/ui/toast", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/components/ui/toast")>();
  return {
    ...original,
    showUndoToast: (...args: Parameters<typeof original.showUndoToast>) => {
      toastCalls.push("shown");
      return original.showUndoToast(...args);
    },
    closeUndoToast: () => {
      toastCalls.push("closed");
      return original.closeUndoToast();
    },
  };
});

const client = { id: "c1", name: "Claude Code" };

function installMockWindow() {
  const createStorage = () => {
    const target = new Map<string, string>();
    return {
      get length() {
        return target.size;
      },
      key: (index: number) => Array.from(target.keys())[index] ?? null,
      getItem: (key: string) => target.get(key) ?? null,
      setItem: (key: string, value: string) => void target.set(key, value),
      removeItem: (key: string) => void target.delete(key),
      clear: () => target.clear(),
    };
  };
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
      localStorage: createStorage(),
      sessionStorage: createStorage(),
    },
  });
}

// The first import of these heavy modules is slow: pay for it before any test
// starts, as agent-tool-runner.test.ts does. Each test still gets a fresh copy.
beforeAll(async () => {
  installMockWindow();
  await import("@/lib/local-store");
  await import("@/features/agents/agent-tool-runner");
}, 60_000);

beforeEach(() => {
  vi.resetModules();
  installMockWindow();
  toastCalls.length = 0;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 15, 15));
});

describe("the toast of an agent write the undo tool refuses", () => {
  it("closes when the record changed since, so its Undo button is not left on a spent token", async () => {
    const { localStore } = await import("@/lib/local-store");
    const { runAgentToolCall } =
      await import("@/features/agents/agent-tool-runner");
    localStore.addProject({
      name: "Acme",
      color: "#123456",
      tasks: [{ name: "Build" }],
    });
    const project = localStore
      .snapshot()
      .projects.find((candidate) => candidate.name === "Acme")!;
    const task = project.tasks[0]!;
    localStore.saveManualTimeEntry({
      localDate: "2026-10-13",
      projectId: project._id,
      taskId: task._id,
      durationMs: 30 * 60_000,
    });
    const entry = localStore.snapshot().timesheetEntries[0]!;
    const run = (tool: string, input: unknown) =>
      runAgentToolCall({ requestId: "r", tool, input, client });

    const edited = (await run("edit_entry", {
      entryId: entry._id,
      minutes: 45,
    })) as { output: { undoToken: string } };
    expect(toastCalls).toEqual(["shown"]);

    // The user edits the entry again, which keeps no Undo of its own.
    localStore.updateTimesheetEntry(entry._id, {
      projectId: project._id,
      taskId: task._id,
      durationMs: 60 * 60_000,
    });
    const { undoToken } = edited.output;
    expect(await run("undo", { undoToken })).toMatchObject({
      ok: false,
      error: "Can't undo. The entry changed after that action.",
    });

    expect(toastCalls).toEqual(["shown", "closed"]);
    // The token is spent: asking again is the expired refusal.
    expect(await run("undo", { undoToken })).toMatchObject({
      ok: false,
      error: "That change can't be undone any more.",
    });
  });
});
