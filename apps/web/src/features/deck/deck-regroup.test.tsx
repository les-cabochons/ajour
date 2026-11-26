// @vitest-environment jsdom
import { type ReactNode } from "react";
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
import {
  DECK_REGROUP_DEFAULT_INSTRUCTION,
  DECK_SUMMARY_DEFAULT_QUESTION,
  type DeckGuide,
  type DeckOpenedPullRequest,
} from "@ajour/shared/deck";
import { TooltipProvider } from "@/components/ui/tooltip";
import * as api from "@/lib/app-api";
import { receiveAgentTurnEvent } from "@/lib/agent-turns";
import { AppApiError, cachePluginsOverview } from "@/lib/app-api";
import { localStore } from "@/lib/local-store";
import { ShortcutProvider } from "@/lib/shortcut-handlers";
import { NO_DECK_SUMMARY } from "@/test-support/deck";
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
 * Regroup and the agent's guide on Deck's review page (#794): Regroup… on
 * the guide header, in the "…" menu in the narrow view, opens a prefilled
 * instruction field and runs the guide task; once its turn ends, the page
 * shows the agent's guide, labelled "Grouped by Claude Code" with a link
 * back to the guide built from the code. The agent's inferred problem says
 * so, and each summary line ends with `more ›`. The local API module is
 * mocked; the turn's events reach the page as the window's stream sends
 * them.
 */

vi.mock("@/lib/app-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/app-api")>()),
  openDeckPullRequest: vi.fn(),
  askDeck: vi.fn(),
  grantDeckConsent: vi.fn(),
  cancelAgentTurn: vi.fn(),
  regroupDeckGuide: vi.fn(),
  readDeckGuide: vi.fn(),
  revertDeckGuide: vi.fn(),
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

const hunk = (id: string, lines: string[]) => {
  const path = id.slice(0, id.lastIndexOf("#"));
  return {
    id,
    header: "@@ -1,1 +1,1 @@",
    oldStart: 1,
    oldLines: 1,
    newStart: 1,
    newLines: 1,
    patch: [
      `diff --git a/${path} b/${path}`,
      "@@ -1,1 +1,1 @@",
      ...lines,
      "",
    ].join("\n"),
  };
};

const BUILT: DeckGuide = {
  madeWith: "code",
  summary: {
    ...NO_DECK_SUMMARY,
    risks: [
      {
        id: "risk:auth",
        text: "Auth and security: src/api.ts",
        hunkIds: ["src/api.ts#0"],
      },
    ],
  },
  concerns: [
    {
      id: "g1",
      title: "Handle the request",
      rationale: "The handler and its test.",
      hunkIds: ["src/api.ts#0", "src/api.test.ts#0"],
      kinds: [],
    },
  ],
};

const AGENT: DeckGuide = {
  madeWith: "agent",
  provider: { cli: "claude-code", label: "Claude Code" },
  summary: {
    ...NO_DECK_SUMMARY,
    problem: {
      text: "Unauthenticated calls reach the handler.",
      source: "inferred",
    },
    kinds: ["fix", "tests"],
    breaking: [
      {
        id: "breaking:1a2b",
        text: "The handler now refuses anonymous calls",
        hunkIds: ["src/api.ts#0"],
      },
    ],
  },
  concerns: [
    {
      id: "agent-1",
      title: "Refuse anonymous calls",
      rationale: "The handler checks the token first.",
      hunkIds: ["src/api.ts#0"],
      kinds: ["fix"],
    },
    {
      id: "agent-2",
      title: "Test the refusal",
      rationale: "",
      hunkIds: ["src/api.test.ts#0"],
      kinds: ["tests"],
    },
  ],
};

const opened = (guide: DeckGuide): DeckOpenedPullRequest => ({
  headSha: HEAD,
  baseSha: "b52d0f3a11",
  files: [
    {
      path: "src/api.test.ts",
      status: "added",
      binary: false,
      hunks: [hunk("src/api.test.ts#0", ["+test('refuses');"])],
    },
    {
      path: "src/api.ts",
      status: "modified",
      binary: false,
      hunks: [hunk("src/api.ts#0", ["-handle()", "+requireToken(); handle()"])],
    },
  ],
  guide,
});

/** A guide turn. Each test has its own id: the page keeps a turn's events. */
const turnOf = (id: string): AgentTurn => ({
  id,
  conversationId: "c1",
  task: "deck.guide",
  pullRequest: "key",
  head: HEAD,
  state: "running",
});

