// @vitest-environment jsdom
import { StrictMode, type ReactNode } from "react";
import {
  act,
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import type { AgentTurn, AgentTurnEvent } from "@ajour/shared/agent-runs";
import type { DeckOpenedPullRequest } from "@ajour/shared/deck";
import { TooltipProvider } from "@/components/ui/tooltip";
import * as api from "@/lib/app-api";
import { receiveAgentTurnEvent } from "@/lib/agent-turns";
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
 * "more ›" on a concern (#791): the first ask. It opens on the default
 * question, which the user sends as is or edits; it runs a turn in the pull
 * request's conversation, a quiet placeholder shows, then the answer streams
 * in under the rationale. The local API module is mocked, and the turn's
 * events reach the page as they come from the window's stream.
 */

vi.mock("@/lib/app-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/app-api")>()),
  openDeckPullRequest: vi.fn(),
  askDeck: vi.fn(),
  grantDeckConsent: vi.fn(),
  cancelAgentTurn: vi.fn(),
  getDeckCloneSuggestions: vi.fn(),
  chooseDeckCloneFolder: vi.fn(),
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

const hunk = (id: string, header: string, lines: string[]) => {
  const path = id.slice(0, id.lastIndexOf("#"));
  return {
    id,
    header,
    oldStart: 1,
    oldLines: 1,
    newStart: 1,
    newLines: 1,
    patch: [`diff --git a/${path} b/${path}`, header, ...lines, ""].join("\n"),
  };
};

const GUIDED: DeckOpenedPullRequest = {
  headSha: HEAD,
  baseSha: "b52d0f3a11",
  files: [
    {
      path: "src/api.ts",
      status: "modified",
      binary: false,
      hunks: [
        hunk("src/api.ts#0", "@@ -1,1 +1,1 @@", ["-b", "+B"]),
        hunk("src/api.ts#1", "@@ -40,1 +40,1 @@", ["-y", "+Y"]),
      ],
    },
    {
      path: "src/new.ts",
      status: "added",
      binary: false,
      hunks: [
        hunk("src/new.ts#0", "@@ -0,0 +1,1 @@", ["+export const a = 1;"]),
      ],
    },
  ],
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
        rationale: "Nothing to review line by line.",
        hunkIds: ["src/api.ts#0"],
      },
    ],
  },
};

const turn = (
  id: string,
  state: AgentTurn["state"] = "running",
): AgentTurn => ({
  id,
  conversationId: "c1",
  task: "deck.ask",
  pullRequest: "key",
  head: HEAD,
  state,
});

/** An event of turn `turnId` arriving on the window's stream. */
function send(event: AgentTurnEvent) {
  act(() => receiveAgentTurnEvent(event));
}
const started = (turnId: string) =>
  send({ type: "started", turnId, conversationId: "c1" });
const text = (turnId: string, index: number, piece: string) =>
  send({ type: "text", turnId, conversationId: "c1", index, text: piece });
const ended = (
  turnId: string,
  outcome: "done" | "cancelled" | "failed" = "done",
  error?: string,
) =>
  send({
    type: "ended",
    turnId,
    conversationId: "c1",
    outcome,
    ...(error ? { error } : {}),
  });

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
  vi.mocked(api.openDeckPullRequest).mockResolvedValue(GUIDED);
});

afterEach(() => {
  cleanup();
  vi.mocked(api.openDeckPullRequest).mockReset();
  vi.mocked(api.askDeck).mockReset();
  vi.mocked(api.grantDeckConsent).mockReset();
  vi.mocked(api.cancelAgentTurn).mockReset();
  vi.mocked(api.getDeckCloneSuggestions).mockReset();
  vi.mocked(api.chooseDeckCloneFolder).mockReset();
});

/** The review page, with its guide shown. */
async function renderGuide(shell = Shell) {
  await renderRoutes({
    shell,
    path: `/deck/${itemId}`,
    routes: { "/deck/$itemId": () => <DeckPage itemId={itemId} /> },
  });
  return await screen.findByRole("region", {
    name: "Concern 1: Handle the request",
  });
}

const moreOn = (concern: HTMLElement) =>
  within(concern).getByRole("button", { name: "More detail" });

/** The question `more ›` opens on. */
const questionOn = (concern: HTMLElement) =>
  within(concern).getByRole("textbox", { name: "Question" });

/** Opens the concern's ask and sends its default question as is. */
function askOn(concern: HTMLElement) {
  fireEvent.click(moreOn(concern));
  fireEvent.keyDown(questionOn(concern), { key: "Enter" });
}

