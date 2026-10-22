import type { BacklogCommentOperation } from "../../../packages/shared/backlog-comments.ts";
import type { CalendarOperation } from "../../../packages/shared/calendar.ts";
import type { CodeHostOperation } from "../../../packages/shared/code-host.ts";
import type {
  AjourCatalog,
  EventName,
  KindOf,
} from "../../../packages/wide-events/catalog.ts";

/** An event whose kinds include `kind`. */
type EventOfKind<Kind extends string> = {
  [Name in EventName<AjourCatalog>]: Kind extends KindOf<AjourCatalog, Name>
    ? Name
    : never;
}[EventName<AjourCatalog>];

/** An event the request seam may name a request. */
export type RequestEventName = EventOfKind<"request">;

/** An event a plugin worker run may be named. */
export type PluginOperationEventName = EventOfKind<"plugin_operation">;

/** An operation that has a route and a plugin method of the same name. */
type RoutedPluginEventName = RequestEventName & PluginOperationEventName;

/**
 * The event each code host operation emits, as its route's request and as
 * its worker run. A new operation needs one.
 */
export const CODE_HOST_EVENTS = {
  syncPullRequests: "pull_request.sync",
  getPullRequestContent: "pull_request.load",
  getFileContent: "pull_request.load_file",
  getPullRequestConversation: "pull_request.load_conversation",
  browsePullRequests: "pull_request.browse",
  submitReview: "pull_request.submit_review",
  postComment: "pull_request.comment",
  replyToThread: "pull_request.reply",
  setThreadResolved: "pull_request.resolve_thread",
  setFileViewed: "pull_request.mark_file_viewed",
  updatePullRequest: "pull_request.update",
  mergePullRequest: "pull_request.merge",
} as const satisfies Record<CodeHostOperation, RoutedPluginEventName>;

/** The event each comment operation emits. A new operation needs one. */
export const COMMENT_EVENTS = {
  listItemComments: "comment.list",
  postItemComment: "comment.post",
  editItemComment: "comment.edit",
  deleteItemComment: "comment.delete",
  setItemCommentReaction: "comment.react",
  searchItemPeople: "mention.search",
} as const satisfies Record<BacklogCommentOperation, RoutedPluginEventName>;

/** The event each calendar operation emits. */
export const CALENDAR_EVENTS = {
  listCalendarEvents: "calendar.fetch",
} as const satisfies Record<CalendarOperation, RoutedPluginEventName>;
