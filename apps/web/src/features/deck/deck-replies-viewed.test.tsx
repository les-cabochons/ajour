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
 * The rest of a review round (#785): replying to a thread, resolving and
 * unresolving it, suggesting a change from the composer, and viewed marks
 * that last, a file's synced with the code host where it keeps them. The
 * local API and the diff library are mocked.
 */

vi.mock("@/lib/app-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/app-api")>()),
  openDeckPullRequest: vi.fn(),
  readPullRequestConversation: vi.fn(),
  readPullRequestChecks: vi.fn(),
  postPullRequestComment: vi.fn(),
  replyToPullRequestThread: vi.fn(),
  setPullRequestThreadResolved: vi.fn(),
  setPullRequestFileViewed: vi.fn(),
}));
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

/** Line 2 of the head reads "B"; api.ts has a second hunk, notes.md one. */
const DIFF: DeckOpenedPullRequest = {
  headSha: "one",
  baseSha: "base",
  guide: null,
  files: [
    {
      path: "notes.md",
      status: "modified",
      binary: false,
      hunks: [hunk("notes.md#0", "@@ -10,1 +10,2 @@", [" # Notes", "+More."])],
    },
    {
      path: "src/api.ts",
      status: "modified",
      binary: false,
      hunks: [
        hunk("src/api.ts#0", "@@ -1,3 +1,3 @@", [" a", "-b", "+B", " c"]),
        hunk("src/api.ts#1", "@@ -20,3 +20,3 @@", [" x", "-y", "+Y", " z"]),
      ],
    },
  ],
};

/** A push: a new hunk comes first in api.ts, B is untouched, Y became Why. */
const PUSHED: DeckOpenedPullRequest = {
  headSha: "two",
  baseSha: "base",
  guide: null,
  files: [
    DIFF.files[0]!,
    {
      path: "src/api.ts",
      status: "modified",
      binary: false,
      hunks: [
        hunk("src/api.ts#0", "@@ -1,1 +1,2 @@", [" top", "+inserted"]),
        hunk("src/api.ts#1", "@@ -5,3 +6,3 @@", [" a", "-b", "+B", " c"]),
        hunk("src/api.ts#2", "@@ -30,3 +31,3 @@", [" x", "-y", "+Why", " z"]),
      ],
    },
  ],
};

const thread = (
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

const conversation = (
  overrides: Partial<CodeHostConversationResult> = {},
): CodeHostConversationResult => ({
  description: "",
  timeline: [],
  threads: [thread("t1")],
  viewedPaths: [],
  mergeMethods: ["merge"],
  ...overrides,
});

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
  vi.mocked(api.readPullRequestConversation).mockResolvedValue(conversation());
  vi.mocked(api.readPullRequestChecks).mockResolvedValue({ checks: [] });
  vi.mocked(api.replyToPullRequestThread).mockResolvedValue({
    commentId: "reply-1",
  });
  vi.mocked(api.postPullRequestComment).mockResolvedValue({
    commentId: "comment-1",
  });
  vi.mocked(api.setPullRequestThreadResolved).mockImplementation(
    async (_plugin, _connection, request) => ({ resolved: request.resolved }),
  );
  vi.mocked(api.setPullRequestFileViewed).mockImplementation(
    async (_plugin, _connection, request) => ({ viewed: request.viewed }),
  );
});

afterEach(() => {
  cleanup();
  localStore.discardDraftReview(REF);
  localStore.removeConnectionPullRequests("github", "work");
  localStore.removeConnectionPullRequests("azure_devops", "work");
  vi.mocked(api.openDeckPullRequest).mockReset();
  vi.mocked(api.readPullRequestConversation).mockReset();
  vi.mocked(api.readPullRequestChecks).mockReset();
  vi.mocked(api.replyToPullRequestThread).mockReset();
  vi.mocked(api.postPullRequestComment).mockReset();
  vi.mocked(api.setPullRequestThreadResolved).mockReset();
  vi.mocked(api.setPullRequestFileViewed).mockReset();
  vi.restoreAllMocks();
});

async function renderReviewPage(id = itemId) {
  const rendered = await renderRoutes({
    shell: Shell,
    path: `/deck/${id}`,
    routes: { "/deck/$itemId": () => <DeckPage itemId={id} /> },
  });
  // A viewed hunk folds, so the page is ready once its files' marks show.
  await screen.findByRole("button", { name: "Viewed file: src/api.ts" });
  return rendered;
}

