import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  BacklogImportCandidate,
  BacklogWriteDescriptionRequest,
} from "@ajour/shared";

/**
 * Saving a synced description through `saveSyncedDescription`: the read, the
 * merge, the write and what each answer leaves on the item.
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

const BASE = "Goal\n\nSteps\n\nDone when";

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
  description: { text: BASE },
};

/** A source that answers reads with `text`, and writes as `write` says. */
function stubSource(
  text: string,
  write: (request: BacklogWriteDescriptionRequest) => Response = (request) =>
    Response.json({
      outcome: "written",
      description: { text: request.text },
    }),
) {
  const writes: BacklogWriteDescriptionRequest[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/description")) {
        return Response.json({ description: { text } });
      }
      const request = JSON.parse(String(init?.body));
      writes.push(request);
      return write(request);
    }),
  );
  return writes;
}

async function setup(local: string) {
  const { localStore } = await import("@/lib/local-store");
  const { saveSyncedDescription } = await import("@/lib/description-save");
  const { subscribeDescriptionConflicts } =
    await import("@/lib/sync-conflict-events");
  localStore.importSyncedWorkItems([candidate]);
  const itemId = localStore.snapshot().workItems[0]!._id;
  localStore.saveWorkItemEdits(itemId, { description: local });
  const item = () =>
    localStore
      .snapshot()
      .workItems.find((workItem) => workItem._id === itemId)!;
  const announced: string[] = [];
  subscribeDescriptionConflicts((items) =>
    announced.push(...items.map((entry) => entry._id)),
  );
  return {
    localStore,
    item,
    itemId,
    announced,
    save: (mode?: "save" | "keepMine") => saveSyncedDescription(itemId, mode),
  };
}

