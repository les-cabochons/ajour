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
import { localStore } from "@/lib/local-store";
import { ShortcutProvider } from "@/lib/shortcut-handlers";
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
const toasts = vi.hoisted(() => ({ show: vi.fn() }));
vi.mock("@/components/ui/toast", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/ui/toast")>()),
  showToast: toasts.show,
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
  toasts.show.mockReset();
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

it("starts a composer of its own for other lines or another comment to edit", async () => {
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
  const editOn = (line: number) =>
    fireEvent.click(
      within(
        within(changes()).getByRole("article", {
          name: `Draft comment on src/api.ts, line ${line}`,
        }),
      ).getByRole("button", { name: "Edit" }),
    );
  const field = () =>
    within(changes()).getByRole("textbox", {
      name: "Comment",
    }) as HTMLTextAreaElement;

  editOn(2);
  expect(field().value).toBe("On B.");
  fireEvent.change(field(), { target: { value: "Changed, not saved." } });
  // Editing the other comment shows its own words, and Save keeps them there.
  editOn(3);
  expect(field().value).toBe("On c.");
  fireEvent.click(within(changes()).getByRole("button", { name: "Save" }));
  expect(draftComments()?.map((comment) => comment.body)).toEqual([
    "On B.",
    "On c.",
  ]);

  fireEvent.click(screen.getByRole("button", { name: "Gutter + line 1" }));
  fireEvent.change(field(), { target: { value: "On a." } });
  fireEvent.click(screen.getByRole("button", { name: "Gutter + line 2" }));
  expect(field().value).toBe("");
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

it("asks before posting a comment again when the code host can't tell whether Comment now reached it", async () => {
  vi.mocked(api.postPullRequestComment)
    .mockRejectedValueOnce(new Error("The connection dropped."))
    .mockResolvedValueOnce({ uncertain: true });
  await renderReviewPage();
  const form = compose("Look here.");
  fireEvent.click(within(form).getByRole("button", { name: "Comment now" }));
  fireEvent.click(await within(form).findByRole("button", { name: "Retry" }));

  await waitFor(() =>
    expect(within(form).getByRole("alert").textContent).toBe(
      "This comment may already be on GitHub: something you posted since may be it. Check the pull request, then post again if it's not there.",
    ),
  );
  const calls = () =>
    vi.mocked(api.postPullRequestComment).mock.calls.map((call) => call[2]);
  expect(calls()[1]).toMatchObject({
    submissionId: calls()[0]!.submissionId,
    firstTriedAt: expect.any(Number),
  });
  // Not Retry: what it sends is a new post, which may make two.
  expect(within(form).queryByRole("button", { name: "Retry" })).toBeNull();

  fireEvent.click(within(form).getByRole("button", { name: "Post again" }));
  await waitFor(() =>
    expect(screen.queryByRole("form", { name: "New comment" })).toBeNull(),
  );
  expect(calls()[2]!.submissionId).not.toBe(calls()[0]!.submissionId);
  expect(calls()[2]).not.toHaveProperty("firstTriedAt");
});

it("offers Retry, not Post again, once a new post after an uncertain answer fails", async () => {
  vi.mocked(api.postPullRequestComment)
    .mockResolvedValueOnce({ uncertain: true })
    .mockRejectedValueOnce(new Error("The connection dropped."));
  await renderReviewPage();
  const form = compose("Look here.");
  fireEvent.click(within(form).getByRole("button", { name: "Comment now" }));
  fireEvent.click(
    await within(form).findByRole("button", { name: "Post again" }),
  );

  // The next click sends that new post's name again: a retry, not a new post.
  fireEvent.click(await within(form).findByRole("button", { name: "Retry" }));
  await waitFor(() =>
    expect(screen.queryByRole("form", { name: "New comment" })).toBeNull(),
  );
  const calls = vi
    .mocked(api.postPullRequestComment)
    .mock.calls.map((call) => call[2]);
  expect(calls[2]).toMatchObject({
    submissionId: calls[1]!.submissionId,
    firstTriedAt: expect.any(Number),
  });
});

it("keeps a later composer's name for its Retry when an earlier Comment now lands meanwhile", async () => {
  let landA: (value: { commentId: string }) => void = () => {};
  vi.mocked(api.postPullRequestComment)
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          landA = resolve;
        }),
    )
    .mockRejectedValueOnce(new Error("The connection dropped."));
  await renderReviewPage();
  // A, on line 2, waits for the code host.
  const a = compose("On B.");
  fireEvent.click(within(a).getByRole("button", { name: "Comment now" }));
  // B, on line 1, reaches it, but its answer is lost.
  fireEvent.click(screen.getByRole("button", { name: "Gutter + line 1" }));
  const b = screen.getByRole("form", { name: "New comment" });
  fireEvent.change(within(b).getByRole("textbox", { name: "Comment" }), {
    target: { value: "On a." },
  });
  fireEvent.click(within(b).getByRole("button", { name: "Comment now" }));
  await within(b).findByRole("button", { name: "Retry" });

  await act(async () => landA({ commentId: "comment-a" }));
  fireEvent.click(within(b).getByRole("button", { name: "Retry" }));
  await waitFor(() =>
    expect(screen.queryByRole("form", { name: "New comment" })).toBeNull(),
  );
  const [, first, retry] = vi
    .mocked(api.postPullRequestComment)
    .mock.calls.map((call) => call[2]);
  // The same name as B's first try, so the plugin finds the one it posted.
  expect(retry).toMatchObject({
    body: "On a.",
    submissionId: first!.submissionId,
    firstTriedAt: expect.any(Number),
  });
});

