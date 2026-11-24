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
  PluginsOverview,
} from "@ajour/shared";
import type { DeckOpenedPullRequest } from "@ajour/shared/deck";
import { TooltipProvider } from "@/components/ui/tooltip";
import * as api from "@/lib/app-api";
import { AppApiError, cachePluginsOverview } from "@/lib/app-api";
import { localStore } from "@/lib/local-store";
import { ShortcutProvider } from "@/lib/shortcut-handlers";
import { installDomShims, renderRoutes } from "@/test-support/dom";
import {
  codeHostOverview,
  pullRequestFacts,
} from "../../../tests/fixtures/pull-requests";
import { DeckPage } from "./deck-page";

/*
 * Deck's draft review (#784): a "+" beside a line opens the composer, which
 * adds the comment to the draft review or posts it at once; Finish review
 * and the R keys send the review with its verdict; a failure keeps the
 * draft with Retry; a push marks comments on changed lines outdated; a
 * closed pull request keeps its draft. The local API and the diff library
 * are mocked. The library draws a "+" per line of the head.
 */

vi.mock("@/lib/app-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/app-api")>()),
  openDeckPullRequest: vi.fn(),
  readPullRequestConversation: vi.fn(),
  readPullRequestChecks: vi.fn(),
  submitPullRequestReview: vi.fn(),
  postPullRequestComment: vi.fn(),
}));
vi.mock("@pierre/diffs/react", () => ({
  PatchDiff: ({
    patch,
    options,
    lineAnnotations,
    renderAnnotation,
  }: {
    patch: string;
    options: {
      onGutterUtilityClick?: (range: {
        start: number;
        end: number;
        side: string;
      }) => void;
    };
    lineAnnotations?: {
      side: string;
      lineNumber: number;
      metadata: { key: string };
    }[];
    renderAnnotation?: (annotation: unknown) => ReactNode;
  }) => {
    const rows = patch.split("\n");
    const at = rows.findIndex((row) => row.startsWith("@@"));
    let line = Number(/\+(\d+)/.exec(rows[at] ?? "")?.[1] ?? 1);
    const heads: number[] = [];
    for (const row of rows.slice(at + 1))
      if (row.startsWith("+") || row.startsWith(" ")) heads.push(line++);
    return (
      <div>
        <pre>{patch}</pre>
        {options.onGutterUtilityClick
          ? heads.map((number) => (
              <button
                key={number}
                type="button"
                onClick={() =>
                  options.onGutterUtilityClick!({
                    start: number,
                    end: number,
                    side: "additions",
                  })
                }
              >
                {`Comment on line ${number}`}
              </button>
            ))
          : null}
        {lineAnnotations?.map((annotation) => (
          <div key={annotation.metadata.key}>
            {renderAnnotation?.(annotation)}
          </div>
        ))}
      </div>
    );
  },
}));

beforeAll(() => installDomShims());

/** Every hunk mounts at once: the test reads what the page draws. */
vi.stubGlobal(
  "IntersectionObserver",
  class {
    constructor(
      private readonly callback: (entries: IntersectionObserverEntry[]) => void,
    ) {}
    observe(target: Element) {
      queueMicrotask(() =>
        this.callback([
          { target, isIntersecting: true } as IntersectionObserverEntry,
        ]),
      );
    }
    unobserve() {}
    disconnect() {}
  },
);

const hunk = (id: string, header: string, lines: string[]) => {
  const [, oldStart = 0, oldLines = 0, newStart = 0, newLines = 0] =
    /^@@ -(\d+),(\d+) \+(\d+),(\d+) @@/.exec(header)?.map(Number) ?? [];
  const path = id.slice(0, id.lastIndexOf("#"));
  return {
    id,
    header,
    oldStart,
    oldLines,
    newStart,
    newLines,
    patch: [
      `diff --git a/${path} b/${path}`,
      `--- a/${path}`,
      `+++ b/${path}`,
      header,
      ...lines,
      "",
    ].join("\n"),
  };
};

