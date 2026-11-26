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
import { useParams } from "@tanstack/react-router";
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
  CodeHostConversationResult,
  CodeHostPullRequestFacts,
  PluginsOverview,
} from "@ajour/shared";
import type { DeckOpenedPullRequest } from "@ajour/shared/deck";
import { Toaster } from "@/components/ui/toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import * as api from "@/lib/app-api";
import { cachePluginsOverview } from "@/lib/app-api";
import { localStore } from "@/lib/local-store";
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
 * Stacks in Deck (#788): the strip under the title, with ‹ › and the stale
 * base warning, "Merges after" on the status line, L for the full stack,
 * the narrow fold, the list's grouping and Next in stack after a review.
 * Three layers, main ← #479 ← #482 ← #485, where #482 was based on an older
 * head of #479, and a lone #12. The local API and the diff library are
 * mocked.
 */

vi.mock("@/lib/app-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/app-api")>()),
  openDeckPullRequest: vi.fn(),
  readPullRequestConversation: vi.fn(),
  readPullRequestChecks: vi.fn(),
  readPullRequestVersions: vi.fn(),
  submitPullRequestReview: vi.fn(),
}));
vi.mock("@/components/diff-highlighter", () => ({
  diffWorkerPool: () => undefined,
}));
vi.mock("@pierre/diffs/react", async () => ({
  WorkerPoolContext: (await import("react")).createContext(undefined),
  PatchDiff: ({ patch }: { patch: string }) => <pre>{patch}</pre>,
}));
vi.stubGlobal(
  "IntersectionObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

beforeAll(() => installDomShims());

const DIFF: DeckOpenedPullRequest = {
  headSha: "head-482",
  baseSha: "base",
  guide: null,
  files: [],
};

const CONVERSATION: CodeHostConversationResult = {
  description: "",
  timeline: [],
  threads: [],
  viewedPaths: [],
  mergeMethods: ["merge"],
};

const facts = (
  number: number,
  headRef: string,
  baseRef: string,
  extra: Partial<CodeHostPullRequestFacts> = {},
): CodeHostPullRequestFacts => ({
  ...pullRequestFacts,
  id: `pr${number}`,
  number,
  url: `https://github.com/acme/api/pull/${number}`,
  title: `Layer ${number}`,
  headSha: `head-${number}`,
  headRef,
  baseRef,
  ...extra,
});

const STACK = [
  facts(485, "per-user", "per-route", { baseSha: "head-482" }),
  facts(12, "docs", "main", { title: "Fix the docs" }),
  facts(482, "per-route", "rate-limits", { baseSha: "an-older-head" }),
  facts(479, "rate-limits", "main", { baseSha: "main-tip" }),
];

const Shell = ({ children }: { children: ReactNode }) => (
  <ShortcutProvider>
    <TooltipProvider>
      {children}
      <Toaster />
    </TooltipProvider>
  </ShortcutProvider>
);

function sync(
  pullRequests: CodeHostPullRequestFacts[] = STACK,
  pluginId = "github",
) {
  localStore.syncPullRequests(
    {
      pluginId,
      pluginName: pluginId === "github" ? "GitHub" : "Azure DevOps",
      connectionId: "work",
      connectionLabel: "Work",
    },
    { viewer: { login: "alex", isBot: false }, pullRequests },
  );
}

const idOf = (number: number) =>
  localStore
    .snapshot()
    .pullRequests!.find((item) => item.facts.number === number)!._id;

beforeEach(() => {
  cachePluginsOverview(codeHostOverview);
  sync();
  vi.mocked(api.openDeckPullRequest).mockResolvedValue(DIFF);
  vi.mocked(api.readPullRequestConversation).mockResolvedValue(CONVERSATION);
  vi.mocked(api.readPullRequestChecks).mockResolvedValue({ checks: [] });
  vi.mocked(api.readPullRequestVersions).mockResolvedValue({ versions: [] });
  vi.mocked(api.submitPullRequestReview).mockResolvedValue({
    reviewId: "review-1",
  });
});

afterEach(() => {
  cleanup();
  localStore.removeConnectionPullRequests("github", "work");
  localStore.removeConnectionPullRequests("azure_devops", "work");
  vi.mocked(api.openDeckPullRequest).mockReset();
  vi.mocked(api.readPullRequestConversation).mockReset();
  vi.mocked(api.readPullRequestChecks).mockReset();
  vi.mocked(api.readPullRequestVersions).mockReset();
  vi.mocked(api.submitPullRequestReview).mockReset();
  vi.restoreAllMocks();
});

async function renderReviewPage(number: number) {
  return await renderRoutes({
    shell: Shell,
    path: `/deck/${idOf(number)}`,
    routes: {
      "/deck/$itemId": function ReviewPage() {
        const { itemId } = useParams({ strict: false });
        return <DeckPage itemId={itemId} />;
      },
      "/deck": () => <DeckPage />,
    },
  });
}

function press(key: string) {
  act(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key }));
  });
}

