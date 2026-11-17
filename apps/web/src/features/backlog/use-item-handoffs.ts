import { useEffect, useState } from "react";
import type { HandoffThreadOffer } from "@ajour/shared/handoff-threads";
import { findHandoffThreads, refreshHandoffs } from "@/lib/app-api";
import { setHandoffs, useHandoffs } from "@/lib/handoffs";
import { useHandoffTools } from "@/lib/handoff-tools";
import {
  dismissHandoffThreadOffer,
  linkHandoffThread,
} from "@/features/backlog/handoff-workflow";

const NO_OFFERS: readonly HandoffThreadOffer[] = [];

const sameOffer = (left: HandoffThreadOffer, right: HandoffThreadOffer) =>
  left.pluginId === right.pluginId &&
  left.toolId === right.toolId &&
  left.threadId === right.threadId &&
  left.connectionId === right.connectionId;

/**
 * The item page's handoffs and tools. Opening the item asks each live thread
 * for its state once, so the card is current without waiting for the API's
 * next tick, and asks once for the threads its project's folders hold whose
 * title names the item's key, to offer linking them. The card shows while
 * the item has threads or a tool could take one, so the web build and
 * items without a tool keep their cards as they were.
 */
export function useItemHandoffs(
  itemId: string,
  projectId?: string,
  key?: string,
) {
  const records = useHandoffs(itemId);
  const tools = useHandoffTools(projectId);
  const live = records
    .filter(
      (record) =>
        !record.paused && record.state !== "done" && record.state !== "gone",
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
  const canList = tools.length > 0;
  useEffect(() => {
    if (!canList || !projectId || !key) return;
    let current = true;
    void findHandoffThreads(projectId, key)
      .then(({ offers }) => {
        if (current) setFound({ itemId, offers });
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [itemId, projectId, key, canList]);
  const offers =
    found?.itemId === itemId && found.offers.length
      ? found.offers.filter(
          (offer) =>
            !records.some(
              (record) =>
                record.pluginId === offer.pluginId &&
                record.toolId === offer.toolId &&
                record.threadId === offer.threadId &&
                record.connectionId === offer.connectionId,
            ),
        )
      : NO_OFFERS;
  const settle = async (
    offer: HandoffThreadOffer,
    run: () => Promise<boolean>,
  ) => {
    if (pending.some((candidate) => sameOffer(candidate, offer))) return;
    setPending((current) => [...current, offer]);
    const done = await run();
    setPending((current) =>
      current.filter((candidate) => !sameOffer(candidate, offer)),
    );
    if (done)
      setFound(
        (current) =>
          current && {
            ...current,
            offers: current.offers.filter(
              (candidate) => !sameOffer(candidate, offer),
            ),
          },
      );
  };
  return {
    records,
    tools,
    offers,
    pending,
    link: (offer: HandoffThreadOffer) =>
      projectId
        ? void settle(offer, () =>
            linkHandoffThread(offer, { workItemId: itemId, projectId }),
          )
        : undefined,
    dismiss: (offer: HandoffThreadOffer) =>
      void settle(offer, () => dismissHandoffThreadOffer(offer)),
    shown: records.length > 0 || tools.length > 0,
  };
}
