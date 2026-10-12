import {
  codeHostPullRequestFactsSchema,
  pluginHasCodeHost,
} from "@ajour/shared";
import { z } from "zod";
import type {
  CodeHostPullRequestFacts,
  CodeHostSyncResult,
  ConnectorsOverview,
} from "@ajour/shared";

export type PullRequestReason =
  | "review-requested"
  | "changes-requested"
  | "new-reply"
  | "mentioned"
  | "new-review"
  | "new-comment"
  | "manual";

/** Sync facts contain no description, patches, or comment bodies. */
export interface LocalPullRequest {
  _id: string;
  pluginId: string;
  pluginName: string;
  connectionId: string;
  connectionLabel: string;
  viewerLogin: string;
  facts: CodeHostPullRequestFacts;
  status: "active" | "settled";
  activeAt: number;
  reason?: PullRequestReason;
  snoozedUntil?: number;
  returnedAt?: number;
  lastActionAt?: number;
  closedAt?: number;
  missingFromSync: boolean;
}

export const CLOSED_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const sameLogin = (left: string, right: string) =>
  left.toLowerCase() === right.toLowerCase();
const refKey = (facts: { repository: string; number: number }) =>
  JSON.stringify([facts.repository.toLowerCase(), facts.number]);

export function enabledCodeHostGroups(overview: ConnectorsOverview | null) {
  return overview?.pluginsEnabled === false
    ? []
    : (overview?.connectionGroups ?? []).filter(
        (group) =>
          group.enabled &&
          pluginHasCodeHost(group.plugin) &&
          group.plugin.entrypoint.length > 0,
      );
}

export function isPullRequestSnoozed(item: LocalPullRequest, now: number) {
  return item.status === "active" && (item.snoozedUntil ?? 0) > now;
}

export function isPullRequestReturned(item: LocalPullRequest, now: number) {
  return (
    item.status === "active" &&
    !isPullRequestSnoozed(item, now) &&
    (item.returnedAt !== undefined ||
      (item.snoozedUntil !== undefined && item.snoozedUntil <= now))
  );
}

export function selectVisiblePullRequests(
  items: readonly LocalPullRequest[],
  overview: ConnectorsOverview | null,
  now: number,
) {
  const connections = new Set(
    enabledCodeHostGroups(overview).flatMap((group) =>
      group.connections.map((connection) =>
        JSON.stringify([group.plugin.id, connection.id]),
      ),
    ),
  );
  return items.filter(
    (item) =>
      !item.missingFromSync &&
      connections.has(JSON.stringify([item.pluginId, item.connectionId])) &&
      (item.facts.state === "open" ||
        now - (item.closedAt ?? now) < CLOSED_RETENTION_MS),
  );
}

export function selectSidebarPullRequests(
  items: readonly LocalPullRequest[],
  now: number,
) {
  return items
    .filter(
      (item) =>
        item.facts.state === "open" &&
        item.status === "active" &&
        !item.missingFromSync &&
        !isPullRequestSnoozed(item, now),
    )
    .sort((a, b) => a.activeAt - b.activeAt || a._id.localeCompare(b._id));
}

