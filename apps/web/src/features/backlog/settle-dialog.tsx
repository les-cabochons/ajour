import { useEffect, useMemo, useState } from "react";
import type { BacklogPerson, BacklogSettleState } from "@ajour/shared";
import { MarkdownEditor } from "@/components/markdown-editor";
import { PersonCombobox } from "@/components/person-combobox";
import { Button } from "@/components/ui/button";
import { ToggleChip } from "@/components/ui/toggle-chip";
import { RiNodeTree as SubitemsIcon } from "@remixicon/react";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
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
import { OptionSelect } from "@/components/ui/option-select";
import { PriorityIcon } from "@/features/backlog/priority-icon";
import {
  getOpenSubitems,
  settleArchivesWorkItem,
  type BacklogSettleChange,
} from "@/domain/backlog/backlog-item-lifecycle";
import {
  assigneeSourceOf,
  type AssigneeSource,
} from "@/domain/backlog/assignees";
import { commentSourceOf, itemPeopleMatching } from "@/domain/backlog/comments";
import { NO_PRIORITY_NAME, PRIORITY_LEVELS } from "@/domain/backlog/priority";
import type { LocalWorkItem } from "@/domain/local-state";
import { findSettleRule } from "@/domain/backlog/settle-rules";
import {
  canWriteSettle,
  releaseSettleComment,
  sendPendingSourceWrites,
} from "@/features/backlog/backlog-source-writes";
import { commentMentionSearch } from "@/features/backlog/comment-threads";
import { resolveIncludeSubitems } from "@/features/backlog/backlog-item-moves";
import { formatPriorityInput } from "@/features/backlog/backlog-task-editor";
import {
  buildSettleChange,
  groupSettleStates,
  isSettleStateDraftValid,
  settleToastTitle,
} from "@/features/backlog/settle-draft";
import { offerUndo } from "@/features/feedback/undo-toast";
import {
  getCachedPluginsOverview,
  listBacklogSettleStates,
  searchBacklogAssignees,
} from "@/lib/app-api";
import { localStore, runStoreCommandWith } from "@/lib/local-store";
import { queueSettleComment } from "@/lib/settle-comments";
import { useLocalState } from "@/lib/local-hooks";

/**
 * Runs once the item is settled, telling whether the comment given went with
 * it, so the comment editor clears its draft only then. Cancel and a closed
 * subitem question never call it.
 */
export type OnSettled = (result: { commentQueued: boolean }) => void;

/** A settle that a caller asked for with a comment or a callback. */
export interface SettleRequest {
  /** Starts in the dialog's Comment field, or goes with a settle that has none. */
  comment?: string;
  onSettled?: OnSettled;
}

/** What a settle did. Nothing when the subitem question was cancelled. */
export type SettleResult =
  { settled: false } | { settled: true; commentQueued: boolean };

let requestListener:
  | ((
      workItemId: string,
      prefill?: BacklogSettleChange,
      request?: SettleRequest,
    ) => void)
  | null = null;

/**
 * Opens the settle dialog for a synced backlog item, starting at `prefill`
 * where given and at the item's current values otherwise. Does nothing until
 * the app shell has mounted the dialog.
 */
export function requestSettle(
  workItemId: string,
  prefill?: BacklogSettleChange,
  request?: SettleRequest,
) {
  requestListener?.(workItemId, prefill, request);
}

/**
 * How Settle behaves on an item. Items whose plugin can't write settle
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

/**
 * Runs Settle on an item: the dialog, the rule's change, or a local settle.
 * A comment from the comment editor starts in the dialog, or goes with the
 * settle, and `onSettled` runs once the item is settled.
 */
export function settleBacklogItem(
  workItem: LocalWorkItem,
  { ask, ...request }: { ask?: boolean } & SettleRequest = {},
) {
  const behavior = getSettleBehavior(workItem, { ask });
  if (behavior.kind === "ask") {
    requestSettle(workItem._id, behavior.prefill, request);
  } else {
    void settleBacklogItemWithUndo(
      workItem,
      behavior.kind === "apply" ? behavior.change : undefined,
      request.comment,
      behavior.kind === "apply" ? "rule" : "local",
    ).then((result) => {
      if (result.settled) request.onSettled?.(result);
    });
  }
}

