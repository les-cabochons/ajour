// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { useState } from "react";
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

let itemKeys = ["PAY-12"];

beforeEach(() => {
  itemKeys = ["PAY-12"];
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
  const handoffs = useItemHandoffs("item-12", "project-1", [...itemKeys]);
  return (
    <TooltipProvider>
      <HandoffsCard
        itemId="item-12"
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
  expect(api.findHandoffThreads).toHaveBeenCalledWith("project-1", "item-12", [
    "PAY-12",
  ]);
  const first = within(list).getByRole("listitem", {
    name: 'Found in T3 Code: "[PAY-12] Fix login redirect", changed 1 min ago',
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

it("offers a thread linked another way no more once Close takes it off the card (#850)", async () => {
  await renderPage();
  // The hand-off flow's "Link that thread" dialog links it without the
  // card's Link, so the offer is only hidden behind the handoff.
  act(() =>
    setHandoffs([
      handoffRecord({
        id: "linked",
        workItemId: "item-12",
        threadId: "t-12",
        state: "done",
      }),
    ]),
  );
  await waitFor(() =>
    expect(
      screen.queryByRole("listitem", { name: /^Found in T3 Code/ }),
    ).toBeNull(),
  );
  // Close in <tool> answers with the handoffs left. The tool no longer
  // lists the thread, so Link would refuse it.
  act(() => setHandoffs([]));
  expect(
    screen.queryByRole("listitem", { name: /^Found in T3 Code/ }),
  ).toBeNull();
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
      workItemId: "item-12",
    }),
  );
  await waitFor(() =>
    expect(
      screen.queryByRole("listitem", { name: /^Found in T3 Code/ }),
    ).toBeNull(),
  );
});

it("asks with each key the item answers to, and again only when they change", async () => {
  itemKeys = ["acme/api#12", "12"];
  await renderPage();
  expect(api.findHandoffThreads).toHaveBeenCalledWith("project-1", "item-12", [
    "acme/api#12",
    "12",
  ]);
  // Re-rendering with equal keys in a new array asks nothing more.
  await act(async () => {
    setHandoffs([]);
  });
  expect(api.findHandoffThreads).toHaveBeenCalledTimes(1);
});

it("moves focus to the next found thread's Link once one is linked or hidden, then to the card's heading", async () => {
  vi.mocked(api.dismissHandoffThread).mockResolvedValue({ ok: true });
  const record = handoffRecord({
    id: "adopted",
    workItemId: "item-12",
    toolId: "claude",
    threadId: "t-both",
    state: "ready",
  });
  vi.mocked(api.adoptHandoffThread).mockResolvedValue(record);
  vi.mocked(api.refreshHandoffs).mockResolvedValue({
    handoffs: [record],
    failures: [],
  });
  const list = await renderPage();
  const first = within(list).getByRole("listitem", { name: /^Found in T3/ });
  fireEvent.click(within(first).getByRole("button", { name: /^Not this one/ }));
  const next = screen.getByRole("button", {
    name: 'Link "[PAY-11] [PAY-12] Split the job" to this item',
  });
  await waitFor(() => expect(document.activeElement).toBe(next));
  fireEvent.click(next);
  await waitFor(() =>
    expect(screen.queryByRole("list", { name: "Threads found" })).toBeNull(),
  );
  await waitFor(() =>
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: /^Handoffs/ }),
    ),
  );
});

it("says when a thread couldn't be hidden, and keeps the offer", async () => {
  vi.mocked(api.dismissHandoffThread).mockRejectedValue(
    new Error("The local API didn't answer."),
  );
  const list = await renderPage();
  const row = within(list).getByRole("listitem", { name: /^Found in T3/ });
  fireEvent.click(within(row).getByRole("button", { name: /^Not this one/ }));
  expect(
    (await screen.findAllByText("Couldn't hide the thread")).length,
  ).toBeGreaterThan(0);
  expect(
    screen.getByRole("listitem", { name: /^Found in T3 Code/ }),
  ).toBeTruthy();
});