/** Line 2 of the head reads "B". */
const DIFF: DeckOpenedPullRequest = {
  headSha: "one",
  baseSha: "base",
  guide: null,
  files: [
    {
      path: "src/api.ts",
      status: "modified",
      binary: false,
      hunks: [
        hunk("src/api.ts#0", "@@ -1,3 +1,3 @@", [" a", "-b", "+B", " c"]),
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

const REF = {
  pluginId: "github",
  connectionId: "work",
  repository: "acme/api",
  number: 1,
};

const Shell = ({ children }: { children: ReactNode }) => (
  <ShortcutProvider>
    <TooltipProvider>{children}</TooltipProvider>
  </ShortcutProvider>
);

function sync(
  overrides: Partial<CodeHostPullRequestFacts> = {},
  pluginId = "github",
) {
  localStore.syncPullRequests(
    {
      pluginId,
      pluginName: pluginId === "github" ? "GitHub" : "Azure DevOps",
      connectionId: "work",
      connectionLabel: "Work",
    },
    {
      viewer: { login: "alex", isBot: false },
      pullRequests: [{ ...pullRequestFacts, ...overrides }],
    },
  );
  return localStore
    .snapshot()
    .pullRequests!.find(
      (item) => item.pluginId === pluginId && item.facts.id === "pr1",
    )!._id;
}

let itemId = "";
beforeEach(() => {
  cachePluginsOverview(codeHostOverview);
  itemId = sync();
  vi.mocked(api.openDeckPullRequest).mockResolvedValue(DIFF);
  vi.mocked(api.readPullRequestConversation).mockResolvedValue(CONVERSATION);
  vi.mocked(api.readPullRequestChecks).mockResolvedValue({ checks: [] });
  vi.mocked(api.submitPullRequestReview).mockResolvedValue({
    reviewId: "review-1",
  });
  vi.mocked(api.postPullRequestComment).mockResolvedValue({
    commentId: "comment-1",
  });
});

afterEach(() => {
  cleanup();
  localStore.discardDraftReview(REF);
  localStore.discardDraftReview({ ...REF, pluginId: "azure_devops" });
  vi.mocked(api.openDeckPullRequest).mockReset();
  vi.mocked(api.readPullRequestConversation).mockReset();
  vi.mocked(api.readPullRequestChecks).mockReset();
  vi.mocked(api.submitPullRequestReview).mockReset();
  vi.mocked(api.postPullRequestComment).mockReset();
  vi.restoreAllMocks();
});

async function renderReviewPage(id = itemId) {
  const rendered = await renderRoutes({
    shell: Shell,
    path: `/deck/${id}`,
    routes: { "/deck/$itemId": () => <DeckPage itemId={id} /> },
  });
  await screen.findByRole("button", { name: "Comment on line 2" });
  return rendered;
}

const changes = () => screen.getByRole("region", { name: "Changes" });
const draftComments = () =>
  localStore.snapshot().deckDraftReviews?.flatMap((review) => review.comments);

/** Opens the composer on line 2 and types. */
function compose(text: string) {
  fireEvent.click(screen.getByRole("button", { name: "Comment on line 2" }));
  const form = screen.getByRole("form", { name: "New comment" });
  fireEvent.change(within(form).getByRole("textbox", { name: "Comment" }), {
    target: { value: text },
  });
  return form;
}

function press(key: string, init: KeyboardEventInit = {}) {
  act(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key, ...init }));
  });
}

it("adds a comment to the draft review from the composer on its line", async () => {
  await renderReviewPage();
  expect(screen.getByRole("button", { name: "Finish review" })).toBeTruthy();

  const form = compose("Rename this.");
  fireEvent.click(within(form).getByRole("button", { name: "Add to review" }));

  const card = within(changes()).getByRole("article", {
    name: "Draft comment on src/api.ts, line 2",
  });
  expect(within(card).getByText("Draft")).toBeTruthy();
  expect(within(card).getByText("Rename this.")).toBeTruthy();
  expect(screen.queryByRole("form", { name: "New comment" })).toBeNull();
  expect(
    screen.getByRole("button", { name: "Finish review · 1" }),
  ).toBeTruthy();
  // Kept in local state, nothing sent.
  expect(draftComments()).toEqual([
    expect.objectContaining({
      path: "src/api.ts",
      side: "head",
      line: 2,
      body: "Rename this.",
      lineText: "B",
    }),
  ]);
  expect(api.postPullRequestComment).not.toHaveBeenCalled();
});

it("adds to the review with Ctrl+Enter, and edits and removes a draft comment", async () => {
  await renderReviewPage();
  compose("First words.");
  press("Enter", { ctrlKey: true });
  expect(draftComments()).toEqual([
    expect.objectContaining({ body: "First words." }),
  ]);

  const card = within(changes()).getByRole("article", {
    name: "Draft comment on src/api.ts, line 2",
  });
  fireEvent.click(within(card).getByRole("button", { name: "Edit" }));
  const editing = screen.getByRole("form", { name: "Edit the draft comment" });
  fireEvent.change(within(editing).getByRole("textbox", { name: "Comment" }), {
    target: { value: "Better words." },
  });
  fireEvent.click(within(editing).getByRole("button", { name: "Save" }));
  expect(draftComments()).toEqual([
    expect.objectContaining({ body: "Better words." }),
  ]);

  fireEvent.click(
    within(
      within(changes()).getByRole("article", {
        name: "Draft comment on src/api.ts, line 2",
      }),
    ).getByRole("button", { name: "Remove" }),
  );
  expect(draftComments() ?? []).toEqual([]);
  expect(screen.getByRole("button", { name: "Finish review" })).toBeTruthy();
});

