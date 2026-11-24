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
import type {
  DeckAskResponse,
  DeckOpenedPullRequest,
} from "@ajour/shared/deck";
import { TooltipProvider } from "@/components/ui/tooltip";
import * as api from "@/lib/app-api";
import { receiveAgentTurnEvent } from "@/lib/agent-turns";
import {
  announceDeckConsentRevoked,
  DECK_CONSENT_REVOKED_STORAGE_KEY,
} from "@/lib/deck-consent-revocations";
import { ShortcutProvider } from "@/lib/shortcut-handlers";
import { AppApiError, cachePluginsOverview } from "@/lib/app-api";
import { localStore } from "@/lib/local-store";
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

/** A guide of one concern with 600 hunks, so its rows mount only near the screen (#790). */
const HUGE: DeckOpenedPullRequest = {
  headSha: HEAD,
  baseSha: "b52d0f3a11",
  files: [
    {
      path: "src/big.ts",
      status: "modified",
      binary: false,
      hunks: Array.from({ length: 600 }, (_, index) => ({
        ...hunk(
          `src/big.ts#${index}`,
          `@@ -${index + 1},1 +${index + 1},1 @@`,
          ["-a", "+A"],
        ),
        oldStart: index + 1,
        newStart: index + 1,
      })),
    },
  ],
  guide: {
    madeWith: "code",
    concerns: [
      {
        id: "big",
        title: "Rewrite the big file",
        rationale: "Every line of it changes.",
        hunkIds: Array.from(
          { length: 600 },
          (_, index) => `src/big.ts#${index}`,
        ),
      },
    ],
  },
};

/** The page inside a 900px scroller whose rows are 100px high. */
async function renderHugeGuide() {
  vi.mocked(api.openDeckPullRequest).mockResolvedValue(HUGE);
  restoreSizes = sizeElements([
    { selector: "[data-testid=scroller]", width: 1440, height: 900 },
    { selector: ".deck-review-row", width: 1000, height: 100 },
  ]);
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
  await screen.findByRole("heading", {
    name: "Concern 1: Rewrite the big file",
  });
  return screen.getByTestId("scroller");
}
let restoreSizes: (() => void) | undefined;
afterEach(() => {
  restoreSizes?.();
  restoreSizes = undefined;
});

/** Moves the focus to a hunk's Viewed mark, as a reader moving on would. */
function focusFirstHunk() {
  const viewed = screen.getByRole("button", {
    name: "Viewed: src/big.ts, line 1",
  });
  act(() => viewed.focus());
  return viewed;
}

it("keeps an ask and its running turn while a huge pull request scrolls its concern away", async () => {
  vi.mocked(api.askDeck).mockResolvedValueOnce({
    kind: "turn",
    turn: turn("t9"),
  });
  const scroller = await renderHugeGuide();
  fireEvent.click(screen.getByRole("button", { name: "More detail" }));
  fireEvent.keyDown(screen.getByRole("textbox", { name: "Question" }), {
    key: "Enter",
  });
  const answer = await screen.findByRole("region", { name: "More detail" });
  started("t9");
  text("t9", 0, "It reads ");
  await within(answer).findByText("It reads");

  const viewed = focusFirstHunk();
  scrollElement(scroller, { top: 20_000 });
  expect(screen.queryByRole("button", { name: "More detail" })).toBeNull();
  // The turn goes on while its concern is away.
  text("t9", 1, "the whole file.");
  scrollElement(scroller, { top: 0 });

  const back = await screen.findByRole("region", { name: "More detail" });
  expect(within(back).getByText("It reads the whole file.")).toBeTruthy();
  expect(within(back).getByRole("button", { name: "Stop" })).toBeTruthy();
  expect(document.activeElement).toBe(viewed);
  ended("t9");
  expect(
    await within(back).findByText("From the code at a41c9e2"),
  ).toBeTruthy();
  expect(api.askDeck).toHaveBeenCalledTimes(1);
});

it("keeps the question being written while a huge pull request scrolls its concern away", async () => {
  const scroller = await renderHugeGuide();
  fireEvent.click(screen.getByRole("button", { name: "More detail" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Question" }), {
    target: { value: "Is it tested?" },
  });

  const viewed = focusFirstHunk();
  scrollElement(scroller, { top: 20_000 });
  expect(screen.queryByRole("textbox", { name: "Question" })).toBeNull();
  scrollElement(scroller, { top: 0 });

  const question = (await screen.findByRole("textbox", {
    name: "Question",
  })) as HTMLTextAreaElement;
  expect(question.value).toBe("Is it tested?");
  // Coming back into view doesn't take the focus from where the reader is.
  expect(document.activeElement).toBe(viewed);
  expect(
    screen
      .getByRole("button", { name: "More detail" })
      .getAttribute("aria-expanded"),
  ).toBe("true");
  expect(api.askDeck).not.toHaveBeenCalled();
});

it("keeps an answer behind Files A–Z", async () => {
  vi.mocked(api.askDeck).mockResolvedValueOnce({
    kind: "turn",
    turn: turn("t10"),
  });
  const concern = await renderGuide();
  askOn(concern);
  await within(concern).findByRole("region", { name: "More detail" });
  started("t10");
  text("t10", 0, "Kept.");

  fireEvent.click(screen.getByRole("button", { name: "Files A–Z" }));
  ended("t10");
  fireEvent.click(screen.getByRole("button", { name: "Guide" }));

  const again = await screen.findByRole("region", {
    name: "Concern 1: Handle the request",
  });
  const answer = within(again).getByRole("region", { name: "More detail" });
  expect(within(answer).getByText("Kept.")).toBeTruthy();
  expect(within(answer).getByText("From the code at a41c9e2")).toBeTruthy();
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

const BILLING = {
  pluginId: "github",
  connectionId: "work",
  repository: "acme/billing-api",
};

/** Settings › Agents revokes `repository` in another window, at `at`, which this one hears through storage. */
function revokeInAnotherWindow(repository: typeof BILLING, at = Date.now()) {
  act(() => {
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: DECK_CONSENT_REVOKED_STORAGE_KEY,
        newValue: JSON.stringify({ ...repository, at }),
      }),
    );
  });
}

