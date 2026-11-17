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

/** The item page asks for the threads its project's folders hold that name its key. */
export const handoffThreadsRouteSchema = z
  .object({ projectId: id, key: z.string().max(500) })
  .strict();
export const handoffThreadsResultSchema = z
  .object({ offers: z.array(handoffThreadOfferSchema).max(1000) })
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

/** "Not this one": the thread is never offered again, for any item. */
export const handoffThreadDismissalSchema = z
  .object({ pluginId: id, toolId: id, threadId: id })
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
 * Whether a thread's title names an item's key in brackets. Only the exact
 * key counts, case and all, as the item shows it: `[pay-12]`, `[PAY-123]`
 * and `[ PAY-12 ]` don't name `PAY-12`. An item without a key has none to
 * name.
 */
export function threadTitleNamesKey(title: string, key: string): boolean {
  return key !== "" && threadTitleKeys(title).includes(key);
}

const sameThread = (
  left: { pluginId: string; toolId: string; threadId: string },
  right: { pluginId: string; toolId: string; threadId: string },
) =>
  left.pluginId === right.pluginId &&
  left.toolId === right.toolId &&
  left.threadId === right.threadId;

/**
 * The listed threads to offer an item: those whose title names its key,
 * not linked to any handoff (a thread id means something only on its own
 * tool and connection) and not dismissed, newest first. An undated thread
 * comes after the dated ones.
 */
export function selectThreadOffers(input: {
  key: string;
  threads: readonly ListedHandoffThread[];
  handoffs: ReadonlyArray<
    Pick<Handoff, "pluginId" | "toolId" | "threadId" | "connectionId">
  >;
  dismissals: readonly HandoffThreadDismissal[];
}): HandoffThreadOffer[] {
  const offers = input.threads.filter(
    (thread) =>
      threadTitleNamesKey(thread.title, input.key) &&
      !input.handoffs.some(
        (handoff) =>
          sameThread(handoff, thread) &&
          (handoff.connectionId ?? null) === (thread.connectionId ?? null),
      ) &&
      !input.dismissals.some((dismissal) => sameThread(dismissal, thread)),
  );
  return offers
    .map((thread, index) => ({ thread, index }))
    .sort(
      (left, right) =>
        (right.thread.updatedAt ?? -Infinity) -
          (left.thread.updatedAt ?? -Infinity) || left.index - right.index,
    )
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
