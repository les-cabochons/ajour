import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  connectionAccessOn,
  holdEstimatePushes,
  withoutHeldEstimateUpdates,
} from "@ajour/shared/connection-access";
import type {
  BacklogImportCandidate,
  BacklogSyncRequest,
  BacklogSyncWorkItemUpdate,
} from "@ajour/shared";

/*
 * Held edits (#395) end to end in the web app: the real local store and
 * device queues, against a fake local API that holds a connection to its
 * access as the real one does. A write refused while editing is off is
 * held; turning editing on sends nothing; Sync review's Send goes through
 * the usual path and its conflict checks; and the held changes outlive a
 * restart.
 */

const storage = new Map<string, string>();

function installWindow() {
  vi.stubGlobal("window", {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
    setTimeout,
    clearTimeout,
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => void storage.set(key, value),
      removeItem: (key: string) => void storage.delete(key),
    },
  });
}

const candidate: BacklogImportCandidate = {
  id: "candidate-1",
  source: "azure_devops",
  connectionId: "contoso",
  connectionLabel: "Contoso",
  tenantLabel: "Entra",
  sourceId: "42",
  externalId: "42",
  title: "Ship the access group",
  workItemType: "Task",
  state: "Active",
  depth: 0,
  selectable: true,
  selected: true,
  childCount: 0,
  pushedAt: 1,
  remainingEstimateHours: 5,
};

const CHOICES = [
  {
    id: "readBacklog",
    label: "Read the backlog",
    always: true,
    operations: [],
  },
  {
    id: "editWorkItems",
    label: "Edit work items",
    always: false,
    operations: ["writeSettle", "postItemComment", "pushEstimates"],
  },
];

/**
 * The local API and its plugin, as far as these writes go: a write on a
 * connection that can't edit is refused before it reaches the source, and
 * a sync uploads only what the API lets through, deciding each estimate as
 * the Azure DevOps plugin does against the source's value.
 */
function fakeApi() {
  const api = {
    editing: false,
    remote: { remainingEstimateHours: 5 } as Record<string, number>,
    sent: [] as { route: string; body: unknown }[],
  };
  const json = (status: number, body: unknown) =>
    Response.json(body, { status });
  const refusal = () =>
    json(403, {
      error: "Editing is off.",
      reason: "access_off",
      access: "editWorkItems",
    });
  const connection = () => ({
    id: "contoso",
    pluginId: "azure_devops",
    label: "Contoso",
    tenantLabel: "Entra",
    autoSync: false,
    autoSyncIntervalMinutes: 15,
    connectedAt: 1,
    pendingImportCount: 0,
    selectedImportCount: 0,
    configSummary: {},
    editableValues: {},
    access: connectionAccessOn(CHOICES, api.editing ? ["editWorkItems"] : []),
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init?: RequestInit) => {
      const route = new URL(input).pathname;
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      if (route.endsWith("/settle")) {
        if (!api.editing) return refusal();
        api.sent.push({ route: "settle", body });
        return json(200, { state: body.state });
      }
      if (route.endsWith("/postItemComment")) {
        if (!api.editing) return refusal();
        api.sent.push({ route: "comment", body });
        return json(200, {
          comment: {
            id: "c1",
            author: { id: "me", displayName: "Me" },
            body: body.body,
            createdAt: "2026-10-25T10:00:00Z",
          },
        });
      }
      if (route.endsWith("/sync")) {
        const request = body as BacklogSyncRequest;
        const { workItems, held } = holdEstimatePushes(
          request.workItems,
          !api.editing,
        );
        const updates: BacklogSyncWorkItemUpdate[] = workItems.map((item) => {
          const field = "remainingEstimateHours" as const;
          const state = item.estimateSync?.[field];
          const local = item[field];
          const base = state?.baselineValue;
          const remote = api.remote[field];
          const localChanged =
            state?.resolution === "keep_local" || local !== base;
          if (localChanged && remote !== base && !state?.resolution) {
            return {
              localWorkItemId: item.localWorkItemId,
              sourceId: item.sourceId,
              fields: {
                [field]: {
                  status: "conflict",
                  localValue: local,
                  remoteValue: remote,
                  baselineValue: base,
                },
              },
            };
          }
          if (localChanged) {
            api.sent.push({ route: "estimate", body: { [field]: local } });
            api.remote[field] = local!;
            return {
              localWorkItemId: item.localWorkItemId,
              sourceId: item.sourceId,
              fields: {
                [field]: {
                  status: "pushed",
                  localValue: local,
                  baselineValue: base,
                  nextBaselineValue: local,
                },
              },
            };
          }
          return {
            localWorkItemId: item.localWorkItemId,
            sourceId: item.sourceId,
            fields: {
              [field]: {
                status: remote === base ? "noop" : "pulled",
                localValue: local,
                remoteValue: remote,
                baselineValue: base,
                nextBaselineValue: remote,
              },
            },
          };
        });
        return json(200, {
          connection: connection(),
          mode: "review",
          items: [],
          stagedCount: 0,
          updatedCount: 0,
          skippedCount: 0,
          workItemUpdates: withoutHeldEstimateUpdates(updates, held),
          doneItems: [],
          commentFacts: [],
          heldEstimates: held,
        });
      }
      return json(404, { error: `No route ${route}` });
    }),
  );
  return api;
}

