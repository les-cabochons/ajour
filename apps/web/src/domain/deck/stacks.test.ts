import { describe, expect, it } from "vitest";
import type { CodeHostPullRequestFacts } from "@ajour/shared";
import type { LocalPullRequest } from "@/domain/pull-requests/pull-request-lifecycle";
import { pullRequestFacts } from "../../../tests/fixtures/pull-requests";
import {
  deckStackIndex,
  deckStackOf,
  groupByStack,
  restackUrl,
  reviewDeckUrl,
} from "./stacks";

/** A synced pull request from `head` into `base`, numbered `number`. */
const layer = (
  number: number,
  head: string | undefined,
  base: string | undefined,
  facts: Partial<CodeHostPullRequestFacts> = {},
  connectionId = "work",
): LocalPullRequest => ({
  _id: `${connectionId}:${facts.repository ?? "acme/api"}:${number}`,
  pluginId: "github",
  pluginName: "GitHub",
  connectionId,
  connectionLabel: "Work",
  viewerLogin: "alex",
  facts: {
    ...pullRequestFacts,
    id: `pr${number}`,
    number,
    title: `Layer ${number}`,
    headSha: `head-${number}`,
    repositoryIdentity: { cloneUrls: ["https://github.com/acme/api.git"] },
    ...(head ? { headRef: head } : {}),
    ...(base ? { baseRef: base } : {}),
    ...facts,
  },
  status: "active",
  activeAt: 0,
  missingFromSync: false,
});

const staleBase = (position: { stale: boolean[]; index: number }) =>
  position.stale[position.index];

const numbers = (items: readonly LocalPullRequest[]) =>
  items.map((item) => item.facts.number);

describe("a pull request's place in its stack", () => {
  const bottom = layer(479, "rate-limits", "main");
  const middle = layer(482, "per-route", "rate-limits", {
    baseSha: "head-479",
  });
  const top = layer(485, "per-user", "per-route", { baseSha: "head-482" });
  const alone = layer(12, "docs", "main");
  const all = [top, alone, middle, bottom];

  it("runs bottom to top from the branch the bottom layer merges into", () => {
    const position = deckStackOf(middle, all)!;
    expect(position.base).toBe("main");
    expect(numbers(position.layers)).toEqual([479, 482, 485]);
    expect(position.index).toBe(1);
    expect(position.below?.facts.number).toBe(479);
    expect(position.above?.facts.number).toBe(485);
  });

  it("merges after the layer below, and the bottom layer after nothing", () => {
    expect(deckStackOf(middle, all)!.below?.facts.number).toBe(479);
    expect(deckStackOf(top, all)!.below?.facts.number).toBe(482);
    expect(deckStackOf(bottom, all)!.below).toBeUndefined();
    expect(deckStackOf(top, all)!.above).toBeUndefined();
  });

  it("is no stack for a lone pull request into a trunk branch", () => {
    expect(deckStackOf(alone, all)).toBeUndefined();
  });

  it("needs two open layers: one pull request into another branch is alone", () => {
    const intoDevelop = layer(30, "feature", "release-candidate");
    expect(deckStackOf(intoDevelop, [intoDevelop])).toBeUndefined();
  });

  it("stops at the usual trunk branches, so promotions don't stack", () => {
    const promotion = layer(40, "develop", "main");
    const feature = layer(41, "search", "develop");
    expect(deckStackOf(feature, [promotion, feature])).toBeUndefined();
    expect(deckStackOf(promotion, [promotion, feature])).toBeUndefined();
  });

  it("leaves out pull requests synced before their branches were", () => {
    const old = layer(50, undefined, undefined);
    const onTop = layer(51, "on-top", "rate-limits");
    expect(deckStackOf(old, [old, bottom])).toBeUndefined();
    expect(numbers(deckStackOf(onTop, [old, bottom, onTop])!.layers)).toEqual([
      479, 51,
    ]);
  });

  it("only counts open pull requests, of the same repository and connection", () => {
    const merged = layer(60, "merged", "main", { state: "merged" });
    const onMerged = layer(61, "on-merged", "merged");
    expect(deckStackOf(onMerged, [merged, onMerged])).toBeUndefined();
    const otherRepository = layer(482, "per-route", "rate-limits", {
      repository: "acme/web",
    });
    expect(deckStackOf(otherRepository, [bottom, otherRepository])).toBe(
      undefined,
    );
    const otherConnection = layer(
      482,
      "per-route",
      "rate-limits",
      {},
      "personal",
    );
    expect(deckStackOf(otherConnection, [bottom, otherConnection])).toBe(
      undefined,
    );
  });

  it("matches branches as the code host names them, refs/heads/ aside", () => {
    const azureBottom = layer(7, "refs/heads/users/alex/base", "main");
    const azureTop = layer(8, "users/alex/top", "refs/heads/users/alex/base");
    expect(
      numbers(deckStackOf(azureTop, [azureBottom, azureTop])!.layers),
    ).toEqual([7, 8]);
  });

  it("keeps the case of branch names, on GitHub and Azure DevOps alike", () => {
    for (const pluginId of ["github", "azure_devops"]) {
      const bottom = { ...layer(7, "Feature", "main"), pluginId };
      const top = { ...layer(8, "top", "feature"), pluginId };
      expect(deckStackOf(top, [bottom, top])).toBeUndefined();
      expect(deckStackIndex([bottom, top]).size).toBe(0);
    }
  });

  it("follows the first layer above where the stack forks", () => {
    const other = layer(483, "per-team", "rate-limits");
    const position = deckStackOf(bottom, [bottom, middle, other])!;
    expect(numbers(position.layers)).toEqual([479, 482]);
    expect(
      numbers(deckStackOf(other, [bottom, middle, other])!.layers),
    ).toEqual([479, 483]);
  });
});

