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
    headSha: "one",
  });
});

it("says the guide isn't built for a pull request with too many hunks, and shows its files A–Z", async () => {
  vi.mocked(api.openDeckPullRequest).mockResolvedValue({
    ...DIFF,
    guideSkipped: { reason: "too_many_hunks", hunkLimit: 1_000 },
  });

  await renderReviewPage();

  const changes = screen.getByRole("region", { name: "Changes" });
  await within(changes).findByRole("heading", { name: "src/api.ts" });
  expect(within(changes).getByRole("heading", { level: 2 }).textContent).toBe(
    "Files3",
  );
  expect(
    within(changes).getByText(
      "This pull request has more than 1,000 hunks, too many to build a guide, so the files show A–Z.",
    ),
  ).toBeTruthy();
  expect(
    within(changes).queryByText(
      "The guide couldn't be built, so the files show A–Z.",
    ),
  ).toBeNull();
  expect(within(changes).queryByRole("group", { name: "Order" })).toBeNull();
});

it("shows a file too large to compare with its line counts and a link to it on the code host", async () => {
  vi.mocked(api.openDeckPullRequest).mockResolvedValue({
    ...DIFF,
    files: [
      {
        path: "pnpm-lock.yaml",
        status: "modified",
        binary: false,
        tooLarge: { oldLines: 4_200, newLines: 4_210 },
        hunks: [hunk("pnpm-lock.yaml#0", "", [])],
      },
      DIFF.files[1]!,
    ],
  });

  await renderReviewPage();

  const changes = screen.getByRole("region", { name: "Changes" });
  await within(changes).findByRole("heading", { name: "pnpm-lock.yaml" });
  expect(
    within(changes).getByText(
      "Not shown: too large to compare here, 4,200 lines before and 4,210 after.",
    ),
  ).toBeTruthy();
  // The pull request's files, at the file: there it shows what changed.
  const link = within(changes).getByRole("link", { name: "Open in GitHub" });
  await waitFor(() =>
    expect(link.getAttribute("href")).toBe(
      "https://github.com/acme/api/pull/1/files#diff-32824c984905bb02bc7ffcef96a77addd1f1602cff71a11fbbfdd7f53ee026bb",
    ),
  );
  // The rest of the pull request shows as usual.
  expect(
    within(changes).getByRole("group", { name: "src/api.ts, lines 1 to 3" }),
  ).toBeTruthy();
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

it("says to update a plugin that doesn't read changes, links Settings › Plugins, and offers nothing to retry", async () => {
  vi.mocked(api.openDeckPullRequest).mockRejectedValue(
    new AppApiError(
      "Update the Azure DevOps plugin in Settings › Plugins to review pull requests in Deck.",
      404,
      undefined,
      {
        error:
          "Update the Azure DevOps plugin in Settings › Plugins to review pull requests in Deck.",
        reason: "not_supported",
      },
    ),
  );

  await renderReviewPage();

  const changes = screen.getByRole("region", { name: "Changes" });
  expect(
    await within(changes).findByText(
      "Update the Azure DevOps plugin in Settings › Plugins to review pull requests in Deck.",
    ),
  ).toBeTruthy();
  expect(
    within(changes).getByRole("link", { name: "Open Settings › Plugins" }),
  ).toBeTruthy();
  expect(screen.queryByRole("alert")).toBeNull();
  expect(within(changes).queryByRole("button", { name: "Retry" })).toBeNull();
});

it("says to update a plugin that doesn't read the conversation, with Settings › Plugins", async () => {
  vi.mocked(api.openDeckPullRequest).mockResolvedValue(DIFF);
  vi.mocked(api.readPullRequestConversation).mockRejectedValue(
    new AppApiError(
      "Update the GitHub plugin in Settings › Plugins to see a pull request's conversation in Deck.",
      404,
      undefined,
      {
        error:
          "Update the GitHub plugin in Settings › Plugins to see a pull request's conversation in Deck.",
        reason: "not_supported",
      },
    ),
  );

  await renderReviewPage();
  await showOverview();

  const conversation = await screen.findByRole("region", {
    name: "Conversation",
  });
  expect(
    await within(conversation).findByText(
      "Update the GitHub plugin in Settings › Plugins to see a pull request's conversation in Deck.",
    ),
  ).toBeTruthy();
  expect(
    within(conversation).getByRole("link", {
      name: "Open Settings › Plugins",
    }),
  ).toBeTruthy();
});

it("reads the merge state in the dock, and opens Status on each requirement, check and reviewer", async () => {
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

  const dock = screen.getByRole("toolbar", { name: "Pull request" });
  const status = within(dock).getByRole("button", { name: /^Status: / });
  await waitFor(() =>
    expect(status.getAttribute("aria-label")).toBe(
      "Status: Waiting, No conflicts with its base branch, 2 checks pending, Waiting for carol",
    ),
  );
  // Pending marks are warning rings; nothing failed.
  expect(status.querySelector(".deck-status-pending")).toBeTruthy();
  expect(api.readPullRequestChecks).toHaveBeenCalledWith("github", "work", {
    repository: "acme/api",
    number: 1,
  });

  fireEvent.click(status);
  const peek = await screen.findByRole("dialog", { name: "Status" });
  expect(
    within(within(peek).getByRole("region", { name: "Requirements" }))
      .getAllByRole("listitem")
      .map((item) => item.textContent),
  ).toEqual([
    "No conflicts with its base branch",
    "2 checks pending",
    "Waiting for carol",
  ]);
  const checks = within(peek).getByRole("region", { name: "Checks" });
  const checkItems = within(checks).getAllByRole("button");
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
  expect(
    within(within(peek).getByRole("region", { name: "Reviewers" }))
      .getAllByRole("listitem")
      .map((item) => item.textContent),
  ).toEqual(["BobApproved", "carolRequiredNo vote yet"]);
});

it("reads the synced checks until the code host lists each one, and says when it can't", async () => {
  vi.mocked(api.openDeckPullRequest).mockResolvedValue(DIFF);
  vi.mocked(api.readPullRequestChecks).mockRejectedValue(
    new AppApiError(
      "Update the GitHub plugin in Settings › Plugins to see a pull request's checks in Deck.",
      404,
      undefined,
      {
        error:
          "Update the GitHub plugin in Settings › Plugins to see a pull request's checks in Deck.",
        reason: "not_supported",
      },
    ),
  );

  await renderReviewPage();

  const status = screen.getByRole("button", { name: /^Status: / });
  expect(status.getAttribute("aria-label")).toContain("Checks passed");
  fireEvent.click(status);
  const peek = await screen.findByRole("dialog", { name: "Status" });
  expect(
    await within(peek).findByText(
      "Update the GitHub plugin in Settings › Plugins to see a pull request's checks in Deck.",
    ),
  ).toBeTruthy();
  expect(
    within(peek).getByRole("link", { name: "Open Settings › Plugins" }),
  ).toBeTruthy();
});

it("keeps the description in a drawer, closed until the user opens it", async () => {
  vi.mocked(api.openDeckPullRequest).mockResolvedValue(DIFF);
  vi.mocked(api.readPullRequestConversation).mockResolvedValue({
    ...CONVERSATION,
    description: "Retries stop on **410**.",
  });

  await renderReviewPage();
  await screen.findByRole("heading", { name: "src/api.ts" });
  await showOverview();

  const toggle = screen.getByRole("button", { name: "Description" });
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
  expect(screen.queryByText(/Retries stop on/)).toBeNull();

  fireEvent.click(toggle);

  expect(toggle.getAttribute("aria-expanded")).toBe("true");
  expect(await screen.findByText(/Retries stop on/)).toBeTruthy();
});

it("opens the next pull request with its drawer closed and nothing viewed, after the last one's were open", async () => {
  vi.mocked(api.openDeckPullRequest).mockResolvedValue(GUIDED);
  vi.mocked(api.readPullRequestConversation).mockResolvedValue({
    ...CONVERSATION,
    description: "Retries stop on **410**.",
  });
  localStore.syncPullRequests(
    {
      pluginId: "github",
      pluginName: "GitHub",
      connectionId: "work",
      connectionLabel: "Work",
    },
    {
      viewer: { login: "alex", isBot: false },
      pullRequests: [
        pullRequestFacts,
        {
          ...pullRequestFacts,
          id: "pr2",
          number: 2,
          url: "https://github.com/acme/api/pull/2",
          title: "Stop on 410",
        },
      ],
    },
  );
  const second = localStore
    .snapshot()
    .pullRequests!.find((item) => item.facts.number === 2)!._id;
  const { router } = await renderRoutes({
    shell: Shell,
    path: `/deck/${itemId}`,
    routes: {
      "/deck/$itemId": function ReviewPage() {
        const { itemId: shown } = useParams({ strict: false });
        return <DeckPage itemId={shown} />;
      },
    },
  });
  await screen.findByRole("heading", { name: "Concern 1: Handle the request" });
  fireEvent.click(
    screen.getByRole("button", { name: "Viewed: src/api.ts, lines 40 to 42" }),
  );
  await showOverview();
  fireEvent.click(screen.getByRole("button", { name: "Description" }));
  expect(await screen.findByText(/Retries stop on/)).toBeTruthy();

  await act(() =>
    router.navigate({ to: "/deck/$itemId", params: { itemId: second } }),
  );

  expect(
    await screen.findByRole("heading", { level: 1, name: "Stop on 410" }),
  ).toBeTruthy();
  // It opens on Changes, with nothing viewed.
  await screen.findByRole("heading", { name: "Concern 1: Handle the request" });
  expect(
    screen
      .getByRole("button", { name: "Viewed: src/api.ts, lines 40 to 42" })
      .getAttribute("aria-pressed"),
  ).toBe("false");
  await showOverview();
  expect(
    screen
      .getByRole("button", { name: "Description" })
      .getAttribute("aria-expanded"),
  ).toBe("false");
  expect(screen.queryByText(/Retries stop on/)).toBeNull();
  expect(api.openDeckPullRequest).toHaveBeenLastCalledWith("github", "work", {
    repository: "acme/api",
    number: 2,
    headSha: "one",
  });
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

it("puts each thread after its line, inside its hunk", async () => {
  vi.mocked(api.openDeckPullRequest).mockResolvedValue(DIFF);
  vi.mocked(api.readPullRequestConversation).mockResolvedValue({
    ...CONVERSATION,
    threads: [reviewThread("on-b", { side: "base", line: 2 })],
  });

  await renderReviewPage();

  const changes = screen.getByRole("region", { name: "Changes" });
  await within(changes).findByRole("heading", { name: "src/api.ts" });
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

it("shows the conversation on Overview: the timeline in time order", async () => {
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
  await showOverview();

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
  // The changes are out of sight while Overview shows.
  expect(screen.queryByRole("region", { name: "Changes" })).toBeNull();
});

it("says calmly that the connection was removed, with nothing to retry", async () => {
  vi.mocked(api.openDeckPullRequest).mockRejectedValue(
    new AppApiError("This connection was removed.", 409, undefined, {
      error: "This connection was removed.",
      reason: "connection_removed",
    }),
  );

  await renderReviewPage();

  const changes = screen.getByRole("region", { name: "Changes" });
  expect(
    await within(changes).findByText("This connection was removed."),
  ).toBeTruthy();
  expect(screen.queryByRole("alert")).toBeNull();
  expect(within(changes).queryByRole("button", { name: "Retry" })).toBeNull();
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

it("opens the guide tree on its titles, folds them to ticks with F, and opens them again", async () => {
  const changes = await openGuided();
  const tree = within(changes).getByRole("navigation", { name: "Guide tree" });
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
    within(tree)
      .getAllByRole("button")
      .map((button) => button.getAttribute("aria-label")),
  ).toEqual([
    "Show the guide tree",
    "1. Handle the request · 0 of 2 viewed",
    "2. Mechanical changes · 0 of 2 viewed",
  ]);

  press("f");

  expect(within(tree).getByText("Handle the request")).toBeTruthy();
});

it("fills a concern's tick as its hunks are marked viewed, and folds them", async () => {
  const changes = await openGuided();
  const tree = within(changes).getByRole("navigation", { name: "Guide tree" });
  // F folds the tree to its ticks.
  press("f");

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
  press("f");

  fireEvent.click(
    within(tree).getByRole("button", {
      name: "2. Mechanical changes · 0 of 2 viewed",
    }),
  );

  expect(reached()).toBe(1);
});

it("shows each thread after its line in its concern, and hides it while its hunk is folded as viewed", async () => {
  vi.mocked(api.readPullRequestConversation).mockResolvedValue({
    ...CONVERSATION,
    threads: [
      reviewThread("on-b", { line: 2 }),
      reviewThread("on-y", { line: 41 }),
    ],
  });
  const changes = await openGuided();
  const hunkNamed = (name: string) =>
    within(changes).getByRole("group", { name });

  // In reading order, concern 1 holds src/api.ts, lines 40 to 42, and its
  // thread on line 41 sits after that line.
  bringOnScreen(hunkNamed("src/api.ts, lines 40 to 42"));
  const thread = await within(
    hunkNamed("src/api.ts, lines 40 to 42"),
  ).findByRole("article", { name: "Thread on src/api.ts, line 41" });
  expect(thread.closest("[data-after]")?.getAttribute("data-after")).toBe(
    "additions 41",
  );

  // Folded as viewed, the hunk hides its thread with its lines.
  fireEvent.click(
    within(changes).getByRole("button", {
      name: "Viewed: src/api.ts, lines 40 to 42",
    }),
  );
  expect(
    within(changes).queryByRole("article", {
      name: "Thread on src/api.ts, line 41",
    }),
  ).toBeNull();

  // In Files A–Z the same threads follow their file's hunks.
  fireEvent.click(
    within(changes).getByRole("button", {
      name: "Viewed: src/api.ts, lines 40 to 42",
    }),
  );
  fireEvent.click(within(changes).getByRole("button", { name: "Files A–Z" }));
  bringOnScreen(hunkNamed("src/api.ts, lines 1 to 3"));
  expect(
    await within(hunkNamed("src/api.ts, lines 1 to 3")).findByRole("article", {
      name: "Thread on src/api.ts, line 2",
    }),
  ).toBeTruthy();
});

/** The guided pull request with a summary every section of which has a line. */
const SUMMARIZED: DeckOpenedPullRequest = {
  ...GUIDED,
  guide: {
    ...GUIDED.guide!,
    concerns: [
      { ...GUIDED.guide!.concerns[0]!, kinds: ["tests"] },
      { ...GUIDED.guide!.concerns[1]!, kinds: ["dependencies", "build"] },
    ],
    summary: {
      problem: {
        text: "Retries never stop on 410",
        source: "ticket",
        ticket: {
          number: 482,
          repository: "acme/api",
          title: "Retries never stop on 410",
          url: "https://github.com/acme/api/issues/482",
          state: "Open",
        },
      },
      tickets: [
        {
          number: 482,
          repository: "acme/api",
          title: "Retries never stop on 410",
          url: "https://github.com/acme/api/issues/482",
          state: "Open",
        },
        {
          number: 12,
          repository: "acme/web",
          title: "Show the retries",
          url: "https://github.com/acme/web/issues/12",
          state: "Closed",
        },
      ],
      kinds: ["tests", "dependencies", "build"],
      breaking: [],
      risks: [
        {
          id: "risk:auth",
          text: "Auth and security: src/api.ts",
          hunkIds: ["src/api.ts#0", "src/api.ts#1"],
        },
      ],
      tests: [],
      untested: [
        {
          id: "untested:g1",
          text: "No test for src/api.ts and src/new.ts",
          hunkIds: ["src/api.ts#1", "src/new.ts#0"],
          concernId: "g1",
        },
      ],
      leftovers: [
        {
          id: "leftover:0",
          text: "TODO in src/new.ts:1: // TODO: stop on 410",
          hunkIds: ["src/new.ts#0"],
        },
      ],
    },
  },
};

async function openSummarized(pullRequest = SUMMARIZED) {
  vi.mocked(api.openDeckPullRequest).mockResolvedValue(pullRequest);
  await renderReviewPage();
  await showOverview();
  return await screen.findByRole("region", { name: "Summary" });
}

it("opens Overview on the summary, above the description: the ticket, the kinds and each section's lines", async () => {
  const summary = await openSummarized();

  const description = screen.getByRole("region", { name: "Description" });
  expect(
    summary.compareDocumentPosition(description) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(within(summary).getByText("Retries never stop on 410")).toBeTruthy();
  expect(
    within(summary).getByRole("button", {
      name: "Open #482: Retries never stop on 410",
    }),
  ).toBeTruthy();
  expect(
    within(summary).getByRole("button", {
      name: "Open acme/web#12: Show the retries",
    }),
  ).toBeTruthy();
  expect(
    within(within(summary).getByRole("list", { name: "Kinds of change" }))
      .getAllByRole("listitem")
      .map((kind) => kind.textContent),
  ).toEqual(["Tests", "Dependencies", "Build"]);
  expect(
    within(summary)
      .getAllByRole("heading", { level: 3 })
      .map((heading) => heading.textContent),
  ).toEqual(["Risky areas", "Tests", "Leftovers"]);
  expect(
    within(summary).getByRole("button", {
      name: "Concern 1: No test for src/api.ts and src/new.ts",
    }),
  ).toBeTruthy();
  expect(within(summary).getAllByText("2 hunks")).toHaveLength(2);
  // Each concern shows its own kinds, on Changes.
  fireEvent.click(screen.getByRole("tab", { name: /^Changes/ }));
  const mechanical = screen.getByRole("region", {
    name: "Concern 2: Mechanical changes",
  });
  expect(
    within(within(mechanical).getByRole("list", { name: "Kinds of change" }))
      .getAllByRole("listitem")
      .map((kind) => kind.textContent),
  ).toEqual(["Dependencies", "Build"]);
});

it("scrolls to a line's first hunk below the versions bar and focuses it, in the guide and in Files A–Z", async () => {
  // Each hunk 500px down the page, under a 60px versions bar.
  const restore = sizeElements([
    { selector: ".deck-versions", width: 1000, height: 60 },
  ]);
  const rect = HTMLElement.prototype.getBoundingClientRect;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      return this.hasAttribute("data-hunk-id")
        ? DOMRect.fromRect({ x: 0, y: 500, width: 1000, height: 100 })
        : rect.call(this);
    },
  );
  const scrolled = vi
    .spyOn(window, "scrollTo")
    .mockImplementation(() => undefined);
  try {
    const summary = await openSummarized();

    fireEvent.click(
      within(summary).getByRole("button", { name: /^TODO in src\/new\.ts/ }),
    );
    // Changes shows, and the hunk's top lands 16px below the bar, as a
    // section's does.
    await waitFor(() =>
      expect(scrolled).toHaveBeenLastCalledWith({
        top: 500 - 60 - 16,
        behavior: "instant",
      }),
    );
    expect((document.activeElement as HTMLElement).dataset.hunkId).toBe(
      "src/new.ts#0",
    );
    const changes = screen.getByRole("region", { name: "Changes" });

    fireEvent.click(
      within(within(changes).getByRole("group", { name: "Order" })).getByRole(
        "button",
        { name: "Files A–Z" },
      ),
    );
    await showOverview();
    scrolled.mockClear();
    fireEvent.click(
      within(await screen.findByRole("region", { name: "Summary" })).getByRole(
        "button",
        {
          name: "Auth and security: src/api.ts",
        },
      ),
    );
    await waitFor(() =>
      expect(scrolled).toHaveBeenCalledExactlyOnceWith({
        top: 500 - 60 - 16,
        behavior: "instant",
      }),
    );
    expect((document.activeElement as HTMLElement).dataset.hunkId).toBe(
      "src/api.ts#0",
    );
  } finally {
    restore();
  }
});

it("says there's no linked ticket, or that the tickets couldn't be read", async () => {
  const none = await openSummarized({
    ...GUIDED,
    guide: { ...GUIDED.guide!, summary: NO_DECK_SUMMARY },
  });
  expect(within(none).getByText("No linked ticket")).toBeTruthy();
  expect(within(none).queryByRole("list")).toBeNull();
  cleanup();

  const unread = await openSummarized({
    ...GUIDED,
    guide: {
      ...GUIDED.guide!,
      summary: { ...NO_DECK_SUMMARY, tickets: null },
    },
  });
  expect(
    within(unread).getByText("The linked tickets couldn't be read."),
  ).toBeTruthy();
});

it("shows no summary while the guide couldn't be built", async () => {
  vi.mocked(api.openDeckPullRequest).mockResolvedValue(DIFF);
  await renderReviewPage();
  await screen.findByRole("heading", { name: "src/api.ts" });
  await showOverview();

  expect(screen.queryByRole("region", { name: "Summary" })).toBeNull();
});

/** One file of 600 one-line hunks, so its rows mount only near the screen (#790). */
const HUGE: DeckOpenedPullRequest = {
  headSha: "head",
  baseSha: "base",
  guide: null,
  files: [
    {
      path: "src/big.ts",
      status: "modified",
      binary: false,
      hunks: Array.from({ length: 600 }, (_, index) =>
        hunk(`src/big.ts#${index}`, `@@ -${index + 1},1 +${index + 1},1 @@`, [
          "-a",
          "+A",
        ]),
      ),
    },
  ],
};

it("scrolls a huge pull request to a summary line's hunk, mounting it below the versions bar", async () => {
  vi.mocked(api.openDeckPullRequest).mockResolvedValue({
    ...HUGE,
    guide: {
      madeWith: "code",
      concerns: [
        {
          id: "g1",
          title: "Rename the field",
          rationale: "Every use of it.",
          hunkIds: HUGE.files[0]!.hunks.map((entry) => entry.id),
          kinds: [],
        },
      ],
      summary: {
        ...NO_DECK_SUMMARY,
        leftovers: [
          {
            id: "leftover:0",
            text: "TODO in src/big.ts:551: // TODO: drop it",
            hunkIds: ["src/big.ts#550"],
          },
        ],
      },
    },
  });
  // A 900px scroller under a 60px versions bar, whose rows are 100px high
  // and sit where the virtualizer placed them.
  const restore = sizeElements([
    { selector: "[data-testid=scroller]", width: 1440, height: 900 },
    { selector: ".deck-versions", width: 1000, height: 60 },
    { selector: ".deck-review-row", width: 1000, height: 100 },
  ]);
  const rect = HTMLElement.prototype.getBoundingClientRect;
  const rowTop = (row: HTMLElement) =>
    Number(/translateY\((-?[\d.]+)px\)/.exec(row.style.transform)?.[1] ?? 0) -
    screen.getByTestId("scroller").scrollTop;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      return this.classList.contains("deck-review-row")
        ? DOMRect.fromRect({ x: 0, y: rowTop(this), width: 1000, height: 100 })
        : rect.call(this);
    },
  );
  try {
    await renderRoutes({
      shell: ({ children }) => (
        <Shell>
          <div
            data-testid="scroller"
            style={{ overflowY: "auto" }}
            ref={(element) => {
              if (!element) return;
              makeScrollable(element);
              // Tall enough for every row, so a scroll there isn't clamped.
              Object.defineProperty(element, "scrollHeight", {
                configurable: true,
                get: () => 100_000,
              });
            }}
          >
            {children}
          </div>
        </Shell>
      ),
      path: `/deck/${itemId}`,
      routes: { "/deck/$itemId": () => <DeckPage itemId={itemId} /> },
    });
    await showOverview();
    const summary = await screen.findByRole("region", { name: "Summary" });
    // Kept mounted while Overview shows, out of sight.
    const changes = document.querySelector<HTMLElement>(
      'section[aria-label="Changes"]',
    )!;
    const hunkElement = () =>
      changes.querySelector<HTMLElement>('[data-hunk-id="src/big.ts#550"]');
    await waitFor(() =>
      expect(
        changes.querySelector(".deck-review-sections[data-virtual]"),
      ).not.toBeNull(),
    );
    expect(hunkElement()).toBeNull();

    fireEvent.click(
      within(summary).getByRole("button", { name: /^TODO in src\/big\.ts/ }),
    );

    // It mounts, takes the focus, and its row's top holds 16px below the bar.
    await waitFor(() => expect(document.activeElement).toBe(hunkElement()));
    await waitFor(() =>
      expect(
        rowTop(hunkElement()!.closest<HTMLElement>(".deck-review-row")!),
      ).toBe(60 + 16),
    );
  } finally {
    restore();
  }
});
