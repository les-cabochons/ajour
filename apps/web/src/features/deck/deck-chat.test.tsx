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
import {
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  it,
  onTestFinished,
  vi,
} from "vitest";
import type {
  AgentRunnerOverview,
  AgentTurn,
  AgentTurnAction,
  AgentTurnEvent,
} from "@ajour/shared/agent-runs";
import type { DeckOpenedPullRequest } from "@ajour/shared/deck";
import { TooltipProvider } from "@/components/ui/tooltip";
import * as api from "@/lib/app-api";
import { receiveAgentTurnEvent } from "@/lib/agent-turns";
import { refreshAgentRunner } from "@/lib/agent-runner";
import { ShortcutProvider } from "@/lib/shortcut-handlers";
import { AppApiError, cachePluginsOverview } from "@/lib/app-api";
import { localStore } from "@/lib/local-store";
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
 * Deck's chat (#796): Chat in the top bar or A opens it beside the review
 * page, a full-height sheet in the narrow view. Its header names the agent
 * and what it reads; Continue in chat on an answer carries its anchor in as
 * a chip; each write the chat makes shows as an action line with its link,
 * and Delete removes what it posted. The local API module is mocked, and
 * the turn's events reach the page as they come from the window's stream.
 */

vi.mock("@/lib/app-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/app-api")>()),
  openDeckPullRequest: vi.fn(),
  readPullRequestConversation: vi.fn(),
  askDeck: vi.fn(),
  chatDeck: vi.fn(),
  grantDeckConsent: vi.fn(),
  cancelAgentTurn: vi.fn(),
  deletePullRequestComment: vi.fn(),
  getAgentRunner: vi.fn(),
  getDeckClones: vi.fn(),
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

const HEAD = "a41c9e2f0d1b";

const DIFF: DeckOpenedPullRequest = {
  headSha: HEAD,
  baseSha: "b52d0f3a11",
  files: [
    {
      path: "src/api.ts",
      status: "modified",
      binary: false,
      hunks: [
        {
          id: "src/api.ts#0",
          header: "@@ -1,1 +1,1 @@",
          oldStart: 1,
          oldLines: 1,
          newStart: 1,
          newLines: 1,
          patch: [
            "diff --git a/src/api.ts b/src/api.ts",
            "@@ -1,1 +1,1 @@",
            "-b",
            "+B",
            "",
          ].join("\n"),
        },
      ],
    },
  ],
  guide: {
    madeWith: "code",
    summary: NO_DECK_SUMMARY,
    concerns: [
      {
        id: "g1",
        title: "Handle the request",
        rationale: "The handler now shouts.",
        hunkIds: ["src/api.ts#0"],
        kinds: [],
      },
    ],
  },
};

const RUNNER: AgentRunnerOverview = {
  settings: { cli: "claude-code", browserMode: "my-chrome", model: "" },
  clis: [
    {
      id: "claude-code",
      label: "Claude Code",
      supported: true,
      installed: true,
    },
  ],
  tasks: [],
  currentRun: null,
};

const turn = (
  id: string,
  task: AgentTurn["task"] = "deck.chat",
): AgentTurn => ({
  id,
  conversationId: "c1",
  task,
  pullRequest: "key",
  head: HEAD,
  state: "running",
});

function send(event: AgentTurnEvent) {
  act(() => receiveAgentTurnEvent(event));
}
const text = (turnId: string, index: number, piece: string) =>
  send({ type: "text", turnId, conversationId: "c1", index, text: piece });
const ended = (turnId: string) =>
  send({ type: "ended", turnId, conversationId: "c1", outcome: "done" });
const acted = (turnId: string, action: AgentTurnAction) =>
  send({ type: "action", turnId, conversationId: "c1", action });

function press(key: string) {
  act(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key }));
  });
}

const Shell = ({ children }: { children: ReactNode }) => (
  <ShortcutProvider>
    <TooltipProvider>{children}</TooltipProvider>
  </ShortcutProvider>
);

const REF = {
  pluginId: "github",
  connectionId: "work",
  repository: "acme/billing-api",
  number: 1,
};

let itemId = "";
function sync(viewerIsAuthor = false) {
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
          viewerIsAuthor,
          ...(viewerIsAuthor
            ? { author: { login: "alex", isBot: false } }
            : {}),
        },
      ],
    },
  );
  itemId = localStore.snapshot().pullRequests![0]!._id;
}

