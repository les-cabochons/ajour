import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BacklogImportCandidate } from "@ajour/shared";

/*
 * Priority changes on synced items write to the source (#471), through the
 * real picker action, store and write queue, against a fake local API. Only
 * the toasts are captured, so a test can press Undo or let the toast close.
 */

const toasts = vi.hoisted(() => ({
  undo: [] as { title: string; onUndo: () => void; onClose?: () => void }[],
  errors: [] as { title: string; description?: string }[],
}));
vi.mock("@/components/ui/toast", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/ui/toast")>()),
  showUndoToast: (toast: (typeof toasts.undo)[number]) =>
    void toasts.undo.push(toast),
  showErrorToast: (toast: (typeof toasts.errors)[number]) =>
    void toasts.errors.push(toast),
}));

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
  priority: "high",
  depth: 0,
  selectable: true,
  selected: true,
  childCount: 0,
  pushedAt: 1,
};

/**
 * The local API, as far as a settle write goes: it records each write, or
 * fails it, or refuses it because editing work items is off. While `gate`
 * waits, a write it received stays on its way.
 */
function fakeApi({ canWrite = true } = {}) {
  const api = {
    answer: "ok" as "ok" | "fail" | "editing-off",
    sent: [] as unknown[],
    received: 0,
    gate: undefined as Promise<void> | undefined,
  };
  const plugin = {
    id: "azure_devops",
    displayName: "Azure DevOps",
    version: "1.1.0",
    apiVersion: 3,
    description: "Azure DevOps work items.",
    iconSvg: "<svg />",
    entrypoint: "plugin.mjs",
    capabilities: { connector: { settle: canWrite } },
    connectionFields: [],
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init?: RequestInit) => {
      const route = new URL(input).pathname;
      if (route === "/api/plugins") {
        return Response.json({
          pluginsEnabled: true,
          plugins: [plugin],
          connectionGroups: [{ plugin, enabled: true, connections: [] }],
          totalPendingImportCount: 0,
          totalSelectedImportCount: 0,
        });
      }
      if (route.endsWith("/settle")) {
        api.received += 1;
        await api.gate;
        if (api.answer === "fail") {
          return Response.json(
            { error: "The priority field is read-only." },
            { status: 500 },
          );
        }
        if (api.answer === "editing-off") {
          return Response.json(
            {
              error: "Editing is off.",
              reason: "access_off",
              access: "editWorkItems",
            },
            { status: 403 },
          );
        }
        api.sent.push(JSON.parse(String(init?.body)));
        return Response.json({});
      }
      return Response.json({ error: `No route ${route}` }, { status: 404 });
    }),
  );
  return api;
}

/**
 * Starts Ajour on the fake API. `restart` starts it again on the state the
 * last run left, as a launch after a quit does.
 */
async function load({ restart = false } = {}) {
  const { localStore } = await import("@/lib/local-store");
  const { getPluginsOverview } = await import("@/lib/app-api");
  const { patchBacklogItemWithUndo } =
    await import("@/features/backlog/backlog-item-surface");
  const { sendPendingSourceWrites } =
    await import("@/features/backlog/backlog-source-writes");
  const { sendHeldEdit } = await import("@/features/backlog/held-edit-review");
  const { listHeldEdits } = await import("@/lib/held-edits");
  await getPluginsOverview();
  if (!restart) localStore.importSyncedWorkItems([candidate]);
  const item = () => localStore.snapshot().workItems[0]!;
  return {
    localStore,
    patchBacklogItemWithUndo,
    sendPendingSourceWrites,
    sendHeldEdit,
    listHeldEdits,
    item,
  };
}

/** A write the fake API receives waits until the returned call. */
function holdWritesOnTheirWay(api: ReturnType<typeof fakeApi>) {
  let release!: () => void;
  api.gate = new Promise((resolve) => (release = resolve));
  return () => {
    api.gate = undefined;
    release();
  };
}

/** The Undo toast's window ends: its time passes and it closes. */
function closeUndoToast() {
  vi.setSystemTime(Date.now() + 8_000);
  toasts.undo.at(-1)!.onClose?.();
}

