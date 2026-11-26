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
  CodeHostPullRequestFacts,
  CodeHostVersionsResult,
} from "@ajour/shared";
import type { DeckOpenedPullRequest } from "@ajour/shared/deck";
import { TooltipProvider } from "@/components/ui/tooltip";
import * as api from "@/lib/app-api";
import { ShortcutProvider } from "@/lib/shortcut-handlers";
import { AppApiError, cachePluginsOverview } from "@/lib/app-api";
import { localStore } from "@/lib/local-store";
import { NO_DECK_SUMMARY } from "@/test-support/deck";
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
 * The versions bar and changes since your review (#787): above the diff,
 * each push with its commits, the one the user reviewed checked, and a
 * filter that keeps only the hunks changed since then, folding the
 * concerns it left untouched into one line. A push during the review shows
 * a banner, and the diff stays put until Refresh. The local API module is
 * mocked; each test reads what the user sees.
 */

vi.mock("@/lib/app-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/app-api")>()),
  openDeckPullRequest: vi.fn(),
  readPullRequestConversation: vi.fn(),
  readPullRequestChecks: vi.fn(),
  readPullRequestVersions: vi.fn(),
  readDeckSinceReview: vi.fn(),
}));
vi.mock("@pierre/diffs/react", () => ({
  PatchDiff: ({ patch }: { patch: string }) => <pre>{patch}</pre>,
}));

beforeAll(installDomShims);
vi.stubGlobal(
  "IntersectionObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

const hunk = (id: string, line: number, lines: string[]) => {
  const path = id.slice(0, id.lastIndexOf("#"));
  const header = `@@ -${line},1 +${line},1 @@`;
  return {
    id,
    header,
    oldStart: line,
    oldLines: 1,
    newStart: line,
    newLines: 1,
    patch: [`diff --git a/${path} b/${path}`, header, ...lines, ""].join("\n"),
  };
};

/** The pull request at its second push, "two": two concerns. */
const diffAt = (headSha: string): DeckOpenedPullRequest => ({
  headSha,
  baseSha: "base",
  files: [
    {
      path: "src/api.ts",
      status: "modified",
      binary: false,
      hunks: [
        hunk("src/api.ts#0", 1, ["-a", "+A"]),
        hunk("src/api.ts#1", 40, ["-b", "+B"]),
      ],
    },
    {
      path: "src/config.ts",
      status: "modified",
      binary: false,
      hunks: [hunk("src/config.ts#0", 3, ["-c", "+C"])],
    },
  ],
  guide: {
    madeWith: "code",
    summary: NO_DECK_SUMMARY,
    concerns: [
      {
        id: "g1",
        title: "Handle the request",
        rationale: "The handler.",
        kinds: [],
        hunkIds: ["src/api.ts#0", "src/api.ts#1"],
      },
      {
        id: "g2",
        title: "Read the config",
        rationale: "The setting.",
        kinds: [],
        hunkIds: ["src/config.ts#0"],
      },
    ],
  },
});

const VERSIONS: CodeHostVersionsResult = {
  versions: [
    {
      number: 1,
      headSha: "one",
      pushedAt: 100,
      commits: [
        {
          sha: "c1a2b3c4d5",
          headline: "Add the handler",
          authorName: "Samir",
          createdAt: 90,
        },
      ],
    },
    {
      number: 2,
      headSha: "two",
      pushedAt: 300,
      forced: true,
      commits: [
        {
          sha: "d9e8f7a6b5",
          headline: "Read the setting",
          authorName: "Samir",
          createdAt: 290,
        },
      ],
    },
  ],
};

/** The user reviewed v1, at 200. */
const REVIEWED: Partial<CodeHostPullRequestFacts> = {
  headSha: "two",
  baseRef: "main",
  reviews: [
    {
      id: "r1",
      author: { login: "alex", isBot: false },
      verdict: "commented",
      submittedAt: 200,
    },
  ],
};

const Shell = ({ children }: { children: ReactNode }) => (
  <ShortcutProvider>
    <TooltipProvider>{children}</TooltipProvider>
  </ShortcutProvider>
);

let itemId = "";
/** Each test reviews a pull request of its own: the store outlives a test. */
let number = 100;
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
      pullRequests: [
        { ...pullRequestFacts, id: `pr${number}`, number, ...overrides },
      ],
    },
  );
}
const item = () =>
  localStore.snapshot().pullRequests!.find((entry) => entry._id === itemId)!;

