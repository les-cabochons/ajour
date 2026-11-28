// @vitest-environment jsdom
import { NO_DECK_SUMMARY } from "@/test-support/deck";
import type { ReactNode } from "react";
import {
  act,
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { useParams } from "@tanstack/react-router";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import type {
  CodeHostConversationResult,
  CodeHostPullRequestFacts,
  CodeHostReviewThread,
} from "@ajour/shared";
import type { DeckOpenedPullRequest } from "@ajour/shared/deck";
import { TooltipProvider } from "@/components/ui/tooltip";
import * as api from "@/lib/app-api";
import { ShortcutProvider } from "@/lib/shortcut-handlers";
import { AppApiError, cachePluginsOverview } from "@/lib/app-api";
import {
  DECK_PANEL_STORAGE_KEY,
  resetDeckPanelForTests,
  setDeckPanel,
} from "@/lib/deck-panel";
import { localStore } from "@/lib/local-store";
import { installDomShims, renderRoutes } from "@/test-support/dom";
import {
  makeScrollable,
  scrollElement,
  sizeElements,
} from "@/test-support/virtual-geometry";
import {
  codeHostOverview,
  pullRequestFacts,
} from "../../../tests/fixtures/pull-requests";
import { DeckPage } from "./deck-page";

/*
 * Deck's review page at /deck/$itemId: its dock, peeks and side panel. The
 * setup below is the review page tests'. Deck's review page (#779, #782): the pull request's
 * title, then its guide's concerns in reading order, or every file's hunks
 * A–Z, as the local API built them. The local
 * API module is mocked, and so is the diff library, which renders a hunk's
 * patch as text here. Each test reads what the user sees.
 */

vi.mock("@/lib/app-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/app-api")>()),
  openDeckPullRequest: vi.fn(),
  readPullRequestConversation: vi.fn(),
  readPullRequestChecks: vi.fn(),
  readPullRequestVersions: vi.fn(),
  readDeckSinceReview: vi.fn(),
}));
// Highlighting runs in the window here: jsdom has no workers.
vi.mock("@/components/diff-highlighter", () => ({
  diffWorkerPool: () => undefined,
}));
vi.mock("@pierre/diffs/react", async () => ({
  WorkerPoolContext: (await import("react")).createContext(undefined),
  PatchDiff: ({
    patch,
    options,
    lineAnnotations,
    renderAnnotation,
    selectedLines,
  }: {
    patch: string;
    options: { overflow: string };
    lineAnnotations?: {
      side: string;
      lineNumber: number;
      metadata: { key: string };
    }[];
    renderAnnotation?: (annotation: unknown) => ReactNode;
    selectedLines?: { side: string; start: number; end: number } | null;
  }) => (
    <div
      data-selected={
        selectedLines
          ? `${selectedLines.side} ${selectedLines.start}-${selectedLines.end}`
          : undefined
      }
    >
      <pre data-overflow={options.overflow}>{patch}</pre>
      {lineAnnotations?.map((annotation) => (
        <div
          key={annotation.metadata.key}
          data-after={`${annotation.side} ${annotation.lineNumber}`}
        >
          {renderAnnotation?.(annotation)}
        </div>
      ))}
    </div>
  ),
}));

let originalMatchMedia: typeof window.matchMedia;
beforeAll(() => {
  installDomShims();
  originalMatchMedia = window.matchMedia;
});

/** An IntersectionObserver whose elements the test brings on screen. */
const observed = new Set<Element>();
let observers = 0;
let notify: ((entries: IntersectionObserverEntry[]) => void) | undefined;
class TestIntersectionObserver {
  constructor(callback: (entries: IntersectionObserverEntry[]) => void) {
    observers += 1;
    notify = callback;
  }
  observe(element: Element) {
    observed.add(element);
  }
  unobserve(element: Element) {
    observed.delete(element);
  }
  disconnect() {}
}
vi.stubGlobal("IntersectionObserver", TestIntersectionObserver);

function bringOnScreen(element: Element) {
  act(() =>
    notify?.([
      {
        target: element,
        isIntersecting: true,
      } as unknown as IntersectionObserverEntry,
    ]),
  );
}

/** A hunk as the local API sends it, its patch cut as Review Deck's `hunkToPatch` writes it. */
const hunk = (id: string, header: string, lines: string[]) => {
  const [, oldStart = 0, oldLines = 0, newStart = 0, newLines = 0] =
    /^@@ -(\d+),(\d+) \+(\d+),(\d+) @@/.exec(header)?.map(Number) ?? [];
  const path = id.slice(0, id.lastIndexOf("#"));
  const fileHeader = [`diff --git a/${path} b/${path}`];
  const patch = header
    ? [...fileHeader, `--- a/${path}`, `+++ b/${path}`, header, ...lines, ""]
    : [...fileHeader, ""];
  return {
    id,
    header,
    oldStart,
    oldLines,
    newStart,
    newLines,
    patch: patch.join("\n"),
  };
};

