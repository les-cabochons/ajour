import { useEffect, useState } from "react";
import {
  sameThread,
  type HandoffThreadOffer,
} from "@ajour/shared/handoff-threads";
import type { RepositoryFolder } from "@ajour/shared/repository-folders";
import type { ListedWorktree } from "@ajour/shared/worktrees";
import {
  findHandoffThreads,
  listRepositoryFolders,
  listWorktreeStatuses,
  refreshHandoffs,
} from "@/lib/app-api";
import { setHandoffs, useHandoffs } from "@/lib/handoffs";
import { hasWorktrees } from "@/lib/worktrees";
import { useAllHandoffTools, useHandoffTools } from "@/lib/handoff-tools";
import { isHandoffFollowed } from "@/domain/handoffs/handoffs";
import {
  dismissHandoffThreadOffer,
  linkHandoffThread,
} from "@/features/backlog/handoff-workflow";

const NO_OFFERS: readonly HandoffThreadOffer[] = [];

const NO_KEYS: readonly string[] = [];

/**
 * The item page's handoffs and tools. Opening the item asks each live thread
 * whose tool follows state (`isHandoffFollowed`) for its state once, so the card is current without waiting for the API's
 * next tick, and asks once for the threads its project's folders hold whose
 * title names one of the item's keys (`getHandoffItemKeys`), to offer
 * linking them, from the tools that are on. A tool turned off still names
 * and follows the threads it started (`tools`). The card shows while the
 * item has threads, a worktree, or a tool that is on could take one, so the
 * web build and items without a tool keep their cards as they were.
 *
 * In the desktop app it also reads the item's worktrees with their status
 * (#862), which git gives as it is now: when the item opens, when a thread
 * starts in another worktree or leaves one, and after `reloadWorktrees`,
 * which a delete or a forget calls. They are asked for by item alone, so a
 * worktree made before the item moved to another project still shows. The
 * project's repository folders are read with them, to name the main folder
 * of the other threads, and only for an item that has a worktree, Ajour's
 * or one a tool made itself (#863). `worktrees` is undefined until the first
 * answer, and where a read failed: the card then shows no worktree line.
 */
export function useItemHandoffs(
  itemId: string,
  projectId?: string,
  keys: readonly string[] = NO_KEYS,
) {
  const records = useHandoffs(itemId);
  const enabled = useHandoffTools(projectId);
  const tools = useAllHandoffTools();
  // Followed by its tool now, so a Started thread whose tool follows state
  // again is asked too.
  const live = records
    .filter(
      (record) =>
        !record.paused &&
        !["done", "gone"].includes(record.state) &&
        isHandoffFollowed(
          record,
          tools.find(
            (tool) =>
              tool.pluginId === record.pluginId &&
              tool.toolId === record.toolId,
          ),
        ),
    )
    .map((record) => record.id)
    .join(" ");
  useEffect(() => {
    if (!live) return;
    for (const id of live.split(" "))
      void refreshHandoffs(id)
        .then((result) => setHandoffs(result.handoffs))
        .catch(() => undefined);
    // Once per item: a record's state changing must not refresh it again.
  }, [itemId, live === ""]);

  // Kept with the item they were found for, so another item never shows them.
  const [found, setFound] = useState<{
    itemId: string;
    offers: readonly HandoffThreadOffer[];
  }>();
  const [pending, setPending] = useState<readonly HandoffThreadOffer[]>([]);
  const canList = enabled.length > 0;
  // Keys come as a new array on every render; their text is what changes.
  const named = JSON.stringify(keys.filter(Boolean));
  useEffect(() => {
    if (!canList || !projectId || named === "[]") return;
    let current = true;
    void findHandoffThreads(projectId, itemId, JSON.parse(named) as string[])
      .then(({ offers }) => {
        if (current) setFound({ itemId, offers });
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [itemId, projectId, named, canList]);
  // A thread linked another way, such as the hand-off flow's "Link that
  // thread" dialog, leaves the offers for good, as the card's Link does.
  // Hiding it only behind its handoff would offer it again once Close takes
  // the handoff off the card, and the tool no longer lists it (#850).
  useEffect(() => {
    const linked = (offer: HandoffThreadOffer) =>
      records.some((record) => sameThread(record, offer));
    setFound((current) =>
      current?.offers.some(linked)
        ? {
            ...current,
            offers: current.offers.filter((offer) => !linked(offer)),
          }
        : current,
    );
  }, [records]);
  // Filtered here too, so the offer and its handoff never show together.
  const offers =
    found?.itemId === itemId && found.offers.length
      ? found.offers.filter(
          (offer) => !records.some((record) => sameThread(record, offer)),
        )
      : NO_OFFERS;
  // Kept with their item too. A worktree a thread names is listed again
  // when the threads' worktrees change, such as after a hand off.
  const [places, setPlaces] = useState<{
    itemId: string;
    worktrees: readonly ListedWorktree[];
    folders: readonly RepositoryFolder[];
  }>();
  const [worktreeReads, setWorktreeReads] = useState(0);
  const inWorktrees = [
    ...new Set(records.flatMap((record) => record.worktreeId ?? [])),
  ]
    .sort()
    .join(" ");
  // A thread in a worktree its tool made (#863) gives the card its lines
  // too, so the main folder's threads need their folder's name.
  const inOwnWorktree = records.some((record) => record.ownWorktree);
  useEffect(() => {
    if (!hasWorktrees()) return;
    let current = true;
    void listWorktreeStatuses({ workItemId: itemId })
      .then(async (worktrees) => {
        const folders =
          (worktrees.length || inOwnWorktree) && projectId
            ? await listRepositoryFolders(projectId).catch(() => [])
            : [];
        if (current) setPlaces({ itemId, worktrees, folders });
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [itemId, projectId, inWorktrees, inOwnWorktree, worktreeReads]);
  const placed = places?.itemId === itemId ? places : undefined;
  /** Resolves whether the offer is settled and left the list. */
  const settle = async (
    offer: HandoffThreadOffer,
    run: () => Promise<boolean>,
  ) => {
    if (pending.some((candidate) => sameThread(candidate, offer))) return false;
    setPending((current) => [...current, offer]);
    const done = await run();
    setPending((current) =>
      current.filter((candidate) => !sameThread(candidate, offer)),
    );
    if (done)
      setFound(
        (current) =>
          current && {
            ...current,
            offers: current.offers.filter(
              (candidate) => !sameThread(candidate, offer),
            ),
          },
      );
    return done;
  };
  return {
    records,
    tools,
    offers,
    pending,
    worktrees: placed?.worktrees,
    folders: placed?.folders,
    reloadWorktrees: () => setWorktreeReads((count) => count + 1),
    link: (offer: HandoffThreadOffer) =>
      projectId
        ? settle(offer, () =>
            linkHandoffThread(offer, { workItemId: itemId, projectId }),
          )
        : Promise.resolve(false),
    dismiss: (offer: HandoffThreadOffer) =>
      settle(offer, () => dismissHandoffThreadOffer(offer, itemId)),
    // A worktree alone keeps the card: its line is where the item's user
    // opens and deletes it, with no thread left and every tool off (#862).
    shown:
      records.length > 0 ||
      enabled.length > 0 ||
      Boolean(placed?.worktrees.length),
  };
}
