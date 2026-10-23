import { webcrypto } from "node:crypto";
import type { AjourEvent } from "@ajour/wide-events/catalog.ts";
import { createRecordingSink } from "@ajour/wide-events/sinks.ts";
import { beforeEach, describe, expect, it, vi } from "vitest";

function installMockWindow() {
  const storage = new Map<string, string>();
  const createStorage = (target: Map<string, string>) => ({
    get length() {
      return target.size;
    },
    key: (index: number) => Array.from(target.keys())[index] ?? null,
    getItem: (key: string) => target.get(key) ?? null,
    setItem: (key: string, value: string) => {
      target.set(key, value);
    },
    removeItem: (key: string) => {
      target.delete(key);
    },
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

describe("the move's event", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal("crypto", webcrypto);
    installMockWindow();
  });

  async function setUp() {
    const sink = createRecordingSink<AjourEvent>();
    const { replaceEventSink } = await import("@/lib/wide-events");
    replaceEventSink(sink);
    const { localStore } = await import("@/lib/local-store");
    const { moveBacklogItem } = await import("./backlog-item-moves");
    const done = localStore.addWorkflowState("Shipped", "#16a34a");
    localStore.updateWorkflowState(done, { name: "Shipped", done: true });
    const parentId = localStore.addWorkItem({ title: "Parent" });
    localStore.addSubtask(parentId, { title: "Child" });
    const parent = localStore
      .snapshot()
      .workItems.find((item) => item._id === parentId)!;
    sink.events.length = 0;
    return { sink, moveBacklogItem, parent, done };
  }

  it("records a move cancelled in the subitem dialog as cancelled", async () => {
    const { sink, moveBacklogItem, parent, done } = await setUp();

    const result = await moveBacklogItem(parent, done, {
      includeSubitems: async () => null,
      chooseSourceState: async () => null,
    });

    expect(result).toEqual({ kind: "cancelled" });
    expect(sink.events).toMatchObject([
      {
        name: "backlog_item.move",
        kind: "command",
        outcome: "cancelled",
        backlog_item: {
          id: parent._id,
          workflow_state_to: done,
          result: "cancelled",
        },
      },
    ]);
  });

  it("records a move made after the dialogs on the same event", async () => {
    const { sink, moveBacklogItem, parent, done } = await setUp();

    await moveBacklogItem(parent, done, {
      includeSubitems: async () => true,
      chooseSourceState: async () => null,
    });

    expect(sink.events).toHaveLength(1);
    expect(sink.events[0]).toMatchObject({
      name: "backlog_item.move",
      outcome: "ok",
      backlog_item: {
        id: parent._id,
        closed: true,
        subitems_included: true,
        subitem_count: 1,
        result: "moved",
      },
      counts: { store_write_count: 1 },
    });
  });
});
