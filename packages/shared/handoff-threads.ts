import { z } from "zod";
import type { Handoff } from "./handoffs.ts";
import { listedThreadSchema } from "./handoffs.ts";

/**
 * Threads a tool lists, offered for linking to the backlog item whose key
 * their title names in brackets, as the thread-naming instructions ask
 * (`[PAY-12] Fix login redirect`). See "Hand off to a coding tool" in
 * docs/agents/ux-spec.md.
 */

const id = z.string().min(1).max(200);

/** The most offers one item page receives, newest first. */
export const MAX_THREAD_OFFERS = 1000;
/**
 * The keys an item answers to: its source's own id and the key it shows,
 * such as `acme/api#12` and `12` for a GitHub issue.
 */
export const MAX_ITEM_KEYS = 4;

/** A thread one of a plugin's tools listed in one repository folder. */
export type ListedHandoffThread = z.infer<typeof listedThreadSchema> & {
  pluginId: string;
  toolId: string;
  folderId: string;
  /** The connection the tool listed it through, for a tool that uses one. */
  connectionId?: string;
};

/** What the item page offers to link: the thread's tool, folder and title. */
export const handoffThreadOfferSchema = z
  .object({
    pluginId: id,
    toolId: id,
    connectionId: id.optional(),
    folderId: id,
    threadId: id,
    title: z.string().min(1).max(500),
    updatedAt: z.number().finite().optional(),
  })
  .strict();
export type HandoffThreadOffer = z.infer<typeof handoffThreadOfferSchema>;

/**
 * The item page asks for the threads its project's folders hold that name
 * one of the item's keys, leaving out those dismissed for the item.
 */
export const handoffThreadsRouteSchema = z
  .object({
    projectId: id,
    workItemId: id,
    keys: z.array(z.string().max(500)).max(MAX_ITEM_KEYS),
  })
  .strict();
export const handoffThreadsResultSchema = z
  .object({ offers: z.array(handoffThreadOfferSchema).max(MAX_THREAD_OFFERS) })
  .strict();

/** Link a listed thread to an item, as a new handoff. */
export const handoffAdoptRouteSchema = z
  .object({
    pluginId: id,
    toolId: id,
    connectionId: id.optional(),
    folderId: id,
    threadId: id,
    projectId: id,
    workItemId: id,
  })
  .strict();
export type HandoffAdoptRoute = z.infer<typeof handoffAdoptRouteSchema>;

/**
 * "Not this one": the thread, on its tool and connection, is never offered
 * to that item again. Other items its title names still offer it.
 */
export const handoffThreadDismissalSchema = z
  .object({
    pluginId: id,
    toolId: id,
    connectionId: id.optional(),
    threadId: id,
    workItemId: id,
  })
  .strict();
export type HandoffThreadDismissal = z.infer<
  typeof handoffThreadDismissalSchema
>;

const TOKEN = /\[([^[\]\r\n]+)\]/g;

/** The bracketed tokens of a thread's title, in order: `[PAY-12]` gives `PAY-12`. */
export function threadTitleKeys(title: string): string[] {
  return [...title.matchAll(TOKEN)].map((match) => match[1]!);
}

/**
 * Whether a thread's title names one of an item's keys in brackets. Only an
 * exact key counts, case and all: `[pay-12]`, `[PAY-123]` and `[ PAY-12 ]`
 * don't name `PAY-12`. A `#` before a number is how people write an issue
 * number, so `[#12]` names `12` as `[12]` does. An empty key names nothing.
 */
export function threadTitleNamesKey(
  title: string,
  keys: readonly string[],
): boolean {
  const named = keys.filter((key) => key !== "");
  if (!named.length) return false;
  return threadTitleKeys(title).some((token) => {
    const number = /^#(\d+)$/.exec(token)?.[1];
    return named.includes(number ?? token);
  });
}

type ThreadIdentity = {
  pluginId: string;
  toolId: string;
  threadId: string;
  connectionId?: string;
};

/** A thread id means something only on its own tool and connection. */
export const sameThread = (left: ThreadIdentity, right: ThreadIdentity) =>
  left.pluginId === right.pluginId &&
  left.toolId === right.toolId &&
  left.threadId === right.threadId &&
  (left.connectionId ?? null) === (right.connectionId ?? null);

/** Two dismissals of the same thread for the same item. */
export const sameDismissal = (
  left: HandoffThreadDismissal,
  right: HandoffThreadDismissal,
) => sameThread(left, right) && left.workItemId === right.workItemId;

/**
 * The listed threads to offer an item: those whose title names one of its
 * keys, not linked to any handoff and not dismissed for this item, once
 * each (a tool may list a thread in several folders), newest first and at
 * most `MAX_THREAD_OFFERS`. An undated thread comes after the dated ones.
 *
 * Two items of a project can show the same key, such as `12` for an issue
 * of each of two GitHub repositories: a thread titled `[12]` is offered on
 * both, and linking it to one stops offering it on the other.
 */
export function selectThreadOffers(input: {
  keys: readonly string[];
  workItemId: string;
  threads: readonly ListedHandoffThread[];
  handoffs: ReadonlyArray<
    Pick<Handoff, "pluginId" | "toolId" | "threadId" | "connectionId">
  >;
  dismissals: readonly HandoffThreadDismissal[];
}): HandoffThreadOffer[] {
  const offers: ListedHandoffThread[] = [];
  for (const thread of input.threads) {
    if (
      threadTitleNamesKey(thread.title, input.keys) &&
      !offers.some((offer) => sameThread(offer, thread)) &&
      !input.handoffs.some((handoff) => sameThread(handoff, thread)) &&
      !input.dismissals.some(
        (dismissal) =>
          dismissal.workItemId === input.workItemId &&
          sameThread(dismissal, thread),
      )
    )
      offers.push(thread);
  }
  return offers
    .map((thread, index) => ({ thread, index }))
    .sort(
      (left, right) =>
        (right.thread.updatedAt ?? -Infinity) -
          (left.thread.updatedAt ?? -Infinity) || left.index - right.index,
    )
    .slice(0, MAX_THREAD_OFFERS)
    .map(({ thread }) => ({
      pluginId: thread.pluginId,
      toolId: thread.toolId,
      ...(thread.connectionId ? { connectionId: thread.connectionId } : {}),
      folderId: thread.folderId,
      threadId: thread.threadId,
      title: thread.title,
      ...(thread.updatedAt !== undefined
        ? { updatedAt: thread.updatedAt }
        : {}),
    }));
}