const changes = () => screen.getByRole("region", { name: "Changes" });
const threadCard = () =>
  within(changes()).getByRole("article", {
    name: "Thread on src/api.ts, line 2",
  });
const viewedMark = (name: string) =>
  within(changes()).getByRole("button", { name }).getAttribute("aria-pressed");
const tick = (name: string) =>
  within(
    within(changes()).getByRole("navigation", { name: "Guide tree" }),
  ).getByRole("button", { name });

function writeReply(text: string) {
  fireEvent.click(within(threadCard()).getByRole("button", { name: "Reply" }));
  const form = within(threadCard()).getByRole("form", {
    name: "Reply to the thread",
  });
  const field = within(form).getByRole("textbox", { name: "Reply" });
  fireEvent.change(field, { target: { value: text } });
  return { form, field };
}

it("replies to a thread at once, named, and shows the reply while the conversation reads again", async () => {
  await renderReviewPage();
  const { field } = writeReply("Done in the next push.");
  expect(document.activeElement).toBe(field);
  // A conversation read that hasn't answered yet keeps the thread showing.
  let answer: (value: CodeHostConversationResult) => void = () => {};
  vi.mocked(api.readPullRequestConversation).mockImplementationOnce(
    () => new Promise((resolve) => (answer = resolve)),
  );
  fireEvent.keyDown(field, { key: "Enter", ctrlKey: true });

  await waitFor(() =>
    expect(
      within(threadCard()).queryByRole("form", { name: "Reply to the thread" }),
    ).toBeNull(),
  );
  expect(api.replyToPullRequestThread).toHaveBeenCalledWith("github", "work", {
    repository: "acme/api",
    number: 1,
    threadId: "t1",
    body: "Done in the next push.",
    submissionId: expect.stringMatching(/^reply_submission_/),
  });
  expect(within(threadCard()).getByText("Done in the next push.")).toBeTruthy();
  expect(within(threadCard()).getByText("You")).toBeTruthy();

  // The conversation's answer holds the reply: it shows once, as the code host has it.
  const replied = thread("t1");
  replied.comments.push({
    id: "reply-1",
    author: { login: "alex", isBot: false },
    body: "Done in the next push.",
    createdAt: 30,
  });
  await act(async () => answer(conversation({ threads: [replied] })));
  await waitFor(() =>
    expect(within(threadCard()).queryByText("You")).toBeNull(),
  );
  expect(
    within(threadCard()).getAllByText("Done in the next push."),
  ).toHaveLength(1);
  // Nothing went to the draft review.
  expect(localStore.snapshot().deckDraftReviews ?? []).toEqual([]);
});

it("keeps a failed reply's words with Retry, which sends the same name, and asks before posting an unsettled one again", async () => {
  vi.mocked(api.replyToPullRequestThread).mockRejectedValueOnce(
    new Error("GitHub is unavailable."),
  );
  await renderReviewPage();
  const { form } = writeReply("Agreed.");
  fireEvent.click(within(form).getByRole("button", { name: "Reply" }));

  expect((await within(form).findByRole("alert")).textContent).toBe(
    "Couldn't post the reply: GitHub is unavailable.",
  );
  const first = vi.mocked(api.replyToPullRequestThread).mock.calls[0]![2];
  expect(
    (
      within(form).getByRole("textbox", {
        name: "Reply",
      }) as HTMLTextAreaElement
    ).value,
  ).toBe("Agreed.");

  vi.mocked(api.replyToPullRequestThread).mockResolvedValueOnce({
    uncertain: true,
  });
  fireEvent.click(within(form).getByRole("button", { name: "Retry" }));
  expect(
    (await within(form).findByRole("button", { name: "Post again" }))
      .textContent,
  ).toBe("Post again");
  const retry = vi.mocked(api.replyToPullRequestThread).mock.calls[1]![2];
  expect(retry.submissionId).toBe(first.submissionId);
  expect(retry.firstTriedAt).toEqual(expect.any(Number));
  expect(within(form).getByRole("alert").textContent).toBe(
    "This reply may already be on GitHub: something you posted since may be it. Check the pull request, then post again if it's not there.",
  );

  fireEvent.click(within(form).getByRole("button", { name: "Post again" }));
  await waitFor(() =>
    expect(vi.mocked(api.replyToPullRequestThread)).toHaveBeenCalledTimes(3),
  );
  const again = vi.mocked(api.replyToPullRequestThread).mock.calls[2]![2];
  expect(again.submissionId).not.toBe(first.submissionId);
  expect(again.firstTriedAt).toBeUndefined();
});

