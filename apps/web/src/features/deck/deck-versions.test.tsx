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
import { installDomShims, renderRoutes } from "@/test-support/dom";
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
    concerns: [
      {
        id: "g1",
        title: "Handle the request",
        rationale: "The handler.",
        hunkIds: ["src/api.ts#0", "src/api.ts#1"],
      },
      {
        id: "g2",
        title: "Read the config",
        rationale: "The setting.",
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
  fireEvent.click(within(banner).getByRole("button", { name: "Refresh" }));

  await waitFor(() =>
    expect(api.openDeckPullRequest).toHaveBeenLastCalledWith("github", "work", {
      repository: "acme/api",
      number,
      headSha: "three",
    }),
  );
  await within(versionsBar(changes)).findByText("v3");
  expect(screen.queryByRole("status", { name: "New pushes" })).toBeNull();
});

it("says when the code host doesn't list its versions, and still shows the diff", async () => {
  vi.mocked(api.readPullRequestVersions).mockRejectedValue(
    new AppApiError("GitHub doesn't offer this yet.", 404, undefined, {
      error: "GitHub doesn't offer this yet.",
      reason: "not_supported",
    }),
  );
  const changes = await renderReviewPage();
  const bar = versionsBar(changes);

  expect(
    await within(bar).findByText("GitHub doesn't offer this yet."),
  ).toBeTruthy();
  expect(hunkNames(changes)).toHaveLength(3);
  expect(api.readDeckSinceReview).not.toHaveBeenCalled();
});