beforeEach(async () => {
  cachePluginsOverview(codeHostOverview);
  sync();
  vi.mocked(api.openDeckPullRequest).mockResolvedValue(DIFF);
  vi.mocked(api.readPullRequestConversation).mockImplementation(async () => ({
    description: "",
    timeline: [],
    threads: [],
    viewedPaths: [],
    mergeMethods: ["merge"],
  }));
  vi.mocked(api.getAgentRunner).mockResolvedValue(RUNNER);
  vi.mocked(api.getDeckClones).mockResolvedValue({ clones: [] });
  await refreshAgentRunner();
});

afterEach(() => {
  cleanup();
  localStore.discardDraftReview(REF);
  localStore.removeConnectionPullRequests("github", "work");
  vi.mocked(api.openDeckPullRequest).mockReset();
  vi.mocked(api.readPullRequestConversation).mockReset();
  vi.mocked(api.askDeck).mockReset();
  vi.mocked(api.chatDeck).mockReset();
  vi.mocked(api.grantDeckConsent).mockReset();
  vi.mocked(api.cancelAgentTurn).mockReset();
  vi.mocked(api.deletePullRequestComment).mockReset();
});

/** The review page, once its diff shows. */
async function renderReview() {
  await renderRoutes({
    shell: Shell,
    path: `/deck/${itemId}`,
    routes: { "/deck/$itemId": () => <DeckPage itemId={itemId} /> },
  });
  await screen.findByRole("region", { name: "Concern 1: Handle the request" });
}

const chatPanel = () => screen.queryByRole("complementary", { name: "Chat" });

/** Types `message` in the open chat and sends it with Enter. */
function sendMessage(message: string) {
  const field = within(chatPanel()!).getByRole("textbox", { name: "Message" });
  fireEvent.change(field, { target: { value: message } });
  fireEvent.keyDown(field, { key: "Enter" });
}

it("opens and closes with A and with Chat, its header naming the pull request, the agent and what it reads", async () => {
  await renderReview();
  expect(chatPanel()).toBeNull();

  press("a");
  const panel = chatPanel()!;
  expect(panel).not.toBeNull();
  expect(within(panel).getByText("#1 · Claude Code · PR")).toBeTruthy();
  expect(
    within(panel).getByRole("textbox", { name: "Message" }) ===
      document.activeElement,
  ).toBe(true);

  // A in the composer types: Escape or Close leave it.
  fireEvent.keyDown(document.activeElement!, { key: "a" });
  expect(chatPanel()).not.toBeNull();
  fireEvent.click(within(panel).getByRole("button", { name: "Close chat" }));
  expect(chatPanel()).toBeNull();

  const chat = screen.getByRole("button", { name: "Chat" });
  fireEvent.click(chat);
  expect(chat.getAttribute("aria-pressed")).toBe("true");
  fireEvent.keyDown(chatPanel()!, { key: "Escape" });
  expect(chatPanel()).toBeNull();

  // A away from a text field closes it too.
  press("a");
  expect(chatPanel()).not.toBeNull();
  act(() => (document.activeElement as HTMLElement).blur());
  press("a");
  expect(chatPanel()).toBeNull();
});

it("says it reads the local clone too when the user chose one", async () => {
  vi.mocked(api.getDeckClones).mockResolvedValue({
    clones: [
      {
        ...REF,
        environment: { kind: "native" },
        path: "C:/code/billing-api",
        remote: "origin",
        chosenAt: 1,
      },
    ],
  });
  localStore.removeConnectionPullRequests("github", "work");
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
          repositoryIdentity: {
            cloneUrls: ["https://github.com/acme/billing-api.git"],
          },
        },
      ],
    },
  );
  itemId = localStore.snapshot().pullRequests![0]!._id;
  await renderReview();

  press("a");

  expect(
    await within(chatPanel()!).findByText(
      "#1 · Claude Code · PR + local clone",
    ),
  ).toBeTruthy();
});

