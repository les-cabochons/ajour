import {
  DEFAULT_TRUNK_PATTERNS,
  isTrunk,
  shortBranch,
} from "@ajour/review-deck/stack.ts";
import type { LocalPullRequest } from "@/domain/pull-requests/pull-request-lifecycle";

/*
 * Stacks among the pull requests Deck lists (#788): a pull request is a
 * layer on another when it targets that one's branch, in the same
 * repository of the same connection. Review Deck's trunk patterns end a
 * stack; the graph is Ajour's own, built once per list in one pass, because
 * Review Deck's `stackFor` reads the whole list for each pull request.
 *
 * - Branch names compare exactly, `refs/heads/` aside: Git's are
 *   case-sensitive, and so are Azure Repos' unless a repository turns on
 *   case enforcement, which only stops new names that differ by case.
 * - A pull request from a fork, or from a head repository Ajour doesn't
 *   know, is never a lower layer: its branch isn't the base repository's
 *   branch of that name.
 * - When more than one open pull request comes from the branch a pull
 *   request targets, the edge is ambiguous and it gets no lower layer.
 * - Pull requests in a cycle, or above one, have no stack.
 * - Ajour has no trunk setting, so the usual trunk branches end a stack,
 *   and a stack needs two open layers: one pull request into a branch that
 *   isn't a trunk, such as `develop` on another name, is alone.
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
  /**
   * For each layer, whether the one below it moved since it was based on
   * it; `stale[index]` is this layer's warning.
   */
  stale: boolean[];
}

/** A layer's place, `index` of `size` from 1, and its stack, by its bottom layer. */
export interface DeckStackRow {
  index: number;
  size: number;
  stack: string;
}

const repositoryKey = (item: LocalPullRequest) =>
  JSON.stringify([
    item.pluginId,
    item.connectionId,
    item.facts.repository.toLowerCase(),
  ]);

/** Whether the pull request's head branch is known to be in its own repository. */
const headInRepository = (item: LocalPullRequest) =>
  !!item.facts.repositoryIdentity && !item.facts.repositoryIdentity.source;

