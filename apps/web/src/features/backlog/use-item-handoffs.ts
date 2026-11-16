import { useEffect } from "react";
import { refreshHandoffs } from "@/lib/app-api";
import { setHandoffs, useHandoffs } from "@/lib/handoffs";
import { useHandoffTools } from "@/lib/handoff-tools";

/**
 * The item page's handoffs and tools. Opening the item asks each live thread
 * for its state once, so the card is current without waiting for the API's
 * next tick. The card shows while the item has threads or a tool could take
 * one, so the web build and items without a tool keep their cards as they
 * were.
 */
export function useItemHandoffs(itemId: string, projectId?: string) {
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
  return {
    records,
    tools,
    shown: records.length > 0 || tools.length > 0,
  };
}
