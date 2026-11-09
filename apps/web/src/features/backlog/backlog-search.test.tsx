// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { BacklogImportCandidate } from "@ajour/shared";
import { BacklogPage } from "./backlog-page";
import { localStore } from "@/lib/local-store";
import { ShortcutProvider } from "@/lib/shortcut-handlers";
import { installDomShims, renderRoutes } from "@/test-support/dom";

beforeEach(() => {
  installDomShims();
  // The visit's refresh finds no local API; the page shows its rows anyway.
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.reject(new Error("offline"))),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** A synced item whose number is not in its title, as a tracker's are. */
function synced(externalId: string, title: string): BacklogImportCandidate {
  return {
    id: `candidate-${externalId}`,
    source: "tracker",
    connectionId: "work",
    connectionLabel: "Work",
    tenantLabel: "Tracker",
    sourceId: `https://tracker.example/items/${externalId}`,
    externalId,
    title,
    workItemType: "Task",
    state: "Active",
    depth: 0,
    selectable: true,
    selected: true,
    childCount: 0,
    pushedAt: 1,
  };
}

// The store keeps the two rows for the whole file; each test opens the page anew.
let seeded = false;
async function renderBacklog() {
  if (!seeded) {
    seeded = true;
    localStore.importSyncedWorkItems([
      synced("331150", "Alpha gateway"),
      synced("332001", "Beta gateway"),
    ]);
  }
  await renderRoutes({
    shell: ({ children }) => <ShortcutProvider>{children}</ShortcutProvider>,
    routes: { "/backlog": BacklogPage },
    path: "/backlog",
  });
  await screen.findByText("Alpha gateway");
}

it("keeps only the item whose number starts with the typed digits, and brings every row back on Escape", async () => {
  await renderBacklog();

  fireEvent.click(screen.getByRole("button", { name: "Search the backlog" }));
  const box = screen.getByRole("searchbox", { name: "Search the backlog" });
  act(() => {
    fireEvent.change(box, { target: { value: "3311" } });
  });

  expect(screen.getByText("Alpha gateway")).toBeTruthy();
  expect(screen.queryByText("Beta gateway")).toBeNull();

  act(() => {
    fireEvent.keyDown(box, { key: "Escape" });
  });

  expect(screen.getByText("Beta gateway")).toBeTruthy();
  expect(screen.queryByRole("searchbox")).toBeNull();
});

it("says no item matches while the query finds nothing", async () => {
  await renderBacklog();

  fireEvent.click(screen.getByRole("button", { name: "Search the backlog" }));
  act(() => {
    fireEvent.change(
      screen.getByRole("searchbox", { name: "Search the backlog" }),
      { target: { value: "omega" } },
    );
  });

  expect(screen.getByText("No matching items")).toBeTruthy();
  expect(
    screen.getByText("Change the search or the filters to see more items."),
  ).toBeTruthy();
});
