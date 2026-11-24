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
 * Deck's review page at /deck/$itemId (#779, #782): the pull request's
 * title, then its guide's concerns in reading order, or every file's hunks
 * A–Z, as the local API built them. The local
 * API module is mocked, and so is the diff library, which renders a hunk's
 * patch as text here. Each test reads what the user sees.
 */

vi.mock("@/lib/app-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/app-api")>()),
  openDeckPullRequest: vi.fn(),
}));
vi.mock("@pierre/diffs/react", async () => ({
  WorkerPoolContext: (await import("react")).createContext(undefined),
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