it("sends a message, streams the reply, and shows each write as an action line with its link and Delete", async () => {
  vi.mocked(api.chatDeck).mockResolvedValueOnce({ turn: turn("t1") });
  vi.mocked(api.deletePullRequestComment).mockResolvedValueOnce({
    deleted: true,
  });
  await renderReview();
  press("a");

  sendMessage("Post a note about the shouting.");

  await waitFor(() =>
    expect(api.chatDeck).toHaveBeenCalledWith(
      "github",
      "work",
      {
        repository: "acme/billing-api",
        number: 1,
        head: HEAD,
        message: "Post a note about the shouting.",
        pullRequestUrl: "https://github.com/acme/api/pull/1",
      },
      expect.any(AbortSignal),
    ),
  );
  const log = within(chatPanel()!).getByRole("log", { name: "Messages" });
  expect(within(log).getByText("Post a note about the shouting.")).toBeTruthy();
  expect(within(log).getByRole("status").textContent).toBe("Thinking…");
  const reads = vi.mocked(api.readPullRequestConversation).mock.calls.length;

  acted("t1", {
    id: "a1",
    kind: "comment",
    text: "Commented on src/api.ts:1",
    url: "https://github.com/acme/billing-api/pull/1#c1",
    posted: { kind: "comment", commentId: "c-1" },
  });
  text("t1", 0, "Posted ");
  text("t1", 1, "it.");
  ended("t1");

  const line = within(log)
    .getByText("Commented on src/api.ts:1")
    .closest("li")!;
  expect(
    within(line).getByRole("link", { name: "Open" }).getAttribute("href"),
  ).toBe("https://github.com/acme/billing-api/pull/1#c1");
  expect(within(log).getByText("Posted it.")).toBeTruthy();
  // The page shows the new comment: its conversation is read again.
  await waitFor(() =>
    expect(
      vi.mocked(api.readPullRequestConversation).mock.calls.length,
    ).toBeGreaterThan(reads),
  );

  fireEvent.click(within(line).getByRole("button", { name: "Delete" }));

  await within(line).findByText("Deleted");
  expect(api.deletePullRequestComment).toHaveBeenCalledWith("github", "work", {
    repository: "acme/billing-api",
    number: 1,
    commentId: "c-1",
  });
  expect(within(line).queryByRole("button", { name: "Delete" })).toBeNull();
});

it.each([["javascript:alert(1)"], ["https://github.com.evil.example/pr/1"]])(
  "links the pull request instead of a link off its code host: %s",
  async (url) => {
    vi.mocked(api.chatDeck).mockResolvedValueOnce({ turn: turn("t9") });
    await renderReview();
    press("a");
    sendMessage("Post it.");
    await waitFor(() => expect(api.chatDeck).toHaveBeenCalled());

    acted("t9", {
      id: "a9",
      kind: "review",
      text: "Approved the pull request",
      url,
    });

    const line = within(chatPanel()!)
      .getByText("Approved the pull request")
      .closest("li")!;
    expect(
      within(line).getByRole("link", { name: "Open" }).getAttribute("href"),
    ).toBe("https://github.com/acme/api/pull/1");
  },
);

it("says so on the line when the code host can't delete a comment", async () => {
  vi.mocked(api.chatDeck).mockResolvedValueOnce({ turn: turn("t2") });
  vi.mocked(api.deletePullRequestComment).mockRejectedValueOnce(
    new AppApiError("GitHub doesn't offer this yet.", 404, undefined, {
      reason: "not_supported",
    }),
  );
  await renderReview();
  press("a");
  sendMessage("Reply to it.");
  await waitFor(() => expect(api.chatDeck).toHaveBeenCalled());

  acted("t2", {
    id: "a2",
    kind: "reply",
    text: "Replied in a thread",
    posted: { kind: "comment", commentId: "c-2" },
  });
  const line = screen.getByText("Replied in a thread").closest("li")!;
  fireEvent.click(within(line).getByRole("button", { name: "Delete" }));

  expect((await within(line).findByRole("alert")).textContent).toBe(
    "GitHub doesn't let Ajour delete it yet. Delete it on GitHub.",
  );
});