function unsettlingEvent(
  previous: LocalPullRequest,
  next: CodeHostPullRequestFacts,
  viewerLogin: string,
) {
  const own = (login: string) => sameLogin(login, viewerLogin);
  const afterAction = (at: number) => at > (previous.lastActionAt ?? -1);
  const events: Array<{ at: number; reason: PullRequestReason }> = [];
  const old = previous.facts;
  const newComments = next.comments.filter(
    (comment) =>
      !old.comments.some((seen) => seen.id === comment.id) &&
      !own(comment.author.login) &&
      !comment.author.isBot &&
      afterAction(comment.createdAt),
  );
  const newReviews = next.reviews.filter(
    (review) =>
      !old.reviews.some((seen) => seen.id === review.id) &&
      !own(review.author.login) &&
      afterAction(review.submittedAt),
  );
  if (next.viewerIsAuthor) {
    events.push(
      ...newReviews.map((review) => ({
        at: review.submittedAt,
        reason: "new-review" as const,
      })),
    );
    events.push(
      ...newComments.map((comment) => ({
        at: comment.createdAt,
        reason: "new-comment" as const,
      })),
    );
  } else {
    const requests =
      next.reviewRequestEvents?.filter(
        (event) =>
          event.includesViewer &&
          !own(event.author.login) &&
          afterAction(event.createdAt) &&
          !old.reviewRequestEvents?.some((seen) => seen.id === event.id),
      ) ?? [];
    events.push(
      ...requests.map((event) => ({
        at: event.createdAt,
        reason: "review-requested" as const,
      })),
    );
    // Providers without request event facts can still report an observed new request.
    if (
      !next.reviewRequestEvents &&
      next.reviewRequests.some(
        (request) =>
          request.includesViewer &&
          !old.reviewRequests.some(
            (seen) =>
              seen.includesViewer &&
              seen.kind === request.kind &&
              sameLogin(seen.name, request.name),
          ),
      )
    ) {
      events.push({ at: next.updatedAt, reason: "review-requested" });
    }
    for (const comment of newComments) {
      if (comment.mentionsViewer)
        events.push({ at: comment.createdAt, reason: "mentioned" });
      else if (
        sameLogin(comment.author.login, next.author.login) &&
        comment.threadId &&
        [...old.comments, ...next.comments].some(
          (participation) =>
            participation.threadId === comment.threadId &&
            own(participation.author.login) &&
            participation.createdAt < comment.createdAt,
        )
      ) {
        events.push({ at: comment.createdAt, reason: "new-reply" });
      }
    }
    events.push(
      ...newReviews
        .filter((review) => review.mentionsViewer && !review.author.isBot)
        .map((review) => ({
          at: review.submittedAt,
          reason: "mentioned" as const,
        })),
    );
    const ownReviews = next.reviews
      .filter(
        (review) => own(review.author.login) && review.verdict !== "dismissed",
      )
      .sort((a, b) => b.submittedAt - a.submittedAt);
    if (
      (old.headSha !== next.headSha ||
        (!old.lastPushActor && next.lastPushActor)) &&
      ownReviews[0]?.verdict === "changes_requested" &&
      next.lastPushedAt > ownReviews[0].submittedAt &&
      afterAction(next.lastPushedAt) &&
      next.lastPushActor &&
      !own(next.lastPushActor.login)
    ) {
      events.push({ at: next.lastPushedAt, reason: "changes-requested" });
    }
  }
  return events.sort((a, b) => b.at - a.at)[0];
}

export function reconcilePullRequests(
  items: readonly LocalPullRequest[],
  source: {
    pluginId: string;
    pluginName: string;
    connectionId: string;
    connectionLabel: string;
  },
  result: CodeHostSyncResult,
  options: {
    now: number;
    createId: () => string;
    changesEndSnoozeEarly: boolean;
  },
): LocalPullRequest[] {
  const inConnection = (item: LocalPullRequest) =>
    item.pluginId === source.pluginId &&
    item.connectionId === source.connectionId;
  const previous = new Map(
    items.filter(inConnection).map((item) => [refKey(item.facts), item]),
  );
  const received = new Set<string>();
  const imported = result.pullRequests.flatMap((facts): LocalPullRequest[] => {
    const key = refKey(facts);
    if (received.has(key)) return [];
    received.add(key);
    const old = previous.get(key);
    const requested = facts.reviewRequests.some(
      (request) => request.includesViewer,
    );
    const closedAt =
      facts.state === "open"
        ? undefined
        : (facts.closedAt ?? old?.closedAt ?? options.now);
    if (closedAt !== undefined && options.now - closedAt >= CLOSED_RETENTION_MS)
      return [];
    const initial: LocalPullRequest = old ?? {
      ...source,
      _id: options.createId(),
      viewerLogin: result.viewer.login,
      facts,
      status: requested && !facts.viewerIsAuthor ? "active" : "settled",
      activeAt:
        facts.reviewRequestEvents
          ?.filter(
            (event) =>
              event.includesViewer &&
              !sameLogin(event.author.login, result.viewer.login),
          )
          .reduce(
            (latest, event) => Math.max(latest, event.createdAt),
            facts.createdAt,
          ) ?? facts.createdAt,
      reason:
        requested && !facts.viewerIsAuthor ? "review-requested" : undefined,
      missingFromSync: false,
    };
    const event = old
      ? unsettlingEvent(old, facts, result.viewer.login)
      : undefined;
    let next: LocalPullRequest = {
      ...initial,
      ...source,
      viewerLogin: result.viewer.login,
      facts,
      closedAt,
      missingFromSync: false,
    };
    if (event && facts.state === "open") {
      next = {
        ...next,
        status: "active",
        reason: event.reason,
        activeAt: initial.status === "settled" ? event.at : initial.activeAt,
        returnedAt:
          initial.status === "settled" ||
          isPullRequestSnoozed(initial, options.now)
            ? options.now
            : initial.returnedAt,
        snoozedUntil: options.changesEndSnoozeEarly
          ? undefined
          : initial.snoozedUntil,
      };
    }
    if (facts.state !== "open")
      next = { ...next, snoozedUntil: undefined, returnedAt: undefined };
    return [next];
  });
  return [
    ...items.filter(
      (item) =>
        !inConnection(item) &&
        (item.closedAt === undefined ||
          options.now - item.closedAt < CLOSED_RETENTION_MS),
    ),
    ...items
      .filter(
        (item) =>
          inConnection(item) &&
          !received.has(refKey(item.facts)) &&
          (item.closedAt === undefined ||
            options.now - item.closedAt < CLOSED_RETENTION_MS),
      )
      .map((item) => ({ ...item, missingFromSync: true })),
    ...imported,
  ];
}

