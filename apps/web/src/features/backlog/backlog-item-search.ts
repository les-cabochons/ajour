import type { HostedBacklogItemActionId } from "@/features/backlog/backlog-item-actions";

/** The search params of the backlog item page at /backlog/$itemId. */
export interface BacklogItemSearch {
  action?: HostedBacklogItemActionId;
}

const hostedActionIds: readonly HostedBacklogItemActionId[] = [
  "edit",
  "add-subitem",
];

/**
 * Validates the search params of /backlog/$itemId. The URL is outside input,
 * so an `action` the page cannot host is dropped instead of reaching it.
 */
export function parseBacklogItemSearch(
  search: Record<string, unknown>,
): BacklogItemSearch {
  const action = hostedActionIds.find((id) => id === search.action);
  return action ? { action } : {};
}