/** A pull request whose guide couldn't be built, so its files show A–Z. */
const DIFF: DeckOpenedPullRequest = {
  headSha: "head",
  baseSha: "base",
  guide: null,
  files: [
    {
      path: "assets/logo.png",
      status: "modified",
      binary: true,
      hunks: [hunk("assets/logo.png#0", "", [])],
    },
    {
      path: "src/api.ts",
      status: "modified",
      binary: false,
      hunks: [
        hunk("src/api.ts#0", "@@ -1,3 +1,3 @@", [" a", "-b", "+B", " c"]),
        hunk("src/api.ts#1", "@@ -40,2 +40,3 @@", [" x", "+y", " z"]),
      ],
    },
    {
      path: "src/new.ts",
      status: "added",
      binary: false,
      hunks: [
        hunk("src/new.ts#0", "@@ -1,0 +1,1 @@", ["+export const a = 1;"]),
      ],
    },
  ],
};

const CONVERSATION: CodeHostConversationResult = {
  description: "",
  timeline: [],
  threads: [],
  viewedPaths: [],
  mergeMethods: ["merge"],
};

/** The same pull request with its guide: two concerns, in reading order. */
const GUIDED: DeckOpenedPullRequest = {
  ...DIFF,
  guide: {
    madeWith: "code",
    summary: NO_DECK_SUMMARY,
    concerns: [
      {
        id: "g1",
        title: "Handle the request",
        rationale: "The handler and the export it reads.",
        hunkIds: ["src/api.ts#1", "src/new.ts#0"],
        kinds: [],
      },
      {
        id: "mechanical",
        title: "Mechanical changes",
        rationale: "1 binary. Nothing to review line by line.",
        hunkIds: ["assets/logo.png#0", "src/api.ts#0"],
        kinds: [],
      },
    ],
  },
};

const Shell = ({ children }: { children: ReactNode }) => (
  <ShortcutProvider>
    <TooltipProvider>{children}</TooltipProvider>
  </ShortcutProvider>
);

let itemId = "";
/** Syncs the pull request again with these facts. */
function syncFacts(overrides: Partial<CodeHostPullRequestFacts>) {
  localStore.syncPullRequests(
    {
      pluginId: "github",
      pluginName: "GitHub",
      connectionId: "work",
      connectionLabel: "Work",
    },
    {
      viewer: { login: "alex", isBot: false },
      pullRequests: [{ ...pullRequestFacts, ...overrides }],
    },
  );
}
beforeEach(() => {
  cachePluginsOverview(codeHostOverview);
  localStore.syncPullRequests(
    {
      pluginId: "github",
      pluginName: "GitHub",
      connectionId: "work",
      connectionLabel: "Work",
    },
    {
      viewer: { login: "alex", isBot: false },
      pullRequests: [pullRequestFacts],
    },
  );
  // A test that synced a second pull request leaves it in the store.
  itemId = localStore
    .snapshot()
    .pullRequests!.find((item) => item.facts.id === pullRequestFacts.id)!._id;
  observed.clear();
});

beforeEach(() => {
  vi.mocked(api.readPullRequestConversation).mockResolvedValue(CONVERSATION);
  vi.mocked(api.readPullRequestChecks).mockResolvedValue({ checks: [] });
  vi.mocked(api.readPullRequestVersions).mockResolvedValue({ versions: [] });
});

afterEach(() => {
  cleanup();
  // Viewed marks last (#785): each test starts with none.
  localStore.removeConnectionPullRequests("github", "work");
  vi.mocked(api.openDeckPullRequest).mockReset();
  vi.mocked(api.readPullRequestConversation).mockReset();
  vi.mocked(api.readPullRequestChecks).mockReset();
  window.matchMedia = originalMatchMedia;
  vi.restoreAllMocks();
});

async function renderReviewPage() {
  return await renderRoutes({
    shell: Shell,
    path: `/deck/${itemId}`,
    routes: { "/deck/$itemId": () => <DeckPage itemId={itemId} /> },
  });
}

/** Shows the Overview tab: the summary, the description and the conversation. */
async function showOverview() {
  fireEvent.click(await screen.findByRole("tab", { name: "Overview" }));
}

const reviewThread = (
  id: string,
  overrides: Partial<CodeHostReviewThread> = {},
): CodeHostReviewThread => ({
  id,
  path: "src/api.ts",
  side: "head",
  line: 2,
  resolved: false,
  outdated: false,
  comments: [
    {
      id: `${id}-1`,
      author: { login: "bob", displayName: "Bob", isBot: false },
      body: `Comment on ${id}`,
      createdAt: 20,
    },
  ],
  ...overrides,
});