export type PullRequestCommand =
  | { type: "settle" | "unsettle" | "unsnooze" | "open" }
  | { type: "snooze"; until: number };

export function changePullRequest(
  item: LocalPullRequest,
  command: PullRequestCommand,
  now: number,
): LocalPullRequest {
  if (command.type === "open")
    return {
      ...item,
      returnedAt: undefined,
      snoozedUntil:
        item.snoozedUntil !== undefined && item.snoozedUntil <= now
          ? undefined
          : item.snoozedUntil,
    };
  if (item.facts.state !== "open") return item;
  switch (command.type) {
    case "settle":
      return {
        ...item,
        status: "settled",
        snoozedUntil: undefined,
        returnedAt: undefined,
        lastActionAt: now,
      };
    case "unsettle":
      return {
        ...item,
        status: "active",
        reason: "manual",
        activeAt: now,
        snoozedUntil: undefined,
        returnedAt: undefined,
        lastActionAt: now,
      };
    case "snooze":
      return item.status === "active" &&
        Number.isFinite(command.until) &&
        command.until > now
        ? {
            ...item,
            snoozedUntil: command.until,
            returnedAt: undefined,
            lastActionAt: now,
          }
        : item;
    case "unsnooze":
      return {
        ...item,
        snoozedUntil: undefined,
        returnedAt: undefined,
        lastActionAt: now,
      };
  }
}

/** Validate the stored facts before they become a sync baseline. */
const storedPullRequestSchema = z.object({
  _id: z.string().min(1),
  pluginId: z.string().min(1),
  pluginName: z.string().min(1),
  connectionId: z.string().min(1),
  connectionLabel: z.string(),
  viewerLogin: z.string().min(1),
  facts: codeHostPullRequestFactsSchema,
  status: z.enum(["active", "settled"]),
  activeAt: z.number().int().nonnegative(),
  reason: z
    .enum([
      "review-requested",
      "changes-requested",
      "new-reply",
      "mentioned",
      "new-review",
      "new-comment",
      "manual",
    ])
    .optional(),
  snoozedUntil: z.number().int().nonnegative().optional(),
  returnedAt: z.number().int().nonnegative().optional(),
  lastActionAt: z.number().int().nonnegative().optional(),
  closedAt: z.number().int().nonnegative().optional(),
  missingFromSync: z.boolean().default(false),
});

export function normalizePullRequests(value: unknown): LocalPullRequest[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw): LocalPullRequest[] => {
    const parsed = storedPullRequestSchema.safeParse(raw);
    if (!parsed.success) return [];
    return [parsed.data];
  });
}
