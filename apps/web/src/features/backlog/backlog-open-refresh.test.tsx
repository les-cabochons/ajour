// @vitest-environment jsdom
import { BacklogAutoSyncScheduler } from "@/features/layout/backlog-auto-sync-scheduler";
import { StrictMode } from "react";
import { act, cleanup, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { BacklogPage } from "./backlog-page";
import { cachePluginsOverview } from "@/lib/app-api";
import { localStore } from "@/lib/local-store";
import { ShortcutProvider } from "@/lib/shortcut-handlers";
import { installDomShims, renderRoutes } from "@/test-support/dom";
import { codeHostOverview } from "../../../tests/fixtures/pull-requests";

beforeAll(installDomShims);
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("refreshes once on every Backlog visit, including with scheduled sync off, without refreshing on store writes", async () => {
  const overview = structuredClone(codeHostOverview);
  const group = overview.connectionGroups[0]!;
  group.plugin.capabilities = { connector: {} };
  group.connections[0]!.id = "open-visit";
  group.connections[0]!.autoSync = false;
  group.connections.push({
    ...group.connections[0]!,
    id: "open-paused",
    paused: { reason: "secret_rejected", message: "Update the saved token" },
  });
  cachePluginsOverview(overview);
  const posts: unknown[] = [];
  const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method !== "POST") return Response.json(overview);
    posts.push(JSON.parse(init.body as string));
    return Response.json({
      connection: group.connections[0],
      mode: "backlog",
      items: [],
      stagedCount: 0,
      updatedCount: 0,
      skippedCount: 0,
    });
  });
  vi.stubGlobal("fetch", fetch);
  const { router } = await renderRoutes({
    shell: ({ children }) => (
      <StrictMode>
        <ShortcutProvider>{children}</ShortcutProvider>
      </StrictMode>
    ),
    routes: { "/backlog": BacklogPage, "/projects": () => <p>Another page</p> },
    path: "/backlog",
  });
  await waitFor(() => expect(posts).toHaveLength(1));
  expect(posts[0]).toMatchObject({ trigger: "auto", refresh: true });
  act(() => {
    localStore.addWorkItem({
      title: "A local change while Backlog stays open",
    });
  });
  await screen.findByText("A local change while Backlog stays open");
  expect(posts).toHaveLength(1);
  await act(async () => {
    await router.navigate({ to: "/projects" });
  });
  await screen.findByText("Another page");
  await act(async () => {
    await router.navigate({ to: "/backlog" });
  });
  await waitFor(() => expect(posts).toHaveLength(2));
});

it("shares in-flight scheduled syncs, including a connection queued behind another", async () => {
  const overview = structuredClone(codeHostOverview);
  const group = overview.connectionGroups[0]!;
  group.plugin.capabilities = { connector: {} };
  group.connections = ["open-overlap-a", "open-overlap-b"].map((id) => ({
    ...group.connections[0]!,
    id,
    autoSync: true,
    backlogLastSyncAt: 1,
  }));
  cachePluginsOverview(overview);
  const posts: string[] = [];
  const finish = new Map<string, (response: Response) => void>();
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => {
      if (init?.method !== "POST")
        return Promise.resolve(Response.json(overview));
      const id = group.connections.find((c) =>
        url.includes(`/connections/${c.id}/`),
      )!.id;
      posts.push(id);
      return new Promise<Response>((resolve) => {
        finish.set(id, resolve);
      });
    }),
  );
  await renderRoutes({
    shell: ({ children }) => (
      <ShortcutProvider>
        <BacklogAutoSyncScheduler />
        {children}
      </ShortcutProvider>
    ),
    routes: { "/backlog": BacklogPage },
    path: "/backlog",
  });
  await waitFor(() => expect(posts).toHaveLength(2));
  const answer = (id: string) =>
    Response.json({
      connection: group.connections.find((c) => c.id === id),
      mode: "backlog",
      items: [],
      stagedCount: 0,
      updatedCount: 0,
      skippedCount: 0,
    });
  await act(async () => {
    finish.get("open-overlap-a")!(answer("open-overlap-a"));
  });
  expect(posts).toHaveLength(2);
  await act(async () => {
    finish.get("open-overlap-b")!(answer("open-overlap-b"));
  });
  expect(new Set(posts).size).toBe(2);
  expect(posts).toHaveLength(2);
});

it("keeps a failed visit visible and tries again on the next visit", async () => {
  const overview = structuredClone(codeHostOverview);
  const group = overview.connectionGroups[0]!;
  group.plugin.capabilities = { connector: {} };
  group.connections[0]!.id = "open-retry";
  group.connections[0]!.backlogLastSyncAt = Date.now() - 120_000;
  cachePluginsOverview(overview);
  let attempts = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method !== "POST") return Response.json(overview);
      if (++attempts === 1)
        return Response.json({ error: "Source is offline" }, { status: 502 });
      return Response.json({
        connection: group.connections[0],
        mode: "backlog",
        items: [],
        stagedCount: 0,
        updatedCount: 0,
        skippedCount: 0,
      });
    }),
  );
  const { router } = await renderRoutes({
    shell: ({ children }) => <ShortcutProvider>{children}</ShortcutProvider>,
    routes: { "/backlog": BacklogPage, "/projects": () => <p>Another page</p> },
    path: "/backlog",
  });
  await screen.findByText(/Auto sync failed/);
  expect(screen.getByText(/last sync 2 min ago/)).toBeTruthy();
  await act(async () => {
    await router.navigate({ to: "/projects" });
  });
  await act(async () => {
    await router.navigate({ to: "/backlog" });
  });
  await screen.findByText(/last sync just now/i);
  expect(attempts).toBe(2);
});