describe("saving a synced description", () => {
  beforeEach(() => {
    vi.resetModules();
    installWindow();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("writes the user's text when the source did not change", async () => {
    const mine = "Goal\n\nMy steps\n\nDone when";
    const { item, save } = await setup(mine);
    const writes = stubSource(BASE);

    expect(await save()).toEqual({ kind: "written", merged: false });
    expect(writes).toEqual([{ sourceId: "s1", text: mine, expected: BASE }]);
    expect(item()).toMatchObject({
      description: mine,
      descriptionSync: { baseline: mine, remote: mine },
    });
  });

  it("merges a source change to other lines, and shows the merged text", async () => {
    const { item, save } = await setup("Goal\n\nMy steps\n\nDone when");
    const theirs = "Their goal\n\nSteps\n\nDone when";
    const writes = stubSource(theirs);
    const merged = "Their goal\n\nMy steps\n\nDone when";

    expect(await save()).toEqual({ kind: "written", merged: true });
    expect(writes).toEqual([
      { sourceId: "s1", text: merged, expected: theirs },
    ]);
    expect(item().description).toBe(merged);
    expect(item().descriptionSync?.baseline).toBe(merged);
  });

  it("writes nothing on a change to the same lines, and records a conflict", async () => {
    const mine = "Goal\n\nMy steps\n\nDone when";
    const { item, itemId, announced, save } = await setup(mine);
    const theirs = "Goal\n\nTheir steps\n\nDone when";
    const writes = stubSource(theirs);

    expect(await save()).toEqual({ kind: "conflict" });
    expect(writes).toEqual([]);
    expect(item()).toMatchObject({
      description: mine,
      descriptionSync: {
        baseline: BASE,
        conflict: { localText: mine, remoteText: theirs },
      },
    });
    expect(announced).toEqual([itemId]);
  });

  it("records a conflict when the source changes between the read and the write", async () => {
    const mine = "Goal\n\nMy steps\n\nDone when";
    const { item, save } = await setup(mine);
    const meanwhile = "Goal\n\nSteps\n\nDone when they say";
    stubSource(BASE, () =>
      Response.json({ outcome: "conflict", description: { text: meanwhile } }),
    );

    expect(await save()).toEqual({ kind: "conflict" });
    expect(item()).toMatchObject({
      description: mine,
      descriptionSync: {
        remote: meanwhile,
        conflict: { localText: mine, remoteText: meanwhile },
      },
    });
  });

  it("keeps the text with why when the write fails", async () => {
    const mine = "Goal\n\nMy steps\n\nDone when";
    const { item, save } = await setup(mine);
    stubSource(BASE, () =>
      Response.json({ error: "The token expired." }, { status: 502 }),
    );

    const outcome = await save();
    expect(outcome.kind).toBe("failed");
    expect(item().description).toBe(mine);
    expect(item().descriptionSync).toMatchObject({
      baseline: BASE,
      writeError: { message: expect.stringContaining("The token expired.") },
    });
  });

  it("keeps a text typed during the save, for the next one", async () => {
    const mine = "Goal\n\nMy steps\n\nDone when";
    const later = "Goal\n\nMy steps, longer\n\nDone when";
    const { localStore, itemId, item, save } = await setup(mine);
    stubSource(BASE, (request) => {
      localStore.saveWorkItemEdits(itemId, { description: later });
      return Response.json({
        outcome: "written",
        description: { text: request.text },
      });
    });

    await save();
    expect(item()).toMatchObject({
      description: later,
      descriptionSync: { baseline: mine },
    });
  });

  it("merges what a sync brought under an open edit, from where the edit began", async () => {
    // The edit began on BASE; a sync then brought "New steps" into the item.
    const theirs = "Goal\n\nNew steps\n\nDone when";
    const mine = "My goal\n\nSteps\n\nDone when";
    const { localStore, itemId, item } = await setup(theirs);
    localStore.updateSyncedDescription(itemId, () => ({
      description: theirs,
      descriptionSync: { baseline: theirs, remote: theirs },
    }));
    localStore.saveWorkItemEdits(itemId, { description: mine });
    const writes = stubSource(theirs);
    const { saveSyncedDescription } = await import("@/lib/description-save");

    expect(await saveSyncedDescription(itemId, "save", BASE)).toEqual({
      kind: "written",
      merged: true,
    });
    const merged = "My goal\n\nNew steps\n\nDone when";
    expect(writes).toEqual([
      { sourceId: "s1", text: merged, expected: theirs },
    ]);
    expect(item().description).toBe(merged);
  });

  it("keeps what the first of two saves merged when the second is written", async () => {
    const { localStore, itemId, item, save } = await setup(
      "My title\n\nSteps\n\nDone when",
    );
    const source = { text: "Goal\n\nNew steps\n\nDone when" };
    // The second edit lands while the first save's write is on its way.
    stubSource(source.text, (request) => {
      if (request.expected === "Goal\n\nNew steps\n\nDone when") {
        localStore.saveWorkItemEdits(itemId, {
          description: "My newer title\n\nSteps\n\nDone when",
        });
      }
      return Response.json({
        outcome: "written",
        description: { text: request.text },
      });
    });
    void save();
    await vi.waitFor(() =>
      expect(item().descriptionSync?.baseline).toBe(
        "My title\n\nNew steps\n\nDone when",
      ),
    );
    const writes = stubSource("My title\n\nNew steps\n\nDone when");

    await save();
    expect(writes.at(-1)?.text).toBe(
      "My newer title\n\nNew steps\n\nDone when",
    );
  });

  it("writes nothing over a source text cut to fit Ajour", async () => {
    const { item, save } = await setup("Goal\n\nMy steps\n\nDone when");
    const writes: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.endsWith("/description")) {
          return Response.json({ description: { text: BASE, cut: true } });
        }
        writes.push(init?.body);
        return Response.json({});
      }),
    );

    expect((await save()).kind).toBe("failed");
    expect(writes).toEqual([]);
    expect(item().descriptionSync?.writeError?.message).toContain(
      "longer in Work than Ajour keeps",
    );
  });

  it("writes the user's side of a conflict with Keep mine", async () => {
    const mine = "Goal\n\nMy steps\n\nDone when";
    const theirs = "Goal\n\nTheir steps\n\nDone when";
    const { item, save } = await setup(mine);
    stubSource(theirs);
    await save();

    const writes = stubSource(theirs);
    expect(await save("keepMine")).toEqual({ kind: "written", merged: false });
    expect(writes).toEqual([{ sourceId: "s1", text: mine, expected: theirs }]);
    expect(item().descriptionSync).toEqual({ baseline: mine, remote: mine });
  });
});
