import { useEffect, useState } from "react";
import type { ConnectorSettleState } from "@ajour/shared";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field";
import { NativeSelect } from "@/components/ui/select";
import {
  settleArchivesWorkItem,
  type BacklogSettleChange,
} from "@/domain/backlog/backlog-item-lifecycle";
import {
  getPriorityLevel,
  getSourcePriority,
  getWorkItemPriorityRanges,
  NO_PRIORITY_NAME,
  PRIORITY_LEVELS,
} from "@/domain/backlog/priority";
import type { LocalWorkItem } from "@/domain/local-state";
import { findSettleRule } from "@/domain/backlog/settle-rules";
import {
  canWriteSettle,
  sendPendingSourceWrites,
} from "@/features/backlog/backlog-source-writes";
import { resolveIncludeSubitems } from "@/features/backlog/backlog-item-moves";
import { formatPriorityInput } from "@/features/backlog/backlog-task-editor";
import {
  buildSettleChange,
  findSettleState,
  groupSettleStates,
} from "@/features/backlog/settle-draft";
import { offerUndo } from "@/features/feedback/undo-toast";
import { listConnectorSettleStates } from "@/lib/app-api";
import { localStore } from "@/lib/local-store";
import { useLocalState } from "@/lib/local-hooks";

let requestListener:
  ((workItemId: string, prefill?: BacklogSettleChange) => void) | null = null;

/**
 * Opens the settle dialog for a synced backlog item, starting at `prefill`
 * where given and at the item's current values otherwise. Does nothing until
 * the app shell has mounted the dialog.
 */
export function requestSettle(
  workItemId: string,
  prefill?: BacklogSettleChange,
) {
  requestListener?.(workItemId, prefill);
}

/**
 * How Settle behaves on an item. Items whose connector can't write settle
 * locally. Others follow their source project's settle rule: Ask opens the
 * dialog, Apply settles with the rule's change. `ask`, from Shift+E or
 * Shift-click, opens the dialog prefilled with the rule instead.
 */
export function getSettleBehavior(
  workItem: LocalWorkItem,
  { ask = false }: { ask?: boolean } = {},
):
  | { kind: "local" }
  | { kind: "ask"; prefill?: BacklogSettleChange }
  | { kind: "apply"; change: BacklogSettleChange } {
  if (!canWriteSettle(workItem)) {
    return { kind: "local" };
  }

  const rule = findSettleRule(localStore.snapshot().settleRules, workItem);
  const change = rule
    ? { state: rule.state, priority: rule.priority }
    : undefined;
  return change && !ask
    ? { kind: "apply", change }
    : { kind: "ask", prefill: change };
}

/** Whether Settle opens the dialog, shown as "Settle…" in action menus. */
export function settleOpensDialog(workItem: LocalWorkItem) {
  return getSettleBehavior(workItem).kind === "ask";
}

/** Runs Settle on an item: the dialog, the rule's change, or a local settle. */
export function settleBacklogItem(
  workItem: LocalWorkItem,
  options?: { ask?: boolean },
) {
  const behavior = getSettleBehavior(workItem, options);
  if (behavior.kind === "ask") {
    requestSettle(workItem._id, behavior.prefill);
  } else {
    settleBacklogItemWithUndo(
      workItem,
      behavior.kind === "apply" ? behavior.change : undefined,
    );
  }
}

/**
 * Settles the item, with Undo in a toast. A parent with open subitems asks
 * whether they settle too, unless the user's setting answers. A change to the
 * source is sent when the toast closes, so Undo cancels it (ADR 0001).
 */
export async function settleBacklogItemWithUndo(
  workItem: LocalWorkItem,
  change?: BacklogSettleChange,
) {
  const includeSubitems = await resolveIncludeSubitems(workItem, "settle");
  if (includeSubitems === null) return false;

  const token = localStore.settleWorkItem(workItem._id, change, {
    includeSubitems,
  });
  if (!token) return false;
  const settled = localStore
    .snapshot()
    .workItems.find((candidate) => candidate._id === workItem._id);
  offerUndo(token, {
    title:
      settled?.status === "archived"
        ? "Backlog item archived"
        : "Backlog item settled",
    subject: "backlog item",
    onWindowClosed: settled?.pendingSourceWrite
      ? () => void sendPendingSourceWrites([workItem._id])
      : undefined,
  });
  return true;
}

type StatesLoad =
  | { status: "loading" }
  | { status: "ready"; states: ConnectorSettleState[] }
  | { status: "failed"; message: string };

/**
 * The settle dialog: a state picker grouped by state category and a priority,
 * both starting at the item's current values. Settling with nothing changed
 * stays local. Mounted once in the app shell.
 */
