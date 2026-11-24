// @vitest-environment jsdom
import { createElement, type ReactNode } from "react";
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
import { DECK_GUTTER_QUERY } from "@/lib/breakpoints";
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
                {`Gutter + line ${number}`}
              </button>
            ))
          : null}
        {/* The "+" the library moves beside the hovered line, on line 3. */}
        {createElement("diffs-container", {
          ref: (host: HTMLElement | null) => {
            if (!host || host.shadowRoot) return;
            const button = document.createElement("button");
            button.setAttribute("data-utility-button", "");
            host.attachShadow({ mode: "open" }).append(button);
          },
        })}
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
  await screen.findByRole("button", { name: "Gutter + line 2" });
  return rendered;
}

const changes = () => screen.getByRole("region", { name: "Changes" });
const draftComments = () =>
  localStore.snapshot().deckDraftReviews?.flatMap((review) => review.comments);

/** Opens the composer on line 2 and types. */
function compose(text: string) {
  fireEvent.click(screen.getByRole("button", { name: "Gutter + line 2" }));
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

it("opens the composer from the keyboard: the hunk's button, its arrow keys, then Enter", async () => {
  await renderReviewPage();
  const key = within(changes()).getByRole("button", {
    name: "Comment on line 1",
  });
  key.focus();
  fireEvent.keyDown(key, { key: "ArrowDown" });
  expect(key.textContent).toContain("Comment on removed line 2");
  fireEvent.keyDown(key, { key: "ArrowDown" });
  fireEvent.keyDown(key, { key: "ArrowDown" });
  fireEvent.keyDown(key, { key: "ArrowUp" });
  expect(key.textContent).toContain("Comment on line 2");
  // Enter on a button clicks it.
  fireEvent.click(key);
  const form = await screen.findByRole("form", { name: "New comment" });
  fireEvent.change(within(form).getByRole("textbox", { name: "Comment" }), {
    target: { value: "From the keys." },
  });
  fireEvent.click(within(form).getByRole("button", { name: "Add to review" }));
  expect(draftComments()).toEqual([
    expect.objectContaining({ side: "head", line: 2, body: "From the keys." }),
  ]);
});

it("names the library's + once the pointer brings it out, and keeps it out of the tab order", async () => {
  await renderReviewPage();
  const hunk = changes().querySelector<HTMLElement>(".diff-hunk")!;
  const plus = hunk
    .querySelector("diffs-container")!
    .shadowRoot!.querySelector("[data-utility-button]")!;
  expect(plus.getAttribute("aria-label")).toBeNull();
  fireEvent.pointerMove(hunk);
  expect(plus.getAttribute("aria-label")).toBe("Comment on this line");
  // The pointer's way in: the keyboard has the hunk's button.
  expect(plus.getAttribute("tabindex")).toBe("-1");
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

it("starts a composer of its own for other lines or another comment to edit, in the gutter too", async () => {
  const original = window.matchMedia;
  window.matchMedia = ((query: string) => ({
    matches: query === DECK_GUTTER_QUERY,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
  try {
    for (const [line, body] of [
      [2, "On B."],
      [3, "On c."],
    ] as const)
      localStore.addDraftComment(REF, {
        headSha: "one",
        anchor: { path: "src/api.ts", side: "head", line },
        body,
        lineText: line === 2 ? "B" : "c",
      });
    await renderReviewPage();
    const gutter = screen.getByRole("complementary", {
      name: "Review threads",
    });
    const editOn = (line: number) =>
      fireEvent.click(
        within(
          within(gutter).getByRole("article", {
            name: `Draft comment on src/api.ts, line ${line}`,
          }),
        ).getByRole("button", { name: "Edit" }),
      );
    const field = () =>
      within(gutter).getByRole("textbox", {
        name: "Comment",
      }) as HTMLTextAreaElement;

    editOn(2);
    expect(field().value).toBe("On B.");
    fireEvent.change(field(), { target: { value: "Changed, not saved." } });
    // Editing the other comment shows its own words, and Save keeps them there.
    editOn(3);
    expect(field().value).toBe("On c.");
    fireEvent.click(within(gutter).getByRole("button", { name: "Save" }));
    expect(draftComments()?.map((comment) => comment.body)).toEqual([
      "On B.",
      "On c.",
    ]);

    fireEvent.click(screen.getByRole("button", { name: "Gutter + line 1" }));
    fireEvent.change(field(), { target: { value: "On a." } });
    fireEvent.click(screen.getByRole("button", { name: "Gutter + line 2" }));
    expect(field().value).toBe("");
  } finally {
    window.matchMedia = original;
  }
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
  const [first, retry] = vi
    .mocked(api.postPullRequestComment)
    .mock.calls.map((call) => call[2]);
  expect(retry).toEqual({
    repository: "acme/api",
    number: 1,
    body: "Look here.",
    anchor: { path: "src/api.ts", side: "head", line: 2, headSha: "one" },
    // The same name as the first try: the plugin finds it if it landed.
    submissionId: first!.submissionId,
    firstTriedAt: expect.any(Number),
  });
  expect(first!.submissionId).toMatch(/^comment_submission_/);
  expect(first).not.toHaveProperty("firstTriedAt");
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
    submissionId: expect.stringMatching(/^review_submission_/),
  });
  await waitFor(() =>
    expect(screen.queryByRole("dialog", { name: "Finish review" })).toBeNull(),
  );
  // The code host took it: nothing of it stays.
  expect(localStore.snapshot().deckDraftReviews).toEqual([]);
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
      submissionId: expect.stringMatching(/^review_submission_/),
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
  // The draft names the review before it's sent, for a retry after a restart.
  const first = vi.mocked(api.submitPullRequestReview).mock.calls[0]![2];
  expect(localStore.snapshot().deckDraftReviews?.[0]?.submission?.id).toBe(
    first.submissionId,
  );

  fireEvent.click(within(dialog).getByRole("button", { name: "Retry" }));
  await waitFor(() => expect(draftComments() ?? []).toEqual([]));
  expect(api.submitPullRequestReview).toHaveBeenCalledTimes(2);
  // Retry sends the same name, so the plugin finds what the first try left.
  expect(
    vi.mocked(api.submitPullRequestReview).mock.calls[1]![2].submissionId,
  ).toBe(first.submissionId);
});

it("names a failed approval with no comments, and Retry sends the same name", async () => {
  vi.mocked(api.submitPullRequestReview).mockRejectedValueOnce(
    new Error("GitHub request failed (502)."),
  );
  await renderReviewPage();
  press("r");
  press("y");
  const dialog = await screen.findByRole("dialog", { name: "Finish review" });
  fireEvent.click(within(dialog).getByRole("button", { name: "Retry" }));
  await waitFor(() =>
    expect(api.submitPullRequestReview).toHaveBeenCalledTimes(2),
  );
  const [first, second] = vi
    .mocked(api.submitPullRequestReview)
    .mock.calls.map((call) => call[2].submissionId);
  expect(second).toBe(first);
  await waitFor(() =>
    expect(localStore.snapshot().deckDraftReviews).toEqual([]),
  );
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
  expect(screen.queryByRole("button", { name: /line \d/ })).toBeNull();

  fireEvent.click(screen.getByRole("button", { name: "Post as comments · 1" }));
  await waitFor(() => expect(draftComments() ?? []).toEqual([]));
  expect(api.postPullRequestComment).toHaveBeenCalledWith("github", "work", {
    repository: "acme/api",
    number: 1,
    body: "Rename this.",
    anchor: { path: "src/api.ts", side: "head", line: 2, headSha: "one" },
    submissionId: expect.stringMatching(/^comment_submission_/),
  });
});

/** A merged pull request whose draft holds these comments, its page open. */
async function renderClosedDraft(...bodies: string[]) {
  for (const [index, body] of bodies.entries())
    localStore.addDraftComment(REF, {
      headSha: "one",
      anchor: { path: "src/api.ts", side: "head", line: index + 1 },
      body,
      lineText: "B",
    });
  sync({ state: "merged", closedAt: Date.now() });
  await renderRoutes({
    shell: Shell,
    path: `/deck/${itemId}`,
    routes: { "/deck/$itemId": () => <DeckPage itemId={itemId} /> },
  });
}

it("names each closed pull request comment before posting it, and Retry posts only the rest, by the same names", async () => {
  // The second post's answer is lost after the code host took it.
  vi.mocked(api.postPullRequestComment)
    .mockResolvedValueOnce({ commentId: "c1" })
    .mockRejectedValueOnce(new Error("The connection dropped."));
  await renderClosedDraft("One.", "Two.", "Three.");

  fireEvent.click(
    await screen.findByRole("button", { name: "Post as comments · 3" }),
  );
  expect((await screen.findByRole("alert")).textContent).toContain(
    "The connection dropped.",
  );
  const calls = () =>
    vi.mocked(api.postPullRequestComment).mock.calls.map((call) => call[2]);
  const failed = calls()[1]!;
  // Its name is kept with the comment, for a retry after a restart too.
  expect(
    draftComments()?.find((comment) => comment.body === "Two.")?.submission?.id,
  ).toBe(failed.submissionId);
  expect(draftComments()?.map((comment) => comment.body)).toEqual([
    "Two.",
    "Three.",
  ]);

  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await waitFor(() => expect(draftComments() ?? []).toEqual([]));
  const [, , retry, third] = calls();
  expect(retry).toMatchObject({
    body: "Two.",
    submissionId: failed.submissionId,
    firstTriedAt: expect.any(Number),
  });
  expect(third).toMatchObject({ body: "Three." });
  expect(third!.submissionId).not.toBe(failed.submissionId);
});

it("asks before posting a closed pull request comment again when the code host can't tell whether it has it", async () => {
  vi.mocked(api.postPullRequestComment)
    .mockRejectedValueOnce(new Error("The connection dropped."))
    .mockResolvedValueOnce({ uncertain: true });
  await renderClosedDraft("One.");
  fireEvent.click(
    await screen.findByRole("button", { name: "Post as comments · 1" }),
  );
  fireEvent.click(await screen.findByRole("button", { name: "Retry" }));

  expect((await screen.findByRole("alert")).textContent).toBe(
    "This comment may already be on GitHub: something you posted since may be it. Check the pull request, then post again if it's not there.",
  );
  expect(draftComments()).toHaveLength(1);
  const [first] = vi
    .mocked(api.postPullRequestComment)
    .mock.calls.map((call) => call[2]);

  fireEvent.click(screen.getByRole("button", { name: "Post again" }));
  await waitFor(() => expect(draftComments() ?? []).toEqual([]));
  const again = vi.mocked(api.postPullRequestComment).mock.calls[2]![2];
  expect(again.submissionId).not.toBe(first!.submissionId);
  expect(again).not.toHaveProperty("firstTriedAt");
});

it("asks before submitting a review again when the code host can't tell whether it has it", async () => {
  vi.mocked(api.submitPullRequestReview)
    .mockRejectedValueOnce(new Error("The connection dropped."))
    .mockResolvedValueOnce({ uncertain: true });
  await renderReviewPage();
  press("r");
  press("y");
  const dialog = await screen.findByRole("dialog", { name: "Finish review" });
  fireEvent.click(within(dialog).getByRole("button", { name: "Retry" }));

  await waitFor(() =>
    expect(within(dialog).getByRole("alert").textContent).toBe(
      "This review may already be on GitHub: something you posted since may be it. Check the pull request, then post again if it's not there. Your draft review is kept.",
    ),
  );
  const calls = () =>
    vi.mocked(api.submitPullRequestReview).mock.calls.map((call) => call[2]);
  expect(calls()[1]).toMatchObject({
    submissionId: calls()[0]!.submissionId,
    firstTriedAt: expect.any(Number),
  });

  fireEvent.click(within(dialog).getByRole("button", { name: "Post again" }));
  await waitFor(() =>
    expect(localStore.snapshot().deckDraftReviews).toEqual([]),
  );
  expect(calls()[2]!.submissionId).not.toBe(calls()[0]!.submissionId);
  expect(calls()[2]).not.toHaveProperty("firstTriedAt");
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
