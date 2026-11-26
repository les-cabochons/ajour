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
import {
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  it,
  onTestFinished,
  vi,
} from "vitest";
import type { AgentTurnEvent } from "@ajour/shared/agent-runs";
import type { CodeHostConversationResult } from "@ajour/shared";
import type { DeckOpenedPullRequest } from "@ajour/shared/deck";
import { TooltipProvider } from "@/components/ui/tooltip";
import * as api from "@/lib/app-api";
import { receiveAgentTurnEvent } from "@/lib/agent-turns";
import { cachePluginsOverview } from "@/lib/app-api";
import { localStore } from "@/lib/local-store";
import { NO_DECK_SUMMARY } from "@/test-support/deck";
import { ShortcutProvider } from "@/lib/shortcut-handlers";
import {
  installDomShims,
  renderRoutes,
  stubNarrowView,
} from "@/test-support/dom";
import {
  codeHostOverview,
  pullRequestFacts,
} from "../../../tests/fixtures/pull-requests";
import { DeckPage } from "./deck-page";

/*
 * Explain, Comment and Ask on selected lines (#793). Dragging over line
 * numbers, or tapping two of them in the narrow view, selects lines and
 * shows a toolbar above them; E, C and A act on them only then. The answer
 * goes after the hunk's lines and its threads, never between code lines;
 * Turn into a comment opens the composer with it, and its citations go to
 * their lines. The local API and the diff library are mocked: the library
 * draws one button per line number, and reports a selection as the real
 * one does, through the hunk's options.
 */

type Range = {
  start: number;
  end: number;
  side: "additions" | "deletions";
  endSide?: "additions" | "deletions";
};

interface LibraryOptions {
  enableLineSelection?: boolean;
  onLineSelectionChange?: (range: Range | null) => void;
  onLineSelectionEnd?: (range: Range | null) => void;
  onGutterUtilityClick?: (range: Range) => void;
}

/** Each hunk's options, by its patch, as the library last got them. */
const library = new Map<string, LibraryOptions>();

