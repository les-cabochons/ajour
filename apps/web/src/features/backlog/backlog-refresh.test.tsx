// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { installDomShims, renderRoutes } from "@/test-support/dom";
import { cachePluginsOverview, syncBacklogConnection } from "@/lib/app-api";
import { BacklogRefresh } from "./backlog-refresh";
import type { PluginsOverview } from "@ajour/shared";
import { codeHostOverview } from "../../../tests/fixtures/pull-requests";
import { BacklogAutoSyncScheduler } from "@/features/layout/backlog-auto-sync-scheduler";

function overview(id = "work"): PluginsOverview {
  const value = structuredClone(codeHostOverview);
  const group = value.connectionGroups[0]!;
  group.plugin.capabilities = { connector: {} };
  group.connections[0] = {
    ...group.connections[0]!,
    id,
    autoSync: true,
    backlogLastSyncAt: Date.now() - 120_000,
  };
  return value;
}
beforeEach(() => {
  installDomShims();
  window.localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("shows the scheduler's progress in both views and leaves the successful age visible after a failure", async () => {
  const data = overview("auto");
  data.connectionGroups[0]!.connections[0]!.backlogLastSyncAt =
    Date.now() - 600_000;
  data.connectionGroups[0]!.connections[0]!.lastSyncAt = Date.now() - 600_000;
  cachePluginsOverview(data);
  let finish!: (value: Response) => void;
  const pending = new Promise<Response>((resolve) => {
    finish = resolve;
  });
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) =>
      url.endsWith("/sync") ? pending : Promise.resolve(Response.json(data)),
    ),
  );
  await renderRoutes({
    routes: {
      "/": () => (
        <>
          <BacklogAutoSyncScheduler />
          <BacklogRefresh />
          <BacklogRefresh
            source={{
              pluginId: "github",
              connectionId: "auto",
              sourceId: "one",
              syncedAt: Date.now() - 600_000,
            }}
          />
        </>
      ),
    },
  });
  await waitFor(() => expect(screen.getAllByText("Syncing…")).toHaveLength(2));
  expect(
    (
      screen.getByRole("button", {
        name: "Refresh backlog",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  await act(async () => {
    finish(Response.json({ error: "Connection is offline" }, { status: 502 }));
  });
  await waitFor(() =>
    expect(screen.getAllByText(/Auto sync failed/)).toHaveLength(2),
  );
  expect(screen.getAllByText(/10 min ago/)).toHaveLength(2);
});

it("refreshes the open item only and returns to a quiet freshness label", async () => {
  const data = overview("manual");
  cachePluginsOverview(data);
  const connection = data.connectionGroups[0]!.connections[0]!;
  const fetch = vi.fn(async (_url: string, _init?: RequestInit) =>
    _url.endsWith("/sync")
      ? Response.json({
          connection,
          mode: "backlog",
          items: [],
          stagedCount: 0,
          updatedCount: 0,
          skippedCount: 0,
        })
      : Response.json(data),
  );
  vi.stubGlobal("fetch", fetch);
  await renderRoutes({
    routes: {
      "/": () => (
        <BacklogRefresh
          source={{
            pluginId: "github",
            connectionId: "manual",
            sourceId: "one",
          }}
        />
      ),
    },
  });
  fireEvent.click(screen.getByRole("button", { name: "Refresh item" }));
  await waitFor(() =>
    expect(screen.getByText("Last sync just now")).toBeTruthy(),
  );
  expect(
    JSON.parse(
      fetch.mock.calls.find((call) => call[1]?.method === "POST")![1]!
        .body as string,
    ),
  ).toMatchObject({ refresh: true, sourceId: "one" });
});

it("warns about overdue and paused automatic sync even if another capability synced recently", async () => {
  const data = overview();
  const connection = data.connectionGroups[0]!.connections[0]!;
  connection.lastSyncAt = Date.now();
  connection.backlogLastSyncAt = Date.now() - 20 * 60_000;
  cachePluginsOverview(data);
  await renderRoutes({ routes: { "/": () => <BacklogRefresh /> } });
  expect(screen.getByText(/Sync overdue/)).toBeTruthy();
  const paused = structuredClone(data);
  paused.connectionGroups[0]!.connections[0]!.paused = {
    reason: "secret_rejected",
    message: "Update the saved token",
  };
  act(() => {
    cachePluginsOverview(paused);
  });
  expect(screen.getByText(/Sync paused/)).toBeTruthy();
  expect(
    (
      screen.getByRole("button", {
        name: "Refresh backlog",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
});

it("does not mark an item fresh when a connection sync did not return that item", async () => {
  const data = overview("coverage");
  data.connectionGroups[0]!.connections[0]!.backlogLastSyncAt = Date.now();
  cachePluginsOverview(data);
  await renderRoutes({
    routes: {
      "/": () => (
        <BacklogRefresh
          source={{
            pluginId: "github",
            connectionId: "coverage",
            sourceId: "missing-from-query",
            syncedAt: Date.now() - 30 * 60_000,
          }}
        />
      ),
    },
  });
  expect(screen.getByText(/last sync 30 min ago/)).toBeTruthy();
});
