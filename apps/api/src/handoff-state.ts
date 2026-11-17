import type {
  Handoff,
  HandoffUpdate,
  StartHandoffResult,
} from "../../../packages/shared/handoffs.ts";
import type { ListedHandoffThread } from "../../../packages/shared/handoff-threads.ts";

export function startHandoff(
  input: Pick<
    Handoff,
    | "id"
    | "pluginId"
    | "toolId"
    | "workItemId"
    | "projectId"
    | "folderId"
    | "title"
    | "branch"
  >,
  result: StartHandoffResult,
  now: number,
  /** False for a tool that can't report its thread's state: `started`. */
  followsState = true,
): Handoff {
  return {
    ...input,
    ...result,
    startedAt: now,
    checkedAt: now,
    changedAt: now,
    state: followsState ? "working" : "started",
    history: [],
  };
}
/**
 * A handoff for a thread the tool listed and the user linked to an item.
 * Ajour didn't start it, so its state is unknown until its first refresh,
 * or `started` for good when its tool doesn't report state.
 */
export function adoptHandoff(
  input: Pick<Handoff, "id" | "workItemId" | "projectId">,
  thread: ListedHandoffThread,
  now: number,
  followsState = true,
): Handoff {
  return {
    ...input,
    pluginId: thread.pluginId,
    toolId: thread.toolId,
    ...(thread.connectionId ? { connectionId: thread.connectionId } : {}),
    folderId: thread.folderId,
    threadId: thread.threadId,
    title: thread.title,
    ...(thread.link ? { link: thread.link } : {}),
    ...(thread.resume ? { resume: thread.resume } : {}),
    native: thread.native,
    startedAt: now,
    checkedAt: now,
    changedAt: now,
    state: followsState ? "unknown" : "started",
    history: [],
  };
}
// Availability and `started` belong to the host, never to a plugin's update
// contract.
export type HostHandoffUpdate = Omit<HandoffUpdate, "state"> &
  Pick<Handoff, "paused" | "state">;

export function updateHandoff(
  record: Handoff,
  update: HostHandoffUpdate,
  now: number,
): Handoff {
  const changed = record.state !== update.state;
  return {
    ...record,
    ...update,
    paused: update.paused,
    checkedAt: now,
    changedAt: changed ? now : record.changedAt,
    history: changed
      ? [
          ...record.history,
          { state: update.state, at: now, ...handoffSummary(update.native) },
        ].slice(-50)
      : record.history,
  };
}
export function removeHandoff(records: Handoff[], id: string): Handoff[] {
  return records.filter((record) => record.id !== id);
}
/**
 * Whether Ajour may still read the handoff's state on its own, on the tick
 * or for a hook: not once it has been done or gone for a day. Whether its
 * tool reports state at all is the tool's to say, at each check
 * (`followsState` on the tool), not the record's.
 */
export function shouldRefresh(record: Handoff, now: number): boolean {
  return !(
    ["done", "gone"].includes(record.state) &&
    now - record.changedAt >= 86_400_000
  );
}

export function handoffSummary(native: Record<string, unknown>) {
  return {
    ...(typeof native.status === "string"
      ? { status: native.status.slice(0, 64) }
      : {}),
    ...(typeof native.label === "string"
      ? { label: native.label.slice(0, 200) }
      : {}),
  };
}
