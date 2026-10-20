import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BacklogImportCandidate, BacklogSyncResult } from "@ajour/shared";

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
