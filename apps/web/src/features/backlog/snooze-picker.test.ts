import type { AjourEvent } from "@ajour/wide-events/catalog.ts";
import { createRecordingSink } from "@ajour/wide-events/sinks.ts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CommentSource } from "@/domain/backlog/comments";

/*
 * Comment and snooze (#487): the snooze's event takes the comment's length,
 * never its text, and the comment waits in the queue for the Undo toast.
 */

const mocks = vi.hoisted(() => ({
  source: undefined as CommentSource | undefined,
  offerUndo: vi.fn(),
}));

vi.mock("@/domain/backlog/comments", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/domain/backlog/comments")>()),
  commentSourceOf: () => mocks.source,
}));
vi.mock("@/features/feedback/undo-toast", () => ({
  offerUndo: mocks.offerUndo,
}));

function installMockWindow() {
  const storage = new Map<string, string>();
  vi.stubGlobal("window", {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    },
  });
}

async function load() {
  const sink = createRecordingSink<AjourEvent>();
  const events = await import("@/lib/wide-events");
  events.replaceEventSink(sink);
  const { localStore } = await import("@/lib/local-store");
  const { snoozeBacklogItem } = await import("./snooze-picker");
  const { settleCommentsOf } = await import("@/lib/settle-comments");
  return { sink, localStore, snoozeBacklogItem, settleCommentsOf };
}

const snoozeEvents = (events: AjourEvent[]) =>
  events.filter((event) => event.name === "backlog_item.snooze");

describe("a snooze with a comment", () => {
  const until = Date.parse("2026-11-03T09:00:00");

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    installMockWindow();
    mocks.source = {
      pluginId: "azure_devops",
      connectionId: "ado-1",
      sourceId: "source-canary-1",
      capability: {},
    };
  });

  it("records the comment's length, never its text, and queues it for the toast", async () => {
    const { sink, localStore, snoozeBacklogItem, settleCommentsOf } =
      await load();
    const itemId = localStore.addWorkItem({ title: "Hidden canary title" });

    const result = snoozeBacklogItem(itemId, until, " Back canary tomorrow ");

    expect(result).toEqual({ snoozed: true, commentQueued: true });
    expect(snoozeEvents(sink.events)).toMatchObject([
      {
        kind: "command",
        outcome: "ok",
        backlog_item: { id: itemId },
        comment: { queued: true, body_length: 20 },
      },
    ]);
    expect(JSON.stringify(sink.events)).not.toMatch(/canary/i);
    expect(settleCommentsOf(itemId)).toEqual([
      expect.objectContaining({
        body: "Back canary tomorrow",
        snoozedUntil: until,
        sourceId: "source-canary-1",
      }),
    ]);
    expect(mocks.offerUndo).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        title: expect.stringMatching(/^Commented and snoozed until /),
        onWindowClosed: expect.any(Function),
      }),
    );
  });

  it("snoozes without the comment when the item's comments went away", async () => {
    const { sink, localStore, snoozeBacklogItem, settleCommentsOf } =
      await load();
    const itemId = localStore.addWorkItem({ title: "Item" });
    mocks.source = undefined;

    const result = snoozeBacklogItem(itemId, until, "Back tomorrow");

    expect(result).toEqual({ snoozed: true, commentQueued: false });
    expect(snoozeEvents(sink.events)).toMatchObject([
      { outcome: "ok", comment: { queued: false } },
    ]);
    expect(snoozeEvents(sink.events)[0]).not.toHaveProperty(
      "comment.body_length",
    );
    expect(settleCommentsOf(itemId)).toEqual([]);
    expect(mocks.offerUndo).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        title: expect.stringMatching(/^Snoozed until /),
        onWindowClosed: undefined,
      }),
    );
  });
});