it("sends a reply's Ctrl+Enter to the reply alone, not to the open composer", async () => {
  await renderReviewPage();
  fireEvent.click(screen.getByRole("button", { name: "Gutter + line 2" }));
  const composer = screen.getByRole("form", { name: "New comment" });
  fireEvent.change(within(composer).getByRole("textbox", { name: "Comment" }), {
    target: { value: "A line comment." },
  });
  const { field } = writeReply("A reply.");
  fireEvent.keyDown(field, { key: "Enter", ctrlKey: true });
  await waitFor(() =>
    expect(api.replyToPullRequestThread).toHaveBeenCalledTimes(1),
  );
  expect(localStore.snapshot().deckDraftReviews ?? []).toEqual([]);
});

it("resolves and unresolves a thread at once, and says why when it fails", async () => {
  await renderReviewPage();
  fireEvent.click(
    within(threadCard()).getByRole("button", { name: "Resolve" }),
  );
  expect(
    await within(threadCard()).findByRole("button", { name: "Unresolve" }),
  ).toBeTruthy();
  expect(within(threadCard()).getByText("Resolved")).toBeTruthy();
  expect(api.setPullRequestThreadResolved).toHaveBeenCalledWith(
    "github",
    "work",
    { repository: "acme/api", number: 1, threadId: "t1", resolved: true },
  );

  vi.mocked(api.setPullRequestThreadResolved).mockRejectedValueOnce(
    new Error("Not allowed."),
  );
  fireEvent.click(
    within(threadCard()).getByRole("button", { name: "Unresolve" }),
  );
  expect((await within(threadCard()).findByRole("alert")).textContent).toBe(
    "Couldn't unresolve the thread: Not allowed.",
  );
  // Still resolved, as the code host has it.
  expect(within(threadCard()).getByText("Resolved")).toBeTruthy();
});

it("points to the access choice when the connection can't review", async () => {
  vi.mocked(api.setPullRequestThreadResolved).mockRejectedValueOnce(
    new AppApiError("Review pull requests is off.", 403, "reviewPullRequests"),
  );
  await renderReviewPage();
  fireEvent.click(
    within(threadCard()).getByRole("button", { name: "Resolve" }),
  );
  expect((await within(threadCard()).findByRole("alert")).textContent).toBe(
    "Couldn't resolve the thread: This GitHub connection can't review pull requests. Turn on Review pull requests for Work in Settings › Plugins, then retry.",
  );
});

it("offers no reply or resolve on a closed pull request", async () => {
  itemId = sync({ state: "merged" });
  // A closed pull request has no "+" to wait for.
  await renderRoutes({
    shell: Shell,
    path: `/deck/${itemId}`,
    routes: { "/deck/$itemId": () => <DeckPage itemId={itemId} /> },
  });
  const card = await screen.findByRole("article", {
    name: "Thread on src/api.ts, line 2",
  });
  expect(within(card).queryByRole("button", { name: "Reply" })).toBeNull();
  expect(within(card).queryByRole("button", { name: "Resolve" })).toBeNull();
});

it("suggests a change: the composer adds a suggestion block holding the line's text", async () => {
  await renderReviewPage();
  fireEvent.click(screen.getByRole("button", { name: "Gutter + line 2" }));
  const form = screen.getByRole("form", { name: "New comment" });
  const field = within(form).getByRole("textbox", {
    name: "Comment",
  }) as HTMLTextAreaElement;
  fireEvent.change(field, { target: { value: "Capitalize it:" } });
  fireEvent.click(within(form).getByRole("button", { name: "Suggest change" }));
  expect(field.value).toBe("Capitalize it:\n\n```suggestion\nB\n```");
  expect(document.activeElement).toBe(field);

  fireEvent.click(within(form).getByRole("button", { name: "Comment now" }));
  await waitFor(() => expect(api.postPullRequestComment).toHaveBeenCalled());
  expect(vi.mocked(api.postPullRequestComment).mock.calls[0]![2]).toMatchObject(
    {
      body: "Capitalize it:\n\n```suggestion\nB\n```",
      anchor: { path: "src/api.ts", side: "head", line: 2, headSha: "one" },
    },
  );
});

