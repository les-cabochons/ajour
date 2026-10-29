import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BacklogImportCandidate, BacklogSyncResult } from "@ajour/shared";
import type { AjourEvent } from "@ajour/wide-events/catalog.ts";
import { createRecordingSink } from "@ajour/wide-events/sinks.ts";

/**
 * Comment returns through `syncBacklogConnection` itself, with sync answers
 * that arrive late and out of order.
 */

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

const candidate: BacklogImportCandidate = {
  id: "candidate-1",
  source: "azure_devops",
  connectionId: "c1",
  connectionLabel: "Work",
  tenantLabel: "Contoso",
  sourceId: "s1",
  externalId: "1",
  title: "Synced",
  workItemType: "Task",
  state: "Active",
  depth: 0,
  selectable: true,
  selected: true,
  childCount: 0,
  pushedAt: 1,
};

const me = { id: "me", displayName: "Alex" };

function answer(
  comment: { author: string; at: string },
  extra: Partial<BacklogSyncResult> = {},
): BacklogSyncResult {
  return {
    connection: {
      id: "c1",
      pluginId: "azure_devops",
      label: "Work",
      tenantLabel: "Contoso",
      autoSync: true,
      autoSyncIntervalMinutes: 15,
      connectedAt: 1,
      pendingImportCount: 0,
      selectedImportCount: 0,
      configSummary: {},
      editableValues: {},
    },
    mode: "review",
    items: [],
    stagedCount: 0,
    updatedCount: 0,
    skippedCount: 0,
    workItemUpdates: [],
    doneItems: [],
    heldEstimates: [],
    viewer: me,
    commentFacts: [
      {
        localWorkItemId: "item",
        comments: [
          {
            id: comment.author,
            author: { id: comment.author, displayName: comment.author },
            createdAt: comment.at,
          },
        ],
      },
    ],
    ...extra,
  };
}

function deferred() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function setup() {
  const { localStore } = await import("@/lib/local-store");
  const { syncBacklogConnection } = await import("@/lib/app-api");
  localStore.importSyncedWorkItems([candidate]);
  const itemId = localStore.snapshot().workItems[0]!._id;
  vi.setSystemTime(Date.parse("2026-10-18T10:00:00Z"));
  localStore.settleWorkItem(itemId);
  const item = () =>
    localStore
      .snapshot()
      .workItems.find((workItem) => workItem._id === itemId)!;
  // The answers name the item by its local id.
  const facts = (result: BacklogSyncResult): BacklogSyncResult => ({
    ...result,
    commentFacts: result.commentFacts.map((entry) => ({
      ...entry,
      localWorkItemId: itemId,
    })),
  });
  return { localStore, syncBacklogConnection, item, itemId, facts };
}

describe("comment returns through a sync", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers({ toFake: ["Date"] });
    installWindow();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("keeps the name a newer answer gave when an older one lands after it", async () => {
    const { syncBacklogConnection, item, facts } = await setup();
    const older = deferred();
    const newer = deferred();
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockReturnValueOnce(older.promise)
        .mockReturnValueOnce(newer.promise),
    );

    const first = syncBacklogConnection("azure_devops", "c1");
    const second = syncBacklogConnection("azure_devops", "c1");
    newer.resolve(
      Response.json(
        facts(answer({ author: "Ana", at: "2026-10-18T10:30:00Z" })),
      ),
    );
    await second;
    older.resolve(
      Response.json(
        facts(answer({ author: "Bob", at: "2026-10-18T10:10:00Z" })),
      ),
    );
    await first;

    expect(item()).toMatchObject({
      status: "active",
      returnedByComment: { author: "Ana" },
    });
  });

  it("leaves an item settled again during the request", async () => {
    const { localStore, syncBacklogConnection, item, itemId, facts } =
      await setup();
    const pending = deferred();
    vi.stubGlobal("fetch", vi.fn().mockReturnValueOnce(pending.promise));

    const sync = syncBacklogConnection("azure_devops", "c1");
    localStore.unsettleWorkItem(itemId);
    vi.setSystemTime(Date.parse("2026-10-18T11:00:00Z"));
    localStore.settleWorkItem(itemId);
    pending.resolve(
      Response.json(
        facts(answer({ author: "Ana", at: "2026-10-18T10:30:00Z" })),
      ),
    );
    await sync;

    expect(item()).toMatchObject({ status: "settled" });
    expect(item().returnedByComment).toBeUndefined();
  });

  it("archives an item the answer reports done, comment or not", async () => {
    const { syncBacklogConnection, item, facts } = await setup();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(
        Response.json(
          facts(
            answer(
              { author: "Ana", at: "2026-10-18T10:30:00Z" },
              {
                doneItems: [
                  {
                    source: "azure_devops",
                    connectionId: "c1",
                    sourceId: "s1",
                    state: "Done",
                  },
                ],
              },
            ),
          ),
        ),
      ),
    );

    await syncBacklogConnection("azure_devops", "c1");

    expect(item()).toMatchObject({ status: "archived" });
    expect(item().returnedByComment).toBeUndefined();
  });
});

