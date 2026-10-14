import { beforeEach, describe, expect, it, vi } from "vitest";

const client = { id: "c1", name: "Claude Code" };

function installMockWindow() {
  const storage = new Map<string, string>();
  const createStorage = (target: Map<string, string>) => ({
    get length() {
      return target.size;
    },
    key: (index: number) => Array.from(target.keys())[index] ?? null,
    getItem: (key: string) => target.get(key) ?? null,
    setItem: (key: string, value: string) => void target.set(key, value),
    removeItem: (key: string) => void target.delete(key),
    clear: () => target.clear(),
  });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
      localStorage: createStorage(storage),
      sessionStorage: createStorage(new Map()),
    },
  });
}

/** Loads a fresh store and runner, and a project "Acme" with a task "Build". */
async function setup() {
  const { localStore } = await import("@/lib/local-store");
  const { runAgentToolCall } =
    await import("@/features/agents/agent-tool-runner");
  localStore.addProject({
    name: "Acme",
    color: "#123456",
    tasks: [{ name: "Build" }, { name: "Old", status: "archived" }],
  });
  const project = localStore
    .snapshot()
    .projects.find((candidate) => candidate.name === "Acme")!;
  const task = (name: string) =>
    project.tasks.find((candidate) => candidate.name === name)!;
  let next = 0;
  const call = (tool: string, input: unknown = {}) =>
    runAgentToolCall({ requestId: `r${(next += 1)}`, tool, input, client });
  return { localStore, call, project, task };
}

beforeEach(() => {
  vi.resetModules();
  installMockWindow();
});

describe("agent read tools", () => {
  it("lists projects through the runner", async () => {
    const { call } = await setup();
    const result = call("list_projects");
    expect(result.ok).toBe(true);
    expect(result.ok && result.output).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "Acme",
          tasks: [expect.objectContaining({ name: "Build" })],
        }),
      ]),
    );
  });

  it("refuses invalid input with the field and reason", async () => {
    const { call } = await setup();
    const result = call("list_time_entries", {
      from: "yesterday",
      to: "2026-10-14",
    });
    expect(result).toEqual({
      requestId: "r1",
      ok: false,
      error: "from: Use a date such as 2026-10-14.",
    });
  });

  it("refuses a tool Ajour does not have", async () => {
    const { call } = await setup();
    expect(call("delete_everything")).toMatchObject({
      ok: false,
      error: "Ajour has no tool named delete_everything.",
    });
  });
});