it("keeps viewed marks across a reopen, and the guide tree's ticks follow them", async () => {
  await renderReviewPage();
  expect(tick("src/api.ts · 0 of 2 viewed")).toBeTruthy();
  fireEvent.click(
    within(changes()).getByRole("button", {
      name: "Viewed: src/api.ts, lines 1 to 3",
    }),
  );
  expect(tick("src/api.ts · 1 of 2 viewed")).toBeTruthy();
  // One hunk of two: the file isn't viewed yet, so GitHub isn't told.
  expect(api.setPullRequestFileViewed).not.toHaveBeenCalled();

  cleanup();
  await renderReviewPage();
  expect(viewedMark("Viewed: src/api.ts, lines 1 to 3")).toBe("true");
  expect(viewedMark("Viewed file: src/api.ts")).toBe("false");
  expect(tick("src/api.ts · 1 of 2 viewed")).toBeTruthy();
});

it("marks a file viewed on GitHub once its hunks all are, at the head read, and unmarks it", async () => {
  await renderReviewPage();
  fireEvent.click(
    within(changes()).getByRole("button", { name: "Viewed file: src/api.ts" }),
  );
  expect(viewedMark("Viewed: src/api.ts, lines 1 to 3")).toBe("true");
  expect(viewedMark("Viewed: src/api.ts, lines 20 to 22")).toBe("true");
  expect(tick("src/api.ts · 2 of 2 viewed")).toBeTruthy();
  await waitFor(() =>
    expect(api.setPullRequestFileViewed).toHaveBeenCalledWith(
      "github",
      "work",
      {
        repository: "acme/api",
        number: 1,
        path: "src/api.ts",
        viewed: true,
        headSha: "one",
      },
    ),
  );

  // Unmarking one hunk unmarks the file.
  fireEvent.click(
    within(changes()).getByRole("button", {
      name: "Viewed: src/api.ts, lines 20 to 22",
    }),
  );
  expect(viewedMark("Viewed file: src/api.ts")).toBe("false");
  await waitFor(() =>
    expect(api.setPullRequestFileViewed).toHaveBeenLastCalledWith(
      "github",
      "work",
      expect.objectContaining({ path: "src/api.ts", viewed: false }),
    ),
  );
  expect(api.setPullRequestFileViewed).toHaveBeenCalledTimes(2);
});

it("shows viewed the files GitHub says the user viewed, and doesn't mark one again after it's unmarked", async () => {
  vi.mocked(api.readPullRequestConversation).mockResolvedValue(
    conversation({ viewedPaths: ["src/api.ts"] }),
  );
  await renderReviewPage();
  await waitFor(() =>
    expect(viewedMark("Viewed file: src/api.ts")).toBe("true"),
  );
  expect(tick("src/api.ts · 2 of 2 viewed")).toBeTruthy();
  expect(viewedMark("Viewed file: notes.md")).toBe("false");

  fireEvent.click(
    within(changes()).getByRole("button", { name: "Viewed file: src/api.ts" }),
  );
  expect(viewedMark("Viewed file: src/api.ts")).toBe("false");
  // A reply reads the conversation again, which may still say viewed.
  await within(changes()).findByRole("article", {
    name: "Thread on src/api.ts, line 2",
  });
  writeReply("Thanks.");
  fireEvent.click(within(threadCard()).getByRole("button", { name: "Reply" }));
  await waitFor(() =>
    expect(api.readPullRequestConversation).toHaveBeenCalledTimes(2),
  );
  await act(async () => {});
  expect(viewedMark("Viewed file: src/api.ts")).toBe("false");
});

