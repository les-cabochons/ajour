import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { commentSourceOf } from "@/domain/backlog/comments";
import { releaseSettleComment } from "@/features/backlog/backlog-source-writes";
import { offerUndo } from "@/features/feedback/undo-toast";
import {
  formatSnoozeTime,
  getSnoozePresets,
} from "@/features/backlog/snooze-presets";
import { getCachedPluginsOverview } from "@/lib/app-api";
import { localStore, runStoreCommandWith } from "@/lib/local-store";
import { queueSettleComment } from "@/lib/settle-comments";

/**
 * A comment that goes with the snooze, from the comment editor's Comment and
 * snooze. `onSnoozed` runs once the snooze is made, so the editor can clear
 * the draft; closing the picker without a time posts nothing.
 */
export interface SnoozeComment {
  body: string;
  onSnoozed: () => void;
}

type SnoozeTarget =
  | { kind: "backlog-item"; id: string; comment?: SnoozeComment }
  | { kind: "pull-request"; id: string };
let requestListener: ((target: SnoozeTarget) => void) | null = null;

/**
 * Opens the Snooze… picker for a backlog item. Snooze… in any action menu, the
 * B key, the sidebar's Snooze button and the comment editor's Comment and
 * snooze all come here. Does nothing until the app shell has mounted the
 * picker.
 */
export function requestSnooze(workItemId: string, comment?: SnoozeComment) {
  requestListener?.({ kind: "backlog-item", id: workItemId, comment });
}

export function requestPullRequestSnooze(id: string) {
  requestListener?.({ kind: "pull-request", id });
}

/**
 * Snoozes the item, with Undo in a toast. A comment waits for the toast to
 * close, then goes to the source tool, as a settle's comment does (ADR
 * 0008); Undo keeps it as the item's draft instead.
 */
export function snoozeBacklogItem(
  workItemId: string,
  until: number,
  comment?: string,
) {
  const workItem = localStore
    .snapshot()
    .workItems.find((candidate) => candidate._id === workItemId);
  const body = comment?.trim();
  const commentSource =
    body && workItem
      ? commentSourceOf(workItem, getCachedPluginsOverview())
      : undefined;
  const commentId = crypto.randomUUID();
  // The event takes the comment's length, never its text.
  const token = runStoreCommandWith(
    "snoozeWorkItem",
    [workItemId, until],
    (unit, token) => {
      if (!token) return;
      unit.set({
        comment: {
          queued: Boolean(commentSource),
          body_length: commentSource ? body?.length : undefined,
        },
      });
    },
  );
  if (!token) return false;
  if (body && commentSource) {
    queueSettleComment({
      id: commentId,
      itemId: workItemId,
      pluginId: commentSource.pluginId,
      connectionId: commentSource.connectionId,
      sourceId: commentSource.sourceId,
      body,
      at: Date.now(),
      snoozedUntil: until,
    });
  }
  // "Today" and "Tomorrow" start the list labels but sit mid-sentence here.
  const when = formatSnoozeTime(until, Date.now()).replace(
    /^(Today|Tomorrow)/,
    (word) => word.toLowerCase(),
  );
  offerUndo(token, {
    title: commentSource
      ? `Commented and snoozed until ${when}`
      : `Snoozed until ${when}`,
    subject: "backlog item",
    onWindowClosed: commentSource
      ? () => void releaseSettleComment(commentId, workItemId)
      : undefined,
  });
  return true;
}

/** The Snooze… dialog: the presets, then a custom date and time. Mounted once in the app shell. */
export function SnoozePickerHost() {
  const [target, setTarget] = useState<SnoozeTarget | null>(null);
  const [custom, setCustom] = useState("");
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const listener = (target: SnoozeTarget) => {
      setNow(Date.now());
      setCustom("");
      setTarget(target);
    };
    requestListener = listener;
    return () => {
      if (requestListener === listener) requestListener = null;
    };
  }, []);

  const state = localStore.snapshot();
  const workItem =
    target?.kind === "backlog-item"
      ? state.workItems.find((item) => item._id === target.id)
      : undefined;
  const pullRequest =
    target?.kind === "pull-request"
      ? state.pullRequests?.find((item) => item._id === target.id)
      : undefined;
  const title = workItem?.title ?? pullRequest?.facts.title;
  const customUntil = custom ? new Date(custom).getTime() : Number.NaN;
  const customIsValid = Number.isFinite(customUntil) && customUntil > now;

  function choose(until: number) {
    if (target?.kind === "backlog-item") {
      if (snoozeBacklogItem(target.id, until, target.comment?.body)) {
        target.comment?.onSnoozed();
      }
    } else if (target)
      localStore.changePullRequest(target.id, { type: "snooze", until });
    setTarget(null);
  }

  return (
    <Dialog
      open={Boolean(title)}
      onOpenChange={(open) => !open && setTarget(null)}
    >
      <DialogContent className="max-w-sm gap-4">
        <DialogHeader className="gap-1">
          <DialogTitle>Snooze until</DialogTitle>
          <DialogDescription className="truncate">{title}</DialogDescription>
          {target?.kind === "backlog-item" && target.comment ? (
            <DialogDescription>
              Your comment is posted with the snooze.
            </DialogDescription>
          ) : null}
        </DialogHeader>
        <div className="flex flex-col gap-1">
          {getSnoozePresets(now).map((preset) => (
            <Button
              key={preset.label}
              type="button"
              variant="ghost"
              className="justify-between"
              onClick={() => choose(preset.until)}
            >
              {preset.label}
              <span className="text-muted-foreground">
                {formatSnoozeTime(preset.until, now)}
              </span>
            </Button>
          ))}
        </div>
        <form
          className="flex items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (customIsValid) choose(customUntil);
          }}
        >
          <Input
            type="datetime-local"
            aria-label="Custom date and time"
            value={custom}
            onChange={(event) => setCustom(event.target.value)}
          />
          <DialogFooter className="shrink-0">
            <Button type="submit" variant="outline" disabled={!customIsValid}>
              Snooze
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
