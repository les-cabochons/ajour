import type { BacklogSyncedDescription } from "@ajour/shared";
import { showErrorToast } from "@/components/ui/toast";
import {
  descriptionInConflict,
  descriptionSaved,
  descriptionWriteFailed,
  lostFormatting,
  planDescriptionSave,
  planKeepMine,
} from "@/domain/backlog/description-sync";
import { readBacklogDescription, writeBacklogDescription } from "@/lib/app-api";
import { localStore } from "@/lib/local-store";
import { announceDescriptionConflicts } from "@/lib/sync-conflict-events";

/**
 * Writes synced descriptions to their source (ADR 0009). A save reads the
 * source's text, merges it with the user's edit by lines, and writes the
 * result with the text it read as the expected one, so a source changed in
 * between answers with a conflict instead of losing that change. There is no
 * Undo window: like a comment, a written description is written.
 */

export type DescriptionSaveOutcome =
  /** The source held the result already, so nothing was written. */
  | { kind: "agreed" }
  | { kind: "written"; merged: boolean }
  | { kind: "conflict" }
  | { kind: "failed"; message: string };

const saving = new Map<string, Promise<DescriptionSaveOutcome>>();
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

/** Whether a save of the item's description is on its way to the source. */
export function isSavingDescription(itemId: string) {
  return saving.has(itemId);
}

export function subscribeDescriptionSaving(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function findItem(itemId: string) {
  return localStore.snapshot().workItems.find((item) => item._id === itemId);
}

/**
 * Writes the item's description, already saved locally, to its source.
 * `keepMine` resolves a conflict with the user's text. A draft a sync put in
 * conflict while it was open records that conflict instead. Saves of one item
 * run one after another, so each reads what the one before wrote.
 */
export function saveSyncedDescription(
  itemId: string,
  mode: "save" | "keepMine" = "save",
  /** What the user saw the conversion lose and saved anyway. */
  allowedLoss: readonly string[] = [],
  /** An agent's save, which the API checks against Agent access. */
  forAgent = false,
): Promise<DescriptionSaveOutcome> {
  const draftAncestor =
    mode === "save" ? conflictedDrafts.get(itemId) : undefined;
  conflictedDrafts.delete(itemId);
  const previous = saving.get(itemId);
  const run = (previous ?? Promise.resolve())
    .catch(() => undefined)
    .then(() =>
      draftAncestor !== undefined
        ? recordDraftConflict(itemId, draftAncestor)
        : runSave(itemId, mode, allowedLoss, forAgent),
    );
  saving.set(itemId, run);
  notify();
  void run.finally(() => {
    if (saving.get(itemId) !== run) return;
    saving.delete(itemId);
    notify();
  });
  return run;
}

/**
 * Open drafts a sync changed in the lines the user edited, so the draft
 * cannot take the change in. Kept outside the editor, so a draft carried to
 * another container keeps it too.
 */
const conflictedDrafts = new Map<string, string>();

/**
 * Marks the item's open draft as in conflict with what a sync brought, with
 * `ancestor`, the item's text the draft began from. The first mark keeps it.
 */
export function markDescriptionDraftConflict(itemId: string, ancestor: string) {
  if (!conflictedDrafts.has(itemId)) conflictedDrafts.set(itemId, ancestor);
}

/** A new draft of the item's description starts without a conflict. */
export function clearDescriptionDraftConflict(itemId: string) {
  conflictedDrafts.delete(itemId);
}

function recordDraftConflict(
  itemId: string,
  ancestor: string,
): DescriptionSaveOutcome {
  const sync = findItem(itemId)?.descriptionSync;
  if (!sync) return { kind: "agreed" };
  return recordConflict(
    itemId,
    {
      text: sync.remote,
      ...(sync.lost ? { lost: sync.lost } : {}),
      ...(sync.cut ? { cut: true } : {}),
    },
    ancestor,
  );
}

async function runSave(
  itemId: string,
  mode: "save" | "keepMine",
  allowedLoss: readonly string[],
  forAgent: boolean,
): Promise<DescriptionSaveOutcome> {
  const item = findItem(itemId);
  if (
    !item?.descriptionSync ||
    item.source === "manual" ||
    !item.sourceConnectionId ||
    !item.sourceId
  ) {
    return { kind: "agreed" };
  }
  const { source: pluginId, sourceConnectionId: connectionId } = item;
  const sourceId = item.sourceId;
  const saved = item.description;

  try {
    const { description: current } = await readBacklogDescription(
      pluginId,
      connectionId,
      sourceId,
      forAgent,
    );
    const now = findItem(itemId);
    if (!now?.descriptionSync) return { kind: "agreed" };
    // Text cut to fit Ajour is not the source's text: a merge with it would
    // write the cut copy back.
    if (current.cut) {
      throw new Error(
        `It is now longer in ${item.sourceConnectionLabel ?? "the source"} than Ajour keeps. Edit it there.`,
      );
    }
    // Nor is a text that lost formatting, which writing it would erase,
    // unless the user saw that loss and saved anyway.
    const unconfirmed = (current.lost ?? []).filter(
      (loss) => !allowedLoss.includes(loss),
    );
    if (unconfirmed.length > 0) {
      throw new Error(
        `Writing it would now lose its ${lostFormatting(unconfirmed)} in ${item.sourceConnectionLabel ?? "the source"}. Edit it there.`,
      );
    }
    const plan =
      mode === "keepMine"
        ? planKeepMine(item, current.text)
        : planDescriptionSave(
            now.descriptionSync.baseline,
            saved,
            current.text,
          );
    if (plan.kind === "agreed") {
      localStore.updateSyncedDescription(itemId, (latest) =>
        descriptionSaved(latest, saved, current, Date.now()),
      );
      return plan;
    }
    if (plan.kind === "conflict") return recordConflict(itemId, current);

    const result = await writeBacklogDescription(
      pluginId,
      connectionId,
      {
        sourceId,
        text: plan.text,
        expected: current.text,
        ...(allowedLoss.length > 0 ? { allowedLoss: [...allowedLoss] } : {}),
      },
      forAgent,
    );
    if (result.outcome === "conflict") {
      return recordConflict(itemId, result.description);
    }
    localStore.updateSyncedDescription(itemId, (latest) =>
      descriptionSaved(latest, saved, result.description, Date.now()),
    );
    return { kind: "written", merged: plan.merged };
  } catch (error) {
    const message =
      error instanceof Error && error.message
        ? error.message
        : "The source did not answer.";
    localStore.updateSyncedDescription(itemId, (latest) =>
      descriptionWriteFailed(latest, message, Date.now()),
    );
    showErrorToast({
      title: `Description not saved to ${item.sourceConnectionLabel ?? "the source"}`,
      description: message,
    });
    return { kind: "failed", message };
  }
}

function recordConflict(
  itemId: string,
  source: BacklogSyncedDescription,
  ancestor?: string,
): DescriptionSaveOutcome {
  const before = findItem(itemId);
  localStore.updateSyncedDescription(itemId, (latest) =>
    descriptionInConflict(latest, source, Date.now(), ancestor),
  );
  const after = findItem(itemId);
  // A conflict the item already had keeps its toast from when it began.
  if (after && !before?.descriptionSync?.conflict) {
    announceDescriptionConflicts([after]);
  }
  return { kind: "conflict" };
}
