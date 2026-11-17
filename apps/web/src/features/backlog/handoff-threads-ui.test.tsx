// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import type { HandoffThreadOffer } from "@ajour/shared/handoff-threads";
import { Toaster } from "@/components/ui/toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import * as api from "@/lib/app-api";
import { cachePluginsOverview } from "@/lib/app-api";
import { setHandoffs } from "@/lib/handoffs";
import { resetHandoffToolDetections } from "@/lib/handoff-tools";
import { installDomShims, renderRoutes } from "@/test-support/dom";
import { HandoffsCard } from "./backlog-item-side-cards";
import { useItemHandoffs } from "./use-item-handoffs";
import {
  handoffOverview,
  handoffRecord,
} from "../../../tests/fixtures/handoffs";

vi.mock("@/lib/app-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/app-api")>()),
  adoptHandoffThread: vi.fn(),
  detectHandoffTools: vi.fn(),
  dismissHandoffThread: vi.fn(),
  findHandoffThreads: vi.fn(),
  listHandoffs: vi.fn(),
  refreshHandoffs: vi.fn(),
}));

beforeAll(installDomShims);

const offer = (
  threadId: string,
  title: string,
  extra: Partial<HandoffThreadOffer> = {},
): HandoffThreadOffer => ({
  pluginId: "agent-handoff",
  toolId: "t3",
  folderId: "folder-1",
  threadId,
  title,
  ...extra,
});

let itemKey = "PAY-12";

beforeEach(() => {
  itemKey = "PAY-12";
  resetHandoffToolDetections();
  window.ajourDesktop = { chooseFolder: vi.fn() };
  cachePluginsOverview(handoffOverview());
  setHandoffs([]);
  vi.mocked(api.listHandoffs).mockResolvedValue([]);
  vi.mocked(api.detectHandoffTools).mockResolvedValue({
    tools: [
      { id: "t3", available: true },
      { id: "claude", available: true },
    ],
  });
  vi.mocked(api.findHandoffThreads).mockResolvedValue({
    offers: [
      offer("t-12", "[PAY-12] Fix login redirect", { updatedAt: 9 * 60_000 }),
      offer("t-both", "[PAY-11] [PAY-12] Split the job", {
        toolId: "claude",
      }),
    ],
  });
});

afterEach(() => {
  cleanup();
  delete window.ajourDesktop;
  vi.resetAllMocks();
});

function Page() {
  const handoffs = useItemHandoffs("item-12", "project-1", itemKey);
  return (
    <TooltipProvider>
      <HandoffsCard
        handoffs={handoffs.records}
        tools={handoffs.tools}
        offers={handoffs.offers}
        onLink={handoffs.link}
        onDismiss={handoffs.dismiss}
        now={10 * 60_000}
        open
        onOpenChange={() => {}}
      />
      <Toaster />
    </TooltipProvider>
  );
}

async function renderPage() {
  await renderRoutes({ routes: { "/": Page } });
  return screen.findByRole("list", { name: "Threads found" });
}

it("asks once on open for the threads that name the item's key, and offers each with its tool", async () => {
  const list = await renderPage();
  expect(api.findHandoffThreads).toHaveBeenCalledTimes(1);
  expect(api.findHandoffThreads).toHaveBeenCalledWith("project-1", "PAY-12");
  const first = within(list).getByRole("listitem", {
    name: 'Found in T3 Code: "[PAY-12] Fix login redirect"',
  });
  expect(first.textContent).toContain("[PAY-12] Fix login redirect");
  expect(first.textContent).toContain("Found in T3 Code");
  expect(within(first).getByText("[PAY-12] Fix login redirect").title).toBe(
    "[PAY-12] Fix login redirect\nChanged 1 min ago",
  );
  expect(
    within(list).getByRole("listitem", {
      name: 'Found in Claude Code: "[PAY-11] [PAY-12] Split the job"',
    }),
  ).toBeTruthy();
  expect(
    within(first).getByRole("button", {
      name: 'Link "[PAY-12] Fix login redirect" to this item',
    }),
  ).toBeTruthy();
  expect(
    within(first).getByRole("button", {
      name: 'Not this one: "[PAY-12] Fix login redirect"',
    }),
  ).toBeTruthy();
});

it("links a found thread as a handoff, which replaces the offer", async () => {
  const record = handoffRecord({
    id: "adopted",
    workItemId: "item-12",
    threadId: "t-12",
    state: "ready",
  });
  vi.mocked(api.adoptHandoffThread).mockResolvedValue(record);
  vi.mocked(api.refreshHandoffs).mockResolvedValue({
    handoffs: [record],
    failures: [],
  });
  const list = await renderPage();
  const row = within(list).getByRole("listitem", {
    name: /\[PAY-12\] Fix login redirect/,
  });
  fireEvent.click(within(row).getByRole("button", { name: /^Link / }));
  await waitFor(() =>
    expect(api.adoptHandoffThread).toHaveBeenCalledWith({
      pluginId: "agent-handoff",
      toolId: "t3",
      folderId: "folder-1",
      threadId: "t-12",
      projectId: "project-1",
      workItemId: "item-12",
    }),
  );
  expect(
    await screen.findByRole("listitem", { name: record.title }),
  ).toBeTruthy();
  await waitFor(() =>
    expect(
      screen.queryByRole("listitem", { name: /^Found in T3 Code/ }),
    ).toBeNull(),
  );
  expect(
    screen.getByRole("listitem", { name: /^Found in Claude Code/ }),
  ).toBeTruthy();
});

it("says why a link failed, in the API's words, and keeps the offer", async () => {
  vi.mocked(api.adoptHandoffThread).mockRejectedValue(
    new Error("This thread is already linked to an item."),
  );
  const list = await renderPage();
  const row = within(list).getByRole("listitem", { name: /^Found in T3/ });
  fireEvent.click(within(row).getByRole("button", { name: /^Link / }));
  expect(
    (await screen.findAllByText("Couldn't link the thread")).length,
  ).toBeGreaterThan(0);
  expect(
    screen.getAllByText("This thread is already linked to an item.").length,
  ).toBeGreaterThan(0);
  expect(
    screen.getByRole("listitem", { name: /^Found in T3 Code/ }),
  ).toBeTruthy();
});

it("forgets a dismissed thread", async () => {
  vi.mocked(api.dismissHandoffThread).mockResolvedValue({ ok: true });
  const list = await renderPage();
  const row = within(list).getByRole("listitem", { name: /^Found in T3/ });
  fireEvent.click(within(row).getByRole("button", { name: /^Not this one/ }));
  await waitFor(() =>
    expect(api.dismissHandoffThread).toHaveBeenCalledWith({
      pluginId: "agent-handoff",
      toolId: "t3",
      threadId: "t-12",
    }),
  );
  await waitFor(() =>
    expect(
      screen.queryByRole("listitem", { name: /^Found in T3 Code/ }),
    ).toBeNull(),
  );
});

it("offers no threads for an item without a key, or in the web build", async () => {
  itemKey = "";
  await renderRoutes({ routes: { "/": Page } });
  await act(async () => {});
  expect(api.findHandoffThreads).not.toHaveBeenCalled();
  cleanup();
  itemKey = "PAY-12";
  delete window.ajourDesktop;
  resetHandoffToolDetections();
  await renderRoutes({ routes: { "/": Page } });
  await act(async () => {});
  expect(api.findHandoffThreads).not.toHaveBeenCalled();
  expect(screen.queryByRole("list", { name: "Threads found" })).toBeNull();
});
