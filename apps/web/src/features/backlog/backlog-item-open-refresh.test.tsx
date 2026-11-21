// @vitest-environment jsdom
import { StrictMode } from "react";
import { act, cleanup, screen, waitFor } from "@testing-library/react";
import { useParams } from "@tanstack/react-router";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import type { BacklogImportCandidate, BacklogSyncRequest } from "@ajour/shared";
import { useBacklogItemRefreshOnOpen } from "./use-backlog-refresh-on-open";
import { cachePluginsOverview } from "@/lib/app-api";
import { localStore } from "@/lib/local-store";
import { installDomShims, renderRoutes } from "@/test-support/dom";
import { codeHostOverview } from "../../../tests/fixtures/pull-requests";

/*
 * Opening a synced item's page syncs that item both ways, on every visit,
 * through the real refresh workflow against a fake local API.
 */

beforeAll(installDomShims);
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** The item page, as far as opening it goes. */
function ItemPage() {
  const { itemId } = useParams({ strict: false }) as { itemId: string };
  useBacklogItemRefreshOnOpen(itemId);
  return <p>Item page {itemId}</p>;
}

/** A connection "item-open" of a backlog plugin, and two items synced from it. */
function setUp() {
  const overview = structuredClone(codeHostOverview);
  const group = overview.connectionGroups[0]!;
  group.plugin.capabilities = { connector: {} };
  group.connections[0]!.id = "item-open";
  cachePluginsOverview(overview);
  const candidate = (sourceId: string): BacklogImportCandidate => ({
    id: `candidate-${sourceId}`,
    source: group.plugin.id,
    connectionId: "item-open",
    connectionLabel: "Work",
    tenantLabel: "GitHub",
    sourceId,
    externalId: sourceId,
    title: `Item ${sourceId}`,
    workItemType: "Task",
    state: "Active",
    depth: 0,
    selectable: true,
    selected: true,
    childCount: 0,
    pushedAt: 1,
  });
  localStore.importSyncedWorkItems([candidate("101"), candidate("102")]);
  const idOf = (sourceId: string) =>
    localStore
      .snapshot()
      .workItems.find((workItem) => workItem.sourceId === sourceId)!._id;
  const answer = () =>
    Response.json({
      connection: group.connections[0],
      mode: "backlog",
      items: [],
      stagedCount: 0,
      updatedCount: 0,
      skippedCount: 0,
    });
  return { overview, idOf, answer };
}

it("syncs a synced item both ways each time its page opens, never on a store write or for a manual item", async () => {
  const { overview, idOf, answer } = setUp();
  const manualId = localStore.addWorkItem({ title: "A manual item" });
  const posts: BacklogSyncRequest[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method !== "POST") return Response.json(overview);
      posts.push(JSON.parse(String(init.body)));
      return answer();
    }),
  );
  const { router } = await renderRoutes({
    shell: ({ children }) => <StrictMode>{children}</StrictMode>,
    routes: { "/backlog/$itemId": ItemPage },
    path: `/backlog/${idOf("101")}`,
  });

  await waitFor(() => expect(posts).toHaveLength(1));
  expect(posts[0]).toMatchObject({
    trigger: "auto",
    refresh: true,
    sourceId: "101",
  });
  act(() => {
    localStore.addWorkItem({ title: "A local change while the page is open" });
  });
  await act(async () => {
    await router.navigate({ to: `/backlog/${idOf("102")}` });
  });
  await waitFor(() => expect(posts).toHaveLength(2));
  expect(posts[1]).toMatchObject({ sourceId: "102" });
  await act(async () => {
    await router.navigate({ to: `/backlog/${manualId}` });
  });
  await screen.findByText(`Item page ${manualId}`);
  await act(async () => {
    await router.navigate({ to: `/backlog/${idOf("101")}` });
  });
  await waitFor(() => expect(posts).toHaveLength(3));
  expect(posts.map((post) => post.sourceId)).toEqual(["101", "102", "101"]);
});

it("syncs the opened item while another item's sync is still on its way", async () => {
  const { overview, idOf, answer } = setUp();
  const posts: string[] = [];
  const finish: (() => void)[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((_url: string, init?: RequestInit) => {
      if (init?.method !== "POST")
        return Promise.resolve(Response.json(overview));
      posts.push(JSON.parse(String(init.body)).sourceId);
      return new Promise<Response>((resolve) =>
        finish.push(() => resolve(answer())),
      );
    }),
  );
  const { router } = await renderRoutes({
    routes: { "/backlog/$itemId": ItemPage },
    path: `/backlog/${idOf("101")}`,
  });
  await waitFor(() => expect(posts).toEqual(["101"]));

  await act(async () => {
    await router.navigate({ to: `/backlog/${idOf("102")}` });
  });

  await waitFor(() => expect(posts).toEqual(["101", "102"]));
  await act(async () => {
    for (const done of finish) done();
  });
});
