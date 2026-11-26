import {
  DEFAULT_TRUNK_PATTERNS,
  isTrunk,
  shortBranch,
  stackFor,
  stackIndex,
  type StackPr,
} from "@ajour/review-deck/stack.ts";
import type { LocalPullRequest } from "@/domain/pull-requests/pull-request-lifecycle";

/*
 * Stacks among the pull requests Deck lists (#788), found by Review Deck's
 * stack code: a pull request is a layer on another when it targets that
 * one's branch, in the same repository of the same connection. Ajour has no
 * trunk setting, so the usual trunk branches end a stack, and a stack needs
 * two open layers: one pull request into a branch that isn't a trunk, such
 * as `develop` on another name, is alone.
 */

/** Where stacks end. Review Deck's defaults, and the other usual names. */
const TRUNKS = [
  ...DEFAULT_TRUNK_PATTERNS,
  "develop",
  "development",
  "dev",
  "trunk",
  "release/**",
];

/** A pull request's place in its stack. */
export interface DeckStackPosition {
  /** Bottom to top; includes the pull request. */
  layers: LocalPullRequest[];
  /** From 0, the bottom layer's. */
  index: number;
  /** The branch the bottom layer merges into, such as `main`. */
  base: string;
  /** The layer below, which merges first. */
  below?: LocalPullRequest;
  /** The layer above, the next one to review bottom-up. */
  above?: LocalPullRequest;
  /** The layer below moved since this one was based on it. */
  staleBase: boolean;
  /** For each layer, whether the one below it moved since it was based on it. */
  stale: boolean[];
}

/** A layer's place, `index` of `size` from 1, and its stack, by its bottom layer. */
export interface DeckStackRow {
  index: number;
  size: number;
  stack: string;
}

type Layer = StackPr & { item: LocalPullRequest };

const repositoryKey = (item: LocalPullRequest) =>
  JSON.stringify([
    item.pluginId,
    item.connectionId,
    item.facts.repository.toLowerCase(),
  ]);
const branchKey = (ref: string) => shortBranch(ref).toLowerCase();

/**
 * The open pull requests that may be layers, by repository. One into a trunk
 * with nothing on top of it never is, so a long list of lone pull requests
 * costs one pass, and Review Deck's code, which reads the whole list for
 * each stack, only sees the few that may stack.
 */
function candidates(all: readonly LocalPullRequest[]): Map<string, Layer[]> {
  const repositories = new Map<string, Layer[]>();
  for (const item of all) {
    const { headRef, baseRef, state, number } = item.facts;
    if (state !== "open" || !headRef || !baseRef) continue;
    const key = repositoryKey(item);
    const layer: Layer = {
      id: number,
      repository: { id: key },
      sourceBranch: headRef,
      targetBranch: baseRef,
      status: "active",
      item,
    };
    const list = repositories.get(key);
    if (list) list.push(layer);
    else repositories.set(key, [layer]);
  }
  for (const [key, layers] of repositories) {
    const targets = new Set(
      layers.map((layer) => branchKey(layer.targetBranch)),
    );
    const stackable = layers.filter(
      (layer) =>
        !isTrunk(layer.targetBranch, TRUNKS) ||
        targets.has(branchKey(layer.sourceBranch)),
    );
    if (stackable.length < 2) repositories.delete(key);
    else repositories.set(key, stackable);
  }
  return repositories;
}

/** Whether `layer` was based on an older head of `below` than its current one. */
function isStale(layer: LocalPullRequest, below: LocalPullRequest) {
  const base = layer.facts.baseSha;
  const head = below.facts.headSha;
  return (
    !!base && head !== "unknown" && base.toLowerCase() !== head.toLowerCase()
  );
}

/** The stack `pullRequest` is a layer of, among `all`, or undefined when it's alone. */
export function deckStackOf(
  pullRequest: LocalPullRequest,
  all: readonly LocalPullRequest[],
): DeckStackPosition | undefined {
  const layers = candidates(all).get(repositoryKey(pullRequest));
  const self = layers?.find((layer) => layer.item._id === pullRequest._id);
  if (!layers || !self) return undefined;
  const position = stackFor(self, layers, TRUNKS);
  if (!position || position.layers.length < 2) return undefined;
  const items = position.layers.map((layer) => layer.item);
  const index = items.findIndex((item) => item._id === pullRequest._id);
  const below = items[index - 1];
  const above = items[index + 1];
  return {
    layers: items,
    index,
    base: position.base.branch,
    ...(below ? { below } : {}),
    ...(above ? { above } : {}),
    staleBase: !!below && isStale(pullRequest, below),
    stale: items.map((item, at) => {
      const under = items[at - 1];
      return !!under && isStale(item, under);
    }),
  };
}

/** Review Deck's extension hub on Azure DevOps, where its Restack is. */
const REVIEW_DECK_HUB = "Cabochonio.review-deck.review-hub";

/**
 * The pull request in Review Deck's hub on Azure DevOps, read from its page
 * on the code host (`…/{project}/_git/{repository}/pullrequest/{number}`),
 * so an on-premises server keeps its own address. Undefined for a page in
 * another shape.
 */
export function reviewDeckUrl(pageUrl: string): string | undefined {
  let url: URL;
  try {
    url = new URL(pageUrl);
  } catch {
    return undefined;
  }
  const match = /^(.*)\/_git\/([^/]+)\/pullrequest\/(\d+)\/?$/i.exec(
    url.pathname,
  );
  if (!match) return undefined;
  const [, project = "", repository = "", number = ""] = match;
  const query = new URLSearchParams({
    pr: number,
    repo: decodeURIComponent(repository),
  });
  return `${url.origin}${project}/_apps/hub/${REVIEW_DECK_HUB}?${query}`;
}

/** Each layer's place among `all`, by its `_id`, for the list's "2/3". */
export function deckStackIndex(
  all: readonly LocalPullRequest[],
): Map<string, DeckStackRow> {
  const rows = new Map<string, DeckStackRow>();
  for (const [key, layers] of candidates(all)) {
    const byNumber = new Map(layers.map((layer) => [layer.id, layer.item]));
    for (const [number, place] of stackIndex(layers, TRUNKS)) {
      const item = byNumber.get(number);
      if (!item || place.size < 2) continue;
      rows.set(item._id, {
        index: place.index,
        size: place.size,
        stack: `${key}#${place.bottomId}`,
      });
    }
  }
  return rows;
}

/**
 * `items` in their order, except that a stack's layers among them follow
 * each other, bottom first, where the first of them shows.
 */
export function groupByStack(
  items: readonly LocalPullRequest[],
  index: ReadonlyMap<string, DeckStackRow>,
): LocalPullRequest[] {
  const stacks = new Map<string, LocalPullRequest[]>();
  for (const item of items) {
    const row = index.get(item._id);
    if (!row) continue;
    const layers = stacks.get(row.stack);
    if (layers) layers.push(item);
    else stacks.set(row.stack, [item]);
  }
  const placed = new Set<string>();
  const out: LocalPullRequest[] = [];
  for (const item of items) {
    const row = index.get(item._id);
    if (!row) {
      out.push(item);
      continue;
    }
    if (placed.has(row.stack)) continue;
    placed.add(row.stack);
    const layers = stacks.get(row.stack) ?? [item];
    out.push(
      ...[...layers].sort(
        (left, right) =>
          (index.get(left._id)?.index ?? 0) -
          (index.get(right._id)?.index ?? 0),
      ),
    );
  }
  return out;
}
