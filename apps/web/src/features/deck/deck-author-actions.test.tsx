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
  codeHostOverview,
  pullRequestFacts,
} from "../../../tests/fixtures/pull-requests";
import { DeckPage } from "./deck-page";

/*
 * The author's actions (#786, ADR 0002): on a pull request they opened, the
 * author edits the title, toggles draft and ready, and merges after a
 * confirmation that names the method and the commit title and offers only
 * the methods the repository allows. Each goes to the code host at once; a
 * failure keeps the edit and offers Retry. The local API is mocked; each
 * test reads what the user sees.
 */

vi.mock("@/lib/app-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/app-api")>()),
  openDeckPullRequest: vi.fn(),
  readPullRequestConversation: vi.fn(),
  readPullRequestChecks: vi.fn(),
  readPullRequestVersions: vi.fn(),
  updatePullRequest: vi.fn(),
  mergePullRequest: vi.fn(),
  syncCodeHostConnection: vi.fn(),
}));
const toasts = vi.hoisted(() => ({ show: vi.fn(), action: vi.fn() }));
vi.mock("@/components/ui/toast", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/ui/toast")>()),
  showToast: toasts.show,
  showActionToast: toasts.action,
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
        {
          id: "src/api.ts#0",
          header: "@@ -1,1 +1,1 @@",
          oldStart: 1,
          oldLines: 1,
          newStart: 1,
          newLines: 1,
          patch:
            "diff --git a/src/api.ts b/src/api.ts\n@@ -1,1 +1,1 @@\n-b\n+B\n",
        },
      ],
    },
  ],
};

const conversation = (
  mergeMethods: CodeHostConversationResult["mergeMethods"] = [
    "squash",
    "rebase",
  ],
): CodeHostConversationResult => ({
  description: "",
  timeline: [],
  threads: [],
  viewedPaths: [],
  mergeMethods,
});

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
      pullRequests: [
        {
          ...pullRequestFacts,
          author: { login: "alex", isBot: false },
          viewerIsAuthor: true,
          reviewRequests: [],
          baseRef: "main",
          ...overrides,
        },
      ],
    },
  );
  return localStore
    .snapshot()
    .pullRequests!.find(
      (item) =>
        item.pluginId === pluginId &&
        item.facts.id === (overrides.id ?? pullRequestFacts.id),
    )!._id;
}

const facts = (id: string) =>
  localStore.snapshot().pullRequests!.find((item) => item._id === id)!.facts;

let number = 100;
beforeEach(() => {
  cachePluginsOverview(codeHostOverview);
  vi.mocked(api.openDeckPullRequest).mockResolvedValue(DIFF);
  vi.mocked(api.readPullRequestConversation).mockResolvedValue(conversation());
  vi.mocked(api.readPullRequestChecks).mockResolvedValue({ checks: [] });
  vi.mocked(api.readPullRequestVersions).mockResolvedValue({
    versions: [{ number: 1, headSha: "one", pushedAt: 1, commits: [] }],
  });
  vi.mocked(api.updatePullRequest).mockImplementation(
    async (_plugin, _connection, request) => ({
      title: request.title ?? pullRequestFacts.title,
      draft: request.draft ?? false,
    }),
  );
  vi.mocked(api.mergePullRequest).mockResolvedValue({
    mergeCommitSha: "merge789",
  });
  vi.mocked(api.syncCodeHostConnection).mockResolvedValue({
    viewer: { login: "alex", isBot: false },
    pullRequests: [],
  });
});

afterEach(() => {
  cleanup();
  vi.mocked(api.openDeckPullRequest).mockReset();
  vi.mocked(api.readPullRequestConversation).mockReset();
  vi.mocked(api.readPullRequestChecks).mockReset();
  vi.mocked(api.readPullRequestVersions).mockReset();
  vi.mocked(api.updatePullRequest).mockReset();
  vi.mocked(api.mergePullRequest).mockReset();
  vi.mocked(api.syncCodeHostConnection).mockReset();
  toasts.show.mockReset();
  toasts.action.mockReset();
  vi.restoreAllMocks();
});