/**
 * Settles the item, with Undo in a toast. A parent with open subitems asks
 * whether they settle too, unless the user's setting answers. A change to the
 * source is sent when the toast closes, so Undo cancels it (ADR 0001). A
 * comment follows the change, or goes when the toast closes if nothing else
 * is written (ADR 0008). `behavior` says what chose the change, for the
 * settle's wide event: a local settle, the rule, or the dialog.
 */
export async function settleBacklogItemWithUndo(
  workItem: LocalWorkItem,
  change?: BacklogSettleChange,
  comment?: string,
  behavior: "local" | "rule" | "ask" = change ? "rule" : "local",
  /** The settle dialog's own answer, so no second dialog asks. */
  includeSubitemsChoice?: boolean,
): Promise<SettleResult> {
  const includeSubitems =
    includeSubitemsChoice ?? (await resolveIncludeSubitems(workItem, "settle"));
  if (includeSubitems === null) return { settled: false };
  let commentQueued = false;

  // The settle's event takes what only this workflow knows: what chose the
  // change, and the comment's length, never its text.
  const token = runStoreCommandWith(
    "settleWorkItem",
    [workItem._id, change, { includeSubitems }],
    (unit, token) => {
      unit.set({ backlog_item: { behavior } });
      if (!token) return;
      commentQueued = afterSettle(
        workItem,
        token,
        comment,
        change?.assignee,
      ).commentQueued;
      unit.set({
        comment: {
          queued: commentQueued,
          body_length: commentQueued ? comment?.trim().length : undefined,
        },
      });
    },
  );
  return token === null ? { settled: false } : { settled: true, commentQueued };
}

/** Queues the settle's comment, and offers its Undo. */
function afterSettle(
  workItem: LocalWorkItem,
  token: string,
  comment?: string,
  assignee?: BacklogPerson | null,
) {
  const settled = localStore
    .snapshot()
    .workItems.find((candidate) => candidate._id === workItem._id);
  const body = comment?.trim();
  const commentSource = body
    ? commentSourceOf(workItem, getCachedPluginsOverview())
    : undefined;
  const commentId = crypto.randomUUID();
  if (body && commentSource) {
    queueSettleComment({
      id: commentId,
      settleId: settled?.settleId,
      itemId: workItem._id,
      pluginId: commentSource.pluginId,
      connectionId: commentSource.connectionId,
      sourceId: commentSource.sourceId,
      body,
      at: Date.now(),
    });
  }
  const commented = Boolean(body && commentSource);
  offerUndo(token, {
    title: settleToastTitle({
      archived: settled?.status === "archived",
      commented,
      assignee,
    }),
    subject: "backlog item",
    onWindowClosed:
      settled?.pendingSourceWrite || commentSource
        ? () => {
            void sendPendingSourceWrites([workItem._id]);
            // This settle's own comment only; it waits for the write above.
            if (commentSource) {
              void releaseSettleComment(commentId, workItem._id);
            }
          }
        : undefined,
  });
  return { commentQueued: commented };
}

type StatesLoad =
  | { status: "loading" }
  | { status: "ready"; states: BacklogSettleState[] }
  | { status: "failed"; message: string };

/**
 * The people a settle can assign the item to. With people search off, a
 * typed name filters the likely assignees instead of searching the
 * organisation, as the @ suggestions do.
 */
function assigneeSearch(source: AssigneeSource) {
  const search = async (query: string) =>
    (
      await searchBacklogAssignees(source.pluginId, source.connectionId, {
        sourceId: source.sourceId,
        query,
        limit: 20,
      })
    ).people;
  return source.peopleSearchOff
    ? async (query: string) => itemPeopleMatching(await search(""), query)
    : search;
}

/**
 * The settle dialog: a state picker grouped by state category, a priority
 * and, for a plugin that assigns, an assignee, all starting at the item's
 * current values. Settling with nothing changed stays local. Mounted once in
 * the app shell.
 */