it("shows a revoked repository's answer no more once its conversation closes, back from Files A–Z", async () => {
  vi.mocked(api.askDeck).mockResolvedValueOnce({
    kind: "turn",
    turn: turn("t12"),
  });
  const concern = await renderGuide();
  askOn(concern);
  const answer = await within(concern).findByRole("region", {
    name: "More detail",
  });
  started("t12");
  text("t12", 0, "The old answer.");
  ended("t12");
  await within(answer).findByText("From the code at a41c9e2");

  fireEvent.click(screen.getByRole("button", { name: "Files A–Z" }));
  // Settings › Agents revokes the repository: its conversation closes.
  send({
    type: "conversation-closed",
    conversationId: "c1",
    reason: "revoked",
  });
  fireEvent.click(screen.getByRole("button", { name: "Guide" }));

  const again = await screen.findByRole("region", {
    name: "Concern 1: Handle the request",
  });
  expect(within(again).queryByRole("region", { name: "More detail" })).toBe(
    null,
  );
  expect(screen.queryByText("The old answer.")).toBeNull();
  expect(moreOn(again).getAttribute("aria-expanded")).toBe("false");
});

it("keeps an answer asked after allowing the repository again, when the revoked conversation's close comes late", async () => {
  vi.mocked(api.askDeck)
    .mockResolvedValueOnce({ kind: "turn", turn: turn("t12") })
    .mockResolvedValueOnce({
      kind: "answer",
      text: "Asked again.",
      head: HEAD,
    });
  const concern = await renderGuide();
  askOn(concern);
  const answer = await within(concern).findByRole("region", {
    name: "More detail",
  });
  started("t12");
  text("t12", 0, "The old answer.");
  ended("t12");
  await within(answer).findByText("From the code at a41c9e2");

  // Settings › Agents revokes the repository, then it is allowed again and
  // asked again, before the old conversation's close arrives.
  act(() => announceDeckConsentRevoked(BILLING));
  expect(screen.queryByText("The old answer.")).toBeNull();
  askOn(concern);
  await within(concern).findByText("Asked again.");
  send({
    type: "conversation-closed",
    conversationId: "c1",
    reason: "revoked",
  });

  expect(within(concern).getByText("Asked again.")).toBeTruthy();
});

it("keeps an answer asked after allowing the repository again, when another window's revocation reaches this one late", async () => {
  vi.mocked(api.askDeck)
    .mockResolvedValueOnce({ kind: "turn", turn: turn("t12") })
    .mockResolvedValueOnce({
      kind: "answer",
      text: "Asked again.",
      head: HEAD,
    });
  const concern = await renderGuide();
  askOn(concern);
  const answer = await within(concern).findByRole("region", {
    name: "More detail",
  });
  started("t12");
  text("t12", 0, "The old answer.");
  ended("t12");
  await within(answer).findByText("From the code at a41c9e2");

  // Revoked in another window: the conversation's close comes first, then
  // the repository is allowed and asked again, then that window's signal.
  const revokedAt = Date.now() - 1_000;
  send({
    type: "conversation-closed",
    conversationId: "c1",
    reason: "revoked",
  });
  expect(screen.queryByText("The old answer.")).toBeNull();
  askOn(concern);
  await within(concern).findByText("Asked again.");
  revokeInAnotherWindow(BILLING, revokedAt);

  expect(within(concern).getByText("Asked again.")).toBeTruthy();
});

it("hides a cached answer as its repository is revoked in another window", async () => {
  vi.mocked(api.askDeck).mockResolvedValueOnce({
    kind: "answer",
    text: "Cached long ago.",
    head: HEAD,
  });
  const concern = await renderGuide();
  askOn(concern);
  await within(concern).findByText("Cached long ago.");

  // Another repository's revocation leaves it.
  revokeInAnotherWindow({ ...BILLING, repository: "acme/other" });
  expect(within(concern).getByText("Cached long ago.")).toBeTruthy();

  revokeInAnotherWindow(BILLING);
  expect(within(concern).queryByText("Cached long ago.")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Files A–Z" }));
  fireEvent.click(screen.getByRole("button", { name: "Guide" }));
  const again = await screen.findByRole("region", {
    name: "Concern 1: Handle the request",
  });
  expect(within(again).queryByText("Cached long ago.")).toBeNull();
});

it("stops an ask still waiting for its answer when its repository is revoked, and drops the answer that comes after", async () => {
  let answerLate: (answer: DeckAskResponse) => void = () => {};
  vi.mocked(api.askDeck).mockReturnValueOnce(
    new Promise((resolve) => {
      answerLate = resolve;
    }),
  );
  const concern = await renderGuide();
  askOn(concern);
  const answer = await within(concern).findByRole("region", {
    name: "More detail",
  });
  expect(within(answer).getByText("Getting more detail…")).toBeTruthy();

  act(() => announceDeckConsentRevoked(BILLING));
  expect(within(answer).getByText("Stopped.")).toBeTruthy();
  await act(async () => {
    answerLate({ kind: "answer", text: "Sent before the revoke.", head: HEAD });
  });
  expect(screen.queryByText("Sent before the revoke.")).toBeNull();
  expect(within(answer).getByText("Stopped.")).toBeTruthy();
});