it("puts one more › at the end of each concern's rationale, and nothing per line", async () => {
  const first = await renderGuide();

  const buttons = screen.getAllByRole("button", { name: "More detail" });
  expect(buttons).toHaveLength(2);
  expect(moreOn(first).textContent).toBe("more ›");
  // It ends the rationale's paragraph.
  expect(
    within(first)
      .getByText("The handler and the export it reads.")
      .contains(moreOn(first)),
  ).toBe(true);

  fireEvent.click(screen.getByRole("button", { name: "Files A–Z" }));
  expect(screen.queryByRole("button", { name: "More detail" })).toBeNull();
});

it("shows a quiet placeholder, streams the answer in under the rationale, then answers again at once from the cache", async () => {
  vi.mocked(api.askDeck).mockResolvedValueOnce({
    kind: "turn",
    turn: turn("t1"),
  });
  const concern = await renderGuide();

  askOn(concern);

  const answer = await within(concern).findByRole("region", {
    name: "More detail",
  });
  expect(within(answer).getByRole("status").textContent).toBe(
    "Getting more detail…",
  );
  expect(api.askDeck).toHaveBeenCalledWith("github", "work", {
    repository: "acme/billing-api",
    number: 1,
    head: HEAD,
    anchor: { kind: "concern", id: "g1" },
  });
  expect(moreOn(concern).getAttribute("aria-expanded")).toBe("true");

  started("t1");
  text("t1", 0, "It reads ");
  expect(await within(answer).findByText("It reads")).toBeTruthy();
  expect(within(answer).queryByText(/From the code at/)).toBeNull();
  text("t1", 1, "the export.");
  ended("t1");

  await within(answer).findByText("It reads the export.");
  expect(within(answer).getByText("From the code at a41c9e2")).toBeTruthy();
  expect(answer.textContent).not.toMatch(/Claude|Codex|OpenCode|agent/i);

  fireEvent.click(within(answer).getByRole("button", { name: "Dismiss" }));
  expect(
    within(concern).queryByRole("region", { name: "More detail" }),
  ).toBeNull();

  vi.mocked(api.askDeck).mockResolvedValueOnce({
    kind: "answer",
    text: "It reads the export.",
    head: HEAD,
  });
  askOn(concern);
  const again = await within(concern).findByRole("region", {
    name: "More detail",
  });
  await within(again).findByText("It reads the export.");
  expect(within(again).queryByText("Getting more detail…")).toBeNull();
  expect(within(again).getByText("From the code at a41c9e2")).toBeTruthy();
});

it("opens on the default question, focused, and sends a typed one in its place", async () => {
  vi.mocked(api.askDeck).mockResolvedValueOnce({
    kind: "turn",
    turn: turn("t2"),
  });
  const concern = await renderGuide();

  fireEvent.click(moreOn(concern));

  const question = questionOn(concern) as HTMLTextAreaElement;
  expect(question.value).toBe(
    "Give more detail on this concern: what it changes, why, and what a reviewer should check.",
  );
  expect(document.activeElement).toBe(question);
  expect(api.askDeck).not.toHaveBeenCalled();
  expect(within(concern).queryByRole("status")).toBeNull();

  fireEvent.change(question, { target: { value: "Is it tested?" } });
  fireEvent.click(within(concern).getByRole("button", { name: "Ask" }));

  expect(api.askDeck).toHaveBeenCalledTimes(1);
  expect(api.askDeck).toHaveBeenCalledWith("github", "work", {
    repository: "acme/billing-api",
    number: 1,
    head: HEAD,
    anchor: { kind: "concern", id: "g1" },
    question: "Is it tested?",
  });
  const answer = await within(concern).findByRole("region", {
    name: "More detail",
  });
  expect(await within(answer).findByText("Is it tested?")).toBeTruthy();
  started("t2");
  text("t2", 0, "Yes, in api.test.ts.");
  ended("t2");
  expect(await within(answer).findByText("Yes, in api.test.ts.")).toBeTruthy();
});

it("closes the question on Escape, sending nothing", async () => {
  const concern = await renderGuide();
  fireEvent.click(moreOn(concern));

  fireEvent.keyDown(questionOn(concern), { key: "Escape" });

  expect(
    within(concern).queryByRole("textbox", { name: "Question" }),
  ).toBeNull();
  expect(moreOn(concern).getAttribute("aria-expanded")).toBe("false");
  expect(document.activeElement).toBe(moreOn(concern));
  expect(api.askDeck).not.toHaveBeenCalled();
});