it("removes a draft comment it added from the draft review with Delete", async () => {
  vi.mocked(api.chatDeck).mockResolvedValueOnce({ turn: turn("t3") });
  await renderReview();
  const draft = localStore.addDraftComment(REF, {
    headSha: HEAD,
    anchor: { path: "src/api.ts", side: "head", line: 1 },
    body: "Why upper case?",
    lineText: "B",
  })!;
  press("a");
  sendMessage("Add a draft comment.");
  await waitFor(() => expect(api.chatDeck).toHaveBeenCalled());

  acted("t3", {
    id: "a3",
    kind: "draft_comment",
    text: "Added a draft comment on src/api.ts:1",
    at: { path: "src/api.ts", side: "head", line: 1 },
    posted: { kind: "draft_comment", draftId: draft.id },
  });
  const line = screen
    .getByText("Added a draft comment on src/api.ts:1")
    .closest("li")!;
  expect(within(line).getByRole("button", { name: "Show" })).toBeTruthy();
  fireEvent.click(within(line).getByRole("button", { name: "Delete" }));

  expect(within(line).getByText("Deleted")).toBeTruthy();
  expect(localStore.snapshot().deckDraftReviews ?? []).toEqual([]);
});

it("shows the line of a draft comment the window added as its turn ended, with Delete", async () => {
  vi.mocked(api.chatDeck).mockResolvedValueOnce({ turn: turn("t8") });
  await renderReview();
  press("a");
  sendMessage("Add a draft comment.");
  await waitFor(() => expect(api.chatDeck).toHaveBeenCalled());

  text("t8", 0, "Done.");
  ended("t8");
  // The local API heard the window's answer after the turn ended.
  acted("t8", {
    id: "a8",
    kind: "draft_comment",
    text: "Added a draft comment on src/api.ts:1",
    at: { path: "src/api.ts", side: "head", line: 1 },
    posted: { kind: "draft_comment", draftId: "draft-late" },
  });

  const line = screen
    .getByText("Added a draft comment on src/api.ts:1")
    .closest("li")!;
  expect(within(line).getByRole("button", { name: "Delete" })).toBeTruthy();
});

it("shows an earlier turn's late action after the next message started, with Delete", async () => {
  vi.mocked(api.chatDeck)
    .mockResolvedValueOnce({ turn: turn("t20") })
    .mockResolvedValueOnce({ turn: turn("t21") });
  await renderReview();
  press("a");
  sendMessage("Post a comment.");
  await waitFor(() => expect(api.chatDeck).toHaveBeenCalledTimes(1));
  text("t20", 0, "Posting it.");
  ended("t20");
  sendMessage("Anything else?");
  await waitFor(() => expect(api.chatDeck).toHaveBeenCalledTimes(2));
  text("t21", 0, "Nothing else.");

  // The code host answered the first turn's post only now.
  acted("t20", {
    id: "a20",
    kind: "comment",
    text: "Commented on src/api.ts:1",
    posted: { kind: "comment", commentId: "c-20" },
  });

  const line = screen.getByText("Commented on src/api.ts:1").closest("li")!;
  expect(within(line).getByRole("button", { name: "Delete" })).toBeTruthy();
});

it("shows a late action of a turn that ended before its message's answer came", async () => {
  let answer!: (value: { turn: AgentTurn }) => void;
  vi.mocked(api.chatDeck).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        answer = resolve;
      }),
  );
  await renderReview();
  press("a");
  sendMessage("Add a draft comment.");
  await waitFor(() => expect(api.chatDeck).toHaveBeenCalled());
  // The whole turn ran before the window heard its id.
  text("t22", 0, "Done.");
  ended("t22");
  await act(async () => answer({ turn: turn("t22") }));
  await screen.findByText("Done.");

  acted("t22", {
    id: "a22",
    kind: "draft_comment",
    text: "Added a draft comment on src/api.ts:1",
    at: { path: "src/api.ts", side: "head", line: 1 },
    posted: { kind: "draft_comment", draftId: "draft-22" },
  });

  const line = screen
    .getByText("Added a draft comment on src/api.ts:1")
    .closest("li")!;
  expect(within(line).getByRole("button", { name: "Delete" })).toBeTruthy();
});

it("shows the title a chat edit gave the pull request", async () => {
  localStore.removeConnectionPullRequests("github", "work");
  sync(true);
  vi.mocked(api.chatDeck).mockResolvedValueOnce({ turn: turn("t4") });
  await renderReview();
  press("a");
  sendMessage("Rename it.");
  await waitFor(() =>
    expect(api.chatDeck).toHaveBeenCalledWith(
      "github",
      "work",
      expect.objectContaining({ author: true }),
      expect.any(AbortSignal),
    ),
  );

  acted("t4", {
    id: "a4",
    kind: "title",
    text: "Renamed the pull request “Shout politely”",
    edited: { title: "Shout politely", draft: false },
  });

  expect(
    await screen.findByRole("heading", { level: 1, name: "Shout politely" }),
  ).toBeTruthy();
});