function send(event: AgentTurnEvent) {
  act(() => receiveAgentTurnEvent(event));
}

const Shell = ({ children }: { children: ReactNode }) => (
  <ShortcutProvider>
    <TooltipProvider>{children}</TooltipProvider>
  </ShortcutProvider>
);

const REF = { repository: "acme/billing-api", number: 1, head: HEAD };

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
  vi.mocked(api.openDeckPullRequest).mockResolvedValue(opened(BUILT));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  for (const mock of [
    api.openDeckPullRequest,
    api.askDeck,
    api.grantDeckConsent,
    api.cancelAgentTurn,
    api.regroupDeckGuide,
    api.readDeckGuide,
    api.revertDeckGuide,
  ]) {
    vi.mocked(mock).mockReset();
  }
});

async function renderPage() {
  await renderRoutes({
    shell: Shell,
    path: `/deck/${itemId}`,
    routes: { "/deck/$itemId": () => <DeckPage itemId={itemId} /> },
  });
  await screen.findByRole("region", { name: /^Concern 1:/ });
}

const changes = () => screen.getByRole("region", { name: "Changes" });
const summary = () => screen.getByRole("region", { name: "Summary" });

it("regroups with the instruction typed in its prefilled field, then shows the agent's guide and names it", async () => {
  vi.mocked(api.regroupDeckGuide).mockResolvedValue({ turn: turnOf("r1") });
  vi.mocked(api.readDeckGuide).mockResolvedValue({ guide: AGENT });
  await renderPage();
  expect(within(changes()).getByText("Built from the code")).toBeTruthy();

  fireEvent.click(within(changes()).getByRole("button", { name: "Regroup…" }));

  const field = within(changes()).getByRole("textbox", {
    name: "Instruction",
  }) as HTMLInputElement;
  expect(field.value).toBe(DECK_REGROUP_DEFAULT_INSTRUCTION);
  expect(document.activeElement).toBe(field);
  expect(field.selectionStart).toBe(0);
  expect(field.selectionEnd).toBe(DECK_REGROUP_DEFAULT_INSTRUCTION.length);
  fireEvent.change(field, {
    target: { value: "Put tests with what they test" },
  });
  fireEvent.submit(field.closest("form")!);

  expect((await within(changes()).findByRole("status")).textContent).toBe(
    "Regrouping the guide…",
  );
  expect(api.regroupDeckGuide).toHaveBeenCalledWith("github", "work", {
    ...REF,
    instruction: "Put tests with what they test",
  });
  send({ type: "started", turnId: "r1", conversationId: "c1" });
  send({
    type: "ended",
    turnId: "r1",
    conversationId: "c1",
    outcome: "done",
  });

  expect(
    await screen.findByRole("region", {
      name: "Concern 1: Refuse anonymous calls",
    }),
  ).toBeTruthy();
  expect(api.readDeckGuide).toHaveBeenCalledWith("github", "work", REF);
  const source = within(changes()).getByText(/Grouped by Claude Code/);
  expect(source.textContent).toBe(
    "Grouped by Claude Code · Built from the code",
  );
  expect(within(changes()).queryByRole("status")).toBeNull();
  // The summary is the agent's, with its kinds.
  expect(within(summary()).getByText("Breaking changes")).toBeTruthy();
  expect(within(summary()).getByText("Fix")).toBeTruthy();
});

it("sends the default instruction as none, and says why a regroup failed, with Try again", async () => {
  vi.mocked(api.regroupDeckGuide).mockResolvedValue({ turn: turnOf("r2") });
  vi.mocked(api.readDeckGuide).mockResolvedValue({ guide: BUILT });
  await renderPage();

  fireEvent.click(within(changes()).getByRole("button", { name: "Regroup…" }));
  fireEvent.submit(
    within(changes())
      .getByRole("textbox", { name: "Instruction" })
      .closest("form")!,
  );
  await waitFor(() =>
    expect(api.regroupDeckGuide).toHaveBeenCalledWith("github", "work", REF),
  );
  send({
    type: "ended",
    turnId: "r2",
    conversationId: "c1",
    outcome: "failed",
    error: "The agent didn't return a guide Ajour could use.",
  });

  expect((await within(changes()).findByRole("alert")).textContent).toBe(
    "The agent didn't return a guide Ajour could use.",
  );
  expect(within(changes()).getByText("Built from the code")).toBeTruthy();
  fireEvent.click(within(changes()).getByRole("button", { name: "Try again" }));
  await waitFor(() => expect(api.regroupDeckGuide).toHaveBeenCalledTimes(2));
});

