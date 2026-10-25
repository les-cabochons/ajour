import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  connectionAccessOn,
  holdEstimatePushes,
  withoutHeldEstimateUpdates,
} from "@ajour/shared/connection-access";
import type { AjourEvent } from "@ajour/wide-events/catalog.ts";
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
    operations: [
      "writeSettle",
      "writeDescription",
      "postItemComment",
      "editItemComment",
      "deleteItemComment",
      "pushEstimates",
    ],
  },
];

const PLUGIN = {
  id: "azure_devops",
  displayName: "Azure DevOps",
  version: "1.1.0",
  apiVersion: 3,
  description: "Azure DevOps work items.",
  iconSvg: "<svg />",
  entrypoint: "plugin.mjs",
  capabilities: {
    connector: {
      settle: true,
      comments: { edit: true, delete: true },
    },
  },
  connectionFields: [],
};

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
    remoteDescription: "Source text",
    sent: [] as { route: string; body: unknown }[],
    /** What Ajour's connection form saved. */
    saves: [] as { access?: string[] }[],
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
  const overview = () => ({
    pluginsEnabled: true,
    plugins: [PLUGIN],
    connectionGroups: [
      {
        plugin: PLUGIN,
        enabled: true,
        connectionAccess: CHOICES,
        connections: [connection()],
      },
    ],
    totalPendingImportCount: 0,
    totalSelectedImportCount: 0,
  });
  const comment = (body: string) => ({
    comment: {
      id: "c1",
      author: { id: "me", displayName: "Me" },
      body,
      createdAt: "2026-10-25T10:00:00Z",
    },
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init?: RequestInit) => {
      const route = new URL(input).pathname;
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      if (route === "/api/plugins" && !init?.method) {
        return json(200, overview());
      }
      // Ajour's form saves the access, as the local API does.
      if (route === "/api/plugins/azure_devops/connections") {
        api.saves.push(body);
        if (Array.isArray(body.access)) {
          api.editing = body.access.includes("editWorkItems");
        }
        return json(200, { overview: overview(), connection: connection() });
      }
      if (route.endsWith("/editItemComment")) {
        if (!api.editing) return refusal();
        api.sent.push({ route: "commentEdit", body });
        return json(200, comment(body.body));
      }
      if (route.endsWith("/deleteItemComment")) {
        if (!api.editing) return refusal();
        api.sent.push({ route: "commentDelete", body });
        return json(200, {});
      }
      if (route.endsWith("/description")) {
        return json(200, { description: { text: api.remoteDescription } });
      }
      if (route.endsWith("/description-write")) {
        if (!api.editing) return refusal();
        api.sent.push({ route: "description", body });
        api.remoteDescription = body.text;
        return json(200, {
          outcome: "written",
          description: { text: body.text },
        });
      }
      if (route.endsWith("/settle")) {
        if (!api.editing) return refusal();
        api.sent.push({ route: "settle", body });
        return json(200, { state: body.state });
      }
      if (route.endsWith("/postItemComment")) {
        if (!api.editing) return refusal();
        api.sent.push({ route: "comment", body });
        return json(200, comment(body.body));
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
  // The connection form's save, through the Settings workflow the page uses.
  const { appPluginSettingsDependencies } =
    await import("@/features/settings/use-plugin-settings-workflow");
  const { createPluginSettingsWorkflow } =
    await import("@/features/settings/plugin-settings-workflow");
  const settings = createPluginSettingsWorkflow({
    ...appPluginSettingsDependencies(),
    subscribeCatalog: () => () => undefined,
  });
  const heldForReview: string[] = [];
  const saveForm = async (access: string[]) => {
    await settings.refresh();
    return settings.execute({
      type: "save",
      pluginId: "azure_devops",
      connectionId: "contoso",
      values: { label: "Contoso" },
      access,
      onHeldForReview: (connectionId) => heldForReview.push(connectionId),
    });
  };
  return {
    localStore,
    sendPendingSourceWrites,
    review,
    held,
    item,
    heldEdits,
    sync,
    saveForm,
    heldForReview,
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
      saveForm,
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

    // Editing turns on in the form: that is no approval, so nothing goes.
    await saveForm(["editWorkItems"]);
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

  it("holds an estimate no sync saw before the form's save turns editing on, sends nothing until review, and keeps every change when editing goes off again", async () => {
    const api = fakeApi();
    const {
      localStore,
      sendPendingSourceWrites,
      item,
      heldEdits,
      sync,
      saveForm,
      heldForReview,
    } = await load();
    localStore.importSyncedWorkItems([candidate]);
    const itemId = item()._id;
    // Edited while editing was off; no sync has run since.
    localStore.updateWorkItem(itemId, { remainingEstimateHours: 2 });
    localStore.settleWorkItem(itemId, {
      state: { name: "Waiting", done: false },
    });
    // Past the settle's Undo window.
    vi.setSystemTime(Date.parse("2026-10-25T09:01:00Z"));
    await sendPendingSourceWrites();
    expect(heldEdits().map((edit) => edit.kind)).toEqual(["settle"]);

    expect(await saveForm(["editWorkItems"])).toBe(true);

    expect(api.saves.at(-1)).toMatchObject({ access: ["editWorkItems"] });
    expect(
      heldEdits()
        .map((edit) => edit.kind)
        .sort(),
    ).toEqual(["estimate", "settle"]);
    // The page takes the user to Sync review on them.
    expect(heldForReview).toEqual(["contoso"]);
    await sendPendingSourceWrites();
    await sync();
    expect(api.sent).toEqual([]);

    // Editing goes off again: the changes stay held.
    expect(await saveForm([])).toBe(true);
    await sendPendingSourceWrites();
    await sync();

    expect(api.sent).toEqual([]);
    expect(heldEdits()).toHaveLength(2);
    expect(item()).toMatchObject({
      status: "settled",
      remainingEstimateHours: 2,
    });
  });

  it("holds a comment post, a comment edit, a comment delete and a description save the connection refuses, through their own paths", async () => {
    const api = fakeApi();
    const { localStore, item, heldEdits } = await load();
    localStore.importSyncedWorkItems([
      { ...candidate, description: { text: "Source text" } },
    ]);
    const itemId = item()._id;
    const thread = {
      pluginId: "azure_devops",
      connectionId: "contoso",
      sourceId: "42",
    };
    const { postThreadComment, saveThreadCommentEdit } =
      await import("@/features/backlog/comment-threads");
    const { queueCommentDelete, sendCommentDelete, pendingCommentDeleteIds } =
      await import("@/lib/comment-deletes");
    const { saveSyncedDescription } = await import("@/lib/description-save");

    expect(await postThreadComment(thread, itemId, "On it")).toBe("held");
    expect(
      await saveThreadCommentEdit(thread, itemId, "c7", "On it, today"),
    ).toBe("held");
    queueCommentDelete({ ...thread, commentId: "c8", itemId, at: 1 });
    expect(await sendCommentDelete({ ...thread, commentId: "c8" })).toBe(
      "held",
    );
    localStore.updateWorkItem(itemId, { description: "Mine" });
    expect(await saveSyncedDescription(itemId, "save")).toEqual({
      kind: "held",
    });

    expect(api.sent).toEqual([]);
    expect(
      heldEdits()
        .map((edit) => edit.kind)
        .sort(),
    ).toEqual(["comment", "commentDelete", "commentEdit", "description"]);
    // The deleted comment stays hidden, and the description as typed.
    expect(pendingCommentDeleteIds(thread)).toEqual(new Set(["c8"]));
    expect(item().description).toBe("Mine");
  });

  it("records sending and discarding a held description, and discarding a held settle, as reviews", async () => {
    fakeApi();
    const { createRecordingSink } = await import("@ajour/wide-events/sinks.ts");
    const sink = createRecordingSink<AjourEvent>();
    (await import("@/lib/wide-events")).replaceEventSink(sink);
    const { localStore, sendPendingSourceWrites, review, item, heldEdits } =
      await load();
    localStore.importSyncedWorkItems([
      { ...candidate, description: { text: "Source text" } },
    ]);
    const itemId = item()._id;
    localStore.settleWorkItem(itemId, {
      state: { name: "Waiting", done: false },
    });
    vi.setSystemTime(Date.parse("2026-10-25T09:01:00Z"));
    await sendPendingSourceWrites();
    localStore.updateWorkItem(itemId, { description: "Mine" });
    const { saveSyncedDescription } = await import("@/lib/description-save");
    await saveSyncedDescription(itemId, "save");
    sink.events.length = 0;

    const held = (kind: string) =>
      heldEdits().find((edit) => edit.kind === kind)!;
    await review.sendHeldEdit(held("description"));
    review.discardHeldEdit(held("description"));
    review.discardHeldEdit(held("settle"));

    const reviews = sink.events
      .filter((event) => event.name.startsWith("backlog_item."))
      .map((event) => [
        event.name,
        (event as { backlog_item?: Record<string, unknown> }).backlog_item
          ?.held_edit,
        (event as { backlog_item?: Record<string, unknown> }).backlog_item
          ?.held_decision,
      ]);
    expect(reviews).toEqual([
      ["backlog_item.review_held_edit", "description", "send"],
      // Still refused, so held again.
      ["backlog_item.hold_edit", "description", undefined],
      ["backlog_item.review_held_edit", "description", "discard"],
      ["backlog_item.review_held_edit", "settle", "discard"],
    ]);
    expect(heldEdits()).toEqual([]);
    expect(item()).toMatchObject({
      status: "active",
      description: "Source text",
    });
  });

  it("says why a held change can't go: its connection removed, paused or still not editing", async () => {
    fakeApi();
    const { review } = await load();
    const settle = {
      kind: "settle" as const,
      itemId: "i1",
      pluginId: "azure_devops",
      connectionId: "contoso",
      at: 1,
    };
    const group = (connection: Record<string, unknown>) => ({
      pluginsEnabled: true,
      plugins: [PLUGIN],
      connectionGroups: [
        {
          plugin: PLUGIN,
          enabled: true,
          connectionAccess: CHOICES,
          connections: [{ id: "contoso", label: "Contoso", ...connection }],
        },
      ],
      totalPendingImportCount: 0,
      totalSelectedImportCount: 0,
    });
    const blocker = (connection?: Record<string, unknown>) =>
      review.heldEditBlocker(
        settle,
        (connection
          ? group(connection)
          : { ...group({}), connectionGroups: [] }) as never,
      );

    expect(blocker()).toBe("removed");
    expect(
      blocker({
        access: ["readBacklog", "editWorkItems"],
        paused: { reason: "secret_rejected", message: "Rejected." },
      }),
    ).toBe("paused");
    expect(blocker({ access: ["readBacklog"] })).toBe("editingOff");
    expect(blocker({ access: ["readBacklog", "editWorkItems"] })).toBe(
      undefined,
    );
  });

  it("keeps a held comment until its post succeeds", async () => {
    const api = fakeApi();
    const { localStore, held, review, item, heldEdits } = await load();
    localStore.importSyncedWorkItems([candidate]);
    held.holdCommentEdit({
      kind: "comment",
      itemId: item()._id,
      pluginId: "azure_devops",
      connectionId: "contoso",
      sourceId: "42",
      body: "Waiting on the client",
    });
    const stored = () =>
      JSON.parse(storage.get(held.HELD_COMMENTS_STORAGE_KEY) ?? "[]");

    // Still refused: it stays held.
    await review.sendHeldEdit(heldEdits()[0]!);
    expect(stored()).toHaveLength(1);

    // While the post runs, Ajour could quit: the comment is still held.
    api.editing = true;
    const sending = review.sendHeldEdit(heldEdits()[0]!);
    expect(stored()).toHaveLength(1);
    await sending;

    expect(api.sent).toEqual([
      {
        route: "comment",
        body: { sourceId: "42", body: "Waiting on the client" },
      },
    ]);
    expect(stored()).toEqual([]);
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
