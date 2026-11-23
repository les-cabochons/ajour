// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Handoff } from "@ajour/shared/handoffs";
import type { Worktree } from "@ajour/shared/worktrees";
import * as api from "@/lib/app-api";
import { localStore } from "@/lib/local-store";
import {
  CLEAN_UP_EVERY_MS,
  runWorktreeCleanUp,
  startWorktreeCleanUp,
} from "./worktree-clean-up";

/*
 * The window's side of automatic clean up (#864): backlog items live in
 * the window, so it starts each round and sends when each item that has a
 * worktree became finished. The local API module is mocked. The tests read
 * what the window sends and when.
 */

vi.mock("@/lib/app-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/app-api")>()),
  cleanUpWorktrees: vi.fn(),
  listWorktrees: vi.fn(),
}));

const setHandoffs = vi.hoisted(() => vi.fn());
vi.mock("@/lib/handoffs", () => ({ setHandoffs }));

let run = 0;

/** Adds a backlog item, and answers its id. */
function addItem(): string {
  const title = `Clean up item ${++run}`;
  localStore.addWorkItem({ title });
  return localStore.snapshot().workItems.find((item) => item.title === title)!
    ._id;
}

const worktreeOf = (workItemId: string, name = "aj-1"): Worktree => ({
  id: `worktree-${name}`,
  repositoryFolderId: "folder-1",
  projectId: "p",
  workItemId,
  itemKey: "1",
  name,
  branch: "1-item",
  source: "origin/main",
  createdAt: 1_000,
});

const answer = (removed: string[] = [], handoffs: Handoff[] = []) => ({
  removed: removed.map((name) => ({
    worktreeId: `worktree-${name}`,
    name,
    rule: "finished" as const,
  })),
  kept: [],
  handoffs,
});

beforeEach(() => {
  vi.mocked(api.listWorktrees).mockResolvedValue([]);
  vi.mocked(api.cleanUpWorktrees).mockResolvedValue(answer());
});
afterEach(() => {
  vi.useRealTimers();
  vi.resetAllMocks();
});

describe("a clean-up round, as the window starts it", () => {
  it("sends when each item that has a worktree became done, settled or archived, and nothing for an active one", async () => {
    const done = addItem();
    const active = addItem();
    const reopened = addItem();
    const without = addItem();
    localStore.archiveWorkItem(done);
    localStore.archiveWorkItem(reopened);
    localStore.restoreWorkItem(reopened);
    localStore.archiveWorkItem(without);
    const archivedAt = localStore
      .snapshot()
      .workItems.find((item) => item._id === done)!.archivedAt!;
    vi.mocked(api.listWorktrees).mockResolvedValue([
      worktreeOf(done, "aj-1"),
      worktreeOf(active, "aj-2"),
      worktreeOf(reopened, "aj-3"),
      worktreeOf("an-item-ajour-no-longer-has", "aj-4"),
    ]);

    await runWorktreeCleanUp("manual");

    expect(api.cleanUpWorktrees).toHaveBeenCalledWith({
      trigger: "manual",
      finished: [{ workItemId: done, finishedAt: archivedAt }],
    });
  });

  it("asks the local API for nothing more when this computer has no worktree", async () => {
    expect(await runWorktreeCleanUp("launch")).toBeUndefined();

    expect(api.listWorktrees).toHaveBeenCalledTimes(1);
    expect(api.cleanUpWorktrees).not.toHaveBeenCalled();
  });

  it("takes the handoffs as they are after a removal, since they no longer name the worktree", async () => {
    const item = addItem();
    const kept = [{ id: "h1" } as Handoff];
    vi.mocked(api.listWorktrees).mockResolvedValue([worktreeOf(item)]);
    vi.mocked(api.cleanUpWorktrees).mockResolvedValue(answer(["aj-1"], kept));

    const result = await runWorktreeCleanUp("timer");

    expect(result?.removed).toHaveLength(1);
    expect(setHandoffs).toHaveBeenCalledWith(kept);
  });

  it("leaves the handoffs alone when a round removed nothing", async () => {
    vi.mocked(api.listWorktrees).mockResolvedValue([worktreeOf(addItem())]);

    await runWorktreeCleanUp("timer");

    expect(setHandoffs).not.toHaveBeenCalled();
  });
});

describe("the rounds the window starts by itself", () => {
  const flush = () => vi.advanceTimersByTimeAsync(0);

  it("runs one at launch, then one an hour, until stopped", async () => {
    vi.useFakeTimers();
    vi.mocked(api.listWorktrees).mockResolvedValue([worktreeOf(addItem())]);

    const stop = startWorktreeCleanUp();
    await flush();
    expect(vi.mocked(api.cleanUpWorktrees).mock.calls).toEqual([
      [{ trigger: "launch", finished: [] }],
    ]);

    await vi.advanceTimersByTimeAsync(CLEAN_UP_EVERY_MS - 1);
    expect(api.cleanUpWorktrees).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(api.cleanUpWorktrees).toHaveBeenLastCalledWith({
      trigger: "timer",
      finished: [],
    });
    await vi.advanceTimersByTimeAsync(CLEAN_UP_EVERY_MS);
    expect(api.cleanUpWorktrees).toHaveBeenCalledTimes(3);

    stop();
    await vi.advanceTimersByTimeAsync(3 * CLEAN_UP_EVERY_MS);
    expect(api.cleanUpWorktrees).toHaveBeenCalledTimes(3);
  });

  it("is once an hour", () => {
    expect(CLEAN_UP_EVERY_MS).toBe(3_600_000);
  });

  it("keeps running after a round the local API didn't answer", async () => {
    vi.useFakeTimers();
    vi.mocked(api.listWorktrees).mockRejectedValueOnce(new Error("offline"));
    vi.mocked(api.listWorktrees).mockResolvedValue([worktreeOf(addItem())]);

    const stop = startWorktreeCleanUp();
    await flush();
    expect(api.cleanUpWorktrees).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(CLEAN_UP_EVERY_MS);
    expect(api.cleanUpWorktrees).toHaveBeenCalledTimes(1);
    stop();
  });
});
