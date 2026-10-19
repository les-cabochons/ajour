import { createDeviceQueue } from "@/lib/device-queue";

/**
 * Comments an agent posted, waiting for their Undo window (map #234, ADR
 * 0008): each goes to the source tool when its Undo toast closes, or at the
 * next launch if Ajour quit first. Kept per device, outside the local state.
 */
export const PENDING_AGENT_COMMENTS_STORAGE_KEY =
  "ajour.pending-agent-comments";

export interface PendingAgentComment {
  id: string;
  itemId: string;
  pluginId: string;
  connectionId: string;
  sourceId: string;
  /** Markdown. Mentions are `[@Name](mention:<id>)`. */
  body: string;
  /** The agent client's name, for the error a refused post shows. */
  clientName: string;
  at: number;
}

const isPendingComment = (value: unknown): value is PendingAgentComment => {
  if (!value || typeof value !== "object") return false;
  const entry = value as Record<string, unknown>;
  return (
    [
      "id",
      "itemId",
      "pluginId",
      "connectionId",
      "sourceId",
      "body",
      "clientName",
    ].every((key) => typeof entry[key] === "string") &&
    typeof entry.at === "number"
  );
};

const queue = createDeviceQueue(
  PENDING_AGENT_COMMENTS_STORAGE_KEY,
  isPendingComment,
);

/** Broken entries are dropped. */
export const parsePendingAgentComments = queue.parse;

export function queueAgentComment(entry: PendingAgentComment) {
  queue.write([
    ...queue.read().filter((pending) => pending.id !== entry.id),
    entry,
  ]);
}

/** Takes the comment off the queue, so it is sent at most once. Undo drops it. */
export function takeAgentComment(id: string) {
  const entries = queue.read();
  const entry = entries.find((pending) => pending.id === id);
  if (entry) queue.write(entries.filter((pending) => pending.id !== id));
  return entry;
}

export function agentCommentIds() {
  return queue.read().map((entry) => entry.id);
}