describe("description conflicts a sync or a review import finds", () => {
  beforeEach(() => {
    vi.resetModules();
    installWindow();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function conflictedSetup() {
    const { localStore } = await import("@/lib/local-store");
    const api = await import("@/lib/app-api");
    const { subscribeDescriptionConflicts } =
      await import("@/lib/sync-conflict-events");
    localStore.importSyncedWorkItems([
      { ...candidate, description: { text: "Original" } },
    ]);
    const itemId = localStore.snapshot().workItems[0]!._id;
    localStore.updateWorkItemWithUndo(itemId, { description: "Mine" });
    const announced: string[][] = [];
    subscribeDescriptionConflicts((items) =>
      announced.push(items.map((item) => item._id)),
    );
    return { api, itemId, announced };
  }

  it("announces an item a sync puts in conflict, once", async () => {
    const { api, itemId, announced } = await conflictedSetup();
    const theirs = {
      ...answer({ author: "me", at: "2026-10-18T10:00:00Z" }),
      mode: "backlog" as const,
      items: [{ ...candidate, description: { text: "Theirs" } }],
      commentFacts: [],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(theirs)),
    );

    await api.syncBacklogConnection("azure_devops", "c1");
    await api.syncBacklogConnection("azure_devops", "c1");

    expect(announced).toEqual([[itemId]]);
  });

  it("announces an item a review import puts in conflict", async () => {
    const { api, itemId, announced } = await conflictedSetup();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          items: [{ ...candidate, description: { text: "Theirs" } }],
          committedCount: 1,
        }),
      ),
    );

    await api.commitSelectedBacklogImportsToLocalStore();

    expect(announced).toEqual([[itemId]]);
  });
});

describe("a backlog sync's event", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers({ toFake: ["Date"] });
    installWindow();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  async function recorded() {
    const sink = createRecordingSink<AjourEvent>();
    (await import("@/lib/wide-events")).replaceEventSink(sink);
    return sink.events;
  }

  it("is one backlog.sync job, with the answer's counts and the store commands that applied it", async () => {
    const events = await recorded();
    const { syncBacklogConnection, facts } = await setup();
    events.length = 0;
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          Response.json(
            facts(answer({ author: "Ana", at: "2026-10-18T10:30:00Z" })),
          ),
        ),
    );

    await syncBacklogConnection("azure_devops", "c1", { trigger: "auto" });

    expect(events).toEqual([
      expect.objectContaining({
        name: "backlog.sync",
        kind: "job",
        trigger: "schedule",
        outcome: "ok",
        plugin: { id: "azure_devops" },
        connection: { id: "c1" },
        backlog_sync: {
          trigger: "auto",
          items_sent: 1,
          mode: "review",
          staged_count: 0,
          updated_count: 0,
          skipped_count: 0,
          done_count: 0,
          work_item_update_count: 0,
          comment_fact_count: 1,
          imported_count: 0,
        },
        steps: expect.arrayContaining(["backlog_item.return"]),
        counts: expect.objectContaining({ api_call_count: 1 }),
      }),
    ]);
    expect(JSON.stringify(events)).not.toMatch(/Ana|Synced/);
  });

  it("is one failed job when the local API refuses it", async () => {
    const events = await recorded();
    const { syncBacklogConnection } = await setup();
    events.length = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ error: "Connection not found." }, { status: 404 }),
      ),
    );

    await expect(syncBacklogConnection("azure_devops", "c1")).rejects.toThrow();

    expect(events).toEqual([
      expect.objectContaining({
        name: "backlog.sync",
        trigger: "user",
        outcome: "error",
        backlog_sync: { trigger: "manual", items_sent: 1 },
        counts: expect.objectContaining({
          api_call_count: 1,
          api_failed_call_count: 1,
        }),
      }),
    ]);
  });
});

