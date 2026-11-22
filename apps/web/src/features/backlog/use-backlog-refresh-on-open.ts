import { useEffect, useRef } from "react";
import { localStore } from "@/lib/local-store";
import { refreshBacklog } from "./backlog-refresh-workflow";

/** A visit refreshes once; StrictMode and store writes are not new visits. */
export function useBacklogRefreshOnOpen() {
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void refreshBacklog({ trigger: "auto" });
  }, []);
}

/**
 * Opening a synced item's page syncs that item, both ways, on every visit:
 * it uploads the item's pending estimate changes and brings in the
 * source's values, as its refresh control does. Moving to another item is
 * a new visit; StrictMode and store writes are not. A manual item has
 * nothing to sync.
 */
export function useBacklogItemRefreshOnOpen(itemId: string) {
  const refreshed = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (refreshed.current === itemId) return;
    refreshed.current = itemId;
    const item = localStore
      .snapshot()
      .workItems.find((workItem) => workItem._id === itemId);
    if (
      !item ||
      item.source === "manual" ||
      !item.sourceId ||
      !item.sourceConnectionId
    ) {
      return;
    }
    void refreshBacklog({
      source: {
        pluginId: item.source,
        connectionId: item.sourceConnectionId,
        sourceId: item.sourceId,
      },
      trigger: "auto",
    });
  }, [itemId]);
}
