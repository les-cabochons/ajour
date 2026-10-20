import type { BacklogSyncedDescription } from "@ajour/shared";
import { showErrorToast } from "@/components/ui/toast";
import {
  descriptionInConflict,
  descriptionSaved,
  descriptionWriteFailed,
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
 * `keepMine` resolves a conflict with the user's text. Saves of one item run
 * one after another, so each reads what the one before wrote.
 */
export function saveSyncedDescription(
  itemId: string,
  mode: "save" | "keepMine" = "save",
): Promise<DescriptionSaveOutcome> {
  const previous = saving.get(itemId);
  const run = (previous ?? Promise.resolve())
    .catch(() => undefined)
    .then(() => runSave(itemId, mode));
  saving.set(itemId, run);
  notify();
  void run.finally(() => {
    if (saving.get(itemId) !== run) return;
    saving.delete(itemId);
    notify();
  });
  return run;
}

async function runSave(
  itemId: string,
  mode: "save" | "keepMine",
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
    );
    const now = findItem(itemId);
    if (!now?.descriptionSync) return { kind: "agreed" };
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
        descriptionSaved(latest, saved, current),
      );
      return plan;
    }
    if (plan.kind === "conflict") return recordConflict(itemId, current);

    const result = await writeBacklogDescription(pluginId, connectionId, {
      sourceId,
      text: plan.text,
      expected: current.text,
    });
    if (result.outcome === "conflict") {
      return recordConflict(itemId, result.description);
    }
    localStore.updateSyncedDescription(itemId, (latest) =>
      descriptionSaved(latest, saved, result.description),
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
): DescriptionSaveOutcome {
  const before = findItem(itemId);
  localStore.updateSyncedDescription(itemId, (latest) =>
    descriptionInConflict(latest, source, Date.now()),
  );
  const after = findItem(itemId);
  // A conflict the item already had keeps its toast from when it began.
  if (after && !before?.descriptionSync?.conflict) {
    announceDescriptionConflicts([after]);
  }
  return { kind: "conflict" };
}