describe("branches of forks", () => {
  const fromFork = {
    cloneUrls: ["https://github.com/acme/api.git"],
    source: {
      repository: "alice/api",
      cloneUrls: ["https://github.com/alice/api.git"],
    },
  };

  it("never takes a fork's branch for the base repository's branch of that name", () => {
    const forked = layer(70, "feature", "main", {
      repositoryIdentity: fromFork,
    });
    const onFeature = layer(71, "top", "feature");
    expect(deckStackOf(onFeature, [forked, onFeature])).toBeUndefined();
    expect(deckStackOf(forked, [forked, onFeature])).toBeUndefined();
    expect(deckStackIndex([forked, onFeature]).size).toBe(0);
  });

  it("stacks a fork's pull request on the base repository's branch", () => {
    const bottom = layer(72, "feature", "main");
    const forkedTop = layer(73, "top", "feature", {
      repositoryIdentity: fromFork,
    });
    expect(
      numbers(deckStackOf(forkedTop, [bottom, forkedTop])!.layers),
    ).toEqual([72, 73]);
  });

  it("makes no layer of a pull request whose head repository isn't known", () => {
    const unknown = layer(74, "feature", "main");
    delete (unknown.facts as Partial<CodeHostPullRequestFacts>)
      .repositoryIdentity;
    const onFeature = layer(75, "top", "feature");
    expect(deckStackOf(onFeature, [unknown, onFeature])).toBeUndefined();
  });
});

describe("pull requests that can't stack", () => {
  it("shows no stack for a cycle, nor for a layer above one", () => {
    const one = layer(80, "a", "b");
    const two = layer(81, "b", "a");
    const above = layer(82, "c", "a");
    const all = [one, two, above];
    for (const item of all) expect(deckStackOf(item, all)).toBeUndefined();
    expect(deckStackIndex(all).size).toBe(0);
    expect(numbers(groupByStack(all, deckStackIndex(all)))).toEqual([
      80, 81, 82,
    ]);
  });

  it("gives no lower layer when two open pull requests come from the branch", () => {
    const intoMain = layer(1, "a", "main");
    const intoRelease = layer(2, "a", "release/x");
    const onA = layer(3, "b", "a");
    for (const all of [
      [intoMain, intoRelease, onA],
      [onA, intoRelease, intoMain],
    ]) {
      expect(deckStackOf(onA, all)).toBeUndefined();
      expect(deckStackOf(intoMain, all)).toBeUndefined();
      expect(deckStackOf(intoRelease, all)).toBeUndefined();
      expect(deckStackIndex(all).size).toBe(0);
    }
  });
});

describe("the stale-base check", () => {
  const bottom = layer(479, "rate-limits", "main");

  it("warns when the layer below moved since this one was based on it", () => {
    const onOld = layer(482, "per-route", "rate-limits", {
      baseSha: "an-older-head",
    });
    expect(staleBase(deckStackOf(onOld, [bottom, onOld])!)).toBe(true);
    // Each layer's, for the full stack.
    expect(deckStackOf(bottom, [bottom, onOld])!.stale).toEqual([false, true]);
  });

  it("stays quiet when this layer is based on the head below, in any case", () => {
    const onHead = layer(482, "per-route", "rate-limits", {
      baseSha: "HEAD-479",
    });
    expect(staleBase(deckStackOf(onHead, [bottom, onHead])!)).toBe(false);
  });

  it("stays quiet without a base commit, and for the bottom layer", () => {
    const unknown = layer(482, "per-route", "rate-limits");
    expect(staleBase(deckStackOf(unknown, [bottom, unknown])!)).toBe(false);
    const onTop = layer(482, "per-route", "rate-limits", {
      baseSha: "elsewhere",
    });
    const movedTrunk = layer(479, "rate-limits", "main", {
      baseSha: "an-old-main",
    });
    expect(staleBase(deckStackOf(movedTrunk, [movedTrunk, onTop])!)).toBe(
      false,
    );
  });
});

