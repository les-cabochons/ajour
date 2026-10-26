import { showToast } from "@/components/ui/toast";
import type { LocalWorkItem } from "@/domain/local-state";

/** Holds that land within this window share one toast, as a settle of many items. */
const SAME_BURST_MS = 3_000;
const lastShown = new Map<string, number>();

/**
 * Says once that a change was held on this computer because its connection
 * can't edit work items (#395). The change waits in Sync review, and the
 * connection's row counts it. Background work has no other place to say
 * it, so it is a toast; a burst of holds on one connection shows one.
 */
export function announceHeldEdit(
  item:
    | Pick<LocalWorkItem, "sourceConnectionId" | "sourceConnectionLabel">
    | undefined,
) {
  const key = item?.sourceConnectionId ?? "";
  const now = Date.now();
  const last = lastShown.get(key);
  if (last !== undefined && now - last < SAME_BURST_MS) return;
  lastShown.set(key, now);
  const connection = item?.sourceConnectionLabel
    ? `"${item.sourceConnectionLabel}"`
    : "its connection";
  showToast(
    `Held on this computer: editing work items is off for ${connection}. Turn it on to review and send the change.`,
  );
}