export function SettleDialogHost() {
  const state = useLocalState();
  const [workItem, setWorkItem] = useState<LocalWorkItem | null>(null);
  const [load, setLoad] = useState<StatesLoad>({ status: "loading" });
  const [stateName, setStateName] = useState("");
  const [priority, setPriority] = useState("");
  // Undefined keeps the assignee: the item's, or none known yet.
  const [assignee, setAssignee] = useState<BacklogPerson | null | undefined>();
  const [comment, setComment] = useState("");
  // Set when the comment editor opened the dialog with its draft.
  const [onSettled, setOnSettled] = useState<OnSettled | undefined>();
  const [pending, setPending] = useState(false);
  // Whether the settle takes the open subitems along, asked in this form.
  const [includeSubitems, setIncludeSubitems] = useState(true);

  useEffect(() => {
    const listener = (
      id: string,
      prefill?: BacklogSettleChange,
      request?: SettleRequest,
    ) => {
      const item = localStore
        .snapshot()
        .workItems.find((candidate) => candidate._id === id);
      if (!item) return;
      setWorkItem(item);
      setStateName(prefill?.state?.name ?? item.sourceStatusLabel ?? "");
      setPriority(
        formatPriorityInput(
          prefill?.priority ?? item.importedPriority ?? item.priority,
        ),
      );
      setAssignee(item.assignee);
      setComment(request?.comment ?? "");
      setIncludeSubitems(true);
      setOnSettled(() => request?.onSettled);
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
    listBacklogSettleStates(
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

  const currentItem = state.workItems.find(
    (item) => item._id === workItem?._id,
  );
  const states = load.status === "ready" ? load.states : [];
  const draftListed = states.some((state) => state.name === stateName);
  const stateDraftValid = isSettleStateDraftValid(
    states,
    stateName,
    currentItem?.sourceStatusLabel,
  );
  const sourceHasPriority = currentItem?.importedPriority !== undefined;
  // Only an item whose plugin assigns offers an assignee.
  const assigneeSource = currentItem
    ? assigneeSourceOf(currentItem, getCachedPluginsOverview())
    : undefined;
  // One search per item, so the field doesn't search again on each render.
  const { pluginId, connectionId, sourceId, peopleSearchOff } =
    assigneeSource ?? {};
  const searchAssignees = useMemo(
    () =>
      pluginId && connectionId && sourceId
        ? assigneeSearch({ pluginId, connectionId, sourceId, peopleSearchOff })
        : undefined,
    [pluginId, connectionId, sourceId, peopleSearchOff],
  );
  const change = currentItem
    ? buildSettleChange(
        states,
        stateName,
        priority,
        {
          sourceStatusLabel: currentItem.sourceStatusLabel,
          importedPriority: currentItem.importedPriority,
          assignee: currentItem.assignee,
        },
        assigneeSource ? assignee : undefined,
      )
    : null;
  const archives = Boolean(
    currentItem &&
    settleArchivesWorkItem(state, currentItem, change ?? undefined),
  );
  // Only an item whose plugin reads and posts comments offers one.
  const commentSource = currentItem
    ? commentSourceOf(currentItem, getCachedPluginsOverview())
    : undefined;
  const commentLimit = commentSource?.capability.maxLength;
  const commentTooLong =
    commentLimit !== undefined && comment.trim().length > commentLimit;

  // A parent with open subitems asks about them here, in the same form, when
  // the user's setting leaves it to them (forms council round 5).
  const openSubitems = currentItem
    ? getOpenSubitems(state, currentItem._id, "settle")
    : [];
  const subitemPreference = state.userPreferences.closeParentSubitems;
  const asksSubitems =
    openSubitems.length > 0 &&
    subitemPreference !== "include" &&
    subitemPreference !== "leave";

  async function settle() {
    if (!currentItem || !change || pending || commentTooLong) return;
    setPending(true);
    try {
      const result = await settleBacklogItemWithUndo(
        currentItem,
        change,
        commentSource ? comment : undefined,
        "ask",
        asksSubitems ? includeSubitems : undefined,
      );
      if (result.settled) {
        onSettled?.(result);
        setWorkItem(null);
      }
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
          {/* The composer's header: the verb as a quiet kicker, the item
              as the subject (forms council round 9). */}
          <DialogTitle className="composer-kicker">Settle</DialogTitle>
          <DialogDescription className="truncate text-[15px] font-semibold text-foreground">
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
          {/* Settle as a composer (forms council round 7): State and
              Priority as chips, the comment to write in, the subitems as a
              toggle chip. */}
          <div className="composer flex flex-col gap-3">
            <div className="composer-chips" role="group" aria-label="Settle as">
              <OptionSelect
                id="settle-state"
                label="State"
                size="sm"
                className="composer-chip"
                prefix={<span className="text-muted-foreground">State ·</span>}
                value={stateName}
                invalid={load.status === "ready" && !stateDraftValid}
                disabled={load.status !== "ready" || pending}
                onChange={setStateName}
                options={
                  draftListed
                    ? []
                    : [
                        {
                          value: stateName,
                          label:
                            load.status === "loading"
                              ? "Loading states…"
                              : stateName || "No state",
                        },
                      ]
                }
                groups={groupSettleStates(states).map((group) => ({
                  label: group.category,
                  options: group.states.map((state) => ({
                    value: state.name,
                    label: state.name,
                  })),
                }))}
              />
              <OptionSelect
                id="settle-priority"
                label="Priority"
                size="sm"
                iconLabel
                className="composer-chip"
                disabled={pending}
                value={priority}
                onChange={setPriority}
                options={[
                  {
                    value: "",
                    label: NO_PRIORITY_NAME,
                    disabled: sourceHasPriority,
                    icon: <PriorityIcon priority={undefined} decorative />,
                  },
                  ...PRIORITY_LEVELS.map(({ level, name }) => ({
                    value: String(level),
                    label: name,
                    icon: <PriorityIcon priority={level} decorative />,
                  })),
                ]}
              />
              {asksSubitems ? (
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <ToggleChip
                        id="settle-subitems"
                        checked={includeSubitems}
                        disabled={pending}
                        onCheckedChange={setIncludeSubitems}
                        icon={<SubitemsIcon aria-hidden className="size-3.5" />}
                      />
                    }
                  >
                    Also settle its {openSubitems.length} open{" "}
                    {openSubitems.length === 1 ? "subitem" : "subitems"}
                  </TooltipTrigger>
                  <TooltipContent>
                    {openSubitems
                      .slice(0, 3)
                      .map((subitem) => subitem.title)
                      .join(", ")}
                    {openSubitems.length > 3
                      ? `, and ${openSubitems.length - 3} more`
                      : ""}
                  </TooltipContent>
                </Tooltip>
              ) : null}
            </div>
            {load.status === "failed" ? (
              <FieldError>Couldn't load states: {load.message}</FieldError>
            ) : load.status === "ready" && !stateDraftValid ? (
              <FieldError>
                This source state is no longer available. Choose another state.
              </FieldError>
            ) : archives ? (
              <FieldDescription>
                This state is done, so the item will be archived.
              </FieldDescription>
            ) : null}

            {change === null && stateDraftValid ? (
              <FieldError>
                This plugin cannot clear its source priority. Choose a priority.
              </FieldError>
            ) : null}
            {searchAssignees && currentItem ? (
              <Field>
                <FieldLabel htmlFor="settle-assignee">Assignee</FieldLabel>
                <FieldContent>
                  <PersonCombobox
                    id="settle-assignee"
                    disabled={pending}
                    value={assignee}
                    current={currentItem.assignee}
                    onChange={setAssignee}
                    search={searchAssignees}
                  />
                </FieldContent>
              </Field>
            ) : null}
            {commentSource && currentItem ? (
              <Field>
                <FieldLabel htmlFor="settle-comment" className="sr-only">
                  Comment
                </FieldLabel>
                <FieldContent>
                  <MarkdownEditor
                    id="settle-comment"
                    aria-label="Comment"
                    className="composer-body"
                    value={comment}
                    onChange={setComment}
                    onSubmit={() => void settle()}
                    placeholder="Add a comment…"
                    minLines={1}
                    mentions={commentMentionSearch(
                      commentSource,
                      currentItem._id,
                    )}
                  />
                  {commentTooLong ? (
                    <FieldError>
                      The source takes up to {commentLimit!.toLocaleString()}{" "}
                      characters.
                    </FieldError>
                  ) : (
                    <FieldDescription>
                      Posted on the item when the Undo toast closes.
                    </FieldDescription>
                  )}
                </FieldContent>
              </Field>
            ) : null}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              disabled={pending}
              onClick={() => setWorkItem(null)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={change === null || pending || commentTooLong}
            >
              {archives ? "Archive" : "Settle"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
