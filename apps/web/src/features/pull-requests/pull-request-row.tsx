import { useNavigate } from "@tanstack/react-router";
import {
  RiGitPullRequestLine as PullRequestIcon,
  RiCheckboxCircleLine as Check,
  RiArrowGoBackLine as Return,
} from "@remixicon/react";
import {
  ObjectActionsButton,
  ObjectContextMenu,
} from "@/components/object-actions-menu";
import { Chip } from "@/components/ui/chip";
import type { ObjectAction } from "@/domain/actions/object-actions";
import {
  isPullRequestReturned,
  isPullRequestSnoozed,
  type LocalPullRequest,
  type PullRequestReason,
} from "@/domain/pull-requests/pull-request-lifecycle";
import { requestPullRequestSnooze } from "@/features/backlog/snooze-picker";
import { formatSnoozeTime } from "@/features/backlog/snooze-presets";
import { handleItemKeyDown, type ActionKeys } from "@/lib/item-keys";
import { localStore } from "@/lib/local-store";
import { withEventAttribution } from "@/lib/wide-events";
import {
  openModifiedSourceClick,
  openSourceUrl,
} from "@/lib/source-navigation";
import { getShortcutPlatform } from "@/lib/shortcuts";
import { cn } from "@/lib/utils";

export const reasonLabels: Record<PullRequestReason, string> = {
  "review-requested": "Review requested",
  "changes-requested": "New commits after your change request",
  "new-reply": "New reply",
  mentioned: "You were mentioned",
  "new-review": "New review",
  "new-comment": "New comment",
  manual: "On your plate",
};

/** The sidebar's one-line reasons. "On your plate" needs no label there. */
const shortReasonLabels: Record<PullRequestReason, string | undefined> = {
  "review-requested": "Review",
  "changes-requested": "New commits",
  "new-reply": "Reply",
  mentioned: "Mention",
  "new-review": "New review",
  "new-comment": "Comment",
  manual: undefined,
};

type PullRequestAction =
  "open" | "open-in-source" | "settle" | "unsettle" | "snooze" | "unsnooze";
const keys: ActionKeys<PullRequestAction> = {
  open: "item.edit",
  settle: "item.settle",
  unsettle: "item.settle",
  snooze: "item.snooze",
};

export function pullRequestActions(
  item: LocalPullRequest,
  now: number,
): ObjectAction<PullRequestAction>[] {
  return [
    {
      id: "open-in-source",
      label: `Open in ${item.pluginName}`,
      group: "source",
      hint: getShortcutPlatform() === "mac" ? "Cmd-click" : "Ctrl-click",
    },
    ...(item.facts.state !== "open"
      ? []
      : [
          item.status === "settled"
            ? { id: "unsettle" as const, label: "Unsettle", group: "triage" }
            : { id: "settle" as const, label: "Settle", group: "triage" },
          ...(item.status !== "active"
            ? []
            : [
                isPullRequestSnoozed(item, now)
                  ? {
                      id: "unsnooze" as const,
                      label: "Unsnooze",
                      group: "triage",
                    }
                  : {
                      id: "snooze" as const,
                      label: "Snooze…",
                      group: "triage",
                    },
              ]),
        ]),
  ];
}

export function runPullRequestAction(
  item: LocalPullRequest,
  action: Exclude<PullRequestAction, "open">,
) {
  return withEventAttribution({ surface: "button" }, () => {
    if (action === "open-in-source") openSourceUrl(item.facts.url);
    else if (action === "snooze") requestPullRequestSnooze(item._id);
    else localStore.changePullRequest(item._id, { type: action });
  });
}

function waitingAge(time: number, now: number) {
  const hours = Math.max(0, Math.floor((now - time) / 3_600_000));
  return hours >= 24
    ? `${Math.floor(hours / 24)}d`
    : hours > 0
      ? `${hours}h`
      : "Just now";
}

/**
 * The list and sidebar share the action set, modified click, keys, and
 * Returned mark. The `compact` sidebar row has no "…" button: right-click and
 * the menu keys open the same menu.
 */