it("carries an answer's anchor in as a removable chip with Continue in chat, and sends it with the message", async () => {
  vi.mocked(api.askDeck).mockResolvedValueOnce({
    kind: "answer",
    text: "It shouts.",
    head: HEAD,
  });
  vi.mocked(api.chatDeck).mockResolvedValueOnce({ turn: turn("t5") });
  await renderReview();
  const concern = screen.getByRole("region", {
    name: "Concern 1: Handle the request",
  });
  fireEvent.click(within(concern).getByRole("button", { name: "More detail" }));
  fireEvent.keyDown(
    within(concern).getByRole("textbox", { name: "Question" }),
    {
      key: "Enter",
    },
  );
  await within(concern).findByText("It shouts.");

  fireEvent.click(
    within(concern).getByRole("button", { name: "Continue in chat" }),
  );

  const panel = chatPanel()!;
  expect(within(panel).getByText("Handle the request")).toBeTruthy();
  // Removed, then carried in again.
  fireEvent.click(
    within(panel).getByRole("button", { name: "Remove Handle the request" }),
  );
  expect(within(panel).queryByText("Handle the request")).toBeNull();
  fireEvent.click(
    within(concern).getByRole("button", { name: "Continue in chat" }),
  );

  sendMessage("Why now?");

  await waitFor(() =>
    expect(api.chatDeck).toHaveBeenCalledWith(
      "github",
      "work",
      expect.objectContaining({
        message: "Why now?",
        anchor: { kind: "concern", id: "g1" },
      }),
      expect.any(AbortSignal),
    ),
  );
  // The chip went with the message.
  const log = within(panel).getByRole("log", { name: "Messages" });
  expect(within(log).getByText("Handle the request")).toBeTruthy();
  expect(
    within(panel).queryByRole("button", { name: "Remove Handle the request" }),
  ).toBeNull();
});

it("asks once for the repository before a first message, then sends it", async () => {
  vi.mocked(api.chatDeck)
    .mockRejectedValueOnce(
      new AppApiError("Ajour asks once for billing-api.", 409, undefined, {
        reason: "needs_consent",
        repository: "acme/billing-api",
        provider: { cli: "claude-code", label: "Claude Code" },
      }),
    )
    .mockResolvedValueOnce({ turn: turn("t6") });
  vi.mocked(api.grantDeckConsent).mockResolvedValueOnce({ consents: [] });
  await renderReview();
  press("a");
  sendMessage("Hi");

  const dialog = await screen.findByRole("alertdialog");
  expect(
    within(dialog).getByText("Ajour asks once for billing-api"),
  ).toBeTruthy();
  fireEvent.click(within(dialog).getByRole("button", { name: "Allow" }));

  await waitFor(() => expect(api.chatDeck).toHaveBeenCalledTimes(2));
  expect(api.grantDeckConsent).toHaveBeenCalledWith(
    "github",
    "work",
    "acme/billing-api",
    "claude-code",
    // What the dialog lists, which covers a chat message too.
    "context",
  );
});

it("is a full-height sheet in the narrow view", async () => {
  stubNarrowView(true);
  onTestFinished(() => stubNarrowView(false));
  await renderReview();

  fireEvent.click(screen.getByRole("button", { name: "Chat" }));

  const sheet = await screen.findByRole("dialog", { name: "Chat" });
  expect(sheet.getAttribute("data-side")).toBe("right");
  expect(sheet.className).toContain("deck-chat-sheet");
  expect(within(sheet).getByText("#1 · Claude Code · PR")).toBeTruthy();
  expect(chatPanel()).toBeNull();
});

it("stops a reply whose conversation closed, so the next message can go", async () => {
  vi.mocked(api.chatDeck).mockResolvedValueOnce({ turn: turn("t7") });
  await renderReview();
  press("a");
  sendMessage("Hi");
  await waitFor(() => expect(api.chatDeck).toHaveBeenCalled());
  const log = within(chatPanel()!).getByRole("log", { name: "Messages" });
  await within(log).findByText("Thinking…");

  send({ type: "conversation-closed", conversationId: "c1", reason: "idle" });

  expect(within(log).getByText("Stopped.")).toBeTruthy();
  expect(
    within(chatPanel()!).getByRole("button", { name: "Send" }),
  ).toBeTruthy();
});