it("posts a comment at once with Comment now, and keeps its words with Retry when it fails", async () => {
  vi.mocked(api.postPullRequestComment).mockRejectedValueOnce(
    new Error("GitHub is down."),
  );
  await renderReviewPage();
  const form = compose("Look here.");

  fireEvent.click(within(form).getByRole("button", { name: "Comment now" }));
  expect((await within(form).findByRole("alert")).textContent).toContain(
    "GitHub is down.",
  );
  expect(
    (
      within(form).getByRole("textbox", {
        name: "Comment",
      }) as HTMLTextAreaElement
    ).value,
  ).toBe("Look here.");
  expect(draftComments() ?? []).toEqual([]);

  fireEvent.click(within(form).getByRole("button", { name: "Retry" }));
  await waitFor(() =>
    expect(screen.queryByRole("form", { name: "New comment" })).toBeNull(),
  );
  expect(api.postPullRequestComment).toHaveBeenLastCalledWith(
    "github",
    "work",
    {
      repository: "acme/api",
      number: 1,
      body: "Look here.",
      anchor: { path: "src/api.ts", side: "head", line: 2, headSha: "one" },
    },
  );
  // The page reads the threads again, to show the new one.
  expect(api.readPullRequestConversation).toHaveBeenCalledTimes(2);
  expect(draftComments() ?? []).toEqual([]);
});

it("sends the draft review with Finish review and its verdict, then clears it", async () => {
  await renderReviewPage();
  fireEvent.click(
    within(compose("Rename this.")).getByRole("button", {
      name: "Add to review",
    }),
  );

  fireEvent.click(screen.getByRole("button", { name: "Finish review · 1" }));
  const dialog = await screen.findByRole("dialog", { name: "Finish review" });
  expect(within(dialog).getByText("1 comment goes with it.")).toBeTruthy();
  fireEvent.change(within(dialog).getByRole("textbox", { name: "Summary" }), {
    target: { value: "A few things." },
  });
  fireEvent.click(
    within(dialog).getByRole("radio", { name: "Request changes" }),
  );
  fireEvent.click(
    within(dialog).getByRole("button", { name: "Submit review" }),
  );

  await waitFor(() => expect(draftComments() ?? []).toEqual([]));
  expect(api.submitPullRequestReview).toHaveBeenCalledWith("github", "work", {
    repository: "acme/api",
    number: 1,
    headSha: "one",
    verdict: "request_changes",
    body: "A few things.",
    comments: [
      { path: "src/api.ts", side: "head", line: 2, body: "Rename this." },
    ],
  });
  await waitFor(() =>
    expect(screen.queryByRole("dialog", { name: "Finish review" })).toBeNull(),
  );
  expect(screen.getByRole("button", { name: "Finish review" })).toBeTruthy();
});

it.each([
  ["c", "Comment"],
  ["n", "Request changes"],
  ["a", "Approve"],
])("opens Finish review on its verdict with R then %s", async (key, label) => {
  await renderReviewPage();
  press("r");
  press(key);
  const dialog = await screen.findByRole("dialog", { name: "Finish review" });
  expect(
    (within(dialog).getByRole("radio", { name: label }) as HTMLInputElement)
      .checked,
  ).toBe(true);
  expect(api.submitPullRequestReview).not.toHaveBeenCalled();
});