it("asks for the repository's consent before the first regroup", async () => {
  vi.mocked(api.regroupDeckGuide)
    .mockRejectedValueOnce(
      new AppApiError("Ajour asks once.", 409, undefined, {
        error: "Ajour asks once.",
        reason: "needs_consent",
        repository: "acme/billing-api",
        provider: { cli: "claude-code", label: "Claude Code", version: "2.1" },
      }),
    )
    .mockResolvedValueOnce({ turn: turnOf("r3") });
  vi.mocked(api.grantDeckConsent).mockResolvedValue({ consents: [] });
  await renderPage();

  fireEvent.click(within(changes()).getByRole("button", { name: "Regroup…" }));
  fireEvent.submit(
    within(changes())
      .getByRole("textbox", { name: "Instruction" })
      .closest("form")!,
  );
  const dialog = await screen.findByRole("alertdialog", {
    name: "Ajour asks once for billing-api",
  });
  fireEvent.click(within(dialog).getByRole("button", { name: "Allow" }));

  await waitFor(() => expect(api.regroupDeckGuide).toHaveBeenCalledTimes(2));
  expect(api.grantDeckConsent).toHaveBeenCalledWith(
    "github",
    "work",
    "acme/billing-api",
    "claude-code",
  );
});

it("labels the agent's guide, and its link goes back to the guide built from the code", async () => {
  vi.mocked(api.openDeckPullRequest).mockResolvedValue(opened(AGENT));
  vi.mocked(api.revertDeckGuide).mockResolvedValue({ guide: BUILT });
  await renderPage();
  expect(
    screen.getByRole("region", { name: "Concern 1: Refuse anonymous calls" }),
  ).toBeTruthy();

  fireEvent.click(
    within(changes()).getByRole("button", { name: "Built from the code" }),
  );

  expect(
    await screen.findByRole("region", {
      name: "Concern 1: Handle the request",
    }),
  ).toBeTruthy();
  expect(api.revertDeckGuide).toHaveBeenCalledWith("github", "work", REF);
  expect(within(changes()).queryByText(/Grouped by/)).toBeNull();
  expect(within(changes()).getByText("Built from the code").tagName).not.toBe(
    "BUTTON",
  );
});

it("labels the agent's problem as inferred when no ticket is linked", async () => {
  vi.mocked(api.openDeckPullRequest).mockResolvedValue(opened(AGENT));
  await renderPage();

  const problem = within(summary()).getByText(
    /Unauthenticated calls reach the handler\./,
  );
  expect(problem.textContent).toBe(
    "Unauthenticated calls reach the handler. Inferred, no linked ticket",
  );
});

it("ends each summary line with more ›, which asks about that line", async () => {
  vi.mocked(api.askDeck).mockResolvedValue({
    kind: "answer",
    text: "The token check guards every route.",
    head: HEAD,
  });
  await renderPage();
  const line = within(summary())
    .getByRole("button", { name: "Auth and security: src/api.ts" })
    .closest("li")!;

  const more = within(line).getByRole("button", { name: "More detail" });
  expect(more.textContent).toBe("more ›");
  fireEvent.click(more);
  const question = within(line).getByRole("textbox", { name: "Question" });
  expect((question as HTMLTextAreaElement).value).toBe(
    DECK_SUMMARY_DEFAULT_QUESTION,
  );
  fireEvent.keyDown(question, { key: "Enter" });

  expect(
    await within(line).findByText("The token check guards every route."),
  ).toBeTruthy();
  expect(api.askDeck).toHaveBeenCalledWith("github", "work", {
    ...REF,
    anchor: { kind: "summary", id: "risk:auth" },
  });
});

it("puts Regroup… in the guide's … menu in the narrow view", async () => {
  stubNarrowView(true);
  await renderPage();
  expect(
    within(changes()).queryByRole("button", { name: "Regroup…" }),
  ).toBeNull();

  fireEvent.click(
    within(changes()).getByRole("button", { name: "More guide actions" }),
  );
  fireEvent.click(await screen.findByRole("menuitem", { name: "Regroup…" }));

  expect(
    await within(changes()).findByRole("textbox", { name: "Instruction" }),
  ).toBeTruthy();
});