/*
 * The dock, the peeks and the side panel (Status, Threads and Chat). Each
 * view peeks above its launcher; Pin moves it into the side panel as a tab,
 * the device remembers the pins, a tab's × unpins it, and » collapses the
 * panel while keeping them.
 */

beforeEach(() => {
  resetDeckPanelForTests();
  localStorage.removeItem(DECK_PANEL_STORAGE_KEY);
});

const dock = () => screen.getByRole("toolbar", { name: "Pull request" });

it("peeks Status above the dock, and closes it again from its launcher or ×", async () => {
  vi.mocked(api.openDeckPullRequest).mockResolvedValue(GUIDED);
  await renderReviewPage();

  const status = within(dock()).getByRole("button", { name: /^Status: / });
  fireEvent.click(status);
  const peek = await screen.findByRole("dialog", { name: "Status" });
  expect(within(peek).getByText("Waiting")).toBeTruthy();
  expect(within(peek).getByRole("button", { name: "Pin" })).toBeTruthy();

  fireEvent.click(within(peek).getByRole("button", { name: "Close Status" }));
  await waitFor(() =>
    expect(screen.queryByRole("dialog", { name: "Status" })).toBeNull(),
  );
  expect(screen.queryByRole("complementary", { name: /panel$/ })).toBeNull();
});

it("pins a view into the side panel, where pins add up as tabs, and remembers them on this device", async () => {
  vi.mocked(api.openDeckPullRequest).mockResolvedValue(GUIDED);
  await renderReviewPage();

  fireEvent.click(within(dock()).getByRole("button", { name: /^Status: / }));
  fireEvent.click(
    within(await screen.findByRole("dialog", { name: "Status" })).getByRole(
      "button",
      { name: "Pin" },
    ),
  );
  const panel = await screen.findByRole("complementary", {
    name: "Status panel",
  });
  expect(screen.queryByRole("dialog", { name: "Status" })).toBeNull();
  expect(within(panel).getByText("Requirements")).toBeTruthy();

  // Threads still peeks beside the panel, and pins as a second tab.
  fireEvent.click(within(dock()).getByRole("button", { name: /^Threads, / }));
  fireEvent.click(
    within(await screen.findByRole("dialog", { name: "Threads" })).getByRole(
      "button",
      { name: "Pin" },
    ),
  );
  const tabs = within(
    await screen.findByRole("complementary", { name: "Threads panel" }),
  ).getByRole("group", { name: "Pinned views" });
  expect(
    within(tabs)
      .getAllByRole("button", { pressed: false })
      .concat(within(tabs).getAllByRole("button", { pressed: true }))
      .map((tab) => tab.textContent),
  ).toEqual(["Status", "Threads"]);
  expect(
    JSON.parse(localStorage.getItem(DECK_PANEL_STORAGE_KEY) ?? "{}"),
  ).toEqual({ pins: ["status", "threads"], open: true, tab: "threads" });
});

it("collapses the panel and keeps its pins, and a pinned launcher opens it on its tab", async () => {
  vi.mocked(api.openDeckPullRequest).mockResolvedValue(GUIDED);
  setDeckPanel({ pins: ["status", "chat"], open: true, tab: "status" });
  await renderReviewPage();

  const panel = await screen.findByRole("complementary", {
    name: "Status panel",
  });
  fireEvent.click(
    within(panel).getByRole("button", { name: "Collapse the panel" }),
  );
  expect(screen.queryByRole("complementary", { name: /panel$/ })).toBeNull();

  // A pinned view's launcher opens the panel, not a peek.
  const status = within(dock()).getByRole("button", { name: /^Status: / });
  expect(within(status).getByLabelText("Pinned")).toBeTruthy();
  fireEvent.click(status);
  expect(
    await screen.findByRole("complementary", { name: "Status panel" }),
  ).toBeTruthy();
  expect(screen.queryByRole("dialog", { name: "Status" })).toBeNull();
  // Its launcher again collapses it.
  fireEvent.click(status);
  expect(screen.queryByRole("complementary", { name: /panel$/ })).toBeNull();
});

