import { lazy, Suspense, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { isValidLocalDate } from "@/domain/time/local-date";
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

/*
 * The calendar loads with the dialog, not with this module: actions and
 * rows import the snooze request from here and need none of it.
 */
const DateField = lazy(() =>
  import("@/components/ui/date-field").then((module) => ({
    default: module.DateField,
  })),
);

/**
 * Runs once the item is snoozed, telling whether the comment given went with
 * it, so the comment editor clears its draft only then. Closing the picker
 * without a time never calls it.
 */
export type OnSnoozed = (result: { commentQueued: boolean }) => void;

/** A snooze that a caller asked for with a comment or a callback. */
export interface SnoozeRequest {
  comment?: string;
  onSnoozed?: OnSnoozed;
}

/** What a snooze did. Nothing when the item couldn't be snoozed. */
export type SnoozeResult =
  { snoozed: false } | { snoozed: true; commentQueued: boolean };

type SnoozeTarget =
  | { kind: "backlog-item"; id: string; request?: SnoozeRequest }
  | { kind: "pull-request"; id: string };
let requestListener: ((target: SnoozeTarget) => void) | null = null;

/**
 * Opens the Snooze… picker for a backlog item. Snooze… in any action menu, the
 * B key, the sidebar's Snooze button and the comment editor's Comment and
 * snooze all come here. Does nothing until the app shell has mounted the
 * picker.
 */
export function requestSnooze(workItemId: string, request?: SnoozeRequest) {
  requestListener?.({ kind: "backlog-item", id: workItemId, request });
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
): SnoozeResult {
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
  if (!token) return { snoozed: false };
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
  return { snoozed: true, commentQueued: Boolean(commentSource) };
}

/** The Snooze… dialog: the presets, then a custom date and time. Mounted once in the app shell. */
export function SnoozePickerHost() {
  const [target, setTarget] = useState<SnoozeTarget | null>(null);
  const [customDate, setCustomDate] = useState("");
  const [customTime, setCustomTime] = useState("9:00");
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const listener = (target: SnoozeTarget) => {
      setNow(Date.now());
      setCustomDate("");
      setCustomTime("9:00");
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
  const timeMatch = customTime.trim().match(/^(\d{1,2}):(\d{2})$/);
  const customUntil =
    isValidLocalDate(customDate) &&
    timeMatch &&
    Number(timeMatch[1]) < 24 &&
    Number(timeMatch[2]) < 60
      ? new Date(
          `${customDate}T${timeMatch[1]!.padStart(2, "0")}:${timeMatch[2]}:00`,
        ).getTime()
      : Number.NaN;
  const customIsValid = Number.isFinite(customUntil) && customUntil > now;

  function choose(until: number) {
    if (target?.kind === "backlog-item") {
      const result = snoozeBacklogItem(
        target.id,
        until,
        target.request?.comment,
      );
      if (result.snoozed) target.request?.onSnoozed?.(result);
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
          <DialogTitle className="composer-kicker">Snooze until</DialogTitle>
          <DialogDescription className="truncate text-[15px] font-semibold text-foreground">
            {title}
          </DialogDescription>
          {target?.kind === "backlog-item" && target.request?.comment ? (
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
          {/* The custom time as chips, as the composers': the day, then
              the time typed in place (forms council round 7). */}
          <div className="composer-chips min-w-0 flex-1">
            <Suspense fallback={<div className="min-w-0 flex-1" />}>
              <div className="composer-date">
                <DateField
                  chip
                  aria-label="Custom date"
                  calendarLabel="Pick the day"
                  value={customDate}
                  onChange={setCustomDate}
                />
              </div>
            </Suspense>
            <div className="composer-chip composer-estimate">
              <label htmlFor="snooze-custom-time">At</label>
              <input
                id="snooze-custom-time"
                aria-label="Custom time"
                className="composer-estimate-input"
                inputMode="numeric"
                autoComplete="off"
                placeholder="9:00"
                value={customTime}
                onChange={(event) => setCustomTime(event.target.value)}
              />
            </div>
          </div>
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