it("approves at once with R then Y, with no dialog", async () => {
  await renderReviewPage();
  press("r");
  press("y");
  await waitFor(() =>
    expect(api.submitPullRequestReview).toHaveBeenCalledWith("github", "work", {
      repository: "acme/api",
      number: 1,
      headSha: "one",
      verdict: "approve",
      comments: [],
    }),
  );
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("keeps the draft when the submit fails, and shows why with Retry", async () => {
  vi.mocked(api.submitPullRequestReview).mockRejectedValueOnce(
    new AppApiError("Review pull requests is off.", 403, "reviewPullRequests"),
  );
  await renderReviewPage();
  fireEvent.click(
    within(compose("Rename this.")).getByRole("button", {
      name: "Add to review",
    }),
  );
  // R then Y fails: the dialog opens on the reason.
  press("r");
  press("y");
  const dialog = await screen.findByRole("dialog", { name: "Finish review" });
  expect(within(dialog).getByRole("alert").textContent).toBe(
    "This GitHub connection can't review pull requests. Turn on Review pull requests for Work in Settings › Plugins, then retry. Your draft review is kept.",
  );
  expect(draftComments()).toHaveLength(1);

  fireEvent.click(within(dialog).getByRole("button", { name: "Retry" }));
  await waitFor(() => expect(draftComments() ?? []).toEqual([]));
  expect(api.submitPullRequestReview).toHaveBeenCalledTimes(2);
});

it("marks outdated a draft comment whose line a push changed, and keeps it out of the review", async () => {
  localStore.addDraftComment(REF, {
    headSha: "zero",
    anchor: { path: "src/api.ts", side: "head", line: 2 },
    body: "On the old line.",
    lineText: "Was different",
  });
  await renderReviewPage();

  const outdated = screen.getByRole("region", { name: "Draft comments" });
  const card = within(outdated).getByRole("article", {
    name: "Draft comment on src/api.ts, line 2",
  });
  expect(within(card).getByText("Outdated")).toBeTruthy();
  expect(within(card).getByText("src/api.ts, line 2")).toBeTruthy();
  expect(within(changes()).queryByRole("article")).toBeNull();

  fireEvent.click(screen.getByRole("button", { name: "Finish review · 1" }));
  const dialog = await screen.findByRole("dialog", { name: "Finish review" });
  expect(
    within(dialog).getByText(
      "No comments. 1 outdated comment stays in your draft.",
    ),
  ).toBeTruthy();
  fireEvent.click(within(dialog).getByRole("radio", { name: "Approve" }));
  fireEvent.click(
    within(dialog).getByRole("button", { name: "Submit review" }),
  );
  await waitFor(() => expect(api.submitPullRequestReview).toHaveBeenCalled());
  expect(
    vi.mocked(api.submitPullRequestReview).mock.calls[0]![2].comments,
  ).toEqual([]);
  expect(draftComments()).toEqual([
    expect.objectContaining({ body: "On the old line.", outdated: true }),
  ]);
});

it("keeps a closed pull request's draft, to post as comments or discard", async () => {
  localStore.addDraftComment(REF, {
    headSha: "one",
    anchor: { path: "src/api.ts", side: "head", line: 2 },
    body: "Rename this.",
    lineText: "B",
  });
  sync({ state: "merged", closedAt: Date.now() });
  await renderRoutes({
    shell: Shell,
    path: `/deck/${itemId}`,
    routes: { "/deck/$itemId": () => <DeckPage itemId={itemId} /> },
  });

  await screen.findByText(
    "This pull request was merged. Your draft review is kept: post its comments, or discard it.",
  );
  expect(screen.queryByRole("button", { name: /Finish review/ })).toBeNull();
  expect(screen.queryByRole("button", { name: /Comment on line/ })).toBeNull();

  fireEvent.click(screen.getByRole("button", { name: "Post as comments · 1" }));
  await waitFor(() => expect(draftComments() ?? []).toEqual([]));
  expect(api.postPullRequestComment).toHaveBeenCalledWith("github", "work", {
    repository: "acme/api",
    number: 1,
    body: "Rename this.",
    anchor: { path: "src/api.ts", side: "head", line: 2, headSha: "one" },
  });
});

it("discards a closed pull request's draft after asking", async () => {
  localStore.addDraftComment(REF, {
    headSha: "one",
    anchor: { path: "src/api.ts", side: "head", line: 2 },
    body: "Rename this.",
    lineText: "B",
  });
  sync({ state: "closed", closedAt: Date.now() });
  await renderRoutes({
    shell: Shell,
    path: `/deck/${itemId}`,
    routes: { "/deck/$itemId": () => <DeckPage itemId={itemId} /> },
  });

  fireEvent.click(await screen.findByRole("button", { name: "Discard" }));
  const confirm = await screen.findByRole("alertdialog", {
    name: "Discard the draft review?",
  });
  fireEvent.click(within(confirm).getByRole("button", { name: "Discard" }));
  expect(draftComments() ?? []).toEqual([]);
  expect(api.postPullRequestComment).not.toHaveBeenCalled();
});

it("names a request for changes Wait for author on Azure DevOps", async () => {
  const overview: PluginsOverview = structuredClone(codeHostOverview);
  overview.connectionGroups[0]!.plugin.id = "azure_devops";
  overview.connectionGroups[0]!.connections[0]!.pluginId = "azure_devops";
  overview.plugins = overview.connectionGroups.map((group) => group.plugin);
  cachePluginsOverview(overview);
  const id = sync({}, "azure_devops");
  await renderReviewPage(id);

  press("r");
  press("n");
  const dialog = await screen.findByRole("dialog", { name: "Finish review" });
  expect(
    (
      within(dialog).getByRole("radio", {
        name: "Wait for author",
      }) as HTMLInputElement
    ).checked,
  ).toBe(true);
});