vi.mock("@/lib/app-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/app-api")>()),
  openDeckPullRequest: vi.fn(),
  readPullRequestConversation: vi.fn(),
  readPullRequestChecks: vi.fn(),
  askDeck: vi.fn(),
  grantDeckConsent: vi.fn(),
  cancelAgentTurn: vi.fn(),
}));
vi.mock("@/components/diff-highlighter", () => ({
  diffWorkerPool: () => undefined,
}));
vi.mock("@pierre/diffs/react", async () => ({
  WorkerPoolContext: (await import("react")).createContext(undefined),
  PatchDiff: ({
    patch,
    options,
    selectedLines,
    lineAnnotations,
    renderAnnotation,
  }: {
    patch: string;
    options: LibraryOptions;
    selectedLines?: Range | null;
    lineAnnotations?: { metadata: { key: string } }[];
    renderAnnotation?: (annotation: unknown) => ReactNode;
  }) => {
    library.set(patch, options);
    const rows = patch.split("\n");
    const at = rows.findIndex((row) => row.startsWith("@@"));
    const [, oldStart = 1, newStart = 1] =
      /^@@ -(\d+)(?:,\d+)? \+(\d+)/.exec(rows[at] ?? "")?.map(Number) ?? [];
    let base = oldStart;
    let head = newStart;
    const numbers: Range[] = [];
    for (const row of rows.slice(at + 1)) {
      if (row.startsWith("-"))
        numbers.push({ side: "deletions", start: base, end: base++ });
      else if (row.startsWith("+") || row.startsWith(" ")) {
        numbers.push({ side: "additions", start: head, end: head++ });
        if (row.startsWith(" ")) base += 1;
      }
    }
    return (
      <div
        data-selected={
          selectedLines
            ? `${selectedLines.side}:${selectedLines.start}-${selectedLines.endSide}:${selectedLines.end}`
            : ""
        }
      >
        <pre>{patch}</pre>
        {options.enableLineSelection
          ? numbers.map((range) => (
              <button
                key={`${range.side}${range.start}`}
                type="button"
                onClick={() => options.onLineSelectionEnd?.(range)}
              >
                {`${range.side === "deletions" ? "Removed line" : "Line"} number ${range.start}`}
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

beforeAll(installDomShims);
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

const HEAD = "a41c9e2f0d1b";

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

const FIRST = hunk("src/api.ts#0", "@@ -1,3 +1,3 @@", [" a", "-b", "+B", " c"]);
const SECOND = hunk("src/api.ts#1", "@@ -40,1 +40,1 @@", ["-y", "+Y"]);

const DIFF: DeckOpenedPullRequest = {
  headSha: HEAD,
  baseSha: "b52d0f3a11",
  files: [
    {
      path: "src/api.ts",
      status: "modified",
      binary: false,
      hunks: [FIRST, SECOND],
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
        hunkIds: ["src/api.ts#0"],
        kinds: [],
      },
      {
        id: "g2",
        title: "Read it later",
        rationale: "Further down.",
        hunkIds: ["src/api.ts#1"],
        kinds: [],
      },
    ],
  },
};

/** Line 2 of the head has a thread. */
const CONVERSATION: CodeHostConversationResult = {
  description: "",
  timeline: [],
  threads: [
    {
      id: "t1",
      path: "src/api.ts",
      side: "head",
      line: 2,
      resolved: false,
      outdated: false,
      comments: [
        {
          id: "c1",
          author: { login: "rivka", isBot: false },
          body: "Why upper case?",
          createdAt: 1795600000000,
        },
      ],
    },
  ],
  viewedPaths: [],
  mergeMethods: ["merge"],
};

const REF = {
  pluginId: "github",
  connectionId: "work",
  repository: "acme/billing-api",
  number: 1,
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
      pullRequests: [{ ...pullRequestFacts, repository: "acme/billing-api" }],
    },
  );
  itemId = localStore.snapshot().pullRequests![0]!._id;
  vi.mocked(api.openDeckPullRequest).mockResolvedValue(DIFF);
  vi.mocked(api.readPullRequestConversation).mockResolvedValue(CONVERSATION);
  vi.mocked(api.readPullRequestChecks).mockResolvedValue({ checks: [] });
});

afterEach(() => {
  cleanup();
  library.clear();
  localStore.discardDraftReview(REF);
  vi.mocked(api.openDeckPullRequest).mockReset();
  vi.mocked(api.readPullRequestConversation).mockReset();
  vi.mocked(api.readPullRequestChecks).mockReset();
  vi.mocked(api.askDeck).mockReset();
  vi.restoreAllMocks();
});

async function renderReviewPage() {
  await renderRoutes({
    shell: Shell,
    path: `/deck/${itemId}`,
    routes: { "/deck/$itemId": () => <DeckPage itemId={itemId} /> },
  });
  await screen.findAllByRole("button", { name: "Line number 1" });
  await screen.findByRole("article", { name: /Thread on src\/api.ts/ });
}

/** The hunk's box, as the page names it. */
const hunkBox = (name: string) => screen.getByRole("group", { name });

/** Drags over line numbers in `of`, from `from` to `to`, as the library reports it. */
function drag(of: { patch: string }, range: Range) {
  const options = library.get(of.patch)!;
  act(() => options.onLineSelectionChange?.(range));
  act(() => options.onLineSelectionEnd?.(range));
}

function press(key: string) {
  act(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key }));
  });
}

const toolbar = () => screen.queryByRole("toolbar", { name: /selected/ });