beforeEach(() => {
  cachePluginsOverview(codeHostOverview);
  number += 1;
  syncFacts(REVIEWED);
  itemId = localStore
    .snapshot()
    .pullRequests!.find((entry) => entry.facts.number === number)!._id;
  vi.mocked(api.openDeckPullRequest).mockImplementation(
    async (_plugin, _connection, request) => diffAt(request.headSha ?? "two"),
  );
  vi.mocked(api.readPullRequestConversation).mockResolvedValue({
    description: "",
    timeline: [],
    threads: [],
    viewedPaths: [],
    mergeMethods: ["merge"],
  });
  vi.mocked(api.readPullRequestChecks).mockResolvedValue({ checks: [] });
  vi.mocked(api.readPullRequestVersions).mockResolvedValue(VERSIONS);
  vi.mocked(api.readDeckSinceReview).mockResolvedValue({
    head: "two",
    reviewedHead: "one",
    version: 2,
    reviewedVersion: 1,
    changed: [{ hunkId: "src/api.ts#1", version: 2 }],
  });
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

async function renderReviewPage() {
  await renderRoutes({
    shell: Shell,
    path: `/deck/${itemId}`,
    routes: { "/deck/$itemId": () => <DeckPage itemId={itemId} /> },
  });
  const changes = screen.getByRole("region", { name: "Changes" });
  await within(changes).findByRole("heading", {
    name: "Concern 1: Handle the request",
  });
  return changes;
}

const versionsBar = (changes: HTMLElement) =>
  within(changes).getByRole("region", { name: "Pushes" });
const hunkNames = (changes: HTMLElement) =>
  within(changes)
    .getAllByRole("group")
    .map((group) => group.getAttribute("aria-label"))
    .filter((name) => name !== "Order");

it("lists each push above the diff, the one reviewed checked, and names what the diff compares", async () => {
  const changes = await renderReviewPage();
  const bar = versionsBar(changes);

  await within(bar).findByText("v1");
  expect(within(bar).getByText("Pushes")).toBeTruthy();
  expect(within(bar).getByText("v2")).toBeTruthy();
  expect(within(bar).getByLabelText("You reviewed v1")).toBeTruthy();
  expect(
    within(bar).getByText("Changes in this pull request, against main"),
  ).toBeTruthy();
  // The default is the latest version, every hunk.
  expect(within(bar).getByText("v2 · 3 hunks")).toBeTruthy();
  expect(hunkNames(changes)).toEqual([
    "src/api.ts, line 1",
    "src/api.ts, line 40",
    "src/config.ts, line 3",
  ]);
  expect(api.readPullRequestVersions).toHaveBeenCalledWith("github", "work", {
    repository: "acme/api",
    number,
  });
});

it("lists each push's commits from ▾, newest first", async () => {
  const changes = await renderReviewPage();
  const bar = versionsBar(changes);
  await within(bar).findByText("v1");

  fireEvent.click(
    within(bar).getByRole("button", { name: "Pushes and their commits" }),
  );

  const items = (await screen.findAllByRole("menuitem")).map(
    (entry) => entry.textContent,
  );
  expect(items).toEqual([
    expect.stringContaining("v2"),
    expect.stringContaining("v1"),
  ]);
  expect(items[0]).toContain("Force-pushed · 1 commit");
  expect(items[0]).toContain("d9e8f7aRead the setting");
  expect(items[1]).toContain("You reviewed this");
  expect(items[1]).toContain("c1a2b3cAdd the handler");
});

it("keeps only the hunks changed since your review, marks them, and folds the untouched concerns into one line", async () => {
  const changes = await renderReviewPage();
  const bar = versionsBar(changes);
  const since = await within(bar).findByRole("button", {
    name: "Changes since your review 1",
  });
  expect(api.readDeckSinceReview).toHaveBeenCalledWith("github", "work", {
    repository: "acme/api",
    number,
    head: "two",
    reviewedHead: "one",
  });
  // Every hunk shows until the filter is on; the changed one says when it changed.
  expect(within(changes).getByText("Changed in v2")).toBeTruthy();

  fireEvent.click(since);

  expect(since.getAttribute("aria-pressed")).toBe("true");
  expect(hunkNames(changes)).toEqual(["src/api.ts, line 40"]);
  const first = screen.getByRole("region", {
    name: "Concern 1: Handle the request",
  });
  expect(within(first).getByText("1 of 2 changed")).toBeTruthy();
  expect(
    screen.queryByRole("region", { name: "Concern 2: Read the config" }),
  ).toBeNull();
  expect(
    within(changes).getByText("Unchanged since your review:").parentElement!
      .textContent,
  ).toBe("Unchanged since your review:2Read the config");
  expect(
    within(bar).getByText("1 of 3 hunks changed since your review of v1"),
  ).toBeTruthy();

  fireEvent.click(since);
  expect(hunkNames(changes)).toHaveLength(3);
});

it("shows every hunk again when a summary line goes to one the filter hides", async () => {
  vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
  vi.mocked(api.openDeckPullRequest).mockImplementation(
    async (_plugin, _connection, request) => {
      const opened = diffAt(request.headSha ?? "two");
      return {
        ...opened,
        guide: {
          ...opened.guide!,
          summary: {
            ...NO_DECK_SUMMARY,
            leftovers: [
              {
                id: "leftover:0",
                text: "TODO in src/config.ts:3: // TODO: read it once",
                hunkIds: ["src/config.ts#0"],
              },
            ],
          },
        },
      };
    },
  );
  const changes = await renderReviewPage();
  const since = await within(versionsBar(changes)).findByRole("button", {
    name: "Changes since your review 1",
  });
  fireEvent.click(since);
  expect(hunkNames(changes)).toEqual(["src/api.ts, line 40"]);

  fireEvent.click(
    within(screen.getByRole("region", { name: "Summary" })).getByRole(
      "button",
      { name: /^TODO in src\/config\.ts/ },
    ),
  );

  expect(since.getAttribute("aria-pressed")).toBe("false");
  expect(hunkNames(changes)).toHaveLength(3);
  await waitFor(() =>
    expect((document.activeElement as HTMLElement).dataset.hunkId).toBe(
      "src/config.ts#0",
    ),
  );
});

/**
 * A huge pull request at "two" (#790): 700 hunks in its first concern, of
 * which v2 changed the first 600, then a config hunk it left untouched and
 * a changed docs hunk.
 */
const hugeAt = (headSha: string): DeckOpenedPullRequest => {
  const file = (path: string, hunks: ReturnType<typeof hunk>[]) => ({
    path,
    status: "modified" as const,
    binary: false,
    hunks,
  });
  const big = Array.from({ length: 700 }, (_, index) =>
    hunk(`src/big.ts#${index}`, index + 1, ["-a", "+A"]),
  );
  return {
    headSha,
    baseSha: "base",
    files: [
      file("src/big.ts", big),
      file("src/config.ts", [hunk("src/config.ts#0", 3, ["-c", "+C"])]),
      file("src/docs.ts", [hunk("src/docs.ts#0", 5, ["-d", "+D"])]),
    ],
    guide: {
      madeWith: "code",
      summary: NO_DECK_SUMMARY,
      concerns: [
        {
          id: "g1",
          title: "Handle the request",
          rationale: "The handler.",
          kinds: [],
          hunkIds: big.map((entry) => entry.id),
        },
        {
          id: "g2",
          title: "Read the config",
          rationale: "The setting.",
          kinds: [],
          hunkIds: ["src/config.ts#0"],
        },
        {
          id: "g3",
          title: "Document it",
          rationale: "The docs.",
          kinds: [],
          hunkIds: ["src/docs.ts#0"],
        },
      ],
    },
  };
};

it("marks the changed hunks and folds the untouched concerns on a huge pull request too", async () => {
  vi.mocked(api.openDeckPullRequest).mockImplementation(
    async (_plugin, _connection, request) => hugeAt(request.headSha ?? "two"),
  );
  vi.mocked(api.readDeckSinceReview).mockResolvedValue({
    head: "two",
    reviewedHead: "one",
    version: 2,
    reviewedVersion: 1,
    changed: [
      ...Array.from({ length: 600 }, (_, index) => ({
        hunkId: `src/big.ts#${index}`,
        version: 2,
      })),
      { hunkId: "src/docs.ts#0", version: 2 },
    ],
  });
  // A 900px scroller whose rows are 100px high: about a dozen mount.
  const restore = sizeElements([
    { selector: "[data-testid=scroller]", width: 1440, height: 900 },
    { selector: ".deck-versions", width: 1000, height: 60 },
    { selector: ".deck-review-row", width: 1000, height: 100 },
  ]);
  try {
    await renderRoutes({
      shell: ({ children }) => (
        <Shell>
          <div
            data-testid="scroller"
            style={{ overflowY: "auto" }}
            ref={(element) => {
              if (element) makeScrollable(element);
            }}
          >
            {children}
          </div>
        </Shell>
      ),
      path: `/deck/${itemId}`,
      routes: { "/deck/$itemId": () => <DeckPage itemId={itemId} /> },
    });
    const scroller = screen.getByTestId("scroller");
    const changes = screen.getByRole("region", { name: "Changes" });
    await within(changes).findByRole("heading", {
      name: "Concern 1: Handle the request",
    });
    const rows = () =>
      changes.querySelector(".deck-review-sections[data-virtual]");
    const headings = () =>
      within(changes)
        .queryAllByRole("heading", { level: 3 })
        .map((heading) => heading.textContent);
    const since = await within(versionsBar(changes)).findByRole("button", {
      name: "Changes since your review 601",
    });

    // Only the rows near the screen mount, and each changed one says when.
    expect(rows()).not.toBeNull();
    expect(hunkNames(changes).length).toBeLessThan(30);
    expect(within(changes).getAllByText("Changed in v2")).toHaveLength(
      hunkNames(changes).length,
    );
    scrollElement(scroller, { top: 200_000 });
    await waitFor(() =>
      expect(hunkNames(changes)).toContain("src/config.ts, line 3"),
    );
    expect(hunkNames(changes)).toContain("src/big.ts, line 700");
    // The untouched hunks carry no chip.
    expect(within(changes).getAllByText("Changed in v2").length).toBeLessThan(
      hunkNames(changes).length,
    );

    fireEvent.click(since);

    // Still mounted row by row, with fewer rows: the end of the list now
    // holds the last changed hunk of the first concern, then the docs.
    expect(rows()).not.toBeNull();
    scrollElement(scroller, { top: 0 });
    await waitFor(() =>
      expect(headings()).toContain("Concern 1: Handle the request"),
    );
    expect(within(changes).getByText("600 of 700 changed")).toBeTruthy();
    scrollElement(scroller, { top: 200_000 });
    await waitFor(() => expect(headings()).toContain("Concern 3: Document it"));
    expect(headings()).not.toContain("Concern 2: Read the config");
    expect(hunkNames(changes)).toContain("src/big.ts, line 600");
    expect(hunkNames(changes)).not.toContain("src/big.ts, line 700");
    expect(hunkNames(changes)).not.toContain("src/config.ts, line 3");
    expect(within(changes).getAllByText("Changed in v2")).toHaveLength(
      hunkNames(changes).length,
    );
    expect(
      within(changes).getByText("Unchanged since your review:").parentElement!
        .textContent,
    ).toBe("Unchanged since your review:2Read the config");
  } finally {
    restore();
  }
});

it("says when nothing changed since your review, with a way back to every hunk", async () => {
  vi.mocked(api.readDeckSinceReview).mockResolvedValue({
    head: "two",
    reviewedHead: "one",
    version: 2,
    reviewedVersion: 1,
    changed: [],
  });
  const changes = await renderReviewPage();
  fireEvent.click(
    await within(versionsBar(changes)).findByRole("button", {
      name: "Changes since your review 0",
    }),
  );

  expect(
    within(changes).getByText("Nothing changed since your review of v1."),
  ).toBeTruthy();
  fireEvent.click(
    within(changes).getByRole("button", { name: "Show all of v2" }),
  );
  expect(hunkNames(changes)).toHaveLength(3);
});

it("can't filter before the user reviewed a version", async () => {
  syncFacts({ ...REVIEWED, reviews: [] });
  const changes = await renderReviewPage();
  const bar = versionsBar(changes);
  await within(bar).findByText("v1");

  const since = within(bar).getByRole("button", {
    name: "Changes since your review –",
  });
  expect(since.hasAttribute("disabled")).toBe(true);
  expect(
    within(bar).getByText("You haven't reviewed this pull request yet."),
  ).toBeTruthy();
  expect(api.readDeckSinceReview).not.toHaveBeenCalled();
});

it("remembers the version reviewed with the pull request in local state, and uses it once it's the later one", async () => {
  const changes = await renderReviewPage();
  await within(versionsBar(changes)).findByText("v1");
  await waitFor(() =>
    expect(item().reviewed).toEqual({ headSha: "one", at: 200 }),
  );
  cleanup();

  // Reviewed from Deck at v2, later than the review the code host lists.
  localStore.changePullRequest(itemId, {
    type: "reviewed",
    headSha: "two",
    at: 400,
  });
  const again = await renderReviewPage();
  const bar = versionsBar(again);
  expect(await within(bar).findByLabelText("You reviewed v2")).toBeTruthy();
  expect(
    await within(bar).findByRole("button", {
      name: "Changes since your review 0",
    }),
  ).toBeTruthy();
  expect(api.readDeckSinceReview).toHaveBeenCalledTimes(1);
});

it("shows a banner when a push comes in during the review, and keeps the diff until Refresh", async () => {
  const changes = await renderReviewPage();
  await within(versionsBar(changes)).findByText("v1");

  act(() => syncFacts({ ...REVIEWED, headSha: "three" }));

  const banner = await screen.findByRole("status", { name: "New pushes" });
  expect(banner.textContent).toContain(
    "1 new push since you opened this pull request.",
  );
  expect(api.openDeckPullRequest).toHaveBeenCalledTimes(1);
  expect(hunkNames(changes)).toHaveLength(3);

  vi.mocked(api.readPullRequestVersions).mockResolvedValue({
    versions: [
      ...VERSIONS.versions,
      { number: 3, headSha: "three", pushedAt: 500, commits: [] },
    ],
  });
  vi.mocked(api.openDeckPullRequest).mockImplementation(
    async (_plugin, _connection, request) => diffAt(request.headSha ?? "three"),
  );
  fireEvent.click(within(banner).getByRole("button", { name: "Refresh" }));

  // Refresh finds the head itself: the content cache would answer a head
  // the page names with the diff it holds there.
  await waitFor(() =>
    expect(api.openDeckPullRequest).toHaveBeenLastCalledWith("github", "work", {
      repository: "acme/api",
      number,
    }),
  );
  await within(versionsBar(changes)).findByText("v3");
  expect(screen.queryByRole("status", { name: "New pushes" })).toBeNull();
});

it("opens the newest head on Refresh when the versions know a push the last sync hasn't seen", async () => {
  vi.mocked(api.openDeckPullRequest).mockImplementation(
    async (_plugin, _connection, request) => diffAt(request.headSha ?? "three"),
  );
  // The last sync saw v2, which the page opens from the content cache; the
  // versions already list v3.
  vi.mocked(api.readPullRequestVersions).mockResolvedValue({
    versions: [
      ...VERSIONS.versions,
      { number: 3, headSha: "three", pushedAt: 500, commits: [] },
    ],
  });
  const changes = await renderReviewPage();
  const banner = await screen.findByRole("status", { name: "New pushes" });
  expect(api.openDeckPullRequest).toHaveBeenLastCalledWith("github", "work", {
    repository: "acme/api",
    number,
    headSha: "two",
  });

  fireEvent.click(within(banner).getByRole("button", { name: "Refresh" }));

  await waitFor(() =>
    expect(screen.queryByRole("status", { name: "New pushes" })).toBeNull(),
  );
  expect(api.openDeckPullRequest).toHaveBeenLastCalledWith("github", "work", {
    repository: "acme/api",
    number,
  });
});

it("says when the code host doesn't list its versions, and still shows the diff", async () => {
  vi.mocked(api.readPullRequestVersions).mockRejectedValue(
    new AppApiError(
      "Update the GitHub plugin in Settings › Plugins to see a pull request's versions in Deck.",
      404,
      undefined,
      {
        error:
          "Update the GitHub plugin in Settings › Plugins to see a pull request's versions in Deck.",
        reason: "not_supported",
      },
    ),
  );
  const changes = await renderReviewPage();
  const bar = versionsBar(changes);

  expect(
    await within(bar).findByText(
      "Update the GitHub plugin in Settings › Plugins to see a pull request's versions in Deck.",
    ),
  ).toBeTruthy();
  expect(
    within(bar).getByRole("link", { name: "Open Settings › Plugins" }),
  ).toBeTruthy();
  expect(hunkNames(changes)).toHaveLength(3);
  expect(api.readDeckSinceReview).not.toHaveBeenCalled();
});