it("asks something else under an answer", async () => {
  vi.mocked(api.askDeck)
    .mockResolvedValueOnce({ kind: "answer", text: "Default.", head: HEAD })
    .mockResolvedValueOnce({ kind: "turn", turn: turn("t8") });
  const concern = await renderGuide();
  askOn(concern);
  const answer = await within(concern).findByRole("region", {
    name: "More detail",
  });
  await within(answer).findByText("Default.");

  fireEvent.change(
    within(answer).getByRole("textbox", { name: "Ask something else" }),
    { target: { value: "And errors?" } },
  );
  fireEvent.submit(
    within(answer).getByRole("textbox", { name: "Ask something else" }),
  );

  await waitFor(() =>
    expect(api.askDeck).toHaveBeenLastCalledWith("github", "work", {
      repository: "acme/billing-api",
      number: 1,
      head: HEAD,
      anchor: { kind: "concern", id: "g1" },
      question: "And errors?",
    }),
  );
  expect(await within(answer).findByText("And errors?")).toBeTruthy();
  expect(within(answer).queryByText("Default.")).toBeNull();
});

it("stops a turn, keeping what came", async () => {
  vi.mocked(api.askDeck).mockResolvedValueOnce({
    kind: "turn",
    turn: turn("t3"),
  });
  vi.mocked(api.cancelAgentTurn).mockResolvedValue({ cancelled: true });
  const concern = await renderGuide();
  askOn(concern);
  const answer = await within(concern).findByRole("region", {
    name: "More detail",
  });
  started("t3");
  text("t3", 0, "Half an");

  fireEvent.click(await within(answer).findByRole("button", { name: "Stop" }));

  expect(api.cancelAgentTurn).toHaveBeenCalledWith("t3");
  ended("t3", "cancelled");
  expect(await within(answer).findByText("Stopped.")).toBeTruthy();
  expect(within(answer).getByText("Half an")).toBeTruthy();
  expect(within(answer).queryByRole("button", { name: "Stop" })).toBeNull();
});

it("waits while a timesheet task runs", async () => {
  vi.mocked(api.askDeck).mockResolvedValueOnce({
    kind: "turn",
    turn: turn("t4", "waiting"),
  });
  const concern = await renderGuide();
  askOn(concern);
  const answer = await within(concern).findByRole("region", {
    name: "More detail",
  });

  send({
    type: "waiting",
    turnId: "t4",
    conversationId: "c1",
    waitingFor: "agent-run",
  });

  expect(
    await within(answer).findByText("Waiting for the timesheet task to finish"),
  ).toBeTruthy();
  expect(within(answer).getByRole("button", { name: "Stop" })).toBeTruthy();
  started("t4");
  expect(within(answer).getByRole("status").textContent).toBe(
    "Getting more detail…",
  );
});

it("asks once for the repository, naming the agent and what leaves the machine, then runs the ask", async () => {
  vi.mocked(api.askDeck)
    .mockRejectedValueOnce(
      new AppApiError("Ajour asks once for billing-api.", 409, undefined, {
        reason: "needs_consent",
        repository: "acme/billing-api",
        provider: {
          cli: "claude-code",
          label: "Claude Code",
          version: "2.1.318",
        },
      }),
    )
    .mockResolvedValueOnce({ kind: "turn", turn: turn("t5") });
  vi.mocked(api.grantDeckConsent).mockResolvedValue({ consents: [] });
  const concern = await renderGuide();

  askOn(concern);

  const dialog = await screen.findByRole("alertdialog", {
    name: "Ajour asks once for billing-api",
  });
  // Nothing is asked yet, so nothing shows in place.
  expect(
    within(concern).queryByRole("region", { name: "More detail" }),
  ).toBeNull();
  expect(dialog.textContent).toContain("Claude Code 2.1.318");
  expect(dialog.textContent).toContain("the changed lines");
  expect(dialog.textContent).toContain("the review threads");
  fireEvent.click(within(dialog).getByRole("button", { name: "Allow" }));

  await waitFor(() => expect(api.askDeck).toHaveBeenCalledTimes(2));
  expect(api.grantDeckConsent).toHaveBeenCalledWith(
    "github",
    "work",
    "acme/billing-api",
    "claude-code",
  );
  expect(
    await within(concern).findByRole("region", { name: "More detail" }),
  ).toBeTruthy();
});

it("sends nothing when the user declines", async () => {
  vi.mocked(api.askDeck).mockRejectedValueOnce(
    new AppApiError("Ajour asks once for billing-api.", 409, undefined, {
      reason: "needs_consent",
      repository: "acme/billing-api",
      provider: { cli: "codex", label: "Codex" },
    }),
  );
  const concern = await renderGuide();
  askOn(concern);
  const dialog = await screen.findByRole("alertdialog");

  fireEvent.click(within(dialog).getByRole("button", { name: "Not now" }));

  await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  expect(api.grantDeckConsent).not.toHaveBeenCalled();
  expect(api.askDeck).toHaveBeenCalledTimes(1);
  expect(
    within(concern).queryByRole("region", { name: "More detail" }),
  ).toBeNull();
});