describe("the list's stacks", () => {
  const bottom = layer(479, "rate-limits", "main");
  const middle = layer(482, "per-route", "rate-limits");
  const top = layer(485, "per-user", "per-route");
  const alone = layer(12, "docs", "main");
  const other = layer(20, "search", "main");
  const onOther = layer(21, "search-ui", "search");

  it("gives each layer its place, as 2/3", () => {
    const index = deckStackIndex([top, alone, middle, bottom]);
    expect(index.get(middle._id)).toMatchObject({ index: 2, size: 3 });
    expect(index.get(top._id)).toMatchObject({ index: 3, size: 3 });
    expect(index.has(alone._id)).toBe(false);
  });

  it("keeps a stack's layers together, bottom first, where its first layer shows", () => {
    const items = [top, alone, onOther, middle, other, bottom];
    const index = deckStackIndex(items);
    expect(numbers(groupByStack(items, index))).toEqual([
      479, 482, 485, 12, 20, 21,
    ]);
  });

  it("groups only the layers in the same group of the list", () => {
    const index = deckStackIndex([bottom, middle, top]);
    expect(numbers(groupByStack([top, alone, bottom], index))).toEqual([
      479, 485, 12,
    ]);
  });

  // A store write costs about 75 ms in production (code-standards.md); the
  // list's stacks are a small part of one, even at thousands of rows.
  const BUDGET_MS = 40;
  const timed = (all: LocalPullRequest[]) => {
    deckStackIndex(all);
    const started = performance.now();
    const index = deckStackIndex(all);
    return { index, elapsed: performance.now() - started };
  };

  it("stays linear on a long list of lone pull requests", () => {
    const many = Array.from({ length: 5_000 }, (_, index) =>
      layer(1_000 + index, `branch-${index}`, "main"),
    );
    const { index, elapsed } = timed([...many, bottom, middle]);
    expect(index.size).toBe(2);
    expect(elapsed).toBeLessThan(BUDGET_MS);
  });

  it("stays linear when every pull request targets a branch that isn't a trunk", () => {
    const many = Array.from({ length: 5_000 }, (_, index) =>
      layer(1_000 + index, `branch-${index}`, `target-${index}`),
    );
    const { index, elapsed } = timed(many);
    expect(index.size).toBe(0);
    expect(elapsed).toBeLessThan(BUDGET_MS);
  });

  it("stays linear on thousands of real stacks", () => {
    const many = Array.from({ length: 2_500 }, (_, index) => [
      layer(10_000 + index, `base-${index}`, "main"),
      layer(20_000 + index, `top-${index}`, `base-${index}`),
    ]).flat();
    const { index, elapsed } = timed(many);
    expect(index.size).toBe(5_000);
    expect(index.get(many[1]!._id)).toMatchObject({ index: 2, size: 2 });
    expect(elapsed).toBeLessThan(BUDGET_MS);
  });
});

describe("Restack in Review Deck", () => {
  it("opens the pull request in Review Deck's hub, on the same server", () => {
    expect(
      reviewDeckUrl(
        "https://dev.azure.com/acme/Payments/_git/api/pullrequest/482",
      ),
    ).toBe(
      "https://dev.azure.com/acme/Payments/_apps/hub/Cabochonio.review-deck.review-hub?pr=482&repo=api",
    );
    expect(
      reviewDeckUrl(
        "https://ado.example.com/tfs/Main/My%20Project/_git/My%20Repo/pullrequest/7",
      ),
    ).toBe(
      "https://ado.example.com/tfs/Main/My%20Project/_apps/hub/Cabochonio.review-deck.review-hub?pr=7&repo=My+Repo",
    );
  });

  it("is offered on Azure DevOps only", () => {
    const azure = {
      ...layer(482, "per-route", "rate-limits", {
        url: "https://dev.azure.com/acme/Payments/_git/api/pullrequest/482",
      }),
      pluginId: "azure_devops",
    };
    expect(restackUrl(azure)).toContain("/_apps/hub/");
    expect(restackUrl(layer(482, "per-route", "rate-limits"))).toBeUndefined();
  });

  it("has no link for a page in another shape", () => {
    expect(reviewDeckUrl("https://github.com/acme/api/pull/482")).toBe(
      undefined,
    );
    expect(reviewDeckUrl("not a url")).toBeUndefined();
  });
});