describe("backlog refresh status", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers({ toFake: ["Date"] });
    installWindow();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("publishes automatic sync progress and keeps the last success after a failed retry", async () => {
    const { syncBacklogConnection, facts } = await setup();
    const { getBacklogSyncSnapshot } =
      await import("@/lib/backlog-sync-status");
    const pending = deferred();
    vi.stubGlobal("fetch", vi.fn().mockReturnValueOnce(pending.promise));
    const run = syncBacklogConnection("azure_devops", "c1", {
      trigger: "auto",
    });
    expect(getBacklogSyncSnapshot()[0]).toMatchObject({
      running: 1,
      trigger: "auto",
    });
    pending.resolve(
      Response.json(
        facts(answer({ author: "Ana", at: "2026-10-18T10:30:00Z" })),
      ),
    );
    await run;
    const lastSuccessAt = Date.now();
    expect(getBacklogSyncSnapshot()[0]).toMatchObject({
      running: 0,
      lastSuccessAt,
    });
    vi.setSystemTime(lastSuccessAt + 60_000);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ error: "Offline" }, { status: 502 })),
    );
    await expect(
      syncBacklogConnection("azure_devops", "c1", { trigger: "auto" }),
    ).rejects.toThrow("Offline");
    expect(getBacklogSyncSnapshot()[0]).toMatchObject({
      running: 0,
      lastSuccessAt,
      failedAt: Date.now(),
    });
  });

  it("refreshes only the requested item and never archives another item missing from the answer", async () => {
    const { localStore, syncBacklogConnection, itemId } = await setup();
    localStore.importSyncedWorkItems([
      {
        ...candidate,
        id: "candidate-2",
        sourceId: "s2",
        title: "Leave this alone",
      },
    ]);
    const fetch = vi.fn(async (_url: string, _init?: RequestInit) =>
      Response.json(
        answer(
          { author: "Ana", at: "2026-10-18T10:30:00Z" },
          {
            mode: "backlog",
            items: [
              {
                ...candidate,
                title: "Updated from Azure",
                pushedAt: Date.now(),
              },
            ],
            commentFacts: [],
          },
        ),
      ),
    );
    vi.stubGlobal("fetch", fetch);
    await syncBacklogConnection("azure_devops", "c1", {
      refresh: true,
      sourceId: "s1",
    });
    const request = JSON.parse(fetch.mock.calls[0]![1]!.body as string);
    expect(request).toMatchObject({
      refresh: true,
      sourceId: "s1",
      workItems: [{ localWorkItemId: itemId }],
    });
    expect(request.workItems).toHaveLength(1);
    expect(
      localStore.snapshot().workItems.find((i) => i.sourceId === "s1")?.title,
    ).toBe("Updated from Azure");
    expect(
      localStore.snapshot().workItems.find((i) => i.sourceId === "s2"),
    ).toMatchObject({
      title: "Leave this alone",
      status: "active",
      sourceSyncedAt: 1,
    });
    vi.resetModules();
    const reloaded = (await import("@/lib/local-store")).localStore.snapshot();
    expect(
      reloaded.workItems.find((i) => i.sourceId === "s1")?.sourceSyncedAt,
    ).toBe(Date.now());
  });
});
