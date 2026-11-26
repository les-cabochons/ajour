import { describe, expect, it } from "vitest";
import type { CodeHostPullRequestFacts } from "@ajour/shared";
import type { LocalPullRequest } from "@/domain/pull-requests/pull-request-lifecycle";
import { pullRequestFacts } from "../../../tests/fixtures/pull-requests";
import {
  deckStackIndex,
  deckStackOf,
  groupByStack,
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
    ...(head ? { headRef: head } : {}),
    ...(base ? { baseRef: base } : {}),
    ...facts,
  },
  status: "active",
  activeAt: 0,
  missingFromSync: false,
});

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

  it("matches branches as the code host names them, refs/heads/ and case aside", () => {
    const azureBottom = layer(7, "refs/heads/Users/Alex/Base", "main");
    const azureTop = layer(8, "users/alex/top", "users/alex/base");
    expect(
      numbers(deckStackOf(azureTop, [azureBottom, azureTop])!.layers),
    ).toEqual([7, 8]);
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

describe("the stale-base check", () => {
  const bottom = layer(479, "rate-limits", "main");

  it("warns when the layer below moved since this one was based on it", () => {
    const onOld = layer(482, "per-route", "rate-limits", {
      baseSha: "an-older-head",
    });
    expect(deckStackOf(onOld, [bottom, onOld])!.staleBase).toBe(true);
    // Each layer's, for the full stack.
    expect(deckStackOf(bottom, [bottom, onOld])!.stale).toEqual([false, true]);
  });

  it("stays quiet when this layer is based on the head below, in any case", () => {
    const onHead = layer(482, "per-route", "rate-limits", {
      baseSha: "HEAD-479",
    });
    expect(deckStackOf(onHead, [bottom, onHead])!.staleBase).toBe(false);
  });

  it("stays quiet without a base commit, and for the bottom layer", () => {
    const unknown = layer(482, "per-route", "rate-limits");
    expect(deckStackOf(unknown, [bottom, unknown])!.staleBase).toBe(false);
    const onTop = layer(482, "per-route", "rate-limits", {
      baseSha: "elsewhere",
    });
    const movedTrunk = layer(479, "rate-limits", "main", {
      baseSha: "an-old-main",
    });
    expect(deckStackOf(movedTrunk, [movedTrunk, onTop])!.staleBase).toBe(false);
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

  it("stays linear on a long list of lone pull requests", () => {
    const many = Array.from({ length: 5_000 }, (_, index) =>
      layer(1_000 + index, `branch-${index}`, "main"),
    );
    const started = performance.now();
    const index = deckStackIndex([...many, bottom, middle]);
    expect(index.size).toBe(2);
    expect(performance.now() - started).toBeLessThan(200);
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

  it("has no link for a page in another shape", () => {
    expect(reviewDeckUrl("https://github.com/acme/api/pull/482")).toBe(
      undefined,
    );
    expect(reviewDeckUrl("not a url")).toBeUndefined();
  });
});