async function load() {
  const { localStore } = await import("@/lib/local-store");
  const { syncBacklogConnection } = await import("@/lib/app-api");
  const { sendPendingSourceWrites } =
    await import("@/features/backlog/backlog-source-writes");
  const review = await import("@/features/backlog/held-edit-review");
  const held = await import("@/lib/held-edits");
  const item = () => localStore.snapshot().workItems[0]!;
  const heldEdits = () => held.listHeldEdits(localStore.snapshot().workItems);
  const sync = () =>
    syncBacklogConnection("azure_devops", "contoso", { trigger: "manual" });
  return {
    localStore,
    sendPendingSourceWrites,
    review,
    held,
    item,
    heldEdits,
    sync,
  };
}

describe("held edits", () => {
  beforeEach(() => {
    storage.clear();
    vi.resetModules();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.parse("2026-10-25T09:00:00Z"));
    installWindow();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("sends nothing when editing goes off then on, keeps the changes while the review is left, and sends one approved through its conflict check", async () => {
    const api = fakeApi();
    const {
      localStore,
      sendPendingSourceWrites,
      review,
      item,
      heldEdits,
      sync,
    } = await load();
    localStore.importSyncedWorkItems([candidate]);
    const itemId = item()._id;
    // Edits made while the connection reads only.
    localStore.updateWorkItem(itemId, { remainingEstimateHours: 2 });
    localStore.settleWorkItem(itemId, {
      state: { name: "Waiting", done: false },
    });
    vi.setSystemTime(Date.parse("2026-10-25T09:01:00Z"));
    await sendPendingSourceWrites();
    await sync();

    expect(api.sent).toEqual([]);
    expect(
      heldEdits()
        .map((edit) => edit.kind)
        .sort(),
    ).toEqual(["estimate", "settle"]);
    // The item stays as the user left it: settled, with its estimate.
    expect(item()).toMatchObject({
      status: "settled",
      remainingEstimateHours: 2,
    });

    // Editing turns on: that is no approval, so nothing goes.
    api.editing = true;
    localStore.holdPendingEstimates({
      pluginId: "azure_devops",
      connectionId: "contoso",
    });
    await sendPendingSourceWrites();
    await sync();
    // Leaving Sync review without a decision keeps them too.
    await sync();

    expect(api.sent).toEqual([]);
    expect(heldEdits()).toHaveLength(2);

    // Someone changed the estimate in the source meanwhile: sending it
    // finds the conflict instead of overwriting their value.
    api.remote.remainingEstimateHours = 7;
    const estimate = heldEdits().find((edit) => edit.kind === "estimate")!;
    await review.sendHeldEdit(estimate);
    const settle = heldEdits().find((edit) => edit.kind === "settle")!;
    await review.sendHeldEdit(settle);

    expect(api.sent).toEqual([
      { route: "settle", body: { sourceId: "42", state: "Waiting" } },
    ]);
    expect(item().estimateSync?.remainingEstimateHours?.conflict).toMatchObject(
      { localValue: 2, remoteValue: 7 },
    );
    expect(heldEdits()).toEqual([]);
  });

  it("holds a comment refused while editing is off, and keeps every held change across a restart", async () => {
    fakeApi();
    const first = await load();
    first.localStore.importSyncedWorkItems([candidate]);
    const itemId = first.item()._id;
    first.localStore.settleWorkItem(itemId, {
      state: { name: "Waiting", done: false },
    });
    vi.setSystemTime(Date.parse("2026-10-25T09:01:00Z"));
    await first.sendPendingSourceWrites();
    first.held.holdCommentEdit({
      kind: "comment",
      itemId,
      pluginId: "azure_devops",
      connectionId: "contoso",
      sourceId: "42",
      body: "Waiting on the client",
    });
    expect(first.heldEdits()).toHaveLength(2);

    // Ajour quits and starts again.
    vi.resetModules();
    const api = fakeApi();
    const next = await load();
    await next.sendPendingSourceWrites();

    expect(api.sent).toEqual([]);
    expect(
      next
        .heldEdits()
        .map((edit) => edit.kind)
        .sort(),
    ).toEqual(["comment", "settle"]);

    // Discarding the comment drops it; the settle waits on.
    const comment = next.heldEdits().find((edit) => edit.kind === "comment")!;
    next.review.discardHeldEdit(comment);
    expect(next.heldEdits().map((edit) => edit.kind)).toEqual(["settle"]);
  });
});