describe("a synced item's priority change", () => {
  beforeEach(() => {
    storage.clear();
    toasts.undo.length = 0;
    toasts.errors.length = 0;
    vi.resetModules();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.parse("2026-10-30T09:00:00Z"));
    installWindow();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("sends the new level with no state once the Undo toast closes, and the next sync follows the source", async () => {
    const api = fakeApi();
    const { localStore, patchBacklogItemWithUndo, item } = await load();

    patchBacklogItemWithUndo(
      item(),
      { priority: 3 },
      "Priority changed to Medium",
    );
    expect(toasts.undo.map((toast) => toast.title)).toEqual([
      "Priority changed to Medium",
    ]);
    expect(api.sent).toEqual([]);
    closeUndoToast();

    await vi.waitFor(() =>
      expect(api.sent).toEqual([{ sourceId: "42", priority: "medium" }]),
    );
    await vi.waitFor(() => expect(item().pendingSourceWrite).toBeUndefined());
    localStore.importSyncedWorkItems([{ ...candidate, priority: "medium" }]);
    expect(item().priority).toBe(3);
    // Someone changes it in the source later: the item follows.
    localStore.importSyncedWorkItems([{ ...candidate, priority: "low" }]);
    expect(item().priority).toBe(4);
  });

  it("sends nothing when Undo is pressed before the toast closes", async () => {
    const api = fakeApi();
    const { patchBacklogItemWithUndo, item } = await load();

    patchBacklogItemWithUndo(
      item(),
      { priority: 3 },
      "Priority changed to Medium",
    );
    toasts.undo.at(-1)!.onUndo();
    closeUndoToast();
    await Promise.resolve();

    expect(item()).toMatchObject({ priority: 2, importedPriority: 2 });
    expect(item().pendingSourceWrite).toBeUndefined();
    expect(api.sent).toEqual([]);
  });

  it("puts the previous priority back when the write fails, with an error toast", async () => {
    const api = fakeApi();
    api.answer = "fail";
    const { patchBacklogItemWithUndo, item } = await load();

    patchBacklogItemWithUndo(
      item(),
      { priority: 3 },
      "Priority changed to Medium",
    );
    closeUndoToast();

    await vi.waitFor(() => expect(toasts.errors).toHaveLength(1));
    expect(item()).toMatchObject({
      status: "active",
      priority: 2,
      importedPriority: 2,
    });
    expect(item().pendingSourceWrite).toBeUndefined();
    expect(toasts.errors[0]).toMatchObject({
      title: 'Couldn\'t update "Ship the access group" in its source',
      description: expect.stringContaining("Its priority went back to High."),
    });
  });

  it("holds the write for Sync review while editing is off, with the item as the user left it", async () => {
    const api = fakeApi();
    api.answer = "editing-off";
    const { localStore, patchBacklogItemWithUndo, listHeldEdits, item } =
      await load();

    patchBacklogItemWithUndo(
      item(),
      { priority: 3 },
      "Priority changed to Medium",
    );
    closeUndoToast();

    await vi.waitFor(() =>
      expect(item().pendingSourceWrite?.heldAt).toBeDefined(),
    );
    expect(item()).toMatchObject({
      priority: 3,
      pendingSourceWrite: { state: undefined, priority: 3 },
    });
    expect(
      listHeldEdits(localStore.snapshot().workItems).map((edit) => edit.kind),
    ).toEqual(["settle"]);
    expect(api.sent).toEqual([]);
  });

  it("keeps a move made after a held priority held with it, until Sync review sends both", async () => {
    const api = fakeApi();
    api.answer = "editing-off";
    const {
      localStore,
      patchBacklogItemWithUndo,
      sendHeldEdit,
      listHeldEdits,
      item,
    } = await load();
    const heldEdits = () => listHeldEdits(localStore.snapshot().workItems);

    patchBacklogItemWithUndo(
      item(),
      { priority: 3 },
      "Priority changed to Medium",
    );
    closeUndoToast();
    await vi.waitFor(() => expect(heldEdits()).toHaveLength(1));

    // Turning editing on isn't approval, and the move doesn't approve it.
    api.answer = "ok";
    localStore.moveWorkItemToState(item()._id, "workflow_state_in_review", {
      sourceWrites: { [item()._id]: "Resolved" },
    });
    closeUndoToast();
    const { sendPendingSourceWrites } =
      await import("@/features/backlog/backlog-source-writes");
    await sendPendingSourceWrites([item()._id]);
    expect(api.sent).toEqual([]);
    expect(heldEdits().map((edit) => edit.kind)).toEqual(["settle"]);
    expect(item().pendingSourceWrite).toMatchObject({
      state: "Resolved",
      priority: 3,
    });

    await sendHeldEdit(heldEdits()[0]!);
    await vi.waitFor(() =>
      expect(api.sent).toEqual([
        { sourceId: "42", state: "Resolved", priority: "medium" },
      ]),
    );
    expect(heldEdits()).toEqual([]);
  });

  it("writes the source's level back when it is picked while the earlier level is on its way", async () => {
    const api = fakeApi();
    const { patchBacklogItemWithUndo, item } = await load();
    const release = holdWritesOnTheirWay(api);

    patchBacklogItemWithUndo(
      item(),
      { priority: 3 },
      "Priority changed to Medium",
    );
    closeUndoToast();
    await vi.waitFor(() => expect(api.received).toBe(1));
    patchBacklogItemWithUndo(
      item(),
      { priority: 2 },
      "Priority changed to High",
    );
    closeUndoToast();
    release();

    await vi.waitFor(() =>
      expect(api.sent).toEqual([
        { sourceId: "42", priority: "medium" },
        { sourceId: "42", priority: "high" },
      ]),
    );
    await vi.waitFor(() => expect(item().pendingSourceWrite).toBeUndefined());
    expect(item()).toMatchObject({ priority: 2, importedPriority: 2 });
  });

  it("writes the source's level back after a restart that left the earlier level on its way", async () => {
    const api = fakeApi();
    const first = await load();
    holdWritesOnTheirWay(api);
    first.patchBacklogItemWithUndo(
      first.item(),
      { priority: 3 },
      "Priority changed to Medium",
    );
    closeUndoToast();
    await vi.waitFor(() => expect(api.received).toBe(1));

    // Ajour quits before the answer, so the source may have Medium.
    vi.resetModules();
    api.gate = undefined;
    const { patchBacklogItemWithUndo, item } = await load({ restart: true });
    patchBacklogItemWithUndo(
      item(),
      { priority: 2 },
      "Priority changed to High",
    );
    closeUndoToast();

    await vi.waitFor(() =>
      expect(api.sent).toEqual([{ sourceId: "42", priority: "high" }]),
    );
    await vi.waitFor(() => expect(item().pendingSourceWrite).toBeUndefined());
    expect(item()).toMatchObject({ priority: 2, importedPriority: 2 });
  });

  it("writes nothing when a settle picks the source's level before the write goes", async () => {
    const api = fakeApi();
    const {
      localStore,
      patchBacklogItemWithUndo,
      sendPendingSourceWrites,
      item,
    } = await load();

    patchBacklogItemWithUndo(
      item(),
      { priority: 3 },
      "Priority changed to Medium",
    );
    localStore.settleWorkItem(item()._id, { priority: 2 });
    vi.setSystemTime(Date.now() + 8_000);
    await sendPendingSourceWrites([item()._id]);

    expect(api.sent).toEqual([]);
    expect(item()).toMatchObject({
      status: "settled",
      priority: 2,
      importedPriority: 2,
    });
    expect(item().pendingSourceWrite).toBeUndefined();
  });

  it("keeps the change in Ajour when the plugin can't write", async () => {
    const api = fakeApi({ canWrite: false });
    const { patchBacklogItemWithUndo, item } = await load();

    patchBacklogItemWithUndo(
      item(),
      { priority: 3 },
      "Priority changed to Medium",
    );
    closeUndoToast();
    await Promise.resolve();

    expect(item()).toMatchObject({ priority: 3, importedPriority: 2 });
    expect(item().pendingSourceWrite).toBeUndefined();
    expect(api.sent).toEqual([]);
  });

  it("refuses No priority while the source has a priority", async () => {
    fakeApi();
    const { patchBacklogItemWithUndo, item } = await load();

    patchBacklogItemWithUndo(
      item(),
      { priority: undefined },
      "Priority changed to No priority",
    );

    expect(item().priority).toBe(2);
    expect(toasts.undo).toEqual([]);
  });
});