it("keeps a host without per-file viewed state to this computer, without asking again", async () => {
  const overview: PluginsOverview = structuredClone(codeHostOverview);
  overview.connectionGroups[0]!.plugin.id = "azure_devops";
  overview.connectionGroups[0]!.connections[0]!.pluginId = "azure_devops";
  overview.plugins = overview.connectionGroups.map((group) => group.plugin);
  cachePluginsOverview(overview);
  itemId = sync({}, "azure_devops");
  vi.mocked(api.setPullRequestFileViewed).mockRejectedValue(
    new AppApiError("Azure DevOps doesn't offer this yet.", 404, undefined, {
      reason: "not_supported",
    }),
  );
  await renderReviewPage(itemId);
  fireEvent.click(
    within(changes()).getByRole("button", { name: "Viewed file: notes.md" }),
  );
  await waitFor(() =>
    expect(api.setPullRequestFileViewed).toHaveBeenCalledTimes(1),
  );
  fireEvent.click(
    within(changes()).getByRole("button", { name: "Viewed file: src/api.ts" }),
  );
  await act(async () => {});
  expect(api.setPullRequestFileViewed).toHaveBeenCalledTimes(1);
  expect(viewedMark("Viewed file: notes.md")).toBe("true");
  expect(viewedMark("Viewed file: src/api.ts")).toBe("true");
  expect(screen.queryByText(/Couldn't mark/)).toBeNull();
});

it("after a new head, keeps the marks of unchanged hunks and clears the changed ones", async () => {
  await renderReviewPage();
  for (const name of [
    "Viewed: src/api.ts, lines 1 to 3",
    "Viewed: src/api.ts, lines 20 to 22",
    "Viewed: notes.md, lines 10 to 11",
  ])
    fireEvent.click(within(changes()).getByRole("button", { name }));
  cleanup();

  vi.mocked(api.openDeckPullRequest).mockResolvedValue(PUSHED);
  itemId = sync({ headSha: "two" });
  await renderReviewPage();
  // B moved to lines 6 to 8 and stays viewed; Why changed; the new hunk is new.
  expect(viewedMark("Viewed: src/api.ts, lines 6 to 8")).toBe("true");
  expect(viewedMark("Viewed: src/api.ts, lines 31 to 33")).toBe("false");
  expect(viewedMark("Viewed: src/api.ts, lines 1 to 2")).toBe("false");
  expect(viewedMark("Viewed: notes.md, lines 10 to 11")).toBe("true");
  expect(tick("src/api.ts · 1 of 3 viewed")).toBeTruthy();
  // The cleared mark is gone from local state, not only hidden.
  const stored = localStore.snapshot().deckViewedMarks?.[0];
  expect(stored?.headSha).toBe("two");
  expect(Object.values(stored?.files ?? {}).flat()).toHaveLength(2);
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

it("keeps a reply's words on a huge pull request as its thread scrolls away and back, and marks the whole file viewed from its row", async () => {
  vi.mocked(api.openDeckPullRequest).mockResolvedValue(HUGE);
  vi.mocked(api.readPullRequestConversation).mockResolvedValue(
    conversation({ threads: [thread("big", { path: "src/big.ts", line: 1 })] }),
  );
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
    const scroller = screen.getByTestId("scroller");
    const card = await screen.findByRole("article", {
      name: "Thread on src/big.ts, line 1",
    });
    fireEvent.click(within(card).getByRole("button", { name: "Reply" }));
    const field = () =>
      screen.queryByRole("textbox", {
        name: "Reply",
      }) as HTMLTextAreaElement | null;
    fireEvent.change(field()!, { target: { value: "Keep me." } });
    act(() => field()!.blur());

    scrollElement(scroller, { top: 61_000 });
    await waitFor(() => expect(field()).toBeNull());
    scrollElement(scroller, { top: 0 });
    await waitFor(() => expect(field()?.value).toBe("Keep me."));

    // The file's own mark, in its section's row, marks all 600 hunks.
    fireEvent.click(
      screen.getByRole("button", { name: "Viewed file: src/big.ts" }),
    );
    expect(
      screen
        .getByRole("button", { name: "Viewed file: src/big.ts" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      within(screen.getByRole("navigation", { name: "Guide tree" })).getByRole(
        "button",
        { name: "src/big.ts · 600 of 600 viewed" },
      ),
    ).toBeTruthy();
    await waitFor(() =>
      expect(api.setPullRequestFileViewed).toHaveBeenCalledWith(
        "github",
        "work",
        expect.objectContaining({ path: "src/big.ts", viewed: true }),
      ),
    );
  } finally {
    restore();
  }
});
