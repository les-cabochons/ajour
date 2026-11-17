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
): Handoff {
  return {
    ...input,
    ...result,
    startedAt: now,
    checkedAt: now,
    changedAt: now,
    state: "working",
    history: [],
  };
}
/**
 * A handoff for a thread the tool listed and the user linked to an item.
 * Ajour didn't start it, so its state is unknown until its first refresh.
 */
export function adoptHandoff(
  input: Pick<Handoff, "id" | "workItemId" | "projectId">,
  thread: ListedHandoffThread,
  now: number,
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
    state: "unknown",
    history: [],
  };
}
// Availability belongs to the host, never to a plugin's update contract.
export type HostHandoffUpdate = HandoffUpdate & Pick<Handoff, "paused">;

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
