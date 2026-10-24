import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AjourEvent } from "@ajour/wide-events/catalog.ts";
import { createRecordingSink } from "@ajour/wide-events/sinks.ts";

/*
 * The launch flush and the queued sends it starts (#310), through the real
 * store and queues with a stubbed local API: the flush is one job, and each
 * send is its own job, a child span in the flush's trace. A source write
 * names the settle that caused it, and a comment delete Ajour's item.
 */

const CANARY = "Canary-7f3e";

const candidate = {
  id: "candidate-1",
  source: "azure_devops" as const,
  connectionId: "ado-1",
  connectionLabel: `${CANARY} connection`,
  tenantLabel: "Contoso",
  sourceId: `https://dev.azure.com/contoso/${CANARY}/101`,
  externalId: "101",
  title: `${CANARY} title`,
  workItemType: "Task",
  state: "Active",
  depth: 0 as const,
  selectable: true,
  selected: true,
  childCount: 0,
  pushedAt: 1,
};

function installWindow() {
  const values = new Map<string, string>();
  vi.stubGlobal("window", {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
    setTimeout,
    clearTimeout,
    localStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => void values.set(key, value),
      removeItem: (key: string) => void values.delete(key),
    },
  });
}

/** The local API's answers to each send, and the URLs it was sent to. */
function stubApi() {
  const fetch = vi.fn(async (url: string) => {
    if (url.endsWith("/postItemComment")) {
      return Response.json({
        comment: {
          id: "77",
          author: { id: "me", displayName: "Alex" },
          body: `${CANARY} body`,
          createdAt: "2026-10-18T10:00:00Z",
        },
      });
    }
    return Response.json({});
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(Date.parse("2026-10-18T10:00:00Z"));
  installWindow();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("the launch flush", () => {
  it("is one job, and each send it starts is a job of its own in its trace", async () => {
    const sink = createRecordingSink<AjourEvent>();
    (await import("@/lib/wide-events")).replaceEventSink(sink);
    const { localStore } = await import("@/lib/local-store");
    const { queueCommentDelete } = await import("@/lib/comment-deletes");
    const { queueSettleComment } = await import("@/lib/settle-comments");
    const { queueAgentComment } = await import("@/lib/agent-comments");
    const { flushPendingWrites } = await import("./pending-writes-flush");

    // A settle whose write and comment waited for its Undo window when the
    // last session quit, a deleted comment, and an agent's comment whose
    // item is gone.
    localStore.importSyncedWorkItems([candidate]);
    const itemId = localStore.snapshot().workItems[0]!._id;
    localStore.settleWorkItem(itemId, {
      state: { name: "Waiting", done: false },
    });
    const settleId = localStore.snapshot().workItems[0]!.settleId!;
    const comment = {
      itemId,
      pluginId: "azure_devops",
      connectionId: "ado-1",
      sourceId: candidate.sourceId,
    };
    queueSettleComment({
      ...comment,
      id: "settle-comment-1",
      settleId,
      body: `${CANARY} body`,
      at: Date.now(),
    });
    queueCommentDelete({
      ...comment,
      commentId: `${CANARY}-comment`,
      at: Date.now(),
    });
    queueAgentComment({
      ...comment,
      id: "agent-comment-1",
      itemId: "deleted-item",
      body: `${CANARY} body`,
      clientName: `${CANARY} agent`,
      at: Date.now(),
    });
    sink.events.length = 0;
    const fetch = stubApi();
    vi.setSystemTime(Date.now() + 60_000);

    await flushPendingWrites();
    await vi.waitFor(() => expect(sink.events).toHaveLength(5));

    const byName = (name: string) =>
      sink.events.find((event) => event.name === name)!;
    const flush = byName("pending_writes.flush");
    const write = byName("backlog.write_source");
    expect(flush).toMatchObject({
      kind: "job",
      trigger: "boot",
      outcome: "ok",
      flush: {
        source_write_count: 1,
        comment_delete_count: 1,
        settle_comment_count: 1,
        agent_comment_count: 1,
      },
    });
    expect(write).toMatchObject({
      kind: "job",
      trigger: "system",
      outcome: "ok",
      backlog_item: { id: itemId, settle_id: settleId },
      plugin: { id: "azure_devops" },
      connection: { id: "ado-1" },
      source_write: {
        state_sent: true,
        priority_sent: false,
        result: "sent",
        delay_ms: expect.any(Number),
      },
      steps: ["backlog_item.complete_source_write"],
      counts: expect.objectContaining({ api_call_count: 1 }),
    });
    expect(byName("comment.delete")).toMatchObject({
      kind: "job",
      outcome: "ok",
      backlog_item: { id: itemId },
      comment: { queued_ms: 60_000 },
    });
    expect(byName("agent_comment.send")).toMatchObject({
      outcome: "noop",
      comment: { result: "gone" },
    });
    // The settle's comment goes once its write landed: a child of the write.
    expect(byName("settle_comment.send")).toMatchObject({
      outcome: "ok",
      parent_span_id: write.span_id,
      backlog_item: { id: itemId, settle_id: settleId },
      comment: {
        body_length: `${CANARY} body`.length,
        for_agent: false,
        result: "posted",
      },
    });
    for (const event of sink.events) {
      expect(event.trace_id).toBe(flush.trace_id);
    }
    for (const name of [
      "backlog.write_source",
      "comment.delete",
      "agent_comment.send",
    ]) {
      expect(byName(name).parent_span_id, name).toBe(flush.span_id);
    }
    expect(fetch).toHaveBeenCalledTimes(3);
    // No title, body, source key or the comment's ID in its source.
    expect(JSON.stringify(sink.events)).not.toContain(CANARY);
  });

  it("ends as a noop on a launch that finds nothing to send", async () => {
    const sink = createRecordingSink<AjourEvent>();
    (await import("@/lib/wide-events")).replaceEventSink(sink);
    const fetch = stubApi();
    const { flushPendingWrites } = await import("./pending-writes-flush");

    await flushPendingWrites();

    expect(sink.events).toEqual([
      expect.objectContaining({
        name: "pending_writes.flush",
        kind: "job",
        outcome: "noop",
        flush: {
          source_write_count: 0,
          comment_delete_count: 0,
          settle_comment_count: 0,
          agent_comment_count: 0,
        },
      }),
    ]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("records a write still in its Undo window as deferred, and its failure when it goes", async () => {
    const sink = createRecordingSink<AjourEvent>();
    (await import("@/lib/wide-events")).replaceEventSink(sink);
    const { localStore } = await import("@/lib/local-store");
    const { sendPendingSourceWrites } =
      await import("@/features/backlog/backlog-source-writes");
    localStore.importSyncedWorkItems([candidate]);
    const itemId = localStore.snapshot().workItems[0]!._id;
    localStore.settleWorkItem(itemId, {
      state: { name: "Waiting", done: false },
    });
    sink.events.length = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ error: `${CANARY} refused` }, { status: 500 }),
      ),
    );

    await sendPendingSourceWrites([itemId]);
    vi.setSystemTime(Date.now() + 9_000);
    await sendPendingSourceWrites([itemId]);

    expect(sink.events).toEqual([
      expect.objectContaining({
        name: "backlog.write_source",
        outcome: "noop",
        source_write: expect.objectContaining({ result: "deferred" }),
      }),
      expect.objectContaining({
        name: "backlog.write_source",
        outcome: "error",
        source_write: expect.objectContaining({
          result: "failed",
          delay_ms: 1_000,
        }),
        error: { type: "Error" },
        steps: ["backlog_item.fail_source_write"],
      }),
    ]);
    expect(JSON.stringify(sink.events)).not.toContain(CANARY);
  });
});