it("unpins a tab with its ×, and the view peeks again", async () => {
  vi.mocked(api.openDeckPullRequest).mockResolvedValue(GUIDED);
  setDeckPanel({ pins: ["status", "threads"], open: true, tab: "threads" });
  await renderReviewPage();

  const panel = await screen.findByRole("complementary", {
    name: "Threads panel",
  });
  fireEvent.click(within(panel).getByRole("button", { name: "Unpin Threads" }));
  expect(
    await screen.findByRole("complementary", { name: "Status panel" }),
  ).toBeTruthy();

  fireEvent.click(within(dock()).getByRole("button", { name: /^Threads, / }));
  expect(await screen.findByRole("dialog", { name: "Threads" })).toBeTruthy();

  fireEvent.click(
    within(
      screen.getByRole("complementary", { name: "Status panel" }),
    ).getByRole("button", { name: "Unpin Status" }),
  );
  await waitFor(() =>
    expect(screen.queryByRole("complementary", { name: /panel$/ })).toBeNull(),
  );
});

it("lists every thread and draft in Threads, open first, and shows one on its line in Changes", async () => {
  vi.mocked(api.openDeckPullRequest).mockResolvedValue(GUIDED);
  vi.mocked(api.readPullRequestConversation).mockResolvedValue({
    ...CONVERSATION,
    threads: [
      reviewThread("on-b", { line: 2, resolved: true }),
      reviewThread("on-y", { line: 41 }),
    ],
  });
  const scrolled = vi
    .spyOn(window, "scrollTo")
    .mockImplementation(() => undefined);
  await renderReviewPage();
  await screen.findByRole("heading", { name: "Concern 1: Handle the request" });
  await showOverview();

  const launcher = within(dock()).getByRole("button", {
    name: /^Threads, /,
  });
  await waitFor(() =>
    expect(launcher.getAttribute("aria-label")).toBe("Threads, 1 to look at"),
  );
  fireEvent.click(launcher);
  const peek = await screen.findByRole("dialog", { name: "Threads" });
  const entries = within(peek).getAllByRole("listitem");
  expect(entries.map((entry) => entry.textContent)).toEqual([
    expect.stringContaining("src/api.ts:41"),
    expect.stringContaining("src/api.ts:2"),
  ]);

  fireEvent.click(within(entries[0]!).getByRole("button"));
  // Changes shows, and the thread's hunk is reached.
  await waitFor(() =>
    expect((document.activeElement as HTMLElement).dataset.hunkId).toBe(
      "src/api.ts#1",
    ),
  );
  expect(screen.getByRole("tab", { name: /^Changes/ })).toHaveProperty(
    "ariaSelected",
    "true",
  );
  expect(scrolled).toHaveBeenCalled();
});

it("shows an outdated thread on its line when the diff still has that line", async () => {
  vi.mocked(api.openDeckPullRequest).mockResolvedValue(GUIDED);
  vi.mocked(api.readPullRequestConversation).mockResolvedValue({
    ...CONVERSATION,
    threads: [reviewThread("old", { line: 41, outdated: true })],
  });
  vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
  await renderReviewPage();
  await screen.findByRole("heading", { name: "Concern 1: Handle the request" });
  await showOverview();

  fireEvent.click(within(dock()).getByRole("button", { name: /^Threads, / }));
  const peek = await screen.findByRole("dialog", { name: "Threads" });
  const [entry] = within(peek).getAllByRole("listitem");
  expect(entry!.textContent).toContain("src/api.ts:41");
  fireEvent.click(within(entry!).getByRole("button"));
  await waitFor(() =>
    expect(screen.getByRole("tab", { name: /^Changes/ })).toHaveProperty(
      "ariaSelected",
      "true",
    ),
  );
});

it("moves to Changes when J is pressed on Overview", async () => {
  vi.mocked(api.openDeckPullRequest).mockResolvedValue(GUIDED);
  await renderReviewPage();
  await screen.findByRole("heading", { name: "Concern 1: Handle the request" });
  await showOverview();
  expect(screen.queryByRole("region", { name: "Changes" })).toBeNull();

  fireEvent.keyDown(window, { key: "j" });

  expect(await screen.findByRole("region", { name: "Changes" })).toBeTruthy();
});

it("puts the breadcrumb in the top bar, and the other actions in the title's More actions menu", async () => {
  vi.mocked(api.openDeckPullRequest).mockResolvedValue(GUIDED);
  await renderReviewPage();
  await screen.findByRole("heading", { name: "Concern 1: Handle the request" });

  const crumbs = screen.getByRole("navigation", { name: "Breadcrumb" });
  expect(within(crumbs).getByRole("link", { name: "Deck" })).toBeTruthy();
  expect(within(crumbs).getByText("api #1")).toBeTruthy();
  expect(screen.queryByRole("link", { name: "Back to Deck" })).toBeNull();
  expect(screen.getByRole("button", { name: "Finish review" })).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: "More actions" }));
  await waitFor(() =>
    expect(
      screen.getAllByRole("menuitem").map((item) => item.textContent),
    ).toEqual([expect.stringContaining("Open in GitHub"), "Settle", "Snooze…"]),
  );
});