export function SettleDialogHost() {
  const state = useLocalState();
  const [workItem, setWorkItem] = useState<LocalWorkItem | null>(null);
  const [load, setLoad] = useState<StatesLoad>({ status: "loading" });
  const [stateName, setStateName] = useState("");
  const [priority, setPriority] = useState("");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    const listener = (id: string, prefill?: BacklogSettleChange) => {
      const item = localStore
        .snapshot()
        .workItems.find((candidate) => candidate._id === id);
      if (!item) return;
      setWorkItem(item);
      setStateName(prefill?.state?.name ?? item.sourceStatusLabel ?? "");
      setPriority(
        formatPriorityInput(
          getPriorityLevel(
            prefill?.priority ?? item.importedPriority,
            getWorkItemPriorityRanges(localStore.snapshot(), item),
          ) ?? item.priority,
        ),
      );
      setLoad({ status: "loading" });
    };
    requestListener = listener;
    return () => {
      if (requestListener === listener) requestListener = null;
    };
  }, []);

  useEffect(() => {
    if (!workItem?.sourceId || !workItem.sourceConnectionId) return;
    let cancelled = false;
    listConnectorSettleStates(
      workItem.source,
      workItem.sourceConnectionId,
      workItem.sourceId,
    ).then(
      (result) => {
        if (!cancelled) setLoad({ status: "ready", states: result.states });
      },
      (error: unknown) => {
        if (!cancelled) {
          setLoad({
            status: "failed",
            message: error instanceof Error ? error.message : "Unknown error",
          });
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [workItem]);

  const states = load.status === "ready" ? load.states : [];
  const currentListed = Boolean(
    findSettleState(states, workItem?.sourceStatusLabel),
  );
  const priorityRanges = workItem
    ? getWorkItemPriorityRanges(state, workItem)
    : {};
  const sourceHasPriority =
    getPriorityLevel(workItem?.importedPriority, priorityRanges) !== undefined;
  const change = workItem
    ? buildSettleChange(states, stateName, priority, {
        importedPriority: workItem.importedPriority,
        ranges: priorityRanges,
      })
    : null;
  const currentItem = state.workItems.find(
    (item) => item._id === workItem?._id,
  );
  const archives = Boolean(
    currentItem &&
    settleArchivesWorkItem(state, currentItem, change ?? undefined),
  );

  async function settle() {
    if (!workItem || !change || pending) return;
    setPending(true);
    try {
      if (await settleBacklogItemWithUndo(workItem, change)) setWorkItem(null);
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      open={Boolean(workItem)}
      onOpenChange={(open) => !open && !pending && setWorkItem(null)}
    >
      <DialogContent className="max-w-sm gap-4">
        <DialogHeader className="gap-1">
          <DialogTitle>Settle</DialogTitle>
          <DialogDescription className="truncate">
            {workItem?.title}
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void settle();
          }}
        >
          <Field>
            <FieldLabel htmlFor="settle-state">State</FieldLabel>
            <FieldContent>
              <NativeSelect
                id="settle-state"
                value={stateName}
                disabled={load.status !== "ready" || pending}
                onChange={(event) => setStateName(event.target.value)}
              >
                {!currentListed ? (
                  <option value={workItem?.sourceStatusLabel ?? ""}>
                    {load.status === "loading"
                      ? "Loading states…"
                      : (workItem?.sourceStatusLabel ?? "No state")}
                  </option>
                ) : null}
                {groupSettleStates(states).map((group) => (
                  <optgroup key={group.category} label={group.category}>
                    {group.states.map((state) => (
                      <option key={state.name} value={state.name}>
                        {state.name}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </NativeSelect>
              {load.status === "failed" ? (
                <FieldError>Couldn't load states: {load.message}</FieldError>
              ) : archives ? (
                <FieldDescription>
                  This state is done, so the item will be archived.
                </FieldDescription>
              ) : null}
            </FieldContent>
          </Field>
          <Field>
            <FieldLabel htmlFor="settle-priority">Priority</FieldLabel>
            <FieldContent>
              <NativeSelect
                id="settle-priority"
                disabled={pending}
                value={priority}
                onChange={(event) => setPriority(event.target.value)}
              >
                <option value="" disabled={sourceHasPriority}>
                  {NO_PRIORITY_NAME}
                </option>
                {PRIORITY_LEVELS.map(({ level, name }) => (
                  <option
                    key={level}
                    value={String(level)}
                    disabled={
                      getSourcePriority(level, priorityRanges) === undefined
                    }
                  >
                    {name}
                  </option>
                ))}
              </NativeSelect>
              {change === null ? (
                <FieldError>
                  {priority === "" && sourceHasPriority
                    ? "This connector cannot clear its source priority. Choose a priority."
                    : "This priority has no source range. Choose another priority."}
                </FieldError>
              ) : null}
            </FieldContent>
          </Field>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              disabled={pending}
              onClick={() => setWorkItem(null)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={change === null || pending}>
              {archives ? "Archive" : "Settle"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