const title = () => screen.getByRole("heading", { level: 1 }).textContent ?? "";
const strip = () => screen.getByRole("navigation", { name: "Stack" });

it("shows the stack under the title, each layer below and above this one a link", async () => {
  await renderReviewPage(482);

  expect(strip().textContent).toContain(
    "Stack 2 of 3 · main ← #479 ← #482 this ← #485",
  );
  expect(
    within(strip()).getByRole("link", { name: "#479" }).getAttribute("href"),
  ).toBe(`/deck/${idOf(479)}`);
  expect(within(strip()).getByRole("link", { name: "#485" })).toBeTruthy();
  expect(within(strip()).queryByRole("link", { name: "#482" })).toBeNull();
});

it("goes down and up the stack with ‹ and ›, with none past either end", async () => {
  await renderReviewPage(482);

  fireEvent.click(
    within(strip()).getByRole("button", { name: "Layer below, #479" }),
  );
  await waitFor(() => expect(title()).toBe("Layer 479"));
  expect(
    (
      within(strip()).getByRole("button", {
        name: "Layer below",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  fireEvent.click(
    within(strip()).getByRole("button", { name: "Layer above, #482" }),
  );
  await waitFor(() => expect(title()).toBe("Layer 482"));
});

it("warns quietly when the layer below changed since this one was based on it", async () => {
  await renderReviewPage(482);
  expect(
    within(strip()).getByText("#479 changed since this layer was based on it."),
  ).toBeTruthy();
});

it("says nothing of the base when this layer is on the head below", async () => {
  await renderReviewPage(485);
  expect(within(strip()).queryByText(/changed since this layer/)).toBeNull();
});

it("puts the merge order on the status line", async () => {
  await renderReviewPage(482);
  expect(screen.getByText("Merges after #479")).toBeTruthy();
  cleanup();

  await renderReviewPage(479);
  expect(screen.queryByText(/Merges after/)).toBeNull();
});

it("shows no strip for a pull request that's alone", async () => {
  await renderReviewPage(12);
  expect(screen.queryByRole("navigation", { name: "Stack" })).toBeNull();
});

it("opens the full stack with L, in merge order, each layer a link", async () => {
  await renderReviewPage(482);

  press("l");
  const stack = await screen.findByRole("dialog", { name: "Stack" });
  expect(
    within(stack)
      .getAllByRole("listitem")
      .map((item) => item.textContent),
  ).toEqual([
    expect.stringContaining("#479Layer 479"),
    expect.stringContaining("#482Layer 482"),
    expect.stringContaining("#485Layer 485"),
  ]);
  expect(within(stack).getByText(/Merges into main/)).toBeTruthy();
  expect(within(stack).getByText("This layer")).toBeTruthy();
  fireEvent.click(within(stack).getByRole("link", { name: /#485/ }));
  await waitFor(() => expect(title()).toBe("Layer 485"));
});

it("leaves S to the timer on the review page", async () => {
  await renderReviewPage(482);
  press("s");
  expect(screen.queryByRole("dialog", { name: "Stack" })).toBeNull();
});

it("links Restack in Review Deck on Azure DevOps, and not on GitHub", async () => {
  await renderReviewPage(482);
  expect(screen.queryByRole("link", { name: "Restack in Review Deck" })).toBe(
    null,
  );
  cleanup();
  localStore.removeConnectionPullRequests("github", "work");

  const overview: PluginsOverview = structuredClone(codeHostOverview);
  overview.connectionGroups[0]!.plugin.id = "azure_devops";
  overview.connectionGroups[0]!.connections[0]!.pluginId = "azure_devops";
  overview.plugins = overview.connectionGroups.map((group) => group.plugin);
  cachePluginsOverview(overview);
  sync(
    STACK.map((entry) => ({
      ...entry,
      repository: "Payments/api",
      url: `https://dev.azure.com/acme/Payments/_git/api/pullrequest/${entry.number}`,
    })),
    "azure_devops",
  );
  await renderReviewPage(482);

  expect(
    within(strip())
      .getByRole("link", { name: "Restack in Review Deck" })
      .getAttribute("href"),
  ).toBe(
    "https://dev.azure.com/acme/Payments/_apps/hub/Cabochonio.review-deck.review-hub?pr=482&repo=api",
  );
});

it("folds to Stack 2/3 in the narrow view, which opens the full stack in a sheet", async () => {
  stubNarrowView(true);
  onTestFinished(() => stubNarrowView(false));
  await renderReviewPage(482);

  expect(within(strip()).queryByText(/main ←/)).toBeNull();
  expect(within(strip()).queryByRole("button", { name: /Layer below/ })).toBe(
    null,
  );
  // The warning stays under the fold.
  expect(
    within(strip()).getByText("#479 changed since this layer was based on it."),
  ).toBeTruthy();
  fireEvent.click(within(strip()).getByRole("button", { name: "Stack 2/3" }));
  const sheet = await screen.findByRole("dialog", { name: "Stack" });
  expect(within(sheet).getAllByRole("listitem")).toHaveLength(3);
});

it("groups a stack's layers in the list, bottom first, each with its place", async () => {
  await renderRoutes({
    shell: Shell,
    path: "/deck",
    routes: { "/deck": () => <DeckPage /> },
  });

  const active = screen.getByRole("region", { name: "Active" });
  const rows = within(active).getAllByRole("link");
  const labels = rows.map((row) => row.getAttribute("aria-label"));
  // The lone pull request keeps its place by time, before or after them.
  const bottom = labels.indexOf("Open Layer 479");
  expect(labels.slice(bottom, bottom + 3)).toEqual([
    "Open Layer 479",
    "Open Layer 482",
    "Open Layer 485",
  ]);
  expect(labels).toContain("Open Fix the docs");
  expect(within(rows[bottom + 1]!).getByText(/Stack 2\/3/)).toBeTruthy();
  const alone = rows[labels.indexOf("Open Fix the docs")]!;
  expect(within(alone).queryByText(/Stack/)).toBeNull();
});

it("offers Next in stack after sending a review, which opens the layer above", async () => {
  await renderReviewPage(482);
  await waitFor(() =>
    expect(
      (
        screen.getByRole("button", {
          name: "Finish review",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false),
  );

  fireEvent.click(screen.getByRole("button", { name: "Finish review" }));
  const dialog = await screen.findByRole("dialog", { name: "Finish review" });
  fireEvent.click(within(dialog).getByRole("radio", { name: "Approve" }));
  fireEvent.click(
    within(dialog).getByRole("button", { name: "Submit review" }),
  );

  const sent = await screen.findByRole("dialog", { name: "Approved" });
  expect(within(sent).getByText("Next in stack: #485 Layer 485")).toBeTruthy();
  fireEvent.click(within(sent).getByRole("button", { name: "Next in stack" }));
  await waitFor(() => expect(title()).toBe("Layer 485"));
  expect(screen.queryByRole("dialog", { name: "Approved" })).toBeNull();
});

it("closes as before after a review of the top layer", async () => {
  await renderReviewPage(485);
  await waitFor(() =>
    expect(
      (
        screen.getByRole("button", {
          name: "Finish review",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false),
  );
  press("r");
  press("a");
  const dialog = await screen.findByRole("dialog", { name: "Finish review" });
  fireEvent.click(
    within(dialog).getByRole("button", { name: "Submit review" }),
  );
  await waitFor(() =>
    expect(screen.queryByRole("dialog", { name: "Finish review" })).toBeNull(),
  );
  expect(api.submitPullRequestReview).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("button", { name: "Next in stack" })).toBeNull();
});

it("offers Next in stack in R then Y's toast, with no dialog", async () => {
  await renderReviewPage(482);
  await waitFor(() =>
    expect(
      (
        screen.getByRole("button", {
          name: "Finish review",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false),
  );
  press("r");
  press("y");
  await waitFor(() => expect(api.submitPullRequestReview).toHaveBeenCalled());
  expect(screen.queryByRole("dialog", { name: "Finish review" })).toBeNull();
  fireEvent.click(await screen.findByRole("button", { name: "Next in stack" }));
  await waitFor(() => expect(title()).toBe("Layer 485"));
});
