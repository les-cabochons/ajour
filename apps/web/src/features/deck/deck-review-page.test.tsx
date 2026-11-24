// @vitest-environment jsdom
import type { ReactNode } from "react";
import {
  act,
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
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
import { DECK_GUTTER_QUERY } from "@/lib/breakpoints";
import { localStore } from "@/lib/local-store";
import { installDomShims, renderRoutes } from "@/test-support/dom";
import {
  codeHostOverview,
  pullRequestFacts,
} from "../../../tests/fixtures/pull-requests";
import { DeckPage } from "./deck-page";

/*
 * Deck's review page at /deck/$itemId (#779, #782): the pull request's
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
}));
vi.mock("@pierre/diffs/react", () => ({
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

/** Makes the window as wide as Deck's gutter needs, or narrower. */
function windowWideEnoughForTheGutter(wide: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: query === DECK_GUTTER_QUERY ? wide : false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}

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
    concerns: [
      {
        id: "g1",
        title: "Handle the request",
        rationale: "The handler and the export it reads.",
        hunkIds: ["src/api.ts#1", "src/new.ts#0"],
      },
      {
        id: "mechanical",
        title: "Mechanical changes",
        rationale: "1 binary. Nothing to review line by line.",
        hunkIds: ["assets/logo.png#0", "src/api.ts#0"],
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
  itemId = localStore.snapshot().pullRequests![0]!._id;
  observed.clear();
});

beforeEach(() => {
  vi.mocked(api.readPullRequestConversation).mockResolvedValue(CONVERSATION);
  vi.mocked(api.readPullRequestChecks).mockResolvedValue({ checks: [] });
});

afterEach(() => {
  cleanup();
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

it("opens the pull request and shows its title and every hunk, files A–Z, without a guide", async () => {
  vi.mocked(api.openDeckPullRequest).mockResolvedValue(DIFF);

  await renderReviewPage();

  expect(
    screen.getByRole("heading", { level: 1, name: "Fix request handling" }),
  ).toBeTruthy();
  const changes = screen.getByRole("region", { name: "Changes" });
  await within(changes).findByRole("heading", { name: "src/api.ts" });
  expect(within(changes).getByRole("heading", { level: 2 }).textContent).toBe(
    "Files3",
  );
  expect(
    within(changes).getByText(
      "The guide couldn't be built, so the files show A–Z.",
    ),
  ).toBeTruthy();
  expect(within(changes).queryByRole("group", { name: "Order" })).toBeNull();
  expect(
    within(changes)
      .getAllByRole("heading", { level: 3 })
      .map((heading) => heading.textContent),
  ).toEqual(["assets/logo.png", "src/api.ts", "src/new.ts"]);
  expect(
    within(changes)
      .getAllByRole("group")
      .map((group) => group.getAttribute("aria-label")),
  ).toEqual([
    "src/api.ts, lines 1 to 3",
    "src/api.ts, lines 40 to 42",
    "src/new.ts, line 1",
  ]);
  expect(
    within(changes).getByText(
      "Not shown: a binary file, or one too large to read.",
    ),
  ).toBeTruthy();
  expect(within(changes).getByText("Added")).toBeTruthy();
  expect(api.openDeckPullRequest).toHaveBeenCalledWith("github", "work", {
    repository: "acme/api",
    number: 1,
  });
});

it("mounts nothing per line at rest, and draws a hunk with wrapped lines once it nears the screen", async () => {
  vi.mocked(api.openDeckPullRequest).mockResolvedValue(DIFF);
  await renderReviewPage();
  const changes = screen.getByRole("region", { name: "Changes" });
  await within(changes).findByRole("heading", { name: "src/api.ts" });
  const hunks = within(changes).getAllByRole("group");

  // One observer, made once for the window, watches every hunk, and no
  // hunk drew a line.
  expect(observers).toBe(1);
  expect(observed.size).toBe(3);
  expect(changes.querySelector("pre")).toBeNull();

  bringOnScreen(hunks[1]!);

  const drawn = await within(hunks[1]!).findByText(/\+y/);
  expect(drawn.textContent).toBe(
    [
      "diff --git a/src/api.ts b/src/api.ts",
      "--- a/src/api.ts",
      "+++ b/src/api.ts",
      "@@ -40,2 +40,3 @@",
      " x",
      "+y",
      " z",
      "",
    ].join("\n"),
  );
  expect(drawn.getAttribute("data-overflow")).toBe("wrap");
  expect(hunks[0]!.querySelector("pre")).toBeNull();
  expect(observed.size).toBe(2);
});

it("says the changes are loading until the local API answers", async () => {
  let answer!: (diff: DeckOpenedPullRequest) => void;
  vi.mocked(api.openDeckPullRequest).mockReturnValue(
    new Promise((resolve) => {
      answer = resolve;
    }),
  );

  await renderReviewPage();

  expect(screen.getByRole("status").textContent).toBe("Loading the changes…");
  await act(async () => answer(DIFF));
  expect(screen.queryByRole("status")).toBeNull();
  expect(screen.getByRole("heading", { name: "src/api.ts" })).toBeTruthy();
});

it("shows why the changes could not be read, and tries again on Retry", async () => {
  vi.mocked(api.openDeckPullRequest)
    .mockRejectedValueOnce(new AppApiError("GitHub request failed (500).", 502))
    .mockResolvedValueOnce(DIFF);

  await renderReviewPage();

  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toContain("GitHub request failed (500).");
  fireEvent.click(within(alert).getByRole("button", { name: "Retry" }));

  await waitFor(() =>
    expect(screen.getByRole("heading", { name: "src/api.ts" })).toBeTruthy(),
  );
  expect(api.openDeckPullRequest).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole("alert")).toBeNull();
});

it("says the code host doesn't show changes yet, with nothing to retry", async () => {
  vi.mocked(api.openDeckPullRequest).mockRejectedValue(
    new AppApiError(
      "Azure DevOps doesn't show a pull request's changes yet.",
      404,
      undefined,
      {
        error: "Azure DevOps doesn't show a pull request's changes yet.",
        reason: "not_supported",
      },
    ),
  );

  await renderReviewPage();

  const changes = screen.getByRole("region", { name: "Changes" });
  expect(
    await within(changes).findByText(
      "Azure DevOps doesn't show a pull request's changes yet.",
    ),
  ).toBeTruthy();
  expect(screen.queryByRole("alert")).toBeNull();
  expect(within(changes).queryByRole("button", { name: "Retry" })).toBeNull();
});

it("reads the status line, with the checks and the approvals each in a small menu", async () => {
  syncFacts({
    checks: "pending",
    approvals: [
      {
        reviewer: { login: "bob", displayName: "Bob", isBot: false },
        vote: "approved",
      },
      {
        reviewer: { login: "carol", isBot: false },
        vote: "none",
        required: true,
      },
    ],
  });
  vi.mocked(api.openDeckPullRequest).mockResolvedValue(DIFF);
  vi.mocked(api.readPullRequestChecks).mockResolvedValue({
    checks: [
      { name: "build", state: "success", url: "https://ci.example.test/1" },
      { name: "test", state: "pending" },
      { name: "lint", state: "pending" },
    ],
  });
  const open = vi.spyOn(window, "open").mockReturnValue(null);

  await renderReviewPage();

  const checks = await screen.findByRole("button", {
    name: "Checks: 2 checks pending",
  });
  const line = checks.closest("p")!;
  expect(line.textContent).toBe("Open·2 checks pending·1 approval");
  // Only the pending mark takes a color: the warning ring.
  expect(line.querySelector(".deck-status-pending")).toBeTruthy();
  expect(api.readPullRequestChecks).toHaveBeenCalledWith("github", "work", {
    repository: "acme/api",
    number: 1,
  });

  fireEvent.click(checks);
  const checkItems = await screen.findAllByRole("menuitem");
  expect(checkItems.map((item) => item.textContent)).toEqual([
    "buildPassed",
    "testPending",
    "lintPending",
  ]);
  fireEvent.click(checkItems[0]!);
  expect(open).toHaveBeenCalledWith(
    "https://ci.example.test/1",
    "_blank",
    "noopener,noreferrer",
  );

  fireEvent.click(
    screen.getByRole("button", { name: "Approvals: 1 approval" }),
  );
  await waitFor(() =>
    expect(
      screen.getAllByRole("menuitem").map((item) => item.textContent),
    ).toEqual(["BobApproved", "carolNo vote yet · Required"]),
  );
});

it("reads the synced checks until the code host lists each one, and says when it can't", async () => {
  vi.mocked(api.openDeckPullRequest).mockResolvedValue(DIFF);
  vi.mocked(api.readPullRequestChecks).mockRejectedValue(
    new AppApiError("GitHub doesn't offer this yet.", 404, undefined, {
      error: "GitHub doesn't offer this yet.",
      reason: "not_supported",
    }),
  );

  await renderReviewPage();

  const checks = await screen.findByRole("button", {
    name: "Checks: Checks passed",
  });
  fireEvent.click(checks);
  expect(
    await screen.findByText("This code host doesn't list its checks yet."),
  ).toBeTruthy();
});

it("keeps the description in a drawer, closed until the user opens it", async () => {
  vi.mocked(api.openDeckPullRequest).mockResolvedValue(DIFF);
  vi.mocked(api.readPullRequestConversation).mockResolvedValue({
    ...CONVERSATION,
    description: "Retries stop on **410**.",
  });

  await renderReviewPage();

  const toggle = screen.getByRole("button", { name: "Description" });
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
  await screen.findByRole("heading", { name: "src/api.ts" });
  expect(screen.queryByText(/Retries stop on/)).toBeNull();

  fireEvent.click(toggle);

  expect(toggle.getAttribute("aria-expanded")).toBe("true");
  expect(await screen.findByText(/Retries stop on/)).toBeTruthy();
});

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

/**
 * Lays the page out as a browser would, in the grid's coordinates: each hunk
 * box 100px below the last, from 100px, 600px wide, a drawn thread's anchor
 * at 160px, and each card 60px tall. Returns a log of the layout reads.
 */
function layOut() {
  const log: string[] = [];
  const rect = (top: number, left = 0, width = 600, height = 40) =>
    ({
      top,
      left,
      width,
      height,
      right: left + width,
      bottom: top + height,
      x: left,
      y: top,
    }) as DOMRect;
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
    function (this: Element) {
      log.push("read");
      if (this.matches("[data-thread-anchor]")) return rect(160);
      if (this.matches("[data-hunk]")) {
        const boxes = [...document.querySelectorAll("[data-hunk]")];
        return rect(100 + boxes.indexOf(this) * 100);
      }
      if (this.matches(".deck-gutter")) return rect(0, 620, 272);
      return rect(0, 0, 892);
    },
  );
  vi.spyOn(Element.prototype, "getClientRects").mockImplementation(function (
    this: Element,
  ) {
    log.push("read");
    return (this.matches("[data-thread-anchor]")
      ? [rect(160)]
      : []) as unknown as DOMRectList;
  });
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(
    () => {
      log.push("read");
      return 60;
    },
  );
  return log;
}

it("floats each thread in the gutter beside its line from 1,100px, and places it again once its hunk mounts", async () => {
  windowWideEnoughForTheGutter(true);
  const log = layOut();
  // Each card's connector is written in the write pass, beside its top.
  const setAttribute = Element.prototype.setAttribute;
  vi.spyOn(Element.prototype, "setAttribute").mockImplementation(function (
    this: Element,
    name: string,
    value: string,
  ) {
    if (name === "d" && this.hasAttribute("data-connector")) log.push("write");
    setAttribute.call(this, name, value);
  });
  vi.mocked(api.openDeckPullRequest).mockResolvedValue(DIFF);
  vi.mocked(api.readPullRequestConversation).mockResolvedValue({
    ...CONVERSATION,
    threads: [
      reviewThread("on-b", { line: 2 }),
      reviewThread("on-y", { line: 41 }),
      reviewThread("outdated", { line: undefined, outdated: true }),
    ],
  });

  await renderReviewPage();

  const gutter = await screen.findByRole("complementary", {
    name: "Review threads",
  });
  const cards = within(gutter).getAllByRole("article");
  expect(cards.map((card) => card.getAttribute("aria-label"))).toEqual([
    "Thread on src/api.ts, line 2",
    "Thread on src/api.ts, line 41",
  ]);
  const card = (id: string) =>
    gutter.querySelector<HTMLElement>(`[data-card="${id}"]`)!;
  // Before the hunks mount, each card is level with its row: the first
  // hunk's box at 100px, line 2 (+B) on its row 2 of 20px, inside the 1px
  // border, its middle at 151px and the card 14px above.
  expect(card("on-b").style.top).toBe("137px");
  // The second hunk's box is at 200px, line 41 (+y) on its row 1, its middle
  // at 231px. The first card ends at 197px, so this one is level too.
  expect(card("on-y").style.top).toBe("217px");
  // A placement measures everything, then moves everything: one read pass,
  // then one write pass.
  expect(log.join(" ")).toMatch(/^(read )+write write$/);
  const connector = document.querySelector("[data-connector='on-b']");
  expect(connector?.getAttribute("d")).toBe("M600 151 H610 V151 H620");
  // The thread the diff can't show is in the conversation instead.
  const conversation = screen.getByRole("heading", {
    name: "Conversation",
  }).parentElement!;
  expect(
    within(conversation).getByRole("article", {
      name: "Thread on src/api.ts",
    }),
  ).toBeTruthy();

  // Drawn, the first hunk marks the line its thread follows, at 160px, and
  // the card moves level with the line above it: its middle at 150px.
  log.length = 0;
  const hunks = within(
    screen.getByRole("region", { name: "Changes" }),
  ).getAllByRole("group");
  bringOnScreen(hunks[0]!);
  await waitFor(() => expect(card("on-b").style.top).toBe("136px"));
  expect(hunks[0]!.querySelector("[data-thread-anchor='on-b']")).toBeTruthy();
  expect(within(hunks[0]!).queryByRole("article")).toBeNull();
  expect(log.join(" ")).toMatch(/^((read )+write write ?)+$/);

  // Hovering a card highlights its line, and its connector.
  fireEvent.mouseEnter(within(card("on-b")).getByRole("article"));
  expect(
    hunks[0]!.querySelector("[data-selected]")?.getAttribute("data-selected"),
  ).toBe("additions 2-2");
  expect(connector?.hasAttribute("data-hot")).toBe(true);
  fireEvent.mouseLeave(within(card("on-b")).getByRole("article"));
  expect(hunks[0]!.querySelector("[data-selected]")).toBeNull();
});

it("puts each thread after its line below 1,100px, with no gutter", async () => {
  windowWideEnoughForTheGutter(false);
  vi.mocked(api.openDeckPullRequest).mockResolvedValue(DIFF);
  vi.mocked(api.readPullRequestConversation).mockResolvedValue({
    ...CONVERSATION,
    threads: [reviewThread("on-b", { side: "base", line: 2 })],
  });

  await renderReviewPage();

  const changes = screen.getByRole("region", { name: "Changes" });
  await within(changes).findByRole("heading", { name: "src/api.ts" });
  expect(
    screen.queryByRole("complementary", { name: "Review threads" }),
  ).toBeNull();
  const hunks = within(changes).getAllByRole("group");
  bringOnScreen(hunks[0]!);

  const thread = await within(hunks[0]!).findByRole("article", {
    name: "Thread on src/api.ts, removed line 2",
  });
  expect(thread.closest("[data-after]")?.getAttribute("data-after")).toBe(
    "deletions 2",
  );
  expect(thread.textContent).toContain("Comment on on-b");

  fireEvent.mouseEnter(thread);
  expect(
    hunks[0]!.querySelector("[data-selected]")?.getAttribute("data-selected"),
  ).toBe("deletions 2-2");
  fireEvent.mouseLeave(thread);
  expect(hunks[0]!.querySelector("[data-selected]")).toBeNull();

  // The keyboard reaches a card too, and focusing it highlights its line.
  expect(thread.tabIndex).toBe(0);
  act(() => thread.focus());
  expect(
    hunks[0]!.querySelector("[data-selected]")?.getAttribute("data-selected"),
  ).toBe("deletions 2-2");
});

it("ends with the conversation: the timeline in time order", async () => {
  vi.mocked(api.openDeckPullRequest).mockResolvedValue(DIFF);
  vi.mocked(api.readPullRequestConversation).mockResolvedValue({
    ...CONVERSATION,
    timeline: [
      {
        kind: "event",
        id: "opened",
        actor: { login: "author", isBot: false },
        text: "opened this pull request",
        createdAt: 1,
      },
      {
        kind: "commit",
        sha: "abc1234567",
        headline: "Stop on 410",
        authorName: "Author",
        createdAt: 2,
      },
      {
        kind: "review",
        id: "r1",
        author: { login: "bob", displayName: "Bob", isBot: false },
        verdict: "approved",
        body: "Looks right.",
        createdAt: 3,
      },
    ],
  });

  await renderReviewPage();

  const heading = await screen.findByRole("heading", { name: "Conversation" });
  const conversation = heading.parentElement!;
  await waitFor(() =>
    expect(within(conversation).getAllByRole("listitem")).toHaveLength(3),
  );
  const lines = within(conversation)
    .getAllByRole("listitem")
    .map(
      (item) => item.querySelector(".deck-timeline-line")?.textContent ?? "",
    );
  expect(lines[0]).toMatch(/^authoropened this pull request/);
  expect(lines[1]).toMatch(/^Authorcommitted abc1234 Stop on 410/);
  expect(lines[2]).toMatch(/^Bobapproved/);
  expect(within(conversation).getByText("Looks right.")).toBeTruthy();
  // The conversation comes after the changes.
  const changes = screen.getByRole("region", { name: "Changes" });
  expect(
    changes.compareDocumentPosition(conversation) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
});

/** The page's hunks, by the names they give assistive technology. */
const hunkNames = (changes: HTMLElement) =>
  within(changes)
    .getAllByRole("group")
    .map((group) => group.getAttribute("aria-label"))
    .filter((name) => name !== "Order");

async function openGuided() {
  vi.mocked(api.openDeckPullRequest).mockResolvedValue(GUIDED);
  await renderReviewPage();
  const changes = screen.getByRole("region", { name: "Changes" });
  await within(changes).findByRole("heading", {
    name: "Concern 1: Handle the request",
  });
  return changes;
}

/**
 * Lays the review page's sections out 600px apart under a scroller at the
 * top of the window, and scrolls them as `scrollIntoView` asks, since jsdom
 * has no layout. Returns the section scrolled to last.
 */
function layOutSections(changes: HTMLElement) {
  let scrolled = 0;
  const sections = [
    ...changes.querySelectorAll<HTMLElement>("[data-review-section]"),
  ];
  sections.forEach((section, index) => {
    section.getBoundingClientRect = () =>
      ({ top: 100 + index * 600 - scrolled }) as DOMRect;
    section.scrollIntoView = () => {
      scrolled = 100 + index * 600 - 16;
    };
  });
  return () =>
    sections.findIndex((section) => section.getBoundingClientRect().top === 16);
}

const press = (key: string) => fireEvent.keyDown(window, { key });

it("shows the guide's concerns in reading order, numbered, with their rationale, built from the code", async () => {
  const changes = await openGuided();

  expect(within(changes).getByRole("heading", { level: 2 }).textContent).toBe(
    "Guide2",
  );
  expect(within(changes).getByText("Built from the code")).toBeTruthy();
  expect(
    within(changes)
      .getAllByRole("heading", { level: 3 })
      .map((heading) => heading.textContent),
  ).toEqual(["Concern 1: Handle the request", "Concern 2: Mechanical changes"]);
  expect(
    within(changes).getByText("The handler and the export it reads."),
  ).toBeTruthy();
  // A concern's hunks come in its order, each after its file's path.
  expect(hunkNames(changes)).toEqual([
    "src/api.ts, lines 40 to 42",
    "src/new.ts, line 1",
    "src/api.ts, lines 1 to 3",
  ]);
  const first = screen.getByRole("region", {
    name: "Concern 1: Handle the request",
  });
  expect(within(first).getByText("src/new.ts")).toBeTruthy();
  expect(within(first).getByText("Added")).toBeTruthy();
});

it("switches to Files A–Z and back to the guide", async () => {
  const changes = await openGuided();
  const order = within(changes).getByRole("group", { name: "Order" });

  fireEvent.click(within(order).getByRole("button", { name: "Files A–Z" }));

  expect(within(changes).getByRole("heading", { level: 2 }).textContent).toBe(
    "Files3",
  );
  expect(
    within(changes)
      .getAllByRole("heading", { level: 3 })
      .map((heading) => heading.textContent),
  ).toEqual(["assets/logo.png", "src/api.ts", "src/new.ts"]);
  expect(within(changes).queryByText("Built from the code")).toBeNull();

  fireEvent.click(within(order).getByRole("button", { name: "Guide" }));

  expect(
    within(changes).getAllByRole("heading", { level: 3 })[0]!.textContent,
  ).toBe("Concern 1: Handle the request");
});

it("moves to the next and previous concern with J and K", async () => {
  const changes = await openGuided();
  const reached = layOutSections(changes);

  press("j");
  expect(reached()).toBe(0);
  expect(document.activeElement?.textContent).toBe(
    "Concern 1: Handle the request",
  );
  press("j");
  expect(reached()).toBe(1);
  expect(document.activeElement?.textContent).toBe(
    "Concern 2: Mechanical changes",
  );
  // The last concern: J stays.
  press("j");
  expect(reached()).toBe(1);
  press("k");
  expect(reached()).toBe(0);
  // Shift, a modifier or a text field keep the keys for themselves.
  fireEvent.keyDown(window, { key: "J", shiftKey: true });
  fireEvent.keyDown(window, { key: "j", ctrlKey: true });
  expect(reached()).toBe(0);
});

it("opens the guide tree's titles with F, and closes them again", async () => {
  const changes = await openGuided();
  const tree = within(changes).getByRole("navigation", { name: "Guide tree" });
  expect(
    within(tree)
      .getAllByRole("button")
      .map((button) => button.getAttribute("aria-label")),
  ).toEqual([
    "Show the guide tree",
    "1. Handle the request · 0 of 2 viewed",
    "2. Mechanical changes · 0 of 2 viewed",
  ]);

  press("f");

  expect(
    within(tree)
      .getByRole("button", { name: "Hide the guide tree" })
      .getAttribute("aria-expanded"),
  ).toBe("true");
  expect(within(tree).getByText("Handle the request")).toBeTruthy();
  expect(within(tree).getByText("Mechanical changes")).toBeTruthy();

  press("f");

  expect(within(tree).queryByText("Handle the request")).toBeNull();
  expect(
    within(tree).getByRole("button", { name: "Show the guide tree" }),
  ).toBeTruthy();
});

it("fills a concern's tick as its hunks are marked viewed, and folds them", async () => {
  const changes = await openGuided();
  const tree = within(changes).getByRole("navigation", { name: "Guide tree" });

  fireEvent.click(
    within(changes).getByRole("button", {
      name: "Viewed: src/api.ts, lines 40 to 42",
    }),
  );

  expect(
    within(tree).getByRole("button", {
      name: "1. Handle the request · 1 of 2 viewed",
    }),
  ).toBeTruthy();
  expect(hunkNames(changes)).toEqual([
    "src/new.ts, line 1",
    "src/api.ts, lines 1 to 3",
  ]);
  const first = screen.getByRole("region", {
    name: "Concern 1: Handle the request",
  });
  expect(within(first).getByText("1/2")).toBeTruthy();

  fireEvent.click(
    within(changes).getByRole("button", { name: "Viewed: src/new.ts, line 1" }),
  );
  expect(
    within(tree).getByRole("button", {
      name: "1. Handle the request · 2 of 2 viewed",
    }),
  ).toBeTruthy();

  // Unmarking it draws it again.
  fireEvent.click(
    within(changes).getByRole("button", {
      name: "Viewed: src/api.ts, lines 40 to 42",
    }),
  );
  expect(hunkNames(changes)[0]).toBe("src/api.ts, lines 40 to 42");
});

it("scrolls to a concern from its tick", async () => {
  const changes = await openGuided();
  const reached = layOutSections(changes);
  const tree = within(changes).getByRole("navigation", { name: "Guide tree" });

  fireEvent.click(
    within(tree).getByRole("button", {
      name: "2. Mechanical changes · 0 of 2 viewed",
    }),
  );

  expect(reached()).toBe(1);
});

it("floats each thread beside its line in its concern, and hides it while its hunk is folded as viewed", async () => {
  windowWideEnoughForTheGutter(true);
  layOut();
  vi.mocked(api.readPullRequestConversation).mockResolvedValue({
    ...CONVERSATION,
    threads: [
      reviewThread("on-b", { line: 2 }),
      reviewThread("on-y", { line: 41 }),
    ],
  });
  const changes = await openGuided();

  const gutter = await screen.findByRole("complementary", {
    name: "Review threads",
  });
  const card = (id: string) =>
    gutter.querySelector<HTMLElement>(`[data-card="${id}"]`)!;
  // In reading order, concern 1's src/api.ts, lines 40 to 42 is the first
  // box, at 100px: line 41 on its row 1, its middle at 131px. Concern 2's
  // src/api.ts, lines 1 to 3 is the third, at 300px: line 2 on its row 2.
  expect(card("on-y").style.top).toBe("117px");
  expect(card("on-b").style.top).toBe("337px");
  expect(card("on-y").hasAttribute("data-placed")).toBe(true);

  fireEvent.click(
    within(changes).getByRole("button", {
      name: "Viewed: src/api.ts, lines 40 to 42",
    }),
  );

  // Its line is folded away, so its card hides; the other moves up with
  // its box, now the second, at 200px.
  await waitFor(() =>
    expect(card("on-y").hasAttribute("data-placed")).toBe(false),
  );
  expect(card("on-b").style.top).toBe("237px");
  expect(
    document.querySelector("[data-connector='on-y']")?.hasAttribute("d"),
  ).toBe(false);

  // In Files A–Z the same threads follow their file's hunks.
  fireEvent.click(
    within(changes).getByRole("button", {
      name: "Viewed: src/api.ts, lines 40 to 42",
    }),
  );
  fireEvent.click(within(changes).getByRole("button", { name: "Files A–Z" }));
  await waitFor(() => expect(card("on-b").style.top).toBe("137px"));
  expect(card("on-y").style.top).toBe("217px");
});
