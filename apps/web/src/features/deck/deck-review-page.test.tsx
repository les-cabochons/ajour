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
import type { DeckPullRequestDiff } from "@ajour/shared/deck";
import { TooltipProvider } from "@/components/ui/tooltip";
import * as api from "@/lib/app-api";
import { AppApiError, cachePluginsOverview } from "@/lib/app-api";
import { localStore } from "@/lib/local-store";
import { installDomShims, renderRoutes } from "@/test-support/dom";
import {
  codeHostOverview,
  pullRequestFacts,
} from "../../../tests/fixtures/pull-requests";
import { DeckPage } from "./deck-page";

/*
 * Deck's review page at /deck/$itemId (#779): the pull request's title, then
 * every file's hunks in file order, as the local API built them. The local
 * API module is mocked, and so is the diff library, which renders a hunk's
 * patch as text here. Each test reads what the user sees.
 */

vi.mock("@/lib/app-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/app-api")>()),
  openDeckPullRequest: vi.fn(),
}));
vi.mock("@pierre/diffs/react", () => ({
  PatchDiff: ({
    patch,
    options,
  }: {
    patch: string;
    options: { overflow: string };
  }) => <pre data-overflow={options.overflow}>{patch}</pre>,
}));

beforeAll(installDomShims);

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

const DIFF: DeckPullRequestDiff = {
  headSha: "head",
  baseSha: "base",
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

const Shell = ({ children }: { children: ReactNode }) => (
  <TooltipProvider>{children}</TooltipProvider>
);

let itemId = "";
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

afterEach(() => {
  cleanup();
  vi.mocked(api.openDeckPullRequest).mockReset();
});

async function renderReviewPage() {
  return await renderRoutes({
    shell: Shell,
    path: `/deck/${itemId}`,
    routes: { "/deck/$itemId": () => <DeckPage itemId={itemId} /> },
  });
}

it("opens the pull request and shows its title and every hunk, in file order", async () => {
  vi.mocked(api.openDeckPullRequest).mockResolvedValue(DIFF);

  await renderReviewPage();

  expect(
    screen.getByRole("heading", { level: 1, name: "Fix request handling" }),
  ).toBeTruthy();
  const changes = screen.getByRole("region", { name: "Changes" });
  await within(changes).findByRole("heading", { name: "src/api.ts" });
  expect(within(changes).getByRole("heading", { level: 2 }).textContent).toBe(
    "Changes3",
  );
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
  let answer!: (diff: DeckPullRequestDiff) => void;
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