it("shows Explain, Comment and Ask above lines dragged over, and E and C act only while lines are selected", async () => {
  vi.mocked(api.askDeck).mockResolvedValue({
    kind: "answer",
    text: "It upper-cases the second line.",
    head: HEAD,
  });
  await renderReviewPage();

  // Nothing at rest: no toolbar, and the keys do nothing.
  expect(toolbar()).toBeNull();
  press("e");
  press("c");
  expect(api.askDeck).not.toHaveBeenCalled();
  expect(screen.queryByRole("form", { name: "New comment" })).toBeNull();

  // Still dragging: no toolbar yet.
  const options = library.get(FIRST.patch)!;
  act(() =>
    options.onLineSelectionChange?.({
      start: 1,
      side: "additions",
      end: 2,
      endSide: "additions",
    }),
  );
  expect(toolbar()).toBeNull();
  drag(FIRST, { start: 1, side: "additions", end: 2, endSide: "additions" });

  const bar = toolbar()!;
  expect(bar.getAttribute("aria-label")).toBe("Lines 1–2 selected");
  expect(
    within(bar)
      .getAllByRole("button")
      .map((button) => button.textContent),
  ).toEqual(["ExplainE", "CommentC", "Ask…A"]);
  // Above the selection, in its hunk, not between its lines.
  const box = hunkBox("src/api.ts, lines 1 to 3");
  expect(box.contains(bar)).toBe(false);
  expect(
    bar.compareDocumentPosition(box) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(
    box.querySelector("[data-selected]")?.getAttribute("data-selected"),
  ).toBe("additions:1-additions:2");

  press("e");

  expect(api.askDeck).toHaveBeenCalledWith(
    "github",
    "work",
    {
      repository: "acme/billing-api",
      number: 1,
      head: HEAD,
      anchor: {
        kind: "lines",
        path: "src/api.ts",
        start: { side: "head", line: 1 },
        end: { side: "head", line: 2 },
      },
    },
    expect.any(AbortSignal),
  );
  await screen.findByText("It upper-cases the second line.");
  expect(toolbar()).toBeNull();

  // The selection is gone: C continues nothing here, and E asks nothing more.
  press("e");
  expect(api.askDeck).toHaveBeenCalledTimes(1);
});

it("sends where the repository is cloned from, and ends a line answer that read the clone with , and your clone", async () => {
  const identity = {
    repositoryIdentity: {
      cloneUrls: ["https://github.com/acme/billing-api.git"],
    },
    headRef: "feature/login",
  };
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
        { ...pullRequestFacts, repository: "acme/billing-api", ...identity },
      ],
    },
  );
  vi.mocked(api.askDeck).mockResolvedValue({
    kind: "answer",
    text: "It upper-cases the second line.",
    head: HEAD,
    clone: { state: "read" },
  });
  await renderReviewPage();

  drag(FIRST, { start: 1, side: "additions", end: 2, endSide: "additions" });
  press("e");

  expect(api.askDeck).toHaveBeenCalledWith(
    "github",
    "work",
    expect.objectContaining({
      anchor: {
        kind: "lines",
        path: "src/api.ts",
        start: { side: "head", line: 1 },
        end: { side: "head", line: 2 },
      },
      clone: identity,
    }),
    expect.any(AbortSignal),
  );
  const answer = await screen.findByRole("region", {
    name: "Explanation of lines 1–2",
  });
  expect(
    await within(answer).findByText("From the code at a41c9e2, and your clone"),
  ).toBeTruthy();
});

it("opens the composer on the selected lines with C, and Escape leaves them", async () => {
  await renderReviewPage();

  drag(FIRST, { start: 1, side: "additions", end: 2, endSide: "additions" });
  press("Escape");
  expect(toolbar()).toBeNull();

  drag(FIRST, { start: 2, side: "deletions", end: 3, endSide: "additions" });
  press("c");

  const form = await screen.findByRole("form", { name: "New comment" });
  fireEvent.change(within(form).getByRole("textbox", { name: "Comment" }), {
    target: { value: "Both lines." },
  });
  fireEvent.click(within(form).getByRole("button", { name: "Add to review" }));
  expect(
    localStore
      .snapshot()
      .deckDraftReviews?.flatMap((review) => review.comments),
  ).toEqual([
    expect.objectContaining({
      path: "src/api.ts",
      side: "head",
      startLine: 2,
      line: 3,
      body: "Both lines.",
    }),
  ]);
  expect(toolbar()).toBeNull();
});

it("selects the lines between two tapped line numbers in the narrow view", async () => {
  stubNarrowView(true);
  onTestFinished(() => stubNarrowView(false));
  await renderReviewPage();
  const box = hunkBox("src/api.ts, lines 1 to 3");

  const tap = (name: string) => {
    const number = within(box).getByRole("button", { name });
    fireEvent.pointerDown(number, { pointerType: "touch" });
    fireEvent.click(number);
  };
  tap("Line number 1");
  expect(toolbar()?.getAttribute("aria-label")).toBe("Line 1 selected");
  tap("Line number 3");

  expect(toolbar()?.getAttribute("aria-label")).toBe("Lines 1–3 selected");
  expect(
    box.querySelector("[data-selected]")?.getAttribute("data-selected"),
  ).toBe("additions:1-additions:3");
});

