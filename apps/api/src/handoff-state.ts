import type {
  Handoff,
  HandoffUpdate,
  StartHandoffResult,
} from "../../../packages/shared/handoffs.ts";

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
export function updateHandoff(
  record: Handoff,
  update: HandoffUpdate,
  now: number,
): Handoff {
  const changed = record.state !== update.state;
  return {
    ...record,
    ...update,
    checkedAt: now,
    changedAt: changed ? now : record.changedAt,
    history: changed
      ? [
          ...record.history,
          { state: update.state, native: update.native, at: now },
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