function push<K, V>(map: Map<K, V[]>, key: K, value: V) {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

/**
 * The stacks among one repository's open pull requests: each one's layer
 * below, its layers above in number order, and the ones that can't stack.
 */
interface StackGraph {
  parent: Map<LocalPullRequest, LocalPullRequest>;
  children: Map<LocalPullRequest, LocalPullRequest[]>;
  /** In a cycle, or above one. */
  broken: Set<LocalPullRequest>;
}

function stackGraph(items: readonly LocalPullRequest[]): StackGraph {
  const heads = new Map<string, LocalPullRequest[]>();
  for (const item of items)
    if (headInRepository(item))
      push(heads, shortBranch(item.facts.headRef!), item);
  const parent = new Map<LocalPullRequest, LocalPullRequest>();
  const children = new Map<LocalPullRequest, LocalPullRequest[]>();
  for (const item of items) {
    const target = item.facts.baseRef!;
    if (isTrunk(target, TRUNKS)) continue;
    const from = heads
      .get(shortBranch(target))
      ?.filter((head) => head !== item);
    if (from?.length !== 1) continue;
    parent.set(item, from[0]!);
    push(children, from[0]!, item);
  }
  for (const list of children.values())
    list.sort((left, right) => left.facts.number - right.facts.number);
  // Each pull request has one layer below at most, so one walk down from
  // each, stopping at what an earlier walk saw, finds every cycle and what
  // sits above one.
  const broken = new Set<LocalPullRequest>();
  const done = new Set<LocalPullRequest>();
  for (const item of items) {
    const path = new Set<LocalPullRequest>();
    let at: LocalPullRequest | undefined = item;
    while (at && !done.has(at) && !path.has(at)) {
      path.add(at);
      at = parent.get(at);
    }
    const cut = !!at && (path.has(at) || broken.has(at));
    for (const visited of path) {
      done.add(visited);
      if (cut) broken.add(visited);
    }
  }
  return { parent, children, broken };
}

/** The open pull requests that may be layers, by repository. */
function byRepository(
  all: readonly LocalPullRequest[],
): Map<string, LocalPullRequest[]> {
  const repositories = new Map<string, LocalPullRequest[]>();
  for (const item of all) {
    const { headRef, baseRef, state } = item.facts;
    if (state === "open" && headRef && baseRef)
      push(repositories, repositoryKey(item), item);
  }
  return repositories;
}

/**
 * `item`'s stack, bottom to top: the layers below it, then the first layer
 * above each one where the stack forks. Undefined when it is alone or
 * can't stack.
 */
function layersOf(item: LocalPullRequest, graph: StackGraph) {
  if (graph.broken.has(item)) return undefined;
  const below: LocalPullRequest[] = [];
  for (let at = graph.parent.get(item); at; at = graph.parent.get(at))
    below.push(at);
  below.reverse();
  const above: LocalPullRequest[] = [];
  for (
    let at = graph.children.get(item)?.[0];
    at;
    at = graph.children.get(at)?.[0]
  )
    above.push(at);
  const layers = [...below, item, ...above];
  return layers.length < 2 ? undefined : { layers, index: below.length };
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
  const items = byRepository(all).get(repositoryKey(pullRequest));
  const self = items?.find((item) => item._id === pullRequest._id);
  if (!items || !self) return undefined;
  const position = layersOf(self, stackGraph(items));
  if (!position) return undefined;
  const { layers, index } = position;
  const below = layers[index - 1];
  const above = layers[index + 1];
  return {
    layers,
    index,
    base: shortBranch(layers[0]!.facts.baseRef!),
    ...(below ? { below } : {}),
    ...(above ? { above } : {}),
    stale: layers.map((item, at) => {
      const under = layers[at - 1];
      return !!under && isStale(item, under);
    }),
  };
}

/** Review Deck's extension hub on Azure DevOps, where its Restack is. */
const REVIEW_DECK_HUB = "Cabochonio.review-deck.review-hub";

/**
 * Where an Azure DevOps pull request restacks: Review Deck's hub. Undefined
 * on another code host, where Ajour offers no restack.
 */
export function restackUrl(pullRequest: LocalPullRequest): string | undefined {
  return pullRequest.pluginId === "azure_devops"
    ? reviewDeckUrl(pullRequest.facts.url)
    : undefined;
}

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

/**
 * Each layer's place among `all`, by its `_id`, for the list's "2/3": its
 * place in its own stack, as its page shows it. Linear in pull requests:
 * each one's depth and height are found once and reused.
 */
export function deckStackIndex(
  all: readonly LocalPullRequest[],
): Map<string, DeckStackRow> {
  const rows = new Map<string, DeckStackRow>();
  for (const [key, items] of byRepository(all)) {
    const graph = stackGraph(items);
    const depth = new Map<LocalPullRequest, number>();
    const bottom = new Map<LocalPullRequest, LocalPullRequest>();
    const height = new Map<LocalPullRequest, number>();
    const measure = (
      item: LocalPullRequest,
      next: (at: LocalPullRequest) => LocalPullRequest | undefined,
      known: Map<LocalPullRequest, number>,
      end?: Map<LocalPullRequest, LocalPullRequest>,
    ) => {
      const path: LocalPullRequest[] = [];
      let at: LocalPullRequest | undefined = item;
      while (at && !known.has(at)) {
        path.push(at);
        at = next(at);
      }
      let count = at ? known.get(at)! : -1;
      const last = at ? end?.get(at) : path.at(-1);
      for (const visited of path.reverse()) {
        known.set(visited, ++count);
        if (end && last) end.set(visited, last);
      }
      return known.get(item)!;
    };
    for (const item of items) {
      if (graph.broken.has(item)) continue;
      const index = measure(item, (at) => graph.parent.get(at), depth, bottom);
      const size =
        index + 1 + measure(item, (at) => graph.children.get(at)?.[0], height);
      if (size < 2) continue;
      rows.set(item._id, {
        index: index + 1,
        size,
        stack: `${key}#${bottom.get(item)!.facts.number}`,
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
