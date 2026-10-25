import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { AppPanel } from "@/components/app-surface";
import { Markdown } from "@/components/markdown";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Value } from "@/components/ui/value";
import { getPriorityLevelName } from "@/domain/backlog/priority";
import type { LocalWorkItem } from "@/domain/local-state";
import {
  canSendHeldEdit,
  discardHeldEdit,
  heldEditBlocker,
  sendHeldEdit,
} from "@/features/backlog/held-edit-review";
import { usePluginsOverview } from "@/features/backlog/plugins-overview";
import { useHeldEdits, type HeldEdit } from "@/lib/held-edits";
import { useLocalWorkItems } from "@/lib/local-hooks";
import { cn } from "@/lib/utils";

const ESTIMATE_LABELS = {
  originalEstimateHours: "Original estimate",
  remainingEstimateHours: "Remaining estimate",
  completedEstimateHours: "Completed",
} as const;

function heldEditKey(edit: HeldEdit) {
  return "id" in edit
    ? edit.id
    : `${edit.kind}:${edit.itemId}:${edit.kind === "estimate" ? edit.field : ""}`;
}

/** What the change is, in a few words. */
function heldEditLabel(edit: HeldEdit) {
  switch (edit.kind) {
    case "settle":
      return "Settle or move";
    case "estimate":
      return ESTIMATE_LABELS[edit.field];
    case "description":
      return "Description";
    case "comment":
      return edit.agentClient ? `Comment by ${edit.agentClient}` : "Comment";
    case "commentEdit":
      return "Comment edit";
    case "commentDelete":
      return "Comment deleted";
  }
}

/** The change itself, as it would be sent. */
function HeldEditDetail({
  edit,
  item,
}: {
  edit: HeldEdit;
  item: LocalWorkItem | undefined;
}) {
  const sourceName = item?.sourceConnectionLabel ?? "the source";
  switch (edit.kind) {
    case "settle": {
      const write = item?.pendingSourceWrite;
      const parts = [
        write?.state ? `State "${write.state}"` : undefined,
        write?.priority !== undefined
          ? `Priority ${getPriorityLevelName(write.priority)}`
          : undefined,
      ].filter(Boolean);
      return (
        <p className="text-xs text-muted-foreground">
          {parts.length > 0 ? parts.join(" · ") : "Its state in the source"}
        </p>
      );
    }
    case "estimate": {
      const state = item?.estimateSync?.[edit.field];
      return (
        <p className="text-xs text-muted-foreground">
          In Ajour: {item?.[edit.field] ?? "empty"} · In {sourceName}:{" "}
          {state?.remoteValue ?? state?.baselineValue ?? "empty"}
        </p>
      );
    }
    case "description":
      return (
        <p className="line-clamp-2 text-xs break-words text-muted-foreground">
          {item?.description?.trim() || "Empty"}
        </p>
      );
    case "comment":
    case "commentEdit":
      return (
        <div className="line-clamp-3 text-muted-foreground">
          <Markdown>{edit.body}</Markdown>
        </div>
      );
    case "commentDelete":
      return (
        <p className="text-xs text-muted-foreground">
          The comment stays hidden here until the delete is sent or discarded.
        </p>
      );
  }
}

const pluginLinkClass = "text-primary underline-offset-2 hover:underline";

/** Why a connection's held changes can't be sent now, and what to do. */
function HeldGroupBlocker({
  blocker,
  pluginId,
}: {
  blocker: ReturnType<typeof heldEditBlocker>;
  pluginId: string;
}) {
  if (blocker === undefined || blocker === "unknown") return null;
  const link = (text: string) => (
    <Link
      to="/settings/plugins/$pluginId"
      params={{ pluginId }}
      className={pluginLinkClass}
    >
      {text}
    </Link>
  );
  return (
    <p className="text-xs text-muted-foreground" data-held-blocker={blocker}>
      {blocker === "removed" ? (
        <>
          This connection was removed, so these can't be sent. Discard them, or
          add the connection again.
        </>
      ) : blocker === "paused" ? (
        <>This connection is paused. {link("Fix it")} to send these.</>
      ) : (
        <>
          Editing work items is off for this connection. {link("Turn it on")} to
          send these.
        </>
      )}
    </p>
  );
}

/** The confirmation's question, naming the kind of change. */
export function discardTitle(edit: HeldEdit) {
  switch (edit.kind) {
    case "settle":
      return "Discard this held settle?";
    case "estimate":
      return `Discard this held ${ESTIMATE_LABELS[edit.field].toLowerCase()} change?`;
    case "description":
      return "Discard this held description change?";
    case "comment":
      return "Discard this held comment?";
    case "commentEdit":
      return "Discard this held comment edit?";
    case "commentDelete":
      return "Discard this held comment deletion?";
  }
}

