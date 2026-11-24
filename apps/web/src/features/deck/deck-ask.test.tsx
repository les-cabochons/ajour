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
 * "more ›" on a concern (#791): the first ask. It runs a turn in the pull
 * request's conversation; a quiet placeholder shows, then the answer streams
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
async function renderGuide() {
  await renderRoutes({
    shell: Shell,
    path: `/deck/${itemId}`,
    routes: { "/deck/$itemId": () => <DeckPage itemId={itemId} /> },
  });
  return await screen.findByRole("region", {
    name: "Concern 1: Handle the request",
  });
}

const moreOn = (concern: HTMLElement) =>
  within(concern).getByRole("button", { name: "More detail" });

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

  fireEvent.click(moreOn(concern));

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
  fireEvent.click(moreOn(concern));
  const again = await within(concern).findByRole("region", {
    name: "More detail",
  });
  await within(again).findByText("It reads the export.");
  expect(within(again).queryByText("Getting more detail…")).toBeNull();
  expect(within(again).getByText("From the code at a41c9e2")).toBeTruthy();
});

it("asks a typed question in place of the default one", async () => {
  vi.mocked(api.askDeck)
    .mockResolvedValueOnce({ kind: "answer", text: "Default.", head: HEAD })
    .mockResolvedValueOnce({ kind: "turn", turn: turn("t2") });
  const concern = await renderGuide();
  fireEvent.click(moreOn(concern));
  const answer = await within(concern).findByRole("region", {
    name: "More detail",
  });
  await within(answer).findByText("Default.");

  fireEvent.change(
    within(answer).getByRole("textbox", { name: "Ask something else" }),
    {
      target: { value: "Is it tested?" },
    },
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
      question: "Is it tested?",
    }),
  );
  expect(await within(answer).findByText("Is it tested?")).toBeTruthy();
  expect(within(answer).queryByText("Default.")).toBeNull();
  started("t2");
  text("t2", 0, "Yes, in api.test.ts.");
  ended("t2");
  expect(await within(answer).findByText("Yes, in api.test.ts.")).toBeTruthy();
});

it("stops a turn, keeping what came", async () => {
  vi.mocked(api.askDeck).mockResolvedValueOnce({
    kind: "turn",
    turn: turn("t3"),
  });
  vi.mocked(api.cancelAgentTurn).mockResolvedValue({ cancelled: true });
  const concern = await renderGuide();
  fireEvent.click(moreOn(concern));
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
  fireEvent.click(moreOn(concern));
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

  fireEvent.click(moreOn(concern));

  const dialog = await screen.findByRole("alertdialog", {
    name: "Ajour asks once for billing-api",
  });
  expect(dialog.textContent).toContain("Claude Code 2.1.318");
  expect(dialog.textContent).toContain("the changed lines");
  expect(dialog.textContent).toContain("the review threads");
  fireEvent.click(within(dialog).getByRole("button", { name: "Allow" }));

  await waitFor(() => expect(api.askDeck).toHaveBeenCalledTimes(2));
  expect(api.grantDeckConsent).toHaveBeenCalledWith(
    "github",
    "work",
    "acme/billing-api",
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
  fireEvent.click(moreOn(concern));
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
  fireEvent.click(moreOn(concern));
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
