import { isCapabilityActive } from "@ajour/shared";
import { UNDO_TOAST_TIMEOUT_MS } from "@/components/ui/toast";
import {
  hasEstimateChangeToPush,
  itemsWithNewEstimateChanges,
} from "@/domain/backlog/estimate-pushes";
import {
  asPoll,
  getPluginsOverview,
  syncBacklogConnection,
} from "@/lib/app-api";
import { getBacklogSyncSnapshot } from "@/lib/backlog-sync-status";
import { localStore } from "@/lib/local-store";

/**
 * How long an estimate change waits before it goes: the Undo toast's time,
 * so an Undo in the toast usually means nothing goes at all. Each new
 * change of the item starts the wait over.
 */
export const ESTIMATE_PUSH_DELAY_MS = UNDO_TOAST_TIMEOUT_MS;

/** How long an upload waits again while another sync of its connection runs. */
const BUSY_CONNECTION_RETRY_MS = 2_000;

/**
 * Sends a synced item's estimate changes to its source soon after they are
 * made, whatever made them: the item page, the editor, logged time, an
 * agent, an Undo, Keep mine or a released hold. Each upload is a sync of
 * that item alone, both ways, with the `source_write` trigger, so its
 * answer updates the agreed values. Scheduled syncs still upload whatever
 * this misses, such as a change made while the connection was paused.
 *
 * One item's uploads go one at a time: a change made while one is on its
 * way goes after its answer, so the second upload compares with the value
 * the first one agreed on. Returns the unsubscribe.
 */
export function watchEstimateChanges() {
  const timers = new Map<string, number>();
  const sending = new Set<string>();
  const sendAgain = new Set<string>();

  const schedule = (itemId: string, delayMs = ESTIMATE_PUSH_DELAY_MS) => {
    window.clearTimeout(timers.get(itemId));
    timers.set(
      itemId,
      window.setTimeout(() => {
        timers.delete(itemId);
        void push(itemId);
      }, delayMs),
    );
  };

  const push = async (itemId: string) => {
    if (sending.has(itemId)) {
      sendAgain.add(itemId);
      return;
    }
    const item = findItem(itemId);
    // Undone, uploaded by another sync, or gone meanwhile.
    if (!item || !hasEstimateChangeToPush(item)) return;
    const pluginId = item.source;
    const connectionId = item.sourceConnectionId!;
    sending.add(itemId);
    try {
      if (!(await canSync(pluginId, connectionId))) return;
      // A sync that runs now read the item before this change, and its
      // answer could put the old value back after this one's: wait for it.
      if (isConnectionSyncing(pluginId, connectionId)) {
        schedule(itemId, BUSY_CONNECTION_RETRY_MS);
        return;
      }
      await syncBacklogConnection(pluginId, connectionId, {
        trigger: "source_write",
        refresh: true,
        sourceId: item.sourceId,
      });
    } catch {
      // The sync's own event records the failure. The change stays on the
      // item, and the next scheduled sync uploads it.
    } finally {
      sending.delete(itemId);
      if (sendAgain.delete(itemId)) void push(itemId);
    }
  };

  let before = localStore.snapshot().workItems;
  const unsubscribe = localStore.subscribe(() => {
    const after = localStore.snapshot().workItems;
    if (after === before) return;
    for (const itemId of itemsWithNewEstimateChanges(before, after)) {
      schedule(itemId);
    }
    before = after;
  });

  return () => {
    unsubscribe();
    for (const timer of timers.values()) window.clearTimeout(timer);
    timers.clear();
  };
}

function findItem(itemId: string) {
  return localStore
    .snapshot()
    .workItems.find((workItem) => workItem._id === itemId);
}

/**
 * Whether the connection can sync its backlog now: plugins are on, its
 * plugin's backlog capability is active, and it isn't paused for its secret.
 * Reading the overview is also the retry when the local API was offline.
 */
async function canSync(pluginId: string, connectionId: string) {
  const overview = await asPoll(() => getPluginsOverview());
  if (overview.pluginsEnabled === false) return false;
  const group = overview.connectionGroups.find(
    (candidate) => candidate.plugin.id === pluginId,
  );
  const connection = group?.connections.find(
    (candidate) => candidate.id === connectionId,
  );
  return Boolean(
    group &&
    isCapabilityActive(group, "connector") &&
    connection &&
    !connection.paused,
  );
}

function isConnectionSyncing(pluginId: string, connectionId: string) {
  return getBacklogSyncSnapshot().some(
    (status) =>
      status.pluginId === pluginId &&
      status.connectionId === connectionId &&
      status.running > 0,
  );
}