/** Comment now waits for the code host until `land` answers. */
function holdCommentNow() {
  const held = {
    land: (_value: { commentId: string }) => {},
    fail: (_error: Error) => {},
  };
  vi.mocked(api.postPullRequestComment).mockImplementationOnce(
    () =>
      new Promise((resolve, reject) => {
        held.land = resolve;
        held.fail = reject;
      }),
  );
  return held;
}

const commentField = (form: HTMLElement) =>
  within(form).getByRole("textbox", { name: "Comment" }) as HTMLTextAreaElement;

it("keeps the words typed while Comment now posts, once the post lands", async () => {
  const post = holdCommentNow();
  await renderReviewPage();
  const form = compose("On B.");
  fireEvent.click(within(form).getByRole("button", { name: "Comment now" }));
  fireEvent.change(commentField(form), {
    target: { value: "On B. And one more thing." },
  });

  await act(async () => post.land({ commentId: "comment-a" }));
  const still = screen.getByRole("form", { name: "New comment" });
  expect(commentField(still).value).toBe("On B. And one more thing.");
  // What landed is posted: the words left are a new comment.
  fireEvent.click(within(still).getByRole("button", { name: "Comment now" }));
  await waitFor(() =>
    expect(screen.queryByRole("form", { name: "New comment" })).toBeNull(),
  );
  const [first, next] = vi
    .mocked(api.postPullRequestComment)
    .mock.calls.map((call) => call[2]);
  expect(next).toMatchObject({ body: "On B. And one more thing." });
  expect(next!.submissionId).not.toBe(first!.submissionId);
  expect(next).not.toHaveProperty("firstTriedAt");
});

it("leaves a composer opened again on the same lines be when the earlier Comment now there lands", async () => {
  const post = holdCommentNow();
  await renderReviewPage();
  const a = compose("On B.");
  fireEvent.click(within(a).getByRole("button", { name: "Comment now" }));
  // Another composer opens, then one on the first lines again.
  fireEvent.click(screen.getByRole("button", { name: "Gutter + line 1" }));
  const again = compose("Second thoughts.");

  await act(async () => post.land({ commentId: "comment-a" }));
  const still = screen.getByRole("form", { name: "New comment" });
  expect(still).toBe(again);
  expect(commentField(still).value).toBe("Second thoughts.");
  expect(
    within(still).getByRole("button", { name: "Comment now" }),
  ).toHaveProperty("disabled", false);
});