it("says why an ask failed, and tries again", async () => {
  vi.mocked(api.askDeck)
    .mockResolvedValueOnce({ kind: "turn", turn: turn("t6") })
    .mockResolvedValueOnce({
      kind: "answer",
      text: "Now it works.",
      head: HEAD,
    });
  const concern = await renderGuide();
  askOn(concern);
  const answer = await within(concern).findByRole("region", {
    name: "More detail",
  });
  started("t6");
  ended("t6", "failed", "The agent stopped answering.");

  expect(
    await within(answer).findByText("The agent stopped answering."),
  ).toBeTruthy();
  fireEvent.click(within(answer).getByRole("button", { name: "Try again" }));
  expect(await within(answer).findByText("Now it works.")).toBeTruthy();
});

it("streams the answer under React's development remount too", async () => {
  vi.mocked(api.askDeck).mockResolvedValueOnce({
    kind: "turn",
    turn: turn("t7"),
  });
  const concern = await renderGuide(({ children }) => (
    <StrictMode>
      <Shell>{children}</Shell>
    </StrictMode>
  ));

  askOn(concern);
  const answer = await within(concern).findByRole("region", {
    name: "More detail",
  });
  await waitFor(() => expect(api.askDeck).toHaveBeenCalled());
  started("t7");
  text("t7", 0, "Still here.");
  ended("t7");

  expect(await within(answer).findByText("Still here.")).toBeTruthy();
  expect(api.askDeck).toHaveBeenCalledTimes(1);
});

it("says why the consent couldn't be recorded", async () => {
  vi.mocked(api.askDeck).mockRejectedValueOnce(
    new AppApiError("Ajour asks once for billing-api.", 409, undefined, {
      reason: "needs_consent",
      repository: "acme/billing-api",
      provider: { cli: "claude-code", label: "Claude Code" },
    }),
  );
  vi.mocked(api.grantDeckConsent).mockRejectedValueOnce(
    new AppApiError(
      "Settings > Agents now picks Codex. Ask again to allow it.",
      409,
    ),
  );
  const concern = await renderGuide();
  askOn(concern);
  fireEvent.click(
    within(await screen.findByRole("alertdialog")).getByRole("button", {
      name: "Allow",
    }),
  );

  expect(
    await within(concern).findByText(
      "Settings > Agents now picks Codex. Ask again to allow it.",
    ),
  ).toBeTruthy();
  expect(api.askDeck).toHaveBeenCalledTimes(1);
});

/*
 * The user's local clone (#795): when the code host says where the
 * repository is cloned from, an ask sends it, and the answer's footer says
 * whether it read the clone, why it couldn't, or offers to choose one.
 */

const IDENTITY = {
  repositoryIdentity: {
    cloneUrls: ["https://github.com/acme/billing-api.git"],
  },
  headRef: "feature/login",
};

/** The pull request as a sync with its clone addresses stores it. */
function syncWithIdentity() {
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
        { ...pullRequestFacts, repository: "acme/billing-api", ...IDENTITY },
      ],
    },
  );
}

it("sends where the repository is cloned from, and ends an answer that read the clone with , and your clone", async () => {
  syncWithIdentity();
  vi.mocked(api.askDeck).mockResolvedValueOnce({
    kind: "turn",
    turn: turn("c1"),
    clone: { state: "read" },
  });
  const concern = await renderGuide();

  askOn(concern);

  const answer = await within(concern).findByRole("region", {
    name: "More detail",
  });
  expect(api.askDeck).toHaveBeenCalledWith("github", "work", {
    repository: "acme/billing-api",
    number: 1,
    head: HEAD,
    anchor: { kind: "concern", id: "g1" },
    clone: IDENTITY,
  });
  started("c1");
  text("c1", 0, "It reads the whole module.");
  ended("c1");
  expect(
    await within(answer).findByText("From the code at a41c9e2, and your clone"),
  ).toBeTruthy();
  expect(answer.textContent).not.toMatch(/Claude|Codex|OpenCode/i);
});

