import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The real toast module, offerUndo and runner. Only the toast manager is
 * watched: the app's provider turns its `close` into the toast closing, which
 * a test without React cannot see, so these tests read the manager's events.
 */
type ManagerEvent = { action: string; options: { id: string } };
const { managerEvents } = vi.hoisted(() => ({
  managerEvents: [] as ManagerEvent[],
}));
vi.mock("@base-ui/react/toast", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@base-ui/react/toast")>();
  return {
    ...original,
    Toast: {
      ...original.Toast,
      createToastManager: () => {
        const manager = original.Toast.createToastManager();
        manager[" subscribe"]((event) =>
          managerEvents.push(event as ManagerEvent),
        );
        return manager;
      },
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

/** The ids of the toasts the manager was told to add, and of those it was told to close. */
function toastIds(action: "add" | "close") {
  return managerEvents
    .filter((event) => event.action === action)
    .map((event) => event.options.id);
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
  managerEvents.length = 0;
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
    const [toastId] = toastIds("add");
    expect(toastId).toBeDefined();
    expect(toastIds("close")).toEqual([]);

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

    expect(toastIds("close")).toEqual([toastId]);
    // The token is spent: asking again is the expired refusal.
    expect(await run("undo", { undoToken })).toMatchObject({
      ok: false,
      error: "That change can't be undone any more.",
    });
  });
});