it("puts the answer under the selected lines' thread, after the hunk's lines", async () => {
  vi.mocked(api.askDeck).mockResolvedValue({
    kind: "turn",
    turn: {
      id: "turn-1",
      conversationId: "c1",
      task: "deck.ask",
      pullRequest: "key",
      head: HEAD,
      state: "running",
    },
  });
  await renderReviewPage();

  drag(FIRST, { start: 1, side: "additions", end: 2, endSide: "additions" });
  fireEvent.click(within(toolbar()!).getByRole("button", { name: /Explain/ }));

  const answer = await screen.findByRole("region", {
    name: "Explanation of lines 1–2",
  });
  expect(within(answer).getByRole("status").textContent).toBe("Explaining…");
  const box = hunkBox("src/api.ts, lines 1 to 3");
  const thread = screen.getByRole("article", {
    name: /Thread on src\/api.ts/,
  });
  expect(box.contains(answer)).toBe(false);
  expect(
    thread.compareDocumentPosition(answer) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(
    box.compareDocumentPosition(answer) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();

  const event = (value: AgentTurnEvent) =>
    act(() => receiveAgentTurnEvent(value));
  event({ type: "started", turnId: "turn-1", conversationId: "c1" });
  event({
    type: "text",
    turnId: "turn-1",
    conversationId: "c1",
    index: 0,
    text: "Upper case.",
  });
  event({
    type: "ended",
    turnId: "turn-1",
    conversationId: "c1",
    outcome: "done",
  });
  await within(answer).findByText("Upper case.");
  expect(within(answer).getByText("From the code at a41c9e2")).toBeTruthy();
  expect(answer.textContent).not.toMatch(/Claude|Codex|OpenCode|agent/i);
  // Continue in chat carries the lines into the chat (#796).
  expect(
    within(answer).getByRole("button", { name: "Continue in chat" }),
  ).toBeTruthy();
});

it("turns an answer into a draft comment on its lines", async () => {
  vi.mocked(api.askDeck).mockResolvedValue({
    kind: "answer",
    text: "It shouts.",
    head: HEAD,
  });
  await renderReviewPage();

  drag(FIRST, { start: 2, side: "additions", end: 3, endSide: "additions" });
  press("e");
  const answer = await screen.findByRole("region", {
    name: "Explanation of lines 2–3",
  });
  await within(answer).findByText("It shouts.");
  fireEvent.click(
    within(answer).getByRole("button", { name: "Turn into a comment" }),
  );

  const form = await screen.findByRole("form", { name: "New comment" });
  const field = within(form).getByRole("textbox", {
    name: "Comment",
  }) as HTMLTextAreaElement;
  expect(field.value).toBe("It shouts.");
  fireEvent.click(within(form).getByRole("button", { name: "Add to review" }));

  expect(
    localStore
      .snapshot()
      .deckDraftReviews?.flatMap((review) => review.comments),
  ).toEqual([
    expect.objectContaining({
      path: "src/api.ts",
      side: "head",
      startLine: 2,
      line: 3,
      body: "It shouts.",
    }),
  ]);
});

it("selects lines of a closed pull request from the keyboard, to explain but not to comment", async () => {
  vi.mocked(api.askDeck).mockResolvedValue({
    kind: "answer",
    text: "It shouts.",
    head: HEAD,
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
        {
          ...pullRequestFacts,
          repository: "acme/billing-api",
          state: "closed",
          closedAt: Date.now(),
        },
      ],
    },
  );
  await renderReviewPage();

  // No line takes a comment, but the hunk's button still picks lines.
  expect(screen.queryByRole("button", { name: /^Comment on/ })).toBeNull();
  const [key] = screen.getAllByRole("button", { name: "Select line 1" });
  fireEvent.focus(key!);
  fireEvent.keyDown(key!, { key: "ArrowDown", shiftKey: true });

  const bar = toolbar()!;
  expect(bar.getAttribute("aria-label")).toBe(
    "Line 1 to removed line 2 selected",
  );
  expect(
    within(bar)
      .getAllByRole("button")
      .map((button) => button.textContent),
  ).toEqual(["ExplainE", "Ask…A"]);
  press("c");
  expect(screen.queryByRole("form", { name: "New comment" })).toBeNull();

  press("e");
  const answer = await screen.findByRole("region", {
    name: "Explanation of line 1 to removed line 2",
  });
  await within(answer).findByText("It shouts.");
  expect(
    within(answer).queryByRole("button", { name: "Turn into a comment" }),
  ).toBeNull();
});

it("adds an answer after the words already typed in the composer on its lines", async () => {
  vi.mocked(api.askDeck).mockResolvedValue({
    kind: "answer",
    text: "It shouts.",
    head: HEAD,
  });
  await renderReviewPage();

  drag(FIRST, { start: 2, side: "additions", end: 3, endSide: "additions" });
  press("e");
  const answer = await screen.findByRole("region", {
    name: "Explanation of lines 2–3",
  });
  await within(answer).findByText("It shouts.");

  // Comment on the same lines, and type before turning the answer in.
  drag(FIRST, { start: 2, side: "additions", end: 3, endSide: "additions" });
  press("c");
  const form = await screen.findByRole("form", { name: "New comment" });
  const field = within(form).getByRole("textbox", {
    name: "Comment",
  }) as HTMLTextAreaElement;
  fireEvent.change(field, { target: { value: "Is this on purpose?" } });

  fireEvent.click(
    within(answer).getByRole("button", { name: "Turn into a comment" }),
  );

  await waitFor(() =>
    expect(field.value).toBe("Is this on purpose?\n\nIt shouts."),
  );
  expect(
    screen.queryByRole("region", { name: "Explanation of lines 2–3" }),
  ).toBeNull();
});

it("keeps the words typed in a composer on other lines, and the answer, when it's turned into a comment", async () => {
  vi.mocked(api.askDeck).mockResolvedValue({
    kind: "answer",
    text: "It shouts.",
    head: HEAD,
  });
  await renderReviewPage();

  drag(FIRST, { start: 2, side: "additions", end: 3, endSide: "additions" });
  press("e");
  const answer = await screen.findByRole("region", {
    name: "Explanation of lines 2–3",
  });
  await within(answer).findByText("It shouts.");

  // A composer on overlapping but other lines holds typed words.
  drag(FIRST, { start: 1, side: "additions", end: 2, endSide: "additions" });
  press("c");
  const form = await screen.findByRole("form", { name: "New comment" });
  const field = within(form).getByRole("textbox", {
    name: "Comment",
  }) as HTMLTextAreaElement;
  fireEvent.change(field, { target: { value: "Typed words" } });

  fireEvent.click(
    within(answer).getByRole("button", { name: "Turn into a comment" }),
  );

  // Neither is lost: the composer keeps its words, the answer stays.
  expect(field.value).toBe("Typed words");
  expect(
    screen.getByRole("region", { name: "Explanation of lines 2–3" }),
  ).toBeTruthy();
});

it("asks a typed question about the lines with A", async () => {
  vi.mocked(api.askDeck).mockResolvedValue({
    kind: "answer",
    text: "No test covers it.",
    head: HEAD,
  });
  await renderReviewPage();

  drag(FIRST, { start: 2, side: "additions", end: 2 });
  press("a");

  const question = (await screen.findByRole("textbox", {
    name: "Question",
  })) as HTMLTextAreaElement;
  expect(question.value).toBe(
    "Explain these lines: what they do, why they changed, and what a reviewer should check.",
  );
  expect(document.activeElement).toBe(question);
  expect(api.askDeck).not.toHaveBeenCalled();
  fireEvent.change(question, { target: { value: "Is it tested?" } });
  fireEvent.keyDown(question, { key: "Enter" });

  expect(api.askDeck).toHaveBeenCalledWith(
    "github",
    "work",
    expect.objectContaining({
      anchor: {
        kind: "lines",
        path: "src/api.ts",
        start: { side: "head", line: 2 },
        end: { side: "head", line: 2 },
      },
      question: "Is it tested?",
    }),
    expect.any(AbortSignal),
  );
  expect(await screen.findByText("No test covers it.")).toBeTruthy();
});

it("scrolls a citation to its line and highlights it", async () => {
  const scrolled = vi.spyOn(window, "scrollTo");
  vi.mocked(api.askDeck).mockResolvedValue({
    kind: "answer",
    text: "It mirrors `src/api.ts:40`.",
    head: HEAD,
  });
  await renderReviewPage();

  drag(FIRST, { start: 2, side: "additions", end: 2 });
  press("e");
  const citation = await screen.findByRole("button", {
    name: "src/api.ts:40",
  });
  fireEvent.click(citation);

  expect(scrolled).toHaveBeenCalled();
  await waitFor(() =>
    expect(
      hunkBox("src/api.ts, line 40")
        .querySelector("[data-selected]")
        ?.getAttribute("data-selected"),
    ).toBe("additions:40-additions:40"),
  );
});

it("keeps an answer while its hunk unmounts, and mounts nothing per line at rest", async () => {
  vi.mocked(api.askDeck).mockResolvedValue({
    kind: "answer",
    text: "Kept.",
    head: HEAD,
  });
  await renderReviewPage();
  // One selection listener per hunk, given to the library: no element per line.
  expect(library.get(FIRST.patch)?.enableLineSelection).toBe(true);
  expect(document.querySelectorAll(".deck-lines-toolbar")).toHaveLength(0);

  drag(FIRST, { start: 1, side: "additions", end: 1 });
  press("e");
  await screen.findByText("Kept.");

  fireEvent.click(screen.getByRole("button", { name: "Files A–Z" }));
  expect(
    await screen.findByRole("region", { name: "Explanation of line 1" }),
  ).toBeTruthy();
  expect(screen.getByText("Kept.")).toBeTruthy();
});