it("says why the clone wasn't read, quietly, under the answer", async () => {
  syncWithIdentity();
  vi.mocked(api.askDeck).mockResolvedValueOnce({
    kind: "answer",
    text: "From the pull request alone.",
    head: HEAD,
    clone: {
      state: "unavailable",
      reason:
        "Your clone's remote doesn't have this pull request's head commit, a41c9e2.",
    },
  });
  const concern = await renderGuide();

  askOn(concern);

  const answer = await within(concern).findByRole("region", {
    name: "More detail",
  });
  await within(answer).findByText("From the pull request alone.");
  expect(within(answer).getByText("From the code at a41c9e2")).toBeTruthy();
  expect(
    within(answer).getByText(
      "Your clone wasn't read: Your clone's remote doesn't have this pull request's head commit, a41c9e2.",
    ),
  ).toBeTruthy();
  expect(
    within(answer).queryByRole("button", { name: "Read your clone too" }),
  ).toBeNull();
});

it("offers to choose the clone, lists the folders Ajour knows, and asks again reading it", async () => {
  syncWithIdentity();
  vi.mocked(api.askDeck)
    .mockResolvedValueOnce({
      kind: "answer",
      text: "From the pull request alone.",
      head: HEAD,
      clone: { state: "not_chosen" },
    })
    .mockResolvedValueOnce({
      kind: "turn",
      turn: turn("c2"),
      clone: { state: "read" },
    });
  vi.mocked(api.getDeckCloneSuggestions).mockResolvedValue({
    suggestions: [
      { folderId: "f1", name: "billing-api", path: "/src/billing-api" },
    ],
  });
  vi.mocked(api.chooseDeckCloneFolder).mockResolvedValue({
    clone: {
      pluginId: "github",
      connectionId: "work",
      repository: "acme/billing-api",
      environment: { kind: "native" },
      path: "/src/billing-api",
      remote: "origin",
      chosenAt: 1,
    },
  });
  const concern = await renderGuide();
  askOn(concern);
  const answer = await within(concern).findByRole("region", {
    name: "More detail",
  });
  await within(answer).findByText("From the pull request alone.");

  fireEvent.click(
    within(answer).getByRole("button", { name: "Read your clone too" }),
  );

  const dialog = await screen.findByRole("dialog", {
    name: "Your clone of billing-api",
  });
  expect(api.getDeckCloneSuggestions).toHaveBeenCalledWith(
    "github",
    "work",
    "acme/billing-api",
    IDENTITY,
  );
  const folder = await within(dialog).findByRole("radio", {
    name: "billing-api /src/billing-api",
  });
  expect((folder as HTMLInputElement).checked).toBe(true);
  fireEvent.click(within(dialog).getByRole("button", { name: "Use clone" }));

  await waitFor(() =>
    expect(
      screen.queryByRole("dialog", { name: "Your clone of billing-api" }),
    ).toBeNull(),
  );
  expect(api.chooseDeckCloneFolder).toHaveBeenCalledWith(
    "github",
    "work",
    "acme/billing-api",
    IDENTITY,
    "f1",
  );
  await waitFor(() => expect(api.askDeck).toHaveBeenCalledTimes(2));
  started("c2");
  text("c2", 0, "Now with the clone.");
  ended("c2");
  expect(
    await within(concern).findByText(
      "From the code at a41c9e2, and your clone",
    ),
  ).toBeTruthy();
});

it("shows why a folder can't be the clone, and keeps the dialog open", async () => {
  syncWithIdentity();
  vi.mocked(api.askDeck).mockResolvedValueOnce({
    kind: "answer",
    text: "From the pull request alone.",
    head: HEAD,
    clone: { state: "not_chosen" },
  });
  vi.mocked(api.getDeckCloneSuggestions).mockResolvedValue({
    suggestions: [{ folderId: "f1", name: "web", path: "/src/web" }],
  });
  vi.mocked(api.chooseDeckCloneFolder).mockRejectedValue(
    new AppApiError("Refused", 400, undefined, {
      reason: "clone_refused",
      error: "None of this folder's remotes is acme/billing-api.",
    }),
  );
  const concern = await renderGuide();
  askOn(concern);
  const answer = await within(concern).findByRole("region", {
    name: "More detail",
  });
  fireEvent.click(
    await within(answer).findByRole("button", { name: "Read your clone too" }),
  );
  const dialog = await screen.findByRole("dialog", {
    name: "Your clone of billing-api",
  });
  await within(dialog).findByRole("radio", { name: "web /src/web" });
  fireEvent.click(within(dialog).getByRole("button", { name: "Use clone" }));

  expect((await within(dialog).findByRole("alert")).textContent).toBe(
    "None of this folder's remotes is acme/billing-api.",
  );
  expect(api.askDeck).toHaveBeenCalledTimes(1);
});