/** What discarding the change does, for its confirmation. */
function discardEffect(edit: HeldEdit, sourceName: string) {
  switch (edit.kind) {
    case "settle":
      return `Nothing is sent to ${sourceName}, and the item goes back to its state before.`;
    case "estimate":
      return `Nothing is sent to ${sourceName}, and the estimate takes its value there.`;
    case "description":
      return `Nothing is sent to ${sourceName}, and the description takes its text there.`;
    case "comment":
      return `The comment is deleted from this computer without being posted.`;
    case "commentEdit":
      return `The comment keeps its text in ${sourceName}.`;
    case "commentDelete":
      return `The comment stays in ${sourceName} and shows again.`;
  }
}

/**
 * The held changes in Sync review (#395): what a connection refused while
 * editing work items was off, grouped by connection. Each goes only when the
 * user sends it, through its usual path and conflict checks, or is
 * discarded after a confirmation. Leaving the page keeps them.
 */
export function HeldEditsReview({
  focusedConnectionId,
}: {
  /** The connection whose editing was just turned on, brought into view. */
  focusedConnectionId?: string;
}) {
  const edits = useHeldEdits();
  const overview = usePluginsOverview();
  const workItems = useLocalWorkItems();
  const [sending, setSending] = useState<ReadonlySet<string>>(new Set());
  const itemsById = useMemo(
    () => new Map(workItems.map((item) => [item._id, item] as const)),
    [workItems],
  );
  const groups = useMemo(() => {
    const byConnection = new Map<string, HeldEdit[]>();
    for (const edit of edits) {
      const key = `${edit.pluginId}\n${edit.connectionId}`;
      byConnection.set(key, [...(byConnection.get(key) ?? []), edit]);
    }
    return [...byConnection.values()];
  }, [edits]);

  useEffect(() => {
    if (!focusedConnectionId) return;
    document
      .querySelector(
        `[data-held-connection="${CSS.escape(focusedConnectionId)}"]`,
      )
      ?.scrollIntoView({ block: "start" });
  }, [focusedConnectionId, groups.length]);

  if (edits.length === 0) return null;

  const send = async (edit: HeldEdit) => {
    const key = heldEditKey(edit);
    setSending((current) => new Set(current).add(key));
    try {
      await sendHeldEdit(edit);
    } finally {
      setSending((current) => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });
    }
  };

  return (
    <AppPanel as="section" aria-label="Held changes">
      <h3 className="settings-subsection-title">
        {edits.length} {edits.length === 1 ? "change" : "changes"} held
      </h3>
      <p className="text-xs text-muted-foreground">
        Made while editing work items was off. Nothing is sent until you send it
        here, and leaving this page keeps them.
      </p>
      {groups.map((group) => {
        const first = group[0]!;
        const connection = overview?.connectionGroups
          .find((candidate) => candidate.plugin.id === first.pluginId)
          ?.connections.find(
            (candidate) => candidate.id === first.connectionId,
          );
        const label =
          connection?.label ??
          itemsById.get(first.itemId)?.sourceConnectionLabel ??
          "Connection";
        const blocker = heldEditBlocker(first, overview);
        return (
          <section
            key={`${first.pluginId}:${first.connectionId}`}
            aria-label={`Held changes of ${label}`}
            data-held-connection={first.connectionId}
            className={cn(
              "flex flex-col gap-3 rounded-md p-2",
              first.connectionId === focusedConnectionId &&
                "bg-[var(--hover-bg)]",
            )}
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium text-foreground">
                {label}
              </span>
              <Value tone="muted" aria-label={`${group.length} held`}>
                {group.length}
              </Value>
            </div>
            <HeldGroupBlocker blocker={blocker} pluginId={first.pluginId} />

            {group.map((edit) => {
              const item = itemsById.get(edit.itemId);
              const key = heldEditKey(edit);
              const sourceName = item?.sourceConnectionLabel ?? label;
              return (
                <div
                  key={key}
                  data-held-edit={edit.kind}
                  className="flex flex-col gap-2 desktop:flex-row desktop:items-start desktop:justify-between"
                >
                  <div className="min-w-0 space-y-0.5">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      {item ? (
                        <Link
                          to="/backlog/$itemId"
                          params={{ itemId: item._id }}
                          className="text-sm font-medium break-words text-foreground"
                        >
                          {item.title}
                        </Link>
                      ) : (
                        <span className="text-sm text-muted-foreground">
                          An item no longer in the backlog
                        </span>
                      )}
                      <Badge className="bg-muted">{heldEditLabel(edit)}</Badge>
                    </div>
                    <HeldEditDetail edit={edit} item={item} />
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    <Button
                      variant="outline"
                      disabled={
                        !canSendHeldEdit(edit, overview) || sending.has(key)
                      }
                      onClick={() => void send(edit)}
                    >
                      Send
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger
                        render={
                          <Button variant="outline" disabled={sending.has(key)}>
                            Discard
                          </Button>
                        }
                      />
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>
                            {discardTitle(edit)}
                          </AlertDialogTitle>
                          <AlertDialogDescription>
                            {discardEffect(edit, sourceName)}
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Keep it</AlertDialogCancel>
                          <AlertDialogAction
                            variant="destructive"
                            onClick={() => discardHeldEdit(edit)}
                          >
                            Discard
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </div>
              );
            })}
          </section>
        );
      })}
    </AppPanel>
  );
}
