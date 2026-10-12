import { showErrorToast } from "@/components/ui/toast";
import type { LocalWorkItem } from "@/domain/local-state";
import {
  getCachedConnectorsOverview,
  writeConnectorSettle,
} from "@/lib/app-api";
import { localStore } from "@/lib/local-store";

/** Items whose write is on its way, so a second flush doesn't send it twice. */
const sending = new Set<string>();

/**
 * Whether a settle can write to the item's source: the item is synced and its
 * active connector has the settle capability. Other items settle locally.
 */
export function canWriteSettle(workItem: LocalWorkItem) {
  if (
    workItem.source === "manual" ||
    !workItem.sourceId ||
    !workItem.sourceConnectionId
  ) {
    return false;
  }

  const group = getCachedConnectorsOverview()?.connectionGroups.find(
    (candidate) => candidate.plugin.id === workItem.source,
  );
  return Boolean(group?.enabled && group.plugin.capabilities?.settle);
}

/**
 * Sends the settle writes waiting in local state. After an Undo toast closes,
 * `workItemIds` limits this to the action's items. At launch, it sends every
 * write left from a session that quit during its Undo window.
 *
 * A failed write puts the item back to active and shows an error toast that
 * stays until dismissed.
 */
export async function sendPendingSourceWrites(workItemIds?: readonly string[]) {
  const pending = localStore
    .snapshot()
    .workItems.filter(
      (workItem) =>
        workItem.pendingSourceWrite &&
        !sending.has(workItem._id) &&
        (!workItemIds || workItemIds.includes(workItem._id)),
    );
  await Promise.all(pending.map(sendSourceWrite));
}

async function sendSourceWrite(workItem: LocalWorkItem) {
  const write = workItem.pendingSourceWrite;
  if (!write) return;

  sending.add(workItem._id);
  try {
    if (!workItem.sourceId || !workItem.sourceConnectionId) {
      throw new Error("The item is no longer linked to its source.");
    }
    await writeConnectorSettle(workItem.source, workItem.sourceConnectionId, {
      sourceId: workItem.sourceId,
      state: write.state,
      priority: write.priority,
    });
    localStore.completeSourceWrite(workItem._id);
  } catch (error) {
    localStore.failSourceWrite(workItem._id);
    showErrorToast({
      title: `Couldn't settle "${workItem.title}"`,
      description: `${error instanceof Error ? error.message : "Unknown error"} The item is back in your list.`,
    });
  } finally {
    sending.delete(workItem._id);
  }
}
