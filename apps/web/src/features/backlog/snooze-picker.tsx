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
import { offerUndo } from "@/features/feedback/undo-toast";
import {
  formatSnoozeTime,
  getSnoozePresets,
} from "@/features/backlog/snooze-presets";
import { localStore } from "@/lib/local-store";

let requestListener: ((workItemId: string) => void) | null = null;

/**
 * Opens the Snooze… picker for a backlog item. Snooze… in any action menu, the
 * B key and the sidebar's Snooze button all come here. Does nothing until the
 * app shell has mounted the picker.
 */
export function requestSnooze(workItemId: string) {
  requestListener?.(workItemId);
}

/** Snoozes the item, with Undo in a toast. */
export function snoozeBacklogItem(workItemId: string, until: number) {
  offerUndo(localStore.snoozeWorkItem(workItemId, until), {
    // "Today" and "Tomorrow" start the list labels but sit mid-sentence here.
    title: `Snoozed until ${formatSnoozeTime(until, Date.now()).replace(
      /^(Today|Tomorrow)/,
      (word) => word.toLowerCase(),
    )}`,
    subject: "backlog item",
  });
}

/** The Snooze… dialog: the presets, then a custom date and time. Mounted once in the app shell. */
export function SnoozePickerHost() {
  const [workItemId, setWorkItemId] = useState<string | null>(null);
  const [custom, setCustom] = useState("");
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const listener = (id: string) => {
      setNow(Date.now());
      setCustom("");
      setWorkItemId(id);
    };
    requestListener = listener;
    return () => {
      if (requestListener === listener) requestListener = null;
    };
  }, []);

  const workItem = workItemId
    ? localStore.snapshot().workItems.find((item) => item._id === workItemId)
    : undefined;
  const customUntil = custom ? new Date(custom).getTime() : Number.NaN;
  const customIsValid = Number.isFinite(customUntil) && customUntil > now;

  function choose(until: number) {
    if (workItemId) {
      snoozeBacklogItem(workItemId, until);
    }
    setWorkItemId(null);
  }

  return (
    <Dialog
      open={Boolean(workItem)}
      onOpenChange={(open) => !open && setWorkItemId(null)}
    >
      <DialogContent className="max-w-sm gap-4">
        <DialogHeader className="gap-1">
          <DialogTitle>Snooze until</DialogTitle>
          <DialogDescription className="truncate">
            {workItem?.title}
          </DialogDescription>
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