/** A pull request of its own for each test, so none shares local state. */
async function renderAuthorPage(
  overrides: Partial<CodeHostPullRequestFacts> = {},
  pluginId = "github",
) {
  number += 1;
  if (pluginId !== "github") {
    // The code host the pull request comes from is the one enabled.
    const overview: PluginsOverview = structuredClone(codeHostOverview);
    overview.connectionGroups[0]!.plugin.id = pluginId;
    overview.connectionGroups[0]!.connections[0]!.pluginId = pluginId;
    overview.plugins = overview.connectionGroups.map((group) => group.plugin);
    cachePluginsOverview(overview);
  }
  const id = sync({ id: `pr${number}`, number, ...overrides }, pluginId);
  await renderRoutes({
    shell: Shell,
    path: `/deck/${id}`,
    routes: { "/deck/$itemId": () => <DeckPage itemId={id} /> },
  });
  // The diff read: the page knows the head on screen.
  await within(screen.getByRole("region", { name: "Changes" })).findAllByText(
    "src/api.ts",
  );
  return id;
}

/** Opens the merge dialog once the methods are read. */
async function openMerge() {
  const button = await screen.findByRole("button", { name: "Merge…" });
  await waitFor(() => expect(button.hasAttribute("disabled")).toBe(false));
  fireEvent.click(button);
  return await screen.findByRole("dialog", { name: /Merge #\d+ into main\?/ });
}

it("shows the author's actions to the author only", async () => {
  await renderAuthorPage({ viewerIsAuthor: false });
  expect(screen.queryByRole("button", { name: "Merge…" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Convert to draft" })).toBeNull();
  expect(screen.queryByRole("button", { name: /Edit the title/ })).toBeNull();
  cleanup();

  await renderAuthorPage();
  expect(screen.getByRole("button", { name: "Merge…" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Convert to draft" })).toBeTruthy();
  expect(screen.getByRole("button", { name: /Edit the title/ })).toBeTruthy();
});

it("offers none of them on a merged pull request", async () => {
  await renderAuthorPage({ state: "merged", closedAt: Date.now() });
  expect(screen.queryByRole("button", { name: "Merge…" })).toBeNull();
  expect(screen.queryByRole("button", { name: /Edit the title/ })).toBeNull();
});

it("edits the title on the code host, and shows what it answered", async () => {
  const id = await renderAuthorPage();

  fireEvent.click(screen.getByRole("button", { name: /Edit the title/ }));
  const field = screen.getByRole("textbox", { name: "Title" });
  fireEvent.change(field, {
    target: { value: "Fix request handling for 410" },
  });
  fireEvent.keyDown(field, { key: "Enter" });

  expect(
    await screen.findByRole("heading", {
      level: 1,
      name: "Fix request handling for 410",
    }),
  ).toBeTruthy();
  expect(api.updatePullRequest).toHaveBeenCalledWith("github", "work", {
    repository: "acme/api",
    number,
    title: "Fix request handling for 410",
  });
  expect(facts(id).title).toBe("Fix request handling for 410");
});

it("sends nothing when Escape leaves the title, or it didn't change", async () => {
  await renderAuthorPage();

  fireEvent.click(screen.getByRole("button", { name: /Edit the title/ }));
  let field = screen.getByRole("textbox", { name: "Title" });
  fireEvent.change(field, { target: { value: "Something else" } });
  fireEvent.keyDown(field, { key: "Escape" });
  expect(screen.getByRole("heading", { level: 1 }).textContent).toContain(
    "Fix request handling",
  );

  fireEvent.click(screen.getByRole("button", { name: /Edit the title/ }));
  field = screen.getByRole("textbox", { name: "Title" });
  fireEvent.keyDown(field, { key: "Enter" });
  expect(screen.queryByRole("textbox", { name: "Title" })).toBeNull();
  expect(api.updatePullRequest).not.toHaveBeenCalled();
});

it("keeps the edited title after a failed save, and Retry sends it again", async () => {
  await renderAuthorPage();
  vi.mocked(api.updatePullRequest).mockRejectedValueOnce(
    new Error("GitHub request failed (502)."),
  );

  fireEvent.click(screen.getByRole("button", { name: /Edit the title/ }));
  const field = screen.getByRole("textbox", { name: "Title" });
  fireEvent.change(field, { target: { value: "Fix 410" } });
  fireEvent.keyDown(field, { key: "Enter" });

  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toBe(
    "Couldn't save the title: GitHub request failed (502).",
  );
  expect(
    (screen.getByRole("textbox", { name: "Title" }) as HTMLInputElement).value,
  ).toBe("Fix 410");

  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(
    await screen.findByRole("heading", { level: 1, name: "Fix 410" }),
  ).toBeTruthy();
  expect(api.updatePullRequest).toHaveBeenCalledTimes(2);
  expect(vi.mocked(api.updatePullRequest).mock.calls[1]![2]).toEqual({
    repository: "acme/api",
    number,
    title: "Fix 410",
  });
});

it("converts the pull request to a draft and marks it ready again, in GitHub's words", async () => {
  const id = await renderAuthorPage();

  fireEvent.click(screen.getByRole("button", { name: "Convert to draft" }));
  await screen.findByRole("button", { name: "Ready for review" });
  expect(api.updatePullRequest).toHaveBeenLastCalledWith("github", "work", {
    repository: "acme/api",
    number,
    draft: true,
  });
  expect(facts(id).draft).toBe(true);
  expect(screen.getByText(/^Draft/)).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: "Ready for review" }));
  await screen.findByRole("button", { name: "Convert to draft" });
  expect(facts(id).draft).toBe(false);
});

it("names the draft actions as Azure DevOps does", async () => {
  await renderAuthorPage({ draft: true }, "azure_devops");
  expect(screen.getByRole("button", { name: "Publish" })).toBeTruthy();
});

it("offers Retry when the draft state didn't change", async () => {
  await renderAuthorPage();
  vi.mocked(api.updatePullRequest).mockRejectedValueOnce(
    new Error("GitHub: Resource not accessible by personal access token"),
  );

  fireEvent.click(screen.getByRole("button", { name: "Convert to draft" }));
  await waitFor(() => expect(toasts.action).toHaveBeenCalledTimes(1));
  const [toast] = toasts.action.mock.calls[0]!;
  expect(toast).toMatchObject({
    title: "Couldn't convert it to a draft",
    description: "GitHub: Resource not accessible by personal access token",
    actionLabel: "Retry",
  });
  act(() => toast.onAction());

  await screen.findByRole("button", { name: "Ready for review" });
  expect(api.updatePullRequest).toHaveBeenCalledTimes(2);
});

it("asks before merging, naming the method, the commit title and what it merges", async () => {
  await renderAuthorPage();

  const dialog = await openMerge();
  expect(
    within(dialog).getByText(
      "It merges the head you read, one, into main. A merge can't be undone.",
    ),
  ).toBeTruthy();
  // Only the methods the repository allows, the first chosen.
  const methods = within(dialog).getAllByRole("radio");
  expect(methods.map((radio) => radio.closest("label")?.textContent)).toEqual([
    "Squash and merge",
    "Rebase and merge",
  ]);
  expect((methods[0] as HTMLInputElement).checked).toBe(true);
  expect(
    (
      within(dialog).getByRole("textbox", {
        name: "Commit title",
      }) as HTMLInputElement
    ).value,
  ).toBe(`Fix request handling (#${number})`);
  expect(api.mergePullRequest).not.toHaveBeenCalled();

  // A rebase makes no merge commit, so it has no title.
  fireEvent.click(
    within(dialog).getByRole("radio", { name: "Rebase and merge" }),
  );
  expect(
    within(dialog).queryByRole("textbox", { name: "Commit title" }),
  ).toBeNull();
  expect(within(dialog).getByText(/no merge commit/)).toBeTruthy();

  fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(api.mergePullRequest).not.toHaveBeenCalled();
});

it("merges at the head on screen with the chosen method and commit title, once confirmed", async () => {
  const id = await renderAuthorPage();

  const dialog = await openMerge();
  fireEvent.change(
    within(dialog).getByRole("textbox", { name: "Commit title" }),
    {
      target: { value: "Handle 410 (#7)" },
    },
  );
  fireEvent.click(within(dialog).getByRole("button", { name: "Merge" }));

  await waitFor(() => expect(toasts.show).toHaveBeenCalledWith("Merged"));
  expect(api.mergePullRequest).toHaveBeenCalledWith("github", "work", {
    repository: "acme/api",
    number,
    method: "squash",
    headSha: "one",
    commitTitle: "Handle 410 (#7)",
  });
  expect(api.mergePullRequest).toHaveBeenCalledTimes(1);
  expect(facts(id).state).toBe("merged");
  // The page now shows a merged pull request, and a sync says how.
  await waitFor(() =>
    expect(screen.queryByRole("button", { name: "Merge…" })).toBeNull(),
  );
  expect(api.syncCodeHostConnection).toHaveBeenCalledWith("github", "work");
});

it("keeps the method and commit title after a failed merge, and Retry sends the same merge", async () => {
  const id = await renderAuthorPage();
  vi.mocked(api.mergePullRequest).mockRejectedValueOnce(
    new Error("GitHub request failed (405): Pull Request is not mergeable."),
  );

  const dialog = await openMerge();
  fireEvent.click(
    within(dialog).getByRole("radio", { name: "Squash and merge" }),
  );
  fireEvent.change(
    within(dialog).getByRole("textbox", { name: "Commit title" }),
    {
      target: { value: "Handle 410" },
    },
  );
  fireEvent.click(within(dialog).getByRole("button", { name: "Merge" }));

  const alert = await within(dialog).findByRole("alert");
  expect(alert.textContent).toBe(
    "Couldn't merge: GitHub request failed (405): Pull Request is not mergeable.",
  );
  expect(
    (
      within(dialog).getByRole("textbox", {
        name: "Commit title",
      }) as HTMLInputElement
    ).value,
  ).toBe("Handle 410");
  expect(facts(id).state).toBe("open");

  fireEvent.click(within(dialog).getByRole("button", { name: "Retry" }));
  await waitFor(() => expect(toasts.show).toHaveBeenCalledWith("Merged"));
  const [first, second] = vi.mocked(api.mergePullRequest).mock.calls;
  expect(second).toEqual(first);
});

it("says a connection without Review pull requests can't merge, and where to turn it on", async () => {
  await renderAuthorPage();
  vi.mocked(api.mergePullRequest).mockRejectedValueOnce(
    new AppApiError("Review pull requests is off.", 403, "reviewPullRequests"),
  );

  const dialog = await openMerge();
  fireEvent.click(within(dialog).getByRole("button", { name: "Merge" }));

  expect((await within(dialog).findByRole("alert")).textContent).toContain(
    "Turn on Review pull requests for Work in Settings › Plugins",
  );
});

it("refuses to merge while a push came in after the head on screen", async () => {
  const id = await renderAuthorPage();
  // A sync sees a newer head than the page read.
  act(() => {
    sync({ id: `pr${number}`, number, headSha: "two" });
  });
  expect(facts(id).headSha).toBe("two");

  const button = await screen.findByRole("button", { name: "Merge…" });
  await waitFor(() => expect(button.hasAttribute("disabled")).toBe(false));
  fireEvent.click(button);
  const dialog = await screen.findByRole("dialog");
  expect(
    within(dialog).getByText(
      "1 new push since you opened this pull request. Refresh to review it before merging.",
    ),
  ).toBeTruthy();
  expect(
    within(dialog)
      .getByRole("button", { name: "Merge" })
      .hasAttribute("disabled"),
  ).toBe(true);
});

it("refuses to merge a draft, and offers only Azure DevOps's allowed merge types there", async () => {
  vi.mocked(api.readPullRequestConversation).mockResolvedValue(
    conversation(["merge"]),
  );
  await renderAuthorPage({ draft: true }, "azure_devops");

  const dialog = await openMerge();
  expect(
    within(dialog).getByText(
      "This pull request is a draft. Publish it to merge it.",
    ),
  ).toBeTruthy();
  expect(
    within(dialog)
      .getAllByRole("radio")
      .map((radio) => radio.closest("label")?.textContent),
  ).toEqual(["Merge (no fast forward)"]);
  expect(
    (
      within(dialog).getByRole("textbox", {
        name: "Commit title",
      }) as HTMLInputElement
    ).value,
  ).toBe(`Merged PR ${number}: Fix request handling`);
  expect(
    within(dialog)
      .getByRole("button", { name: "Merge" })
      .hasAttribute("disabled"),
  ).toBe(true);
});

it("reads the versions again after a refused merge, so a push since holds Merge back", async () => {
  await renderAuthorPage();
  vi.mocked(api.mergePullRequest).mockRejectedValueOnce(
    new Error(
      "The pull request has new commits since you read it. Refresh to review them before merging.",
    ),
  );
  vi.mocked(api.readPullRequestVersions).mockResolvedValue({
    versions: [
      { number: 1, headSha: "one", pushedAt: 1, commits: [] },
      { number: 2, headSha: "two", pushedAt: 2, commits: [] },
    ],
  });

  const dialog = await openMerge();
  fireEvent.click(within(dialog).getByRole("button", { name: "Merge" }));

  expect(
    await within(dialog).findByText(
      "1 new push since you opened this pull request. Refresh to review it before merging.",
    ),
  ).toBeTruthy();
  expect(
    within(dialog)
      .getByRole("button", { name: "Retry" })
      .hasAttribute("disabled"),
  ).toBe(true);
  expect(api.mergePullRequest).toHaveBeenCalledTimes(1);
});

it("holds Merge while Azure DevOps is still completing it, until a sync says how", async () => {
  vi.mocked(api.mergePullRequest).mockResolvedValue({});
  const id = await renderAuthorPage({}, "azure_devops");

  const dialog = await openMerge();
  fireEvent.click(within(dialog).getByRole("button", { name: "Merge" }));

  await waitFor(() =>
    expect(toasts.show).toHaveBeenCalledWith(
      "Azure DevOps is completing the merge",
    ),
  );
  expect(facts(id).state).toBe("open");
  const button = screen.getByRole("button", { name: "Merging…" });
  expect(button.hasAttribute("disabled")).toBe(true);

  // A sync that still finds it open lets the author try again.
  act(() => {
    sync({ id: `pr${number}`, number, updatedAt: 200 }, "azure_devops");
  });
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Merge…" }).hasAttribute("disabled"),
    ).toBe(false),
  );
});

it("sends nothing from an old toast's Retry once the draft state is what it asked for", async () => {
  await renderAuthorPage();
  vi.mocked(api.updatePullRequest).mockRejectedValueOnce(
    new Error("GitHub request failed (502)."),
  );

  fireEvent.click(screen.getByRole("button", { name: "Convert to draft" }));
  await waitFor(() => expect(toasts.action).toHaveBeenCalledTimes(1));
  // The user tries again from the button, and it lands.
  fireEvent.click(
    await screen.findByRole("button", { name: "Convert to draft" }),
  );
  await screen.findByRole("button", { name: "Ready for review" });

  act(() => toasts.action.mock.calls[0]![0].onAction());
  expect(api.updatePullRequest).toHaveBeenCalledTimes(2);
});