export function PullRequestRow({
  item,
  now,
  compact = false,
  showConnection = false,
  selected = false,
}: {
  item: LocalPullRequest;
  now: number;
  compact?: boolean;
  showConnection?: boolean;
  selected?: boolean;
}) {
  const navigate = useNavigate();
  const actions = pullRequestActions(item, now);
  function open() {
    void navigate({
      to: "/pull-requests/$itemId",
      params: { itemId: item._id },
    });
  }
  const returned = isPullRequestReturned(item, now);
  return (
    <ObjectContextMenu
      actions={actions}
      keys={keys}
      onAction={(action) =>
        runPullRequestAction(item, action as Exclude<PullRequestAction, "open">)
      }
      render={
        <div
          role="link"
          tabIndex={0}
          aria-label={`Open ${item.facts.title}`}
          data-pull-request-id={item._id}
          data-focus-column="0"
          className={cn(
            "group flex min-w-0 cursor-pointer gap-2 rounded-md text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring",
            compact
              ? "h-7 shrink-0 items-center px-2 hover:bg-foreground/5 focus-visible:ring-1"
              : "items-start border-b border-border px-1 py-2.5 hover:bg-[var(--highlight-bg)]",
            selected && "bg-foreground/[0.07]",
          )}
          onClick={(event) => {
            if (!openModifiedSourceClick(event, item.facts.url)) open();
          }}
          onKeyDown={(event) =>
            handleItemKeyDown(event, {
              actions: [...actions, { id: "open", label: "Open" }],
              keys,
              onAction: (action) =>
                action === "open" ? open() : runPullRequestAction(item, action),
            })
          }
        />
      }
    >
      {compact ? (
        <>
          {item.facts.state === "open" ? (
            <PullRequestIcon
              className="size-4 shrink-0 text-[var(--success)]"
              aria-hidden="true"
            />
          ) : (
            <Check
              className="size-4 shrink-0 text-muted-foreground"
              aria-hidden="true"
            />
          )}
          <span
            className={cn(
              "min-w-0 flex-1 truncate",
              returned && "font-semibold",
            )}
            title={`${item.facts.repository} #${item.facts.number}${showConnection ? ` · ${item.connectionLabel}` : ""}`}
          >
            {item.facts.title}
          </span>
          <span className="shrink-0 text-xs text-muted-foreground">
            {[
              returned
                ? "Returned"
                : shortReasonLabels[item.reason ?? "manual"],
              waitingAge(item.activeAt, now),
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </>
      ) : (
        <>
          {item.facts.state === "open" ? (
            <PullRequestIcon
              className="mt-0.5 size-4 shrink-0 text-muted-foreground"
              aria-hidden="true"
            />
          ) : (
            <Check
              className="mt-0.5 size-4 shrink-0 text-muted-foreground"
              aria-hidden="true"
            />
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-start gap-2">
              <span className="font-medium break-words">
                {item.facts.title}
              </span>
              {returned ? (
                <span className="inline-flex items-center gap-1 text-xs text-primary">
                  <Return className="size-3" />
                  Returned
                </span>
              ) : null}
            </div>
            <p className="mt-1 truncate text-xs text-muted-foreground">
              {item.facts.repository} #{item.facts.number}
              {showConnection ? ` · ${item.connectionLabel}` : ""}
            </p>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span>
                {item.facts.state !== "open"
                  ? item.facts.state === "merged"
                    ? "Merged"
                    : "Closed"
                  : isPullRequestSnoozed(item, now)
                    ? `Snoozed until ${formatSnoozeTime(item.snoozedUntil!, now)}`
                    : item.status === "settled"
                      ? "Settled"
                      : reasonLabels[item.reason ?? "manual"]}
              </span>
              {item.facts.draft ? <Chip>Draft</Chip> : null}
              {item.facts.checks !== "none" ? (
                <span>
                  Checks{" "}
                  {item.facts.checks === "success"
                    ? "passed"
                    : item.facts.checks === "failure"
                      ? "failed"
                      : "pending"}
                </span>
              ) : null}
              <span>{waitingAge(item.activeAt, now)}</span>
            </div>
          </div>
        </>
      )}
      {compact ? null : (
        <ObjectActionsButton
          actions={actions}
          keys={keys}
          onAction={(action) =>
            runPullRequestAction(
              item,
              action as Exclude<PullRequestAction, "open">,
            )
          }
          label={`Actions for ${item.facts.title}`}
        />
      )}
    </ObjectContextMenu>
  );
}