it("offers no threads for an item without a key, or in the web build", async () => {
  itemKeys = [];
  await renderRoutes({ routes: { "/": Page } });
  await act(async () => {});
  expect(api.findHandoffThreads).not.toHaveBeenCalled();
  cleanup();
  itemKeys = ["PAY-12"];
  delete window.ajourDesktop;
  resetHandoffToolDetections();
  await renderRoutes({ routes: { "/": Page } });
  await act(async () => {});
  expect(api.findHandoffThreads).not.toHaveBeenCalled();
  expect(screen.queryByRole("list", { name: "Threads found" })).toBeNull();
});

/**
 * The card as the item page keeps it across items: the item changes under
 * it while a Link is under way, and the Link resolves when the test says.
 */
function renderAcrossItems() {
  const gate: { open?: (done: boolean) => void } = {};
  const control: { showItem?: (itemId: string) => void } = {};
  function Harness() {
    const [itemId, setItemId] = useState("item-a");
    const [offers, setOffers] = useState<
      Record<string, readonly HandoffThreadOffer[]>
    >({
      "item-a": [offer("a-1", "[A-1] First"), offer("a-2", "[A-1] Second")],
      "item-b": [offer("b-1", "[B-1] Other")],
    });
    control.showItem = setItemId;
    return (
      <TooltipProvider>
        <input aria-label="Elsewhere" />
        <HandoffsCard
          itemId={itemId}
          handoffs={[]}
          tools={[]}
          offers={offers[itemId]}
          onLink={async (linked) => {
            const done = await new Promise<boolean>((resolve) => {
              gate.open = resolve;
            });
            if (done)
              setOffers((current) => ({
                ...current,
                [itemId]: current[itemId]!.filter((o) => o !== linked),
              }));
            return done;
          }}
          now={10 * 60_000}
          open
          onOpenChange={() => {}}
        />
      </TooltipProvider>
    );
  }
  return {
    gate,
    control,
    rendered: renderRoutes({ routes: { "/": Harness } }),
  };
}

it("doesn't move focus into the next item when a Link started on the last one completes", async () => {
  const { gate, control, rendered } = renderAcrossItems();
  await rendered;
  const link = screen.getByRole("button", {
    name: 'Link "[A-1] First" to this item',
  });
  link.focus();
  fireEvent.click(link);
  await act(async () => control.showItem!("item-b"));
  const other = screen.getByRole("button", {
    name: 'Link "[B-1] Other" to this item',
  });
  await act(async () => gate.open!(true));
  await act(async () => {});
  expect(document.activeElement).not.toBe(other);
  expect(document.activeElement).not.toBe(
    screen.getByRole("button", { name: /^Handoffs/ }),
  );
});

it("leaves focus where the user moved it while a Link was under way", async () => {
  const { gate, rendered } = renderAcrossItems();
  await rendered;
  const link = screen.getByRole("button", {
    name: 'Link "[A-1] First" to this item',
  });
  link.focus();
  fireEvent.click(link);
  const elsewhere = screen.getByRole("textbox", { name: "Elsewhere" });
  elsewhere.focus();
  await act(async () => gate.open!(true));
  await act(async () => {});
  expect(
    screen.queryByRole("button", { name: 'Link "[A-1] First" to this item' }),
  ).toBeNull();
  expect(document.activeElement).toBe(elsewhere);
});

it("asks on open for the state of a started thread only while its tool follows state", async () => {
  cachePluginsOverview(handoffOverview({ copilot: true }));
  const followed = handoffRecord({
    id: "followed",
    workItemId: "item-12",
    toolId: "t3",
    state: "started",
    native: {},
  });
  const blind = handoffRecord({
    id: "blind",
    workItemId: "item-12",
    toolId: "copilot",
    state: "started",
    native: {},
  });
  vi.mocked(api.refreshHandoffs).mockResolvedValue({
    handoffs: [followed, blind],
    failures: [],
  });
  act(() => setHandoffs([followed, blind]));
  await renderPage();
  await waitFor(() =>
    expect(api.refreshHandoffs).toHaveBeenCalledWith("followed"),
  );
  expect(api.refreshHandoffs).not.toHaveBeenCalledWith("blind");
});