it("leaves a composer opened again on the same lines be when the earlier Comment now there fails", async () => {
  const post = holdCommentNow();
  await renderReviewPage();
  const a = compose("On B.");
  fireEvent.click(within(a).getByRole("button", { name: "Comment now" }));
  fireEvent.click(screen.getByRole("button", { name: "Gutter + line 1" }));
  const again = compose("Second thoughts.");

  await act(async () => post.fail(new Error("GitHub is down.")));
  expect(within(again).queryByRole("alert")).toBeNull();
  expect(commentField(again).value).toBe("Second thoughts.");
  expect(
    within(again).getByRole("button", { name: "Comment now" }),
  ).toHaveProperty("disabled", false);
});

/** One file of 600 one-line hunks, so its rows mount only near the screen (#790). */
const HUGE: DeckOpenedPullRequest = {
  headSha: "one",
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

/**
 * The huge pull request's page in a 900px scroller whose rows are 100px
 * high, through the real virtualizer: about a dozen rows mount.
 */
async function renderHugeReviewPage(
  run: (scroller: HTMLElement) => Promise<void>,
) {
  vi.mocked(api.openDeckPullRequest).mockResolvedValue(HUGE);
  const restore = sizeElements([
    { selector: "[data-testid=scroller]", width: 1440, height: 900 },
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
    await screen.findByRole("button", { name: "Gutter + line 1" });
    await run(screen.getByTestId("scroller"));
  } finally {
    restore();
  }
}

const composerField = () =>
  screen.queryByRole("textbox", {
    name: "Comment",
  }) as HTMLTextAreaElement | null;

it("keeps the composer's words on a huge pull request as its hunk scrolls away and back, after its line", async () => {
  await renderHugeReviewPage(async (scroller) => {
    fireEvent.click(screen.getByRole("button", { name: "Gutter + line 1" }));
    fireEvent.change(composerField()!, { target: { value: "Keep me." } });
    expect(document.activeElement).toBe(composerField());

    // While it holds the focus, its hunk stays mounted however far away.
    scrollElement(scroller, { top: 61_000 });
    await waitFor(() =>
      expect(
        document.querySelector('[data-hunk="src/big.ts#599"]'),
      ).not.toBeNull(),
    );
    expect(composerField()?.value).toBe("Keep me.");
    expect(document.activeElement).toBe(composerField());

    // Without the focus it unmounts, and comes back with its words.
    act(() => composerField()!.blur());
    await waitFor(() => expect(composerField()).toBeNull());
    scrollElement(scroller, { top: 0 });
    await waitFor(() => expect(composerField()?.value).toBe("Keep me."));
    // It took the focus as it opened, once: back, it leaves it where it is.
    expect(document.activeElement).not.toBe(composerField());

    // A composer opened again starts empty.
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Gutter + line 1" }));
    expect(composerField()?.value).toBe("");
  });
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

it("keeps the summary read-only while the review sends, so what it sends is what completes", async () => {
  let answer!: (result: { reviewId: string }) => void;
  vi.mocked(api.submitPullRequestReview).mockImplementationOnce(
    () => new Promise((resolve) => (answer = resolve)),
  );
  await renderReviewPage();
  fireEvent.click(screen.getByRole("button", { name: "Finish review" }));
  const dialog = await screen.findByRole("dialog", { name: "Finish review" });
  const summary = () =>
    within(dialog).getByRole("textbox", {
      name: "Summary",
    }) as HTMLTextAreaElement;
  fireEvent.change(summary(), { target: { value: "A few things." } });
  fireEvent.click(
    within(dialog).getByRole("button", { name: "Submit review" }),
  );
  await waitFor(() => expect(api.submitPullRequestReview).toHaveBeenCalled());

  // It stays readable and focusable, and takes no typing until it's sent.
  expect(summary().readOnly).toBe(true);
  expect(summary().disabled).toBe(false);
  expect(summary().value).toBe("A few things.");
  await act(async () => answer({ reviewId: "review-1" }));

  expect(vi.mocked(api.submitPullRequestReview).mock.calls[0]![2].body).toBe(
    "A few things.",
  );
  await waitFor(() =>
    expect(screen.queryByRole("dialog", { name: "Finish review" })).toBeNull(),
  );
});

it("keeps a summary it didn't send when R then Y approves", async () => {
  await renderReviewPage();
  fireEvent.click(screen.getByRole("button", { name: "Finish review" }));
  let dialog = await screen.findByRole("dialog", { name: "Finish review" });
  fireEvent.change(within(dialog).getByRole("textbox", { name: "Summary" }), {
    target: { value: "Still thinking." },
  });
  fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
  await waitFor(() =>
    expect(screen.queryByRole("dialog", { name: "Finish review" })).toBeNull(),
  );

  press("r");
  press("y");
  await waitFor(() => expect(toasts.show).toHaveBeenCalledWith("Approved"));
  expect(
    vi.mocked(api.submitPullRequestReview).mock.calls[0]![2],
  ).not.toHaveProperty("body");

  fireEvent.click(screen.getByRole("button", { name: "Finish review" }));
  dialog = await screen.findByRole("dialog", { name: "Finish review" });
  expect(
    (
      within(dialog).getByRole("textbox", {
        name: "Summary",
      }) as HTMLTextAreaElement
    ).value,
  ).toBe("Still thinking.");
});

it("keeps a draft comment edited while the review was sending, with its new words", async () => {
  let answer!: (result: { reviewId: string }) => void;
  vi.mocked(api.submitPullRequestReview).mockImplementationOnce(
    () => new Promise((resolve) => (answer = resolve)),
  );
  await renderReviewPage();
  fireEvent.click(
    within(compose("Rename this.")).getByRole("button", {
      name: "Add to review",
    }),
  );
  press("r");
  press("y");
  await waitFor(() => expect(api.submitPullRequestReview).toHaveBeenCalled());

  const card = within(changes()).getByRole("article", {
    name: "Draft comment on src/api.ts, line 2",
  });
  fireEvent.click(within(card).getByRole("button", { name: "Edit" }));
  const editing = screen.getByRole("form", { name: "Edit the draft comment" });
  fireEvent.change(within(editing).getByRole("textbox", { name: "Comment" }), {
    target: { value: "Rename it to run." },
  });
  fireEvent.click(within(editing).getByRole("button", { name: "Save" }));
  await act(async () => answer({ reviewId: "review-1" }));

  await waitFor(() =>
    expect(
      localStore.snapshot().deckDraftReviews?.[0]?.submission,
    ).toBeUndefined(),
  );
  expect(draftComments()).toEqual([
    expect.objectContaining({ body: "Rename it to run." }),
  ]);
  expect(
    within(changes()).getByRole("article", {
      name: "Draft comment on src/api.ts, line 2",
    }).textContent,
  ).toContain("Rename it to run.");
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

  fireEvent.click(screen.getByRole("tab", { name: "Overview" }));
  const outdated = screen.getByRole("region", { name: "Draft comments" });
  const card = within(outdated).getByRole("article", {
    name: "Draft comment on src/api.ts, line 2",
  });
  expect(within(card).getByText("Outdated")).toBeTruthy();
  expect(within(card).getByText("src/api.ts, line 2")).toBeTruthy();
  fireEvent.click(screen.getByRole("tab", { name: /^Changes/ }));
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
  // Its lines still select, for Explain and Ask, but take no comment.
  expect(
    screen.queryByRole("button", { name: /^Comment on .*line \d/ }),
  ).toBeNull();

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

it("takes what was posted out of the draft when new commits held back the vote, and says to vote again", async () => {
  const overview: PluginsOverview = structuredClone(codeHostOverview);
  overview.connectionGroups[0]!.plugin.id = "azure_devops";
  overview.connectionGroups[0]!.connections[0]!.pluginId = "azure_devops";
  overview.plugins = overview.connectionGroups.map((group) => group.plugin);
  cachePluginsOverview(overview);
  const id = sync({}, "azure_devops");
  vi.mocked(api.submitPullRequestReview).mockResolvedValueOnce({
    reviewId: "1-alex",
    voteWithheld: { reason: "new_commits" },
  });
  await renderReviewPage(id);
  fireEvent.click(
    within(compose("Rename this.")).getByRole("button", {
      name: "Add to review",
    }),
  );
  const reads = vi.mocked(api.readPullRequestConversation).mock.calls.length;

  fireEvent.click(screen.getByRole("button", { name: "Finish review · 1" }));
  let dialog = await screen.findByRole("dialog", { name: "Finish review" });
  fireEvent.change(within(dialog).getByRole("textbox", { name: "Summary" }), {
    target: { value: "Looks good." },
  });
  fireEvent.click(within(dialog).getByRole("radio", { name: "Approve" }));
  fireEvent.click(
    within(dialog).getByRole("button", { name: "Submit review" }),
  );

  const withheld = await screen.findByRole("dialog", {
    name: "Your vote wasn't sent",
  });
  expect(withheld.textContent).toContain(
    "New commits arrived while your review was sending. Your comment and summary are on the pull request; review the new commits, then vote again.",
  );
  // They're on the pull request: the draft lets go of them, and the page
  // reads the conversation again to show them.
  expect(draftComments() ?? []).toEqual([]);
  await waitFor(() =>
    expect(
      vi.mocked(api.readPullRequestConversation).mock.calls.length,
    ).toBeGreaterThan(reads),
  );
  fireEvent.click(
    within(withheld)
      .getAllByRole("button", { name: "Close" })
      .find((button) => button.textContent === "Close")!,
  );

  // Approving again sends the vote alone: no thread is posted twice.
  fireEvent.click(screen.getByRole("button", { name: "Finish review" }));
  dialog = await screen.findByRole("dialog", { name: "Finish review" });
  expect(within(dialog).getByText("No comments.")).toBeTruthy();
  fireEvent.click(within(dialog).getByRole("radio", { name: "Approve" }));
  fireEvent.click(
    within(dialog).getByRole("button", { name: "Submit review" }),
  );
  await waitFor(() =>
    expect(api.submitPullRequestReview).toHaveBeenCalledTimes(2),
  );
  const [first, second] = vi
    .mocked(api.submitPullRequestReview)
    .mock.calls.map((call) => call[2]);
  expect(second).toMatchObject({ verdict: "approve", comments: [] });
  expect(second).not.toHaveProperty("body");
  expect(second!.submissionId).not.toBe(first!.submissionId);
});

it("opens the dialog on why the vote wasn't sent after R then Y, when new commits held it back", async () => {
  vi.mocked(api.submitPullRequestReview).mockResolvedValueOnce({
    reviewId: "1-alex",
    voteWithheld: { reason: "new_commits" },
  });
  await renderReviewPage();
  press("r");
  press("y");
  // As a failure does, it opens the dialog on why.
  const dialog = await screen.findByRole("dialog", {
    name: "Your vote wasn't sent",
  });
  expect(dialog.textContent).toContain(
    "New commits arrived while your review was sending. Review them, then vote again.",
  );
  expect(toasts.show).not.toHaveBeenCalled();
  expect(localStore.snapshot().deckDraftReviews).toEqual([]);
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
